const express = require('express');
const { getUserContext } = require('../middlewares/getUserContext.middleware');
const { internalAuth } = require('../middlewares/internalAuth.middleware');
const { config } = require('../config');
const {
     getScheduleAvailability,
     getScheduleSeats,
     lockSeats,
     unlockSeats,
     confirmSeats,
     cancelBooking,
} = require('../controllers/inventory.controller');

const router = express.Router();

// Allows either user context (from gateway) or internal service key (from booking-service)
function userOrInternal(req, res, next) {
     const serviceKey = req.headers['x-internal-service-key'];
     if (serviceKey && serviceKey === config.INTERNAL_SERVICE_KEY) {
          req.user = { id: 'internal-service' };
          return next();
     }
     return getUserContext(req, res, next);
}

// Public: aggregate availability (used by search results)
router.get('/schedules/:scheduleId/availability', getScheduleAvailability);

// Authenticated OR internal: individual seat statuses
router.get('/schedules/:scheduleId/seats', userOrInternal, getScheduleSeats);

// Internal: called by booking-service (protected by service key)
router.post('/seats/lock', internalAuth, lockSeats);
router.post('/seats/unlock', internalAuth, unlockSeats);
router.post('/seats/confirm', internalAuth, confirmSeats);
router.post('/seats/cancel-booking', internalAuth, cancelBooking);

module.exports = router;
