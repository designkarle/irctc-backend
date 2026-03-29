require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const logger = require('./config/logger');
const { config } = require('./config');
const cookieParser = require('cookie-parser');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const errorHandler = require('./middlewares/error.middleware');
const { reqLogger } = require('./middlewares/req.middleware');
const { disconnectAll } = require('./config/kafka');
const { RedisClient } = require('./config/redis');

const prisma = require('./config/prisma');
const bookingRoutes = require('./routes/booking.route');
const bookingConsumer = require('./kafka/consumer/booking.consumer');
const { startBookingExpiryJob, stopBookingExpiryJob } = require('./utils/bookingExpiry');

const app = express();

app.use(corsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false
}));
app.use(reqLogger);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.get("/", (req, res) => {
     res.send("Hello from booking-service");
})

// Health check (includes Redis + PostgreSQL)
app.get('/health', async (req, res) => {
     let dbHealthy = false;
     try {
          await prisma.$queryRaw`SELECT 1`;
          dbHealthy = true;
     } catch (e) {
          logger.error('Health check: DB unreachable', { error: e.message });
     }

     const redisHealthy = RedisClient.isReady();
     const healthy = dbHealthy && redisHealthy;

     res.status(healthy ? 200 : 503).json({
          success: healthy,
          message: healthy ? 'Booking Service is healthy' : 'Booking Service is degraded',
          redis: redisHealthy,
          database: dbHealthy,
          timestamp: new Date().toISOString(),
     });
});

// API Routes
app.use(bookingRoutes);

// Error handler (must be last)
app.use(errorHandler);

const startServer = async () => {
     try {
          await bookingConsumer.start();
          startBookingExpiryJob();

          const server = app.listen(config.PORT, () => {
               logger.info(
                    `${config.SERVICE_NAME} is running on port ${config.PORT}`
               );
          });

          // Graceful shutdown
          const shutdown = async () => {
               logger.info('Shutting down gracefully...');
               stopBookingExpiryJob();

               server.close(async () => {
                    await disconnectAll();
                    await RedisClient.closeConnection();
                    logger.info('Server closed');
                    process.exit(0);
               });
          };

          process.on('SIGTERM', shutdown);
          process.on('SIGINT', shutdown);

     } catch (error) {
          logger.error('Failed to start server', error);
          process.exit(1);
     }
};

startServer();

module.exports = app;
