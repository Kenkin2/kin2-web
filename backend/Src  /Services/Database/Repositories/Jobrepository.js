const BaseRepository = require('../BaseRepository');

class JobRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'job');
  }

  /**
   * Create job with company validation
   */
  async create(data) {
    try {
      // Verify company exists
      const company = await this.prisma.employerProfile.findUnique({
        where: { id: data.companyId },
      });

      if (!company) {
        throw new Error('Company not found');
      }

      // Generate slug
      const slug = this.generateSlug(data.title, data.companyId);

      return await this.model.create({
        data: {
          ...data,
          slug,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Generate unique slug for job
   */
  generateSlug(title, companyId) {
    const baseSlug = title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

    const timestamp = Date.now();
    return `${baseSlug}-${companyId}-${timestamp}`;
  }

  /**
   * Find job by slug
   */
  async findBySlug(slug, options = {}) {
    try {
      return await this.model.findUnique({
        where: { slug },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find jobs by company ID
   */
  async findByCompanyId(companyId, options = {}) {
    try {
      return await this.findMany({
        where: { companyId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find jobs by category
   */
  async findByCategory(category, options = {}) {
    try {
      return await this.findMany({
        where: { category },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find jobs by status
   */
  async findByStatus(status, options = {}) {
    try {
      return await this.findMany({
        where: { status },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Search jobs with advanced filters
   */
  async searchJobs(filters = {}, pagination = {}) {
    try {
      const {
        query,
        category,
        location,
        remote,
        minSalary,
        maxSalary,
        experienceLevel,
        jobType,
        employmentType,
        datePosted,
        companyId,
        status = 'PUBLISHED',
        ...otherFilters
      } = filters;

      const where = {
        status,
        expiresAt: { gt: new Date() },
      };

      // Text search
      if (query) {
        where.OR = [
          { title: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { requirements: { contains: query, mode: 'insensitive' } },
          { company: { companyName: { contains: query, mode: 'insensitive' } } },
        ];
      }

      // Category filter
      if (category) {
        where.category = category;
      }

      // Location filter
      if (location) {
        where.OR = [
          { location: { contains: location, mode: 'insensitive' } },
          { city: { contains: location, mode: 'insensitive' } },
          { state: { contains: location, mode: 'insensitive' } },
          { country: { contains: location, mode: 'insensitive' } },
        ];
      }

      // Remote filter
      if (remote !== undefined) {
        if (remote) {
          where.isRemote = true;
        } else {
          where.isRemote = false;
        }
      }

      // Salary range filter
      if (minSalary !== undefined || maxSalary !== undefined) {
        where.AND = [];
        if (minSalary !== undefined) {
          where.AND.push({
            OR: [
              { minSalary: { gte: minSalary } },
              { minSalary: null },
            ],
          });
        }
        if (maxSalary !== undefined) {
          where.AND.push({
            OR: [
              { maxSalary: { lte: maxSalary } },
              { maxSalary: null },
            ],
          });
        }
      }

      // Experience level filter
      if (experienceLevel) {
        where.experienceLevel = experienceLevel;
      }

      // Job type filter
      if (jobType) {
        where.jobType = jobType;
      }

      // Employment type filter
      if (employmentType) {
        where.employmentType = employmentType;
      }

      // Date posted filter
      if (datePosted) {
        const date = new Date();
        switch (datePosted) {
          case 'today':
            date.setDate(date.getDate() - 1);
            break;
          case 'week':
            date.setDate(date.getDate() - 7);
            break;
          case 'month':
            date.setMonth(date.getMonth() - 1);
            break;
          case '3months':
            date.setMonth(date.getMonth() - 3);
            break;
        }
        where.postedAt = { gte: date };
      }

      // Company filter
      if (companyId) {
        where.companyId = companyId;
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      return await this.paginate(where, {
        include: {
          company: true,
          _count: {
            select: {
              applications: true,
              bookmarks: true,
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
   * Get job with full details
   */
  async getJobWithDetails(id, userId = null) {
    try {
      const job = await this.model.findUnique({
        where: { id },
        include: {
          company: {
            include: {
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  email: true,
                  avatar: true,
                },
              },
            },
          },
          _count: {
            select: {
              applications: true,
              bookmarks: true,
            },
          },
        },
      });

      if (!job) {
        return null;
      }

      let userApplication = null;
      let isBookmarked = false;
      let kfnScore = null;

      // Get user-specific data if userId provided
      if (userId) {
        [userApplication, isBookmarked, kfnScore] = await Promise.all([
          this.prisma.application.findFirst({
            where: {
              jobId: id,
              userId,
            },
            select: {
              id: true,
              status: true,
              appliedAt: true,
              kfnScore: true,
            },
          }),
          this.prisma.bookmark.findFirst({
            where: {
              jobId: id,
              userId,
            },
          }).then(bookmark => !!bookmark),
          this.prisma.kFN.findFirst({
            where: {
              jobId: id,
              userId,
            },
            select: {
              overallScore: true,
              calculatedAt: true,
            },
          }),
        ]);
      }

      // Increment view count
      await this.model.update({
        where: { id },
        data: {
          views: {
            increment: 1,
          },
        },
      });

      return {
        ...job,
        userApplication,
        isBookmarked,
        kfnScore: kfnScore?.overallScore || null,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get similar jobs
   */
  async getSimilarJobs(jobId, limit = 5) {
    try {
      const job = await this.findById(jobId);
      if (!job) {
        return [];
      }

      return await this.findMany({
        where: {
          id: { not: jobId },
          OR: [
            { category: job.category },
            { title: { contains: job.title.split(' ')[0], mode: 'insensitive' } },
            { companyId: job.companyId },
          ],
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
        },
        include: {
          company: true,
        },
        orderBy: { postedAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get trending jobs
   */
  async getTrendingJobs(limit = 10) {
    try {
      return await this.findMany({
        where: {
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
        },
        include: {
          company: true,
          _count: {
            select: {
              applications: true,
              bookmarks: true,
            },
          },
        },
        orderBy: [
          { views: 'desc' },
          { applications: 'desc' },
        ],
        take: limit,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get jobs by experience level
   */
  async getJobsByExperienceLevel(level, options = {}) {
    try {
      return await this.findMany({
        where: {
          experienceLevel: level,
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
        },
        include: {
          company: true,
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get remote jobs
   */
  async getRemoteJobs(options = {}) {
    try {
      return await this.findMany({
        where: {
          isRemote: true,
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
        },
        include: {
          company: true,
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update job status
   */
  async updateStatus(id, status) {
    try {
      const data = { status };

      // Set closed date if closing job
      if (['CLOSED', 'EXPIRED'].includes(status)) {
        data.closedAt = new Date();
      }

      // Set published date if publishing
      if (status === 'PUBLISHED') {
        data.postedAt = new Date();
      }

      return await this.update(id, data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Close expired jobs
   */
  async closeExpiredJobs() {
    try {
      const expiredJobs = await this.findMany({
        where: {
          expiresAt: { lt: new Date() },
          status: 'PUBLISHED',
        },
      });

      if (expiredJobs.length === 0) {
        return { closed: 0 };
      }

      const result = await this.updateMany({
        expiresAt: { lt: new Date() },
        status: 'PUBLISHED',
      }, {
        status: 'EXPIRED',
        closedAt: new Date(),
      });

      return { closed: result.count };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get job statistics
   */
  async getJobStats(jobId) {
    try {
      const [
        job,
        applications,
        interviews,
        kfnScores,
      ] = await Promise.all([
        this.findById(jobId),
        this.prisma.application.findMany({
          where: { jobId },
          include: {
            user: {
              include: {
                profile: true,
              },
            },
          },
        }),
        this.prisma.interview.findMany({
          where: {
            application: { jobId },
          },
        }),
        this.prisma.kFN.findMany({
          where: { jobId },
        }),
      ]);

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

      // KFN statistics
      const kfnStats = {
        avgScore: kfnScores.length > 0
          ? kfnScores.reduce((sum, kfn) => sum + kfn.overallScore, 0) / kfnScores.length
          : 0,
        highestScore: kfnScores.length > 0
          ? Math.max(...kfnScores.map(k => k.overallScore))
          : 0,
        lowestScore: kfnScores.length > 0
          ? Math.min(...kfnScores.map(k => k.overallScore))
          : 0,
        distribution: this.calculateScoreDistribution(kfnScores),
      };

      // Candidate quality analysis
      const candidateAnalysis = {
        total: applications.length,
        shortlisted: applications.filter(a => a.status === 'SHORTLISTED').length,
        interviewed: applications.filter(a => a.status === 'INTERVIEWING').length,
        offered: applications.filter(a => a.status === 'OFFERED').length,
        hired: applications.filter(a => a.status === 'HIRED').length,
        avgKFN: kfnStats.avgScore,
      };

      // Top candidates by KFN score
      const topCandidates = applications
        .filter(app => app.kfnScore !== null)
        .sort((a, b) => (b.kfnScore || 0) - (a.kfnScore || 0))
        .slice(0, 5)
        .map(app => ({
          userId: app.userId,
          name: `${app.user?.firstName} ${app.user?.lastName}`,
          kfnScore: app.kfnScore,
          status: app.status,
          appliedAt: app.appliedAt,
        }));

      return {
        job,
        stats: {
          applications: appStats,
          interviews: interviewStats,
          kfn: kfnStats,
          candidateAnalysis,
        },
        topCandidates,
        totalApplications: applications.length,
        totalInterviews: interviews.length,
        conversionRate: candidateAnalysis.hired / (applications.length || 1) * 100,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate KFN score distribution
   */
  calculateScoreDistribution(kfnScores) {
    const distribution = {
      excellent: 0, // 90-100
      good: 0,      // 75-89
      average: 0,   // 60-74
      poor: 0,      // 0-59
    };

    kfnScores.forEach(kfn => {
      const score = kfn.overallScore;
      if (score >= 90) {
        distribution.excellent++;
      } else if (score >= 75) {
        distribution.good++;
      } else if (score >= 60) {
        distribution.average++;
      } else {
        distribution.poor++;
      }
    });

    return distribution;
  }

  /**
   * Get job application funnel
   */
  async getJobApplicationFunnel(jobId) {
    try {
      const applications = await this.prisma.application.findMany({
        where: { jobId },
        select: { status: true },
      });

      const funnel = {
        applied: 0,
        screened: 0,
        interviewed: 0,
        offered: 0,
        hired: 0,
      };

      applications.forEach(app => {
        funnel.applied++;

        if (['REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'HIRED'].includes(app.status)) {
          funnel.screened++;
        }

        if (['INTERVIEWING', 'OFFERED', 'HIRED'].includes(app.status)) {
          funnel.interviewed++;
        }

        if (['OFFERED', 'HIRED'].includes(app.status)) {
          funnel.offered++;
        }

        if (app.status === 'HIRED') {
          funnel.hired++;
        }
      });

      // Calculate conversion rates
      const conversionRates = {
        screenToApply: (funnel.screened / funnel.applied) * 100,
        interviewToScreen: (funnel.interviewed / funnel.screened) * 100,
        offerToInterview: (funnel.offered / funnel.interviewed) * 100,
        hireToOffer: (funnel.hired / funnel.offered) * 100,
        overall: (funnel.hired / funnel.applied) * 100,
      };

      return {
        funnel,
        conversionRates,
        totalApplications: applications.length,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get job market insights
   */
  async getJobMarketInsights(filters = {}) {
    try {
      const {
        category,
        location,
        dateRange = '30d',
      } = filters;

      const date = new Date();
      switch (dateRange) {
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

      const where = {
        status: 'PUBLISHED',
        postedAt: { gte: date },
      };

      if (category) {
        where.category = category;
      }

      if (location) {
        where.OR = [
          { location: { contains: location, mode: 'insensitive' } },
          { city: { contains: location, mode: 'insensitive' } },
          { state: { contains: location, mode: 'insensitive' } },
          { country: { contains: location, mode: 'insensitive' } },
        ];
      }

      const [
        totalJobs,
        jobsByCategory,
        jobsByExperience,
        jobsByType,
        avgSalary,
        remoteJobs,
        recentJobs,
      ] = await Promise.all([
        this.count(where),
        this.model.groupBy({
          by: ['category'],
          where,
          _count: { _all: true },
          _avg: {
            minSalary: true,
            maxSalary: true,
          },
        }),
        this.model.groupBy({
          by: ['experienceLevel'],
          where,
          _count: { _all: true },
        }),
        this.model.groupBy({
          by: ['jobType'],
          where,
          _count: { _all: true },
        }),
        this.model.aggregate({
          where,
          _avg: {
            minSalary: true,
            maxSalary: true,
          },
        }),
        this.count({ ...where, isRemote: true }),
        this.findMany({
          where,
          orderBy: { postedAt: 'desc' },
          take: 10,
          include: { company: true },
        }),
      ]);

      // Process category data
      const categoryData = jobsByCategory.map(item => ({
        category: item.category,
        count: item._count._all,
        avgMinSalary: item._avg.minSalary,
        avgMaxSalary: item._avg.maxSalary,
      }));

      // Process experience data
      const experienceData = jobsByExperience.map(item => ({
        level: item.experienceLevel,
        count: item._count._all,
      }));

      // Process job type data
      const typeData = jobsByType.map(item => ({
        type: item.jobType,
        count: item._count._all,
      }));

      // Calculate remote job percentage
      const remotePercentage = (remoteJobs / totalJobs) * 100;

      // Get trending skills
      const trendingSkills = await this.getTrendingSkills(where);

      return {
        summary: {
          totalJobs,
          avgMinSalary: avgSalary._avg.minSalary,
          avgMaxSalary: avgSalary._avg.maxSalary,
          remoteJobs,
          remotePercentage,
          dateRange,
        },
        byCategory: categoryData,
        byExperience: experienceData,
        byType: typeData,
        trendingSkills,
        recentJobs,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get trending skills from job descriptions
   */
  async getTrendingSkills(where, limit = 10) {
    try {
      // This is a simplified implementation
      // In production, you might want to use text analysis or ML
      const jobs = await this.findMany({
        where,
        select: {
          title: true,
          description: true,
          requirements: true,
        },
        take: 100,
      });

      const skillsFrequency = {};
      const commonSkills = [
        'JavaScript', 'Python', 'Java', 'React', 'Node.js', 'TypeScript',
        'HTML', 'CSS', 'SQL', 'MongoDB', 'AWS', 'Docker', 'Kubernetes',
        'Git', 'Agile', 'Scrum', 'Machine Learning', 'AI', 'Data Science',
        'Product Management', 'UX', 'UI', 'Design', 'DevOps', 'Cloud',
      ];

      jobs.forEach(job => {
        const text = `${job.title} ${job.description} ${job.requirements}`.toLowerCase();
        commonSkills.forEach(skill => {
          if (text.includes(skill.toLowerCase())) {
            skillsFrequency[skill] = (skillsFrequency[skill] || 0) + 1;
          }
        });
      });

      // Sort by frequency and return top skills
      return Object.entries(skillsFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([skill, count]) => ({ skill, count }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Bookmark job for user
   */
  async bookmarkJob(jobId, userId, folder = 'default', notes = null) {
    try {
      return await this.prisma.bookmark.upsert({
        where: {
          userId_jobId: {
            userId,
            jobId,
          },
        },
        update: {
          folder,
          notes,
          updatedAt: new Date(),
        },
        create: {
          userId,
          jobId,
          folder,
          notes,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Remove job bookmark
   */
  async removeBookmark(jobId, userId) {
    try {
      return await this.prisma.bookmark.delete({
        where: {
          userId_jobId: {
            userId,
            jobId,
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user's bookmarked jobs
   */
  async getBookmarkedJobs(userId, options = {}) {
    try {
      const bookmarks = await this.prisma.bookmark.findMany({
        where: { userId },
        include: {
          job: {
            include: {
              company: true,
              _count: {
                select: {
                  applications: true,
                },
              },
            },
          },
        },
        ...options,
      });

      return bookmarks.map(bookmark => ({
        ...bookmark.job,
        bookmarkId: bookmark.id,
        folder: bookmark.folder,
        notes: bookmark.notes,
        bookmarkedAt: bookmark.createdAt,
      }));
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get job alerts for user
   */
  async getJobAlerts(userId) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          workerProfile: true,
        },
      });

      if (!user || !user.workerProfile) {
        return [];
      }

      const { preferredRoles, preferredLocations, remotePreference } = user.workerProfile;

      const where = {
        status: 'PUBLISHED',
        expiresAt: { gt: new Date() },
        postedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }, // Last 7 days
      };

      // Role match
      if (preferredRoles && preferredRoles.length > 0) {
        where.OR = preferredRoles.map(role => ({
          title: { contains: role, mode: 'insensitive' },
        }));
      }

      // Location match
      if (preferredLocations && preferredLocations.length > 0) {
        if (remotePreference === 'REMOTE') {
          where.isRemote = true;
        } else if (remotePreference === 'HYBRID') {
          where.OR = [
            { isRemote: true },
            {
              OR: preferredLocations.map(location => ({
                location: { contains: location, mode: 'insensitive' },
              })),
            },
          ];
        } else {
          where.OR = preferredLocations.map(location => ({
            location: { contains: location, mode: 'insensitive' },
          }));
        }
      }

      return await this.findMany({
        where,
        include: {
          company: true,
        },
        orderBy: { postedAt: 'desc' },
        take: 20,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Export job data
   */
  async exportJobData(jobId) {
    try {
      const [
        job,
        applications,
        interviews,
        bookmarks,
        kfnScores,
      ] = await Promise.all([
        this.findById(jobId),
        this.prisma.application.findMany({
          where: { jobId },
          include: {
            user: {
              include: {
                profile: true,
                skills: {
                  include: { skill: true },
                },
              },
            },
          },
        }),
        this.prisma.interview.findMany({
          where: {
            application: { jobId },
          },
          include: {
            application: {
              include: { user: true },
            },
          },
        }),
        this.prisma.bookmark.findMany({
          where: { jobId },
          include: { user: true },
        }),
        this.prisma.kFN.findMany({
          where: { jobId },
        }),
      ]);

      return {
        job,
        applications: {
          count: applications.length,
          data: applications,
        },
        interviews: {
          count: interviews.length,
          data: interviews,
        },
        bookmarks: {
          count: bookmarks.length,
          data: bookmarks,
        },
        kfnScores: {
          count: kfnScores.length,
          data: kfnScores,
        },
        exportDate: new Date().toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }
}

module.exports = JobRepository;
