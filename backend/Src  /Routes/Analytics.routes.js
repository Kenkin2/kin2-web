const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');

const prisma = new PrismaClient();

// Track analytics event
router.post('/track', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { eventType, eventCategory, properties = {}, sessionId } = req.body;

    // Create analytics event
    await prisma.analyticsEvent.create({
      data: {
        userId: req.userId,
        eventType,
        eventCategory,
        properties,
        sessionId,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        url: req.headers.referer
      }
    });

    // Update user analytics
    await updateUserAnalytics(req.userId, eventType, properties);

    res.json({ message: 'Event tracked successfully' });
  } catch (error) {
    console.error('Track analytics error:', error);
    res.status(500).json({ error: 'Failed to track analytics event' });
  }
});

// Get user analytics
router.get('/user', authMiddleware.verifyToken, async (req, res) => {
  try {
    const userAnalytics = await prisma.userAnalytics.findUnique({
      where: { userId: req.userId }
    });

    if (!userAnalytics) {
      // Create user analytics if not exists
      const newAnalytics = await prisma.userAnalytics.create({
        data: { userId: req.userId }
      });
      return res.json(newAnalytics);
    }

    res.json(userAnalytics);
  } catch (error) {
    console.error('Get user analytics error:', error);
    res.status(500).json({ error: 'Failed to get user analytics' });
  }
});

// Get platform analytics (admin only)
router.get('/platform', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only admins can view platform analytics
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { period = '30d' } = req.query;
    const dateThreshold = getDateThreshold(period);

    const [
      userStats,
      jobStats,
      applicationStats,
      revenueStats,
      performanceStats,
      recentActivity
    ] = await Promise.all([
      getUserStats(dateThreshold),
      getJobStats(dateThreshold),
      getApplicationStats(dateThreshold),
      getRevenueStats(dateThreshold),
      getPerformanceStats(),
      getRecentActivity()
    ]);

    res.json({
      period,
      dateThreshold,
      userStats,
      jobStats,
      applicationStats,
      revenueStats,
      performanceStats,
      recentActivity
    });
  } catch (error) {
    console.error('Get platform analytics error:', error);
    res.status(500).json({ error: 'Failed to get platform analytics' });
  }
});

// Get analytics dashboard
router.get('/dashboard', authMiddleware.verifyToken, async (req, res) => {
  try {
    const dashboardData = {
      overview: await getDashboardOverview(req.userId, req.userRole),
      charts: await getDashboardCharts(req.userId, req.userRole),
      recentActivity: await getRecentUserActivity(req.userId),
      insights: await getAnalyticsInsights(req.userId, req.userRole)
    };

    res.json(dashboardData);
  } catch (error) {
    console.error('Get analytics dashboard error:', error);
    res.status(500).json({ error: 'Failed to get analytics dashboard' });
  }
});

// Get event statistics
router.get('/events', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { eventType, startDate, endDate, groupBy = 'day' } = req.query;

    const where = {};
    
    if (req.userRole !== 'ADMIN') {
      where.userId = req.userId;
    }
    
    if (eventType) {
      where.eventType = eventType;
    }
    
    if (startDate) {
      where.createdAt = { gte: new Date(startDate) };
    }
    
    if (endDate) {
      where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
    }

    let groupByClause;
    switch (groupBy) {
      case 'hour':
        groupByClause = {
          year: { year: { $year: '$createdAt' } },
          month: { month: { $month: '$createdAt' } },
          day: { day: { $dayOfMonth: '$createdAt' } },
          hour: { hour: { $hour: '$createdAt' } }
        };
        break;
      case 'day':
        groupByClause = {
          year: { year: { $year: '$createdAt' } },
          month: { month: { $month: '$createdAt' } },
          day: { day: { $dayOfMonth: '$createdAt' } }
        };
        break;
      case 'week':
        groupByClause = {
          year: { year: { $year: '$createdAt' } },
          week: { week: { $week: '$createdAt' } }
        };
        break;
      case 'month':
        groupByClause = {
          year: { year: { $year: '$createdAt' } },
          month: { month: { $month: '$createdAt' } }
        };
        break;
      default:
        groupByClause = {
          year: { year: { $year: '$createdAt' } },
          month: { month: { $month: '$createdAt' } },
          day: { day: { $dayOfMonth: '$createdAt' } }
        };
    }

    // Note: This is a simplified example. In a real implementation,
    // you would use Prisma's groupBy or raw SQL queries

    const events = await prisma.analyticsEvent.groupBy({
      by: ['eventType'],
      where,
      _count: {
        eventType: true
      },
      orderBy: {
        _count: {
          eventType: 'desc'
        }
      },
      take: 20
    });

    const timeline = await prisma.analyticsEvent.groupBy({
      by: ['createdAt'],
      where,
      _count: {
        createdAt: true
      },
      orderBy: {
        createdAt: 'asc'
      },
      take: 30
    });

    res.json({
      events: events.reduce((acc, event) => {
        acc[event.eventType] = event._count.eventType;
        return acc;
      }, {}),
      timeline: timeline.map(item => ({
        date: item.createdAt,
        count: item._count.createdAt
      }))
    });
  } catch (error) {
    console.error('Get event statistics error:', error);
    res.status(500).json({ error: 'Failed to get event statistics' });
  }
});

// Export analytics data
router.get('/export', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only admins can export analytics data
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { format = 'json', startDate, endDate } = req.query;

    const where = {};
    if (startDate) where.createdAt = { gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

    const data = await prisma.analyticsEvent.findMany({
      where,
      include: {
        user: {
          select: {
            email: true,
            role: true,
            profile: {
              select: {
                firstName: true,
                lastName: true
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 1000 // Limit for export
    });

    if (format === 'csv') {
      // Convert to CSV
      const csvData = convertToCSV(data);
      res.header('Content-Type', 'text/csv');
      res.attachment('analytics-export.csv');
      return res.send(csvData);
    }

    res.json({
      count: data.length,
      data,
      exportedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Export analytics error:', error);
    res.status(500).json({ error: 'Failed to export analytics data' });
  }
});

// Helper functions
async function updateUserAnalytics(userId, eventType, properties) {
  try {
    const updateData = { lastActivity: new Date() };

    switch (eventType) {
      case 'JOB_VIEW':
        updateData.jobsViewed = { increment: 1 };
        break;
      case 'JOB_APPLY':
        updateData.jobsApplied = { increment: 1 };
        break;
      case 'JOB_SAVE':
        updateData.jobsSaved = { increment: 1 };
        break;
      case 'PROFILE_VIEW':
        updateData.profileViews = { increment: 1 };
        break;
      case 'SEARCH':
        updateData.searchQueries = { increment: 1 };
        break;
      case 'LOGIN':
        updateData.totalLogins = { increment: 1 };
        updateData.lastLogin = new Date();
        break;
    }

    // Calculate profile completeness
    if (eventType === 'PROFILE_UPDATE') {
      const profileCompleteness = await calculateProfileCompleteness(userId);
      updateData.profileCompleteness = profileCompleteness;
    }

    await prisma.userAnalytics.upsert({
      where: { userId },
      update: updateData,
      create: {
        userId,
        ...updateData,
        firstActivity: new Date()
      }
    });
  } catch (error) {
    console.error('Update user analytics error:', error);
  }
}

async function calculateProfileCompleteness(userId) {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        profile: true,
        workerProfile: true,
        workerSkills: true,
        experience: true,
        education: true
      }
    });

    if (!user) return 0;

    let completeness = 0;
    const weights = {
      profile: 0.2,
      skills: 0.2,
      experience: 0.3,
      education: 0.2,
      resume: 0.1
    };

    // Profile completeness
    if (user.profile) {
      const profileFields = ['firstName', 'lastName', 'location', 'bio'];
      const filledFields = profileFields.filter(field => user.profile[field]);
      completeness += (filledFields.length / profileFields.length) * weights.profile;
    }

    // Skills completeness
    if (user.workerSkills && user.workerSkills.length > 0) {
      completeness += weights.skills;
    }

    // Experience completeness
    if (user.experience && user.experience.length > 0) {
      completeness += weights.experience;
    }

    // Education completeness
    if (user.education && user.education.length > 0) {
      completeness += weights.education;
    }

    // Resume completeness
    if (user.workerProfile?.resumeUrl) {
      completeness += weights.resume;
    }

    return Math.round(completeness * 100);
  } catch (error) {
    console.error('Calculate profile completeness error:', error);
    return 0;
  }
}

function getDateThreshold(period) {
  const now = new Date();
  switch (period) {
    case '7d':
      return new Date(now.setDate(now.getDate() - 7));
    case '30d':
      return new Date(now.setDate(now.getDate() - 30));
    case '90d':
      return new Date(now.setDate(now.getDate() - 90));
    case '1y':
      return new Date(now.setFullYear(now.getFullYear() - 1));
    default:
      return new Date(now.setDate(now.getDate() - 30));
  }
}

async function getUserStats(dateThreshold) {
  const [
    totalUsers,
    newUsers,
    activeUsers,
    usersByRole,
    userGrowth
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({
      where: { createdAt: { gte: dateThreshold } }
    }),
    prisma.user.count({
      where: {
        lastLogin: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }
      }
    }),
    prisma.user.groupBy({
      by: ['role'],
      _count: { role: true }
    }),
    prisma.user.groupBy({
      by: ['createdAt'],
      where: { createdAt: { gte: dateThreshold } },
      _count: { createdAt: true },
      orderBy: { createdAt: 'asc' }
    })
  ]);

  return {
    totalUsers,
    newUsers,
    activeUsers,
    usersByRole: usersByRole.reduce((acc, item) => {
      acc[item.role] = item._count.role;
      return acc;
    }, {}),
    userGrowth: userGrowth.map(item => ({
      date: item.createdAt,
      count: item._count.createdAt
    }))
  };
}

async function getJobStats(dateThreshold) {
  const [
    totalJobs,
    newJobs,
    activeJobs,
    jobsByCategory,
    jobsByType
  ] = await Promise.all([
    prisma.job.count({ where: { status: 'PUBLISHED' } }),
    prisma.job.count({
      where: { 
        status: 'PUBLISHED',
        postedDate: { gte: dateThreshold }
      }
    }),
    prisma.job.count({
      where: { 
        status: 'PUBLISHED',
        expirationDate: { gt: new Date() }
      }
    }),
    prisma.job.groupBy({
      by: ['categoryId'],
      where: { status: 'PUBLISHED' },
      _count: { categoryId: true },
      _avg: { applicationsCount: true }
    }),
    prisma.job.groupBy({
      by: ['employmentType'],
      where: { status: 'PUBLISHED' },
      _count: { employmentType: true }
    })
  ]);

  return {
    totalJobs,
    newJobs,
    activeJobs,
    jobsByCategory,
    jobsByType: jobsByType.reduce((acc, item) => {
      acc[item.employmentType] = item._count.employmentType;
      return acc;
    }, {})
  };
}

async function getApplicationStats(dateThreshold) {
  const [
    totalApplications,
    newApplications,
    applicationsByStatus,
    avgResponseTime,
    conversionFunnel
  ] = await Promise.all([
    prisma.application.count(),
    prisma.application.count({
      where: { appliedAt: { gte: dateThreshold } }
    }),
    prisma.application.groupBy({
      by: ['status'],
      _count: { status: true }
    }),
    calculateAverageResponseTime(),
    calculateConversionFunnel()
  ]);

  return {
    totalApplications,
    newApplications,
    applicationsByStatus: applicationsByStatus.reduce((acc, item) => {
      acc[item.status] = item._count.status;
      return acc;
    }, {}),
    avgResponseTime,
    conversionFunnel
  };
}

async function calculateAverageResponseTime() {
  const applications = await prisma.application.findMany({
    where: {
      statusChangedAt: { not: null },
      status: { in: ['REJECTED', 'HIRED', 'OFFERED'] }
    },
    select: {
      appliedAt: true,
      statusChangedAt: true
    },
    take: 1000
  });

  if (applications.length === 0) return null;

  const totalTime = applications.reduce((sum, app) => {
    return sum + (app.statusChangedAt - app.appliedAt);
  }, 0);

  return Math.round(totalTime / applications.length / (1000 * 60 * 60 * 24)); // Convert to days
}

async function calculateConversionFunnel() {
  const stages = [
    { status: 'PENDING', label: 'Applied' },
    { status: 'REVIEWING', label: 'Under Review' },
    { status: 'SHORTLISTED', label: 'Shortlisted' },
    { status: 'INTERVIEWING', label: 'Interviewing' },
    { status: 'OFFERED', label: 'Offered' },
    { status: 'HIRED', label: 'Hired' }
  ];

  const funnel = [];
  for (const stage of stages) {
    const count = await prisma.application.count({
      where: { status: stage.status }
    });
    funnel.push({ stage: stage.label, count });
  }

  return funnel;
}

async function getRevenueStats(dateThreshold) {
  const [
    totalRevenue,
    monthlyRevenue,
    revenueByPlan,
    successfulTransactions
  ] = await Promise.all([
    prisma.payment.aggregate({
      where: { 
        status: 'COMPLETED',
        completedAt: { gte: dateThreshold }
      },
      _sum: { amount: true }
    }),
    prisma.payment.groupBy({
      by: ['completedAt'],
      where: { 
        status: 'COMPLETED',
        completedAt: { gte: dateThreshold }
      },
      _sum: { amount: true },
      orderBy: { completedAt: 'asc' }
    }),
    prisma.payment.groupBy({
      by: ['type'],
      where: { 
        status: 'COMPLETED',
        completedAt: { gte: dateThreshold }
      },
      _sum: { amount: true }
    }),
    prisma.payment.count({
      where: { 
        status: 'COMPLETED',
        completedAt: { gte: dateThreshold }
      }
    })
  ]);

  return {
    totalRevenue: totalRevenue._sum.amount || 0,
    monthlyRevenue: monthlyRevenue.map(item => ({
      month: item.completedAt,
      revenue: item._sum.amount
    })),
    revenueByPlan: revenueByPlan.reduce((acc, item) => {
      acc[item.type] = item._sum.amount;
      return acc;
    }, {}),
    successfulTransactions
  };
}

async function getPerformanceStats() {
  // This would include API response times, error rates, etc.
  // For now, return mock data
  return {
    avgResponseTime: 150, // ms
    errorRate: 0.5, // percentage
    uptime: 99.9, // percentage
    activeConnections: 42
  };
}

async function getRecentActivity() {
  const activities = await prisma.analyticsEvent.findMany({
    include: {
      user: {
        select: {
          email: true,
          profile: {
            select: {
              firstName: true,
              lastName: true
            }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  return activities.map(activity => ({
    id: activity.id,
    userId: activity.userId,
    user: activity.user ? 
      `${activity.user.profile?.firstName} ${activity.user.profile?.lastName}` : 
      'Anonymous',
    eventType: activity.eventType,
    timestamp: activity.createdAt,
    properties: activity.properties
  }));
}

async function getDashboardOverview(userId, userRole) {
  if (userRole === 'WORKER') {
    const [
      totalApplications,
      interviews,
      offers,
      profileViews,
      kfnScore
    ] = await Promise.all([
      prisma.application.count({ where: { applicantId: userId } }),
      prisma.application.count({ 
        where: { 
          applicantId: userId,
          status: { in: ['INTERVIEWING', 'SHORTLISTED'] }
        }
      }),
      prisma.application.count({ 
        where: { 
          applicantId: userId,
          status: { in: ['OFFERED', 'HIRED'] }
        }
      }),
      prisma.userAnalytics.findUnique({
        where: { userId },
        select: { profileViews: true }
      }).then(data => data?.profileViews || 0),
      prisma.workerProfile.findUnique({
        where: { userId },
        select: { kfnScore: true }
      }).then(data => data?.kfnScore || 0)
    ]);

    return {
      totalApplications,
      interviews,
      offers,
      profileViews,
      kfnScore
    };
  } else if (userRole === 'EMPLOYER') {
    const [
      totalJobs,
      activeJobs,
      totalApplications,
      interviewsScheduled,
      totalHires
    ] = await Promise.all([
      prisma.job.count({ where: { employerId: userId } }),
      prisma.job.count({ 
        where: { 
          employerId: userId,
          status: 'PUBLISHED'
        }
      }),
      prisma.application.count({
        where: {
          job: { employerId: userId }
        }
      }),
      prisma.interview.count({
        where: {
          application: {
            job: { employerId: userId }
          }
        }
      }),
      prisma.application.count({
        where: {
          job: { employerId: userId },
          status: 'HIRED'
        }
      })
    ]);

    return {
      totalJobs,
      activeJobs,
      totalApplications,
      interviewsScheduled,
      totalHires
    };
  }

  return {};
}

async function getDashboardCharts(userId, userRole) {
  // Return chart data based on user role
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  if (userRole === 'WORKER') {
    // Applications over time
    const applicationsByDay = await prisma.application.groupBy({
      by: ['appliedAt'],
      where: {
        applicantId: userId,
        appliedAt: { gte: thirtyDaysAgo }
      },
      _count: { appliedAt: true },
      orderBy: { appliedAt: 'asc' }
    });

    return {
      applicationsOverTime: applicationsByDay.map(item => ({
        date: item.appliedAt,
        count: item._count.appliedAt
      }))
    };
  } else if (userRole === 'EMPLOYER') {
    // Job views and applications over time
    const jobs = await prisma.job.findMany({
      where: {
        employerId: userId,
        postedDate: { gte: thirtyDaysAgo }
      },
      select: {
        postedDate: true,
        views: true,
        applicationsCount: true
      },
      orderBy: { postedDate: 'asc' }
    });

    return {
      jobPerformance: jobs.map(job => ({
        date: job.postedDate,
        views: job.views,
        applications: job.applicationsCount
      }))
    };
  }

  return {};
}

async function getRecentUserActivity(userId) {
  const activities = await prisma.analyticsEvent.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10
  });

  return activities.map(activity => ({
    eventType: activity.eventType,
    timestamp: activity.createdAt,
    properties: activity.properties
  }));
}

async function getAnalyticsInsights(userId, userRole) {
  const insights = [];

  if (userRole === 'WORKER') {
    // Get worker-specific insights
    const profileCompleteness = await prisma.userAnalytics.findUnique({
      where: { userId },
      select: { profileCompleteness: true }
    });

    if (profileCompleteness?.profileCompleteness < 70) {
      insights.push({
        type: 'PROFILE_COMPLETENESS',
        message: 'Your profile is incomplete. Complete your profile to increase your job match rate.',
        priority: 'HIGH',
        action: 'UPDATE_PROFILE'
      });
    }

    const lastApplication = await prisma.application.findFirst({
      where: { applicantId: userId },
      orderBy: { appliedAt: 'desc' }
    });

    if (lastApplication) {
      const daysSinceLastApply = Math.floor(
        (new Date() - lastApplication.appliedAt) / (1000 * 60 * 60 * 24)
      );

      if (daysSinceLastApply > 7) {
        insights.push({
          type: 'APPLICATION_ACTIVITY',
          message: `It's been ${daysSinceLastApply} days since your last application. Consider applying to more jobs.`,
          priority: 'MEDIUM',
          action: 'BROWSE_JOBS'
        });
      }
    }
  } else if (userRole === 'EMPLOYER') {
    // Get employer-specific insights
    const jobsWithoutApplications = await prisma.job.count({
      where: {
        employerId: userId,
        status: 'PUBLISHED',
        applicationsCount: 0,
        postedDate: { lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) }
      }
    });

    if (jobsWithoutApplications > 0) {
      insights.push({
        type: 'JOB_PERFORMANCE',
        message: `${jobsWithoutApplications} of your job postings have no applications. Consider updating the job descriptions or requirements.`,
        priority: 'MEDIUM',
        action: 'REVIEW_JOBS'
      });
    }

    const pendingApplications = await prisma.application.count({
      where: {
        job: { employerId: userId },
        status: 'PENDING',
        appliedAt: { lt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) }
      }
    });

    if (pendingApplications > 0) {
      insights.push({
        type: 'APPLICATION_RESPONSE',
        message: `You have ${pendingApplications} applications pending review for more than 3 days.`,
        priority: 'HIGH',
        action: 'REVIEW_APPLICATIONS'
      });
    }
  }

  return insights;
}

function convertToCSV(data) {
  if (data.length === 0) return '';

  const headers = Object.keys(data[0]).join(',');
  const rows = data.map(item => 
    Object.values(item).map(value => 
      typeof value === 'object' ? JSON.stringify(value) : value
    ).join(',')
  );

  return [headers, ...rows].join('\n');
}

module.exports = router;
