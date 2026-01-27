# 🔒 KIN2 Security & Compliance Guide

**Version:** 2.5.0  
**Last Updated:** January 27, 2026  
**Classification:** Internal - For Development & Operations Teams

---

## 📋 Executive Summary

This document outlines the security measures, best practices, and compliance requirements for the KIN2 Workforce Platform. It serves as a comprehensive guide for maintaining the security posture of the application in production environments.

**Critical Security Principles:**
1. **Defense in Depth** - Multiple layers of security
2. **Principle of Least Privilege** - Minimum necessary access
3. **Zero Trust** - Verify everything, trust nothing
4. **Security by Design** - Built-in, not bolted-on
5. **Continuous Monitoring** - Constant vigilance

---

## 🛡️ Security Architecture Overview

### Application Security Layers

```
┌─────────────────────────────────────────────────┐
│          Frontend Security Layer                │
│  ├─ HTTPS/TLS Encryption                       │
│  ├─ Content Security Policy (CSP)              │
│  ├─ XSS Protection                              │
│  └─ CSRF Tokens                                 │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│          API Gateway Layer                      │
│  ├─ Rate Limiting                               │
│  ├─ DDoS Protection                             │
│  ├─ Request Validation                          │
│  └─ API Key Authentication                      │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│          Application Layer                      │
│  ├─ JWT Authentication                          │
│  ├─ Role-Based Access Control (RBAC)           │
│  ├─ Input Sanitization                          │
│  ├─ Output Encoding                             │
│  └─ Session Management                          │
└─────────────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────┐
│          Data Layer                             │
│  ├─ Encryption at Rest                          │
│  ├─ SQL Injection Prevention                    │
│  ├─ Secure Database Connections                 │
│  └─ Data Masking                                │
└─────────────────────────────────────────────────┘
```

---

## 🔐 Authentication & Authorization

### 1. Password Security

**Requirements:**
- Minimum 8 characters
- At least one uppercase letter
- At least one lowercase letter
- At least one number
- At least one special character
- Cannot be common passwords
- Cannot contain username or email

**Implementation:**

```javascript
// backend/src/utils/passwordValidator.js
const validator = require('validator');

function validatePassword(password, user) {
  const errors = [];
  
  // Length check
  if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  }
  
  // Complexity checks
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }
  
  // Common password check
  const commonPasswords = [
    'password', 'password123', '12345678', 'qwerty', 
    'abc123', 'monkey', '1234567890', 'letmein'
  ];
  if (commonPasswords.includes(password.toLowerCase())) {
    errors.push('Password is too common. Please choose a stronger password');
  }
  
  // User information check
  if (user) {
    const userInfo = [
      user.email?.toLowerCase(),
      user.firstName?.toLowerCase(),
      user.lastName?.toLowerCase(),
      user.username?.toLowerCase()
    ].filter(Boolean);
    
    for (const info of userInfo) {
      if (password.toLowerCase().includes(info)) {
        errors.push('Password cannot contain your personal information');
        break;
      }
    }
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Password hashing
const bcrypt = require('bcrypt');
const SALT_ROUNDS = 12;

async function hashPassword(password) {
  return await bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

module.exports = {
  validatePassword,
  hashPassword,
  verifyPassword
};
```

### 2. JWT Token Security

**Token Configuration:**

```javascript
// backend/src/config/jwt.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_CONFIG = {
  access: {
    secret: process.env.JWT_SECRET,
    expiresIn: '15m', // Short-lived access tokens
    algorithm: 'HS256'
  },
  refresh: {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: '7d', // Longer-lived refresh tokens
    algorithm: 'HS256'
  }
};

// Generate secure tokens
function generateAccessToken(user) {
  const payload = {
    userId: user.id,
    email: user.email,
    role: user.role,
    type: 'access'
  };
  
  return jwt.sign(payload, JWT_CONFIG.access.secret, {
    expiresIn: JWT_CONFIG.access.expiresIn,
    algorithm: JWT_CONFIG.access.algorithm,
    issuer: 'kin2-platform',
    audience: 'kin2-api'
  });
}

function generateRefreshToken(user) {
  const payload = {
    userId: user.id,
    type: 'refresh',
    // Add random jti for token revocation
    jti: crypto.randomBytes(16).toString('hex')
  };
  
  return jwt.sign(payload, JWT_CONFIG.refresh.secret, {
    expiresIn: JWT_CONFIG.refresh.expiresIn,
    algorithm: JWT_CONFIG.refresh.algorithm,
    issuer: 'kin2-platform',
    audience: 'kin2-api'
  });
}

// Verify tokens with comprehensive checks
function verifyAccessToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_CONFIG.access.secret, {
      algorithms: [JWT_CONFIG.access.algorithm],
      issuer: 'kin2-platform',
      audience: 'kin2-api'
    });
    
    // Additional checks
    if (decoded.type !== 'access') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired token');
  }
}

function verifyRefreshToken(token) {
  try {
    const decoded = jwt.verify(token, JWT_CONFIG.refresh.secret, {
      algorithms: [JWT_CONFIG.refresh.algorithm],
      issuer: 'kin2-platform',
      audience: 'kin2-api'
    });
    
    if (decoded.type !== 'refresh') {
      throw new Error('Invalid token type');
    }
    
    return decoded;
  } catch (error) {
    throw new Error('Invalid or expired refresh token');
  }
}

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
```

### 3. Role-Based Access Control (RBAC)

**Permission Matrix:**

| Resource | ADMIN | EMPLOYER | WORKER | VOLUNTEER | FREELANCER | SELLER |
|----------|-------|----------|--------|-----------|------------|--------|
| Create Job | ✅ | ✅ | ❌ | ❌ | ❌ | ❌ |
| View Jobs | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Apply Job | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Manage Users | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| View Analytics | ✅ | ✅ | ✅ | ❌ | ❌ | ❌ |
| Process Payments | ✅ | ✅ | ❌ | ❌ | ❌ | ✅ |

**RBAC Implementation:**

```javascript
// backend/src/middleware/rbac.js
const PERMISSIONS = {
  ADMIN: [
    'users:read', 'users:write', 'users:delete',
    'jobs:read', 'jobs:write', 'jobs:delete',
    'applications:read', 'applications:write',
    'payments:read', 'payments:write',
    'analytics:read', 'system:configure'
  ],
  EMPLOYER: [
    'jobs:read', 'jobs:write', 'jobs:delete',
    'applications:read', 'applications:write',
    'workers:read', 'payments:write',
    'analytics:read'
  ],
  WORKER: [
    'jobs:read', 'applications:write',
    'applications:read', 'profile:write',
    'earnings:read'
  ],
  VOLUNTEER: [
    'opportunities:read', 'opportunities:apply',
    'profile:write', 'karma:read'
  ],
  FREELANCER: [
    'projects:read', 'projects:apply',
    'invoices:write', 'portfolio:write'
  ],
  SELLER: [
    'products:read', 'products:write',
    'orders:read', 'orders:write',
    'inventory:write'
  ]
};

function hasPermission(userRole, requiredPermission) {
  const rolePermissions = PERMISSIONS[userRole] || [];
  return rolePermissions.includes(requiredPermission);
}

function requirePermission(permission) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!hasPermission(req.user.role, permission)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: permission,
        userRole: req.user.role
      });
    }
    
    next();
  };
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: 'Access denied',
        requiredRoles: allowedRoles,
        userRole: req.user.role
      });
    }
    
    next();
  };
}

module.exports = {
  hasPermission,
  requirePermission,
  requireRole,
  PERMISSIONS
};
```

---

## 🔒 Data Protection

### 1. Encryption

**Encryption at Rest:**

```javascript
// backend/src/utils/encryption.js
const crypto = require('crypto');

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY; // Must be 32 bytes
const ALGORITHM = 'aes-256-gcm';

function encrypt(text) {
  // Generate random IV
  const iv = crypto.randomBytes(16);
  
  // Create cipher
  const cipher = crypto.createCipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    iv
  );
  
  // Encrypt data
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  // Get authentication tag
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Return IV, encrypted data, and auth tag
  return {
    iv: iv.toString('hex'),
    encryptedData: encrypted,
    authTag: authTag
  };
}

function decrypt(encryptedObject) {
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    Buffer.from(ENCRYPTION_KEY, 'hex'),
    Buffer.from(encryptedObject.iv, 'hex')
  );
  
  // Set authentication tag
  decipher.setAuthTag(Buffer.from(encryptedObject.authTag, 'hex'));
  
  // Decrypt data
  let decrypted = decipher.update(encryptedObject.encryptedData, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  
  return decrypted;
}

// Use for sensitive fields
function encryptSensitiveData(user) {
  if (user.ssn) {
    const encrypted = encrypt(user.ssn);
    user.ssnEncrypted = JSON.stringify(encrypted);
    delete user.ssn;
  }
  
  if (user.bankAccount) {
    const encrypted = encrypt(user.bankAccount);
    user.bankAccountEncrypted = JSON.stringify(encrypted);
    delete user.bankAccount;
  }
  
  return user;
}

function decryptSensitiveData(user) {
  if (user.ssnEncrypted) {
    const encrypted = JSON.parse(user.ssnEncrypted);
    user.ssn = decrypt(encrypted);
  }
  
  if (user.bankAccountEncrypted) {
    const encrypted = JSON.parse(user.bankAccountEncrypted);
    user.bankAccount = decrypt(encrypted);
  }
  
  return user;
}

module.exports = {
  encrypt,
  decrypt,
  encryptSensitiveData,
  decryptSensitiveData
};
```

**Encryption in Transit:**

```javascript
// Enforce HTTPS
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && !req.secure) {
    return res.redirect(301, `https://${req.headers.host}${req.url}`);
  }
  next();
});

// Strict Transport Security
app.use(helmet.hsts({
  maxAge: 31536000, // 1 year
  includeSubDomains: true,
  preload: true
}));
```

### 2. Data Sanitization

**Input Sanitization:**

```javascript
// backend/src/middleware/sanitize.js
const validator = require('validator');
const xss = require('xss');

function sanitizeInput(req, res, next) {
  // Sanitize body
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }
  
  // Sanitize query parameters
  if (req.query) {
    req.query = sanitizeObject(req.query);
  }
  
  // Sanitize URL parameters
  if (req.params) {
    req.params = sanitizeObject(req.params);
  }
  
  next();
}

function sanitizeObject(obj) {
  const sanitized = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      // Remove potential XSS
      sanitized[key] = xss(value);
      
      // Trim whitespace
      sanitized[key] = sanitized[key].trim();
      
      // Escape HTML
      if (!isHTMLAllowed(key)) {
        sanitized[key] = validator.escape(sanitized[key]);
      }
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(item => 
        typeof item === 'string' ? xss(item.trim()) : item
      );
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  
  return sanitized;
}

// Fields that allow HTML (for rich text editors)
const HTML_ALLOWED_FIELDS = ['description', 'content', 'bio'];

function isHTMLAllowed(fieldName) {
  return HTML_ALLOWED_FIELDS.includes(fieldName);
}

module.exports = {
  sanitizeInput,
  sanitizeObject
};
```

**Output Encoding:**

```javascript
// backend/src/utils/outputEncoding.js
function encodeForHTML(str) {
  if (typeof str !== 'string') return str;
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

function encodeForJSON(obj) {
  if (typeof obj === 'string') {
    return encodeForHTML(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => encodeForJSON(item));
  }
  
  if (typeof obj === 'object' && obj !== null) {
    const encoded = {};
    for (const [key, value] of Object.entries(obj)) {
      encoded[key] = encodeForJSON(value);
    }
    return encoded;
  }
  
  return obj;
}

module.exports = {
  encodeForHTML,
  encodeForJSON
};
```

### 3. SQL Injection Prevention

Prisma ORM provides automatic protection against SQL injection through parameterized queries. However, for custom queries:

```javascript
// ✅ Safe - Using Prisma
await prisma.user.findMany({
  where: {
    email: userEmail // Automatically parameterized
  }
});

// ✅ Safe - Using Prisma raw query with parameters
await prisma.$queryRaw`
  SELECT * FROM "User" 
  WHERE email = ${userEmail}
`;

// ❌ Dangerous - Never do this
await prisma.$queryRawUnsafe(`
  SELECT * FROM "User" 
  WHERE email = '${userEmail}'
`);
```

---

## 🚫 Rate Limiting & DDoS Protection

### 1. Rate Limiting Implementation

```javascript
// backend/src/middleware/rateLimiting.js
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const redis = require('redis');

// Redis client for distributed rate limiting
const redisClient = redis.createClient({
  url: process.env.REDIS_URL,
  password: process.env.REDIS_PASSWORD
});

// General API rate limit
const apiLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:api:'
  }),
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many requests from this IP, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

// Authentication endpoints (stricter)
const authLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:auth:'
  }),
  windowMs: 15 * 60 * 1000,
  max: 20, // Only 20 auth requests per 15 minutes
  skipSuccessfulRequests: true, // Don't count successful logins
  skipFailedRequests: false, // Count failed attempts
  message: 'Too many authentication attempts, please try again later'
});

// Password reset (very strict)
const passwordResetLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:reset:'
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // Only 3 attempts per hour
  message: 'Too many password reset attempts, please try again after an hour'
});

// AI endpoints (expensive operations)
const aiLimiter = rateLimit({
  store: new RedisStore({
    client: redisClient,
    prefix: 'rl:ai:'
  }),
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50, // 50 AI requests per hour
  message: 'AI request limit exceeded, please try again later',
  handler: (req, res) => {
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: res.getHeader('Retry-After'),
      limit: 50,
      message: 'You have exceeded the AI request limit. Please upgrade your plan for higher limits.'
    });
  }
});

// Per-user rate limiting
function createUserLimiter(max, windowMs) {
  return rateLimit({
    store: new RedisStore({
      client: redisClient,
      prefix: 'rl:user:'
    }),
    windowMs,
    max,
    keyGenerator: (req) => {
      // Use user ID for authenticated requests
      return req.user?.id || req.ip;
    },
    skip: (req) => !req.user // Skip for unauthenticated requests
  });
}

module.exports = {
  apiLimiter,
  authLimiter,
  passwordResetLimiter,
  aiLimiter,
  createUserLimiter
};
```

### 2. DDoS Protection

```javascript
// backend/src/middleware/ddosProtection.js
const slowDown = require('express-slow-down');

// Gradually slow down responses after threshold
const speedLimiter = slowDown({
  windowMs: 15 * 60 * 1000, // 15 minutes
  delayAfter: 50, // Allow 50 requests per 15 minutes at full speed
  delayMs: 500, // Add 500ms delay per request after threshold
  maxDelayMs: 20000, // Maximum delay of 20 seconds
});

// IP blacklist (can be populated from threat intelligence)
const blacklistedIPs = new Set();

function checkBlacklist(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress;
  
  if (blacklistedIPs.has(ip)) {
    return res.status(403).json({ 
      error: 'Access denied',
      message: 'Your IP has been blocked due to suspicious activity'
    });
  }
  
  next();
}

// Detect and block suspicious patterns
const suspiciousActivity = new Map();

function detectSuspiciousActivity(req, res, next) {
  const ip = req.ip;
  const path = req.path;
  
  // Track activity
  if (!suspiciousActivity.has(ip)) {
    suspiciousActivity.set(ip, {
      requests: 0,
      paths: new Set(),
      firstSeen: Date.now()
    });
  }
  
  const activity = suspiciousActivity.get(ip);
  activity.requests++;
  activity.paths.add(path);
  
  // Check for suspicious patterns
  const timeWindow = 60 * 1000; // 1 minute
  const timeSinceFirst = Date.now() - activity.firstSeen;
  
  if (timeSinceFirst < timeWindow) {
    // More than 100 requests in 1 minute
    if (activity.requests > 100) {
      blacklistedIPs.add(ip);
      return res.status(429).json({ 
        error: 'Too many requests',
        message: 'Your IP has been temporarily blocked'
      });
    }
    
    // Accessing too many different paths (possible scanning)
    if (activity.paths.size > 50) {
      return res.status(429).json({ 
        error: 'Suspicious activity detected',
        message: 'Please slow down your requests'
      });
    }
  } else {
    // Reset tracking after time window
    suspiciousActivity.delete(ip);
  }
  
  next();
}

module.exports = {
  speedLimiter,
  checkBlacklist,
  detectSuspiciousActivity
};
```

---

## 🔍 Security Monitoring & Logging

### 1. Security Event Logging

```javascript
// backend/src/utils/securityLogger.js
const winston = require('winston');
const { ElasticsearchTransport } = require('winston-elasticsearch');

const securityLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  defaultMeta: { service: 'kin2-security' },
  transports: [
    // File transport for all security events
    new winston.transports.File({ 
      filename: 'logs/security.log',
      maxsize: 10485760, // 10MB
      maxFiles: 30,
      tailable: true
    }),
    
    // Console in development
    ...(process.env.NODE_ENV !== 'production' ? [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple()
        )
      })
    ] : []),
    
    // Elasticsearch in production
    ...(process.env.NODE_ENV === 'production' ? [
      new ElasticsearchTransport({
        level: 'info',
        clientOpts: { node: process.env.ELASTICSEARCH_URL }
      })
    ] : [])
  ]
});

// Security event types
const SECURITY_EVENTS = {
  // Authentication events
  LOGIN_SUCCESS: 'login_success',
  LOGIN_FAILURE: 'login_failure',
  LOGOUT: 'logout',
  TOKEN_REFRESH: 'token_refresh',
  PASSWORD_CHANGE: 'password_change',
  PASSWORD_RESET_REQUEST: 'password_reset_request',
  PASSWORD_RESET_COMPLETE: 'password_reset_complete',
  
  // Authorization events
  UNAUTHORIZED_ACCESS: 'unauthorized_access',
  PERMISSION_DENIED: 'permission_denied',
  ROLE_CHANGE: 'role_change',
  
  // Data events
  SENSITIVE_DATA_ACCESS: 'sensitive_data_access',
  DATA_EXPORT: 'data_export',
  DATA_DELETION: 'data_deletion',
  
  // Account events
  ACCOUNT_CREATED: 'account_created',
  ACCOUNT_DELETED: 'account_deleted',
  ACCOUNT_LOCKED: 'account_locked',
  ACCOUNT_UNLOCKED: 'account_unlocked',
  
  // Security incidents
  BRUTE_FORCE_ATTEMPT: 'brute_force_attempt',
  SQL_INJECTION_ATTEMPT: 'sql_injection_attempt',
  XSS_ATTEMPT: 'xss_attempt',
  CSRF_ATTEMPT: 'csrf_attempt',
  RATE_LIMIT_EXCEEDED: 'rate_limit_exceeded',
  SUSPICIOUS_ACTIVITY: 'suspicious_activity',
  
  // System events
  SYSTEM_ERROR: 'system_error',
  CONFIG_CHANGE: 'config_change',
  BACKUP_CREATED: 'backup_created',
  BACKUP_RESTORED: 'backup_restored'
};

function logSecurityEvent(eventType, details) {
  securityLogger.info({
    event: eventType,
    timestamp: new Date().toISOString(),
    ...details
  });
  
  // Alert on critical events
  if (isCriticalEvent(eventType)) {
    alertSecurityTeam(eventType, details);
  }
}

function isCriticalEvent(eventType) {
  const criticalEvents = [
    SECURITY_EVENTS.UNAUTHORIZED_ACCESS,
    SECURITY_EVENTS.SQL_INJECTION_ATTEMPT,
    SECURITY_EVENTS.BRUTE_FORCE_ATTEMPT,
    SECURITY_EVENTS.SUSPICIOUS_ACTIVITY,
    SECURITY_EVENTS.DATA_EXPORT,
    SECURITY_EVENTS.ACCOUNT_DELETED
  ];
  
  return criticalEvents.includes(eventType);
}

async function alertSecurityTeam(eventType, details) {
  // Send alert to security team
  // Implementation depends on your alerting system
  // Could be: Slack, PagerDuty, Email, SMS, etc.
  
  if (process.env.SLACK_SECURITY_WEBHOOK) {
    const message = {
      text: `🚨 Security Alert: ${eventType}`,
      attachments: [{
        color: 'danger',
        fields: Object.entries(details).map(([key, value]) => ({
          title: key,
          value: String(value),
          short: true
        }))
      }]
    };
    
    await fetch(process.env.SLACK_SECURITY_WEBHOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message)
    });
  }
}

// Middleware to log security-relevant requests
function securityLoggingMiddleware(req, res, next) {
  const startTime = Date.now();
  
  // Log after response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Log failed authentication
    if (req.path.includes('/auth/') && res.statusCode >= 400) {
      logSecurityEvent(SECURITY_EVENTS.LOGIN_FAILURE, {
        ip: req.ip,
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        userAgent: req.get('User-Agent'),
        duration
      });
    }
    
    // Log unauthorized access
    if (res.statusCode === 401 || res.statusCode === 403) {
      logSecurityEvent(SECURITY_EVENTS.UNAUTHORIZED_ACCESS, {
        ip: req.ip,
        path: req.path,
        method: req.method,
        statusCode: res.statusCode,
        userId: req.user?.id,
        duration
      });
    }
    
    // Log sensitive data access
    if (req.path.includes('/sensitive/') || req.path.includes('/export/')) {
      logSecurityEvent(SECURITY_EVENTS.SENSITIVE_DATA_ACCESS, {
        ip: req.ip,
        path: req.path,
        userId: req.user?.id,
        duration
      });
    }
  });
  
  next();
}

module.exports = {
  securityLogger,
  logSecurityEvent,
  securityLoggingMiddleware,
  SECURITY_EVENTS
};
```

---

## 🎯 Security Testing

### 1. Automated Security Scanning

```bash
# Install security scanning tools
npm install -g snyk
npm install --save-dev @lavamoat/allow-scripts

# Run dependency audit
npm audit

# Fix automatically
npm audit fix

# Run Snyk scan
snyk test
snyk monitor

# Check for known vulnerabilities in code
npx eslint-plugin-security
```

### 2. Penetration Testing Checklist

**Authentication Testing:**
- [ ] Test password complexity requirements
- [ ] Test account lockout after failed attempts
- [ ] Test session timeout
- [ ] Test token expiration
- [ ] Test JWT signature validation
- [ ] Test refresh token rotation
- [ ] Test password reset flow
- [ ] Test email verification bypass
- [ ] Test OAuth integration security

**Authorization Testing:**
- [ ] Test vertical privilege escalation (role bypass)
- [ ] Test horizontal privilege escalation (accessing other users' data)
- [ ] Test direct object reference vulnerabilities
- [ ] Test API endpoint authorization
- [ ] Test file access permissions
- [ ] Test admin functionality access

**Input Validation Testing:**
- [ ] Test SQL injection in all input fields
- [ ] Test XSS in text fields and rich text editors
- [ ] Test command injection
- [ ] Test path traversal
- [ ] Test file upload restrictions
- [ ] Test parameter tampering
- [ ] Test HTTP header injection

**Session Management:**
- [ ] Test session fixation
- [ ] Test session hijacking
- [ ] Test concurrent session handling
- [ ] Test logout functionality
- [ ] Test token revocation

**Business Logic:**
- [ ] Test payment manipulation
- [ ] Test job application bypass
- [ ] Test KFN score manipulation
- [ ] Test AI agent abuse
- [ ] Test rate limiting bypass

---

## 📊 Security Metrics & KPIs

Track these security metrics:

1. **Authentication Metrics:**
   - Failed login attempts per hour
   - Account lockouts per day
   - Password reset requests per day
   - Average session duration

2. **Authorization Metrics:**
   - Unauthorized access attempts
   - Permission denied events
   - Role escalation attempts

3. **API Security Metrics:**
   - Rate limit violations
   - Invalid token submissions
   - API abuse attempts

4. **Incident Metrics:**
   - Security incidents per month
   - Mean time to detect (MTTD)
   - Mean time to respond (MTTR)
   - False positive rate

5. **Vulnerability Metrics:**
   - Open vulnerabilities
   - Time to patch
   - Vulnerability severity distribution

---

## 🔒 Compliance Requirements

### GDPR Compliance

**User Rights Implementation:**

```javascript
// backend/src/services/gdpr.js
class GDPRService {
  // Right to Access (Article 15)
  async exportUserData(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        applications: true,
        jobs: true,
        payments: true,
        messages: true,
        notifications: true,
        sessions: true
      }
    });
    
    // Remove sensitive system data
    delete user.password;
    delete user.refreshTokens;
    
    return {
      exportDate: new Date().toISOString(),
      userData: user,
      format: 'JSON'
    };
  }
  
  // Right to Erasure (Article 17)
  async deleteUserData(userId, reason) {
    // Log deletion request
    await logSecurityEvent(SECURITY_EVENTS.DATA_DELETION, {
      userId,
      reason,
      requestedAt: new Date()
    });
    
    // Anonymize instead of hard delete (for compliance)
    await prisma.user.update({
      where: { id: userId },
      data: {
        email: `deleted_${userId}@anonymized.local`,
        firstName: '[DELETED]',
        lastName: '[DELETED]',
        phone: null,
        deletedAt: new Date(),
        deletionReason: reason
      }
    });
    
    // Delete associated data
    await prisma.session.deleteMany({ where: { userId } });
    await prisma.refreshToken.deleteMany({ where: { userId } });
    
    return { success: true, deletedAt: new Date() };
  }
  
  // Right to Rectification (Article 16)
  async updateUserData(userId, updates) {
    return await prisma.user.update({
      where: { id: userId },
      data: updates
    });
  }
  
  // Right to Data Portability (Article 20)
  async exportDataPortable(userId, format = 'json') {
    const data = await this.exportUserData(userId);
    
    switch (format.toLowerCase()) {
      case 'csv':
        return convertToCSV(data);
      case 'xml':
        return convertToXML(data);
      case 'json':
      default:
        return JSON.stringify(data, null, 2);
    }
  }
  
  // Consent Management
  async recordConsent(userId, consentType, granted) {
    return await prisma.consent.create({
      data: {
        userId,
        type: consentType,
        granted,
        recordedAt: new Date(),
        ipAddress: req.ip,
        userAgent: req.get('User-Agent')
      }
    });
  }
}

module.exports = new GDPRService();
```

### PCI DSS Compliance (Payment Processing)

**Never store sensitive payment data:**

```javascript
// ❌ NEVER DO THIS
async function createPayment(cardData) {
  await prisma.payment.create({
    data: {
      cardNumber: cardData.number, // NEVER STORE
      cvv: cardData.cvv, // NEVER STORE
      expiry: cardData.expiry
    }
  });
}

// ✅ CORRECT - Use Stripe tokens
async function createPayment(stripeToken, amount) {
  const paymentIntent = await stripe.paymentIntents.create({
    amount: amount * 100, // Convert to cents
    currency: 'usd',
    payment_method: stripeToken,
    confirm: true
  });
  
  // Only store non-sensitive data
  await prisma.payment.create({
    data: {
      stripePaymentIntentId: paymentIntent.id,
      amount,
      status: paymentIntent.status,
      last4: paymentIntent.charges.data[0].payment_method_details.card.last4,
      brand: paymentIntent.charges.data[0].payment_method_details.card.brand
    }
  });
  
  return paymentIntent;
}
```

---

## ✅ Production Security Checklist

### Pre-Deployment

- [ ] All dependencies updated to latest secure versions
- [ ] npm audit shows no vulnerabilities
- [ ] Environment variables properly secured
- [ ] Database credentials rotated
- [ ] API keys regenerated for production
- [ ] HTTPS enforced across all services
- [ ] SSL certificates valid and auto-renewing
- [ ] Security headers configured (Helmet.js)
- [ ] CORS properly restricted
- [ ] Rate limiting enabled
- [ ] Input validation comprehensive
- [ ] Output encoding implemented
- [ ] SQL injection prevention verified
- [ ] XSS protection enabled
- [ ] CSRF protection configured
- [ ] Authentication tested thoroughly
- [ ] Authorization rules verified
- [ ] Password policy enforced
- [ ] Session management secure
- [ ] File upload restrictions in place
- [ ] Logging configured for security events
- [ ] Monitoring and alerting active
- [ ] Backup strategy implemented
- [ ] Incident response plan documented
- [ ] Security team contacts updated

### Post-Deployment

- [ ] Penetration testing completed
- [ ] Security scanning running continuously
- [ ] Log monitoring active
- [ ] Intrusion detection configured
- [ ] Regular security reviews scheduled
- [ ] Vulnerability disclosure program active
- [ ] Bug bounty program considered
- [ ] Security training for team completed
- [ ] Compliance audit passed
- [ ] Insurance policies active

---

## 📞 Security Incident Response

### Incident Response Plan

**Phase 1: Detection**
- Monitor logs and alerts
- Identify potential security incidents
- Classify severity (Critical, High, Medium, Low)

**Phase 2: Containment**
- Isolate affected systems
- Revoke compromised credentials
- Block malicious IPs
- Preserve evidence

**Phase 3: Eradication**
- Remove malware/backdoors
- Patch vulnerabilities
- Reset compromised accounts
- Update security rules

**Phase 4: Recovery**
- Restore from clean backups
- Verify system integrity
- Monitor for reinfection
- Gradually restore services

**Phase 5: Post-Incident**
- Document incident details
- Conduct root cause analysis
- Update security measures
- Improve detection capabilities
- Train team on lessons learned

### Emergency Contacts

```
Security Team Lead: security@yourdomain.com
Emergency Hotline: +1-XXX-XXX-XXXX
Incident Response: incident@yourdomain.com
Legal Department: legal@yourdomain.com
PR Team: pr@yourdomain.com
```

---

**Document Maintained By:** Security Team  
**Last Security Audit:** January 27, 2026  
**Next Review Date:** April 27, 2026  

---

*This document contains sensitive security information and should be treated as confidential. Distribution is restricted to authorized personnel only.*
