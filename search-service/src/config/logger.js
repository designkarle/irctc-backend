const winston = require('winston');
const { config } = require('./index');

const logFormat = winston.format.combine(
     winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
     winston.format.errors({ stack: true }),
     winston.format.splat(),
     winston.format.json()
);

const logger = winston.createLogger({
     level: config.NODE_ENV === 'production' ? 'info' : 'debug',
     format: logFormat,
     defaultMeta: { service: config.SERVICE_NAME },
     transports: [
          new winston.transports.Console({
               format: winston.format.combine(
                    winston.format.colorize(),
                    winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
                         let msg = `${timestamp} [${service}] ${level}: ${message}`;
                         if (Object.keys(meta).length > 0) {
                              msg += ` ${JSON.stringify(meta)}`;
                         }
                         return msg;
                    })
               )
          }),
          new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
          new winston.transports.File({ filename: 'logs/combined.log' })
     ]
});

module.exports = logger;