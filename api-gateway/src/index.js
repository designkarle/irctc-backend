require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const { config } = require('./config');
const logger = require('./config/logger');
const errorHandler = require('./middlewares/error.middleware');
const { notFound } = require('./middlewares/notFound.middleware');
const { reqLogger } = require('./middlewares/req.middleware');
const { corsMiddleware } = require('./middlewares/cors.middleware');
const { installGracefulShutdown, closeHttpServer } = require('../../shared/utils/gracefulShutdown');
const { RedisClient } = require('./config/redis');
const routes = require('./routes');
const app = express();


app.use(corsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false,
}));
app.use(reqLogger);

// Skip JSON parsing for Razorpay webhook — signature verification needs raw bytes
app.use((req, res, next) => {
     if (req.path === '/api/payments/webhooks/razorpay') {
          return express.raw({ type: 'application/json', limit: '10mb' })(req, res, next);
     }
     express.json({ limit: '10mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

if (config.NODE_ENV === 'development') {
     app.use(morgan('dev'));
}

app.get('/health', (req, res) => {
     res.status(200).json({
          success: true,
          message: 'API Gateway is running',
          timestamp: new Date().toISOString(),
          environment: config.NODE_ENV,
     });
});

app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.PORT, () => {
     logger.info(`🚀 API Gateway running on port ${config.PORT} in ${config.NODE_ENV} mode`);
});

// B7: the old handler could hang forever on a keep-alive connection, since
// server.close() waits for every socket to close on its own.
installGracefulShutdown({
     logger,
     steps: [
          { name: 'http server', fn: () => closeHttpServer(server, logger) },
          { name: 'redis', fn: () => RedisClient.closeConnection() },
     ],
});

process.on('unhandledRejection', (err) => {
     // This used to call server.close() + process.exit(1), taking down the SINGLE
     // entrypoint to the entire system over one stray rejection — and the async
     // middleware in the proxy and rate-limiter paths makes those entirely possible.
     // An unhandled rejection is a bug to fix, not a reason to drop all traffic.
     logger.error('Unhandled Rejection — continuing', {
          error: err?.message,
          stack: err?.stack,
     });
});

process.on('uncaughtException', (err) => {
     // An uncaught exception genuinely leaves the process in an unknown state, so
     // here exiting IS correct — but go through the graceful path so in-flight
     // requests get a chance to finish.
     logger.error('Uncaught Exception — shutting down', {
          error: err?.message,
          stack: err?.stack,
     });
     process.kill(process.pid, 'SIGTERM');
});

module.exports = app;