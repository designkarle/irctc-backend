require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const logger = require('./config/logger');
const { config } = require('./config');
const cookieParser = require('cookie-parser');
// Routes
const stationRoutes = require('./routes/station.route');
const trainRoutes = require('./routes/train.route');
const scheduleRoutes = require('./routes/schedule.route');

// Middlewares
const { corsMiddleware } = require('./middlewares/cors.middleware');
const errorHandler = require('./middlewares/error.middleware');
const { reqLogger } = require('./middlewares/req.middleware');
const { disconnectProducer } = require('./config/kafka');
const { installGracefulShutdown, closeHttpServer } = require('../../shared/utils/gracefulShutdown');
const prisma = require('./config/prisma');

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

// Request logging
app.use((req, res, next) => {
     logger.info(`${req.method} ${req.path}`, {
          ip: req.ip,
          userAgent: req.get('user-agent')
     });
     next();
});

app.get("/", (req, res) => {
     res.send("Hello from index.js of admin-service");
})

// Health check
app.get('/health', (req, res) => {
     res.status(200).json({
          success: true,
          message: 'Admin Service is healthy',
          timestamp: new Date().toISOString()
     });
});

// API Routes - All protected by auth middleware
app.use("/stations", stationRoutes);
app.use("/trains", trainRoutes);
app.use("/schedules", scheduleRoutes);

// Error handler (must be last)
app.use(errorHandler);

const startServer = async () => {
     try {
          const server = app.listen(config.PORT, () => {
               logger.info(
                    `${config.SERVICE_NAME} is running on port ${config.PORT}`
               );
          });

          // B7: ordered teardown instead of nesting everything inside server.close.
          installGracefulShutdown({
               logger,
               steps: [
                    { name: 'http server', fn: () => closeHttpServer(server, logger) },
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