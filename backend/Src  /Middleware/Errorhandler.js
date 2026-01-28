/**
 * Comprehensive Error Handling Middleware
 * Integrates with existing logging system
 */

const { createLogger } = require('../utils/logger');
const { AppError } = require('../utils/AppError');

// Initialize error logger
const errorLogger = createLogger({
  module: 'error-handler',
  environment: process.env.NODE_ENV,
  redactFields: [
    'password',
    'token',
    'secret',
    'authorization',
    'creditCard',
    'ssn',
    'apiKey',
    'privateKey',
  ],
});

/**
 * Global Error Handler Middleware
 */
const errorHandler = (err, req, res, next) => {
  // Set default error values
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';
  err.timestamp = new Date().toISOString();
  
  // Generate error ID for tracking
  const errorId = req.errorId || req.requestId || require('crypto').randomUUID();
  
  // Log the error with context
  logErrorWithContext(err, req, errorId);
  
  // Handle different environments
  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res, errorId);
  } else {
    sendErrorProd(err, req, res, errorId);
  }
};

/**
 * Log error with comprehensive context
 */
const logErrorWithContext = (err, req, errorId) => {
  const errorContext = {
    errorId,
    requestId: req.requestId,
    correlationId: req.correlationId,
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    service: 'job-portal-api',
    
    // Error details
    error: {
      name: err.name,
      message: err.message,
      code: err.code,
      statusCode: err.statusCode,
      stack: err.stack,
      isOperational: err.isOperational,
    },
    
    // Request context
    request: {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referer: req.get('referer'),
      query: redactSensitiveData(req.query),
      params: req.params,
      body: redactSensitiveData(req.body),
    },
    
    // User context
    user: req.user ? {
      id: req.user.id,
      role: req.user.role,
      email: maskEmail(req.user.email),
    } : null,
    
    // Performance context
    performance: {
      responseTime: req.responseTime,
      startTime: req._startTime,
    },
  };
  
  // Log based on error type
  if (err.statusCode >= 500) {
    errorLogger.error(`Server Error [${errorId}]`, errorContext);
    
    // Critical errors - notify admins
    if (process.env.NODE_ENV === 'production') {
      notifyCriticalError(err, errorContext);
    }
  } else if (err.statusCode >= 400) {
    errorLogger.warn(`Client Error [${errorId}]`, errorContext);
  } else {
    errorLogger.info(`Error [${errorId}]`, errorContext);
  }
  
  // Audit log for security-related errors
  if (isSecurityError(err)) {
    logSecurityError(err, errorContext);
  }
};

/**
 * Send error response for development
 */
const sendErrorDev = (err, req, res, errorId) => {
  const response = {
    success: false,
    errorId,
    requestId: req.requestId,
    timestamp: err.timestamp,
    status: err.status,
    statusCode: err.statusCode,
    message: err.message,
    error: {
      name: err.name,
      code: err.code,
      stack: err.stack,
    },
    ...(err.errors && { validationErrors: err.errors }),
    ...(err.metadata && { metadata: err.metadata }),
  };
  
  res.status(err.statusCode).json(response);
};

/**
 * Send error response for production
 */
const sendErrorProd = (err, req, res, errorId) => {
  // Operational, trusted error
  if (err.isOperational) {
    const response = {
      success: false,
      errorId,
      requestId: req.requestId,
      timestamp: err.timestamp,
      status: err.status,
      statusCode: err.statusCode,
      message: err.message,
      ...(err.errors && { validationErrors: err.errors }),
    };
    
    res.status(err.statusCode).json(response);
  } 
  // Programming or unknown error
  else {
    // Log the unknown error for debugging
    errorLogger.error(`Unknown Error [${errorId}]`, {
      message: err.message,
      stack: err.stack,
      requestId: req.requestId,
    });
    
    const response = {
      success: false,
      errorId,
      requestId: req.requestId,
      timestamp: new Date().toISOString(),
      status: 'error',
      statusCode: 500,
      message: 'An unexpected error occurred. Please try again later.',
      supportCode: generateSupportCode(errorId),
    };
    
    res.status(500).json(response);
  }
};

/**
 * Custom Error Classes for Job Portal
 */
class JobPortalError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;
    this.timestamp = new Date().toISOString();
    
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends JobPortalError {
  constructor(message, errors = []) {
    super(message || 'Validation failed', 400);
    this.errors = errors;
    this.code = 'VALIDATION_ERROR';
  }
}

class AuthenticationError extends JobPortalError {
  constructor(message = 'Authentication required') {
    super(message, 401);
    this.code = 'AUTHENTICATION_ERROR';
  }
}

class AuthorizationError extends JobPortalError {
  constructor(message = 'Insufficient permissions') {
    super(message, 403);
    this.code = 'AUTHORIZATION_ERROR';
  }
}

class NotFoundError extends JobPortalError {
  constructor(resource = 'Resource', id = null) {
    super(id ? `${resource} with ID "${id}" not found` : `${resource} not found`, 404);
    this.code = 'NOT_FOUND_ERROR';
    this.resource = resource;
    this.id = id;
  }
}

class ConflictError extends JobPortalError {
  constructor(message = 'Resource already exists', conflictData = {}) {
    super(message, 409);
    this.code = 'CONFLICT_ERROR';
    this.conflictData = conflictData;
  }
}

class RateLimitError extends JobPortalError {
  constructor(message = 'Too many requests', retryAfter = null) {
    super(message, 429);
    this.code = 'RATE_LIMIT_ERROR';
    this.retryAfter = retryAfter;
    this.headers = retryAfter ? { 'Retry-After': retryAfter } : {};
  }
}

class PaymentError extends JobPortalError {
  constructor(message, gateway = 'unknown', transactionId = null) {
    super(message, 402);
    this.code = 'PAYMENT_ERROR';
    this.gateway = gateway;
    this.transactionId = transactionId;
  }
}

class ExternalServiceError extends JobPortalError {
  constructor(service, message = 'Service unavailable', originalError = null) {
    super(`${service}: ${message}`, 502);
    this.code = 'EXTERNAL_SERVICE_ERROR';
    this.service = service;
    this.originalError = originalError;
  }
}

class DatabaseError extends JobPortalError {
  constructor(message, operation = 'unknown', query = null) {
    super(message, 500);
    this.code = 'DATABASE_ERROR';
    this.operation = operation;
    this.query = query;
    this.isOperational = false; // Database errors are usually programming errors
  }
}

/**
 * Async Handler Wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    // Enhance error with request context
    error.requestId = req.requestId;
    error.correlationId = req.correlationId;
    error.path = req.path;
    error.method = req.method;
    error.userId = req.user?.id;
    
    next(error);
  });
};

/**
 * Handle specific error types from libraries
 */
const handleErrorType = (error) => {
  // MongoDB/Mongoose errors
  if (error.name === 'CastError') {
    return new ValidationError(`Invalid ID format: ${error.value}`);
  }
  
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(err => ({
      field: err.path,
      message: err.message,
      value: err.value,
    }));
    return new ValidationError('Validation failed', errors);
  }
  
  if (error.code === 11000) {
    const field = Object.keys(error.keyPattern)[0];
    const value = error.keyValue[field];
    return new ConflictError(`${field} "${value}" already exists`);
  }
  
  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return new AuthenticationError('Invalid token');
  }
  
  if (error.name === 'TokenExpiredError') {
    return new AuthenticationError('Token expired');
  }
  
  // Multer file upload errors
  if (error.name === 'MulterError') {
    switch(error.code) {
      case 'LIMIT_FILE_SIZE':
        return new ValidationError('File size too large');
      case 'LIMIT_FILE_COUNT':
        return new ValidationError('Too many files');
      case 'LIMIT_UNEXPECTED_FILE':
        return new ValidationError('Unexpected file field');
      default:
        return new ValidationError('File upload error');
    }
  }
  
  // Stripe payment errors
  if (error.type === 'StripeCardError') {
    return new PaymentError(error.message, 'stripe', error.id);
  }
  
  if (error.type === 'StripeInvalidRequestError') {
    return new ValidationError('Invalid payment request');
  }
  
  // Axios/HTTP errors
  if (error.isAxiosError) {
    return new ExternalServiceError(
      error.config?.url || 'External API',
      error.response?.data?.message || error.message,
      error
    );
  }
  
  // Prisma errors
  if (error.code?.startsWith('P')) {
    return handlePrismaError(error);
  }
  
  // Return original error if no specific handler
  return error;
};

/**
 * Handle Prisma errors
 */
const handlePrismaError = (error) => {
  switch(error.code) {
    case 'P2002':
      return new ConflictError('Unique constraint violation', error.meta);
    case 'P2003':
      return new ValidationError('Foreign key constraint failed', error.meta);
    case 'P2025':
      return new NotFoundError('Record', error.meta?.target);
    default:
      return new DatabaseError('Database operation failed', 'prisma', error.meta);
  }
};

/**
 * Security error detection
 */
const isSecurityError = (error) => {
  const securityErrorCodes = [
    'AUTHENTICATION_ERROR',
    'AUTHORIZATION_ERROR',
    'RATE_LIMIT_ERROR',
    'VALIDATION_ERROR', // When it's input validation
  ];
  
  return securityErrorCodes.includes(error.code) ||
    error.statusCode === 401 ||
    error.statusCode === 403 ||
    error.statusCode === 429;
};

/**
 * Log security errors
 */
const logSecurityError = (err, context) => {
  const securityLogger = createLogger({
    module: 'security',
    environment: process.env.NODE_ENV,
  });
  
  securityLogger.security('security_event', {
    type: err.code || err.name,
    severity: err.statusCode >= 500 ? 'high' : 'medium',
    userId: context.user?.id,
    ip: context.request.ip,
    userAgent: context.request.userAgent,
    errorId: context.errorId,
    message: err.message,
    timestamp: new Date().toISOString(),
  });
};

/**
 * Notify critical errors
 */
const notifyCriticalError = (err, context) => {
  // Send to external monitoring (Sentry, DataDog, etc.)
  if (process.env.SENTRY_DSN) {
    // Sentry.captureException(err, { extra: context });
  }
  
  // Send email notification for critical errors
  if (process.env.ERROR_NOTIFICATION_EMAIL) {
    const criticalErrors = ['DATABASE_ERROR', 'EXTERNAL_SERVICE_ERROR'];
    if (criticalErrors.includes(err.code) || err.statusCode >= 500) {
      sendErrorNotificationEmail(err, context);
    }
  }
};

/**
 * Send error notification email
 */
const sendErrorNotificationEmail = async (err, context) => {
  // Implementation depends on your email service
  try {
    await require('./emailService').sendEmail({
      to: process.env.ERROR_NOTIFICATION_EMAIL,
      subject: `🚨 Critical Error: ${err.code || err.name}`,
      template: 'error-alert',
      data: {
        error: {
          message: err.message,
          code: err.code,
          statusCode: err.statusCode,
          timestamp: err.timestamp,
        },
        context: {
          errorId: context.errorId,
          requestId: context.requestId,
          url: context.request.url,
          method: context.request.method,
          userId: context.user?.id,
        },
        environment: process.env.NODE_ENV,
        time: new Date().toLocaleString(),
      },
    });
  } catch (emailError) {
    errorLogger.error('Failed to send error notification email', {
      error: emailError.message,
      originalErrorId: context.errorId,
    });
  }
};

/**
 * Redact sensitive data from objects
 */
const redactSensitiveData = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const redacted = { ...obj };
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'authorization',
    'creditCard',
    'ssn',
    'apiKey',
    'privateKey',
    'cvv',
    'expiry',
  ];
  
  sensitiveFields.forEach(field => {
    if (redacted[field]) {
      redacted[field] = '[REDACTED]';
    }
  });
  
  // Recursively redact nested objects
  Object.keys(redacted).forEach(key => {
    if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactSensitiveData(redacted[key]);
    }
  });
  
  return redacted;
};

/**
 * Mask email address
 */
const maskEmail = (email) => {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return email;
  
  const maskedLocal = local.length <= 2 
    ? '*'.repeat(local.length)
    : local[0] + '*'.repeat(Math.min(3, local.length - 2)) + local.slice(-1);
  
  return `${maskedLocal}@${domain}`;
};

/**
 * Generate support code
 */
const generateSupportCode = (errorId) => {
  const prefix = 'SUP';
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

/**
 * 404 Not Found Handler
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(
    `Route ${req.method} ${req.originalUrl}`,
    req.originalUrl
  );
  error.requestId = req.requestId;
  error.correlationId = req.correlationId;
  next(error);
};

/**
 * Validation Middleware
 */
const validateRequest = (schema) => {
  return asyncHandler(async (req, res, next) => {
    try {
      // Use Joi, Yup, or your preferred validation library
      const validated = await schema.validateAsync(req.body, {
        abortEarly: false,
        stripUnknown: true,
      });
      
      req.validatedBody = validated;
      next();
    } catch (error) {
      if (error.isJoi) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type,
        }));
        
        throw new ValidationError('Validation failed', validationErrors);
      }
      throw error;
    }
  });
};

/**
 * Error Reporting Middleware
 */
const errorReportingMiddleware = (req, res, next) => {
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Track response time
  req._startTime = process.hrtime();
  
  res.send = function(body) {
    // Calculate response time
    const diff = process.hrtime(req._startTime);
    const responseTime = diff[0] * 1e3 + diff[1] * 1e-6;
    req.responseTime = responseTime;
    
    // Log slow responses
    if (responseTime > 1000) { // > 1 second
      errorLogger.warn('Slow response', {
        url: req.originalUrl,
        method: req.method,
        responseTime,
        statusCode: res.statusCode,
        requestId: req.requestId,
      });
    }
    
    return originalSend.call(this, body);
  };
  
  res.json = function(body) {
    // Calculate response time
    const diff = process.hrtime(req._startTime);
    const responseTime = diff[0] * 1e3 + diff[1] * 1e-6;
    req.responseTime = responseTime;
    
    // Add response time to JSON response if successful
    if (res.statusCode < 400 && body && typeof body === 'object') {
      body.responseTime = `${responseTime.toFixed(2)}ms`;
    }
    
    return originalJson.call(this, body);
  };
  
  next();
};

module.exports = {
  errorHandler,
  asyncHandler,
  notFoundHandler,
  validateRequest,
  errorReportingMiddleware,
  
  // Error Classes
  JobPortalError,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  RateLimitError,
  PaymentError,
  ExternalServiceError,
  DatabaseError,
  
  // Utility functions
  handleErrorType,
  redactSensitiveData,
  maskEmail,
};
