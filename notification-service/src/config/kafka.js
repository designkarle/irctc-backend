const { Kafka, logLevel } = require('kafkajs');
const logger = require('./logger');
const { config } = require('.');
const kafka = new Kafka({
     clientId: config.KAFKA_CLIENT_ID,
     brokers: [config.KAFKA_BROKER || 'localhost:9093'],
     logLevel: logLevel.ERROR,
     retry: {
          initialRetryTime: 300,
          retries: 10,
          maxRetryTime: 30000,
          multiplier: 2,
     },
});

const consumer = kafka.consumer({
     groupId: 'notification-service-group',
     sessionTimeout: 30000,
     heartbeatInterval: 3000,
});

// Producer (used only for DLQ publishing)
const producer = kafka.producer({
     allowAutoTopicCreation: true,
     retry: { retries: 3 },
});

let isProducerConnected = false;

const connectProducer = async () => {
     if (!isProducerConnected) {
          await producer.connect();
          isProducerConnected = true;
          logger.info('Kafka producer connected (DLQ)');
     }
};

// B7: this module used to register its own SIGTERM/SIGINT handlers that called
// process.exit(0) immediately after disconnecting — killing the process without
// letting any in-flight eachMessage handler finish, and racing whatever else the
// service still had to clean up. Shutdown ordering now belongs to index.js; this
// module just exposes the teardown primitives.

/** Stops consuming and waits for in-flight message handlers to settle. */
const disconnectConsumer = async () => {
     await consumer.disconnect();
     logger.info('Kafka consumer disconnected');
};

const disconnectProducer = async () => {
     if (isProducerConnected) {
          await producer.disconnect();
          isProducerConnected = false;
          logger.info('Kafka producer disconnected (DLQ)');
     }
};

/** Consumer first — its handlers may still need the producer for DLQ publishing. */
const disconnectAll = async () => {
     await disconnectConsumer();
     await disconnectProducer();
};

module.exports = {
     kafka,
     consumer,
     producer,
     connectProducer,
     disconnectConsumer,
     disconnectProducer,
     disconnectAll,
};
