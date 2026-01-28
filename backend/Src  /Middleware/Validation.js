// src/middleware/validation.js
const Joi = require('joi');
const { Types } = require('mongoose');
const sanitizeHtml = require('sanitize-html');
const xss = require('xss');
const validator = require('validator');

class ValidationService {
  constructor() {
    // Define custom Joi validators
    this.customValidators = this.registerCustomValidators();
    
    // Common validation rules
    this.rules = {
      // Basic types
      string: Joi.string().trim(),
      number: Joi.number(),
      boolean: Joi.boolean(),
      date: Joi.date(),
      array: Joi.array(),
      object: Joi.object(),
      
      // Common patterns
      email: Joi.string().trim().lowercase().email().max(255),
      password: Joi.string().min(8).max(100)
        .pattern(/[A-Z]/).message('Password must contain at least one uppercase letter')
        .pattern(/[a-z]/).message('Password must contain at least one lowercase letter')
        .pattern(/[0-9]/).message('Password must contain at least one number')
        .pattern(/[^A-Za-z0-9]/).message('Password must contain at least one special character'),
      
      phone: Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).message('Invalid phone number format'),
      url: Joi.string().uri(),
      objectId: Joi.string().custom(this.validateObjectId, 'ObjectId validation'),
      
      // Business-specific
      jobTitle: Joi.string().min(3).max(100),
      jobDescription: Joi.string().min(10).max(10000),
      salary: Joi.number().min(0).max(1000000),
      experience: Joi.number().min(0).max(50),
    };
    
    // Cached schemas
    this.schemas = new Map();
  }

  registerCustomValidators() {
    // ObjectId validation
    Joi.objectId = () => Joi.string().custom(this.validateObjectId, 'ObjectId validation');
    
    // File validation
    Joi.file = (options = {}) => {
      const { maxSize = 5 * 1024 * 1024, mimeTypes = [] } = options;
      return Joi.object({
        fieldname: Joi.string().required(),
        originalname: Joi.string().required(),
        encoding: Joi.string().required(),
        mimetype: Joi.string().required().custom((value, helpers) => {
          if (mimeTypes.length && !mimeTypes.includes(value)) {
            return helpers.error('any.invalid');
          }
          return value;
        }),
        buffer: Joi.binary().required(),
        size: Joi.number().max(maxSize).required(),
      });
    };
    
    // Currency validation
    Joi.currency = () => Joi.string().pattern(/^[A-Z]{3}$/);
    
    // Phone validation with country code
    Joi.phoneWithCountry = () => Joi.string().pattern(/^\+\d{1,3}\s?\d{4,14}$/);
    
    // URL slug validation
    Joi.slug = () => Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    
    // HTML sanitization
    Joi.sanitizedHtml = (options = {}) => {
      return Joi.string().custom((value, helpers) => {
        const sanitized = sanitizeHtml(value, {
          allowedTags: options.allowedTags || ['b', 'i', 'em', 'strong', 'p', 'br', 'ul', 'ol', 'li', 'a'],
          allowedAttributes: options.allowedAttributes || {
            'a': ['href', 'title', 'target']
          },
        });
        return sanitized;
      });
    };
    
    // XSS prevention
    Joi.xssSafe = () => Joi.string().custom((value, helpers) => xss(value));
    
    return Joi;
  }

  validateObjectId(value, helpers) {
    if (!Types.ObjectId.isValid(value)) {
      return helpers.error('any.invalid');
    }
    return value;
  }

  // SCHEMA DEFINITIONS

  // User Schemas
  get userRegistrationSchema() {
    return Joi.object({
      email: this.rules.email.required(),
      password: this.rules.password.required(),
      firstName: Joi.string().min(2).max(50).required(),
      lastName: Joi.string().min(2).max(50).required(),
      phone: this.rules.phone.optional(),
      role: Joi.string().valid('candidate', 'employer').required(),
      termsAccepted: Joi.boolean().valid(true).required().messages({
        'any.only': 'You must accept the terms and conditions'
      }),
      
      // Optional fields based on role
      companyName: Joi.when('role', {
        is: 'employer',
        then: Joi.string().min(2).max(100).required(),
        otherwise: Joi.optional()
      }),
      jobTitle: Joi.when('role', {
        is: 'candidate',
        then: Joi.string().min(2).max(100).optional(),
        otherwise: Joi.optional()
      }),
    });
  }

  get userLoginSchema() {
    return Joi.object({
      email: this.rules.email.required(),
      password: Joi.string().required(),
      rememberMe: Joi.boolean().default(false),
      deviceInfo: Joi.object({
        userAgent: Joi.string().optional(),
        fingerprint: Joi.string().optional(),
      }).optional(),
    });
  }

  get userProfileUpdateSchema() {
    return Joi.object({
      firstName: Joi.string().min(2).max(50).optional(),
      lastName: Joi.string().min(2).max(50).optional(),
      phone: this.rules.phone.optional(),
      avatar: Joi.string().uri().optional(),
      
      // Contact info
      address: Joi.object({
        street: Joi.string().max(100).optional(),
        city: Joi.string().max(50).optional(),
        state: Joi.string().max(50).optional(),
        country: Joi.string().max(50).optional(),
        zipCode: Joi.string().max(20).optional(),
      }).optional(),
      
      // Preferences
      preferences: Joi.object({
        emailNotifications: Joi.boolean().default(true),
        pushNotifications: Joi.boolean().default(true),
        newsletter: Joi.boolean().default(false),
        privacy: Joi.string().valid('public', 'private', 'connections').default('private'),
      }).optional(),
      
      // Social links
      socialLinks: Joi.object({
        linkedin: Joi.string().uri().optional(),
        github: Joi.string().uri().optional(),
        twitter: Joi.string().uri().optional(),
        portfolio: Joi.string().uri().optional(),
      }).optional(),
    }).min(1); // At least one field must be provided
  }

  get passwordChangeSchema() {
    return Joi.object({
      currentPassword: Joi.string().required(),
      newPassword: this.rules.password.required(),
      confirmPassword: Joi.any().valid(Joi.ref('newPassword')).required().messages({
        'any.only': 'Passwords do not match'
      }),
    });
  }

  // Candidate Schemas
  get candidateProfileSchema() {
    return Joi.object({
      // Professional info
      headline: Joi.string().max(200).optional(),
      bio: Joi.string().max(2000).optional(),
      currentSalary: Joi.number().min(0).max(1000000).optional(),
      expectedSalary: Joi.number().min(0).max(1000000).optional(),
      noticePeriod: Joi.number().min(0).max(180).optional(), // days
      availability: Joi.string().valid('immediately', '1_week', '2_weeks', '1_month', '3_months', 'custom').optional(),
      employmentType: Joi.array().items(
        Joi.string().valid('full_time', 'part_time', 'contract', 'freelance', 'internship', 'remote')
      ).optional(),
      
      // Location
      currentLocation: Joi.string().max(100).optional(),
      preferredLocations: Joi.array().items(Joi.string().max(100)).optional(),
      relocation: Joi.boolean().default(false),
      
      // Experience
      totalExperience: Joi.number().min(0).max(50).optional(),
      yearsOfExperience: Joi.object({
        years: Joi.number().min(0).max(50).optional(),
        months: Joi.number().min(0).max(11).optional(),
      }).optional(),
      
      // Education
      highestEducation: Joi.object({
        degree: Joi.string().max(100).optional(),
        field: Joi.string().max(100).optional(),
        institution: Joi.string().max(100).optional(),
        graduationYear: Joi.number().min(1900).max(new Date().getFullYear() + 10).optional(),
      }).optional(),
      
      // Skills
      skills: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          level: Joi.string().valid('beginner', 'intermediate', 'advanced', 'expert').optional(),
          years: Joi.number().min(0).max(50).optional(),
        })
      ).max(50).optional(),
      
      // Languages
      languages: Joi.array().items(
        Joi.object({
          language: Joi.string().required(),
          proficiency: Joi.string().valid('basic', 'conversational', 'fluent', 'native').optional(),
        })
      ).optional(),
      
      // Links
      resumeUrl: Joi.string().uri().optional(),
      portfolioUrl: Joi.string().uri().optional(),
      videoIntro: Joi.string().uri().optional(),
    });
  }

  get candidateExperienceSchema() {
    return Joi.object({
      company: Joi.string().max(100).required(),
      title: Joi.string().max(100).required(),
      location: Joi.string().max(100).optional(),
      startDate: Joi.date().required(),
      endDate: Joi.date().optional().greater(Joi.ref('startDate')),
      currentlyWorking: Joi.boolean().default(false),
      description: Joi.string().max(5000).optional(),
      achievements: Joi.array().items(Joi.string().max(500)).optional(),
      skills: Joi.array().items(Joi.string()).optional(),
    });
  }

  get candidateEducationSchema() {
    return Joi.object({
      institution: Joi.string().max(100).required(),
      degree: Joi.string().max(100).required(),
      field: Joi.string().max(100).optional(),
      location: Joi.string().max(100).optional(),
      startDate: Joi.date().required(),
      endDate: Joi.date().optional().greater(Joi.ref('startDate')),
      currentlyStudying: Joi.boolean().default(false),
      grade: Joi.string().max(50).optional(),
      description: Joi.string().max(2000).optional(),
      activities: Joi.array().items(Joi.string().max(500)).optional(),
    });
  }

  // Employer Schemas
  get employerProfileSchema() {
    return Joi.object({
      companyName: Joi.string().min(2).max(100).required(),
      companySize: Joi.string().valid('1-10', '11-50', '51-200', '201-500', '501-1000', '1000+').optional(),
      industry: Joi.string().max(100).optional(),
      foundedYear: Joi.number().min(1800).max(new Date().getFullYear()).optional(),
      website: Joi.string().uri().optional(),
      description: Joi.string().max(5000).optional(),
      
      // Contact
      contactEmail: this.rules.email.optional(),
      contactPhone: this.rules.phone.optional(),
      
      // Address
      address: Joi.object({
        street: Joi.string().max(100).optional(),
        city: Joi.string().max(50).optional(),
        state: Joi.string().max(50).optional(),
        country: Joi.string().max(50).optional(),
        zipCode: Joi.string().max(20).optional(),
      }).optional(),
      
      // Social
      socialLinks: Joi.object({
        linkedin: Joi.string().uri().optional(),
        twitter: Joi.string().uri().optional(),
        facebook: Joi.string().uri().optional(),
        instagram: Joi.string().uri().optional(),
      }).optional(),
      
      // Logo
      logo: Joi.string().uri().optional(),
      
      // Settings
      settings: Joi.object({
        autoApproveJobs: Joi.boolean().default(false),
        applicationNotifications: Joi.boolean().default(true),
        candidateSearchAccess: Joi.boolean().default(false),
      }).optional(),
    });
  }

  // Job Schemas
  get jobPostSchema() {
    return Joi.object({
      title: this.rules.jobTitle.required(),
      description: this.rules.jobDescription.required(),
      shortDescription: Joi.string().max(500).optional(),
      
      // Job details
      jobType: Joi.string().valid(
        'full_time', 'part_time', 'contract', 'freelance', 'internship', 'temporary'
      ).required(),
      employmentType: Joi.string().valid('on_site', 'remote', 'hybrid').required(),
      experienceLevel: Joi.string().valid(
        'entry', 'junior', 'mid', 'senior', 'lead', 'manager', 'executive'
      ).required(),
      
      // Location
      location: Joi.object({
        city: Joi.string().max(50).required(),
        state: Joi.string().max(50).optional(),
        country: Joi.string().max(50).required(),
        remote: Joi.boolean().default(false),
        coordinates: Joi.object({
          lat: Joi.number().min(-90).max(90).optional(),
          lng: Joi.number().min(-180).max(180).optional(),
        }).optional(),
      }).required(),
      
      // Salary
      salary: Joi.object({
        min: Joi.number().min(0).max(1000000).optional(),
        max: Joi.number().min(0).max(1000000).optional(),
        currency: Joi.string().valid('USD', 'EUR', 'GBP', 'INR').default('USD'),
        period: Joi.string().valid('hourly', 'weekly', 'monthly', 'yearly').default('yearly'),
        negotiable: Joi.boolean().default(false),
        disclosed: Joi.boolean().default(false),
      }).optional(),
      
      // Requirements
      requirements: Joi.object({
        education: Joi.array().items(Joi.string()).optional(),
        experience: Joi.number().min(0).max(50).optional(),
        skills: Joi.array().items(Joi.string()).min(1).max(50).required(),
        certifications: Joi.array().items(Joi.string()).optional(),
        languages: Joi.array().items(
          Joi.object({
            language: Joi.string().required(),
            proficiency: Joi.string().valid('basic', 'conversational', 'fluent', 'native').optional(),
          })
        ).optional(),
      }).required(),
      
      // Benefits
      benefits: Joi.array().items(Joi.string()).optional(),
      
      // Application process
      application: Joi.object({
        deadline: Joi.date().greater('now').optional(),
        process: Joi.string().max(2000).optional(),
        questions: Joi.array().items(
          Joi.object({
            question: Joi.string().required(),
            type: Joi.string().valid('text', 'choice', 'multiple', 'file').required(),
            required: Joi.boolean().default(false),
            options: Joi.when('type', {
              is: Joi.valid('choice', 'multiple'),
              then: Joi.array().items(Joi.string()).min(2).required(),
              otherwise: Joi.forbidden(),
            }),
          })
        ).max(10).optional(),
      }).optional(),
      
      // Metadata
      tags: Joi.array().items(Joi.string()).max(20).optional(),
      category: Joi.string().max(50).optional(),
      industry: Joi.string().max(50).optional(),
      
      // Visibility
      status: Joi.string().valid('draft', 'active', 'paused', 'closed').default('draft'),
      featured: Joi.boolean().default(false),
      urgent: Joi.boolean().default(false),
      
      // SEO
      slug: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      metaTitle: Joi.string().max(60).optional(),
      metaDescription: Joi.string().max(160).optional(),
    });
  }

  get jobUpdateSchema() {
    return this.jobPostSchema.fork(['title', 'description', 'jobType', 'employmentType'], 
      schema => schema.optional()
    );
  }

  get jobSearchSchema() {
    return Joi.object({
      query: Joi.string().max(100).optional(),
      location: Joi.string().max(100).optional(),
      jobType: Joi.array().items(
        Joi.string().valid('full_time', 'part_time', 'contract', 'freelance', 'internship')
      ).optional(),
      experienceLevel: Joi.array().items(
        Joi.string().valid('entry', 'junior', 'mid', 'senior', 'lead')
      ).optional(),
      salaryMin: Joi.number().min(0).optional(),
      salaryMax: Joi.number().min(0).optional(),
      remote: Joi.boolean().optional(),
      skills: Joi.array().items(Joi.string()).optional(),
      company: Joi.array().items(Joi.string()).optional(),
      industry: Joi.array().items(Joi.string()).optional(),
      datePosted: Joi.string().valid('24h', '7d', '30d', 'any').default('any'),
      
      // Pagination
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(20),
      sortBy: Joi.string().valid(
        'relevance', 'date', 'salary', 'experience'
      ).default('relevance'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    });
  }

  // Application Schemas
  get applicationSchema() {
    return Joi.object({
      jobId: Joi.objectId().required(),
      candidateId: Joi.objectId().optional(),
      
      // Cover letter
      coverLetter: Joi.string().max(5000).optional(),
      
      // Answers to job questions
      answers: Joi.array().items(
        Joi.object({
          questionId: Joi.string().required(),
          answer: Joi.alternatives().try(
            Joi.string(),
            Joi.array().items(Joi.string()),
            Joi.object() // For file uploads
          ).required(),
        })
      ).optional(),
      
      // Additional info
      source: Joi.string().max(100).optional(),
      referredBy: Joi.string().max(100).optional(),
      availability: Joi.date().optional(),
      expectedSalary: Joi.number().min(0).optional(),
      noticePeriod: Joi.number().min(0).optional(),
      
      // Files
      resume: Joi.string().uri().optional(),
      portfolio: Joi.string().uri().optional(),
      otherFiles: Joi.array().items(Joi.string().uri()).max(5).optional(),
      
      // Preferences
      preferences: Joi.object({
        contactMethod: Joi.string().valid('email', 'phone', 'both').default('email'),
        contactTime: Joi.string().valid('morning', 'afternoon', 'evening', 'any').default('any'),
      }).optional(),
    });
  }

  get applicationUpdateSchema() {
    return Joi.object({
      status: Joi.string().valid(
        'submitted', 'reviewing', 'shortlisted', 'interviewing', 
        'offer', 'hired', 'rejected', 'withdrawn'
      ).optional(),
      rating: Joi.number().min(1).max(5).optional(),
      notes: Joi.string().max(5000).optional(),
      feedback: Joi.string().max(5000).optional(),
      nextSteps: Joi.array().items(Joi.string()).optional(),
      
      // Interview scheduling
      interview: Joi.object({
        scheduledDate: Joi.date().greater('now').optional(),
        duration: Joi.number().min(15).max(480).optional(),
        type: Joi.string().valid('phone', 'video', 'in_person').optional(),
        location: Joi.string().max(500).optional(),
        link: Joi.string().uri().optional(),
        description: Joi.string().max(2000).optional(),
      }).optional(),
    });
  }

  // Company Schemas
  get companySchema() {
    return Joi.object({
      name: Joi.string().min(2).max(100).required(),
      legalName: Joi.string().min(2).max(100).optional(),
      tagline: Joi.string().max(200).optional(),
      description: Joi.string().max(10000).required(),
      shortDescription: Joi.string().max(500).optional(),
      
      // Contact
      email: this.rules.email.optional(),
      phone: this.rules.phone.optional(),
      website: Joi.string().uri().optional(),
      
      // Location
      headquarters: Joi.object({
        address: Joi.string().max(200).optional(),
        city: Joi.string().max(50).optional(),
        state: Joi.string().max(50).optional(),
        country: Joi.string().max(50).optional(),
        zipCode: Joi.string().max(20).optional(),
      }).optional(),
      
      // Details
      foundedYear: Joi.number().min(1800).max(new Date().getFullYear()).optional(),
      companySize: Joi.string().valid(
        '1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000', '5000+'
      ).optional(),
      industry: Joi.array().items(Joi.string()).optional(),
      type: Joi.string().valid(
        'public', 'private', 'nonprofit', 'government', 'startup', 'agency'
      ).optional(),
      
      // Social
      socialLinks: Joi.object({
        linkedin: Joi.string().uri().optional(),
        twitter: Joi.string().uri().optional(),
        facebook: Joi.string().uri().optional(),
        instagram: Joi.string().uri().optional(),
        youtube: Joi.string().uri().optional(),
        glassdoor: Joi.string().uri().optional(),
      }).optional(),
      
      // Media
      logo: Joi.string().uri().optional(),
      coverImage: Joi.string().uri().optional(),
      gallery: Joi.array().items(Joi.string().uri()).max(10).optional(),
      video: Joi.string().uri().optional(),
      
      // Culture
      mission: Joi.string().max(1000).optional(),
      vision: Joi.string().max(1000).optional(),
      values: Joi.array().items(Joi.string().max(200)).optional(),
      culture: Joi.string().max(5000).optional(),
      
      // Benefits
      benefits: Joi.array().items(
        Joi.object({
          name: Joi.string().required(),
          description: Joi.string().max(500).optional(),
          icon: Joi.string().optional(),
        })
      ).optional(),
      
      // SEO
      slug: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
      metaTitle: Joi.string().max(60).optional(),
      metaDescription: Joi.string().max(160).optional(),
      
      // Settings
      verified: Joi.boolean().default(false),
      featured: Joi.boolean().default(false),
      status: Joi.string().valid('active', 'inactive', 'suspended').default('active'),
    });
  }

  // Payment Schemas
  get paymentSchema() {
    return Joi.object({
      amount: Joi.number().min(0.01).required(),
      currency: Joi.string().valid('USD', 'EUR', 'GBP', 'INR').default('USD'),
      description: Joi.string().max(200).optional(),
      
      // Payment method
      paymentMethod: Joi.object({
        type: Joi.string().valid('card', 'bank', 'wallet', 'upi').required(),
        token: Joi.string().optional(),
        card: Joi.object({
          number: Joi.string().creditCard().optional(),
          expMonth: Joi.number().min(1).max(12).optional(),
          expYear: Joi.number().min(new Date().getFullYear()).optional(),
          cvc: Joi.string().length(3).optional(),
        }).optional(),
      }).required(),
      
      // Billing
      billingDetails: Joi.object({
        name: Joi.string().max(100).optional(),
        email: this.rules.email.optional(),
        phone: this.rules.phone.optional(),
        address: Joi.object({
          line1: Joi.string().max(100).optional(),
          line2: Joi.string().max(100).optional(),
          city: Joi.string().max(50).optional(),
          state: Joi.string().max(50).optional(),
          country: Joi.string().max(50).optional(),
          postalCode: Joi.string().max(20).optional(),
        }).optional(),
      }).optional(),
      
      // Metadata
      metadata: Joi.object().pattern(
        Joi.string(),
        Joi.alternatives().try(Joi.string(), Joi.number(), Joi.boolean())
      ).optional(),
      
      // For job postings
      itemType: Joi.string().valid('job_post', 'featured_job', 'boost', 'subscription', 'resume_access').optional(),
      itemId: Joi.string().optional(),
      quantity: Joi.number().min(1).default(1),
    });
  }

  // Review/Rating Schemas
  get reviewSchema() {
    return Joi.object({
      rating: Joi.number().min(1).max(5).required(),
      title: Joi.string().max(100).optional(),
      review: Joi.string().max(5000).required(),
      
      // For company reviews
      companyId: Joi.objectId().optional(),
      
      // For candidate reviews (by employer)
      candidateId: Joi.objectId().optional(),
      
      // For employer reviews (by candidate)
      employerId: Joi.objectId().optional(),
      
      // Categories
      categories: Joi.array().items(
        Joi.object({
          category: Joi.string().required(),
          rating: Joi.number().min(1).max(5).required(),
        })
      ).optional(),
      
      // Anonymous
      anonymous: Joi.boolean().default(false),
      
      // Would recommend
      recommend: Joi.boolean().optional(),
      
      // Pros and cons
      pros: Joi.array().items(Joi.string().max(200)).optional(),
      cons: Joi.array().items(Joi.string().max(200)).optional(),
    });
  }

  // Notification Schemas
  get notificationSettingsSchema() {
    return Joi.object({
      email: Joi.object({
        jobAlerts: Joi.boolean().default(true),
        applicationUpdates: Joi.boolean().default(true),
        messages: Joi.boolean().default(true),
        promotions: Joi.boolean().default(false),
        newsletter: Joi.boolean().default(false),
        security: Joi.boolean().default(true),
      }).default(),
      
      push: Joi.object({
        jobAlerts: Joi.boolean().default(true),
        applicationUpdates: Joi.boolean().default(true),
        messages: Joi.boolean().default(true),
        reminders: Joi.boolean().default(true),
      }).default(),
      
      sms: Joi.object({
        security: Joi.boolean().default(true),
        importantUpdates: Joi.boolean().default(false),
      }).default(),
      
      frequency: Joi.string().valid('immediate', 'daily', 'weekly').default('immediate'),
    });
  }

  // Search Schemas
  get candidateSearchSchema() {
    return Joi.object({
      query: Joi.string().max(100).optional(),
      skills: Joi.array().items(Joi.string()).optional(),
      experienceMin: Joi.number().min(0).max(50).optional(),
      experienceMax: Joi.number().min(0).max(50).optional(),
      location: Joi.string().max(100).optional(),
      education: Joi.array().items(Joi.string()).optional(),
      availability: Joi.string().valid('immediately', '1_week', '2_weeks', '1_month', '3_months').optional(),
      employmentType: Joi.array().items(
        Joi.string().valid('full_time', 'part_time', 'contract', 'freelance', 'remote')
      ).optional(),
      salaryExpectationMin: Joi.number().min(0).optional(),
      salaryExpectationMax: Joi.number().min(0).optional(),
      languages: Joi.array().items(Joi.string()).optional(),
      hasResume: Joi.boolean().optional(),
      hasPortfolio: Joi.boolean().optional(),
      
      // Pagination
      page: Joi.number().min(1).default(1),
      limit: Joi.number().min(1).max(100).default(20),
      sortBy: Joi.string().valid(
        'relevance', 'experience', 'date_updated', 'rating'
      ).default('relevance'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
    });
  }

  // File Upload Schemas
  get fileUploadSchema() {
    return Joi.object({
      fieldname: Joi.string().required(),
      originalname: Joi.string().required(),
      encoding: Joi.string().required(),
      mimetype: Joi.string().required().valid(
        'image/jpeg', 'image/png', 'image/gif', 'image/webp',
        'application/pdf', 'application/msword', 
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
      ),
      buffer: Joi.binary().required(),
      size: Joi.number().max(10 * 1024 * 1024).required(), // 10MB max
    });
  }

  // Admin Schemas
  get adminUserUpdateSchema() {
    return Joi.object({
      role: Joi.string().valid(
        'candidate', 'employer', 'admin', 'moderator', 'support', 'suspended', 'banned'
      ).optional(),
      status: Joi.string().valid('active', 'inactive', 'suspended', 'banned').optional(),
      verified: Joi.boolean().optional(),
      permissions: Joi.array().items(Joi.string()).optional(),
      notes: Joi.string().max(5000).optional(),
    });
  }

  // Helper methods
  getSchema(name) {
    if (this.schemas.has(name)) {
      return this.schemas.get(name);
    }

    let schema;
    switch (name) {
      case 'userRegistration':
        schema = this.userRegistrationSchema;
        break;
      case 'userLogin':
        schema = this.userLoginSchema;
        break;
      case 'userProfileUpdate':
        schema = this.userProfileUpdateSchema;
        break;
      case 'passwordChange':
        schema = this.passwordChangeSchema;
        break;
      case 'candidateProfile':
        schema = this.candidateProfileSchema;
        break;
      case 'candidateExperience':
        schema = this.candidateExperienceSchema;
        break;
      case 'candidateEducation':
        schema = this.candidateEducationSchema;
        break;
      case 'employerProfile':
        schema = this.employerProfileSchema;
        break;
      case 'jobPost':
        schema = this.jobPostSchema;
        break;
      case 'jobUpdate':
        schema = this.jobUpdateSchema;
        break;
      case 'jobSearch':
        schema = this.jobSearchSchema;
        break;
      case 'application':
        schema = this.applicationSchema;
        break;
      case 'applicationUpdate':
        schema = this.applicationUpdateSchema;
        break;
      case 'company':
        schema = this.companySchema;
        break;
      case 'payment':
        schema = this.paymentSchema;
        break;
      case 'review':
        schema = this.reviewSchema;
        break;
      case 'notificationSettings':
        schema = this.notificationSettingsSchema;
        break;
      case 'candidateSearch':
        schema = this.candidateSearchSchema;
        break;
      case 'fileUpload':
        schema = this.fileUploadSchema;
        break;
      case 'adminUserUpdate':
        schema = this.adminUserUpdateSchema;
        break;
      default:
        throw new Error(`Schema ${name} not found`);
    }

    this.schemas.set(name, schema);
    return schema;
  }

  // Validation middleware generator
  validate(schemaName, options = {}) {
    const {
      source = 'body',
      allowUnknown = false,
      stripUnknown = true,
      abortEarly = false,
      context = {},
    } = options;

    return async (req, res, next) => {
      try {
        const schema = this.getSchema(schemaName);
        const data = req[source];
        
        // Validate data
        const { error, value } = schema.validate(data, {
          allowUnknown,
          stripUnknown,
          abortEarly,
          context,
        });

        if (error) {
          const validationErrors = this.formatValidationErrors(error);
          
          return res.status(400).json({
            success: false,
            error: 'VALIDATION_ERROR',
            message: 'Validation failed',
            code: 'VALIDATION_FAILED',
            errors: validationErrors,
            details: this.getErrorDetails(validationErrors),
          });
        }

        // Sanitize data (additional sanitization beyond Joi)
        const sanitizedValue = this.sanitizeData(value);
        
        // Replace request data with validated and sanitized data
        req[source] = sanitizedValue;
        
        // Store original data for reference
        req.originalData = data;
        req.validatedData = sanitizedValue;

        next();
      } catch (error) {
        console.error('Validation error:', error);
        
        return res.status(500).json({
          success: false,
          error: 'VALIDATION_PROCESSING_ERROR',
          message: 'Failed to validate input',
          code: 'VALIDATION_ERROR',
        });
      }
    };
  }

  // Custom validation function
  validateData(schemaName, data, options = {}) {
    const schema = this.getSchema(schemaName);
    const { error, value } = schema.validate(data, {
      allowUnknown: options.allowUnknown || false,
      stripUnknown: options.stripUnknown || true,
      abortEarly: options.abortEarly || false,
      context: options.context || {},
    });

    if (error) {
      return {
        valid: false,
        errors: this.formatValidationErrors(error),
        data: null,
      };
    }

    return {
      valid: true,
      errors: null,
      data: this.sanitizeData(value),
    };
  }

  // Format validation errors
  formatValidationErrors(error) {
    return error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      type: detail.type,
      context: detail.context,
    }));
  }

  // Get error details for debugging
  getErrorDetails(errors) {
    return errors.reduce((details, error) => {
      details[error.field] = {
        message: error.message,
        type: error.type,
      };
      return details;
    }, {});
  }

  // Sanitize data
  sanitizeData(data) {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }

    const sanitized = {};
    
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string') {
        // Remove script tags and sanitize HTML
        sanitized[key] = sanitizeHtml(value, {
          allowedTags: [],
          allowedAttributes: {},
        }).trim();
        
        // Additional XSS protection
        sanitized[key] = xss(sanitized[key]);
        
        // Trim whitespace
        sanitized[key] = sanitized[key].trim();
      } else if (typeof value === 'object' && value !== null) {
        sanitized[key] = this.sanitizeData(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  }

  // Validate file
  validateFile(file, options = {}) {
    const {
      maxSize = 10 * 1024 * 1024,
      allowedTypes = [
        'image/jpeg', 'image/png', 'image/gif',
        'application/pdf', 
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
      required = true,
    } = options;

    if (!file && required) {
      return {
        valid: false,
        error: 'File is required',
      };
    }

    if (!file && !required) {
      return { valid: true };
    }

    // Check file type
    if (!allowedTypes.includes(file.mimetype)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed types: ${allowedTypes.join(', ')}`,
      };
    }

    // Check file size
    if (file.size > maxSize) {
      return {
        valid: false,
        error: `File size exceeds maximum allowed size of ${maxSize / (1024 * 1024)}MB`,
      };
    }

    // Check filename for XSS
    if (file.originalname && this.containsXSS(file.originalname)) {
      return {
        valid: false,
        error: 'Invalid filename',
      };
    }

    return { valid: true };
  }

  // Check for XSS in string
  containsXSS(str) {
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+="[^"]*"/gi,
      /on\w+='[^']*'/gi,
      /on\w+=\w+/gi,
      /data:/gi,
      /vbscript:/gi,
    ];

    return xssPatterns.some(pattern => pattern.test(str));
  }

  // Validate email
  validateEmail(email) {
    if (!validator.isEmail(email)) {
      return {
        valid: false,
        error: 'Invalid email format',
      };
    }

    // Check for disposable emails
    const disposableDomains = [
      'tempmail.com', 'guerrillamail.com', 'mailinator.com',
      '10minutemail.com', 'throwawaymail.com', 'yopmail.com',
    ];

    const domain = email.split('@')[1].toLowerCase();
    if (disposableDomains.includes(domain)) {
      return {
        valid: false,
        error: 'Disposable email addresses are not allowed',
      };
    }

    return { valid: true };
  }

  // Validate password strength
  validatePassword(password) {
    const minLength = 8;
    const hasUpperCase = /[A-Z]/.test(password);
    const hasLowerCase = /[a-z]/.test(password);
    const hasNumbers = /\d/.test(password);
    const hasSpecialChar = /[^A-Za-z0-9]/.test(password);

    const errors = [];

    if (password.length < minLength) {
      errors.push(`Password must be at least ${minLength} characters long`);
    }
    if (!hasUpperCase) {
      errors.push('Password must contain at least one uppercase letter');
    }
    if (!hasLowerCase) {
      errors.push('Password must contain at least one lowercase letter');
    }
    if (!hasNumbers) {
      errors.push('Password must contain at least one number');
    }
    if (!hasSpecialChar) {
      errors.push('Password must contain at least one special character');
    }

    if (errors.length > 0) {
      return {
        valid: false,
        errors,
      };
    }

    return { valid: true };
  }

  // Validate URL
  validateURL(url, options = {}) {
    const { protocols = ['http', 'https'], requireProtocol = true } = options;
    
    if (!validator.isURL(url, { protocols, require_protocol: requireProtocol })) {
      return {
        valid: false,
        error: 'Invalid URL format',
      };
    }

    return { valid: true };
  }

  // Batch validation
  async validateBatch(items, schemaName, options = {}) {
    const results = await Promise.all(
      items.map(async (item, index) => {
        try {
          const result = this.validateData(schemaName, item, options);
          
          return {
            index,
            item,
            valid: result.valid,
            errors: result.errors,
            data: result.data,
          };
        } catch (error) {
          return {
            index,
            item,
            valid: false,
            error: error.message,
          };
        }
      })
    );

    const validResults = results.filter(r => r.valid);
    const invalidResults = results.filter(r => !r.valid);

    return {
      total: results.length,
      valid: validResults.length,
      invalid: invalidResults.length,
      results,
      validResults,
      invalidResults,
    };
  }
}

// Create validation middleware factory
const createValidationMiddleware = (validationService) => {
  /**
   * Main validation middleware
   */
  const validate = (schemaName, options = {}) => {
    return validationService.validate(schemaName, options);
  };

  /**
   * File validation middleware
   */
  const validateFile = (fieldName, options = {}) => {
    return async (req, res, next) => {
      try {
        const file = req.file || req.files?.[fieldName];
        
        const result = validationService.validateFile(file, options);
        
        if (!result.valid) {
          return res.status(400).json({
            success: false,
            error: 'FILE_VALIDATION_ERROR',
            message: result.error,
            code: 'INVALID_FILE',
          });
        }
        
        next();
      } catch (error) {
        console.error('File validation error:', error);
        res.status(500).json({
          success: false,
          error: 'FILE_VALIDATION_PROCESSING_ERROR',
          message: 'Failed to validate file',
          code: 'FILE_VALIDATION_ERROR',
        });
      }
    };
  };

  /**
   * Multiple file validation middleware
   */
  const validateFiles = (fieldName, options = {}) => {
    return async (req, res, next) => {
      try {
        const files = req.files?.[fieldName] || [];
        
        for (const file of files) {
          const result = validationService.validateFile(file, options);
          
          if (!result.valid) {
            return res.status(400).json({
              success: false,
              error: 'FILE_VALIDATION_ERROR',
              message: result.error,
              code: 'INVALID_FILE',
              fileName: file.originalname,
            });
          }
        }
        
        next();
      } catch (error) {
        console.error('Files validation error:', error);
        res.status(500).json({
          success: false,
          error: 'FILES_VALIDATION_PROCESSING_ERROR',
          message: 'Failed to validate files',
          code: 'FILES_VALIDATION_ERROR',
        });
      }
    };
  };

  /**
   * Conditional validation middleware
   */
  const validateConditional = (condition, schemaName, options = {}) => {
    return async (req, res, next) => {
      try {
        const shouldValidate = typeof condition === 'function' 
          ? condition(req) 
          : condition;
        
        if (!shouldValidate) {
          return next();
        }
        
        return validationService.validate(schemaName, options)(req, res, next);
      } catch (error) {
        console.error('Conditional validation error:', error);
        next(error);
      }
    };
  };

  /**
   * Validate query parameters with sanitization
   */
  const validateQuery = (schemaName, options = {}) => {
    return validationService.validate(schemaName, { ...options, source: 'query' });
  };

  /**
   * Validate route parameters
   */
  const validateParams = (schemaName, options = {}) => {
    return validationService.validate(schemaName, { ...options, source: 'params' });
  };

  /**
   * Validate request headers
   */
  const validateHeaders = (schemaName, options = {}) => {
    return validationService.validate(schemaName, { ...options, source: 'headers' });
  };

  /**
   * Sanitize input middleware (basic sanitization for all requests)
   */
  const sanitizeInput = () => {
    return (req, res, next) => {
      try {
        // Sanitize body
        if (req.body && typeof req.body === 'object') {
          req.body = validationService.sanitizeData(req.body);
        }
        
        // Sanitize query
        if (req.query && typeof req.query === 'object') {
          req.query = validationService.sanitizeData(req.query);
        }
        
        // Sanitize params
        if (req.params && typeof req.params === 'object') {
          req.params = validationService.sanitizeData(req.params);
        }
        
        next();
      } catch (error) {
        console.error('Sanitization error:', error);
        next(error);
      }
    };
  };

  /**
   * Validate and transform response data
   */
  const validateResponse = (schemaName, options = {}) => {
    return async (req, res, next) => {
      const originalSend = res.send;
      
      res.send = function(data) {
        try {
          // Only validate successful responses
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const result = validationService.validateData(schemaName, data, options);
            
            if (!result.valid) {
              console.warn('Response validation failed:', result.errors);
              // Don't fail the request, just log the warning
            } else {
              data = result.data;
            }
          }
          
          return originalSend.call(this, data);
        } catch (error) {
          console.error('Response validation error:', error);
          return originalSend.call(this, data);
        }
      };
      
      next();
    };
  };

  /**
   * Rate limiting for validation errors
   */
  const validationRateLimit = (maxErrors = 10, windowMs = 15 * 60 * 1000) => {
    const errorCounts = new Map();
    
    return (req, res, next) => {
      const key = req.ip;
      const now = Date.now();
      const windowStart = now - windowMs;
      
      // Clean old entries
      for (const [ip, data] of errorCounts.entries()) {
        if (data.timestamp < windowStart) {
          errorCounts.delete(ip);
        }
      }
      
      const userData = errorCounts.get(key) || { count: 0, timestamp: now };
      
      if (userData.count >= maxErrors) {
        return res.status(429).json({
          success: false,
          error: 'VALIDATION_RATE_LIMIT',
          message: 'Too many validation errors. Please try again later.',
          code: 'VALIDATION_RATE_LIMITED',
          retryAfter: Math.ceil((userData.timestamp + windowMs - now) / 1000),
        });
      }
      
      // Attach error counter to request
      req.validationErrorCount = userData.count;
      
      const originalJson = res.json;
      res.json = function(data) {
        if (data && data.error === 'VALIDATION_ERROR') {
          userData.count++;
          userData.timestamp = now;
          errorCounts.set(key, userData);
        }
        return originalJson.call(this, data);
      };
      
      next();
    };
  };

  /**
   * Audit logging for validation failures
   */
  const auditValidation = () => {
    return (req, res, next) => {
      const originalJson = res.json;
      
      res.json = function(data) {
        if (data && data.error === 'VALIDATION_ERROR') {
          // Log validation failure
          logValidationFailure({
            timestamp: new Date().toISOString(),
            userId: req.user?.id,
            ip: req.ip,
            method: req.method,
            path: req.path,
            errors: data.errors,
            userAgent: req.headers['user-agent'],
          }).catch(console.error);
        }
        
        return originalJson.call(this, data);
      };
      
      next();
    };
  };

  return {
    // Core validation
    validate,
    validateQuery,
    validateParams,
    validateHeaders,
    validateFile,
    validateFiles,
    validateConditional,
    validateResponse,
    
    // Sanitization
    sanitizeInput,
    
    // Security
    validationRateLimit,
    auditValidation,
    
    // Service access
    validationService,
  };
};

// Helper function to log validation failures
async function logValidationFailure(entry) {
  // Implement logging to database or external service
  console.log('Validation failure:', entry);
}

// Initialize validation service and middleware
const validationService = new ValidationService();
const validationMiddleware = createValidationMiddleware(validationService);

module.exports = validationMiddleware;
