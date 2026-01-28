const express = require('express');
const { body, query, param } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const multer = require('multer');
const path = require('path');
const fs = require('fs').promises;

// Import middleware and services
const { logger } = require('../../server');
const {
  asyncHandler,
  ValidationError,
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ConflictError,
  validateRequest,
} = require('../middleware/errorHandler');
const {
  authenticate,
  authorize,
  authorizeSelfOrAdmin,
  hasPermission,
} = require('../middleware/auth');

const prisma = new PrismaClient();
const router = express.Router();

// Create child logger for users module
const userLogger = logger.child('users');

// ======================
// FILE UPLOAD CONFIGURATION
// ======================

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../uploads/users');
    // Create directory if it doesn't exist
    fs.mkdir(uploadDir, { recursive: true }).then(() => {
      cb(null, uploadDir);
    }).catch(err => {
      cb(err, uploadDir);
    });
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `user-${req.user.id}-${uniqueSuffix}${ext}`);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new ValidationError('Invalid file type. Only images and PDFs are allowed.'), false);
  }
};

const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 1
  }
});

// ======================
// VALIDATION SCHEMAS
// ======================

const updateProfileSchema = [
  body('firstName').optional().trim().notEmpty().withMessage('First name cannot be empty'),
  body('lastName').optional().trim().notEmpty().withMessage('Last name cannot be empty'),
  body('phone').optional().trim().matches(/^[+]?[\d\s\-()]+$/).withMessage('Invalid phone number'),
  body('location').optional().trim(),
  body('bio').optional().trim().isLength({ max: 1000 }).withMessage('Bio must be less than 1000 characters'),
  body('skills').optional().isArray().withMessage('Skills must be an array'),
  body('socialLinks').optional().isObject().withMessage('Social links must be an object'),
];

const updateWorkerProfileSchema = [
  body('experienceLevel').optional().isIn(['BEGINNER', 'INTERMEDIATE', 'EXPERT']).withMessage('Invalid experience level'),
  body('hourlyRate').optional().isFloat({ min: 0 }).withMessage('Hourly rate must be a positive number'),
  body('availability').optional().isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE']).withMessage('Invalid availability'),
  body('skills').optional().isArray().withMessage('Skills must be an array'),
  body('certifications').optional().isArray().withMessage('Certifications must be an array'),
  body('education').optional().isArray().withMessage('Education must be an array'),
  body('languages').optional().isArray().withMessage('Languages must be an array'),
];

const updateEmployerProfileSchema = [
  body('companyName').optional().trim().notEmpty().withMessage('Company name cannot be empty'),
  body('companySize').optional().isIn(['SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE']).withMessage('Invalid company size'),
  body('industry').optional().trim(),
  body('website').optional().trim().isURL().withMessage('Invalid website URL'),
  body('description').optional().trim().isLength({ max: 2000 }).withMessage('Description must be less than 2000 characters'),
];

const searchUsersSchema = [
  query('role').optional().isIn(['WORKER', 'EMPLOYER', 'FREELANCER', 'VOLUNTEER', 'SELLER']),
  query('skills').optional().isString(),
  query('location').optional().isString(),
  query('experienceLevel').optional().isIn(['BEGINNER', 'INTERMEDIATE', 'EXPERT']),
  query('page').optional().isInt({ min: 1 }).toInt(),
  query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
  query('sortBy').optional().isIn(['createdAt', 'lastLogin', 'name', 'rating']),
  query('sortOrder').optional().isIn(['asc', 'desc']),
];

// ======================
// HELPER FUNCTIONS
// ======================

/**
 * Get user with appropriate profile based on role
 */
async function getUserWithProfile(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      profile: true,
      // Include role-specific profile
      workerProfile: true,
      employerProfile: true,
      freelancerProfile: true,
      volunteerProfile: true,
      sellerProfile: true,
      _count: {
        select: {
          jobs: true,
          applications: true,
          reviews: true,
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

  // Remove sensitive data
  delete user.password;
  delete user.refreshTokens;
  
  return user;
}

/**
 * Format user data for response
 */
function formatUserResponse(user) {
  const baseUser = {
    id: user.id,
    email: user.email,
    role: user.role,
    status: user.status,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
    lastLogin: user.lastLogin,
    profile: user.profile,
    stats: user._count,
  };

  // Add role-specific profile
  switch (user.role) {
    case 'WORKER':
      baseUser.workerProfile = user.workerProfile;
      break;
    case 'EMPLOYER':
      baseUser.employerProfile = user.employerProfile;
      break;
    case 'FREELANCER':
      baseUser.freelancerProfile = user.freelancerProfile;
      break;
    case 'VOLUNTEER':
      baseUser.volunteerProfile = user.volunteerProfile;
      break;
    case 'SELLER':
      baseUser.sellerProfile = user.sellerProfile;
      break;
  }

  return baseUser;
}

/**
 * Search users with filters
 */
async function searchUsers(filters = {}, page = 1, limit = 20) {
  const skip = (page - 1) * limit;
  const where = {};

  // Build where clause based on filters
  if (filters.role) {
    where.role = filters.role;
  }

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.location) {
    where.profile = {
      location: {
        contains: filters.location,
        mode: 'insensitive'
      }
    };
  }

  if (filters.skills) {
    const skills = filters.skills.split(',').map(s => s.trim());
    where.workerProfile = {
      skills: {
        hasSome: skills
      }
    };
  }

  if (filters.experienceLevel) {
    where.workerProfile = {
      ...where.workerProfile,
      experienceLevel: filters.experienceLevel
    };
  }

  // Search by name
  if (filters.search) {
    where.OR = [
      {
        profile: {
          firstName: {
            contains: filters.search,
            mode: 'insensitive'
          }
        }
      },
      {
        profile: {
          lastName: {
            contains: filters.search,
            mode: 'insensitive'
          }
        }
      },
      {
        email: {
          contains: filters.search,
          mode: 'insensitive'
        }
      }
    ];
  }

  // Build orderBy
  const orderBy = {};
  if (filters.sortBy) {
    switch (filters.sortBy) {
      case 'name':
        orderBy.profile = {
          firstName: filters.sortOrder || 'asc'
        };
        break;
      case 'lastLogin':
        orderBy.lastLogin = filters.sortOrder || 'desc';
        break;
      case 'rating':
        orderBy.rating = filters.sortOrder || 'desc';
        break;
      default:
        orderBy[filters.sortBy] = filters.sortOrder || 'desc';
    }
  } else {
    orderBy.createdAt = 'desc';
  }

  // Execute query
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        profile: true,
        workerProfile: true,
        employerProfile: true,
        freelancerProfile: true,
        volunteerProfile: true,
        sellerProfile: true,
        _count: {
          select: {
            jobs: true,
            applications: true,
            reviews: true
          }
        }
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.user.count({ where })
  ]);

  // Format users and remove sensitive data
  const formattedUsers = users.map(user => {
    const { password, refreshTokens, ...safeUser } = user;
    return formatUserResponse(safeUser);
  });

  return {
    users: formattedUsers,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    }
  };
}

// ======================
// USER ROUTES
// ======================

/**
 * @route   GET /api/v1/users/me
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/me',
  authenticate(),
  asyncHandler(async (req, res) => {
    const user = await getUserWithProfile(req.user.id);
    
    userLogger.info('User profile retrieved', {
      userId: req.user.id,
      role: req.user.role,
    });
    
    res.json({
      success: true,
      user: formatUserResponse(user),
    });
  })
);

/**
 * @route   PUT /api/v1/users/me
 * @desc    Update current user profile
 * @access  Private
 */
router.put('/me',
  authenticate(),
  validateRequest(updateProfileSchema),
  asyncHandler(async (req, res) => {
    const { firstName, lastName, phone, location, bio, skills, socialLinks } = req.body;
    
    userLogger.info('Updating user profile', {
      userId: req.user.id,
      updates: Object.keys(req.body),
    });
    
    // Update profile
    const updatedUser = await prisma.user.update({
      where: { id: req.user.id },
      data: {
        profile: {
          update: {
            firstName,
            lastName,
            phone,
            location,
            bio,
            socialLinks,
          }
        }
      },
      include: {
        profile: true,
      }
    });
    
    // Update skills if provided and user is a worker
    if (skills && Array.isArray(skills) && req.user.role === 'WORKER') {
      await prisma.workerProfile.update({
        where: { userId: req.user.id },
        data: { skills }
      });
    }
    
    // Get full updated user
    const user = await getUserWithProfile(req.user.id);
    
    userLogger.success('User profile updated', {
      userId: req.user.id,
    });
    
    // Audit log
    logger.audit('profile_updated', {
      userId: req.user.id,
      changes: Object.keys(req.body),
    });
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: formatUserResponse(user),
    });
  })
);

/**
 * @route   GET /api/v1/users/profile/:userId
 * @desc    Get user profile by ID (public)
 * @access  Public
 */
router.get('/profile/:userId',
  optionalAuth(),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        // Include role-specific profile (public info only)
        workerProfile: req.query.includeDetails === 'true',
        employerProfile: req.query.includeDetails === 'true',
        freelancerProfile: req.query.includeDetails === 'true',
        volunteerProfile: req.query.includeDetails === 'true',
        sellerProfile: req.query.includeDetails === 'true',
        _count: {
          select: {
            jobs: true,
            applications: req.user?.id === userId, // Only show if own profile
            reviews: true,
          }
        }
      }
    });
    
    if (!user) {
      throw new NotFoundError('User');
    }
    
    // Check if user is active
    if (user.status !== 'ACTIVE') {
      throw new NotFoundError('User');
    }
    
    // Remove sensitive data for public viewing
    const publicUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
      profile: user.profile,
      stats: user._count,
    };
    
    // Add role-specific profile if requested and allowed
    if (req.query.includeDetails === 'true') {
      switch (user.role) {
        case 'WORKER':
          publicUser.workerProfile = user.workerProfile;
          break;
        case 'EMPLOYER':
          publicUser.employerProfile = user.employerProfile;
          break;
        case 'FREELANCER':
          publicUser.freelancerProfile = user.freelancerProfile;
          break;
        case 'VOLUNTEER':
          publicUser.volunteerProfile = user.volunteerProfile;
          break;
        case 'SELLER':
          publicUser.sellerProfile = user.sellerProfile;
          break;
      }
    }
    
    userLogger.debug('Public profile viewed', {
      viewerId: req.user?.id || 'anonymous',
      profileUserId: userId,
    });
    
    res.json({
      success: true,
      user: publicUser,
    });
  })
);

/**
 * @route   PUT /api/v1/users/me/worker-profile
 * @desc    Update worker profile
 * @access  Private (Worker only)
 */
router.put('/me/worker-profile',
  authenticate({ requiredRole: 'WORKER' }),
  validateRequest(updateWorkerProfileSchema),
  asyncHandler(async (req, res) => {
    const {
      experienceLevel,
      hourlyRate,
      availability,
      skills,
      certifications,
      education,
      languages
    } = req.body;
    
    userLogger.info('Updating worker profile', {
      userId: req.user.id,
      updates: Object.keys(req.body),
    });
    
    const updatedProfile = await prisma.workerProfile.upsert({
      where: { userId: req.user.id },
      update: {
        experienceLevel,
        hourlyRate,
        availability,
        skills,
        certifications,
        education,
        languages,
        updatedAt: new Date(),
      },
      create: {
        userId: req.user.id,
        experienceLevel,
        hourlyRate,
        availability,
        skills,
        certifications,
        education,
        languages,
      }
    });
    
    // Get updated user
    const user = await getUserWithProfile(req.user.id);
    
    userLogger.success('Worker profile updated', {
      userId: req.user.id,
    });
    
    res.json({
      success: true,
      message: 'Worker profile updated successfully',
      workerProfile: updatedProfile,
      user: formatUserResponse(user),
    });
  })
);

/**
 * @route   PUT /api/v1/users/me/employer-profile
 * @desc    Update employer profile
 * @access  Private (Employer only)
 */
router.put('/me/employer-profile',
  authenticate({ requiredRole: 'EMPLOYER' }),
  validateRequest(updateEmployerProfileSchema),
  asyncHandler(async (req, res) => {
    const {
      companyName,
      companySize,
      industry,
      website,
      description
    } = req.body;
    
    userLogger.info('Updating employer profile', {
      userId: req.user.id,
      updates: Object.keys(req.body),
    });
    
    const updatedProfile = await prisma.employerProfile.upsert({
      where: { userId: req.user.id },
      update: {
        companyName,
        companySize,
        industry,
        website,
        description,
        updatedAt: new Date(),
      },
      create: {
        userId: req.user.id,
        companyName,
        companySize,
        industry,
        website,
        description,
      }
    });
    
    // Get updated user
    const user = await getUserWithProfile(req.user.id);
    
    userLogger.success('Employer profile updated', {
      userId: req.user.id,
    });
    
    res.json({
      success: true,
      message: 'Employer profile updated successfully',
      employerProfile: updatedProfile,
      user: formatUserResponse(user),
    });
  })
);

/**
 * @route   POST /api/v1/users/me/avatar
 * @desc    Upload user avatar
 * @access  Private
 */
router.post('/me/avatar',
  authenticate(),
  upload.single('avatar'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new ValidationError('Avatar file is required');
    }
    
    const fileUrl = `/uploads/users/${req.file.filename}`;
    
    // Update user profile with avatar URL
    await prisma.profile.update({
      where: { userId: req.user.id },
      data: { avatarUrl: fileUrl }
    });
    
    // Delete old avatar if exists
    const oldProfile = await prisma.profile.findUnique({
      where: { userId: req.user.id },
      select: { avatarUrl: true }
    });
    
    if (oldProfile?.avatarUrl && oldProfile.avatarUrl.startsWith('/uploads/')) {
      const oldPath = path.join(__dirname, '../..', oldProfile.avatarUrl);
      try {
        await fs.unlink(oldPath);
      } catch (error) {
        userLogger.warn('Failed to delete old avatar', {
          error: error.message,
          path: oldPath,
        });
      }
    }
    
    userLogger.success('Avatar uploaded', {
      userId: req.user.id,
      fileUrl,
    });
    
    res.json({
      success: true,
      message: 'Avatar uploaded successfully',
      avatarUrl: fileUrl,
    });
  })
);

/**
 * @route   DELETE /api/v1/users/me/avatar
 * @desc    Delete user avatar
 * @access  Private
 */
router.delete('/me/avatar',
  authenticate(),
  asyncHandler(async (req, res) => {
    const profile = await prisma.profile.findUnique({
      where: { userId: req.user.id },
      select: { avatarUrl: true }
    });
    
    if (!profile?.avatarUrl) {
      throw new NotFoundError('Avatar');
    }
    
    // Delete file from server
    if (profile.avatarUrl.startsWith('/uploads/')) {
      const filePath = path.join(__dirname, '../..', profile.avatarUrl);
      try {
        await fs.unlink(filePath);
      } catch (error) {
        userLogger.warn('Failed to delete avatar file', {
          error: error.message,
          path: filePath,
        });
      }
    }
    
    // Update profile
    await prisma.profile.update({
      where: { userId: req.user.id },
      data: { avatarUrl: null }
    });
    
    userLogger.info('Avatar deleted', {
      userId: req.user.id,
    });
    
    res.json({
      success: true,
      message: 'Avatar deleted successfully',
    });
  })
);

/**
 * @route   GET /api/v1/users/search
 * @desc    Search users with filters
 * @access  Private
 */
router.get('/search',
  authenticate(),
  validateRequest(searchUsersSchema),
  asyncHandler(async (req, res) => {
    const {
      role,
      skills,
      location,
      experienceLevel,
      search,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;
    
    userLogger.info('User search', {
      searchParams: req.query,
      searcherId: req.user.id,
    });
    
    const filters = {
      role,
      skills,
      location,
      experienceLevel,
      search,
    };
    
    const result = await searchUsers(filters, parseInt(page), parseInt(limit));
    
    userLogger.debug('Search completed', {
      results: result.users.length,
      total: result.pagination.total,
    });
    
    res.json({
      success: true,
      ...result,
    });
  })
);

/**
 * @route   GET /api/v1/users
 * @desc    Get all users (Admin only)
 * @access  Private (Admin)
 */
router.get('/',
  authenticate({ requiredRole: 'ADMIN' }),
  validateRequest([
    query('page').optional().isInt({ min: 1 }).toInt(),
    query('limit').optional().isInt({ min: 1, max: 100 }).toInt(),
    query('role').optional().isIn(['WORKER', 'EMPLOYER', 'FREELANCER', 'VOLUNTEER', 'SELLER']),
    query('status').optional().isIn(['ACTIVE', 'PENDING', 'SUSPENDED', 'DELETED']),
  ]),
  asyncHandler(async (req, res) => {
    const { page = 1, limit = 20, role, status } = req.query;
    const skip = (page - 1) * limit;
    
    const where = {};
    if (role) where.role = role;
    if (status) where.status = status;
    
    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where,
        include: {
          profile: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: parseInt(skip),
        take: parseInt(limit),
      }),
      prisma.user.count({ where })
    ]);
    
    // Remove sensitive data
    const safeUsers = users.map(user => {
      const { password, refreshTokens, ...safeUser } = user;
      return safeUser;
    });
    
    userLogger.info('Admin user list retrieved', {
      adminId: req.user.id,
      totalUsers: total,
    });
    
    res.json({
      success: true,
      users: safeUsers,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit),
      },
    });
  })
);

/**
 * @route   GET /api/v1/users/:userId
 * @desc    Get user by ID (Admin only)
 * @access  Private (Admin)
 */
router.get('/:userId',
  authenticate({ requiredRole: 'ADMIN' }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        workerProfile: true,
        employerProfile: true,
        freelancerProfile: true,
        volunteerProfile: true,
        sellerProfile: true,
        refreshTokens: {
          select: {
            id: true,
            createdAt: true,
            expiresAt: true,
            revoked: true,
            userAgent: true,
            ipAddress: true,
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        loginHistory: {
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
        auditLogs: {
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      }
    });
    
    if (!user) {
      throw new NotFoundError('User');
    }
    
    userLogger.info('Admin user details retrieved', {
      adminId: req.user.id,
      targetUserId: userId,
    });
    
    // Don't expose password
    delete user.password;
    
    res.json({
      success: true,
      user,
    });
  })
);

/**
 * @route   PUT /api/v1/users/:userId/status
 * @desc    Update user status (Admin only)
 * @access  Private (Admin)
 */
router.put('/:userId/status',
  authenticate({ requiredRole: 'ADMIN' }),
  validateRequest([
    body('status').isIn(['ACTIVE', 'SUSPENDED', 'DELETED']).withMessage('Invalid status'),
    body('reason').optional().isString().isLength({ max: 500 }),
  ]),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    const { status, reason } = req.body;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      throw new NotFoundError('User');
    }
    
    // Prevent modifying admin users
    if (user.role === 'ADMIN' && req.user.id !== userId) {
      throw new AuthorizationError('Cannot modify admin users');
    }
    
    const oldStatus = user.status;
    
    // Update user status
    const updatedUser = await prisma.user.update({
      where: { id: userId },
      data: { status }
    });
    
    // Log status change
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_STATUS_CHANGE',
        resourceType: 'USER',
        resourceId: userId,
        details: {
          oldStatus,
          newStatus: status,
          reason,
        },
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    });
    
    // Revoke all tokens if suspended or deleted
    if (status === 'SUSPENDED' || status === 'DELETED') {
      await prisma.refreshToken.updateMany({
        where: { userId, revoked: false },
        data: { revoked: true, revokedAt: new Date() }
      });
    }
    
    // Send notification email
    try {
      const sendEmail = require('../services/email.service');
      const userProfile = await prisma.profile.findUnique({
        where: { userId }
      });
      
      await sendEmail({
        to: updatedUser.email,
        subject: `Account ${status.toLowerCase()} - Kin2 Workforce`,
        template: 'account-status-change',
        data: {
          name: `${userProfile.firstName} ${userProfile.lastName}`,
          status,
          reason,
          contactEmail: process.env.SUPPORT_EMAIL || 'support@kin2workforce.com',
        }
      });
    } catch (emailError) {
      userLogger.error('Failed to send status change email', {
        error: logger.formatError(emailError),
        userId,
      });
    }
    
    userLogger.info('User status updated', {
      adminId: req.user.id,
      targetUserId: userId,
      oldStatus,
      newStatus: status,
    });
    
    res.json({
      success: true,
      message: `User status updated to ${status}`,
      user: {
        id: updatedUser.id,
        email: updatedUser.email,
        role: updatedUser.role,
        status: updatedUser.status,
      },
    });
  })
);

/**
 * @route   DELETE /api/v1/users/:userId
 * @desc    Delete user (Admin only)
 * @access  Private (Admin)
 */
router.delete('/:userId',
  authenticate({ requiredRole: 'ADMIN' }),
  asyncHandler(async (req, res) => {
    const { userId } = req.params;
    
    const user = await prisma.user.findUnique({
      where: { id: userId }
    });
    
    if (!user) {
      throw new NotFoundError('User');
    }
    
    // Prevent deleting admin users
    if (user.role === 'ADMIN') {
      throw new AuthorizationError('Cannot delete admin users');
    }
    
    // Soft delete: mark as deleted instead of actually deleting
    const deletedUser = await prisma.user.update({
      where: { id: userId },
      data: { 
        status: 'DELETED',
        email: `deleted_${Date.now()}_${user.email}`,
        deletedAt: new Date(),
      }
    });
    
    // Revoke all tokens
    await prisma.refreshToken.updateMany({
      where: { userId, revoked: false },
      data: { revoked: true, revokedAt: new Date() }
    });
    
    // Log deletion
    await prisma.auditLog.create({
      data: {
        userId: req.user.id,
        action: 'USER_DELETED',
        resourceType: 'USER',
        resourceId: userId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      }
    });
    
    userLogger.info('User deleted', {
      adminId: req.user.id,
      targetUserId: userId,
    });
    
    res.json({
      success: true,
      message: 'User deleted successfully',
    });
  })
);

/**
 * @route   POST /api/v1/users/me/verify-email
 * @desc    Request email verification
 * @access  Private
 */
router.post('/me/verify-email',
  authenticate(),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id }
    });
    
    if (user.emailVerified) {
      throw new ValidationError('Email already verified');
    }
    
    // Generate verification token
    const jwt = require('jsonwebtoken');
    const verificationToken = jwt.sign(
      { userId: user.id, type: 'email_verification' },
      process.env.JWT_VERIFY_SECRET || process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );
    
    // Store verification token
    await prisma.verification.create({
      data: {
        userId: user.id,
        token: verificationToken,
        type: 'EMAIL_VERIFICATION',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      }
    });
    
    // Send verification email
    try {
      const sendEmail = require('../services/email.service');
      const userProfile = await prisma.profile.findUnique({
        where: { userId: user.id }
      });
      
      const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;
      
      await sendEmail({
        to: user.email,
        subject: 'Verify Your Email - Kin2 Workforce',
        template: 'email-verification',
        data: {
          name: `${userProfile.firstName} ${userProfile.lastName}`,
          verificationUrl,
        }
      });
    } catch (emailError) {
      userLogger.error('Failed to send verification email', {
        error: logger.formatError(emailError),
        userId: user.id,
      });
      throw new Error('Failed to send verification email');
    }
    
    userLogger.info('Email verification requested', {
      userId: user.id,
    });
    
    res.json({
      success: true,
      message: 'Verification email sent. Please check your inbox.',
    });
  })
);

/**
 * @route   GET /api/v1/users/me/stats
 * @desc    Get user statistics
 * @access  Private
 */
router.get('/me/stats',
  authenticate(),
  asyncHandler(async (req, res) => {
    const [stats, recentActivity] = await Promise.all([
      // Get counts
      prisma.user.findUnique({
        where: { id: req.user.id },
        include: {
          _count: {
            select: {
              jobs: true,
              applications: true,
              reviews: true,
              notifications: {
                where: { read: false }
              },
              savedJobs: true,
            }
          }
        }
      }),
      
      // Get recent activity
      prisma.auditLog.findMany({
        where: { userId: req.user.id },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          action: true,
          resourceType: true,
          resourceId: true,
          createdAt: true,
          details: true,
        }
      })
    ]);
    
    // Get role-specific stats
    let roleStats = {};
    if (req.user.role === 'WORKER') {
      const workerStats = await prisma.application.groupBy({
        by: ['status'],
        where: { userId: req.user.id },
        _count: true,
      });
      roleStats.applications = workerStats;
    } else if (req.user.role === 'EMPLOYER') {
      const employerStats = await prisma.job.groupBy({
        by: ['status'],
        where: { employerId: req.user.id },
        _count: true,
      });
      roleStats.jobs = employerStats;
    }
    
    userLogger.debug('User stats retrieved', {
      userId: req.user.id,
    });
    
    res.json({
      success: true,
      stats: {
        counts: stats._count,
        roleStats,
        recentActivity,
      },
    });
  })
);

/**
 * @route   GET /api/v1/users/me/sessions
 * @desc    Get active sessions
 * @access  Private
 */
router.get('/me/sessions',
  authenticate(),
  asyncHandler(async (req, res) => {
    const sessions = await prisma.refreshToken.findMany({
      where: {
        userId: req.user.id,
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
 * @route   DELETE /api/v1/users/me/sessions/:sessionId
 * @desc    Revoke specific session
 * @access  Private
 */
router.delete('/me/sessions/:sessionId',
  authenticate(),
  asyncHandler(async (req, res) => {
    const { sessionId } = req.params;
    
    const session = await prisma.refreshToken.findFirst({
      where: {
        id: sessionId,
        userId: req.user.id,
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
    
    userLogger.info('Session revoked', {
      userId: req.user.id,
      sessionId,
    });
    
    res.json({
      success: true,
      message: 'Session revoked successfully',
    });
  })
);

/**
 * @route   DELETE /api/v1/users/me/sessions
 * @desc    Revoke all sessions except current
 * @access  Private
 */
router.delete('/me/sessions',
  authenticate(),
  asyncHandler(async (req, res) => {
    // Get current token ID
    const currentTokenId = req.user.tokenId;
    
    // Revoke all other sessions
    await prisma.refreshToken.updateMany({
      where: {
        userId: req.user.id,
        revoked: false,
        NOT: { token: currentTokenId }
      },
      data: { 
        revoked: true, 
        revokedAt: new Date() 
      }
    });
    
    userLogger.info('All other sessions revoked', {
      userId: req.user.id,
      currentTokenId,
    });
    
    res.json({
      success: true,
      message: 'All other sessions revoked successfully',
    });
  })
);

module.exports = router;
