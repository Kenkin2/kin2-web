// src/middleware/auth.js
const { JWTService } = require('../../utils/jwt');
const { TokenBlacklist } = require('../../utils/jwt');
const { CachedTokenValidator } = require('../../utils/jwt');
const { extractTokenFromRequest } = require('../../utils/jwt');

// Initialize services with app configuration
const jwtService = new JWTService({
  accessTokenSecret: process.env.JWT_ACCESS_SECRET,
  refreshTokenSecret: process.env.JWT_REFRESH_SECRET,
  resetTokenSecret: process.env.JWT_RESET_SECRET,
  verifyTokenSecret: process.env.JWT_VERIFY_SECRET,
  apiTokenSecret: process.env.JWT_API_SECRET,
  
  accessTokenExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
  refreshTokenExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  resetTokenExpiry: process.env.JWT_RESET_EXPIRY || '1h',
  verifyTokenExpiry: process.env.JWT_VERIFY_EXPIRY || '24h',
  apiTokenExpiry: process.env.JWT_API_EXPIRY || '30d',
  
  algorithm: process.env.JWT_ALGORITHM || 'HS256',
  issuer: process.env.APP_NAME || 'JobPortal',
  audience: process.env.APP_URL || 'http://localhost:3000',
});

// Initialize Redis for token blacklisting (if configured)
let tokenBlacklist = null;
let cachedValidator = null;

if (process.env.REDIS_URL) {
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL);
  
  tokenBlacklist = new TokenBlacklist(redis);
  
  // Override isTokenRevoked method
  jwtService.isTokenRevoked = async function(tokenId) {
    return await tokenBlacklist.has(tokenId);
  };
  
  // Create cached validator
  cachedValidator = new CachedTokenValidator(jwtService, redis);
}

/**
 * Authentication Middleware
 * Verifies JWT token and attaches user to request
 */
const authenticate = (options = {}) => {
  return async (req, res, next) => {
    try {
      const {
        requiredRole = null,
        tokenType = 'access',
        allowQueryToken = false,
        checkRevocation = true,
        requiredClaims = {},
      } = options;

      // Extract token from request
      const token = extractTokenFromRequest(req, { allowQueryToken });
      
      if (!token) {
        return res.status(401).json({
          success: false,
          error: 'NO_TOKEN',
          message: 'Authentication token is required',
          code: 'AUTH_TOKEN_REQUIRED',
        });
      }

      // Use cached validator if available
      let decoded;
      if (cachedValidator) {
        const result = await cachedValidator.validate(token, tokenType, options);
        if (!result.valid) {
          return handleJWTError(res, result);
        }
        decoded = result;
      } else {
        // Direct validation
        decoded = jwtService.validateToken(token, tokenType, { requiredClaims });
        
        if (!decoded || !decoded.valid) {
          return handleJWTError(res, decoded);
        }
      }

      // Check if token is revoked
      if (checkRevocation && decoded.jti) {
        const isRevoked = await jwtService.isTokenRevoked(decoded.jti);
        if (isRevoked) {
          return res.status(401).json({
            success: false,
            error: 'TOKEN_REVOKED',
            message: 'Token has been revoked',
            code: 'TOKEN_REVOKED',
          });
        }
      }

      // Check role if required
      if (requiredRole) {
        const roles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
        if (!roles.includes(decoded.role)) {
          return res.status(403).json({
            success: false,
            error: 'INSUFFICIENT_PERMISSIONS',
            message: `Required role: ${roles.join(' or ')}`,
            code: 'ROLE_NOT_AUTHORIZED',
          });
        }
      }

      // Attach user to request
      req.user = {
        id: decoded.sub,
        email: decoded.email,
        role: decoded.role,
        tokenId: decoded.jti,
        tokenType: decoded.type || tokenType,
        claims: decoded,
      };

      // Attach token metadata
      req.token = {
        id: decoded.jti,
        type: decoded.type || tokenType,
        issuedAt: new Date(decoded.iat * 1000),
        expiresAt: new Date(decoded.exp * 1000),
      };

      // Add token to response headers for tracking
      res.setHeader('X-Request-Id', req.requestId || decoded.jti);
      res.setHeader('X-User-Id', decoded.sub);

      next();
    } catch (error) {
      console.error('Authentication error:', error);
      
      // Handle specific error types
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'INVALID_TOKEN',
          message: 'Invalid authentication token',
          code: 'INVALID_TOKEN',
        });
      }

      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'TOKEN_EXPIRED',
          message: 'Authentication token has expired',
          code: 'TOKEN_EXPIRED',
          expiredAt: error.expiredAt,
        });
      }

      return res.status(500).json({
        success: false,
        error: 'AUTHENTICATION_FAILED',
        message: 'Authentication failed',
        code: 'INTERNAL_AUTH_ERROR',
      });
    }
  };
};

/**
 * Optional Authentication Middleware
 * Tries to authenticate but doesn't fail if token is invalid/missing
 */
const optionalAuth = (options = {}) => {
  return async (req, res, next) => {
    try {
      const token = extractTokenFromRequest(req, options);
      
      if (!token) {
        return next();
      }

      const decoded = jwtService.validateToken(token, options.tokenType || 'access', options);
      
      if (decoded && decoded.valid && decoded.jti) {
        // Check if token is revoked
        const isRevoked = await jwtService.isTokenRevoked(decoded.jti);
        
        if (!isRevoked) {
          req.user = {
            id: decoded.sub,
            email: decoded.email,
            role: decoded.role,
            tokenId: decoded.jti,
            tokenType: decoded.type || 'access',
            claims: decoded,
          };

          req.token = {
            id: decoded.jti,
            type: decoded.type || 'access',
            issuedAt: new Date(decoded.iat * 1000),
            expiresAt: new Date(decoded.exp * 1000),
          };
        }
      }
    } catch (error) {
      // Silently ignore authentication errors for optional auth
      console.debug('Optional auth failed:', error.message);
    }
    
    next();
  };
};

/**
 * Role-Based Authorization Middleware
 * Must be used after authenticate middleware
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: `Insufficient permissions. Required roles: ${allowedRoles.join(', ')}`,
        code: 'INSUFFICIENT_PERMISSIONS',
        userRole: req.user.role,
        requiredRoles: allowedRoles,
      });
    }

    next();
  };
};

/**
 * Resource Ownership Middleware
 * Checks if user owns the resource or has admin privileges
 */
const isOwnerOrAdmin = (resourceOwnerIdPath = 'params.userId') => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Admin bypass
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return next();
    }

    // Extract owner ID from request path
    const paths = resourceOwnerIdPath.split('.');
    let ownerId = req;
    for (const path of paths) {
      ownerId = ownerId[path];
      if (ownerId === undefined) break;
    }

    if (!ownerId) {
      return res.status(400).json({
        success: false,
        error: 'BAD_REQUEST',
        message: 'Resource owner ID not found in request',
        code: 'OWNER_ID_MISSING',
      });
    }

    // Check ownership
    if (req.user.id !== ownerId && req.user.id !== ownerId.toString()) {
      return res.status(403).json({
        success: false,
        error: 'FORBIDDEN',
        message: 'You do not have permission to access this resource',
        code: 'NOT_OWNER',
        userId: req.user.id,
        resourceOwnerId: ownerId,
      });
    }

    next();
  };
};

/**
 * Permission-Based Authorization Middleware
 * Checks for specific permissions in token claims
 */
const hasPermission = (...requiredPermissions) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Extract permissions from token claims
    const userPermissions = req.user.claims.permissions || 
                          req.user.claims.scopes || 
                          [];

    // Check for admin override
    if (req.user.role === 'admin' || req.user.role === 'superadmin') {
      return next();
    }

    // Check if user has all required permissions
    const hasAllPermissions = requiredPermissions.every(permission =>
      userPermissions.includes(permission)
    );

    if (!hasAllPermissions) {
      return res.status(403).json({
        success: false,
        error: 'INSUFFICIENT_PERMISSIONS',
        message: `Required permissions: ${requiredPermissions.join(', ')}`,
        code: 'MISSING_PERMISSIONS',
        userPermissions,
        requiredPermissions,
      });
    }

    next();
  };
};

/**
 * Token Refresh Middleware
 * Handles refresh token validation and new token generation
 */
const refreshToken = () => {
  return async (req, res, next) => {
    try {
      const refreshToken = extractTokenFromRequest(req, { 
        allowQueryToken: true,
        headerNames: ['x-refresh-token', 'refresh-token']
      });

      if (!refreshToken) {
        return res.status(400).json({
          success: false,
          error: 'NO_REFRESH_TOKEN',
          message: 'Refresh token is required',
          code: 'REFRESH_TOKEN_REQUIRED',
        });
      }

      // Verify refresh token
      const decoded = jwtService.verifyRefreshToken(refreshToken);
      
      if (!decoded || !decoded.valid) {
        return handleJWTError(res, decoded);
      }

      // Check if refresh token is revoked
      if (decoded.jti) {
        const isRevoked = await jwtService.isTokenRevoked(decoded.jti);
        if (isRevoked) {
          return res.status(401).json({
            success: false,
            error: 'REFRESH_TOKEN_REVOKED',
            message: 'Refresh token has been revoked',
            code: 'REFRESH_TOKEN_REVOKED',
          });
        }
      }

      // Get user from database
      const user = await getUserById(decoded.sub);
      
      if (!user) {
        return res.status(401).json({
          success: false,
          error: 'USER_NOT_FOUND',
          message: 'User account no longer exists',
          code: 'USER_DELETED',
        });
      }

      // Check if user is active
      if (user.status !== 'active') {
        return res.status(403).json({
          success: false,
          error: 'ACCOUNT_INACTIVE',
          message: 'User account is not active',
          code: 'ACCOUNT_DISABLED',
          userStatus: user.status,
        });
      }

      // Generate new token pair
      const deviceInfo = {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        fingerprint: req.headers['x-device-fingerprint'],
      };

      const tokens = jwtService.generateTokenPair(user, deviceInfo);

      // Store refresh token in database
      await storeRefreshToken(user.id, tokens.refreshToken, {
        deviceInfo,
        ip: req.ip,
      });

      // Revoke old refresh token
      if (tokenBlacklist && decoded.jti) {
        await tokenBlacklist.add(decoded.jti, 7 * 24 * 60 * 60); // 7 days
      }

      // Attach tokens to response
      res.locals.tokens = tokens;
      res.locals.user = user;

      next();
    } catch (error) {
      console.error('Token refresh error:', error);
      return res.status(401).json({
        success: false,
        error: 'REFRESH_FAILED',
        message: 'Failed to refresh token',
        code: 'REFRESH_ERROR',
        details: error.message,
      });
    }
  };
};

/**
 * API Token Authentication Middleware
 * For machine-to-machine communication
 */
const apiTokenAuth = (requiredScopes = []) => {
  return async (req, res, next) => {
    try {
      const apiToken = extractTokenFromRequest(req, {
        headerNames: ['x-api-token', 'api-token']
      });

      if (!apiToken) {
        return res.status(401).json({
          success: false,
          error: 'NO_API_TOKEN',
          message: 'API token is required',
          code: 'API_TOKEN_REQUIRED',
        });
      }

      const decoded = jwtService.verifyApiToken(apiToken, requiredScopes);
      
      if (!decoded || !decoded.valid) {
        return handleJWTError(res, decoded);
      }

      // Check token type
      if (decoded.type !== 'api') {
        return res.status(401).json({
          success: false,
          error: 'INVALID_TOKEN_TYPE',
          message: 'Invalid token type. API token required.',
          code: 'WRONG_TOKEN_TYPE',
        });
      }

      // Attach API client to request
      req.apiClient = {
        id: decoded.sub,
        scopes: decoded.scopes || [],
        metadata: decoded.metadata || {},
        tokenId: decoded.jti,
      };

      // Rate limiting for API tokens
      const rateLimitKey = `api_rate_limit:${decoded.sub}`;
      const rateLimit = await checkRateLimit(rateLimitKey, {
        limit: decoded.metadata?.rateLimit || 100,
        window: 3600, // 1 hour
      });

      if (!rateLimit.allowed) {
        res.setHeader('X-RateLimit-Limit', rateLimit.limit);
        res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
        res.setHeader('X-RateLimit-Reset', rateLimit.reset);
        
        return res.status(429).json({
          success: false,
          error: 'RATE_LIMIT_EXCEEDED',
          message: 'API rate limit exceeded',
          code: 'RATE_LIMITED',
          retryAfter: rateLimit.reset - Math.floor(Date.now() / 1000),
        });
      }

      // Add rate limit headers
      res.setHeader('X-RateLimit-Limit', rateLimit.limit);
      res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
      res.setHeader('X-RateLimit-Reset', rateLimit.reset);

      next();
    } catch (error) {
      console.error('API token auth error:', error);
      return res.status(401).json({
        success: false,
        error: 'API_AUTH_FAILED',
        message: 'API authentication failed',
        code: 'API_AUTH_ERROR',
      });
    }
  };
};

/**
 * Two-Factor Authentication Middleware
 * Requires 2FA verification for sensitive operations
 */
const require2FA = () => {
  return async (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        error: 'UNAUTHORIZED',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Check if 2FA is enabled for the user
    const user2FA = await getUser2FAStatus(req.user.id);
    
    if (!user2FA.enabled) {
      return next(); // 2FA not required
    }

    // Check for 2FA token in request
    const twoFactorToken = req.headers['x-2fa-token'] || 
                          req.body.twoFactorToken ||
                          req.query.twoFactorToken;

    if (!twoFactorToken) {
      return res.status(403).json({
        success: false,
        error: '2FA_REQUIRED',
        message: 'Two-factor authentication is required',
        code: '2FA_TOKEN_REQUIRED',
        methods: user2FA.methods,
      });
    }

    // Verify 2FA token
    try {
      const isValid = await verify2FAToken(req.user.id, twoFactorToken, user2FA.method);
      
      if (!isValid) {
        return res.status(401).json({
          success: false,
          error: 'INVALID_2FA_TOKEN',
          message: 'Invalid two-factor authentication token',
          code: '2FA_INVALID',
        });
      }
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: '2FA_VERIFICATION_FAILED',
        message: 'Two-factor authentication failed',
        code: '2FA_ERROR',
      });
    }

    next();
  };
};

/**
 * Device Fingerprint Validation Middleware
 * Adds extra security by validating device fingerprint
 */
const validateDevice = () => {
  return async (req, res, next) => {
    if (!req.user) {
      return next();
    }

    const deviceFingerprint = req.headers['x-device-fingerprint'];
    
    if (!deviceFingerprint) {
      return res.status(400).json({
        success: false,
        error: 'DEVICE_FINGERPRINT_REQUIRED',
        message: 'Device fingerprint is required for enhanced security',
        code: 'DEVICE_FP_MISSING',
      });
    }

    // Check if this device is trusted
    const isTrustedDevice = await checkTrustedDevice(req.user.id, deviceFingerprint);
    
    if (!isTrustedDevice) {
      // Log suspicious activity
      await logSuspiciousActivity(req.user.id, {
        type: 'untrusted_device',
        ip: req.ip,
        userAgent: req.headers['user-agent'],
        deviceFingerprint,
      });

      // Send security alert
      await sendSecurityAlert(req.user.id, {
        type: 'new_device',
        ip: req.ip,
        location: await getLocationFromIP(req.ip),
        deviceInfo: req.headers['user-agent'],
      });

      return res.status(403).json({
        success: false,
        error: 'UNTRUSTED_DEVICE',
        message: 'This device is not recognized. Please verify your identity.',
        code: 'DEVICE_NOT_TRUSTED',
        requiresVerification: true,
      });
    }

    // Update device last seen
    await updateDeviceLastSeen(req.user.id, deviceFingerprint);

    next();
  };
};

/**
 * Rate Limiting Middleware
 * Limits requests based on user ID or IP
 */
const rateLimit = (options = {}) => {
  return async (req, res, next) => {
    const {
      windowMs = 15 * 60 * 1000, // 15 minutes
      max = 100, // limit each IP to 100 requests per windowMs
      keyGenerator = (req) => req.ip, // default key is IP address
      skipSuccessfulRequests = false,
      message = 'Too many requests, please try again later.',
    } = options;

    const key = keyGenerator(req);
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      // Use Redis for distributed rate limiting
      if (process.env.REDIS_URL) {
        const redisKey = `rate_limit:${key}`;
        const current = await redis.incr(redisKey);
        
        if (current === 1) {
          await redis.expire(redisKey, Math.ceil(windowMs / 1000));
        }

        if (current > max) {
          res.setHeader('X-RateLimit-Limit', max);
          res.setHeader('X-RateLimit-Remaining', 0);
          res.setHeader('X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));
          
          return res.status(429).json({
            success: false,
            error: 'RATE_LIMIT_EXCEEDED',
            message,
            code: 'RATE_LIMITED',
            retryAfter: Math.ceil((windowStart + windowMs - now) / 1000),
          });
        }

        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', Math.max(0, max - current));
        res.setHeader('X-RateLimit-Reset', Math.ceil((windowStart + windowMs) / 1000));
      } else {
        // In-memory rate limiting for development
        const memoryKey = `rate_limit_${key}`;
        const windowKey = `${memoryKey}_window`;
        
        if (!global.rateLimitStore) {
          global.rateLimitStore = new Map();
        }

        const currentWindow = global.rateLimitStore.get(windowKey) || 0;
        const lastReset = global.rateLimitStore.get(`${memoryKey}_reset`) || 0;

        if (now - lastReset > windowMs) {
          // Reset window
          global.rateLimitStore.set(windowKey, 1);
          global.rateLimitStore.set(`${memoryKey}_reset`, now);
        } else {
          if (currentWindow >= max) {
            return res.status(429).json({
              success: false,
              error: 'RATE_LIMIT_EXCEEDED',
              message,
              code: 'RATE_LIMITED',
            });
          }
          global.rateLimitStore.set(windowKey, currentWindow + 1);
        }
      }

      // Skip incrementing for successful requests if configured
      const originalSend = res.send;
      res.send = function(data) {
        if (skipSuccessfulRequests && res.statusCode < 400) {
          // Don't count successful requests
        }
        originalSend.call(this, data);
      };

      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      next(); // Fail open for rate limiting errors
    }
  };
};

/**
 * Audit Logging Middleware
 * Logs all authenticated requests for auditing
 */
const auditLog = (options = {}) => {
  return async (req, res, next) => {
    const startTime = Date.now();
    const originalSend = res.send;

    res.send = function(data) {
      const duration = Date.now() - startTime;
      
      // Log the request
      if (req.user || req.apiClient) {
        const auditEntry = {
          timestamp: new Date().toISOString(),
          userId: req.user?.id || req.apiClient?.id,
          userRole: req.user?.role || 'api_client',
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
          requestId: req.requestId,
          tokenId: req.user?.tokenId || req.apiClient?.tokenId,
          metadata: {
            params: req.params,
            query: req.query,
            body: req.body ? JSON.stringify(req.body).substring(0, 1000) : null,
          },
        };

        // Log to database or external service
        logAuditEntry(auditEntry).catch(console.error);
      }

      return originalSend.call(this, data);
    };

    next();
  };
};

/**
 * CSRF Protection Middleware
 * Protects against Cross-Site Request Forgery
 */
const csrfProtection = (options = {}) => {
  return async (req, res, next) => {
    // Skip CSRF for API routes and GET/HEAD/OPTIONS
    if (req.path.startsWith('/api/') || 
        ['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const csrfToken = req.headers['x-csrf-token'] || 
                     req.body._csrf || 
                     req.query._csrf;

    // Get expected CSRF token from session
    const expectedToken = req.session?.csrfToken;

    if (!csrfToken || !expectedToken || csrfToken !== expectedToken) {
      return res.status(403).json({
        success: false,
        error: 'CSRF_TOKEN_INVALID',
        message: 'Invalid or missing CSRF token',
        code: 'CSRF_FAILED',
      });
    }

    // Regenerate CSRF token for next request
    if (req.session) {
      req.session.csrfToken = generateCSRFToken();
    }

    next();
  };
};

/**
 * Security Headers Middleware
 * Adds security-related HTTP headers
 */
const securityHeaders = () => {
  return (req, res, next) => {
    // Content Security Policy
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline';"
    );

    // X-Frame-Options
    res.setHeader('X-Frame-Options', 'DENY');

    // X-Content-Type-Options
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Referrer-Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions-Policy
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

    // X-XSS-Protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Strict-Transport-Security (only in production)
    if (process.env.NODE_ENV === 'production') {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    // Cache-Control for API responses
    if (req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }

    next();
  };
};

/**
 * Input Validation Middleware
 * Validates and sanitizes request input
 */
const validateInput = (schema, options = {}) => {
  return async (req, res, next) => {
    try {
      const { 
        location = 'body', 
        allowUnknown = false,
        stripUnknown = true,
      } = options;

      const data = req[location];
      
      // Validate using Joi or similar
      const { error, value } = schema.validate(data, {
        allowUnknown,
        stripUnknown,
        abortEarly: false,
      });

      if (error) {
        const validationErrors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type,
        }));

        return res.status(400).json({
          success: false,
          error: 'VALIDATION_ERROR',
          message: 'Input validation failed',
          code: 'VALIDATION_FAILED',
          errors: validationErrors,
        });
      }

      // Replace request data with validated data
      req[location] = value;

      // Sanitize input
      sanitizeInput(req[location]);

      next();
    } catch (error) {
      console.error('Input validation error:', error);
      return res.status(500).json({
        success: false,
        error: 'VALIDATION_PROCESSING_ERROR',
        message: 'Failed to validate input',
        code: 'VALIDATION_ERROR',
      });
    }
  };
};

/**
 * Error Handling Middleware for Authentication
 */
const authErrorHandler = (err, req, res, next) => {
  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Invalid or expired token',
      code: 'TOKEN_INVALID',
    });
  }

  if (err.name === 'ForbiddenError') {
    return res.status(403).json({
      success: false,
      error: 'FORBIDDEN',
      message: 'Insufficient permissions',
      code: 'ACCESS_DENIED',
    });
  }

  // JWT-specific errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid authentication token',
      code: 'TOKEN_MALFORMED',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      error: 'TOKEN_EXPIRED',
      message: 'Authentication token has expired',
      code: 'TOKEN_EXPIRED',
      expiredAt: err.expiredAt,
    });
  }

  next(err);
};

/**
 * Helper function to handle JWT errors
 */
const handleJWTError = (res, errorResult) => {
  if (!errorResult || !errorResult.error) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Invalid authentication token',
      code: 'TOKEN_INVALID',
    });
  }

  switch (errorResult.error) {
    case 'TOKEN_EXPIRED':
      return res.status(401).json({
        success: false,
        error: 'TOKEN_EXPIRED',
        message: errorResult.message || 'Token has expired',
        code: 'TOKEN_EXPIRED',
        expiredAt: errorResult.expiredAt,
      });

    case 'INVALID_SIGNATURE':
    case 'MALFORMED_TOKEN':
    case 'INVALID_TOKEN':
      return res.status(401).json({
        success: false,
        error: 'INVALID_TOKEN',
        message: errorResult.message || 'Invalid token',
        code: 'TOKEN_INVALID',
      });

    case 'TOKEN_NOT_ACTIVE':
      return res.status(401).json({
        success: false,
        error: 'TOKEN_NOT_ACTIVE',
        message: errorResult.message || 'Token is not yet active',
        code: 'TOKEN_NOT_ACTIVE',
        activeAt: errorResult.activeAt,
      });

    default:
      return res.status(401).json({
        success: false,
        error: 'AUTHENTICATION_FAILED',
        message: errorResult.message || 'Authentication failed',
        code: 'AUTH_ERROR',
      });
  }
};

/**
 * Helper function to check rate limit
 */
async function checkRateLimit(key, options) {
  const { limit = 100, window = 3600 } = options;
  
  if (process.env.REDIS_URL) {
    const current = await redis.incr(`rate_limit:${key}`);
    if (current === 1) {
      await redis.expire(`rate_limit:${key}`, window);
    }

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      reset: Math.floor(Date.now() / 1000) + window,
      limit,
    };
  }

  // In-memory fallback
  return {
    allowed: true,
    remaining: limit,
    reset: Math.floor(Date.now() / 1000) + window,
    limit,
  };
}

/**
 * Helper function to sanitize input
 */
function sanitizeInput(obj) {
  if (typeof obj !== 'object' || obj === null) return;

  for (const key in obj) {
    if (typeof obj[key] === 'string') {
      // Remove script tags and sanitize
      obj[key] = obj[key]
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+="[^"]*"/gi, '')
        .replace(/on\w+='[^']*'/gi, '')
        .replace(/on\w+=\w+/gi, '')
        .trim();
    } else if (typeof obj[key] === 'object') {
      sanitizeInput(obj[key]);
    }
  }
}

/**
 * Helper function to generate CSRF token
 */
function generateCSRFToken() {
  return require('crypto').randomBytes(32).toString('hex');
}

// Database helper functions (these would be implemented in your models)
async function getUserById(userId) {
  // Implement database lookup
  // return await User.findById(userId);
  return { id: userId, status: 'active' }; // Mock
}

async function getUser2FAStatus(userId) {
  // Implement 2FA status check
  // return await TwoFA.findByUserId(userId);
  return { enabled: false, methods: [] }; // Mock
}

async function verify2FAToken(userId, token, method) {
  // Implement 2FA verification
  return true; // Mock
}

async function storeRefreshToken(userId, token, metadata) {
  // Implement refresh token storage
  // await RefreshToken.create({ userId, token, ...metadata });
}

async function checkTrustedDevice(userId, fingerprint) {
  // Implement trusted device check
  return true; // Mock
}

async function updateDeviceLastSeen(userId, fingerprint) {
  // Implement device update
}

async function logSuspiciousActivity(userId, data) {
  // Implement activity logging
  console.log('Suspicious activity:', { userId, ...data });
}

async function sendSecurityAlert(userId, data) {
  // Implement security alert sending
}

async function getLocationFromIP(ip) {
  // Implement IP geolocation
  return 'Unknown';
}

async function logAuditEntry(entry) {
  // Implement audit logging
  console.log('Audit log:', entry);
}

// Export all middleware functions
module.exports = {
  // Core authentication
  authenticate,
  optionalAuth,
  authorize,
  refreshToken,
  apiTokenAuth,
  
  // Authorization
  isOwnerOrAdmin,
  hasPermission,
  require2FA,
  
  // Security
  validateDevice,
  rateLimit,
  csrfProtection,
  securityHeaders,
  validateInput,
  
  // Monitoring
  auditLog,
  
  // Error handling
  authErrorHandler,
  
  // Service instances
  jwtService,
  tokenBlacklist,
  cachedValidator,
  
  // Helper functions
  extractTokenFromRequest,
  handleJWTError,
};
