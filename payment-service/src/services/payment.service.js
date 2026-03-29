const prisma = require('../config/prisma');
const logger = require('../config/logger');
const paymentProducer = require('../kafka/producer/payment.producer');
const { getGateway } = require('./gateways/gateway.factory');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/error');
const { config } = require('../config');

// ─── Idempotency Helper ──────────────────────────────────────────────────────

const withIdempotency = async (key, fn) => {
     const existing = await prisma.idempotencyRecord.findUnique({ where: { eventKey: key } });
     if (existing) {
          logger.info(`Idempotent request detected: ${key}`);
          return existing.response;
     }

     const result = await fn();

     await prisma.idempotencyRecord.create({
          data: { eventKey: key, response: result },
     });

     return result;
};

// ─── Create Payment Order ────────────────────────────────────────────────────

const createPaymentOrder = async (bookingId, amount, userId, idempotencyKey) => {
     if (!bookingId || !amount || !userId || !idempotencyKey) {
          throw new BadRequestError('bookingId, amount, userId, and idempotencyKey are required');
     }

     if (amount <= 0) {
          throw new BadRequestError('Amount must be greater than 0');
     }

     return withIdempotency(`payment-order:${idempotencyKey}`, async () => {
          const gateway = getGateway();

          // Create order with gateway
          const gatewayResult = await gateway.createOrder(amount, 'INR', bookingId, {
               bookingId,
               userId,
          });

          // Create payment order record
          const paymentOrder = await prisma.paymentOrder.create({
               data: {
                    bookingId,
                    userId,
                    amount,
                    currency: 'INR',
                    status: 'CREATED',
                    idempotencyKey,
                    gatewayProvider: config.PAYMENT_GATEWAY,
                    gatewayOrderId: gatewayResult.gatewayOrderId,
               },
          });

          // Audit log
          await prisma.paymentAuditLog.create({
               data: {
                    paymentOrderId: paymentOrder.id,
                    action: 'ORDER_CREATED',
                    gatewayResponse: gatewayResult.rawResponse,
                    metadata: { bookingId, userId, amount },
               },
          });

          logger.info(`Payment order created: ${paymentOrder.id}`, {
               bookingId,
               gatewayOrderId: gatewayResult.gatewayOrderId,
          });

          return {
               paymentOrderId: paymentOrder.id,
               gatewayOrderId: gatewayResult.gatewayOrderId,
               amount: paymentOrder.amount,
               currency: paymentOrder.currency,
               status: paymentOrder.status,
               gatewayProvider: paymentOrder.gatewayProvider,
               keyId: config.RAZORPAY_KEY_ID,
          };
     });
};

// ─── Handle Webhook ──────────────────────────────────────────────────────────

const handleWebhook = async (rawBody, signature) => {
     const gateway = getGateway();

     // Verify signature
     const isValid = gateway.verifyWebhookSignature(rawBody, signature);
     if (!isValid) {
          logger.warn('Webhook signature verification failed');
          throw new BadRequestError('Invalid webhook signature', 'INVALID_SIGNATURE');
     }

     const payload = typeof rawBody === 'string' ? JSON.parse(rawBody) : JSON.parse(rawBody.toString('utf8'));
     const event = payload.event;
     const paymentEntity = payload.payload?.payment?.entity;

     if (!paymentEntity) {
          logger.warn('Webhook payload missing payment entity', { event });
          return { status: 'ignored', event };
     }

     const gatewayOrderId = paymentEntity.order_id;
     const gatewayPaymentId = paymentEntity.id;

     // Find payment order
     const paymentOrder = await prisma.paymentOrder.findUnique({
          where: { gatewayOrderId },
     });

     if (!paymentOrder) {
          logger.warn(`Payment order not found for gateway order: ${gatewayOrderId}`);
          return { status: 'ignored', reason: 'order_not_found' };
     }

     // Audit log the webhook
     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: `WEBHOOK_${event.toUpperCase().replace(/\./g, '_')}`,
               gatewayResponse: payload,
          },
     });

     if (event === 'payment.captured' || event === 'payment.authorized') {
          return handlePaymentCaptured(paymentOrder, gatewayPaymentId, paymentEntity);
     }

     if (event === 'payment.failed') {
          return handlePaymentFailed(paymentOrder, gatewayPaymentId, paymentEntity);
     }

     if (event === 'refund.processed' || event === 'refund.created') {
          return handleRefundProcessed(paymentOrder, payload.payload?.refund?.entity);
     }

     logger.info(`Webhook event ignored: ${event}`);
     return { status: 'ignored', event };
};

const handlePaymentCaptured = async (paymentOrder, gatewayPaymentId, paymentEntity) => {
     // Idempotent: already captured
     if (paymentOrder.status === 'CAPTURED') {
          logger.info(`Payment already captured: ${paymentOrder.id}`);
          return { status: 'already_processed' };
     }

     if (paymentOrder.status !== 'CREATED') {
          logger.warn(`Cannot capture payment in status: ${paymentOrder.status}`, {
               paymentOrderId: paymentOrder.id,
          });
          return { status: 'invalid_state', currentStatus: paymentOrder.status };
     }

     // Update payment order
     await prisma.paymentOrder.update({
          where: { id: paymentOrder.id },
          data: {
               status: 'CAPTURED',
               gatewayPaymentId,
               gatewaySignature: paymentEntity.acquirer_data?.auth_code || null,
               version: { increment: 1 },
          },
     });

     logger.info(`Payment captured: ${paymentOrder.id}`, { gatewayPaymentId });

     // Publish PAYMENT_SUCCESS to Kafka
     await paymentProducer.publishPaymentSuccess(
          paymentOrder.id,
          paymentOrder.bookingId,
          gatewayPaymentId,
          paymentOrder.amount
     ).catch(err => {
          logger.error('Failed to publish PAYMENT_SUCCESS', { error: err.message });
     });

     return { status: 'captured', paymentOrderId: paymentOrder.id };
};

const handlePaymentFailed = async (paymentOrder, gatewayPaymentId, paymentEntity) => {
     // Idempotent: already failed
     if (paymentOrder.status === 'FAILED') {
          return { status: 'already_processed' };
     }

     if (paymentOrder.status !== 'CREATED') {
          return { status: 'invalid_state', currentStatus: paymentOrder.status };
     }

     const reason = paymentEntity.error_description || paymentEntity.error_reason || 'payment_failed';

     await prisma.paymentOrder.update({
          where: { id: paymentOrder.id },
          data: {
               status: 'FAILED',
               gatewayPaymentId,
               failureReason: reason,
               version: { increment: 1 },
          },
     });

     logger.info(`Payment failed: ${paymentOrder.id}`, { reason });

     // Publish PAYMENT_FAILED to Kafka
     await paymentProducer.publishPaymentFailed(
          paymentOrder.id,
          paymentOrder.bookingId,
          reason
     ).catch(err => {
          logger.error('Failed to publish PAYMENT_FAILED', { error: err.message });
     });

     return { status: 'failed', paymentOrderId: paymentOrder.id };
};

const handleRefundProcessed = async (paymentOrder, refundEntity) => {
     if (!refundEntity) return { status: 'ignored', reason: 'no_refund_entity' };

     const gatewayRefundId = refundEntity.id;

     const refund = await prisma.refund.findUnique({
          where: { gatewayRefundId },
     });

     if (refund) {
          await prisma.refund.update({
               where: { id: refund.id },
               data: { status: 'COMPLETED' },
          });

          // Update parent payment order status
          const allRefunds = await prisma.refund.findMany({
               where: { paymentOrderId: paymentOrder.id },
          });

          const totalRefunded = allRefunds
               .filter(r => r.status === 'COMPLETED' || r.id === refund.id)
               .reduce((sum, r) => sum + r.amount, 0);

          const newStatus = totalRefunded >= paymentOrder.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

          await prisma.paymentOrder.update({
               where: { id: paymentOrder.id },
               data: { status: newStatus, version: { increment: 1 } },
          });

          logger.info(`Refund processed: ${gatewayRefundId}`, { newStatus });
     }

     return { status: 'refund_processed', gatewayRefundId };
};

// ─── Verify and Capture (client-side verification) ───────────────────────────

const verifyAndCapturePayment = async (paymentOrderId, gatewayPaymentId, gatewaySignature) => {
     if (!paymentOrderId || !gatewayPaymentId || !gatewaySignature) {
          throw new BadRequestError('paymentOrderId, gatewayPaymentId, and gatewaySignature are required');
     }

     const paymentOrder = await prisma.paymentOrder.findUnique({
          where: { id: paymentOrderId },
     });

     if (!paymentOrder) {
          throw new NotFoundError('Payment order not found');
     }

     // Idempotent
     if (paymentOrder.status === 'CAPTURED') {
          return {
               paymentOrderId: paymentOrder.id,
               status: 'CAPTURED',
               gatewayPaymentId: paymentOrder.gatewayPaymentId,
               message: 'Payment already captured',
          };
     }

     if (paymentOrder.status !== 'CREATED') {
          throw new ConflictError(`Payment order is in ${paymentOrder.status} status`);
     }

     const gateway = getGateway();

     // Verify signature
     const isValid = gateway.verifyPaymentSignature(
          paymentOrder.gatewayOrderId,
          gatewayPaymentId,
          gatewaySignature
     );

     // Audit log the verification attempt
     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: isValid ? 'SIGNATURE_VERIFIED' : 'SIGNATURE_VERIFICATION_FAILED',
               metadata: { gatewayPaymentId, isValid },
          },
     });

     if (!isValid) {
          await prisma.paymentOrder.update({
               where: { id: paymentOrder.id },
               data: {
                    status: 'FAILED',
                    failureReason: 'signature_verification_failed',
                    version: { increment: 1 },
               },
          });

          // Publish failure
          await paymentProducer.publishPaymentFailed(
               paymentOrder.id,
               paymentOrder.bookingId,
               'signature_verification_failed'
          ).catch(err => {
               logger.error('Failed to publish PAYMENT_FAILED after sig failure', { error: err.message });
          });

          throw new BadRequestError('Payment signature verification failed', 'INVALID_SIGNATURE');
     }

     // Signature valid — capture payment
     await prisma.paymentOrder.update({
          where: { id: paymentOrder.id },
          data: {
               status: 'CAPTURED',
               gatewayPaymentId,
               gatewaySignature,
               version: { increment: 1 },
          },
     });

     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: 'PAYMENT_CAPTURED_VIA_VERIFY',
               metadata: { gatewayPaymentId },
          },
     });

     logger.info(`Payment captured via verify: ${paymentOrder.id}`);

     // Publish PAYMENT_SUCCESS
     await paymentProducer.publishPaymentSuccess(
          paymentOrder.id,
          paymentOrder.bookingId,
          gatewayPaymentId,
          paymentOrder.amount
     ).catch(err => {
          logger.error('Failed to publish PAYMENT_SUCCESS after verify', { error: err.message });
     });

     return {
          paymentOrderId: paymentOrder.id,
          status: 'CAPTURED',
          gatewayPaymentId,
     };
};

// ─── Initiate Refund ─────────────────────────────────────────────────────────

const initiateRefund = async (paymentOrderId, amount, reason, idempotencyKey) => {
     if (!paymentOrderId || !amount || !idempotencyKey) {
          throw new BadRequestError('paymentOrderId, amount, and idempotencyKey are required');
     }

     return withIdempotency(`refund:${idempotencyKey}`, async () => {
          const paymentOrder = await prisma.paymentOrder.findUnique({
               where: { id: paymentOrderId },
               include: { refunds: true },
          });

          if (!paymentOrder) {
               throw new NotFoundError('Payment order not found');
          }

          if (paymentOrder.status !== 'CAPTURED' && paymentOrder.status !== 'PARTIALLY_REFUNDED') {
               throw new ConflictError(`Cannot refund payment in ${paymentOrder.status} status`);
          }

          if (!paymentOrder.gatewayPaymentId) {
               throw new ConflictError('Payment has no gateway payment ID — cannot refund');
          }

          // Check total refunded doesn't exceed original amount
          const totalRefunded = paymentOrder.refunds
               .filter(r => r.status !== 'FAILED')
               .reduce((sum, r) => sum + r.amount, 0);

          if (totalRefunded + amount > paymentOrder.amount) {
               throw new BadRequestError(
                    `Refund amount (${amount}) exceeds refundable amount (${paymentOrder.amount - totalRefunded})`
               );
          }

          const gateway = getGateway();

          const gatewayResult = await gateway.initiateRefund(
               paymentOrder.gatewayPaymentId,
               amount,
               { reason, bookingId: paymentOrder.bookingId }
          );

          // Create refund record
          const refund = await prisma.refund.create({
               data: {
                    paymentOrderId: paymentOrder.id,
                    amount,
                    reason: reason || null,
                    status: 'INITIATED',
                    idempotencyKey,
                    gatewayRefundId: gatewayResult.gatewayRefundId,
               },
          });

          // Update payment order status
          await prisma.paymentOrder.update({
               where: { id: paymentOrder.id },
               data: {
                    status: 'REFUND_INITIATED',
                    version: { increment: 1 },
               },
          });

          // Audit log
          await prisma.paymentAuditLog.create({
               data: {
                    paymentOrderId: paymentOrder.id,
                    action: 'REFUND_INITIATED',
                    gatewayResponse: gatewayResult.rawResponse,
                    metadata: { refundId: refund.id, amount, reason },
               },
          });

          logger.info(`Refund initiated: ${refund.id}`, {
               paymentOrderId: paymentOrder.id,
               amount,
               gatewayRefundId: gatewayResult.gatewayRefundId,
          });

          return {
               refundId: refund.id,
               paymentOrderId: paymentOrder.id,
               status: refund.status,
               amount: refund.amount,
               gatewayRefundId: gatewayResult.gatewayRefundId,
          };
     });
};

// ─── Get Payment Order ───────────────────────────────────────────────────────

const getPaymentOrder = async (paymentOrderId) => {
     const paymentOrder = await prisma.paymentOrder.findUnique({
          where: { id: paymentOrderId },
          include: {
               auditLogs: { orderBy: { createdAt: 'desc' } },
               refunds: { orderBy: { createdAt: 'desc' } },
          },
     });

     if (!paymentOrder) {
          throw new NotFoundError('Payment order not found');
     }

     return paymentOrder;
};

module.exports = {
     createPaymentOrder,
     handleWebhook,
     verifyAndCapturePayment,
     initiateRefund,
     getPaymentOrder,
};
