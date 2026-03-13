require('dotenv').config();
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { config } = require('./config');
const logger = require('./config/logger');
const { initIndices, recreateIndices } = require('./config/elasticsearch');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const errorHandler = require('./middlewares/error.middleware');
const { reqLogger } = require('./middlewares/req.middleware');

const searchRoutes = require('./routes/search.route');
const searchConsumer = require('./kafka/consumer/search.consumer');
const { disconnectAll } = require('./config/kafka');

const app = express();

app.use(corsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false,
     contentSecurityPolicy: {
          directives: {
               defaultSrc: ["'self'"],
               scriptSrc: ["'self'", "'unsafe-inline'"],
               styleSrc: ["'self'", "'unsafe-inline'"],
               imgSrc: ["'self'", "data:"],
               connectSrc: ["'self'"],
          },
     },
}));
app.use(reqLogger);
app.use(express.json());
app.use(cookieParser());

// Serve frontend static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Mount search routes at root (gateway strips first path segment)
app.use(searchRoutes);

app.get('/health', (req, res) => res.json({ status: 'ok', service: config.SERVICE_NAME }));
app.use(errorHandler);

const startServer = async () => {
     if (process.env.ES_RECREATE_INDICES === 'true') {
          await recreateIndices();
     } else {
          await initIndices();
     }
     await searchConsumer.start();

     const server = app.listen(config.PORT, () => {
          logger.info(`${config.SERVICE_NAME} running on http://localhost:${config.PORT}`);
     });

     const shutdown = async () => {
          logger.info('Shutting down...');
          server.close(async () => {
               await disconnectAll();
               process.exit(0);
          });
     };
     process.on('SIGTERM', shutdown);
     process.on('SIGINT', shutdown);
};

startServer();
