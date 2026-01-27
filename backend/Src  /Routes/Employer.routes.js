const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const prisma = new PrismaClient();

// Middleware to ensure user is an employer
const requireEmployer = (req, res, next) => {
  if (req.userRole !== 'EMPLOYER') {
    return res.status(403).json({ error: 'Access denied. Employer role required.' });
  }
  next();
};

// Get employer profile
router.get('/profile', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    const employerProfile = await prisma.employerProfile.findUnique({
      where: { userId: req.userId },
      include: {
        user: {
          include: {
            profile: true,
            postedJobs: {
              include: {
                category: true,
                industry: true,
                _count: {
                  select: { applications: true }
                }
              },
              orderBy: { postedDate: 'desc' },
              take: 10
            },
            companyReviews: {
              include: {
                reviewer: {
                  include: { profile: true }
                }
              },
              orderBy: { createdAt: 'desc' },
              take: 5
            }
          }
        }
      }
    });

    if (!employerProfile) {
      return res.status(404).json({ error: 'Employer profile not found' });
    }

    res.json(employerProfile);
  } catch (error) {
    console.error('Get employer profile error:', error);
    res.status(500).json({ error: 'Failed to get employer profile' });
  }
});

// Update employer profile
router.put('/profile', authMiddleware.verifyToken, requireEmployer, [
  body('companyName').optional().trim().notEmpty(),
  body('companyLogo').optional().trim(),
  body('companyWebsite').optional().trim().isURL(),
  body('companySize').optional().isIn(['MICRO', 'SMALL', 'MEDIUM', 'LARGE', 'ENTERPRISE']),
  body('industry').optional().trim(),
  body('description').optional().trim(),
  body('foundedYear').optional().isInt({ min: 1800, max: new Date().getFullYear() }),
  body('headquarters').optional().trim(),
  body('locations').optional().isArray(),
  body('linkedInUrl').optional().trim().isURL(),
  body('twitterUrl').optional().trim().isURL(),
  body('facebookUrl').optional().trim().isURL()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const employerProfile = await prisma.employerProfile.update({
      where: { userId: req.userId },
      data: req.body
    });

    res.json({ 
      message: 'Employer profile updated successfully', 
      profile: employerProfile 
    });
  } catch (error) {
    console.error('Update employer profile error:', error);
    res.status(500).json({ error: 'Failed to update employer profile' });
  }
});

// Upload company logo
router.post('/logo', authMiddleware.verifyToken, requireEmployer, upload.single('logo'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const logoUrl = `/uploads/logos/${req.file.filename}`;

    await prisma.employerProfile.update({
      where: { userId: req.userId },
      data: { companyLogo: logoUrl }
    });

    res.json({ 
      message: 'Company logo uploaded successfully', 
      logoUrl 
    });
  } catch (error) {
    console.error('Upload logo error:', error);
    res.status(500).json({ error: 'Failed to upload logo' });
  }
});

// Create job
router.post('/jobs', authMiddleware.verifyToken, requireEmployer, [
  body('title').notEmpty().trim(),
  body('description').notEmpty().trim(),
  body('requirements').notEmpty().trim(),
  body('responsibilities').optional().trim(),
  body('benefits').optional().trim(),
  body('employmentType').isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'VOLUNTEER']),
  body('experienceLevel').isIn(['ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'EXECUTIVE']),
  body('remotePreference').isIn(['ONSITE', 'REMOTE', 'HYBRID']),
  body('location').notEmpty().trim(),
  body('salaryMin').optional().isInt({ min: 0 }),
  body('salaryMax').optional().isInt({ min: 0 }),
  body('salaryCurrency').optional().isIn(['USD', 'EUR', 'GBP', 'JPY']),
  body('salaryType').optional().isIn(['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']),
  body('equityOffered').optional().isBoolean(),
  body('bonusOffered').optional().isBoolean(),
  body('categoryId').notEmpty(),
  body('industryId').notEmpty(),
  body('requiredSkills').optional().isArray(),
  body('preferredSkills').optional().isArray(),
  body('expirationDate').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const {
      title,
      description,
      requirements,
      responsibilities,
      benefits,
      employmentType,
      experienceLevel,
      remotePreference,
      location,
      salaryMin,
      salaryMax,
      salaryCurrency,
      salaryType,
      equityOffered,
      bonusOffered,
      categoryId,
      industryId,
      requiredSkills = [],
      preferredSkills = [],
      expirationDate
    } = req.body;

    // Generate slug from title
    const slug = title
      .toLowerCase()
      .replace(/[^\w\s]/g, '')
      .replace(/\s+/g, '-')
      .concat('-', Date.now().toString().slice(-6));

    // Create job
    const job = await prisma.job.create({
      data: {
        title,
        slug,
        description,
        requirements,
        responsibilities,
        benefits,
        employmentType,
        experienceLevel,
        remotePreference,
        location,
        salaryMin,
        salaryMax,
        salaryCurrency: salaryCurrency || 'USD',
        salaryType: salaryType || 'YEARLY',
        equityOffered: equityOffered || false,
        bonusOffered: bonusOffered || false,
        employerId: req.userId,
        categoryId,
        industryId,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        requiredSkills: {
          create: requiredSkills.map(skillId => ({
            skillId,
            isRequired: true,
            importance: 5
          }))
        },
        preferredSkills: {
          create: preferredSkills.map(skillId => ({
            skillId,
            isRequired: false,
            importance: 3
          }))
        }
      },
      include: {
        category: true,
        industry: true,
        requiredSkills: {
          include: { skill: true }
        },
        preferredSkills: {
          include: { skill: true }
        }
      }
    });

    // Update employer stats
    await prisma.employerProfile.update({
      where: { userId: req.userId },
      data: {
        totalJobsPosted: { increment: 1 }
      }
    });

    res.status(201).json({
      message: 'Job created successfully',
      job
    });
  } catch (error) {
    console.error('Create job error:', error);
    res.status(500).json({ error: 'Failed to create job' });
  }
});

// Get employer's jobs
router.get('/jobs', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { employerId: req.userId };
    if (status) {
      where.status = status;
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          category: true,
          industry: true,
          _count: {
            select: { applications: true }
          }
        },
        orderBy: { postedDate: 'desc' },
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
    console.error('Get employer jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Update job
router.put('/jobs/:id', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    // Check if job belongs to employer
    const existingJob = await prisma.job.findFirst({
      where: {
        id: req.params.id,
        employerId: req.userId
      }
    });

    if (!existingJob) {
      return res.status(404).json({ error: 'Job not found or access denied' });
    }

    const job = await prisma.job.update({
      where: { id: req.params.id },
      data: req.body,
      include: {
        category: true,
        industry: true
      }
    });

    res.json({
      message: 'Job updated successfully',
      job
    });
  } catch (error) {
    console.error('Update job error:', error);
    res.status(500).json({ error: 'Failed to update job' });
  }
});

// Publish job
router.post('/jobs/:id/publish', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    const job = await prisma.job.update({
      where: {
        id: req.params.id,
        employerId: req.userId,
        status: 'DRAFT'
      },
      data: {
        status: 'PUBLISHED',
        postedDate: new Date()
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found or cannot be published' });
    }

    res.json({
      message: 'Job published successfully',
      job
    });
  } catch (error) {
    console.error('Publish job error:', error);
    res.status(500).json({ error: 'Failed to publish job' });
  }
});

// Close job
router.post('/jobs/:id/close', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    const job = await prisma.job.update({
      where: {
        id: req.params.id,
        employerId: req.userId,
        status: 'PUBLISHED'
      },
      data: {
        status: 'CLOSED',
        closedDate: new Date()
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found or cannot be closed' });
    }

    res.json({
      message: 'Job closed successfully',
      job
    });
  } catch (error) {
    console.error('Close job error:', error);
    res.status(500).json({ error: 'Failed to close job' });
  }
});

// Get applications for a job
router.get('/jobs/:jobId/applications', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Verify job belongs to employer
    const job = await prisma.job.findFirst({
      where: {
        id: req.params.jobId,
        employerId: req.userId
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found or access denied' });
    }

    const where = { jobId: req.params.jobId };
    if (status) {
      where.status = status;
    }

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          applicant: {
            include: {
              profile: true,
              workerProfile: true,
              workerSkills: {
                include: { skill: true }
              },
              experience: true,
              education: true
            }
          },
          kfnCalculations: {
            orderBy: { createdAt: 'desc' },
            take: 1
          }
        },
        orderBy: { appliedAt: 'desc' },
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
    console.error('Get applications error:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

// Update application status
router.patch('/applications/:id/status', authMiddleware.verifyToken, requireEmployer, [
  body('status').isIn(['PENDING', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN', 'EXPIRED']),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { status, notes } = req.body;

    // Get application with job to verify ownership
    const application = await prisma.application.findFirst({
      where: {
        id: req.params.id,
        job: {
          employerId: req.userId
        }
      },
      include: {
        job: true
      }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found or access denied' });
    }

    const updatedApplication = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        status,
        statusChangedAt: new Date(),
        statusChangedBy: req.userId,
        notes: notes !== undefined ? notes : application.notes
      },
      include: {
        applicant: {
          include: { profile: true }
        }
      }
    });

    // Create notification for applicant
    await prisma.notification.create({
      data: {
        userId: application.applicantId,
        type: 'APPLICATION_UPDATE',
        title: 'Application Status Updated',
        message: `Your application for "${application.job.title}" has been updated to ${status}`,
        channels: ['IN_APP', 'EMAIL'],
        data: {
          jobId: application.jobId,
          jobTitle: application.job.title,
          applicationId: application.id,
          oldStatus: application.status,
          newStatus: status
        }
      }
    });

    // If hired, update employer stats
    if (status === 'HIRED') {
      await prisma.employerProfile.update({
        where: { userId: req.userId },
        data: {
          totalHires: { increment: 1 }
        }
      });
    }

    res.json({
      message: 'Application status updated',
      application: updatedApplication
    });
  } catch (error) {
    console.error('Update application status error:', error);
    res.status(500).json({ error: 'Failed to update application status' });
  }
});

// Schedule interview
router.post('/applications/:id/interview', authMiddleware.verifyToken, requireEmployer, [
  body('type').isIn(['PHONE', 'VIDEO', 'IN_PERSON', 'TECHNICAL', 'BEHAVIORAL', 'PANEL']),
  body('stage').notEmpty().trim(),
  body('scheduledDate').isISO8601(),
  body('duration').isInt({ min: 15, max: 480 }),
  body('timezone').notEmpty().trim(),
  body('interviewerId').optional(),
  body('participantIds').optional().isArray(),
  body('location').optional().trim(),
  body('meetingUrl').optional().trim().isURL(),
  body('platform').optional().trim(),
  body('notes').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Verify application belongs to employer's job
    const application = await prisma.application.findFirst({
      where: {
        id: req.params.id,
        job: {
          employerId: req.userId
        }
      },
      include: {
        job: true,
        applicant: {
          include: { profile: true }
        }
      }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found or access denied' });
    }

    const interview = await prisma.interview.create({
      data: {
        applicationId: req.params.id,
        type: req.body.type,
        stage: req.body.stage,
        status: 'SCHEDULED',
        scheduledDate: new Date(req.body.scheduledDate),
        duration: req.body.duration,
        timezone: req.body.timezone,
        interviewerId: req.body.interviewerId || req.userId,
        participantIds: req.body.participantIds || [req.userId],
        location: req.body.location,
        meetingUrl: req.body.meetingUrl,
        platform: req.body.platform,
        notes: req.body.notes
      }
    });

    // Update application status
    await prisma.application.update({
      where: { id: req.params.id },
      data: { status: 'INTERVIEWING' }
    });

    // Create notification for applicant
    await prisma.notification.create({
      data: {
        userId: application.applicantId,
        type: 'INTERVIEW_INVITE',
        title: 'Interview Invitation',
        message: `You've been invited for an interview for "${application.job.title}"`,
        channels: ['IN_APP', 'EMAIL', 'SMS'],
        data: {
          jobId: application.jobId,
          jobTitle: application.job.title,
          applicationId: application.id,
          interviewId: interview.id,
          interviewType: interview.type,
          scheduledDate: interview.scheduledDate,
          meetingUrl: interview.meetingUrl
        }
      }
    });

    res.status(201).json({
      message: 'Interview scheduled successfully',
      interview
    });
  } catch (error) {
    console.error('Schedule interview error:', error);
    res.status(500).json({ error: 'Failed to schedule interview' });
  }
});

// Get employer statistics
router.get('/stats', authMiddleware.verifyToken, requireEmployer, async (req, res) => {
  try {
    const [
      totalJobs,
      activeJobs,
      totalApplications,
      interviewsScheduled,
      totalHires,
      companyReviews,
      responseRate
    ] = await Promise.all([
      prisma.job.count({ where: { employerId: req.userId } }),
      prisma.job.count({ 
        where: { 
          employerId: req.userId,
          status: 'PUBLISHED'
        }
      }),
      prisma.application.count({
        where: {
          job: { employerId: req.userId }
        }
      }),
      prisma.interview.count({
        where: {
          application: {
            job: { employerId: req.userId }
          }
        }
      }),
      prisma.application.count({
        where: {
          job: { employerId: req.userId },
          status: 'HIRED'
        }
      }),
      prisma.companyReview.count({
        where: { companyId: req.userId }
      }),
      prisma.employerProfile.findUnique({
        where: { userId: req.userId },
        select: { responseRate: true }
      }).then(p => p?.responseRate || 0)
    ]);

    // Calculate average time to hire (simplified)
    const recentHires = await prisma.application.findMany({
      where: {
        job: { employerId: req.userId },
        status: 'HIRED',
        statusChangedAt: { not: null }
      },
      select: {
        appliedAt: true,
        statusChangedAt: true
      },
      take: 10
    });

    const avgTimeToHire = recentHires.length > 0
      ? recentHires.reduce((sum, hire) => {
          const timeDiff = hire.statusChangedAt - hire.appliedAt;
          return sum + (timeDiff / (1000 * 60 * 60 * 24)); // Convert to days
        }, 0) / recentHires.length
      : null;

    res.json({
      totalJobs,
      activeJobs,
      totalApplications,
      interviewsScheduled,
      totalHires,
      companyReviews,
      responseRate,
      avgTimeToHire: avgTimeToHire ? Math.round(avgTimeToHire) : null
    });
  } catch (error) {
    console.error('Get employer stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

module.exports = router;
