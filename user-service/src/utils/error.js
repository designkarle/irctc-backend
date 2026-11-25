class AppError extends Error {
     constructor(message, statusCode, code) {
          super(message);
          this.statusCode = statusCode;
          this.code = code; // custom error code
          Error.captureStackTrace(this, this.constructor);
     }
}

class BadRequestError extends AppError {
     constructor(message, code = 'BAD_REQUEST') {
          super(message, 400, code);
     }
}

class UnauthorizedError extends AppError {
     constructor(message, code = 'UNAUTHORIZED') {
          super(message, 401, code);
     }
}

class ForbiddenError extends AppError {
     constructor(message, code = 'FORBIDDEN') {
          super(message, 403, code);
     }
}

class NotFoundError extends AppError {
     constructor(message, code = 'NOT_FOUND') {
          super(message, 404, code);
     }
}

class ConflictError extends AppError {
     constructor(message, code = 'CONFLICT') {
          super(message, 409, code);
     }
}

class TooManyRequestsError extends AppError {
     constructor(message, code = 'TOO_MANY_REQUESTS') {
          super(message, 429, code);
     }
}

/**
 * A backing store this operation genuinely requires is unreachable.
 * Distinct from InternalServerError: the request was well-formed and the service
 * is fine — a dependency is down, and retrying shortly is the right response.
 */
class ServiceUnavailableError extends AppError {
     constructor(message = 'Service temporarily unavailable', code = 'SERVICE_UNAVAILABLE') {
          super(message, 503, code);
     }
}

class InternalServerError extends AppError {
     constructor(message = 'Internal Server Error', code = 'SERVER_ERROR') {
          super(message, 500, code);
     }
}

module.exports = {
     AppError,
     BadRequestError,
     UnauthorizedError,
     ForbiddenError,
     NotFoundError,
     ConflictError,
     TooManyRequestsError,
     ServiceUnavailableError,
     InternalServerError
};
