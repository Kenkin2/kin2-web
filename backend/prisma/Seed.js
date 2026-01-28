const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const logger = require('../src/utils/logger');

const prisma = new PrismaClient();

async function main() {
  logger.info('Starting database seeding...');

  // Clear existing data (in development)
  if (process.env.NODE_ENV === 'development') {
    logger.info('Clearing existing data...');
    
    // Delete in correct order to avoid foreign key constraints
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
        await prisma[model].deleteMany({});
        logger.info(`Cleared ${model}`);
      } catch (error) {
        logger.warn(`Could not clear ${model}: ${error.message}`);
      }
    }
  }

  // Create Skills
  logger.info('Creating skills...');
  const skills = [
    // Technical Skills
    { name: 'JavaScript', category: 'TECHNICAL' },
    { name: 'Python', category: 'TECHNICAL' },
    { name: 'Java', category: 'TECHNICAL' },
    { name: 'React', category: 'TECHNICAL' },
    { name: 'Node.js', category: 'TECHNICAL' },
    { name: 'TypeScript', category: 'TECHNICAL' },
    { name: 'HTML/CSS', category: 'TECHNICAL' },
    { name: 'SQL', category: 'TECHNICAL' },
    { name: 'MongoDB', category: 'TECHNICAL' },
    { name: 'AWS', category: 'TECHNICAL' },
    { name: 'Docker', category: 'TECHNICAL' },
    { name: 'Git', category: 'TECHNICAL' },
    
    // Soft Skills
    { name: 'Communication', category: 'SOFT' },
    { name: 'Leadership', category: 'SOFT' },
    { name: 'Teamwork', category: 'SOFT' },
    { name: 'Problem Solving', category: 'SOFT' },
    { name: 'Time Management', category: 'SOFT' },
    { name: 'Adaptability', category: 'SOFT' },
    
    // Languages
    { name: 'English', category: 'LANGUAGE' },
    { name: 'Spanish', category: 'LANGUAGE' },
    { name: 'French', category: 'LANGUAGE' },
    { name: 'German', category: 'LANGUAGE' },
    { name: 'Chinese', category: 'LANGUAGE' },
  ];

  for (const skillData of skills) {
    await prisma.skill.upsert({
      where: { name: skillData.name },
      update: skillData,
      create: skillData,
    });
  }
  logger.info(`Created ${skills.length} skills`);

  // Create Admin User
  logger.info('Creating admin user...');
  const adminPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD || 'Admin123!', 12);
  
  const admin = await prisma.user.upsert({
    where: { email: 'admin@kin2.com' },
    update: {},
    create: {
      email: 'admin@kin2.com',
      password: adminPassword,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: true,
      firstName: 'Admin',
      lastName: 'User',
      phone: '+1234567890',
      profile: {
        create: {
          headline: 'Platform Administrator',
          summary: 'System administrator for Kin2 Workforce Platform',
          currentTitle: 'System Administrator',
          currentCompany: 'Kin2',
        },
      },
    },
  });
  logger.info(`Created admin user: ${admin.email}`);

  // Create Sample Workers
  logger.info('Creating sample workers...');
  const workerPasswords = await Promise.all(
    Array(5).fill(null).map(() => bcrypt.hash('Worker123!', 12))
  );

  const workers = [
    {
      email: 'john.doe@example.com',
      firstName: 'John',
      lastName: 'Doe',
      role: 'WORKER',
      profile: {
        create: {
          headline: 'Senior Software Engineer',
          summary: 'Experienced full-stack developer with 8+ years in web development',
          currentTitle: 'Senior Software Engineer',
          currentCompany: 'TechCorp',
          yearsExperience: 8,
        },
      },
      workerProfile: {
        create: {
          workerType: 'FULL_TIME',
          availability: 'AVAILABLE',
          preferredRoles: ['Software Engineer', 'Tech Lead', 'Full Stack Developer'],
          minSalary: 120000,
          maxSalary: 180000,
          salaryType: 'YEARLY',
          remotePreference: 'HYBRID',
          currentEmploymentStatus: 'ACTIVELY_LOOKING',
          preferredLocations: ['San Francisco', 'Remote'],
        },
      },
    },
    {
      email: 'jane.smith@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      role: 'WORKER',
      profile: {
        create: {
          headline: 'Product Manager',
          summary: 'Product manager with 5+ years experience in SaaS products',
          currentTitle: 'Product Manager',
          currentCompany: 'SaaS Innovations',
          yearsExperience: 5,
        },
      },
      workerProfile: {
        create: {
          workerType: 'FULL_TIME',
          availability: 'AVAILABLE',
          preferredRoles: ['Product Manager', 'Product Owner'],
          minSalary: 110000,
          maxSalary: 160000,
          salaryType: 'YEARLY',
          remotePreference: 'REMOTE',
          currentEmploymentStatus: 'OPEN_TO_OFFERS',
          preferredLocations: ['New York', 'Remote'],
        },
      },
    },
    {
      email: 'mike.wilson@example.com',
      firstName: 'Mike',
      lastName: 'Wilson',
      role: 'WORKER',
      profile: {
        create: {
          headline: 'Data Scientist',
          summary: 'Data scientist specializing in machine learning and AI',
          currentTitle: 'Data Scientist',
          currentCompany: 'DataTech',
          yearsExperience: 4,
        },
      },
      workerProfile: {
        create: {
          workerType: 'FULL_TIME',
          availability: 'AVAILABLE',
          preferredRoles: ['Data Scientist', 'ML Engineer'],
          minSalary: 100000,
          maxSalary: 150000,
          salaryType: 'YEARLY',
          remotePreference: 'HYBRID',
          currentEmploymentStatus: 'ACTIVELY_LOOKING',
          preferredLocations: ['Seattle', 'Remote'],
        },
      },
    },
    {
      email: 'sarah.johnson@example.com',
      firstName: 'Sarah',
      lastName: 'Johnson',
      role: 'WORKER',
      profile: {
        create: {
          headline: 'UX/UI Designer',
          summary: 'Creative designer with expertise in user experience and interface design',
          currentTitle: 'Senior UX Designer',
          currentCompany: 'DesignStudio',
          yearsExperience: 6,
        },
      },
      workerProfile: {
        create: {
          workerType: 'FULL_TIME',
          availability: 'AVAILABLE',
          preferredRoles: ['UX Designer', 'UI Designer', 'Product Designer'],
          minSalary: 90000,
          maxSalary: 140000,
          salaryType: 'YEARLY',
          remotePreference: 'REMOTE',
          currentEmploymentStatus: 'OPEN_TO_OFFERS',
          preferredLocations: ['Austin', 'Remote'],
        },
      },
    },
    {
      email: 'david.chen@example.com',
      firstName: 'David',
      lastName: 'Chen',
      role: 'WORKER',
      profile: {
        create: {
          headline: 'DevOps Engineer',
          summary: 'DevOps specialist with cloud infrastructure and automation expertise',
          currentTitle: 'DevOps Engineer',
          currentCompany: 'CloudSystems',
          yearsExperience: 7,
        },
      },
      workerProfile: {
        create: {
          workerType: 'FULL_TIME',
          availability: 'AVAILABLE',
          preferredRoles: ['DevOps Engineer', 'Site Reliability Engineer'],
          minSalary: 115000,
          maxSalary: 170000,
          salaryType: 'YEARLY',
          remotePreference: 'ONSITE',
          currentEmploymentStatus: 'ACTIVELY_LOOKING',
          preferredLocations: ['Boston'],
        },
      },
    },
  ];

  for (let i = 0; i < workers.length; i++) {
    const workerData = workers[i];
    const user = await prisma.user.upsert({
      where: { email: workerData.email },
      update: {},
      create: {
        email: workerData.email,
        password: workerPasswords[i],
        role: workerData.role,
        status: 'ACTIVE',
        emailVerified: true,
        firstName: workerData.firstName,
        lastName: workerData.lastName,
        phone: `+1${5550000000 + i}`,
        profile: workerData.profile,
        workerProfile: workerData.workerProfile,
      },
    });
    
    // Add skills to workers
    const skillIds = await prisma.skill.findMany({
      where: { category: 'TECHNICAL' },
      take: 5,
    });
    
    for (const skill of skillIds) {
      await prisma.userSkill.create({
        data: {
          userId: user.id,
          skillId: skill.id,
          proficiency: ['BEGINNER', 'INTERMEDIATE', 'ADVANCED', 'EXPERT'][Math.floor(Math.random() * 4)],
          yearsExperience: Math.floor(Math.random() * 10) + 1,
          isPrimary: Math.random() > 0.5,
        },
      });
    }
  }
  logger.info(`Created ${workers.length} sample workers`);

  // Create Sample Employers
  logger.info('Creating sample employers...');
  const employerPasswords = await Promise.all(
    Array(3).fill(null).map(() => bcrypt.hash('Employer123!', 12))
  );

  const employers = [
    {
      email: 'hr@techcorp.com',
      firstName: 'Tech',
      lastName: 'Corp',
      companyName: 'TechCorp Inc.',
      industry: 'Technology',
      companySize: 'LARGE',
      description: 'Leading technology company specializing in software solutions',
    },
    {
      email: 'careers@innovate.com',
      firstName: 'Innovate',
      lastName: 'Labs',
      companyName: 'Innovate Labs',
      industry: 'Software',
      companySize: 'MEDIUM',
      description: 'Innovative software development agency',
    },
    {
      email: 'jobs@datatech.com',
      firstName: 'Data',
      lastName: 'Tech',
      companyName: 'DataTech Solutions',
      industry: 'Data & Analytics',
      companySize: 'SMALL',
      description: 'Data analytics and machine learning solutions provider',
    },
  ];

  for (let i = 0; i < employers.length; i++) {
    const employerData = employers[i];
    await prisma.user.upsert({
      where: { email: employerData.email },
      update: {},
      create: {
        email: employerData.email,
        password: employerPasswords[i],
        role: 'EMPLOYER',
        status: 'ACTIVE',
        emailVerified: true,
        firstName: employerData.firstName,
        lastName: employerData.lastName,
        employerProfile: {
          create: {
            companyName: employerData.companyName,
            industry: employerData.industry,
            companySize: employerData.companySize,
            description: employerData.description,
            headquarters: 'San Francisco, CA',
            locations: ['San Francisco', 'New York', 'Remote'],
            verified: true,
            verificationDate: new Date(),
          },
        },
      },
    });
  }
  logger.info(`Created ${employers.length} sample employers`);

  // Create Sample Jobs
  logger.info('Creating sample jobs...');
  const companies = await prisma.employerProfile.findMany({
    take: 3,
  });

  const sampleJobs = [
    {
      title: 'Senior Full Stack Developer',
      description: 'We are looking for an experienced Full Stack Developer to join our team...',
      requirements: '5+ years of experience with JavaScript, React, Node.js, and SQL...',
      responsibilities: 'Develop and maintain web applications, collaborate with cross-functional teams...',
      jobType: 'FULL_TIME',
      experienceLevel: 'SENIOR',
      remotePreference: 'HYBRID',
      employmentType: 'PERMANENT',
      salaryType: 'YEARLY',
      minSalary: 130000,
      maxSalary: 180000,
      location: 'San Francisco, CA',
      category: 'Software Development',
      tags: ['javascript', 'react', 'nodejs', 'fullstack'],
    },
    {
      title: 'Product Manager',
      description: 'Lead product strategy and development for our flagship product...',
      requirements: '3+ years of product management experience, strong analytical skills...',
      responsibilities: 'Define product roadmap, work with engineering and design teams...',
      jobType: 'FULL_TIME',
      experienceLevel: 'MID',
      remotePreference: 'REMOTE',
      employmentType: 'PERMANENT',
      salaryType: 'YEARLY',
      minSalary: 120000,
      maxSalary: 160000,
      location: 'Remote',
      category: 'Product Management',
      tags: ['product', 'management', 'strategy', 'analytics'],
    },
    {
      title: 'Data Scientist',
      description: 'Join our data science team to build predictive models and insights...',
      requirements: 'Masters degree in CS or related field, experience with ML frameworks...',
      responsibilities: 'Develop machine learning models, analyze large datasets...',
      jobType: 'FULL_TIME',
      experienceLevel: 'MID',
      remotePreference: 'HYBRID',
      employmentType: 'PERMANENT',
      salaryType: 'YEARLY',
      minSalary: 110000,
      maxSalary: 150000,
      location: 'Seattle, WA',
      category: 'Data Science',
      tags: ['python', 'machine-learning', 'data-science', 'ai'],
    },
    {
      title: 'UX/UI Designer',
      description: 'Design beautiful and functional user interfaces for our products...',
      requirements: 'Portfolio required, experience with Figma and design systems...',
      responsibilities: 'Create wireframes, prototypes, and final designs...',
      jobType: 'FULL_TIME',
      experienceLevel: 'SENIOR',
      remotePreference: 'REMOTE',
      employmentType: 'CONTRACT',
      salaryType: 'YEARLY',
      minSalary: 90000,
      maxSalary: 140000,
      location: 'Remote',
      category: 'Design',
      tags: ['ux', 'ui', 'design', 'figma'],
    },
    {
      title: 'DevOps Engineer',
      description: 'Build and maintain our cloud infrastructure and CI/CD pipelines...',
      requirements: 'Experience with AWS, Docker, Kubernetes, and infrastructure as code...',
      responsibilities: 'Manage cloud infrastructure, automate deployments...',
      jobType: 'FULL_TIME',
      experienceLevel: 'SENIOR',
      remotePreference: 'ONSITE',
      employmentType: 'PERMANENT',
      salaryType: 'YEARLY',
      minSalary: 120000,
      maxSalary: 170000,
      location: 'Boston, MA',
      category: 'DevOps',
      tags: ['aws', 'docker', 'kubernetes', 'devops'],
    },
  ];

  for (let i = 0; i < sampleJobs.length; i++) {
    const jobData = sampleJobs[i];
    const company = companies[i % companies.length];
    
    await prisma.job.create({
      data: {
        ...jobData,
        slug: `${jobData.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}`,
        companyId: company.id,
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        urgency: ['LOW', 'NORMAL', 'HIGH', 'URGENT'][Math.floor(Math.random() * 4)],
        postedAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000), // Random date within last 30 days
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days from now
        applicationDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
      },
    });
  }
  logger.info(`Created ${sampleJobs.length} sample jobs`);

  // Create Sample Applications
  logger.info('Creating sample applications...');
  const jobs = await prisma.job.findMany({ take: 5 });
  const workerUsers = await prisma.user.findMany({
    where: { role: 'WORKER' },
    take: 5,
  });

  for (let i = 0; i < Math.min(jobs.length, workerUsers.length) * 2; i++) {
    const job = jobs[i % jobs.length];
    const user = workerUsers[Math.floor(i / 2) % workerUsers.length];
    
    // Check if application already exists
    const existingApp = await prisma.application.findFirst({
      where: {
        jobId: job.id,
        userId: user.id,
      },
    });
    
    if (!existingApp) {
      const statuses = ['PENDING', 'REVIEWING', 'SHORTLISTED', 'INTERVIEWING', 'OFFERED', 'REJECTED'];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      
      await prisma.application.create({
        data: {
          jobId: job.id,
          userId: user.id,
          coverLetter: `Dear Hiring Manager,\n\nI am excited to apply for the ${job.title} position...`,
          status: status,
          stage: 'APPLIED',
          kfnScore: Math.random() * 40 + 60, // Random score between 60-100
          aiScreeningScore: Math.random() * 30 + 70,
          appliedAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  logger.info('Created sample applications');

  // Create Sample KFN Scores
  logger.info('Creating sample KFN scores...');
  const applications = await prisma.application.findMany({
    where: { kfnScore: { not: null } },
    take: 10,
  });

  for (const application of applications) {
    await prisma.kFN.upsert({
      where: {
        userId_jobId: {
          userId: application.userId,
          jobId: application.jobId,
        },
      },
      update: {},
      create: {
        userId: application.userId,
        jobId: application.jobId,
        overallScore: application.kfnScore || 75,
        skillsScore: Math.random() * 20 + 70,
        experienceScore: Math.random() * 20 + 70,
        locationScore: Math.random() * 20 + 70,
        availabilityScore: Math.random() * 20 + 70,
        educationScore: Math.random() * 20 + 70,
        culturalScore: Math.random() * 20 + 70,
        strengths: ['Strong technical skills', 'Good communication', 'Relevant experience'],
        weaknesses: ['Limited industry experience', 'Could improve on specific technologies'],
        recommendations: ['Consider for interview', 'Good cultural fit'],
        calculatedAt: new Date(),
      },
    });
  }
  logger.info('Created sample KFN scores');

  // Create Sample Subscriptions
  logger.info('Creating sample subscriptions...');
  const subscriptionPlans = [
    {
      planId: 'free',
      planName: 'Free',
      price: 0,
      interval: 'MONTHLY',
    },
    {
      planId: 'basic',
      planName: 'Basic',
      price: 29.99,
      interval: 'MONTHLY',
    },
    {
      planId: 'pro',
      planName: 'Professional',
      price: 79.99,
      interval: 'MONTHLY',
    },
    {
      planId: 'business',
      planName: 'Business',
      price: 199.99,
      interval: 'MONTHLY',
    },
  ];

  for (const employer of await prisma.user.findMany({ where: { role: 'EMPLOYER' } })) {
    const plan = subscriptionPlans[Math.floor(Math.random() * subscriptionPlans.length)];
    
    await prisma.subscription.create({
      data: {
        userId: employer.id,
        planId: plan.planId,
        planName: plan.planName,
        price: plan.price,
        interval: plan.interval,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        gatewayId: `sub_${Date.now()}_${employer.id}`,
        gatewayCustomerId: `cus_${employer.id}`,
      },
    });
  }
  logger.info('Created sample subscriptions');

  // Create Sample Notifications
  logger.info('Creating sample notifications...');
  const allUsers = await prisma.user.findMany({ take: 10 });

  for (const user of allUsers) {
    const notificationTypes = [
      'APPLICATION_UPDATE',
      'JOB_MATCH',
      'MESSAGE',
      'INTERVIEW_INVITE',
      'SYSTEM_ALERT',
    ];

    for (let i = 0; i < 3; i++) {
      const type = notificationTypes[Math.floor(Math.random() * notificationTypes.length)];
      
      await prisma.notification.create({
        data: {
          userId: user.id,
          type: type,
          title: `Sample ${type.replace('_', ' ')}`,
          message: `This is a sample ${type.toLowerCase().replace('_', ' ')} notification`,
          channels: ['IN_APP', 'EMAIL'],
          sentVia: ['IN_APP'],
          read: Math.random() > 0.5,
          clicked: Math.random() > 0.7,
          sentAt: new Date(Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000),
        },
      });
    }
  }
  logger.info('Created sample notifications');

  logger.info('Database seeding completed successfully!');
}

main()
  .catch((error) => {
    logger.error('Error during database seeding:', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
