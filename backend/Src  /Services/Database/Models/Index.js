/**
 * Database models and relationships
 */

// User models
const User = require('./user.model');
const Profile = require('./profile.model');
const Employer = require('./employer.model');
const Worker = require('./worker.model');
const Freelancer = require('./freelancer.model');
const Volunteer = require('./volunteer.model');
const Seller = require('./seller.model');
const Admin = require('./admin.model');

// Job models
const Job = require('./job.model');
const Application = require('./application.model');
const Interview = require('./interview.model');
const Shift = require('./shift.model');
const CompletedShift = require('./completedShift.model');

// AI models
const AIAgent = require('./aiAgent.model');
const AIAgentLog = require('./aiAgentLog.model');
const JobMatch = require('./jobMatch.model');
const KFNScore = require('./kfnScore.model');

// Financial models
const Payment = require('./payment.model');
const Earning = require('./earning.model');
const Transaction = require('./transaction.model');
const Invoice = require('./invoice.model');
const Subscription = require('./subscription.model');

// Communication models
const Message = require('./message.model');
const Notification = require('./notification.model');

// Engagement models
const KarmaTransaction = require('./karmaTransaction.model');
const Review = require('./review.model');

// Additional models
const Department = require('./department.model');
const Product = require('./product.model');
const ComplianceDoc = require('./complianceDoc.model');
const ActivityLog = require('./activityLog.model');

// Profile support models
const Skill = require('./skill.model');
const Education = require('./education.model');
const Experience = require('./experience.model');
const Certification = require('./certification.model');
const Language = require('./language.model');
const Portfolio = require('./portfolio.model');

// Reporting models
const Report = require('./report.model');

// Settings models
const SystemConfig = require('./systemConfig.model');
const EmailTemplate = require('./emailTemplate.model');

// Audit models
const AuditLog = require('./auditLog.model');
const DatabaseBackup = require('./databaseBackup.model');

// Export all models
module.exports = {
  // User models
  User,
  Profile,
  Employer,
  Worker,
  Freelancer,
  Volunteer,
  Seller,
  Admin,
  
  // Job models
  Job,
  Application,
  Interview,
  Shift,
  CompletedShift,
  
  // AI models
  AIAgent,
  AIAgentLog,
  JobMatch,
  KFNScore,
  
  // Financial models
  Payment,
  Earning,
  Transaction,
  Invoice,
  Subscription,
  
  // Communication models
  Message,
  Notification,
  
  // Engagement models
  KarmaTransaction,
  Review,
  
  // Additional models
  Department,
  Product,
  ComplianceDoc,
  ActivityLog,
  
  // Profile support models
  Skill,
  Education,
  Experience,
  Certification,
  Language,
  Portfolio,
  
  // Reporting models
  Report,
  
  // Settings models
  SystemConfig,
  EmailTemplate,
  
  // Audit models
  AuditLog,
  DatabaseBackup
};
