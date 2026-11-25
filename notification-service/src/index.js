require('dotenv').config();
const emailConsumer = require('./kafka/consumer/email.consumer');
const logger = require('./config/logger');
const { disconnectAll } = require('./config/kafka');
const { installGracefulShutdown } = require('../../shared/utils/gracefulShutdown');

async function startNotificationService() {
     try {
          logger.info('Starting Notification Service...');

          const requiredEnvVars = ['SENDGRID_API_KEY', 'MAIL_SEND', 'KAFKA_BROKER'];
          const missing = requiredEnvVars.filter(varName => !process.env[varName]);

          if (missing.length > 0) {
               throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
          }

          await emailConsumer.start();

          // B7: this service had NO drain at all — config/kafka.js registered a signal
          // handler that disconnected and immediately process.exit(0)'d, abandoning any
          // email currently being sent. Since notification-service is the last hop for
          // ticket confirmations, a dropped in-flight message is a customer who paid
          // and never heard back.
          installGracefulShutdown({
               logger,
               steps: [
                    { name: 'kafka drain', fn: () => disconnectAll() },
               ],
          });

          logger.info('✅ Notification Service started successfully');
          logger.info('Service is ready to process notifications');

     } catch (error) {
          logger.error('Failed to start Notification Service', {
               error: error.message,
               stack: error.stack
          });
          process.exit(1);
     }
}

process.on('unhandledRejection', (reason, promise) => {
     logger.error('Unhandled Rejection', { reason, promise });
});

process.on('uncaughtException', (error) => {
     logger.error('Uncaught Exception', { error: error.message, stack: error.stack });
     process.exit(1);
});

startNotificationService();