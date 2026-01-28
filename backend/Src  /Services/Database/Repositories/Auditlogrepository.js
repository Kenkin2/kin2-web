class AuditLogRepository {
  constructor(prisma, redis) {
    this.prisma = prisma;
    this.redis = redis;
    this.CACHE_TTL = 300; // 5 minutes
  }

  // LOG CREATION
  async logEvent(event) {
    const auditLog = await this.prisma.auditLog.create({
      data: {
        userId: event.userId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        changes: event.changes || {},
        metadata: {
          ...event.metadata,
          timestamp: new Date().toISOString(),
          userAgent: event.userAgent,
          ipAddress: event.ipAddress,
          location: event.location,
          sessionId: event.sessionId,
        },
      },
    });

    // Clear relevant caches
    await this.clearAuditLogCaches(event.userId, event.entityType, event.entityId);

    return auditLog;
  }

  async logBulkEvents(events) {
    const logs = await this.prisma.auditLog.createMany({
      data: events.map(event => ({
        userId: event.userId,
        action: event.action,
        entityType: event.entityType,
        entityId: event.entityId,
        changes: event.changes || {},
        metadata: {
          ...event.metadata,
          timestamp: new Date().toISOString(),
          userAgent: event.userAgent,
          ipAddress: event.ipAddress,
          location: event.location,
          sessionId: event.sessionId,
        },
      })),
      skipDuplicates: false,
    });

    return logs;
  }

  // COMMON AUDIT EVENTS
  async logUserLogin(userId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'LOGIN',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        ...metadata,
        eventType: 'AUTHENTICATION',
      },
    });
  }

  async logUserLogout(userId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'LOGOUT',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        ...metadata,
        eventType: 'AUTHENTICATION',
      },
    });
  }

  async logPasswordChange(userId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'PASSWORD_CHANGE',
      entityType: 'USER',
      entityId: userId,
      metadata: {
        ...metadata,
        eventType: 'SECURITY',
      },
    });
  }

  async logProfileUpdate(userId, entityId, changes, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'UPDATE',
      entityType: 'PROFILE',
      entityId,
      changes,
      metadata: {
        ...metadata,
        eventType: 'PROFILE',
      },
    });
  }

  async logJobCreation(userId, jobId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'CREATE',
      entityType: 'JOB',
      entityId: jobId,
      metadata: {
        ...metadata,
        eventType: 'JOB_MANAGEMENT',
      },
    });
  }

  async logJobUpdate(userId, jobId, changes, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'UPDATE',
      entityType: 'JOB',
      entityId: jobId,
      changes,
      metadata: {
        ...metadata,
        eventType: 'JOB_MANAGEMENT',
      },
    });
  }

  async logApplicationSubmission(userId, applicationId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'CREATE',
      entityType: 'APPLICATION',
      entityId: applicationId,
      metadata: {
        ...metadata,
        eventType: 'APPLICATION',
      },
    });
  }

  async logApplicationStatusChange(userId, applicationId, oldStatus, newStatus, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'UPDATE',
      entityType: 'APPLICATION',
      entityId: applicationId,
      changes: {
        status: { from: oldStatus, to: newStatus },
      },
      metadata: {
        ...metadata,
        eventType: 'APPLICATION',
      },
    });
  }

  async logInterviewScheduling(userId, interviewId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'CREATE',
      entityType: 'INTERVIEW',
      entityId: interviewId,
      metadata: {
        ...metadata,
        eventType: 'INTERVIEW',
      },
    });
  }

  async logFileUpload(userId, fileId, entityType, entityId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'UPLOAD',
      entityType,
      entityId,
      metadata: {
        ...metadata,
        eventType: 'FILE',
        fileId,
      },
    });
  }

  async logDataExport(userId, reportId, metadata = {}) {
    return await this.logEvent({
      userId,
      action: 'EXPORT',
      entityType: 'REPORT',
      entityId: reportId,
      metadata: {
        ...metadata,
        eventType: 'DATA_EXPORT',
      },
    });
  }

  async logSystemEvent(action, metadata = {}) {
    return await this.logEvent({
      userId: 'SYSTEM',
      action,
      entityType: 'SYSTEM',
      entityId: 'SYSTEM',
      metadata: {
        ...metadata,
        eventType: 'SYSTEM',
      },
    });
  }

  // LOG RETRIEVAL
  async getAuditLogs(filters = {}) {
    const cacheKey = this.generateAuditLogsCacheKey(filters);
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const where = this.buildAuditLogQuery(filters);

    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              role: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (filters.page - 1) * (filters.limit || 50),
        take: filters.limit || 50,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    const result = {
      logs,
      pagination: {
        page: filters.page || 1,
        limit: filters.limit || 50,
        total,
        pages: Math.ceil(total / (filters.limit || 50)),
      },
      summary: await this.getAuditLogSummary(where),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  buildAuditLogQuery(filters) {
    const where = {};

    if (filters.userId) {
      where.userId = filters.userId;
    }
    if (filters.action) {
      where.action = filters.action;
    }
    if (filters.entityType) {
      where.entityType = filters.entityType;
    }
    if (filters.entityId) {
      where.entityId = filters.entityId;
    }
    if (filters.startDate) {
      where.createdAt = { gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      where.createdAt = { lte: new Date(filters.endDate) };
    }
    if (filters.eventType) {
      where.metadata = {
        path: ['eventType'],
        equals: filters.eventType,
      };
    }
    if (filters.ipAddress) {
      where.metadata = {
        ...where.metadata,
        path: ['ipAddress'],
        equals: filters.ipAddress,
      };
    }

    return where;
  }

  async getAuditLogSummary(where) {
    const summary = await this.prisma.auditLog.groupBy({
      by: ['action', 'entityType'],
      where,
      _count: { id: true },
    });

    const userSummary = await this.prisma.auditLog.groupBy({
      by: ['userId'],
      where,
      _count: { id: true },
      _max: { createdAt: true },
      orderBy: { _count: { id: 'desc' } },
      take: 10,
    });

    const timeSeries = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        COUNT(DISTINCT user_id) as unique_users
      FROM audit_logs
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    return {
      byAction: summary.reduce((acc, stat) => {
        if (!acc[stat.entityType]) acc[stat.entityType] = {};
        acc[stat.entityType][stat.action] = stat._count.id;
        return acc;
      }, {}),
      topUsers: userSummary,
      timeSeries,
    };
  }

  async getEntityAuditTrail(entityType, entityId) {
    const cacheKey = `audit:${entityType}:${entityId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const logs = await this.prisma.auditLog.findMany({
      where: {
        entityType,
        entityId,
      },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Group by date
    const grouped = logs.reduce((acc, log) => {
      const date = new Date(log.createdAt).toDateString();
      if (!acc[date]) acc[date] = [];
      acc[date].push(log);
      return acc;
    }, {});

    const result = {
      entityType,
      entityId,
      totalLogs: logs.length,
      timeline: Object.entries(grouped).map(([date, logs]) => ({
        date,
        logs,
      })),
      changes: this.extractEntityChanges(logs),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  extractEntityChanges(logs) {
    const changes = [];

    logs.forEach(log => {
      if (log.changes && Object.keys(log.changes).length > 0) {
        changes.push({
          timestamp: log.createdAt,
          action: log.action,
          user: log.user,
          changes: log.changes,
        });
      }
    });

    return changes;
  }

  async getUserActivity(userId, filters = {}) {
    const where = { userId };
    
    if (filters.startDate) {
      where.createdAt = { gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      where.createdAt = { lte: new Date(filters.endDate) };
    }
    if (filters.action) {
      where.action = filters.action;
    }
    if (filters.entityType) {
      where.entityType = filters.entityType;
    }

    const [logs, stats] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit || 100,
      }),
      this.prisma.auditLog.groupBy({
        by: ['entityType', 'action'],
        where,
        _count: { id: true },
      }),
    ]);

    // Calculate session activity
    const sessions = await this.extractUserSessions(userId, filters);

    return {
      userId,
      logs,
      stats: stats.reduce((acc, stat) => {
        if (!acc[stat.entityType]) acc[stat.entityType] = {};
        acc[stat.entityType][stat.action] = stat._count.id;
        return acc;
      }, {}),
      sessions,
      recentActivity: logs.slice(0, 20),
    };
  }

  async extractUserSessions(userId, filters) {
    const where = {
      userId,
      action: 'LOGIN',
    };

    if (filters.startDate) {
      where.createdAt = { gte: new Date(filters.startDate) };
    }
    if (filters.endDate) {
      where.createdAt = { lte: new Date(filters.endDate) };
    }

    const logins = await this.prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    const sessions = [];
    let currentSession = null;

    for (const login of logins) {
      // Find corresponding logout
      const logout = await this.prisma.auditLog.findFirst({
        where: {
          userId,
          action: 'LOGOUT',
          createdAt: {
            gt: login.createdAt,
          },
          metadata: {
            path: ['sessionId'],
            equals: login.metadata?.sessionId,
          },
        },
        orderBy: { createdAt: 'asc' },
      });

      const session = {
        loginTime: login.createdAt,
        logoutTime: logout?.createdAt || null,
        duration: logout ? 
          (new Date(logout.createdAt) - new Date(login.createdAt)) / (1000 * 60) : // minutes
          null,
        ipAddress: login.metadata?.ipAddress,
        userAgent: login.metadata?.userAgent,
        activities: await this.getSessionActivities(
          userId,
          login.metadata?.sessionId,
          login.createdAt,
          logout?.createdAt
        ),
      };

      sessions.push(session);
    }

    return sessions;
  }

  async getSessionActivities(userId, sessionId, startTime, endTime) {
    const where = {
      userId,
      createdAt: {
        gte: startTime,
      },
    };

    if (endTime) {
      where.createdAt.lte = endTime;
    }

    if (sessionId) {
      where.metadata = {
        path: ['sessionId'],
        equals: sessionId,
      };
    }

    const activities = await this.prisma.auditLog.groupBy({
      by: ['action', 'entityType'],
      where,
      _count: { id: true },
    });

    return activities.map(act => ({
      action: act.action,
      entityType: act.entityType,
      count: act._count.id,
    }));
  }

  // SECURITY MONITORING
  async detectSuspiciousActivity(filters = {}) {
    const where = this.buildAuditLogQuery(filters);
    
    // Add suspicious activity patterns
    where.OR = [
      { action: 'FAILED_LOGIN' },
      {
        action: 'LOGIN',
        metadata: {
          path: ['location'],
          not: filters.normalLocation, // Login from unusual location
        },
      },
      {
        action: 'PASSWORD_CHANGE',
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000), // Last 24 hours
        },
      },
      {
        action: 'EXPORT',
        entityType: 'REPORT',
        createdAt: {
          gte: new Date(Date.now() - 1 * 60 * 60 * 1000), // Last hour
        },
      },
    ];

    const suspicious = await this.prisma.auditLog.findMany({
      where,
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Analyze patterns
    const analysis = this.analyzeSuspiciousActivity(suspicious);

    return {
      suspiciousActivities: suspicious,
      analysis,
      recommendations: this.generateSecurityRecommendations(analysis),
    };
  }

  analyzeSuspiciousActivity(activities) {
    const analysis = {
      failedLogins: activities.filter(a => a.action === 'FAILED_LOGIN').length,
      unusualLocations: new Set(),
      rapidChanges: 0,
      dataExports: activities.filter(a => a.action === 'EXPORT').length,
      byUser: {},
    };

    const userActivity = {};
    const now = new Date();

    activities.forEach(activity => {
      // Track by user
      if (!userActivity[activity.userId]) {
        userActivity[activity.userId] = {
          count: 0,
          lastActivity: activity.createdAt,
          actions: new Set(),
        };
      }

      userActivity[activity.userId].count++;
      userActivity[activity.userId].actions.add(activity.action);

      // Track unusual locations
      if (activity.metadata?.location) {
        analysis.unusualLocations.add(activity.metadata.location);
      }

      // Check for rapid changes (multiple password changes in short time)
      if (activity.action === 'PASSWORD_CHANGE') {
        const timeSince = (now - new Date(activity.createdAt)) / (1000 * 60 * 60); // hours
        if (timeSince < 1) { // Within last hour
          analysis.rapidChanges++;
        }
      }
    });

    analysis.unusualLocations = Array.from(analysis.unusualLocations);
    analysis.byUser = userActivity;

    return analysis;
  }

  generateSecurityRecommendations(analysis) {
    const recommendations = [];

    if (analysis.failedLogins > 10) {
      recommendations.push({
        type: 'HIGH_FAILED_LOGINS',
        priority: 'HIGH',
        message: `High number of failed login attempts: ${analysis.failedLogins}`,
        actions: [
          'Review login attempts',
          'Consider implementing account lockout',
          'Check for brute force attacks',
        ],
      });
    }

    if (analysis.rapidChanges > 3) {
      recommendations.push({
        type: 'RAPID_PASSWORD_CHANGES',
        priority: 'MEDIUM',
        message: `Multiple password changes detected: ${analysis.rapidChanges}`,
        actions: [
          'Verify user activity',
          'Consider rate limiting password changes',
        ],
      });
    }

    if (analysis.dataExports > 5) {
      recommendations.push({
        type: 'HIGH_DATA_EXPORTS',
        priority: 'MEDIUM',
        message: `High number of data exports: ${analysis.dataExports}`,
        actions: [
          'Review export permissions',
          'Implement export limits',
          'Monitor data access patterns',
        ],
      });
    }

    return recommendations;
  }

  async getSecurityReport(period = '7_DAYS') {
    const startDate = this.getPeriodStartDate(period);

    const [
      authStats,
      accessStats,
      changeStats,
      exportStats,
      suspicious,
    ] = await Promise.all([
      this.getAuthenticationStats(startDate),
      this.getAccessStats(startDate),
      this.getChangeStats(startDate),
      this.getExportStats(startDate),
      this.detectSuspiciousActivity({ startDate }),
    ]);

    return {
      period,
      startDate,
      endDate: new Date(),
      authentication: authStats,
      access: accessStats,
      changes: changeStats,
      exports: exportStats,
      suspiciousActivities: suspicious,
      securityScore: this.calculateSecurityScore(authStats, suspicious),
    };
  }

  async getAuthenticationStats(startDate) {
    const stats = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        createdAt: { gte: startDate },
        metadata: {
          path: ['eventType'],
          equals: 'AUTHENTICATION',
        },
      },
      _count: { id: true },
    });

    const failedLogins = stats.find(s => s.action === 'FAILED_LOGIN')?._count.id || 0;
    const successfulLogins = stats.find(s => s.action === 'LOGIN')?._count.id || 0;
    const totalAttempts = failedLogins + successfulLogins;

    return {
      failedLogins,
      successfulLogins,
      totalAttempts,
      failureRate: totalAttempts > 0 ? failedLogins / totalAttempts : 0,
      uniqueUsers: await this.countUniqueUsers(startDate, 'AUTHENTICATION'),
    };
  }

  async getAccessStats(startDate) {
    const stats = await this.prisma.auditLog.groupBy({
      by: ['entityType', 'action'],
      where: {
        createdAt: { gte: startDate },
        action: { in: ['READ', 'VIEW', 'ACCESS'] },
      },
      _count: { id: true },
    });

    return stats.reduce((acc, stat) => {
      if (!acc[stat.entityType]) acc[stat.entityType] = {};
      acc[stat.entityType][stat.action] = stat._count.id;
      return acc;
    }, {});
  }

  async getChangeStats(startDate) {
    const stats = await this.prisma.auditLog.groupBy({
      by: ['entityType', 'action'],
      where: {
        createdAt: { gte: startDate },
        action: { in: ['CREATE', 'UPDATE', 'DELETE'] },
      },
      _count: { id: true },
    });

    return stats.reduce((acc, stat) => {
      if (!acc[stat.entityType]) acc[stat.entityType] = {};
      acc[stat.entityType][stat.action] = stat._count.id;
      return acc;
    }, {});
  }

  async getExportStats(startDate) {
    const exports = await this.prisma.auditLog.count({
      where: {
        createdAt: { gte: startDate },
        action: 'EXPORT',
        entityType: 'REPORT',
      },
    });

    const users = await this.prisma.auditLog.groupBy({
      by: ['userId'],
      where: {
        createdAt: { gte: startDate },
        action: 'EXPORT',
        entityType: 'REPORT',
      },
      _count: { id: true },
    });

    return {
      totalExports: exports,
      uniqueExporters: users.length,
      topExporters: users.slice(0, 5).map(u => ({
        userId: u.userId,
        count: u._count.id,
      })),
    };
  }

  async countUniqueUsers(startDate, eventType = null) {
    const where = {
      createdAt: { gte: startDate },
    };

    if (eventType) {
      where.metadata = {
        path: ['eventType'],
        equals: eventType,
      };
    }

    const result = await this.prisma.auditLog.groupBy({
      by: ['userId'],
      where,
      _count: { id: true },
    });

    return result.length;
  }

  calculateSecurityScore(authStats, suspicious) {
    let score = 100;

    // Deduct for high failure rate
    if (authStats.failureRate > 0.1) {
      score -= 20;
    } else if (authStats.failureRate > 0.05) {
      score -= 10;
    }

    // Deduct for suspicious activities
    if (suspicious.suspiciousActivities.length > 5) {
      score -= 30;
    } else if (suspicious.suspiciousActivities.length > 2) {
      score -= 15;
    }

    return Math.max(score, 0);
  }

  // DATA RETENTION
  async cleanupOldLogs(days = 365) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const deleted = await this.prisma.auditLog.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        metadata: {
          path: ['retention'],
          not: 'PERMANENT',
        },
      },
    });

    return deleted;
  }

  async archiveLogs(days = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const logsToArchive = await this.prisma.auditLog.findMany({
      where: {
        createdAt: { lt: cutoffDate },
        archived: false,
      },
      take: 10000,
    });

    if (logsToArchive.length === 0) {
      return { archived: 0 };
    }

    // Archive logs (implementation depends on archiving system)
    const archiveResult = await this.archiveToStorage(logsToArchive);

    // Mark as archived
    const logIds = logsToArchive.map(log => log.id);
    await this.prisma.auditLog.updateMany({
      where: { id: { in: logIds } },
      data: { archived: true, archivedAt: new Date() },
    });

    return {
      archived: logsToArchive.length,
      archiveLocation: archiveResult.location,
    };
  }

  async archiveToStorage(logs) {
    // Implement archiving logic
    // This would typically compress and upload to cold storage
    throw new Error('Archive to storage not implemented');
  }

  // CACHE MANAGEMENT
  generateAuditLogsCacheKey(filters) {
    const filterStr = JSON.stringify(filters);
    return `audit_logs:${Buffer.from(filterStr).toString('base64')}`;
  }

  async clearAuditLogCaches(userId, entityType, entityId) {
    const patterns = [
      `audit_logs:*`,
      `audit:${entityType}:${entityId}`,
      `user_activity:${userId}:*`,
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  // HELPER METHODS
  getPeriodStartDate(period) {
    const now = new Date();
    switch (period) {
      case '7_DAYS':
        return new Date(now.setDate(now.getDate() - 7));
      case '30_DAYS':
        return new Date(now.setDate(now.getDate() - 30));
      case '90_DAYS':
        return new Date(now.setDate(now.getDate() - 90));
      case 'YEAR':
        return new Date(now.setFullYear(now.getFullYear() - 1));
      default:
        return new Date(now.setDate(now.getDate() - 30));
    }
  }
}

module.exports = AuditLogRepository;
