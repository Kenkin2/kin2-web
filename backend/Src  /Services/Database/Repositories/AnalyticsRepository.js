const { PrismaClient, Prisma } = require('@prisma/client');
const prisma = new PrismaClient();

class AnalyticsRepository {
  // Get platform statistics
  async getPlatformStats() {
    const [
      totalUsers,
      totalEmployers,
      totalWorkers,
      totalJobs,
      activeJobs,
      totalApplications,
      completedShifts,
      totalRevenue,
    ] = await Promise.all([
      prisma.user.count(),
      prisma.employer.count(),
      prisma.worker.count(),
      prisma.job.count(),
      prisma.job.count({ where: { status: 'ACTIVE' } }),
      prisma.application.count(),
      prisma.completedShift.count(),
      prisma.payment.aggregate({
        _sum: { amount: true },
        where: { status: 'COMPLETED' },
      }),
    ]);

    return {
      totalUsers,
      totalEmployers,
      totalWorkers,
      totalJobs,
      activeJobs,
      totalApplications,
      completedShifts,
      totalRevenue: totalRevenue._sum.amount || 0,
    };
  }

  // Get growth metrics over time
  async getGrowthMetrics(period = 'MONTH', limit = 12) {
    const intervals = this.generateTimeIntervals(period, limit);
    const results = [];

    for (const interval of intervals) {
      const [newUsers, newJobs, newApplications, revenue] = await Promise.all([
        prisma.user.count({
          where: {
            createdAt: {
              gte: interval.start,
              lt: interval.end,
            },
          },
        }),
        prisma.job.count({
          where: {
            createdAt: {
              gte: interval.start,
              lt: interval.end,
            },
          },
        }),
        prisma.application.count({
          where: {
            createdAt: {
              gte: interval.start,
              lt: interval.end,
            },
          },
        }),
        prisma.payment.aggregate({
          _sum: { amount: true },
          where: {
            status: 'COMPLETED',
            createdAt: {
              gte: interval.start,
              lt: interval.end,
            },
          },
        }),
      ]);

      results.push({
        period: interval.label,
        date: interval.start,
        newUsers,
        newJobs,
        newApplications,
        revenue: revenue._sum.amount || 0,
      });
    }

    return results;
  }

  // Get user engagement metrics
  async getUserEngagement(period = 'MONTH') {
    const startDate = this.getStartDate(period);
    
    const [
      activeUsers,
      averageSessionDuration,
      returnRate,
      featureUsage,
    ] = await Promise.all([
      // Active users (users with any activity in period)
      prisma.user.count({
        where: {
          lastActiveAt: {
            gte: startDate,
          },
        },
      }),
      // Average session duration (from session logs)
      this.getAverageSessionDuration(startDate),
      // Return rate (users who came back)
      this.calculateReturnRate(startDate),
      // Feature usage breakdown
      this.getFeatureUsage(startDate),
    ]);

    return {
      activeUsers,
      averageSessionDuration,
      returnRate,
      featureUsage,
    };
  }

  // Get job market analytics
  async getJobMarketAnalytics() {
    const [
      topSkills,
      popularJobTypes,
      averageSalaryByRole,
      applicationRate,
      timeToFill,
    ] = await Promise.all([
      // Top 10 most in-demand skills
      this.getTopSkills(),
      // Most popular job types
      this.getPopularJobTypes(),
      // Average salary by role
      this.getAverageSalaryByRole(),
      // Application rate (applications per job)
      this.getApplicationRate(),
      // Average time to fill jobs
      this.getTimeToFill(),
    ]);

    return {
      topSkills,
      popularJobTypes,
      averageSalaryByRole,
      applicationRate,
      timeToFill,
    };
  }

  // Get AI agent performance metrics
  async getAIAgentPerformance() {
    const agents = await prisma.aIAgent.findMany({
      include: {
        logs: {
          take: 1000,
          where: {
            createdAt: {
              gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
            },
          },
        },
      },
    });

    return agents.map(agent => {
      const logs = agent.logs;
      const successful = logs.filter(log => log.status === 'SUCCESS').length;
      const failed = logs.filter(log => log.status === 'ERROR').length;
      const total = logs.length;

      return {
        agentId: agent.id,
        agentName: agent.name,
        totalExecutions: total,
        successRate: total > 0 ? (successful / total) * 100 : 0,
        averageResponseTime: this.calculateAverageResponseTime(logs),
        errorRate: total > 0 ? (failed / total) * 100 : 0,
        mostCommonErrors: this.getMostCommonErrors(logs),
        lastExecution: logs.length > 0 ? logs[logs.length - 1].createdAt : null,
      };
    });
  }

  // Get KFN algorithm effectiveness
  async getKFNEffectiveness() {
    const matches = await prisma.jobMatch.findMany({
      where: {
        createdAt: {
          gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        },
        score: {
          not: null,
        },
      },
      include: {
        application: {
          select: {
            status: true,
            createdAt: true,
          },
        },
      },
    });

    const analysis = {
      totalMatches: matches.length,
      matchesByScoreRange: {
        excellent: matches.filter(m => m.score >= 90).length,
        good: matches.filter(m => m.score >= 75 && m.score < 90).length,
        average: matches.filter(m => m.score >= 60 && m.score < 75).length,
        poor: matches.filter(m => m.score < 60).length,
      },
      conversionRate: this.calculateConversionRate(matches),
      averageScore: matches.reduce((sum, m) => sum + m.score, 0) / matches.length,
      scoreTrend: this.calculateScoreTrend(matches),
    };

    return analysis;
  }

  // Get employer analytics
  async getEmployerAnalytics(employerId) {
    const [
      jobStats,
      applicationStats,
      hireMetrics,
      aiUsage,
      financials,
    ] = await Promise.all([
      this.getEmployerJobStats(employerId),
      this.getEmployerApplicationStats(employerId),
      this.getHireMetrics(employerId),
      this.getEmployerAIUsage(employerId),
      this.getEmployerFinancials(employerId),
    ]);

    return {
      jobStats,
      applicationStats,
      hireMetrics,
      aiUsage,
      financials,
    };
  }

  // Get worker analytics
  async getWorkerAnalytics(workerId) {
    const [
      applicationStats,
      skillAnalysis,
      earnings,
      kfnScores,
      recommendations,
    ] = await Promise.all([
      this.getWorkerApplicationStats(workerId),
      this.getWorkerSkillAnalysis(workerId),
      this.getWorkerEarnings(workerId),
      this.getWorkerKFNScores(workerId),
      this.getWorkerRecommendations(workerId),
    ]);

    return {
      applicationStats,
      skillAnalysis,
      earnings,
      kfnScores,
      recommendations,
    };
  }

  // Helper methods
  generateTimeIntervals(period, limit) {
    const intervals = [];
    const now = new Date();

    for (let i = limit - 1; i >= 0; i--) {
      const start = new Date(now);
      const end = new Date(now);

      switch (period) {
        case 'DAY':
          start.setDate(start.getDate() - i);
          end.setDate(end.getDate() - i + 1);
          break;
        case 'WEEK':
          start.setDate(start.getDate() - i * 7);
          end.setDate(end.getDate() - (i - 1) * 7);
          break;
        case 'MONTH':
          start.setMonth(start.getMonth() - i);
          end.setMonth(end.getMonth() - i + 1);
          break;
      }

      intervals.push({
        start,
        end,
        label: this.formatIntervalLabel(start, period),
      });
    }

    return intervals;
  }

  formatIntervalLabel(date, period) {
    switch (period) {
      case 'DAY':
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'WEEK':
        const weekStart = new Date(date);
        const weekEnd = new Date(date);
        weekEnd.setDate(weekEnd.getDate() + 6);
        return `${weekStart.getDate()}-${weekEnd.getDate()} ${weekStart.toLocaleDateString('en-US', { month: 'short' })}`;
      case 'MONTH':
        return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      default:
        return date.toLocaleDateString();
    }
  }

  getStartDate(period) {
    const now = new Date();
    const start = new Date(now);

    switch (period) {
      case 'DAY':
        start.setDate(start.getDate() - 1);
        break;
      case 'WEEK':
        start.setDate(start.getDate() - 7);
        break;
      case 'MONTH':
        start.setMonth(start.getMonth() - 1);
        break;
      case 'QUARTER':
        start.setMonth(start.getMonth() - 3);
        break;
      case 'YEAR':
        start.setFullYear(start.getFullYear() - 1);
        break;
      default:
        start.setMonth(start.getMonth() - 1);
    }

    return start;
  }

  // Additional helper methods would be implemented here...
  async getAverageSessionDuration(startDate) {
    // Implementation depends on your session logging
    return 0;
  }

  async calculateReturnRate(startDate) {
    // Implementation depends on your user tracking
    return 0;
  }

  async getFeatureUsage(startDate) {
    // Implementation depends on your feature tracking
    return {};
  }

  async getTopSkills() {
    // Implementation
    return [];
  }

  async getPopularJobTypes() {
    // Implementation
    return [];
  }

  async getAverageSalaryByRole() {
    // Implementation
    return {};
  }

  async getApplicationRate() {
    // Implementation
    return 0;
  }

  async getTimeToFill() {
    // Implementation
    return 0;
  }

  calculateAverageResponseTime(logs) {
    // Implementation
    return 0;
  }

  getMostCommonErrors(logs) {
    // Implementation
    return [];
  }

  calculateConversionRate(matches) {
    // Implementation
    return 0;
  }

  calculateScoreTrend(matches) {
    // Implementation
    return {};
  }

  async getEmployerJobStats(employerId) {
    // Implementation
    return {};
  }

  async getEmployerApplicationStats(employerId) {
    // Implementation
    return {};
  }

  async getHireMetrics(employerId) {
    // Implementation
    return {};
  }

  async getEmployerAIUsage(employerId) {
    // Implementation
    return {};
  }

  async getEmployerFinancials(employerId) {
    // Implementation
    return {};
  }

  async getWorkerApplicationStats(workerId) {
    // Implementation
    return {};
  }

  async getWorkerSkillAnalysis(workerId) {
    // Implementation
    return {};
  }

  async getWorkerEarnings(workerId) {
    // Implementation
    return {};
  }

  async getWorkerKFNScores(workerId) {
    // Implementation
    return {};
  }

  async getWorkerRecommendations(workerId) {
    // Implementation
    return {};
  }
}

module.exports = new AnalyticsRepository();
