const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { config } = require('../config');
const { createLeaderElection } = require('../../../shared/utils/leaderElection');
const { recountAndPublish, recomputeSegmentSeatStatuses } = require('../services/inventory.service');

let intervalHandle = null;

// B3: replaces pg_try_advisory_lock(800001).
//
// Advisory locks are SESSION scoped, but Prisma pools connections — so acquire and
// release could run on different pooled sessions. The unlock would then target a
// session that doesn't hold the lock (Postgres just warns and returns false) while
// the real holder kept it until that connection was recycled. The job would be
// permanently dead across every instance, and the only symptom would be expired
// seat locks never being swept, i.e. seats quietly becoming unbookable.
//
// A lease row is a single atomic statement and is indifferent to which connection
// executes it.
const leaderElection = createLeaderElection({
     prisma,
     logger,
     name: 'inventory:lock-expiry-job',
     leaseSeconds: 120,
});

async function cleanExpiredLocksInner() {
     try {
          // --- SEGMENT BOOKING: Clean expired segment locks first ---
          try {
               const expiredSegmentLocks = await prisma.seatSegmentLock.findMany({
                    where: { status: 'LOCKED', lockExpiresAt: { lt: new Date() } },
                    select: { id: true, scheduleId: true, seatId: true },
               });

               if (expiredSegmentLocks.length > 0) {
                    logger.info(`Found ${expiredSegmentLocks.length} expired segment lock(s) to clean up`);

                    const segmentIds = expiredSegmentLocks.map(l => l.id);
                    await prisma.$executeRaw`
                         DELETE FROM seat_segment_locks WHERE id = ANY(${segmentIds}::text[])
                    `;

                    // Group by scheduleId → Set<seatId> for recomputing SeatInventory
                    const affectedScheduleSeats = new Map();
                    for (const lock of expiredSegmentLocks) {
                         if (!affectedScheduleSeats.has(lock.scheduleId)) {
                              affectedScheduleSeats.set(lock.scheduleId, new Set());
                         }
                         affectedScheduleSeats.get(lock.scheduleId).add(lock.seatId);
                    }

                    for (const [scheduleId, seatIdSet] of affectedScheduleSeats) {
                         // Recompute each seat's summary status from remaining segment locks.
                         // This correctly handles all transitions: LOCKED→AVAILABLE, LOCKED→BOOKED, etc.
                         await prisma.$transaction(async (tx) => {
                              await recomputeSegmentSeatStatuses(tx, scheduleId, [...seatIdSet]);
                         });
                         await recountAndPublish(scheduleId);
                    }

                    logger.info(`Cleaned ${expiredSegmentLocks.length} expired segment lock(s)`);
               }
          } catch (segErr) {
               logger.error('Segment lock expiry cleanup failed', { error: segErr.message });
          }
          // --- END SEGMENT BOOKING ---

          // Find all expired locked seats (original full-journey lock expiry)
          const expiredSeats = await prisma.seatInventory.findMany({
               where: {
                    status: 'LOCKED',
                    lockExpiresAt: { lt: new Date() },
               },
               select: {
                    id: true,
                    scheduleId: true,
                    seatNumber: true,
               },
          });

          if (expiredSeats.length === 0) return;

          logger.info(`Found ${expiredSeats.length} expired seat lock(s) to clean up`);

          // Group by scheduleId
          const bySchedule = {};
          for (const seat of expiredSeats) {
               if (!bySchedule[seat.scheduleId]) bySchedule[seat.scheduleId] = [];
               bySchedule[seat.scheduleId].push(seat);
          }

          for (const [scheduleId, seats] of Object.entries(bySchedule)) {
               try {
                    const seatPkIds = seats.map(s => s.id);

                    // Release the expired locks
                    await prisma.$executeRaw`
                         UPDATE seat_inventories
                         SET status = 'AVAILABLE', "lockedBy" = NULL,
                             "lockedAt" = NULL, "lockExpiresAt" = NULL,
                             version = version + 1, "updatedAt" = NOW()
                         WHERE id = ANY(${seatPkIds}::text[])
                         AND status = 'LOCKED'
                    `;

                    // Recount from actual seat rows to prevent counter drift
                    await recountAndPublish(scheduleId);

                    logger.info(`Released ${seats.length} expired lock(s) for schedule ${scheduleId}`);
               } catch (err) {
                    logger.error(`Failed to clean expired locks for schedule ${scheduleId}`, {
                         error: err.message,
                    });
               }
          }
     } catch (error) {
          logger.error('Lock expiry cleanup failed', { error: error.message });
     }
}

// Prevents overlapping cycles — a large backlog can make one cycle outlast the
// interval, and setInterval would otherwise stack a second run on top of it.
let cycleInFlight = null;

async function cleanExpiredLocks() {
     if (cycleInFlight) {
          logger.warn('Previous lock expiry cycle still running — skipping this tick');
          return cycleInFlight;
     }

     cycleInFlight = (async () => {
          try {
               await leaderElection.withLeadership(cleanExpiredLocksInner);
          } catch (error) {
               logger.error('Lock expiry cycle failed', { error: error.message });
          } finally {
               cycleInFlight = null;
          }
     })();

     return cycleInFlight;
}

function startLockExpiryJob() {
     // Run once immediately
     cleanExpiredLocks();

     intervalHandle = setInterval(cleanExpiredLocks, config.LOCK_EXPIRY_INTERVAL_MS);
     logger.info(`Lock expiry job started (interval: ${config.LOCK_EXPIRY_INTERVAL_MS}ms)`);
}

/**
 * Stop scheduling new cycles and wait for any in-flight one.
 * B7: exiting mid-cycle could leave segment locks deleted but seat statuses not
 * yet recomputed, so the aggregate counts would be wrong until the next sweep.
 */
async function stopLockExpiryJob() {
     if (intervalHandle) {
          clearInterval(intervalHandle);
          intervalHandle = null;
          logger.info('Lock expiry job stopped accepting new cycles');
     }

     if (cycleInFlight) {
          logger.info('Waiting for in-flight lock expiry cycle to finish...');
          try {
               await cycleInFlight;
          } catch {
               // already logged inside the cycle
          }
          logger.info('In-flight lock expiry cycle finished');
     }
}

module.exports = { startLockExpiryJob, stopLockExpiryJob };
