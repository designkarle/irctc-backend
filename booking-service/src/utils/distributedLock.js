const { redis } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Redis distributed locking using Lua scripts for atomicity.
 * Lock key pattern: booking:lock:seat:{scheduleId}:{seatId}
 *
 * All-or-nothing acquisition: either ALL seats are locked or NONE.
 * Uses sorted seatIds to prevent deadlocks when overlapping seat sets.
 */

// Lua script: Acquire all locks atomically. Returns 1 on success, 0 on failure.
// If any key already exists, releases all previously acquired keys and returns 0.
const ACQUIRE_SCRIPT = `
local lockValue = ARGV[1]
local ttl = tonumber(ARGV[2])
local acquired = {}

for i, key in ipairs(KEYS) do
     local result = redis.call('SET', key, lockValue, 'NX', 'EX', ttl)
     if not result then
          -- Rollback: release all previously acquired locks
          for j = 1, #acquired do
               redis.call('DEL', acquired[j])
          end
          return 0
     end
     table.insert(acquired, key)
end

return 1
`;

// Lua script: Release locks only if we own them (value matches).
const RELEASE_SCRIPT = `
local lockValue = ARGV[1]
local released = 0

for i, key in ipairs(KEYS) do
     local currentValue = redis.call('GET', key)
     if currentValue == lockValue then
          redis.call('DEL', key)
          released = released + 1
     end
end

return released
`;

/**
 * Build lock keys for a set of seats in a schedule.
 * For segment bookings, includes fromSeq:toSeq so that non-overlapping
 * segments on the same seat get different keys (and don't block each other).
 * Overlapping-but-not-identical segments also get different keys — the DB
 * transaction with FOR UPDATE NOWAIT catches those conflicts.
 * @param {string} scheduleId
 * @param {string[]} seatIds - Will be sorted alphabetically to prevent deadlocks
 * @param {number} [fromSeq] - Segment start (sequence number)
 * @param {number} [toSeq] - Segment end (sequence number)
 * @returns {string[]} Sorted lock keys
 */
function buildLockKeys(scheduleId, seatIds, fromSeq, toSeq) {
     const suffix = (fromSeq && toSeq) ? `:${fromSeq}:${toSeq}` : '';
     return [...seatIds]
          .sort()
          .map(seatId => `booking:lock:seat:${scheduleId}:${seatId}${suffix}`);
}

/**
 * Acquire distributed locks for a set of seats.
 * @param {string} scheduleId
 * @param {string[]} seatIds
 * @param {string} bookingId - Used as lock value for ownership
 * @param {number} ttlSeconds - Lock TTL in seconds
 * @param {number} [fromSeq] - Segment start (for segment-aware keys)
 * @param {number} [toSeq] - Segment end (for segment-aware keys)
 * @returns {Promise<{acquired: boolean, lockValue: string|null}>}
 */
async function acquireSeatLocks(scheduleId, seatIds, bookingId, ttlSeconds, fromSeq, toSeq) {
     const keys = buildLockKeys(scheduleId, seatIds, fromSeq, toSeq);
     const lockValue = `${bookingId}:${Date.now()}`;

     try {
          const result = await redis.eval(ACQUIRE_SCRIPT, keys.length, ...keys, lockValue, ttlSeconds);

          if (result === 1) {
               logger.info(`Distributed locks acquired for booking ${bookingId}`, {
                    scheduleId,
                    seatCount: seatIds.length,
                    ttlSeconds,
               });
               return { acquired: true, lockValue };
          }

          logger.info(`Failed to acquire locks — seats already locked`, {
               scheduleId,
               bookingId,
          });
          return { acquired: false, lockValue: null };

     } catch (error) {
          logger.error('Error acquiring distributed locks', {
               error: error.message,
               scheduleId,
               bookingId,
          });
          // Fail closed: reject the booking attempt rather than bypassing the lock.
          // Allowing duplicate bookings is far worse than a temporary service degradation.
          return { acquired: false, lockValue: null };
     }
}

/**
 * Release distributed locks for a set of seats.
 * Only releases locks that match our lockValue (ownership check).
 * @param {string} scheduleId
 * @param {string[]} seatIds
 * @param {string} lockValue - The lock value returned from acquireSeatLocks
 * @param {number} [fromSeq] - Segment start (for segment-aware keys)
 * @param {number} [toSeq] - Segment end (for segment-aware keys)
 */
async function releaseSeatLocks(scheduleId, seatIds, lockValue, fromSeq, toSeq) {
     if (!lockValue) return;

     const keys = buildLockKeys(scheduleId, seatIds, fromSeq, toSeq);

     try {
          const released = await redis.eval(RELEASE_SCRIPT, keys.length, ...keys, lockValue);
          logger.info(`Released ${released} distributed lock(s)`, { scheduleId });
     } catch (error) {
          // Non-critical: locks will expire via TTL
          logger.error('Error releasing distributed locks', {
               error: error.message,
               scheduleId,
          });
     }
}

/**
 * Force-release all locks for a schedule+seatIds regardless of ownership.
 * Used by the expiry job when we know the booking is expired.
 * @param {string} scheduleId
 * @param {string[]} seatIds
 * @param {number} [fromSeq] - Segment start (for segment-aware keys)
 * @param {number} [toSeq] - Segment end (for segment-aware keys)
 */
async function forceReleaseSeatLocks(scheduleId, seatIds, fromSeq, toSeq) {
     const keys = buildLockKeys(scheduleId, seatIds, fromSeq, toSeq);

     try {
          if (keys.length > 0) {
               await redis.del(...keys);
               logger.info(`Force-released ${keys.length} lock(s)`, { scheduleId });
          }
     } catch (error) {
          logger.error('Error force-releasing locks', { error: error.message });
     }
}

module.exports = {
     acquireSeatLocks,
     releaseSeatLocks,
     forceReleaseSeatLocks,
};
