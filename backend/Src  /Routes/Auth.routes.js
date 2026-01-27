const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const sendEmail = require('../services/email.service');
const authMiddleware = require('../middleware/auth.middleware');

const prisma = new PrismaClient();

// Validation middleware
const validateRegister = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('firstName').trim().notEmpty(),
  body('lastName').trim().notEmpty(),
  body('role').isIn(['WORKER', 'EMPLOYER', 'FREELANCER', 'VOLUNTEER', 'SELLER'])
];

const validateLogin = [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty()
];

// Generate tokens
const generateTokens = (userId, role) => {
  const accessToken = jwt.sign(
    { userId, role },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '1h' }
  );

  const refreshToken = jwt.sign(
    { userId, role },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );

  return { accessToken, refreshToken };
};

// Register new user
router.post('/register', validateRegister, async (req, res) => {
  try {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password, firstName, lastName, role, phone } = req.body;

    // Check if user exists
    const existingUser = await prisma.user.findUnique({
      where: { email }
    });

    if (existingUser) {
      return res.status(400).json({ error: 'User already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Create user with profile
    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        role,
        profile: {
          create: {
            firstName,
            lastName,
            phone
          }
        },
        // Create role-specific profile
        ...(role === 'WORKER' && {
          workerProfile: {
            create: {}
          }
        }),
        ...(role === 'EMPLOYER' && {
          employerProfile: {
            create: {
              companyName: `${firstName}'s Company`
            }
          }
        }),
        ...(role === 'FREELANCER' && {
          freelancerProfile: {
            create: {}
          }
        }),
        ...(role === 'VOLUNTEER' && {
          volunteerProfile: {
            create: {}
          }
        }),
        ...(role === 'SELLER' && {
          sellerProfile: {
            create: {}
          }
        })
      },
      include: {
        profile: true
      }
    });

    // Generate tokens
    const tokens = generateTokens(user.id, user.role);

    // Save refresh token (optional - could store in database)
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Send welcome email
    try {
      await sendEmail({
        to: user.email,
        subject: 'Welcome to Kin2 Workforce Platform!',
        template: 'welcome',
        data: {
          name: `${firstName} ${lastName}`,
          role: role.toLowerCase()
        }
      });
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    // Return user data (excluding password)
    const { password: _, ...userWithoutPassword } = user;

    res.status(201).json({
      message: 'Registration successful',
      user: userWithoutPassword,
      ...tokens
    });
  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', validateLogin, async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    });

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check status
    if (user.status !== 'ACTIVE') {
      return res.status(403).json({ 
        error: 'Account not active', 
        status: user.status 
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Generate tokens
    const tokens = generateTokens(user.id, user.role);

    // Update last login
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() }
    });

    // Log login
    await prisma.loginHistory.create({
      data: {
        userId: user.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      }
    });

    // Return user data (excluding password)
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful',
      user: userWithoutPassword,
      ...tokens
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Refresh token
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);

    // Check if user exists and is active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, role: true, status: true }
    });

    if (!user || user.status !== 'ACTIVE') {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    // Generate new tokens
    const tokens = generateTokens(user.id, user.role);

    res.json(tokens);
  } catch (error) {
    console.error('Refresh token error:', error);
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

// Logout
router.post('/logout', authMiddleware.verifyToken, async (req, res) => {
  try {
    // In a real implementation, you might want to:
    // 1. Add the token to a blacklist
    // 2. Remove refresh token from database
    // 3. Clear session data
    
    res.json({ message: 'Logout successful' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Logout failed' });
  }
});

// Get current user
router.get('/me', authMiddleware.verifyToken, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      include: {
        profile: true,
        ...(req.userRole === 'WORKER' && { workerProfile: true }),
        ...(req.userRole === 'EMPLOYER' && { employerProfile: true }),
        ...(req.userRole === 'FREELANCER' && { freelancerProfile: true }),
        ...(req.userRole === 'VOLUNTEER' && { volunteerProfile: true }),
        ...(req.userRole === 'SELLER' && { sellerProfile: true })
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password: _, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Forgot password
router.post('/forgot-password', [
  body('email').isEmail().normalizeEmail()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email } = req.body;

    // Find user
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    });

    if (!user) {
      // Don't reveal that user doesn't exist
      return res.json({ 
        message: 'If an account exists, you will receive reset instructions' 
      });
    }

    // Generate reset token
    const resetToken = jwt.sign(
      { userId: user.id, type: 'password_reset' },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    // Store reset token (in a real app, store in database with expiry)
    await prisma.verification.create({
      data: {
        userId: user.id,
        token: resetToken,
        type: 'PASSWORD_RESET',
        expiresAt: new Date(Date.now() + 3600000) // 1 hour
      }
    });

    // Send reset email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    await sendEmail({
      to: user.email,
      subject: 'Reset Your Password',
      template: 'password-reset',
      data: {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        resetUrl,
        expiryHours: 1
      }
    });

    res.json({ 
      message: 'Password reset instructions sent to your email' 
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ error: 'Failed to process request' });
  }
});

// Reset password
router.post('/reset-password', [
  body('token').notEmpty(),
  body('password').isLength({ min: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token, password } = req.body;

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (decoded.type !== 'password_reset') {
      return res.status(400).json({ error: 'Invalid token type' });
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
      return res.status(400).json({ error: 'Invalid or expired token' });
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
      data: { used: true, usedAt: new Date() }
    });

    // Notify user
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { profile: true }
    });

    await sendEmail({
      to: user.email,
      subject: 'Password Reset Successful',
      template: 'password-reset-success',
      data: {
        name: `${user.profile.firstName} ${user.profile.lastName}`
      }
    });

    res.json({ message: 'Password reset successful' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// Verify email
router.post('/verify-email', async (req, res) => {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ error: 'Token required' });
    }

    // Verify token
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(400).json({ error: 'Invalid or expired token' });
    }

    if (decoded.type !== 'email_verification') {
      return res.status(400).json({ error: 'Invalid token type' });
    }

    // Update user status
    await prisma.user.update({
      where: { id: decoded.userId },
      data: { status: 'ACTIVE' }
    });

    // Mark token as used
    await prisma.verification.updateMany({
      where: {
        userId: decoded.userId,
        type: 'EMAIL_VERIFICATION',
        used: false
      },
      data: { used: true, usedAt: new Date() }
    });

    res.json({ message: 'Email verified successfully' });
  } catch (error) {
    console.error('Verify email error:', error);
    res.status(500).json({ error: 'Failed to verify email' });
  }
});

// Change password
router.post('/change-password', authMiddleware.verifyToken, [
  body('currentPassword').notEmpty(),
  body('newPassword').isLength({ min: 8 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { currentPassword, newPassword } = req.body;
    const userId = req.userId;

    // Get user with password
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 12);

    // Update password
    await prisma.user.update({
      where: { id: userId },
      data: { password: hashedPassword }
    });

    // Log password change
    await prisma.auditLog.create({
      data: {
        userId: userId,
        action: 'PASSWORD_CHANGE',
        resourceType: 'USER',
        resourceId: userId,
        ipAddress: req.ip
      }
    });

    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
