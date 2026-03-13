const { Client } = require('@elastic/elasticsearch');
const { config } = require('.');
const logger = require('./logger');

const esClient = new Client({ node: config.ELASTICSEARCH_URL });

const STATION_INDEX = 'stations';
const TRAIN_INDEX = 'trains';
const ROUTE_INDEX = 'routes';
const SCHEDULE_INDEX = 'schedules';

/**
 * Create indices with mappings that power:
 *   • Fuzzy search  (match + fuzziness)
 *   • Autocomplete  (completion suggester)
 *   • Full-text     (text analyzer)
 */
const initIndices = async () => {
     // ── Station index (for autocomplete) ──
     const stationExists = await esClient.indices.exists({ index: STATION_INDEX });
     if (!stationExists) {
          await esClient.indices.create({
               index: STATION_INDEX,
               settings: {
                    analysis: {
                         analyzer: {
                              autocomplete_analyzer: {
                                   type: 'custom',
                                   tokenizer: 'autocomplete_tokenizer',
                                   filter: ['lowercase'],
                              },
                              search_analyzer: {
                                   type: 'custom',
                                   tokenizer: 'standard',
                                   filter: ['lowercase'],
                              },
                         },
                         tokenizer: {
                              autocomplete_tokenizer: {
                                   type: 'edge_ngram',
                                   min_gram: 2,
                                   max_gram: 20,
                                   token_chars: ['letter', 'digit'],
                              },
                         },
                    },
               },
               mappings: {
                    properties: {
                         stationId: { type: 'keyword' },
                         name: { type: 'text', analyzer: 'autocomplete_analyzer', search_analyzer: 'search_analyzer' },
                         code: { type: 'keyword' },
                         city: { type: 'text', analyzer: 'autocomplete_analyzer', search_analyzer: 'search_analyzer' },
                         suggest: { type: 'completion' },
                    },
               },
          });
          logger.info('Station index created');
     }

     // ── Train index ──
     const trainExists = await esClient.indices.exists({ index: TRAIN_INDEX });
     if (!trainExists) {
          await esClient.indices.create({
               index: TRAIN_INDEX,
               mappings: {
                    properties: {
                         trainId: { type: 'keyword' },
                         trainNumber: { type: 'keyword' },
                         trainName: { type: 'text' },
                         route: {
                              type: 'nested',
                              properties: {
                                   stationId: { type: 'keyword' },
                                   stationName: { type: 'text' },
                                   stationCode: { type: 'keyword' },
                                   sequenceNumber: { type: 'integer' },
                                   arrivalTime: { type: 'keyword' },
                                   departureTime: { type: 'keyword' },
                                   distanceFromOrigin: { type: 'float' },
                              },
                         },
                         schedules: {
                              type: 'nested',
                              properties: {
                                   scheduleId: { type: 'keyword' },
                                   departureDate: { type: 'date' },
                                   status: { type: 'keyword' },
                                   available: { type: 'integer' },
                                   locked: { type: 'integer' },
                                   booked: { type: 'integer' },
                              },
                         },
                         seatSummary: {
                              properties: {
                                   total: { type: 'integer' },
                                   LOWER: { type: 'integer' },
                                   MIDDLE: { type: 'integer' },
                                   UPPER: { type: 'integer' },
                                   SIDE_LOWER: { type: 'integer' },
                                   SIDE_UPPER: { type: 'integer' },
                              },
                         },
                    },
               },
          });
          logger.info('Train index created');
     }
};

const recreateIndices = async () => {
     for (const index of [STATION_INDEX, TRAIN_INDEX]) {
          const exists = await esClient.indices.exists({ index });
          if (exists) {
               await esClient.indices.delete({ index });
               logger.info(`Deleted index: ${index}`);
          }
     }
     await initIndices();
     logger.info('All indices recreated');
};

module.exports = { esClient, STATION_INDEX, TRAIN_INDEX, ROUTE_INDEX, SCHEDULE_INDEX, initIndices, recreateIndices };