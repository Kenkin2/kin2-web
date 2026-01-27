const Stripe = require('stripe');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

class PaymentService {
  constructor() {
    this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  }

  async createPaymentIntent(options) {
    try {
      const { amount, currency, paymentMethod, description, metadata } = options;

      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: Math.round(amount * 100), // Convert to cents
        currency: currency.toLowerCase(),
        payment_method_types: ['card'],
        description,
        metadata
      });

      return paymentIntent;
    } catch (error) {
      console.error('Create payment intent error:', error);
      throw error;
    }
  }

  async createSubscription(options) {
    try {
      const { userId, plan, billingCycle, price, currency, paymentMethodId } = options;

      // Create or get Stripe customer
      let customer = await this.getStripeCustomer(userId);
      
      if (!customer) {
        customer = await this.stripe.customers.create({
          email: await this.getUserEmail(userId),
          metadata: { userId }
        });
        
        await this.saveStripeCustomerId(userId, customer.id);
      }

      // Create subscription
      const subscription = await this.stripe.subscriptions.create({
        customer: customer.id,
        items: [{
          price_data: {
            currency: currency.toLowerCase(),
            product_data: {
              name: `${plan} Plan - ${billingCycle}`,
              description: `Kin2 Workforce Platform ${plan} subscription`
            },
            unit_amount: Math.round(price * 100),
            recurring: {
              interval: billingCycle.toLowerCase().slice(0, -2) // monthly, yearly, etc.
            }
          }
        }],
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent']
      });

      // Create payment record
      const payment = await prisma.payment.create({
        data: {
          transactionId: subscription.latest_invoice.payment_intent.id,
          amount: price,
          currency,
          status: 'PENDING',
          method: 'CREDIT_CARD',
          payerId: userId,
          type: 'SUBSCRIPTION',
          referenceId: subscription.id,
          description: `Subscription: ${plan} Plan (${billingCycle})`,
          gateway: 'stripe',
          gatewayData: subscription
        }
      });

      return {
        subscription,
        paymentId: payment.id,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret
      };
    } catch (error) {
      console.error('Create subscription error:', error);
      throw error;
    }
  }

  async getPaymentMethods(userId) {
    try {
      const customer = await this.getStripeCustomer(userId);
      
      if (!customer) {
        return [];
      }

      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customer.id,
        type: 'card'
      });

      return paymentMethods.data.map(method => ({
        id: method.id,
        type: method.type,
        card: {
          brand: method.card.brand,
          last4: method.card.last4,
          expMonth: method.card.exp_month,
          expYear: method.card.exp_year
        },
        created: method.created
      }));
    } catch (error) {
      console.error('Get payment methods error:', error);
      return [];
    }
  }

  async addPaymentMethod(options) {
    try {
      const { userId, paymentMethodId, type, isDefault } = options;

      const customer = await this.getOrCreateStripeCustomer(userId);

      // Attach payment method to customer
      await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customer.id
      });

      // Set as default if specified
      if (isDefault) {
        await this.stripe.customers.update(customer.id, {
          invoice_settings: {
            default_payment_method: paymentMethodId
          }
        });
      }

      return {
        success: true,
        paymentMethodId,
        customerId: customer.id
      };
    } catch (error) {
      console.error('Add payment method error:', error);
      throw error;
    }
  }

  async removePaymentMethod(userId, paymentMethodId) {
    try {
      const customer = await this.getStripeCustomer(userId);
      
      if (!customer) {
        throw new Error('Customer not found');
      }

      await this.stripe.paymentMethods.detach(paymentMethodId);

      return { success: true };
    } catch (error) {
      console.error('Remove payment method error:', error);
      throw error;
    }
  }

  async getPlanPrice(plan, billingCycle) {
    const prices = {
      'BASIC': {
        'MONTHLY': 29.99,
        'QUARTERLY': 79.99,
        'YEARLY': 299.99
      },
      'PRO': {
        'MONTHLY': 79.99,
        'QUARTERLY': 219.99,
        'YEARLY': 799.99
      },
      'BUSINESS': {
        'MONTHLY': 199.99,
        'QUARTERLY': 549.99,
        'YEARLY': 1999.99
      },
      'ENTERPRISE': {
        'MONTHLY': 499.99,
        'QUARTERLY': 1399.99,
        'YEARLY': 4999.99
      }
    };

    const amount = prices[plan]?.[billingCycle] || 0;
    
    return {
      amount,
      currency: 'USD',
      display: `$${amount.toFixed(2)}/${billingCycle.toLowerCase().slice(0, -2)}`
    };
  }

  async processRefund(options) {
    try {
      const { paymentId, amount, reason } = options;

      const refund = await this.stripe.refunds.create({
        payment_intent: paymentId,
        amount: Math.round(amount * 100),
        reason: reason || 'requested_by_customer'
      });

      return refund;
    } catch (error) {
      console.error('Process refund error:', error);
      throw error;
    }
  }

  async cancelSubscription(subscriptionId) {
    try {
      const subscription = await this.stripe.subscriptions.cancel(subscriptionId);

      return subscription;
    } catch (error) {
      console.error('Cancel subscription error:', error);
      throw error;
    }
  }

  async updateSubscription(options) {
    try {
      const { subscriptionId, plan, billingCycle, price } = options;

      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

      // Update subscription
      const updated = await this.stripe.subscriptions.update(subscriptionId, {
        items: [{
          id: subscription.items.data[0].id,
          price_data: {
            currency: 'usd',
            product_data: {
              name: `${plan} Plan - ${billingCycle}`,
              description: `Kin2 Workforce Platform ${plan} subscription`
            },
            unit_amount: Math.round(price * 100),
            recurring: {
              interval: billingCycle.toLowerCase().slice(0, -2)
            }
          }
        }]
      });

      return updated;
    } catch (error) {
      console.error('Update subscription error:', error);
      throw error;
    }
  }

  verifyWebhook(payload, signature) {
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      this.webhookSecret
    );
  }

  async generateInvoicePdf(invoice) {
    // In production, use a PDF generation library like pdfkit or puppeteer
    // For now, return a placeholder URL
    return `/invoices/${invoice.invoiceNumber}.pdf`;
  }

  // Helper methods
  async getStripeCustomer(userId) {
    try {
      // In a real implementation, you would store Stripe customer IDs in your database
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { email: true }
      });

      if (!user) return null;

      // Search for customer by email
      const customers = await this.stripe.customers.list({
        email: user.email,
        limit: 1
      });

      return customers.data[0] || null;
    } catch (error) {
      console.error('Get Stripe customer error:', error);
      return null;
    }
  }

  async getOrCreateStripeCustomer(userId) {
    let customer = await this.getStripeCustomer(userId);
    
    if (!customer) {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });

      if (!user) {
        throw new Error('User not found');
      }

      customer = await this.stripe.customers.create({
        email: user.email,
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        phone: user.profile.phone,
        metadata: { userId }
      });
    }

    return customer;
  }

  async saveStripeCustomerId(userId, customerId) {
    // Save Stripe customer ID to your database
    // This is a placeholder implementation
    console.log(`Save customer ${customerId} for user ${userId}`);
  }

  async getUserEmail(userId) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true }
    });

    return user?.email || 'unknown@example.com';
  }
}

module.exports = new PaymentService();
