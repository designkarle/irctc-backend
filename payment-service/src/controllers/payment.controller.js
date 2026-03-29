const asyncHandler = require('../utils/asyncHandler');
const { BadRequestError } = require('../utils/error');
const paymentService = require('../services/payment.service');

exports.createPaymentOrder = asyncHandler(async (req, res) => {
     const { bookingId, amount, userId, idempotencyKey } = req.body;

     if (!bookingId || !amount || !userId || !idempotencyKey) {
          throw new BadRequestError('bookingId, amount, userId, and idempotencyKey are required');
     }

     const result = await paymentService.createPaymentOrder(bookingId, amount, userId, idempotencyKey);

     res.status(201).json({ success: true, data: result });
});

exports.getPaymentOrder = asyncHandler(async (req, res) => {
     const { paymentOrderId } = req.params;

     const result = await paymentService.getPaymentOrder(paymentOrderId);

     res.status(200).json({ success: true, data: result });
});

exports.verifyAndCapturePayment = asyncHandler(async (req, res) => {
     const { paymentOrderId } = req.params;
     const { gatewayPaymentId, gatewaySignature } = req.body;

     if (!gatewayPaymentId || !gatewaySignature) {
          throw new BadRequestError('gatewayPaymentId and gatewaySignature are required');
     }

     const result = await paymentService.verifyAndCapturePayment(
          paymentOrderId,
          gatewayPaymentId,
          gatewaySignature
     );

     res.status(200).json({ success: true, data: result });
});

exports.initiateRefund = asyncHandler(async (req, res) => {
     const { paymentOrderId, amount, reason, idempotencyKey } = req.body;

     if (!paymentOrderId || !amount || !idempotencyKey) {
          throw new BadRequestError('paymentOrderId, amount, and idempotencyKey are required');
     }

     const result = await paymentService.initiateRefund(paymentOrderId, amount, reason, idempotencyKey);

     res.status(201).json({ success: true, data: result });
});
