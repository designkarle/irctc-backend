const axios = require('axios');
const { config } = require('../config');
const logger = require('../config/logger');

const client = axios.create({
     baseURL: config.PAYMENT_SERVICE_URL,
     timeout: 10000,
     headers: {
          'Content-Type': 'application/json',
          'x-internal-service-key': config.INTERNAL_SERVICE_KEY,
     },
});

/**
 * Retry wrapper with exponential backoff.
 */
async function withRetry(fn, maxRetries = 3) {
     let lastError;
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
               return await fn();
          } catch (error) {
               lastError = error;
               const status = error.response?.status;
               if (status && status >= 400 && status < 500) throw error;

               if (attempt < maxRetries) {
                    const delay = 200 * Math.pow(2, attempt - 1);
                    logger.warn(`Payment client retry ${attempt}/${maxRetries} after ${delay}ms`, {
                         error: error.message,
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
               }
          }
     }
     throw lastError;
}

function extractError(error) {
     if (error.response?.data) {
          return {
               status: error.response.status,
               message: error.response.data.message || error.message,
               code: error.response.data.error,
          };
     }
     return { status: 500, message: error.message, code: 'PAYMENT_SERVICE_ERROR' };
}

const paymentClient = {
     async createPaymentOrder(bookingId, amount, userId, idempotencyKey) {
          return withRetry(async () => {
               const { data } = await client.post('/orders', {
                    bookingId,
                    amount,
                    userId,
                    idempotencyKey,
               });
               return data.data;
          });
     },

     async getPaymentStatus(paymentOrderId) {
          return withRetry(async () => {
               const { data } = await client.get(`/orders/${paymentOrderId}`);
               return data.data;
          });
     },

     async verifyPayment(paymentOrderId, gatewayPaymentId, gatewaySignature) {
          return withRetry(async () => {
               const { data } = await client.post(`/orders/${paymentOrderId}/verify`, {
                    gatewayPaymentId,
                    gatewaySignature,
               });
               return data.data;
          });
     },

     async initiateRefund(paymentOrderId, amount, reason, idempotencyKey) {
          return withRetry(async () => {
               const { data } = await client.post('/refunds', {
                    paymentOrderId,
                    amount,
                    reason,
                    idempotencyKey,
               });
               return data.data;
          });
     },
};

module.exports = { paymentClient, extractError };
