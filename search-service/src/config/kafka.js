const { Kafka, logLevel } = require('kafkajs');
const logger = require('./logger');
const { config } = require('.');

const kafka = new Kafka({
     clientId: config.KAFKA_CLIENT_ID,
     brokers: [config.KAFKA_BROKER],
     logLevel: logLevel.ERROR,
     retry: { initialRetryTime: 300, retries: 8, maxRetryTime: 30000 },
});

const consumer = kafka.consumer({
     groupId: 'search-service-group-v2',
     sessionTimeout: 30000,
     heartbeatInterval: 3000,
});

const disconnectAll = async () => {
     await consumer.disconnect();
     logger.info('Kafka consumer disconnected');
};

module.exports = { kafka, consumer, disconnectAll };