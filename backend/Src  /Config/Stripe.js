// utils/stripe.js
const Stripe = require('stripe');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');

class StripeService {
  constructor(config = {}) {
    this.config = {
      apiKey: config.apiKey || process.env.STRIPE_SECRET_KEY,
      webhookSecret: config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET,
      publishableKey: config.publishableKey || process.env.STRIPE_PUBLISHABLE_KEY,
      
      // Job portal specific configuration
      productNames: {
        jobPost: config.productNames?.jobPost || 'Job Posting Credit',
        featuredJob: config.productNames?.featuredJob || 'Featured Job Listing',
        resumeAccess: config.productNames?.resumeAccess || 'Resume Database Access',
        premium: config.productNames?.premium || 'Premium Employer Account',
        boost: config.productNames?.boost || 'Job Post Boost',
      },
      
      currency: config.currency || 'usd',
      taxRates: config.taxRates || [], // Stripe tax rate IDs
      defaultTrialDays: config.defaultTrialDays || 14,
      
      // Webhook event handlers
      webhookHandlers: config.webhookHandlers || {},
    };

    if (!this.config.apiKey) {
      throw new Error('Stripe API key is required');
    }

    this.stripe = new Stripe(this.config.apiKey, {
      apiVersion: '2023-10-16',
      maxNetworkRetries: 3,
      timeout: 20000,
      appInfo: {
        name: 'JobPortal',
        version: '1.0.0',
        url: 'https://app.jobportal.com',
      },
    });

    // Initialize cache for frequently accessed data
    this.cache = {
      products: new Map(),
      prices: new Map(),
      coupons: new Map(),
    };
  }

  // CUSTOMER MANAGEMENT
  async createCustomer(userData, metadata = {}) {
    try {
      const customer = await this.stripe.customers.create({
        email: userData.email,
        name: userData.name,
        phone: userData.phone,
        metadata: {
          userId: userData.id,
          userRole: userData.role,
          registrationDate: new Date().toISOString(),
          ...metadata,
        },
        address: userData.address,
        shipping: userData.shippingAddress,
        preferred_locales: userData.preferredLocales || ['en'],
      });

      return {
        success: true,
        customer,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getCustomer(customerId) {
    try {
      const customer = await this.stripe.customers.retrieve(customerId, {
        expand: ['default_source', 'invoice_settings.default_payment_method'],
      });

      return {
        success: true,
        customer,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async updateCustomer(customerId, updates) {
    try {
      const customer = await this.stripe.customers.update(customerId, updates);

      return {
        success: true,
        customer,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async deleteCustomer(customerId) {
    try {
      const deleted = await this.stripe.customers.del(customerId);

      return {
        success: true,
        deleted,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async findOrCreateCustomer(userData) {
    try {
      // Try to find existing customer by email
      const existingCustomers = await this.stripe.customers.list({
        email: userData.email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        return {
          success: true,
          customer: existingCustomers.data[0],
          created: false,
        };
      }

      // Create new customer
      const result = await this.createCustomer(userData);
      return {
        ...result,
        created: true,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // PAYMENT METHOD MANAGEMENT
  async createPaymentMethod(paymentMethodData) {
    try {
      const paymentMethod = await this.stripe.paymentMethods.create(paymentMethodData);

      return {
        success: true,
        paymentMethod,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async attachPaymentMethod(customerId, paymentMethodId) {
    try {
      const paymentMethod = await this.stripe.paymentMethods.attach(paymentMethodId, {
        customer: customerId,
      });

      // Optionally set as default
      await this.stripe.customers.update(customerId, {
        invoice_settings: {
          default_payment_method: paymentMethodId,
        },
      });

      return {
        success: true,
        paymentMethod,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getCustomerPaymentMethods(customerId, type = 'card') {
    try {
      const paymentMethods = await this.stripe.paymentMethods.list({
        customer: customerId,
        type: type,
      });

      return {
        success: true,
        paymentMethods: paymentMethods.data,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async detachPaymentMethod(paymentMethodId) {
    try {
      const paymentMethod = await this.stripe.paymentMethods.detach(paymentMethodId);

      return {
        success: true,
        paymentMethod,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async setupIntent(customerId, usage = 'off_session') {
    try {
      const setupIntent = await this.stripe.setupIntents.create({
        customer: customerId,
        usage: usage,
        metadata: {
          setupFor: 'recurring_payments',
        },
      });

      return {
        success: true,
        setupIntent,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // PRODUCT MANAGEMENT (Job Portal Specific)
  async getOrCreateProducts() {
    try {
      const products = {};

      // Job Post Product
      products.jobPost = await this.getOrCreateProduct({
        name: this.config.productNames.jobPost,
        description: 'Credit for posting a single job listing',
        metadata: {
          type: 'job_post',
          credits: 1,
        },
      });

      // Featured Job Product
      products.featuredJob = await this.getOrCreateProduct({
        name: this.config.productNames.featuredJob,
        description: 'Featured job listing for increased visibility',
        metadata: {
          type: 'featured_job',
          duration_days: 30,
        },
      });

      // Resume Access Product
      products.resumeAccess = await this.getOrCreateProduct({
        name: this.config.productNames.resumeAccess,
        description: 'Access to resume database for recruiting',
        metadata: {
          type: 'resume_access',
          duration_days: 30,
          search_limit: 100,
        },
      });

      // Premium Subscription Product
      products.premium = await this.getOrCreateProduct({
        name: this.config.productNames.premium,
        description: 'Premium employer account with enhanced features',
        metadata: {
          type: 'premium_subscription',
          tier: 'premium',
        },
      });

      // Job Boost Product
      products.boost = await this.getOrCreateProduct({
        name: this.config.productNames.boost,
        description: 'Boost existing job post to top of listings',
        metadata: {
          type: 'job_boost',
          duration_days: 7,
        },
      });

      return {
        success: true,
        products,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getOrCreateProduct(productData) {
    try {
      const cacheKey = `product_${productData.name}`;
      
      // Check cache
      if (this.cache.products.has(cacheKey)) {
        return this.cache.products.get(cacheKey);
      }

      // Search for existing product
      const existingProducts = await this.stripe.products.search({
        query: `name:"${productData.name}" active:'true'`,
        limit: 1,
      });

      let product;
      if (existingProducts.data.length > 0) {
        product = existingProducts.data[0];
      } else {
        // Create new product
        product = await this.stripe.products.create({
          name: productData.name,
          description: productData.description,
          active: true,
          metadata: productData.metadata,
          shippable: false,
          statement_descriptor: productData.name.substring(0, 22),
        });
      }

      // Cache the product
      this.cache.products.set(cacheKey, product);

      return product;
    } catch (error) {
      throw error;
    }
  }

  // PRICE MANAGEMENT
  async createPrice(productId, priceData, metadata = {}) {
    try {
      const price = await this.stripe.prices.create({
        product: productId,
        unit_amount: priceData.amount,
        currency: priceData.currency || this.config.currency,
        recurring: priceData.recurring,
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString(),
        },
      });

      return {
        success: true,
        price,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getProductPrices(productId) {
    try {
      const prices = await this.stripe.prices.list({
        product: productId,
        active: true,
      });

      return {
        success: true,
        prices: prices.data,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async archivePrice(priceId) {
    try {
      const price = await this.stripe.prices.update(priceId, {
        active: false,
      });

      return {
        success: true,
        price,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // SUBSCRIPTION MANAGEMENT
  async createSubscription(customerId, priceId, options = {}) {
    try {
      const subscriptionData = {
        customer: customerId,
        items: [{ price: priceId }],
        metadata: options.metadata || {},
        payment_behavior: 'default_incomplete',
        expand: ['latest_invoice.payment_intent'],
      };

      // Add trial if specified
      if (options.trialPeriodDays) {
        subscriptionData.trial_period_days = options.trialPeriodDays;
      } else if (this.config.defaultTrialDays > 0) {
        subscriptionData.trial_period_days = this.config.defaultTrialDays;
      }

      // Add tax rates if configured
      if (this.config.taxRates.length > 0) {
        subscriptionData.default_tax_rates = this.config.taxRates;
      }

      // Add coupon if provided
      if (options.couponId) {
        subscriptionData.coupon = options.couponId;
      }

      // Add payment settings
      subscriptionData.payment_settings = {
        payment_method_types: ['card'],
        save_default_payment_method: 'on_subscription',
      };

      const subscription = await this.stripe.subscriptions.create(subscriptionData);

      return {
        success: true,
        subscription,
        clientSecret: subscription.latest_invoice.payment_intent.client_secret,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getSubscription(subscriptionId) {
    try {
      const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
        expand: ['customer', 'latest_invoice', 'pending_setup_intent'],
      });

      return {
        success: true,
        subscription,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async updateSubscription(subscriptionId, updates) {
    try {
      const subscription = await this.stripe.subscriptions.update(
        subscriptionId,
        updates
      );

      return {
        success: true,
        subscription,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async cancelSubscription(subscriptionId, cancelAtPeriodEnd = false) {
    try {
      const subscription = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: cancelAtPeriodEnd,
      });

      return {
        success: true,
        subscription,
        cancelAt: cancelAtPeriodEnd ? subscription.current_period_end : null,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async reactivateSubscription(subscriptionId) {
    try {
      const subscription = await this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: false,
      });

      return {
        success: true,
        subscription,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async listSubscriptions(customerId, status = 'active') {
    try {
      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        status: status,
        expand: ['data.plan.product'],
      });

      return {
        success: true,
        subscriptions: subscriptions.data,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // PAYMENT INTENTS (for one-time payments)
  async createPaymentIntent(amount, customerId, metadata = {}) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.create({
        amount: amount,
        currency: this.config.currency,
        customer: customerId,
        metadata: {
          paymentType: 'one_time',
          ...metadata,
        },
        payment_method_types: ['card'],
        setup_future_usage: 'off_session',
      });

      return {
        success: true,
        paymentIntent,
        clientSecret: paymentIntent.client_secret,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async confirmPaymentIntent(paymentIntentId, paymentMethodId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.confirm(paymentIntentId, {
        payment_method: paymentMethodId,
      });

      return {
        success: true,
        paymentIntent,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async capturePaymentIntent(paymentIntentId, amount = null) {
    try {
      const captureData = amount ? { amount_to_capture: amount } : {};
      const paymentIntent = await this.stripe.paymentIntents.capture(
        paymentIntentId,
        captureData
      );

      return {
        success: true,
        paymentIntent,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async cancelPaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await this.stripe.paymentIntents.cancel(paymentIntentId);

      return {
        success: true,
        paymentIntent,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // CHECKOUT SESSIONS
  async createCheckoutSession(lineItems, customerId, successUrl, cancelUrl, mode = 'payment', metadata = {}) {
    try {
      const sessionData = {
        customer: customerId,
        payment_method_types: ['card'],
        line_items: lineItems,
        mode: mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: metadata,
        allow_promotion_codes: true,
        billing_address_collection: 'required',
        shipping_address_collection: {
          allowed_countries: ['US', 'CA', 'GB', 'AU', 'IN'],
        },
      };

      // For subscriptions, add subscription data
      if (mode === 'subscription') {
        sessionData.subscription_data = {
          trial_period_days: this.config.defaultTrialDays,
          metadata: metadata,
        };
      }

      // For one-time payments, add payment intent data
      if (mode === 'payment') {
        sessionData.payment_intent_data = {
          metadata: metadata,
          setup_future_usage: 'off_session',
        };
      }

      const session = await this.stripe.checkout.sessions.create(sessionData);

      return {
        success: true,
        session,
        url: session.url,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getCheckoutSession(sessionId) {
    try {
      const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
        expand: ['customer', 'payment_intent', 'subscription'],
      });

      return {
        success: true,
        session,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async expireCheckoutSession(sessionId) {
    try {
      const session = await this.stripe.checkout.sessions.expire(sessionId);

      return {
        success: true,
        session,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // INVOICE MANAGEMENT
  async getInvoice(invoiceId) {
    try {
      const invoice = await this.stripe.invoices.retrieve(invoiceId, {
        expand: ['customer', 'payment_intent', 'subscription'],
      });

      return {
        success: true,
        invoice,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async listInvoices(customerId, limit = 10) {
    try {
      const invoices = await this.stripe.invoices.list({
        customer: customerId,
        limit: limit,
        expand: ['data.payment_intent'],
      });

      return {
        success: true,
        invoices: invoices.data,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async createInvoice(customerId, items, metadata = {}) {
    try {
      const invoice = await this.stripe.invoices.create({
        customer: customerId,
        collection_method: 'send_invoice',
        days_until_due: 30,
        metadata: metadata,
      });

      // Add line items
      for (const item of items) {
        await this.stripe.invoiceItems.create({
          customer: customerId,
          invoice: invoice.id,
          amount: item.amount,
          currency: item.currency || this.config.currency,
          description: item.description,
          metadata: item.metadata,
        });
      }

      // Finalize invoice
      const finalizedInvoice = await this.stripe.invoices.finalizeInvoice(invoice.id);

      return {
        success: true,
        invoice: finalizedInvoice,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async sendInvoice(invoiceId) {
    try {
      const invoice = await this.stripe.invoices.sendInvoice(invoiceId);

      return {
        success: true,
        invoice,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async payInvoice(invoiceId, paymentMethodId = null) {
    try {
      const payOptions = paymentMethodId ? { payment_method: paymentMethodId } : {};
      const invoice = await this.stripe.invoices.pay(invoiceId, payOptions);

      return {
        success: true,
        invoice,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // REFUND MANAGEMENT
  async createRefund(paymentIntentId, amount = null, reason = null) {
    try {
      const refundData = {
        payment_intent: paymentIntentId,
      };

      if (amount) refundData.amount = amount;
      if (reason) refundData.reason = reason;

      const refund = await this.stripe.refunds.create(refundData);

      return {
        success: true,
        refund,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getRefund(refundId) {
    try {
      const refund = await this.stripe.refunds.retrieve(refundId);

      return {
        success: true,
        refund,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async cancelRefund(refundId) {
    try {
      const refund = await this.stripe.refunds.cancel(refundId);

      return {
        success: true,
        refund,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // COUPON & PROMOTION CODE MANAGEMENT
  async createCoupon(percentOff, duration, metadata = {}) {
    try {
      const coupon = await this.stripe.coupons.create({
        percent_off: percentOff,
        duration: duration,
        name: `${percentOff}% off ${duration}`,
        metadata: metadata,
      });

      return {
        success: true,
        coupon,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async createPromotionCode(couponId, code = null, metadata = {}) {
    try {
      const promotionCode = await this.stripe.promotionCodes.create({
        coupon: couponId,
        code: code,
        metadata: metadata,
      });

      return {
        success: true,
        promotionCode,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async validatePromotionCode(code) {
    try {
      const promotionCodes = await this.stripe.promotionCodes.list({
        code: code,
        active: true,
      });

      if (promotionCodes.data.length === 0) {
        return {
          success: false,
          error: 'Invalid or expired promotion code',
        };
      }

      const promotionCode = promotionCodes.data[0];

      return {
        success: true,
        promotionCode,
        valid: true,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // WEBHOOK HANDLING
  async constructEvent(payload, signature) {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        this.config.webhookSecret
      );

      return {
        success: true,
        event,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async handleWebhook(event) {
    try {
      let result = null;

      // Handle specific event types
      switch (event.type) {
        case 'payment_intent.succeeded':
          result = await this.handlePaymentIntentSucceeded(event.data.object);
          break;

        case 'payment_intent.payment_failed':
          result = await this.handlePaymentIntentFailed(event.data.object);
          break;

        case 'customer.subscription.created':
          result = await this.handleSubscriptionCreated(event.data.object);
          break;

        case 'customer.subscription.updated':
          result = await this.handleSubscriptionUpdated(event.data.object);
          break;

        case 'customer.subscription.deleted':
          result = await this.handleSubscriptionDeleted(event.data.object);
          break;

        case 'invoice.payment_succeeded':
          result = await this.handleInvoicePaymentSucceeded(event.data.object);
          break;

        case 'invoice.payment_failed':
          result = await this.handleInvoicePaymentFailed(event.data.object);
          break;

        case 'checkout.session.completed':
          result = await this.handleCheckoutSessionCompleted(event.data.object);
          break;

        case 'charge.refunded':
          result = await this.handleChargeRefunded(event.data.object);
          break;

        default:
          // Call custom handler if provided
          if (this.config.webhookHandlers[event.type]) {
            result = await this.config.webhookHandlers[event.type](event);
          }
      }

      return {
        success: true,
        event: event.type,
        result,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // Default webhook handlers
  async handlePaymentIntentSucceeded(paymentIntent) {
    // Update job post status, send confirmation email, etc.
    console.log('Payment succeeded:', paymentIntent.id);
    
    // Extract metadata for job portal specific actions
    const { jobId, userId, type } = paymentIntent.metadata;
    
    if (type === 'job_post') {
      // Activate job posting
      // await activateJobPost(jobId, userId);
    }

    return { processed: true, paymentIntentId: paymentIntent.id };
  }

  async handlePaymentIntentFailed(paymentIntent) {
    // Notify user, update job post status, etc.
    console.log('Payment failed:', paymentIntent.id);
    return { processed: true, paymentIntentId: paymentIntent.id };
  }

  async handleSubscriptionCreated(subscription) {
    // Activate premium features, send welcome email
    console.log('Subscription created:', subscription.id);
    return { processed: true, subscriptionId: subscription.id };
  }

  async handleSubscriptionUpdated(subscription) {
    // Update user's subscription status
    console.log('Subscription updated:', subscription.id);
    return { processed: true, subscriptionId: subscription.id };
  }

  async handleSubscriptionDeleted(subscription) {
    // Downgrade user, send cancellation email
    console.log('Subscription deleted:', subscription.id);
    return { processed: true, subscriptionId: subscription.id };
  }

  async handleInvoicePaymentSucceeded(invoice) {
    // Update billing records, send receipt
    console.log('Invoice payment succeeded:', invoice.id);
    return { processed: true, invoiceId: invoice.id };
  }

  async handleInvoicePaymentFailed(invoice) {
    // Notify user, retry logic
    console.log('Invoice payment failed:', invoice.id);
    return { processed: true, invoiceId: invoice.id };
  }

  async handleCheckoutSessionCompleted(session) {
    // Process completed checkout
    console.log('Checkout session completed:', session.id);
    return { processed: true, sessionId: session.id };
  }

  async handleChargeRefunded(charge) {
    // Update order status, notify user
    console.log('Charge refunded:', charge.id);
    return { processed: true, chargeId: charge.id };
  }

  // JOB PORTAL SPECIFIC METHODS
  async purchaseJobPost(customerId, jobData, priceId) {
    try {
      const metadata = {
        type: 'job_post',
        jobId: jobData.id,
        jobTitle: jobData.title,
        employerId: jobData.employerId,
        purchaseDate: new Date().toISOString(),
      };

      const paymentIntent = await this.createPaymentIntent(
        jobData.amount,
        customerId,
        metadata
      );

      return {
        success: true,
        ...paymentIntent,
        metadata,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async purchaseFeaturedJob(customerId, jobId, durationDays = 30) {
    try {
      const price = await this.getOrCreateFeaturedJobPrice(durationDays);
      
      const session = await this.createCheckoutSession(
        [{
          price: price.id,
          quantity: 1,
        }],
        customerId,
        `${process.env.APP_URL}/payment-success?jobId=${jobId}`,
        `${process.env.APP_URL}/payment-cancel?jobId=${jobId}`,
        'payment',
        {
          type: 'featured_job',
          jobId: jobId,
          durationDays: durationDays,
        }
      );

      return session;
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async subscribeToPremium(customerId, tier = 'premium') {
    try {
      const products = await this.getOrCreateProducts();
      const price = await this.getProductPrices(products.premium.id);
      
      if (price.prices.length === 0) {
        throw new Error('No price found for premium subscription');
      }

      const subscription = await this.createSubscription(
        customerId,
        price.prices[0].id,
        {
          metadata: {
            tier: tier,
            subscriptionDate: new Date().toISOString(),
          },
        }
      );

      return subscription;
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async boostJobPost(customerId, jobId, boostType = 'standard') {
    try {
      const boostPrices = {
        standard: 1999, // $19.99
        premium: 3999,  // $39.99
        max: 7999,      // $79.99
      };

      const amount = boostPrices[boostType] || boostPrices.standard;

      const paymentIntent = await this.createPaymentIntent(
        amount,
        customerId,
        {
          type: 'job_boost',
          jobId: jobId,
          boostType: boostType,
          boostDate: new Date().toISOString(),
        }
      );

      return paymentIntent;
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // BILLING PORTAL
  async createBillingPortalSession(customerId, returnUrl) {
    try {
      const session = await this.stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
      });

      return {
        success: true,
        session,
        url: session.url,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // REPORTING & ANALYTICS
  async getRevenueReport(startDate, endDate) {
    try {
      // Get all successful charges in date range
      const charges = await this.stripe.charges.list({
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000),
        },
        limit: 100,
      });

      // Get all subscriptions active in date range
      const subscriptions = await this.stripe.subscriptions.list({
        created: {
          gte: Math.floor(startDate.getTime() / 1000),
          lte: Math.floor(endDate.getTime() / 1000),
        },
        limit: 100,
      });

      // Calculate totals
      const totalRevenue = charges.data.reduce((sum, charge) => sum + charge.amount, 0);
      const mrr = subscriptions.data.reduce((sum, sub) => {
        if (sub.status === 'active') {
          return sum + (sub.plan?.amount || 0);
        }
        return sum;
      }, 0);

      return {
        success: true,
        report: {
          period: { startDate, endDate },
          totalCharges: charges.data.length,
          totalRevenue,
          mrr,
          currency: this.config.currency,
          breakdown: {
            jobPosts: charges.data.filter(c => c.metadata.type === 'job_post').length,
            featuredJobs: charges.data.filter(c => c.metadata.type === 'featured_job').length,
            subscriptions: subscriptions.data.length,
            boosts: charges.data.filter(c => c.metadata.type === 'job_boost').length,
          },
        },
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  async getCustomerLifetimeValue(customerId) {
    try {
      const charges = await this.stripe.charges.list({
        customer: customerId,
        limit: 100,
      });

      const subscriptions = await this.stripe.subscriptions.list({
        customer: customerId,
        limit: 100,
      });

      const totalSpent = charges.data.reduce((sum, charge) => sum + charge.amount, 0);
      
      const subscriptionRevenue = subscriptions.data.reduce((sum, sub) => {
        if (sub.status === 'active') {
          return sum + (sub.plan?.amount || 0) * (sub.current_period_end - sub.current_period_start) / (30 * 24 * 60 * 60);
        }
        return sum;
      }, 0);

      return {
        success: true,
        metrics: {
          totalCharges: charges.data.length,
          totalSpent,
          subscriptionRevenue,
          lifetimeValue: totalSpent + subscriptionRevenue,
          activeSubscriptions: subscriptions.data.filter(s => s.status === 'active').length,
          currency: this.config.currency,
        },
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // UTILITY METHODS
  async getOrCreateFeaturedJobPrice(durationDays = 30) {
    const cacheKey = `featured_job_${durationDays}`;
    
    if (this.cache.prices.has(cacheKey)) {
      return this.cache.prices.get(cacheKey);
    }

    const products = await this.getOrCreateProducts();
    const price = await this.createPrice(products.featuredJob.id, {
      amount: durationDays === 30 ? 4999 : 8999, // $49.99 or $89.99
      currency: this.config.currency,
    });

    this.cache.prices.set(cacheKey, price.price);
    return price.price;
  }

  formatAmount(amount, currency = this.config.currency) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount / 100);
  }

  handleStripeError(error) {
    console.error('Stripe error:', error);

    // Handle specific Stripe error types
    switch (error.type) {
      case 'StripeCardError':
        return {
          success: false,
          error: 'CARD_ERROR',
          message: error.message,
          code: error.code,
          declineCode: error.decline_code,
        };

      case 'StripeRateLimitError':
        return {
          success: false,
          error: 'RATE_LIMIT',
          message: 'Too many requests. Please try again later.',
        };

      case 'StripeInvalidRequestError':
        return {
          success: false,
          error: 'INVALID_REQUEST',
          message: error.message,
          param: error.param,
        };

      case 'StripeAPIError':
        return {
          success: false,
          error: 'API_ERROR',
          message: 'An error occurred with our payment processor. Please try again.',
        };

      case 'StripeConnectionError':
        return {
          success: false,
          error: 'CONNECTION_ERROR',
          message: 'Unable to connect to payment processor. Please check your connection.',
        };

      case 'StripeAuthenticationError':
        return {
          success: false,
          error: 'AUTHENTICATION_ERROR',
          message: 'Authentication with payment processor failed.',
        };

      default:
        return {
          success: false,
          error: 'UNKNOWN_ERROR',
          message: error.message || 'An unexpected error occurred',
        };
    }
  }

  // CLEANUP & MAINTENANCE
  async cleanupExpiredCarts() {
    try {
      const expiredSessions = await this.stripe.checkout.sessions.list({
        created: {
          lte: Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000), // 24 hours ago
        },
        status: 'open',
        limit: 100,
      });

      for (const session of expiredSessions.data) {
        await this.expireCheckoutSession(session.id);
      }

      return {
        success: true,
        expired: expiredSessions.data.length,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }

  // SECURITY & FRAUD DETECTION
  async verifyPaymentSignature(payload, signature) {
    try {
      const event = await this.constructEvent(payload, signature);
      return {
        success: true,
        verified: true,
        eventType: event.event?.type,
      };
    } catch (error) {
      return {
        success: false,
        verified: false,
        error: error.message,
      };
    }
  }

  async createRadarSession() {
    try {
      const radarSession = await this.stripe.radar.sessions.create();

      return {
        success: true,
        radarSession,
      };
    } catch (error) {
      return this.handleStripeError(error);
    }
  }
}

// Express middleware for Stripe
const createStripeMiddleware = (stripeService) => {
  return {
    // Authentication middleware for Stripe customers
    requireStripeCustomer: () => {
      return async (req, res, next) => {
        try {
          if (!req.user) {
            return res.status(401).json({
              error: 'AUTHENTICATION_REQUIRED',
              message: 'Authentication required',
            });
          }

          // Check if user has Stripe customer ID
          if (!req.user.stripeCustomerId) {
            // Create or find Stripe customer
            const customerResult = await stripeService.findOrCreateCustomer({
              id: req.user.id,
              email: req.user.email,
              name: req.user.name,
              role: req.user.role,
            });

            if (!customerResult.success) {
              return res.status(500).json({
                error: 'STRIPE_CUSTOMER_ERROR',
                message: 'Unable to setup payment account',
              });
            }

            req.user.stripeCustomerId = customerResult.customer.id;
            // Update user in database with stripeCustomerId
            // await updateUserStripeId(req.user.id, customerResult.customer.id);
          }

          req.stripeCustomerId = req.user.stripeCustomerId;
          next();
        } catch (error) {
          console.error('Stripe customer middleware error:', error);
          return res.status(500).json({
            error: 'STRIPE_MIDDLEWARE_ERROR',
            message: 'Error in payment system',
          });
        }
      };
    },

    // Webhook handler middleware
    handleWebhook: () => {
      return async (req, res) => {
        const sig = req.headers['stripe-signature'];

        try {
          // Verify webhook signature
          const eventResult = await stripeService.constructEvent(
            req.body,
            sig
          );

          if (!eventResult.success) {
            return res.status(400).json({
              error: 'WEBHOOK_ERROR',
              message: eventResult.error,
            });
          }

          // Process webhook
          const result = await stripeService.handleWebhook(eventResult.event);

          res.json({
            success: true,
            received: true,
            event: eventResult.event.type,
            result,
          });
        } catch (error) {
          console.error('Webhook error:', error);
          res.status(400).json({
            error: 'WEBHOOK_PROCESSING_ERROR',
            message: error.message,
          });
        }
      };
    },

    // Payment intent validation middleware
    validatePaymentIntent: () => {
      return async (req, res, next) => {
        try {
          const { paymentIntentId } = req.body;

          if (!paymentIntentId) {
            return res.status(400).json({
              error: 'MISSING_PAYMENT_INTENT',
              message: 'Payment intent ID is required',
            });
          }

          const paymentIntent = await stripeService.stripe.paymentIntents.retrieve(
            paymentIntentId
          );

          if (paymentIntent.status !== 'succeeded') {
            return res.status(400).json({
              error: 'PAYMENT_NOT_COMPLETED',
              message: 'Payment not completed',
              status: paymentIntent.status,
            });
          }

          // Attach payment intent to request
          req.paymentIntent = paymentIntent;
          next();
        } catch (error) {
          console.error('Payment intent validation error:', error);
          return res.status(400).json({
            error: 'PAYMENT_VALIDATION_ERROR',
            message: 'Invalid payment intent',
          });
        }
      };
    },

    // Subscription check middleware
    requireActiveSubscription: (requiredPlan = null) => {
      return async (req, res, next) => {
        try {
          if (!req.stripeCustomerId) {
            return res.status(400).json({
              error: 'NO_STRIPE_CUSTOMER',
              message: 'Payment account not found',
            });
          }

          const subscriptions = await stripeService.listSubscriptions(
            req.stripeCustomerId,
            'active'
          );

          if (!subscriptions.success || subscriptions.subscriptions.length === 0) {
            return res.status(403).json({
              error: 'NO_ACTIVE_SUBSCRIPTION',
              message: 'Active subscription required',
            });
          }

          if (requiredPlan) {
            const hasRequiredPlan = subscriptions.subscriptions.some(sub =>
              sub.metadata?.plan === requiredPlan || 
              sub.plan?.metadata?.tier === requiredPlan
            );

            if (!hasRequiredPlan) {
              return res.status(403).json({
                error: 'INSUFFICIENT_SUBSCRIPTION',
                message: `Required plan: ${requiredPlan}`,
              });
            }
          }

          req.activeSubscription = subscriptions.subscriptions[0];
          next();
        } catch (error) {
          console.error('Subscription check error:', error);
          return res.status(500).json({
            error: 'SUBSCRIPTION_CHECK_ERROR',
            message: 'Error checking subscription status',
          });
        }
      };
    },
  };
};

// Helper functions
const stripeHelpers = {
  // Create line items for checkout
  createLineItems: (items) => {
    return items.map(item => ({
      price_data: {
        currency: item.currency || 'usd',
        product_data: {
          name: item.name,
          description: item.description,
          metadata: item.metadata || {},
        },
        unit_amount: item.amount,
      },
      quantity: item.quantity || 1,
    }));
  },

  // Format price for display
  formatPrice: (amount, currency = 'usd') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount / 100);
  },

  // Calculate tax
  calculateTax: (amount, taxRatePercentage) => {
    return Math.round(amount * taxRatePercentage / 100);
  },

  // Generate invoice number
  generateInvoiceNumber: (prefix = 'INV') => {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `${prefix}-${timestamp}-${random}`;
  },

  // Validate card details
  validateCard: (card) => {
    const errors = [];

    // Simple Luhn check
    function luhnCheck(cardNumber) {
      let sum = 0;
      let alternate = false;
      for (let i = cardNumber.length - 1; i >= 0; i--) {
        let n = parseInt(cardNumber[i], 10);
        if (alternate) {
          n *= 2;
          if (n > 9) {
            n -= 9;
          }
        }
        sum += n;
        alternate = !alternate;
      }
      return sum % 10 === 0;
    }

    if (!card.number || !/^\d{13,19}$/.test(card.number.replace(/\s/g, ''))) {
      errors.push('Invalid card number');
    } else if (!luhnCheck(card.number.replace(/\s/g, ''))) {
      errors.push('Invalid card number (Luhn check failed)');
    }

    if (!card.exp_month || card.exp_month < 1 || card.exp_month > 12) {
      errors.push('Invalid expiration month');
    }

    if (!card.exp_year || card.exp_year < new Date().getFullYear()) {
      errors.push('Invalid expiration year');
    }

    if (!card.cvc || !/^\d{3,4}$/.test(card.cvc)) {
      errors.push('Invalid CVC');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  },
};

module.exports = {
  StripeService,
  createStripeMiddleware,
  stripeHelpers,
};
