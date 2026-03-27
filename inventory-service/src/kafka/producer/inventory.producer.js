const { producer, connectProducer } = require('../../config/kafka');
const logger = require('../../config/logger');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');

const MAX_PUBLISH_RETRIES = 3;
const RETRY_DELAY_MS = 500;

class InventoryProducer {
     constructor() { this.isInitialized = false; }

     async initialize() {
          if (!this.isInitialized) {
               await connectProducer();
               this.isInitialized = true;
          }
     }

     /**
      * Send a message with retries. Availability updates are important for
      * keeping search results accurate — retry before giving up.
      */
     async sendMessage(topic, key, value) {
          await this.initialize();

          let lastError;
          for (let attempt = 1; attempt <= MAX_PUBLISH_RETRIES; attempt++) {
               try {
                    const result = await producer.send({
                         topic,
                         messages: [{
                              key: key || `${topic}-${Date.now()}`,
                              value: JSON.stringify(value),
                              timestamp: Date.now().toString(),
                         }],
                    });
                    logger.info(`Message sent to topic: ${topic}`, {
                         key,
                         partition: result[0].partition,
                         offset: result[0].offset,
                    });
                    return result;
               } catch (error) {
                    lastError = error;
                    logger.error(`Failed to send message to ${topic} (attempt ${attempt}/${MAX_PUBLISH_RETRIES})`, {
                         error: error.message,
                         key,
                    });
                    if (attempt < MAX_PUBLISH_RETRIES) {
                         await new Promise(r => setTimeout(r, RETRY_DELAY_MS * attempt));
                    }
               }
          }

          logger.error(`All ${MAX_PUBLISH_RETRIES} publish attempts failed for ${topic}`, { key });
          throw lastError;
     }

     async publishSeatAvailabilityUpdated(scheduleId, trainId, available, locked, booked) {
          return this.sendMessage(
               KAFKA_TOPICS.SEAT_AVAILABILITY_UPDATED,
               `schedule-${scheduleId}`,
               { scheduleId, trainId, available, locked, booked }
          );
     }
}

module.exports = new InventoryProducer();
