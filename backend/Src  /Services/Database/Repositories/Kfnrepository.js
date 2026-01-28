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

    const avgFirst = firstHalf.reduce((sum, k) => sum + k.overallScore, 0) / firstHalf.length;
    const avgSecond = secondHalf.reduce((sum, k) => sum + k.overallScore, 0) / secondHalf.length;

    const difference = avgSecond - avgFirst;
    const percentageChange = (difference / avgFirst) * 100;

    if (percentageChange > 10) {
      return 'improving';
    } else if (percentageChange < -10) {
      return 'declining';
    } else {
      return 'stable';
    }
  }

  /**
   * Generate insights from statistics
   */
  generateInsights(stats, user) {
    const insights = [];

    // Overall score insight
    if (stats.averageScore < 70) {
      insights.push({
        type: 'OVERALL_SCORE',
        title: 'Below Average Match Score',
        description: `Your average KFN score is ${stats.averageScore.toFixed(1)}%, which is below the recommended threshold of 70%.`,
        severity: 'HIGH',
        component: 'overall',
      });
    }

    // Component insights
    Object.entries(stats.componentAverages).forEach(([component, score]) => {
      if (score < 60) {
        insights.push({
          type: 'COMPONENT_SCORE',
          title: `Low ${this.formatComponentName(component)} Score`,
          description: `Your average ${component} score is ${score.toFixed(1)}%.`,
          severity: 'MEDIUM',
          component,
        });
      }
    });

    // Success correlation insight
    if (stats.successCorrelation.averageKFNForSuccess > stats.averageScore + 10) {
      insights.push({
        type: 'SUCCESS_CORRELATION',
        title: 'Successful Applications Have Higher KFN',
        description: 'Applications with higher KFN scores are more likely to result in offers.',
        severity: 'LOW',
      });
    }

    // Trend insight
    if (stats.trend === 'declining') {
      insights.push({
        type: 'TREND',
        title: 'Declining Match Scores',
        description: 'Your recent KFN scores are lower than previous ones.',
        severity: 'MEDIUM',
      });
    } else if (stats.trend === 'improving') {
      insights.push({
        type: 'TREND',
        title: 'Improving Match Scores',
        description: 'Your recent KFN scores are showing improvement.',
        severity: 'LOW',
        positive: true,
      });
    }

    return insights;
  }

  /**
   * Format component name
   */
  formatComponentName(component) {
    return component.charAt(0).toUpperCase() + component.slice(1);
  }

  /**
   * Generate recommendations
   */
  generateRecommendations(insights, user) {
    const recommendations = [];

    insights.forEach(insight => {
      switch (insight.type) {
        case 'OVERALL_SCORE':
          recommendations.push({
            type: 'IMPROVE_PROFILE',
            title: 'Enhance Your Profile',
            description: 'Consider adding more skills, experiences, and detailed information to your profile.',
            action: 'Update profile',
            priority: 'HIGH',
          });
          break;

        case 'COMPONENT_SCORE':
          if (insight.component === 'skills') {
            recommendations.push({
              type: 'ADD_SKILLS',
              title: 'Add More Relevant Skills',
              description: 'Identify and add skills that are in high demand for your target roles.',
              action: 'Add skills',
              priority: 'MEDIUM',
            });
          } else if (insight.component === 'experience') {
            recommendations.push({
              type: 'ENHANCE_EXPERIENCE',
              title: 'Highlight Relevant Experience',
              description: 'Focus on experience that matches your target job requirements.',
              action: 'Update experience',
              priority: 'MEDIUM',
            });
          }
          break;

        case 'SUCCESS_CORRELATION':
          recommendations.push({
            type: 'TARGET_HIGH_MATCH',
            title: 'Target High-Match Positions',
            description: 'Focus on applying to positions where you have a higher KFN score.',
            action: 'View high-match jobs',
            priority: 'LOW',
          });
          break;
      }
    });

    // Add general recommendations
    if (recommendations.length === 0) {
      recommendations.push({
        type: 'CONTINUE_STRATEGY',
        title: 'Continue Current Strategy',
        description: 'Your KFN scores are good. Continue applying to similar positions.',
        action: 'Browse jobs',
        priority: 'LOW',
      });
    }

    return recommendations;
  }

  /**
   * Get KFN for job recommendations
   */
  async getJobRecommendations(userId, limit = 10) {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          workerProfile: true,
          skills: {
            include: { skill: true },
          },
        },
      });

      if (!user || !user.workerProfile) {
        return [];
      }

      // Get user's previous KFN scores to understand patterns
      const userKFNs = await this.findByUserId(userId, {
        select: {
          jobId: true,
          overallScore: true,
          job: {
            select: {
              category: true,
              experienceLevel: true,
              jobType: true,
            },
          },
        },
      });

      // Find jobs similar to those with high KFN scores
      const highScoreJobs = userKFNs
        .filter(kfn => kfn.overallScore >= 75)
        .map(kfn => kfn.job);

      // Get jobs in same categories
      const categories = [...new Set(highScoreJobs.map(job => job.category))];

      // Find jobs with similar requirements
      const where = {
        status: 'PUBLISHED',
        expiresAt: { gt: new Date() },
        id: { notIn: userKFNs.map(kfn => kfn.jobId) },
      };

      if (categories.length > 0) {
        where.category = { in: categories };
      }

      // Get potential jobs
      const potentialJobs = await this.prisma.job.findMany({
        where,
        include: {
          company: true,
        },
        take: limit * 2, // Get more for filtering
      });

      // Calculate estimated KFN for each job
      const jobsWithEstimatedKFN = potentialJobs.map(job => {
        const estimatedScore = this.estimateKFN(user, job, highScoreJobs);
        return {
          ...job,
          estimatedKFN: estimatedScore,
          matchReasons: this.getMatchReasons(user, job),
        };
      });

      // Sort by estimated KFN and return top results
      return jobsWithEstimatedKFN
        .sort((a, b) => b.estimatedKFN - a.estimatedKFN)
        .slice(0, limit);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Estimate KFN score
   */
  estimateKFN(user, job, highScoreJobs) {
    let score = 50; // Base score

    // Check if job is similar to high-scoring jobs
    const similarHighScore = highScoreJobs.some(highJob =>
      highJob.category === job.category &&
      highJob.experienceLevel === job.experienceLevel &&
      highJob.jobType === job.jobType
    );

    if (similarHighScore) {
      score += 20;
    }

    // Check user skills against job requirements
    const userSkills = user.skills.map(s => s.skill.name);
    const jobSkills = this.extractSkillsFromJob(job);
    const skillMatch = jobSkills.filter(skill =>
      userSkills.some(userSkill => userSkill.toLowerCase().includes(skill.toLowerCase()))
    ).length;

    score += (skillMatch / (jobSkills.length || 1)) * 20;

    // Check location match
    if (user.workerProfile.preferredLocations?.some(location =>
      job.location?.toLowerCase().includes(location.toLowerCase())
    )) {
      score += 10;
    }

    // Check remote preference
    if (job.isRemote && user.workerProfile.remotePreference === 'REMOTE') {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * Extract skills from job
   */
  extractSkillsFromJob(job) {
    const text = `
      ${job.title}
      ${job.description}
      ${job.requirements}
    `.toLowerCase();

    const commonSkills = [
      'javascript', 'python', 'java', 'react', 'node.js', 'typescript',
      'html', 'css', 'sql', 'mongodb', 'aws', 'docker', 'kubernetes',
      'git', 'agile', 'scrum', 'machine learning', 'ai', 'data science',
      'product management', 'ux', 'ui', 'design', 'devops', 'cloud',
    ];

    return commonSkills.filter(skill => text.includes(skill));
  }

  /**
   * Get match reasons
   */
  getMatchReasons(user, job) {
    const reasons = [];

    // Skill match
    const userSkills = user.skills.map(s => s.skill.name);
    const jobSkills = this.extractSkillsFromJob(job);
    const matchedSkills = jobSkills.filter(skill =>
      userSkills.some(userSkill => userSkill.toLowerCase().includes(skill.toLowerCase()))
    );

    if (matchedSkills.length > 0) {
      reasons.push(`Matches ${matchedSkills.length} required skills`);
    }

    // Category match
    if (user.profile?.industry === job.category) {
      reasons.push('Industry match');
    }

    // Location match
    if (user.workerProfile?.preferredLocations?.some(location =>
      job.location?.toLowerCase().includes(location.toLowerCase())
    )) {
      reasons.push('Location match');
    }

    // Remote match
    if (job.isRemote && user.workerProfile?.remotePreference === 'REMOTE') {
      reasons.push('Remote work preference match');
    }

    return reasons;
  }

  /**
   * Batch calculate KFN for multiple user-job pairs
   */
  async batchCalculate(pairs) {
    try {
      const results = [];

      for (const { userId, jobId } of pairs) {
        try {
          // Check if already calculated
          const existing = await this.findByUserAndJob(userId, jobId);
          if (existing) {
            results.push({
              userId,
              jobId,
              success: true,
              existing: true,
              kfn: existing,
            });
            continue;
          }

          // Get user and job data
          const [user, job] = await Promise.all([
            this.prisma.user.findUnique({
              where: { id: userId },
              include: {
                profile: true,
                workerProfile: true,
                skills: {
                  include: { skill: true },
                },
                experiences: true,
                educations: true,
              },
            }),
            this.prisma.job.findUnique({
              where: { id: jobId },
              include: {
                company: true,
              },
            }),
          ]);

          if (!user || !job) {
            results.push({
              userId,
              jobId,
              success: false,
              error: 'User or job not found',
            });
            continue;
          }

          // Calculate KFN
          const kfnData = await this.calculateKFN(user, job);

          // Save to database
          const kfn = await this.create({
            userId,
            jobId,
            ...kfnData,
          });

          // Update application if exists
          await this.updateApplicationKFN(userId, jobId, kfnData.overallScore);

          results.push({
            userId,
            jobId,
            success: true,
            kfn,
          });
        } catch (error) {
          results.push({
            userId,
            jobId,
            success: false,
            error: error.message,
          });
        }
      }

      return results;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate KFN score
   */
  async calculateKFN(user, job) {
    // This is a simplified calculation
    // In production, this would use the full KFN algorithm

    const scores = {
      skillsScore: this.calculateSkillsScore(user, job),
      experienceScore: this.calculateExperienceScore(user, job),
      locationScore: this.calculateLocationScore(user, job),
      availabilityScore: this.calculateAvailabilityScore(user, job),
      educationScore: this.calculateEducationScore(user, job),
      culturalScore: this.calculateCulturalScore(user, job),
    };

    const weights = {
      skills: 0.30,
      experience: 0.25,
      location: 0.15,
      availability: 0.15,
      education: 0.10,
      cultural: 0.05,
    };

    const overallScore = Object.entries(scores).reduce((total, [key, score]) => {
      const component = key.replace('Score', '');
      return total + score * weights[component];
    }, 0);

    const strengths = this.extractStrengths(scores);
    const weaknesses = this.extractWeaknesses(scores);
    const recommendations = this.generateKFNRecommendations(scores);

    return {
      overallScore: parseFloat(overallScore.toFixed(2)),
      ...scores,
      strengths,
      weaknesses,
      recommendations,
      calculatedAt: new Date(),
      version: '2.0',
    };
  }

  /**
   * Calculate skills score
   */
  calculateSkillsScore(user, job) {
    // Simplified implementation
    const userSkills = user.skills.map(s => s.skill.name);
    const jobSkills = this.extractSkillsFromJob(job);

    if (jobSkills.length === 0) return 70;

    const matched = jobSkills.filter(skill =>
      userSkills.some(userSkill => userSkill.toLowerCase().includes(skill.toLowerCase()))
    );

    return (matched.length / jobSkills.length) * 100;
  }

  /**
   * Calculate experience score
   */
  calculateExperienceScore(user, job) {
    const userExp = user.profile?.yearsExperience || 0;
    const requiredExp = this.experienceLevelToYears(job.experienceLevel);

    if (userExp >= requiredExp) return 100;
    return (userExp / requiredExp) * 100;
  }

  /**
   * Convert experience level to years
   */
  experienceLevelToYears(level) {
    const levels = {
      ENTRY: 1,
      JUNIOR: 2,
      MID: 4,
      SENIOR: 7,
      LEAD: 10,
      EXECUTIVE: 15,
    };
    return levels[level] || 4;
  }

  /**
   * Calculate location score
   */
  calculateLocationScore(user, job) {
    if (job.isRemote) return 100;

    const userLocations = user.workerProfile?.preferredLocations || [];
    const jobLocation = job.location;

    if (!jobLocation) return 70;

    const match = userLocations.some(location =>
      jobLocation.toLowerCase().includes(location.toLowerCase())
    );

    return match ? 90 : 50;
  }

  /**
   * Calculate availability score
   */
  calculateAvailabilityScore(user, job) {
    const availability = user.workerProfile?.availability || 'UNAVAILABLE';
    if (availability === 'UNAVAILABLE') return 0;
    if (availability === 'AVAILABLE') return 100;
    if (availability === 'SOON') return 80;
    return 60;
  }

  /**
   * Calculate education score
   */
  calculateEducationScore(user, job) {
    const education = user.educations || [];
    if (education.length === 0) return 50;

    // Simplified: higher education = higher score
    const highest = this.getHighestEducationLevel(education);
    const scores = {
      'HIGH_SCHOOL': 40,
      'ASSOCIATE': 60,
      'BACHELOR': 80,
      'MASTER': 90,
      'PHD': 95,
    };

    return scores[highest] || 70;
  }

  /**
   * Get highest education level
   */
  getHighestEducationLevel(educations) {
    const levels = {
      'PHD': 5,
      'MASTER': 4,
      'BACHELOR': 3,
      'ASSOCIATE': 2,
      'HIGH_SCHOOL': 1,
    };

    let highest = 'HIGH_SCHOOL';
    educations.forEach(edu => {
      const degree = edu.degree.toLowerCase();
      if (degree.includes('phd') || degree.includes('doctor')) {
        highest = 'PHD';
      } else if (degree.includes('master') && levels[highest] < 4) {
        highest = 'MASTER';
      } else if (degree.includes('bachelor') && levels[highest] < 3) {
        highest = 'BACHELOR';
      } else if (degree.includes('associate') && levels[highest] < 2) {
        highest = 'ASSOCIATE';
      }
    });

    return highest;
  }

  /**
   * Calculate cultural score
   */
  calculateCulturalScore(user, job) {
    // Simplified cultural fit calculation
    const userIndustry = user.profile?.industry;
    const companyIndustry = job.company?.industry;

    if (userIndustry && companyIndustry && userIndustry === companyIndustry) {
      return 90;
    }

    return 70;
  }

  /**
   * Extract strengths from scores
   */
  extractStrengths(scores) {
    const strengths = [];
    Object.entries(scores).forEach(([component, score]) => {
      if (score >= 80) {
        strengths.push(`Strong ${component.replace('Score', '')} match`);
      }
    });
    return strengths;
  }

  /**
   * Extract weaknesses from scores
   */
  extractWeaknesses(scores) {
    const weaknesses = [];
    Object.entries(scores).forEach(([component, score]) => {
      if (score <= 50) {
        weaknesses.push(`Room for improvement in ${component.replace('Score', '')}`);
      }
    });
    return weaknesses;
  }

  /**
   * Generate KFN recommendations
   */
  generateKFNRecommendations(scores) {
    const recommendations = [];
    Object.entries(scores).forEach(([component, score]) => {
      if (score < 60) {
        recommendations.push(`Consider improving ${component.replace('Score', '')}`);
      }
    });

    if (recommendations.length === 0) {
      recommendations.push('Strong match overall');
    }

    return recommendations;
  }

  /**
   * Update application KFN score
   */
  async updateApplicationKFN(userId, jobId, score) {
    try {
      await this.prisma.application.updateMany({
        where: {
          userId,
          jobId,
        },
        data: {
          kfnScore: score,
        },
      });
    } catch (error) {
      // Silent fail - application might not exist
    }
  }

  /**
   * Get KFN accuracy metrics
   */
  async getAccuracyMetrics() {
    try {
      const results = await this.prisma.$queryRaw`
        SELECT 
          COUNT(*) as total_pairs,
          COUNT(CASE WHEN a.status = 'HIRED' AND k.overall_score >= 75 THEN 1 END) as true_positives,
          COUNT(CASE WHEN a.status = 'HIRED' AND k.overall_score < 75 THEN 1 END) as false_negatives,
          COUNT(CASE WHEN a.status != 'HIRED' AND k.overall_score >= 75 THEN 1 END) as false_positives,
          COUNT(CASE WHEN a.status != 'HIRED' AND k.overall_score < 75 THEN 1 END) as true_negatives
        FROM "KFN" k
        LEFT JOIN "Application" a ON a.user_id = k.user_id AND a.job_id = k.job_id
        WHERE a.status IS NOT NULL
      `;

      const metrics = results[0] || {};
      const {
        total_pairs,
        true_positives,
        false_negatives,
        false_positives,
        true_negatives,
      } = metrics;

      if (!total_pairs || total_pairs === 0) {
        return {
          accuracy: 0,
          precision: 0,
          recall: 0,
          f1Score: 0,
          total: 0,
        };
      }

      const accuracy = (true_positives + true_negatives) / total_pairs;
      const precision = true_positives / (true_positives + false_positives || 1);
      const recall = true_positives / (true_positives + false_negatives || 1);
      const f1Score = 2 * (precision * recall) / (precision + recall || 1);

      return {
        accuracy: parseFloat(accuracy.toFixed(3)),
        precision: parseFloat(precision.toFixed(3)),
        recall: parseFloat(recall.toFixed(3)),
        f1Score: parseFloat(f1Score.toFixed(3)),
        total: total_pairs,
        confusionMatrix: {
          truePositives: true_positives,
          falsePositives: false_positives,
          trueNegatives: true_negatives,
          falseNegatives: false_negatives,
        },
      };
    } catch (error) {
      return {
        accuracy: 0,
        precision: 0,
        recall: 0,
        f1Score: 0,
        total: 0,
        confusionMatrix: {
          truePositives: 0,
          falsePositives: 0,
          trueNegatives: 0,
          falseNegatives: 0,
        },
      };
    }
  }
}

module.exports = KFNRepository;
