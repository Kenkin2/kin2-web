// src/middleware/roles.js
const { JWTService } = require('../../utils/jwt');

class RoleService {
  constructor() {
    // Define role hierarchy and permissions
    this.roles = {
      // System Roles
      superadmin: {
        level: 100,
        inherits: ['admin', 'employer', 'candidate', 'guest'],
        permissions: ['*'],
        description: 'Full system access',
        can: {
          manage: ['users', 'roles', 'permissions', 'system'],
          view: ['*'],
          edit: ['*'],
          delete: ['*'],
          create: ['*'],
        }
      },
      
      admin: {
        level: 90,
        inherits: ['employer', 'candidate', 'guest'],
        permissions: [
          'manage_users',
          'manage_jobs',
          'manage_companies',
          'view_reports',
          'manage_content',
          'manage_payments',
          'view_analytics',
        ],
        description: 'Administrator with broad access',
        can: {
          manage: ['users', 'jobs', 'companies', 'reports'],
          view: ['all_users', 'all_jobs', 'all_applications'],
          edit: ['users', 'jobs', 'companies'],
          delete: ['users', 'jobs', 'applications'],
          create: ['admin_users', 'categories', 'tags'],
        }
      },
      
      // Business Roles
      employer: {
        level: 50,
        inherits: ['candidate', 'guest'],
        permissions: [
          'post_jobs',
          'manage_company_profile',
          'view_applications',
          'manage_interviews',
          'purchase_credits',
          'view_analytics',
          'manage_team',
        ],
        description: 'Employer with hiring capabilities',
        can: {
          manage: ['jobs', 'company', 'applications', 'interviews'],
          view: ['applications', 'candidates', 'analytics'],
          edit: ['jobs', 'company_profile'],
          delete: ['jobs', 'applications'],
          create: ['jobs', 'interviews', 'assessments'],
        },
        subRoles: {
          hiring_manager: {
            permissions: ['view_applications', 'manage_interviews'],
            description: 'Can manage hiring process'
          },
          recruiter: {
            permissions: ['post_jobs', 'view_applications'],
            description: 'Can post jobs and view applications'
          },
          billing_admin: {
            permissions: ['purchase_credits', 'view_billing'],
            description: 'Can manage billing and payments'
          }
        }
      },
      
      // User Roles
      candidate: {
        level: 30,
        inherits: ['guest'],
        permissions: [
          'apply_jobs',
          'manage_profile',
          'view_jobs',
          'upload_resume',
          'track_applications',
          'save_jobs',
          'view_salary_insights',
        ],
        description: 'Job seeker with application capabilities',
        can: {
          manage: ['profile', 'resume', 'applications'],
          view: ['jobs', 'companies', 'salary_data'],
          edit: ['profile', 'resume'],
          delete: ['applications', 'saved_jobs'],
          create: ['applications', 'profile'],
        }
      },
      
      // Special Roles
      moderator: {
        level: 80,
        inherits: ['employer', 'candidate', 'guest'],
        permissions: [
          'review_content',
          'flag_users',
          'manage_reports',
          'view_moderation_queue',
        ],
        description: 'Content moderator',
        can: {
          manage: ['content', 'reports', 'flags'],
          view: ['all_content', 'user_reports'],
          edit: ['content', 'flags'],
          delete: ['content', 'comments'],
          create: ['warnings', 'flags'],
        }
      },
      
      support: {
        level: 70,
        inherits: ['guest'],
        permissions: [
          'view_tickets',
          'respond_tickets',
          'escalate_tickets',
          'view_user_info',
        ],
        description: 'Customer support agent',
        can: {
          manage: ['tickets', 'support_requests'],
          view: ['user_profiles', 'ticket_history'],
          edit: ['tickets', 'responses'],
          delete: ['tickets'],
          create: ['responses', 'ticket_notes'],
        }
      },
      
      // Basic Role
      guest: {
        level: 10,
        inherits: [],
        permissions: [
          'view_public_jobs',
          'view_company_profiles',
          'search_jobs',
          'register',
          'login',
        ],
        description: 'Unauthenticated user with basic access',
        can: {
          view: ['public_jobs', 'company_profiles'],
          create: ['account'],
        }
      },
      
      // Temporary/System Roles
      suspended: {
        level: 0,
        inherits: [],
        permissions: ['login'],
        description: 'Temporarily restricted user',
        can: {
          view: ['own_profile'],
          edit: [],
          delete: [],
          create: [],
        }
      },
      
      banned: {
        level: -10,
        inherits: [],
        permissions: [],
        description: 'Permanently banned user',
        can: {}
      }
    };

    // Define resource types and their operations
    this.resources = {
      user: ['create', 'read', 'update', 'delete', 'manage'],
      job: ['create', 'read', 'update', 'delete', 'apply', 'share'],
      company: ['create', 'read', 'update', 'delete', 'follow'],
      application: ['create', 'read', 'update', 'delete', 'withdraw'],
      resume: ['upload', 'read', 'update', 'delete', 'download'],
      interview: ['schedule', 'read', 'update', 'cancel', 'reschedule'],
      payment: ['create', 'read', 'refund', 'invoice'],
      report: ['generate', 'read', 'export', 'share'],
      content: ['create', 'read', 'update', 'delete', 'moderate'],
      notification: ['create', 'read', 'update', 'delete', 'send'],
      analytics: ['view', 'export', 'share'],
      system: ['configure', 'monitor', 'backup', 'restore'],
    };

    // Initialize JWT service for token validation
    this.jwtService = new JWTService({
      accessTokenSecret: process.env.JWT_ACCESS_SECRET,
    });
  }

  /**
   * Check if user has required role
   */
  hasRole(user, requiredRole) {
    if (!user || !user.role) return false;
    
    // Superadmin has access to everything
    if (user.role === 'superadmin') return true;
    
    // Handle array of required roles
    const requiredRoles = Array.isArray(requiredRole) ? requiredRole : [requiredRole];
    
    return requiredRoles.some(role => {
      // Direct match
      if (user.role === role) return true;
      
      // Check role inheritance
      const userRoleConfig = this.roles[user.role];
      if (userRoleConfig && userRoleConfig.inherits) {
        return userRoleConfig.inherits.includes(role);
      }
      
      return false;
    });
  }

  /**
   * Check if user has at least the required role level
   */
  hasMinRoleLevel(user, minLevel) {
    if (!user || !user.role) return false;
    
    const userRole = this.roles[user.role];
    if (!userRole) return false;
    
    return userRole.level >= minLevel;
  }

  /**
   * Check if user has specific permission
   */
  hasPermission(user, permission) {
    if (!user || !user.role) return false;
    
    // Superadmin has all permissions
    if (user.role === 'superadmin') return true;
    
    const userRole = this.roles[user.role];
    if (!userRole) return false;
    
    // Check direct permissions
    if (userRole.permissions.includes('*') || userRole.permissions.includes(permission)) {
      return true;
    }
    
    // Check inherited roles
    if (userRole.inherits) {
      for (const inheritedRole of userRole.inherits) {
        const inheritedRoleConfig = this.roles[inheritedRole];
        if (inheritedRoleConfig && 
            (inheritedRoleConfig.permissions.includes('*') || 
             inheritedRoleConfig.permissions.includes(permission))) {
          return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check if user can perform action on resource
   */
  can(user, resource, action) {
    if (!user || !user.role) return false;
    
    // Superadmin can do everything
    if (user.role === 'superadmin') return true;
    
    const userRole = this.roles[user.role];
    if (!userRole || !userRole.can) return false;
    
    // Check if action is allowed on resource
    if (userRole.can[action]) {
      if (userRole.can[action].includes('*')) return true;
      if (userRole.can[action].includes(resource)) return true;
      
      // Check for resource categories (e.g., 'own_' prefix)
      if (resource.startsWith('own_')) {
        const baseResource = resource.replace('own_', '');
        return userRole.can[action].includes(baseResource);
      }
    }
    
    // Check inherited roles
    if (userRole.inherits) {
      for (const inheritedRole of userRole.inherits) {
        const inheritedRoleConfig = this.roles[inheritedRole];
        if (inheritedRoleConfig && inheritedRoleConfig.can && inheritedRoleConfig.can[action]) {
          if (inheritedRoleConfig.can[action].includes('*')) return true;
          if (inheritedRoleConfig.can[action].includes(resource)) return true;
        }
      }
    }
    
    return false;
  }

  /**
   * Check resource ownership
   */
  isOwner(user, resource, resourceOwnerId) {
    if (!user || !user.id) return false;
    
    // Convert to string for comparison
    const userId = user.id.toString();
    const ownerId = resourceOwnerId ? resourceOwnerId.toString() : null;
    
    return userId === ownerId;
  }

  /**
   * Check if user can access resource (considering ownership)
   */
  canAccess(user, resource, action, resourceOwnerId = null) {
    // Check general permission
    if (this.can(user, resource, action)) {
      return true;
    }
    
    // Check ownership-based permission
    if (resourceOwnerId && this.isOwner(user, resource, resourceOwnerId)) {
      const ownResource = `own_${resource}`;
      return this.can(user, ownResource, action);
    }
    
    return false;
  }

  /**
   * Get user's effective permissions
   */
  getUserPermissions(user) {
    if (!user || !user.role) return [];
    
    const userRole = this.roles[user.role];
    if (!userRole) return [];
    
    const permissions = new Set(userRole.permissions);
    
    // Add inherited permissions
    if (userRole.inherits) {
      userRole.inherits.forEach(inheritedRole => {
        const inheritedRoleConfig = this.roles[inheritedRole];
        if (inheritedRoleConfig) {
          inheritedRoleConfig.permissions.forEach(permission => {
            permissions.add(permission);
          });
        }
      });
    }
    
    return Array.from(permissions);
  }

  /**
   * Get user's role hierarchy
   */
  getRoleHierarchy(user) {
    if (!user || !user.role) return [];
    
    const userRole = this.roles[user.role];
    if (!userRole) return [];
    
    const hierarchy = [user.role];
    
    if (userRole.inherits) {
      hierarchy.push(...userRole.inherits);
    }
    
    return hierarchy;
  }

  /**
   * Validate user against role requirements
   */
  validateUserRole(user, requirements) {
    const {
      requiredRole = null,
      minRoleLevel = null,
      requiredPermissions = [],
      requiredResource = null,
      requiredAction = null,
      resourceOwnerId = null,
    } = requirements;
    
    const errors = [];
    
    // Check role
    if (requiredRole && !this.hasRole(user, requiredRole)) {
      errors.push(`Required role: ${requiredRole}`);
    }
    
    // Check role level
    if (minRoleLevel !== null && !this.hasMinRoleLevel(user, minRoleLevel)) {
      errors.push(`Minimum role level required: ${minRoleLevel}`);
    }
    
    // Check permissions
    for (const permission of requiredPermissions) {
      if (!this.hasPermission(user, permission)) {
        errors.push(`Missing permission: ${permission}`);
      }
    }
    
    // Check resource access
    if (requiredResource && requiredAction) {
      if (!this.canAccess(user, requiredResource, requiredAction, resourceOwnerId)) {
        errors.push(`Cannot ${requiredAction} ${requiredResource}`);
      }
    }
    
    return {
      valid: errors.length === 0,
      errors,
      userRole: user.role,
      userPermissions: this.getUserPermissions(user),
    };
  }

  /**
   * Get all available roles
   */
  getAllRoles() {
    return Object.keys(this.roles).map(roleName => ({
      name: roleName,
      ...this.roles[roleName]
    }));
  }

  /**
   * Get role details
   */
  getRoleDetails(roleName) {
    const role = this.roles[roleName];
    if (!role) return null;
    
    return {
      name: roleName,
      ...role,
      effectivePermissions: this.getRoleEffectivePermissions(roleName),
    };
  }

  getRoleEffectivePermissions(roleName) {
    const role = this.roles[roleName];
    if (!role) return [];
    
    const permissions = new Set(role.permissions);
    
    if (role.inherits) {
      role.inherits.forEach(inheritedRole => {
        const inheritedRoleConfig = this.roles[inheritedRole];
        if (inheritedRoleConfig) {
          inheritedRoleConfig.permissions.forEach(permission => {
            permissions.add(permission);
          });
        }
      });
    }
    
    return Array.from(permissions);
  }

  /**
   * Check if role can be assigned
   */
  canAssignRole(assignerRole, targetRole) {
    const assigner = this.roles[assignerRole];
    const target = this.roles[targetRole];
    
    if (!assigner || !target) return false;
    
    // Cannot assign roles to/from system roles
    const systemRoles = ['superadmin', 'suspended', 'banned'];
    if (systemRoles.includes(targetRole)) {
      return assignerRole === 'superadmin';
    }
    
    // Can only assign roles of lower level
    return assigner.level > target.level;
  }

  /**
   * Get assignable roles for a given role
   */
  getAssignableRoles(roleName) {
    const role = this.roles[roleName];
    if (!role) return [];
    
    return Object.keys(this.roles).filter(targetRole => {
      return this.canAssignRole(roleName, targetRole);
    });
  }
}

// Create middleware factory
const createRoleMiddleware = (roleService) => {
  /**
   * Role requirement middleware
   */
  const requireRole = (...requiredRoles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      if (!roleService.hasRole(req.user, requiredRoles)) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_ROLE',
          message: `Required role(s): ${requiredRoles.join(', ')}`,
          code: 'ROLE_NOT_AUTHORIZED',
          userRole: req.user.role,
          requiredRoles,
        });
      }
      
      next();
    };
  };

  /**
   * Minimum role level middleware
   */
  const requireMinRoleLevel = (minLevel) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      if (!roleService.hasMinRoleLevel(req.user, minLevel)) {
        return res.status(403).json({
          success: false,
          error: 'INSUFFICIENT_ROLE_LEVEL',
          message: `Minimum role level required: ${minLevel}`,
          code: 'ROLE_LEVEL_INSUFFICIENT',
          userRole: req.user.role,
          userLevel: roleService.roles[req.user.role]?.level,
          requiredLevel: minLevel,
        });
      }
      
      next();
    };
  };

  /**
   * Permission requirement middleware
   */
  const requirePermission = (...requiredPermissions) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      for (const permission of requiredPermissions) {
        if (!roleService.hasPermission(req.user, permission)) {
          return res.status(403).json({
            success: false,
            error: 'INSUFFICIENT_PERMISSIONS',
            message: `Required permission: ${permission}`,
            code: 'PERMISSION_DENIED',
            userPermissions: roleService.getUserPermissions(req.user),
            requiredPermission: permission,
          });
        }
      }
      
      next();
    };
  };

  /**
   * Resource access middleware
   */
  const canAccessResource = (resource, action, ownerIdPath = null) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      // Extract owner ID if path is provided
      let resourceOwnerId = null;
      if (ownerIdPath) {
        const paths = ownerIdPath.split('.');
        let value = req;
        for (const path of paths) {
          value = value[path];
          if (value === undefined) break;
        }
        resourceOwnerId = value;
      }
      
      if (!roleService.canAccess(req.user, resource, action, resourceOwnerId)) {
        return res.status(403).json({
          success: false,
          error: 'ACCESS_DENIED',
          message: `Cannot ${action} ${resource}`,
          code: 'RESOURCE_ACCESS_DENIED',
          userRole: req.user.role,
          resource,
          action,
          resourceOwnerId,
        });
      }
      
      next();
    };
  };

  /**
   * Ownership or role middleware
   */
  const isOwnerOrHasRole = (ownerIdPath, ...allowedRoles) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      // Check if user has required role
      if (roleService.hasRole(req.user, allowedRoles)) {
        return next();
      }
      
      // Check ownership
      const paths = ownerIdPath.split('.');
      let ownerId = req;
      for (const path of paths) {
        ownerId = ownerId[path];
        if (ownerId === undefined) break;
      }
      
      if (!ownerId) {
        return res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Owner ID not found in request',
          code: 'OWNER_ID_MISSING',
        });
      }
      
      if (roleService.isOwner(req.user, 'user', ownerId)) {
        return next();
      }
      
      return res.status(403).json({
        success: false,
        error: 'ACCESS_DENIED',
        message: 'You are not the owner of this resource',
        code: 'NOT_OWNER_OR_AUTHORIZED',
        userId: req.user.id,
        resourceOwnerId: ownerId,
        allowedRoles,
      });
    };
  };

  /**
   * Dynamic permission check middleware
   */
  const checkPermission = (permissionResolver) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      const permission = typeof permissionResolver === 'function' 
        ? permissionResolver(req) 
        : permissionResolver;
      
      if (!roleService.hasPermission(req.user, permission)) {
        return res.status(403).json({
          success: false,
          error: 'PERMISSION_DENIED',
          message: `Permission denied: ${permission}`,
          code: 'PERMISSION_DENIED',
        });
      }
      
      next();
    };
  };

  /**
   * Role assignment validation middleware
   */
  const validateRoleAssignment = (targetRolePath = 'body.role') => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      // Extract target role from request
      const paths = targetRolePath.split('.');
      let targetRole = req;
      for (const path of paths) {
        targetRole = targetRole[path];
        if (targetRole === undefined) break;
      }
      
      if (!targetRole) {
        return res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Target role not specified',
          code: 'TARGET_ROLE_MISSING',
        });
      }
      
      // Check if user can assign this role
      if (!roleService.canAssignRole(req.user.role, targetRole)) {
        return res.status(403).json({
          success: false,
          error: 'CANNOT_ASSIGN_ROLE',
          message: `You cannot assign the role: ${targetRole}`,
          code: 'ROLE_ASSIGNMENT_DENIED',
          userRole: req.user.role,
          targetRole,
          assignableRoles: roleService.getAssignableRoles(req.user.role),
        });
      }
      
      next();
    };
  };

  /**
   * Role hierarchy validation middleware
   */
  const validateRoleHierarchy = (userRolePath, targetRolePath) => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      // Extract roles from request
      const userRole = getValueFromPath(req, userRolePath);
      const targetRole = getValueFromPath(req, targetRolePath);
      
      if (!userRole || !targetRole) {
        return res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: 'User role or target role not found',
          code: 'ROLES_MISSING',
        });
      }
      
      const userRoleConfig = roleService.roles[userRole];
      const targetRoleConfig = roleService.roles[targetRole];
      
      if (!userRoleConfig || !targetRoleConfig) {
        return res.status(400).json({
          success: false,
          error: 'INVALID_ROLE',
          message: 'Invalid role specified',
          code: 'INVALID_ROLE',
        });
      }
      
      // Check hierarchy (user must have higher level than target)
      if (userRoleConfig.level <= targetRoleConfig.level) {
        return res.status(403).json({
          success: false,
          error: 'HIERARCHY_VIOLATION',
          message: 'Cannot modify user with equal or higher role level',
          code: 'ROLE_HIERARCHY_VIOLATION',
          userRoleLevel: userRoleConfig.level,
          targetRoleLevel: targetRoleConfig.level,
        });
      }
      
      next();
    };
  };

  /**
   * Multi-tenancy middleware (for company-based access control)
   */
  const requireCompanyAccess = (companyIdPath = 'params.companyId') => {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      const paths = companyIdPath.split('.');
      let companyId = req;
      for (const path of paths) {
        companyId = companyId[path];
        if (companyId === undefined) break;
      }
      
      if (!companyId) {
        return res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Company ID not found in request',
          code: 'COMPANY_ID_MISSING',
        });
      }
      
      // Check if user has access to this company
      const hasAccess = await checkCompanyAccess(req.user.id, companyId, req.user.role);
      
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          error: 'COMPANY_ACCESS_DENIED',
          message: 'You do not have access to this company',
          code: 'NO_COMPANY_ACCESS',
          userId: req.user.id,
          companyId,
          userRole: req.user.role,
        });
      }
      
      // Attach company ID to request
      req.companyId = companyId;
      next();
    };
  };

  /**
   * Team-based access control middleware
   */
  const requireTeamMember = (teamIdPath = 'params.teamId') => {
    return async (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      const paths = teamIdPath.split('.');
      let teamId = req;
      for (const path of paths) {
        teamId = teamId[path];
        if (teamId === undefined) break;
      }
      
      if (!teamId) {
        return res.status(400).json({
          success: false,
          error: 'BAD_REQUEST',
          message: 'Team ID not found in request',
          code: 'TEAM_ID_MISSING',
        });
      }
      
      // Check if user is a member of this team
      const isMember = await checkTeamMembership(req.user.id, teamId);
      
      if (!isMember) {
        return res.status(403).json({
          success: false,
          error: 'TEAM_ACCESS_DENIED',
          message: 'You are not a member of this team',
          code: 'NOT_TEAM_MEMBER',
          userId: req.user.id,
          teamId,
        });
      }
      
      req.teamId = teamId;
      next();
    };
  };

  /**
   * Scoped resource middleware (limits resource access based on role)
   */
  const scopeResources = (resourceType, scope = 'own') => {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication required',
          code: 'AUTH_REQUIRED',
        });
      }
      
      // Add scoping to request
      req.scope = {
        resourceType,
        scope,
        userRole: req.user.role,
        userId: req.user.id,
      };
      
      // Add query modifiers based on scope
      if (req.queryBuilder) {
        switch (scope) {
          case 'own':
            req.queryBuilder.where({ userId: req.user.id });
            break;
          case 'company':
            if (req.user.companyId) {
              req.queryBuilder.where({ companyId: req.user.companyId });
            }
            break;
          case 'team':
            // Team scoping would require additional logic
            break;
          case 'all':
            // No restrictions for admin/superadmin
            if (!['admin', 'superadmin'].includes(req.user.role)) {
              return res.status(403).json({
                success: false,
                error: 'SCOPE_VIOLATION',
                message: 'You cannot access all resources',
                code: 'SCOPE_NOT_ALLOWED',
              });
            }
            break;
        }
      }
      
      next();
    };
  };

  /**
   * Audit logging for role-based actions
   */
  const auditRoleAction = (action, resourceType, resourceIdPath = 'params.id') => {
    return async (req, res, next) => {
      const originalSend = res.send;
      
      res.send = function(data) {
        if (res.statusCode < 400) {
          // Log successful role-based action
          const resourceId = getValueFromPath(req, resourceIdPath);
          
          logRoleAction({
            userId: req.user?.id,
            userRole: req.user?.role,
            action,
            resourceType,
            resourceId,
            ip: req.ip,
            userAgent: req.headers['user-agent'],
            timestamp: new Date(),
            metadata: {
              method: req.method,
              path: req.path,
              params: req.params,
              query: req.query,
            },
          }).catch(console.error);
        }
        
        return originalSend.call(this, data);
      };
      
      next();
    };
  };

  /**
   * Rate limiting based on role
   */
  const roleBasedRateLimit = (limits = {}) => {
    return (req, res, next) => {
      if (!req.user) {
        // Apply default limit for unauthenticated users
        const defaultLimit = limits.guest || limits.default || { windowMs: 900000, max: 100 };
        return applyRateLimit(req, res, next, defaultLimit);
      }
      
      const userRole = req.user.role;
      const roleLimit = limits[userRole] || limits.default || { windowMs: 900000, max: 1000 };
      
      return applyRateLimit(req, res, next, roleLimit);
    };
  };

  // Helper function to get value from path
  const getValueFromPath = (obj, path) => {
    const paths = path.split('.');
    let value = obj;
    for (const p of paths) {
      value = value[p];
      if (value === undefined) break;
    }
    return value;
  };

  // Helper function to apply rate limit
  const applyRateLimit = (req, res, next, limit) => {
    const { windowMs = 900000, max = 100 } = limit;
    // Implement rate limiting logic here
    // This would typically use a rate limiting library
    next();
  };

  return {
    // Core role checks
    requireRole,
    requireMinRoleLevel,
    requirePermission,
    canAccessResource,
    isOwnerOrHasRole,
    
    // Advanced checks
    checkPermission,
    validateRoleAssignment,
    validateRoleHierarchy,
    
    // Multi-tenancy
    requireCompanyAccess,
    requireTeamMember,
    scopeResources,
    
    // Monitoring
    auditRoleAction,
    roleBasedRateLimit,
    
    // Service access
    roleService,
  };
};

// Database helper functions (to be implemented)
async function checkCompanyAccess(userId, companyId, userRole) {
  // Implement company access check
  // This would check if user is associated with the company
  return true; // Mock implementation
}

async function checkTeamMembership(userId, teamId) {
  // Implement team membership check
  return true; // Mock implementation
}

async function logRoleAction(logEntry) {
  // Implement audit logging
  console.log('Role action:', logEntry);
}

// Initialize role service and middleware
const roleService = new RoleService();
const roleMiddleware = createRoleMiddleware(roleService);

module.exports = roleMiddleware;
