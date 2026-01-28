const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const sendEmail = require('../services/email.service');
const authMiddleware = require('../middleware/auth.middleware');

// Import error handling and logging
const { logger } = require('../../server');
const {
  asyncHandler,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  validateRequest,
} = require('../middleware/errorHandler');

const prisma = new PrismaClient();
const router = express.Router();

// Create child logger for auth module
const authLogger = logger.child('auth');

// Validation schemas
const registerSchema = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('role').isIn(['WORKER', 'EMPLOYER', 'FREELANCER', 'VOLUNTEER', 'SELLER'])
    .withMessage('Valid role is required'),
];

const loginSchema = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
];

const forgotPasswordSchema = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
];

const resetPasswordSchema = [
  body('token').notEmpty().withMessage('Reset token is required'),
  body('password').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
];

const changePasswordSchema = [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters'),
];

/**
 * Generate JWT tokens
 */
const generateTokens = (userId, role, email) => {
  const accessToken = jwt.sign(
    { userId, role, email },
    process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this',
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

  const refreshToken = jwt.sign(
    { userId, role, email, type: 'refresh' },
    process.env.JWT_REFRESH_SECRET || 'your-refresh-token-secret-change-this',
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

/**
 * @route   POST /api/v1/auth/register
 * @desc    Register new user
 * @access  Public
 */
router.post('/register',
  // Audit logging for registration
  logger.auditLogger('user_registration', (req) => ({ 
    email: req.body.email,
    role: req.body.role,
    source: req.body.source || 'direct',
  })),
  
  // Business logging
  logger.businessLogger('user_registered', (req, res, body) => ({
    userId: body.user?.id,
    email: req.body.email,
    role: req.body.role,
    source: req.body.source || 'direct',
  })),
  
  validateRequest(registerSchema),
  asyncHandler(async (req, res) => {
    const { email, password, firstName, lastName, role, phone, source } = req.body;
    
    authLogger.info('Registration attempt', {
      email,
      role,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    
    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      authLogger.warn('Registration failed - user already exists', { email });
      throw new ConflictError('User already exists with this email');
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Create user with profile
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role,
        status: 'PENDING', // Email verification required
        source: source || 'direct',
        profile: {
          create: {
            firstName,
            lastName,
            phone: phone || null,
          }
        },
        // Create role-specific profile
        ...(role === 'WORKER' && {
          workerProfile: {
            create: {
              skills: [],
              experienceLevel: 'BEGINNER',
            }
          }
        }),
        ...(role === 'EMPLOYER' && {
          employerProfile: {
            create: {
              companyName: `${firstName}'s Company`,
              companySize: 'SMALL',
            }
          }
        }),
        ...(role === 'FREELANCER' && {
          freelancerProfile: {
            create: {
              hourlyRate: 0,
              skills: [],
            }
          }
        }),
        ...(role === 'VOLUNTEER' && {
          volunteerProfile: {
            create: {
              causes: [],
              availability: 'FLEXIBLE',
            }
          }
        }),
        ...(role === 'SELLER' && {
          sellerProfile: {
            create: {
              storeName: `${firstName}'s Store`,
            }
          }
        })
      },
      include: {
        profile: true
      }
    });
    
    // Generate verification token
    const verificationToken = jwt.sign(
      { userId: user.id, type: 'email_verification' },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this',
      { expiresIn: '24h' }
    );
    
    // Store verification token
    await prisma.verification.create({
      data: {
        userId: user.id,
        token: verificationToken,
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24 hours
      }
    });
    
    // Generate auth tokens
    const tokens = generateTokens(user.id, user.role, user.email);
    
    // Save refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      }
    });
    
    // Send welcome email with verification link
    try {
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      await sendEmail({
        to: user.email,
        subject: 'Welcome to Kin2 Workforce Platform!',
        template: 'welcome',
        data: {
          name: `${firstName} ${lastName}`,
          role: role.toLowerCase(),
          verificationUrl,
        }
      });
      authLogger.info('Welcome email sent', { email: user.email });
    } catch (emailError) {
      authLogger.error('Failed to send welcome email', {
        error: logger.formatError(emailError),
        email: user.email,
      });
      // Don't throw error, continue registration
    }
    
    authLogger.success('User registered successfully', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    
    // Business event
    logger.business('user_registered', {
      userId: user.id,
      email: user.email,
      role: user.role,
      plan: 'free',
      referral: req.body.referralCode,
    });
    
    // Return user data (excluding password)
    const { password: _, ...userWithoutPassword } = user;
    
    res.status(201).json({
      success: true,
      message: 'Registration successful. Please check your email to verify your account.',
      user: userWithoutPassword,
      ...tokens,
    });
  })
);

/**
 * @route   POST /api/v1/auth/login
 * @desc    Authenticate user & get token
 * @access  Public
 */
router.post('/login',
  // Security logging for login attempts
  logger.securityLogger('login_attempt', (req) => ({
    email: req.body.email,
    success: false, // Will be updated in handler
  })),
  
  validateRequest(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body;
    
    authLogger.verbose('Login attempt', {
      email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    
    // Find user with profile
    const user = await prisma.user.findUnique({
      where: { email },
      include: { 
        profile: true,
        refreshTokens: {
          where: {
            revoked: false,
            expiresAt: { gt: new Date() }
          },
          take: 1,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!user) {
      authLogger.warn('Login failed - user not found', { email, ip: req.ip });
      throw new AuthenticationError('Invalid credentials');
    }
    
    // Check account status
    if (user.status !== 'ACTIVE') {
      authLogger.warn('Login failed - account not active', { 
        email, 
        status: user.status,
        ip: req.ip 
      });
      
      throw new AuthenticationError(
        user.status === 'PENDING' 
          ? 'Please verify your email address'
          : 'Your account has been suspended',
        user.status
      );
    }
    
    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      authLogger.warn('Login failed - invalid password', { 
        email, 
        ip: req.ip 
      });
      throw new AuthenticationError('Invalid credentials');
    }
    
    // Generate tokens
    const tokens = generateTokens(user.id, user.role, user.email);
    
    // Save new refresh token
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: tokens.refreshToken,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      }
    });
    
    // Revoke old refresh tokens (keep last 3)
    const oldTokens = await prisma.refreshToken.findMany({
      where: {
        userId: user.id,
        revoked: false,
      },
      orderBy: { createdAt: 'desc' },
      skip: 2, // Keep 2 most recent tokens
    });
    
    if (oldTokens.length > 0) {
      await prisma.refreshToken.updateMany({
        where: {
          id: { in: oldTokens.map(t => t.id) }
        },
        data: { revoked: true, revokedAt: new Date() }
      });
    }
    
    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });
    
    // Log login history
    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        success: true,
      }
    });
    
    // Update security log with success
    logger.security('login_success', {
      userId: user.id,
      email: user.email,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    
    authLogger.info('Login successful', {
      userId: user.id,
      email: user.email,
      role: user.role,
    });
    
    // Return user data (excluding password)
    const { password: _, refreshTokens, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Login successful',
      user: userWithoutPassword,
      ...tokens,
    });
  })
);

/**
 * @route   POST /api/v1/auth/refresh
 * @desc    Refresh access token
 * @access  Public
 */
router.post('/refresh', asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  
  if (!refreshToken) {
    throw new ValidationError('Refresh token is required');
  }
  
  // Verify refresh token in database
  const storedToken = await prisma.refreshToken.findFirst({
    where: {
      token: refreshToken,
      revoked: false,
      expiresAt: { gt: new Date() }
    },
    include: { user: true }
  });
  
  if (!storedToken) {
    authLogger.warn('Refresh token invalid or expired', { 
      token: refreshToken.substring(0, 20) + '...' 
    });
    throw new AuthenticationError('Invalid or expired refresh token');
  }
  
  // Verify JWT
  let decoded;
  try {
    decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || 'your-refresh-token-secret-change-this');
  } catch (error) {
    // Mark token as revoked if invalid
    await prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revoked: true, revokedAt: new Date() }
    });
    
    authLogger.warn('Refresh token JWT verification failed', {
      error: error.message,
      tokenId: storedToken.id,
    });
    
    throw new AuthenticationError('Invalid refresh token');
  }
  
  // Check if user exists and is active
  if (!storedToken.user || storedToken.user.status !== 'ACTIVE') {
    throw new AuthenticationError('User account is not active');
  }
  
  // Generate new tokens
  const newTokens = generateTokens(
    storedToken.user.id, 
    storedToken.user.role,
    storedToken.user.email
  );
  
  // Save new refresh token
  await prisma.refreshToken.create({
    data: {
      userId: storedToken.userId,
      token: newTokens.refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    }
  });
  
  // Revoke the old refresh token
  await prisma.refreshToken.update({
    where: { id: storedToken.id },
    data: { 
      revoked: true, 
      revokedAt: new Date(),
      replacedByToken: newTokens.refreshToken
    }
  });
  
  authLogger.info('Token refreshed successfully', {
    userId: storedToken.userId,
    oldTokenId: storedToken.id,
  });
  
  res.json({
    success: true,
    message: 'Token refreshed successfully',
    ...newTokens,
  });
}));

/**
 * @route   POST /api/v1/auth/logout
 * @desc    Logout user (revoke tokens)
 * @access  Private
 */
router.post('/logout', 
  authMiddleware.verifyToken,
  asyncHandler(async (req, res) => {
    const { refreshToken } = req.body;
    
    // Revoke refresh token if provided
    if (refreshToken) {
      await prisma.refreshToken.updateMany({
        where: {
          token: refreshToken,
          userId: req.userId,
          revoked: false,
        },
        data: { 
          revoked: true, 
          revokedAt: new Date() 
        }
      });
    }
    
    // Optionally revoke all user's refresh tokens
    if (req.body.allDevices) {
      await prisma.refreshToken.updateMany({
        where: {
          userId: req.userId,
          revoked: false,
        },
        data: { 
          revoked: true, 
          revokedAt: new Date() 
        }
      });
    }
    
    authLogger.info('User logged out', {
      userId: req.userId,
      allDevices: req.body.allDevices || false,
    });
    
    res.json({
      success: true,
      message: 'Logout successful',
    });
  })
);

/**
 * @route   GET /api/v1/auth/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me',
  authMiddleware.verifyToken,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: {
        profile: true,
        ...(req.userRole === 'WORKER' && { 
          workerProfile: true 
        }),
        ...(req.userRole === 'EMPLOYER' && { 
          employerProfile: true 
        }),
        ...(req.userRole === 'FREELANCER' && { 
          freelancerProfile: true 
        }),
        ...(req.userRole === 'VOLUNTEER' && { 
          volunteerProfile: true 
        }),
        ...(req.userRole === 'SELLER' && { 
          sellerProfile: true 
        }),
        _count: {
          select: {
            jobs: true,
            applications: true,
            notifications: {
              where: { read: false }
            }
          }
        }
      }
    });

    if (!user) {
      throw new NotFoundError('User');
    }
    
    const { password: _, ...userWithoutPassword } = user;
    
    authLogger.debug('User profile retrieved', {
      userId: req.userId,
    });
    
    res.json({
      success: true,
      user: userWithoutPassword,
    });
  })
);

/**
 * @route   POST /api/v1/auth/forgot-password
 * @desc    Request password reset
 * @access  Public
 */
router.post('/forgot-password',
  validateRequest(forgotPasswordSchema),
  asyncHandler(async (req, res) => {
    const { email } = req.body;
    
    authLogger.info('Password reset requested', { email });
    
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    });

    if (!user) {
      // Don't reveal that user doesn't exist (security best practice)
      authLogger.info('Password reset request for non-existent email', { email });
      
      // Still return success to prevent email enumeration
      return res.json({
        success: true,
        message: 'If an account exists, you will receive reset instructions',
      });
    }
    
    if (user.status !== 'ACTIVE') {
      throw new AuthenticationError('Account is not active');
    }
    
    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, type: 'password_reset' },
      process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this',
      { expiresIn: '1h' }
    );
    
    // Store reset token
    await prisma.verification.create({
      data: {
        userId: user.id,
        token: resetToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600000), // 1 hour
      }
    });
    
    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    try {
      await sendEmail({
        to: user.email,
        subject: 'Reset Your Password - Kin2 Workforce',
        template: 'password-reset',
        data: {
          name: `${user.profile.firstName} ${user.profile.lastName}`,
          resetUrl,
          expiryHours: 1,
        }
      });
      
      authLogger.info('Password reset email sent', { email: user.email });
    } catch (emailError) {
      authLogger.error('Failed to send password reset email', {
        error: logger.formatError(emailError),
        email: user.email,
      });
      throw new Error('Failed to send reset email. Please try again later.');
    }
    
    res.json({
      success: true,
      message: 'Password reset instructions sent to your email',
    });
  })
);

/**
 * @route   POST /api/v1/auth/reset-password
 * @desc    Reset password with token
 * @access  Public
 */
router.post('/reset-password',
  validateRequest(resetPasswordSchema),
  asyncHandler(async (req, res) => {
    const { token, password } = req.body;
    
    authLogger.info('Password reset attempt', { 
      token: token.substring(0, 20) + '...' 
    });
    
    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this');
    } catch (error) {
      throw new AuthenticationError('Invalid or expired reset token');
    }

    if (decoded.type !== 'password_reset') {
      throw new AuthenticationError('Invalid token type');
    }
    
    // Check if token exists in database
    const verification = await prisma.verification.findFirst({
      where: {
        userId: decoded.userId,
        token,
        type: 'PASSWORD_RESET',
        expiresAt: { gt: new Date() },
        used: false
      }
    });

    if (!verification) {
      throw new AuthenticationError('Invalid or expired reset token');
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(password, 12);
    
    // Update password
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { password: hashedPassword }
    });
    
    // Mark token as used
    await prisma.verification.update({
      where: { id: verification.id },
      data: { 
        used: true, 
        usedAt: new Date() 
      }
    });
    
    // Revoke all refresh tokens for security
    await prisma.refreshToken.updateMany({
      where: {
        userId: decoded.userId,
        revoked: false,
      },
      data: { 
        revoked: true, 
        revokedAt: new Date() 
      }
    });
    
    // Notify user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { profile: true }
    });

    try {
      await sendEmail({
        to: user.email,
        subject: 'Password Reset Successful - Kin2 Workforce',
        template: 'password-reset-success',
        data: {
          name: `${user.profile.firstName} ${user.profile.lastName}`,
        }
      });
    } catch (emailError) {
      authLogger.error('Failed to send password reset success email', {
        error: logger.formatError(emailError),
        email: user.email,
      });
      // Don't throw, password reset was successful
    }
    
    authLogger.info('Password reset successful', { userId: decoded.userId });
    
    res.json({
      success: true,
      message: 'Password reset successful. You can now login with your new password.',
    });
  })
);

/**
 * @route   POST /api/v1/auth/verify-email
 * @desc    Verify email address
 * @access  Public
 */
router.post('/verify-email', asyncHandler(async (req, res) => {
  const { token } = req.body;
  
  if (!token) {
    throw new ValidationError('Verification token is required');
  }
  
  authLogger.info('Email verification attempt', { 
    token: token.substring(0, 20) + '...' 
  });
  
  // Verify token
  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this');
  } catch (error) {
    throw new AuthenticationError('Invalid or expired verification token');
  }

  if (decoded.type !== 'email_verification') {
    throw new AuthenticationError('Invalid token type');
  }
  
  // Check if token exists in database
  const verification = await prisma.verification.findFirst({
    where: {
      userId: decoded.userId,
      token,
      type: 'EMAIL_VERIFICATION',
      expiresAt: { gt: new Date() },
      used: false
    }
  });

  if (!verification) {
    throw new AuthenticationError('Invalid or expired verification token');
  }
  
  // Update user status
  await prisma.user.update({
    where: { id: decoded.userId },
    data: { 
      status: 'ACTIVE',
      emailVerified: true,
      emailVerifiedAt: new Date(),
    }
  });
  
  // Mark token as used
  await prisma.verification.update({
    where: { id: verification.id },
    data: { 
      used: true, 
      usedAt: new Date() 
    }
  });
  
  // Get user info for logging
  const user = await prisma.user.findUnique({
    where: { id: decoded.userId },
    include: { profile: true }
  });
  
  authLogger.success('Email verified successfully', {
    userId: decoded.userId,
    email: user.email,
  });
  
  // Business event
  logger.business('email_verified', {
    userId: decoded.userId,
    email: user.email,
  });
  
  res.json({
    success: true,
    message: 'Email verified successfully. Your account is now active.',
    user: {
      id: user.id,
      email: user.email,
      status: user.status,
      emailVerified: user.emailVerified,
    },
  });
}));

/**
 * @route   POST /api/v1/auth/change-password
 * @desc    Change password (authenticated)
 * @access  Private
 */
router.post('/change-password',
  authMiddleware.verifyToken,
  validateRequest(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    const userId = req.userId;
    
    authLogger.info('Password change requested', { userId });
    
    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      throw new NotFoundError('User');
    }
    
    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      authLogger.warn('Password change failed - incorrect current password', { userId });
      throw new ValidationError('Current password is incorrect');
    }
    
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);
    
    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });
    
    // Revoke all refresh tokens for security
    await prisma.refreshToken.updateMany({
      where: {
        userId: userId,
        revoked: false,
      },
      data: { 
        revoked: true, 
        revokedAt: new Date() 
      }
    });
    
    // Log password change
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'PASSWORD_CHANGE',
        resourceType: 'USER',
        resourceId: userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    });
    
    // Notify user via email
    try {
      const userWithProfile = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });
      
      await sendEmail({
        to: userWithProfile.email,
        subject: 'Password Changed - Kin2 Workforce',
        template: 'password-changed',
        data: {
          name: `${userWithProfile.profile.firstName} ${userWithProfile.profile.lastName}`,
          timestamp: new Date().toLocaleString(),
        }
      });
    } catch (emailError) {
      authLogger.error('Failed to send password change notification email', {
        error: logger.formatError(emailError),
        userId,
      });
      // Don't throw, password change was successful
    }
    
    authLogger.info('Password changed successfully', { userId });
    
    res.json({
      success: true,
      message: 'Password changed successfully. Please login again with your new password.',
    });
  })
);

/**
 * @route   GET /api/v1/auth/sessions
 * @desc    Get active sessions
 * @access  Private
 */
router.get('/sessions',
  authMiddleware.verifyToken,
  asyncHandler(async (req, res) => {
    const sessions = await prisma.refreshToken.findMany({
      where: {
        userId: req.userId,
        revoked: false,
        expiresAt: { gt: new Date() }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
      }
    });
    
    res.json({
      success: true,
      sessions,
    });
  })
);

/**
 * @route   DELETE /api/v1/auth/sessions/:sessionId
 * @desc    Revoke specific session
 * @access  Private
 */
router.delete('/sessions/:sessionId',
  authMiddleware.verifyToken,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    
    const session = await prisma.refreshToken.findFirst({
      where: {
        id: sessionId,
        userId: req.userId,
        revoked: false,
      }
    });
    
    if (!session) {
      throw new NotFoundError('Session');
    }
    
    await prisma.refreshToken.update({
      where: { id: sessionId },
      data: { 
        revoked: true, 
        revokedAt: new Date() 
      }
    });
    
    authLogger.info('Session revoked', {
      userId: req.userId,
      sessionId,
    });
    
    res.json({
      success: true,
      message: 'Session revoked successfully',
    });
  })
);

module.exports = router;
