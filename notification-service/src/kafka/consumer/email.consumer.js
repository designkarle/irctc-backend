const { consumer, producer, connectProducer } = require('../../config/kafka');
const emailService = require('../../services/email.service');
const logger = require('../../config/logger');
const { TOPICS } = require('../../utils/constants');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../shared/utils/dlqHandler');

class EmailConsumer {
     async start() {
          try {
               await consumer.connect();
               await connectProducer(); // needed for DLQ publishing
               logger.info('Email consumer connected to Kafka');

               await consumer.subscribe({
                    topics: Object.values(TOPICS),
                    fromBeginning: false
               });

               await consumer.run({
                    eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_NOTIFICATION, logger, async ({ topic, parsedValue }) => {
                         logger.info(`Processing message from topic: ${topic}`);
                         await this.handleMessage(topic, parsedValue);
                    }),
               });

               logger.info('Email consumer is running and listening for messages...');
          } catch (error) {
               logger.error('Failed to start email consumer', { error: error.message });
               throw error;
          }
     }

     async handleMessage(topic, data) {
          switch (topic) {
               case TOPICS.OTP_EMAIL:
                    await this.handleOtpEmail(data);
                    break;

               case TOPICS.WELCOME_EMAIL:
                    await this.handleWelcomeEmail(data);
                    break;

               default:
                    logger.warn(`Unknown topic: ${topic}`);
          }
     }

     async handleOtpEmail(data) {
          const { email, otp, ttlMinutes } = data;

          if (!email || !otp) {
               throw new Error('Missing required fields: email or otp');
          }

          await emailService.sendOtpEmail(email, otp, ttlMinutes || 5);
          logger.info(`OTP email sent to ${email}`);
     }

     async handleWelcomeEmail(data) {
          const { email, firstName } = data;

          if (!email || !firstName) {
               throw new Error('Missing required fields: email or firstName');
          }

          await emailService.sendWelcomeEmail(email, firstName);
          logger.info(`Welcome email sent to ${email}`);
     }

     async stop() {
          await consumer.disconnect();
          logger.info('Email consumer disconnected');
     }
}

module.exports = new EmailConsumer();
