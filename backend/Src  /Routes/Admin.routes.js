const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

// Middleware to ensure user is admin
const requireAdmin = (req, res, next) => {
  if (req.userRole !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Admin role required.' });
  }
  next();
};

// Get all users
router.get('/users', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      role,
      status,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    
    if (role) where.role = role;
    if (status) where.status = status;
    
    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        {
          profile: {
            OR: [
              { firstName: { contains: search, mode: 'insensitive' } },
              { lastName: { contains: search, mode: 'insensitive' } }
            ]
          }
        }
      ];
    }

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
              jobApplications: true,
              postedJobs: true,
              payments: true
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      prisma.user.count({ where })
    ]);

    // Remove passwords from response
    const usersWithoutPasswords = users.map(user => {
      const { password, ...userWithoutPassword } = user;
      return userWithoutPassword;
    });

    res.json({
      users: usersWithoutPasswords,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Get user by ID
router.get('/users/:id', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        profile: true,
        workerProfile: {
          include: {
            user: {
              include: {
                workerSkills: {
                  include: { skill: true }
                },
                experience: true,
                education: true,
                certifications: true
              }
            }
          }
        },
        employerProfile: {
          include: {
            user: {
              include: {
                postedJobs: {
                  include: {
                    category: true,
                    _count: {
                      select: { applications: true }
                    }
                  }
                },
                companyReviews: true
              }
            }
          }
        },
        freelancerProfile: true,
        volunteerProfile: true,
        sellerProfile: true,
        jobApplications: {
          include: {
            job: true
          },
          take: 10,
          orderBy: { appliedAt: 'desc' }
        },
        postedJobs: {
          include: {
            category: true
          },
          take: 10,
          orderBy: { postedDate: 'desc' }
        },
        payments: {
          take: 10,
          orderBy: { initiatedAt: 'desc' }
        },
        notifications: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        loginHistory: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        },
        auditLogs: {
          take: 10,
          orderBy: { createdAt: 'desc' }
        }
      }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { password, ...userWithoutPassword } = user;
    res.json(userWithoutPassword);
  } catch (error) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

// Update user
router.put('/users/:id', authMiddleware.verifyToken, requireAdmin, [
  body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'PENDING_VERIFICATION']),
  body('role').optional().isIn(['WORKER', 'EMPLOYER', 'FREELANCER', 'VOLUNTEER', 'SELLER', 'ADMIN']),
  body('email').optional().isEmail(),
  body('profile').optional().isObject(),
  body('workerProfile').optional().isObject(),
  body('employerProfile').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { profile, workerProfile, employerProfile, ...userData } = req.body;

    // Update user
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: userData
    });

    // Update profile if provided
    if (profile) {
      await prisma.profile.update({
        where: { userId: req.params.id },
        data: profile
      });
    }

    // Update worker profile if provided
    if (workerProfile && user.role === 'WORKER') {
      await prisma.workerProfile.update({
        where: { userId: req.params.id },
        data: workerProfile
      });
    }

    // Update employer profile if provided
    if (employerProfile && user.role === 'EMPLOYER') {
      await prisma.employerProfile.update({
        where: { userId: req.params.id },
        data: employerProfile
      });
    }

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'UPDATE_USER',
        resourceType: 'USER',
        resourceId: req.params.id,
        oldData: user,
        newData: req.body,
        ipAddress: req.ip
      }
    });

    const updatedUser = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        profile: true,
        ...(user.role === 'WORKER' && { workerProfile: true }),
        ...(user.role === 'EMPLOYER' && { employerProfile: true })
      }
    });

    const { password: _, ...userWithoutPassword } = updatedUser;
    res.json({
      message: 'User updated successfully',
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/users/:id', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id }
    });

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Soft delete - update status
    await prisma.user.update({
      where: { id: req.params.id },
      data: { status: 'INACTIVE' }
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'DELETE_USER',
        resourceType: 'USER',
        resourceId: req.params.id,
        oldData: user,
        ipAddress: req.ip
      }
    });

    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Get all jobs (admin view)
router.get('/jobs', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      status,
      employerId,
      categoryId,
      search,
      sortBy = 'postedDate',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    
    if (status) where.status = status;
    if (employerId) where.employerId = employerId;
    if (categoryId) where.categoryId = categoryId;
    
    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } }
      ];
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          employer: {
            include: {
              profile: true,
              employerProfile: true
            }
          },
          category: true,
          industry: true,
          _count: {
            select: { applications: true }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      prisma.job.count({ where })
    ]);

    res.json({
      jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Update job
router.put('/jobs/:id', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const updatedJob = await prisma.job.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        employer: {
          include: {
            profile: true
          }
        }
      }
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'UPDATE_JOB',
        resourceType: 'JOB',
        resourceId: req.params.id,
        oldData: job,
        newData: updatedJob,
        ipAddress: req.ip
      }
    });

    res.json({
      message: 'Job updated successfully',
      job: updatedJob
    });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// Delete job
router.delete('/jobs/:id', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Archive job instead of deleting
    await prisma.job.update({
      where: { id: req.params.id },
      data: { status: 'ARCHIVED' }
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'ARCHIVE_JOB',
        resourceType: 'JOB',
        resourceId: req.params.id,
        oldData: job,
        ipAddress: req.ip
      }
    });

    res.json({ message: 'Job archived successfully' });
  } catch (error) {
    console.error('Delete job error:', error);
    res.status(500).json({ error: 'Failed to delete job' });
  }
});

// Get all applications
router.get('/applications', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      status,
      jobId,
      applicantId,
      employerId,
      sortBy = 'appliedAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    
    if (status) where.status = status;
    if (jobId) where.jobId = jobId;
    if (applicantId) where.applicantId = applicantId;
    
    if (employerId) {
      where.job = { employerId };
    }

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          job: {
            include: {
              employer: {
                include: {
                  profile: true,
                  employerProfile: true
                }
              }
            }
          },
          applicant: {
            include: {
              profile: true,
              workerProfile: true
            }
          },
          kfnCalculations: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          interviews: {
            orderBy: { scheduledDate: 'desc' },
            take: 3
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      prisma.application.count({ where })
    ]);

    res.json({
      applications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get all applications error:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

// Get admin logs
router.get('/logs', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50,
      adminId,
      action,
      resourceType,
      resourceId,
      startDate,
      endDate,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    
    if (adminId) where.adminId = adminId;
    if (action) where.action = action;
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;
    
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.adminLog.findMany({
        where,
        include: {
          admin: {
            include: {
              profile: true
            }
          }
        },
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: parseInt(limit)
      }),
      prisma.adminLog.count({ where })
    ]);

    res.json({
      logs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get admin logs error:', error);
    res.status(500).json({ error: 'Failed to get admin logs' });
  }
});

// Get system settings
router.get('/settings', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const { category } = req.query;

    const where = {};
    if (category) where.category = category;

    const settings = await prisma.systemSetting.findMany({
      where,
      orderBy: { category: 'asc' }
    });

    res.json(settings);
  } catch (error) {
    console.error('Get system settings error:', error);
    res.status(500).json({ error: 'Failed to get system settings' });
  }
});

// Update system setting
router.put('/settings/:key', authMiddleware.verifyToken, requireAdmin, [
  body('value').notEmpty(),
  body('type').optional().isIn(['STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'ARRAY'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { value, type } = req.body;

    const oldSetting = await prisma.systemSetting.findUnique({
      where: { key: req.params.key }
    });

    if (!oldSetting) {
      return res.status(404).json({ error: 'Setting not found' });
    }

    const updatedSetting = await prisma.systemSetting.update({
      where: { key: req.params.key },
      data: {
        value,
        type: type || oldSetting.type,
        version: { increment: 1 },
        updatedBy: req.userId
      }
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'UPDATE_SETTING',
        resourceType: 'SETTING',
        resourceId: req.params.key,
        oldData: oldSetting,
        newData: updatedSetting,
        ipAddress: req.ip
      }
    });

    res.json({
      message: 'System setting updated successfully',
      setting: updatedSetting
    });
  } catch (error) {
    console.error('Update system setting error:', error);
    res.status(500).json({ error: 'Failed to update system setting' });
  }
});

// Create system setting
router.post('/settings', authMiddleware.verifyToken, requireAdmin, [
  body('key').notEmpty().trim(),
  body('value').notEmpty(),
  body('type').isIn(['STRING', 'NUMBER', 'BOOLEAN', 'JSON', 'ARRAY']),
  body('category').notEmpty().trim(),
  body('description').optional().trim(),
  body('editable').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { key, value, type, category, description, editable = true } = req.body;

    // Check if setting already exists
    const existingSetting = await prisma.systemSetting.findUnique({
      where: { key }
    });

    if (existingSetting) {
      return res.status(400).json({ error: 'Setting already exists' });
    }

    const setting = await prisma.systemSetting.create({
      data: {
        key,
        value,
        type,
        category,
        description,
        editable,
        updatedBy: req.userId
      }
    });

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'CREATE_SETTING',
        resourceType: 'SETTING',
        resourceId: key,
        newData: setting,
        ipAddress: req.ip
      }
    });

    res.status(201).json({
      message: 'System setting created successfully',
      setting
    });
  } catch (error) {
    console.error('Create system setting error:', error);
    res.status(500).json({ error: 'Failed to create system setting' });
  }
});

// Get platform statistics
router.get('/stats/overview', authMiddleware.verifyToken, requireAdmin, async (req, res) => {
  try {
    const [
      userStats,
      jobStats,
      applicationStats,
      revenueStats,
      aiStats,
      performanceStats
    ] = await Promise.all([
      getUserStatistics(),
      getJobStatistics(),
      getApplicationStatistics(),
      getRevenueStatistics(),
      getAIStatistics(),
      getPerformanceStatistics()
    ]);

    res.json({
      userStats,
      jobStats,
      applicationStats,
      revenueStats,
      aiStats,
      performanceStats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get platform statistics error:', error);
    res.status(500).json({ error: 'Failed to get platform statistics' });
  }
});

// Run system maintenance
router.post('/maintenance', authMiddleware.verifyToken, requireAdmin, [
  body('action').isIn(['CLEANUP_OLD_DATA', 'RECALCULATE_KFN', 'UPDATE_INDEXES', 'BACKUP_DATABASE']),
  body('parameters').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { action, parameters = {} } = req.body;

    let result;
    switch (action) {
      case 'CLEANUP_OLD_DATA':
        result = await cleanupOldData(parameters);
        break;
      case 'RECALCULATE_KFN':
        result = await recalculateKFN(parameters);
        break;
      case 'UPDATE_INDEXES':
        result = await updateIndexes(parameters);
        break;
      case 'BACKUP_DATABASE':
        result = await backupDatabase(parameters);
        break;
      default:
        return res.status(400).json({ error: 'Invalid maintenance action' });
    }

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: `MAINTENANCE_${action}`,
        resourceType: 'SYSTEM',
        data: { action, parameters, result },
        ipAddress: req.ip
      }
    });

    res.json({
      message: 'Maintenance action completed',
      action,
      result
    });
  } catch (error) {
    console.error('Run maintenance error:', error);
    res.status(500).json({ error: 'Failed to run maintenance', details: error.message });
  }
});

// Send system announcement
router.post('/announcements', authMiddleware.verifyToken, requireAdmin, [
  body('title').notEmpty().trim(),
  body('message').notEmpty().trim(),
  body('channels').isArray(),
  body('targetUsers').optional().isObject(),
  body('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { title, message, channels, targetUsers = {}, priority = 'NORMAL' } = req.body;

    // Get target users based on criteria
    const where = {};
    
    if (targetUsers.roles && targetUsers.roles.length > 0) {
      where.role = { in: targetUsers.roles };
    }
    
    if (targetUsers.status && targetUsers.status.length > 0) {
      where.status = { in: targetUsers.status };
    }
    
    if (targetUsers.subscriptionPlans && targetUsers.subscriptionPlans.length > 0) {
      where.employerProfile = {
        subscriptionPlan: { in: targetUsers.subscriptionPlans }
      };
    }

    const users = await prisma.user.findMany({
      where,
      select: { id: true }
    });

    const userIds = users.map(user => user.id);

    // Send notifications
    const results = await Promise.all(
      userIds.map(async userId => {
        try {
          await prisma.notification.create({
            data: {
              userId,
              type: 'SYSTEM_ALERT',
              title,
              message,
              channels,
              priority,
              data: {
                announcement: true,
                sentAt: new Date().toISOString()
              }
            }
          });
          return { userId, success: true };
        } catch (error) {
          return { userId, success: false, error: error.message };
        }
      })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    // Log admin action
    await prisma.adminLog.create({
      data: {
        adminId: req.userId,
        action: 'SEND_ANNOUNCEMENT',
        resourceType: 'SYSTEM',
        data: {
          title,
          message,
          channels,
          targetUsers,
          priority,
          totalUsers: userIds.length,
          successful,
          failed
        },
        ipAddress: req.ip
      }
    });

    res.json({
      message: 'Announcement sent successfully',
      results: {
        total: userIds.length,
        successful,
        failed
      }
    });
  } catch (error) {
    console.error('Send announcement error:', error);
    res.status(500).json({ error: 'Failed to send announcement', details: error.message });
  }
});

// Helper functions
async function getUserStatistics() {
  const [
    totalUsers,
    usersByRole,
    usersByStatus,
    newUsersToday,
    activeUsersToday
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({
      by: ['role'],
      _count: { role: true }
    }),
    prisma.user.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.user.count({
      where: {
        createdAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    }),
    prisma.user.count({
      where: {
        lastLogin: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })
  ]);

  return {
    totalUsers,
    usersByRole: usersByRole.reduce((acc, item) => {
      acc[item.role] = item._count.role;
      return acc;
    }, {}),
    usersByStatus: usersByStatus.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
    newUsersToday,
    activeUsersToday
  };
}

async function getJobStatistics() {
  const [
    totalJobs,
    jobsByStatus,
    jobsByCategory,
    jobsByType,
    newJobsToday
  ] = await Promise.all([
    prisma.job.count(),
    prisma.job.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.job.groupBy({
      by: ['categoryId'],
      _count: { categoryId: true }
    }),
    prisma.job.groupBy({
      by: ['employmentType'],
      _count: { employmentType: true }
    }),
    prisma.job.count({
      where: {
        postedDate: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })
  ]);

  return {
    totalJobs,
    jobsByStatus: jobsByStatus.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
    jobsByCategory: jobsByCategory.reduce((acc, item) => {
      acc[item.categoryId] = item._count.categoryId;
      return acc;
    }, {}),
    jobsByType: jobsByType.reduce((acc, item) => {
      acc[item.employmentType] = item._count.employmentType;
      return acc;
    }, {}),
    newJobsToday
  };
}

async function getApplicationStatistics() {
  const [
    totalApplications,
    applicationsByStatus,
    avgKFNScore,
    conversionRate,
    newApplicationsToday
  ] = await Promise.all([
    prisma.application.count(),
    prisma.application.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    prisma.application.aggregate({
      _avg: { kfnScore: true }
    }),
    calculateOverallConversionRate(),
    prisma.application.count({
      where: {
        appliedAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0))
        }
      }
    })
  ]);

  return {
    totalApplications,
    applicationsByStatus: applicationsByStatus.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
    avgKFNScore: avgKFNScore._avg.kfnScore || 0,
    conversionRate,
    newApplicationsToday
  };
}

async function calculateOverallConversionRate() {
  const [
    totalApplications,
    hiredApplications
  ] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({
      where: { status: 'HIRED' }
    })
  ]);

  return totalApplications > 0 ? (hiredApplications / totalApplications) * 100 : 0;
}

async function getRevenueStatistics() {
  const [
    totalRevenue,
    revenueByType,
    monthlyRevenue,
    successfulTransactions,
    avgTransactionValue
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ['type'],
      where: { status: 'COMPLETED' },
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ['completedAt'],
      where: { 
        status: 'COMPLETED',
        completedAt: {
          gte: new Date(new Date().setMonth(new Date().getMonth() - 6))
        }
      },
      _sum: { amount: true },
      orderBy: { completedAt: 'asc' }
    }),
    prisma.payment.count({
      where: { status: 'COMPLETED' }
    }),
    prisma.payment.aggregate({
      where: { status: 'COMPLETED' },
      _avg: { amount: true }
    })
  ]);

  return {
    totalRevenue: totalRevenue._sum.amount || 0,
    revenueByType: revenueByType.reduce((acc, item) => {
      acc[item.type] = item._sum.amount;
      return acc;
    }, {}),
    monthlyRevenue: monthlyRevenue.map(item => ({
      month: item.completedAt,
      revenue: item._sum.amount
    })),
    successfulTransactions,
    avgTransactionValue: avgTransactionValue._avg.amount || 0
  };
}

async function getAIStatistics() {
  const [
    totalAnalyses,
    analysesByType,
    avgConfidence,
    totalTokensUsed,
    totalCost
  ] = await Promise.all([
    prisma.aIAnalysis.count(),
    prisma.aIAnalysis.groupBy({
      by: ['type'],
      _count: { type: true }
    }),
    prisma.aIAnalysis.aggregate({
      _avg: { confidence: true }
    }),
    prisma.aIAnalysis.aggregate({
      _sum: { tokensUsed: true }
    }),
    prisma.aIAnalysis.aggregate({
      _sum: { cost: true }
    })
  ]);

  return {
    totalAnalyses,
    analysesByType: analysesByType.reduce((acc, item) => {
      acc[item.type] = item._count.type;
      return acc;
    }, {}),
    avgConfidence: avgConfidence._avg.confidence || 0,
    totalTokensUsed: totalTokensUsed._sum.tokensUsed || 0,
    totalCost: totalCost._sum.cost || 0
  };
}

async function getPerformanceStatistics() {
  // These would come from your monitoring system
  // For now, return mock data
  return {
    apiResponseTime: {
      avg: 150,
      p95: 300,
      p99: 500
    },
    errorRate: 0.5,
    uptime: 99.9,
    database: {
      connections: 25,
      queryPerformance: 'Good'
    },
    memoryUsage: '75%',
    cpuUsage: '60%'
  };
}

async function cleanupOldData(parameters) {
  const { 
    maxAgeDays = 365,
    keepImportant = true 
  } = parameters;

  const cutoffDate = new Date(Date.now() - maxAgeDays * 24 * 60 * 60 * 1000);

  let results = {
    deletedLogs: 0,
    deletedOldJobs: 0,
    deletedOldApplications: 0,
    deletedOldNotifications: 0
  };

  // Delete old audit logs
  results.deletedLogs = await prisma.auditLog.deleteMany({
    where: {
      createdAt: { lt: cutoffDate }
    }
  });

  // Archive old jobs
  if (!keepImportant) {
    results.deletedOldJobs = await prisma.job.updateMany({
      where: {
        status: { in: ['CLOSED', 'EXPIRED'] },
        updatedAt: { lt: cutoffDate }
      },
      data: { status: 'ARCHIVED' }
    });
  }

  // Delete old notifications
  results.deletedOldNotifications = await prisma.notification.deleteMany({
    where: {
      read: true,
      createdAt: { lt: cutoffDate }
    }
  });

  return results;
}

async function recalculateKFN(parameters) {
  const { batchSize = 100 } = parameters;

  // Get applications without KFN scores
  const applications = await prisma.application.findMany({
    where: {
      kfnScore: null,
      status: { in: ['PENDING', 'REVIEWING', 'SHORTLISTED'] }
    },
    take: batchSize,
    select: {
      id: true,
      applicantId: true,
      jobId: true
    }
  });

  const kfnService = require('../services/kfn/kfn.service');
  const results = [];

  for (const application of applications) {
    try {
      const kfnScore = await kfnService.calculateKFN(
        application.applicantId,
        application.jobId
      );

      await prisma.application.update({
        where: { id: application.id },
        data: {
          kfnScore: kfnScore.overallScore,
          aiAnalysis: kfnScore
        }
      });

      await prisma.kFNCalculation.create({
        data: {
          workerId: application.applicantId,
          jobId: application.jobId,
          applicationId: application.id,
          ...kfnScore
        }
      });

      results.push({
        applicationId: application.id,
        success: true,
        score: kfnScore.overallScore
      });
    } catch (error) {
      results.push({
        applicationId: application.id,
        success: false,
        error: error.message
      });
    }
  }

  return {
    processed: applications.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
    results
  };
}

async function updateIndexes(parameters) {
  // This would involve database-specific index optimization
  // For PostgreSQL, you might run ANALYZE or REINDEX commands
  // For now, return a placeholder response
  
  return {
    message: 'Index update would be performed here',
    parameters
  };
}

async function backupDatabase(parameters) {
  const { backupType = 'FULL', destination = 'local' } = parameters;

  // This would involve your database backup strategy
  // For now, return a placeholder response
  
  return {
    message: `Database backup (${backupType}) to ${destination} would be performed here`,
    timestamp: new Date().toISOString(),
    backupId: `backup-${Date.now()}`
  };
}

module.exports = router;
