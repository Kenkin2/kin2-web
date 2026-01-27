/**
 * Request validation middleware using Joi
 */

const Joi = require('joi');
const { ValidationError } = require('./errorHandler');

// Common validation schemas
const commonValidators = {
  id: Joi.string().cuid().required(),
  email: Joi.string().email().max(255).required(),
  password: Joi.string()
    .min(8)
    .max(100)
    .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$'))
    .message('Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character'),
  phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/),
  url: Joi.string().uri(),
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string(),
    order: Joi.string().valid('asc', 'desc').default('desc')
  })
};

// Validation schemas for different endpoints
const validationSchemas = {
  // Auth schemas
  register: Joi.object({
    email: commonValidators.email,
    password: commonValidators.password,
    firstName: Joi.string().max(100).required(),
    lastName: Joi.string().max(100).required(),
    role: Joi.string().valid('EMPLOYER', 'WORKER', 'VOLUNTEER', 'FREELANCER', 'SELLER').required(),
    phone: commonValidators.phone,
    companyName: Joi.string().when('role', {
      is: 'EMPLOYER',
      then: Joi.string().max(200).required()
    }),
    acceptTerms: Joi.boolean().valid(true).required()
  }),

  login: Joi.object({
    email: commonValidators.email,
    password: Joi.string().required(),
    rememberMe: Joi.boolean().default(false)
  }),

  // Job schemas
  createJob: Joi.object({
    title: Joi.string().max(200).required(),
    description: Joi.string().required(),
    requirements: Joi.string().required(),
    responsibilities: Joi.string().required(),
    jobType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'TEMPORARY', 'INTERNSHIP').required(),
    workType: Joi.string().valid('REMOTE', 'ONSITE', 'HYBRID').required(),
    experienceLevel: Joi.string().valid('ENTRY', 'MID_LEVEL', 'SENIOR', 'LEAD', 'EXECUTIVE').required(),
    location: Joi.string().max(200),
    isRemote: Joi.boolean().default(false),
    salaryMin: Joi.number().positive(),
    salaryMax: Joi.number().positive().greater(Joi.ref('salaryMin')),
    salaryCurrency: Joi.string().length(3).default('USD'),
    requiredSkills: Joi.array().items(Joi.string().max(100)),
    applicationDeadline: Joi.date().greater('now')
  }),

  updateJob: Joi.object({
    title: Joi.string().max(200),
    description: Joi.string(),
    requirements: Joi.string(),
    status: Joi.string().valid('DRAFT', 'PUBLISHED', 'CLOSED', 'ARCHIVED')
  }).min(1),

  // Application schemas
  createApplication: Joi.object({
    jobId: commonValidators.id,
    coverLetter: Joi.string().max(5000),
    resumeFile: Joi.string().uri(),
    portfolioLink: commonValidators.url,
    linkedinProfile: commonValidators.url,
    githubProfile: commonValidators.url
  }),

  // User schemas
  updateProfile: Joi.object({
    firstName: Joi.string().max(100),
    lastName: Joi.string().max(100),
    bio: Joi.string().max(2000),
    phone: commonValidators.phone,
    location: Joi.string().max(200),
    skills: Joi.array().items(Joi.string().max(100)),
    availabilityType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'CONTRACT', 'FREELANCE'),
    minSalary: Joi.number().positive(),
    maxSalary: Joi.number().positive().greater(Joi.ref('minSalary'))
  }),

  // AI schemas
  aiScreenResume: Joi.object({
    resumeText: Joi.string().required(),
    jobId: commonValidators.id.required(),
    analysisType: Joi.string().valid('QUICK', 'DETAILED', 'COMPREHENSIVE').default('DETAILED')
  }),

  aiMatchJobs: Joi.object({
    workerId: commonValidators.id.required(),
    limit: Joi.number().integer().min(1).max(50).default(10),
    includeScores: Joi.boolean().default(true)
  }),

  // Payment schemas
  createPayment: Joi.object({
    amount: Joi.number().positive().required(),
    currency: Joi.string().length(3).default('USD'),
    description: Joi.string().max(500),
    metadata: Joi.object()
  }),

  // Admin schemas
  adminUpdateUser: Joi.object({
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'SUSPENDED', 'BANNED'),
    role: Joi.string().valid('ADMIN', 'EMPLOYER', 'WORKER', 'VOLUNTEER', 'FREELANCER', 'SELLER'),
    verificationLevel: Joi.number().integer().min(0).max(3)
  })
};

/**
 * Validate request against schema
 */
const validateRequest = (schemaName, options = {}) => {
  return (req, res, next) => {
    const schema = validationSchemas[schemaName];
    
    if (!schema) {
      return next(new Error(`Validation schema '${schemaName}' not found`));
    }

    const dataToValidate = {};
    
    // Determine what to validate based on options
    if (options.body !== false) {
      Object.assign(dataToValidate, req.body);
    }
    
    if (options.params !== false) {
      Object.assign(dataToValidate, req.params);
    }
    
    if (options.query !== false) {
      Object.assign(dataToValidate, req.query);
    }

    const validationOptions = {
      abortEarly: false,
      allowUnknown: false,
      stripUnknown: true,
      ...options.joiOptions
    };

    const { error, value } = schema.validate(dataToValidate, validationOptions);

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/['"]/g, ''),
        type: detail.type
      }));

      return next(new ValidationError(errors, 'Validation failed'));
    }

    // Replace validated data
    if (options.body !== false) {
      req.body = value;
    }
    
    if (options.params !== false) {
      req.params = value;
    }
    
    if (options.query !== false) {
      req.query = value;
    }

    next();
  };
};

/**
 * Sanitize input data
 */
const sanitizeInput = (req, res, next) => {
  // Sanitize strings
  const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;
    return str
      .replace(/<[^>]*>?/gm, '') // Remove HTML tags
      .replace(/[<>"'`]/g, '') // Remove dangerous characters
      .trim();
  };

  // Recursive sanitize function
  const sanitizeObject = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
      return typeof obj === 'string' ? sanitizeString(obj) : obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(item => sanitizeObject(item));
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeObject(value);
    }
    return sanitized;
  };

  // Sanitize request body, params, and query
  if (req.body) {
    req.body = sanitizeObject(req.body);
  }

  if (req.params) {
    req.params = sanitizeObject(req.params);
  }

  if (req.query) {
    req.query = sanitizeObject(req.query);
  }

  next();
};

module.exports = {
  validateRequest,
  sanitizeInput,
  commonValidators,
  validationSchemas
};
