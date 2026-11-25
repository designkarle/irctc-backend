const config = {
     PORT: Number(process.env.PORT) || 4007,
     SERVICE_NAME: require('../../package.json').name,
     NODE_ENV: process.env.NODE_ENV || 'development',
     LOG_LEVEL: process.env.LOG_LEVEL || 'info',
     KAFKA_BROKER: process.env.KAFKA_BROKER,
     KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID,
     DATABASE_URL: process.env.DATABASE_URL,
     ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
     LOCK_TTL_SECONDS: parseInt(process.env.LOCK_TTL_SECONDS || '300', 10),
     LOCK_EXPIRY_INTERVAL_MS: parseInt(process.env.LOCK_EXPIRY_INTERVAL_MS || '60000', 10),
     INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,

     // ─── Database connection pool (B5) ───────────────────────────────────────
     // PER PROCESS. Keep (max x instances x services) < postgres max_connections.
     DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX || '10', 10),
     DB_CONNECTION_TIMEOUT_MS: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
     DB_IDLE_TIMEOUT_MS: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
     DB_STATEMENT_TIMEOUT_MS: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000', 10),
}

module.exports = { config };
