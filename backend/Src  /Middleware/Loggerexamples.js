// app.js or server.js
const express = require('express');
const createLogger = require('./middleware/logger');

// Initialize logger with configuration
const logger = createLogger({
  appName: 'JobPortal',
  appVersion: '1.0.0',
  environment: process.env.NODE_ENV,
  logDir: './logs',
  elasticsearch: {
    node: process.env.ELASTICSEARCH_URL,
  },
  loki: {
    host: process.env.LOKI_URL,
  },
  redactFields: [
    'password',
    'token',
    'secret',
    'authorization',
    'creditCard',
    'ssn',
  ],
});

const app = express();

// Add request ID and correlation ID middleware
app.use((req, res, next) => {
  req.requestId = req.headers['x-request-id'] || require('crypto').randomUUID();
  req.correlationId = req.headers['x-correlation-id'] || req.requestId;
  next();
});

// Use request logger middleware
app.use(logger.requestLogger);

// Use performance monitoring for slow routes
app.use('/api', logger.performanceLogger(500)); // Warn if >500ms

// Error handling
app.use(logger.errorLogger);

// Global error handler
app.use((err, req, res, next) => {
  logger.error('Unhandled application error', {
    error: logger.formatError(err),
    requestId: req.requestId,
    userId: req.user?.id,
  });
  
  res.status(err.status || 500).json({
    success: false,
    error: 'INTERNAL_SERVER_ERROR',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong',
    requestId: req.requestId,
  });
});

// Export logger for use in other modules
module.exports = { app, logger };

// routes/auth.js
const express = require('express');
const router = express.Router();
const { logger } = require('../app');

// Create child logger for auth module
const authLogger = logger.child('auth');

router.post('/register',
  // Audit logging for registration
  logger.auditLogger('user_registration', (req) => ({ email: req.body.email })),
  
  // Business logging
  logger.businessLogger('user_registered', (req, res) => ({
    userId: res.locals.userId,
    email: req.body.email,
    source: req.body.source || 'direct',
  })),
  
  async (req, res, next) => {
    try {
      authLogger.info('Registration attempt', {
        email: req.body.email,
        ip: req.ip,
      });
      
      // Registration logic
      const user = await createUser(req.body);
      
      authLogger.success('User registered successfully', {
        userId: user.id,
        email: user.email,
      });
      
      // Business event
      logger.business('user_registered', {
        userId: user.id,
        plan: user.plan,
        referral: req.body.referralCode,
      });
      
      res.json({ success: true, user });
    } catch (error) {
      authLogger.error('Registration failed', {
        error: logger.formatError(error),
        email: req.body.email,
        ip: req.ip,
      });
      
      next(error);
    }
  }
);

router.post('/login',
  // Security logging for login attempts
  logger.securityLogger('login_attempt', (req) => ({
    email: req.body.email,
    success: false, // Will be updated in handler
  })),
  
  async (req, res, next) => {
    try {
      authLogger.verbose('Login attempt', {
        email: req.body.email,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      
      const user = await authenticateUser(req.body.email, req.body.password);
      
      // Update security log with success
      logger.security('login_success', user, {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      });
      
      authLogger.info('Login successful', {
        userId: user.id,
        email: user.email,
      });
      
      res.json({ success: true, user });
    } catch (error) {
      // Security event for failed login
      logger.security('login_failed', null, {
        email: req.body.email,
        ip: req.ip,
        reason: error.message,
      });
      
      authLogger.warn('Login failed', {
        email: req.body.email,
        ip: req.ip,
        reason: error.message,
      });
      
      next(error);
    }
  }
);

// routes/jobs.js
const jobLogger = logger.child('jobs');

router.post('/jobs',
  // Audit logging for job creation
  logger.auditLogger('job_created', (req) => ({
    jobTitle: req.body.title,
    companyId: req.body.companyId,
  })),
  
  // Performance logging
  logger.performanceLogger(1000),
  
  async (req, res, next) => {
    try {
      const startTime = process.hrtime();
      
      jobLogger.info('Creating job post', {
        title: req.body.title,
        employerId: req.user.id,
        companyId: req.body.companyId,
      });
      
      const job = await createJob(req.body, req.user);
      
      const duration = logger.calculateResponseTime(startTime);
      jobLogger.performance('job_creation', duration, {
        jobId: job.id,
        complexity: req.body.description.length,
      });
      
      // Business event
      logger.business('job_posted', {
        jobId: job.id,
        employerId: req.user.id,
        category: job.category,
        salaryRange: job.salary,
      });
      
      jobLogger.success('Job created successfully', {
        jobId: job.id,
        title: job.title,
      });
      
      res.json({ success: true, job });
    } catch (error) {
      jobLogger.error('Job creation failed', {
        error: logger.formatError(error),
        employerId: req.user.id,
        title: req.body.title,
      });
      
      next(error);
    }
  }
);

router.get('/jobs/:id',
  async (req, res, next) => {
    try {
      jobLogger.debug('Fetching job details', {
        jobId: req.params.id,
        userId: req.user?.id,
      });
      
      const job = await getJobById(req.params.id);
      
      // Log view (for analytics)
      logger.business('job_viewed', {
        jobId: job.id,
        viewerId: req.user?.id,
        viewerRole: req.user?.role,
        source: req.headers.referer,
      });
      
      res.json(job);
    } catch (error) {
      jobLogger.error('Failed to fetch job', {
        error: logger.formatError(error),
        jobId: req.params.id,
      });
      
      next(error);
    }
  }
);

// routes/admin.js
const adminLogger = logger.child('admin');

router.get('/admin/metrics',
  // Security check for admin access
  logger.securityLogger('admin_access', (req) => ({
    endpoint: '/admin/metrics',
    userRole: req.user.role,
  })),
  
  async (req, res) => {
    try {
      adminLogger.info('Admin metrics accessed', {
        adminId: req.user.id,
        endpoint: req.path,
      });
      
      const metrics = {
        system: {
          uptime: process.uptime(),
          memory: process.memoryUsage(),
          load: require('os').loadavg(),
        },
        logging: logger.getStats(),
        database: await getDatabaseMetrics(),
        cache: await getCacheMetrics(),
      };
      
      res.json(metrics);
    } catch (error) {
      adminLogger.error('Failed to get admin metrics', {
        error: logger.formatError(error),
        adminId: req.user.id,
      });
      
      throw error;
    }
  }
);

// routes/payments.js
const paymentLogger = logger.child('payments');

router.post('/payments/process',
  // Comprehensive logging for payment processing
  logger.auditLogger('payment_processed', (req) => ({
    amount: req.body.amount,
    currency: req.body.currency,
    userId: req.user.id,
  })),
  
  logger.securityLogger('payment_attempt', (req) => ({
    amount: req.body.amount,
    paymentMethod: req.body.paymentMethod?.type,
  })),
  
  async (req, res, next) => {
    const startTime = process.hrtime();
    
    try {
      paymentLogger.info('Processing payment', {
        userId: req.user.id,
        amount: req.body.amount,
        currency: req.body.currency,
        paymentMethod: req.body.paymentMethod?.type,
      });
      
      // Process payment
      const payment = await processPayment(req.body, req.user);
      
      const duration = logger.calculateResponseTime(startTime);
      paymentLogger.performance('payment_processing', duration, {
        paymentId: payment.id,
        gateway: payment.gateway,
      });
      
      // Business event
      logger.business('payment_completed', {
        paymentId: payment.id,
        userId: req.user.id,
        amount: payment.amount,
        itemType: payment.metadata?.itemType,
        itemId: payment.metadata?.itemId,
      });
      
      paymentLogger.success('Payment processed successfully', {
        paymentId: payment.id,
        userId: req.user.id,
        amount: payment.amount,
      });
      
      res.json({ success: true, payment });
    } catch (error) {
      const duration = logger.calculateResponseTime(startTime);
      
      paymentLogger.error('Payment processing failed', {
        error: logger.formatError(error),
        userId: req.user.id,
        amount: req.body.amount,
        duration,
        paymentMethod: req.body.paymentMethod?.type,
      });
      
      // Security event for failed payment
      logger.security('payment_failed', req.user, {
        amount: req.body.amount,
        error: error.message,
        gateway: error.gateway,
      });
      
      next(error);
    }
  }
);

// Background job processor
const processBackgroundJobs = async () => {
  const jobLogger = logger.child('background-jobs');
  
  while (true) {
    try {
      const job = await getNextJob();
      
      if (!job) {
        await sleep(1000);
        continue;
      }
      
      jobLogger.info('Processing background job', {
        jobId: job.id,
        type: job.type,
        priority: job.priority,
      });
      
      const startTime = process.hrtime();
      
      // Process job
      await processJob(job);
      
      const duration = logger.calculateResponseTime(startTime);
      jobLogger.performance('background_job', duration, {
        jobId: job.id,
        type: job.type,
      });
      
      jobLogger.success('Background job completed', {
        jobId: job.id,
        duration,
      });
      
    } catch (error) {
      jobLogger.error('Background job failed', {
        error: logger.formatError(error),
        jobId: job?.id,
        jobType: job?.type,
      });
      
      // Retry logic
      await retryJob(job, error);
    }
  }
};

// Database operations with logging
class DatabaseService {
  constructor() {
    this.logger = logger.child('database');
  }
  
  async query(sql, params = []) {
    const startTime = process.hrtime();
    
    try {
      this.logger.debug('Executing database query', {
        sql: this.redactSql(sql),
        params: this.redactParams(params),
        caller: new Error().stack.split('\n')[2].trim(),
      });
      
      const result = await db.query(sql, params);
      
      const duration = logger.calculateResponseTime(startTime);
      this.logger.performance('database_query', duration, {
        sql: this.redactSql(sql),
        rowCount: result.rowCount,
      });
      
      return result;
    } catch (error) {
      const duration = logger.calculateResponseTime(startTime);
      
      this.logger.error('Database query failed', {
        error: logger.formatError(error),
        sql: this.redactSql(sql),
        params: this.redactParams(params),
        duration,
      });
      
      throw error;
    }
  }
  
  redactSql(sql) {
    // Redact sensitive data in SQL
    return sql.replace(/(password|token|secret)\s*=\s*'[^']*'/gi, "$1 = '[REDACTED]'");
  }
  
  redactParams(params) {
    return params.map(param => 
      typeof param === 'string' && param.length > 50 
        ? param.substring(0, 50) + '...' 
        : param
    );
  }
}

// Email service with logging
class EmailService {
  constructor() {
    this.logger = logger.child('email');
  }
  
  async sendEmail(template, to, data) {
    const startTime = process.hrtime();
    
    try {
      this.logger.info('Sending email', {
        template,
        to: logger.maskEmail(to),
        subject: data.subject,
        metadata: data.metadata,
      });
      
      await sendEmail(template, to, data);
      
      const duration = logger.calculateResponseTime(startTime);
      this.logger.performance('email_send', duration, {
        template,
        to: logger.maskEmail(to),
      });
      
      this.logger.success('Email sent successfully', {
        template,
        to: logger.maskEmail(to),
        messageId: data.messageId,
      });
      
      // Business event
      logger.business('email_sent', {
        template,
        recipient: logger.maskEmail(to),
        purpose: data.metadata?.purpose,
      });
      
    } catch (error) {
      const duration = logger.calculateResponseTime(startTime);
      
      this.logger.error('Failed to send email', {
        error: logger.formatError(error),
        template,
        to: logger.maskEmail(to),
        duration,
      });
      
      throw error;
    }
  }
}

// Health check endpoint with logging
router.get('/health',
  async (req, res) => {
    const healthChecks = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      checks: {},
    };
    
    try {
      // Check database
      const dbStart = process.hrtime();
      await db.query('SELECT 1');
      const dbDuration = logger.calculateResponseTime(dbStart);
      healthChecks.checks.database = { status: 'healthy', duration: dbDuration };
      
      logger.verbose('Database health check passed', { duration: dbDuration });
    } catch (error) {
      healthChecks.checks.database = { status: 'unhealthy', error: error.message };
      healthChecks.status = 'unhealthy';
      
      logger.error('Database health check failed', { error: logger.formatError(error) });
    }
    
    try {
      // Check cache
      const cacheStart = process.hrtime();
      await cache.ping();
      const cacheDuration = logger.calculateResponseTime(cacheStart);
      healthChecks.checks.cache = { status: 'healthy', duration: cacheDuration };
      
      logger.verbose('Cache health check passed', { duration: cacheDuration });
    } catch (error) {
      healthChecks.checks.cache = { status: 'unhealthy', error: error.message };
      healthChecks.status = 'unhealthy';
      
      logger.error('Cache health check failed', { error: logger.formatError(error) });
    }
    
    // Log health check result
    logger.info('Health check completed', {
      status: healthChecks.status,
      checks: Object.keys(healthChecks.checks),
      requestId: req.requestId,
    });
    
    res.status(healthChecks.status === 'healthy' ? 200 : 503).json(healthChecks);
  }
);

// Graceful shutdown
const gracefulShutdown = async () => {
  logger.info('Starting graceful shutdown');
  
  // Close HTTP server
  server.close(async () => {
    logger.info('HTTP server closed');
    
    try {
      // Flush logs
      await logger.flush();
      logger.info('Logs flushed');
      
      // Close logger
      await logger.close();
      logger.info('Logger closed');
      
      // Close database connections
      await db.close();
      logger.info('Database connections closed');
      
      process.exit(0);
    } catch (error) {
      logger.error('Error during shutdown', { error: logger.formatError(error) });
      process.exit(1);
    }
  });
  
  // Force shutdown after timeout
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// Export logger for use in tests
if (process.env.NODE_ENV === 'test') {
  // Use a mock logger for tests
  module.exports = createLogger({
    environment: 'test',
    logDir: './logs/test',
  });
}
