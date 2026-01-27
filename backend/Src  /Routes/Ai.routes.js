const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const aiService = require('../services/ai/ai.service');

const prisma = new PrismaClient();

// Screen resume
router.post('/screen-resume', authMiddleware.verifyToken, [
  body('applicationId').optional(),
  body('resumeText').optional(),
  body('jobId').optional()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { applicationId, resumeText, jobId } = req.body;

    let result;
    
    if (applicationId) {
      // Screen existing application
      result = await aiService.screenResume(applicationId);
    } else if (resumeText && jobId) {
      // Screen provided resume text against job
      result = await aiService.screenResumeText(resumeText, jobId);
    } else {
      return res.status(400).json({ 
        error: 'Either applicationId or (resumeText and jobId) are required' 
      });
    }

    res.json(result);
  } catch (error) {
    console.error('Screen resume error:', error);
    res.status(500).json({ error: 'Failed to screen resume', details: error.message });
  }
});

// Match jobs for worker
router.post('/match-jobs', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only workers can get job matches
    if (req.userRole !== 'WORKER') {
      return res.status(403).json({ error: 'Only workers can get job matches' });
    }

    const { limit = 10, forceRecalculate = false } = req.body;

    const matches = await aiService.matchJobsForWorker(
      req.userId, 
      parseInt(limit), 
      forceRecalculate
    );

    res.json(matches);
  } catch (error) {
    console.error('Match jobs error:', error);
    res.status(500).json({ error: 'Failed to match jobs', details: error.message });
  }
});

// Match workers for job
router.post('/match-workers', authMiddleware.verifyToken, [
  body('jobId').notEmpty()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Only employers can get worker matches for their jobs
    const job = await prisma.job.findUnique({
      where: { id: req.body.jobId }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    if (job.employerId !== req.userId && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { limit = 10 } = req.body;

    const matches = await aiService.matchWorkersForJob(
      req.body.jobId, 
      parseInt(limit)
    );

    res.json(matches);
  } catch (error) {
    console.error('Match workers error:', error);
    res.status(500).json({ error: 'Failed to match workers', details: error.message });
  }
});

// AI chat assistant
router.post('/chat', authMiddleware.verifyToken, [
  body('message').notEmpty().trim(),
  body('context').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { message, context = {} } = req.body;

    const response = await aiService.chatAssistant(
      req.userId,
      message,
      context
    );

    res.json(response);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process chat message', details: error.message });
  }
});

// Analyze content (resume, job description, etc.)
router.post('/analyze', authMiddleware.verifyToken, [
  body('content').notEmpty().trim(),
  body('type').isIn(['RESUME', 'JOB_DESCRIPTION', 'COVER_LETTER', 'PROFILE', 'SKILLS']),
  body('options').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { content, type, options = {} } = req.body;

    const analysis = await aiService.analyzeContent(content, type, options);

    // Save analysis to database
    await prisma.aIAnalysis.create({
      data: {
        type,
        contentId: req.userId, // or generate a unique ID
        contentType: type,
        analysis: analysis,
        summary: analysis.summary || '',
        keywords: analysis.keywords || [],
        sentiment: analysis.sentiment,
        confidence: analysis.confidence || 0.8,
        modelUsed: 'deepseek-chat',
        tokensUsed: analysis.tokensUsed || 0,
        cost: analysis.cost || 0
      }
    });

    res.json(analysis);
  } catch (error) {
    console.error('Analyze content error:', error);
    res.status(500).json({ error: 'Failed to analyze content', details: error.message });
  }
});

// Optimize resume
router.post('/optimize-resume', authMiddleware.verifyToken, [
  body('resumeText').notEmpty().trim(),
  body('targetJobTitle').optional().trim(),
  body('targetIndustry').optional().trim(),
  body('optimizationGoals').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { resumeText, targetJobTitle, targetIndustry, optimizationGoals } = req.body;

    const optimizedResume = await aiService.optimizeResume(
      resumeText,
      {
        targetJobTitle,
        targetIndustry,
        optimizationGoals: optimizationGoals || ['ATS_FRIENDLY', 'KEYWORD_OPTIMIZATION', 'CLARITY']
      }
    );

    res.json(optimizedResume);
  } catch (error) {
    console.error('Optimize resume error:', error);
    res.status(500).json({ error: 'Failed to optimize resume', details: error.message });
  }
});

// Generate cover letter
router.post('/generate-cover-letter', authMiddleware.verifyToken, [
  body('jobDescription').notEmpty().trim(),
  body('resumeText').optional().trim(),
  body('tone').optional().isIn(['PROFESSIONAL', 'CREATIVE', 'CONCISE', 'ENTHUSIASTIC']),
  body('length').optional().isIn(['SHORT', 'MEDIUM', 'LONG'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { jobDescription, resumeText, tone = 'PROFESSIONAL', length = 'MEDIUM' } = req.body;

    // Get user's resume if not provided
    let userResumeText = resumeText;
    if (!userResumeText && req.userRole === 'WORKER') {
      const workerProfile = await prisma.workerProfile.findUnique({
        where: { userId: req.userId },
        select: { resumeUrl: true }
      });
      
      // In a real implementation, you would read the resume file
      userResumeText = "User's resume content would be extracted here";
    }

    const coverLetter = await aiService.generateCoverLetter(
      jobDescription,
      userResumeText,
      { tone, length }
    );

    res.json(coverLetter);
  } catch (error) {
    console.error('Generate cover letter error:', error);
    res.status(500).json({ error: 'Failed to generate cover letter', details: error.message });
  }
});

// Analyze interview performance
router.post('/analyze-interview', authMiddleware.verifyToken, [
  body('interviewTranscript').notEmpty().trim(),
  body('jobDescription').optional().trim(),
  body('interviewType').optional().isIn(['TECHNICAL', 'BEHAVIORAL', 'CULTURAL', 'GENERAL']),
  body('questions').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { interviewTranscript, jobDescription, interviewType, questions } = req.body;

    const analysis = await aiService.analyzeInterview(
      interviewTranscript,
      {
        jobDescription,
        interviewType: interviewType || 'GENERAL',
        questions: questions || []
      }
    );

    res.json(analysis);
  } catch (error) {
    console.error('Analyze interview error:', error);
    res.status(500).json({ error: 'Failed to analyze interview', details: error.message });
  }
});

// Suggest interview questions
router.post('/suggest-interview-questions', authMiddleware.verifyToken, [
  body('jobDescription').notEmpty().trim(),
  body('resumeText').optional().trim(),
  body('questionType').optional().isIn(['TECHNICAL', 'BEHAVIORAL', 'CULTURAL', 'ALL']),
  body('difficulty').optional().isIn(['EASY', 'MEDIUM', 'HARD', 'MIXED']),
  body('count').optional().isInt({ min: 1, max: 20 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      jobDescription, 
      resumeText, 
      questionType = 'ALL', 
      difficulty = 'MIXED',
      count = 10 
    } = req.body;

    const questions = await aiService.suggestInterviewQuestions(
      jobDescription,
      resumeText,
      {
        questionType,
        difficulty,
        count: parseInt(count)
      }
    );

    res.json(questions);
  } catch (error) {
    console.error('Suggest interview questions error:', error);
    res.status(500).json({ error: 'Failed to suggest interview questions', details: error.message });
  }
});

// Get AI service status
router.get('/status', authMiddleware.verifyToken, async (req, res) => {
  try {
    const status = await aiService.getStatus();
    
    res.json(status);
  } catch (error) {
    console.error('Get AI status error:', error);
    res.status(500).json({ error: 'Failed to get AI service status', details: error.message });
  }
});

// Batch process resumes
router.post('/batch-process', authMiddleware.verifyToken, [
  body('applicationIds').isArray(),
  body('action').isIn(['SCREEN', 'MATCH', 'ANALYZE'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { applicationIds, action } = req.body;

    // Check permissions - only employers or admins
    if (req.userRole !== 'EMPLOYER' && req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const results = await aiService.batchProcess(
      applicationIds,
      action,
      req.userId
    );

    res.json({
      message: `Batch ${action.toLowerCase()} completed`,
      results,
      processed: results.length,
      failed: results.filter(r => r.error).length
    });
  } catch (error) {
    console.error('Batch process error:', error);
    res.status(500).json({ error: 'Failed to batch process', details: error.message });
  }
});

module.exports = router;
