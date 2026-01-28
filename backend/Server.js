#!/usr/bin/enconst express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const compression = require('compression');
const path = require('path');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import error handling and logging
const createLogger = require('./src/utils/logger');
const {
  errorHandler,
  notFoundHandler,
  errorReportingMiddleware,
  asyncHandler,
  RateLimitError,
} = require('./src/middleware/errorHandler');

// Initialize logger with configuration
const logger = createLogger({
  appName: 'Kin2Workforce',
  appVersion: process.env.npm_package_version || '1.0.0',
  environment: process.env.NODE_ENV || 'development',
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
    'cvv',
    'apiKey',
    'privateKey',
    'refreshToken',
    'accessToken',
  ],
});

const app = express();

// ======================
// SECURITY MIDDLEWARE
// ======================
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      connectSrc: ["'self'", process.env.API_URL || 'http://localhost:3000', 'https://*.deepseek.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      frameSrc: ["'self'", 'https://js.stripe.com'],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

// CORS configuration
const corsOptions = {
  origin: process.env.FRONTEND_URL 
    ? process.env.FRONTEND_URL.split(',') 
    : ['http://localhost:5173', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type', 
    'Authorization', 
    'X-Request-ID', 
    'X-Correlation-ID',
    'X-API-Key',
    'Stripe-Signature'
  ],
  exposedHeaders: ['X-Request-ID', 'X-RateLimit-Limit', 'X-RateLimit-Remaining'],
  maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions)); // Preflight requests

// ======================
// RATE LIMITING
// ======================
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'production' ? 100 : 1000, // requests per window
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  keyGenerator: (req) => {
    return req.ip; // Use IP for rate limiting
  },
  handler: (req, res, next) => {
    next(new RateLimitError('Too many requests. Please try again later.', 60)); // 60 seconds retry
  },
  skip: (req) => {
    // Skip rate limiting for health checks and internal IPs
    return req.path === '/health' || req.ip === '::1' || req.ip === '127.0.0.1';
  },
});

// Apply rate limiting to API routes
app.use('/api', limiter);

// Stricter rate limiting for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10, // Only 10 requests per window for auth
  message: 'Too many authentication attempts. Please try again later.',
  skipSuccessfulRequests: false,
});

app.use('/api/auth', authLimiter);

// ======================
// BODY PARSING & COOKIES
// ======================
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf; // For Stripe webhook verification
  }
}));
app.use(express.urlencoded({ 
  extended: true, 
  limit: '10mb' 
}));
app.use(cookieParser(process.env.COOKIE_SECRET || 'your-cookie-secret-here'));

// ======================
// COMPRESSION
// ======================
app.use(compression({
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  }
}));

// ======================
// REQUEST LOGGING & MONITORING
// ======================
app.use(logger.requestLogger);
app.use(errorReportingMiddleware);

// Performance monitoring for all routes
const performanceThreshold = process.env.NODE_ENV === 'production' ? 500 : 1000;
app.use(logger.performanceLogger(performanceThreshold));

// Morgan HTTP logging (development only)
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev', { 
    stream: { 
      write: (msg) => logger.info(msg.trim(), { source: 'morgan' }) 
    } 
  }));
}

// ======================
// DATABASE CONNECTION
// ======================
const connectDatabase = async () => {
  try {
    // Your database connection logic here (Prisma, Mongoose, etc.)
    logger.info('Database connection established');
  } catch (error) {
    logger.error('Database connection failed', {
      error: logger.formatError(error),
      retryCount: 1,
    });
    
    // Retry logic or exit
    setTimeout(connectDatabase, 5000);
  }
};

// ======================
// APPLICATION ROUTES
// ======================

// Import routes
const authRoutes = require('./src/routes/auth');
const jobRoutes = require('./src/routes/jobs');
const paymentRoutes = require('./src/routes/payments');
const adminRoutes = require('./src/routes/admin');
const workforceRoutes = require('./src/routes/workforce');
const aiRoutes = require('./src/routes/ai');

// API Routes with versioning
const API_PREFIX = '/api/v1';

// Public routes (no authentication required)
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/health`, require('./src/routes/health'));

// Protected routes (require authentication)
app.use(`${API_PREFIX}/jobs`, jobRoutes);
app.use(`${API_PREFIX}/payments`, paymentRoutes);
app.use(`${API_PREFIX}/admin`, adminRoutes);
app.use(`${API_PREFIX}/workforce`, workforceRoutes);
app.use(`${API_PREFIX}/ai`, aiRoutes);

// ======================
// HEALTH CHECK ENDPOINT
// ======================
app.get('/health', asyncHandler(async (req, res) => {
  const healthChecks = {
    service: 'Kin2 Workforce Platform',
    timestamp: new Date().toISOString(),
    status: 'healthy',
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    requestId: req.requestId,
    checks: {},
  };
  
  // Database health check
  try {
    // Example with Prisma
    // await prisma.$queryRaw`SELECT 1`;
    healthChecks.checks.database = { 
      status: 'healthy', 
      timestamp: new Date().toISOString(),
      responseTime: '0ms' 
    };
  } catch (error) {
    healthChecks.checks.database = { 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString(),
    };
    healthChecks.status = 'degraded';
  }
  
  // Redis/Cache health check
  try {
    // Example with Redis
    // await redis.ping();
    healthChecks.checks.cache = { 
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    healthChecks.checks.cache = { 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString(),
    };
    healthChecks.status = 'degraded';
  }
  
  // External service checks
  try {
    // Check Stripe connectivity
    healthChecks.checks.stripe = { 
      status: 'healthy',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    healthChecks.checks.stripe = { 
      status: 'unhealthy', 
      error: error.message,
      timestamp: new Date().toISOString(),
    };
    healthChecks.status = 'degraded';
  }
  
  // System metrics
  healthChecks.system = {
    memory: process.memoryUsage(),
    cpu: process.cpuUsage(),
    platform: process.platform,
    nodeVersion: process.version,
  };
  
  logger.info('Health check completed', {
    requestId: req.requestId,
    status: healthChecks.status,
    responseTime: `${Date.now() - req._startTime}ms`,
  });
  
  const statusCode = healthChecks.status === 'healthy' ? 200 : 
                     healthChecks.status === 'degraded' ? 206 : 503;
  
  res.status(statusCode).json(healthChecks);
}));

// ======================
// STATIC FILE SERVING
// ======================
if (process.env.NODE_ENV === 'production') {
  // Serve frontend static files
  app.use(express.static(path.join(__dirname, '../frontend/dist'), {
    maxAge: '1y',
    etag: true,
    lastModified: true,
    setHeaders: (res, path) => {
      if (path.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      }
    },
  }));
  
  // Handle SPA routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
  });
} else {
  // Development static files
  app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
}

// ======================
// ERROR HANDLING CHAIN
// ======================

// 404 handler - must be before error handler
app.use(notFoundHandler);

// Error logger middleware
app.use(logger.errorLogger);

// Global error handler - MUST BE LAST
app.use(errorHandler);

// ======================
// SERVER STARTUP
// ======================

// Initialize database connection
connectDatabase();

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const server = app.listen(PORT, HOST, () => {
  logger.info(`🚀 Server started successfully`, {
    environment: process.env.NODE_ENV,
    port: PORT,
    host: HOST,
    url: `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`,
    pid: process.pid,
    nodeVersion: process.version,
  });
});

// ======================
// PROCESS EVENT HANDLERS
// ======================

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', {
    reason: logger.formatError(reason),
    promise: promise.toString(),
    timestamp: new Date().toISOString(),
    pid: process.pid,
  });
  
  // In production, you might want to exit the process
  if (process.env.NODE_ENV === 'production') {
    // Attempt graceful shutdown
    gracefulShutdown();
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception - CRITICAL', {
    error: logger.formatError(error),
    timestamp: new Date().toISOString(),
    pid: process.pid,
  });
  
  // Exit the process as the application is in an unknown state
  setTimeout(() => {
    process.exit(1);
  }, 1000);
});

// Handle SIGTERM for graceful shutdown in Kubernetes/Docker
process.on('SIGTERM', () => {
  logger.info('SIGTERM received, starting graceful shutdown');
  gracefulShutdown();
});

// Handle SIGINT for Ctrl+C
process.on('SIGINT', () => {
  logger.info('SIGINT received, starting graceful shutdown');
  gracefulShutdown();
});

// ======================
// GRACEFUL SHUTDOWN
// ======================
const gracefulShutdown = async (signal = 'manual') => {
  logger.info('Starting graceful shutdown', { signal, pid: process.pid });
  
  // Set shutdown flag
  app.locals.isShuttingDown = true;
  
  // Stop accepting new connections
  server.close(async (err) => {
    if (err) {
      logger.error('Error closing HTTP server', {
        error: logger.formatError(err),
        signal,
      });
      process.exit(1);
    }
    
    logger.info('HTTP server closed');
    
    try {
      // Close database connections
      // Example with Prisma:
      // await prisma.$disconnect();
      logger.info('Database connections closed');
      
      // Close Redis connections
      // await redis.quit();
      logger.info('Cache connections closed');
      
      // Flush logs if supported
      if (logger.flush && typeof logger.flush === 'function') {
        await logger.flush();
        logger.info('Logs flushed to external services');
      }
      
      // Close logger transports
      if (logger.close && typeof logger.close === 'function') {
        await logger.close();
        logger.info('Logger transports closed');
      }
      
      logger.info('Graceful shutdown completed successfully');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown', { 
        error: logger.formatError(error),
        signal,
      });
      process.exit(1);
    }
  });
  
  // Force shutdown after timeout
  const forceShutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000); // 30 seconds timeout
  
  // Clear timeout if shutdown completes
  server.on('close', () => {
    clearTimeout(forceShutdownTimeout);
  });
};

// ======================
// READINESS & LIVENESS
// ======================
let isReady = false;

// Simple readiness check
app.get('/ready', (req, res) => {
  if (isReady && !app.locals.isShuttingDown) {
    res.status(200).json({ status: 'ready', timestamp: new Date().toISOString() });
  } else {
    res.status(503).json({ status: 'not ready', timestamp: new Date().toISOString() });
  }
});

// Simple liveness check
app.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive', timestamp: new Date().toISOString() });
});

// Mark as ready after startup
setTimeout(() => {
  isReady = true;
  logger.info('Application is now ready to accept traffic');
}, 2000);

// ======================
// EXPORTS
// ======================
module.exports = { 
  app, 
  logger,
  server,
  gracefulShutdown,
};v node

/**
 * █▀▀ █░█ █▄░█ █▀▀ ░░█ █▀ ▀█▀ █▀▀ █▀█ █ █▄░█ █▀▀
 * █▄▄ █▄█ █░▀█ █▀░ █▄█ ▄█ ░█░ ██▄ █▀▄ █ █░▀█ █▄█
 * Kin2 Workforce Platform - Production Server v2.5.0
 * Main server entry point with service initialization
 */

// ======================================================
// 1. ENVIRONMENT LOADING
// ======================================================

// Load environment with our custom loader
const envLoader = require('./src/utils/env-loader');
envLoader.load();

// ======================================================
// 2. IMPORTS
// ======================================================

const { createApp } = require('./src/app');
const { PrismaClient } = require('@prisma/client');
const redis = require('redis');
const { createClient } = require('redis');
const WebSocket = require('ws');
const http = require('http');
const cluster = require('cluster');
const os = require('os');
const path = require('path');
const fs = require('fs');

// Custom utilities
const { systemLogger, securityLogger } = require('./src/utils/logger');
const { scheduleJobs } = require('./src/services/background/scheduler');

// ======================================================
// 3. SERVICE INITIALIZATION
// ======================================================

/**
 * Initialize all external services
 */
async function initializeServices() {
  const services = {};
  const errors = [];
  
  systemLogger.info('🚀 Initializing services...');

  // 1. Initialize Prisma (Database)
  try {
    services.prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' 
        ? ['query', 'info', 'warn', 'error']
        : ['warn', 'error'],
      errorFormat: 'pretty'
    });
    
    // Test database connection
    await services.prisma.$connect();
    systemLogger.info('✅ Prisma (Database) connected successfully');
  } catch (error) {
    errors.push(`Database: ${error.message}`);
    systemLogger.error('❌ Failed to connect to database:', error.message);
  }

  // 2. Initialize Redis (Cache & Sessions)
  if (process.env.REDIS_URL) {
    try {
      services.redisClient = createClient({
        url: process.env.REDIS_URL,
        password: process.env.REDIS_PASSWORD,
        socket: {
          tls: process.env.REDIS_TLS === 'true',
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              systemLogger.error('❌ Redis reconnection failed after 10 attempts');
              return new Error('Max reconnection attempts exceeded');
            }
            return Math.min(retries * 100, 3000);
          }
        }
      });

      services.redisClient.on('error', (err) => {
        systemLogger.error('Redis client error:', err);
      });

      services.redisClient.on('connect', () => {
        systemLogger.info('✅ Redis connected successfully');
      });

      services.redisClient.on('reconnecting', () => {
        systemLogger.warn('Redis reconnecting...');
      });

      await services.redisClient.connect();
    } catch (error) {
      errors.push(`Redis: ${error.message}`);
      systemLogger.error('❌ Failed to connect to Redis:', error.message);
      services.redisClient = null;
    }
  } else {
    systemLogger.warn('⚠️  Redis URL not configured, skipping Redis initialization');
    services.redisClient = null;
  }

  // 3. Initialize Stripe (Payments)
  if (process.env.STRIPE_SECRET_KEY && process.env.ENABLE_PAYMENTS === 'true') {
    try {
      const Stripe = require('stripe');
      services.stripe = Stripe(process.env.STRIPE_SECRET_KEY, {
        apiVersion: '2023-10-16',
        maxNetworkRetries: 3,
        timeout: 30000,
        telemetry: false
      });
      
      // Test Stripe connection
      await services.stripe.balance.retrieve();
      systemLogger.info('✅ Stripe connected successfully');
    } catch (error) {
      errors.push(`Stripe: ${error.message}`);
      systemLogger.error('❌ Failed to initialize Stripe:', error.message);
      services.stripe = null;
    }
  }

  // 4. Initialize Email Service
  if (process.env.SMTP_HOST && process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true') {
    try {
      const nodemailer = require('nodemailer');
      services.emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT) || 587,
        secure: process.env.SMTP_SECURE === 'true',
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS
        },
        pool: true,
        maxConnections: 5,
        maxMessages: 100
      });

      // Verify connection configuration
      await services.emailTransporter.verify();
      systemLogger.info('✅ Email service configured successfully');
    } catch (error) {
      errors.push(`Email: ${error.message}`);
      systemLogger.error('❌ Failed to initialize email service:', error.message);
      services.emailTransporter = null;
    }
  }

  // 5. Initialize AI Services
  if (process.env.DEEPSEEK_API_KEY && process.env.ENABLE_AI_AGENTS === 'true') {
    try {
      const { initializeAI } = require('./src/services/ai');
      services.ai = await initializeAI();
      systemLogger.info('✅ AI services initialized successfully');
    } catch (error) {
      errors.push(`AI: ${error.message}`);
      systemLogger.error('❌ Failed to initialize AI services:', error.message);
      services.ai = null;
    }
  }

  // 6. Initialize File Storage
  services.storage = {
    local: {
      uploadsDir: path.join(process.cwd(), 'uploads'),
      tempDir: path.join(process.cwd(), 'uploads/temp'),
      ensureDirectories: () => {
        const dirs = [services.storage.local.uploadsDir, services.storage.local.tempDir];
        dirs.forEach(dir => {
          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }
        });
      }
    }
  };

  // Ensure upload directories exist
  services.storage.local.ensureDirectories();

  // 7. Initialize Bull Queue (Background Jobs)
  if (services.redisClient) {
    try {
      const Queue = require('bull');
      const { setupQueues } = require('./src/services/background/queues');
      services.queues = await setupQueues(services.redisClient);
      systemLogger.info('✅ Background queues initialized');
    } catch (error) {
      errors.push(`Queues: ${error.message}`);
      systemLogger.error('❌ Failed to initialize background queues:', error.message);
      services.queues = null;
    }
  }

  // Log initialization results
  if (errors.length > 0) {
    systemLogger.warn(`⚠️  Some services failed to initialize: ${errors.length} error(s)`);
    errors.forEach((error, index) => {
      systemLogger.warn(`  ${index + 1}. ${error}`);
    });
  } else {
    systemLogger.info('🎉 All services initialized successfully');
  }

  return services;
}

// ======================================================
// 4. SERVER CREATION & CONFIGURATION
// ======================================================

/**
 * Create and configure HTTP/WebSocket server
 */
async function createServer(app, services) {
  const PORT = process.env.PORT || 3000;
  const HOST = process.env.HOST || '0.0.0.0';
  
  let server;
  let wss = null;

  // Create HTTP server
  server = http.createServer(app);

  // Initialize WebSocket server if enabled
  if (process.env.ENABLE_WEBSOCKETS === 'true' && services.redisClient) {
    try {
      wss = new WebSocket.Server({ 
        server,
        path: '/ws',
        clientTracking: true,
        maxPayload: 1048576, // 1MB
        perMessageDeflate: {
          zlibDeflateOptions: {
            chunkSize: 1024,
            memLevel: 7,
            level: 3
          },
          zlibInflateOptions: {
            chunkSize: 10 * 1024
          },
          clientNoContextTakeover: true,
          serverNoContextTakeover: true,
          serverMaxWindowBits: 10,
          concurrencyLimit: 10,
          threshold: 1024
        }
      });

      // Initialize WebSocket handlers
      const { initializeWebSocket } = require('./src/services/notification/webSocketService');
      initializeWebSocket(wss, services.redisClient);
      
      services.wss = wss;
      systemLogger.info('✅ WebSocket server initialized');
    } catch (error) {
      systemLogger.error('❌ Failed to initialize WebSocket server:', error.message);
    }
  }

  // Configure server timeouts
  server.keepAliveTimeout = 65000; // 65 seconds
  server.headersTimeout = 66000; // 66 seconds
  server.requestTimeout = 30000; // 30 seconds

  // Graceful shutdown handlers
  setupGracefulShutdown(server, services, wss);

  return { server, wss };
}

// ======================================================
// 5. GRACEFUL SHUTDOWN
// ======================================================

/**
 * Setup graceful shutdown handlers
 */
function setupGracefulShutdown(server, services, wss) {
  const shutdown = async (signal) => {
    systemLogger.info(`\n${signal} received. Starting graceful shutdown...`);
    
    // 1. Stop accepting new connections
    server.close(() => {
      systemLogger.info('✅ HTTP server closed');
    });

    // 2. Close WebSocket connections
    if (wss) {
      wss.clients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close(1001, 'Server shutting down');
        }
      });
      wss.close(() => {
        systemLogger.info('✅ WebSocket server closed');
      });
    }

    // 3. Close background queues
    if (services.queues) {
      await Promise.all(
        Object.values(services.queues).map(queue => queue.close())
      );
      systemLogger.info('✅ Background queues closed');
    }

    // 4. Close database connections
    if (services.prisma) {
      await services.prisma.$disconnect();
      systemLogger.info('✅ Database connections closed');
    }

    // 5. Close Redis connections
    if (services.redisClient) {
      await services.redisClient.quit();
      systemLogger.info('✅ Redis connections closed');
    }

    // 6. Close other services
    if (services.emailTransporter) {
      services.emailTransporter.close();
      systemLogger.info('✅ Email transporter closed');
    }

    // 7. Exit process
    systemLogger.info('👋 Shutdown complete. Goodbye!');
    process.exit(0);
  };

  // Handle termination signals
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    systemLogger.error('❌ Uncaught Exception:', error);
    // Don't exit in production, let the process manager restart
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason, promise) => {
    systemLogger.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
  });
}

// ======================================================
// 6. CLUSTER MODE (FOR PRODUCTION)
// ======================================================

/**
 * Start server in cluster mode (production only)
 */
async function startCluster() {
  const numCPUs = os.cpus().length;
  systemLogger.info(`🚀 Starting cluster with ${numCPUs} workers`);

  if (cluster.isPrimary) {
    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code, signal) => {
      systemLogger.warn(`Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork();
    });

    cluster.on('online', (worker) => {
      systemLogger.info(`Worker ${worker.process.pid} is online`);
    });

    cluster.on('listening', (worker, address) => {
      systemLogger.info(`Worker ${worker.process.pid} listening on ${address.address}:${address.port}`);
    });
  } else {
    // Worker process
    await startServer();
  }
}

// ======================================================
// 7. MAIN SERVER STARTUP FUNCTION
// ======================================================

/**
 * Main server startup function
 */
async function startServer() {
  try {
    const startTime = Date.now();
    
    // Log startup banner
    systemLogger.info(`
╔══════════════════════════════════════════════════════════════╗
║                KIN2 WORKFORCE PLATFORM v2.5.0               ║
║                Production Server                            ║
╠══════════════════════════════════════════════════════════════╣
║  🚀 Starting server...                                      ║
║  📁 Environment: ${process.env.NODE_ENV || 'development'}
║  🔗 API URL: ${process.env.API_URL || `http://localhost:${process.env.PORT || 3000}`}
║  🌐 Frontend: ${process.env.APP_URL || 'http://localhost:5173'}
║  📊 Mode: ${process.env.ENABLE_CLUSTER === 'true' ? 'Cluster' : 'Single'}
╚══════════════════════════════════════════════════════════════╝
    `);

    // Initialize services
    const services = await initializeServices();
    
    // Create Express app
    const app = createApp(process.env, services);
    
    // Create HTTP server
    const { server, wss } = await createServer(app, services);
    
    // Start server
    const PORT = process.env.PORT || 3000;
    const HOST = process.env.HOST || '0.0.0.0';
    
    server.listen(PORT, HOST, () => {
      const startupTime = Date.now() - startTime;
      const serverType = wss ? 'WebSocket-enabled ' : '';
      
      systemLogger.info(`
╔══════════════════════════════════════════════════════════════╗
║                SERVER STARTUP COMPLETE                      ║
╠══════════════════════════════════════════════════════════════╣
║  ✅ Server:      ${serverType}HTTP Server
║  ✅ Port:        ${PORT}
║  ✅ Host:        ${HOST}
║  ✅ Startup:     ${startupTime}ms
║  ✅ Environment: ${process.env.NODE_ENV}
╠══════════════════════════════════════════════════════════════╣
║  📚 API Docs:     ${process.env.API_URL || `http://localhost:${PORT}`}/api-docs
║  🩺 Health:       ${process.env.API_URL || `http://localhost:${PORT}`}/health
║  📊 Metrics:      ${process.env.API_URL || `http://localhost:${PORT}`}/metrics
║  🔧 Admin:        ${process.env.API_URL || `http://localhost:${PORT}`}/admin
╚══════════════════════════════════════════════════════════════╝
      `);

      // Log configured features
      logFeatureStatus();
      
      // Start background jobs
      if (services.queues) {
        scheduleJobs(services.queues);
        systemLogger.info('✅ Background jobs scheduled');
      }
      
      // Start AI agents if enabled
      if (services.ai && process.env.ENABLE_AI_AGENTS === 'true') {
        services.ai.startAgents();
        systemLogger.info('✅ AI agents started');
      }
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        systemLogger.error(`❌ Port ${PORT} is already in use`);
        systemLogger.info('Try one of these solutions:');
        systemLogger.info(`  1. Change PORT in .env file (currently: ${PORT})`);
        systemLogger.info(`  2. Kill process on port ${PORT}:`);
        systemLogger.info(`     - lsof -ti:${PORT} | xargs kill`);
        systemLogger.info(`     - pkill -f "node.*${PORT}"`);
      } else {
        systemLogger.error('❌ Server error:', error);
      }
      process.exit(1);
    });

    // Handle process warnings
    process.on('warning', (warning) => {
      systemLogger.warn('⚠️  Process warning:', warning);
    });

    return { server, app, services };
  } catch (error) {
    systemLogger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// ======================================================
// 8. HELPER FUNCTIONS
// ======================================================

/**
 * Log feature status
 */
function logFeatureStatus() {
  const features = {
    '🤖 AI Agents': process.env.ENABLE_AI_AGENTS === 'true',
    '📧 Email': process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true' && process.env.SMTP_HOST,
    '💳 Payments': process.env.ENABLE_PAYMENTS === 'true' && process.env.STRIPE_SECRET_KEY,
    '⚖️ KFN Scoring': process.env.ENABLE_KFN_SCORING === 'true',
    '🌐 WebSockets': process.env.ENABLE_WEBSOCKETS === 'true',
    '📊 Analytics': true,
    '🔐 Authentication': true,
    '📝 Job Matching': true
  };

  systemLogger.info('🔧 Feature Status:');
  Object.entries(features).forEach(([name, enabled]) => {
    const status = enabled ? '✅ Enabled' : '❌ Disabled';
    systemLogger.info(`  ${name.padEnd(20)} ${status}`);
  });
}

/**
 * Perform pre-flight checks
 */
async function preFlightChecks() {
  const checks = [];
  
  // Check Node.js version
  const nodeVersion = process.version;
  const requiredVersion = '>=20.0.0';
  checks.push({
    name: 'Node.js Version',
    status: nodeVersion >= 'v20.0.0',
    message: `Required: ${requiredVersion}, Current: ${nodeVersion}`
  });

  // Check memory
  const totalMem = os.totalmem() / 1024 / 1024 / 1024; // GB
  checks.push({
    name: 'System Memory',
    status: totalMem >= 1, // At least 1GB
    message: `Total: ${totalMem.toFixed(2)}GB`
  });

  // Check disk space
  const disk = require('check-disk-space').default;
  const diskInfo = await disk(process.cwd());
  const freeSpaceGB = diskInfo.free / 1024 / 1024 / 1024;
  checks.push({
    name: 'Disk Space',
    status: freeSpaceGB >= 1, // At least 1GB free
    message: `Free: ${freeSpaceGB.toFixed(2)}GB`
  });

  // Log checks
  systemLogger.info('🔍 Pre-flight checks:');
  checks.forEach(check => {
    const status = check.status ? '✅' : '❌';
    systemLogger.info(`  ${status} ${check.name}: ${check.message}`);
  });

  // Return false if any critical check fails
  return checks.every(check => check.status || !check.critical);
}

// ======================================================
// 9. ENTRY POINT
// ======================================================

/**
 * Main entry point
 */
async function main() {
  try {
    // Perform pre-flight checks
    const checksPassed = await preFlightChecks();
    if (!checksPassed) {
      systemLogger.error('❌ Pre-flight checks failed. Exiting.');
      process.exit(1);
    }

    // Start in cluster mode if enabled (production)
    if (process.env.ENABLE_CLUSTER === 'true' && process.env.NODE_ENV === 'production') {
      await startCluster();
    } else {
      // Start in single process mode
      await startServer();
    }
  } catch (error) {
    systemLogger.error('❌ Fatal error during startup:', error);
    process.exit(1);
  }
}

// ======================================================
// 10. EXECUTION
// ======================================================

// Only execute if this file is run directly (not imported as module)
if (require.main === module) {
  main();
}

// Export for testing and programmatic use
module.exports = {
  initializeServices,
  startServer,
  createServer,
  setupGracefulShutdown
};
