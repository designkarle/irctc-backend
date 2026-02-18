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
const routes = require('./routes');
const app = express();


app.use(corsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false,
}));
app.use(reqLogger);

app.use(express.json({ limit: '10mb' }));
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

const gracefulShutdown = () => {
     logger.info('Received shutdown signal, closing server gracefully...');
     server.close(() => {
          logger.info('Server closed');
          process.exit(0);
     });

     setTimeout(() => {
          logger.error('Forced shutdown after timeout');
          process.exit(1);
     }, 30000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

const server = app.listen(config.PORT, () => {
     logger.info(`🚀 API Gateway running on port ${config.PORT} in ${config.NODE_ENV} mode`);
});

process.on('unhandledRejection', (err) => {
     logger.error('Unhandled Rejection:', err);
     server.close(() => process.exit(1));
});

module.exports = app;