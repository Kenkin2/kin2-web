const { Prisma } = require('@prisma/client');

const errorHandler = (err, req, res, next) => {
  console.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.userId,
    timestamp: new Date().toISOString()
  });

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return res.status(409).json({
          error: 'Duplicate entry',
          fields: err.meta?.target,
          message: 'A record with this value already exists'
        });
      case 'P2003':
        return res.status(400).json({
          error: 'Foreign key constraint failed',
          field: err.meta?.field_name,
          message: 'Referenced record does not exist'
        });
      case 'P2025':
        return res.status(404).json({
          error: 'Record not found',
          message: err.meta?.cause || 'The requested record was not found'
        });
      default:
        return res.status(400).json({
          error: 'Database error',
          code: err.code,
          message: 'An error occurred while processing your request'
        });
    }
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      error: 'Invalid token',
      message: 'The provided token is invalid'
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Token expired',
      message: 'The provided token has expired'
    });
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.details || err.errors
    });
  }

  // Multer errors (file upload)
  if (err.name === 'MulterError') {
    switch (err.code) {
      case 'LIMIT_FILE_SIZE':
        return res.status(400).json({
          error: 'File too large',
          message: `File size must be less than ${err.limit / (1024 * 1024)}MB`
        });
      case 'LIMIT_FILE_COUNT':
        return res.status(400).json({
          error: 'Too many files',
          message: `Maximum ${err.limit} files allowed`
        });
      case 'LIMIT_UNEXPECTED_FILE':
        return res.status(400).json({
          error: 'Unexpected file field',
          message: `Unexpected field: ${err.field}`
        });
      default:
        return res.status(400).json({
          error: 'File upload error',
          message: err.message
        });
    }
  }

  // Custom API errors
  if (err.isApiError) {
    return res.status(err.statusCode).json({
      error: err.name,
      message: err.message,
      ...(err.details && { details: err.details })
    });
  }

  // Default error
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'An unexpected error occurred'
    : err.message;

  res.status(statusCode).json({
    error: 'Internal server error',
    message,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      type: err.name
    })
  });
};

// 404 handler
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    error: 'Not found',
    message: `Cannot ${req.method} ${req.originalUrl}`,
    timestamp: new Date().toISOString()
  });
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Custom error class
class ApiError extends Error {
  constructor(name, message, statusCode = 500, details = null) {
    super(message);
    this.name = name;
    this.statusCode = statusCode;
    this.details = details;
    this.isApiError = true;
  }
}

class ValidationError extends ApiError {
  constructor(message, details = null) {
    super('ValidationError', message, 400, details);
  }
}

class AuthenticationError extends ApiError {
  constructor(message = 'Authentication required') {
    super('AuthenticationError', message, 401);
  }
}

class AuthorizationError extends ApiError {
  constructor(message = 'Insufficient permissions') {
    super('AuthorizationError', message, 403);
  }
}

class NotFoundError extends ApiError {
  constructor(resource = 'Resource') {
    super('NotFoundError', `${resource} not found`, 404);
  }
}

class ConflictError extends ApiError {
  constructor(message = 'Resource already exists') {
    super('ConflictError', message, 409);
  }
}

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  ApiError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError
};
