const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class InterviewRepository {
  // Create interview
  async createInterview(data) {
    return await prisma.interview.create({
      data: {
        applicationId: data.applicationId,
        jobId: data.jobId,
        employerId: data.employerId,
        workerId: data.workerId,
        type: data.type,
        status: data.status || 'SCHEDULED',
        scheduledAt: data.scheduledAt,
        duration: data.duration || 60,
        timezone: data.timezone,
        platform: data.platform || 'ZOOM',
        meetingLink: data.meetingLink,
        notes: data.notes,
        aiGenerated: data.aiGenerated || false,
        metadata: data.metadata || {},
      },
    });
  }

  // Get interview by ID
  async getById(interviewId) {
    return await prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        job: {
          select: {
            id: true,
            title: true,
            employerId: true,
            employer: {
              select: {
                companyName: true,
              },
            },
          },
        },
        employer: {
          select: {
            id: true,
            companyName: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        worker: {
          select: {
            id: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        feedback: true,
      },
    });
  }

  // Get interviews by user
  async getUserInterviews(userId, userRole, options = {}) {
    const { page = 1, limit = 20, status } = options;
    const skip = (page - 1) * limit;

    const where = {};
    if (userRole === 'EMPLOYER') {
      where.employerId = userId;
    } else if (userRole === 'WORKER') {
      where.workerId = userId;
    }

    if (status) {
      where.status = status;
    }

    return await prisma.interview.findMany({
      where,
      skip,
      take: limit,
      orderBy: { scheduledAt: 'asc' },
      include: {
        job: {
          select: {
            title: true,
          },
        },
        employer: {
          select: {
            companyName: true,
          },
        },
        worker: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
  }

  // Update interview status
  async updateStatus(interviewId, status, notes = null) {
    const data = { status, updatedAt: new Date() };
    if (notes) data.notes = notes;

    if (status === 'COMPLETED') {
      data.completedAt = new Date();
    } else if (status === 'CANCELLED') {
      data.cancelledAt = new Date();
    }

    return await prisma.interview.update({
      where: { id: interviewId },
      data,
    });
  }

  // Reschedule interview
  async reschedule(interviewId, newTime, duration = null) {
    const data = {
      scheduledAt: newTime,
      status: 'RESCHEDULED',
      updatedAt: new Date(),
    };

    if (duration) {
      data.duration = duration;
    }

    return await prisma.interview.update({
      where: { id: interviewId },
      data,
    });
  }

  // Add interview feedback
  async addFeedback(interviewId, feedbackData) {
    return await prisma.interviewFeedback.create({
      data: {
        interviewId,
        reviewerId: feedbackData.reviewerId,
        rating: feedbackData.rating,
        strengths: feedbackData.strengths || [],
        weaknesses: feedbackData.weaknesses || [],
        notes: feedbackData.notes,
        recommendation: feedbackData.recommendation,
        aiAnalysis: feedbackData.aiAnalysis || {},
      },
    });
  }

  // Get interview feedback
  async getFeedback(interviewId) {
    return await prisma.interviewFeedback.findUnique({
      where: { interviewId },
      include: {
        reviewer: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
    });
  }

  // Get upcoming interviews
  async getUpcomingInterviews(userId, userRole, hours = 24) {
    const now = new Date();
    const future = new Date(now.getTime() + hours * 60 * 60 * 1000);

    const where = {
      scheduledAt: {
        gte: now,
        lte: future,
      },
      status: 'SCHEDULED',
    };

    if (userRole === 'EMPLOYER') {
      where.employerId = userId;
    } else if (userRole === 'WORKER') {
      where.workerId = userId;
    }

    return await prisma.interview.findMany({
      where,
      orderBy: { scheduledAt: 'asc' },
      include: {
        job: {
          select: {
            title: true,
          },
        },
        employer: {
          select: {
            companyName: true,
          },
        },
        worker: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
      },
    });
  }

  // Get interview statistics
  async getStatistics(userId, userRole, period = 'MONTH') {
    const now = new Date();
    let startDate;

    switch (period) {
      case 'WEEK':
        startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case 'MONTH':
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case 'QUARTER':
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    const where = {
      createdAt: {
        gte: startDate,
      },
    };

    if (userRole === 'EMPLOYER') {
      where.employerId = userId;
    } else if (userRole === 'WORKER') {
      where.workerId = userId;
    }

    const interviews = await prisma.interview.findMany({
      where,
      select: {
        status: true,
        scheduledAt: true,
        completedAt: true,
      },
    });

    return {
      total: interviews.length,
      scheduled: interviews.filter(i => i.status === 'SCHEDULED').length,
      completed: interviews.filter(i => i.status === 'COMPLETED').length,
      cancelled: interviews.filter(i => i.status === 'CANCELLED').length,
      noShow: interviews.filter(i => i.status === 'NO_SHOW').length,
      averageDuration: this.calculateAverageDuration(interviews),
    };
  }

  // Helper method to calculate average interview duration
  calculateAverageDuration(interviews) {
    const completed = interviews.filter(i => i.status === 'COMPLETED' && i.scheduledAt && i.completedAt);
    if (completed.length === 0) return 0;

    const totalDuration = completed.reduce((sum, interview) => {
      const duration = interview.completedAt - interview.scheduledAt;
      return sum + duration;
    }, 0);

    return Math.round(totalDuration / completed.length / (60 * 1000)); // Return in minutes
  }

  // Delete interview
  async deleteInterview(interviewId) {
    return await prisma.interview.delete({
      where: { id: interviewId },
    });
  }
}

module.exports = new InterviewRepository();
