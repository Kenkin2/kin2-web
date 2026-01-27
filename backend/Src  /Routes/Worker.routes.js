const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const upload = require('../middleware/upload.middleware');

const prisma = new PrismaClient();

// Middleware to ensure user is a worker
const requireWorker = (req, res, next) => {
  if (req.userRole !== 'WORKER') {
    return res.status(403).json({ error: 'Access denied. Worker role required.' });
  }
  next();
};

// Get worker profile
router.get('/profile', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    const workerProfile = await prisma.workerProfile.findUnique({
      where: { userId: req.userId },
      include: {
        user: {
          include: {
            profile: true,
            workerSkills: {
              include: { skill: true }
            },
            experience: {
              orderBy: { startDate: 'desc' }
            },
            education: {
              orderBy: { startDate: 'desc' }
            },
            certifications: {
              orderBy: { issueDate: 'desc' }
            }
          }
        }
      }
    });

    if (!workerProfile) {
      return res.status(404).json({ error: 'Worker profile not found' });
    }

    res.json(workerProfile);
  } catch (error) {
    console.error('Get worker profile error:', error);
    res.status(500).json({ error: 'Failed to get worker profile' });
  }
});

// Update worker profile
router.put('/profile', authMiddleware.verifyToken, requireWorker, [
  body('headline').optional().trim().notEmpty(),
  body('summary').optional().trim(),
  body('currentJobTitle').optional().trim(),
  body('currentCompany').optional().trim(),
  body('employmentTypes').optional().isArray(),
  body('preferredLocations').optional().isArray(),
  body('remotePreference').optional().isIn(['ONSITE', 'REMOTE', 'HYBRID']),
  body('salaryExpectationMin').optional().isInt({ min: 0 }),
  body('salaryExpectationMax').optional().isInt({ min: 0 }),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'JPY']),
  body('noticePeriod').optional().isInt({ min: 0, max: 180 }),
  body('availability').optional().isIn(['AVAILABLE', 'UNAVAILABLE', 'SOON']),
  body('availableFrom').optional().isISO8601(),
  body('fullTime').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const workerProfile = await prisma.workerProfile.update({
      where: { userId: req.userId },
      data: req.body
    });

    res.json({ 
      message: 'Worker profile updated successfully', 
      profile: workerProfile 
    });
  } catch (error) {
    console.error('Update worker profile error:', error);
    res.status(500).json({ error: 'Failed to update worker profile' });
  }
});

// Upload resume
router.post('/resume', authMiddleware.verifyToken, requireWorker, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // In production, upload to S3
    const resumeUrl = `/uploads/resumes/${req.file.filename}`;

    await prisma.workerProfile.update({
      where: { userId: req.userId },
      data: { resumeUrl }
    });

    res.json({ 
      message: 'Resume uploaded successfully', 
      resumeUrl 
    });
  } catch (error) {
    console.error('Upload resume error:', error);
    res.status(500).json({ error: 'Failed to upload resume' });
  }
});

// Add skill
router.post('/skills', authMiddleware.verifyToken, requireWorker, [
  body('skillId').notEmpty(),
  body('proficiency').isIn(['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT']),
  body('yearsOfExperience').optional().isInt({ min: 0 }),
  body('lastUsed').optional().isISO8601()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { skillId, proficiency, yearsOfExperience, lastUsed } = req.body;

    // Check if skill exists
    const skill = await prisma.skill.findUnique({
      where: { id: skillId }
    });

    if (!skill) {
      return res.status(404).json({ error: 'Skill not found' });
    }

    // Add skill to worker
    const workerSkill = await prisma.workerSkill.create({
      data: {
        workerId: req.userId,
        skillId,
        proficiency,
        yearsOfExperience,
        lastUsed: lastUsed ? new Date(lastUsed) : null
      },
      include: { skill: true }
    });

    res.status(201).json({ 
      message: 'Skill added successfully', 
      skill: workerSkill 
    });
  } catch (error) {
    console.error('Add skill error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Skill already added' });
    }
    res.status(500).json({ error: 'Failed to add skill' });
  }
});

// Remove skill
router.delete('/skills/:skillId', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    await prisma.workerSkill.delete({
      where: {
        workerId_skillId: {
          workerId: req.userId,
          skillId: req.params.skillId
        }
      }
    });

    res.json({ message: 'Skill removed successfully' });
  } catch (error) {
    console.error('Remove skill error:', error);
    res.status(500).json({ error: 'Failed to remove skill' });
  }
});

// Add experience
router.post('/experience', authMiddleware.verifyToken, requireWorker, [
  body('title').notEmpty().trim(),
  body('company').notEmpty().trim(),
  body('location').optional().trim(),
  body('employmentType').isIn(['FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP', 'VOLUNTEER']),
  body('startDate').isISO8601(),
  body('endDate').optional().isISO8601(),
  body('current').optional().isBoolean(),
  body('description').optional().trim(),
  body('achievements').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const experience = await prisma.experience.create({
      data: {
        workerId: req.userId,
        ...req.body,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : null
      }
    });

    res.status(201).json({ 
      message: 'Experience added successfully', 
      experience 
    });
  } catch (error) {
    console.error('Add experience error:', error);
    res.status(500).json({ error: 'Failed to add experience' });
  }
});

// Update experience
router.put('/experience/:id', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    const experience = await prisma.experience.update({
      where: {
        id: req.params.id,
        workerId: req.userId
      },
      data: req.body
    });

    res.json({ 
      message: 'Experience updated successfully', 
      experience 
    });
  } catch (error) {
    console.error('Update experience error:', error);
    res.status(500).json({ error: 'Failed to update experience' });
  }
});

// Delete experience
router.delete('/experience/:id', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    await prisma.experience.delete({
      where: {
        id: req.params.id,
        workerId: req.userId
      }
    });

    res.json({ message: 'Experience deleted successfully' });
  } catch (error) {
    console.error('Delete experience error:', error);
    res.status(500).json({ error: 'Failed to delete experience' });
  }
});

// Add education
router.post('/education', authMiddleware.verifyToken, requireWorker, [
  body('institution').notEmpty().trim(),
  body('degree').notEmpty().trim(),
  body('fieldOfStudy').optional().trim(),
  body('startDate').isISO8601(),
  body('endDate').optional().isISO8601(),
  body('grade').optional().trim(),
  body('description').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const education = await prisma.education.create({
      data: {
        workerId: req.userId,
        ...req.body,
        startDate: new Date(req.body.startDate),
        endDate: req.body.endDate ? new Date(req.body.endDate) : null
      }
    });

    res.status(201).json({ 
      message: 'Education added successfully', 
      education 
    });
  } catch (error) {
    console.error('Add education error:', error);
    res.status(500).json({ error: 'Failed to add education' });
  }
});

// Get worker statistics
router.get('/stats', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    const [
      totalApplications,
      interviews,
      offers,
      profileViews,
      savedJobs,
      kfnScore
    ] = await Promise.all([
      prisma.application.count({ where: { applicantId: req.userId } }),
      prisma.application.count({ 
        where: { 
          applicantId: req.userId,
          status: { in: ['INTERVIEWING', 'SHORTLISTED'] }
        }
      }),
      prisma.application.count({ 
        where: { 
          applicantId: req.userId,
          status: { in: ['OFFERED', 'HIRED'] }
        }
      }),
      prisma.workerProfile.findUnique({
        where: { userId: req.userId },
        select: { profileViews: true }
      }).then(p => p?.profileViews || 0),
      prisma.savedJob.count({ where: { userId: req.userId } }),
      prisma.workerProfile.findUnique({
        where: { userId: req.userId },
        select: { kfnScore: true }
      }).then(p => p?.kfnScore || 0)
    ]);

    // Calculate application success rate
    const successRate = totalApplications > 0 
      ? ((offers / totalApplications) * 100).toFixed(1)
      : 0;

    res.json({
      totalApplications,
      interviews,
      offers,
      profileViews,
      savedJobs,
      kfnScore,
      successRate: parseFloat(successRate)
    });
  } catch (error) {
    console.error('Get worker stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

// Get recommended jobs
router.get('/recommended-jobs', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    // Get worker skills
    const workerSkills = await prisma.workerSkill.findMany({
      where: { workerId: req.userId },
      select: { skillId: true }
    });

    const skillIds = workerSkills.map(ws => ws.skillId);

    // Find jobs with matching skills
    const jobs = await prisma.job.findMany({
      where: {
        status: 'PUBLISHED',
        OR: [
          {
            requiredSkills: {
              some: {
                skillId: { in: skillIds }
              }
            }
          },
          {
            preferredSkills: {
              some: {
                skillId: { in: skillIds }
              }
            }
          }
        ]
      },
      include: {
        employer: {
          include: {
            employerProfile: true
          }
        },
        category: true,
        industry: true,
        requiredSkills: {
          include: { skill: true }
        }
      },
      orderBy: { postedDate: 'desc' },
      take: parseInt(limit)
    });

    // Get KFN scores for these jobs
    const jobsWithKFN = await Promise.all(
      jobs.map(async (job) => {
        const kfn = await prisma.kFNCalculation.findFirst({
          where: {
            workerId: req.userId,
            jobId: job.id
          }
        });

        return {
          ...job,
          kfnScore: kfn?.overallScore || null
        };
      })
    );

    // Sort by KFN score (highest first)
    jobsWithKFN.sort((a, b) => (b.kfnScore || 0) - (a.kfnScore || 0));

    res.json(jobsWithKFN);
  } catch (error) {
    console.error('Get recommended jobs error:', error);
    res.status(500).json({ error: 'Failed to get recommended jobs' });
  }
});

// Save job
router.post('/jobs/:jobId/save', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    // Check if job exists
    const job = await prisma.job.findUnique({
      where: { id: req.params.jobId }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Save job
    const savedJob = await prisma.savedJob.create({
      data: {
        userId: req.userId,
        jobId: req.params.jobId
      },
      include: { job: true }
    });

    res.status(201).json({ 
      message: 'Job saved successfully', 
      savedJob 
    });
  } catch (error) {
    console.error('Save job error:', error);
    if (error.code === 'P2002') {
      return res.status(400).json({ error: 'Job already saved' });
    }
    res.status(500).json({ error: 'Failed to save job' });
  }
});

// Get saved jobs
router.get('/saved-jobs', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    const savedJobs = await prisma.savedJob.findMany({
      where: { userId: req.userId },
      include: {
        job: {
          include: {
            employer: {
              include: { employerProfile: true }
            },
            category: true
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.json(savedJobs.map(sj => sj.job));
  } catch (error) {
    console.error('Get saved jobs error:', error);
    res.status(500).json({ error: 'Failed to get saved jobs' });
  }
});

// Remove saved job
router.delete('/saved-jobs/:jobId', authMiddleware.verifyToken, requireWorker, async (req, res) => {
  try {
    await prisma.savedJob.delete({
      where: {
        userId_jobId: {
          userId: req.userId,
          jobId: req.params.jobId
        }
      }
    });

    res.json({ message: 'Job removed from saved list' });
  } catch (error) {
    console.error('Remove saved job error:', error);
    res.status(500).json({ error: 'Failed to remove saved job' });
  }
});

module.exports = router;
