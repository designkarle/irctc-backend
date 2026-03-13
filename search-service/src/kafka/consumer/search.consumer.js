const { consumer } = require('../../config/kafka');
const searchService = require('../../services/search.service');
const logger = require('../../config/logger');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');

class SearchConsumer {
     async start() {
          await consumer.connect();
          logger.info('Search consumer connected');

          await consumer.subscribe({
               topics: [
                    KAFKA_TOPICS.STATION_CREATED,
                    KAFKA_TOPICS.ROUTE_CREATED,
                    KAFKA_TOPICS.SCHEDULE_CREATED,
                    KAFKA_TOPICS.SCHEDULE_CANCELLED,
                    KAFKA_TOPICS.SEAT_AVAILABILITY_UPDATED,
               ],
               fromBeginning: true,
          });

          await consumer.run({
               eachMessage: async ({ topic, partition, message }) => {
                    try {
                         const value = JSON.parse(message.value.toString());
                         logger.info(`Processing ${topic}`, { partition, offset: message.offset });

                         switch (topic) {
                              case KAFKA_TOPICS.STATION_CREATED:
                                   await searchService.indexStation(value);
                                   break;
                              case KAFKA_TOPICS.ROUTE_CREATED:
                                   await searchService.indexTrainRoute(value);
                                   break;
                              case KAFKA_TOPICS.SCHEDULE_CREATED:
                                   await searchService.indexSchedule(value);
                                   break;
                              case KAFKA_TOPICS.SCHEDULE_CANCELLED:
                                   await searchService.cancelSchedule(value);
                                   break;
                              case KAFKA_TOPICS.SEAT_AVAILABILITY_UPDATED:
                                   await searchService.updateSeatAvailability(value);
                                   break;
                              default:
                                   logger.warn(`Unknown topic: ${topic}`);
                         }
                    } catch (error) {
                         logger.error('Error processing message', { topic, error: error.message, stack: error.stack });
                    }
               },
          });

          logger.info('Search consumer running...');
     }
}

module.exports = new SearchConsumer();
