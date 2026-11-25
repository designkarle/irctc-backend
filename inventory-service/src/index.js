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
const { installGracefulShutdown, closeHttpServer } = require('../../shared/utils/gracefulShutdown');

const prisma = require('./config/prisma');
const outbox = require('./utils/outbox');
const inventoryRoutes = require('./routes/inventory.route');
const inventoryConsumer = require('./kafka/consumer/inventory.consumer');
const { startLockExpiryJob, stopLockExpiryJob } = require('./utils/lockExpiry');

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
     res.send("Hello from inventory-service");
})

// Health check 
app.get('/health', async (req, res) => {
     let dbHealthy = false;
     try {
          await prisma.$queryRaw`SELECT 1`;
          dbHealthy = true;
     } catch (e) {
          logger.error('Health check: DB unreachable', { error: e.message });
     }

     res.status(dbHealthy ? 200 : 503).json({
          success: dbHealthy,
          message: dbHealthy ? 'Inventory Service is healthy' : 'Inventory Service is degraded',
          database: dbHealthy,
          timestamp: new Date().toISOString(),
     });
});

// API Routes
app.use(inventoryRoutes);

// Error handler
app.use(errorHandler);

const startServer = async () => {
     try {
          await inventoryConsumer.start();
          startLockExpiryJob();
          outbox.startRelay();

          const server = app.listen(config.PORT, () => {
               logger.info(
                    `${config.SERVICE_NAME} is running on port ${config.PORT}`
               );
          });

          // B7: see shared/utils/gracefulShutdown.js for why the order matters.
          installGracefulShutdown({
               logger,
               steps: [
                    { name: 'http server', fn: () => closeHttpServer(server, logger) },
                    { name: 'kafka consumer drain', fn: () => disconnectConsumer() },

                    // Awaits the running cycle: exiting mid-sweep could leave segment
                    // locks deleted but seat statuses not yet recomputed.
                    { name: 'lock expiry job', fn: () => stopLockExpiryJob() },

                    { name: 'outbox drain', fn: () => outbox.stopRelay() },
                    { name: 'kafka producer', fn: () => disconnectProducer() },
                    { name: 'prisma', fn: () => prisma.$disconnect() },
               ],
          });

     } catch (error) {
          logger.error('Failed to start server', error);
          process.exit(1);
     }
};

startServer();

module.exports = app;
