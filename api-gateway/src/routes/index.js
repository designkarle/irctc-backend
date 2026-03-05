const express = require('express');
const { requireAuth } = require('../middlewares/auth.middleware');
const { createProxy, getCircuitBreakerStatus } = require('../services/proxy');
const { ipRateLimit, endpointRateLimit, combinedRateLimit } = require('../middlewares/rateLimiting.middleware')
const { config } = require('../config');

const router = express.Router();

// ===========================
// Service Proxy Routes
// ===========================

/**
 * USER SERVICE ROUTES
 * Gateway Path: /api/users/auth/login
 * Service Path: /auth/login
**/

const userServiceProxy = createProxy('userService', config.SERVICES.USER_SERVICE_URL);

// public routes
router.post(
     '/users/auth/send-otp',
     endpointRateLimit(5, 3600000), // 5 requests per hour
     userServiceProxy
);

router.post(
     '/users/auth/verify-otp',
     endpointRateLimit(10, 3600000), // 10 requests per hour
     userServiceProxy
);

router.post(
     '/users/auth/login',
     endpointRateLimit(100, 900000),// 100 requests per 15 minutes
     userServiceProxy
);

router.post(
     '/users/auth/google-auth',
     endpointRateLimit(10, 900000), // 10 requests per 15 minutes
     userServiceProxy
);

router.post(
     '/users/auth/refresh',
     endpointRateLimit(20, 900000), // 20 requests per 15 minutes
     userServiceProxy
);

// private routes
router.get(
     '/users/user/profile',
     requireAuth,
     combinedRateLimit(),
     userServiceProxy
)


const adminServiceProxy = createProxy('adminService', config.SERVICES.ADMIN_SERVICE_URL);

router.post(
     '/admins/stations/station',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
);

router.post(
     '/admins/trains/train',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
);

router.post(
     '/admins/trains/route',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
)

router.post(
     '/admins/schedules/schedule',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
)

router.get(
     '/admins/stations/station',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
)

router.get(
     '/admins/trains/train/:trainId',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
);

router.put(
     '/admins/schedules/schedule/:scheduleId',
     requireAuth,
     combinedRateLimit(),
     adminServiceProxy
)
// Gateway Health Status

router.get('/gateway/health', (req, res) => {
     res.status(200).json({
          success: true,
          message: "API Gateway is healthy",
          timestamp: new Date().toISOString()
     });
});

router.get('/gateway/circuit-breakers', (req, res) => {
     const status = getCircuitBreakerStatus();
     res.status(200).json({
          success: true,
          circuitBreakers: status,
     });
});

module.exports = router;