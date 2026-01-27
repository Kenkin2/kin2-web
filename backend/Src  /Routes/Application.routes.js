const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const prisma = new PrismaClient();

// Apply for a job
router.post('/', authMiddleware.verifyToken, [
  body('jobId').notEmpty(),
  body('coverLetter').optional().trim(),
  body('answers').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { jobId, coverLetter, answers } = req.body;

    // Check if job exists and is published
    const job = await prisma.job.findUnique({
      where: { 
        id: jobId,
        status: 'PUBLISHED'
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found or not available' });
    }

    // Check if user has already applied
    const existingApplication = await prisma.application.findUnique({
      where: {
        jobId_applicantId: {
          jobId,
          applicantId: req.userId
        }
      }
    });

    if (existingApplication) {
      return res.status(400).json({ error: 'You have already applied for this job' });
    }

    // Check user role - only workers can apply
    if (req.userRole !== 'WORKER') {
      return res.status(403).json({ error: 'Only workers can apply for jobs' });
    }

    // Get worker's resume URL
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.userId },
      select: { resumeUrl: true }
    });

    if (!workerProfile?.resumeUrl) {
      return res.status(400).json({ error: 'Please upload your resume before applying' });
    }

    // Create application
    const application = await prisma.application.create({
      data: {
        jobId,
        applicantId: req.userId,
        coverLetter,
        resumeUrl: workerProfile.resumeUrl,
        answers,
        status: 'PENDING'
      },
      include: {
        job: {
          include: {
            employer: {
              include: { employerProfile: true }
            }
          }
        },
        applicant: {
          include: { profile: true }
        }
      }
    });

    // Update job application count
    await prisma.job.update({
      where: { id: jobId },
      data: { applicationsCount: { increment: 1 } }
    });

    // Update worker stats
    await prisma.workerProfile.update({
      where: { userId: req.userId },
      data: { totalApplications: { increment: 1 } }
    });

    // Create notification for employer
    await prisma.notification.create({
      data: {
        userId: job.employerId,
        type: 'APPLICATION_UPDATE',
        title: 'New Application Received',
        message: `New application received for "${job.title}"`,
        channels: ['IN_APP', 'EMAIL'],
        data: {
          jobId,
          jobTitle: job.title,
          applicationId: application.id,
          applicantName: `${application.applicant.profile.firstName} ${application.applicant.profile.lastName}`
        }
      }
    });

    // Trigger AI resume screening (async)
    setTimeout(async () => {
      try {
        const aiService = require('../services/ai/ai.service');
        await aiService.screenResume(application.id);
      } catch (aiError) {
        console.error('AI screening failed:', aiError);
      }
    }, 0);

    res.status(201).json({
      message: 'Application submitted successfully',
      application
    });
  } catch (error) {
    console.error('Apply for job error:', error);
    res.status(500).json({ error: 'Failed to apply for job' });
  }
});

// Get user's applications
router.get('/my-applications', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { applicantId: req.userId };
    if (status) {
      where.status = status;
    }

    const [applications, total] = await Promise.all([
      prisma.application.findMany({
        where,
        include: {
          job: {
            include: {
              employer: {
                include: { employerProfile: true }
              },
              category: true
            }
          },
          kfnCalculations: {
            orderBy: { createdAt: 'desc' },
            take: 1
          },
          interviews: {
            orderBy: { scheduledDate: 'asc' }
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

// Get single application
router.get('/:id', authMiddleware.verifyToken, async (req, res) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: {
          include: {
            employer: {
              include: { employerProfile: true }
            },
            category: true,
            industry: true,
            requiredSkills: {
              include: { skill: true }
            }
          }
        },
        applicant: {
          include: {
            profile: true,
            workerProfile: true,
            workerSkills: {
              include: { skill: true }
            },
            experience: true,
            education: true,
            certifications: true
          }
        },
        kfnCalculations: {
          orderBy: { createdAt: 'desc' }
        },
        messages: {
          orderBy: { createdAt: 'asc' }
        },
        interviews: {
          orderBy: { scheduledDate: 'asc' }
        }
      }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check permissions
    if (application.applicantId !== req.userId && 
        application.job.employerId !== req.userId &&
        req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    res.json(application);
  } catch (error) {
    console.error('Get application error:', error);
    res.status(500).json({ error: 'Failed to get application' });
  }
});

// Withdraw application
router.post('/:id/withdraw', authMiddleware.verifyToken, async (req, res) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: true
      }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check permissions
    if (application.applicantId !== req.userId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if can be withdrawn
    if (application.status === 'WITHDRAWN') {
      return res.status(400).json({ error: 'Application already withdrawn' });
    }

    if (application.status === 'HIRED') {
      return res.status(400).json({ error: 'Cannot withdraw a hired application' });
    }

    const updatedApplication = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        status: 'WITHDRAWN',
        statusChangedAt: new Date(),
        statusChangedBy: req.userId
      }
    });

    // Create notification for employer
    await prisma.notification.create({
      data: {
        userId: application.job.employerId,
        type: 'APPLICATION_UPDATE',
        title: 'Application Withdrawn',
        message: `Application withdrawn for "${application.job.title}"`,
        channels: ['IN_APP'],
        data: {
          jobId: application.jobId,
          jobTitle: application.job.title,
          applicationId: application.id
        }
      }
    });

    res.json({
      message: 'Application withdrawn successfully',
      application: updatedApplication
    });
  } catch (error) {
    console.error('Withdraw application error:', error);
    res.status(500).json({ error: 'Failed to withdraw application' });
  }
});

// Send message in application
router.post('/:id/messages', authMiddleware.verifyToken, [
  body('message').notEmpty().trim(),
  body('attachments').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { message, attachments = [] } = req.body;

    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: true,
        applicant: {
          include: { profile: true }
        }
      }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check permissions - only applicant or employer can message
    const isApplicant = application.applicantId === req.userId;
    const isEmployer = application.job.employerId === req.userId;
    
    if (!isApplicant && !isEmployer && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Determine recipient
    const recipientId = isApplicant ? application.job.employerId : application.applicantId;

    const applicationMessage = await prisma.applicationMessage.create({
      data: {
        applicationId: req.params.id,
        senderId: req.userId,
        recipientId,
        message,
        attachments
      },
      include: {
        sender: {
          include: { profile: true }
        }
      }
    });

    // Create notification for recipient
    await prisma.notification.create({
      data: {
        userId: recipientId,
        type: 'MESSAGE',
        title: 'New Message',
        message: `New message in your application for "${application.job.title}"`,
        channels: ['IN_APP', 'EMAIL'],
        data: {
          jobId: application.jobId,
          jobTitle: application.job.title,
          applicationId: application.id,
          messageId: applicationMessage.id,
          senderName: `${applicationMessage.sender.profile.firstName} ${applicationMessage.sender.profile.lastName}`
        }
      }
    });

    res.status(201).json({
      message: 'Message sent successfully',
      message: applicationMessage
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({ error: 'Failed to send message' });
  }
});

// Get application messages
router.get('/:id/messages', authMiddleware.verifyToken, async (req, res) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check permissions
    if (application.applicantId !== req.userId && 
        application.job.employerId !== req.userId &&
        req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const messages = await prisma.applicationMessage.findMany({
      where: { applicationId: req.params.id },
      include: {
        sender: {
          include: { profile: true }
        },
        recipient: {
          include: { profile: true }
        }
      },
      orderBy: { createdAt: 'asc' }
    });

    // Mark messages as read
    await prisma.applicationMessage.updateMany({
      where: {
        applicationId: req.params.id,
        recipientId: req.userId,
        read: false
      },
      data: { read: true }
    });

    res.json(messages);
  } catch (error) {
    console.error('Get messages error:', error);
    res.status(500).json({ error: 'Failed to get messages' });
  }
});

// Get application analytics
router.get('/:id/analytics', authMiddleware.verifyToken, async (req, res) => {
  try {
    const application = await prisma.application.findUnique({
      where: { id: req.params.id },
      include: {
        job: true,
        kfnCalculations: true
      }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check permissions
    if (application.applicantId !== req.userId && 
        application.job.employerId !== req.userId &&
        req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Get timeline
    const timeline = await prisma.auditLog.findMany({
      where: {
        OR: [
          {
            resourceType: 'APPLICATION',
            resourceId: req.params.id
          },
          {
            action: 'APPLICATION_STATUS_CHANGE',
            data: {
              path: ['applicationId'],
              equals: req.params.id
            }
          }
        ]
      },
      orderBy: { createdAt: 'asc' }
    });

    // Get similar applications stats
    const similarApplications = await prisma.application.findMany({
      where: {
        jobId: application.jobId,
        id: { not: req.params.id }
      },
      select: {
        status: true,
        kfnScore: true
      }
    });

    const stats = {
      totalSimilarApplications: similarApplications.length,
      averageKFNScore: similarApplications.reduce((sum, app) => sum + (app.kfnScore || 0), 0) / 
                       (similarApplications.length || 1),
      statusDistribution: similarApplications.reduce((acc, app) => {
        acc[app.status] = (acc[app.status] || 0) + 1;
        return acc;
      }, {})
    };

    res.json({
      application,
      timeline,
      stats
    });
  } catch (error) {
    console.error('Get application analytics error:', error);
    res.status(500).json({ error: 'Failed to get analytics' });
  }
});

// Upload application document
router.post('/:id/documents', authMiddleware.verifyToken, upload.array('documents', 5), async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const application = await prisma.application.findUnique({
      where: { id: req.params.id }
    });

    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }

    // Check permissions
    if (application.applicantId !== req.userId && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const documentUrls = req.files.map(file => 
      `/uploads/application-documents/${file.filename}`
    );

    // Update application with new documents
    const updatedApplication = await prisma.application.update({
      where: { id: req.params.id },
      data: {
        documents: {
          push: documentUrls
        }
      }
    });

    res.json({
      message: 'Documents uploaded successfully',
      documents: documentUrls,
      application: updatedApplication
    });
  } catch (error) {
    console.error('Upload documents error:', error);
    res.status(500).json({ error: 'Failed to upload documents' });
  }
});

module.exports = router;
