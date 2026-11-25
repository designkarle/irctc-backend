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
const { installGracefulShutdown, closeHttpServer } = require('../../shared/utils/gracefulShutdown');

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

     // B7: Kafka teardown used to be nested inside the server.close callback, so a
     // lingering keep-alive connection meant the consumer was never drained. That
     // matters more here now that handlers rethrow (B6): an abandoned in-flight
     // message with a committed offset is a permanently missed index update.
     installGracefulShutdown({
          logger,
          steps: [
               { name: 'http server', fn: () => closeHttpServer(server, logger) },
               { name: 'kafka drain', fn: () => disconnectAll() },
          ],
     });
};

startServer();
