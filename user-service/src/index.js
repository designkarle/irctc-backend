require('dotenv').config();
const express = require('express');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const { config } = require('./config');
const logger = require('./config/logger');

const authRoutes = require('./routes/auth.route');
const userRoutes = require('./routes/user.route');

const { corsMiddleware } = require('./middlewares/cors.middleware');
const errorHandler = require('./middlewares/error.middleware');
const { reqLogger } = require('./middlewares/req.middleware');

const app = express();

app.use(corsMiddleware);
app.use(helmet({
     crossOriginOpenerPolicy: false,
     crossOriginEmbedderPolicy: false,
}));
app.use(reqLogger);
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/user", userRoutes);

app.get("/", (req, res) => {
     res.send("Hello from index.js of user-service")
})

app.get("/health", (req, res) => {
     res.status(200).json({
          message: "ok"
     })
})

app.use(errorHandler)

const startServer = async () => {
     try {
          const server = app.listen(config.PORT, () => {
               logger.info(
                    `${config.SERVICE_NAME} is running on http://localhost:${config.PORT}`
               );
          })
     } catch (error) {
          logger.error("Failed to Start Server", error);
          process.exit(1);
     }
}
startServer();