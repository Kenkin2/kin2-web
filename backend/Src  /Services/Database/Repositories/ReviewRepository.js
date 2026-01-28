const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ReviewRepository {
  // Create review
  async createReview(data) {
    return await prisma.review.create({
      data: {
        reviewerId: data.reviewerId,
        revieweeId: data.revieweeId,
        type: data.type, // EMPLOYER_TO_WORKER, WORKER_TO_EMPLOYER, PEER
        jobId: data.jobId,
        rating: data.rating,
        title: data.title,
        comment: data.comment,
        strengths: data.strengths || [],
        areasForImprovement: data.areasForImprovement || [],
        anonymous: data.anonymous || false,
        verified: data.verified || false,
        metadata: data.metadata || {},
      },
    });
  }

  // Get review by ID
  async getById(reviewId) {
    return await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        reviewer: {
          select: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                profile: {
                  select: {
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        reviewee: {
          select: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        job: {
          select: {
            title: true,
          },
        },
      },
    });
  }

  // Get reviews for user
  async getReviewsForUser(userId, options = {}) {
    const { page = 1, limit = 20, type, includeAnonymous = true } = options;
    const skip = (page - 1) * limit;

    const where = { revieweeId: userId };
    
    if (type) {
      where.type = type;
    }
    
    if (!includeAnonymous) {
      where.anonymous = false;
    }

    return await prisma.review.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reviewer: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profile: {
                  select: {
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        job: {
          select: {
            title: true,
          },
        },
      },
    });
  }

  // Get reviews by reviewer
  async getReviewsByUser(userId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    return await prisma.review.findMany({
      where: { reviewerId: userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reviewee: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        job: {
          select: {
            title: true,
          },
        },
      },
    });
  }

  // Update review
  async updateReview(reviewId, data) {
    const allowedFields = ['rating', 'title', 'comment', 'strengths', 'areasForImprovement', 'anonymous'];
    const updateData = {};

    allowedFields.forEach(field => {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    });

    updateData.updatedAt = new Date();

    return await prisma.review.update({
      where: { id: reviewId },
      data: updateData,
    });
  }

  // Delete review
  async deleteReview(reviewId) {
    return await prisma.review.delete({
      where: { id: reviewId },
    });
  }

  // Get average rating for user
  async getAverageRating(userId, type = null) {
    const where = { revieweeId: userId };
    if (type) {
      where.type = type;
    }

    const result = await prisma.review.aggregate({
      where,
      _avg: {
        rating: true,
      },
      _count: {
        rating: true,
      },
    });

    return {
      average: result._avg.rating || 0,
      count: result._count.rating || 0,
    };
  }

  // Get rating breakdown
  async getRatingBreakdown(userId) {
    const reviews = await prisma.review.findMany({
      where: { revieweeId: userId },
      select: { rating: true },
    });

    const breakdown = {
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 0,
    };

    reviews.forEach(review => {
      const rating = Math.round(review.rating);
      if (breakdown[rating] !== undefined) {
        breakdown[rating]++;
      }
    });

    return breakdown;
  }

  // Get reviews by job
  async getReviewsByJob(jobId, options = {}) {
    const { page = 1, limit = 20 } = options;
    const skip = (page - 1) * limit;

    return await prisma.review.findMany({
      where: { jobId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        reviewer: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profile: {
                  select: {
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        reviewee: {
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

  // Get recent reviews
  async getRecentReviews(limit = 10) {
    return await prisma.review.findMany({
      take: limit,
      orderBy: { createdAt: 'desc' },
      where: {
        anonymous: false,
        verified: true,
      },
      include: {
        reviewer: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                profile: {
                  select: {
                    avatarUrl: true,
                  },
                },
              },
            },
          },
        },
        reviewee: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        job: {
          select: {
            title: true,
          },
        },
      },
    });
  }

  // Mark review as verified (e.g., after job completion)
  async markAsVerified(reviewId) {
    return await prisma.review.update({
      where: { id: reviewId },
      data: {
        verified: true,
        verifiedAt: new Date(),
      },
    });
  }

  // Report review
  async reportReview(reviewId, reporterId, reason) {
    return await prisma.reviewReport.create({
      data: {
        reviewId,
        reporterId,
        reason,
        status: 'PENDING',
      },
    });
  }

  // Check if user has reviewed for specific job
  async hasReviewedJob(reviewerId, jobId, type) {
    const review = await prisma.review.findFirst({
      where: {
        reviewerId,
        jobId,
        type,
      },
    });

    return !!review;
  }
}

module.exports = new ReviewRepository();
