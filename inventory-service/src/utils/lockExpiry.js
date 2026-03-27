const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { config } = require('../config');
const { recountAndPublish } = require('../services/inventory.service');

let intervalHandle = null;

// PostgreSQL advisory lock ID for leader election.
// Only one instance holds this lock at a time (try-lock, non-blocking).
const ADVISORY_LOCK_ID = 800001;

/**
 * Try to become the leader for this expiry cycle using pg_try_advisory_lock.
 * Returns true if this instance acquired the lock. The lock is session-level
 * and released explicitly after the job finishes.
 */
async function tryAcquireLeadership() {
     try {
          const result = await prisma.$queryRaw`SELECT pg_try_advisory_lock(${ADVISORY_LOCK_ID}) AS acquired`;
          return result[0].acquired === true;
     } catch (err) {
          logger.error('Failed to acquire lock expiry leadership', { error: err.message });
          return false;
     }
}

async function releaseLeadership() {
     try {
          await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_ID})`;
     } catch (err) {
          logger.error('Failed to release lock expiry leadership', { error: err.message });
     }
}

async function cleanExpiredLocks() {
     const isLeader = await tryAcquireLeadership();
     if (!isLeader) {
          logger.debug('Skipping lock expiry job — another instance is the leader');
          return;
     }

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
                         for (const seatId of seatIdSet) {
                              const remaining = await prisma.seatSegmentLock.count({
                                   where: { scheduleId, seatId, status: { in: ['LOCKED', 'BOOKED'] } },
                              });
                              if (remaining === 0) {
                                   await prisma.$executeRaw`
                                        UPDATE seat_inventories
                                        SET status = 'AVAILABLE', "lockedBy" = NULL,
                                            "lockedAt" = NULL, "lockExpiresAt" = NULL,
                                            version = version + 1, "updatedAt" = NOW()
                                        WHERE "scheduleId" = ${scheduleId} AND "seatId" = ${seatId} AND status = 'LOCKED'
                                   `;
                              }
                         }
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
     } finally {
          await releaseLeadership();
     }
}

function startLockExpiryJob() {
     // Run once immediately
     cleanExpiredLocks();

     intervalHandle = setInterval(cleanExpiredLocks, config.LOCK_EXPIRY_INTERVAL_MS);
     logger.info(`Lock expiry job started (interval: ${config.LOCK_EXPIRY_INTERVAL_MS}ms)`);
}

function stopLockExpiryJob() {
     if (intervalHandle) {
          clearInterval(intervalHandle);
          intervalHandle = null;
          logger.info('Lock expiry job stopped');
     }
}

module.exports = { startLockExpiryJob, stopLockExpiryJob };
