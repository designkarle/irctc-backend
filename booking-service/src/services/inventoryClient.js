const axios = require('axios');
const { config } = require('../config');
const logger = require('../config/logger');

const client = axios.create({
     baseURL: config.INVENTORY_SERVICE_URL,
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
               // Don't retry client errors (4xx) — only server/network errors
               const status = error.response?.status;
               if (status && status >= 400 && status < 500) throw error;

               if (attempt < maxRetries) {
                    const delay = 200 * Math.pow(2, attempt - 1);
                    logger.warn(`Inventory client retry ${attempt}/${maxRetries} after ${delay}ms`, {
                         error: error.message,
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
               }
          }
     }
     throw lastError;
}

/**
 * Extract error message from axios error.
 */
function extractError(error) {
     if (error.response?.data) {
          return {
               status: error.response.status,
               message: error.response.data.message || error.message,
               code: error.response.data.error,
          };
     }
     return { status: 500, message: error.message, code: 'INVENTORY_SERVICE_ERROR' };
}

const inventoryClient = {
     async getAvailability(scheduleId) {
          return withRetry(async () => {
               const { data } = await client.get(`/schedules/${scheduleId}/availability`);
               return data.data;
          });
     },

     async getSeats(scheduleId, filters = {}) {
          return withRetry(async () => {
               const params = {};
               if (filters.status) params.status = filters.status;
               if (filters.seatType) params.seatType = filters.seatType;
               if (filters.fromSeq) params.fromSeq = filters.fromSeq;  // --- SEGMENT BOOKING
               if (filters.toSeq) params.toSeq = filters.toSeq;        // --- SEGMENT BOOKING

               const { data } = await client.get(`/schedules/${scheduleId}/seats`, { params });
               return data.data;
          });
     },

     // --- SEGMENT BOOKING: Added fromSeq/toSeq params to holdSeats, releaseSeats, confirmSeats ---
     async holdSeats(scheduleId, seatIds, userId, ttlSeconds, fromSeq, toSeq) {
          return withRetry(async () => {
               const { data } = await client.post('/seats/lock', {
                    scheduleId,
                    seatIds,
                    userId,
                    ttlSeconds,
                    fromSeq,  // --- SEGMENT BOOKING
                    toSeq,    // --- SEGMENT BOOKING
               });
               return data.data;
          });
     },

     async releaseSeats(scheduleId, seatIds, userId, fromSeq, toSeq) {
          return withRetry(async () => {
               const { data } = await client.post('/seats/unlock', {
                    scheduleId,
                    seatIds,
                    userId,
                    fromSeq,  // --- SEGMENT BOOKING
                    toSeq,    // --- SEGMENT BOOKING
               });
               return data.data;
          });
     },

     async confirmSeats(scheduleId, seatIds, userId, bookingId, fromSeq, toSeq) {
          return withRetry(async () => {
               const { data } = await client.post('/seats/confirm', {
                    scheduleId,
                    seatIds,
                    userId,
                    bookingId,
                    fromSeq,  // --- SEGMENT BOOKING
                    toSeq,    // --- SEGMENT BOOKING
               });
               return data.data;
          });
     },

     async cancelBooking(scheduleId, bookingId, userId) {
          return withRetry(async () => {
               const { data } = await client.post('/seats/cancel-booking', {
                    scheduleId,
                    bookingId,
                    userId,
               });
               return data.data;
          });
     },
};

module.exports = { inventoryClient, extractError };
