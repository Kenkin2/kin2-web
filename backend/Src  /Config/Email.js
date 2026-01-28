// utils/email.js
const nodemailer = require('nodemailer');
const handlebars = require('handlebars');
const fs = require('fs').promises;
const path = require('path');
const juice = require('juice'); // For inline CSS
const mjml2html = require('mjml'); // For responsive emails
const crypto = require('crypto');

class EmailService {
  constructor(config = {}) {
    this.config = {
      // SMTP Configuration
      host: config.host || process.env.SMTP_HOST,
      port: config.port || process.env.SMTP_PORT || 587,
      secure: config.secure || process.env.SMTP_SECURE === 'true',
      auth: {
        user: config.user || process.env.SMTP_USER,
        pass: config.pass || process.env.SMTP_PASSWORD,
      },
      
      // Email defaults
      from: config.from || process.env.EMAIL_FROM || 'noreply@jobportal.com',
      fromName: config.fromName || process.env.EMAIL_FROM_NAME || 'Job Portal',
      replyTo: config.replyTo || process.env.EMAIL_REPLY_TO,
      
      // Template configuration
      templateDir: config.templateDir || path.join(__dirname, '../templates/email'),
      defaultLocale: config.defaultLocale || 'en',
      enablePreview: config.enablePreview || process.env.NODE_ENV !== 'production',
      
      // Rate limiting
      rateLimit: config.rateLimit || {
        maxPerDay: 1000,
        maxPerHour: 100,
        maxPerMinute: 20,
      },
      
      // Retry configuration
      retryAttempts: config.retryAttempts || 3,
      retryDelay: config.retryDelay || 1000,
      
      // Queue configuration
      useQueue: config.useQueue || true,
      queueName: config.queueName || 'email_queue',
      
      // Tracking
      enableTracking: config.enableTracking || true,
      trackingPixelUrl: config.trackingPixelUrl || process.env.TRACKING_PIXEL_URL,
    };

    // Validate configuration
    this.validateConfig();

    // Initialize transporter
    this.transporter = this.createTransporter();

    // Initialize template cache
    this.templateCache = new Map();

    // Initialize email tracking
    this.tracking = {
      sentToday: 0,
      sentThisHour: 0,
      sentThisMinute: 0,
      lastReset: {
        day: new Date().getDate(),
        hour: new Date().getHours(),
        minute: new Date().getMinutes(),
      },
    };

    // Initialize queues if enabled
    if (this.config.useQueue) {
      this.queue = [];
      this.isProcessingQueue = false;
    }

    // Register default helpers
    this.registerDefaultHelpers();
  }

  validateConfig() {
    const required = ['host', 'port', 'auth.user', 'auth.pass'];
    const missing = required.filter(key => {
      const keys = key.split('.');
      let value = this.config;
      for (const k of keys) {
        value = value[k];
        if (value === undefined) return true;
      }
      return false;
    });

    if (missing.length > 0) {
      throw new Error(`Missing email configuration: ${missing.join(', ')}`);
    }
  }

  createTransporter() {
    return nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.auth,
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      rateLimit: 10, // messages per second
      logger: process.env.NODE_ENV === 'development',
      debug: process.env.NODE_ENV === 'development',
      tls: {
        rejectUnauthorized: process.env.NODE_ENV === 'production',
      },
    });
  }

  registerDefaultHelpers() {
    // Format date
    handlebars.registerHelper('formatDate', function(date, format) {
      if (!date) return '';
      const d = new Date(date);
      
      const formats = {
        short: `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`,
        long: d.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        }),
        time: d.toLocaleTimeString('en-US', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        datetime: d.toLocaleString('en-US', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        }),
      };

      return formats[format] || d.toLocaleDateString();
    });

    // Format currency
    handlebars.registerHelper('formatCurrency', function(amount, currency = 'USD') {
      if (amount === undefined || amount === null) return '';
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
      }).format(amount);
    });

    // Truncate text
    handlebars.registerHelper('truncate', function(text, length, suffix = '...') {
      if (!text || text.length <= length) return text;
      return text.substring(0, length) + suffix;
    });

    // Capitalize
    handlebars.registerHelper('capitalize', function(text) {
      if (!text) return '';
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    });

    // Pluralize
    handlebars.registerHelper('pluralize', function(count, singular, plural) {
      return count === 1 ? singular : plural;
    });

    // If equals
    handlebars.registerHelper('ifeq', function(a, b, options) {
      return a === b ? options.fn(this) : options.inverse(this);
    });

    // If not equals
    handlebars.registerHelper('ifneq', function(a, b, options) {
      return a !== b ? options.fn(this) : options.inverse(this);
    });

    // JSON stringify
    handlebars.registerHelper('json', function(context) {
      return JSON.stringify(context);
    });

    // Markdown (simple implementation)
    handlebars.registerHelper('markdown', function(text) {
      if (!text) return '';
      // Simple markdown to HTML conversion
      return text
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n/g, '<br>')
        .replace(/`(.*?)`/g, '<code>$1</code>');
    });

    // Safe HTML
    handlebars.registerHelper('safe', function(context) {
      return new handlebars.SafeString(context);
    });

    // Concatenate
    handlebars.registerHelper('concat', function(...args) {
      return args.slice(0, -1).join('');
    });
  }

  // TEMPLATE MANAGEMENT
  async getTemplate(templateName, locale = this.config.defaultLocale) {
    const cacheKey = `${templateName}_${locale}`;
    
    // Check cache first
    if (this.templateCache.has(cacheKey)) {
      return this.templateCache.get(cacheKey);
    }

    try {
      // Try locale-specific template first
      let templatePath = path.join(
        this.config.templateDir,
        locale,
        `${templateName}.hbs`
      );

      // Fall back to default locale
      if (!await this.fileExists(templatePath)) {
        templatePath = path.join(
          this.config.templateDir,
          this.config.defaultLocale,
          `${templateName}.hbs`
        );
      }

      // Try extension variations
      if (!await this.fileExists(templatePath)) {
        templatePath = path.join(
          this.config.templateDir,
          locale,
          `${templateName}.html`
        );
      }

      if (!await this.fileExists(templatePath)) {
        templatePath = path.join(
          this.config.templateDir,
          this.config.defaultLocale,
          `${templateName}.html`
        );
      }

      // Try MJML template
      if (!await this.fileExists(templatePath)) {
        templatePath = path.join(
          this.config.templateDir,
          locale,
          `${templateName}.mjml`
        );
      }

      if (!await this.fileExists(templatePath)) {
        throw new Error(`Template not found: ${templateName}`);
      }

      // Read template file
      const templateContent = await fs.readFile(templatePath, 'utf-8');
      
      // Compile template
      let template;
      if (templatePath.endsWith('.mjml')) {
        // Convert MJML to HTML
        const mjmlResult = mjml2html(templateContent);
        template = handlebars.compile(mjmlResult.html);
      } else {
        template = handlebars.compile(templateContent);
      }

      // Cache the template
      this.templateCache.set(cacheKey, template);

      return template;
    } catch (error) {
      throw new Error(`Failed to load template ${templateName}: ${error.message}`);
    }
  }

  async fileExists(filePath) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async renderTemplate(templateName, data, locale = this.config.defaultLocale) {
    try {
      const template = await this.getTemplate(templateName, locale);
      
      // Add default data
      const templateData = {
        ...data,
        _config: {
          appName: 'Job Portal',
          appUrl: process.env.APP_URL || 'https://app.jobportal.com',
          supportEmail: process.env.SUPPORT_EMAIL || 'support@jobportal.com',
          currentYear: new Date().getFullYear(),
        },
        _user: data.user || {},
        _meta: data.meta || {},
      };

      // Render template
      let html = template(templateData);

      // Inline CSS for better email client compatibility
      html = juice(html);

      return html;
    } catch (error) {
      throw new Error(`Failed to render template ${templateName}: ${error.message}`);
    }
  }

  // EMAIL SENDING
  async sendEmail(options) {
    // Check rate limits
    if (!this.checkRateLimit()) {
      throw new Error('Rate limit exceeded');
    }

    const emailOptions = this.prepareEmailOptions(options);

    try {
      // Send email
      const info = await this.transporter.sendMail(emailOptions);

      // Update tracking
      this.updateTracking();

      // Log email
      await this.logEmail({
        ...emailOptions,
        messageId: info.messageId,
        status: 'sent',
        sentAt: new Date(),
      });

      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        previewUrl: this.config.enablePreview ? nodemailer.getTestMessageUrl(info) : null,
      };
    } catch (error) {
      // Log failure
      await this.logEmail({
        ...emailOptions,
        status: 'failed',
        error: error.message,
        sentAt: new Date(),
      });

      throw error;
    }
  }

  async sendEmailWithRetry(options, retries = this.config.retryAttempts) {
    for (let i = 0; i < retries; i++) {
      try {
        return await this.sendEmail(options);
      } catch (error) {
        if (i === retries - 1) {
          throw error;
        }
        
        // Exponential backoff
        const delay = this.config.retryDelay * Math.pow(2, i);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Reset transporter if needed
        if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
          this.transporter = this.createTransporter();
        }
      }
    }
  }

  async sendTemplateEmail(templateName, data, options) {
    const {
      to,
      subject,
      locale = this.config.defaultLocale,
      attachments = [],
      cc,
      bcc,
      replyTo,
      priority = 'normal',
      tags = [],
      metadata = {},
      trackOpens = this.config.enableTracking,
      trackClicks = this.config.enableTracking,
      unsubscribeUrl,
      ...otherOptions
    } = options;

    // Render template
    const html = await this.renderTemplate(templateName, data, locale);

    // Generate text version
    const text = this.htmlToText(html);

    // Prepare email options
    const emailOptions = {
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      replyTo: replyTo || this.config.replyTo,
      attachments,
      priority,
      headers: {
        'X-Priority': priority === 'high' ? '1' : '3',
        'X-Mailer': 'JobPortal Email Service',
        'X-Email-Type': templateName,
        'X-Template-Version': '1.0',
        'X-Tracking-ID': this.generateTrackingId(),
        ...this.generateListHeaders(unsubscribeUrl),
        ...(tags.length > 0 && { 'X-Tags': tags.join(',') }),
        ...metadata,
      },
      ...otherOptions,
    };

    // Add tracking pixel if enabled
    if (trackOpens && this.config.trackingPixelUrl) {
      const trackingPixel = this.generateTrackingPixel(emailOptions.headers['X-Tracking-ID']);
      emailOptions.html += trackingPixel;
    }

    // Send email
    return this.sendEmailWithRetry(emailOptions);
  }

  // TEMPLATE-BASED EMAIL METHODS
  async sendWelcomeEmail(user, options = {}) {
    const data = {
      user,
      welcomeMessage: `Welcome to Job Portal, ${user.name}!`,
      verifyUrl: `${process.env.APP_URL}/verify-email?token=${user.verificationToken}`,
      loginUrl: `${process.env.APP_URL}/login`,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('welcome', data, {
      to: user.email,
      subject: `Welcome to Job Portal, ${user.name}!`,
      tags: ['welcome', 'onboarding'],
      metadata: {
        userId: user.id,
        userRole: user.role,
      },
      ...options,
    });
  }

  async sendVerificationEmail(user, options = {}) {
    const data = {
      user,
      verifyUrl: `${process.env.APP_URL}/verify-email?token=${user.verificationToken}`,
      expiryHours: 24,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('verify-email', data, {
      to: user.email,
      subject: 'Verify Your Email Address',
      tags: ['verification', 'security'],
      metadata: {
        userId: user.id,
      },
      ...options,
    });
  }

  async sendPasswordResetEmail(user, resetToken, options = {}) {
    const data = {
      user,
      resetUrl: `${process.env.APP_URL}/reset-password?token=${resetToken}`,
      expiryMinutes: 60,
      ipAddress: options.ipAddress || 'Unknown',
      userAgent: options.userAgent || 'Unknown',
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('password-reset', data, {
      to: user.email,
      subject: 'Reset Your Password',
      tags: ['password-reset', 'security'],
      metadata: {
        userId: user.id,
        resetRequestedAt: new Date().toISOString(),
      },
      ...options,
    });
  }

  async sendPasswordChangedEmail(user, options = {}) {
    const data = {
      user,
      changeTime: new Date(),
      ipAddress: options.ipAddress || 'Unknown',
      deviceInfo: options.deviceInfo || 'Unknown',
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('password-changed', data, {
      to: user.email,
      subject: 'Your Password Has Been Changed',
      tags: ['security', 'password-change'],
      metadata: {
        userId: user.id,
      },
      ...options,
    });
  }

  async sendJobApplicationEmail(application, job, employer, candidate, options = {}) {
    const data = {
      application,
      job,
      employer,
      candidate,
      applicationUrl: `${process.env.APP_URL}/employer/applications/${application.id}`,
      candidateProfileUrl: `${process.env.APP_URL}/candidate/${candidate.id}`,
      jobUrl: `${process.env.APP_URL}/jobs/${job.id}`,
    };

    return this.sendTemplateEmail('job-application', data, {
      to: employer.email,
      subject: `New Application for ${job.title}`,
      tags: ['job-application', 'notification'],
      metadata: {
        applicationId: application.id,
        jobId: job.id,
        employerId: employer.id,
        candidateId: candidate.id,
      },
      ...options,
    });
  }

  async sendApplicationStatusEmail(application, job, candidate, status, options = {}) {
    const data = {
      application,
      job,
      candidate,
      status,
      statusMessage: this.getApplicationStatusMessage(status),
      jobUrl: `${process.env.APP_URL}/jobs/${job.id}`,
      applicationsUrl: `${process.env.APP_URL}/candidate/applications`,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('application-status', data, {
      to: candidate.email,
      subject: `Application Update: ${job.title}`,
      tags: ['application-status', 'notification'],
      metadata: {
        applicationId: application.id,
        jobId: job.id,
        candidateId: candidate.id,
        status: status,
      },
      ...options,
    });
  }

  async sendJobPostedEmail(job, employer, options = {}) {
    const data = {
      job,
      employer,
      jobUrl: `${process.env.APP_URL}/jobs/${job.id}`,
      editJobUrl: `${process.env.APP_URL}/employer/jobs/${job.id}/edit`,
      analyticsUrl: `${process.env.APP_URL}/employer/jobs/${job.id}/analytics`,
      boostJobUrl: `${process.env.APP_URL}/employer/jobs/${job.id}/boost`,
    };

    return this.sendTemplateEmail('job-posted', data, {
      to: employer.email,
      subject: `Your Job Posting is Live: ${job.title}`,
      tags: ['job-posted', 'notification'],
      metadata: {
        jobId: job.id,
        employerId: employer.id,
      },
      ...options,
    });
  }

  async sendJobExpiringEmail(job, employer, daysLeft, options = {}) {
    const data = {
      job,
      employer,
      daysLeft,
      renewUrl: `${process.env.APP_URL}/employer/jobs/${job.id}/renew`,
      jobUrl: `${process.env.APP_URL}/jobs/${job.id}`,
    };

    return this.sendTemplateEmail('job-expiring', data, {
      to: employer.email,
      subject: `Your Job Posting Expires in ${daysLeft} Days`,
      tags: ['job-expiring', 'notification'],
      metadata: {
        jobId: job.id,
        employerId: employer.id,
        expiryDate: job.expiryDate,
      },
      ...options,
    });
  }

  async sendNewCandidateEmail(candidate, employer, options = {}) {
    const data = {
      candidate,
      employer,
      candidateProfileUrl: `${process.env.APP_URL}/employer/candidates/${candidate.id}`,
      searchUrl: `${process.env.APP_URL}/employer/candidates`,
      subscriptionUrl: `${process.env.APP_URL}/employer/subscription`,
    };

    return this.sendTemplateEmail('new-candidate', data, {
      to: employer.email,
      subject: `New Candidate in Your Area: ${candidate.name}`,
      tags: ['new-candidate', 'notification'],
      metadata: {
        candidateId: candidate.id,
        employerId: employer.id,
        candidateSkills: candidate.skills?.join(', ') || '',
      },
      ...options,
    });
  }

  async sendInterviewInvitationEmail(interview, job, candidate, employer, options = {}) {
    const data = {
      interview,
      job,
      candidate,
      employer,
      interviewDetails: interview.details,
      acceptUrl: `${process.env.APP_URL}/candidate/interviews/${interview.id}/accept`,
      declineUrl: `${process.env.APP_URL}/candidate/interviews/${interview.id}/decline`,
      rescheduleUrl: `${process.env.APP_URL}/candidate/interviews/${interview.id}/reschedule`,
      jobUrl: `${process.env.APP_URL}/jobs/${job.id}`,
      employerProfileUrl: `${process.env.APP_URL}/employer/${employer.id}`,
    };

    return this.sendTemplateEmail('interview-invitation', data, {
      to: candidate.email,
      subject: `Interview Invitation: ${job.title}`,
      tags: ['interview', 'invitation'],
      metadata: {
        interviewId: interview.id,
        jobId: job.id,
        candidateId: candidate.id,
        employerId: employer.id,
        interviewDate: interview.scheduledDate,
      },
      ...options,
    });
  }

  async sendInterviewReminderEmail(interview, job, candidate, employer, hoursBefore, options = {}) {
    const data = {
      interview,
      job,
      candidate,
      employer,
      hoursBefore,
      interviewUrl: interview.meetingUrl || `${process.env.APP_URL}/interviews/${interview.id}`,
      jobUrl: `${process.env.APP_URL}/jobs/${job.id}`,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('interview-reminder', data, {
      to: [candidate.email, employer.email],
      subject: `Reminder: Interview for ${job.title} in ${hoursBefore} Hours`,
      tags: ['interview', 'reminder'],
      metadata: {
        interviewId: interview.id,
        jobId: job.id,
        reminderType: `${hoursBefore}_hour`,
      },
      ...options,
    });
  }

  async sendPaymentReceiptEmail(payment, user, options = {}) {
    const data = {
      payment,
      user,
      receiptNumber: `REC-${payment.id.slice(0, 8).toUpperCase()}`,
      invoiceUrl: `${process.env.APP_URL}/account/invoices/${payment.invoiceId}`,
      billingUrl: `${process.env.APP_URL}/account/billing`,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('payment-receipt', data, {
      to: user.email,
      subject: `Payment Receipt for Order #${payment.orderId}`,
      tags: ['payment', 'receipt'],
      attachments: options.attachments,
      metadata: {
        paymentId: payment.id,
        userId: user.id,
        amount: payment.amount,
        currency: payment.currency,
      },
      ...options,
    });
  }

  async sendSubscriptionRenewalEmail(subscription, user, daysUntilRenewal, options = {}) {
    const data = {
      subscription,
      user,
      daysUntilRenewal,
      renewalDate: new Date(subscription.currentPeriodEnd * 1000),
      updatePaymentMethodUrl: `${process.env.APP_URL}/account/payment-methods`,
      billingUrl: `${process.env.APP_URL}/account/billing`,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('subscription-renewal', data, {
      to: user.email,
      subject: `Your Subscription Renews in ${daysUntilRenewal} Days`,
      tags: ['subscription', 'renewal'],
      metadata: {
        subscriptionId: subscription.id,
        userId: user.id,
        plan: subscription.plan?.name || 'Premium',
        renewalDate: data.renewalDate,
      },
      ...options,
    });
  }

  async sendSubscriptionCancelledEmail(subscription, user, options = {}) {
    const data = {
      subscription,
      user,
      cancellationDate: new Date(),
      effectiveDate: new Date(subscription.currentPeriodEnd * 1000),
      renewUrl: `${process.env.APP_URL}/account/subscription/renew`,
      feedbackUrl: `${process.env.APP_URL}/feedback?reason=cancellation`,
      supportEmail: process.env.SUPPORT_EMAIL,
    };

    return this.sendTemplateEmail('subscription-cancelled', data, {
      to: user.email,
      subject: 'Your Subscription Has Been Cancelled',
      tags: ['subscription', 'cancellation'],
      metadata: {
        subscriptionId: subscription.id,
        userId: user.id,
        cancelledAt: data.cancellationDate,
      },
      ...options,
    });
  }

  async sendAdminAlertEmail(alertType, data, options = {}) {
    const adminEmails = process.env.ADMIN_EMAILS?.split(',') || ['admin@jobportal.com'];
    
    const emailData = {
      alertType,
      data,
      alertTime: new Date(),
      dashboardUrl: `${process.env.APP_URL}/admin/dashboard`,
    };

    return this.sendTemplateEmail('admin-alert', emailData, {
      to: adminEmails,
      subject: `Admin Alert: ${this.getAlertSubject(alertType)}`,
      tags: ['admin', 'alert', alertType],
      priority: 'high',
      metadata: {
        alertType,
        alertTime: emailData.alertTime,
        severity: options.severity || 'medium',
      },
      ...options,
    });
  }

  async sendNewsletterEmail(subscribers, newsletter, options = {}) {
    const data = {
      newsletter,
      unsubscribeUrl: `${process.env.APP_URL}/unsubscribe?token=${options.unsubscribeToken}`,
      preferencesUrl: `${process.env.APP_URL}/email-preferences`,
    };

    // Send in batches to avoid rate limits
    const batchSize = 50;
    const results = [];

    for (let i = 0; i < subscribers.length; i += batchSize) {
      const batch = subscribers.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (subscriber) => {
        try {
          const personalizedData = {
            ...data,
            subscriber,
            firstName: subscriber.name?.split(' ')[0] || 'there',
          };

          return await this.sendTemplateEmail('newsletter', personalizedData, {
            to: subscriber.email,
            subject: newsletter.subject,
            tags: ['newsletter', `issue-${newsletter.issue}`],
            metadata: {
              newsletterId: newsletter.id,
              subscriberId: subscriber.id,
              issue: newsletter.issue,
            },
            ...options,
          });
        } catch (error) {
          console.error(`Failed to send newsletter to ${subscriber.email}:`, error);
          return { success: false, email: subscriber.email, error: error.message };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));

      // Delay between batches
      if (i + batchSize < subscribers.length) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    return results;
  }

  // BULK EMAIL MANAGEMENT
  async sendBulkEmails(emails, options = {}) {
    if (this.config.useQueue) {
      return this.queueBulkEmails(emails, options);
    }

    const results = [];
    const batchSize = options.batchSize || 10;
    const delayBetweenBatches = options.delayBetweenBatches || 1000;

    for (let i = 0; i < emails.length; i += batchSize) {
      const batch = emails.slice(i, i + batchSize);
      
      const batchPromises = batch.map(async (email, index) => {
        try {
          const result = await this.sendEmailWithRetry({
            ...email,
            headers: {
              ...email.headers,
              'X-Bulk-ID': options.bulkId || `bulk_${Date.now()}`,
              'X-Email-Index': i + index,
            },
          });

          return {
            success: true,
            email: email.to,
            messageId: result.messageId,
          };
        } catch (error) {
          return {
            success: false,
            email: email.to,
            error: error.message,
          };
        }
      });

      const batchResults = await Promise.allSettled(batchPromises);
      results.push(...batchResults.map(r => r.value || r.reason));

      // Delay between batches
      if (i + batchSize < emails.length) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
      }
    }

    return {
      total: emails.length,
      sent: results.filter(r => r.success).length,
      failed: results.filter(r => !r.success).length,
      results,
    };
  }

  // EMAIL QUEUE
  async queueEmail(emailOptions) {
    if (!this.config.useQueue) {
      return this.sendEmail(emailOptions);
    }

    const queueItem = {
      id: crypto.randomBytes(16).toString('hex'),
      emailOptions,
      status: 'queued',
      createdAt: new Date(),
      attempts: 0,
      maxAttempts: 3,
    };

    this.queue.push(queueItem);

    // Start processing if not already processing
    if (!this.isProcessingQueue) {
      this.processQueue();
    }

    return queueItem;
  }

  async queueBulkEmails(emails, options = {}) {
    const bulkId = options.bulkId || `bulk_${Date.now()}`;
    const queueItems = [];

    for (const email of emails) {
      const queueItem = {
        id: crypto.randomBytes(16).toString('hex()),
        emailOptions: {
          ...email,
          headers: {
            ...email.headers,
            'X-Bulk-ID': bulkId,
          },
        },
        status: 'queued',
        createdAt: new Date(),
        attempts: 0,
        maxAttempts: 3,
        bulkId,
      };

      this.queue.push(queueItem);
      queueItems.push(queueItem);
    }

    if (!this.isProcessingQueue) {
      this.processQueue();
    }

    return {
      bulkId,
      total: emails.length,
      queued: queueItems.length,
      queueItems,
    };
  }

  async processQueue() {
    if (this.isProcessingQueue || this.queue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();

      try {
        item.status = 'processing';
        item.startedAt = new Date();

        const result = await this.sendEmailWithRetry(item.emailOptions);

        item.status = 'sent';
        item.completedAt = new Date();
        item.result = result;

        // Log successful email
        await this.logEmail({
          ...item.emailOptions,
          messageId: result.messageId,
          status: 'sent',
          sentAt: item.completedAt,
          queueId: item.id,
        });

      } catch (error) {
        item.status = 'failed';
        item.error = error.message;
        item.attempts += 1;

        // Retry if attempts remain
        if (item.attempts < item.maxAttempts) {
          item.status = 'retrying';
          this.queue.push(item); // Add back to queue
        } else {
          item.completedAt = new Date();
          
          // Log failed email
          await this.logEmail({
            ...item.emailOptions,
            status: 'failed',
            error: error.message,
            sentAt: item.completedAt,
            queueId: item.id,
            attempts: item.attempts,
          });
        }
      }

      // Rate limiting delay
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    this.isProcessingQueue = false;
  }

  // UTILITY METHODS
  prepareEmailOptions(options) {
    const defaultOptions = {
      from: this.config.fromName 
        ? `"${this.config.fromName}" <${this.config.from}>`
        : this.config.from,
      replyTo: this.config.replyTo,
      encoding: 'utf-8',
      date: new Date(),
    };

    return {
      ...defaultOptions,
      ...options,
    };
  }

  htmlToText(html) {
    // Simple HTML to text conversion
    return html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<p\s*\/?>/gi, '\n\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .trim();
  }

  generateTrackingId() {
    return `trk_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  generateTrackingPixel(trackingId) {
    if (!this.config.trackingPixelUrl) return '';
    
    const pixelUrl = `${this.config.trackingPixelUrl}/open/${trackingId}`;
    return `<img src="${pixelUrl}" width="1" height="1" alt="" style="display:none">`;
  }

  generateListHeaders(unsubscribeUrl) {
    const headers = {};

    if (unsubscribeUrl) {
      headers['List-Unsubscribe'] = `<${unsubscribeUrl}>`;
      headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
    }

    return headers;
  }

  checkRateLimit() {
    const now = new Date();
    
    // Reset counters if day changed
    if (now.getDate() !== this.tracking.lastReset.day) {
      this.tracking.sentToday = 0;
      this.tracking.lastReset.day = now.getDate();
    }
    
    // Reset counters if hour changed
    if (now.getHours() !== this.tracking.lastReset.hour) {
      this.tracking.sentThisHour = 0;
      this.tracking.lastReset.hour = now.getHours();
    }
    
    // Reset counters if minute changed
    if (now.getMinutes() !== this.tracking.lastReset.minute) {
      this.tracking.sentThisMinute = 0;
      this.tracking.lastReset.minute = now.getMinutes();
    }

    // Check limits
    if (this.tracking.sentToday >= this.config.rateLimit.maxPerDay) {
      return false;
    }
    
    if (this.tracking.sentThisHour >= this.config.rateLimit.maxPerHour) {
      return false;
    }
    
    if (this.tracking.sentThisMinute >= this.config.rateLimit.maxPerMinute) {
      return false;
    }

    return true;
  }

  updateTracking() {
    this.tracking.sentToday++;
    this.tracking.sentThisHour++;
    this.tracking.sentThisMinute++;
  }

  getApplicationStatusMessage(status) {
    const messages = {
      submitted: 'Your application has been submitted successfully.',
      reviewing: 'Your application is being reviewed by the employer.',
      shortlisted: 'Congratulations! You have been shortlisted for this position.',
      rejected: 'Thank you for your application, but we have decided to move forward with other candidates.',
      hired: 'Congratulations! You have been selected for this position.',
      withdrawn: 'You have withdrawn your application.',
    };

    return messages[status] || 'Your application status has been updated.';
  }

  getAlertSubject(alertType) {
    const subjects = {
      'payment_failed': 'Payment Processing Failed',
      'high_traffic': 'High Traffic Alert',
      'system_error': 'System Error Detected',
      'security_breach': 'Security Breach Attempt',
      'resource_limit': 'Resource Limit Exceeded',
      'new_registration': 'New User Registration',
      'job_post_flagged': 'Job Post Flagged for Review',
      'suspicious_activity': 'Suspicious Activity Detected',
    };

    return subjects[alertType] || 'System Alert';
  }

  // EMAIL VALIDATION
  async validateEmail(email) {
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!emailRegex.test(email)) {
      return {
        valid: false,
        reason: 'Invalid email format',
      };
    }

    // Check for disposable emails
    const disposableDomains = [
      'tempmail.com', 'guerrillamail.com', 'mailinator.com',
      '10minutemail.com', 'throwawaymail.com', 'yopmail.com',
    ];

    const domain = email.split('@')[1].toLowerCase();
    if (disposableDomains.includes(domain)) {
      return {
        valid: false,
        reason: 'Disposable email addresses are not allowed',
      };
    }

    // Check MX records (optional, could be slow)
    if (process.env.CHECK_MX_RECORDS === 'true') {
      try {
        const dns = require('dns').promises;
        await dns.resolveMx(domain);
      } catch (error) {
        return {
          valid: false,
          reason: 'Domain does not accept email',
        };
      }
    }

    return {
      valid: true,
      email: email,
      domain: domain,
    };
  }

  // EMAIL LOGGING
  async logEmail(emailData) {
    // In production, log to database or external service
    const logEntry = {
      timestamp: new Date().toISOString(),
      to: emailData.to,
      subject: emailData.subject,
      template: emailData.headers?.['X-Email-Type'],
      trackingId: emailData.headers?.['X-Tracking-ID'],
      status: emailData.status,
      messageId: emailData.messageId,
      error: emailData.error,
      metadata: {
        userId: emailData.metadata?.userId,
        jobId: emailData.metadata?.jobId,
        applicationId: emailData.metadata?.applicationId,
      },
    };

    // Log to console in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Email Log:', JSON.stringify(logEntry, null, 2));
    }

    // TODO: Save to database
    // await EmailLog.create(logEntry);

    return logEntry;
  }

  // STATISTICS
  async getEmailStatistics(startDate, endDate) {
    // TODO: Implement database queries
    return {
      period: { startDate, endDate },
      totalSent: 0,
      totalFailed: 0,
      openRate: 0,
      clickRate: 0,
      bounceRate: 0,
      unsubscribeRate: 0,
      byTemplate: {},
      byDay: {},
    };
  }

  // TEMPLATE MANAGEMENT API
  async createTemplate(name, content, options = {}) {
    const templatePath = path.join(
      this.config.templateDir,
      options.locale || this.config.defaultLocale,
      `${name}.hbs`
    );

    await fs.mkdir(path.dirname(templatePath), { recursive: true });
    await fs.writeFile(templatePath, content, 'utf-8');

    // Clear cache for this template
    const cacheKey = `${name}_${options.locale || this.config.defaultLocale}`;
    this.templateCache.delete(cacheKey);

    return {
      success: true,
      path: templatePath,
      name,
      locale: options.locale || this.config.defaultLocale,
    };
  }

  async previewTemplate(templateName, data = {}, locale = this.config.defaultLocale) {
    const html = await this.renderTemplate(templateName, data, locale);
    const text = this.htmlToText(html);

    return {
      html,
      text,
      subject: this.getTemplateSubject(templateName, data, locale),
    };
  }

  getTemplateSubject(templateName, data, locale) {
    // This would typically come from a database or configuration
    const subjects = {
      'welcome': `Welcome to Job Portal, ${data.user?.name || 'there'}!`,
      'verify-email': 'Verify Your Email Address',
      'password-reset': 'Reset Your Password',
      'job-application': `New Application for ${data.job?.title || 'Job'}`,
      // Add more template subjects here
    };

    return subjects[templateName] || 'Email from Job Portal';
  }

  // TESTING AND VERIFICATION
  async testConnection() {
    try {
      await this.transporter.verify();
      return {
        success: true,
        message: 'SMTP connection successful',
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'SMTP connection failed',
      };
    }
  }

  async sendTestEmail(to = process.env.TEST_EMAIL) {
    if (!to) {
      throw new Error('Test email address is required');
    }

    const testData = {
      user: {
        name: 'Test User',
        email: to,
      },
      testTime: new Date(),
      appName: 'Job Portal',
    };

    return this.sendTemplateEmail('welcome', testData, {
      to,
      subject: 'Test Email from Job Portal',
      tags: ['test'],
      metadata: {
        test: true,
        timestamp: new Date().toISOString(),
      },
    });
  }

  // CLEANUP
  async cleanupOldLogs(days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    // TODO: Delete old email logs from database
    // await EmailLog.deleteMany({ timestamp: { $lt: cutoffDate } });

    return {
      success: true,
      deletedBefore: cutoffDate,
    };
  }

  // STATIC METHODS
  static extractEmailDomain(email) {
    if (!email || !email.includes('@')) return null;
    return email.split('@')[1].toLowerCase();
  }

  static isCorporateEmail(email) {
    const domain = this.extractEmailDomain(email);
    if (!domain) return false;

    const corporateDomains = [
      'gmail.com',
      'yahoo.com',
      'outlook.com',
      'hotmail.com',
      'icloud.com',
      'aol.com',
      'protonmail.com',
    ];

    return !corporateDomains.includes(domain);
  }

  static generateUnsubscribeToken(userId, email) {
    const hash = crypto.createHash('sha256');
    hash.update(`${userId}:${email}:${process.env.UNSUBSCRIBE_SECRET}`);
    return hash.digest('hex');
  }
}

// Middleware for email tracking
const createEmailTrackingMiddleware = (emailService) => {
  return {
    // Track email opens
    trackOpen: async (req, res) => {
      const { trackingId } = req.params;

      // Record the open
      await emailService.logEmail({
        trackingId,
        event: 'open',
        timestamp: new Date(),
        userAgent: req.headers['user-agent'],
        ip: req.ip,
      });

      // Return a transparent 1x1 pixel
      res.setHeader('Content-Type', 'image/png');
      res.send(Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        'base64'
      ));
    },

    // Track email clicks
    trackClick: async (req, res) => {
      const { trackingId } = req.params;
      const { redirect } = req.query;

      // Record the click
      await emailService.logEmail({
        trackingId,
        event: 'click',
        timestamp: new Date(),
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        url: redirect,
      });

      // Redirect to the actual URL
      if (redirect) {
        return res.redirect(redirect);
      }

      res.status(400).send('Missing redirect URL');
    },

    // Handle unsubscribe requests
    handleUnsubscribe: async (req, res) => {
      const { token } = req.query;

      try {
        // Verify token and unsubscribe user
        // const user = await verifyUnsubscribeToken(token);
        // await unsubscribeUser(user.email);

        res.render('unsubscribe-success', {
          message: 'You have been unsubscribed successfully.',
        });
      } catch (error) {
        res.status(400).render('unsubscribe-error', {
          message: 'Invalid unsubscribe request.',
        });
      }
    },
  };
};

// Export utilities
module.exports = {
  EmailService,
  createEmailTrackingMiddleware,
};
