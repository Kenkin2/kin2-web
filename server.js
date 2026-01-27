const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware
app.use(helmet());

// CORS Configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body Parser
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging
app.use(morgan('combined'));

// Serve static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// General Rate Limiter
const generalLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

app.use('/api/', generalLimiter);

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API Routes
app.use('/api/auth', require('./src/routes/auth.routes'));
app.use('/api/users', require('./src/routes/user.routes'));
app.use('/api/workers', require('./src/routes/worker.routes'));
app.use('/api/employers', require('./src/routes/employer.routes'));
app.use('/api/jobs', require('./src/routes/job.routes'));
app.use('/api/applications', require('./src/routes/application.routes'));
app.use('/api/ai', require('./src/routes/ai.routes'));
app.use('/api/kfn', require('./src/routes/kfn.routes'));
app.use('/api/payments', require('./src/routes/payment.routes'));
app.use('/api/notifications', require('./src/routes/notification.routes'));
app.use('/api/analytics', require('./src/routes/analytics.routes'));
app.use('/api/admin', require('./src/routes/admin.routes'));

// 404 Handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Route not found',
    path: req.originalUrl,
    method: req.method
  });
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  
  // Prisma Errors
  if (err.code && err.code.startsWith('P')) {
    return res.status(400).json({
      error: 'Database operation failed',
      message: process.env.NODE_ENV === 'development' ? err.message : 'Operation failed'
    });
  }

  // JWT Errors
  if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'Authentication failed',
      message: err.message
    });
  }

  // Validation Errors
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation failed',
      details: err.details || err.message
    });
  }

  // Default Error Response
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

// Start Server
const server = app.listen(PORT, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🚀  KIN2 WORKFORCE PLATFORM - BACKEND SERVER           ║
║                                                           ║
║   🌐  Server:      http://localhost:${PORT}                  ║
║   🩺  Health:      http://localhost:${PORT}/health          ║
║   📚  API Docs:    http://localhost:${PORT}/api-docs        ║
║                                                           ║
║   📦  Environment: ${process.env.NODE_ENV || 'development'}
║   🔧  Node:        ${process.version}                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
  `);
});

// Graceful Shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT signal received: closing HTTP server');
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
});

module.exports = app;
