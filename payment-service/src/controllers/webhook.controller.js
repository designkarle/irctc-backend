const asyncHandler = require('../utils/asyncHandler');
const paymentService = require('../services/payment.service');
const logger = require('../config/logger');

/**
 * Razorpay webhook handler.
 * IMPORTANT: This endpoint receives raw body (not JSON-parsed)
 * for signature verification. The route must use express.raw().
 */
exports.razorpayWebhook = asyncHandler(async (req, res) => {
     const signature = req.headers['x-razorpay-signature'];

     if (!signature) {
          logger.warn('Webhook received without signature header');
          return res.status(400).json({ status: 'error', message: 'Missing signature' });
     }

     const rawBody = req.body;

     const result = await paymentService.handleWebhook(rawBody, signature);

     logger.info('Webhook processed', { result });

     // Always return 200 to the gateway to prevent retries for processed events
     res.status(200).json({ status: 'ok', ...result });
});
