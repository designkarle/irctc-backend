const axios = require('axios');
const { config } = require('../config');
const logger = require('../config/logger');

const client = axios.create({
     baseURL: config.ADMIN_SERVICE_URL,
     timeout: 5000,
     headers: {
          'Content-Type': 'application/json',
          'x-internal-service-key': config.INTERNAL_SERVICE_KEY,
     },
});

const STATION_CACHE_TTL_MS = 10 * 60 * 1000;
const stationCache = new Map();

function cacheGet(stationId) {
     const entry = stationCache.get(stationId);
     if (!entry) return null;
     if (Date.now() > entry.expiresAt) {
          stationCache.delete(stationId);
          return null;
     }
     return entry.value;
}

function cacheSet(stationId, value) {
     stationCache.set(stationId, {
          value,
          expiresAt: Date.now() + STATION_CACHE_TTL_MS,
     });
}

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
                    logger.warn(`Station client retry ${attempt}/${maxRetries} after ${delay}ms`, {
                         error: error.message,
                    });
                    await new Promise(resolve => setTimeout(resolve, delay));
               }
          }
     }
     throw lastError;
}

const stationClient = {
     async getStationById(stationId) {
          if (!stationId) return null;

          const cached = cacheGet(stationId);
          if (cached) return cached;

          const station = await withRetry(async () => {
               const { data } = await client.get(`/station/internal/${stationId}`);
               return data.data;
          });

          if (station) cacheSet(stationId, station);
          return station;
     },
};

module.exports = { stationClient };
