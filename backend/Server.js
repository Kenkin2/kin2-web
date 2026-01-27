#!/usr/bin/env node

/**
 * █▀▀ █░█ █▄░█ █▀▀ ░░█ █▀ ▀█▀ █▀▀ █▀█ █ █▄░█ █▀▀
 * █▄▄ █▄█ █░▀█ █▀░ █▄█ ▄█ ░█░ ██▄ █▀▄ █ █░▀█ █▄█
 * Kin2 Workforce Platform - Production Server v2.5.0
 * Enterprise-Grade AI-Powered Workforce Management
 */

// ======================================================
// 1. ENVIRONMENT VALIDATION
// ======================================================
require('dotenv').config({ path: `.env.${process.env.NODE_ENV || 'development'}` });

// Check for required environment variables
const requiredEnvVars = [
  'NODE_ENV',
  'PORT',
  'DATABASE_URL',
  'JWT_SECRET',
  'JWT_REFRESH_SECRET',
  'APP_URL',
  'API_URL',
  'CORS_ORIGIN'
];

const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(envVar => console.error(`   - ${envVar}`));
  console.error('\nPlease check your .env file');
  process.exit(1);
}

// Feature flags
const FEATURES = {
  AI_AGENTS: process.env.ENABLE_AI_AGENTS === 'true',
  EMAIL_NOTIFICATIONS: process.env.ENABLE_EMAIL_NOTIFICATIONS === 'true',
  PAYMENTS: process.env.ENABLE_PAYMENTS === 'true',
  KFN_SCORING: process.env.ENABLE_KFN_SCORING === 'true'
};

// ======================================================
// 2. IMPORTS
// ======================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const { PrismaClient } = require('@prisma/client');
const redis = require('redis');
const swaggerUi = require('swagger-ui-express');
const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');
const fs = require('fs');

// Custom middleware and utilities
const { errorHandler } = require('./src/middleware/errorHandler');
const { notFoundHandler } = require('./src/middleware/notFoundHandler');
const { requestLogger, systemLogger, securityLogger } = require('./src/utils/logger');

// ======================================================
// 3. INITIALIZE SERVICES
// ======================================================
const app = express();
const prisma = new PrismaClient();

// Initialize Redis if configured
let redisClient = null;
if (process.env.REDIS_URL) {
  redisClient = redis.createClient({
    url: process.env.REDIS_URL,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 2000)
    }
  });

  redisClient.on('error', (err) => {
    systemLogger.error('Redis connection error:', err);
  });

  redisClient.on('connect', () => {
    systemLogger.info('✅ Redis connected successfully');
  });
}

// ======================================================
// 4. DATABASE HEALTH CHECK
// ======================================================
async function checkDatabaseConnection() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    systemLogger.info('✅ Database connection established');
    return true;
  } catch (error) {
    systemLogger.error('❌ Database connection failed:', error.message);
    
    // Attempt to create database if it doesn't exist (development only)
    if (process.env.NODE_ENV === 'development') {
      systemLogger.warn('Attempting to create database...');
      try {
        const { execSync } = require('child_process');
        execSync('npx prisma db push --accept-data-loss', { stdio: 'inherit' });
        systemLogger.info('✅ Database created and seeded');
        return true;
      } catch (dbError) {
        systemLogger.error('❌ Failed to create database:', dbError.message);
      }
    }
    return false;
  }
}

// ======================================================
// 5. SECURITY MIDDLEWARE
// ======================================================

// Custom security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "http:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      connectSrc: ["'self'", process.env.API_URL, "https://api.deepseek.com", "https://api.stripe.com"]
    }
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// CORS Configuration
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = process.env.CORS_ORIGIN.split(',');
    
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      securityLogger.warn(`Blocked CORS request from origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-API-Key']
};
app.use(cors(corsOptions));

// ======================================================
// 6. RATE LIMITING
// ======================================================

// General rate limiter for all requests
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: process.env.NODE_ENV === 'development' ? 1000 : 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
  skip: (req) => req.ip === '127.0.0.1' // Skip for localhost in development
});

// Slower down for authentication endpoints
const authSpeedLimiter = slowDown({
  windowMs: 15 * 60 * 1000,
  delayAfter: 5,
  delayMs: 100
});

// Apply rate limiting
app.use('/api/', globalLimiter);
app.use('/api/auth/', authSpeedLimiter);

// ======================================================
// 7. REQUEST PARSING & LOGGING
// ======================================================

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());

// Compression
app.use(compression({ level: 6 }));

// Morgan logging configuration
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
const morganStream = {
  write: (message) => requestLogger.info(message.trim())
};
app.use(morgan(morganFormat, { stream: morganStream }));

// Request ID middleware
app.use((req, res, next) => {
  req.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
  req.startTime = Date.now();
  next();
});

// ======================================================
// 8. STATIC FILES
// ======================================================

// Serve uploaded files
if (fs.existsSync(path.join(__dirname, 'uploads'))) {
  app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      // Security headers for uploaded files
      res.set('X-Content-Type-Options', 'nosniff');
      
      // Don't cache sensitive files
      if (filePath.includes('resumes') || filePath.includes('private')) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      }
    }
  }));
}

// Serve API documentation
app.use('/api-docs', express.static(path.join(__dirname, 'docs')));

// ======================================================
// 9. SWAGGER/OPENAPI DOCUMENTATION
// ======================================================

const swaggerOptions = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Kin2 Workforce Platform API',
      version: '2.5.0',
      description: 'Enterprise AI-powered workforce management platform',
      contact: {
        name: 'Kin2 Support',
        email: 'support@kin2.co.uk',
        url: 'https://kin2.co.uk'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: process.env.API_URL || 'http://localhost:3000',
        description: process.env.NODE_ENV === 'production' ? 'Production server' : 'Development server'
      }
    ],
    components: {
      securitySchemes: {
        BearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT'
        },
        ApiKeyAuth: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key'
        }
      }
    },
    security: [{
      BearerAuth: []
    }]
  },
  apis: [
    './src/routes/*.js',
    './src/controllers/*.js',
    './src/services/**/*.js'
  ]
};

const swaggerSpec = swaggerJsdoc(swaggerOptions);
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// ======================================================
// 10. HEALTH CHECK ENDPOINTS
// ======================================================

// Basic health check
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    nodeVersion: process.version,
    environment: process.env.NODE_ENV,
    features: FEATURES
  });
});

// Detailed health check
app.get('/health/detailed', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check database
  try {
    await prisma.$queryRaw`SELECT 1`;
    healthCheck.services.database = { status: 'healthy', latency: Date.now() - req.startTime + 'ms' };
  } catch (error) {
    healthCheck.services.database = { status: 'unhealthy', error: error.message };
    healthCheck.status = 'degraded';
  }

  // Check Redis
  if (redisClient) {
    try {
      await redisClient.ping();
      healthCheck.services.redis = { status: 'healthy' };
    } catch (error) {
      healthCheck.services.redis = { status: 'unhealthy', error: error.message };
      healthCheck.status = 'degraded';
    }
  }

  // Check external services (if configured)
  if (process.env.DEEPSEEK_API_KEY) {
    healthCheck.services.ai = { status: 'configured' };
  }

  if (process.env.STRIPE_SECRET_KEY) {
    healthCheck.services.payments = { status: 'configured' };
  }

  res.status(healthCheck.status === 'healthy' ? 200 : 503).json(healthCheck);
});

// ======================================================
// 11. API ROUTES
// ======================================================

// Import route modules
const authRoutes = require('./src/routes/auth.routes');
const userRoutes = require('./src/routes/user.routes');
const employerRoutes = require('./src/routes/employer.routes');
const workerRoutes = require('./src/routes/worker.routes');
const jobRoutes = require('./src/routes/job.routes');
const applicationRoutes = require('./src/routes/application.routes');
const aiRoutes = require('./src/routes/ai.routes');
const kfnRoutes = require('./src/routes/kfn.routes');
const paymentRoutes = require('./src/routes/payment.routes');
const notificationRoutes = require('./src/routes/notification.routes');
const analyticsRoutes = require('./src/routes/analytics.routes');
const adminRoutes = require('./src/routes/admin.routes');

// Mount routes with versioning
const API_VERSION = 'v1';
const apiBase = `/api/${API_VERSION}`;

// Public routes
app.use(`${apiBase}/auth`, authRoutes);
app.use(`${apiBase}/health`, (req, res) => res.json({ status: 'ok' }));

// Protected routes (with auth middleware)
const { verifyToken, checkRole } = require('./src/middleware/auth');

// User routes (authenticated)
app.use(`${apiBase}/users`, verifyToken, userRoutes);

// Role-based routes
app.use(`${apiBase}/employers`, verifyToken, checkRole(['EMPLOYER', 'ADMIN']), employerRoutes);
app.use(`${apiBase}/workers`, verifyToken, checkRole(['WORKER', 'ADMIN']), workerRoutes);

// Job marketplace (mixed access)
app.use(`${apiBase}/jobs`, jobRoutes); // Some endpoints public, some protected
app.use(`${apiBase}/applications`, verifyToken, applicationRoutes);

// AI routes (protected, rate limited)
const aiLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: process.env.NODE_ENV === 'development' ? 1000 : 50, // 50 AI calls per hour per IP
  message: { error: 'Too many AI requests, please try again later.' }
});

app.use(`${apiBase}/ai`, verifyToken, aiLimiter, aiRoutes);
app.use(`${apiBase}/kfn`, verifyToken, kfnRoutes);

// Payment routes
if (FEATURES.PAYMENTS) {
  app.use(`${apiBase}/payments`, verifyToken, paymentRoutes);
  
  // Stripe webhook needs raw body
  app.post('/stripe-webhook', 
    express.raw({ type: 'application/json' }),
    require('./src/routes/payment.routes').handleStripeWebhook
  );
}

// Notification routes
if (FEATURES.EMAIL_NOTIFICATIONS) {
  app.use(`${apiBase}/notifications`, verifyToken, notificationRoutes);
}

// Analytics routes
app.use(`${apiBase}/analytics`, verifyToken, checkRole(['EMPLOYER', 'ADMIN']), analyticsRoutes);

// Admin routes
app.use(`${apiBase}/admin`, verifyToken, checkRole(['ADMIN']), adminRoutes);

// ======================================================
// 12. WEBSOCKET SETUP (FOR REAL-TIME UPDATES)
// ======================================================

let wss = null;
if (process.env.ENABLE_WEBSOCKETS === 'true') {
  const WebSocket = require('ws');
  const http = require('http');
  const server = http.createServer(app);
  
  wss = new WebSocket.Server({ 
    server,
    path: '/ws',
    clientTracking: true
  });

  // WebSocket connection handling
  require('./src/services/notification/webSocketService')(wss);
  
  systemLogger.info('✅ WebSocket server initialized');
}

// ======================================================
// 13. ERROR HANDLING MIDDLEWARE
// ======================================================

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

// Graceful shutdown handler
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

// ======================================================
// 14. SERVER INITIALIZATION
// ======================================================

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    // Check database connection
    const dbConnected = await checkDatabaseConnection();
    if (!dbConnected) {
      throw new Error('Failed to connect to database');
    }

    // Connect to Redis if configured
    if (redisClient) {
      await redisClient.connect();
    }

    // Start server
    const server = wss ? require('http').createServer(app) : app;
    
    server.listen(PORT, () => {
      const serverType = wss ? 'WebSocket-enabled ' : '';
      systemLogger.info(`
╔══════════════════════════════════════════════════════════════╗
║                KIN2 WORKFORCE PLATFORM v2.5.0               ║
║                ${serverType}Production Server                ║
╠══════════════════════════════════════════════════════════════╣
║  🔗 API URL:      ${process.env.API_URL || `http://localhost:${PORT}`}
║  🌐 Frontend:     ${process.env.APP_URL || 'http://localhost:5173'}
║  📊 Environment:  ${process.env.NODE_ENV || 'development'}
║  🗄️  Database:     Connected
║  🤖 AI Agents:    ${FEATURES.AI_AGENTS ? 'Enabled' : 'Disabled'}
║  💳 Payments:     ${FEATURES.PAYMENTS ? 'Enabled' : 'Disabled'}
║  📧 Notifications:${FEATURES.EMAIL_NOTIFICATIONS ? 'Enabled' : 'Disabled'}
║  ⚖️  KFN Scoring:  ${FEATURES.KFN_SCORING ? 'Enabled' : 'Disabled'}
╠══════════════════════════════════════════════════════════════╣
║  📚 API Docs:     ${process.env.API_URL || `http://localhost:${PORT}`}/api/docs
║  🩺 Health Check: ${process.env.API_URL || `http://localhost:${PORT}`}/health
║  🔐 Admin:        ${process.env.API_URL || `http://localhost:${PORT}`}/api/v1/admin
╚══════════════════════════════════════════════════════════════╝
      `);

      // Log startup complete
      systemLogger.info(`✅ Server is running on port ${PORT}`);
      
      // Initialize AI agents if enabled
      if (FEATURES.AI_AGENTS) {
        const aiService = require('./src/services/ai');
        aiService.initializeAgents()
          .then(() => systemLogger.info('✅ AI agents initialized'))
          .catch(err => systemLogger.error('❌ Failed to initialize AI agents:', err));
      }

      // Start background jobs
      startBackgroundJobs();
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        systemLogger.error(`❌ Port ${PORT} is already in use`);
        systemLogger.info('Try:');
        systemLogger.info('  1. Change PORT in .env file');
        systemLogger.info(`  2. Kill process: lsof -ti:${PORT} | xargs kill`);
      } else {
        systemLogger.error('❌ Server error:', error);
      }
      process.exit(1);
    });

    return server;
  } catch (error) {
    systemLogger.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

// ======================================================
// 15. BACKGROUND JOBS
// ======================================================

function startBackgroundJobs() {
  // Cleanup expired sessions (runs every hour)
  setInterval(async () => {
    try {
      const { cleanupExpiredSessions } = require('./src/services/authService');
      const deletedCount = await cleanupExpiredSessions();
      if (deletedCount > 0) {
        systemLogger.debug(`Cleaned up ${deletedCount} expired sessions`);
      }
    } catch (error) {
      systemLogger.error('Failed to cleanup sessions:', error);
    }
  }, 60 * 60 * 1000); // 1 hour

  // Generate daily analytics (runs at midnight)
  const schedule = require('node-schedule');
  schedule.scheduleJob('0 0 * * *', async () => {
    try {
      const { generateDailyReport } = require('./src/services/analyticsService');
      await generateDailyReport();
      systemLogger.info('Daily analytics report generated');
    } catch (error) {
      systemLogger.error('Failed to generate daily report:', error);
    }
  });

  // AI agent health check (runs every 5 minutes)
  setInterval(async () => {
    if (FEATURES.AI_AGENTS) {
      try {
        const aiService = require('./src/services/ai');
        const status = await aiService.checkAgentsHealth();
        if (!status.healthy) {
          systemLogger.warn('AI agent health check failed:', status);
        }
      } catch (error) {
        systemLogger.error('AI health check error:', error);
      }
    }
  }, 5 * 60 * 1000); // 5 minutes

  systemLogger.info('✅ Background jobs initialized');
}

// ======================================================
// 16. GRACEFUL SHUTDOWN
// ======================================================

async function gracefulShutdown(signal) {
  systemLogger.info(`\n${signal} received. Starting graceful shutdown...`);
  
  // 1. Stop accepting new connections
  if (wss) {
    wss.close();
  }
  
  // 2. Close database connection
  try {
    await prisma.$disconnect();
    systemLogger.info('✅ Database connection closed');
  } catch (error) {
    systemLogger.error('❌ Error closing database connection:', error);
  }
  
  // 3. Close Redis connection
  if (redisClient) {
    try {
      await redisClient.quit();
      systemLogger.info('✅ Redis connection closed');
    } catch (error) {
      systemLogger.error('❌ Error closing Redis connection:', error);
    }
  }
  
  // 4. Exit process
  systemLogger.info('👋 Shutdown complete. Goodbye!');
  process.exit(0);
}

// ======================================================
// 17. UNCAUGHT EXCEPTION HANDLING
// ======================================================

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

// ======================================================
// 18. START THE SERVER
// ======================================================

// Only start if this file is run directly (not required as module)
if (require.main === module) {
  startServer().catch(error => {
    systemLogger.error('Failed to start server:', error);
    process.exit(1);
  });
}

// Export for testing
module.exports = {
  app,
  prisma,
  redisClient,
  startServer,
  gracefulShutdown
};
