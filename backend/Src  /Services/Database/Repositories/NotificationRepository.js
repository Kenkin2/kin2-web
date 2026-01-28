const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class NotificationRepository {
  // Create notification
  async createNotification(data) {
    return await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        message: data.message,
        metadata: data.metadata || {},
        read: false,
        channel: data.channel || 'APP',
      },
    });
  }

  // Get user notifications
  async getUserNotifications(userId, options = {}) {
    const { page = 1, limit = 20, unreadOnly = false } = options;
    const skip = (page - 1) * limit;

    const where = { userId };
    if (unreadOnly) {
      where.read = false;
    }

    return await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    });
  }

  // Mark notification as read
  async markAsRead(notificationId) {
    return await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true, readAt: new Date() },
    });
  }

  // Mark all notifications as read for user
  async markAllAsRead(userId) {
    return await prisma.notification.updateMany({
      where: {
        userId,
        read: false,
      },
      data: {
        read: true,
        readAt: new Date(),
      },
    });
  }

  // Get notification count
  async getUnreadCount(userId) {
    return await prisma.notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  // Delete notification
  async deleteNotification(notificationId) {
    return await prisma.notification.delete({
      where: { id: notificationId },
    });
  }

  // Bulk create notifications (for batch operations)
  async createBulkNotifications(notifications) {
    return await prisma.notification.createMany({
      data: notifications.map(notification => ({
        userId: notification.userId,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        metadata: notification.metadata || {},
        channel: notification.channel || 'APP',
        read: false,
      })),
    });
  }

  // Get notification by type and metadata
  async findByTypeAndMetadata(type, metadataKey, metadataValue) {
    return await prisma.notification.findFirst({
      where: {
        type,
        metadata: {
          path: [metadataKey],
          equals: metadataValue,
        },
      },
    });
  }

  // Clean up old notifications (keep only last 6 months)
  async cleanupOldNotifications(months = 6) {
    const cutoffDate = new Date();
    cutoffDate.setMonth(cutoffDate.getMonth() - months);

    return await prisma.notification.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
      },
    });
  }
}

module.exports = new NotificationRepository();
