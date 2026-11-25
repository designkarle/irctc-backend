const config = {
     PORT: Number(process.env.PORT) || 4005,
     SERVICE_NAME: require('../../package.json').name,
     NODE_ENV: process.env.NODE_ENV || 'development',
     LOG_LEVEL: process.env.LOG_LEVEL || 'info',
     KAFKA_BROKER: process.env.KAFKA_BROKER,
     KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID || 'booking-service',
     DATABASE_URL: process.env.DATABASE_URL,
     ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
     REDIS_URL: process.env.REDIS_URL,

     // Inter-service communication
     INVENTORY_SERVICE_URL: process.env.INVENTORY_SERVICE_URL || 'http://localhost:4007',
     PAYMENT_SERVICE_URL: process.env.PAYMENT_SERVICE_URL || 'http://localhost:4006',
     USER_SERVICE_URL: process.env.USER_SERVICE_URL || 'http://localhost:4001',
     ADMIN_SERVICE_URL: process.env.ADMIN_SERVICE_URL || 'http://localhost:4003',
     INTERNAL_SERVICE_KEY: process.env.INTERNAL_SERVICE_KEY,

     // Booking TTL
     BOOKING_TTL_SECONDS: parseInt(process.env.BOOKING_TTL_SECONDS || '600', 10),
     LOCK_TTL_SECONDS: parseInt(process.env.LOCK_TTL_SECONDS || '600', 10),
     BOOKING_EXPIRY_CHECK_INTERVAL_MS: parseInt(process.env.BOOKING_EXPIRY_CHECK_INTERVAL_MS || '30000', 10),

     // How long a booking may sit in a transient state (CONFIRMING / CANCELLING)
     // before the sweeper assumes the owning process died and resumes the saga.
     // Must exceed a worst-case confirm — inventory call with retries — so we never
     // interfere with a request that is merely slow.
     STUCK_BOOKING_THRESHOLD_MS: parseInt(process.env.STUCK_BOOKING_THRESHOLD_MS || '120000', 10),

     // Max bookings processed per expiry tick. Bounds memory and cycle duration when
     // a backlog has built up; the next tick picks up where this one left off.
     EXPIRY_JOB_BATCH_SIZE: parseInt(process.env.EXPIRY_JOB_BATCH_SIZE || '500', 10),

     // ─── Database connection pool (B5) ───────────────────────────────────────
     // PER PROCESS. Keep (max x instances x services) < postgres max_connections.
     DB_POOL_MAX: parseInt(process.env.DB_POOL_MAX || '10', 10),
     DB_CONNECTION_TIMEOUT_MS: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '5000', 10),
     DB_IDLE_TIMEOUT_MS: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
     DB_STATEMENT_TIMEOUT_MS: parseInt(process.env.DB_STATEMENT_TIMEOUT_MS || '15000', 10),
}

module.exports = { config };
