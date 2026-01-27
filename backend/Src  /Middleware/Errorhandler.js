/**
 * Global error handler middleware
 */

const { systemLogger } = require('../utils/logger');
const { Prisma } = require('@prisma/client');

class AppError extends Error {
  constructor(message, statusCode = 500, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor(errors, message = 'Validation failed') {
    super(message, 400);
    this.errors = errors;
  }
}

class AuthenticationError extends AppError {
  constructor(message = 'Authentication required') {
    super(message, 401);
  }
}

class AuthorizationError extends AppError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
  }
}

class NotFoundError extends AppError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404);
  }
}

class RateLimitError extends AppError {
  constructor(message = 'Too many requests') {
    super(message, 429);
  }
}

const errorHandler = (err, req, res, next) => {
  // Set default values
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';
  err.message = err.message || 'Something went wrong!';

  // Log error
  const logData = {
    requestId: req.id,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userId: req.user?.id,
    error: err.message,
    stack: err.stack,
    statusCode: err.statusCode,
    isOperational: err.isOperational
  };

  // Prisma specific errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // Handle known Prisma errors
    switch (err.code) {
      case 'P2002':
        err = new AppError('Duplicate field value entered', 400);
        break;
      case 'P2014':
        err = new AppError('Invalid ID', 400);
        break;
      case 'P2003':
        err = new AppError('Foreign key constraint failed', 400);
        break;
      case 'P2025':
        err = new NotFoundError('Record');
        break;
      default:
        err = new AppError('Database error', 500);
    }
    logData.prismaCode = err.code;
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    err = new AuthenticationError('Invalid token');
  }
  
  if (err.name === 'TokenExpiredError') {
    err = new AuthenticationError('Token expired');
  }

  // Mongoose validation error (if using MongoDB)
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(el => el.message);
    err = new ValidationError(errors, 'Validation failed');
  }

  // Rate limit error
  if (err.name === 'RateLimitError') {
    err = new RateLimitError(err.message);
  }

  // Log based on error type
  if (err.statusCode >= 500) {
    systemLogger.error('Server error', logData);
  } else if (err.statusCode >= 400) {
    systemLogger.warn('Client error', logData);
  }

  // Development vs Production error response
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const errorResponse = {
    status: err.status,
    message: err.message,
    requestId: req.id,
    timestamp: new Date().toISOString()
  };

  // Add error details in development
  if (isDevelopment) {
    errorResponse.error = err;
    errorResponse.stack = err.stack;
  }

  // Add validation errors if present
  if (err.errors) {
    errorResponse.errors = err.errors;
  }

  // Add retry-after for rate limiting
  if (err.statusCode === 429) {
    const retryAfter = req.rateLimit?.resetTime 
      ? Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
      : 900; // 15 minutes default
    res.setHeader('Retry-After', retryAfter);
    errorResponse.retryAfter = retryAfter;
  }

  // Send error response
  res.status(err.statusCode).json(errorResponse);
};

module.exports = {
  errorHandler,
  AppError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  RateLimitError
};
