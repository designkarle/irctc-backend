const { redis } = require('../config/redis');
const { config } = require('../config');
const { TooManyRequestsError } = require('../utils/error');
const logger = require('../config/logger');

/**
 * Rate limiting strategies:
 * 1. IP-based rate limiting (for unauthenticated users)
 * 2. User-based rate limiting (for authenticated users)
 * 3. Endpoint-specific rate limiting
 *
 * ─── B2: behaviour when Redis is unavailable ────────────────────────────────
 * This used to `return { allowed: true }` on any Redis error — rate limiting
 * silently ceased to exist at exactly the moment the system was least able to
 * absorb traffic. An OTP-send flood became free, and so did the SendGrid bill.
 *
 * It now degrades to an in-process sliding window instead. That is weaker than
 * the Redis limiter (each gateway instance counts separately, so the effective
 * global ceiling is max x instances) but it is a bounded, predictable
 * degradation rather than an open door.
 *
 * Two related silent-failure bugs are fixed alongside:
 *   - `results[2][1]` was read without checking `results[2][0]`, the per-command
 *     error slot. A failed ZCARD left requestCount undefined, `undefined > max`
 *     is false, and the request sailed through with nothing logged at all.
 *   - endpointRateLimit keyed on `req.path`, the CONCRETE path, so every booking
 *     id got its own bucket (`/bookings/abc/cancel` vs `/bookings/def/cancel`).
 *     Any limit on a parameterised route was effectively per-resource, and Redis
 *     accumulated one key per id ever seen. Callers now pass a stable route name.
 */

// ─── In-process fallback limiter ─────────────────────────────────────────────

// Bounded so a key-space flood during an outage cannot exhaust memory. On
// overflow the oldest entries are evicted (Map preserves insertion order).
const FALLBACK_MAX_KEYS = 10000;
const fallbackWindows = new Map();

function fallbackRateLimiter(key, maxRequests, windowMs) {
     const now = Date.now();
     const windowStart = now - windowMs;

     let timestamps = fallbackWindows.get(key);
     if (!timestamps) {
          if (fallbackWindows.size >= FALLBACK_MAX_KEYS) {
               // Evict the oldest ~10% rather than one at a time.
               const evictCount = Math.ceil(FALLBACK_MAX_KEYS * 0.1);
               let evicted = 0;
               for (const k of fallbackWindows.keys()) {
                    fallbackWindows.delete(k);
                    if (++evicted >= evictCount) break;
               }
          }
          timestamps = [];
          fallbackWindows.set(key, timestamps);
     }

     // Drop entries that have aged out of the window.
     let firstLive = 0;
     while (firstLive < timestamps.length && timestamps[firstLive] <= windowStart) firstLive++;
     if (firstLive > 0) timestamps.splice(0, firstLive);

     timestamps.push(now);

     if (timestamps.length > maxRequests) {
          const resetTime = timestamps[0] + windowMs;
          return {
               allowed: false,
               remaining: 0,
               resetTime,
               retryAfter: Math.max(1, Math.ceil((resetTime - now) / 1000)),
               degraded: true,
          };
     }

     return {
          allowed: true,
          remaining: maxRequests - timestamps.length,
          resetTime: now + windowMs,
          degraded: true,
     };
}

// Sweep idle fallback keys so the map doesn't hold memory after an outage ends.
const FALLBACK_SWEEP_MS = 60_000;
const sweepTimer = setInterval(() => {
     if (fallbackWindows.size === 0) return;
     const cutoff = Date.now() - config.RATE_LIMIT_WINDOW_MS;
     for (const [key, timestamps] of fallbackWindows) {
          if (timestamps.length === 0 || timestamps[timestamps.length - 1] <= cutoff) {
               fallbackWindows.delete(key);
          }
     }
}, FALLBACK_SWEEP_MS);
// Don't keep the event loop alive for this.
if (typeof sweepTimer.unref === 'function') sweepTimer.unref();

// One log line per interval while degraded, instead of one per request.
const DEGRADED_LOG_THROTTLE_MS = 10_000;
let lastDegradedLogAt = 0;

function logDegraded(reason) {
     const now = Date.now();
     if (now - lastDegradedLogAt < DEGRADED_LOG_THROTTLE_MS) return;
     lastDegradedLogAt = now;
     logger.error(
          'Rate limiter degraded to in-process fallback — limits are now PER INSTANCE, not global',
          { reason }
     );
}

/**
 * Generic rate limiter using sliding window algorithm.
 * Falls back to an in-process window if Redis is unreachable or misbehaving.
 */
async function rateLimiter(key, maxRequests, windowMs) {
     const now = Date.now();
     const windowStart = now - windowMs;

     try {
          // Use Redis pipeline for atomic operations
          const pipeline = redis.pipeline();

          // Remove old entries outside the current window
          pipeline.zremrangebyscore(key, 0, windowStart);

          // Add current request
          pipeline.zadd(key, now, `${now}-${Math.random()}`);

          // Count requests in current window
          pipeline.zcard(key);

          // Set expiry on the key
          pipeline.expire(key, Math.ceil(windowMs / 1000));

          const results = await pipeline.exec();

          // ioredis returns [[err, value], ...]. A null results array, or an error in
          // ANY slot, means the window we just computed is not trustworthy.
          if (!results) throw new Error('Redis pipeline returned no results');

          for (const [cmdErr] of results) {
               if (cmdErr) throw cmdErr;
          }

          const requestCount = results[2][1];
          if (typeof requestCount !== 'number') {
               throw new Error(`Redis ZCARD returned ${typeof requestCount}`);
          }

          if (requestCount > maxRequests) {
               const oldestRequest = await redis.zrange(key, 0, 0, 'WITHSCORES');
               const oldestScore = parseInt(oldestRequest?.[1], 10);
               const resetTime = Number.isNaN(oldestScore) ? now + windowMs : oldestScore + windowMs;
               const retryAfter = Math.max(1, Math.ceil((resetTime - now) / 1000));

               return {
                    allowed: false,
                    remaining: 0,
                    resetTime,
                    retryAfter,
               };
          }

          return {
               allowed: true,
               remaining: maxRequests - requestCount,
               resetTime: windowStart + windowMs,
          };
     } catch (err) {
          logDegraded(err.message);
          // Bounded degradation, not a free pass.
          return fallbackRateLimiter(key, maxRequests, windowMs);
     }
}

/** Shared response-header + rejection handling for all three strategies. */
function applyResult(res, next, result, maxRequests, onReject) {
     res.setHeader('X-RateLimit-Limit', maxRequests);
     res.setHeader('X-RateLimit-Remaining', result.remaining);
     res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());
     if (result.degraded) res.setHeader('X-RateLimit-Degraded', 'true');

     if (!result.allowed) {
          res.setHeader('Retry-After', result.retryAfter);
          onReject();
          return next(
               new TooManyRequestsError(
                    `Too many requests. Please try again in ${result.retryAfter} seconds`,
                    result.retryAfter
               )
          );
     }

     return next();
}

/**
 * IP-based rate limiting middleware
 * Default: 100 requests per 15 minutes
 */
function ipRateLimit(options = {}) {
     const maxRequests = options.max || config.RATE_LIMIT_MAX_REQUESTS;
     const windowMs = options.windowMs || config.RATE_LIMIT_WINDOW_MS;

     return async (req, res, next) => {
          const ip = req.ip || req.connection.remoteAddress;
          const key = `ratelimit:ip:${ip}`;

          const result = await rateLimiter(key, maxRequests, windowMs);

          return applyResult(res, next, result, maxRequests, () =>
               logger.warn(`Rate limit exceeded for IP: ${ip}`)
          );
     };
}

/**
 * User-based rate limiting middleware
 * Should be used after authentication middleware
 * Default: 1000 requests per 15 minutes (more lenient than IP-based)
 */
function userRateLimit(options = {}) {
     const maxRequests = options.max || config.RATE_LIMIT_MAX_REQUESTS * 10;
     const windowMs = options.windowMs || config.RATE_LIMIT_WINDOW_MS;

     return async (req, res, next) => {
          // Skip if no user authenticated
          if (!req.user || !req.user.id) {
               return next();
          }

          const userId = req.user.id;
          const key = `ratelimit:user:${userId}`;

          const result = await rateLimiter(key, maxRequests, windowMs);

          return applyResult(res, next, result, maxRequests, () =>
               logger.warn(`Rate limit exceeded for user: ${userId}`)
          );
     };
}

/**
 * Endpoint-specific rate limiting.
 * Example: endpointRateLimit(5, 3600000, 'POST:/users/auth/send-otp')
 *
 * `routeName` MUST be a stable identifier for the route, not the concrete request
 * path — otherwise every path parameter value gets its own bucket and the limit
 * stops being a limit. It defaults to method + path only for routes with no
 * parameters; pass it explicitly for anything containing an :id.
 */
function endpointRateLimit(maxRequests, windowMs, routeName) {
     return async (req, res, next) => {
          const ip = req.ip || req.connection.remoteAddress;
          const endpoint = routeName || `${req.method}:${req.route?.path || req.path}`;
          const key = `ratelimit:endpoint:${endpoint}:${ip}`;

          const result = await rateLimiter(key, maxRequests, windowMs);

          return applyResult(res, next, result, maxRequests, () =>
               logger.warn(`Endpoint rate limit exceeded for ${endpoint} from IP: ${ip}`)
          );
     };
}

/**
 * Combined rate limiting strategy
 * Applies both IP and user-based rate limiting
 */
function combinedRateLimit(ipOptions = {}, userOptions = {}) {
     const ipLimiter = ipRateLimit(ipOptions);
     const userLimiter = userRateLimit(userOptions);

     return async (req, res, next) => {
          // Apply IP rate limit first
          ipLimiter(req, res, (err) => {
               if (err) return next(err);

               // Then apply user rate limit if authenticated
               userLimiter(req, res, next);
          });
     };
}

module.exports = {
     ipRateLimit,
     userRateLimit,
     endpointRateLimit,
     combinedRateLimit,
};
