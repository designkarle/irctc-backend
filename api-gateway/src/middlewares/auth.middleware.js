const jwt = require('jsonwebtoken');
const { config } = require('../config');
const { UnauthorizedError } = require('../utils/error');
const logger = require('../config/logger');

/**
 * Middleware to verify access token from Authorization header
 * This is going to be our authentication mechanism which will authenticate user
 * Extracts user ID and attaches it to request headers for downstream services
 */
function requireAuth(req, res, next) {
     try {
          const authHeader = req.headers.authorization;

          if (!authHeader || !authHeader.startsWith('Bearer ')) {
               throw new UnauthorizedError('Authorization token missing');
          }

          const accessToken = authHeader.split(' ')[1];

          if (!accessToken) {
               throw new UnauthorizedError('Authorization token missing');
          }

          // Verify access token
          const payload = jwt.verify(accessToken, config.JWT_ACCESS_SECRET);

          if (!payload.id) {
               throw new UnauthorizedError('Invalid token payload');
          }

          // Attach user context to request for downstream services
          req.user = {
               id: payload.id,
          };

          // Add user ID to headers for proxied requests
          req.headers['x-user-id'] = payload.id.toString();

          logger.debug(`User ${payload.id} authenticated successfully`);

          next();
     } catch (err) {
          if (err.name === 'TokenExpiredError') {
               return next(new UnauthorizedError('Access token expired', 'TOKEN_EXPIRED'));
          }
          if (err.name === 'JsonWebTokenError') {
               return next(new UnauthorizedError('Invalid access token', 'TOKEN_INVALID'));
          }
          return next(err);
     }
}

module.exports = { requireAuth };