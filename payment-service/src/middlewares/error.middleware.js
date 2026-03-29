const { AppError } = require('../utils/error');
const { config } = require('../config');
const logger = require('../config/logger');

module.exports = (err, req, res, next) => {
     if (err instanceof AppError) {
          return res.status(err.statusCode).json({
               success: false,
               error: err.code,
               message: err.message
          });
     }

     const errMsg = err.message || (typeof err === 'object' ? JSON.stringify(err) : String(err));
     console.error("UNHANDLED ERROR:", errMsg, err.stack || '');

     if(config.NODE_ENV !== "production"){
          logger.error(`${errMsg} | ${req.method} ${req.path}`, {
               stack: err.stack,
               body: req.body,
               query: req.query
          });
     }
     return res.status(500).json({
          success: false,
          error: "SERVER_ERROR",
          message: "Internal Server Error"
     });
};
