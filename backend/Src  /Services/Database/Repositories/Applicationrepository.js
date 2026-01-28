const BaseRepository = require('../BaseRepository');

class ApplicationRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'application');
  }

  /**
   * Create application with validation
   */
  async create(data) {
    try {
      // Check if user already applied
      const existing = await this.findFirst({
        jobId: data.jobId,
        userId: data.userId,
      });

      if (existing) {
        throw new Error('You have already applied for this job');
      }

      // Check if job exists and is open
      const job = await this.prisma.job.findUnique({
        where: { id: data.jobId },
        select: { status: true, applicationDeadline: true },
      });

      if (!job || job.status !== 'PUBLISHED') {
        throw new Error('Job is not available for applications');
      }

      if (job.applicationDeadline && new Date(job.applicationDeadline) < new Date()) {
        throw new Error('Application deadline has passed');
      }

      return await super.create(data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find application by job and user
   */
  async findByJobAndUser(jobId, userId, options = {}) {
    try {
      return await this.findFirst({
        jobId,
        userId,
      }, options);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find applications by user ID
   */
  async findByUserId(userId, options = {}) {
    try {
      return await this.findMany({
        userId,
      }, options);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find applications by job ID
   */
  async findByJobId(jobId, options = {}) {
    try {
      return await this.findMany({
        jobId,
      }, options);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get applications with filters and pagination
   */
  async getApplications(filters = {}, pagination = {}) {
    try {
      const {
        userId,
        jobId,
        status,
        stage,
        dateFrom,
        dateTo,
        search,
        ...otherFilters
      } = filters;

      const where = {};

      // User filter
      if (userId) {
        where.userId = userId;
      }

      // Job filter
      if (jobId) {
        where.jobId = jobId;
      }

      // Status filter
      if (status) {
        where.status = status;
      }

      // Stage filter
      if (stage) {
        where.stage = stage;
      }

      // Date range filters
      if (dateFrom || dateTo) {
        where.appliedAt = {};
        if (dateFrom) {
          where.appliedAt.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.appliedAt.lte = new Date(dateTo);
        }
      }

      // Search filter
      if (search) {
        where.OR = [
          {
            job: {
              title: { contains: search, mode: 'insensitive' },
            },
          },
          {
            job: {
              company: {
                companyName: { contains: search, mode: 'insensitive' },
              },
            },
          },
          {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        ];
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      return await this.paginate(where, {
        include: {
          job: {
            include: {
              company: true,
            },
          },
          user: {
            include: {
              profile: true,
            },
          },
          interviews: {
            orderBy: { scheduledAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { appliedAt: 'desc' },
        ...pagination,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get application with full details
   */
  async getApplicationDetails(applicationId, userId = null) {
    try {
      const application = await this.model.findUnique({
        where: { id: applicationId },
        include: {
          job: {
            include: {
              company: true,
            },
          },
          user: {
            include: {
              profile: true,
              workerProfile: true,
              skills: {
                include: { skill: true },
              },
              experiences: {
                orderBy: { startDate: 'desc' },
              },
              educations: {
                orderBy: { startDate: 'desc' },
              },
              resumes: {
                where: { isPrimary: true },
                take: 1,
              },
            },
          },
          interviews: {
            orderBy: { scheduledAt: 'desc' },
          },
          notes: {
            orderBy: { createdAt: 'desc' },
            include: {
              author: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
          kfn: {
            orderBy: { calculatedAt: 'desc' },
            take: 1,
          },
        },
      });

      if (!application) {
        return null;
      }

      // Check if user has permission to view
      if (userId && application.userId !== userId) {
        const isEmployer = await this.isJobEmployer(application.jobId, userId);
        const isAdmin = await this.isUserAdmin(userId);

        if (!isEmployer && !isAdmin) {
          throw new Error('Unauthorized to view this application');
        }
      }

      // Get application timeline
      const timeline = await this.getApplicationTimeline(applicationId);

      return {
        ...application,
        timeline,
        permissions: {
          canEdit: userId === application.userId,
          canAddNote: userId !== application.userId,
          canScheduleInterview: userId !== application.userId,
          canUpdateStatus: userId !== application.userId,
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Check if user is job employer
   */
  async isJobEmployer(jobId, userId) {
    try {
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: { companyId: true },
      });

      if (!job) {
        return false;
      }

      const employer = await this.prisma.employerProfile.findFirst({
        where: {
          id: job.companyId,
          userId,
        },
      });

      return !!employer;
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if user is admin
   */
  async isUserAdmin(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      return user?.role === 'ADMIN';
    } catch (error) {
      return false;
    }
  }

  /**
   * Get application timeline
   */
  async getApplicationTimeline(applicationId) {
    try {
      const application = await this.findById(applicationId);
      if (!application) {
        return [];
      }

      const timeline = [];

      // Application submitted
      timeline.push({
        date: application.appliedAt,
        event: 'APPLIED',
        description: 'Application submitted',
        user: 'Applicant',
      });

      // Status changes
      if (application.reviewedAt) {
        timeline.push({
          date: application.reviewedAt,
          event: 'REVIEWED',
          description: 'Application reviewed',
          user: 'Reviewer',
        });
      }

      if (application.shortlistedAt) {
        timeline.push({
          date: application.shortlistedAt,
          event: 'SHORTLISTED',
          description: 'Application shortlisted',
          user: 'Reviewer',
        });
      }

      if (application.interviewedAt) {
        timeline.push({
          date: application.interviewedAt,
          event: 'INTERVIEWED',
          description: 'Interview conducted',
          user: 'Interviewer',
        });
      }

      if (application.offeredAt) {
        timeline.push({
          date: application.offeredAt,
          event: 'OFFERED',
          description: 'Job offer extended',
          user: 'Hiring Manager',
        });
      }

      if (application.rejectedAt) {
        timeline.push({
          date: application.rejectedAt,
          event: 'REJECTED',
          description: 'Application rejected',
          user: 'Reviewer',
        });
      }

      if (application.withdrawnAt) {
        timeline.push({
          date: application.withdrawnAt,
          event: 'WITHDRAWN',
          description: 'Application withdrawn',
          user: 'Applicant',
        });
      }

      // Get interviews
      const interviews = await this.prisma.interview.findMany({
        where: { applicationId },
        orderBy: { scheduledAt: 'asc' },
      });

      interviews.forEach(interview => {
        timeline.push({
          date: interview.scheduledAt,
          event: 'INTERVIEW_SCHEDULED',
          description: `${interview.type} interview scheduled`,
          user: 'Scheduler',
          metadata: {
            interviewId: interview.id,
            type: interview.type,
            status: interview.status,
          },
        });

        if (interview.status === 'COMPLETED') {
          timeline.push({
            date: interview.updatedAt,
            event: 'INTERVIEW_COMPLETED',
            description: `${interview.type} interview completed`,
            user: 'Interviewer',
            metadata: {
              interviewId: interview.id,
              rating: interview.rating,
            },
          });
        }
      });

      // Get notes
      const notes = await this.prisma.applicationNote.findMany({
        where: { applicationId },
        orderBy: { createdAt: 'asc' },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      });

      notes.forEach(note => {
        timeline.push({
          date: note.createdAt,
          event: 'NOTE_ADDED',
          description: 'Note added to application',
          user: `${note.author.firstName} ${note.author.lastName}`,
          metadata: {
            noteId: note.id,
            content: note.content.substring(0, 100) + '...',
          },
        });
      });

      // Sort timeline by date
      timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

      return timeline;
    } catch (error) {
      return [];
    }
  }

  /**
   * Update application status
   */
  async updateStatus(applicationId, status, userId = null) {
    try {
      const application = await this.findById(applicationId);
      if (!application) {
        throw new Error('Application not found');
      }

      const data = { status };
      const now = new Date();

      // Set status-specific timestamps
      switch (status) {
        case 'REVIEWING':
          data.reviewedAt = now;
          break;
        case 'SHORTLISTED':
          data.shortlistedAt = now;
          break;
        case 'INTERVIEWING':
          data.interviewedAt = now;
          break;
        case 'OFFERED':
          data.offeredAt = now;
          break;
        case 'HIRED':
          data.hiredAt = now;
          break;
        case 'REJECTED':
          data.rejectedAt = now;
          break;
        case 'WITHDRAWN':
          data.withdrawnAt = now;
          break;
      }

      // Update application
      const updated = await this.update(applicationId, data);

      // Create audit log
      if (userId) {
        await this.prisma.applicationNote.create({
          data: {
            applicationId,
            authorId: userId,
            content: `Status changed to ${status}`,
            type: 'STATUS_CHANGE',
          },
        });
      }

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update application stage
   */
  async updateStage(applicationId, stage, userId = null) {
    try {
      const data = { stage };

      const updated = await this.update(applicationId, data);

      // Create audit log
      if (userId) {
        await this.prisma.applicationNote.create({
          data: {
            applicationId,
            authorId: userId,
            content: `Stage changed to ${stage}`,
            type: 'STAGE_CHANGE',
          },
        });
      }

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Add note to application
   */
  async addNote(applicationId, authorId, content, type = 'NOTE') {
    try {
      return await this.prisma.applicationNote.create({
        data: {
          applicationId,
          authorId,
          content,
          type,
        },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get application notes
   */
  async getNotes(applicationId, options = {}) {
    try {
      return await this.prisma.applicationNote.findMany({
        where: { applicationId },
        include: {
          author: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get application statistics
   */
  async getApplicationStats(userId = null, filters = {}) {
    try {
      const where = {};

      // User filter
      if (userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });

        if (user?.role === 'WORKER' || user?.role === 'FREELANCER') {
          where.userId = userId;
        } else if (user?.role === 'EMPLOYER') {
          const employer = await this.prisma.employerProfile.findFirst({
            where: { userId },
          });

          if (employer) {
            where.job = {
              companyId: employer.id,
            };
          }
        }
      }

      // Apply other filters
      Object.assign(where, filters);

      const [
        total,
        byStatus,
        byStage,
        byMonth,
        avgKFN,
        avgResponseTime,
      ] = await Promise.all([
        this.count(where),
        this.model.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.model.groupBy({
          by: ['stage'],
          where,
          _count: { _all: true },
        }),
        this.getMonthlyStats(where),
        this.getAverageKFN(where),
        this.getAverageResponseTime(where),
      ]);

      // Process status data
      const statusData = byStatus.reduce((acc, item) => {
        acc[item.status] = item._count._all;
        return acc;
      }, {});

      // Process stage data
      const stageData = byStage.reduce((acc, item) => {
        acc[item.stage] = item._count._all;
        return acc;
      }, {});

      return {
        total,
        byStatus: statusData,
        byStage: stageData,
        byMonth,
        averages: {
          kfn: avgKFN,
          responseTime: avgResponseTime,
        },
        successRate: this.calculateSuccessRate(statusData),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get monthly application statistics
   */
  async getMonthlyStats(where, months = 6) {
    try {
      const date = new Date();
      date.setMonth(date.getMonth() - months);

      const applications = await this.findMany({
        where: {
          ...where,
          appliedAt: { gte: date },
        },
        select: { appliedAt: true, status: true },
      });

      const monthlyData = {};
      applications.forEach(app => {
        const month = app.appliedAt.toISOString().slice(0, 7); // YYYY-MM
        if (!monthlyData[month]) {
          monthlyData[month] = {
            total: 0,
            byStatus: {},
          };
        }

        monthlyData[month].total++;
        monthlyData[month].byStatus[app.status] = 
          (monthlyData[month].byStatus[app.status] || 0) + 1;
      });

      // Convert to array and sort
      return Object.entries(monthlyData)
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get average KFN score
   */
  async getAverageKFN(where) {
    try {
      const result = await this.model.aggregate({
        where: {
          ...where,
          kfnScore: { not: null },
        },
        _avg: {
          kfnScore: true,
        },
        _count: {
          kfnScore: true,
        },
      });

      return {
        average: result._avg.kfnScore || 0,
        count: result._count.kfnScore || 0,
      };
    } catch (error) {
      return { average: 0, count: 0 };
    }
  }

  /**
   * Get average response time
   */
  async getAverageResponseTime(where) {
    try {
      const applications = await this.findMany({
        where: {
          ...where,
          reviewedAt: { not: null },
        },
        select: {
          appliedAt: true,
          reviewedAt: true,
        },
      });

      if (applications.length === 0) {
        return { average: 0, count: 0 };
      }

      const totalResponseTime = applications.reduce((total, app) => {
        const responseTime = app.reviewedAt - app.appliedAt;
        return total + responseTime;
      }, 0);

      const averageMs = totalResponseTime / applications.length;
      const averageDays = averageMs / (1000 * 60 * 60 * 24);

      return {
        average: averageDays,
        count: applications.length,
        unit: 'days',
      };
    } catch (error) {
      return { average: 0, count: 0, unit: 'days' };
    }
  }

  /**
   * Calculate success rate
   */
  calculateSuccessRate(statusData) {
    const successful = (statusData.HIRED || 0) + (statusData.OFFERED || 0);
    const total = Object.values(statusData).reduce((sum, count) => sum + count, 0);

    return total > 0 ? (successful / total) * 100 : 0;
  }

  /**
   * Get top applicants for a job
   */
  async getTopApplicants(jobId, limit = 10) {
    try {
      return await this.findMany({
        where: {
          jobId,
          kfnScore: { not: null },
        },
        include: {
          user: {
            include: {
              profile: true,
              skills: {
                include: { skill: true },
                take: 5,
              },
            },
          },
          kfn: {
            orderBy: { calculatedAt: 'desc' },
            take: 1,
          },
        },
        orderBy: { kfnScore: 'desc' },
        take: limit,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Withdraw application
   */
  async withdrawApplication(applicationId, userId) {
    try {
      const application = await this.findById(applicationId);
      if (!application) {
        throw new Error('Application not found');
      }

      if (application.userId !== userId) {
        throw new Error('Unauthorized to withdraw this application');
      }

      if (application.status === 'WITHDRAWN') {
        throw new Error('Application already withdrawn');
      }

      if (['HIRED', 'REJECTED'].includes(application.status)) {
        throw new Error(`Cannot withdraw application in ${application.status} status`);
      }

      return await this.updateStatus(applicationId, 'WITHDRAWN', userId);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get application analytics for dashboard
   */
  async getDashboardAnalytics(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!user) {
        return null;
      }

      let analytics = {};

      switch (user.role) {
        case 'WORKER':
        case 'FREELANCER':
          analytics = await this.getWorkerAnalytics(userId);
          break;
        case 'EMPLOYER':
          analytics = await this.getEmployerAnalytics(userId);
          break;
        case 'ADMIN':
          analytics = await this.getAdminAnalytics();
          break;
      }

      return analytics;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get worker application analytics
   */
  async getWorkerAnalytics(userId) {
    try {
      const [
        stats,
        recentApplications,
        interviewSchedule,
        successRateTrend,
      ] = await Promise.all([
        this.getApplicationStats(userId),
        this.findByUserId(userId, {
          include: {
            job: {
              include: {
                company: true,
              },
            },
          },
          orderBy: { appliedAt: 'desc' },
          take: 5,
        }),
        this.prisma.interview.findMany({
          where: {
            intervieweeId: userId,
            scheduledAt: { gt: new Date() },
            status: 'SCHEDULED',
          },
          include: {
            application: {
              include: {
                job: {
                  include: { company: true },
                },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
        }),
        this.getSuccessRateTrend(userId),
      ]);

      return {
        stats,
        recentApplications,
        interviewSchedule,
        successRateTrend,
        recommendations: this.generateWorkerRecommendations(stats),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer application analytics
   */
  async getEmployerAnalytics(userId) {
    try {
      const employer = await this.prisma.employerProfile.findFirst({
        where: { userId },
      });

      if (!employer) {
        return null;
      }

      const [
        stats,
        recentApplications,
        hiringPipeline,
        topJobs,
      ] = await Promise.all([
        this.getApplicationStats(userId),
        this.getApplications({
          job: { companyId: employer.id },
        }, {
          limit: 10,
          include: {
            user: {
              include: {
                profile: true,
              },
            },
            job: true,
          },
        }),
        this.getHiringPipeline(employer.id),
        this.getTopPerformingJobs(employer.id),
      ]);

      return {
        stats,
        recentApplications,
        hiringPipeline,
        topJobs,
        insights: this.generateEmployerInsights(stats, hiringPipeline),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get admin application analytics
   */
  async getAdminAnalytics() {
    try {
      const [
        platformStats,
        recentActivity,
        topEmployers,
        conversionRates,
      ] = await Promise.all([
        this.getApplicationStats(),
        this.getApplications({}, {
          limit: 10,
          include: {
            user: { select: { firstName: true, lastName: true } },
            job: {
              include: {
                company: true,
              },
            },
          },
          orderBy: { appliedAt: 'desc' },
        }),
        this.getTopEmployers(),
        this.getPlatformConversionRates(),
      ]);

      return {
        platformStats,
        recentActivity,
        topEmployers,
        conversionRates,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get success rate trend for worker
   */
  async getSuccessRateTrend(userId, months = 6) {
    try {
      const date = new Date();
      date.setMonth(date.getMonth() - months);

      const applications = await this.findMany({
        where: {
          userId,
          appliedAt: { gte: date },
        },
        select: {
          appliedAt: true,
          status: true,
        },
      });

      // Group by month
      const monthlyData = {};
      applications.forEach(app => {
        const month = app.appliedAt.toISOString().slice(0, 7);
        if (!monthlyData[month]) {
          monthlyData[month] = {
            total: 0,
            successful: 0,
          };
        }

        monthlyData[month].total++;
        if (['HIRED', 'OFFERED'].includes(app.status)) {
          monthlyData[month].successful++;
        }
      });

      // Calculate success rates
      return Object.entries(monthlyData)
        .map(([month, data]) => ({
          month,
          successRate: data.total > 0 ? (data.successful / data.total) * 100 : 0,
          total: data.total,
          successful: data.successful,
        }))
        .sort((a, b) => a.month.localeCompare(b.month));
    } catch (error) {
      return [];
    }
  }

  /**
   * Generate worker recommendations
   */
  generateWorkerRecommendations(stats) {
    const recommendations = [];

    if (stats.averages.kfn.average < 70) {
      recommendations.push({
        type: 'KFN_SCORE',
        title: 'Improve KFN Score',
        description: 'Your average KFN score is below 70%. Consider improving your skills and profile.',
        priority: 'HIGH',
      });
    }

    if (stats.successRate < 20) {
      recommendations.push({
        type: 'SUCCESS_RATE',
        title: 'Increase Application Success',
        description: 'Your application success rate is low. Consider applying to more suitable positions.',
        priority: 'HIGH',
      });
    }

    if (stats.averages.responseTime.average > 7) {
      recommendations.push({
        type: 'RESPONSE_TIME',
        title: 'Follow Up on Applications',
        description: 'Employers are taking over a week to respond. Consider following up on pending applications.',
        priority: 'MEDIUM',
      });
    }

    if (stats.byStatus.PENDING && stats.byStatus.PENDING > 10) {
      recommendations.push({
        type: 'PENDING_APPLICATIONS',
        title: 'Reduce Pending Applications',
        description: 'You have many pending applications. Consider withdrawing from positions you are no longer interested in.',
        priority: 'LOW',
      });
    }

    return recommendations;
  }

  /**
   * Get hiring pipeline for employer
   */
  async getHiringPipeline(companyId) {
    try {
      const jobs = await this.prisma.job.findMany({
        where: {
          companyId,
          status: 'PUBLISHED',
        },
        include: {
          _count: {
            select: {
              applications: true,
            },
          },
        },
      });

      const pipeline = {
        totalJobs: jobs.length,
        totalApplications: 0,
        byStage: {
          applied: 0,
          screened: 0,
          interviewed: 0,
          offered: 0,
          hired: 0,
        },
      };

      for (const job of jobs) {
        const applications = await this.findByJobId(job.id);
        pipeline.totalApplications += applications.length;

        applications.forEach(app => {
          pipeline.byStage.applied++;

          if (['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED'].includes(app.status)) {
            pipeline.byStage.screened++;
          }

          if (['INTERVIEWING', 'OFFERED', 'HIRED'].includes(app.status)) {
            pipeline.byStage.interviewed++;
          }

          if (['OFFERED', 'HIRED'].includes(app.status)) {
            pipeline.byStage.offered++;
          }

          if (app.status === 'HIRED') {
            pipeline.byStage.hired++;
          }
        });
      }

      return pipeline;
    } catch (error) {
      return {
        totalJobs: 0,
        totalApplications: 0,
        byStage: {
          applied: 0,
          screened: 0,
          interviewed: 0,
          offered: 0,
          hired: 0,
        },
      };
    }
  }

  /**
   * Get top performing jobs for employer
   */
  async getTopPerformingJobs(companyId, limit = 5) {
    try {
      const jobs = await this.prisma.job.findMany({
        where: { companyId },
        include: {
          _count: {
            select: {
              applications: true,
            },
          },
        },
      });

      // Calculate performance metrics for each job
      const jobPerformance = await Promise.all(
        jobs.map(async job => {
          const applications = await this.findByJobId(job.id);
          const hired = applications.filter(a => a.status === 'HIRED').length;
          const conversionRate = applications.length > 0 ? (hired / applications.length) * 100 : 0;

          return {
            ...job,
            performance: {
              totalApplications: applications.length,
              hired,
              conversionRate,
              avgKFN: this.calculateAverageKFN(applications),
            },
          };
        })
      );

      // Sort by conversion rate and return top jobs
      return jobPerformance
        .sort((a, b) => b.performance.conversionRate - a.performance.conversionRate)
        .slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  /**
   * Calculate average KFN for applications
   */
  calculateAverageKFN(applications) {
    const scores = applications
      .map(a => a.kfnScore)
      .filter(score => score !== null);

    return scores.length > 0
      ? scores.reduce((sum, score) => sum + score, 0) / scores.length
      : 0;
  }

  /**
   * Generate employer insights
   */
  generateEmployerInsights(stats, pipeline) {
    const insights = [];

    const overallConversion = pipeline.byStage.hired / (pipeline.byStage.applied || 1) * 100;

    if (overallConversion < 10) {
      insights.push({
        type: 'LOW_CONVERSION',
        title: 'Low Conversion Rate',
        description: `Your overall conversion rate is ${overallConversion.toFixed(1)}%. Consider improving job descriptions or screening process.`,
        priority: 'HIGH',
      });
    }

    if (pipeline.byStage.interviewed / (pipeline.byStage.screened || 1) < 0.3) {
      insights.push({
        type: 'SCREENING_EFFICIENCY',
        title: 'Improve Screening Efficiency',
        description: 'Only a small percentage of screened candidates are being interviewed. Consider refining your screening criteria.',
        priority: 'MEDIUM',
      });
    }

    if (stats.averages.responseTime.average > 5) {
      insights.push({
        type: 'RESPONSE_TIME',
        title: 'Slow Response Time',
        description: `Average response time is ${stats.averages.responseTime.average.toFixed(1)} days. Faster responses improve candidate experience.`,
        priority: 'MEDIUM',
      });
    }

    return insights;
  }

  /**
   * Get top employers by application volume
   */
  async getTopEmployers(limit = 10) {
    try {
      const results = await this.prisma.$queryRaw`
        SELECT 
          e.id as company_id,
          e.company_name,
          COUNT(a.id) as total_applications,
          COUNT(CASE WHEN a.status = 'HIRED' THEN 1 END) as hired,
          ROUND(
            COUNT(CASE WHEN a.status = 'HIRED' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(a.id), 0), 2
          ) as conversion_rate
        FROM "EmployerProfile" e
        LEFT JOIN "Job" j ON j.company_id = e.id
        LEFT JOIN "Application" a ON a.job_id = j.id
        WHERE a.applied_at >= NOW() - INTERVAL '30 days'
        GROUP BY e.id, e.company_name
        ORDER BY total_applications DESC
        LIMIT ${limit}
      `;

      return results;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get platform conversion rates
   */
  async getPlatformConversionRates() {
    try {
      const result = await this.prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_applications,
          COUNT(CASE WHEN status = 'HIRED' THEN 1 END) as hired,
          COUNT(CASE WHEN status = 'OFFERED' THEN 1 END) as offered,
          COUNT(CASE WHEN status = 'INTERVIEWING' THEN 1 END) as interviewing,
          COUNT(CASE WHEN status = 'SHORTLISTED' THEN 1 END) as shortlisted,
          COUNT(CASE WHEN status = 'REJECTED' THEN 1 END) as rejected,
          COUNT(CASE WHEN status = 'WITHDRAWN' THEN 1 END) as withdrawn,
          ROUND(
            COUNT(CASE WHEN status = 'HIRED' THEN 1 END) * 100.0 / 
            NULLIF(COUNT(*), 0), 2
          ) as overall_conversion_rate
        FROM "Application"
        WHERE applied_at >= NOW() - INTERVAL '30 days'
      `;

      return result[0] || {};
    } catch (error) {
      return {};
    }
  }
}

module.exports = ApplicationRepository;
