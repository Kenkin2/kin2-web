/**
 * Enhanced logger that works with error handling
 */

const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const LokiTransport = require('winston-loki');

const createLogger = (config = {}) => {
  const {
    appName = 'JobPortal',
    appVersion = '1.0.0',
    environment = process.env.NODE_ENV || 'development',
    logDir = './logs',
    elasticsearch,
    loki,
    redactFields = [],
  } = config;

  // Custom format for redaction
  const redactFormat = winston.format((info, opts) => {
    if (info.message && typeof info.message === 'object') {
      info.message = redactObject(info.message, redactFields);
    }
    if (info.meta && typeof info.meta === 'object') {
      info.meta = redactObject(info.meta, redactFields);
    }
    return info;
  });

  const transports = [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          return `${timestamp} [${level}]: ${message} ${
            Object.keys(meta).length ? JSON.stringify(meta, null, 2) : ''
          }`;
        })
      ),
    }),

    // File transports for errors
    new winston.transports.File({
      filename: `${logDir}/error.log`,
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: `${logDir}/combined.log`,
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      ),
    }),
  ];

  // Add Elasticsearch transport if configured
  if (elasticsearch?.node) {
    transports.push(
      new ElasticsearchTransport({
        level: 'info',
        index: `${appName.toLowerCase()}-${environment}`,
        clientOpts: {
          node: elasticsearch.node,
          auth: elasticsearch.auth,
        },
        format: winston.format.combine(
          winston.format.timestamp(),
          redactFormat(),
          winston.format.json()
        ),
      })
    );
  }

  // Add Loki transport if configured
  if (loki?.host) {
    transports.push(
      new LokiTransport({
        host: loki.host,
        labels: { 
          app: appName,
          version: appVersion,
          env: environment,
        },
        json: true,
        format: winston.format.combine(
          winston.format.timestamp(),
          redactFormat(),
          winston.format.json()
        ),
      })
    );
  }

  const logger = winston.createLogger({
    level: environment === 'development' ? 'debug' : 'info',
    defaultMeta: {
      service: appName,
      version: appVersion,
      environment,
    },
    format: winston.format.combine(
      winston.format.timestamp(),
      redactFormat(),
      winston.format.errors({ stack: true }),
      winston.format.json()
    ),
    transports,
  });

  // Add custom methods for error handling
  logger.formatError = (error) => {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      isOperational: error.isOperational,
      timestamp: error.timestamp || new Date().toISOString(),
    };
  };

  logger.maskEmail = (email) => {
    if (!email) return null;
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    
    const maskedLocal = local.length <= 2 
      ? '*'.repeat(local.length)
      : local[0] + '*'.repeat(Math.min(3, local.length - 2)) + local.slice(-1);
    
    return `${maskedLocal}@${domain}`;
  };

  logger.calculateResponseTime = (startTime) => {
    const diff = process.hrtime(startTime);
    return diff[0] * 1e3 + diff[1] * 1e-6; // Convert to milliseconds
  };

  // Child logger creation
  logger.child = (module) => {
    return logger.child ? logger.child({ module }) : logger;
  };

  // Request logger middleware
  logger.requestLogger = (req, res, next) => {
    const startTime = process.hrtime();
    
    // Generate IDs if not present
    req.requestId = req.headers['x-request-id'] || require('crypto').randomUUID();
    req.correlationId = req.headers['x-correlation-id'] || req.requestId;
    req.errorId = req.requestId; // Alias for error tracking
    
    logger.info('Request started', {
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      url: req.originalUrl,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      userId: req.user?.id,
    });
    
    // Log when response finishes
    res.on('finish', () => {
      const responseTime = logger.calculateResponseTime(startTime);
      
      logger.info('Request completed', {
        requestId: req.requestId,
        correlationId: req.correlationId,
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        responseTime: `${responseTime.toFixed(2)}ms`,
        userId: req.user?.id,
      });
      
      // Log slow requests
      if (responseTime > 1000) {
        logger.warn('Slow request', {
          requestId: req.requestId,
          url: req.originalUrl,
          responseTime: `${responseTime.toFixed(2)}ms`,
          threshold: '1s',
        });
      }
    });
    
    next();
  };

  // Error logger middleware
  logger.errorLogger = (err, req, res, next) => {
    logger.error('Error occurred', {
      requestId: req.requestId,
      correlationId: req.correlationId,
      error: logger.formatError(err),
      url: req.originalUrl,
      method: req.method,
      userId: req.user?.id,
    });
    
    next(err);
  };

  // Performance logger middleware
  logger.performanceLogger = (threshold = 500) => {
    return (req, res, next) => {
      const startTime = process.hrtime();
      
      res.on('finish', () => {
        const responseTime = logger.calculateResponseTime(startTime);
        
        if (responseTime > threshold) {
          logger.warn('Performance issue', {
            requestId: req.requestId,
            url: req.originalUrl,
            method: req.method,
            responseTime: `${responseTime.toFixed(2)}ms`,
            threshold: `${threshold}ms`,
            userId: req.user?.id,
          });
        }
      });
      
      next();
    };
  };

  // Audit logger middleware
  logger.auditLogger = (event, getMetadata) => {
    return (req, res, next) => {
      const metadata = getMetadata ? getMetadata(req) : {};
      
      logger.info('Audit event', {
        event,
        requestId: req.requestId,
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        ...metadata,
      });
      
      next();
    };
  };

  // Business event logger
  logger.businessLogger = (event, getMetadata) => {
    return (req, res, next) => {
      const originalJson = res.json;
      
      res.json = function(body) {
        if (res.statusCode < 400 && getMetadata) {
          const metadata = getMetadata(req, res, body);
          
          logger.info('Business event', {
            event,
            requestId: req.requestId,
            userId: req.user?.id,
            timestamp: new Date().toISOString(),
            ...metadata,
          });
        }
        
        return originalJson.call(this, body);
      };
      
      next();
    };
  };

  // Security logger middleware
  logger.securityLogger = (event, getMetadata) => {
    return (req, res, next) => {
      const metadata = getMetadata ? getMetadata(req) : {};
      
      logger.warn('Security event', {
        event,
        requestId: req.requestId,
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        severity: 'medium',
        ...metadata,
      });
      
      next();
    };
  };

  return logger;
};

// Helper function to redact sensitive data
const redactObject = (obj, fields) => {
  if (!obj || typeof obj !== 'object') return obj;
  
  const redacted = { ...obj };
  fields.forEach(field => {
    if (redacted[field] !== undefined) {
      redacted[field] = '[REDACTED]';
    }
  });
  
  // Recursively redact nested objects
  Object.keys(redacted).forEach(key => {
    if (typeof redacted[key] === 'object' && redacted[key] !== null) {
      redacted[key] = redactObject(redacted[key], fields);
    }
  });
  
  return redacted;
};

module.exports = createLogger;
