const { redis } = require('../config/redis');
const logger = require('../config/logger');
const { ServiceUnavailableError } = require('./error');

/**
 * B4 — Redis was a hard dependency dressed up as a cache.
 *
 * `getProfile` called `redis.get` and let it throw, so a Redis blip 500'd every
 * profile read even though Postgres held the same data and was perfectly healthy.
 * A cache must never be able to fail a request it is only meant to accelerate.
 *
 * Two distinct policies live here, and the distinction is deliberate:
 *
 *   cacheGet / cacheSet / cacheDel  — best effort. Never throw. A Redis outage
 *        degrades these to a straight database read.
 *
 *   requireRedis()                  — for state that has NO database fallback
 *        (OTP sessions, refresh-token JTIs). These genuinely need Redis, so they
 *        fail — but with an explicit 503 AUTH_STORE_UNAVAILABLE the caller can
 *        act on, not an opaque 500.
 */

// Redis outages produce one error per call; log at most one line per interval per
// operation so a sustained outage doesn't bury every other log line.
const LOG_THROTTLE_MS = 10_000;
const lastLoggedAt = new Map();

function logDegraded(operation, key, error) {
     const now = Date.now();
     const last = lastLoggedAt.get(operation) || 0;
     if (now - last < LOG_THROTTLE_MS) return;
     lastLoggedAt.set(operation, now);

     logger.error(`Redis unavailable — degrading ${operation} to database`, {
          key,
          error: error.message,
     });
}

/** Read through the cache. Returns null on a miss OR on any Redis failure. */
async function cacheGet(key) {
     try {
          const raw = await redis.get(key);
          return raw ? JSON.parse(raw) : null;
     } catch (error) {
          logDegraded('cache read', key, error);
          return null;
     }
}

/** Write to the cache. Swallows failures — the caller already has the real value. */
async function cacheSet(key, value, ttlSeconds) {
     try {
          await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
     } catch (error) {
          logDegraded('cache write', key, error);
     }
}

/**
 * Invalidate. Swallows failures, but logs every one: a missed invalidation means
 * stale data is served until the TTL expires, which is worth knowing about.
 */
async function cacheDel(key) {
     try {
          await redis.del(key);
     } catch (error) {
          logger.error('Cache invalidation failed — stale data may be served until TTL', {
               key,
               error: error.message,
          });
     }
}

/**
 * Wrap an operation whose state lives ONLY in Redis (OTP, refresh tokens).
 * Converts a connection failure into an explicit 503 instead of a generic 500.
 */
async function requireRedis(operation, fn) {
     try {
          return await fn();
     } catch (error) {
          // Don't swallow our own domain errors (rate limits, etc.) — only transport
          // failures become 503.
          if (error.statusCode) throw error;

          logger.error(`Redis required for ${operation} but unavailable`, { error: error.message });
          throw new ServiceUnavailableError(
               'Authentication store is temporarily unavailable. Please try again in a moment.',
               'AUTH_STORE_UNAVAILABLE'
          );
     }
}

module.exports = { cacheGet, cacheSet, cacheDel, requireRedis };
