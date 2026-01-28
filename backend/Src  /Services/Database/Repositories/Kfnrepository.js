const BaseRepository = require('../BaseRepository');

class KFNRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'kFN');
  }

  /**
   * Create KFN record with validation
   */
  async create(data) {
    try {
      // Check if KFN already exists for user-job pair
      const existing = await this.findFirst({
        userId: data.userId,
        jobId: data.jobId,
      });

      if (existing) {
        throw new Error('KFN already calculated for this user-job pair');
      }

      // Verify user and job exist
      const [user, job] = await Promise.all([
        this.prisma.user.findUnique({ where: { id: data.userId } }),
        this.prisma.job.findUnique({ where: { id: data.jobId } }),
      ]);

      if (!user) {
        throw new Error('User not found');
      }

      if (!job) {
        throw new Error('Job not found');
      }

      return await super.create(data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find KFN by user and job
   */
  async findByUserAndJob(userId, jobId, options = {}) {
    try {
      return await this.findFirst({
        userId,
        jobId,
      }, options);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find KFNs by user ID
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
   * Find KFNs by job ID
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
   * Get KFN with details
   */
  async getKFNWithDetails(kfnId) {
    try {
      return await this.model.findUnique({
        where: { id: kfnId },
        include: {
          user: {
            include: {
              profile: true,
            },
          },
          job: {
            include: {
              company: true,
            },
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate KFN statistics
   */
  async getKFNStatistics(filters = {}) {
    try {
      const {
        userId,
        jobId,
        dateFrom,
        dateTo,
        minScore,
        maxScore,
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

      // Date range filter
      if (dateFrom || dateTo) {
        where.calculatedAt = {};
        if (dateFrom) {
          where.calculatedAt.gte = new Date(dateFrom);
        }
        if (dateTo) {
          where.calculatedAt.lte = new Date(dateTo);
        }
      }

      // Score range filter
      if (minScore !== undefined || maxScore !== undefined) {
        where.overallScore = {};
        if (minScore !== undefined) {
          where.overallScore.gte = minScore;
        }
        if (maxScore !== undefined) {
          where.overallScore.lte = maxScore;
        }
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      const [
        total,
        average,
        distribution,
        byComponent,
        trend,
        topMatches,
      ] = await Promise.all([
        this.count(where),
        this.getAverageScores(where),
        this.getScoreDistribution(where),
        this.getComponentScores(where),
        this.getScoreTrend(where),
        this.getTopMatches(where),
      ]);

      return {
        total,
        average,
        distribution,
        byComponent,
        trend,
        topMatches,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get average scores
   */
  async getAverageScores(where) {
    try {
      const result = await this.model.aggregate({
        where,
        _avg: {
          overallScore: true,
          skillsScore: true,
          experienceScore: true,
          locationScore: true,
          availabilityScore: true,
          educationScore: true,
          culturalScore: true,
        },
        _count: {
          _all: true,
        },
      });

      return {
        overall: result._avg.overallScore || 0,
        skills: result._avg.skillsScore || 0,
        experience: result._avg.experienceScore || 0,
        location: result._avg.locationScore || 0,
        availability: result._avg.availabilityScore || 0,
        education: result._avg.educationScore || 0,
        cultural: result._avg.culturalScore || 0,
        count: result._count._all || 0,
      };
    } catch (error) {
      return {
        overall: 0,
        skills: 0,
        experience: 0,
        location: 0,
        availability: 0,
        education: 0,
        cultural: 0,
        count: 0,
      };
    }
  }

  /**
   * Get score distribution
   */
  async getScoreDistribution(where) {
    try {
      const kfns = await this.findMany({
        where,
        select: { overallScore: true },
      });

      const distribution = {
        excellent: 0, // 90-100
        good: 0,      // 75-89
        average: 0,   // 60-74
        poor: 0,      // 0-59
      };

      kfns.forEach(kfn => {
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

      // Calculate percentages
      const total = kfns.length;
      if (total > 0) {
        distribution.excellentPercent = (distribution.excellent / total) * 100;
        distribution.goodPercent = (distribution.good / total) * 100;
        distribution.averagePercent = (distribution.average / total) * 100;
        distribution.poorPercent = (distribution.poor / total) * 100;
      }

      return distribution;
    } catch (error) {
      return {
        excellent: 0,
        good: 0,
        average: 0,
        poor: 0,
        excellentPercent: 0,
        goodPercent: 0,
        averagePercent: 0,
        poorPercent: 0,
      };
    }
  }

  /**
   * Get component scores
   */
  async getComponentScores(where) {
    try {
      const kfns = await this.findMany({
        where,
        select: {
          skillsScore: true,
          experienceScore: true,
          locationScore: true,
          availabilityScore: true,
          educationScore: true,
          culturalScore: true,
        },
        take: 1000, // Limit for performance
      });

      if (kfns.length === 0) {
        return {};
      }

      const components = [
        'skills',
        'experience',
        'location',
        'availability',
        'education',
        'cultural',
      ];

      const componentData = {};
      components.forEach(component => {
        const scores = kfns.map(k => k[`${component}Score`]).filter(s => s !== null);
        if (scores.length > 0) {
          const sum = scores.reduce((total, score) => total + score, 0);
          const avg = sum / scores.length;
          const max = Math.max(...scores);
          const min = Math.min(...scores);
          const stdDev = this.calculateStandardDeviation(scores, avg);

          componentData[component] = {
            average: avg,
            max,
            min,
            stdDev,
            count: scores.length,
          };
        }
      });

      return componentData;
    } catch (error) {
      return {};
    }
  }

  /**
   * Calculate standard deviation
   */
  calculateStandardDeviation(scores, mean) {
    const squaredDifferences = scores.map(score => Math.pow(score - mean, 2));
    const variance = squaredDifferences.reduce((sum, diff) => sum + diff, 0) / scores.length;
    return Math.sqrt(variance);
  }

  /**
   * Get score trend over time
   */
  async getScoreTrend(where, period = 'monthly') {
    try {
      const kfns = await this.findMany({
        where,
        select: {
          overallScore: true,
          calculatedAt: true,
        },
        orderBy: { calculatedAt: 'asc' },
      });

      if (kfns.length === 0) {
        return [];
      }

      const groupedData = {};
      kfns.forEach(kfn => {
        let key;
        const date = new Date(kfn.calculatedAt);

        switch (period) {
          case 'daily':
            key = date.toISOString().slice(0, 10); // YYYY-MM-DD
            break;
          case 'weekly':
            const week = this.getWeekNumber(date);
            key = `${date.getFullYear()}-W${week}`;
            break;
          case 'monthly':
          default:
            key = date.toISOString().slice(0, 7); // YYYY-MM
            break;
        }

        if (!groupedData[key]) {
          groupedData[key] = {
            period: key,
            scores: [],
            count: 0,
            average: 0,
          };
        }

        groupedData[key].scores.push(kfn.overallScore);
        groupedData[key].count++;
      });

      // Calculate averages
      Object.values(groupedData).forEach(group => {
        const sum = group.scores.reduce((total, score) => total + score, 0);
        group.average = sum / group.scores.length;
        delete group.scores; // Clean up
      });

      // Convert to array and sort
      return Object.values(groupedData).sort((a, b) => a.period.localeCompare(b.period));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get week number of the year
   */
  getWeekNumber(date) {
    const firstDay = new Date(date.getFullYear(), 0, 1);
    const pastDays = (date - firstDay) / 86400000;
    return Math.ceil((pastDays + firstDay.getDay() + 1) / 7);
  }

  /**
   * Get top matches
   */
  async getTopMatches(where, limit = 10) {
    try {
      return await this.findMany({
        where,
        include: {
          user: {
            include: {
              profile: true,
            },
          },
          job: {
            include: {
              company: true,
            },
          },
        },
        orderBy: { overallScore: 'desc' },
        take: limit,
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Get KFN insights for user
   */
  async getUserInsights(userId) {
    try {
      const [
        kfns,
        user,
        applications,
      ] = await Promise.all([
        this.findByUserId(userId, {
          include: {
            job: {
              include: {
                company: true,
              },
            },
          },
          orderBy: { calculatedAt: 'desc' },
          take: 50,
        }),
        this.prisma.user.findUnique({
          where: { id: userId },
          include: {
            profile: true,
            skills: {
              include: { skill: true },
            },
          },
        }),
        this.prisma.application.findMany({
          where: { userId },
          select: { status: true, kfnScore: true },
        }),
      ]);

      if (kfns.length === 0) {
        return {
          insights: [],
          recommendations: [],
          statistics: {},
        };
      }

      // Calculate statistics
      const stats = this.calculateUserStats(kfns, applications);

      // Generate insights
      const insights = this.generateInsights(stats, user);

      // Generate recommendations
      const recommendations = this.generateRecommendations(insights, user);

      return {
        insights,
        recommendations,
        statistics: stats,
        recentKFN: kfns.slice(0, 5),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate user statistics
   */
  calculateUserStats(kfns, applications) {
    const scores = kfns.map(k => k.overallScore);
    const avgScore = scores.reduce((sum, score) => sum + score, 0) / scores.length;

    // Component averages
    const components = ['skills', 'experience', 'location', 'availability', 'education', 'cultural'];
    const componentAverages = {};
    components.forEach(component => {
      const componentScores = kfns.map(k => k[`${component}Score`]).filter(s => s !== null);
      if (componentScores.length > 0) {
        componentAverages[component] = componentScores.reduce((sum, score) => sum + score, 0) / componentScores.length;
      }
    });

    // Success correlation
    const successfulApps = applications.filter(app => ['HIRED', 'OFFERED'].includes(app.status));
    const avgKFNForSuccess = successfulApps.length > 0
      ? successfulApps.reduce((sum, app) => sum + (app.kfnScore || 0), 0) / successfulApps.length
      : 0;

    // Score distribution
    const distribution = {
      excellent: scores.filter(s => s >= 90).length,
      good: scores.filter(s => s >= 75 && s < 90).length,
      average: scores.filter(s => s >= 60 && s < 75).length,
      poor: scores.filter(s => s < 60).length,
    };

    return {
      totalKFN: kfns.length,
      averageScore: avgScore,
      componentAverages,
      successCorrelation: {
        successfulApplications: successfulApps.length,
        averageKFNForSuccess: avgKFNForSuccess,
        successRate: (successfulApps.length / applications.length) * 100 || 0,
      },
      distribution,
      trend: this.calculateScoreTrend(kfns),
    };
  }

  /**
   * Calculate score trend
   */
  calculateScoreTrend(kfns) {
    if (kfns.length < 2) {
      return 'stable';
    }

    // Sort by date
    const sorted = [...kfns].sort((a, b) => new Date(a.calculatedAt) - new Date(b.calculatedAt));

    // Split into halves
    const firstHalf = sorted.slice(0, Math.floor(sorted.length / 2));
    const secondHalf = sorted.slice(Math.floor(sorted.length / 2));

    const avgFirst = firstHalf.reduce((sum, k) => sum + k.overallScore, 0) / firstHalf.length
