const { validationResult } = require('express-validator');

const validate = (validations) => {
  return async (req, res, next) => {
    // Run all validations
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    // Format errors
    const formattedErrors = errors.array().map(error => ({
      field: error.path,
      message: error.msg,
      value: error.value
    }));

    res.status(400).json({
      error: 'Validation failed',
      details: formattedErrors
    });
  };
};

const sanitizeInput = (req, res, next) => {
  // Recursively sanitize all string fields in body, params, and query
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      // Basic sanitization - remove script tags and trim
      return obj
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        .trim();
    }
    
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    
    if (typeof obj === 'object' && obj !== null) {
      const sanitized = {};
      for (const key in obj) {
        sanitized[key] = sanitize(obj[key]);
      }
      return sanitized;
    }
    
    return obj;
  };

  if (req.body) req.body = sanitize(req.body);
  if (req.params) req.params = sanitize(req.params);
  if (req.query) req.query = sanitize(req.query);

  next();
};

const validateObjectId = (paramName) => {
  return (req, res, next) => {
    const id = req.params[paramName];
    
    // Check if it looks like a Prisma CUID or UUID
    const isValidId = /^[a-z0-9]+$/.test(id) && id.length >= 20;
    
    if (!isValidId) {
      return res.status(400).json({
        error: 'Invalid ID format',
        field: paramName,
        value: id
      });
    }
    
    next();
  };
};

const validatePagination = (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 20;
  
  if (page < 1) {
    return res.status(400).json({ error: 'Page must be greater than 0' });
  }
  
  if (limit < 1 || limit > 100) {
    return res.status(400).json({ error: 'Limit must be between 1 and 100' });
  }
  
  req.pagination = { page, limit, skip: (page - 1) * limit };
  next();
};

module.exports = {
  validate,
  sanitizeInput,
  validateObjectId,
  validatePagination
};
