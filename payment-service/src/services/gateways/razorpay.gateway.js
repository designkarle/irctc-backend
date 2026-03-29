const Razorpay = require('razorpay');
const crypto = require('crypto');
const BaseGateway = require('./base.gateway');
const logger = require('../../config/logger');

class RazorpayGateway extends BaseGateway {
     constructor(keyId, keySecret, webhookSecret) {
          super('razorpay');
          this.keyId = keyId;
          this.keySecret = keySecret;
          this.webhookSecret = webhookSecret;
          this.client = new Razorpay({
               key_id: keyId,
               key_secret: keySecret,
          });
     }

     async createOrder(amount, currency, receipt, notes = {}) {
          const amountInPaise = Math.round(amount * 100);

          let order;
          try {
               order = await this.client.orders.create({
                    amount: amountInPaise,
                    currency,
                    receipt,
                    notes,
               });
          } catch (err) {
               // Razorpay SDK throws plain objects, not Error instances
               const description = err?.error?.description || err?.message || JSON.stringify(err);
               logger.error(`Razorpay createOrder failed: ${description}`);
               const { BadRequestError } = require('../../utils/error');
               throw new BadRequestError(`Payment gateway error: ${description}`, 'PAYMENT_GATEWAY_ERROR');
          }

          logger.info(`Razorpay order created: ${order.id}`, { receipt, amount });

          return {
               gatewayOrderId: order.id,
               amount: order.amount / 100,
               currency: order.currency,
               receipt: order.receipt,
               rawResponse: order,
          };
     }

     verifyPaymentSignature(orderId, paymentId, signature) {
          const body = `${orderId}|${paymentId}`;
          const expectedSignature = crypto
               .createHmac('sha256', this.keySecret)
               .update(body)
               .digest('hex');

          return crypto.timingSafeEqual(
               Buffer.from(expectedSignature, 'hex'),
               Buffer.from(signature, 'hex')
          );
     }

     verifyWebhookSignature(rawBody, signature) {
          const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');
          const expectedSignature = crypto
               .createHmac('sha256', this.webhookSecret)
               .update(body)
               .digest('hex');

          try {
               return crypto.timingSafeEqual(
                    Buffer.from(expectedSignature, 'hex'),
                    Buffer.from(signature, 'hex')
               );
          } catch {
               return false;
          }
     }

     async fetchPayment(paymentId) {
          const payment = await this.client.payments.fetch(paymentId);

          return {
               status: payment.status,
               amount: payment.amount / 100,
               method: payment.method,
               rawResponse: payment,
          };
     }

     async initiateRefund(paymentId, amount, notes = {}) {
          const amountInPaise = Math.round(amount * 100);

          const refund = await this.client.payments.refund(paymentId, {
               amount: amountInPaise,
               notes,
          });

          logger.info(`Razorpay refund initiated: ${refund.id}`, { paymentId, amount });

          return {
               gatewayRefundId: refund.id,
               status: refund.status,
               amount: refund.amount / 100,
               rawResponse: refund,
          };
     }

     async fetchRefund(paymentId, refundId) {
          const refund = await this.client.payments.fetchRefund(paymentId, refundId);

          return {
               status: refund.status,
               amount: refund.amount / 100,
               rawResponse: refund,
          };
     }
}

module.exports = RazorpayGateway;
