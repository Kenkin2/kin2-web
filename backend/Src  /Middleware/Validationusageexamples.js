// routes/auth.js
const express = require('express');
const router = express.Router();
const {
  validate,
  validateQuery,
  validateParams,
  validateFile,
  sanitizeInput,
} = require('../middleware/validation');

// Apply sanitization to all routes
router.use(sanitizeInput());

// User registration
router.post('/register',
  validate('userRegistration'),
  async (req, res) => {
    const userData = req.validatedData;
    // Process registration
  }
);

// User login
router.post('/login',
  validate('userLogin'),
  async (req, res) => {
    const loginData = req.validatedData;
    // Process login
  }
);

// Update profile
router.put('/profile',
  authenticate(),
  validate('userProfileUpdate'),
  async (req, res) => {
    const updateData = req.validatedData;
    // Update profile
  }
);

// Change password
router.post('/change-password',
  authenticate(),
  validate('passwordChange'),
  async (req, res) => {
    const passwordData = req.validatedData;
    // Change password
  }
);

// Upload resume
router.post('/resume/upload',
  authenticate(),
  upload.single('resume'),
  validateFile('resume', {
    allowedTypes: ['application/pdf', 'application/msword', 
                   'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    maxSize: 5 * 1024 * 1024, // 5MB
  }),
  async (req, res) => {
    // Process resume upload
  }
);

// routes/jobs.js
router.post('/jobs',
  authenticate(),
  authorize('employer', 'admin'),
  validate('jobPost'),
  async (req, res) => {
    const jobData = req.validatedData;
    // Create job
  }
);

router.put('/jobs/:jobId',
  authenticate(),
  authorize('employer', 'admin'),
  validateParams('jobId', { source: 'params' }), // Validate jobId is ObjectId
  validate('jobUpdate'),
  async (req, res) => {
    const jobData = req.validatedData;
    // Update job
  }
);

router.get('/jobs/search',
  validateQuery('jobSearch'),
  async (req, res) => {
    const searchParams = req.validatedData;
    // Search jobs
  }
);

// routes/applications.js
router.post('/applications',
  authenticate(),
  authorize('candidate'),
  validate('application'),
  async (req, res) => {
    const applicationData = req.validatedData;
    // Submit application
  }
);

router.put('/applications/:applicationId',
  authenticate(),
  authorize('employer', 'admin'),
  validateParams('applicationId', { source: 'params' }),
  validate('applicationUpdate'),
  async (req, res) => {
    const updateData = req.validatedData;
    // Update application status
  }
);

// routes/companies.js
router.post('/companies',
  authenticate(),
  authorize('employer', 'admin'),
  validate('company'),
  async (req, res) => {
    const companyData = req.validatedData;
    // Create or update company
  }
);

// routes/admin.js
router.put('/admin/users/:userId',
  authenticate(),
  authorize('admin', 'superadmin'),
  validateParams('userId', { source: 'params' }),
  validate('adminUserUpdate'),
  async (req, res) => {
    const updateData = req.validatedData;
    // Update user as admin
  }
);

// Conditional validation example
router.post('/profile/complete',
  authenticate(),
  validateConditional(
    (req) => req.user.role === 'candidate',
    'candidateProfile'
  ),
  validateConditional(
    (req) => req.user.role === 'employer',
    'employerProfile'
  ),
  async (req, res) => {
    // Complete profile based on role
  }
);

// Batch validation example
router.post('/jobs/bulk',
  authenticate(),
  authorize('employer', 'admin'),
  async (req, res) => {
    const jobs = req.body.jobs;
    
    const result = await validationService.validateBatch(jobs, 'jobPost');
    
    if (result.invalid > 0) {
      return res.status(400).json({
        success: false,
        error: 'BATCH_VALIDATION_ERROR',
        message: 'Some jobs failed validation',
        total: result.total,
        valid: result.valid,
        invalid: result.invalid,
        invalidResults: result.invalidResults.map(r => ({
          index: r.index,
          errors: r.errors,
        })),
      });
    }
    
    // Process valid jobs
    const validJobs = result.validResults.map(r => r.data);
    // ...
  }
);

// Custom validation in controller
router.post('/custom-validation',
  async (req, res) => {
    const data = req.body;
    
    // Validate email
    const emailResult = validationService.validateEmail(data.email);
    if (!emailResult.valid) {
      return res.status(400).json({
        error: 'INVALID_EMAIL',
        message: emailResult.error,
      });
    }
    
    // Validate password
    const passwordResult = validationService.validatePassword(data.password);
    if (!passwordResult.valid) {
      return res.status(400).json({
        error: 'WEAK_PASSWORD',
        messages: passwordResult.errors,
      });
    }
    
    // Validate URL
    if (data.website) {
      const urlResult = validationService.validateURL(data.website);
      if (!urlResult.valid) {
        return res.status(400).json({
          error: 'INVALID_URL',
          message: urlResult.error,
        });
      }
    }
    
    // Process data
  }
);

// Response validation
router.get('/api/data',
  validationMiddleware.validateResponse('apiResponseSchema'),
  async (req, res) => {
    const data = await getData();
    res.json(data); // Will be validated before sending
  }
);

// Rate limiting for validation errors
router.post('/contact',
  validationMiddleware.validationRateLimit(5, 900000), // 5 errors per 15 minutes
  validate('contactForm'),
  async (req, res) => {
    // Process contact form
  }
);
