const { consumer } = require('../../config/kafka');
const { producer, connectProducer } = require('../../config/kafka');
const logger = require('../../config/logger');
const { KAFKA_TOPICS } = require('../../../../shared/constants/kafka-topics');
const { withDLQ } = require('../../../../shared/utils/dlqHandler');
const bookingService = require('../../services/booking.service');

const start = async () => {
     await consumer.connect();
     await connectProducer(); // needed for DLQ publishing
     logger.info('Booking consumer connected');

     await consumer.subscribe({
          topics: [
               KAFKA_TOPICS.PAYMENT_SUCCESS,
               KAFKA_TOPICS.PAYMENT_FAILED,
               KAFKA_TOPICS.SCHEDULE_CANCELLED,
          ],
          fromBeginning: false,
     });

     await consumer.run({
          eachMessage: withDLQ(producer, KAFKA_TOPICS.DLQ_BOOKING, logger, async ({ topic, partition, message, parsedValue }) => {
               logger.info(`Received message on topic: ${topic}`, {
                    partition,
                    offset: message.offset,
                    key: message.key?.toString(),
               });

               switch (topic) {
                    case KAFKA_TOPICS.PAYMENT_SUCCESS:
                         await bookingService.handlePaymentSuccess(
                              parsedValue.paymentOrderId,
                              parsedValue.gatewayPaymentId,
                              parsedValue.amount
                         );
                         break;

                    case KAFKA_TOPICS.PAYMENT_FAILED:
                         await bookingService.handlePaymentFailure(
                              parsedValue.paymentOrderId,
                              parsedValue.reason
                         );
                         break;

                    case KAFKA_TOPICS.SCHEDULE_CANCELLED: {
                         const scheduleId = parsedValue.scheduleId || parsedValue.id || (parsedValue.data && parsedValue.data.scheduleId);
                         await bookingService.handleScheduleCancelled(scheduleId);
                         break;
                    }

                    default:
                         logger.warn(`Unknown topic: ${topic}`);
               }
          }),
     });

     logger.info('Booking consumer running');
};

module.exports = { start };
