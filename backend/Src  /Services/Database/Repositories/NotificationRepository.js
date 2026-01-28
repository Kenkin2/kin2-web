  async markAllAsRead(userId) {
    const updated = await this.prisma.notification.updateMany({
      where: { 
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });

    // Clear cache
    await this.clearNotificationCaches(userId);

    // Notify via WebSocket
    this.websocketService.sendToUser(userId, {
      type: 'NOTIFICATIONS_READ',
      data: { count: updated.count },
    });

    return updated;
  }

  async deleteNotification(notificationId, userId) {
    const notification = await this.prisma.notification.findFirst({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error('Notification not found or access denied');
    }

    await this.prisma.notification.delete({
      where: { id: notificationId },
    });

    // Clear cache
    await this.clearNotificationCaches(userId);

    return { success: true };
  }

  async deleteOldNotifications(days = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);

    const result = await this.prisma.notification.deleteMany({
      where: {
        createdAt: { lt: cutoffDate },
        read: true,
        metadata: {
          path: ['priority'],
          not: 'HIGH', // Don't delete high priority notifications
        },
      },
    });

    return result;
  }

  // NOTIFICATION TEMPLATES
  async createNotificationTemplate(data) {
    const template = await this.prisma.notificationTemplate.create({
      data: {
        name: data.name,
        type: data.type,
        title: data.title,
        content: data.content,
        variables: data.variables || [],
        channels: data.channels || ['EMAIL', 'IN_APP'],
        metadata: {
          createdBy: data.createdBy,
          createdAt: new Date().toISOString(),
          version: '1.0',
        },
        isActive: true,
      },
    });

    return template;
  }

  async getNotificationTemplate(name, type) {
    const template = await this.prisma.notificationTemplate.findFirst({
      where: {
        name,
        type,
        isActive: true,
      },
    });

    if (!template) {
      // Fallback to default template
      return this.getDefaultTemplate(type);
    }

    return template;
  }

  getDefaultTemplate(type) {
    const defaultTemplates = {
      'NEW_APPLICATION': {
        name: 'default-new-application',
        title: 'New Application Received',
        content: 'You have received a new application for {{jobTitle}} from {{candidateName}}.',
        variables: ['jobTitle', 'candidateName'],
      },
      'INTERVIEW_INVITATION': {
        name: 'default-interview-invitation',
        title: 'Interview Invitation',
        content: 'You have been invited for an interview for {{jobTitle}} scheduled on {{interviewDate}}.',
        variables: ['jobTitle', 'interviewDate'],
      },
      // Add more default templates as needed
    };

    return defaultTemplates[type] || {
      name: 'default-general',
      title: 'Notification',
      content: '{{message}}',
      variables: ['message'],
    };
  }

  async renderNotificationTemplate(template, variables) {
    let content = template.content;
    let title = template.title;

    // Replace variables in content
    template.variables.forEach(variable => {
      const placeholder = `{{${variable}}}`;
      const value = variables[variable] || '';
      content = content.replace(new RegExp(placeholder, 'g'), value);
      title = title.replace(new RegExp(placeholder, 'g'), value);
    });

    return { title, content };
  }

  // SYSTEM NOTIFICATIONS
  async sendApplicationStatusNotification(applicationId, status, metadata = {}) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: {
          select: {
            title: true,
            employer: {
              select: {
                name: true,
              },
            },
          },
        },
        worker: {
          select: {
            userId: true,
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

    if (!application) {
      throw new Error('Application not found');
    }

    const candidateName = `${application.worker.user.firstName} ${application.worker.user.lastName}`;
    const employerName = application.job.employer.name;
    const jobTitle = application.job.title;

    // Send to candidate
    await this.createNotification({
      userId: application.worker.userId,
      type: 'APPLICATION_STATUS_CHANGE',
      title: 'Application Status Update',
      message: `Your application for "${jobTitle}" at ${employerName} has been updated to ${status}.`,
      metadata: {
        ...metadata,
        applicationId,
        jobId: application.jobId,
        status,
        employerName,
        jobTitle,
      },
      priority: 'MEDIUM',
    });

    // Send to employer if status is important
    if (['INTERVIEWING', 'OFFERED', 'HIRED'].includes(status)) {
      const employer = await this.prisma.employer.findUnique({
        where: { id: application.job.employerId },
        select: { userId: true },
      });

      if (employer) {
        await this.createNotification({
          userId: employer.userId,
          type: 'APPLICATION_STATUS_CHANGE',
          title: 'Candidate Application Update',
          message: `Candidate ${candidateName}'s application for "${jobTitle}" is now ${status}.`,
          metadata: {
            ...metadata,
            applicationId,
            candidateName,
            status,
            jobTitle,
          },
          priority: 'LOW',
        });
      }
    }
  }

  async sendInterviewInvitation(interviewId) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        job: {
          select: {
            title: true,
            employer: {
              select: {
                name: true,
              },
            },
          },
        },
        candidate: {
          select: {
            userId: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        employer: {
          select: {
            userId: true,
            user: {
              select: {
                firstName: true,
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    const candidateName = `${interview.candidate.user.firstName} ${interview.candidate.user.lastName}`;
    const employerName = interview.employer.user.firstName;
    const jobTitle = interview.job.title;
    const interviewDate = new Date(interview.scheduledAt).toLocaleString();

    // Send to candidate
    await this.createNotification({
      userId: interview.candidate.userId,
      type: 'INTERVIEW_INVITATION',
      title: 'Interview Invitation',
      message: `You've been invited for an interview for "${jobTitle}" at ${interviewDate}.`,
      metadata: {
        interviewId,
        jobId: interview.jobId,
        jobTitle,
        employerName,
        scheduledAt: interview.scheduledAt,
        type: interview.type,
        duration: interview.duration,
        meetingLink: interview.meetingLink,
      },
      priority: 'HIGH',
    });

    // Send to employer
    await this.createNotification({
      userId: interview.employer.userId,
      type: 'INTERVIEW_INVITATION',
      title: 'Interview Scheduled',
      message: `Interview scheduled with ${candidateName} for "${jobTitle}" at ${interviewDate}.`,
      metadata: {
        interviewId,
        candidateName,
        jobTitle,
        scheduledAt: interview.scheduledAt,
      },
      priority: 'MEDIUM',
    });
  }

  async sendInterviewReminder(interviewId, hoursBefore = 24) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        job: {
          select: { title: true },
        },
        candidate: {
          select: { userId: true },
        },
        employer: {
          select: { userId: true },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    const interviewDate = new Date(interview.scheduledAt);
    const reminderTime = new Date(interviewDate.getTime() - hoursBefore * 60 * 60 * 1000);

    // Schedule reminder for candidate
    await this.createNotification({
      userId: interview.candidate.userId,
      type: 'INTERVIEW_REMINDER',
      title: 'Interview Reminder',
      message: `You have an interview for "${interview.job.title}" tomorrow at ${interviewDate.toLocaleTimeString()}.`,
      metadata: {
        interviewId,
        jobTitle: interview.job.title,
        scheduledAt: interview.scheduledAt,
        meetingLink: interview.meetingLink,
      },
      priority: 'MEDIUM',
      scheduledFor: reminderTime,
    });

    // Schedule reminder for employer
    await this.createNotification({
      userId: interview.employer.userId,
      type: 'INTERVIEW_REMINDER',
      title: 'Interview Reminder',
      message: `You have an interview for "${interview.job.title}" tomorrow at ${interviewDate.toLocaleTimeString()}.`,
      metadata: {
        interviewId,
        candidateId: interview.workerId,
        scheduledAt: interview.scheduledAt,
      },
      priority: 'MEDIUM',
      scheduledFor: reminderTime,
    });
  }

  async sendJobRecommendation(userId, jobId, reason) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      select: {
        title: true,
        employer: {
          select: { name: true },
        },
        location: true,
      },
    });

    if (!job) {
      throw new Error('Job not found');
    }

    await this.createNotification({
      userId,
      type: 'JOB_RECOMMENDATION',
      title: 'Job Recommendation',
      message: `Recommended: "${job.title}" at ${job.employer.name} in ${job.location}. ${reason}`,
      metadata: {
        jobId,
        jobTitle: job.title,
        employerName: job.employer.name,
        location: job.location,
        reason,
      },
      priority: 'LOW',
    });
  }

  async sendSystemAlert(userIds, title, message, metadata = {}) {
    const notifications = userIds.map(userId => ({
      userId,
      type: 'SYSTEM_ALERT',
      title,
      message,
      metadata: {
        ...metadata,
        alertType: metadata.alertType || 'INFO',
      },
      priority: metadata.priority || 'MEDIUM',
      channel: 'ALL',
    }));

    return await this.createBulkNotifications(notifications);
  }

  // NOTIFICATION PREFERENCES
  async updateNotificationPreferences(userId, preferences) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('User not found');
    }

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        notificationPreferences: {
          ...user.notificationPreferences,
          ...preferences,
        },
      },
    });

    // Clear cache
    await this.clearNotificationCaches(userId);

    return updated.notificationPreferences;
  }

  async getNotificationPreferences(userId) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true },
    });

    if (!user) {
      throw new Error('User not found');
    }

    return user.notificationPreferences || this.getDefaultPreferences();
  }

  getDefaultPreferences() {
    return {
      email: true,
      sms: false,
      push: true,
      inApp: true,
      frequency: 'IMMEDIATE',
      quietHours: {
        enabled: false,
        start: '22:00',
        end: '08:00',
      },
      categories: {
        applications: true,
        interviews: true,
        messages: true,
        recommendations: true,
        system: true,
        marketing: false,
      },
    };
  }

  // CACHE MANAGEMENT
  generateNotificationsCacheKey(userId, filters) {
    const filterStr = JSON.stringify(filters);
    return `notifications:${userId}:${Buffer.from(filterStr).toString('base64')}`;
  }

  async clearNotificationCaches(userId) {
    const pattern = `notifications:${userId}:*`;
    const keys = await this.redis.keys(pattern);
    if (keys.length > 0) {
      await this.redis.del(...keys);
    }
  }

  // NOTIFICATION ANALYTICS
  async getNotificationAnalytics(userId, period = '30_DAYS') {
    const cacheKey = `notifications:analytics:${userId}:${period}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const startDate = this.getPeriodStartDate(period);

    const [
      deliveryStats,
      engagementStats,
      preferenceStats,
    ] = await Promise.all([
      this.getDeliveryStats(userId, startDate),
      this.getEngagementStats(userId, startDate),
      this.getPreferenceStats(userId),
    ]);

    const analytics = {
      userId,
      period,
      deliveryStats,
      engagementStats,
      preferenceStats,
      recommendations: this.generateNotificationRecommendations(deliveryStats, engagementStats),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(analytics));

    return analytics;
  }

  async getDeliveryStats(userId, startDate) {
    const stats = await this.prisma.notification.groupBy({
      by: ['type', 'delivered'],
      where: {
        userId,
        createdAt: { gte: startDate },
      },
      _count: { id: true },
    });

    const deliveryRate = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN delivered = true THEN 1 ELSE 0 END) as delivered
      FROM notifications
      WHERE user_id = ${userId}
        AND created_at >= ${startDate}
    `;

    const channelStats = await this.prisma.notification.groupBy({
      by: ['metadata.channel'],
      where: {
        userId,
        createdAt: { gte: startDate },
        delivered: true,
      },
      _count: { id: true },
    });

    return {
      total: parseInt(deliveryRate[0]?.total) || 0,
      delivered: parseInt(deliveryRate[0]?.delivered) || 0,
      deliveryRate: deliveryRate[0]?.total > 0 ? 
        deliveryRate[0].delivered / deliveryRate[0].total : 0,
      byType: stats.reduce((acc, stat) => {
        if (!acc[stat.type]) acc[stat.type] = { total: 0, delivered: 0 };
        acc[stat.type].total += stat._count.id;
        if (stat.delivered) acc[stat.type].delivered += stat._count.id;
        return acc;
      }, {}),
      byChannel: channelStats.reduce((acc, stat) => {
        acc[stat.metadata?.channel || 'UNKNOWN'] = stat._count.id;
        return acc;
      }, {}),
    };
  }

  async getEngagementStats(userId, startDate) {
    const stats = await this.prisma.notification.groupBy({
      by: ['type', 'read'],
      where: {
        userId,
        createdAt: { gte: startDate },
        delivered: true,
      },
      _count: { id: true },
    });

    const readRate = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN read = true THEN 1 ELSE 0 END) as read
      FROM notifications
      WHERE user_id = ${userId}
        AND delivered = true
        AND created_at >= ${startDate}
    `;

    const timeToRead = await this.prisma.$queryRaw`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (read_at - created_at)) / 3600) as avg_hours
      FROM notifications
      WHERE user_id = ${userId}
        AND read = true
        AND read_at IS NOT NULL
        AND created_at >= ${startDate}
    `;

    return {
      total: parseInt(readRate[0]?.total) || 0,
      read: parseInt(readRate[0]?.read) || 0,
      readRate: readRate[0]?.total > 0 ? 
        readRate[0].read / readRate[0].total : 0,
      avgTimeToRead: timeToRead[0]?.avg_hours || 0,
      byType: stats.reduce((acc, stat) => {
        if (!acc[stat.type]) acc[stat.type] = { total: 0, read: 0 };
        acc[stat.type].total += stat._count.id;
        if (stat.read) acc[stat.type].read += stat._count.id;
        return acc;
      }, {}),
    };
  }

  async getPreferenceStats(userId) {
    const preferences = await this.getNotificationPreferences(userId);
    
    const categoryStats = {
      enabled: 0,
      disabled: 0,
      total: Object.keys(preferences.categories || {}).length,
    };

    Object.values(preferences.categories || {}).forEach(value => {
      if (value) categoryStats.enabled++;
      else categoryStats.disabled++;
    });

    return {
      channels: preferences,
      categories: categoryStats,
      quietHours: preferences.quietHours?.enabled || false,
      frequency: preferences.frequency || 'IMMEDIATE',
    };
  }

  generateNotificationRecommendations(deliveryStats, engagementStats) {
    const recommendations = [];

    // Low delivery rate recommendation
    if (deliveryStats.deliveryRate < 0.8) {
      recommendations.push({
        type: 'DELIVERY_OPTIMIZATION',
        priority: 'MEDIUM',
        title: 'Improve Notification Delivery',
        message: `Delivery rate is ${(deliveryStats.deliveryRate * 100).toFixed(1)}%`,
        action: 'Check user notification preferences and contact information',
      });
    }

    // Low engagement recommendation
    if (engagementStats.readRate < 0.5) {
      recommendations.push({
        type: 'ENGAGEMENT_OPTIMIZATION',
        priority: 'MEDIUM',
        title: 'Improve Notification Engagement',
        message: `Read rate is ${(engagementStats.readRate * 100).toFixed(1)}%`,
        action: 'Review notification content and timing',
      });
    }

    return recommendations;
  }

  // HELPER METHODS
  getPeriodStartDate(period) {
    const now = new Date();
    switch (period) {
      case '7_DAYS':
        return new Date(now.setDate(now.getDate() - 7));
      case '30_DAYS':
        return new Date(now.setDate(now.getDate() - 30));
      case '90_DAYS':
        return new Date(now.setDate(now.getDate() - 90));
      default:
        return new Date(now.setDate(now.getDate() - 30));
    }
  }
}

module.exports = NotificationRepository;
