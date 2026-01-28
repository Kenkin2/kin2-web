const { prisma } = require('../config/database');

// Import all repositories
const UserRepository = require('./repositories/UserRepository');
const ProfileRepository = require('./repositories/ProfileRepository');
const WorkerRepository = require('./repositories/WorkerRepository');
const EmployerRepository = require('./repositories/EmployerRepository');
const JobRepository = require('./repositories/JobRepository');
const ApplicationRepository = require('./repositories/ApplicationRepository');
const KFNRepository = require('./repositories/KFNRepository');
const SkillRepository = require('./repositories/SkillRepository');
const ExperienceRepository = require('./repositories/ExperienceRepository');
const EducationRepository = require('./repositories/EducationRepository');
const PaymentRepository = require('./repositories/PaymentRepository');
const SubscriptionRepository = require('./repositories/SubscriptionRepository');
const NotificationRepository = require('./repositories/NotificationRepository');
const ResumeRepository = require('./repositories/ResumeRepository');
const InterviewRepository = require('./repositories/InterviewRepository');
const ReviewRepository = require('./repositories/ReviewRepository');
const AnalyticsRepository = require('./repositories/AnalyticsRepository');
const AdminRepository = require('./repositories/AdminRepository');

/**
 * Repository Factory
 * Provides access to all repositories through a single interface
 */
class RepositoryFactory {
  constructor(prismaClient) {
    this.prisma = prismaClient;
    
    // Initialize all repositories
    this.repositories = {
      user: new UserRepository(this.prisma),
      profile: new ProfileRepository(this.prisma),
      worker: new WorkerRepository(this.prisma),
      employer: new EmployerRepository(this.prisma),
      job: new JobRepository(this.prisma),
      application: new ApplicationRepository(this.prisma),
      kfn: new KFNRepository(this.prisma),
      skill: new SkillRepository(this.prisma),
      experience: new ExperienceRepository(this.prisma),
      education: new EducationRepository(this.prisma),
      payment: new PaymentRepository(this.prisma),
      subscription: new SubscriptionRepository(this.prisma),
      notification: new NotificationRepository(this.prisma),
      resume: new ResumeRepository(this.prisma),
      interview: new InterviewRepository(this.prisma),
      review: new ReviewRepository(this.prisma),
      analytics: new AnalyticsRepository(this.prisma),
      admin: new AdminRepository(this.prisma),
    };
  }

  /**
   * Get repository by name
   */
  getRepository(name) {
    const repository = this.repositories[name];
    if (!repository) {
      throw new Error(`Repository not found: ${name}`);
    }
    return repository;
  }

  /**
   * Get all repositories
   */
  getAllRepositories() {
    return this.repositories;
  }

  /**
   * Get specific repositories
   */
  getUserRepository() { return this.repositories.user; }
  getProfileRepository() { return this.repositories.profile; }
  getWorkerRepository() { return this.repositories.worker; }
  getEmployerRepository() { return this.repositories.employer; }
  getJobRepository() { return this.repositories.job; }
  getApplicationRepository() { return this.repositories.application; }
  getKFNRepository() { return this.repositories.kfn; }
  getSkillRepository() { return this.repositories.skill; }
  getExperienceRepository() { return this.repositories.experience; }
  getEducationRepository() { return this.repositories.education; }
  getPaymentRepository() { return this.repositories.payment; }
  getSubscriptionRepository() { return this.repositories.subscription; }
  getNotificationRepository() { return this.repositories.notification; }
  getResumeRepository() { return this.repositories.resume; }
  getInterviewRepository() { return this.repositories.interview; }
  getReviewRepository() { return this.repositories.review; }
  getAnalyticsRepository() { return this.repositories.analytics; }
  getAdminRepository() { return this.repositories.admin; }

  /**
   * Transaction wrapper
   */
  async transaction(callback) {
    return await this.prisma.$transaction(callback);
  }

  /**
   * Execute raw query
   */
  async rawQuery(query, params = []) {
    return await this.prisma.$executeRaw(query, params);
  }

  /**
   * Execute raw query with results
   */
  async rawQueryWithResults(query, params = []) {
    return await this.prisma.$queryRaw(query, params);
  }

  /**
   * Disconnect from database
   */
  async disconnect() {
    await this.prisma.$disconnect();
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        repositories: Object.keys(this.repositories).length,
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Clear all data (for testing only)
   */
  async clearAllData() {
    if (process.env.NODE_ENV !== 'test') {
      throw new Error('This method is only available in test environment');
    }

    const models = [
      'analyticsEvent',
      'adminLog',
      'conversationParticipant',
      'message',
      'conversation',
      'bookmark',
      'review',
      'session',
      'interview',
      'applicationNote',
      'application',
      'kfn',
      'jobSkill',
      'job',
      'certificate',
      'education',
      'experience',
      'userSkill',
      'skill',
      'resume',
      'notification',
      'subscription',
      'payment',
      'volunteerProfile',
      'sellerProfile',
      'freelancerProfile',
      'employerProfile',
      'workerProfile',
      'profile',
      'user',
    ];

    for (const model of models) {
      try {
        await this.prisma[model].deleteMany({});
      } catch (error) {
        // Ignore errors for models that don't exist
      }
    }
  }
}

// Create singleton instance
const repositoryFactory = new RepositoryFactory(prisma);

module.exports = repositoryFactory;
