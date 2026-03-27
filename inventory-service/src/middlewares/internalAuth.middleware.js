const { config } = require('../config');
const { ForbiddenError } = require('../utils/error');

/**
 * Validates that the request comes from an internal service
 * by checking the x-internal-service-key header.
 */
const internalAuth = (req, res, next) => {
     const serviceKey = req.headers['x-internal-service-key'];

     if (!serviceKey || serviceKey !== config.INTERNAL_SERVICE_KEY) {
          throw new ForbiddenError('Invalid or missing internal service key');
     }

     next();
};

module.exports = { internalAuth };
