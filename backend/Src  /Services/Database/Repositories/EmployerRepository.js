const BaseRepository = require('../BaseRepository');

class EmployerRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'employerProfile');
  }

  /**
   * Find employer profile by user ID
   */
  async findByUserId(userId, options = {}) {
    try {
      return await this.model.findUnique({
        where: { userId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update employer profile by user ID
   */
  async updateByUserId(userId, data) {
    try {
      return await this.model.update({
        where: { userId },
        data,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create or update employer profile
   */
  async upsertByUserId(userId, data) {
    try {
      return await this.model.upsert({
        where: { userId },
        update: data,
        create: {
          userId,
          ...data,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get complete employer profile with all relations
   */
  async getCompleteEmployerProfile(userId) {
    try {
      return await this.prisma.user.findUnique({
        where: { 
          id: userId,
          role: 'EMPLOYER',
        },
        include: {
          profile: true,
          employerProfile: true,
          jobs: {
            include: {
              _count: {
                select: {
                  applications: true,
                },
              },
            },
            orderBy: { postedAt: 'desc' },
            take: 10,
          },
          reviews: {
            where: { type: 'COMPANY' },
            include: {
              reviewer: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
            orderBy: { createdAt: 'desc' },
            take: 10,
          },
          subscriptions: {
            where: { status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer statistics
   */
  async getEmployerStats(employerId) {
    try {
      const [
        employer,
        jobs,
        applications,
        interviews,
        hires,
        revenue,
      ] = await Promise.all([
        this.findById(employerId),
        this.prisma.job.findMany({
          where: { companyId: employerId },
        }),
        this.prisma.application.findMany({
          where: {
            job: { companyId: employerId },
          },
        }),
        this.prisma.interview.findMany({
          where: {
            application: {
              job: { companyId: employerId },
            },
          },
        }),
        this.prisma.application.findMany({
          where: {
            job: { companyId: employerId },
            status: 'HIRED',
          },
        }),
        this.prisma.payment.findMany({
          where: {
            employerId,
            status: 'COMPLETED',
          },
          select: { amount: true },
        }),
      ]);

      // Job statistics
      const jobStats = jobs.reduce((stats, job) => {
        stats[job.status] = (stats[job.status] || 0) + 1;
        return stats;
      }, {});

      // Application statistics
      const appStats = applications.reduce((stats, app) => {
        stats[app.status] = (stats[app.status] || 0) + 1;
        return stats;
      }, {});

      // Interview statistics
      const interviewStats = interviews.reduce((stats, interview) => {
        stats[interview.status] = (stats[interview.status] || 0) + 1;
        return stats;
      }, {});

      // Time to hire analysis
      const timeToHire = await this.calculateTimeToHire(employerId);

      // Revenue calculation
      const totalRevenue = revenue.reduce((sum, payment) => sum + payment.amount, 0);

      return {
        employer,
        stats: {
          jobs: {
            total: jobs.length,
            byStatus: jobStats,
            active: jobs.filter(j => j.status === 'PUBLISHED').length,
          },
          applications: {
            total: applications.length,
            byStatus: appStats,
            conversionRate: (hires.length / applications.length) * 100 || 0,
          },
          interviews: {
            total: interviews.length,
            byStatus: interviewStats,
            upcoming: interviews.filter(i => 
              new Date(i.scheduledAt) > new Date() && i.status === 'SCHEDULED'
            ).length,
          },
          hires: {
            total: hires.length,
            thisMonth: hires.filter(h => 
              new Date(h.hiredAt) > new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
            ).length,
          },
          financial: {
            totalRevenue,
            averageRevenuePerHire: hires.length > 0 ? totalRevenue / hires.length : 0,
          },
          performance: {
            timeToHire,
            qualityOfHire: await this.calculateQualityOfHire(employerId),
          },
        },
        recentHires: hires.slice(0, 5),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate average time to hire
   */
  async calculateTimeToHire(employerId) {
    try {
      const hires = await this.prisma.application.findMany({
        where: {
          job: { companyId: employerId },
          status: 'HIRED',
          appliedAt: { not: null },
          hiredAt: { not: null },
        },
        select: {
          appliedAt: true,
          hiredAt: true,
        },
      });

      if (hires.length === 0) {
        return 0;
      }

      const totalDays = hires.reduce((sum, hire) => {
        const days = (hire.hiredAt - hire.appliedAt) / (1000 * 60 * 60 * 24);
        return sum + days;
      }, 0);

      return totalDays / hires.length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate quality of hire
   */
  async calculateQualityOfHire(employerId) {
    try {
      const hires = await this.prisma.application.findMany({
        where: {
          job: { companyId: employerId },
          status: 'HIRED',
        },
        include: {
          user: {
            include: {
              reviews: {
                where: {
                  type: 'EMPLOYER_TO_WORKER',
                  revieweeId: employerId,
                },
              },
            },
          },
        },
      });

      if (hires.length === 0) {
        return 0;
      }

      const totalRating = hires.reduce((sum, hire) => {
        const review = hire.user.reviews[0];
        return sum + (review?.rating || 3); // Default to 3 if no review
      }, 0);

      return totalRating / hires.length;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Search employers
   */
  async searchEmployers(filters = {}, pagination = {}) {
    try {
      const {
        query,
        industry,
        companySize,
        location,
        verified,
        hiring,
        ...otherFilters
      } = filters;

      const where = {
        user: {
          status: 'ACTIVE',
          role: 'EMPLOYER',
        },
      };

      // Text search
      if (query) {
        where.OR = [
          { companyName: { contains: query, mode: 'insensitive' } },
          { companyDescription: { contains: query, mode: 'insensitive' } },
          { user: { 
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
          } },
        ];
      }

      // Industry filter
      if (industry) {
        where.industry = industry;
      }

      // Company size filter
      if (companySize) {
        where.companySize = companySize;
      }

      // Location filter
      if (location) {
        where.OR = [
          { companyLocation: { contains: location, mode: 'insensitive' } },
          { city: { contains: location, mode: 'insensitive' } },
          { state: { contains: location, mode: 'insensitive' } },
          { country: { contains: location, mode: 'insensitive' } },
        ];
      }

      // Verification filter
      if (verified !== undefined) {
        where.isVerified = verified;
      }

      // Currently hiring filter
      if (hiring !== undefined) {
        if (hiring) {
          where.jobs = {
            some: {
              status: 'PUBLISHED',
              expiresAt: { gt: new Date() },
            },
          };
        } else {
          where.jobs = {
            none: {
              status: 'PUBLISHED',
              expiresAt: { gt: new Date() },
            },
          };
        }
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      return await this.paginate(where, {
        include: {
          user: {
            include: {
              profile: true,
            },
          },
          jobs: {
            where: {
              status: 'PUBLISHED',
              expiresAt: { gt: new Date() },
            },
            take: 3,
          },
          _count: {
            select: {
              jobs: true,
              reviews: true,
            },
          },
        },
        ...pagination,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer's active jobs
   */
  async getActiveJobs(employerId, options = {}) {
    try {
      return await this.prisma.job.findMany({
        where: {
          companyId: employerId,
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
        },
        include: {
          _count: {
            select: {
              applications: true,
              bookmarks: true,
            },
          },
        },
        orderBy: { postedAt: 'desc' },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer's hiring pipeline
   */
  async getHiringPipeline(employerId) {
    try {
      const jobs = await this.prisma.job.findMany({
        where: {
          companyId: employerId,
          status: 'PUBLISHED',
        },
        select: { id: true },
      });

      const jobIds = jobs.map(job => job.id);

      const applications = await this.prisma.application.findMany({
        where: {
          jobId: { in: jobIds },
        },
        select: {
          status: true,
          appliedAt: true,
        },
      });

      // Group by status
      const byStatus = applications.reduce((acc, app) => {
        acc[app.status] = (acc[app.status] || 0) + 1;
        return acc;
      }, {});

      // Calculate pipeline metrics
      const pipeline = {
        applied: applications.length,
        reviewed: applications.filter(a => 
          ['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED'].includes(a.status)
        ).length,
        interviewed: applications.filter(a => 
          ['INTERVIEWING', 'OFFERED', 'HIRED'].includes(a.status)
        ).length,
        offered: applications.filter(a => 
          ['OFFERED', 'HIRED'].includes(a.status)
        ).length,
        hired: applications.filter(a => a.status === 'HIRED').length,
      };

      // Calculate conversion rates
      const conversionRates = {
        reviewToApply: (pipeline.reviewed / pipeline.applied) * 100,
        interviewToReview: (pipeline.interviewed / pipeline.reviewed) * 100,
        offerToInterview: (pipeline.offered / pipeline.interviewed) * 100,
        hireToOffer: (pipeline.hired / pipeline.offered) * 100,
        overall: (pipeline.hired / pipeline.applied) * 100,
      };

      // Time-based metrics
      const recentApplications = applications.filter(a => 
        new Date(a.appliedAt) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
      );

      return {
        byStatus,
        pipeline,
        conversionRates,
        recentApplications: recentApplications.length,
        activeJobs: jobs.length,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer analytics
   */
  async getEmployerAnalytics(employerId, timeframe = '30d') {
    try {
      const date = new Date();
      switch (timeframe) {
        case '7d':
          date.setDate(date.getDate() - 7);
          break;
        case '30d':
          date.setDate(date.getDate() - 30);
          break;
        case '90d':
          date.setDate(date.getDate() - 90);
          break;
        case '1y':
          date.setFullYear(date.getFullYear() - 1);
          break;
      }

      const [
        jobsPosted,
        applicationsReceived,
        interviewsConducted,
        hiresMade,
        revenueGenerated,
        topPerformingJobs,
        candidateSources,
      ] = await Promise.all([
        this.prisma.job.count({
          where: {
            companyId: employerId,
            postedAt: { gte: date },
          },
        }),
        this.prisma.application.count({
          where: {
            job: { companyId: employerId },
            appliedAt: { gte: date },
          },
        }),
        this.prisma.interview.count({
          where: {
            application: {
              job: { companyId: employerId },
            },
            scheduledAt: { gte: date },
          },
        }),
        this.prisma.application.count({
          where: {
            job: { companyId: employerId },
            status: 'HIRED',
            hiredAt: { gte: date },
          },
        }),
        this.prisma.payment.aggregate({
          where: {
            employerId,
            status: 'COMPLETED',
            createdAt: { gte: date },
          },
          _sum: { amount: true },
        }),
        this.getTopPerformingJobs(employerId, date),
        this.getCandidateSources(employerId, date),
      ]);

      // Calculate metrics
      const metrics = {
        jobsPosted,
        applicationsReceived,
        interviewsConducted,
        hiresMade,
        revenueGenerated: revenueGenerated._sum.amount || 0,
        applicationPerJob: jobsPosted > 0 ? applicationsReceived / jobsPosted : 0,
        interviewToApplication: applicationsReceived > 0 ? interviewsConducted / applicationsReceived : 0,
        hireToInterview: interviewsConducted > 0 ? hiresMade / interviewsConducted : 0,
        costPerHire: hiresMade > 0 ? (revenueGenerated._sum.amount || 0) / hiresMade : 0,
      };

      return {
        metrics,
        topPerformingJobs,
        candidateSources,
        timeframe,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get top performing jobs
   */
  async getTopPerformingJobs(employerId, sinceDate, limit = 5) {
    try {
      const jobs = await this.prisma.job.findMany({
        where: {
          companyId: employerId,
          postedAt: { gte: sinceDate },
        },
        include: {
          _count: {
            select: {
              applications: true,
            },
          },
        },
      });

      // Calculate performance for each job
      const jobPerformance = await Promise.all(
        jobs.map(async job => {
          const applications = await this.prisma.application.findMany({
            where: {
              jobId: job.id,
            },
            select: { status: true },
          });

          const hires = applications.filter(a => a.status === 'HIRED').length;
          const conversionRate = applications.length > 0 ? (hires / applications.length) * 100 : 0;

          return {
            ...job,
            performance: {
              totalApplications: applications.length,
              hires,
              conversionRate,
            },
          };
        })
      );

      // Sort by conversion rate and return top jobs
      return jobPerformance
        .filter(job => job.performance.totalApplications > 0)
        .sort((a, b) => b.performance.conversionRate - a.performance.conversionRate)
        .slice(0, limit);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get candidate sources
   */
  async getCandidateSources(employerId, sinceDate) {
    try {
      const applications = await this.prisma.application.findMany({
        where: {
          job: { companyId: employerId },
          appliedAt: { gte: sinceDate },
        },
        select: { source: true, status: true },
      });

      const sources = {};
      applications.forEach(app => {
        const source = app.source || 'DIRECT';
        if (!sources[source]) {
          sources[source] = {
            total: 0,
            hired: 0,
          };
        }
        sources[source].total++;
        if (app.status === 'HIRED') {
          sources[source].hired++;
        }
      });

      // Convert to array and calculate conversion rates
      return Object.entries(sources).map(([source, data]) => ({
        source,
        total: data.total,
        hired: data.hired,
        conversionRate: (data.hired / data.total) * 100,
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Update company verification status
   */
  async updateVerificationStatus(employerId, status, verifiedBy, notes = null) {
    try {
      const employer = await this.findById(employerId);
      if (!employer) {
        throw new Error('Employer not found');
      }

      const data = {
        isVerified: status === 'APPROVED',
        verificationStatus: status,
        verificationDate: status === 'APPROVED' ? new Date() : null,
        verifiedBy,
        verificationNotes: notes,
      };

      const updated = await this.update(employerId, data);

      // Create verification log
      await this.prisma.adminLog.create({
        data: {
          adminId: verifiedBy,
          action: 'VERIFICATION_UPDATE',
          targetType: 'EMPLOYER',
          targetId: employerId,
          details: {
            previousStatus: employer.verificationStatus,
            newStatus: status,
            notes,
          },
        },
      });

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer verification queue
   */
  async getVerificationQueue(status = 'PENDING', options = {}) {
    try {
      return await this.findMany({
        where: {
          verificationStatus: status,
        },
        include: {
          user: {
            include: {
              profile: true,
            },
          },
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update company branding
   */
  async updateCompanyBranding(employerId, brandingData) {
    try {
      const employer = await this.findById(employerId);
      if (!employer) {
        throw new Error('Employer not found');
      }

      const currentBranding = employer.companyBranding || {};
      const updatedBranding = { ...currentBranding, ...brandingData };

      return await this.update(employerId, {
        companyBranding: updatedBranding,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer team members
   */
  async getTeamMembers(employerId, options = {}) {
    try {
      return await this.prisma.teamMember.findMany({
        where: { employerId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
              role: true,
            },
          },
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Add team member
   */
  async addTeamMember(employerId, userId, role, permissions) {
    try {
      // Check if user exists and is not already a team member
      const existingMember = await this.prisma.teamMember.findFirst({
        where: {
          employerId,
          userId,
        },
      });

      if (existingMember) {
        throw new Error('User is already a team member');
      }

      // Check if user exists and has appropriate role
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      });

      if (!user) {
        throw new Error('User not found');
      }

      return await this.prisma.teamMember.create({
        data: {
          employerId,
          userId,
          role,
          permissions,
          status: 'ACTIVE',
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Remove team member
   */
  async removeTeamMember(employerId, userId) {
    try {
      return await this.prisma.teamMember.deleteMany({
        where: {
          employerId,
          userId,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update team member permissions
   */
  async updateTeamMemberPermissions(memberId, permissions) {
    try {
      return await this.prisma.teamMember.update({
        where: { id: memberId },
        data: { permissions },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer subscription details
   */
  async getSubscriptionDetails(employerId) {
    try {
      return await this.prisma.subscription.findFirst({
        where: {
          employerId,
          status: { in: ['ACTIVE', 'TRIAL'] },
        },
        include: {
          plan: true,
          payments: {
            orderBy: { createdAt: 'desc' },
            take: 5,
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer billing history
   */
  async getBillingHistory(employerId, options = {}) {
    try {
      return await this.prisma.payment.findMany({
        where: {
          employerId,
          status: 'COMPLETED',
        },
        orderBy: { createdAt: 'desc' },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer dashboard data
   */
  async getEmployerDashboard(employerId) {
    try {
      const [
        employer,
        activeJobs,
        recentApplications,
        upcomingInterviews,
        hiringPipeline,
        subscription,
        teamMembers,
      ] = await Promise.all([
        this.getCompleteEmployerProfile(employerId),
        this.getActiveJobs(employerId, { take: 5 }),
        this.prisma.application.findMany({
          where: {
            job: { companyId: employerId },
          },
          include: {
            user: {
              include: {
                profile: true,
              },
            },
            job: true,
          },
          orderBy: { appliedAt: 'desc' },
          take: 10,
        }),
        this.prisma.interview.findMany({
          where: {
            application: {
              job: { companyId: employerId },
            },
            scheduledAt: { gt: new Date() },
            status: 'SCHEDULED',
          },
          include: {
            application: {
              include: {
                user: {
                  select: {
                    id: true,
                    firstName: true,
                    lastName: true,
                    avatar: true,
                  },
                },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
        }),
        this.getHiringPipeline(employerId),
        this.getSubscriptionDetails(employerId),
        this.getTeamMembers(employerId, { take: 5 }),
      ]);

      // Calculate quick stats
      const quickStats = {
        activeJobs: activeJobs.length,
        totalApplications: hiringPipeline.pipeline.applied,
        pendingReview: recentApplications.filter(app => app.status === 'PENDING').length,
        upcomingInterviews: upcomingInterviews.length,
        openPositions: activeJobs.filter(job => 
          job._count.applications < job.maxApplications
        ).length,
        teamMembers: teamMembers.length,
      };

      return {
        employer,
        stats: quickStats,
        activeJobs,
        recentApplications,
        upcomingInterviews,
        hiringPipeline,
        subscription,
        teamMembers,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer hiring trends
   */
  async getHiringTrends(employerId, period = 'monthly') {
    try {
      const date = new Date();
      let months = 6;

      switch (period) {
        case '3months':
          months = 3;
          break;
        case '6months':
          months = 6;
          break;
        case '1year':
          months = 12;
          break;
        case '2years':
          months = 24;
          break;
      }

      date.setMonth(date.getMonth() - months);

      const [
        jobsPosted,
        applicationsReceived,
        interviewsConducted,
        hiresMade,
      ] = await Promise.all([
        this.prisma.job.groupBy({
          by: ['postedAt'],
          where: {
            companyId: employerId,
            postedAt: { gte: date },
          },
          _count: { _all: true },
        }),
        this.prisma.application.groupBy({
          by: ['appliedAt'],
          where: {
            job: { companyId: employerId },
            appliedAt: { gte: date },
          },
          _count: { _all: true },
        }),
        this.prisma.interview.groupBy({
          by: ['scheduledAt'],
          where: {
            application: {
              job: { companyId: employerId },
            },
            scheduledAt: { gte: date },
          },
          _count: { _all: true },
        }),
        this.prisma.application.groupBy({
          by: ['hiredAt'],
          where: {
            job: { companyId: employerId },
            status: 'HIRED',
            hiredAt: { gte: date },
          },
          _count: { _all: true },
        }),
      ]);

      // Process data by month
      const trends = [];
      for (let i = months - 1; i >= 0; i--) {
        const currentDate = new Date();
        currentDate.setMonth(currentDate.getMonth() - i);
        const monthKey = currentDate.toISOString().slice(0, 7); // YYYY-MM

        const jobs = jobsPosted.filter(j => 
          j.postedAt.toISOString().slice(0, 7) === monthKey
        ).reduce((sum, j) => sum + j._count._all, 0);

        const applications = applicationsReceived.filter(a => 
          a.appliedAt.toISOString().slice(0, 7) === monthKey
        ).reduce((sum, a) => sum + a._count._all, 0);

        const interviews = interviewsConducted.filter(i => 
          i.scheduledAt.toISOString().slice(0, 7) === monthKey
        ).reduce((sum, i) => sum + i._count._all, 0);

        const hires = hiresMade.filter(h => 
          h.hiredAt?.toISOString().slice(0, 7) === monthKey
        ).reduce((sum, h) => sum + h._count._all, 0);

        trends.push({
          month: monthKey,
          jobs,
          applications,
          interviews,
          hires,
          conversionRate: applications > 0 ? (hires / applications) * 100 : 0,
        });
      }

      return trends;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer comparison benchmarks
   */
  async getBenchmarkData(employerId, industry = null) {
    try {
      const employer = await this.findById(employerId);
      const targetIndustry = industry || employer.industry;

      // Get employer's metrics
      const employerMetrics = await this.getEmployerStats(employerId);

      // Get industry averages
      const industryAverages = await this.calculateIndustryAverages(targetIndustry);

      // Calculate percentile rankings
      const benchmarks = {
        applicationVolume: this.calculatePercentile(
          employerMetrics.stats.applications.total,
          industryAverages.applications
        ),
        timeToHire: this.calculatePercentile(
          employerMetrics.stats.performance.timeToHire,
          industryAverages.timeToHire,
          false // Lower is better
        ),
        costPerHire: this.calculatePercentile(
          employerMetrics.stats.financial.averageRevenuePerHire,
          industryAverages.costPerHire,
          false // Lower is better
        ),
        qualityOfHire: this.calculatePercentile(
          employerMetrics.stats.performance.qualityOfHire,
          industryAverages.qualityOfHire
        ),
      };

      // Generate recommendations
      const recommendations = this.generateBenchmarkRecommendations(benchmarks);

      return {
        employerMetrics,
        industryAverages,
        benchmarks,
        recommendations,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate industry averages
   */
  async calculateIndustryAverages(industry) {
    try {
      const employers = await this.findMany({
        where: { industry },
        include: {
          _count: {
            select: {
              jobs: true,
            },
          },
        },
      });

      // This is a simplified implementation
      // In production, you would use actual industry data
      return {
        applications: 50,
        timeToHire: 30,
        costPerHire: 5000,
        qualityOfHire: 4.0,
        sampleSize: employers.length,
      };
    } catch (error) {
      return {
        applications: 0,
        timeToHire: 0,
        costPerHire: 0,
        qualityOfHire: 0,
        sampleSize: 0,
      };
    }
  }

  /**
   * Calculate percentile
   */
  calculatePercentile(value, average, higherIsBetter = true) {
    if (average === 0) return 50;

    const ratio = value / average;
    let percentile;

    if (higherIsBetter) {
      percentile = ratio >= 1 ? 50 + (ratio - 1) * 25 : 50 - (1 - ratio) * 50;
    } else {
      percentile = ratio <= 1 ? 50 + (1 - ratio) * 25 : 50 - (ratio - 1) * 50;
    }

    return Math.min(100, Math.max(0, percentile));
  }

  /**
   * Generate benchmark recommendations
   */
  generateBenchmarkRecommendations(benchmarks) {
    const recommendations = [];

    if (benchmarks.applicationVolume < 30) {
      recommendations.push({
        category: 'APPLICATION_VOLUME',
        title: 'Increase Application Volume',
        description: 'Your application volume is below average. Consider improving job postings and marketing.',
        priority: 'HIGH',
      });
    }

    if (benchmarks.timeToHire < 40) {
      recommendations.push({
        category: 'TIME_TO_HIRE',
        title: 'Reduce Time to Hire',
        description: 'Your hiring process is slower than industry average. Consider streamlining interviews.',
        priority: 'MEDIUM',
      });
    }

    if (benchmarks.costPerHire < 40) {
      recommendations.push({
        category: 'COST_PER_HIRE',
        title: 'Optimize Hiring Costs',
        description: 'Your cost per hire is higher than average. Consider more efficient sourcing strategies.',
        priority: 'MEDIUM',
      });
    }

    if (benchmarks.qualityOfHire < 40) {
      recommendations.push({
        category: 'QUALITY_OF_HIRE',
        title: 'Improve Quality of Hire',
        description: 'New hire satisfaction is below average. Consider improving selection criteria.',
        priority: 'HIGH',
      });
    }

    return recommendations;
  }

  /**
   * Export employer data
   */
  async exportEmployerData(employerId) {
    try {
      const [
        employer,
        jobs,
        applications,
        interviews,
        hires,
        payments,
        subscriptions,
        teamMembers,
        reviews,
      ] = await Promise.all([
        this.findById(employerId),
        this.prisma.job.findMany({
          where: { companyId: employerId },
          include: {
            _count: {
              select: {
                applications: true,
              },
            },
          },
        }),
        this.prisma.application.findMany({
          where: {
            job: { companyId: employerId },
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            job: {
              select: {
                title: true,
              },
            },
          },
        }),
        this.prisma.interview.findMany({
          where: {
            application: {
              job: { companyId: employerId },
            },
          },
          include: {
            application: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                  },
                },
              },
            },
          },
        }),
        this.prisma.application.findMany({
          where: {
            job: { companyId: employerId },
            status: 'HIRED',
          },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            job: {
              select: {
                title: true,
              },
            },
          },
        }),
        this.prisma.payment.findMany({
          where: { employerId },
        }),
        this.prisma.subscription.findMany({
          where: { employerId },
          include: { plan: true },
        }),
        this.prisma.teamMember.findMany({
          where: { employerId },
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        }),
        this.prisma.review.findMany({
          where: { revieweeId: employerId },
          include: {
            reviewer: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        }),
      ]);

      return {
        companyInformation: employer,
        jobs: {
          total: jobs.length,
          data: jobs,
        },
        applications: {
          total: applications.length,
          data: applications,
        },
        interviews: {
          total: interviews.length,
          data: interviews,
        },
        hires: {
          total: hires.length,
          data: hires,
        },
        financial: {
          payments,
          subscriptions,
        },
        team: teamMembers,
        reviews,
        exportDate: new Date().toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }
}

module.exports = EmployerRepository;
