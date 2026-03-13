const config = {
     SERVICE_NAME: require('../../package.json').name,
     PORT: Number(process.env.PORT) || 4002,
     NODE_ENV: process.env.NODE_ENV || "development",
     LOG_LEVEL: process.env.LOG_LEVEL || "info",
     ELASTICSEARCH_URL: process.env.ELASTICSEARCH_URL,
     KAFKA_BROKER: process.env.KAFKA_BROKER,
     KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID,
     ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
}

module.exports = { config };