// src/middleware/logger.js
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const { ElasticsearchTransport } = require('winston-elasticsearch');
const LokiTransport = require('winston-loki');
const { MESSAGE } = require('triple-beam');
const crypto = require('crypto');
const util = require('util');
const path = require('path');

class LoggerService {
  constructor(config = {}) {
    this.config = {
      // Log levels
      levels: {
        error: 0,
        warn: 1,
        info: 2,
        http: 3,
        verbose: 4,
        debug: 5,
        silly: 6,
      },
      
      // Colors for console
      colors: {
        error: 'red',
        warn: 'yellow',
        info: 'green',
        http: 'magenta',
        verbose: 'cyan',
        debug: 'blue',
        silly: 'gray',
      },
      
      // Application info
      appName: config.appName || process.env.APP_NAME || 'JobPortal',
      appVersion: config.appVersion || process.env.APP_VERSION || '1.0.0',
      environment: config.environment || process.env.NODE_ENV || 'development',
      nodeEnv: process.env.NODE_ENV || 'development',
      
      // Log directories
      logDir: config.logDir || path.join(process.cwd(), 'logs'),
      errorLogDir: config.errorLogDir || path.join(process.cwd(), 'logs', 'errors'),
      auditLogDir: config.auditLogDir || path.join(process.cwd(), 'logs', 'audit'),
      
      // Retention policies
      retentionDays: config.retentionDays || 30,
      maxSize: config.maxSize || '20m',
      maxFiles: config.maxFiles || '14d',
      
      // External services
      elasticsearch: config.elasticsearch || {
        node: process.env.ELASTICSEARCH_URL,
        level: 'info',
      },
      loki: config.loki || {
        host: process.env.LOKI_URL,
        level: 'info',
      },
      sentry: config.sentry || {
        dsn: process.env.SENTRY_DSN,
        level: 'error',
      },
      
      // Performance
      bufferSize: config.bufferSize || 1000,
      flushInterval: config.flushInterval || 2000,
      
      // Security
      redactFields: config.redactFields || [
        'password',
        'token',
        'secret',
        'authorization',
        'apiKey',
        'creditCard',
        'ssn',
        'cvv',
      ],
      
      // Correlation
      correlationHeader: config.correlationHeader || 'x-correlation-id',
      requestIdHeader: config.requestIdHeader || 'x-request-id',
    };

    // Initialize logger
    this.logger = this.createLogger();
    
    // Initialize child loggers cache
    this.childLoggers = new Map();
    
    // Initialize metrics
    this.metrics = {
      logsWritten: 0,
      errorsLogged: 0,
      warningsLogged: 0,
      byLevel: new Map(),
      bySource: new Map(),
    };
    
    // Set up error handlers
    this.setupErrorHandlers();
  }

  /**
   * Create main logger instance
   */
  createLogger() {
    const transports = this.getTransports();
    const format = this.getFormat();
    
    const logger = winston.createLogger({
      levels: this.config.levels,
      level: this.getLogLevel(),
      format,
      transports,
      exitOnError: false,
      defaultMeta: {
        service: this.config.appName,
        version: this.config.appVersion,
        env: this.config.environment,
        hostname: require('os').hostname(),
        pid: process.pid,
      },
    });

    // Add custom methods
    logger.success = (message, meta) => logger.info(message, { ...meta, success: true });
    logger.audit = (action, user, resource, meta) => 
      logger.info(`AUDIT: ${action}`, {
        action,
        user: this.redactUser(user),
        resource,
        type: 'audit',
        ...meta,
      });
    
    logger.performance = (operation, duration, meta) =>
      logger.info(`PERFORMANCE: ${operation}`, {
        operation,
        duration,
        type: 'performance',
        ...meta,
      });

    logger.security = (event, user, details, meta) =>
      logger.warn(`SECURITY: ${event}`, {
        event,
        user: this.redactUser(user),
        details: this.redactSensitive(details),
        type: 'security',
        ...meta,
      });

    logger.business = (event, data, meta) =>
      logger.info(`BUSINESS: ${event}`, {
        event,
        data: this.redactSensitive(data),
        type: 'business',
        ...meta,
      });

    return logger;
  }

  /**
   * Get log level based on environment
   */
  getLogLevel() {
    const envLevels = {
      production: 'info',
      staging: 'verbose',
      development: 'debug',
      test: 'error',
    };
    
    return process.env.LOG_LEVEL || envLevels[this.config.nodeEnv] || 'info';
  }

  /**
   * Get log format
   */
  getFormat() {
    const { format } = winston;
    
    const formats = [
      format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss.SSS',
      }),
      format.errors({ stack: true }),
      this.createRedactionFormat(),
      format.metadata({
        fillExcept: ['message', 'level', 'timestamp', 'label'],
      }),
    ];
    
    if (this.config.nodeEnv === 'production') {
      formats.push(format.json());
    } else {
      formats.push(
        format.colorize({ all: true }),
        this.createConsoleFormat()
      );
    }
    
    return format.combine(...formats);
  }

  /**
   * Create console format for development
   */
  createConsoleFormat() {
    const { format } = winston;
    
    return format.printf(({ timestamp, level, message, metadata, ...rest }) => {
      const meta = { ...metadata, ...rest };
      delete meta.timestamp;
      delete meta.level;
      delete meta.message;
      
      const metaString = Object.keys(meta).length > 0 
        ? ` ${util.inspect(meta, { colors: true, depth: 2 })}`
        : '';
      
      return `${timestamp} ${level}: ${message}${metaString}`;
    });
  }

  /**
   * Create redaction format
   */
  createRedactionFormat() {
    const { format } = winston;
    
    return format((info) => {
      if (info.metadata) {
        info.metadata = this.redactSensitive(info.metadata);
      }
      
      // Redact in nested objects
      const redactRecursive = (obj) => {
        if (!obj || typeof obj !== 'object') return obj;
        
        for (const key in obj) {
          if (this.config.redactFields.some(field => 
            key.toLowerCase().includes(field.toLowerCase())
          )) {
            obj[key] = '[REDACTED]';
          } else if (typeof obj[key] === 'object') {
            redactRecursive(obj[key]);
          }
        }
        return obj;
      };
      
      redactRecursive(info);
      return info;
    })();
  }

  /**
   * Get transports based on environment
   */
  getTransports() {
    const transports = [];
    
    // Console transport (always)
    transports.push(this.createConsoleTransport());
    
    // File transports
    transports.push(this.createFileTransport('all'));
    transports.push(this.createErrorTransport());
    
    // Audit log
    transports.push(this.createAuditTransport());
    
    // External transports based on environment
    if (this.config.elasticsearch.node) {
      transports.push(this.createElasticsearchTransport());
    }
    
    if (this.config.loki.host) {
      transports.push(this.createLokiTransport());
    }
    
    if (this.config.sentry.dsn) {
      transports.push(this.createSentryTransport());
    }
    
    return transports;
  }

  /**
   * Create console transport
   */
  createConsoleTransport() {
    return new winston.transports.Console({
      level: this.getLogLevel(),
      handleExceptions: true,
      handleRejections: true,
      format: this.config.nodeEnv === 'production'
        ? winston.format.json()
        : winston.format.combine(
            winston.format.colorize(),
            this.createConsoleFormat()
          ),
    });
  }

  /**
   * Create file transport
   */
  createFileTransport(level = 'info') {
    return new DailyRotateFile({
      level,
      dirname: this.config.logDir,
      filename: `%DATE%-${level}.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: this.config.maxSize,
      maxFiles: this.config.maxFiles,
      format: winston.format.json(),
      handleExceptions: true,
      handleRejections: true,
    });
  }

  /**
   * Create error transport
   */
  createErrorTransport() {
    return new DailyRotateFile({
      level: 'error',
      dirname: this.config.errorLogDir,
      filename: `%DATE%-error.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: this.config.maxSize,
      maxFiles: this.config.maxFiles,
      format: winston.format.json(),
      handleExceptions: true,
      handleRejections: true,
    });
  }

  /**
   * Create audit transport
   */
  createAuditTransport() {
    return new DailyRotateFile({
      level: 'info',
      dirname: this.config.auditLogDir,
      filename: `%DATE%-audit.log`,
      datePattern: 'YYYY-MM-DD',
      zippedArchive: true,
      maxSize: this.config.maxSize,
      maxFiles: this.config.maxFiles,
      format: winston.format.json(),
      filter: (info) => info.metadata?.type === 'audit',
    });
  }

  /**
   * Create Elasticsearch transport
   */
  createElasticsearchTransport() {
    return new ElasticsearchTransport({
      level: this.config.elasticsearch.level || 'info',
      clientOpts: {
        node: this.config.elasticsearch.node,
        auth: {
          username: process.env.ELASTICSEARCH_USERNAME,
          password: process.env.ELASTICSEARCH_PASSWORD,
        },
      },
      index: `${this.config.appName.toLowerCase()}-${this.config.environment}`,
      format: winston.format.json(),
      bufferSize: this.config.bufferSize,
      flushInterval: this.config.flushInterval,
    });
  }

  /**
   * Create Loki transport
   */
  createLokiTransport() {
    return new LokiTransport({
      level: this.config.loki.level || 'info',
      host: this.config.loki.host,
      labels: {
        app: this.config.appName,
        env: this.config.environment,
        version: this.config.appVersion,
      },
      json: true,
      format: winston.format.json(),
      gracefulShutdown: true,
      replaceTimestamp: true,
      timeout: 5000,
    });
  }

  /**
   * Create Sentry transport
   */
  createSentryTransport() {
    const Sentry = require('@sentry/node');
    
    Sentry.init({
      dsn: this.config.sentry.dsn,
      environment: this.config.environment,
      release: this.config.appVersion,
    });
    
    return {
      log: (info, callback) => {
        if (info.level === 'error' && info.metadata?.error) {
          Sentry.captureException(info.metadata.error, {
            level: 'error',
            extra: info.metadata,
          });
        }
        callback();
      },
    };
  }

  /**
   * Create child logger with context
   */
  child(context, meta = {}) {
    const cacheKey = JSON.stringify({ context, meta });
    
    if (this.childLoggers.has(cacheKey)) {
      return this.childLoggers.get(cacheKey);
    }
    
    const childLogger = this.logger.child({
      context,
      ...meta,
    });
    
    this.childLoggers.set(cacheKey, childLogger);
    return childLogger;
  }

  /**
   * Redact sensitive information
   */
  redactSensitive(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const redacted = { ...obj };
    
    for (const field of this.config.redactFields) {
      if (redacted[field]) {
        redacted[field] = '[REDACTED]';
      }
    }
    
    // Handle nested objects
    for (const key in redacted) {
      if (redacted[key] && typeof redacted[key] === 'object') {
        redacted[key] = this.redactSensitive(redacted[key]);
      }
    }
    
    return redacted;
  }

  /**
   * Redact user information
   */
  redactUser(user) {
    if (!user) return null;
    
    return {
      id: user.id,
      email: user.email ? this.maskEmail(user.email) : undefined,
      role: user.role,
      // Don't include sensitive user data
    };
  }

  /**
   * Mask email address
   */
  maskEmail(email) {
    if (!email) return '';
    const [local, domain] = email.split('@');
    if (!local || !domain) return email;
    
    const maskedLocal = local.length > 2 
      ? local[0] + '*'.repeat(local.length - 2) + local[local.length - 1]
      : '*'.repeat(local.length);
    
    return `${maskedLocal}@${domain}`;
  }

  /**
   * Setup error handlers
   */
  setupErrorHandlers() {
    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      this.logger.error('Uncaught Exception', { 
        error: this.formatError(error),
        process: {
          pid: process.pid,
          memory: process.memoryUsage(),
          uptime: process.uptime(),
        },
      });
      
      // Give time for logs to flush
      setTimeout(() => process.exit(1), 1000);
    });
    
    // Handle unhandled rejections
    process.on('unhandledRejection', (reason, promise) => {
      this.logger.error('Unhandled Rejection', { 
        reason: this.formatError(reason),
        promise,
        process: {
          pid: process.pid,
          memory: process.memoryUsage(),
          uptime: process.uptime(),
        },
      });
    });
    
    // Handle warnings
    process.on('warning', (warning) => {
      this.logger.warn('Process Warning', { 
        warning: this.formatError(warning),
      });
    });
  }

  /**
   * Format error for logging
   */
  formatError(error) {
    if (!error) return error;
    
    if (error instanceof Error) {
      return {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: error.code,
        ...error,
      };
    }
    
    return error;
  }

  /**
   * Log HTTP request
   */
  logRequest(req, res, responseTime, meta = {}) {
    const logData = {
      type: 'http',
      method: req.method,
      url: req.originalUrl || req.url,
      status: res.statusCode,
      responseTime,
      ip: this.getClientIP(req),
      userAgent: req.headers['user-agent'],
      referer: req.headers.referer,
      requestId: req.requestId,
      correlationId: req.correlationId,
      userId: req.user?.id,
      userRole: req.user?.role,
      contentLength: res.get('content-length'),
      ...meta,
    };
    
    // Determine log level based on status code
    let level = 'info';
    if (res.statusCode >= 500) {
      level = 'error';
    } else if (res.statusCode >= 400) {
      level = 'warn';
    } else if (res.statusCode >= 300) {
      level = 'verbose';
    }
    
    this.logger.log(level, `HTTP ${req.method} ${req.originalUrl} ${res.statusCode}`, logData);
    
    // Update metrics
    this.updateMetrics('http', level);
  }

  /**
   * Get client IP address
   */
  getClientIP(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && this.config.trustProxy) {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.connection.remoteAddress;
  }

  /**
   * Update metrics
   */
  updateMetrics(source, level) {
    this.metrics.logsWritten++;
    
    if (level === 'error') this.metrics.errorsLogged++;
    if (level === 'warn') this.metrics.warningsLogged++;
    
    // Update by level
    const levelCount = this.metrics.byLevel.get(level) || 0;
    this.metrics.byLevel.set(level, levelCount + 1);
    
    // Update by source
    const sourceCount = this.metrics.bySource.get(source) || 0;
    this.metrics.bySource.set(source, sourceCount + 1);
  }

  /**
   * Get logger statistics
   */
  getStats() {
    return {
      logsWritten: this.metrics.logsWritten,
      errorsLogged: this.metrics.errorsLogged,
      warningsLogged: this.metrics.warningsLogged,
      byLevel: Object.fromEntries(this.metrics.byLevel),
      bySource: Object.fromEntries(this.metrics.bySource),
      childLoggers: this.childLoggers.size,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Flush logs (for transports that buffer)
   */
  async flush() {
    const promises = [];
    
    for (const transport of this.logger.transports) {
      if (transport.flush && typeof transport.flush === 'function') {
        promises.push(transport.flush());
      }
    }
    
    await Promise.allSettled(promises);
  }

  /**
   * Close logger and all transports
   */
  async close() {
    await this.flush();
    await new Promise(resolve => this.logger.close(resolve));
  }
}

// Create Express middleware factory
const createLoggingMiddleware = (loggerService, options = {}) => {
  const {
    skip = () => false,
    requestIdHeader = 'x-request-id',
    correlationHeader = 'x-correlation-id',
    logRequestBody = false,
    logResponseBody = false,
    maxBodySize = 1024, // 1KB
    sensitiveRoutes = ['/auth', '/login', '/register'],
  } = options;

  /**
   * Request logging middleware
   */
  const requestLogger = (req, res, next) => {
    // Skip logging for certain conditions
    if (skip(req)) {
      return next();
    }

    // Generate request IDs
    req.requestId = req.headers[requestIdHeader] || crypto.randomUUID();
    req.correlationId = req.headers[correlationHeader] || req.requestId;

    // Add to response headers
    res.setHeader('X-Request-ID', req.requestId);
    res.setHeader('X-Correlation-ID', req.correlationId);

    // Capture start time
    const startTime = process.hrtime();

    // Capture request body for logging (if enabled)
    let requestBody = null;
    if (logRequestBody && !sensitiveRoutes.some(route => req.path.startsWith(route))) {
      requestBody = this.captureRequestBody(req, maxBodySize);
    }

    // Capture response body
    const originalSend = res.send;
    let responseBody = null;
    
    if (logResponseBody && !sensitiveRoutes.some(route => req.path.startsWith(route))) {
      res.send = function(body) {
        responseBody = this.captureResponseBody(body, maxBodySize);
        return originalSend.call(this, body);
      };
    }

    // Log when response finishes
    res.on('finish', () => {
      const responseTime = this.calculateResponseTime(startTime);
      
      const logMeta = {
        requestId: req.requestId,
        correlationId: req.correlationId,
        user: req.user ? loggerService.redactUser(req.user) : null,
        query: req.query,
        params: req.params,
        requestBody,
        responseBody,
        contentLength: res.get('content-length'),
        cacheStatus: res.get('x-cache-status'),
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
        accept: req.headers.accept,
        contentType: req.headers['content-type'],
      };

      loggerService.logRequest(req, res, responseTime, logMeta);
    });

    // Log request start
    loggerService.logger.verbose(`Request started: ${req.method} ${req.originalUrl}`, {
      type: 'http_start',
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      url: req.originalUrl,
      ip: loggerService.getClientIP(req),
    });

    next();
  };

  /**
   * Error logging middleware
   */
  const errorLogger = (err, req, res, next) => {
    const errorId = crypto.randomUUID();
    
    loggerService.logger.error('Unhandled error', {
      type: 'error',
      errorId,
      requestId: req.requestId,
      correlationId: req.correlationId,
      error: loggerService.formatError(err),
      request: {
        method: req.method,
        url: req.originalUrl,
        headers: loggerService.redactSensitive(req.headers),
        body: loggerService.redactSensitive(req.body),
        query: req.query,
        params: req.params,
        user: req.user ? loggerService.redactUser(req.user) : null,
      },
      response: {
        statusCode: res.statusCode,
        headers: res.getHeaders(),
      },
      stack: err.stack,
    });

    // Add error ID to response
    res.setHeader('X-Error-ID', errorId);

    next(err);
  };

  /**
   * Performance monitoring middleware
   */
  const performanceLogger = (threshold = 1000) => {
    return (req, res, next) => {
      const startTime = process.hrtime();
      const operation = `${req.method} ${req.path}`;

      res.on('finish', () => {
        const duration = this.calculateResponseTime(startTime);
        
        if (duration > threshold) {
          loggerService.logger.warn(`Slow operation: ${operation}`, {
            type: 'performance',
            operation,
            duration,
            threshold,
            requestId: req.requestId,
            url: req.originalUrl,
            method: req.method,
            statusCode: res.statusCode,
            user: req.user?.id,
          });
        }

        loggerService.logger.performance(operation, duration, {
          requestId: req.requestId,
          user: req.user?.id,
          statusCode: res.statusCode,
        });
      });

      next();
    };
  };

  /**
   * Audit logging middleware
   */
  const auditLogger = (action, getResource = (req) => req.params.id) => {
    return (req, res, next) => {
      const originalSend = res.send;
      const startTime = process.hrtime();

      res.send = function(body) {
        const duration = this.calculateResponseTime(startTime);
        const resource = typeof getResource === 'function' ? getResource(req) : getResource;

        loggerService.logger.audit(
          action,
          req.user,
          resource,
          {
            requestId: req.requestId,
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration,
            ip: loggerService.getClientIP(req),
            userAgent: req.headers['user-agent'],
            changes: req.body,
            result: res.statusCode < 400 ? 'success' : 'failure',
          }
        );

        return originalSend.call(this, body);
      };

      next();
    };
  };

  /**
   * Security event logging
   */
  const securityLogger = (event, getDetails = (req) => ({})) => {
    return (req, res, next) => {
      const details = typeof getDetails === 'function' ? getDetails(req) : getDetails;
      
      loggerService.logger.security(
        event,
        req.user,
        {
          ...details,
          requestId: req.requestId,
          method: req.method,
          url: req.originalUrl,
          ip: loggerService.getClientIP(req),
          userAgent: req.headers['user-agent'],
        },
        {
          timestamp: new Date().toISOString(),
        }
      );

      next();
    };
  };

  /**
   * Business event logging
   */
  const businessLogger = (event, getData = (req, res) => ({})) => {
    return (req, res, next) => {
      const originalSend = res.send;

      res.send = function(body) {
        const data = typeof getData === 'function' ? getData(req, res) : getData;

        loggerService.logger.business(
          event,
          {
            ...data,
            requestId: req.requestId,
            user: req.user?.id,
            statusCode: res.statusCode,
          },
          {
            timestamp: new Date().toISOString(),
          }
        );

        return originalSend.call(this, body);
      };

      next();
    };
  };

  /**
   * Helper to calculate response time
   */
  const calculateResponseTime = (startTime) => {
    const diff = process.hrtime(startTime);
    return (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2); // milliseconds
  };

  /**
   * Helper to capture request body
   */
  const captureRequestBody = (req, maxSize) => {
    if (!req.body || typeof req.body !== 'object') return null;
    
    const bodyStr = JSON.stringify(req.body);
    if (bodyStr.length > maxSize) {
      return {
        truncated: true,
        size: bodyStr.length,
        preview: bodyStr.substring(0, maxSize) + '...',
      };
    }
    
    return loggerService.redactSensitive(req.body);
  };

  /**
   * Helper to capture response body
   */
  const captureResponseBody = (body, maxSize) => {
    if (!body) return null;
    
    let bodyStr;
    if (typeof body === 'object') {
      bodyStr = JSON.stringify(body);
    } else {
      bodyStr = String(body);
    }
    
    if (bodyStr.length > maxSize) {
      return {
        truncated: true,
        size: bodyStr.length,
        preview: bodyStr.substring(0, maxSize) + '...',
      };
    }
    
    try {
      const parsed = typeof body === 'string' ? JSON.parse(body) : body;
      return loggerService.redactSensitive(parsed);
    } catch {
      return { text: '[non-json response]' };
    }
  };

  return {
    // Core middleware
    requestLogger,
    errorLogger,
    performanceLogger,
    auditLogger,
    securityLogger,
    businessLogger,
    
    // Utilities
    calculateResponseTime,
    captureRequestBody,
    captureResponseBody,
    
    // Service access
    loggerService,
  };
};

// Create singleton instance
const createLogger = (config = {}) => {
  const loggerService = new LoggerService(config);
  const loggingMiddleware = createLoggingMiddleware(loggerService);
  
  return {
    // Logger instance
    logger: loggerService.logger,
    
    // Middleware
    ...loggingMiddleware,
    
    // Service methods
    child: (context, meta) => loggerService.child(context, meta),
    redact: (obj) => loggerService.redactSensitive(obj),
    formatError: (error) => loggerService.formatError(error),
    getStats: () => loggerService.getStats(),
    flush: () => loggerService.flush(),
    close: () => loggerService.close(),
    
    // Convenience methods
    error: (message, meta) => loggerService.logger.error(message, meta),
    warn: (message, meta) => loggerService.logger.warn(message, meta),
    info: (message, meta) => loggerService.logger.info(message, meta),
    http: (message, meta) => loggerService.logger.http(message, meta),
    verbose: (message, meta) => loggerService.logger.verbose(message, meta),
    debug: (message, meta) => loggerService.logger.debug(message, meta),
    success: (message, meta) => loggerService.logger.success(message, meta),
    audit: (action, user, resource, meta) => 
      loggerService.logger.audit(action, user, resource, meta),
    performance: (operation, duration, meta) =>
      loggerService.logger.performance(operation, duration, meta),
    security: (event, user, details, meta) =>
      loggerService.logger.security(event, user, details, meta),
    business: (event, data, meta) =>
      loggerService.logger.business(event, data, meta),
  };
};

// Export
module.exports = createLogger;
