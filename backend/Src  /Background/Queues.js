const Queue = require('bull');
const { systemLogger } = require('../../utils/logger');

/**
 * Setup Bull queues
 */
async function setupQueues(redisClient) {
  const queues = {};
  
  const queueOptions = {
    redis: {
      url: process.env.REDIS_URL,
      password: process.env.REDIS_PASSWORD
    },
    prefix: 'kin2:queue',
    defaultJobOptions: {
      removeOnComplete: 100,
      removeOnFail: 1000,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 5000
      }
    }
  };

  // Email queue
  queues.emailQueue = new Queue('email', queueOptions);
  
  // AI processing queue
  queues.aiQueue = new Queue('ai-processing', queueOptions);
  
  // Payment processing queue
  queues.paymentsQueue = new Queue('payments', queueOptions);
  
  // Reports queue
  queues.reportsQueue = new Queue('reports', queueOptions);
  
  // Cleanup queue
  queues.cleanupQueue = new Queue('cleanup', queueOptions);
  
  // Backup queue
  queues.backupQueue = new Queue('backup', queueOptions);
  
  // Setup queue event handlers
  Object.entries(queues).forEach(([name, queue]) => {
    queue.on('completed', (job) => {
      systemLogger.debug(`Job ${job.id} completed in ${name} queue`);
    });
    
    queue.on('failed', (job, error) => {
      systemLogger.error(`Job ${job.id} failed in ${name} queue:`, error);
    });
    
    queue.on('stalled', (job) => {
      systemLogger.warn(`Job ${job.id} stalled in ${name} queue`);
    });
  });

  // Start queue processors
  await startQueueProcessors(queues);

  return queues;
}

/**
 * Start queue processors
 */
async function startQueueProcessors(queues) {
  // Email processor
  queues.emailQueue.process('send-email', 5, async (job) => {
    const { to, subject, html, text } = job.data;
    // Email sending logic here
  });

  // AI processor
  queues.aiQueue.process('process-ai-request', 3, async (job) => {
    const { type, data } = job.data;
    // AI processing logic here
  });

  // Payment processor
  queues.paymentsQueue.process('process-payment', 2, async (job) => {
    const { paymentId } = job.data;
    // Payment processing logic here
  });

  systemLogger.info('✅ Queue processors started');
}

module.exports = { setupQueues };
