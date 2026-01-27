const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { createClient } = require('redis');

// Create Redis client if REDIS_URL is set
let redisClient = null;
let redisStore = null;

if (process.env.REDIS_URL) {
  redisClient = createClient({
    url: process.env.REDIS_URL
  });

  redisClient.on('error', (err) => {
    console.error('Redis error:', err);
  });

  redisStore = new RedisStore({
    sendCommand: (...args) => redisClient.sendCommand(args),
  });
}

// General rate limiter
const generalLimiter = rateLimit({
  store: redisStore,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks and certain paths
    return req.path === '/health' || req.path === '/api-docs';
  }
});

// Authentication rate limiter (stricter)
const authLimiter = rateLimit({
  store: redisStore,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // Limit each IP to 10 auth requests per windowMs
  message: 'Too many authentication attempts, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true // Don't count successful logins
});

// API key rate limiter (for higher limits)
const apiKeyLimiter = rateLimit({
  store: redisStore,
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Higher limit for API keys
  message: 'API rate limit exceeded',
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    // Use API key if provided, otherwise use IP
    return req.headers['x-api-key'] || req.ip;
  }
});

// Job posting rate limiter (for employers)
const jobPostLimiter = rateLimit({
  store: redisStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10, // Limit to 10 job posts per hour
  message: 'Too many job postings, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip for admins
    return req.userRole === 'ADMIN';
  }
});

// Application submission rate limiter (for workers)
const applicationLimiter = rateLimit({
  store: redisStore,
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 20, // Limit to 20 applications per hour
  message: 'Too many applications, please try again later.',
  standardHeaders: true,
  legacyHeaders: false
});

// Dynamic rate limiter based on user role
const dynamicLimiter = (options = {}) => {
  return rateLimit({
    store: redisStore,
    windowMs: options.windowMs || 15 * 60 * 1000,
    max: (req) => {
      // Set different limits based on user role
      if (req.userRole === 'ADMIN') return 1000;
      if (req.userRole === 'EMPLOYER') return 500;
      if (req.userRole === 'WORKER') return 200;
      return 100; // Default for unauthenticated users
    },
    message: options.message || 'Rate limit exceeded',
    standardHeaders: true,
    legacyHeaders: false,
    skip: options.skip
  });
};

// Rate limiter for specific endpoints
const endpointLimiters = {
  '/api/auth/login': authLimiter,
  '/api/auth/register': authLimiter,
  '/api/jobs': generalLimiter,
  '/api/jobs/:id/apply': applicationLimiter,
  '/api/employer/jobs': jobPostLimiter
};

// Middleware to apply appropriate rate limiter
const smartRateLimit = (req, res, next) => {
  const path = req.path;
  
  // Check if there's a specific limiter for this endpoint
  for (const [endpoint, limiter] of Object.entries(endpointLimiters)) {
    if (path.startsWith(endpoint.replace(':id', ''))) {
      return limiter(req, res, next);
    }
  }
  
  // Default to general limiter
  return generalLimiter(req, res, next);
};

module.exports = {
  generalLimiter,
  authLimiter,
  apiKeyLimiter,
  jobPostLimiter,
  applicationLimiter,
  dynamicLimiter,
  smartRateLimit,
  redisClient
};
