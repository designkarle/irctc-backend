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

const prisma = require('./config/prisma');
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

          const server = app.listen(config.PORT, () => {
               logger.info(
                    `${config.SERVICE_NAME} is running on port ${config.PORT}`
               );
          });

          // Graceful shutdown
          const shutdown = async () => {
               logger.info('Shutting down gracefully...');
               stopLockExpiryJob();

               server.close(async () => {
                    await disconnectAll();
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
