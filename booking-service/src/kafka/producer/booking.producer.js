const { producer, connectProducer } = require('../../config/kafka');
const logger = require('../../config/logger');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');

const MAX_PUBLISH_RETRIES = 3;
const RETRY_DELAY_MS = 500;

class BookingProducer {
     constructor() { this.isInitialized = false; }

     async initialize() {
          if (!this.isInitialized) {
               await connectProducer();
               this.isInitialized = true;
          }
     }

     /**
      * Send a message with retries. Critical events (BOOKING_CONFIRMED, etc.)
      * must not be silently lost — callers should handle the thrown error.
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

     async publishBookingConfirmed(data) {
          return this.sendMessage(
               KAFKA_TOPICS.BOOKING_CONFIRMED,
               `booking-${data.bookingId}`,
               { ...data, confirmedAt: new Date().toISOString() }
          );
     }

     async publishBookingCancelled(data) {
          return this.sendMessage(
               KAFKA_TOPICS.BOOKING_CANCELLED,
               `booking-${data.bookingId}`,
               { ...data, cancelledAt: new Date().toISOString() }
          );
     }

     async publishBookingFailed(data) {
          return this.sendMessage(
               KAFKA_TOPICS.BOOKING_FAILED,
               `booking-${data.bookingId}`,
               { ...data, failedAt: new Date().toISOString() }
          );
     }
}

module.exports = new BookingProducer();
