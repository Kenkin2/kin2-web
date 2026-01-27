const nodemailer = require('nodemailer');
const { PrismaClient } = require('@prisma/client');
const twilio = require('twilio');

const prisma = new PrismaClient();

class NotificationService {
  constructor() {
    // Email transporter
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });

    // SMS client (Twilio)
    this.twilioClient = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN
      ? twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN)
      : null;
  }

  async sendNotification(options) {
    try {
      const { userId, type, title, message, channels, data = {}, priority = 'NORMAL' } = options;

      // Check user notification preferences
      const preferences = await this.getUserPreferences(userId);
      
      // Filter channels based on preferences
      const allowedChannels = channels.filter(channel => 
        this.isChannelAllowed(channel, type, preferences)
      );

      if (allowedChannels.length === 0) {
        return { success: false, error: 'No allowed channels' };
      }

      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          userId,
          type,
          title,
          message,
          channels: allowedChannels,
          data,
          priority
        }
      });

      // Send through each channel
      const results = await Promise.allSettled(
        allowedChannels.map(channel => 
          this.sendThroughChannel(userId, channel, notification)
        )
      );

      // Update notification with delivery status
      const emailSent = results.some((result, index) => 
        result.status === 'fulfilled' && allowedChannels[index] === 'EMAIL'
      );
      const smsSent = results.some((result, index) => 
        result.status === 'fulfilled' && allowedChannels[index] === 'SMS'
      );

      await prisma.notification.update({
        where: { id: notification.id },
        data: {
          emailSent,
          smsSent,
          inAppSent: true // Always true since we created the record
        }
      });

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      return {
        success: successful > 0,
        notificationId: notification.id,
        channels: allowedChannels,
        delivery: {
          total: allowedChannels.length,
          successful,
          failed
        }
      };
    } catch (error) {
      console.error('Send notification error:', error);
      throw error;
    }
  }

  async sendThroughChannel(userId, channel, notification) {
    switch (channel) {
      case 'EMAIL':
        return this.sendEmail(userId, notification);
      case 'SMS':
        return this.sendSMS(userId, notification);
      case 'PUSH':
        return this.sendPush(userId, notification);
      case 'IN_APP':
        return this.sendInApp(userId, notification);
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  }

  async sendEmail(userId, notification) {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: { profile: true }
      });

      if (!user) {
        throw new Error('User not found');
      }

      const template = this.getEmailTemplate(notification.type);
      const html = this.renderEmailTemplate(template, {
        user: user.profile,
        notification,
        date: new Date().toLocaleDateString()
      });

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to: user.email,
        subject: notification.title,
        html,
        text: notification.message
      };

      await this.transporter.sendMail(mailOptions);
      
      return { success: true, channel: 'EMAIL' };
    } catch (error) {
      console.error('Send email error:', error);
      return { success: false, channel: 'EMAIL', error: error.message };
    }
  }

  async sendSMS(userId, notification) {
    try {
      if (!this.twilioClient) {
        throw new Error('SMS service not configured');
      }

      const user = await prisma.user.findUnique({
        where: { userId },
        include: { profile: true }
      });

      if (!user?.profile?.phone) {
        throw new Error('User phone number not found');
      }

      const message = `${notification.title}: ${notification.message}`.slice(0, 160);

      await this.twilioClient.messages.create({
        body: message,
        from: process.env.TWILIO_PHONE_NUMBER,
        to: user.profile.phone
      });

      return { success: true, channel: 'SMS' };
    } catch (error) {
      console.error('Send SMS error:', error);
      return { success: false, channel: 'SMS', error: error.message };
    }
  }

  async sendPush(userId, notification) {
    try {
      // In a real implementation, you would integrate with Firebase Cloud Messaging or similar
      // For now, return success (implementation would go here)
      return { success: true, channel: 'PUSH' };
    } catch (error) {
      console.error('Send push error:', error);
      return { success: false, channel: 'PUSH', error: error.message };
    }
  }

  async sendInApp(userId, notification) {
    try {
      // In-app notifications are handled by creating the record in the database
      // Additional real-time features could be added here (WebSocket, etc.)
      return { success: true, channel: 'IN_APP' };
    } catch (error) {
      console.error('Send in-app error:', error);
      return { success: false, channel: 'IN_APP', error: error.message };
    }
  }

  async getUserPreferences(userId) {
    const preferences = await prisma.notificationPreference.findUnique({
      where: { userId }
    });

    if (!preferences) {
      // Create default preferences
      return await prisma.notificationPreference.create({
        data: { userId }
      });
    }

    return preferences;
  }

  isChannelAllowed(channel, type, preferences) {
    // Check channel enablement
    switch (channel) {
      case 'EMAIL':
        if (!preferences.emailEnabled) return false;
        break;
      case 'SMS':
        if (!preferences.smsEnabled) return false;
        break;
      case 'PUSH':
        if (!preferences.pushEnabled) return false;
        break;
      case 'IN_APP':
        if (!preferences.inAppEnabled) return false;
        break;
    }

    // Check type preferences
    switch (type) {
      case 'APPLICATION_UPDATE':
        return preferences.applicationUpdates;
      case 'JOB_MATCH':
        return preferences.jobMatches;
      case 'MESSAGE':
        return preferences.messages;
      case 'INTERVIEW_INVITE':
        return preferences.interviewInvites;
      case 'PAYMENT_RECEIVED':
        return preferences.paymentUpdates;
      case 'SYSTEM_ALERT':
        return preferences.systemAlerts;
      default:
        return true;
    }
  }

  getEmailTemplate(type) {
    const templates = {
      APPLICATION_UPDATE: {
        subject: 'Application Status Update',
        template: 'application-update'
      },
      JOB_MATCH: {
        subject: 'New Job Match',
        template: 'job-match'
      },
      MESSAGE: {
        subject: 'New Message',
        template: 'message'
      },
      INTERVIEW_INVITE: {
        subject: 'Interview Invitation',
        template: 'interview-invite'
      },
      PAYMENT_RECEIVED: {
        subject: 'Payment Confirmation',
        template: 'payment-received'
      },
      SYSTEM_ALERT: {
        subject: 'System Notification',
        template: 'system-alert'
      }
    };

    return templates[type] || {
      subject: 'Notification',
      template: 'default'
    };
  }

  renderEmailTemplate(template, data) {
    // Simple template rendering - in production, use a template engine like Handlebars
    const templates = {
      'application-update': `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Application Update</h2>
          <p>Hello ${data.user.firstName},</p>
          <p>${data.notification.message}</p>
          <p>Date: ${data.date}</p>
          <hr>
          <p>Best regards,<br>Kin2 Workforce Platform</p>
        </div>
      `,
      'default': `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>${data.notification.title}</h2>
          <p>Hello ${data.user.firstName},</p>
          <p>${data.notification.message}</p>
          <p>Date: ${data.date}</p>
          <hr>
          <p>Best regards,<br>Kin2 Workforce Platform</p>
        </div>
      `
    };

    return templates[template.template] || templates.default;
  }

  async getTemplates() {
    // Return available notification templates
    return [
      {
        id: 'application-update',
        name: 'Application Update',
        type: 'APPLICATION_UPDATE',
        subject: 'Application Status Update',
        body: 'Your application for {jobTitle} has been updated to {status}.',
        variables: ['jobTitle', 'status']
      },
      {
        id: 'job-match',
        name: 'Job Match',
        type: 'JOB_MATCH',
        subject: 'New Job Match: {jobTitle}',
        body: 'We found a new job that matches your profile: {jobTitle} at {company}.',
        variables: ['jobTitle', 'company', 'location']
      },
      {
        id: 'interview-invite',
        name: 'Interview Invitation',
        type: 'INTERVIEW_INVITE',
        subject: 'Interview Invitation: {jobTitle}',
        body: 'You have been invited for an interview for {jobTitle}. Scheduled for {date} at {time}.',
        variables: ['jobTitle', 'date', 'time', 'location']
      }
    ];
  }

  async createTemplate(template) {
    // Save template to database or configuration
    // This is a simplified implementation
    return {
      ...template,
      id: `template-${Date.now()}`,
      createdAt: new Date().toISOString()
    };
  }

  async bulkSend(options) {
    const { userIds, type, title, message, channels, data } = options;

    const results = await Promise.all(
      userIds.map(async userId => {
        try {
          const result = await this.sendNotification({
            userId,
            type,
            title,
            message,
            channels,
            data
          });

          return {
            userId,
            success: result.success,
            notificationId: result.notificationId
          };
        } catch (error) {
          return {
            userId,
            success: false,
            error: error.message
          };
        }
      })
    );

    return results;
  }
}

module.exports = new NotificationService();
