const { consumer } = require('../../config/kafka');
const emailService = require('../../services/email.service');
const logger = require('../../config/logger');
const { TOPICS } = require('../../utils/constants');

class EmailConsumer {
     async start() {
          try {
               await consumer.connect();
               logger.info('Email consumer connected to Kafka');

               await consumer.subscribe({
                    topics: Object.values(TOPICS),
                    fromBeginning: false
               });

               await consumer.run({
                    eachMessage: async ({ topic, partition, message }) => {
                         try {
                              const value = JSON.parse(message.value.toString());
                              logger.info(`Processing message from topic: ${topic}`, {
                                   partition,
                                   offset: message.offset,
                                   key: message.key?.toString(),
                              });

                              await this.handleMessage(topic, value);

                         } catch (error) {
                              logger.error('Error processing message', {
                                   topic,
                                   partition,
                                   offset: message.offset,
                                   error: error.message,
                                   stack: error.stack,
                              });

                              // TODO: Send to dead letter queue for failed messages
                              // await this.sendToDeadLetterQueue(topic, message, error);
                         }
                    },
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