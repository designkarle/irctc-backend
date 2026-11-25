require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const logger = require('./config/logger');
const { config } = require('./config');
const cookieParser = require('cookie-parser');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const errorHandler = require('./middlewares/error.middleware');
const { reqLogger } = require('./middlewares/req.middleware');
const { disconnectProducer, disconnectConsumer } = require('./config/kafka');
const { RedisClient } = require('./config/redis');
const { installGracefulShutdown, closeHttpServer } = require('../../shared/utils/gracefulShutdown');

const prisma = require('./config/prisma');
const outbox = require('./utils/outbox');
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
          outbox.startRelay();

          const server = app.listen(config.PORT, () => {
               logger.info(
                    `${config.SERVICE_NAME} is running on port ${config.PORT}`
               );
          });

          // B7: ordered teardown. The old version nested Kafka disconnect inside the
          // server.close callback, so one lingering keep-alive connection meant the
          // consumer was never drained and in-flight messages were abandoned with
          // their offsets possibly already auto-committed.
          installGracefulShutdown({
               logger,
               steps: [
                    // 1. Stop taking new HTTP work.
                    { name: 'http server', fn: () => closeHttpServer(server, logger) },

                    // 2. Stop consuming and let in-flight handlers finish. This must
                    //    happen before the producer goes away — handlers publish.
                    { name: 'kafka consumer drain', fn: () => disconnectConsumer() },

                    // 3. Stop the expiry/recovery job and await its running cycle, so we
                    //    never exit mid-compensation.
                    { name: 'expiry job', fn: () => stopBookingExpiryJob() },

                    // 4. Flush queued events rather than leaving them for another instance.
                    { name: 'outbox drain', fn: () => outbox.stopRelay() },

                    // 5. Now nothing can publish any more.
                    { name: 'kafka producer', fn: () => disconnectProducer() },

                    // 6. Release backing connections.
                    { name: 'prisma', fn: () => prisma.$disconnect() },
                    { name: 'redis', fn: () => RedisClient.closeConnection() },
               ],
          });

     } catch (error) {
          logger.error('Failed to start server', error);
          process.exit(1);
     }
};

startServer();

module.exports = app;
