const validator = require('validator');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const validators = {
  // Email validation
  isEmail: (email) => {
    return validator.isEmail(email) && email.length <= 255;
  },

  // Password validation
  isStrongPassword: (password) => {
    return validator.isStrongPassword(password, {
      minLength: 8,
      minLowercase: 1,
      minUppercase: 1,
      minNumbers: 1,
      minSymbols: 1
    });
  },

  // Phone validation (basic)
  isPhone: (phone) => {
    if (!phone) return true; // Optional
    return validator.isMobilePhone(phone, 'any', { strictMode: false });
  },

  // URL validation
  isURL: (url) => {
    if (!url) return true; // Optional
    return validator.isURL(url, {
      protocols: ['http', 'https'],
      require_protocol: true,
      require_valid_protocol: true
    });
  },

  // Date validation
  isDate: (date) => {
    return validator.isISO8601(date) || validator.isDate(date);
  },

  // JSON validation
  isJSON: (json) => {
    try {
      JSON.parse(json);
      return true;
    } catch {
      return false;
    }
  },

  // Array validation
  isArray: (arr, itemValidator = null) => {
    if (!Array.isArray(arr)) return false;
    
    if (itemValidator) {
      return arr.every(item => itemValidator(item));
    }
    
    return true;
  },

  // Object validation
  isObject: (obj, schema = null) => {
    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      return false;
    }
    
    if (schema) {
      return Object.entries(schema).every(([key, validatorFn]) => {
        return obj.hasOwnProperty(key) && validatorFn(obj[key]);
      });
    }
    
    return true;
  },

  // Skill validation
  isSkill: async (skillId) => {
    const skill = await prisma.skill.findUnique({
      where: { id: skillId }
    });
    return !!skill;
  },

  // Category validation
  isCategory: async (categoryId) => {
    const category = await prisma.category.findUnique({
      where: { id: categoryId }
    });
    return !!category;
  },

  // Industry validation
  isIndustry: async (industryId) => {
    const industry = await prisma.industry.findUnique({
      where: { id: industryId }
    });
    return !!industry;
  },

  // Job validation
  isJob: async (jobId, employerId = null) => {
    const where = { id: jobId };
    if (employerId) {
      where.employerId = employerId;
    }
    
    const job = await prisma.job.findUnique({ where });
    return !!job;
  },

  // User validation
  isUser: async (userId, role = null) => {
    const where = { id: userId };
    if (role) {
      where.role = role;
    }
    
    const user = await prisma.user.findUnique({ where });
    return !!user;
  },

  // Application validation
  isApplication: async (applicationId, userId = null) => {
    const where = { id: applicationId };
    if (userId) {
      where.OR = [
        { applicantId: userId },
        { job: { employerId: userId } }
      ];
    }
    
    const application = await prisma.application.findFirst({ where });
    return !!application;
  },

  // File validation
  isFileType: (file, allowedTypes) => {
    if (!file || !file.mimetype) return false;
    return allowedTypes.includes(file.mimetype);
  },

  isFileSize: (file, maxSizeMB) => {
    if (!file || !file.size) return false;
    return file.size <= maxSizeMB * 1024 * 1024;
  },

  // Location validation
  isLocation: (location) => {
    if (!location) return false;
    return location.length >= 2 && location.length <= 100;
  },

  // Salary validation
  isSalaryRange: (min, max) => {
    if (min && max) {
      return min <= max;
    }
    return true;
  },

  // Experience validation
  isExperienceRange: (years) => {
    if (years === undefined || years === null) return true;
    return Number.isInteger(years) && years >= 0 && years <= 50;
  },

  // Availability validation
  isAvailability: (availability) => {
    const validValues = ['AVAILABLE', 'UNAVAILABLE', 'SOON'];
    return validValues.includes(availability);
  },

  // Employment type validation
  isEmploymentType: (type) => {
    const validTypes = [
      'FULL_TIME',
      'PART_TIME',
      'CONTRACT',
      'TEMPORARY',
      'INTERNSHIP',
      'VOLUNTEER'
    ];
    return validTypes.includes(type);
  },

  // Experience level validation
  isExperienceLevel: (level) => {
    const validLevels = [
      'ENTRY',
      'JUNIOR',
      'MID',
      'SENIOR',
      'LEAD',
      'EXECUTIVE'
    ];
    return validLevels.includes(level);
  },

  // Remote preference validation
  isRemotePreference: (preference) => {
    const validPreferences = ['ONSITE', 'REMOTE', 'HYBRID'];
    return validPreferences.includes(preference);
  },

  // Currency validation
  isCurrency: (currency) => {
    const validCurrencies = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD'];
    return validCurrencies.includes(currency);
  },

  // Language validation
  isLanguage: (language) => {
    const validLanguages = ['en', 'es', 'fr', 'de', 'ja', 'zh'];
    return validLanguages.includes(language);
  },

  // Timezone validation
  isTimezone: (timezone) => {
    // Simple timezone validation (could be enhanced)
    return timezone && timezone.length >= 3 && timezone.includes('/');
  },

  // KFN score validation
  isKFNScore: (score) => {
    return score >= 0 && score <= 100;
  },

  // Rating validation (1-5)
  isRating: (rating) => {
    return rating >= 1 && rating <= 5;
  },

  // Percentage validation (0-100)
  isPercentage: (percentage) => {
    return percentage >= 0 && percentage <= 100;
  },

  // Boolean validation
  isBoolean: (value) => {
    return typeof value === 'boolean';
  },

  // Integer validation
  isInteger: (value, min = null, max = null) => {
    if (!Number.isInteger(value)) return false;
    if (min !== null && value < min) return false;
    if (max !== null && value > max) return false;
    return true;
  },

  // Float validation
  isFloat: (value, min = null, max = null) => {
    if (typeof value !== 'number' || isNaN(value)) return false;
    if (min !== null && value < min) return false;
    if (max !== null && value > max) return false;
    return true;
  },

  // String validation with length constraints
  isString: (value, minLength = 0, maxLength = 255) => {
    if (typeof value !== 'string') return false;
    if (value.length < minLength) return false;
    if (value.length > maxLength) return false;
    return true;
  },

  // Array length validation
  isArrayLength: (array, minLength = 0, maxLength = null) => {
    if (!Array.isArray(array)) return false;
    if (array.length < minLength) return false;
    if (maxLength !== null && array.length > maxLength) return false;
    return true;
  },

  // Object keys validation
  hasKeys: (obj, requiredKeys = [], optionalKeys = []) => {
    if (typeof obj !== 'object' || obj === null) return false;
    
    const objKeys = Object.keys(obj);
    const allAllowedKeys = [...requiredKeys, ...optionalKeys];
    
    // Check for required keys
    if (!requiredKeys.every(key => objKeys.includes(key))) {
      return false;
    }
    
    // Check for invalid keys
    if (!objKeys.every(key => allAllowedKeys.includes(key))) {
      return false;
    }
    
    return true;
  },

  // Hex color validation
  isHexColor: (color) => {
    return /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color);
  },

  // Base64 validation
  isBase64: (str) => {
    if (str === '' || str.trim() === '') return false;
    try {
      return btoa(atob(str)) === str;
    } catch (err) {
      return false;
    }
  },

  // UUID validation
  isUUID: (uuid) => {
    return validator.isUUID(uuid);
  },

  // MongoDB ID validation
  isMongoId: (id) => {
    return validator.isMongoId(id);
  },

  // CUID validation (Prisma)
  isCUID: (cuid) => {
    return /^c[a-z0-9]+$/.test(cuid) && cuid.length === 25;
  },

  // Social media URL validation
  isSocialUrl: (url, platform) => {
    if (!url) return true;
    
    const patterns = {
      linkedin: /^https?:\/\/(www\.)?linkedin\.com\/.+/,
      twitter: /^https?:\/\/(www\.)?twitter\.com\/.+/,
      github: /^https?:\/\/(www\.)?github\.com\/.+/,
      facebook: /^https?:\/\/(www\.)?facebook\.com\/.+/
    };
    
    const pattern = patterns[platform];
    if (!pattern) return validator.isURL(url);
    
    return pattern.test(url);
  },

  // Resume file validation
  isResumeFile: (file) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ];
    
    const maxSizeMB = 5;
    
    return this.isFileType(file, allowedTypes) && 
           this.isFileSize(file, maxSizeMB);
  },

  // Image file validation
  isImageFile: (file) => {
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/svg+xml'
    ];
    
    const maxSizeMB = 2;
    
    return this.isFileType(file, allowedTypes) && 
           this.isFileSize(file, maxSizeMB);
  },

  // Video file validation
  isVideoFile: (file) => {
    const allowedTypes = [
      'video/mp4',
      'video/webm',
      'video/ogg'
    ];
    
    const maxSizeMB = 50;
    
    return this.isFileType(file, allowedTypes) && 
           this.isFileSize(file, maxSizeMB);
  },

  // Document file validation
  isDocumentFile: (file) => {
    const allowedTypes = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'text/plain',
      'application/rtf'
    ];
    
    const maxSizeMB = 10;
    
    return this.isFileType(file, allowedTypes) && 
           this.isFileSize(file, maxSizeMB);
  },

  // Validate all fields in an object
  validateObject: (obj, validations) => {
    const errors = {};
    
    for (const [field, validation] of Object.entries(validations)) {
      const value = obj[field];
      
      if (validation.required && (value === undefined || value === null || value === '')) {
        errors[field] = `${field} is required`;
        continue;
      }
      
      if (value !== undefined && value !== null && value !== '') {
        if (validation.validator && !validation.validator(value)) {
          errors[field] = validation.message || `Invalid ${field}`;
        }
        
        if (validation.minLength && value.length < validation.minLength) {
          errors[field] = `${field} must be at least ${validation.minLength} characters`;
        }
        
        if (validation.maxLength && value.length > validation.maxLength) {
          errors[field] = `${field} must be at most ${validation.maxLength} characters`;
        }
        
        if (validation.min !== undefined && value < validation.min) {
          errors[field] = `${field} must be at least ${validation.min}`;
        }
        
        if (validation.max !== undefined && value > validation.max) {
          errors[field] = `${field} must be at most ${validation.max}`;
        }
        
        if (validation.pattern && !validation.pattern.test(value)) {
          errors[field] = validation.message || `Invalid ${field} format`;
        }
      }
    }
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors
    };
  },

  // Sanitize input
  sanitize: {
    string: (str) => {
      if (typeof str !== 'string') return str;
      return str
        .replace(/[<>]/g, '') // Remove < and >
        .trim();
    },
    
    html: (html) => {
      if (typeof html !== 'string') return html;
      // Basic HTML sanitization
      return html
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .replace(/javascript:/gi, '')
        .replace(/on\w+\s*=/gi, '');
    },
    
    url: (url) => {
      if (typeof url !== 'string') return url;
      return validator.escape(url).trim();
    },
    
    email: (email) => {
      if (typeof email !== 'string') return email;
      return validator.normalizeEmail(email, {
        gmail_remove_dots: false,
        gmail_remove_subaddress: false,
        outlookdotcom_remove_subaddress: false,
        yahoo_remove_subaddress: false,
        icloud_remove_subaddress: false
      });
    }
  },

  // Generate validation schema for common models
  schemas: {
    user: {
      email: {
        required: true,
        validator: (v) => validators.isEmail(v),
        message: 'Invalid email address'
      },
      password: {
        required: true,
        validator: (v) => validators.isStrongPassword(v),
        message: 'Password must be at least 8 characters with uppercase, lowercase, number, and symbol'
      },
      firstName: {
        required: true,
        minLength: 1,
        maxLength: 50
      },
      lastName: {
        required: true,
        minLength: 1,
        maxLength: 50
      },
      phone: {
        required: false,
        validator: (v) => validators.isPhone(v),
        message: 'Invalid phone number'
      }
    },
    
    job: {
      title: {
        required: true,
        minLength: 3,
        maxLength: 200
      },
      description: {
        required: true,
        minLength: 10,
        maxLength: 5000
      },
      requirements: {
        required: true,
        minLength: 10,
        maxLength: 2000
      },
      location: {
        required: true,
        validator: (v) => validators.isLocation(v),
        message: 'Invalid location'
      },
      employmentType: {
        required: true,
        validator: (v) => validators.isEmploymentType(v),
        message: 'Invalid employment type'
      }
    },
    
    application: {
      coverLetter: {
        required: false,
        maxLength: 2000
      }
    }
  }
};

module.exports = validators;
