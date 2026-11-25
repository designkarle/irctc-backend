const prisma = require('../config/prisma');
const logger = require('../config/logger');
const producer = require('../kafka/producer/payment.producer');
const { createOutbox } = require('../../../shared/utils/outbox');

/**
 * B1: this service's transactional outbox.
 *
 * Use `enqueue(tx, { topic, key, payload })` from INSIDE a prisma.$transaction so
 * the event and the state change commit together. The relay publishes queued rows
 * through the existing producer, so retry/backoff semantics there still apply.
 */
const outbox = createOutbox({
     prisma,
     logger,
     sendMessage: (topic, key, payload) => producer.sendMessage(topic, key, payload),
});

module.exports = outbox;
