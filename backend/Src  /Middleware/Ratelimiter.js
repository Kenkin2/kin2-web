/**
 * Advanced rate limiting middleware
 */

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { RateLimitError } = require('./errorHandler');
const { securityLogger } = require('../utils/logger');

/**
 * Create a rate limiter with Redis store
 */
const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, // Limit each IP to 100 requests per windowMs
    message = 'Too many requests, please try again later.',
    skip = () => false,
    keyGenerator = (req) => req.ip,
    store = null,
    ...otherOptions
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: {
      error: message,
      retryAfter: `${Math.ceil(windowMs / 60000)} minutes`
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip,
    keyGenerator,
    store,
    handler: (req, res, next, options) => {
      securityLogger.warn('Rate limit exceeded', {
        ip: req.ip,
        path: req.path,
        method: req.method,
        userId: req.user?.id,
        limit: max,
        windowMs: windowMs
      });
      
      const retryAfter = req.rateLimit?.resetTime 
        ? Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
        : Math.ceil(windowMs / 1000);
      
      res.setHeader('Retry-After', retryAfter);
      next(new RateLimitError(options.message.error));
    },
    ...otherOptions
  });
};

/**
 * Create Redis-based rate limiter
 */
const createRedisRateLimiter = (redisClient, options = {}) => {
  return createRateLimiter({
    store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
      prefix: 'kin2:ratelimit:'
    }),
    ...options
  });
};

/**
 * Per-user rate limiter
 */
const userRateLimiter = (redisClient) => {
  return createRedisRateLimiter(redisClient, {
    keyGenerator: (req) => req.user?.id || req.ip,
    max: 1000, // Higher limit for authenticated users
    skip: (req) => req.user?.role === 'ADMIN'
  });
};

/**
 * Per-IP rate limiter (for anonymous users)
 */
const ipRateLimiter = (redisClient) => {
  return createRedisRateLimiter(redisClient, {
    max: 100,
    skip: (req) => req.user // Skip for authenticated users
  });
};

/**
 * API key rate limiter
 */
const apiKeyRateLimiter = (redisClient) => {
  return createRedisRateLimiter(redisClient, {
    keyGenerator: (req) => req.apiKey?.key || req.ip,
    max: (req) => req.apiKey?.rateLimit || 1000,
    skip: (req) => !req.apiKey
  });
};

/**
 * AI endpoint rate limiter
 */
const aiRateLimiter = (redisClient) => {
  return createRedisRateLimiter(redisClient, {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: (req) => {
      if (req.user?.role === 'ADMIN') return 10000;
      if (req.user?.role === 'EMPLOYER') return 500;
      return 100; // Free tier
    },
    skip: (req) => req.user?.subscription?.plan === 'ENTERPRISE'
  });
};

/**
 * Brute force protection for authentication endpoints
 */
const authRateLimiter = (redisClient) => {
  return createRedisRateLimiter(redisClient, {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: 'Too many login attempts, please try again later.',
    skip: (req) => req.user?.role === 'ADMIN'
  });
};

/**
 * Dynamic rate limiting based on user tier
 */
const tieredRateLimiter = (redisClient) => {
  return createRedisRateLimiter(redisClient, {
    max: (req) => {
      const user = req.user;
      if (!user) return 100; // Anonymous users
      
      switch (user.role) {
        case 'ADMIN':
          return 10000;
        case 'EMPLOYER':
          return user.subscription?.plan === 'ENTERPRISE' ? 5000 : 
                 user.subscription?.plan === 'PROFESSIONAL' ? 2000 : 500;
        case 'WORKER':
          return 1000;
        default:
          return 500;
      }
    }
  });
};

module.exports = {
  createRateLimiter,
  createRedisRateLimiter,
  userRateLimiter,
  ipRateLimiter,
  apiKeyRateLimiter,
  aiRateLimiter,
  authRateLimiter,
  tieredRateLimiter
};
