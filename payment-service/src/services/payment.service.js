const prisma = require('../config/prisma');
const logger = require('../config/logger');
const { getGateway } = require('./gateways/gateway.factory');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/error');
const { config } = require('../config');
const outbox = require('../utils/outbox');
const { KAFKA_TOPICS } = require('../../../shared/constants/kafka-topics');

// ─── Optimistic Lock Helper (CAS — Compare-And-Swap) ─────────────────────────
// The webhook and the browser's verify call routinely arrive within milliseconds
// of each other. Without this, both read status CREATED, both write CAPTURED, and
// both publish PAYMENT_SUCCESS. The `version` column existed for exactly this and
// was never used — every status transition now goes through here.
//
// Returns true when this caller won the transition, false when another already did.
// Callers must only emit side effects (Kafka, audit-of-record) when it returns true.

const casUpdatePaymentOrder = async (paymentOrderId, expectedVersion, data, client = prisma) => {
     const result = await client.paymentOrder.updateMany({
          where: { id: paymentOrderId, version: expectedVersion },
          data: { ...data, version: { increment: 1 } },
     });

     if (result.count === 0) {
          logger.info(`CAS lost for payment order ${paymentOrderId} (expected version ${expectedVersion})`);
          return false;
     }

     return true;
};

/**
 * B1: transition a payment order and record its event atomically.
 *
 * The publish used to happen after the update committed, in a `.catch(log)` — so a
 * Kafka outage captured the customer's money and never told booking-service, which
 * meant no seats confirmed and no ticket. Both now commit together or neither does.
 *
 * @returns {Promise<boolean>} whether this caller won the CAS.
 */
const transitionAndAnnounce = async (paymentOrder, data, event) => {
     return prisma.$transaction(async (tx) => {
          const won = await casUpdatePaymentOrder(paymentOrder.id, paymentOrder.version, data, tx);
          if (!won) return false;

          if (event) {
               await outbox.enqueue(tx, {
                    topic: event.topic,
                    key: `payment-${paymentOrder.id}`,
                    payload: event.payload,
               });
          }

          return true;
     });
};

const paymentSuccessEvent = (paymentOrder, gatewayPaymentId) => ({
     topic: KAFKA_TOPICS.PAYMENT_SUCCESS,
     payload: {
          paymentOrderId: paymentOrder.id,
          bookingId: paymentOrder.bookingId,
          gatewayPaymentId,
          amount: paymentOrder.amount,
          capturedAt: new Date().toISOString(),
     },
});

const paymentFailedEvent = (paymentOrder, reason) => ({
     topic: KAFKA_TOPICS.PAYMENT_FAILED,
     payload: {
          paymentOrderId: paymentOrder.id,
          bookingId: paymentOrder.bookingId,
          reason,
          failedAt: new Date().toISOString(),
     },
});

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

     // Claim the transition and record the event in one transaction. If the
     // client-side verify captured it first we lose the CAS and emit nothing.
     const won = await transitionAndAnnounce(
          paymentOrder,
          {
               status: 'CAPTURED',
               gatewayPaymentId,
               gatewaySignature: paymentEntity.acquirer_data?.auth_code || null,
          },
          paymentSuccessEvent(paymentOrder, gatewayPaymentId)
     );

     if (!won) {
          logger.info(`Payment ${paymentOrder.id} already captured by another path — webhook is a no-op`);
          return { status: 'already_processed' };
     }

     logger.info(`Payment captured: ${paymentOrder.id}`, { gatewayPaymentId });

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

     const won = await transitionAndAnnounce(
          paymentOrder,
          { status: 'FAILED', gatewayPaymentId, failureReason: reason },
          paymentFailedEvent(paymentOrder, reason)
     );

     if (!won) {
          logger.info(`Payment ${paymentOrder.id} already transitioned by another path — failure webhook is a no-op`);
          return { status: 'already_processed' };
     }

     logger.info(`Payment failed: ${paymentOrder.id}`, { reason });

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

          // Recompute the parent order's status from the refunds that are now on record.
          // Read fresh and CAS: concurrent refund webhooks for the same order would
          // otherwise each compute a total from their own stale snapshot.
          for (let attempt = 1; attempt <= 2; attempt++) {
               const current = await prisma.paymentOrder.findUnique({
                    where: { id: paymentOrder.id },
                    include: { refunds: true },
               });

               if (!current) break;

               const totalRefunded = current.refunds
                    .filter(r => r.status === 'COMPLETED')
                    .reduce((sum, r) => sum + r.amount, 0);

               const newStatus = totalRefunded >= current.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';

               const won = await casUpdatePaymentOrder(current.id, current.version, { status: newStatus });

               if (won) {
                    logger.info(`Refund processed: ${gatewayRefundId}`, { newStatus, totalRefunded });
                    break;
               }

               if (attempt === 2) {
                    logger.warn(`Could not update order status after refund ${gatewayRefundId} — concurrent write won twice`, {
                         paymentOrderId: current.id,
                    });
               }
          }
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
          // The event is only recorded if we actually moved the order into FAILED — a
          // concurrent webhook may have legitimately captured it in the meantime.
          await transitionAndAnnounce(
               paymentOrder,
               { status: 'FAILED', failureReason: 'signature_verification_failed' },
               paymentFailedEvent(paymentOrder, 'signature_verification_failed')
          );

          throw new BadRequestError('Payment signature verification failed', 'INVALID_SIGNATURE');
     }

     // Signature valid — claim the capture and record the event atomically.
     const won = await transitionAndAnnounce(
          paymentOrder,
          { status: 'CAPTURED', gatewayPaymentId, gatewaySignature },
          paymentSuccessEvent(paymentOrder, gatewayPaymentId)
     );

     if (!won) {
          // The webhook captured it first. That path already published PAYMENT_SUCCESS,
          // so report success to the browser without emitting a duplicate event.
          const fresh = await prisma.paymentOrder.findUnique({ where: { id: paymentOrder.id } });
          logger.info(`Payment ${paymentOrder.id} already captured by webhook — verify is a no-op`);

          return {
               paymentOrderId: paymentOrder.id,
               status: fresh?.status || 'CAPTURED',
               gatewayPaymentId: fresh?.gatewayPaymentId || gatewayPaymentId,
               message: 'Payment already captured',
          };
     }

     await prisma.paymentAuditLog.create({
          data: {
               paymentOrderId: paymentOrder.id,
               action: 'PAYMENT_CAPTURED_VIA_VERIFY',
               metadata: { gatewayPaymentId },
          },
     });

     logger.info(`Payment captured via verify: ${paymentOrder.id}`);

     // B1: PAYMENT_SUCCESS was enqueued to the outbox in the same transaction as the
     // capture above. No post-commit send here — that dual-write is what let a Kafka
     // outage take a customer's money without ever confirming their seats.

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

          // Update payment order status. The gateway refund has already been accepted
          // at this point, so losing the CAS is not a failure — the refund record is the
          // source of truth and handleRefundProcessed will settle the order status when
          // the webhook lands. Log it rather than unwinding a real refund.
          const won = await casUpdatePaymentOrder(paymentOrder.id, paymentOrder.version, {
               status: 'REFUND_INITIATED',
          });

          if (!won) {
               logger.warn(`Refund ${refund.id} recorded but order status was changed concurrently`, {
                    paymentOrderId: paymentOrder.id,
               });
          }

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
