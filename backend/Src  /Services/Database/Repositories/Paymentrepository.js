const BaseRepository = require('../BaseRepository');

class PaymentRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'payment');
  }

  /**
   * Create payment with validation
   */
  async create(data) {
    try {
      // Generate unique payment reference
      const paymentRef = this.generatePaymentReference();
      
      return await super.create({
        ...data,
        paymentReference: paymentRef,
        status: data.status || 'PENDING',
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Generate payment reference
   */
  generatePaymentReference() {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9).toUpperCase();
    return `PAY-${timestamp}-${random}`;
  }

  /**
   * Find payment by reference
   */
  async findByReference(reference, options = {}) {
    try {
      return await this.model.findUnique({
        where: { paymentReference: reference },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find payment by gateway ID
   */
  async findByGatewayId(gatewayId, options = {}) {
    try {
      return await this.model.findFirst({
        where: { gatewayTransactionId: gatewayId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find user payments
   */
  async findUserPayments(userId, options = {}) {
    try {
      return await this.findMany({
        where: { userId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find employer payments
   */
  async findEmployerPayments(employerId, options = {}) {
    try {
      return await this.findMany({
        where: { employerId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Process payment webhook
   */
  async processWebhook(webhookData) {
    try {
      const { 
        paymentReference, 
        gatewayTransactionId, 
        status, 
        gatewayData 
      } = webhookData;

      const payment = await this.findByReference(paymentReference);
      if (!payment) {
        throw new Error('Payment not found');
      }

      const updatedPayment = await this.model.update({
        where: { id: payment.id },
        data: {
          status,
          gatewayTransactionId,
          gatewayData: {
            ...payment.gatewayData,
            ...gatewayData,
            webhookReceived: new Date(),
          },
          processedAt: status === 'COMPLETED' ? new Date() : null,
        },
      });

      // Trigger post-payment actions
      await this.handlePostPaymentActions(updatedPayment);

      return updatedPayment;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Handle post-payment actions
   */
  async handlePostPaymentActions(payment) {
    try {
      if (payment.status === 'COMPLETED') {
        switch (payment.paymentType) {
          case 'SUBSCRIPTION':
            await this.activateSubscription(payment);
            break;
          case 'JOB_POSTING':
            await this.activateJobPosting(payment);
            break;
          case 'PREMIUM_FEATURE':
            await this.activatePremiumFeature(payment);
            break;
          case 'WITHDRAWAL':
            await this.processWithdrawal(payment);
            break;
        }
      }

      // Send payment confirmation
      await this.sendPaymentConfirmation(payment);
    } catch (error) {
      console.error('Post-payment action failed:', error);
    }
  }

  /**
   * Activate subscription
   */
  async activateSubscription(payment) {
    try {
      const subscription = await this.prisma.subscription.findFirst({
        where: { paymentId: payment.id },
      });

      if (subscription) {
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + (subscription.plan?.durationMonths || 1));

        await this.prisma.subscription.update({
          where: { id: subscription.id },
          data: {
            status: 'ACTIVE',
            startDate,
            endDate,
            nextBillingDate: endDate,
          },
        });

        // Update user/employer subscription status
        if (subscription.userId) {
          await this.prisma.user.update({
            where: { id: subscription.userId },
            data: { 
              hasActiveSubscription: true,
              subscriptionTier: subscription.plan?.tier || 'PREMIUM',
            },
          });
        } else if (subscription.employerId) {
          await this.prisma.employerProfile.update({
            where: { id: subscription.employerId },
            data: { 
              hasActiveSubscription: true,
              subscriptionTier: subscription.plan?.tier || 'PREMIUM',
            },
          });
        }
      }
    } catch (error) {
      console.error('Subscription activation failed:', error);
    }
  }

  /**
   * Activate job posting
   */
  async activateJobPosting(payment) {
    try {
      const job = await this.prisma.job.findFirst({
        where: { paymentId: payment.id },
      });

      if (job) {
        await this.prisma.job.update({
          where: { id: job.id },
          data: {
            status: 'PUBLISHED',
            postedAt: new Date(),
            expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
          },
        });
      }
    } catch (error) {
      console.error('Job posting activation failed:', error);
    }
  }

  /**
   * Activate premium feature
   */
  async activatePremiumFeature(payment) {
    try {
      const feature = await this.prisma.premiumFeature.findFirst({
        where: { paymentId: payment.id },
      });

      if (feature) {
        await this.prisma.premiumFeature.update({
          where: { id: feature.id },
          data: {
            status: 'ACTIVE',
            activatedAt: new Date(),
            expiresAt: new Date(Date.now() + feature.durationDays * 24 * 60 * 60 * 1000),
          },
        });
      }
    } catch (error) {
      console.error('Premium feature activation failed:', error);
    }
  }

  /**
   * Process withdrawal
   */
  async processWithdrawal(payment) {
    try {
      // In production, this would integrate with payout APIs
      // For now, mark as processed
      await this.prisma.withdrawal.updateMany({
        where: { paymentId: payment.id },
        data: {
          status: 'PROCESSED',
          processedAt: new Date(),
        },
      });
    } catch (error) {
      console.error('Withdrawal processing failed:', error);
    }
  }

  /**
   * Send payment confirmation
   */
  async sendPaymentConfirmation(payment) {
    try {
      let recipient;
      if (payment.userId) {
        recipient = await this.prisma.user.findUnique({
          where: { id: payment.userId },
          select: { email: true, firstName: true },
        });
      } else if (payment.employerId) {
        const employer = await this.prisma.employerProfile.findUnique({
          where: { id: payment.employerId },
          select: { companyEmail: true, companyName: true },
        });
        recipient = {
          email: employer.companyEmail,
          firstName: employer.companyName,
        };
      }

      if (recipient) {
        // In production, this would send an actual email
        await this.prisma.notification.create({
          data: {
            userId: payment.userId,
            employerId: payment.employerId,
            type: 'PAYMENT_CONFIRMATION',
            title: `Payment ${payment.status.toLowerCase()}`,
            message: `Your payment of $${payment.amount} has been ${payment.status.toLowerCase()}`,
            data: {
              paymentId: payment.id,
              amount: payment.amount,
              status: payment.status,
              reference: payment.paymentReference,
            },
          },
        });
      }
    } catch (error) {
      console.error('Payment confirmation failed:', error);
    }
  }

  /**
   * Get payment statistics
   */
  async getPaymentStatistics(filters = {}) {
    try {
      const {
        userId,
        employerId,
        paymentType,
        status,
        dateFrom,
        dateTo,
        ...otherFilters
      } = filters;

      const where = {};

      if (userId) {
        where.userId = userId;
      }

      if (employerId) {
        where.employerId = employerId;
      }

      if (paymentType) {
        where.paymentType = paymentType;
      }

      if (status) {
        where.status = status;
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

      Object.assign(where, otherFilters);

      const [
        total,
        totalAmount,
        byStatus,
        byType,
        byMonth,
        averagePayment,
        revenueTrend,
      ] = await Promise.all([
        this.count(where),
        this.model.aggregate({
          where,
          _sum: { amount: true },
        }),
        this.model.groupBy({
          by: ['status'],
          where,
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.model.groupBy({
          by: ['paymentType'],
          where,
          _count: { _all: true },
          _sum: { amount: true },
        }),
        this.getMonthlyPaymentStats(where),
        this.model.aggregate({
          where,
          _avg: { amount: true },
        }),
        this.getRevenueTrend(where),
      ]);

      return {
        total,
        totalAmount: totalAmount._sum.amount || 0,
        byStatus: byStatus.reduce((acc, item) => {
          acc[item.status] = {
            count: item._count._all,
            amount: item._sum.amount || 0,
            percentage: total > 0 ? (item._count._all / total) * 100 : 0,
          };
          return acc;
        }, {}),
        byType: byType.reduce((acc, item) => {
          acc[item.paymentType] = {
            count: item._count._all,
            amount: item._sum.amount || 0,
            percentage: total > 0 ? (item._count._all / total) * 100 : 0,
          };
          return acc;
        }, {}),
        byMonth,
        averagePayment: averagePayment._avg.amount || 0,
        revenueTrend,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get monthly payment statistics
   */
  async getMonthlyPaymentStats(where, months = 12) {
    try {
      const date = new Date();
      date.setMonth(date.getMonth() - months);

      const payments = await this.findMany({
        where: {
          ...where,
          createdAt: { gte: date },
        },
        select: {
          amount: true,
          status: true,
          paymentType: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const monthlyData = {};
      payments.forEach(payment => {
        const month = payment.createdAt.toISOString().slice(0, 7); // YYYY-MM
        if (!monthlyData[month]) {
          monthlyData[month] = {
            total: 0,
            count: 0,
            successful: 0,
            failed: 0,
            refunded: 0,
            byType: {},
          };
        }

        monthlyData[month].total += payment.amount;
        monthlyData[month].count++;

        if (payment.status === 'COMPLETED') {
          monthlyData[month].successful++;
        } else if (payment.status === 'FAILED') {
          monthlyData[month].failed++;
        } else if (payment.status === 'REFUNDED') {
          monthlyData[month].refunded++;
        }

        // Group by payment type
        if (!monthlyData[month].byType[payment.paymentType]) {
          monthlyData[month].byType[payment.paymentType] = {
            count: 0,
            amount: 0,
          };
        }
        monthlyData[month].byType[payment.paymentType].count++;
        monthlyData[month].byType[payment.paymentType].amount += payment.amount;
      });

      // Convert to array and sort
      return Object.entries(monthlyData)
        .map(([month, data]) => ({ month, ...data }))
        .sort((a, b) => a.month.localeCompare(b.month));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get revenue trend
   */
  async getRevenueTrend(where) {
    try {
      const monthlyStats = await this.getMonthlyPaymentStats(where, 12);
      
      if (monthlyStats.length < 2) {
        return { trend: 'STABLE', growthRate: 0, direction: 'NEUTRAL' };
      }

      // Calculate month-over-month growth
      const recentMonths = monthlyStats.slice(-3);
      let totalGrowth = 0;
      let growthCount = 0;

      for (let i = 1; i < recentMonths.length; i++) {
        const current = recentMonths[i].total;
        const previous = recentMonths[i - 1].total;
        
        if (previous > 0) {
          const growth = ((current - previous) / previous) * 100;
          totalGrowth += growth;
          growthCount++;
        }
      }

      const averageGrowth = growthCount > 0 ? totalGrowth / growthCount : 0;

      // Determine trend
      let trend, direction;
      if (averageGrowth > 10) {
        trend = 'STRONG_GROWTH';
        direction = 'UP';
      } else if (averageGrowth > 5) {
        trend = 'GROWING';
        direction = 'UP';
      } else if (averageGrowth > -5) {
        trend = 'STABLE';
        direction = 'NEUTRAL';
      } else if (averageGrowth > -10) {
        trend = 'DECLINING';
        direction = 'DOWN';
      } else {
        trend = 'STRONG_DECLINE';
        direction = 'DOWN';
      }

      return {
        trend,
        growthRate: parseFloat(averageGrowth.toFixed(2)),
        direction,
        recentMonths,
      };
    } catch (error) {
      return { trend: 'STABLE', growthRate: 0, direction: 'NEUTRAL' };
    }
  }

  /**
   * Create payment intent
   */
  async createPaymentIntent(data) {
    try {
      const {
        userId,
        employerId,
        amount,
        currency = 'USD',
        paymentMethod,
        description,
        metadata = {},
        returnUrl,
        cancelUrl,
      } = data;

      // Validate amount
      if (amount <= 0) {
        throw new Error('Amount must be greater than 0');
      }

      // Create payment record
      const payment = await this.create({
        userId,
        employerId,
        amount,
        currency,
        paymentType: metadata.paymentType || 'OTHER',
        description,
        status: 'PENDING',
        gateway: paymentMethod,
        metadata,
      });

      // In production, this would create an actual payment intent with Stripe/PayPal/etc.
      // For now, simulate a payment intent
      const paymentIntent = {
        id: `pi_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        clientSecret: `cs_${Math.random().toString(36).substr(2, 32)}`,
        amount: amount * 100, // In cents
        currency,
        status: 'requires_payment_method',
        metadata: {
          paymentId: payment.id,
          ...metadata,
        },
        payment_method_types: ['card'],
        return_url: returnUrl,
        cancel_url: cancelUrl,
      };

      // Store payment intent data
      await this.model.update({
        where: { id: payment.id },
        data: {
          gatewayData: {
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.clientSecret,
          },
        },
      });

      return {
        paymentId: payment.id,
        paymentReference: payment.paymentReference,
        paymentIntent,
        nextAction: 'redirect_to_payment',
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Process payment
   */
  async processPayment(paymentId, gatewayData) {
    try {
      const payment = await this.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Update payment with gateway response
      const updated = await this.model.update({
        where: { id: payment.id },
        data: {
          status: gatewayData.status === 'succeeded' ? 'COMPLETED' : 'FAILED',
          gatewayTransactionId: gatewayData.id,
          gatewayData: {
            ...payment.gatewayData,
            ...gatewayData,
          },
          processedAt: gatewayData.status === 'succeeded' ? new Date() : null,
        },
      });

      // Trigger post-payment actions
      if (updated.status === 'COMPLETED') {
        await this.handlePostPaymentActions(updated);
      }

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Refund payment
   */
  async refundPayment(paymentId, amount = null, reason = null) {
    try {
      const payment = await this.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status !== 'COMPLETED') {
        throw new Error('Only completed payments can be refunded');
      }

      if (payment.status === 'REFUNDED' || payment.status === 'PARTIALLY_REFUNDED') {
        throw new Error('Payment already refunded');
      }

      const refundAmount = amount || payment.amount;
      if (refundAmount > payment.amount) {
        throw new Error('Refund amount cannot exceed payment amount');
      }

      // Create refund record
      const refund = await this.prisma.refund.create({
        data: {
          paymentId: payment.id,
          amount: refundAmount,
          reason,
          status: 'PENDING',
          refundReference: `REF-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        },
      });

      // In production, this would process the refund through the payment gateway
      // For now, simulate refund processing
      setTimeout(async () => {
        await this.prisma.refund.update({
          where: { id: refund.id },
          data: {
            status: 'COMPLETED',
            processedAt: new Date(),
          },
        });

        // Update payment status
        const newStatus = refundAmount === payment.amount ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
        await this.model.update({
          where: { id: payment.id },
          data: {
            status: newStatus,
            refundedAmount: refundAmount,
            refundedAt: new Date(),
          },
        });

        // Send refund notification
        await this.sendRefundNotification(payment, refund);
      }, 2000);

      return refund;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Send refund notification
   */
  async sendRefundNotification(payment, refund) {
    try {
      let recipient;
      if (payment.userId) {
        recipient = await this.prisma.user.findUnique({
          where: { id: payment.userId },
          select: { email: true, firstName: true },
        });
      } else if (payment.employerId) {
        const employer = await this.prisma.employerProfile.findUnique({
          where: { id: payment.employerId },
          select: { companyEmail: true, companyName: true },
        });
        recipient = {
          email: employer.companyEmail,
          firstName: employer.companyName,
        };
      }

      if (recipient) {
        await this.prisma.notification.create({
          data: {
            userId: payment.userId,
            employerId: payment.employerId,
            type: 'REFUND_PROCESSED',
            title: 'Refund Processed',
            message: `Your refund of $${refund.amount} has been processed`,
            data: {
              paymentId: payment.id,
              refundId: refund.id,
              amount: refund.amount,
              reason: refund.reason,
            },
          },
        });
      }
    } catch (error) {
      console.error('Refund notification failed:', error);
    }
  }

  /**
   * Get revenue analytics
   */
  async getRevenueAnalytics(timeframe = '30d') {
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
        status: 'COMPLETED',
        createdAt: { gte: date },
      };

      const [
        totalRevenue,
        revenueByType,
        revenueByGateway,
        dailyRevenue,
        topEmployers,
        topUsers,
        refundStats,
      ] = await Promise.all([
        this.model.aggregate({
          where,
          _sum: { amount: true },
        }),
        this.model.groupBy({
          by: ['paymentType'],
          where,
          _sum: { amount: true },
        }),
        this.model.groupBy({
          by: ['gateway'],
          where,
          _sum: { amount: true },
        }),
        this.getDailyRevenue(where),
        this.getTopEmployersByRevenue(where, 10),
        this.getTopUsersByRevenue(where, 10),
        this.getRefundStatistics(where),
      ]);

      return {
        totalRevenue: totalRevenue._sum.amount || 0,
        revenueByType: revenueByType.reduce((acc, item) => {
          acc[item.paymentType] = item._sum.amount || 0;
          return acc;
        }, {}),
        revenueByGateway: revenueByGateway.reduce((acc, item) => {
          acc[item.gateway] = item._sum.amount || 0;
          return acc;
        }, {}),
        dailyRevenue,
        topEmployers,
        topUsers,
        refundStats,
        timeframe,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get daily revenue
   */
  async getDailyRevenue(where) {
    try {
      const payments = await this.findMany({
        where,
        select: {
          amount: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      });

      const dailyData = {};
      payments.forEach(payment => {
        const day = payment.createdAt.toISOString().slice(0, 10); // YYYY-MM-DD
        if (!dailyData[day]) {
          dailyData[day] = 0;
        }
        dailyData[day] += payment.amount;
      });

      return Object.entries(dailyData)
        .map(([day, amount]) => ({ day, amount }))
        .sort((a, b) => a.day.localeCompare(b.day));
    } catch (error) {
      return [];
    }
  }

  /**
   * Get top employers by revenue
   */
  async getTopEmployersByRevenue(where, limit = 10) {
    try {
      const results = await this.model.groupBy({
        by: ['employerId'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
        take: limit,
      });

      // Fetch employer details
      return await Promise.all(
        results.map(async (item) => {
          const employer = await this.prisma.employerProfile.findUnique({
            where: { id: item.employerId },
            select: {
              companyName: true,
              companyEmail: true,
            },
          });

          return {
            employerId: item.employerId,
            companyName: employer?.companyName || 'Unknown',
            totalAmount: item._sum.amount || 0,
            paymentCount: item._count._all,
            averagePayment: item._count._all > 0 ? 
              (item._sum.amount || 0) / item._count._all : 0,
          };
        })
      );
    } catch (error) {
      return [];
    }
  }

  /**
   * Get top users by revenue
   */
  async getTopUsersByRevenue(where, limit = 10) {
    try {
      const results = await this.model.groupBy({
        by: ['userId'],
        where,
        _sum: { amount: true },
        _count: { _all: true },
        orderBy: {
          _sum: {
            amount: 'desc',
          },
        },
        take: limit,
      });

      // Fetch user details
      return await Promise.all(
        results.map(async (item) => {
          const user = await this.prisma.user.findUnique({
            where: { id: item.userId },
            select: {
              firstName: true,
              lastName: true,
              email: true,
            },
          });

          return {
            userId: item.userId,
            name: user ? `${user.firstName} ${user.lastName}` : 'Unknown',
            email: user?.email,
            totalAmount: item._sum.amount || 0,
            paymentCount: item._count._all,
            averagePayment: item._count._all > 0 ? 
              (item._sum.amount || 0) / item._count._all : 0,
          };
        })
      );
    } catch (error) {
      return [];
    }
  }

  /**
   * Get refund statistics
   */
  async getRefundStatistics(where) {
    try {
      const refunds = await this.prisma.refund.findMany({
        where: {
          status: 'COMPLETED',
          payment: where,
        },
        select: {
          amount: true,
          reason: true,
          createdAt: true,
        },
      });

      const totalRefunds = refunds.reduce((sum, refund) => sum + refund.amount, 0);
      const refundCount = refunds.length;

      // Group by reason
      const byReason = {};
      refunds.forEach(refund => {
        const reason = refund.reason || 'Other';
        if (!byReason[reason]) {
          byReason[reason] = {
            count: 0,
            amount: 0,
          };
        }
        byReason[reason].count++;
        byReason[reason].amount += refund.amount;
      });

      return {
        totalRefunds,
        refundCount,
        averageRefund: refundCount > 0 ? totalRefunds / refundCount : 0,
        byReason,
      };
    } catch (error) {
      return {
        totalRefunds: 0,
        refundCount: 0,
        averageRefund: 0,
        byReason: {},
      };
    }
  }

  /**
   * Generate invoice
   */
  async generateInvoice(paymentId) {
    try {
      const payment = await this.model.findUnique({
        where: { id: paymentId },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
              address: true,
            },
          },
          employer: {
            select: {
              id: true,
              companyName: true,
              companyEmail: true,
              companyPhone: true,
              companyAddress: true,
            },
          },
        },
      });

      if (!payment) {
        throw new Error('Payment not found');
      }

      const invoiceNumber = `INV-${payment.paymentReference}`;
      const issueDate = payment.createdAt;
      const dueDate = new Date(issueDate);
      dueDate.setDate(dueDate.getDate() + 30); // 30 days payment terms

      const invoiceData = {
        invoiceNumber,
        issueDate,
        dueDate,
        from: {
          name: 'Kin2 Workforce Platform',
          address: '123 Business Street, City, State 12345',
          email: 'billing@kin2.com',
          phone: '+1 (555) 123-4567',
          taxId: 'TAX-123456789',
        },
        to: payment.employerId ? {
          type: 'COMPANY',
          name: payment.employer.companyName,
          email: payment.employer.companyEmail,
          phone: payment.employer.companyPhone,
          address: payment.employer.companyAddress,
        } : {
          type: 'INDIVIDUAL',
          name: `${payment.user.firstName} ${payment.user.lastName}`,
          email: payment.user.email,
          phone: payment.user.phone,
          address: payment.user.address,
        },
        items: [
          {
            description: payment.description || 'Platform Service',
            quantity: 1,
            unitPrice: payment.amount,
            taxRate: 0, // Could be dynamic based on location
            amount: payment.amount,
          },
        ],
        subtotal: payment.amount,
        tax: 0,
        total: payment.amount,
        paymentStatus: payment.status,
        paymentMethod: payment.gateway,
        notes: [
          'Thank you for your business!',
          'Please pay within 30 days.',
          'For any questions, contact billing@kin2.com',
        ],
        terms: [
          'Payment due within 30 days of invoice date',
          'Late payments subject to 1.5% monthly interest',
          'All payments are non-refundable unless stated otherwise',
        ],
      };

      // Generate PDF (in production, this would use a PDF library)
      const pdfData = {
        ...invoiceData,
        generatedAt: new Date(),
        qrCode: `https://kin2.com/invoice/${invoiceNumber}`, // QR code for easy payment
      };

      return {
        invoiceData,
        pdfData,
        downloadUrl: `https://api.kin2.com/invoices/${invoiceNumber}/download`,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get payment disputes
   */
  async getDisputes(filters = {}) {
    try {
      const {
        status = 'OPEN',
        paymentId,
        userId,
        employerId,
        dateFrom,
        dateTo,
        ...otherFilters
      } = filters;

      const where = {
        status,
        ...otherFilters,
      };

      if (paymentId) {
        where.paymentId = paymentId;
      }

      if (userId) {
        where.userId = userId;
      }

      if (employerId) {
        where.employerId = employerId;
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

      return await this.prisma.dispute.findMany({
        where,
        include: {
          payment: true,
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
        orderBy: { createdAt: 'desc' },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create dispute
   */
  async createDispute(data) {
    try {
      const { paymentId, userId, employerId, reason, evidence } = data;

      const payment = await this.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      // Check authorization
      if (userId && payment.userId !== userId) {
        throw new Error('Unauthorized to create dispute for this payment');
      }
      if (employerId && payment.employerId !== employerId) {
        throw new Error('Unauthorized to create dispute for this payment');
      }

      // Check if dispute already exists
      const existingDispute = await this.prisma.dispute.findFirst({
        where: { paymentId },
      });

      if (existingDispute) {
        throw new Error('Dispute already exists for this payment');
      }

      // Create dispute
      const dispute = await this.prisma.dispute.create({
        data: {
          paymentId,
          userId,
          employerId,
          reason,
          evidence,
          status: 'OPEN',
          disputeReference: `DSP-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        },
      });

      // Update payment status
      await this.model.update({
        where: { id: paymentId },
        data: { status: 'DISPUTED' },
      });

      // Notify admin
      await this.prisma.notification.create({
        data: {
          type: 'DISPUTE_CREATED',
          title: 'New Payment Dispute',
          message: `A new dispute has been created for payment ${payment.paymentReference}`,
          data: {
            disputeId: dispute.id,
            paymentId,
            reason,
          },
          priority: 'HIGH',
        },
      });

      return dispute;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Resolve dispute
   */
  async resolveDispute(disputeId, resolution, resolvedBy) {
    try {
      const dispute = await this.prisma.dispute.findUnique({
        where: { id: disputeId },
        include: { payment: true },
      });

      if (!dispute) {
        throw new Error('Dispute not found');
      }

      const updatedDispute = await this.prisma.dispute.update({
        where: { id: disputeId },
        data: {
          status: 'RESOLVED',
          resolution,
          resolvedBy,
          resolvedAt: new Date(),
        },
      });

      // Update payment based on resolution
      if (resolution.action === 'REFUND') {
        await this.refundPayment(
          dispute.paymentId,
          resolution.amount,
          `Dispute resolution: ${resolution.reason}`
        );
      } else if (resolution.action === 'RELEASE') {
        await this.model.update({
          where: { id: dispute.paymentId },
          data: { status: 'COMPLETED' },
        });
      }

      // Notify parties
      await this.sendDisputeResolutionNotification(dispute, resolution);

      return updatedDispute;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Send dispute resolution notification
   */
  async sendDisputeResolutionNotification(dispute, resolution) {
    try {
      const recipients = [];

      if (dispute.userId) {
        recipients.push({
          type: 'USER',
          id: dispute.userId,
        });
      }

      if (dispute.employerId) {
        recipients.push({
          type: 'EMPLOYER',
          id: dispute.employerId,
        });
      }

      for (const recipient of recipients) {
        await this.prisma.notification.create({
          data: {
            userId: recipient.type === 'USER' ? recipient.id : null,
            employerId: recipient.type === 'EMPLOYER' ? recipient.id : null,
            type: 'DISPUTE_RESOLVED',
            title: 'Dispute Resolved',
            message: `Your dispute has been resolved: ${resolution.reason}`,
            data: {
              disputeId: dispute.id,
              resolution,
              paymentId: dispute.paymentId,
            },
          },
        });
      }
    } catch (error) {
      console.error('Dispute resolution notification failed:', error);
    }
  }

  /**
   * Get payment projections
   */
  async getPaymentProjections(employerId = null, months = 6) {
    try {
      const date = new Date();
      const projections = [];

      // Get historical data
      const where = {
        status: 'COMPLETED',
        createdAt: {
          gte: new Date(date.getFullYear(), date.getMonth() - months, 1),
        },
      };

      if (employerId) {
        where.employerId = employerId;
      }

      const historicalData = await this.getMonthlyPaymentStats(where, months);

      // Use time series forecasting (simplified)
      for (let i = 1; i <= 3; i++) { // Project next 3 months
        const futureMonth = new Date(date.getFullYear(), date.getMonth() + i, 1);
        const monthKey = futureMonth.toISOString().slice(0, 7);

        // Simple moving average with seasonality adjustment
        let projectedRevenue = 0;
        let confidence = 0;

        if (historicalData.length >= 3) {
          // Use average of last 3 months
          const lastThree = historicalData.slice(-3);
          const avgRevenue = lastThree.reduce((sum, month) => sum + month.total, 0) / 3;

          // Adjust for monthly growth trend (simplified)
          const monthlyGrowth = this.calculateMonthlyGrowth(historicalData);
          projectedRevenue = avgRevenue * Math.pow(1 + monthlyGrowth, i);

          // Confidence decreases for further projections
          confidence = Math.max(20, 100 - (i * 25));
        } else {
          // Not enough data, use platform average
          const platformAvg = await this.getPlatformAverageRevenue();
          projectedRevenue = platformAvg;
          confidence = 50;
        }

        projections.push({
          month: monthKey,
          projectedRevenue: Math.round(projectedRevenue),
          confidence,
          upperBound: Math.round(projectedRevenue * 1.2),
          lowerBound: Math.round(projectedRevenue * 0.8),
        });
      }

      return {
        historical: historicalData,
        projections,
        employerId,
        generatedAt: new Date(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate monthly growth rate
   */
  calculateMonthlyGrowth(historicalData) {
    if (historicalData.length < 2) return 0.05; // Default 5% growth

    const recent = historicalData.slice(-6); // Last 6 months
    let totalGrowth = 0;
    let count = 0;

    for (let i = 1; i < recent.length; i++) {
      const current = recent[i].total;
      const previous = recent[i - 1].total;
      
      if (previous > 0) {
        const growth = (current - previous) / previous;
        totalGrowth += growth;
        count++;
      }
    }

    return count > 0 ? totalGrowth / count : 0.05;
  }

  /**
   * Get platform average revenue
   */
  async getPlatformAverageRevenue() {
    try {
      const result = await this.model.aggregate({
        where: {
          status: 'COMPLETED',
          createdAt: {
            gte: new Date(new Date().getFullYear(), 0, 1), // This year
          },
        },
        _avg: { amount: true },
      });

      return result._avg.amount || 1000; // Default $1000 if no data
    } catch (error) {
      return 1000;
    }
  }

  /**
   * Export payment data
   */
  async exportPaymentData(userId = null, employerId = null, format = 'JSON') {
    try {
      const where = {};

      if (userId) {
        where.userId = userId;
      } else if (employerId) {
        where.employerId = employerId;
      }

      const [
        payments,
        refunds,
        disputes,
        subscriptions,
      ] = await Promise.all([
        this.findMany({
          where,
          include: {
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
        this.prisma.refund.findMany({
          where: {
            payment: where,
          },
          include: {
            payment: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.dispute.findMany({
          where: {
            OR: [
              { userId },
              { employerId },
            ],
          },
          include: {
            payment: true,
          },
          orderBy: { createdAt: 'desc' },
        }),
        this.prisma.subscription.findMany({
          where: {
            OR: [
              { userId },
              { employerId },
            ],
          },
          include: {
            plan: true,
            payments: true,
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
            payments: payments.length,
            refunds: refunds.length,
            disputes: disputes.length,
            subscriptions: subscriptions.length,
          },
        },
        payments,
        refunds,
        disputes,
        subscriptions,
        summary: {
          totalPayments: payments.reduce((sum, p) => sum + p.amount, 0),
          totalRefunds: refunds.reduce((sum, r) => sum + r.amount, 0),
          netAmount: payments.reduce((sum, p) => sum + p.amount, 0) - 
                     refunds.reduce((sum, r) => sum + r.amount, 0),
        },
      };

      if (format === 'CSV') {
        // Convert to CSV format
        return this.convertToCSV(exportData);
      }

      return exportData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Convert export data to CSV
   */
  convertToCSV(data) {
    // Simplified CSV conversion
    const csvData = [];
    
    // Payments CSV
    const paymentHeaders = ['Date', 'Reference', 'Amount', 'Status', 'Type', 'Description'];
    const paymentRows = data.payments.map(p => [
      p.createdAt.toISOString(),
      p.paymentReference,
      p.amount,
      p.status,
      p.paymentType,
      p.description,
    ]);
    
    csvData.push({
      sheet: 'Payments',
      headers: paymentHeaders,
      rows: paymentRows,
    });

    // Refunds CSV
    const refundHeaders = ['Date', 'Reference', 'Amount', 'Reason', 'Status'];
    const refundRows = data.refunds.map(r => [
      r.createdAt.toISOString(),
      r.refundReference,
      r.amount,
      r.reason,
      r.status,
    ]);
    
    csvData.push({
      sheet: 'Refunds',
      headers: refundHeaders,
      rows: refundRows,
    });

    return {
      csvData,
      totalSheets: csvData.length,
      downloadUrl: `https://api.kin2.com/exports/payments-${Date.now()}.zip`,
    };
  }

  /**
   * Get payment dashboard
   */
  async getPaymentDashboard(userId = null, employerId = null) {
    try {
      const where = {};
      
      if (userId) {
        where.userId = userId;
      } else if (employerId) {
        where.employerId = employerId;
      }

      const [
        recentPayments,
        paymentStats,
        upcomingSubscriptions,
        pendingDisputes,
        revenueTrend,
      ] = await Promise.all([
        this.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        this.getPaymentStatistics(where),
        this.getUpcomingSubscriptions(userId, employerId),
        this.getDisputes({ 
          status: 'OPEN',
          ...(userId && { userId }),
          ...(employerId && { employerId }),
        }),
        this.getRevenueTrend(where),
      ]);

      return {
        recentPayments,
        stats: {
          totalPayments: paymentStats.total,
          totalAmount: paymentStats.totalAmount,
          successfulPayments: paymentStats.byStatus.COMPLETED?.count || 0,
          pendingPayments: paymentStats.byStatus.PENDING?.count || 0,
          refundedAmount: paymentStats.byStatus.REFUNDED?.amount || 0,
        },
        upcomingSubscriptions,
        pendingDisputes: pendingDisputes.length,
        revenueTrend,
        quickActions: [
          { label: 'Make Payment', action: 'CREATE_PAYMENT' },
          { label: 'View Invoices', action: 'VIEW_INVOICES' },
          { label: 'Request Refund', action: 'REQUEST_REFUND' },
        ],
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get upcoming subscriptions
   */
  async getUpcomingSubscriptions(userId = null, employerId = null) {
    try {
      const where = {
        status: 'ACTIVE',
        endDate: {
          gte: new Date(),
          lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // Next 30 days
        },
      };

      if (userId) {
        where.userId = userId;
      } else if (employerId) {
        where.employerId = employerId;
      }

      return await this.prisma.subscription.findMany({
        where,
        include: {
          plan: true,
        },
        orderBy: { endDate: 'asc' },
        take: 5,
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Process scheduled payments
   */
  async processScheduledPayments() {
    try {
      const now = new Date();
      const cutoffDate = new Date(now.getTime() - 2 * 60 * 60 * 1000); // 2 hours ago

      // Find pending scheduled payments that are due
      const scheduledPayments = await this.prisma.scheduledPayment.findMany({
        where: {
          status: 'SCHEDULED',
          scheduledAt: {
            lte: cutoffDate,
          },
        },
        include: {
          payment: true,
        },
        take: 50, // Process in batches
      });

      const results = [];

      for (const scheduledPayment of scheduledPayments) {
        try {
          // Process the payment
          const processedPayment = await this.processPayment(
            scheduledPayment.paymentId,
            {
              status: 'succeeded',
              id: `ch_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            }
          );

          // Update scheduled payment status
          await this.prisma.scheduledPayment.update({
            where: { id: scheduledPayment.id },
            data: {
              status: 'PROCESSED',
              processedAt: new Date(),
            },
          });

          results.push({
            scheduledPaymentId: scheduledPayment.id,
            paymentId: scheduledPayment.paymentId,
            status: 'SUCCESS',
          });
        } catch (error) {
          // Update as failed
          await this.prisma.scheduledPayment.update({
            where: { id: scheduledPayment.id },
            data: {
              status: 'FAILED',
              error: error.message,
              processedAt: new Date(),
            },
          });

          results.push({
            scheduledPaymentId: scheduledPayment.id,
            paymentId: scheduledPayment.paymentId,
            status: 'FAILED',
            error: error.message,
          });
        }
      }

      return {
        processed: results.length,
        results,
        timestamp: now.toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Schedule payment
   */
  async schedulePayment(paymentId, scheduleDate) {
    try {
      const payment = await this.findById(paymentId);
      if (!payment) {
        throw new Error('Payment not found');
      }

      if (payment.status !== 'PENDING') {
        throw new Error('Only pending payments can be scheduled');
      }

      const scheduledPayment = await this.prisma.scheduledPayment.create({
        data: {
          paymentId,
          scheduledAt: scheduleDate,
          status: 'SCHEDULED',
          retryCount: 0,
        },
      });

      // Update payment status
      await this.model.update({
        where: { id: paymentId },
        data: { status: 'SCHEDULED' },
      });

      return scheduledPayment;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Cancel scheduled payment
   */
  async cancelScheduledPayment(scheduledPaymentId) {
    try {
      const scheduledPayment = await this.prisma.scheduledPayment.findUnique({
        where: { id: scheduledPaymentId },
        include: { payment: true },
      });

      if (!scheduledPayment) {
        throw new Error('Scheduled payment not found');
      }

      // Update scheduled payment
      await this.prisma.scheduledPayment.update({
        where: { id: scheduledPaymentId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      });

      // Update payment status
      await this.model.update({
        where: { id: scheduledPayment.paymentId },
        data: { status: 'CANCELLED' },
      });

      return {
        success: true,
        scheduledPaymentId,
        paymentId: scheduledPayment.paymentId,
      };
    } catch (error) {
      this.handleError(error);
    }
  }
}

module.exports = PaymentRepository;
