const { UnauthorizedError } = require('../utils/error');

/**
 * Extract user context from gateway headers
 * Gateway sets x-user-id after JWT verification(We have discussed this in video)
 */
function getUserContext(req, res, next) {
     const userId = req.headers['x-user-id'];

     if (!userId) {
          return next(
               new UnauthorizedError('User context missing - must come through gateway')
          );
     }

     req.user = { id: userId };
     next();
}

module.exports = { getUserContext };