const express = require('express');
const { internalAuth } = require('../middlewares/internalAuth.middleware');
const {
     createPaymentOrder,
     getPaymentOrder,
     verifyAndCapturePayment,
     initiateRefund,
} = require('../controllers/payment.controller');

const router = express.Router();

// Internal routes (called by booking-service)
router.post('/orders', internalAuth, createPaymentOrder);
router.get('/orders/:paymentOrderId', internalAuth, getPaymentOrder);
router.post('/orders/:paymentOrderId/verify', internalAuth, verifyAndCapturePayment);
router.post('/refunds', internalAuth, initiateRefund);

module.exports = router;
