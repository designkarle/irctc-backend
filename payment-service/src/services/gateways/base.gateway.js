/**
 * Abstract base class defining the payment gateway interface.
 * All gateway implementations must extend this and implement every method.
 * This enables the adapter pattern — swap gateways without touching business logic.
 */
class BaseGateway {
     constructor(providerName) {
          if (new.target === BaseGateway) {
               throw new Error('BaseGateway is abstract and cannot be instantiated directly');
          }
          this.providerName = providerName;
     }

     /**
      * Create a payment order with the gateway.
      * @param {number} amount - Amount in base currency (e.g., INR, not paise)
      * @param {string} currency - Currency code (e.g., "INR")
      * @param {string} receipt - Unique receipt/reference ID (typically bookingId)
      * @param {object} notes - Additional metadata
      * @returns {Promise<{ gatewayOrderId: string, amount: number, currency: string, receipt: string, rawResponse: object }>}
      */
     async createOrder(amount, currency, receipt, notes = {}) {
          throw new Error('createOrder() must be implemented by gateway');
     }

     /**
      * Verify a payment signature (client-side verification after checkout).
      * @param {string} orderId - Gateway order ID
      * @param {string} paymentId - Gateway payment ID
      * @param {string} signature - Signature from client
      * @returns {boolean}
      */
     verifyPaymentSignature(orderId, paymentId, signature) {
          throw new Error('verifyPaymentSignature() must be implemented by gateway');
     }

     /**
      * Verify a webhook signature from the gateway.
      * @param {string|Buffer} rawBody - Raw request body
      * @param {string} signature - Signature from webhook header
      * @returns {boolean}
      */
     verifyWebhookSignature(rawBody, signature) {
          throw new Error('verifyWebhookSignature() must be implemented by gateway');
     }

     /**
      * Fetch payment details from gateway.
      * @param {string} paymentId - Gateway payment ID
      * @returns {Promise<{ status: string, amount: number, method: string, rawResponse: object }>}
      */
     async fetchPayment(paymentId) {
          throw new Error('fetchPayment() must be implemented by gateway');
     }

     /**
      * Initiate a refund.
      * @param {string} paymentId - Gateway payment ID to refund
      * @param {number} amount - Refund amount in base currency
      * @param {object} notes - Additional metadata
      * @returns {Promise<{ gatewayRefundId: string, status: string, amount: number, rawResponse: object }>}
      */
     async initiateRefund(paymentId, amount, notes = {}) {
          throw new Error('initiateRefund() must be implemented by gateway');
     }

     /**
      * Fetch refund details from gateway.
      * @param {string} paymentId - Gateway payment ID
      * @param {string} refundId - Gateway refund ID
      * @returns {Promise<{ status: string, amount: number, rawResponse: object }>}
      */
     async fetchRefund(paymentId, refundId) {
          throw new Error('fetchRefund() must be implemented by gateway');
     }
}

module.exports = BaseGateway;
