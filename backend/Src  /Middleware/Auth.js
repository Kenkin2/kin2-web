/**
 * Authentication and authorization middleware
 */

const jwt = require('jsonwebtoken');
const { AppError, AuthenticationError, AuthorizationError } = require('./errorHandler');
const { securityLogger } = require('../utils/logger');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

/**
 * Verify JWT token
 */
const verifyToken = async (req, res, next) => {
  try {
    // Get token from header or cookie
    let token;
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    } else if (req.cookies?.accessToken) {
      token = req.cookies.accessToken;
    }

    if (!token) {
      throw new AuthenticationError('No authentication token provided');
    }

    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Check if user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: {
        profile: true,
        employer: true,
        worker: true,
        admin: true
      }
    });

    if (!user) {
      throw new AuthenticationError('User no longer exists');
    }

    if (user.status !== 'ACTIVE' && user.status !== 'VERIFIED') {
      throw new AuthenticationError(`User account is ${user.status.toLowerCase()}`);
    }

    // Check if token was issued before last password change
    if (user.lastPasswordChange && decoded.iat * 1000 < user.lastPasswordChange.getTime()) {
      throw new AuthenticationError('Password was changed. Please login again.');
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;
    
    // Update last active time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() }
    });

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      next(new AuthenticationError('Invalid token'));
    } else if (error.name === 'TokenExpiredError') {
      next(new AuthenticationError('Token expired'));
    } else {
      next(error);
    }
  }
};

/**
 * Check user role
 */
const checkRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(new AuthenticationError('Authentication required'));
    }

    if (!roles.includes(req.user.role)) {
      securityLogger.warn('Unauthorized access attempt', {
        userId: req.user.id,
        userRole: req.user.role,
        requiredRoles: roles,
        path: req.path,
        method: req.method
      });
      return next(new AuthorizationError('Insufficient permissions'));
    }

    next();
  };
};

/**
 * Check permission (for granular access control)
 */
const checkPermission = (permission) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        throw new AuthenticationError('Authentication required');
      }

      // For admins, check admin permissions
      if (req.user.role === 'ADMIN' && req.user.admin) {
        const admin = req.user.admin;
        if (admin.isSuperAdmin || admin.permissions.includes('all') || admin.permissions.includes(permission)) {
          return next();
        }
      }

      // Check based on resource ownership
      switch (permission) {
        case 'manage_own_jobs':
          if (req.params.id) {
            const job = await prisma.job.findUnique({
              where: { id: req.params.id }
            });
            if (job && job.userId === req.user.id) {
              return next();
            }
          }
          break;
          
        case 'manage_own_applications':
          if (req.params.id) {
            const application = await prisma.application.findUnique({
              where: { id: req.params.id }
            });
            if (application && application.userId === req.user.id) {
              return next();
            }
          }
          break;
          
        case 'view_own_earnings':
          if (req.params.id && req.params.id === req.user.id) {
            return next();
          }
          break;
      }

      throw new AuthorizationError('Insufficient permissions');
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Require email verification
 */
const requireVerifiedEmail = (req, res, next) => {
  if (!req.user) {
    return next(new AuthenticationError('Authentication required'));
  }

  if (!req.user.isEmailVerified) {
    return next(new AuthenticationError('Email verification required'));
  }

  next();
};

/**
 * Require 2FA for sensitive operations
 */
const require2FA = async (req, res, next) => {
  try {
    if (!req.user) {
      throw new AuthenticationError('Authentication required');
    }

    if (req.user.isTwoFactorEnabled) {
      // Check if 2FA was verified in this session
      const twoFactorVerified = req.session?.twoFactorVerified;
      if (!twoFactorVerified) {
        throw new AuthenticationError('Two-factor authentication required');
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

/**
 * API Key authentication
 */
const apiKeyAuth = async (req, res, next) => {
  try {
    const apiKey = req.headers['x-api-key'];
    
    if (!apiKey) {
      throw new AuthenticationError('API key required');
    }

    const keyRecord = await prisma.apiKey.findUnique({
      where: { key: apiKey },
      include: { user: true }
    });

    if (!keyRecord || !keyRecord.isActive) {
      throw new AuthenticationError('Invalid API key');
    }

    if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
      throw new AuthenticationError('API key expired');
    }

    // Check rate limiting for API key
    const now = Date.now();
    const windowStart = now - (15 * 60 * 1000); // 15 minutes
    
    // In production, this would use Redis
    // For now, we'll update last used time
    await prisma.apiKey.update({
      where: { id: keyRecord.id },
      data: { lastUsedAt: new Date() }
    });

    // Attach user and API key info to request
    req.user = keyRecord.user;
    req.apiKey = keyRecord;
    
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyToken,
  checkRole,
  checkPermission,
  requireVerifiedEmail,
  require2FA,
  apiKeyAuth
};
