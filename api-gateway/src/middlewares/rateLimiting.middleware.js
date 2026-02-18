const { redis } = require('../config/redis');
const { config } = require('../config');
const { TooManyRequestsError } = require('../utils/error');
const logger = require('../config/logger');

/**
 * Rate limiting strategies:
 * 1. IP-based rate limiting (for unauthenticated users)
 * 2. User-based rate limiting (for authenticated users)
 * 3. Endpoint-specific rate limiting
 */

/**
 * Generic rate limiter using sliding window algorithm
**/
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

          // Get the count from the third command (index 2)
          const requestCount = results[2][1];

          if (requestCount > maxRequests) {
               const oldestRequest = await redis.zrange(key, 0, 0, 'WITHSCORES');
               const resetTime = parseInt(oldestRequest[1]) + windowMs;
               const retryAfter = Math.ceil((resetTime - now) / 1000);

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
          logger.error('Rate limiter error:', err);
          // Fail open - allow request if Redis is down
          return { allowed: true, remaining: maxRequests };
     }
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

          // Set rate limit headers
          res.setHeader('X-RateLimit-Limit', maxRequests);
          res.setHeader('X-RateLimit-Remaining', result.remaining);
          res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

          if (!result.allowed) {
               res.setHeader('Retry-After', result.retryAfter);
               logger.warn(`Rate limit exceeded for IP: ${ip}`);
               return next(
                    new TooManyRequestsError(
                         `Too many requests. Please try again in ${result.retryAfter} seconds`,
                         result.retryAfter
                    )
               );
          }

          next();
     };
}

/**
 * User-based rate limiting middleware
 * Should be used after authentication middleware
 * Default: 1000 requests per 15 minutes (more lenient than IP-based)
**/
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

          res.setHeader('X-RateLimit-Limit', maxRequests);
          res.setHeader('X-RateLimit-Remaining', result.remaining);
          res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

          if (!result.allowed) {
               res.setHeader('Retry-After', result.retryAfter);
               logger.warn(`Rate limit exceeded for user: ${userId}`);
               return next(
                    new TooManyRequestsError(
                         `Too many requests. Please try again in ${result.retryAfter} seconds`,
                         result.retryAfter
                    )
               );
          }

          next();
     };
}

/**
 * Endpoint-specific rate limiting
 * Example: POST /api/auth/send-otp - 5 requests per hour
**/
function endpointRateLimit(maxRequests, windowMs) {
     return async (req, res, next) => {
          const ip = req.ip || req.connection.remoteAddress;
          const endpoint = `${req.method}:${req.path}`;
          const key = `ratelimit:endpoint:${endpoint}:${ip}`;

          const result = await rateLimiter(key, maxRequests, windowMs);

          res.setHeader('X-RateLimit-Limit', maxRequests);
          res.setHeader('X-RateLimit-Remaining', result.remaining);
          res.setHeader('X-RateLimit-Reset', new Date(result.resetTime).toISOString());

          if (!result.allowed) {
               res.setHeader('Retry-After', result.retryAfter);
               logger.warn(`Endpoint rate limit exceeded for ${endpoint} from IP: ${ip}`);
               return next(
                    new TooManyRequestsError(
                         `Too many requests to this endpoint. Please try again in ${result.retryAfter} seconds`,
                         result.retryAfter
                    )
               );
          }

          next();
     };
}

/**
 * Combined rate limiting strategy
 * Applies both IP and user-based rate limiting
**/
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