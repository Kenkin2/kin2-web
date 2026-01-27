const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const kfnService = require('../services/kfn/kfn.service');

const prisma = new PrismaClient();

// Calculate KFN score
router.post('/calculate', authMiddleware.verifyToken, [
  body('workerId').optional(),
  body('jobId').notEmpty(),
  body('forceRecalculate').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workerId, jobId, forceRecalculate = false } = req.body;

    // Determine worker ID
    const targetWorkerId = workerId || req.userId;

    // Check if user has permission
    if (workerId && workerId !== req.userId && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    // Check if calculation already exists
    if (!forceRecalculate) {
      const existingCalculation = await prisma.kFNCalculation.findFirst({
        where: {
          workerId: targetWorkerId,
          jobId
        },
        orderBy: { createdAt: 'desc' }
      });

      if (existingCalculation) {
        return res.json(existingCalculation);
      }
    }

    // Calculate KFN score
    const kfnScore = await kfnService.calculateKFN(targetWorkerId, jobId);

    // Save calculation
    const calculation = await prisma.kFNCalculation.create({
      data: {
        workerId: targetWorkerId,
        jobId,
        ...kfnScore
      }
    });

    // Update worker profile with average KFN score
    if (targetWorkerId === req.userId) {
      const avgScore = await prisma.kFNCalculation.aggregate({
        where: { workerId: targetWorkerId },
        _avg: { overallScore: true }
      });

      await prisma.workerProfile.update({
        where: { userId: targetWorkerId },
        data: { kfnScore: avgScore._avg.overallScore }
      });
    }

    res.json(calculation);
  } catch (error) {
    console.error('Calculate KFN error:', error);
    res.status(500).json({ error: 'Failed to calculate KFN score', details: error.message });
  }
});

// Get KFN score explanation
router.get('/explanation/:calculationId', authMiddleware.verifyToken, async (req, res) => {
  try {
    const calculation = await prisma.kFNCalculation.findUnique({
      where: { id: req.params.calculationId }
    });

    if (!calculation) {
      return res.status(404).json({ error: 'Calculation not found' });
    }

    // Check permissions
    if (calculation.workerId !== req.userId && req.userRole !== 'ADMIN') {
      const job = await prisma.job.findUnique({
        where: { id: calculation.jobId }
      });

      if (!job || job.employerId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const explanation = kfnService.explainKFN(calculation);

    res.json(explanation);
  } catch (error) {
    console.error('Get KFN explanation error:', error);
    res.status(500).json({ error: 'Failed to get KFN explanation', details: error.message });
  }
});

// Batch calculate KFN scores
router.post('/batch', authMiddleware.verifyToken, [
  body('workerIds').optional().isArray(),
  body('jobIds').optional().isArray(),
  body('pairs').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { workerIds, jobIds, pairs } = req.body;

    let calculations = [];

    if (pairs && pairs.length > 0) {
      // Calculate for specific worker-job pairs
      calculations = await Promise.all(
        pairs.map(async (pair) => {
          try {
            return await kfnService.calculateKFN(pair.workerId, pair.jobId);
          } catch (error) {
            return {
              workerId: pair.workerId,
              jobId: pair.jobId,
              error: error.message
            };
          }
        })
      );
    } else if (workerIds && jobIds) {
      // Calculate all combinations
      const allPairs = [];
      for (const workerId of workerIds) {
        for (const jobId of jobIds) {
          allPairs.push({ workerId, jobId });
        }
      }

      calculations = await Promise.all(
        allPairs.map(async (pair) => {
          try {
            return await kfnService.calculateKFN(pair.workerId, pair.jobId);
          } catch (error) {
            return {
              workerId: pair.workerId,
              jobId: pair.jobId,
              error: error.message
            };
          }
        })
      );
    } else {
      return res.status(400).json({ 
        error: 'Either pairs or (workerIds and jobIds) are required' 
      });
    }

    // Filter out errors and save successful calculations
    const successfulCalculations = calculations.filter(c => !c.error);
    
    if (successfulCalculations.length > 0) {
      await prisma.kFNCalculation.createMany({
        data: successfulCalculations.map(calc => ({
          workerId: calc.workerId,
          jobId: calc.jobId,
          overallScore: calc.overallScore,
          skillsScore: calc.skillsScore,
          experienceScore: calc.experienceScore,
          locationScore: calc.locationScore,
          availabilityScore: calc.availabilityScore,
          educationScore: calc.educationScore,
          culturalScore: calc.culturalScore,
          skillMatches: calc.skillMatches,
          experienceMatches: calc.experienceMatches,
          locationMatch: calc.locationMatch,
          availabilityMatch: calc.availabilityMatch,
          educationMatch: calc.educationMatch,
          culturalMatch: calc.culturalMatch,
          recommendation: calc.recommendation,
          confidence: calc.confidence,
          strengths: calc.strengths,
          areasToImprove: calc.areasToImprove
        }))
      });
    }

    res.json({
      message: 'Batch KFN calculation completed',
      total: calculations.length,
      successful: successfulCalculations.length,
      failed: calculations.length - successfulCalculations.length,
      calculations
    });
  } catch (error) {
    console.error('Batch KFN error:', error);
    res.status(500).json({ error: 'Failed to batch calculate KFN scores', details: error.message });
  }
});

// Get KFN score breakdown
router.get('/breakdown/:workerId/:jobId', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { workerId, jobId } = req.params;

    // Check permissions
    if (workerId !== req.userId && req.userRole !== 'ADMIN') {
      const job = await prisma.job.findUnique({
        where: { id: jobId }
      });

      if (!job || job.employerId !== req.userId) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    const breakdown = await kfnService.getScoreBreakdown(workerId, jobId);

    if (!breakdown) {
      return res.status(404).json({ error: 'No KFN calculation found' });
    }

    res.json(breakdown);
  } catch (error) {
    console.error('Get KFN breakdown error:', error);
    res.status(500).json({ error: 'Failed to get KFN breakdown', details: error.message });
  }
});

// Get worker's average KFN score
router.get('/worker/:workerId/average', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { workerId } = req.params;

    // Check permissions
    if (workerId !== req.userId && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await prisma.kFNCalculation.aggregate({
      where: { workerId },
      _avg: {
        overallScore: true,
        skillsScore: true,
        experienceScore: true,
        locationScore: true,
        availabilityScore: true,
        educationScore: true,
        culturalScore: true
      },
      _count: {
        overallScore: true
      },
      _max: {
        overallScore: true
      },
      _min: {
        overallScore: true
      }
    });

    // Get score distribution
    const distribution = await prisma.kFNCalculation.groupBy({
      by: ['recommendation'],
      where: { workerId },
      _count: {
        recommendation: true
      }
    });

    res.json({
      average: stats._avg,
      count: stats._count.overallScore,
      range: {
        min: stats._min.overallScore,
        max: stats._max.overallScore
      },
      distribution: distribution.reduce((acc, item) => {
        acc[item.recommendation] = item._count.recommendation;
        return acc;
      }, {})
    });
  } catch (error) {
    console.error('Get worker KFN average error:', error);
    res.status(500).json({ error: 'Failed to get worker KFN average', details: error.message });
  }
});

// Get job's KFN statistics
router.get('/job/:jobId/stats', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { jobId } = req.params;

    // Check if user has access to this job's data
    const job = await prisma.job.findUnique({
      where: { id: jobId }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.employerId !== req.userId && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const stats = await prisma.kFNCalculation.aggregate({
      where: { jobId },
      _avg: {
        overallScore: true,
        skillsScore: true,
        experienceScore: true,
        locationScore: true,
        availabilityScore: true,
        educationScore: true,
        culturalScore: true
      },
      _count: {
        overallScore: true
      },
      _max: {
        overallScore: true
      },
      _min: {
        overallScore: true
      }
    });

    // Get top candidates
    const topCandidates = await prisma.kFNCalculation.findMany({
      where: { 
        jobId,
        overallScore: { gte: 70 }
      },
      include: {
        worker: {
          include: {
            profile: true,
            workerProfile: true
          }
        }
      },
      orderBy: { overallScore: 'desc' },
      take: 10
    });

    res.json({
      average: stats._avg,
      count: stats._count.overallScore,
      range: {
        min: stats._min.overallScore,
        max: stats._max.overallScore
      },
      topCandidates: topCandidates.map(candidate => ({
        workerId: candidate.workerId,
        name: `${candidate.worker.profile.firstName} ${candidate.worker.profile.lastName}`,
        score: candidate.overallScore,
        recommendation: candidate.recommendation,
        headline: candidate.worker.workerProfile?.headline
      }))
    });
  } catch (error) {
    console.error('Get job KFN stats error:', error);
    res.status(500).json({ error: 'Failed to get job KFN statistics', details: error.message });
  }
});

// Recalculate all KFN scores (admin only)
router.post('/recalculate-all', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only admins can recalculate all scores
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { batchSize = 100 } = req.body;

    // Get all applications without KFN scores
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

    const results = await Promise.all(
      applications.map(async (application) => {
        try {
          const kfnScore = await kfnService.calculateKFN(
            application.applicantId,
            application.jobId
          );

          // Update application with KFN score
          await prisma.application.update({
            where: { id: application.id },
            data: {
              kfnScore: kfnScore.overallScore,
              aiAnalysis: kfnScore
            }
          });

          // Save KFN calculation
          await prisma.kFNCalculation.create({
            data: {
              workerId: application.applicantId,
              jobId: application.jobId,
              applicationId: application.id,
              ...kfnScore
            }
          });

          return {
            applicationId: application.id,
            success: true,
            score: kfnScore.overallScore
          };
        } catch (error) {
          return {
            applicationId: application.id,
            success: false,
            error: error.message
          };
        }
      })
    );

    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({
      message: 'Recalculation completed',
      processed: applications.length,
      successful,
      failed,
      results
    });
  } catch (error) {
    console.error('Recalculate all KFN error:', error);
    res.status(500).json({ error: 'Failed to recalculate KFN scores', details: error.message });
  }
});

module.exports = router;
