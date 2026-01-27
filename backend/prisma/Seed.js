#!/usr/bin/env node

/**
 * Database Seeder for Kin2 Platform
 * Run: npx prisma db seed
 */

const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { faker } = require('@faker-js/faker');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Clean existing data
  await prisma.$executeRaw`TRUNCATE TABLE users CASCADE`;
  
  // Create admin user
  const adminPassword = await hash('Admin123!', 12);
  const admin = await prisma.user.create({
    data: {
      email: 'admin@kin2.co.uk',
      passwordHash: adminPassword,
      role: 'ADMIN',
      status: 'VERIFIED',
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'System',
          lastName: 'Administrator',
          displayName: 'Admin',
          phone: '+441234567890',
          bio: 'System administrator account',
          preferredLanguage: 'en',
          currency: 'USD',
          profileCompletion: 100
        }
      },
      admin: {
        create: {
          adminLevel: 5,
          permissions: ['users', 'jobs', 'payments', 'reports', 'settings', 'system'],
          assignedModules: ['all'],
          isSuperAdmin: true,
          mfaEnabled: true
        }
      }
    }
  });

  // Create test employer
  const employerPassword = await hash('Employer123!', 12);
  const employer = await prisma.user.create({
    data: {
      email: 'employer@example.com',
      passwordHash: employerPassword,
      role: 'EMPLOYER',
      status: 'VERIFIED',
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'Tech',
          lastName: 'Corp',
          displayName: 'Tech Corp',
          bio: 'Leading technology company',
          preferredLanguage: 'en',
          currency: 'USD',
          profileCompletion: 85
        }
      },
      employer: {
        create: {
          companyName: 'Tech Innovations Ltd.',
          companyLogo: 'https://example.com/logo.png',
          companyWebsite: 'https://techcorp.com',
          companyDescription: 'Innovative technology solutions provider',
          companySize: '51-200',
          industry: 'Technology',
          contactPerson: 'John Smith',
          contactEmail: 'contact@techcorp.com',
          contactPhone: '+441234567891',
          isVerified: true,
          verificationLevel: 2,
          subscriptionPlan: 'PROFESSIONAL',
          autoRenew: true
        }
      }
    }
  });

  // Create test worker
  const workerPassword = await hash('Worker123!', 12);
  const worker = await prisma.user.create({
    data: {
      email: 'worker@example.com',
      passwordHash: workerPassword,
      role: 'WORKER',
      status: 'VERIFIED',
      isEmailVerified: true,
      profile: {
        create: {
          firstName: 'Jane',
          lastName: 'Doe',
          displayName: 'Jane Doe',
          bio: 'Experienced software developer',
          gender: 'FEMALE',
          phone: '+441234567892',
          city: 'London',
          country: 'United Kingdom',
          preferredLanguage: 'en',
          currency: 'GBP',
          profileCompletion: 90,
          skills: {
            create: [
              { name: 'JavaScript', category: 'Programming', level: 5, yearsExperience: 5 },
              { name: 'React', category: 'Frontend', level: 5, yearsExperience: 4 },
              { name: 'Node.js', category: 'Backend', level: 4, yearsExperience: 3 }
            ]
          },
          educations: {
            create: [
              {
                institution: 'University of Technology',
                degree: 'Bachelor of Science',
                fieldOfStudy: 'Computer Science',
                startDate: new Date('2015-09-01'),
                endDate: new Date('2019-06-01'),
                location: 'London, UK'
              }
            ]
          },
          experiences: {
            create: [
              {
                title: 'Senior Software Engineer',
                company: 'Tech Solutions Inc.',
                employmentType: 'FULL_TIME',
                location: 'London, UK',
                startDate: new Date('2020-01-01'),
                isCurrent: true,
                description: 'Led development of enterprise applications',
                skillsUsed: ['JavaScript', 'React', 'Node.js', 'AWS']
              }
            ]
          }
        }
      },
      worker: {
        create: {
          workerId: 'WRK-001',
          headline: 'Senior Software Engineer',
          summary: 'Experienced full-stack developer',
          availabilityType: 'FULL_TIME',
          availabilityDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
          preferredJobTypes: ['REMOTE', 'HYBRID'],
          preferredIndustries: ['Technology', 'Fintech'],
          minSalary: 70000,
          maxSalary: 100000,
          salaryCurrency: 'GBP',
          isOpenToRelocation: true,
          identityVerified: true,
          trustScore: 85
        }
      }
    }
  });

  // Create AI Agents
  const aiAgents = await Promise.all([
    prisma.aIAgent.create({
      data: {
        agentId: 'RESUME_SCREENER_01',
        name: 'Resume Screening Agent',
        type: 'RESUME_SCREENER',
        version: '2.0.0',
        description: 'Analyzes resumes and matches against job requirements',
        provider: 'DEEPSEEK',
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 2000,
        status: 'IDLE',
        isActive: true,
        rateLimitPerMinute: 60,
        rateLimitPerHour: 1000
      }
    }),
    prisma.aIAgent.create({
      data: {
        agentId: 'JOB_MATCHER_01',
        name: 'Job Matching Agent',
        type: 'JOB_MATCHER',
        version: '2.0.0',
        description: 'Matches workers to jobs using KFN algorithm',
        provider: 'DEEPSEEK',
        model: 'deepseek-chat',
        temperature: 0.5,
        maxTokens: 3000,
        status: 'IDLE',
        isActive: true,
        rateLimitPerMinute: 40,
        rateLimitPerHour: 800
      }
    })
  ]);

  // Create sample job
  const job = await prisma.job.create({
    data: {
      employerId: employer.employer?.id || '',
      userId: employer.id,
      jobId: 'JOB-001',
      title: 'Senior Full-Stack Developer',
      slug: 'senior-full-stack-developer',
      description: 'We are looking for an experienced full-stack developer to join our team.',
      requirements: '5+ years experience with JavaScript, React, Node.js, and PostgreSQL.',
      responsibilities: 'Develop and maintain web applications, collaborate with team members.',
      jobType: 'FULL_TIME',
      workType: 'REMOTE',
      experienceLevel: 'SENIOR',
      location: 'Remote',
      country: 'United Kingdom',
      isRemote: true,
      salaryMin: 80000,
      salaryMax: 100000,
      salaryCurrency: 'GBP',
      status: 'PUBLISHED',
      publishedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      requiredSkills: ['JavaScript', 'React', 'Node.js', 'PostgreSQL', 'AWS'],
      preferredSkills: ['TypeScript', 'GraphQL', 'Docker'],
      viewsCount: 150,
      applicationsCount: 0
    }
  });

  // Create sample application
  const application = await prisma.application.create({
    data: {
      jobId: job.id,
      userId: worker.id,
      workerId: worker.worker?.id || '',
      applicationId: 'APP-001',
      coverLetter: 'I am excited to apply for this position...',
      resumeText: 'Experienced software developer with 5+ years...',
      status: 'PENDING',
      screeningScore: 85.5,
      aiAnalysis: {
        strengths: ['Strong JavaScript skills', 'Good React experience'],
        concerns: ['Limited AWS experience'],
        recommendation: 'SHORTLIST'
      }
    }
  });

  // Create sample KFN score
  const kfnScore = await prisma.kFNScore.create({
    data: {
      jobId: job.id,
      workerId: worker.worker?.id || '',
      userId: worker.id,
      scoreId: 'KFN-001',
      version: '2.0.0',
      overallScore: 87.5,
      skillsScore: 90,
      skillsBreakdown: { JavaScript: 95, React: 90, Nodejs: 85 },
      experienceScore: 85,
      experienceBreakdown: { years: 5, relevance: 90 },
      locationScore: 100,
      locationBreakdown: { remote: true, match: 100 },
      salaryScore: 88,
      salaryBreakdown: { expected: 90000, offered: 95000 },
      availabilityScore: 95,
      availabilityBreakdown: { fullTime: true, immediate: true },
      cultureScore: 80,
      cultureBreakdown: { values: 85, workStyle: 75 },
      biasScore: 95,
      diversityScore: 90,
      transparencyScore: 85,
      recommendation: 'STRONG_MATCH',
      insights: ['Excellent skills match', 'Salary expectations aligned'],
      calculationTime: 2.5,
      dataPointsUsed: 25
    }
  });

  // Create system configurations
  await prisma.systemConfig.createMany({
    data: [
      {
        key: 'app.name',
        value: '"Kin2 Workforce Platform"',
        type: 'string',
        category: 'general',
        description: 'Application name',
        isPublic: true,
        isMutable: true
      },
      {
        key: 'app.version',
        value: '"2.5.0"',
        type: 'string',
        category: 'general',
        description: 'Application version',
        isPublic: true,
        isMutable: false
      },
      {
        key: 'job.autoExpireDays',
        value: '30',
        type: 'number',
        category: 'jobs',
        description: 'Days before jobs auto-expire',
        isPublic: false,
        isMutable: true
      },
      {
        key: 'email.enabled',
        value: 'true',
        type: 'boolean',
        category: 'email',
        description: 'Enable email notifications',
        isPublic: false,
        isMutable: true
      }
    ]
  });

  // Create email templates
  await prisma.emailTemplate.createMany({
    data: [
      {
        templateId: 'welcome',
        name: 'Welcome Email',
        subject: 'Welcome to Kin2 Workforce Platform!',
        bodyHtml: '<h1>Welcome {{name}}!</h1><p>Thank you for joining...</p>',
        bodyText: 'Welcome {{name}}! Thank you for joining...',
        variables: ['name', 'email'],
        category: 'authentication',
        isActive: true,
        version: '1.0.0'
      },
      {
        templateId: 'password-reset',
        name: 'Password Reset',
        subject: 'Reset Your Password',
        bodyHtml: '<h1>Password Reset</h1><p>Click here to reset: {{resetLink}}</p>',
        bodyText: 'Password Reset\nClick here: {{resetLink}}',
        variables: ['resetLink', 'expiry'],
        category: 'authentication',
        isActive: true,
        version: '1.0.0'
      }
    ]
  });

  console.log('✅ Database seeded successfully!');
  console.log('📋 Created:');
  console.log(`   👑 Admin: ${admin.email}`);
  console.log(`   🏢 Employer: ${employer.email}`);
  console.log(`   👷 Worker: ${worker.email}`);
  console.log(`   💼 Job: ${job.title}`);
  console.log(`   📄 Application: ${application.applicationId}`);
  console.log(`   ⚖️ KFN Score: ${kfnScore.overallScore}`);
  console.log(`   🤖 AI Agents: ${aiAgents.length}`);
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
