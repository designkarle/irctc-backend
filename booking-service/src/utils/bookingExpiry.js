const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { config } = require('../config');
const { createLeaderElection } = require('../../../shared/utils/leaderElection');
const { forceReleaseSeatLocks } = require('./distributedLock');
const { compensateAll } = require('../services/saga.service');
const { userClient } = require('../services/userClient');
const bookingService = require('../services/booking.service');
const outbox = require('./outbox');
const { KAFKA_TOPICS } = require('../../../shared/constants/kafka-topics');

const fetchUserForNotification = async (userId) => {
     try {
          const user = await userClient.getUserById(userId);
          return user ? { email: user.email, firstName: user.firstName } : {};
     } catch (err) {
          logger.warn('Failed to enrich expiry event with user details', {
               userId,
               error: err.message,
          });
          return {};
     }
};

let expiryInterval = null;

// B3: leader election now lives in Postgres, not Redis.
//
// The old Redis SET NX had an outage failure mode that was exactly backwards: if
// Redis was unreachable, tryAcquire returned false for EVERY instance, so nobody
// ran the job. Expired bookings then accumulated with their seats held — and the
// expiry job is precisely the thing that recovers them. A Redis blip silently
// disabled the system's own repair mechanism.
//
// The lease lives in the same database as the bookings being expired, so it can't
// be unavailable while there is still work to do. It also renews itself during a
// long cycle, which the fixed 25s TTL could not (that TTL was shorter than the
// 30s interval, and a slow cycle could lose the lock mid-run to a second instance).
const leaderElection = createLeaderElection({
     prisma,
     logger,
     name: 'booking:expiry-job',
     leaseSeconds: 60,
});

/**
 * Background job that expires stale bookings.
 * Runs every BOOKING_EXPIRY_CHECK_INTERVAL_MS (default 30s).
 *
 * Uses Redis leader election so only ONE instance across all replicas
 * runs the cleanup each cycle, avoiding redundant DB scans.
 *
 * Finds bookings in PENDING / SEATS_HELD / PAYMENT_PENDING
 * where lockExpiresAt < now, compensates all saga steps,
 * and marks them as EXPIRED.
 */
async function cleanExpiredBookings() {
     // Leader election happens once per cycle in runExpiryCycle, which drives both
     // this pass and the stuck-booking recovery pass.
     try {
          // Bounded: after an outage this table can hold a very large backlog, and
          // an unbounded findMany would pull all of it (with seats) into memory and
          // then process it serially inside a single tick.
          const expiredBookings = await prisma.booking.findMany({
               where: {
                    status: { in: ['PENDING', 'SEATS_HELD', 'PAYMENT_PENDING'] },
                    lockExpiresAt: { lt: new Date() },
               },
               include: { seats: true },
               orderBy: { lockExpiresAt: 'asc' },
               take: config.EXPIRY_JOB_BATCH_SIZE,
          });

          if (expiredBookings.length === 0) return;

          logger.info(`Found ${expiredBookings.length} expired booking(s) to clean up`);

          for (const booking of expiredBookings) {
               try {
                    const seatIds = booking.seats.map(s => s.seatId).sort();

                    // Enrich before the transaction — HTTP must not run inside one.
                    const userInfo = await fetchUserForNotification(booking.userId);

                    // B1: atomically claim this booking via optimistic lock (CAS) AND
                    // record the notification. If the payment webhook or a user cancel
                    // already changed the version, we lose the CAS and emit nothing.
                    const claimed = await prisma.$transaction(async (tx) => {
                         const result = await tx.booking.updateMany({
                              where: {
                                   id: booking.id,
                                   version: booking.version,
                                   status: { in: ['PENDING', 'SEATS_HELD', 'PAYMENT_PENDING'] },
                              },
                              data: {
                                   status: 'EXPIRED',
                                   failureReason: 'booking_timeout',
                                   version: { increment: 1 },
                              },
                         });

                         if (result.count === 0) return false;

                         await outbox.enqueue(tx, {
                              topic: KAFKA_TOPICS.BOOKING_FAILED,
                              key: `booking-${booking.id}`,
                              payload: {
                                   bookingId: booking.id,
                                   userId: booking.userId,
                                   email: userInfo.email,
                                   firstName: userInfo.firstName,
                                   scheduleId: booking.scheduleId,
                                   reason: 'booking_timeout',
                                   failedAt: new Date().toISOString(),
                              },
                         });

                         return true;
                    });

                    if (!claimed) {
                         logger.info(`Booking ${booking.id} already handled by another process, skipping expiry`);
                         continue;
                    }

                    // Compensate all completed saga steps
                    await compensateAll(booking, seatIds);

                    // Release Redis locks (segment-aware)
                    await forceReleaseSeatLocks(booking.scheduleId, seatIds, booking.fromSeq, booking.toSeq);

                    logger.info(`Expired booking ${booking.id} cleaned up`, {
                         previousStatus: booking.status,
                    });

               } catch (error) {
                    logger.error(`Failed to clean up expired booking ${booking.id}`, {
                         error: error.message,
                    });
               }
          }
     } catch (error) {
          logger.error('Error in booking expiry job', { error: error.message });
     }
}

/**
 * Second pass: resume bookings abandoned in a transient state.
 *
 * CONFIRMING and CANCELLING have no timeout and are not covered by the scan above,
 * so a process that died mid-saga used to wedge a booking permanently — seats locked,
 * payment captured, no ticket, and cancelBooking refusing to touch it.
 *
 * Runs under the same leader election as the expiry pass.
 */
async function recoverStuckBookings() {
     const cutoff = new Date(Date.now() - config.STUCK_BOOKING_THRESHOLD_MS);

     const stuck = await prisma.booking.findMany({
          where: {
               status: { in: ['CONFIRMING', 'CANCELLING'] },
               updatedAt: { lt: cutoff },
          },
          include: { seats: true },
          orderBy: { updatedAt: 'asc' },
          take: config.EXPIRY_JOB_BATCH_SIZE,
     });

     if (stuck.length === 0) return;

     logger.warn(`Found ${stuck.length} booking(s) stuck in a transient state`);

     for (const booking of stuck) {
          try {
               await bookingService.recoverStuckBooking(booking);
          } catch (error) {
               logger.error(`Failed to recover stuck booking ${booking.id}`, {
                    status: booking.status,
                    error: error.message,
               });
          }
     }
}

// Guards against overlapping cycles: a backlog can make one cycle outlast the
// interval, and setInterval would otherwise start a second on top of it.
let cycleInFlight = null;

async function runExpiryCycle() {
     if (cycleInFlight) {
          logger.warn('Previous expiry cycle still running — skipping this tick');
          return cycleInFlight;
     }

     cycleInFlight = (async () => {
          try {
               // One lease covers both passes, renewed automatically for long cycles.
               await leaderElection.withLeadership(async () => {
                    await cleanExpiredBookings();

                    try {
                         await recoverStuckBookings();
                    } catch (error) {
                         logger.error('Error in stuck-booking recovery pass', { error: error.message });
                    }
               });
          } catch (error) {
               logger.error('Expiry cycle failed', { error: error.message });
          } finally {
               cycleInFlight = null;
          }
     })();

     return cycleInFlight;
}

/** Awaited during shutdown so we never exit mid-compensation. */
function currentCycle() {
     return cycleInFlight;
}

function startBookingExpiryJob() {
     // Run immediately once
     runExpiryCycle();

     // Then run on interval
     expiryInterval = setInterval(runExpiryCycle, config.BOOKING_EXPIRY_CHECK_INTERVAL_MS);
     logger.info(
          `Booking expiry job started (interval: ${config.BOOKING_EXPIRY_CHECK_INTERVAL_MS}ms, ` +
          `stuck threshold: ${config.STUCK_BOOKING_THRESHOLD_MS}ms)`
     );
}

/**
 * Stop scheduling new cycles and wait for any in-flight one to finish.
 *
 * B7: previously this only cleared the interval. A SIGTERM arriving mid-cycle left
 * a saga half-compensated — seats released but the booking never marked, or a
 * refund initiated with nothing recorded — and A7's sweeper would have to untangle
 * it later. Awaiting the cycle means shutdown lands on a clean boundary.
 */
async function stopBookingExpiryJob() {
     if (expiryInterval) {
          clearInterval(expiryInterval);
          expiryInterval = null;
          logger.info('Booking expiry job stopped accepting new cycles');
     }

     if (cycleInFlight) {
          logger.info('Waiting for in-flight expiry cycle to finish...');
          try {
               await cycleInFlight;
          } catch {
               // already logged inside the cycle
          }
          logger.info('In-flight expiry cycle finished');
     }
}

module.exports = { startBookingExpiryJob, stopBookingExpiryJob, currentCycle };
