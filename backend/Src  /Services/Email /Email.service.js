const nodemailer = require('nodemailer');
const fs = require('fs').promises;
const path = require('path');

class EmailService {
  constructor() {
    this.transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT),
      secure: process.env.SMTP_PORT === '465',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASSWORD
      }
    });

    this.templates = {};
    this.loadTemplates();
  }

  async loadTemplates() {
    try {
      const templatesDir = path.join(__dirname, '../../templates/email');
      
      // Load HTML templates
      const files = await fs.readdir(templatesDir);
      
      for (const file of files) {
        if (file.endsWith('.html')) {
          const templateName = path.basename(file, '.html');
          const content = await fs.readFile(path.join(templatesDir, file), 'utf8');
          this.templates[templateName] = content;
        }
      }
      
      console.log(`Loaded ${Object.keys(this.templates).length} email templates`);
    } catch (error) {
      console.warn('Could not load email templates:', error.message);
      // Use default templates
      this.templates = this.getDefaultTemplates();
    }
  }

  getDefaultTemplates() {
    return {
      'welcome': `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4361ee; color: white; padding: 20px; text-align: center; }
            .content { background: #f8f9fa; padding: 30px; }
            .footer { background: #343a40; color: white; padding: 20px; text-align: center; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #4361ee; color: white; text-decoration: none; border-radius: 5px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Welcome to Kin2 Workforce Platform!</h1>
            </div>
            <div class="content">
              <h2>Hello {name},</h2>
              <p>Welcome to the Kin2 Workforce Platform! We're excited to have you join our community.</p>
              <p>Your account has been successfully created as a <strong>{role}</strong>.</p>
              <p>To get started, please complete your profile and explore the platform features.</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="{dashboardUrl}" class="button">Go to Dashboard</a>
              </p>
              <p>If you have any questions, feel free to contact our support team.</p>
              <p>Best regards,<br>The Kin2 Team</p>
            </div>
            <div class="footer">
              <p>&copy; 2024 Kin2 Workforce Platform. All rights reserved.</p>
              <p>This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      
      'password-reset': `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #4361ee; color: white; padding: 20px; text-align: center; }
            .content { background: #f8f9fa; padding: 30px; }
            .footer { background: #343a40; color: white; padding: 20px; text-align: center; font-size: 12px; }
            .button { display: inline-block; padding: 12px 24px; background: #4361ee; color: white; text-decoration: none; border-radius: 5px; }
            .warning { background: #fff3cd; border: 1px solid #ffc107; padding: 15px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Reset Your Password</h1>
            </div>
            <div class="content">
              <h2>Hello {name},</h2>
              <p>We received a request to reset your password for your Kin2 Workforce Platform account.</p>
              <p>Click the button below to reset your password:</p>
              <p style="text-align: center; margin: 30px 0;">
                <a href="{resetUrl}" class="button">Reset Password</a>
              </p>
              <p>Or copy and paste this link into your browser:</p>
              <p style="word-break: break-all; color: #4361ee;">{resetUrl}</p>
              <div class="warning">
                <p><strong>Important:</strong> This link will expire in {expiryHours} hour(s).</p>
                <p>If you did not request a password reset, please ignore this email or contact support if you have concerns.</p>
              </div>
              <p>Best regards,<br>The Kin2 Team</p>
            </div>
            <div class="footer">
              <p>&copy; 2024 Kin2 Workforce Platform. All rights reserved.</p>
              <p>This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
      
      'application-submitted': `
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #28a745; color: white; padding: 20px; text-align: center; }
            .content { background: #f8f9fa; padding: 30px; }
            .footer { background: #343a40; color: white; padding: 20px; text-align: center; font-size: 12px; }
            .job-details { background: white; border: 1px solid #dee2e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>Application Submitted Successfully!</h1>
            </div>
            <div class="content">
              <h2>Hello {name},</h2>
              <p>Your application has been successfully submitted for the following position:</p>
              
              <div class="job-details">
                <h3>{jobTitle}</h3>
                <p><strong>Company:</strong> {companyName}</p>
                <p><strong>Location:</strong> {location}</p>
                <p><strong>Applied on:</strong> {appliedDate}</p>
              </div>
              
              <p><strong>What happens next?</strong></p>
              <ol>
                <li>The employer will review your application</li>
                <li>You may be contacted for an interview</li>
                <li>Check your dashboard for updates</li>
              </ol>
              
              <p>You can track the status of your application from your dashboard.</p>
              
              <p>Best regards,<br>The Kin2 Team</p>
            </div>
            <div class="footer">
              <p>&copy; 2024 Kin2 Workforce Platform. All rights reserved.</p>
              <p>This is an automated message, please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `
    };
  }

  async sendEmail(options) {
    try {
      const { to, subject, template, data, attachments } = options;

      // Get template content
      let htmlContent = this.templates[template] || this.templates['default'];
      
      if (!htmlContent) {
        throw new Error(`Template "${template}" not found`);
      }

      // Replace template variables
      htmlContent = this.replaceTemplateVariables(htmlContent, data);

      // Create text version (simplified)
      const textContent = this.createTextVersion(htmlContent);

      const mailOptions = {
        from: process.env.EMAIL_FROM,
        to,
        subject,
        html: htmlContent,
        text: textContent,
        attachments
      };

      const info = await this.transporter.sendMail(mailOptions);
      
      return {
        success: true,
        messageId: info.messageId,
        response: info.response
      };
    } catch (error) {
      console.error('Send email error:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  replaceTemplateVariables(template, data) {
    let result = template;
    
    // Replace {variable} with data
    for (const [key, value] of Object.entries(data)) {
      const regex = new RegExp(`{${key}}`, 'g');
      result = result.replace(regex, value || '');
    }

    // Replace any remaining variables with empty string
    result = result.replace(/{[^}]+}/g, '');

    return result;
  }

  createTextVersion(html) {
    // Simple HTML to text conversion
    return html
      .replace(/<[^>]+>/g, ' ') // Remove HTML tags
      .replace(/\s+/g, ' ')     // Collapse multiple spaces
      .replace(/&nbsp;/g, ' ')  // Replace non-breaking spaces
      .replace(/&amp;/g, '&')   // Replace HTML entities
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  async sendWelcomeEmail(user, role) {
    return this.sendEmail({
      to: user.email,
      subject: 'Welcome to Kin2 Workforce Platform!',
      template: 'welcome',
      data: {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        role: role.toLowerCase(),
        dashboardUrl: `${process.env.FRONTEND_URL}/dashboard`
      }
    });
  }

  async sendPasswordResetEmail(user, resetToken) {
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
    
    return this.sendEmail({
      to: user.email,
      subject: 'Reset Your Password - Kin2 Workforce Platform',
      template: 'password-reset',
      data: {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        resetUrl,
        expiryHours: 1
      }
    });
  }

  async sendApplicationSubmittedEmail(application, user, job, company) {
    return this.sendEmail({
      to: user.email,
      subject: `Application Submitted: ${job.title}`,
      template: 'application-submitted',
      data: {
        name: `${user.profile.firstName} ${user.profile.lastName}`,
        jobTitle: job.title,
        companyName: company.companyName || 'Unknown Company',
        location: job.location,
        appliedDate: new Date(application.appliedAt).toLocaleDateString()
      }
    });
  }

  async sendInterviewInvitationEmail(user, interview, job) {
    // Custom template for interview invitations
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #007bff; color: white; padding: 20px; text-align: center; }
          .content { background: #f8f9fa; padding: 30px; }
          .interview-details { background: white; border: 1px solid #dee2e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Interview Invitation</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.profile.firstName},</h2>
            <p>Congratulations! You have been invited for an interview for the following position:</p>
            
            <div class="interview-details">
              <h3>${job.title}</h3>
              <p><strong>Company:</strong> ${job.employer.employerProfile?.companyName || 'Unknown Company'}</p>
              <p><strong>Interview Type:</strong> ${interview.type}</p>
              <p><strong>Date & Time:</strong> ${new Date(interview.scheduledDate).toLocaleString()}</p>
              <p><strong>Duration:</strong> ${interview.duration} minutes</p>
              ${interview.meetingUrl ? `<p><strong>Meeting Link:</strong> <a href="${interview.meetingUrl}">${interview.meetingUrl}</a></p>` : ''}
              ${interview.location ? `<p><strong>Location:</strong> ${interview.location}</p>` : ''}
            </div>
            
            <p><strong>Preparation Tips:</strong></p>
            <ul>
              <li>Review the job description and your application</li>
              <li>Prepare questions to ask the interviewer</li>
              <li>Test your equipment if it's a video interview</li>
              <li>Join the meeting 5 minutes early</li>
            </ul>
            
            <p>You can view and manage your interviews from your dashboard.</p>
            
            <p>Best regards,<br>The Kin2 Team</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: `Interview Invitation: ${job.title}`,
      html,
      text: this.createTextVersion(html)
    });
  }

  async sendPaymentConfirmationEmail(user, payment, invoice) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #28a745; color: white; padding: 20px; text-align: center; }
          .content { background: #f8f9fa; padding: 30px; }
          .payment-details { background: white; border: 1px solid #dee2e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #28a745; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Payment Confirmation</h1>
          </div>
          <div class="content">
            <h2>Hello ${user.profile.firstName},</h2>
            <p>Your payment has been successfully processed. Here are the details:</p>
            
            <div class="payment-details">
              <h3>Invoice #${invoice.invoiceNumber}</h3>
              <p><strong>Date:</strong> ${new Date(payment.completedAt).toLocaleDateString()}</p>
              <p><strong>Amount:</strong> ${payment.currency} ${payment.amount.toFixed(2)}</p>
              <p><strong>Description:</strong> ${payment.description}</p>
              <p><strong>Status:</strong> ${payment.status}</p>
              <p><strong>Transaction ID:</strong> ${payment.transactionId}</p>
            </div>
            
            <p>You can view and download your invoice from your account dashboard.</p>
            
            <p>Thank you for your payment!</p>
            <p>Best regards,<br>The Kin2 Team</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: `Payment Confirmation - Invoice #${invoice.invoiceNumber}`,
      html,
      text: this.createTextVersion(html)
    });
  }

  async sendWeeklyDigestEmail(user, digestData) {
    const html = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: #6f42c1; color: white; padding: 20px; text-align: center; }
          .content { background: #f8f9fa; padding: 30px; }
          .section { background: white; border: 1px solid #dee2e6; padding: 20px; border-radius: 5px; margin: 20px 0; }
          .stat { display: inline-block; width: 30%; text-align: center; padding: 10px; }
          .stat-value { font-size: 24px; font-weight: bold; color: #6f42c1; }
          .job-item { border-bottom: 1px solid #dee2e6; padding: 10px 0; }
          .button { display: inline-block; padding: 12px 24px; background: #6f42c1; color: white; text-decoration: none; border-radius: 5px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Your Weekly Digest</h1>
            <p>${new Date().toLocaleDateString()}</p>
          </div>
          <div class="content">
            <h2>Hello ${user.profile.firstName},</h2>
            <p>Here's your weekly activity summary on Kin2 Workforce Platform:</p>
            
            <div class="section">
              <h3>📊 Activity Summary</h3>
              <div class="stat">
                <div class="stat-value">${digestData.applications || 0}</div>
                <div>Applications</div>
              </div>
              <div class="stat">
                <div class="stat-value">${digestData.interviews || 0}</div>
                <div>Interviews</div>
              </div>
              <div class="stat">
                <div class="stat-value">${digestData.profileViews || 0}</div>
                <div>Profile Views</div>
              </div>
            </div>
            
            ${digestData.recommendedJobs && digestData.recommendedJobs.length > 0 ? `
            <div class="section">
              <h3>🎯 Recommended Jobs</h3>
              ${digestData.recommendedJobs.slice(0, 3).map(job => `
                <div class="job-item">
                  <h4>${job.title}</h4>
                  <p>${job.company} • ${job.location}</p>
                  <p>Match Score: ${job.matchScore || 'N/A'}</p>
                </div>
              `).join('')}
              <p style="text-align: center; margin-top: 20px;">
                <a href="${process.env.FRONTEND_URL}/jobs" class="button">View All Jobs</a>
              </p>
            </div>
            ` : ''}
            
            ${digestData.upcomingInterviews && digestData.upcomingInterviews.length > 0 ? `
            <div class="section">
              <h3>📅 Upcoming Interviews</h3>
              ${digestData.upcomingInterviews.slice(0, 2).map(interview => `
                <div class="job-item">
                  <h4>${interview.jobTitle}</h4>
                  <p>${new Date(interview.date).toLocaleDateString()} at ${new Date(interview.date).toLocaleTimeString()}</p>
                  <p>Type: ${interview.type}</p>
                </div>
              `).join('')}
            </div>
            ` : ''}
            
            <div class="section">
              <h3>💡 Tips & Updates</h3>
              <p>${digestData.tips || 'Complete your profile to get better job matches!'}</p>
              <p style="text-align: center; margin-top: 20px;">
                <a href="${process.env.FRONTEND_URL}/dashboard" class="button">Go to Dashboard</a>
              </p>
            </div>
            
            <p>Best regards,<br>The Kin2 Team</p>
          </div>
        </div>
      </body>
      </html>
    `;

    return this.sendEmail({
      to: user.email,
      subject: `Your Weekly Digest - ${new Date().toLocaleDateString()}`,
      html,
      text: this.createTextVersion(html)
    });
  }

  async sendSystemAlertEmail(users, alert) {
    const results = [];
    
    for (const user of users) {
      const result = await this.sendEmail({
        to: user.email,
        subject: alert.subject,
        template: 'system-alert',
        data: {
          name: `${user.profile.firstName} ${user.profile.lastName}`,
          message: alert.message,
          date: new Date().toLocaleDateString()
        }
      });
      
      results.push({
        userId: user.id,
        email: user.email,
        success: result.success,
        error: result.error
      });
    }
    
    return results;
  }
}

module.exports = new EmailService();
