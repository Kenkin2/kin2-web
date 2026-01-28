const IUserRepository = require('../interfaces/IUserRepository');
const BaseRepository = require('../BaseRepository');

class UserRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'user');
  }

  /**
   * Find user by email
   */
  async findByEmail(email, options = {}) {
    try {
      return await this.model.findUnique({
        where: { email },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find user by phone
   */
  async findByPhone(phone, options = {}) {
    try {
      return await this.model.findFirst({
        where: { phone },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find user by verification token
   */
  async findByVerificationToken(token, options = {}) {
    try {
      return await this.model.findFirst({
        where: { verificationToken: token },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find user by reset token
   */
  async findByResetToken(token, options = {}) {
    try {
      return await this.model.findFirst({
        where: {
          resetToken: token,
          resetTokenExpiry: {
            gt: new Date(),
          },
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update user password
   */
  async updatePassword(id, password) {
    try {
      return await this.model.update({
        where: { id },
        data: {
          password,
          resetToken: null,
          resetTokenExpiry: null,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Verify user email
   */
  async verifyEmail(id) {
    try {
      return await this.model.update({
        where: { id },
        data: {
          emailVerified: true,
          verificationToken: null,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get users by role
   */
  async findByRole(role, options = {}) {
    try {
      return await this.model.findMany({
        where: { role },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get users with pagination and filters
   */
  async findWithFilters(filters = {}, pagination = {}) {
    try {
      const {
        search,
        role,
        status,
        emailVerified,
        phoneVerified,
        dateFrom,
        dateTo,
        ...otherFilters
      } = filters;

      const where = {};

      // Text search
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Role filter
      if (role) {
        where.role = role;
      }

      // Status filter
      if (status) {
        where.status = status;
      }

      // Verification filters
      if (emailVerified !== undefined) {
        where.emailVerified = emailVerified;
      }
      if (phoneVerified !== undefined) {
        where.phoneVerified = phoneVerified;
      }

      // Date range filters
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.createdAt.lte = new Date(dateTo);
        }
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      return await this.paginate(where, pagination);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user statistics
   */
  async getUserStats(userId) {
    try {
      const [user, profile, workerProfile, employerProfile] = await Promise.all([
        this.findById(userId),
        this.prisma.profile.findUnique({ where: { userId } }),
        this.prisma.workerProfile.findUnique({ where: { userId } }),
        this.prisma.employerProfile.findUnique({ where: { userId } }),
      ]);

      // Get application stats for workers
      let applicationStats = {};
      if (user.role === 'WORKER' || user.role === 'FREELANCER') {
        const applications = await this.prisma.application.groupBy({
          by: ['status'],
          where: { userId },
          _count: { _all: true },
        });

        applicationStats = applications.reduce((acc, app) => {
          acc[app.status] = app._count._all;
          return acc;
        }, {});
      }

      // Get job stats for employers
      let jobStats = {};
      if (user.role === 'EMPLOYER') {
        const jobs = await this.prisma.job.groupBy({
          by: ['status'],
          where: { companyId: employerProfile?.id },
          _count: { _all: true },
        });

        jobStats = jobs.reduce((acc, job) => {
          acc[job.status] = job._count._all;
          return acc;
        }, {});
      }

      return {
        user,
        profile,
        workerProfile,
        employerProfile,
        stats: {
          applications: applicationStats,
          jobs: jobStats,
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update user last login
   */
  async updateLastLogin(id) {
    try {
      return await this.model.update({
        where: { id },
        data: { lastLogin: new Date() },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Search users
   */
  async search(query, options = {}) {
    try {
      return await this.model.findMany({
        where: {
          OR: [
            { email: { contains: query, mode: 'insensitive' } },
            { firstName: { contains: query, mode: 'insensitive' } },
            { lastName: { contains: query, mode: 'insensitive' } },
          ],
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user with related data
   */
  async findByIdWithRelations(id, include = []) {
    try {
      const includes = {};

      // Dynamically build include object
      if (Array.isArray(include)) {
        include.forEach(relation => {
          includes[relation] = true;
        });
      }

      return await this.model.findUnique({
        where: { id },
        include: includes,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user dashboard data
   */
  async getUserDashboard(userId) {
    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      let dashboardData = {
        user,
        notifications: [],
        stats: {},
        recentActivity: [],
        upcomingEvents: [],
      };

      // Common data for all roles
      const [notifications, sessions] = await Promise.all([
        this.prisma.notification.findMany({
          where: { userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.session.findMany({
          where: { userId, isValid: true },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
      ]);

      dashboardData.notifications = notifications;
      dashboardData.recentActivity = sessions.map(session => ({
        type: 'SESSION',
        description: 'Logged in',
        timestamp: session.createdAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      }));

      // Role-specific dashboard data
      switch (user.role) {
        case 'WORKER':
        case 'FREELANCER':
          dashboardData = await this.getWorkerDashboard(userId, dashboardData);
          break;
        case 'EMPLOYER':
          dashboardData = await this.getEmployerDashboard(userId, dashboardData);
          break;
        case 'ADMIN':
          dashboardData = await this.getAdminDashboard(dashboardData);
          break;
      }

      return dashboardData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get worker dashboard data
   */
  async getWorkerDashboard(userId, dashboardData) {
    try {
      const [
        applications,
        bookmarks,
        kfnScores,
        interviews,
        skills,
      ] = await Promise.all([
        this.prisma.application.findMany({
          where: { userId },
          include: {
            job: {
              include: {
                company: true,
              },
            },
          },
          orderBy: { appliedAt: 'desc' },
          take: 10,
        }),
        this.prisma.bookmark.findMany({
          where: { userId },
          include: {
            job: {
              include: {
                company: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        this.prisma.kFN.findMany({
          where: { userId },
          orderBy: { calculatedAt: 'desc' },
          take: 5,
        }),
        this.prisma.interview.findMany({
          where: { intervieweeId: userId },
          orderBy: { scheduledAt: 'desc' },
          take: 5,
        }),
        this.prisma.userSkill.findMany({
          where: { userId },
          include: { skill: true },
          orderBy: { isPrimary: 'desc' },
          take: 10,
        }),
      ]);

      // Application statistics
      const appStats = applications.reduce((stats, app) => {
        stats[app.status] = (stats[app.status] || 0) + 1;
        return stats;
      }, {});

      // KFN statistics
      const avgKFN = kfnScores.length > 0
        ? kfnScores.reduce((sum, kfn) => sum + kfn.overallScore, 0) / kfnScores.length
        : 0;

      // Upcoming interviews
      const upcomingInterviews = interviews.filter(
        interview => new Date(interview.scheduledAt) > new Date()
      );

      dashboardData.applications = applications;
      dashboardData.bookmarks = bookmarks;
      dashboardData.interviews = interviews;
      dashboardData.skills = skills;
      dashboardData.upcomingEvents = upcomingInterviews.map(interview => ({
        type: 'INTERVIEW',
        title: interview.title,
        description: `Interview for ${interview.type}`,
        timestamp: interview.scheduledAt,
        status: interview.status,
      }));
      dashboardData.stats = {
        totalApplications: applications.length,
        applicationStats: appStats,
        totalBookmarks: bookmarks.length,
        totalInterviews: interviews.length,
        upcomingInterviews: upcomingInterviews.length,
        avgKFNScore: avgKFN,
        totalSkills: skills.length,
      };

      return dashboardData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get employer dashboard data
   */
  async getEmployerDashboard(userId, dashboardData) {
    try {
      const employerProfile = await this.prisma.employerProfile.findUnique({
        where: { userId },
      });

      if (!employerProfile) {
        return dashboardData;
      }

      const [
        jobs,
        applications,
        interviews,
        companyReviews,
      ] = await Promise.all([
        this.prisma.job.findMany({
          where: { companyId: employerProfile.id },
          orderBy: { postedAt: 'desc' },
          take: 10,
        }),
        this.prisma.application.findMany({
          where: {
            job: {
              companyId: employerProfile.id,
            },
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
              job: {
                companyId: employerProfile.id,
              },
            },
          },
          orderBy: { scheduledAt: 'desc' },
          take: 10,
        }),
        this.prisma.review.findMany({
          where: { revieweeId: userId },
          orderBy: { createdAt: 'desc' },
          take: 5,
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

      // Upcoming interviews
      const upcomingInterviews = interviews.filter(
        interview => new Date(interview.scheduledAt) > new Date()
      );

      dashboardData.jobs = jobs;
      dashboardData.applications = applications;
      dashboardData.interviews = interviews;
      dashboardData.reviews = companyReviews;
      dashboardData.upcomingEvents = upcomingInterviews.map(interview => ({
        type: 'INTERVIEW',
        title: interview.title,
        description: `Interview with ${interview.intervieweeId}`,
        timestamp: interview.scheduledAt,
        status: interview.status,
      }));
      dashboardData.stats = {
        totalJobs: jobs.length,
        jobStats,
        totalApplications: applications.length,
        applicationStats: appStats,
        totalInterviews: interviews.length,
        upcomingInterviews: upcomingInterviews.length,
        avgReviewRating: companyReviews.length > 0
          ? companyReviews.reduce((sum, review) => sum + review.rating, 0) / companyReviews.length
          : 0,
      };

      return dashboardData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get admin dashboard data
   */
  async getAdminDashboard(dashboardData) {
    try {
      const [
        totalUsers,
        totalJobs,
        totalApplications,
        totalPayments,
        recentUsers,
        recentJobs,
        platformStats,
      ] = await Promise.all([
        this.count(),
        this.prisma.job.count(),
        this.prisma.application.count(),
        this.prisma.payment.count(),
        this.findMany({
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.prisma.job.findMany({
          orderBy: { postedAt: 'desc' },
          take: 10,
          include: { company: true },
        }),
        this.getPlatformStats(),
      ]);

      dashboardData.stats = {
        totalUsers,
        totalJobs,
        totalApplications,
        totalPayments,
        ...platformStats,
      };
      dashboardData.recentUsers = recentUsers;
      dashboardData.recentJobs = recentJobs;

      return dashboardData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get platform statistics
   */
  async getPlatformStats() {
    try {
      const [
        usersByRole,
        usersByStatus,
        jobsByStatus,
        applicationsByStatus,
        monthlyGrowth,
      ] = await Promise.all([
        this.model.groupBy({
          by: ['role'],
          _count: { _all: true },
        }),
        this.model.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.job.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.application.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.getMonthlyGrowth(),
      ]);

      return {
        usersByRole: usersByRole.reduce((acc, item) => {
          acc[item.role] = item._count._all;
          return acc;
        }, {}),
        usersByStatus: usersByStatus.reduce((acc, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {}),
        jobsByStatus: jobsByStatus.reduce((acc, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {}),
        applicationsByStatus: applicationsByStatus.reduce((acc, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {}),
        monthlyGrowth,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get monthly growth statistics
   */
  async getMonthlyGrowth() {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const [userGrowth, jobGrowth, applicationGrowth] = await Promise.all([
        this.model.groupBy({
          by: ['createdAt'],
          where: {
            createdAt: {
              gte: sixMonthsAgo,
            },
          },
          _count: { _all: true },
        }),
        this.prisma.job.groupBy({
          by: ['postedAt'],
          where: {
            postedAt: {
              gte: sixMonthsAgo,
            },
          },
          _count: { _all: true },
        }),
        this.prisma.application.groupBy({
          by: ['appliedAt'],
          where: {
            appliedAt: {
              gte: sixMonthsAgo,
            },
          },
          _count: { _all: true },
        }),
      ]);

      // Format data for charts
      const months = [];
      for (let i = 5; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        months.push(date.toISOString().slice(0, 7));
      }

      const growthData = months.map(month => {
        const userCount = userGrowth.filter(g =>
          g.createdAt.toISOString().slice(0, 7) === month
        ).reduce((sum, g) => sum + g._count._all, 0);

        const jobCount = jobGrowth.filter(g =>
          g.postedAt.toISOString().slice(0, 7) === month
        ).reduce((sum, g) => sum + g._count._all, 0);

        const applicationCount = applicationGrowth.filter(g =>
          g.appliedAt.toISOString().slice(0, 7) === month
        ).reduce((sum, g) => sum + g._count._all, 0);

        return {
          month,
          users: userCount,
          jobs: jobCount,
          applications: applicationCount,
        };
      });

      return growthData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update user notification preferences
   */
  async updateNotificationPreferences(userId, preferences) {
    try {
      const user = await this.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const currentPreferences = user.notifications || {};
      const updatedPreferences = { ...currentPreferences, ...preferences };

      return await this.model.update({
        where: { id: userId },
        data: { notifications: updatedPreferences },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user sessions
   */
  async getUserSessions(userId, options = {}) {
    try {
      return await this.prisma.session.findMany({
        where: { userId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Invalidate user sessions
   */
  async invalidateSessions(userId, exceptSessionId = null) {
    try {
      const where = { userId };
      if (exceptSessionId) {
        where.NOT = { id: exceptSessionId };
      }

      return await this.prisma.session.updateMany({
        where,
        data: { isValid: false, logoutAt: new Date() },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user activity log
   */
  async getUserActivity(userId, options = {}) {
    try {
      const {
        type,
        action,
        dateFrom,
        dateTo,
        limit = 50,
        page = 1,
      } = options;

      const where = { userId: userId };

      if (type) {
        where.type = type;
      }
      if (action) {
        where.action = action;
      }
      if (dateFrom || dateTo) {
        where.createdAt = {};
        if (dateFrom) {
          where.createdAt.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.createdAt.lte = new Date(dateTo);
        }
      }

      const skip = (page - 1) * limit;

      const [activities, total] = await Promise.all([
        this.prisma.analyticsEvent.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: limit,
        }),
        this.prisma.analyticsEvent.count({ where }),
      ]);

      return {
        activities,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Export user data (GDPR compliance)
   */
  async exportUserData(userId) {
    try {
      const [
        user,
        profile,
        workerProfile,
        employerProfile,
        applications,
        interviews,
        messages,
        payments,
        subscriptions,
        reviewsGiven,
        reviewsReceived,
        skills,
        experiences,
        educations,
        certificates,
        sessions,
        notifications,
        analyticsEvents,
      ] = await Promise.all([
        this.findById(userId),
        this.prisma.profile.findUnique({ where: { userId } }),
        this.prisma.workerProfile.findUnique({ where: { userId } }),
        this.prisma.employerProfile.findUnique({ where: { userId } }),
        this.prisma.application.findMany({
          where: { userId },
          include: { job: true },
        }),
        this.prisma.interview.findMany({
          where: { intervieweeId: userId },
          include: { application: true },
        }),
        this.prisma.message.findMany({
          where: { senderId: userId },
          include: { conversation: true },
        }),
        this.prisma.payment.findMany({ where: { userId } }),
        this.prisma.subscription.findMany({ where: { userId } }),
        this.prisma.review.findMany({
          where: { reviewerId: userId },
          include: { reviewee: true },
        }),
        this.prisma.review.findMany({
          where: { revieweeId: userId },
          include: { reviewer: true },
        }),
        this.prisma.userSkill.findMany({
          where: { userId },
          include: { skill: true },
        }),
        this.prisma.experience.findMany({ where: { userId } }),
        this.prisma.education.findMany({ where: { userId } }),
        this.prisma.certificate.findMany({ where: { userId } }),
        this.prisma.session.findMany({ where: { userId } }),
        this.prisma.notification.findMany({ where: { userId } }),
        this.prisma.analyticsEvent.findMany({ where: { userId } }),
      ]);

      return {
        personalInformation: {
          user,
          profile,
          workerProfile,
          employerProfile,
        },
        professionalInformation: {
          skills,
          experiences,
          educations,
          certificates,
        },
        jobRelated: {
          applications,
          interviews,
          reviewsGiven,
          reviewsReceived,
        },
        financialInformation: {
          payments,
          subscriptions,
        },
        communication: {
          messages,
          notifications,
        },
        systemData: {
          sessions,
          analyticsEvents,
        },
        exportDate: new Date().toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Anonymize user data (GDPR compliance)
   */
  async anonymizeUserData(userId) {
    try {
      return await this.transaction(async (prisma) => {
        // Generate anonymous identifier
        const anonymousId = `anonymous_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Anonymize user data
        await prisma.user.update({
          where: { id: userId },
          data: {
            email: `${anonymousId}@anonymized.kin2.com`,
            password: 'ANONYMIZED',
            firstName: 'Anonymous',
            lastName: 'User',
            phone: null,
            avatar: null,
            bio: null,
            dateOfBirth: null,
            googleId: null,
            linkedinId: null,
            githubId: null,
            verificationToken: null,
            resetToken: null,
            resetTokenExpiry: null,
            deletedAt: new Date(),
          },
        });

        // Anonymize profile
        await prisma.profile.updateMany({
          where: { userId },
          data: {
            headline: 'Anonymized Profile',
            summary: 'This user profile has been anonymized.',
            website: null,
            linkedin: null,
            github: null,
            twitter: null,
            currentTitle: null,
            currentCompany: null,
          },
        });

        // Anonymize messages (keep for other users but remove sender info)
        await prisma.message.updateMany({
          where: { senderId: userId },
          data: {
            content: '[Message content removed due to user deletion]',
            mediaUrl: null,
          },
        });

        return { success: true, anonymousId };
      });
    } catch (error) {
      this.handleError(error);
    }
  }
}

module.exports = UserRepository;
