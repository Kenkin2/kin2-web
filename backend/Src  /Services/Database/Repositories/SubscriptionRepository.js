const BaseRepository = require('../BaseRepository');

class SubscriptionRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'subscription');
  }

  /**
   * Create subscription with validation
   */
  async create(data) {
    try {
      // Validate plan exists
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: data.planId },
      });

      if (!plan) {
        throw new Error('Subscription plan not found');
      }

      // Check for existing active subscription
      if (data.userId) {
        const existing = await this.findActiveUserSubscription(data.userId);
        if (existing) {
          throw new Error('User already has an active subscription');
        }
      } else if (data.employerId) {
        const existing = await this.findActiveEmployerSubscription(data.employerId);
        if (existing) {
          throw new Error('Employer already has an active subscription');
        }
      }

      // Set subscription dates
      const startDate = new Date();
      const endDate = new Date();
      endDate.setMonth(endDate.getMonth() + plan.durationMonths);

      const subscriptionData = {
        ...data,
        startDate,
        endDate,
        status: data.status || 'ACTIVE',
        nextBillingDate: endDate,
      };

      return await super.create(subscriptionData);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find active user subscription
   */
  async findActiveUserSubscription(userId) {
    try {
      return await this.model.findFirst({
        where: {
          userId,
          status: 'ACTIVE',
          endDate: { gt: new Date() },
        },
        include: {
          plan: true,
          payments: {
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
   * Find active employer subscription
   */
  async findActiveEmployerSubscription(employerId) {
    try {
      return await this.model.findFirst({
        where: {
          employerId,
          status: 'ACTIVE',
          endDate: { gt: new Date() },
        },
        include: {
          plan: true,
          payments: {
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
   * Find subscription by user or employer
   */
  async findBySubscriber(userId = null, employerId = null) {
    try {
      const where = {};

      if (userId) {
        where.userId = userId;
      } else if (employerId) {
        where.employerId = employerId;
      } else {
        throw new Error('Either userId or employerId is required');
      }

      return await this.findMany({
        where,
        include: {
          plan: true,
          payments: {
            orderBy: { createdAt: 'desc' },
          },
        },
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(subscriptionId, reason = null, cancelledBy = null) {
    try {
      const subscription = await this.findById(subscriptionId);
      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status !== 'ACTIVE') {
        throw new Error('Only active subscriptions can be cancelled');
      }

      const updated = await this.model.update({
        where: { id: subscriptionId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancellationReason: reason,
          cancelledBy,
        },
      });

      // Update user/employer subscription status
      await this.updateSubscriberStatus(subscription, false);

      // Create cancellation log
      await this.prisma.subscriptionCancellation.create({
        data: {
          subscriptionId,
          reason,
          cancelledBy,
          cancelledAt: new Date(),
          refundAmount: this.calculateRefundAmount(subscription),
        },
      });

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update subscriber status
   */
  async updateSubscriberStatus(subscription, hasActiveSubscription) {
    try {
      if (subscription.userId) {
        await this.prisma.user.update({
          where: { id: subscription.userId },
          data: {
            hasActiveSubscription,
            subscriptionTier: hasActiveSubscription ? subscription.plan?.tier : 'FREE',
          },
        });
      } else if (subscription.employerId) {
        await this.prisma.employerProfile.update({
          where: { id: subscription.employerId },
          data: {
            hasActiveSubscription,
            subscriptionTier: hasActiveSubscription ? subscription.plan?.tier : 'FREE',
          },
        });
      }
    } catch (error) {
      console.error('Failed to update subscriber status:', error);
    }
  }

  /**
   * Calculate refund amount for cancelled subscription
   */
  calculateRefundAmount(subscription) {
    const now = new Date();
    const totalDays = (subscription.endDate - subscription.startDate) / (1000 * 60 * 60 * 24);
    const usedDays = (now - subscription.startDate) / (1000 * 60 * 60 * 24);
    const unusedPercentage = Math.max(0, (totalDays - usedDays) / totalDays);
    
    const totalAmount = subscription.plan?.price || 0;
    return totalAmount * unusedPercentage;
  }

  /**
   * Renew subscription
   */
  async renewSubscription(subscriptionId) {
    try {
      const subscription = await this.findById(subscriptionId, {
        include: { plan: true },
      });

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status !== 'ACTIVE') {
        throw new Error('Only active subscriptions can be renewed');
      }

      // Calculate new dates
      const newStartDate = new Date(subscription.endDate);
      const newEndDate = new Date(newStartDate);
      newEndDate.setMonth(newEndDate.getMonth() + subscription.plan.durationMonths);

      const renewed = await this.model.update({
        where: { id: subscriptionId },
        data: {
          startDate: newStartDate,
          endDate: newEndDate,
          nextBillingDate: newEndDate,
          status: 'ACTIVE',
          renewalCount: {
            increment: 1,
          },
          lastRenewedAt: new Date(),
        },
      });

      // Create renewal record
      await this.prisma.subscriptionRenewal.create({
        data: {
          subscriptionId,
          renewedAt: new Date(),
          previousEndDate: subscription.endDate,
          newEndDate,
          amount: subscription.plan.price,
        },
      });

      // Send renewal confirmation
      await this.sendRenewalConfirmation(renewed);

      return renewed;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Send renewal confirmation
   */
  async sendRenewalConfirmation(subscription) {
    try {
      let recipient;
      if (subscription.userId) {
        recipient = await this.prisma.user.findUnique({
          where: { id: subscription.userId },
          select: { email: true, firstName: true },
        });
      } else if (subscription.employerId) {
        const employer = await this.prisma.employerProfile.findUnique({
          where: { id: subscription.employerId },
          select: { companyEmail: true, companyName: true },
        });
        recipient = {
          email: employer.companyEmail,
          name: employer.companyName,
        };
      }

      if (recipient) {
        await this.prisma.notification.create({
          data: {
            userId: subscription.userId,
            employerId: subscription.employerId,
            type: 'SUBSCRIPTION_RENEWED',
            title: 'Subscription Renewed',
            message: `Your subscription has been renewed until ${subscription.endDate.toDateString()}`,
            data: {
              subscriptionId: subscription.id,
              endDate: subscription.endDate,
              planName: subscription.plan?.name,
            },
          },
        });
      }
    } catch (error) {
      console.error('Renewal confirmation failed:', error);
    }
  }

  /**
   * Upgrade subscription
   */
  async upgradeSubscription(subscriptionId, newPlanId) {
    try {
      const subscription = await this.findById(subscriptionId, {
        include: { plan: true },
      });

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status !== 'ACTIVE') {
        throw new Error('Only active subscriptions can be upgraded');
      }

      const newPlan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: newPlanId },
      });

      if (!newPlan) {
        throw new Error('New plan not found');
      }

      if (newPlan.price <= subscription.plan.price) {
        throw new Error('New plan must be more expensive than current plan');
      }

      // Calculate prorated upgrade cost
      const upgradeCost = this.calculateUpgradeCost(subscription, newPlan);

      // Create upgrade record
      const upgrade = await this.prisma.subscriptionUpgrade.create({
        data: {
          subscriptionId,
          fromPlanId: subscription.planId,
          toPlanId: newPlanId,
          upgradeCost,
          proratedAmount: this.calculateProratedAmount(subscription),
          effectiveDate: new Date(),
        },
      });

      // Update subscription
      const updated = await this.model.update({
        where: { id: subscriptionId },
        data: {
          planId: newPlanId,
          upgradedAt: new Date(),
          upgradeId: upgrade.id,
        },
      });

      // Create payment for upgrade difference
      if (upgradeCost > 0) {
        await this.prisma.payment.create({
          data: {
            userId: subscription.userId,
            employerId: subscription.employerId,
            amount: upgradeCost,
            paymentType: 'SUBSCRIPTION_UPGRADE',
            description: `Upgrade from ${subscription.plan.name} to ${newPlan.name}`,
            status: 'PENDING',
            metadata: {
              upgradeId: upgrade.id,
              subscriptionId,
            },
          },
        });
      }

      return {
        subscription: updated,
        upgrade,
        upgradeCost,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate upgrade cost
   */
  calculateUpgradeCost(subscription, newPlan) {
    const now = new Date();
    const totalDays = (subscription.endDate - subscription.startDate) / (1000 * 60 * 60 * 24);
    const remainingDays = (subscription.endDate - now) / (1000 * 60 * 60 * 24);
    const remainingPercentage = remainingDays / totalDays;

    const currentPlanValue = subscription.plan.price * remainingPercentage;
    const newPlanValue = newPlan.price * remainingPercentage;

    return Math.max(0, newPlanValue - currentPlanValue);
  }

  /**
   * Calculate prorated amount
   */
  calculateProratedAmount(subscription) {
    const now = new Date();
    const totalDays = (subscription.endDate - subscription.startDate) / (1000 * 60 * 60 * 24);
    const usedDays = (now - subscription.startDate) / (1000 * 60 * 60 * 24);
    const usedPercentage = usedDays / totalDays;

    return subscription.plan.price * usedPercentage;
  }

  /**
   * Downgrade subscription
   */
  async downgradeSubscription(subscriptionId, newPlanId, effectiveDate = null) {
    try {
      const subscription = await this.findById(subscriptionId, {
        include: { plan: true },
      });

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      const newPlan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: newPlanId },
      });

      if (!newPlan) {
        throw new Error('New plan not found');
      }

      if (newPlan.price >= subscription.plan.price) {
        throw new Error('New plan must be less expensive than current plan');
      }

      const effective = effectiveDate || new Date();

      // Create downgrade record
      const downgrade = await this.prisma.subscriptionDowngrade.create({
        data: {
          subscriptionId,
          fromPlanId: subscription.planId,
          toPlanId: newPlanId,
          effectiveDate: effective,
          creditAmount: this.calculateDowngradeCredit(subscription, newPlan, effective),
        },
      });

      // Schedule downgrade
      await this.prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          scheduledDowngradeId: downgrade.id,
          scheduledDowngradeDate: effective,
        },
      });

      return {
        subscription,
        downgrade,
        effectiveDate: effective,
        message: `Downgrade scheduled for ${effective.toDateString()}`,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate downgrade credit
   */
  calculateDowngradeCredit(subscription, newPlan, effectiveDate) {
    const effective = new Date(effectiveDate);
    const remainingDays = (subscription.endDate - effective) / (1000 * 60 * 60 * 24);
    const totalDays = (subscription.endDate - subscription.startDate) / (1000 * 60 * 60 * 24);
    const remainingPercentage = remainingDays / totalDays;

    const currentPlanValue = subscription.plan.price * remainingPercentage;
    const newPlanValue = newPlan.price * remainingPercentage;

    return currentPlanValue - newPlanValue;
  }

  /**
   * Process scheduled downgrades
   */
  async processScheduledDowngrades() {
    try {
      const now = new Date();
      const subscriptions = await this.model.findMany({
        where: {
          scheduledDowngradeDate: { lte: now },
          scheduledDowngradeId: { not: null },
          status: 'ACTIVE',
        },
        include: {
          scheduledDowngrade: {
            include: {
              toPlan: true,
            },
          },
        },
      });

      const results = [];

      for (const subscription of subscriptions) {
        try {
          // Apply downgrade
          await this.model.update({
            where: { id: subscription.id },
            data: {
              planId: subscription.scheduledDowngrade.toPlanId,
              scheduledDowngradeId: null,
              scheduledDowngradeDate: null,
              downgradedAt: now,
            },
          });

          // Create credit for difference
          if (subscription.scheduledDowngrade.creditAmount > 0) {
            await this.prisma.payment.create({
              data: {
                userId: subscription.userId,
                employerId: subscription.employerId,
                amount: -subscription.scheduledDowngrade.creditAmount, // Negative amount for credit
                paymentType: 'SUBSCRIPTION_CREDIT',
                description: `Credit from downgrade to ${subscription.scheduledDowngrade.toPlan.name}`,
                status: 'COMPLETED',
                metadata: {
                  downgradeId: subscription.scheduledDowngrade.id,
                  subscriptionId: subscription.id,
                },
              },
            });
          }

          results.push({
            subscriptionId: subscription.id,
            status: 'SUCCESS',
            newPlan: subscription.scheduledDowngrade.toPlan.name,
            creditAmount: subscription.scheduledDowngrade.creditAmount,
          });
        } catch (error) {
          results.push({
            subscriptionId: subscription.id,
            status: 'FAILED',
            error: error.message,
          });
        }
      }

      return {
        processed: subscriptions.length,
        results,
        timestamp: now.toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get subscription usage
   */
  async getSubscriptionUsage(subscriptionId, feature = null) {
    try {
      const subscription = await this.findById(subscriptionId, {
        include: { plan: true },
      });

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      const planLimits = subscription.plan.limits || {};
      const usage = {};

      // Calculate usage for each feature
      if (feature) {
        usage[feature] = await this.calculateFeatureUsage(subscription, feature);
      } else {
        // Calculate usage for all features
        for (const [featureName, limit] of Object.entries(planLimits)) {
          if (typeof limit === 'number') {
            usage[featureName] = await this.calculateFeatureUsage(subscription, featureName);
          }
        }
      }

      // Calculate usage percentages
      const usageWithPercentages = {};
      for (const [featureName, used] of Object.entries(usage)) {
        const limit = planLimits[featureName];
        const percentage = limit > 0 ? (used / limit) * 100 : 0;
        
        usageWithPercentages[featureName] = {
          used,
          limit,
          percentage: parseFloat(percentage.toFixed(2)),
          remaining: Math.max(0, limit - used),
          status: percentage >= 90 ? 'NEAR_LIMIT' : percentage >= 100 ? 'EXCEEDED' : 'OK',
        };
      }

      return {
        subscriptionId,
        plan: subscription.plan.name,
        usage: usageWithPercentages,
        billingCycle: {
          startDate: subscription.startDate,
          endDate: subscription.endDate,
          daysRemaining: Math.ceil((subscription.endDate - new Date()) / (1000 * 60 * 60 * 24)),
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate feature usage
   */
  async calculateFeatureUsage(subscription, feature) {
    const userId = subscription.userId;
    const employerId = subscription.employerId;
    const startDate = subscription.startDate;
    const endDate = subscription.endDate;

    switch (feature) {
      case 'job_postings':
        if (employerId) {
          return await this.prisma.job.count({
            where: {
              companyId: employerId,
              postedAt: { gte: startDate, lte: endDate },
            },
          });
        }
        return 0;

      case 'applications':
        if (userId) {
          return await this.prisma.application.count({
            where: {
              userId,
              appliedAt: { gte: startDate, lte: endDate },
            },
          });
        }
        return 0;

      case 'resumes':
        if (userId) {
          return await this.prisma.resume.count({
            where: {
              userId,
              createdAt: { gte: startDate, lte: endDate },
            },
          });
        }
        return 0;

      case 'kfn_calculations':
        if (userId) {
          return await this.prisma.kFN.count({
            where: {
              userId,
              calculatedAt: { gte: startDate, lte: endDate },
            },
          });
        }
        return 0;

      case 'premium_support':
        // Count support tickets with premium priority
        const where = {
          createdAt: { gte: startDate, lte: endDate },
          priority: 'HIGH',
        };
        if (userId) where.userId = userId;
        if (employerId) where.employerId = employerId;
        
        return await this.prisma.supportTicket.count({ where });

      default:
        return 0;
    }
  }

  /**
   * Check subscription limit
   */
  async checkSubscriptionLimit(subscriptionId, feature, requestedCount = 1) {
    try {
      const usage = await this.getSubscriptionUsage(subscriptionId, feature);
      
      if (!usage.usage[feature]) {
        return {
          allowed: true,
          reason: 'Feature not limited in current plan',
        };
      }

      const { used, limit, remaining } = usage.usage[feature];

      if (remaining >= requestedCount) {
        return {
          allowed: true,
          remaining,
          used,
          limit,
        };
      } else {
        return {
          allowed: false,
          reason: `Exceeds ${feature} limit`,
          used,
          limit,
          remaining,
          requested: requestedCount,
          exceededBy: requestedCount - remaining,
        };
      }
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get expiring subscriptions
   */
  async getExpiringSubscriptions(days = 7) {
    try {
      const date = new Date();
      date.setDate(date.getDate() + days);

      return await this.findMany({
        where: {
          status: 'ACTIVE',
          endDate: {
            lte: date,
            gte: new Date(), // Not already expired
          },
        },
        include: {
          plan: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
            },
          },
          employer: {
            select: {
              id: true,
              companyName: true,
              companyEmail: true,
            },
          },
        },
        orderBy: { endDate: 'asc' },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get trial users
   */
  async getTrialUsers(status = 'ACTIVE') {
    try {
      return await this.findMany({
        where: {
          status,
          isTrial: true,
        },
        include: {
          plan: true,
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              createdAt: true,
            },
          },
          employer: {
            select: {
              id: true,
              companyName: true,
              companyEmail: true,
              createdAt: true,
            },
          },
        },
        orderBy: { endDate: 'asc' },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create trial subscription
   */
  async createTrialSubscription(userId = null, employerId = null, planId = null) {
    try {
      // Get trial plan if not specified
      let trialPlanId = planId;
      if (!trialPlanId) {
        const trialPlan = await this.prisma.subscriptionPlan.findFirst({
          where: { isTrial: true },
        });
        if (!trialPlan) {
          throw new Error('No trial plan available');
        }
        trialPlanId = trialPlan.id;
      }

      // Check if user/employer already had a trial
      const where = {
        isTrial: true,
        OR: [
          { userId: userId || undefined },
          { employerId: employerId || undefined },
        ],
      };

      const existingTrial = await this.findFirst(where);
      if (existingTrial) {
        throw new Error('Trial already used');
      }

      // Create trial subscription
      const trialDays = 14; // Default 14-day trial
      const startDate = new Date();
      const endDate = new Date();
      endDate.setDate(endDate.getDate() + trialDays);

      return await this.create({
        userId,
        employerId,
        planId: trialPlanId,
        startDate,
        endDate,
        status: 'ACTIVE',
        isTrial: true,
        nextBillingDate: endDate,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Convert trial to paid
   */
  async convertTrialToPaid(subscriptionId, planId) {
    try {
      const subscription = await this.findById(subscriptionId);
      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (!subscription.isTrial) {
        throw new Error('Only trial subscriptions can be converted');
      }

      const newPlan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: planId },
      });

      if (!newPlan) {
        throw new Error('Plan not found');
      }

      // Calculate remaining trial days
      const now = new Date();
      const remainingTrialDays = Math.max(0, (subscription.endDate - now) / (1000 * 60 * 60 * 24));

      // Extend subscription with new plan
      const newEndDate = new Date();
      newEndDate.setDate(newEndDate.getDate() + remainingTrialDays + (newPlan.durationMonths * 30));

      const updated = await this.model.update({
        where: { id: subscriptionId },
        data: {
          planId: newPlan.id,
          isTrial: false,
          endDate: newEndDate,
          nextBillingDate: newEndDate,
          convertedFromTrialAt: now,
        },
      });

      // Create conversion record
      await this.prisma.trialConversion.create({
        data: {
          subscriptionId,
          fromPlanId: subscription.planId,
          toPlanId: newPlan.id,
          convertedAt: now,
          trialDaysUsed: Math.floor((now - subscription.startDate) / (1000 * 60 * 60 * 24)),
          remainingTrialDays: Math.floor(remainingTrialDays),
        },
      });

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get subscription analytics
   */
  async getSubscriptionAnalytics(timeframe = '30d') {
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

      const where = {
        createdAt: { gte: date },
      };

      const [
        totalSubscriptions,
        activeSubscriptions,
        trialSubscriptions,
        byPlan,
        byStatus,
        churnRate,
        renewalRate,
        mrr,
        arr,
        growthMetrics,
      ] = await Promise.all([
        this.count(where),
        this.count({ ...where, status: 'ACTIVE' }),
        this.count({ ...where, isTrial: true }),
        this.model.groupBy({
          by: ['planId'],
          where,
          _count: { _all: true },
        }),
        this.model.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
        }),
        this.calculateChurnRate(where),
        this.calculateRenewalRate(where),
        this.calculateMRR(where),
        this.calculateARR(where),
        this.calculateGrowthMetrics(where),
      ]);

      // Get plan names
      const planDetails = await Promise.all(
        byPlan.map(async (item) => {
          const plan = await this.prisma.subscriptionPlan.findUnique({
            where: { id: item.planId },
            select: { name: true, price: true },
          });
          return {
            planId: item.planId,
            planName: plan?.name || 'Unknown',
            count: item._count._all,
            price: plan?.price || 0,
            revenue: item._count._all * (plan?.price || 0),
          };
        })
      );

      return {
        totals: {
          all: totalSubscriptions,
          active: activeSubscriptions,
          trial: trialSubscriptions,
          paid: totalSubscriptions - trialSubscriptions,
        },
        byPlan: planDetails.sort((a, b) => b.revenue - a.revenue),
        byStatus: byStatus.reduce((acc, item) => {
          acc[item.status] = item._count._all;
          return acc;
        }, {}),
        metrics: {
          churnRate,
          renewalRate,
          mrr,
          arr,
          ...growthMetrics,
        },
        timeframe,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate churn rate
   */
  async calculateChurnRate(where) {
    try {
      const cancelled = await this.count({
        ...where,
        status: 'CANCELLED',
      });

      const total = await this.count(where);
      
      return total > 0 ? (cancelled / total) * 100 : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate renewal rate
   */
  async calculateRenewalRate(where) {
    try {
      const renewed = await this.prisma.subscriptionRenewal.count({
        where: {
          renewedAt: where.createdAt,
        },
      });

      const eligible = await this.count({
        ...where,
        status: 'ACTIVE',
        endDate: { lt: new Date() }, // Past end date
      });

      return eligible > 0 ? (renewed / eligible) * 100 : 0;
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate Monthly Recurring Revenue
   */
  async calculateMRR(where) {
    try {
      const activeSubscriptions = await this.findMany({
        where: {
          ...where,
          status: 'ACTIVE',
          isTrial: false,
        },
        include: {
          plan: true,
        },
      });

      return activeSubscriptions.reduce((total, sub) => {
        const monthlyPrice = sub.plan?.price || 0;
        return total + monthlyPrice;
      }, 0);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate Annual Recurring Revenue
   */
  async calculateARR(where) {
    const mrr = await this.calculateMRR(where);
    return mrr * 12;
  }

  /**
   * Calculate growth metrics
   */
  async calculateGrowthMetrics(where) {
    try {
      const now = new Date();
      const previousPeriod = new Date(now);
      previousPeriod.setMonth(previousPeriod.getMonth() - 1);

      const currentMRR = await this.calculateMRR(where);
      const previousMRR = await this.calculateMRR({
        ...where,
        createdAt: { gte: previousPeriod, lt: now },
      });

      const currentSubs = await this.count({
        ...where,
        status: 'ACTIVE',
      });

      const previousSubs = await this.count({
        ...where,
        status: 'ACTIVE',
        createdAt: { gte: previousPeriod, lt: now },
      });

      const mrrGrowth = previousMRR > 0 ? ((currentMRR - previousMRR) / previousMRR) * 100 : 0;
      const subscriberGrowth = previousSubs > 0 ? ((currentSubs - previousSubs) / previousSubs) * 100 : 0;

      return {
        mrrGrowth: parseFloat(mrrGrowth.toFixed(2)),
        subscriberGrowth: parseFloat(subscriberGrowth.toFixed(2)),
        netNewMRR: currentMRR - previousMRR,
        netNewSubscribers: currentSubs - previousSubs,
      };
    } catch (error) {
      return {
        mrrGrowth: 0,
        subscriberGrowth: 0,
        netNewMRR: 0,
        netNewSubscribers: 0,
      };
    }
  }

  /**
   * Get subscription health
   */
  async getSubscriptionHealth(subscriptionId) {
    try {
      const subscription = await this.findById(subscriptionId, {
        include: { plan: true },
      });

      if (!subscription) {
        throw new Error('Subscription not found');
      }

      const now = new Date();
      const daysRemaining = Math.ceil((subscription.endDate - now) / (1000 * 60 * 60 * 24));
      const totalDays = Math.ceil((subscription.endDate - subscription.startDate) / (1000 * 60 * 60 * 24));
      const utilizationPercentage = ((totalDays - daysRemaining) / totalDays) * 100;

      // Get usage data
      const usage = await this.getSubscriptionUsage(subscriptionId);
      const nearLimitFeatures = Object.values(usage.usage || {}).filter(
        feature => feature.status === 'NEAR_LIMIT'
      ).length;

      const exceededFeatures = Object.values(usage.usage || {}).filter(
        feature => feature.status === 'EXCEEDED'
      ).length;

      // Calculate health score (0-100)
      let healthScore = 100;

      // Deduct for near expiration
      if (daysRemaining < 7) healthScore -= 30;
      else if (daysRemaining < 14) healthScore -= 15;

      // Deduct for usage limits
      healthScore -= (nearLimitFeatures * 10);
      healthScore -= (exceededFeatures * 20);

      // Deduct for payment issues
      if (subscription.status === 'PAST_DUE') healthScore -= 25;

      healthScore = Math.max(0, Math.min(100, healthScore));

      // Determine health status
      let status, color;
      if (healthScore >= 80) {
        status = 'HEALTHY';
        color = 'green';
      } else if (healthScore >= 60) {
        status = 'WARNING';
        color = 'yellow';
      } else {
        status = 'CRITICAL';
        color = 'red';
      }

      return {
        subscriptionId,
        healthScore: parseFloat(healthScore.toFixed(1)),
        status,
        color,
        metrics: {
          daysRemaining,
          utilizationPercentage: parseFloat(utilizationPercentage.toFixed(1)),
          nearLimitFeatures,
          exceededFeatures,
          subscriptionStatus: subscription.status,
        },
        issues: this.identifyHealthIssues(subscription, daysRemaining, exceededFeatures),
        recommendations: this.generateHealthRecommendations(healthScore, subscription, daysRemaining),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Identify health issues
   */
  identifyHealthIssues(subscription, daysRemaining, exceededFeatures) {
    const issues = [];

    if (daysRemaining < 7) {
      issues.push({
        type: 'EXPIRING_SOON',
        severity: 'HIGH',
        message: `Subscription expires in ${daysRemaining} days`,
        action: 'RENEW',
      });
    }

    if (exceededFeatures > 0) {
      issues.push({
        type: 'LIMIT_EXCEEDED',
        severity: 'MEDIUM',
        message: `${exceededFeatures} feature limit(s) exceeded`,
        action: 'UPGRADE',
      });
    }

    if (subscription.status === 'PAST_DUE') {
      issues.push({
        type: 'PAYMENT_ISSUE',
        severity: 'HIGH',
        message: 'Payment is past due',
        action: 'UPDATE_PAYMENT',
      });
    }

    return issues;
  }

  /**
   * Generate health recommendations
   */
  generateHealthRecommendations(healthScore, subscription, daysRemaining) {
    const recommendations = [];

    if (healthScore < 60) {
      recommendations.push({
        type: 'IMMEDIATE_ACTION',
        priority: 'HIGH',
        title: 'Take Immediate Action',
        description: 'Your subscription health is critical. Address the issues below.',
      });
    }

    if (daysRemaining < 14) {
      recommendations.push({
        type: 'RENEWAL',
        priority: daysRemaining < 7 ? 'HIGH' : 'MEDIUM',
        title: 'Renew Subscription',
        description: `Your subscription expires in ${daysRemaining} days. Renew to avoid interruption.`,
        action: 'RENEW_NOW',
      });
    }

    if (subscription.isTrial && daysRemaining < 3) {
      recommendations.push({
        type: 'TRIAL_CONVERSION',
        priority: 'HIGH',
        title: 'Convert Trial to Paid',
        description: 'Your trial is ending soon. Choose a plan to continue.',
        action: 'VIEW_PLANS',
      });
    }

    return recommendations;
  }

  /**
   * Send renewal reminders
   */
  async sendRenewalReminders(daysBefore = [7, 3, 1]) {
    try {
      const now = new Date();
      const results = [];

      for (const days of daysBefore) {
        const reminderDate = new Date(now);
        reminderDate.setDate(reminderDate.getDate() + days);

        const expiringSubscriptions = await this.getExpiringSubscriptions(days);

        for (const subscription of expiringSubscriptions) {
          try {
            // Check if reminder already sent
            const existingReminder = await this.prisma.subscriptionReminder.findFirst({
              where: {
                subscriptionId: subscription.id,
                daysBefore: days,
                sentAt: { gte: new Date(now.getFullYear(), now.getMonth(), now.getDate()) },
              },
            });

            if (existingReminder) {
              continue; // Already sent today
            }

            // Send reminder
            let recipient;
            if (subscription.userId) {
              recipient = await this.prisma.user.findUnique({
                where: { id: subscription.userId },
                select: { email: true, firstName: true },
              });
            } else if (subscription.employerId) {
              const employer = await this.prisma.employerProfile.findUnique({
                where: { id: subscription.employerId },
                select: { companyEmail: true, companyName: true },
              });
              recipient = {
                email: employer.companyEmail,
                name: employer.companyName,
              };
            }

            if (recipient) {
              // Create notification
              await this.prisma.notification.create({
                data: {
                  userId: subscription.userId,
                  employerId: subscription.employerId,
                  type: 'SUBSCRIPTION_RENEWAL_REMINDER',
                  title: 'Subscription Renewal Reminder',
                  message: `Your subscription expires in ${days} days. Renew now to continue uninterrupted service.`,
                  data: {
                    subscriptionId: subscription.id,
                    daysRemaining: days,
                    endDate: subscription.endDate,
                    planName: subscription.plan?.name,
                  },
                },
              });

              // Create reminder record
              await this.prisma.subscriptionReminder.create({
                data: {
                  subscriptionId: subscription.id,
                  daysBefore: days,
                  sentAt: new Date(),
                  recipientEmail: recipient.email,
                },
              });

              results.push({
                subscriptionId: subscription.id,
                daysBefore: days,
                status: 'SENT',
                recipient: recipient.email,
              });
            }
          } catch (error) {
            results.push({
              subscriptionId: subscription.id,
              daysBefore: days,
              status: 'FAILED',
              error: error.message,
            });
          }
        }
      }

      return {
        sent: results.filter(r => r.status === 'SENT').length,
        failed: results.filter(r => r.status === 'FAILED').length,
        results,
        timestamp: now.toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Process expired subscriptions
   */
  async processExpiredSubscriptions() {
    try {
      const now = new Date();
      const expiredSubscriptions = await this.findMany({
        where: {
          status: 'ACTIVE',
          endDate: { lt: now },
        },
        include: {
          plan: true,
        },
      });

      const results = [];

      for (const subscription of expiredSubscriptions) {
        try {
          // Update subscription status
          await this.model.update({
            where: { id: subscription.id },
            data: {
              status: 'EXPIRED',
              expiredAt: now,
            },
          });

          // Update user/employer status
          await this.updateSubscriberStatus(subscription, false);

          // Send expiration notification
          await this.sendExpirationNotification(subscription);

          results.push({
            subscriptionId: subscription.id,
            status: 'EXPIRED',
            processedAt: now,
          });
        } catch (error) {
          results.push({
            subscriptionId: subscription.id,
            status: 'FAILED',
            error: error.message,
          });
        }
      }

      return {
        processed: expiredSubscriptions.length,
        results,
        timestamp: now.toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Send expiration notification
   */
  async sendExpirationNotification(subscription) {
    try {
      let recipient;
      if (subscription.userId) {
        recipient = await this.prisma.user.findUnique({
          where: { id: subscription.userId },
          select: { email: true, firstName: true },
        });
      } else if (subscription.employerId) {
        const employer = await this.prisma.employerProfile.findUnique({
          where: { id: subscription.employerId },
          select: { companyEmail: true, companyName: true },
        });
        recipient = {
          email: employer.companyEmail,
          name: employer.companyName,
        };
      }

      if (recipient) {
        await this.prisma.notification.create({
          data: {
            userId: subscription.userId,
            employerId: subscription.employerId,
            type: 'SUBSCRIPTION_EXPIRED',
            title: 'Subscription Expired',
            message: 'Your subscription has expired. Renew now to restore access.',
            data: {
              subscriptionId: subscription.id,
              planName: subscription.plan?.name,
              expiredAt: new Date(),
            },
            priority: 'HIGH',
          },
        });
      }
    } catch (error) {
      console.error('Expiration notification failed:', error);
    }
  }

  /**
   * Get subscription comparison
   */
  async getSubscriptionComparison(currentPlanId, targetPlanId) {
    try {
      const [currentPlan, targetPlan] = await Promise.all([
        this.prisma.subscriptionPlan.findUnique({
          where: { id: currentPlanId },
        }),
        this.prisma.subscriptionPlan.findUnique({
          where: { id: targetPlanId },
        }),
      ]);

      if (!currentPlan || !targetPlan) {
        throw new Error('One or both plans not found');
      }

      const comparison = {
        currentPlan: {
          id: currentPlan.id,
          name: currentPlan.name,
          price: currentPlan.price,
          features: currentPlan.features || [],
          limits: currentPlan.limits || {},
        },
        targetPlan: {
          id: targetPlan.id,
          name: targetPlan.name,
          price: targetPlan.price,
          features: targetPlan.features || [],
          limits: targetPlan.limits || {},
        },
        differences: {
          priceDifference: targetPlan.price - currentPlan.price,
          newFeatures: this.findNewFeatures(currentPlan.features, targetPlan.features),
          removedFeatures: this.findRemovedFeatures(currentPlan.features, targetPlan.features),
          limitChanges: this.compareLimits(currentPlan.limits, targetPlan.limits),
        },
        recommendation: this.generatePlanRecommendation(currentPlan, targetPlan),
      };

      return comparison;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find new features
   */
  findNewFeatures(currentFeatures, targetFeatures) {
    return targetFeatures.filter(
      feature => !currentFeatures.includes(feature)
    );
  }

  /**
   * Find removed features
   */
  findRemovedFeatures(currentFeatures, targetFeatures) {
    return currentFeatures.filter(
      feature => !targetFeatures.includes(feature)
    );
  }

  /**
   * Compare limits
   */
  compareLimits(currentLimits, targetLimits) {
    const changes = [];
    
    // Compare all limit keys
    const allKeys = new Set([
      ...Object.keys(currentLimits || {}),
      ...Object.keys(targetLimits || {}),
    ]);

    for (const key of allKeys) {
      const current = currentLimits?.[key] || 0;
      const target = targetLimits?.[key] || 0;
      
      if (current !== target) {
        changes.push({
          feature: key,
          current,
          target,
          change: target - current,
          type: target > current ? 'INCREASE' : 'DECREASE',
        });
      }
    }

    return changes;
  }

  /**
   * Generate plan recommendation
   */
  generatePlanRecommendation(currentPlan, targetPlan) {
    if (targetPlan.price > currentPlan.price) {
      return {
        action: 'UPGRADE',
        reason: 'Get access to more features and higher limits',
        costBenefit: 'Higher cost but better value',
      };
    } else if (targetPlan.price < currentPlan.price) {
      return {
        action: 'DOWNGRADE',
        reason: 'Reduce costs while maintaining essential features',
        costBenefit: 'Lower cost with reduced features',
      };
    } else {
      return {
        action: 'SAME_TIER',
        reason: 'Similar pricing with different feature sets',
        costBenefit: 'No cost change, different feature focus',
      };
    }
  }

  /**
   * Export subscription data
   */
  async exportSubscriptionData(userId = null, employerId = null, format = 'JSON') {
    try {
      const where = {};

      if (userId) {
        where.userId = userId;
      } else if (employerId) {
        where.employerId = employerId;
      }

      const [
        subscriptions,
        renewals,
        upgrades,
        downgrades,
        cancellations,
        payments,
      ] = await Promise.all([
        this.findMany({
          where,
          include: {
            plan: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
            employer: {
              select: {
                companyName: true,
                companyEmail: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.subscriptionRenewal.findMany({
          where: {
            subscription: where,
          },
          include: {
            subscription: true,
          },
          orderBy: { renewedAt: 'desc' },
        }),
        this.prisma.subscriptionUpgrade.findMany({
          where: {
            subscription: where,
          },
          include: {
            subscription: true,
            fromPlan: true,
            toPlan: true,
          },
          orderBy: { effectiveDate: 'desc' },
        }),
        this.prisma.subscriptionDowngrade.findMany({
          where: {
            subscription: where,
          },
          include: {
            subscription: true,
            fromPlan: true,
            toPlan: true,
          },
          orderBy: { effectiveDate: 'desc' },
        }),
        this.prisma.subscriptionCancellation.findMany({
          where: {
            subscription: where,
          },
          include: {
            subscription: true,
          },
          orderBy: { cancelledAt: 'desc' },
        }),
        this.prisma.payment.findMany({
          where: {
            OR: [
              { userId, subscription: where },
              { employerId, subscription: where },
            ],
            paymentType: { in: ['SUBSCRIPTION', 'SUBSCRIPTION_UPGRADE', 'SUBSCRIPTION_RENEWAL'] },
          },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          format,
          userId,
          employerId,
          recordCounts: {
            subscriptions: subscriptions.length,
            renewals: renewals.length,
            upgrades: upgrades.length,
            downgrades: downgrades.length,
            cancellations: cancellations.length,
            payments: payments.length,
          },
        },
        subscriptions,
        renewals,
        upgrades,
        downgrades,
        cancellations,
        payments,
        summary: {
          totalSpent: payments.reduce((sum, p) => sum + p.amount, 0),
          activeSubscriptions: subscriptions.filter(s => s.status === 'ACTIVE').length,
          totalSubscriptions: subscriptions.length,
          averageSubscriptionValue: subscriptions.length > 0 ?
            payments.reduce((sum, p) => sum + p.amount, 0) / subscriptions.length : 0,
        },
      };

      if (format === 'CSV') {
        return this.convertSubscriptionsToCSV(exportData);
      }

      return exportData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Convert subscriptions to CSV
   */
  convertSubscriptionsToCSV(data) {
    const csvData = [];
    
    // Subscriptions CSV
    const subscriptionHeaders = ['Start Date', 'End Date', 'Plan', 'Status', 'Price', 'Is Trial'];
    const subscriptionRows = data.subscriptions.map(s => [
      s.startDate.toISOString(),
      s.endDate.toISOString(),
      s.plan.name,
      s.status,
      s.plan.price,
      s.isTrial ? 'Yes' : 'No',
    ]);
    
    csvData.push({
      sheet: 'Subscriptions',
      headers: subscriptionHeaders,
      rows: subscriptionRows,
    });

    // Payments CSV
    const paymentHeaders = ['Date', 'Amount', 'Type', 'Status', 'Description'];
    const paymentRows = data.payments.map(p => [
      p.createdAt.toISOString(),
      p.amount,
      p.paymentType,
      p.status,
      p.description,
    ]);
    
    csvData.push({
      sheet: 'Payments',
      headers: paymentHeaders,
      rows: paymentRows,
    });

    return {
      csvData,
      totalSheets: csvData.length,
      downloadUrl: `https://api.kin2.com/exports/subscriptions-${Date.now()}.zip`,
    };
  }
}

module.exports = SubscriptionRepository;
