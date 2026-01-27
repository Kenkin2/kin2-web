const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const { PrismaClient } = require('@prisma/client');
const authMiddleware = require('../middleware/auth.middleware');
const notificationService = require('../services/notification/notification.service');

const prisma = new PrismaClient();

// Get user notifications
router.get('/', authMiddleware.verifyToken, async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20, 
      unreadOnly = false,
      type,
      channel 
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { userId: req.userId };
    
    if (unreadOnly === 'true') {
      where.read = false;
    }
    
    if (type) {
      where.type = type;
    }
    
    if (channel) {
      where.channels = {
        has: channel
      };
    }

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit)
      }),
      prisma.notification.count({ where })
    ]);

    res.json({
      notifications,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Failed to get notifications' });
  }
});

// Get notification count
router.get('/count', authMiddleware.verifyToken, async (req, res) => {
  try {
    const [unreadCount, totalCount] = await Promise.all([
      prisma.notification.count({
        where: { 
          userId: req.userId,
          read: false 
        }
      }),
      prisma.notification.count({
        where: { userId: req.userId }
      })
    ]);

    res.json({
      unread: unreadCount,
      total: totalCount
    });
  } catch (error) {
    console.error('Get notification count error:', error);
    res.status(500).json({ error: 'Failed to get notification count' });
  }
});

// Mark notification as read
router.patch('/:id/read', authMiddleware.verifyToken, async (req, res) => {
  try {
    const notification = await prisma.notification.update({
      where: {
        id: req.params.id,
        userId: req.userId
      },
      data: { 
        read: true, 
        readAt: new Date() 
      }
    });

    if (!notification) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ 
      message: 'Notification marked as read', 
      notification 
    });
  } catch (error) {
    console.error('Mark notification read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Mark all notifications as read
router.post('/read-all', authMiddleware.verifyToken, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { 
        userId: req.userId,
        read: false 
      },
      data: { 
        read: true, 
        readAt: new Date() 
      }
    });

    res.json({ message: 'All notifications marked as read' });
  } catch (error) {
    console.error('Mark all notifications read error:', error);
    res.status(500).json({ error: 'Failed to mark notifications as read' });
  }
});

// Delete notification
router.delete('/:id', authMiddleware.verifyToken, async (req, res) => {
  try {
    await prisma.notification.delete({
      where: {
        id: req.params.id,
        userId: req.userId
      }
    });

    res.json({ message: 'Notification deleted successfully' });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Failed to delete notification' });
  }
});

// Clear all notifications
router.delete('/', authMiddleware.verifyToken, async (req, res) => {
  try {
    await prisma.notification.deleteMany({
      where: { userId: req.userId }
    });

    res.json({ message: 'All notifications cleared' });
  } catch (error) {
    console.error('Clear all notifications error:', error);
    res.status(500).json({ error: 'Failed to clear notifications' });
  }
});

// Get notification preferences
router.get('/preferences', authMiddleware.verifyToken, async (req, res) => {
  try {
    const preferences = await prisma.notificationPreference.findUnique({
      where: { userId: req.userId }
    });

    if (!preferences) {
      // Create default preferences if not exists
      const defaultPreferences = await prisma.notificationPreference.create({
        data: { userId: req.userId }
      });
      return res.json(defaultPreferences);
    }

    res.json(preferences);
  } catch (error) {
    console.error('Get notification preferences error:', error);
    res.status(500).json({ error: 'Failed to get notification preferences' });
  }
});

// Update notification preferences
router.put('/preferences', authMiddleware.verifyToken, [
  body('emailEnabled').optional().isBoolean(),
  body('pushEnabled').optional().isBoolean(),
  body('smsEnabled').optional().isBoolean(),
  body('inAppEnabled').optional().isBoolean(),
  body('applicationUpdates').optional().isBoolean(),
  body('jobMatches').optional().isBoolean(),
  body('messages').optional().isBoolean(),
  body('interviewInvites').optional().isBoolean(),
  body('paymentUpdates').optional().isBoolean(),
  body('systemAlerts').optional().isBoolean(),
  body('marketing').optional().isBoolean(),
  body('quietHoursStart').optional().isInt({ min: 0, max: 23 }),
  body('quietHoursEnd').optional().isInt({ min: 0, max: 23 })
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Create or update preferences
    const preferences = await prisma.notificationPreference.upsert({
      where: { userId: req.userId },
      update: req.body,
      create: {
        userId: req.userId,
        ...req.body
      }
    });

    res.json({ 
      message: 'Notification preferences updated successfully',
      preferences 
    });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Failed to update notification preferences' });
  }
});

// Send test notification
router.post('/test', authMiddleware.verifyToken, [
  body('channel').isIn(['EMAIL', 'PUSH', 'SMS', 'IN_APP']),
  body('type').isIn(['APPLICATION_UPDATE', 'JOB_MATCH', 'MESSAGE', 'INTERVIEW_INVITE', 'PAYMENT_RECEIVED', 'SYSTEM_ALERT']),
  body('message').optional().trim()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { channel, type, message } = req.body;

    const testNotification = await notificationService.sendNotification({
      userId: req.userId,
      type,
      title: 'Test Notification',
      message: message || 'This is a test notification from the system.',
      channels: [channel],
      data: { test: true, timestamp: new Date().toISOString() }
    });

    res.json({
      message: 'Test notification sent successfully',
      notification: testNotification
    });
  } catch (error) {
    console.error('Send test notification error:', error);
    res.status(500).json({ error: 'Failed to send test notification', details: error.message });
  }
});

// Get notification templates
router.get('/templates', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only admins can view templates
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const templates = await notificationService.getTemplates();

    res.json(templates);
  } catch (error) {
    console.error('Get notification templates error:', error);
    res.status(500).json({ error: 'Failed to get notification templates', details: error.message });
  }
});

// Create notification template
router.post('/templates', authMiddleware.verifyToken, [
  body('name').notEmpty().trim(),
  body('type').isIn(['APPLICATION_UPDATE', 'JOB_MATCH', 'MESSAGE', 'INTERVIEW_INVITE', 'PAYMENT_RECEIVED', 'SYSTEM_ALERT']),
  body('subject').notEmpty().trim(),
  body('body').notEmpty().trim(),
  body('variables').optional().isArray()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Only admins can create templates
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const template = await notificationService.createTemplate(req.body);

    res.status(201).json({
      message: 'Notification template created successfully',
      template
    });
  } catch (error) {
    console.error('Create notification template error:', error);
    res.status(500).json({ error: 'Failed to create notification template', details: error.message });
  }
});

// Bulk send notifications
router.post('/bulk', authMiddleware.verifyToken, [
  body('userIds').isArray(),
  body('type').isIn(['APPLICATION_UPDATE', 'JOB_MATCH', 'MESSAGE', 'INTERVIEW_INVITE', 'PAYMENT_RECEIVED', 'SYSTEM_ALERT']),
  body('title').notEmpty().trim(),
  body('message').notEmpty().trim(),
  body('channels').isArray(),
  body('data').optional().isObject()
], async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    // Only admins can send bulk notifications
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { userIds, type, title, message, channels, data } = req.body;

    const results = await notificationService.bulkSend({
      userIds,
      type,
      title,
      message,
      channels,
      data
    });

    res.json({
      message: 'Bulk notifications sent successfully',
      results: {
        total: userIds.length,
        successful: results.filter(r => r.success).length,
        failed: results.filter(r => !r.success).length,
        details: results
      }
    });
  } catch (error) {
    console.error('Bulk send notifications error:', error);
    res.status(500).json({ error: 'Failed to send bulk notifications', details: error.message });
  }
});

// Get notification statistics
router.get('/stats', authMiddleware.verifyToken, async (req, res) => {
  try {
    // Only admins can view notification statistics
    if (req.userRole !== 'ADMIN') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const { days = 30 } = req.query;
    const dateThreshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [
      totalNotifications,
      notificationsByType,
      notificationsByChannel,
      deliveryStats,
      engagementStats
    ] = await Promise.all([
      prisma.notification.count({
        where: { createdAt: { gte: dateThreshold } }
      }),
      prisma.notification.groupBy({
        by: ['type'],
        where: { createdAt: { gte: dateThreshold } },
        _count: { type: true }
      }),
      prisma.notification.groupBy({
        by: ['channels'],
        where: { createdAt: { gte: dateThreshold } },
        _count: { channels: true }
      }),
      prisma.notification.aggregate({
        where: { createdAt: { gte: dateThreshold } },
        _avg: {
          emailSent: true,
          pushSent: true,
          smsSent: true,
          inAppSent: true
        }
      }),
      prisma.notification.aggregate({
        where: { 
          createdAt: { gte: dateThreshold },
          read: true 
        },
        _count: { read: true },
        _avg: {
          clicked: true
        }
      })
    ]);

    // Calculate channel delivery rates
    const channelDelivery = {
      email: Math.round(deliveryStats._avg.emailSent * 100),
      push: Math.round(deliveryStats._avg.pushSent * 100),
      sms: Math.round(deliveryStats._avg.smsSent * 100),
      inApp: Math.round(deliveryStats._avg.inAppSent * 100)
    };

    res.json({
      totalNotifications,
      notificationsByType: notificationsByType.reduce((acc, item) => {
        acc[item.type] = item._count.type;
        return acc;
      }, {}),
      channelDelivery,
      engagement: {
        readRate: totalNotifications > 0 ? 
          Math.round((engagementStats._count.read / totalNotifications) * 100) : 0,
        clickRate: engagementStats._avg.clicked ? 
          Math.round(engagementStats._avg.clicked * 100) : 0
      },
      period: `${days} days`
    });
  } catch (error) {
    console.error('Get notification stats error:', error);
    res.status(500).json({ error: 'Failed to get notification statistics', details: error.message });
  }
});

module.exports = router;
