const logger = require('../config/logger');

async function retryTransaction(fn, maxRetries = 3) {
     for (let attempt = 1; attempt <= maxRetries; attempt++) {
          try {
               return await fn();
          } catch (error) {
               const isRetryable =
                    error.code === 'P2034' ||
                    error.message?.includes('could not serialize') ||
                    error.message?.includes('could not obtain lock') ||
                    error.message?.includes('deadlock detected');

               if (isRetryable && attempt < maxRetries) {
                    const delay = 50 * attempt;
                    logger.warn(`Transaction attempt ${attempt} failed (retryable), retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    continue;
               }
               throw error;
          }
     }
}

module.exports = { retryTransaction };
