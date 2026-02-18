const { NotFoundError } = require('../utils/error');

function notFound(req, res, next) {
  next(new NotFoundError(`Route ${req.method} ${req.path} not found`));
}

module.exports = { notFound };