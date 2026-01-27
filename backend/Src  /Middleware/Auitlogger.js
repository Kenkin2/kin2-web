/**
 * Audit logging middleware for tracking user actions
 */

const { PrismaClient } = require('@prisma/client');
const { securityLogger } = require('../utils/logger');

const prisma = new PrismaClient();

// Actions that should be audited
const AUDITED_ACTIONS = [
  'USER_CREATE',
  'USER_UPDATE',
  'USER_DELETE',
  'USER_LOGIN',
  'USER_LOGOUT',
  'USER_PASSWORD_CHANGE',
  'JOB_CREATE',
  'JOB_UPDATE',
  'JOB_DELETE',
  'APPLICATION_CREATE',
  'APPLICATION_UPDATE',
  'PAYMENT_CREATE',
  'PAYMENT_REFUND',
  'ADMIN_ACTION',
  'SETTINGS_UPDATE',
  'API_KEY_CREATE',
  'API_KEY_DELETE'
];

// Actions that should be logged to security log
const SECURITY_ACTIONS = [
  'USER_LOGIN_FAILED',
  'USER_PASSWORD_RESET',
  'USER_SUSPENDED',
  'USER_BANNED',
  'RATE_LIMIT_EXCEEDED',
  'UNAUTHORIZED_ACCESS',
  'API_KEY_CREATE',
  'API_KEY_DELETE'
];

/**
 * Audit logging middleware
 */
const auditLogger = async (req, res, next) => {
  const originalSend = res.send;
  
  // Store response data
  let responseBody;
  res.send = function(body) {
    responseBody = body;
    return originalSend.call(this, body);
  };

  // Log after response is sent
  res.on('finish', async () => {
    try {
      const userId = req.user?.id;
      const action = getActionFromRequest(req);
      
      if (!action || (!AUDITED_ACTIONS.includes(action) && !SECURITY_ACTIONS.includes(action))) {
        return;
      }

      const auditData = {
        userId,
        action,
        entityType: getEntityTypeFromRequest(req),
        entityId: getEntityIdFromRequest(req),
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        method: req.method,
        url: req.originalUrl,
        statusCode: res.statusCode,
        requestBody: shouldLogRequestBody(action) ? req.body : undefined,
        responseBody: shouldLogResponseBody(action) ? responseBody : undefined,
        changes: getChangesFromRequest(req),
        metadata: {
          userRole: req.user?.role,
          userAgent: req.get('user-agent'),
          referrer: req.get('referer')
        }
      };

      // Log to database
      if (AUDITED_ACTIONS.includes(action)) {
        await prisma.activityLog.create({
          data: auditData
        });
      }

      // Log to security log for security-sensitive actions
      if (SECURITY_ACTIONS.includes(action)) {
        securityLogger.warn('Security audit', auditData);
      }

      // Log to console in development
      if (process.env.NODE_ENV === 'development') {
        console.log(`🔍 Audit: ${action} by ${userId || 'anonymous'} - ${req.method} ${req.url} - ${res.statusCode}`);
      }
    } catch (error) {
      // Don't let audit logging break the request
      console.error('Audit logging failed:', error.message);
    }
  });

  next();
};

/**
 * Determine action from request
 */
function getActionFromRequest(req) {
  const { method, originalUrl, user } = req;
  
  // Auth actions
  if (originalUrl.includes('/auth/login')) {
    return res.statusCode === 200 ? 'USER_LOGIN' : 'USER_LOGIN_FAILED';
  }
  
  if (originalUrl.includes('/auth/logout')) {
    return 'USER_LOGOUT';
  }
  
  if (originalUrl.includes('/auth/password')) {
    return 'USER_PASSWORD_CHANGE';
  }
  
  // User actions
  if (originalUrl.includes('/users')) {
    if (method === 'POST') return 'USER_CREATE';
    if (method === 'PUT' || method === 'PATCH') return 'USER_UPDATE';
    if (method === 'DELETE') return 'USER_DELETE';
  }
  
  // Job actions
  if (originalUrl.includes('/jobs')) {
    if (method === 'POST') return 'JOB_CREATE';
    if (method === 'PUT' || method === 'PATCH') return 'JOB_UPDATE';
    if (method === 'DELETE') return 'JOB_DELETE';
  }
  
  // Application actions
  if (originalUrl.includes('/applications')) {
    if (method === 'POST') return 'APPLICATION_CREATE';
    if (method === 'PUT' || method === 'PATCH') return 'APPLICATION_UPDATE';
  }
  
  // Payment actions
  if (originalUrl.includes('/payments')) {
    if (method === 'POST') return 'PAYMENT_CREATE';
    if (originalUrl.includes('/refund')) return 'PAYMENT_REFUND';
  }
  
  // Admin actions
  if (originalUrl.includes('/admin')) {
    return 'ADMIN_ACTION';
  }
  
  // API key actions
  if (originalUrl.includes('/api-keys')) {
    if (method === 'POST') return 'API_KEY_CREATE';
    if (method === 'DELETE') return 'API_KEY_DELETE';
  }
  
  return null;
}

/**
 * Get entity type from request
 */
function getEntityTypeFromRequest(req) {
  const { originalUrl } = req;
  
  if (originalUrl.includes('/users')) return 'USER';
  if (originalUrl.includes('/jobs')) return 'JOB';
  if (originalUrl.includes('/applications')) return 'APPLICATION';
  if (originalUrl.includes('/payments')) return 'PAYMENT';
  if (originalUrl.includes('/api-keys')) return 'API_KEY';
  
  return 'SYSTEM';
}

/**
 * Get entity ID from request
 */
function getEntityIdFromRequest(req) {
  return req.params?.id || req.body?.id || null;
}

/**
 * Check if request body should be logged
 */
function shouldLogRequestBody(action) {
  const sensitiveActions = [
    'USER_CREATE',
    'USER_UPDATE',
    'USER_PASSWORD_CHANGE',
    'PAYMENT_CREATE',
    'API_KEY_CREATE'
  ];
  
  return !sensitiveActions.includes(action);
}

/**
 * Check if response body should be logged
 */
function shouldLogResponseBody(action) {
  const sensitiveActions = [
    'USER_LOGIN',
    'PAYMENT_CREATE',
    'API_KEY_CREATE'
  ];
  
  return !sensitiveActions.includes(action);
}

/**
 * Get changes from request (for update actions)
 */
function getChangesFromRequest(req) {
  if (!req.originalData) return null;
  
  const changes = {};
  const oldData = req.originalData;
  const newData = req.body;
  
  for (const key in newData) {
    if (oldData[key] !== newData[key]) {
      changes[key] = {
        old: oldData[key],
        new: newData[key]
      };
    }
  }
  
  return Object.keys(changes).length > 0 ? changes : null;
}

/**
 * Middleware to store original data for update operations
 */
const storeOriginalData = (model, idField = 'id') => {
  return async (req, res, next) => {
    try {
      const id = req.params[idField];
      if (id && (req.method === 'PUT' || req.method === 'PATCH')) {
        const record = await prisma[model].findUnique({
          where: { id }
        });
        if (record) {
          req.originalData = record;
        }
      }
      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  auditLogger,
  storeOriginalData
};
