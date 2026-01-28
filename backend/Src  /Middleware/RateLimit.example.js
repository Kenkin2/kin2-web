// app.js or server.js
const { rateLimit } = require('./middleware/ratelimit');

// Apply global rate limiting
app.use(rateLimit());

// Or with custom configuration
app.use(rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  skip: (req) => req.user?.role === 'admin', // Skip for admins
}));

// routes/auth.js
const express = require('express');
const router = express.Router();

// Strict rate limiting for authentication endpoints
router.post('/login',
  rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 login attempts
    skipFailedRequests: true, // Don't count failed attempts
    message: 'Too many login attempts. Please try again later.',
  }),
  async (req, res) => {
    // Login logic
  }
);

router.post('/register',
  rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 3, // 3 registrations per hour per IP
    message: 'Too many registration attempts from this IP.',
  }),
  async (req, res) => {
    // Registration logic
  }
);

router.post('/forgot-password',
  rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 password reset attempts
    message: 'Too many password reset attempts.',
  }),
  async (req, res) => {
    // Password reset logic
  }
);

// routes/jobs.js
router.post('/jobs',
  rateLimit.user({ // User-based rate limiting
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 job posts per hour
    message: 'You have posted too many jobs. Please try again later.',
  }),
  authenticate(),
  authorize('employer', 'admin'),
  async (req, res) => {
    // Job posting logic
  }
);

router.get('/jobs/search',
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 60, // 60 searches per minute
    keyGenerator: (req) => {
      // Different limits for authenticated vs anonymous users
      if (req.user) {
        return `search:user:${req.user.id}`;
      }
      return `search:ip:${req.ip}`;
    },
  }),
  async (req, res) => {
    // Job search logic
  }
);

// routes/applications.js
router.post('/jobs/:jobId/apply',
  rateLimit.user({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 50, // 50 applications per hour
    message: 'You have applied to too many jobs. Please try again later.',
  }),
  authenticate(),
  authorize('candidate'),
  async (req, res) => {
    // Application logic
  }
);

// routes/messages.js
router.post('/messages',
  rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 messages per minute
    keyGenerator: (req) => `messages:user:${req.user.id}`,
  }),
  authenticate(),
  async (req, res) => {
    // Message sending logic
  }
);

// routes/upload.js
router.post('/upload/resume',
  rateLimit.user({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, // 5 uploads per hour
    message: 'Too many file uploads. Please try again later.',
  }),
  authenticate(),
  upload.single('resume'),
  async (req, res) => {
    // File upload logic
  }
);

// routes/api.js
const apiRouter = express.Router();

// API-wide rate limiting
apiRouter.use(
  rateLimit.api({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 1000, // 1000 requests per hour per API key
    skip: (req) => req.apiClient?.metadata?.unlimited === true,
  })
);

apiRouter.get('/data',
  async (req, res) => {
    // API data logic
  }
);

// routes/admin.js
const adminRouter = express.Router();

// Admin endpoints with higher limits
adminRouter.use(
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 1000,
    skipRoles: ['admin', 'superadmin'], // Skip rate limiting for admins
  })
);

adminRouter.get('/analytics',
  authenticate(),
  authorize('admin', 'superadmin'),
  async (req, res) => {
    // Admin analytics
  }
);

// routes/health.js
// No rate limiting for health checks
router.get('/health', (req, res) => {
  res.json({ status: 'OK' });
});

// Concurrency limiting example
router.post('/process-job',
  rateLimit.concurrency(5, {
    // Max 5 concurrent requests
    keyGenerator: (req) => `process:user:${req.user.id}`,
  }),
  authenticate(),
  async (req, res) => {
    // Long-running job processing
  }
);

// Quota limiting example (daily quota)
router.post('/send-emails',
  rateLimit.quota(1000, 'day', {
    // 1000 emails per day
    keyGenerator: (req) => `emails:user:${req.user.id}`,
  }),
  authenticate(),
  authorize('employer', 'admin'),
  async (req, res) => {
    // Email sending logic
  }
);

// Cost-based rate limiting
router.post('/ai-processing',
  rateLimit.cost((req) => {
    // Calculate cost based on request complexity
    if (req.body.complexity === 'high') return 10;
    if (req.body.complexity === 'medium') return 5;
    return 1;
  }, {
    windowMs: 60 * 60 * 1000,
    max: 100, // 100 "cost points" per hour
    keyGenerator: (req) => `ai:user:${req.user.id}`,
  }),
  authenticate(),
  async (req, res) => {
    // AI processing logic
  }
);

// Geo-based rate limiting
router.post('/global-endpoint',
  rateLimit.geo({
    US: { windowMs: 15 * 60 * 1000, max: 100 }, // 100 requests per 15 min for US
    CN: { windowMs: 15 * 60 * 1000, max: 50 },  // 50 requests per 15 min for China
    IN: { windowMs: 15 * 60 * 1000, max: 200 }, // 200 requests per 15 min for India
    // Default for other countries
    default: { windowMs: 15 * 60 * 1000, max: 100 },
  }),
  async (req, res) => {
    // Global endpoint logic
  }
);

// Role-based rate limiting using middleware composition
const roleBasedRateLimit = (role, endpoint) => {
  return (req, res, next) => {
    if (req.user?.role === role) {
      return rateLimit.endpoint(endpoint, {
        windowMs: 60 * 60 * 1000,
        max: 100,
        keyGenerator: (req) => `${endpoint}:role:${role}:${req.user.id}`,
      })(req, res, next);
    }
    next();
  };
};

router.get('/employer/dashboard',
  authenticate(),
  authorize('employer'),
  roleBasedRateLimit('employer', '/employer/dashboard'),
  async (req, res) => {
    // Employer dashboard
  }
);

// Monitoring endpoint
router.get('/admin/rate-limit-stats',
  authenticate(),
  authorize('admin', 'superadmin'),
  async (req, res) => {
    const stats = rateLimit.getStats({
      detailed: true,
      top: 20,
      since: Date.now() - 24 * 60 * 60 * 1000, // Last 24 hours
    });
    
    res.json(stats);
  }
);

// Reset rate limits (admin only)
router.post('/admin/rate-limit/reset',
  authenticate(),
  authorize('admin', 'superadmin'),
  async (req, res) => {
    const { key } = req.body;
    
    if (key === '*') {
      const count = await rateLimit.resetAll();
      res.json({ success: true, message: `Reset ${count} rate limits` });
    } else {
      const count = await rateLimit.reset(key);
      res.json({ success: true, message: `Reset ${count} rate limits for key: ${key}` });
    }
  }
);

// Test rate limit endpoint
router.get('/test-rate-limit',
  rateLimit({
    windowMs: 60 * 1000,
    max: 10,
  }),
  async (req, res) => {
    // Test the rate limit
    const testResult = await rateLimit.test(req, {
      windowMs: 60 * 1000,
      max: 10,
    });
    
    res.json({
      success: true,
      message: 'Rate limit test',
      testResult,
      headers: {
        'X-RateLimit-Limit': res.get('X-RateLimit-Limit'),
        'X-RateLimit-Remaining': res.get('X-RateLimit-Remaining'),
        'X-RateLimit-Reset': res.get('X-RateLimit-Reset'),
      },
    });
  }
);

// Error handling for rate limits
app.use((err, req, res, next) => {
  if (err.type === 'rate-limit-exceeded') {
    return res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: err.message || 'Too many requests',
      retryAfter: err.retryAfter,
    });
  }
  next(err);
});

// WebSocket rate limiting example
const setupWebSocketRateLimit = (wss) => {
  const messageLimits = new Map();
  
  wss.on('connection', (ws, req) => {
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 60 * 1000; // 1 minute
    const maxMessages = 100; // 100 messages per minute
    
    if (!messageLimits.has(ip)) {
      messageLimits.set(ip, {
        messages: [],
        lastCleanup: now,
      });
    }
    
    const limit = messageLimits.get(ip);
    
    // Cleanup old messages
    if (now - limit.lastCleanup > 5000) { // Cleanup every 5 seconds
      limit.messages = limit.messages.filter(time => time > now - windowMs);
      limit.lastCleanup = now;
    }
    
    ws.on('message', (message) => {
      // Check rate limit
      if (limit.messages.length >= maxMessages) {
        ws.send(JSON.stringify({
          type: 'error',
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many messages. Please slow down.',
        }));
        return;
      }
      
      // Add message to count
      limit.messages.push(now);
      
      // Process message
      // ...
    });
  });
};

// Export routes with rate limiting
module.exports = {
  authRouter,
  jobsRouter,
  applicationsRouter,
  messagesRouter,
  apiRouter,
  adminRouter,
};
