const config = {
     SERVICE_NAME: require('../../package.json').name,
     PORT: Number(process.env.PORT) || 4004,
     NODE_ENV: process.env.NODE_ENV || "development",
     LOG_LEVEL: process.env.LOG_LEVEL || "info",
     ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
     SENDGRID_API_KEY: process.env.SENDGRID_API_KEY,
     KAFKA_BROKER: process.env.KAFKA_BROKER,
     KAFKA_CLIENT_ID: process.env.KAFKA_CLIENT_ID,
     MAIL_SEND: process.env.MAIL_SEND,
     FRONTEND_URL: process.env.FRONTEND_URL
}
module.exports = { config };