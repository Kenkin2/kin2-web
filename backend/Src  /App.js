/**
 * █▀▀ █░█ █▄░█ █▀▀ ░░█ █▀ ▀█▀ █▀▀ █▀█ █ █▄░█ █▀▀
 * █▄▄ █▄█ █░▀█ █▀░ █▄█ ▄█ ░█░ ██▄ █▀▄ █ █░▀█ █▄█
 * Kin2 Workforce Platform - Express Application v2.5.0
 * Main application configuration and middleware setup
 */

// ======================================================
// 1. IMPORTS & DEPENDENCIES
// ======================================================
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const rateLimit = require('express-rate-limit');
const slowDown = require('express-slow-down');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const RedisStore = require('connect-redis').default;
const mongoSanitize = require('express-mongo-sanitize');
const hpp = require('hpp');
const xss = require('xss-clean');
const path = require('path');
const fs = require('fs');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

// Custom middleware
const { errorHandler } = require('./middleware/errorHandler');
const { notFoundHandler } = require('./middleware/notFoundHandler');
const { requestLogger, securityLogger } = require('./utils/logger');
const { verifyToken, checkRole } = require('./middleware/auth');
const { validateRequest } = require('./middleware/validation');
const { auditLogger } = require('./middleware/auditLogger');
const { rateLimiter } = require('./middleware/rateLimiter');

// ======================================================
// 2. CREATE EXPRESS APPLICATION
// ======================================================

/**
 * Create and configure Express application
 * @param {Object} config - Application configuration
 * @param {Object} services - External services (Redis, Prisma, etc.)
 * @returns {express.Application} Configured Express application
 */
function createApp(config, services = {}) {
  const app = express();
  
  // Store configuration and services in app locals
  app.locals.config = config;
  app.locals.services = services;
  app.locals.startTime = new Date();

  // ======================================================
  // 3. SECURITY MIDDLEWARE
  // ======================================================

  // 3.1 Helmet.js - Security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: ["'self'", "data:", "https:", "http:", "blob:"],
        scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        connectSrc: [
          "'self'",
          config.API_URL,
          config.APP_URL,
          "https://api.deepseek.com",
          "https://api.openai.com",
          "https://api.stripe.com",
          "https://api.sentry.io",
          "ws://localhost:3000",
          "wss://" + new URL(config.APP_URL).hostname
        ],
        frameSrc: ["'self'", "https://js.stripe.com"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'", "blob:"],
        childSrc: ["'self'", "blob:"]
      }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginOpenerPolicy: { policy: "same-origin" },
    dnsPrefetchControl: { allow: false },
    frameguard: { action: 'deny' },
    hidePoweredBy: true,
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true
    },
    ieNoOpen: true,
    noSniff: true,
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' }
  }));

  // 3.2 CORS Configuration
  const corsOptions = {
    origin: (origin, callback) => {
      const allowedOrigins = config.CORS_ORIGIN.split(',');
      
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin && config.NODE_ENV !== 'production') {
        return callback(null, true);
      }
      
      // Check if origin is allowed
      if (allowedOrigins.includes(origin) || 
          config.NODE_ENV === 'development' || 
          origin && origin.includes('localhost')) {
        callback(null, true);
      } else {
        securityLogger.warn(`Blocked CORS request from origin: ${origin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    optionsSuccessStatus: 200,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'X-API-Key',
      'X-Request-ID',
      'X-Client-Version',
      'X-Platform'
    ],
    exposedHeaders: [
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset'
    ],
    maxAge: 86400 // 24 hours
  };
  
  app.use(cors(corsOptions));

  // 3.3 Request Parsing Security
  app.use(express.json({
    limit: config.MAX_REQUEST_SIZE || '10mb',
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  }));
  
  app.use(express.urlencoded({
    extended: true,
    limit: config.MAX_REQUEST_SIZE || '10mb',
    parameterLimit: 100
  }));

  // 3.4 Input Sanitization
  app.use(mongoSanitize({
    replaceWith: '_',
    onSanitize: ({ req, key }) => {
      securityLogger.warn(`Sanitized mongo injection in ${req.method} ${req.url}: ${key}`);
    }
  }));

  app.use(xss());
  app.use(hpp({
    whitelist: [
      'filter',
      'sort',
      'limit',
      'page',
      'search',
      'category',
      'tags'
    ]
  }));

  // ======================================================
  // 4. SESSION & AUTHENTICATION
  // ======================================================

  // 4.1 Session Configuration
  let sessionStore;
  
  if (services.redisClient && config.ENABLE_REDIS_SESSIONS === 'true') {
    sessionStore = new RedisStore({
      client: services.redisClient,
      prefix: 'kin2:sess:',
      ttl: config.SESSION_MAX_AGE || 86400
    });
  }

  app.use(session({
    store: sessionStore,
    secret: config.SESSION_SECRET,
    name: config.SESSION_NAME || 'kin2.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'strict',
      maxAge: config.SESSION_MAX_AGE || 86400000,
      domain: config.NODE_ENV === 'production' ? `.${new URL(config.APP_URL).hostname}` : undefined
    },
    rolling: true
  }));

  // 4.2 Cookie Parser
  app.use(cookieParser(config.SESSION_SECRET));

  // ======================================================
  // 5. RATE LIMITING & THROTTLING
  // ======================================================

  // 5.1 Global Rate Limiter
  const globalLimiter = rateLimit({
    windowMs: config.RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000, // 15 minutes
    max: config.NODE_ENV === 'development' ? 1000 : 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
      // Skip for localhost in development
      if (config.NODE_ENV === 'development' && req.ip === '127.0.0.1') return true;
      // Skip for health checks
      if (req.path === '/health' || req.path === '/health/detailed') return true;
      return false;
    },
    message: {
      error: 'Too many requests from this IP, please try again later.',
      retryAfter: '15 minutes'
    },
    handler: (req, res, next, options) => {
      securityLogger.warn(`Rate limit exceeded for IP: ${req.ip}, Path: ${req.path}`);
      res.status(options.statusCode).json(options.message);
    }
  });

  // 5.2 Slow Down (Traffic Shaping)
  const speedLimiter = slowDown({
    windowMs: 15 * 60 * 1000,
    delayAfter: 50,
    delayMs: 100,
    maxDelayMs: 5000
  });

  // 5.3 Apply Rate Limiting
  app.use('/api/', globalLimiter);
  app.use('/api/auth/', speedLimiter);

  // 5.4 AI Endpoint Specific Rate Limiter
  const aiLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: config.NODE_ENV === 'development' ? 1000 : config.AI_RATE_LIMIT_PER_HOUR || 100,
    message: {
      error: 'Too many AI requests, please try again later.',
      retryAfter: '1 hour'
    },
    skip: (req) => req.user?.role === 'ADMIN'
  });

  // ======================================================
  // 6. LOGGING & MONITORING
  // ======================================================

  // 6.1 Morgan HTTP Logging
  const morganFormat = config.NODE_ENV === 'production' ? 'combined' : 'dev';
  const morganStream = {
    write: (message) => requestLogger.info(message.trim())
  };

  // Custom token for request ID
  morgan.token('req-id', (req) => req.id || '-');
  morgan.token('user-id', (req) => req.user?.id || 'anonymous');
  morgan.token('response-time-ms', (req, res) => {
    if (!req.startTime) return '-';
    const ms = Date.now() - req.startTime;
    return ms.toFixed(3);
  });

  app.use(morgan(morganFormat, {
    stream: morganStream,
    skip: (req) => req.path === '/health' || req.path.startsWith('/_next/')
  }));

  // 6.2 Custom Request Logging Middleware
  app.use((req, res, next) => {
    req.id = Date.now().toString(36) + Math.random().toString(36).substr(2);
    req.startTime = Date.now();
    
    // Add request ID to response headers
    res.setHeader('X-Request-ID', req.id);
    
    // Log request start
    requestLogger.debug('Request started', {
      requestId: req.id,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.get('user-agent')
    });
    
    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - req.startTime;
      const logData = {
        requestId: req.id,
        method: req.method,
        url: req.originalUrl || req.url,
        statusCode: res.statusCode,
        duration: `${duration}ms`,
        ip: req.ip,
        userAgent: req.get('user-agent'),
        userId: req.user?.id || 'anonymous',
        contentLength: res.get('Content-Length') || '-'
      };

      if (res.statusCode >= 500) {
        requestLogger.error('Request error', logData);
      } else if (res.statusCode >= 400) {
        requestLogger.warn('Request warning', logData);
      } else if (duration > 1000) {
        requestLogger.warn('Slow request', { ...logData, threshold: '1000ms' });
      } else {
        requestLogger.info('Request completed', logData);
      }
    });

    next();
  });

  // 6.3 Audit Logging Middleware
  app.use(auditLogger);

  // ======================================================
  // 7. COMPRESSION & PERFORMANCE
  // ======================================================

  app.use(compression({
    level: config.COMPRESSION_LEVEL || 6,
    threshold: config.COMPRESSION_THRESHOLD || 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      return compression.filter(req, res);
    }
  }));

  // ======================================================
  // 8. STATIC FILES & UPLOADS
  // ======================================================

  // 8.1 Uploads directory
  const uploadsDir = path.join(process.cwd(), 'uploads');
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  app.use('/uploads', express.static(uploadsDir, {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      // Security headers for uploaded files
      res.set('X-Content-Type-Options', 'nosniff');
      
      // Don't cache sensitive files
      const sensitivePaths = ['resumes', 'private', 'compliance'];
      if (sensitivePaths.some(path => filePath.includes(path))) {
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
    },
    index: false,
    redirect: false
  }));

  // 8.2 Public directory (if exists)
  const publicDir = path.join(process.cwd(), 'public');
  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir, {
      maxAge: '1d',
      index: false,
      redirect: false
    }));
  }

  // ======================================================
  // 9. API DOCUMENTATION (Swagger/OpenAPI)
  // ======================================================

  if (config.NODE_ENV !== 'production' || config.ENABLE_API_DOCS === 'true') {
    try {
      const swaggerDocument = YAML.load(path.join(process.cwd(), 'docs/openapi.yaml'));
      
      // Custom Swagger UI options
      const swaggerOptions = {
        explorer: true,
        customCss: '.swagger-ui .topbar { display: none }',
        customSiteTitle: 'Kin2 Workforce Platform API',
        customfavIcon: '/favicon.ico',
        swaggerOptions: {
          persistAuthorization: true,
          displayRequestDuration: true,
          docExpansion: 'list',
          filter: true,
          showExtensions: true,
          showCommonExtensions: true,
          tagsSorter: 'alpha',
          operationsSorter: 'method'
        }
      };

      app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerOptions));
      
      // JSON endpoint for OpenAPI spec
      app.get('/api-docs/json', (req, res) => {
        res.json(swaggerDocument);
      });

      console.log('📚 API Documentation available at /api-docs');
    } catch (error) {
      console.warn('⚠️  Could not load OpenAPI documentation:', error.message);
    }
  }

  // ======================================================
  // 10. HEALTH CHECK ENDPOINTS
  // ======================================================

  // 10.1 Basic Health Check
  app.get('/health', (req, res) => {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      nodeVersion: process.version,
      environment: config.NODE_ENV,
      appVersion: config.APP_VERSION || '2.5.0',
      requestId: req.id
    };

    res.status(200).json(health);
  });

  // 10.2 Detailed Health Check
  app.get('/health/detailed', async (req, res) => {
    const startTime = Date.now();
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {},
      checks: []
    };

    // Database Health Check
    try {
      if (services.prisma) {
        await services.prisma.$queryRaw`SELECT 1`;
        health.services.database = {
          status: 'healthy',
          type: 'postgresql',
          latency: `${Date.now() - startTime}ms`
        };
        health.checks.push({ service: 'database', status: 'healthy' });
      } else {
        health.services.database = { status: 'not_configured' };
        health.checks.push({ service: 'database', status: 'not_configured' });
      }
    } catch (error) {
      health.services.database = {
        status: 'unhealthy',
        error: error.message,
        latency: `${Date.now() - startTime}ms`
      };
      health.checks.push({ service: 'database', status: 'unhealthy', error: error.message });
      health.status = 'degraded';
    }

    // Redis Health Check
    try {
      if (services.redisClient) {
        await services.redisClient.ping();
        health.services.redis = { status: 'healthy' };
        health.checks.push({ service: 'redis', status: 'healthy' });
      } else {
        health.services.redis = { status: 'not_configured' };
        health.checks.push({ service: 'redis', status: 'not_configured' });
      }
    } catch (error) {
      health.services.redis = {
        status: 'unhealthy',
        error: error.message
      };
      health.checks.push({ service: 'redis', status: 'unhealthy', error: error.message });
      health.status = 'degraded';
    }

    // AI Service Health Check
    if (config.DEEPSEEK_API_KEY) {
      health.services.ai = { status: 'configured' };
      health.checks.push({ service: 'ai', status: 'configured' });
    }

    // Payment Service Health Check
    if (config.STRIPE_SECRET_KEY) {
      health.services.payments = { status: 'configured' };
      health.checks.push({ service: 'payments', status: 'configured' });
    }

    // Email Service Health Check
    if (config.SMTP_HOST) {
      health.services.email = { status: 'configured' };
      health.checks.push({ service: 'email', status: 'configured' });
    }

    // System Metrics
    health.system = {
      platform: process.platform,
      arch: process.arch,
      cpuCount: require('os').cpus().length,
      totalMemory: require('os').totalmem(),
      freeMemory: require('os').freemem(),
      loadAverage: require('os').loadavg()
    };

    const responseCode = health.status === 'healthy' ? 200 : 503;
    res.status(responseCode).json(health);
  });

  // 10.3 Readiness Probe
  app.get('/health/ready', async (req, res) => {
    const checks = [];
    
    // Database ready check
    try {
      if (services.prisma) {
        await services.prisma.$queryRaw`SELECT 1`;
        checks.push({ service: 'database', status: 'ready' });
      } else {
        checks.push({ service: 'database', status: 'not_configured' });
      }
    } catch (error) {
      checks.push({ service: 'database', status: 'not_ready', error: error.message });
    }

    // Redis ready check
    try {
      if (services.redisClient) {
        await services.redisClient.ping();
        checks.push({ service: 'redis', status: 'ready' });
      } else {
        checks.push({ service: 'redis', status: 'not_configured' });
      }
    } catch (error) {
      checks.push({ service: 'redis', status: 'not_ready', error: error.message });
    }

    const allReady = checks.every(check => check.status === 'ready' || check.status === 'not_configured');
    const status = allReady ? 200 : 503;
    
    res.status(status).json({
      status: allReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks
    });
  });

  // 10.4 Liveness Probe
  app.get('/health/live', (req, res) => {
    res.status(200).json({
      status: 'alive',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // ======================================================
  // 11. API ROUTES (VERSIONED)
  // ======================================================

  // Import route modules
  const authRoutes = require('./routes/auth.routes');
  const userRoutes = require('./routes/user.routes');
  const employerRoutes = require('./routes/employer.routes');
  const workerRoutes = require('./routes/worker.routes');
  const jobRoutes = require('./routes/job.routes');
  const applicationRoutes = require('./routes/application.routes');
  const aiRoutes = require('./routes/ai.routes');
  const kfnRoutes = require('./routes/kfn.routes');
  const paymentRoutes = require('./routes/payment.routes');
  const notificationRoutes = require('./routes/notification.routes');
  const analyticsRoutes = require('./routes/analytics.routes');
  const adminRoutes = require('./routes/admin.routes');
  const publicRoutes = require('./routes/public.routes');
  const webhookRoutes = require('./routes/webhook.routes');

  // API Version
  const API_VERSION = 'v1';
  const apiBase = `/api/${API_VERSION}`;

  // 11.1 Public Routes (No Authentication Required)
  app.use(`${apiBase}/auth`, authRoutes);
  app.use(`${apiBase}/public`, publicRoutes);
  
  // Webhook endpoints (needs raw body)
  app.use('/webhooks', webhookRoutes);

  // 11.2 Protected Routes (Authentication Required)
  
  // User management
  app.use(`${apiBase}/users`, verifyToken, userRoutes);
  
  // Role-based routes
  app.use(`${apiBase}/employers`, verifyToken, checkRole(['EMPLOYER', 'ADMIN']), employerRoutes);
  app.use(`${apiBase}/workers`, verifyToken, checkRole(['WORKER', 'ADMIN']), workerRoutes);
  
  // Job marketplace
  app.use(`${apiBase}/jobs`, jobRoutes); // Mixed access - some public, some protected
  app.use(`${apiBase}/applications`, verifyToken, applicationRoutes);
  
  // AI & KFN routes
  app.use(`${apiBase}/ai`, verifyToken, aiLimiter, aiRoutes);
  app.use(`${apiBase}/kfn`, verifyToken, kfnRoutes);
  
  // Payment routes
  if (config.ENABLE_PAYMENTS === 'true') {
    app.use(`${apiBase}/payments`, verifyToken, paymentRoutes);
  }
  
  // Notification routes
  if (config.ENABLE_EMAIL_NOTIFICATIONS === 'true') {
    app.use(`${apiBase}/notifications`, verifyToken, notificationRoutes);
  }
  
  // Analytics routes
  app.use(`${apiBase}/analytics`, verifyToken, checkRole(['EMPLOYER', 'ADMIN']), analyticsRoutes);
  
  // Admin routes
  app.use(`${apiBase}/admin`, verifyToken, checkRole(['ADMIN']), adminRoutes);

  // ======================================================
  // 12. ERROR HANDLING MIDDLEWARE
  // ======================================================

  // 12.1 404 Handler
  app.use(notFoundHandler);

  // 12.2 Global Error Handler
  app.use(errorHandler);

  // ======================================================
  // 13. APPLICATION METADATA
  // ======================================================

  // Add application info endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'Kin2 Workforce Platform',
      version: '2.5.0',
      description: 'Enterprise AI-powered workforce management platform',
      environment: config.NODE_ENV,
      documentation: config.NODE_ENV !== 'production' ? `${req.protocol}://${req.get('host')}/api-docs` : null,
      health: `${req.protocol}://${req.get('host')}/health`,
      status: 'operational',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    });
  });

  // API information endpoint
  app.get('/api', (req, res) => {
    res.json({
      api: {
        name: 'Kin2 Workforce Platform API',
        version: API_VERSION,
        baseUrl: `${req.protocol}://${req.get('host')}${apiBase}`,
        authentication: 'JWT Bearer Token',
        rateLimiting: '100 requests per 15 minutes',
        documentation: `${req.protocol}://${req.get('host')}/api-docs`
      },
      endpoints: {
        auth: `${apiBase}/auth`,
        users: `${apiBase}/users`,
        jobs: `${apiBase}/jobs`,
        ai: `${apiBase}/ai`,
        payments: `${apiBase}/payments`,
        admin: `${apiBase}/admin`
      }
    });
  });

  // ======================================================
  // 14. DEVELOPMENT TOOLS
  // ======================================================

  if (config.NODE_ENV === 'development') {
    // Request/Response debugging middleware
    app.use((req, res, next) => {
      if (req.query._debug === 'true') {
        console.log('\n=== DEBUG REQUEST ===');
        console.log('Method:', req.method);
        console.log('URL:', req.url);
        console.log('Headers:', req.headers);
        console.log('Body:', req.body);
        console.log('Query:', req.query);
        console.log('Params:', req.params);
        console.log('User:', req.user);
        console.log('====================\n');
      }
      next();
    });

    // Add request timing header in development
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const duration = Date.now() - start;
        res.setHeader('X-Response-Time', `${duration}ms`);
      });
      next();
    });
  }

  // ======================================================
  // 15. FINAL SETUP
  // ======================================================

  // Trust proxy settings
  app.set('trust proxy', config.TRUST_PROXY || 1);

  // Disable x-powered-by header (handled by helmet)
  app.disable('x-powered-by');

  // Set application settings
  app.set('json spaces', config.NODE_ENV === 'development' ? 2 : 0);
  app.set('json replacer', null);
  app.set('case sensitive routing', false);
  app.set('strict routing', false);
  app.set('view cache', true);

  console.log('✅ Express application configured successfully');
  
  // Log configured routes in development
  if (config.NODE_ENV === 'development') {
    setTimeout(() => {
      console.log('\n📋 Configured Routes:');
      const routes = [];
      app._router.stack.forEach((middleware) => {
        if (middleware.route) {
          // Routes registered directly on the app
          const methods = Object.keys(middleware.route.methods).join(', ').toUpperCase();
          routes.push(`${methods.padEnd(8)} ${middleware.route.path}`);
        } else if (middleware.name === 'router') {
          // Router middleware
          middleware.handle.stack.forEach((handler) => {
            if (handler.route) {
              const methods = Object.keys(handler.route.methods).join(', ').toUpperCase();
              routes.push(`${methods.padEnd(8)} ${handler.route.path}`);
            }
          });
        }
      });
      
      routes.sort().forEach(route => console.log(`  ${route}`));
      console.log(`\n🚀 Total routes: ${routes.length}`);
    }, 100);
  }

  return app;
}

// ======================================================
// 16. EXPORTS
// ======================================================

module.exports = {
  createApp
};

// For backward compatibility
module.exports.default = createApp;
