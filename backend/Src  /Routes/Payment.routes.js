const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const paymentService = require('../services/payment/payment.service');

const prisma = new PrismaClient();

// Create payment intent
router.post('/create-intent', authMiddleware.verifyToken, [
  body('amount').isFloat({ min: 0.5 }),
  body('currency').optional().isIn(['USD', 'EUR', 'GBP', 'JPY']),
  body('paymentMethod').optional().isIn(['CREDIT_CARD', 'DEBIT_CARD', 'BANK_TRANSFER', 'PAYPAL']),
  body('description').optional().trim(),
  body('metadata').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { 
      amount, 
      currency = 'USD', 
      paymentMethod = 'CREDIT_CARD',
      description,
      metadata = {}
    } = req.body;

    // Add user ID to metadata
    metadata.userId = req.userId;
    metadata.userRole = req.userRole;

    const paymentIntent = await paymentService.createPaymentIntent({
      amount,
      currency,
      paymentMethod,
      description: description || `Payment from ${req.userId}`,
      metadata
    });

    // Create payment record
    const payment = await prisma.payment.create({
      data: {
        transactionId: paymentIntent.id,
        amount,
        currency,
        status: 'PENDING',
        method: paymentMethod,
        payerId: req.userId,
        type: metadata.type || 'OTHER',
        referenceId: metadata.referenceId,
        description: description || `Payment for ${metadata.type || 'services'}`,
        gateway: 'stripe',
        gatewayData: paymentIntent
      }
    });

    res.json({
      clientSecret: paymentIntent.client_secret,
      paymentId: payment.id,
      amount,
      currency
    });
  } catch (error) {
    console.error('Create payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent', details: error.message });
  }
});

// Create subscription
router.post('/subscribe', authMiddleware.verifyToken, [
  body('plan').isIn(['BASIC', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  body('billingCycle').isIn(['MONTHLY', 'QUARTERLY', 'YEARLY']),
  body('paymentMethodId').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { plan, billingCycle, paymentMethodId } = req.body;

    // Get plan price
    const planPrice = await paymentService.getPlanPrice(plan, billingCycle);

    // Create subscription
    const subscription = await paymentService.createSubscription({
      userId: req.userId,
      plan,
      billingCycle,
      price: planPrice.amount,
      currency: planPrice.currency,
      paymentMethodId
    });

    // Create subscription record
    const subscriptionRecord = await prisma.subscription.create({
      data: {
        userId: req.userId,
        plan,
        price: planPrice.amount,
        currency: planPrice.currency,
        billingCycle,
        status: 'ACTIVE',
        autoRenew: true,
        startDate: new Date(),
        endDate: new Date(Date.now() + (billingCycle === 'MONTHLY' ? 30 : billingCycle === 'QUARTERLY' ? 90 : 365) * 24 * 60 * 60 * 1000),
        nextBillingDate: new Date(Date.now() + (billingCycle === 'MONTHLY' ? 30 : billingCycle === 'QUARTERLY' ? 90 : 365) * 24 * 60 * 60 * 1000),
        lastPaymentId: subscription.paymentId
      }
    });

    // Update user's subscription status in employer profile
    if (req.userRole === 'EMPLOYER') {
      await prisma.employerProfile.update({
        where: { userId: req.userId },
        data: {
          subscriptionPlan: plan,
          subscriptionEnds: subscriptionRecord.endDate
        }
      });
    }

    res.json({
      message: 'Subscription created successfully',
      subscription: subscriptionRecord,
      payment: subscription.payment
    });
  } catch (error) {
    console.error('Create subscription error:', error);
    res.status(500).json({ error: 'Failed to create subscription', details: error.message });
  }
});

// Get payment methods
router.get('/methods', authMiddleware.verifyToken, async (req, res) => {
  try {
    const paymentMethods = await paymentService.getPaymentMethods(req.userId);

    res.json(paymentMethods);
  } catch (error) {
    console.error('Get payment methods error:', error);
    res.status(500).json({ error: 'Failed to get payment methods', details: error.message });
  }
});

// Add payment method
router.post('/methods', authMiddleware.verifyToken, [
  body('paymentMethodId').notEmpty().trim(),
  body('type').isIn(['CARD', 'BANK_ACCOUNT']),
  body('isDefault').optional().isBoolean()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentMethodId, type, isDefault = false } = req.body;

    const paymentMethod = await paymentService.addPaymentMethod({
      userId: req.userId,
      paymentMethodId,
      type,
      isDefault
    });

    res.json({
      message: 'Payment method added successfully',
      paymentMethod
    });
  } catch (error) {
    console.error('Add payment method error:', error);
    res.status(500).json({ error: 'Failed to add payment method', details: error.message });
  }
});

// Remove payment method
router.delete('/methods/:id', authMiddleware.verifyToken, async (req, res) => {
  try {
    await paymentService.removePaymentMethod(req.userId, req.params.id);

    res.json({ message: 'Payment method removed successfully' });
  } catch (error) {
    console.error('Remove payment method error:', error);
    res.status(500).json({ error: 'Failed to remove payment method', details: error.message });
  }
});

// Get invoices
router.get('/invoices', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId: req.userId };
    if (status) {
      where.status = status;
    }

    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          subscription: true,
          payment: true
        },
        orderBy: { issueDate: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.invoice.count({ where })
    ]);

    res.json({
      invoices,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get invoices error:', error);
    res.status(500).json({ error: 'Failed to get invoices', details: error.message });
  }
});

// Get invoice by ID
router.get('/invoices/:id', authMiddleware.verifyToken, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { 
        id: req.params.id,
        userId: req.userId 
      },
      include: {
        subscription: true,
        payment: true,
        user: {
          include: {
            profile: true,
            ...(req.userRole === 'EMPLOYER' && { employerProfile: true })
          }
        }
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    res.json(invoice);
  } catch (error) {
    console.error('Get invoice error:', error);
    res.status(500).json({ error: 'Failed to get invoice', details: error.message });
  }
});

// Download invoice PDF
router.get('/invoices/:id/download', authMiddleware.verifyToken, async (req, res) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { 
        id: req.params.id,
        userId: req.userId 
      }
    });

    if (!invoice) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (!invoice.pdfUrl) {
      // Generate PDF if not exists
      const pdfUrl = await paymentService.generateInvoicePdf(invoice);
      await prisma.invoice.update({
        where: { id: req.params.id },
        data: { pdfUrl }
      });
      
      res.json({ pdfUrl });
    } else {
      res.json({ pdfUrl: invoice.pdfUrl });
    }
  } catch (error) {
    console.error('Download invoice error:', error);
    res.status(500).json({ error: 'Failed to download invoice', details: error.message });
  }
});

// Process refund
router.post('/refund', authMiddleware.verifyToken, [
  body('paymentId').notEmpty(),
  body('amount').optional().isFloat({ min: 0.5 }),
  body('reason').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { paymentId, amount, reason } = req.body;

    // Check if payment exists and belongs to user
    const payment = await prisma.payment.findFirst({
      where: {
        id: paymentId,
        OR: [
          { payerId: req.userId },
          { recipientId: req.userId }
        ]
      }
    });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found or access denied' });
    }

    // Only completed payments can be refunded
    if (payment.status !== 'COMPLETED') {
      return res.status(400).json({ error: 'Only completed payments can be refunded' });
    }

    const refund = await paymentService.processRefund({
      paymentId: payment.transactionId,
      amount: amount || payment.amount,
      reason: reason || 'Customer request'
    });

    // Update payment status
    await prisma.payment.update({
      where: { id: paymentId },
      data: {
        status: 'REFUNDED',
        refundedAt: new Date(),
        gatewayResponse: { refund }
      }
    });

    res.json({
      message: 'Refund processed successfully',
      refund
    });
  } catch (error) {
    console.error('Process refund error:', error);
    res.status(500).json({ error: 'Failed to process refund', details: error.message });
  }
});

// Get subscription details
router.get('/subscription', authMiddleware.verifyToken, async (req, res) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId: req.userId },
      include: {
        lastPayment: true
      }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    res.json(subscription);
  } catch (error) {
    console.error('Get subscription error:', error);
    res.status(500).json({ error: 'Failed to get subscription', details: error.message });
  }
});

// Cancel subscription
router.post('/subscription/cancel', authMiddleware.verifyToken, async (req, res) => {
  try {
    const subscription = await prisma.subscription.findUnique({
      where: { userId: req.userId }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    // Cancel with payment gateway
    await paymentService.cancelSubscription(subscription.id);

    // Update subscription status
    const updatedSubscription = await prisma.subscription.update({
      where: { userId: req.userId },
      data: {
        status: 'CANCELLED',
        autoRenew: false,
        cancelledAt: new Date()
      }
    });

    // Update employer profile
    if (req.userRole === 'EMPLOYER') {
      await prisma.employerProfile.update({
        where: { userId: req.userId },
        data: {
          subscriptionPlan: 'FREE',
          subscriptionEnds: updatedSubscription.endDate
        }
      });
    }

    res.json({
      message: 'Subscription cancelled successfully',
      subscription: updatedSubscription
    });
  } catch (error) {
    console.error('Cancel subscription error:', error);
    res.status(500).json({ error: 'Failed to cancel subscription', details: error.message });
  }
});

// Update subscription
router.put('/subscription', authMiddleware.verifyToken, [
  body('plan').isIn(['BASIC', 'PRO', 'BUSINESS', 'ENTERPRISE']),
  body('billingCycle').isIn(['MONTHLY', 'QUARTERLY', 'YEARLY'])
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { plan, billingCycle } = req.body;

    const subscription = await prisma.subscription.findUnique({
      where: { userId: req.userId }
    });

    if (!subscription) {
      return res.status(404).json({ error: 'No subscription found' });
    }

    // Get new plan price
    const planPrice = await paymentService.getPlanPrice(plan, billingCycle);

    // Update subscription with payment gateway
    const updatedSubscription = await paymentService.updateSubscription({
      subscriptionId: subscription.id,
      plan,
      billingCycle,
      price: planPrice.amount
    });

    // Update subscription record
    const updatedRecord = await prisma.subscription.update({
      where: { userId: req.userId },
      data: {
        plan,
        price: planPrice.amount,
        billingCycle,
        nextBillingDate: new Date(Date.now() + (billingCycle === 'MONTHLY' ? 30 : billingCycle === 'QUARTERLY' ? 90 : 365) * 24 * 60 * 60 * 1000)
      }
    });

    // Update employer profile
    if (req.userRole === 'EMPLOYER') {
      await prisma.employerProfile.update({
        where: { userId: req.userId },
        data: {
          subscriptionPlan: plan
        }
      });
    }

    res.json({
      message: 'Subscription updated successfully',
      subscription: updatedRecord
    });
  } catch (error) {
    console.error('Update subscription error:', error);
    res.status(500).json({ error: 'Failed to update subscription', details: error.message });
  }
});

// Webhook for payment gateway notifications
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  try {
    const signature = req.headers['stripe-signature'];

    const event = paymentService.verifyWebhook(req.body, signature);

    // Handle the event
    switch (event.type) {
      case 'payment_intent.succeeded':
        const paymentIntent = event.data.object;
        
        // Update payment status
        await prisma.payment.updateMany({
          where: { transactionId: paymentIntent.id },
          data: {
            status: 'COMPLETED',
            completedAt: new Date(),
            gatewayResponse: { webhook: event }
          }
        });

        // Create invoice if needed
        const payment = await prisma.payment.findFirst({
          where: { transactionId: paymentIntent.id }
        });

        if (payment) {
          await prisma.invoice.create({
            data: {
              invoiceNumber: `INV-${Date.now()}-${payment.id.slice(-6)}`,
              userId: payment.payerId,
              paymentId: payment.id,
              subtotal: payment.amount,
              taxAmount: payment.taxAmount,
              total: payment.amount + payment.taxAmount,
              currency: payment.currency,
              items: [{ description: payment.description, amount: payment.amount }],
              issueDate: new Date(),
              dueDate: new Date(),
              status: 'PAID',
              paidDate: new Date()
            }
          });
        }
        break;

      case 'payment_intent.payment_failed':
        const failedPaymentIntent = event.data.object;
        
        await prisma.payment.updateMany({
          where: { transactionId: failedPaymentIntent.id },
          data: {
            status: 'FAILED',
            gatewayResponse: { webhook: event }
          }
        });
        break;

      case 'invoice.payment_succeeded':
        // Handle subscription invoice payment
        const invoice = event.data.object;
        // Update subscription and create payment record
        break;

      case 'customer.subscription.updated':
      case 'customer.subscription.deleted':
        // Handle subscription updates
        const subscription = event.data.object;
        // Update subscription status in database
        break;

      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(400).json({ error: 'Webhook error', details: error.message });
  }
});

// Get payment statistics
router.get('/stats', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only admins or employers can see payment stats
    if (req.userRole !== 'ADMIN' && req.userRole !== 'EMPLOYER') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const where = {};
    if (req.userRole === 'EMPLOYER') {
      where.OR = [
        { payerId: req.userId },
        { recipientId: req.userId }
      ];
    }

    const [
      totalRevenue,
      monthlyRevenue,
      successfulPayments,
      pendingPayments,
      topPlans,
      revenueByMonth
    ] = await Promise.all([
      prisma.payment.aggregate({
        where: { ...where, status: 'COMPLETED' },
        _sum: { amount: true }
      }),
      prisma.payment.aggregate({
        where: {
          ...where,
          status: 'COMPLETED',
          completedAt: {
            gte: new Date(new Date().setMonth(new Date().getMonth() - 1))
          }
        },
        _sum: { amount: true }
      }),
      prisma.payment.count({
        where: { ...where, status: 'COMPLETED' }
      }),
      prisma.payment.count({
        where: { ...where, status: 'PENDING' }
      }),
      prisma.subscription.groupBy({
        by: ['plan'],
        _count: {
          plan: true
        },
        orderBy: {
          _count: {
            plan: 'desc'
          }
        },
        take: 5
      }),
      prisma.payment.groupBy({
        by: ['createdAt'],
        where: { ...where, status: 'COMPLETED' },
        _sum: {
          amount: true
        },
        orderBy: {
          createdAt: 'desc'
        },
        take: 12
      })
    ]);

    res.json({
      totalRevenue: totalRevenue._sum.amount || 0,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      successfulPayments,
      pendingPayments,
      topPlans,
      revenueByMonth: revenueByMonth.map(item => ({
        month: item.createdAt,
        revenue: item._sum.amount
      }))
    });
  } catch (error) {
    console.error('Get payment stats error:', error);
    res.status(500).json({ error: 'Failed to get payment statistics', details: error.message });
  }
});

module.exports = router;
