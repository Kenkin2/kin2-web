class EmployerRepository {
  constructor(prisma, redis, es, storageService) {
    this.prisma = prisma;
    this.redis = redis;
    this.es = es;
    this.storageService = storageService;
    this.CACHE_TTL = 3600; // 1 hour
  }

  // EMPLOYER PROFILE MANAGEMENT
  async createEmployer(data, userId) {
    // Check if user already has an employer profile
    const existing = await this.prisma.employer.findFirst({
      where: { userId },
    });

    if (existing) {
      throw new Error('User already has an employer profile');
    }

    const employer = await this.prisma.employer.create({
      data: {
        userId,
        name: data.name,
        description: data.description,
        website: data.website,
        logo: data.logo,
        industry: data.industry,
        size: data.size,
        founded: data.founded,
        headquarters: data.headquarters,
        contactEmail: data.contactEmail,
        contactPhone: data.contactPhone,
        socialLinks: data.socialLinks,
        metadata: {
          createdBy: userId,
          createdAt: new Date().toISOString(),
          verificationStatus: 'PENDING',
          subscription: {
            tier: 'FREE',
            startedAt: new Date().toISOString(),
          },
        },
        settings: {
          emailNotifications: true,
          pushNotifications: true,
          autoScreening: false,
          requireApproval: true,
          defaultInterviewDuration: 60,
          timezone: 'UTC',
          language: 'en',
        },
      },
    });

    // Clear user cache
    await this.redis.del(`user:${userId}:employer`);

    return employer;
  }

  async updateEmployer(employerId, updates, updatedBy) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
    });

    if (!employer) {
      throw new Error('Employer not found');
    }

    const updated = await this.prisma.employer.update({
      where: { id: employerId },
      data: {
        ...updates,
        metadata: {
          ...employer.metadata,
          updatedBy,
          updatedAt: new Date().toISOString(),
          updateHistory: [
            ...(employer.metadata?.updateHistory || []),
            {
              updatedBy,
              updatedAt: new Date().toISOString(),
              changes: Object.keys(updates),
            },
          ],
        },
      },
    });

    // Clear caches
    await this.clearEmployerCaches(employerId);

    // Index in search
    await this.indexEmployerInElasticsearch(updated);

    return updated;
  }

  async getEmployer(employerId) {
    const cacheKey = `employer:${employerId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        },
        jobs: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            title: true,
            department: true,
            location: true,
            createdAt: true,
          },
          take: 10,
          orderBy: { createdAt: 'desc' },
        },
        departments: {
          select: {
            id: true,
            name: true,
            description: true,
            memberCount: true,
          },
        },
        _count: {
          select: {
            jobs: true,
            applications: true,
            employees: true,
            departments: true,
          },
        },
      },
    });

    if (employer) {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(employer));
    }

    return employer;
  }

  async getEmployerByUserId(userId) {
    const cacheKey = `user:${userId}:employer`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const employer = await this.prisma.employer.findFirst({
      where: { userId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
      },
    });

    if (employer) {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(employer));
    }

    return employer;
  }

  async verifyEmployer(employerId, verificationData, verifiedBy) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
    });

    if (!employer) {
      throw new Error('Employer not found');
    }

    const updated = await this.prisma.employer.update({
      where: { id: employerId },
      data: {
        verificationStatus: 'VERIFIED',
        verificationData,
        metadata: {
          ...employer.metadata,
          verifiedBy,
          verifiedAt: new Date().toISOString(),
          verificationData,
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}`);

    return updated;
  }

  // EMPLOYER SETTINGS
  async updateEmployerSettings(employerId, settings, updatedBy) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
    });

    if (!employer) {
      throw new Error('Employer not found');
    }

    const updated = await this.prisma.employer.update({
      where: { id: employerId },
      data: {
        settings: {
          ...employer.settings,
          ...settings,
        },
        metadata: {
          ...employer.metadata,
          settingsUpdatedBy: updatedBy,
          settingsUpdatedAt: new Date().toISOString(),
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}`);

    return updated;
  }

  async getEmployerSettings(employerId) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
      select: { settings: true },
    });

    return employer?.settings || {};
  }

  // DEPARTMENT MANAGEMENT
  async createDepartment(employerId, data, createdBy) {
    const department = await this.prisma.department.create({
      data: {
        employerId,
        name: data.name,
        description: data.description,
        managerId: data.managerId,
        parentId: data.parentId,
        metadata: {
          createdBy,
          createdAt: new Date().toISOString(),
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}:departments`);

    return department;
  }

  async updateDepartment(departmentId, updates, updatedBy) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
    });

    if (!department) {
      throw new Error('Department not found');
    }

    const updated = await this.prisma.department.update({
      where: { id: departmentId },
      data: {
        ...updates,
        metadata: {
          ...department.metadata,
          updatedBy,
          updatedAt: new Date().toISOString(),
        },
      },
    });

    // Clear caches
    await this.clearDepartmentCaches(departmentId, department.employerId);

    return updated;
  }

  async getDepartment(departmentId) {
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      include: {
        manager: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        parent: {
          select: {
            id: true,
            name: true,
          },
        },
        children: {
          select: {
            id: true,
            name: true,
            description: true,
          },
        },
        members: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                avatar: true,
              },
            },
          },
        },
        jobs: {
          where: { status: 'ACTIVE' },
          select: {
            id: true,
            title: true,
            location: true,
            createdAt: true,
          },
        },
      },
    });

    return department;
  }

  async getDepartments(employerId, filters = {}) {
    const cacheKey = `employer:${employerId}:departments`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached && !filters.search) {
      return JSON.parse(cached);
    }

    const where = { employerId };
    
    if (filters.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }
    
    if (filters.managerId) {
      where.managerId = filters.managerId;
    }

    const departments = await this.prisma.department.findMany({
      where,
      include: {
        manager: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        _count: {
          select: {
            members: true,
            jobs: true,
          },
        },
      },
      orderBy: { name: 'asc' },
    });

    if (!filters.search) {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(departments));
    }

    return departments;
  }

  async addDepartmentMember(departmentId, userId, role, addedBy) {
    const existing = await this.prisma.departmentMember.findFirst({
      where: { departmentId, userId },
    });

    if (existing) {
      throw new Error('User is already a member of this department');
    }

    const member = await this.prisma.departmentMember.create({
      data: {
        departmentId,
        userId,
        role,
        addedBy,
        addedAt: new Date(),
        metadata: {
          addedBy,
          addedAt: new Date().toISOString(),
        },
      },
    });

    // Clear caches
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { employerId: true },
    });

    if (department) {
      await this.clearDepartmentCaches(departmentId, department.employerId);
    }

    return member;
  }

  async removeDepartmentMember(departmentId, userId, removedBy) {
    const member = await this.prisma.departmentMember.findFirst({
      where: { departmentId, userId },
    });

    if (!member) {
      throw new Error('User is not a member of this department');
    }

    await this.prisma.departmentMember.delete({
      where: { id: member.id },
    });

    // Clear caches
    const department = await this.prisma.department.findUnique({
      where: { id: departmentId },
      select: { employerId: true },
    });

    if (department) {
      await this.clearDepartmentCaches(departmentId, department.employerId);
    }

    return { success: true };
  }

  // TEAM MANAGEMENT
  async createTeam(employerId, data, createdBy) {
    const team = await this.prisma.team.create({
      data: {
        employerId,
        name: data.name,
        description: data.description,
        purpose: data.purpose,
        metadata: {
          createdBy,
          createdAt: new Date().toISOString(),
        },
      },
    });

    // Add creator as team lead
    await this.prisma.teamMember.create({
      data: {
        teamId: team.id,
        userId: createdBy,
        role: 'LEAD',
        joinedAt: new Date(),
        metadata: {
          addedBy: createdBy,
          addedAt: new Date().toISOString(),
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}:teams`);

    return team;
  }

  async addTeamMember(teamId, userId, role, addedBy) {
    const existing = await this.prisma.teamMember.findFirst({
      where: { teamId, userId },
    });

    if (existing) {
      throw new Error('User is already a member of this team');
    }

    const member = await this.prisma.teamMember.create({
      data: {
        teamId,
        userId,
        role,
        addedBy,
        joinedAt: new Date(),
        metadata: {
          addedBy,
          addedAt: new Date().toISOString(),
        },
      },
    });

    // Clear cache
    const team = await this.prisma.team.findUnique({
      where: { id: teamId },
      select: { employerId: true },
    });

    if (team) {
      await this.redis.del(`team:${teamId}:members`);
      await this.redis.del(`employer:${team.employerId}:teams`);
    }

    return member;
  }

  async getTeamMembers(teamId) {
    const cacheKey = `team:${teamId}:members`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
            title: true,
          },
        },
      },
      orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
    });

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(members));

    return members;
  }

  // HIRING WORKFLOW MANAGEMENT
  async createHiringWorkflow(employerId, data, createdBy) {
    const workflow = await this.prisma.hiringWorkflow.create({
      data: {
        employerId,
        name: data.name,
        description: data.description,
        stages: data.stages,
        rules: data.rules,
        metadata: {
          createdBy,
          createdAt: new Date().toISOString(),
          version: 1,
          isActive: true,
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}:workflows`);

    return workflow;
  }

  async applyHiringWorkflow(jobId, workflowId, appliedBy) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    const workflow = await this.prisma.hiringWorkflow.findUnique({
      where: { id: workflowId },
    });

    if (!workflow) {
      throw new Error('Workflow not found');
    }

    const updated = await this.prisma.job.update({
      where: { id: jobId },
      data: {
        hiringWorkflowId: workflowId,
        metadata: {
          ...job.metadata,
          appliedWorkflow: workflowId,
          appliedWorkflowBy: appliedBy,
          appliedWorkflowAt: new Date().toISOString(),
          workflowVersion: workflow.metadata?.version,
        },
      },
    });

    return updated;
  }

  async getHiringWorkflows(employerId) {
    const cacheKey = `employer:${employerId}:workflows`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const workflows = await this.prisma.hiringWorkflow.findMany({
      where: { 
        employerId,
        metadata: {
          path: ['isActive'],
          equals: true,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(workflows));

    return workflows;
  }

  // EMPLOYER ANALYTICS
  async getEmployerAnalytics(employerId, period = '30_DAYS') {
    const cacheKey = `employer:${employerId}:analytics:${period}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const startDate = this.getPeriodStartDate(period);
    
    const [
      jobStats,
      applicationStats,
      interviewStats,
      hiringStats,
      departmentStats,
    ] = await Promise.all([
      this.getJobStatistics(employerId, startDate),
      this.getApplicationStatistics(employerId, startDate),
      this.getInterviewStatistics(employerId, startDate),
      this.getHiringStatistics(employerId, startDate),
      this.getDepartmentStatistics(employerId),
    ]);

    const analytics = {
      employerId,
      period,
      overview: {
        totalJobs: jobStats.total,
        activeJobs: jobStats.active,
        totalApplications: applicationStats.total,
        totalInterviews: interviewStats.total,
        totalHires: hiringStats.totalHires,
      },
      jobAnalytics: jobStats,
      applicationAnalytics: applicationStats,
      interviewAnalytics: interviewStats,
      hiringAnalytics: hiringStats,
      departmentAnalytics: departmentStats,
      insights: this.generateEmployerInsights(
        jobStats,
        applicationStats,
        interviewStats,
        hiringStats
      ),
      recommendations: this.generateEmployerRecommendations(
        jobStats,
        applicationStats,
        interviewStats,
        hiringStats
      ),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL / 2, JSON.stringify(analytics));

    return analytics;
  }

  async getJobStatistics(employerId, startDate) {
    const stats = await this.prisma.job.groupBy({
      by: ['status', 'departmentId'],
      where: {
        employerId,
        createdAt: { gte: startDate },
      },
      _count: { id: true },
      _avg: {
        salaryMin: true,
        salaryMax: true,
      },
    });

    const timeSeries = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        AVG(salary_max - salary_min) as avg_salary_range
      FROM jobs
      WHERE employer_id = ${employerId}
        AND created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    return {
      total: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      byStatus: stats.reduce((acc, stat) => {
        acc[stat.status] = (acc[stat.status] || 0) + stat._count.id;
        return acc;
      }, {}),
      byDepartment: stats.reduce((acc, stat) => {
        if (!acc[stat.departmentId]) acc[stat.departmentId] = 0;
        acc[stat.departmentId] += stat._count.id;
        return acc;
      }, {}),
      timeSeries,
      avgSalaryRange: stats[0]?._avg.salaryMax - stats[0]?._avg.salaryMin || 0,
    };
  }

  async getApplicationStatistics(employerId, startDate) {
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where: {
        job: { employerId },
        createdAt: { gte: startDate },
      },
      _count: { id: true },
      _avg: { kfnScore: true },
    });

    const sourceStats = await this.prisma.application.groupBy({
      by: ['metadata.source'],
      where: {
        job: { employerId },
        createdAt: { gte: startDate },
      },
      _count: { id: true },
    });

    const conversionRate = await this.calculateApplicationConversionRate(employerId, startDate);

    return {
      total: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      byStatus: stats.reduce((acc, stat) => {
        acc[stat.status] = {
          count: stat._count.id,
          avgScore: stat._avg.kfnScore,
        };
        return acc;
      }, {}),
      bySource: sourceStats.reduce((acc, stat) => {
        acc[stat.metadata?.source || 'UNKNOWN'] = stat._count.id;
        return acc;
      }, {}),
      conversionRate,
      avgProcessingTime: await this.calculateAvgApplicationProcessingTime(employerId, startDate),
    };
  }

  async getInterviewStatistics(employerId, startDate) {
    const stats = await this.prisma.interview.groupBy({
      by: ['status', 'type'],
      where: {
        employerId,
        scheduledAt: { gte: startDate },
      },
      _count: { id: true },
      _avg: { duration: true },
    });

    const feedbackStats = await this.prisma.interviewFeedback.groupBy({
      by: ['recommendation'],
      where: {
        interview: {
          employerId,
          scheduledAt: { gte: startDate },
        },
      },
      _count: { id: true },
      _avg: { rating: true },
    });

    return {
      total: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      byStatus: stats.reduce((acc, stat) => {
        if (!acc[stat.status]) acc[stat.status] = {};
        acc[stat.status][stat.type] = {
          count: stat._count.id,
          avgDuration: stat._avg.duration,
        };
        return acc;
      }, {}),
      feedbackDistribution: feedbackStats.reduce((acc, stat) => {
        acc[stat.recommendation] = {
          count: stat._count.id,
          avgRating: stat._avg.rating,
        };
        return acc;
      }, {}),
      completionRate: await this.calculateInterviewCompletionRate(employerId, startDate),
      averageRating: await this.calculateAverageInterviewRating(employerId, startDate),
    };
  }

  async getHiringStatistics(employerId, startDate) {
    const hires = await this.prisma.application.count({
      where: {
        job: { employerId },
        status: 'HIRED',
        createdAt: { gte: startDate },
      },
    });

    const timeToHire = await this.prisma.$queryRaw`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400) as avg_days
      FROM applications
      WHERE job_id IN (
        SELECT id FROM jobs WHERE employer_id = ${employerId}
      )
        AND status = 'HIRED'
        AND created_at >= ${startDate}
    `;

    const sourceEffectiveness = await this.prisma.application.groupBy({
      by: ['metadata.source'],
      where: {
        job: { employerId },
        status: 'HIRED',
        createdAt: { gte: startDate },
      },
      _count: { id: true },
    });

    return {
      totalHires: hires,
      avgTimeToHire: timeToHire[0]?.avg_days || 0,
      sourceEffectiveness: sourceEffectiveness.reduce((acc, stat) => {
        acc[stat.metadata?.source || 'UNKNOWN'] = stat._count.id;
        return acc;
      }, {}),
      departmentHires: await this.getHiresByDepartment(employerId, startDate),
    };
  }

  async getDepartmentStatistics(employerId) {
    const stats = await this.prisma.department.findMany({
      where: { employerId },
      include: {
        _count: {
          select: {
            jobs: true,
            members: true,
          },
        },
        jobs: {
          select: {
            _count: {
              select: {
                applications: true,
              },
            },
          },
        },
      },
    });

    return stats.map(dept => ({
      id: dept.id,
      name: dept.name,
      jobCount: dept._count.jobs,
      memberCount: dept._count.members,
      applicationCount: dept.jobs.reduce((sum, job) => sum + job._count.applications, 0),
    }));
  }

  async calculateApplicationConversionRate(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('HIRED', 'ACCEPTED') THEN 1 ELSE 0 END) as hired
      FROM applications
      WHERE job_id IN (
        SELECT id FROM jobs WHERE employer_id = ${employerId}
      )
        AND created_at >= ${startDate}
    `;

    const total = parseInt(result[0].total) || 0;
    const hired = parseInt(result[0].hired) || 0;

    return total > 0 ? hired / total : 0;
  }

  async calculateAvgApplicationProcessingTime(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400) as avg_days
      FROM applications
      WHERE job_id IN (
        SELECT id FROM jobs WHERE employer_id = ${employerId}
      )
        AND created_at >= ${startDate}
        AND status IN ('HIRED', 'REJECTED', 'WITHDRAWN')
    `;

    return result[0]?.avg_days || 0;
  }

  async calculateInterviewCompletionRate(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
      FROM interviews
      WHERE employer_id = ${employerId}
        AND scheduled_at >= ${startDate}
    `;

    const total = parseInt(result[0].total) || 0;
    const completed = parseInt(result[0].completed) || 0;

    return total > 0 ? completed / total : 0;
  }

  async calculateAverageInterviewRating(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT AVG(rating) as avg_rating
      FROM interview_feedbacks
      WHERE interview_id IN (
        SELECT id FROM interviews 
        WHERE employer_id = ${employerId}
          AND scheduled_at >= ${startDate}
      )
    `;

    return result[0]?.avg_rating || 0;
  }

  async getHiresByDepartment(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        d.id,
        d.name,
        COUNT(a.id) as hires
      FROM applications a
      JOIN jobs j ON a.job_id = j.id
      JOIN departments d ON j.department_id = d.id
      WHERE j.employer_id = ${employerId}
        AND a.status = 'HIRED'
        AND a.created_at >= ${startDate}
      GROUP BY d.id, d.name
    `;

    return result;
  }

  generateEmployerInsights(jobStats, applicationStats, interviewStats, hiringStats) {
    const insights = [];

    // Application conversion insight
    if (applicationStats.conversionRate < 0.05) {
      insights.push({
        type: 'LOW_CONVERSION_RATE',
        severity: 'HIGH',
        message: `Low application to hire conversion rate: ${(applicationStats.conversionRate * 100).toFixed(1)}%`,
        suggestion: 'Review application process and job requirements',
      });
    }

    // Time to hire insight
    if (hiringStats.avgTimeToHire > 30) {
      insights.push({
        type: 'LONG_HIRING_PROCESS',
        severity: 'MEDIUM',
        message: `Average time to hire is ${hiringStats.avgTimeToHire.toFixed(1)} days`,
        suggestion: 'Streamline interview process and reduce delays',
      });
    }

    // Interview completion insight
    if (interviewStats.completionRate < 0.7) {
      insights.push({
        type: 'LOW_INTERVIEW_COMPLETION',
        severity: 'MEDIUM',
        message: `Only ${(interviewStats.completionRate * 100).toFixed(1)}% of scheduled interviews are completed`,
        suggestion: 'Improve interview scheduling and follow-up',
      });
    }

    // Source effectiveness insight
    const topSource = Object.entries(applicationStats.bySource)
      .sort((a, b) => b[1] - a[1])[0];
    
    if (topSource && topSource[1] / applicationStats.total > 0.6) {
      insights.push({
        type: 'SOURCE_CONCENTRATION',
        severity: 'MEDIUM',
        message: `Over-reliant on ${topSource[0]} for applications (${((topSource[1] / applicationStats.total) * 100).toFixed(1)}%)`,
        suggestion: 'Diversify recruitment channels',
      });
    }

    return insights;
  }

  generateEmployerRecommendations(jobStats, applicationStats, interviewStats, hiringStats) {
    const recommendations = [];

    // Based on conversion rate
    if (applicationStats.conversionRate < 0.05) {
      recommendations.push({
        type: 'IMPROVE_CONVERSION',
        priority: 'HIGH',
        actions: [
          'Review job descriptions for clarity',
          'Optimize application process',
          'Implement better screening criteria',
        ],
        expectedImpact: 'Increase hire rate by 20-30%',
      });
    }

    // Based on time to hire
    if (hiringStats.avgTimeToHire > 30) {
      recommendations.push({
        type: 'REDUCE_TIME_TO_HIRE',
        priority: 'MEDIUM',
        actions: [
          'Implement interview scheduling automation',
          'Set SLAs for interview feedback',
          'Streamline approval processes',
        ],
        expectedImpact: 'Reduce hiring time by 25%',
      });
    }

    // Based on interview feedback
    if (interviewStats.averageRating < 3.5) {
      recommendations.push({
        type: 'IMPROVE_INTERVIEW_QUALITY',
        priority: 'MEDIUM',
        actions: [
          'Provide interviewer training',
          'Standardize interview questions',
          'Implement scoring rubrics',
        ],
        expectedImpact: 'Improve interview quality and consistency',
      });
    }

    return recommendations;
  }

  // EMPLOYER BRANDING
  async updateEmployerBranding(employerId, brandingData, updatedBy) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
    });

    if (!employer) {
      throw new Error('Employer not found');
    }

    const updated = await this.prisma.employer.update({
      where: { id: employerId },
      data: {
        branding: {
          ...employer.branding,
          ...brandingData,
        },
        metadata: {
          ...employer.metadata,
          brandingUpdatedBy: updatedBy,
          brandingUpdatedAt: new Date().toISOString(),
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}`);

    return updated;
  }

  async getEmployerBranding(employerId) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
      select: { branding: true },
    });

    return employer?.branding || {};
  }

  // EMPLOYER INTEGRATIONS
  async setupIntegration(employerId, integrationType, config, setupBy) {
    const existing = await this.prisma.integration.findFirst({
      where: { employerId, type: integrationType },
    });

    let integration;
    
    if (existing) {
      integration = await this.prisma.integration.update({
        where: { id: existing.id },
        data: {
          config,
          status: 'ACTIVE',
          metadata: {
            ...existing.metadata,
            updatedBy: setupBy,
            updatedAt: new Date().toISOString(),
            lastConfigured: new Date().toISOString(),
          },
        },
      });
    } else {
      integration = await this.prisma.integration.create({
        data: {
          employerId,
          type: integrationType,
          config,
          status: 'ACTIVE',
          metadata: {
            setupBy,
            setupAt: new Date().toISOString(),
          },
        },
      });
    }

    // Clear cache
    await this.redis.del(`employer:${employerId}:integrations`);

    return integration;
  }

  async getIntegrations(employerId) {
    const cacheKey = `employer:${employerId}:integrations`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const integrations = await this.prisma.integration.findMany({
      where: { employerId },
      orderBy: { createdAt: 'desc' },
    });

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(integrations));

    return integrations;
  }

  // EMPLOYER SUBSCRIPTION
  async updateSubscription(employerId, subscriptionData, updatedBy) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
    });

    if (!employer) {
      throw new Error('Employer not found');
    }

    const updated = await this.prisma.employer.update({
      where: { id: employerId },
      data: {
        metadata: {
          ...employer.metadata,
          subscription: {
            ...(employer.metadata?.subscription || {}),
            ...subscriptionData,
            updatedBy,
            updatedAt: new Date().toISOString(),
          },
        },
      },
    });

    // Clear cache
    await this.redis.del(`employer:${employerId}`);

    return updated;
  }

  async getSubscription(employerId) {
    const employer = await this.prisma.employer.findUnique({
      where: { id: employerId },
      select: { metadata: true },
    });

    return employer?.metadata?.subscription || {};
  }

  // EMPLOYER COMPLIANCE
  async trackComplianceEvent(employerId, eventType, details, userId) {
    const event = await this.prisma.complianceEvent.create({
      data: {
        employerId,
        eventType,
        details,
        userId,
        timestamp: new Date(),
        metadata: {
          ipAddress: details.ipAddress,
          userAgent: details.userAgent,
        },
      },
    });

    // Update employer compliance score
    await this.updateComplianceScore(employerId);

    return event;
  }

  async updateComplianceScore(employerId) {
    const events = await this.prisma.complianceEvent.findMany({
      where: { employerId },
      orderBy: { timestamp: 'desc' },
      take: 100,
    });

    let score = 100; // Start with perfect score

    // Deduct points for compliance issues
    events.forEach(event => {
      if (event.eventType === 'DATA_BREACH') {
        score -= 20;
      } else if (event.eventType === 'PRIVACY_VIOLATION') {
        score -= 15;
      } else if (event.eventType === 'DISCRIMINATION_COMPLAINT') {
        score -= 25;
      }
    });

    // Ensure score stays within bounds
    score = Math.max(Math.min(score, 100), 0);

    await this.prisma.employer.update({
      where: { id: employerId },
      data: {
        metadata: {
          complianceScore: score,
          lastComplianceCheck: new Date().toISOString(),
        },
      },
    });

    return score;
  }

  // CACHE MANAGEMENT
  async clearEmployerCaches(employerId) {
    const patterns = [
      `employer:${employerId}`,
      `employer:${employerId}:*`,
      `user:*:employer`,
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async clearDepartmentCaches(departmentId, employerId) {
    const patterns = [
      `department:${departmentId}`,
      `employer:${employerId}:departments`,
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  // SEARCH INDEXING
  async indexEmployerInElasticsearch(employer) {
    if (!this.es) return;

    try {
      await this.es.index({
        index: 'employers',
        id: employer.id,
        body: {
          id: employer.id,
          name: employer.name,
          description: employer.description,
          industry: employer.industry,
          size: employer.size,
          location: employer.headquarters,
          website: employer.website,
          verified: employer.verificationStatus === 'VERIFIED',
          createdAt: employer.createdAt,
          updatedAt: employer.updatedAt,
        },
      });
    } catch (error) {
      console.error('Failed to index employer:', error);
    }
  }

  async searchEmployersInElasticsearch(query, filters = {}) {
    if (!this.es) return { employers: [], total: 0 };

    const esQuery = {
      bool: {
        must: [],
        filter: [],
      },
    };

    if (query) {
      esQuery.bool.must.push({
        multi_match: {
          query,
          fields: [
            'name^3',
            'description^2',
            'industry',
            'location',
          ],
          fuzziness: 'AUTO',
        },
      });
    }

    if (filters.industry) {
      esQuery.bool.filter.push({ term: { industry: filters.industry } });
    }
    if (filters.size) {
      esQuery.bool.filter.push({ term: { size: filters.size } });
    }
    if (filters.verified !== undefined) {
      esQuery.bool.filter.push({ term: { verified: filters.verified } });
    }

    const result = await this.es.search({
      index: 'employers',
      body: {
        query: esQuery,
        sort: [
          { verified: { order: 'desc' } },
          { _score: { order: 'desc' } },
        ],
        from: ((filters.page || 1) - 1) * (filters.limit || 20),
        size: filters.limit || 20,
      },
    });

    return {
      employers: result.hits.hits.map(hit => hit._source),
      total: result.hits.total.value,
    };
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
      case 'QUARTER':
        return new Date(now.setMonth(now.getMonth() - 3));
      case 'YEAR':
        return new Date(now.setFullYear(now.getFullYear() - 1));
      default:
        return new Date(now.setDate(now.getDate() - 30));
    }
  }
}

module.exports = EmployerRepository;
