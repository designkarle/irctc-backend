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


// Graceful shutdown
const shutdown = async () => {
     logger.info('Shutting down Kafka connections...');
     await consumer.disconnect();
     process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

module.exports = { kafka, consumer };