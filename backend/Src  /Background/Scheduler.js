const cron = require('node-cron');
const { systemLogger } = require('../../utils/logger');

/**
 * Schedule background jobs
 */
function scheduleJobs(queues) {
  if (!queues) return;

  // 1. Cleanup expired sessions (daily at 2 AM)
  cron.schedule('0 2 * * *', async () => {
    try {
      await queues.cleanupQueue.add('cleanup-sessions', {
        type: 'sessions'
      });
      systemLogger.info('Scheduled: Cleanup expired sessions');
    } catch (error) {
      systemLogger.error('Failed to schedule session cleanup:', error);
    }
  });

  // 2. Generate daily reports (daily at 4 AM)
  cron.schedule('0 4 * * *', async () => {
    try {
      await queues.reportsQueue.add('generate-daily-report', {
        date: new Date().toISOString().split('T')[0]
      });
      systemLogger.info('Scheduled: Generate daily report');
    } catch (error) {
      systemLogger.error('Failed to schedule daily report:', error);
    }
  });

  // 3. Process pending payments (every 30 minutes)
  cron.schedule('*/30 * * * *', async () => {
    try {
      await queues.paymentsQueue.add('process-pending-payments');
      systemLogger.info('Scheduled: Process pending payments');
    } catch (error) {
      systemLogger.error('Failed to schedule payment processing:', error);
    }
  });

  // 4. AI agent health check (every 15 minutes)
  cron.schedule('*/15 * * * *', async () => {
    try {
      await queues.aiQueue.add('health-check');
      systemLogger.info('Scheduled: AI agent health check');
    } catch (error) {
      systemLogger.error('Failed to schedule AI health check:', error);
    }
  });

  // 5. Database backup (daily at 3 AM)
  if (process.env.ENABLE_AUTO_BACKUP === 'true') {
    cron.schedule('0 3 * * *', async () => {
      try {
        await queues.backupQueue.add('database-backup', {
          type: 'full',
          retention: process.env.BACKUP_RETENTION_DAYS || 7
        });
        systemLogger.info('Scheduled: Database backup');
      } catch (error) {
        systemLogger.error('Failed to schedule database backup:', error);
      }
    });
  }

  systemLogger.info('✅ Background jobs scheduled');
}

module.exports = { scheduleJobs };
