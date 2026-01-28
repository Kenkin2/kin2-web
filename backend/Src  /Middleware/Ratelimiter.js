// src/middleware/ratelimit.js
const Redis = require('ioredis');
const crypto = require('crypto');

class RateLimitService {
  constructor(config = {}) {
    this.config = {
      // Redis configuration
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      
      // Default limits
      defaultLimits: {
        // Global limits
        global: {
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: 1000, // 1000 requests per window
        },
        
        // Authentication endpoints
        auth: {
          windowMs: 15 * 60 * 1000, // 15 minutes
          max: 10, // 10 login attempts
        },
        
        // Registration endpoints
        registration: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 5, // 5 registrations per hour
        },
        
        // Password reset
        passwordReset: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 5, // 5 reset attempts
        },
        
        // Job posting
        jobPost: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 10, // 10 job posts per hour
        },
        
        // Job applications
        jobApply: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 50, // 50 applications per hour
        },
        
        // API endpoints
        api: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 1000, // 1000 API calls per hour
        },
        
        // Search endpoints
        search: {
          windowMs: 60 * 1000, // 1 minute
          max: 60, // 60 searches per minute
        },
        
        // File uploads
        upload: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 20, // 20 uploads per hour
        },
        
        // Messaging
        messaging: {
          windowMs: 60 * 1000, // 1 minute
          max: 30, // 30 messages per minute
        },
        
        // Email sending
        email: {
          windowMs: 60 * 60 * 1000, // 1 hour
          max: 100, // 100 emails per hour
        },
      },
      
      // Role-based limits
      roleLimits: {
        guest: {
          global: { windowMs: 15 * 60 * 1000, max: 100 },
          search: { windowMs: 60 * 1000, max: 30 },
        },
        candidate: {
          global: { windowMs: 15 * 60 * 1000, max: 500 },
          jobApply: { windowMs: 60 * 60 * 1000, max: 100 },
          search: { windowMs: 60 * 1000, max: 60 },
        },
        employer: {
          global: { windowMs: 15 * 60 * 1000, max: 1000 },
          jobPost: { windowMs: 60 * 60 * 1000, max: 50 },
          candidateSearch: { windowMs: 60 * 1000, max: 120 },
        },
        admin: {
          global: { windowMs: 15 * 60 * 1000, max: 5000 },
        },
        superadmin: {
          global: { windowMs: 15 * 60 * 1000, max: 10000 },
        },
      },
      
      // Burst protection
      burstProtection: {
        enabled: true,
        burstWindowMs: 1000, // 1 second
        burstMax: 10, // 10 requests per second
      },
      
      // Slow down/delay settings
      slowDown: {
        enabled: true,
        delayAfter: 10, // requests
        delayMs: 100, // milliseconds
        maxDelayMs: 5000,
      },
      
      // Retry-After header
      retryAfter: 'window', // 'window' or 'reset'
      
      // Skip options
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      trustProxy: true,
      
      // Headers
      headers: true,
      draft_polli_ratelimit_headers: false, // RFC draft headers
      
      // Logging
      logLevel: 'warn', // 'debug', 'info', 'warn', 'error'
      logger: console,
    };

    // Initialize Redis client if URL is provided
    if (this.config.redisUrl) {
      this.redis = new Redis(this.config.redisUrl, {
        retryStrategy: (times) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });

      this.redis.on('error', (err) => {
        console.error('Redis rate limit error:', err);
      });
    } else {
      // Fallback to in-memory store
      this.store = new Map();
      console.warn('Rate limiting using in-memory store (not recommended for production)');
    }

    // Statistics
    this.stats = {
      totalRequests: 0,
      limitedRequests: 0,
      byEndpoint: new Map(),
      byIP: new Map(),
      byUser: new Map(),
    };

    // Cleanup interval for in-memory store
    if (!this.redis) {
      setInterval(() => this.cleanupMemoryStore(), 60 * 1000);
    }
  }

  /**
   * Main rate limiting middleware
   */
  limit(options = {}) {
    return async (req, res, next) => {
      try {
        // Skip rate limiting for certain conditions
        if (this.shouldSkip(req, options)) {
          return next();
        }

        // Generate rate limit key
        const key = this.generateKey(req, options);
        
        // Get limits for this request
        const limits = this.getLimits(req, options);
        
        // Check all limits
        const results = await Promise.all(
          limits.map(limit => this.checkLimit(key, limit, req))
        );

        // Check if any limit is exceeded
        const exceededLimit = results.find(result => !result.allowed);
        
        if (exceededLimit) {
          return this.handleLimitExceeded(req, res, exceededLimit, results);
        }

        // Apply slowdown if configured
        if (this.config.slowDown.enabled) {
          await this.applySlowDown(key, req, res);
        }

        // Add rate limit headers
        if (this.config.headers) {
          this.addHeaders(res, results);
        }

        // Update statistics
        this.updateStats(req, results);

        next();
      } catch (error) {
        console.error('Rate limiting error:', error);
        // Don't block requests if rate limiting fails
        next();
      }
    };
  }

  /**
   * Check a specific rate limit
   */
  async checkLimit(key, limit, req) {
    const { windowMs, max, weight = 1 } = limit;
    const now = Date.now();
    const windowStart = now - windowMs;
    
    // Generate unique key for this limit
    const limitKey = `${key}:${windowMs}:${max}`;
    
    try {
      if (this.redis) {
        // Redis implementation
        return await this.checkRedisLimit(limitKey, now, windowMs, max, weight);
      } else {
        // In-memory implementation
        return this.checkMemoryLimit(limitKey, now, windowStart, max, weight);
      }
    } catch (error) {
      console.error('Rate limit check error:', error);
      // Fail open - allow request if rate limiting fails
      return {
        key: limitKey,
        allowed: true,
        limit: max,
        remaining: max,
        reset: Math.floor((now + windowMs) / 1000),
        windowMs,
        weight,
      };
    }
  }

  /**
   * Check limit using Redis
   */
  async checkRedisLimit(key, now, windowMs, max, weight) {
    const reset = Math.floor((now + windowMs) / 1000);
    
    // Use Redis transactions for atomic operations
    const multi = this.redis.multi();
    
    // Remove old entries
    multi.zremrangebyscore(key, 0, now - windowMs);
    
    // Get current count
    multi.zcard(key);
    
    // Add current request
    multi.zadd(key, now, `${now}:${crypto.randomBytes(8).toString('hex')}`);
    
    // Set expiry
    multi.expire(key, Math.ceil(windowMs / 1000));
    
    const results = await multi.exec();
    const current = results[1][1]; // Get count from ZCARD result
    
    const remaining = Math.max(0, max - current);
    const allowed = current < max;
    
    return {
      key,
      allowed,
      limit: max,
      remaining,
      reset,
      windowMs,
      current,
      weight,
    };
  }

  /**
   * Check limit using in-memory store
   */
  checkMemoryLimit(key, now, windowStart, max, weight) {
    if (!this.store.has(key)) {
      this.store.set(key, {
        requests: [],
        resetTime: now + (windowStart - now),
      });
    }

    const entry = this.store.get(key);
    
    // Clean old requests
    entry.requests = entry.requests.filter(time => time > windowStart);
    
    // Check if allowed
    const current = entry.requests.length;
    const remaining = Math.max(0, max - current);
    const allowed = current < max;
    
    if (allowed) {
      entry.requests.push(now);
    }
    
    return {
      key,
      allowed,
      limit: max,
      remaining,
      reset: Math.floor(entry.resetTime / 1000),
      windowMs: windowStart - now,
      current,
      weight,
    };
  }

  /**
   * Generate rate limit key
   */
  generateKey(req, options) {
    const { keyGenerator = this.defaultKeyGenerator } = options;
    
    if (typeof keyGenerator === 'function') {
      return keyGenerator(req);
    }
    
    return this.defaultKeyGenerator(req);
  }

  /**
   * Default key generator
   */
  defaultKeyGenerator(req) {
    const parts = [];
    
    // Add IP address (respect proxy settings)
    const ip = this.getClientIP(req);
    parts.push(`ip:${ip}`);
    
    // Add user ID if authenticated
    if (req.user?.id) {
      parts.push(`user:${req.user.id}`);
    }
    
    // Add API token if present
    if (req.apiClient?.id) {
      parts.push(`api:${req.apiClient.id}`);
    }
    
    // Add endpoint/method
    const route = req.route?.path || req.path;
    parts.push(`route:${req.method}:${route}`);
    
    return parts.join(':');
  }

  /**
   * Get client IP address
   */
  getClientIP(req) {
    if (this.config.trustProxy && req.headers['x-forwarded-for']) {
      const ips = req.headers['x-forwarded-for'].split(',');
      return ips[0].trim();
    }
    
    return req.ip || req.connection.remoteAddress || '127.0.0.1';
  }

  /**
   * Get limits for request
   */
  getLimits(req, options) {
    const limits = [];
    
    // Add global limit
    if (options.global !== false) {
      const globalLimit = this.config.defaultLimits.global;
      limits.push(globalLimit);
    }
    
    // Add endpoint-specific limit
    const endpoint = req.route?.path || req.path;
    const endpointLimit = this.getEndpointLimit(endpoint, req.method);
    if (endpointLimit) {
      limits.push(endpointLimit);
    }
    
    // Add role-based limits
    if (req.user?.role) {
      const roleLimits = this.getRoleLimits(req.user.role, endpoint);
      limits.push(...roleLimits);
    }
    
    // Add burst protection
    if (this.config.burstProtection.enabled) {
      limits.push({
        windowMs: this.config.burstProtection.burstWindowMs,
        max: this.config.burstProtection.burstMax,
        weight: 0.1, // Lower weight for burst limits
      });
    }
    
    // Add custom limits from options
    if (options.limits) {
      limits.push(...options.limits);
    }
    
    return limits;
  }

  /**
   * Get endpoint-specific limit
   */
  getEndpointLimit(endpoint, method) {
    // Map endpoints to limit types
    const endpointMap = {
      // Auth endpoints
      '/auth/login': 'auth',
      '/auth/register': 'registration',
      '/auth/forgot-password': 'passwordReset',
      '/auth/reset-password': 'passwordReset',
      
      // Job endpoints
      '/jobs': 'jobPost',
      '/jobs/:id/apply': 'jobApply',
      
      // Search endpoints
      '/jobs/search': 'search',
      '/candidates/search': 'search',
      
      // Upload endpoints
      '/upload/resume': 'upload',
      '/upload/avatar': 'upload',
      
      // Messaging endpoints
      '/messages': 'messaging',
      '/messages/:id': 'messaging',
    };
    
    const limitType = endpointMap[endpoint] || this.getMatchingEndpoint(endpoint, endpointMap);
    
    if (limitType) {
      return this.config.defaultLimits[limitType];
    }
    
    return null;
  }

  /**
   * Get matching endpoint for pattern matching
   */
  getMatchingEndpoint(endpoint, endpointMap) {
    for (const [pattern, limitType] of Object.entries(endpointMap)) {
      if (pattern.includes(':')) {
        // Convert pattern to regex
        const regexPattern = pattern.replace(/:\w+/g, '[^/]+');
        const regex = new RegExp(`^${regexPattern}$`);
        
        if (regex.test(endpoint)) {
          return limitType;
        }
      }
    }
    
    return null;
  }

  /**
   * Get role-based limits
   */
  getRoleLimits(role, endpoint) {
    const roleConfig = this.config.roleLimits[role];
    if (!roleConfig) return [];
    
    const limits = [];
    
    // Add global role limit
    if (roleConfig.global) {
      limits.push(roleConfig.global);
    }
    
    // Add endpoint-specific role limits
    const endpointKey = this.getEndpointKey(endpoint);
    if (roleConfig[endpointKey]) {
      limits.push(roleConfig[endpointKey]);
    }
    
    return limits;
  }

  /**
   * Get endpoint key for role limits
   */
  getEndpointKey(endpoint) {
    // Convert endpoint to key format
    return endpoint
      .replace(/\//g, '_')
      .replace(/:/g, '')
      .replace(/[^a-zA-Z0-9_]/g, '')
      .toLowerCase();
  }

  /**
   * Handle rate limit exceeded
   */
  handleLimitExceeded(req, res, exceededLimit, allLimits) {
    // Calculate retry after time
    const retryAfter = this.calculateRetryAfter(exceededLimit);
    
    // Add headers
    if (this.config.headers) {
      this.addHeaders(res, allLimits, exceededLimit);
      
      res.setHeader('Retry-After', retryAfter);
      res.setHeader('X-Retry-After', retryAfter);
    }
    
    // Log the limit exceeded event
    this.logLimitExceeded(req, exceededLimit);
    
    // Send response
    const statusCode = 429;
    
    // Determine response format based on Accept header
    const accept = req.headers.accept || '';
    
    if (accept.includes('application/json')) {
      return res.status(statusCode).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later.',
        code: 'RATE_LIMITED',
        retryAfter,
        limits: allLimits.map(l => ({
          limit: l.limit,
          remaining: l.remaining,
          reset: l.reset,
          windowMs: l.windowMs,
        })),
      });
    }
    
    // HTML response
    if (accept.includes('text/html')) {
      res.setHeader('Content-Type', 'text/html');
      return res.status(statusCode).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Rate Limit Exceeded</title>
          <meta http-equiv="refresh" content="${retryAfter};url=${req.originalUrl}">
        </head>
        <body>
          <h1>Too Many Requests</h1>
          <p>You have made too many requests. Please wait ${retryAfter} seconds and try again.</p>
          <p>Retrying in <span id="countdown">${retryAfter}</span> seconds...</p>
          <script>
            let countdown = ${retryAfter};
            setInterval(() => {
              countdown--;
              document.getElementById('countdown').textContent = countdown;
              if (countdown <= 0) {
                window.location.reload();
              }
            }, 1000);
          </script>
        </body>
        </html>
      `);
    }
    
    // Plain text response
    res.setHeader('Content-Type', 'text/plain');
    return res.status(statusCode).send(`Rate limit exceeded. Retry after ${retryAfter} seconds.`);
  }

  /**
   * Calculate retry after time
   */
  calculateRetryAfter(exceededLimit) {
    if (this.config.retryAfter === 'reset') {
      const now = Math.floor(Date.now() / 1000);
      return Math.max(1, exceededLimit.reset - now);
    }
    
    // Default: retry after window
    return Math.ceil(exceededLimit.windowMs / 1000);
  }

  /**
   * Add rate limit headers
   */
  addHeaders(res, limits, exceededLimit = null) {
    if (!this.config.headers) return;
    
    // Find the most restrictive limit
    const limitingLimit = exceededLimit || limits.reduce((prev, current) => {
      return prev.remaining < current.remaining ? prev : current;
    }, limits[0]);
    
    // Standard headers
    res.setHeader('X-RateLimit-Limit', limitingLimit.limit);
    res.setHeader('X-RateLimit-Remaining', limitingLimit.remaining);
    res.setHeader('X-RateLimit-Reset', limitingLimit.reset);
    
    // RFC draft headers
    if (this.config.draft_polli_ratelimit_headers) {
      res.setHeader('RateLimit-Limit', limitingLimit.limit);
      res.setHeader('RateLimit-Remaining', limitingLimit.remaining);
      res.setHeader('RateLimit-Reset', limitingLimit.reset);
    }
    
    // Additional headers for debugging
    if (this.config.logLevel === 'debug') {
      res.setHeader('X-RateLimit-Window', limitingLimit.windowMs);
      res.setHeader('X-RateLimit-Weight', limitingLimit.weight || 1);
      
      // Add all limits for debugging
      const allLimits = limits.map(l => ({
        limit: l.limit,
        remaining: l.remaining,
        reset: l.reset,
      }));
      res.setHeader('X-RateLimit-All', JSON.stringify(allLimits));
    }
  }

  /**
   * Apply slowdown to requests
   */
  async applySlowDown(key, req, res) {
    const { delayAfter, delayMs, maxDelayMs } = this.config.slowDown;
    
    const slowdownKey = `${key}:slowdown`;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    
    let current;
    
    if (this.redis) {
      // Redis implementation
      const multi = this.redis.multi();
      multi.zremrangebyscore(slowdownKey, 0, now - windowMs);
      multi.zcard(slowdownKey);
      multi.zadd(slowdownKey, now, `${now}:${crypto.randomBytes(8).toString('hex')}`);
      multi.expire(slowdownKey, Math.ceil(windowMs / 1000));
      
      const results = await multi.exec();
      current = results[1][1];
    } else {
      // In-memory implementation
      if (!this.store.has(slowdownKey)) {
        this.store.set(slowdownKey, {
          requests: [],
        });
      }
      
      const entry = this.store.get(slowdownKey);
      entry.requests = entry.requests.filter(time => time > now - windowMs);
      current = entry.requests.length;
      entry.requests.push(now);
    }
    
    // Calculate delay
    if (current > delayAfter) {
      const extraRequests = current - delayAfter;
      const delay = Math.min(extraRequests * delayMs, maxDelayMs);
      
      // Add delay header
      res.setHeader('X-SlowDown-Delay', delay);
      
      // Wait for delay
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  /**
   * Check if request should be skipped
   */
  shouldSkip(req, options) {
    // Skip if explicitly disabled
    if (options.skip === true) {
      return true;
    }
    
    // Skip successful requests if configured
    if (this.config.skipSuccessfulRequests && req.skipRateLimit) {
      return true;
    }
    
    // Skip failed requests if configured
    if (this.config.skipFailedRequests && req.skipRateLimitOnError) {
      return true;
    }
    
    // Skip based on user role (e.g., admin users)
    if (options.skipRoles && req.user?.role) {
      if (Array.isArray(options.skipRoles)) {
        if (options.skipRoles.includes(req.user.role)) {
          return true;
        }
      } else if (req.user.role === options.skipRoles) {
        return true;
      }
    }
    
    // Skip based on IP whitelist
    if (options.skipIPs) {
      const ip = this.getClientIP(req);
      if (options.skipIPs.includes(ip)) {
        return true;
      }
    }
    
    // Skip health checks
    if (req.path === '/health' || req.path === '/status') {
      return true;
    }
    
    // Skip static assets
    if (req.path.match(/\.(css|js|jpg|png|gif|ico|svg)$/)) {
      return true;
    }
    
    return false;
  }

  /**
   * Update statistics
   */
  updateStats(req, results) {
    this.stats.totalRequests++;
    
    const ip = this.getClientIP(req);
    const userId = req.user?.id || 'anonymous';
    const endpoint = req.path;
    
    // Update by endpoint
    if (!this.stats.byEndpoint.has(endpoint)) {
      this.stats.byEndpoint.set(endpoint, {
        requests: 0,
        limited: 0,
        lastRequest: Date.now(),
      });
    }
    
    const endpointStats = this.stats.byEndpoint.get(endpoint);
    endpointStats.requests++;
    endpointStats.lastRequest = Date.now();
    
    // Update by IP
    if (!this.stats.byIP.has(ip)) {
      this.stats.byIP.set(ip, {
        requests: 0,
        limited: 0,
        lastRequest: Date.now(),
      });
    }
    
    const ipStats = this.stats.byIP.get(ip);
    ipStats.requests++;
    ipStats.lastRequest = Date.now();
    
    // Update by user
    if (userId !== 'anonymous') {
      if (!this.stats.byUser.has(userId)) {
        this.stats.byUser.set(userId, {
          requests: 0,
          limited: 0,
          lastRequest: Date.now(),
        });
      }
      
      const userStats = this.stats.byUser.get(userId);
      userStats.requests++;
      userStats.lastRequest = Date.now();
    }
    
    // Check if any limit was exceeded
    const limited = results.some(r => !r.allowed);
    if (limited) {
      this.stats.limitedRequests++;
      endpointStats.limited++;
      ipStats.limited++;
      
      if (userId !== 'anonymous') {
        const userStats = this.stats.byUser.get(userId);
        userStats.limited++;
      }
    }
  }

  /**
   * Log limit exceeded event
   */
  logLimitExceeded(req, exceededLimit) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'warn',
      message: 'Rate limit exceeded',
      data: {
        ip: this.getClientIP(req),
        userId: req.user?.id,
        path: req.path,
        method: req.method,
        limit: exceededLimit.limit,
        remaining: exceededLimit.remaining,
        reset: exceededLimit.reset,
        windowMs: exceededLimit.windowMs,
        userAgent: req.headers['user-agent'],
        referer: req.headers.referer,
      },
    };
    
    const logger = this.config.logger;
    const level = this.config.logLevel;
    
    if (logger && level !== 'silent') {
      if (level === 'debug' || level === 'info') {
        logger.info('Rate limit exceeded:', logEntry);
      } else if (level === 'warn') {
        logger.warn('Rate limit exceeded:', logEntry.data);
      } else if (level === 'error') {
        logger.error('Rate limit exceeded:', logEntry.data);
      }
    }
    
    // Emit event for monitoring
    this.emitLimitExceeded(logEntry);
  }

  /**
   * Emit limit exceeded event
   */
  emitLimitExceeded(logEntry) {
    if (typeof process.emit === 'function') {
      process.emit('rateLimit:exceeded', logEntry);
    }
  }

  /**
   * Cleanup in-memory store
   */
  cleanupMemoryStore() {
    const now = Date.now();
    
    for (const [key, entry] of this.store.entries()) {
      if (key.includes('slowdown')) {
        // Keep slowdown entries for 5 minutes
        if (now - Math.max(...entry.requests) > 5 * 60 * 1000) {
          this.store.delete(key);
        }
      } else {
        // Keep rate limit entries based on their window
        const windowMs = parseInt(key.split(':').pop());
        if (entry.requests.length === 0 || 
            (now - Math.max(...entry.requests) > windowMs * 2)) {
          this.store.delete(key);
        }
      }
    }
  }

  /**
   * Get rate limit statistics
   */
  getStats(options = {}) {
    const {
      detailed = false,
      top = 10,
      since = Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
    } = options;
    
    const stats = {
      totalRequests: this.stats.totalRequests,
      limitedRequests: this.stats.limitedRequests,
      limitedPercentage: this.stats.totalRequests > 0 
        ? (this.stats.limitedRequests / this.stats.totalRequests * 100).toFixed(2)
        : 0,
      timestamp: new Date().toISOString(),
    };
    
    if (detailed) {
      // Top endpoints
      const topEndpoints = Array.from(this.stats.byEndpoint.entries())
        .filter(([_, data]) => data.lastRequest >= since)
        .sort((a, b) => b[1].requests - a[1].requests)
        .slice(0, top)
        .map(([endpoint, data]) => ({
          endpoint,
          ...data,
          limitedPercentage: data.requests > 0 
            ? (data.limited / data.requests * 100).toFixed(2)
            : 0,
        }));
      
      // Top IPs
      const topIPs = Array.from(this.stats.byIP.entries())
        .filter(([_, data]) => data.lastRequest >= since)
        .sort((a, b) => b[1].requests - a[1].requests)
        .slice(0, top)
        .map(([ip, data]) => ({
          ip,
          ...data,
          limitedPercentage: data.requests > 0 
            ? (data.limited / data.requests * 100).toFixed(2)
            : 0,
        }));
      
      // Top users
      const topUsers = Array.from(this.stats.byUser.entries())
        .filter(([_, data]) => data.lastRequest >= since)
        .sort((a, b) => b[1].requests - a[1].requests)
        .slice(0, top)
        .map(([userId, data]) => ({
          userId,
          ...data,
          limitedPercentage: data.requests > 0 
            ? (data.limited / data.requests * 100).toFixed(2)
            : 0,
        }));
      
      stats.topEndpoints = topEndpoints;
      stats.topIPs = topIPs;
      stats.topUsers = topUsers;
      
      // Store size
      if (this.redis) {
        stats.storeType = 'redis';
      } else {
        stats.storeType = 'memory';
        stats.storeSize = this.store.size;
      }
    }
    
    return stats;
  }

  /**
   * Reset rate limits for a key
   */
  async reset(key) {
    if (this.redis) {
      // Find and delete all keys matching the pattern
      const keys = await this.redis.keys(`${key}*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return keys.length;
    } else {
      // In-memory store
      let deleted = 0;
      for (const storeKey of this.store.keys()) {
        if (storeKey.startsWith(key)) {
          this.store.delete(storeKey);
          deleted++;
        }
      }
      return deleted;
    }
  }

  /**
   * Reset all rate limits
   */
  async resetAll() {
    if (this.redis) {
      // Delete all rate limit keys (be careful in production!)
      const keys = await this.redis.keys('ratelimit:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
      return keys.length;
    } else {
      const size = this.store.size;
      this.store.clear();
      return size;
    }
  }

  /**
   * Test if a request would be allowed
   */
  async testLimit(req, options = {}) {
    const key = this.generateKey(req, options);
    const limits = this.getLimits(req, options);
    
    const results = await Promise.all(
      limits.map(limit => this.checkLimit(key, limit, req))
    );
    
    return {
      allowed: results.every(r => r.allowed),
      results,
      key,
    };
  }

  /**
   * Middleware for specific endpoints
   */
  createEndpointLimiter(endpoint, options = {}) {
    return this.limit({
      ...options,
      keyGenerator: (req) => {
        const baseKey = this.defaultKeyGenerator(req);
        return `${baseKey}:endpoint:${endpoint}`;
      },
    });
  }

  /**
   * IP-based rate limiting
   */
  ipLimiter(options = {}) {
    return this.limit({
      ...options,
      keyGenerator: (req) => {
        const ip = this.getClientIP(req);
        return `ratelimit:ip:${ip}`;
      },
    });
  }

  /**
   * User-based rate limiting
   */
  userLimiter(options = {}) {
    return this.limit({
      ...options,
      keyGenerator: (req) => {
        if (!req.user?.id) {
          const ip = this.getClientIP(req);
          return `ratelimit:anonymous:${ip}`;
        }
        return `ratelimit:user:${req.user.id}`;
      },
    });
  }

  /**
   * API token-based rate limiting
   */
  apiTokenLimiter(options = {}) {
    return this.limit({
      ...options,
      keyGenerator: (req) => {
        if (!req.apiClient?.id) {
          const ip = this.getClientIP(req);
          return `ratelimit:api:anonymous:${ip}`;
        }
        return `ratelimit:api:${req.apiClient.id}`;
      },
    });
  }

  /**
   * Concurrency limiting (max concurrent requests)
   */
  concurrencyLimiter(maxConcurrent, options = {}) {
    const activeRequests = new Map();
    
    return async (req, res, next) => {
      const key = options.keyGenerator 
        ? options.keyGenerator(req)
        : this.defaultKeyGenerator(req);
      
      const now = Date.now();
      
      // Clean up old entries
      for (const [k, timestamp] of activeRequests.entries()) {
        if (now - timestamp > 30000) { // 30 seconds timeout
          activeRequests.delete(k);
        }
      }
      
      // Check if we can add another request
      if (activeRequests.size >= maxConcurrent) {
        return res.status(503).json({
          success: false,
          error: 'TOO_MANY_CONCURRENT_REQUESTS',
          message: 'Too many concurrent requests. Please try again later.',
          code: 'CONCURRENCY_LIMITED',
          retryAfter: 1,
        });
      }
      
      // Add request to active set
      activeRequests.set(key, now);
      
      // Remove request when done
      const originalEnd = res.end;
      res.end = function(...args) {
        activeRequests.delete(key);
        return originalEnd.apply(this, args);
      };
      
      next();
    };
  }

  /**
   * Daily/monthly quota limiting
   */
  quotaLimiter(quota, period = 'day', options = {}) {
    return this.limit({
      ...options,
      limits: [{
        windowMs: period === 'day' ? 24 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000,
        max: quota,
      }],
      keyGenerator: (req) => {
        const baseKey = options.keyGenerator 
          ? options.keyGenerator(req)
          : this.defaultKeyGenerator(req);
        
        const now = new Date();
        const periodKey = period === 'day' 
          ? now.toISOString().split('T')[0] // YYYY-MM-DD
          : `${now.getFullYear()}-${now.getMonth() + 1}`; // YYYY-MM
        
        return `${baseKey}:quota:${period}:${periodKey}`;
      },
    });
  }

  /**
   * Custom rate limit based on request cost
   */
  costBasedLimiter(costCalculator, options = {}) {
    return async (req, res, next) => {
      try {
        // Calculate cost for this request
        const cost = typeof costCalculator === 'function'
          ? costCalculator(req)
          : costCalculator;
        
        if (cost <= 0) {
          return next();
        }
        
        // Apply rate limiting with weight
        const key = this.generateKey(req, options);
        const limits = this.getLimits(req, options);
        
        // Check all limits with cost
        const results = await Promise.all(
          limits.map(async (limit) => {
            const { windowMs, max } = limit;
            const limitKey = `${key}:${windowMs}:${max}`;
            
            if (this.redis) {
              // Redis implementation with cost
              const now = Date.now();
              const reset = Math.floor((now + windowMs) / 1000);
              
              const multi = this.redis.multi();
              multi.zremrangebyscore(limitKey, 0, now - windowMs);
              
              // Get total cost
              multi.zrange(limitKey, 0, -1, 'WITHSCORES');
              
              const results = await multi.exec();
              const entries = results[1][1];
              
              let totalCost = 0;
              if (entries && entries.length > 0) {
                for (let i = 0; i < entries.length; i += 2) {
                  totalCost += parseFloat(entries[i + 1]);
                }
              }
              
              const remaining = Math.max(0, max - totalCost);
              const allowed = totalCost + cost <= max;
              
              if (allowed) {
                await this.redis.zadd(limitKey, now, `${now}:${cost}`);
                await this.redis.expire(limitKey, Math.ceil(windowMs / 1000));
              }
              
              return {
                key: limitKey,
                allowed,
                limit: max,
                remaining,
                reset,
                windowMs,
                cost,
                totalCost,
              };
            } else {
              // In-memory implementation
              const now = Date.now();
              const windowStart = now - windowMs;
              
              if (!this.store.has(limitKey)) {
                this.store.set(limitKey, {
                  requests: [],
                });
              }
              
              const entry = this.store.get(limitKey);
              entry.requests = entry.requests.filter(r => r.timestamp > windowStart);
              
              const totalCost = entry.requests.reduce((sum, r) => sum + r.cost, 0);
              const remaining = Math.max(0, max - totalCost);
              const allowed = totalCost + cost <= max;
              
              if (allowed) {
                entry.requests.push({ timestamp: now, cost });
              }
              
              return {
                key: limitKey,
                allowed,
                limit: max,
                remaining,
                reset: Math.floor((now + windowMs) / 1000),
                windowMs,
                cost,
                totalCost,
              };
            }
          })
        );
        
        const exceededLimit = results.find(result => !result.allowed);
        
        if (exceededLimit) {
          return this.handleLimitExceeded(req, res, exceededLimit, results);
        }
        
        // Add cost headers
        if (this.config.headers) {
          res.setHeader('X-RateLimit-Cost', cost);
          res.setHeader('X-RateLimit-Cost-Remaining', exceededLimit?.remaining || results[0].remaining);
        }
        
        next();
      } catch (error) {
        console.error('Cost-based rate limiting error:', error);
        next();
      }
    };
  }

  /**
   * Geobased rate limiting
   */
  geoLimiter(countryLimits, options = {}) {
    return async (req, res, next) => {
      try {
        // Get country from IP (this would use a geolocation service)
        const ip = this.getClientIP(req);
        const country = await this.getCountryFromIP(ip);
        
        if (country && countryLimits[country]) {
          const countryLimit = countryLimits[country];
          
          return this.limit({
            ...options,
            limits: [countryLimit],
            keyGenerator: (req) => {
              const baseKey = this.defaultKeyGenerator(req);
              return `${baseKey}:country:${country}`;
            },
          })(req, res, next);
        }
        
        next();
      } catch (error) {
        console.error('Geo rate limiting error:', error);
        next();
      }
    };
  }

  /**
   * Get country from IP (mock implementation)
   */
  async getCountryFromIP(ip) {
    // In production, use a service like MaxMind or ip-api
    // This is a mock implementation
    return 'US'; // Default to US
  }
}

// Create rate limiting middleware factory
const createRateLimitMiddleware = (config = {}) => {
  const service = new RateLimitService(config);
  
  // Main middleware
  const rateLimit = (options = {}) => service.limit(options);
  
  // Convenience methods
  rateLimit.ip = (options) => service.ipLimiter(options);
  rateLimit.user = (options) => service.userLimiter(options);
  rateLimit.api = (options) => service.apiTokenLimiter(options);
  rateLimit.endpoint = (endpoint, options) => service.createEndpointLimiter(endpoint, options);
  rateLimit.concurrency = (max, options) => service.concurrencyLimiter(max, options);
  rateLimit.quota = (quota, period, options) => service.quotaLimiter(quota, period, options);
  rateLimit.cost = (costCalculator, options) => service.costBasedLimiter(costCalculator, options);
  rateLimit.geo = (countryLimits, options) => service.geoLimiter(countryLimits, options);
  
  // Management methods
  rateLimit.getStats = (options) => service.getStats(options);
  rateLimit.reset = (key) => service.reset(key);
  rateLimit.resetAll = () => service.resetAll();
  rateLimit.test = (req, options) => service.testLimit(req, options);
  
  // Service instance
  rateLimit.service = service;
  
  return rateLimit;
};

// Export singleton instance
const rateLimit = createRateLimitMiddleware();

// Export factory
module.exports = {
  RateLimitService,
  createRateLimitMiddleware,
  rateLimit,
};
