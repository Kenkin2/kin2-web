const winston = require('winston');
const { createLogger, format, transports } = winston;
const { combine, timestamp, printf, colorize, json } = format;

// Custom format for console output
const consoleFormat = printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level}]: ${message}`;
  
  if (metadata.userId) {
    msg += ` [User: ${metadata.userId}]`;
  }
  
  if (metadata.path) {
    msg += ` [Path: ${metadata.path}]`;
  }
  
  if (metadata.duration) {
    msg += ` [Duration: ${metadata.duration}ms]`;
  }
  
  if (Object.keys(metadata).length > 0) {
    // Don't include userId, path, duration again
    const { userId, path, duration, ...rest } = metadata;
    if (Object.keys(rest).length > 0) {
      msg += ` [Metadata: ${JSON.stringify(rest)}]`;
    }
  }
  
  return msg;
});

// Create logger instance
const logger = createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: combine(
    timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    json()
  ),
  transports: [
    // Console transport for development
    new transports.Console({
      format: combine(
        colorize(),
        consoleFormat
      )
    }),
    // File transport for errors
    new transports.File({
      filename: process.env.LOG_FILE_PATH || 'logs/error.log',
      level: 'error',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    }),
    // File transport for all logs
    new transports.File({
      filename: process.env.LOG_FILE_PATH || 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 5
    })
  ],
  exceptionHandlers: [
    new transports.File({
      filename: process.env.LOG_FILE_PATH || 'logs/exceptions.log'
    })
  ],
  rejectionHandlers: [
    new transports.File({
      filename: process.env.LOG_FILE_PATH || 'logs/rejections.log'
    })
  ]
});

// Request logging middleware
const requestLogger = (req, res, next) => {
  const startTime = Date.now();
  
  // Log request
  logger.info('Request received', {
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.userId,
    query: req.query,
    body: req.method === 'POST' || req.method === 'PUT' ? req.body : undefined
  });
  
  // Capture response
  const originalSend = res.send;
  res.send = function(body) {
    const duration = Date.now() - startTime;
    
    // Log response
    const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
    logger.log(logLevel, 'Response sent', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.userId,
      responseSize: body?.length || 0
    });
    
    originalSend.call(this, body);
  };
  
  next();
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
  logger.error('Unhandled error', {
    error: err.message,
    stack: err.stack,
    method: req.method,
    path: req.path,
    userId: req.userId,
    ip: req.ip,
    body: req.body
  });
  
  next(err);
};

// Audit logging middleware
const auditLogger = (action, resourceType, resourceId, details = {}) => {
  return async (req, res, next) => {
    try {
      if (req.userId) {
        // Log to database
        const { PrismaClient } = require('@prisma/client');
        const prisma = new PrismaClient();
        
        await prisma.auditLog.create({
          data: {
            userId: req.userId,
            action,
            resourceType,
            resourceId,
            oldData: details.oldData,
            newData: details.newData,
            changes: details.changes,
            ipAddress: req.ip,
            userAgent: req.get('User-Agent')
          }
        });
        
        await prisma.$disconnect();
      }
      
      // Also log to Winston
      logger.info('Audit log', {
        action,
        resourceType,
        resourceId,
        userId: req.userId,
        ip: req.ip,
        details
      });
    } catch (error) {
      console.error('Audit logging error:', error);
      // Don't fail the request if audit logging fails
    }
    
    if (typeof next === 'function') {
      next();
    }
  };
};

// Performance logging middleware
const performanceLogger = (req, res, next) => {
  const start = process.hrtime();
  
  res.on('finish', () => {
    const [seconds, nanoseconds] = process.hrtime(start);
    const duration = seconds * 1000 + nanoseconds / 1000000;
    
    if (duration > 1000) { // Log slow requests (>1s)
      logger.warn('Slow request', {
        method: req.method,
        path: req.path,
        duration: duration.toFixed(2) + 'ms',
        userId: req.userId
      });
    }
  });
  
  next();
};

// Security logging middleware
const securityLogger = (req, res, next) => {
  // Log potential security issues
  const suspiciousHeaders = ['x-forwarded-for', 'x-real-ip', 'cf-connecting-ip'];
  const suspiciousActivities = [];
  
  // Check for suspicious headers
  suspiciousHeaders.forEach(header => {
    if (req.headers[header]) {
      suspiciousActivities.push(`Suspicious header: ${header}=${req.headers[header]}`);
    }
  });
  
  // Check for SQL injection patterns
  const sqlPatterns = [
    /(\%27)|(\')|(\-\-)|(\%23)|(#)/i,
    /((\%3D)|(=))[^\n]*((\%27)|(\')|(\-\-)|(\%3B)|(;))/i,
    /w*((\%27)|(\'))((\%6F)|o|(\%4F))((\%72)|r|(\%52))/i
  ];
  
  const checkString = JSON.stringify({ ...req.query, ...req.body });
  sqlPatterns.forEach(pattern => {
    if (pattern.test(checkString)) {
      suspiciousActivities.push('Potential SQL injection attempt');
    }
  });
  
  // Check for XSS patterns
  const xssPatterns = [
    /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
    /javascript:/gi,
    /on\w+\s*=/gi
  ];
  
  xssPatterns.forEach(pattern => {
    if (pattern.test(checkString)) {
      suspiciousActivities.push('Potential XSS attempt');
    }
  });
  
  // Log if any suspicious activities detected
  if (suspiciousActivities.length > 0) {
    logger.warn('Security alert', {
      ip: req.ip,
      method: req.method,
      path: req.path,
      userAgent: req.get('User-Agent'),
      activities: suspiciousActivities,
      userId: req.userId
    });
  }
  
  next();
};

module.exports = {
  logger,
  requestLogger,
  errorLogger,
  auditLogger,
  performanceLogger,
  securityLogger
};
