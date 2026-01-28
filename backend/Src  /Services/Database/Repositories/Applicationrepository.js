class ApplicationRepository {
  constructor(prisma, redis, es) {
    this.prisma = prisma;
    this.redis = redis;
    this.es = es;
    this.CACHE_TTL = 3600; // 1 hour
  }

  // APPLICATION SUBMISSION & VALIDATION
  async submitApplication(jobId, workerId, data, metadata = {}) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId, status: 'ACTIVE' },
    });

    if (!job) {
      throw new Error('Job is not active or not found');
    }

    // Check if already applied
    const existing = await this.prisma.application.findFirst({
      where: { jobId, workerId, status: { not: 'WITHDRAWN' } },
    });

    if (existing) {
      throw new Error('Already applied to this job');
    }

    // Validate application against job requirements
    const validation = await this.validateApplication(jobId, workerId, data);
    if (!validation.valid) {
      throw new Error(`Application validation failed: ${validation.errors.join(', ')}`);
    }

    // Calculate KFN score
    const kfnScore = await this.calculateKFNScore(jobId, workerId, data);

    const application = await this.prisma.application.create({
      data: {
        jobId,
        workerId,
        status: 'SUBMITTED',
        kfnScore,
        data,
        metadata: {
          ...metadata,
          submittedAt: new Date().toISOString(),
          validated: true,
          validationResult: validation,
          ipAddress: metadata.ipAddress,
          userAgent: metadata.userAgent,
          source: metadata.source || 'DIRECT',
        },
        timeline: [
          {
            action: 'SUBMITTED',
            timestamp: new Date(),
            status: 'SUBMITTED',
            note: 'Application submitted',
          },
        ],
      },
    });

    // Clear relevant caches
    await this.clearApplicationCaches(jobId, workerId);

    // Index in search
    await this.indexApplicationInElasticsearch(application);

    // Notify employer
    await this.notifyNewApplication(jobId, application.id);

    return application;
  }

  async validateApplication(jobId, workerId, data) {
    const [job, worker, existingApplications] = await Promise.all([
      this.prisma.job.findUnique({
        where: { id: jobId },
        include: {
          screeningQuestions: true,
          requirements: true,
        },
      }),
      this.prisma.worker.findUnique({
        where: { id: workerId },
        include: {
          skills: true,
          experiences: true,
          education: true,
        },
      }),
      this.prisma.application.count({
        where: {
          workerId,
          status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'INTERVIEWING'] },
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const errors = [];
    const warnings = [];

    // Basic validation
    if (!data.resumeId && !data.resumeText && !data.resumeUrl) {
      errors.push('Resume is required');
    }

    if (!data.coverLetter && job.requiresCoverLetter) {
      errors.push('Cover letter is required');
    }

    // Check job requirements
    if (job.requirements) {
      if (job.requirements.minExperience && worker.experiences.length === 0) {
        warnings.push('No experience listed');
      }

      if (job.requiredSkills?.length > 0) {
        const workerSkillNames = worker.skills.map(s => s.name);
        const missingSkills = job.requiredSkills.filter(
          skill => !workerSkillNames.includes(skill)
        );
        if (missingSkills.length > 0) {
          warnings.push(`Missing skills: ${missingSkills.join(', ')}`);
        }
      }
    }

    // Check screening questions
    if (job.screeningQuestions?.length > 0) {
      for (const question of job.screeningQuestions) {
        if (question.required && !data.answers?.[question.id]) {
          errors.push(`Required question not answered: ${question.text}`);
        }
      }
    }

    // Check application limits
    if (existingApplications >= 30) {
      warnings.push('High number of applications in last 30 days');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      job,
      worker,
    };
  }

  async calculateKFNScore(jobId, workerId, data) {
    const [job, worker] = await Promise.all([
      this.prisma.job.findUnique({
        where: { id: jobId },
        include: {
          requirements: true,
          skills: true,
        },
      }),
      this.prisma.worker.findUnique({
        where: { id: workerId },
        include: {
          skills: true,
          experiences: true,
          education: true,
        },
      }),
    ]);

    let score = 50; // Base score

    // Skill match (0-20 points)
    const jobSkills = job.skills || [];
    const workerSkills = worker.skills || [];
    const matchedSkills = workerSkills.filter(ws => 
      jobSkills.some(js => js.name.toLowerCase() === ws.name.toLowerCase())
    );
    score += (matchedSkills.length / Math.max(jobSkills.length, 1)) * 20;

    // Experience match (0-15 points)
    if (job.requirements?.minExperience) {
      const totalExperience = worker.experiences.reduce((sum, exp) => {
        const start = new Date(exp.startDate);
        const end = exp.endDate ? new Date(exp.endDate) : new Date();
        return sum + (end.getFullYear() - start.getFullYear());
      }, 0);
      
      if (totalExperience >= job.requirements.minExperience) {
        score += 15;
      } else {
        score += (totalExperience / job.requirements.minExperience) * 15;
      }
    }

    // Education match (0-10 points)
    if (job.requirements?.educationLevel) {
      const educationLevels = {
        'HIGH_SCHOOL': 1,
        'ASSOCIATE': 2,
        'BACHELOR': 3,
        'MASTER': 4,
        'PHD': 5,
      };
      
      const workerEducation = Math.max(
        ...worker.education.map(e => educationLevels[e.level] || 0)
      );
      const requiredEducation = educationLevels[job.requirements.educationLevel] || 0;
      
      if (workerEducation >= requiredEducation) {
        score += 10;
      } else {
        score += (workerEducation / requiredEducation) * 10;
      }
    }

    // Location match (0-10 points)
    if (job.location && worker.preferences?.location) {
      if (this.isLocationMatch(job.location, worker.preferences.location)) {
        score += 10;
      }
    }

    // Resume quality (0-15 points)
    const resumeScore = await this.analyzeResumeQuality(data.resumeText || data.resumeUrl);
    score += resumeScore;

    // Application completeness (0-10 points)
    const completeness = this.calculateApplicationCompleteness(data);
    score += completeness;

    // Recent activity bonus (0-5 points)
    const recentActivity = await this.getWorkerRecentActivity(workerId);
    score += recentActivity;

    return Math.min(Math.max(score, 0), 100);
  }

  async analyzeResumeQuality(resumeContent) {
    if (!resumeContent) return 0;

    let score = 0;
    
    // Check length
    const wordCount = resumeContent.split(/\s+/).length;
    if (wordCount >= 300 && wordCount <= 800) {
      score += 5; // Optimal length
    } else if (wordCount > 800) {
      score += 2; // Too long
    } else if (wordCount > 100) {
      score += 3; // Too short but has content
    }

    // Check sections
    const sections = ['experience', 'education', 'skills', 'summary'];
    const hasSection = sections.filter(section => 
      resumeContent.toLowerCase().includes(section)
    ).length;
    score += (hasSection / sections.length) * 5;

    // Check keywords
    const keywords = ['achieved', 'improved', 'managed', 'developed', 'led'];
    const foundKeywords = keywords.filter(keyword => 
      resumeContent.toLowerCase().includes(keyword)
    ).length;
    score += (foundKeywords / keywords.length) * 5;

    return score;
  }

  calculateApplicationCompleteness(data) {
    let score = 0;
    const fields = ['resume', 'coverLetter', 'answers'];

    fields.forEach(field => {
      if (data[field]) {
        if (field === 'answers' && Object.keys(data.answers).length > 0) {
          score += 3;
        } else if (field === 'coverLetter' && data.coverLetter.trim().length > 50) {
          score += 4;
        } else if (field === 'resume') {
          score += 3;
        }
      }
    });

    return Math.min(score, 10);
  }

  // APPLICATION MANAGEMENT
  async getApplication(applicationId) {
    const cacheKey = `application:${applicationId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: {
          include: {
            employer: true,
          },
        },
        worker: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
              },
            },
          },
        },
        interviews: {
          orderBy: { scheduledAt: 'desc' },
          take: 5,
        },
        feedback: true,
        notes: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    if (application) {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(application));
    }

    return application;
  }

  async updateApplicationStatus(applicationId, status, userId, reason = '') {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });

    if (!application) {
      throw new Error('Application not found');
    }

    const validTransitions = {
      'SUBMITTED': ['UNDER_REVIEW', 'REJECTED', 'WITHDRAWN'],
      'UNDER_REVIEW': ['INTERVIEWING', 'REJECTED', 'WITHDRAWN'],
      'INTERVIEWING': ['OFFERED', 'REJECTED', 'WITHDRAWN'],
      'OFFERED': ['ACCEPTED', 'REJECTED', 'WITHDRAWN'],
      'ACCEPTED': ['HIRED'],
      'REJECTED': [],
      'WITHDRAWN': [],
      'HIRED': [],
    };

    if (!validTransitions[application.status]?.includes(status)) {
      throw new Error(`Invalid status transition from ${application.status} to ${status}`);
    }

    const updated = await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        status,
        metadata: {
          ...application.metadata,
          statusUpdatedAt: new Date().toISOString(),
          statusUpdatedBy: userId,
          statusChangeReason: reason,
        },
        timeline: [
          ...(application.timeline || []),
          {
            action: 'STATUS_CHANGE',
            timestamp: new Date(),
            status,
            updatedBy: userId,
            reason,
          },
        ],
      },
    });

    // Clear cache
    await this.redis.del(`application:${applicationId}`);

    // Notify worker
    await this.notifyStatusChange(applicationId, status, reason);

    // Update analytics
    await this.updateApplicationAnalytics(applicationId, status);

    return updated;
  }

  async addApplicationNote(applicationId, userId, content, visibility = 'INTERNAL') {
    const note = await this.prisma.applicationNote.create({
      data: {
        applicationId,
        userId,
        content,
        visibility,
        createdAt: new Date(),
      },
    });

    // Update application timeline
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        timeline: {
          push: {
            action: 'NOTE_ADDED',
            timestamp: new Date(),
            noteId: note.id,
            addedBy: userId,
            visibility,
          },
        },
      },
    });

    // Clear cache
    await this.redis.del(`application:${applicationId}`);

    return note;
  }

  async addApplicationFeedback(applicationId, userId, rating, comments, categories = []) {
    const feedback = await this.prisma.applicationFeedback.create({
      data: {
        applicationId,
        userId,
        rating,
        comments,
        categories,
        createdAt: new Date(),
      },
    });

    // Update application metadata
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        metadata: {
          feedbackReceived: true,
          lastFeedbackAt: new Date().toISOString(),
        },
      },
    });

    // Recalculate KFN score with feedback
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });

    const newKFNScore = await this.recalculateKFNScoreWithFeedback(application, feedback);
    
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        kfnScore: newKFNScore,
      },
    });

    return feedback;
  }

  async recalculateKFNScoreWithFeedback(application, feedback) {
    let score = application.kfnScore || 50;
    
    // Adjust based on feedback rating (0-5 scale)
    const ratingAdjustment = (feedback.rating - 3) * 5; // -10 to +10
    score += ratingAdjustment;

    // Category adjustments
    if (feedback.categories.includes('STRONG_SKILL_MATCH')) {
      score += 5;
    }
    if (feedback.categories.includes('WEAK_EXPERIENCE')) {
      score -= 7;
    }
    if (feedback.categories.includes('EXCELLENT_COMMUNICATION')) {
      score += 8;
    }

    return Math.min(Math.max(score, 0), 100);
  }

  // APPLICATION SEARCH & FILTERING
  async searchApplications(filters, pagination = { page: 1, limit: 20 }) {
    const {
      jobId,
      employerId,
      workerId,
      status,
      minKfnScore,
      maxKfnScore,
      dateFrom,
      dateTo,
      hasFeedback,
      hasInterview,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
    } = filters;

    const where = {};

    if (jobId) where.jobId = jobId;
    if (employerId) where.job = { employerId };
    if (workerId) where.workerId = workerId;
    if (status) where.status = status;
    if (minKfnScore) where.kfnScore = { gte: minKfnScore };
    if (maxKfnScore) where.kfnScore = { ...where.kfnScore, lte: maxKfnScore };
    if (dateFrom) where.createdAt = { gte: new Date(dateFrom) };
    if (dateTo) where.createdAt = { ...where.createdAt, lte: new Date(dateTo) };
    if (hasFeedback !== undefined) {
      where.feedback = hasFeedback ? { some: {} } : { none: {} };
    }
    if (hasInterview !== undefined) {
      where.interviews = hasInterview ? { some: {} } : { none: {} };
    }

    // Text search
    if (search) {
      where.OR = [
        {
          worker: {
            user: {
              OR: [
                { firstName: { contains: search, mode: 'insensitive' } },
                { lastName: { contains: search, mode: 'insensitive' } },
                { email: { contains: search, mode: 'insensitive' } },
              ],
            },
          },
        },
        {
          data: {
            path: ['coverLetter'],
            string_contains: search,
          },
        },
      ];
    }

    const [applications, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
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
              user: {
                select: {
                  firstName: true,
                  lastName: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              interviews: true,
              feedback: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.application.count({ where }),
    ]);

    return {
      applications,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async getApplicationStatistics(employerId, period = '30_DAYS') {
    const startDate = this.getPeriodStartDate(period);
    
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where: {
        job: { employerId },
        createdAt: { gte: startDate },
      },
      _count: { id: true },
      _avg: { kfnScore: true },
    });

    const timeSeries = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        AVG(kfn_score) as avg_score
      FROM applications
      WHERE job_id IN (
        SELECT id FROM jobs WHERE employer_id = ${employerId}
      )
        AND created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    const sources = await this.prisma.application.groupBy({
      by: ['metadata.source'],
      where: {
        job: { employerId },
        createdAt: { gte: startDate },
      },
      _count: { id: true },
    });

    return {
      total: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      byStatus: stats.reduce((acc, stat) => {
        acc[stat.status] = {
          count: stat._count.id,
          avgScore: stat._avg.kfnScore,
        };
        return acc;
      }, {}),
      timeSeries,
      sources: sources.reduce((acc, source) => {
        acc[source.metadata?.source || 'UNKNOWN'] = source._count.id;
        return acc;
      }, {}),
      conversionRate: await this.calculateApplicationConversionRate(employerId, startDate),
      avgProcessingTime: await this.calculateAvgProcessingTime(employerId, startDate),
    };
  }

  async calculateApplicationConversionRate(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status IN ('HIRED', 'ACCEPTED') THEN 1 ELSE 0 END) as hired
      FROM applications
      WHERE job_id IN (
        SELECT id FROM jobs WHERE employer_id = ${employerId}
      )
        AND created_at >= ${startDate}
    `;

    const total = parseInt(result[0].total) || 0;
    const hired = parseInt(result[0].hired) || 0;

    return total > 0 ? hired / total : 0;
  }

  async calculateAvgProcessingTime(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (updated_at - created_at)) / 86400) as avg_days
      FROM applications
      WHERE job_id IN (
        SELECT id FROM jobs WHERE employer_id = ${employerId}
      )
        AND created_at >= ${startDate}
        AND status IN ('HIRED', 'REJECTED', 'WITHDRAWN')
    `;

    return result[0]?.avg_days || 0;
  }

  // APPLICATION ANALYTICS
  async getApplicationAnalytics(applicationId) {
    const analytics = await this.redis.get(`application:analytics:${applicationId}`);
    
    if (analytics) {
      return JSON.parse(analytics);
    }

    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        worker: true,
        interviews: true,
        feedback: true,
        notes: true,
      },
    });

    const analyticsData = {
      applicationId,
      kfnScore: application.kfnScore,
      timeline: application.timeline,
      engagement: await this.calculateEngagementMetrics(applicationId),
      matchAnalysis: await this.analyzeJobMatch(application.job, application.worker),
      feedbackSummary: this.summarizeFeedback(application.feedback),
      interviewPerformance: await this.analyzeInterviewPerformance(applicationId),
      predictedOutcome: await this.predictApplicationOutcome(application),
      recommendations: this.generateRecommendations(application),
    };

    await this.redis.setex(
      `application:analytics:${applicationId}`,
      this.CACHE_TTL / 2, // 30 minutes
      JSON.stringify(analyticsData)
    );

    return analyticsData;
  }

  async calculateEngagementMetrics(applicationId) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        timeline: true,
        notes: true,
        interviews: true,
      },
    });

    const metrics = {
      responseTime: null,
      noteCount: application.notes.length,
      interviewCount: application.interviews.length,
      timelineEvents: application.timeline?.length || 0,
    };

    // Calculate average response time between employer actions
    const employerEvents = application.timeline?.filter(event => 
      ['STATUS_CHANGE', 'NOTE_ADDED', 'INTERVIEW_SCHEDULED'].includes(event.action)
    ) || [];

    if (employerEvents.length > 1) {
      let totalResponseTime = 0;
      for (let i = 1; i < employerEvents.length; i++) {
        const timeDiff = new Date(employerEvents[i].timestamp) - 
                       new Date(employerEvents[i-1].timestamp);
        totalResponseTime += timeDiff;
      }
      metrics.responseTime = totalResponseTime / (employerEvents.length - 1);
    }

    return metrics;
  }

  async analyzeJobMatch(job, worker) {
    const analysis = {
      skillMatch: this.calculateSkillMatch(job.skills, worker.skills),
      experienceMatch: this.calculateExperienceMatch(job.requirements, worker.experiences),
      educationMatch: this.calculateEducationMatch(job.requirements, worker.education),
      locationMatch: this.isLocationMatch(job.location, worker.preferences?.location),
      salaryExpectationMatch: this.calculateSalaryMatch(job.salaryRange, worker.preferences?.salaryRange),
      overallScore: 0,
    };

    // Calculate overall match score
    analysis.overallScore = (
      analysis.skillMatch.score * 0.4 +
      analysis.experienceMatch.score * 0.3 +
      analysis.educationMatch.score * 0.2 +
      (analysis.locationMatch ? 0.1 : 0)
    );

    return analysis;
  }

  calculateSkillMatch(jobSkills, workerSkills) {
    if (!jobSkills?.length || !workerSkills?.length) {
      return { score: 0, matched: [], missing: [] };
    }

    const jobSkillNames = jobSkills.map(s => s.name.toLowerCase());
    const workerSkillNames = workerSkills.map(s => s.name.toLowerCase());

    const matched = workerSkillNames.filter(skill => 
      jobSkillNames.includes(skill)
    );
    const missing = jobSkillNames.filter(skill => 
      !workerSkillNames.includes(skill)
    );

    return {
      score: matched.length / jobSkillNames.length,
      matched,
      missing,
    };
  }

  calculateExperienceMatch(requirements, experiences) {
    if (!requirements?.minExperience) {
      return { score: 1, meetsRequirement: true };
    }

    const totalExperience = experiences.reduce((sum, exp) => {
      const start = new Date(exp.startDate);
      const end = exp.endDate ? new Date(exp.endDate) : new Date();
      return sum + (end.getFullYear() - start.getFullYear());
    }, 0);

    return {
      score: Math.min(totalExperience / requirements.minExperience, 1),
      meetsRequirement: totalExperience >= requirements.minExperience,
      totalExperience,
      requiredExperience: requirements.minExperience,
    };
  }

  calculateEducationMatch(requirements, education) {
    if (!requirements?.educationLevel) {
      return { score: 1, meetsRequirement: true };
    }

    const educationLevels = {
      'HIGH_SCHOOL': 1,
      'ASSOCIATE': 2,
      'BACHELOR': 3,
      'MASTER': 4,
      'PHD': 5,
    };

    const workerEducation = Math.max(
      ...education.map(e => educationLevels[e.level] || 0)
    );
    const requiredEducation = educationLevels[requirements.educationLevel] || 0;

    return {
      score: Math.min(workerEducation / requiredEducation, 1),
      meetsRequirement: workerEducation >= requiredEducation,
      workerEducation,
      requiredEducation,
    };
  }

  isLocationMatch(jobLocation, workerLocation) {
    if (!jobLocation || !workerLocation) return true; // No preference
    
    // Simple location matching - in production, use geocoding service
    return jobLocation.city === workerLocation.city &&
           jobLocation.country === workerLocation.country;
  }

  calculateSalaryMatch(jobSalaryRange, workerSalaryRange) {
    if (!jobSalaryRange || !workerSalaryRange) {
      return { score: 1, match: true };
    }

    const jobAvg = (jobSalaryRange.min + jobSalaryRange.max) / 2;
    const workerAvg = (workerSalaryRange.min + workerSalaryRange.max) / 2;

    const difference = Math.abs(jobAvg - workerAvg);
    const maxDifference = Math.max(jobAvg, workerAvg) * 0.2; // 20% tolerance

    return {
      score: Math.max(1 - (difference / maxDifference), 0),
      match: difference <= maxDifference,
      jobAvg,
      workerAvg,
      difference,
    };
  }

  summarizeFeedback(feedback) {
    if (!feedback?.length) {
      return null;
    }

    const summary = {
      averageRating: 0,
      categories: {},
      comments: [],
      strengths: [],
      weaknesses: [],
    };

    let totalRating = 0;
    feedback.forEach(f => {
      totalRating += f.rating;
      summary.comments.push(f.comments);

      f.categories?.forEach(category => {
        summary.categories[category] = (summary.categories[category] || 0) + 1;
      });
    });

    summary.averageRating = totalRating / feedback.length;

    // Identify strengths and weaknesses based on categories
    Object.entries(summary.categories).forEach(([category, count]) => {
      if (count >= feedback.length / 2) {
        if (category.includes('STRONG') || category.includes('EXCELLENT')) {
          summary.strengths.push(category);
        } else if (category.includes('WEAK') || category.includes('NEEDS')) {
          summary.weaknesses.push(category);
        }
      }
    });

    return summary;
  }

  async analyzeInterviewPerformance(applicationId) {
    const interviews = await this.prisma.interview.findMany({
      where: { applicationId },
      include: {
        feedback: true,
      },
    });

    if (interviews.length === 0) {
      return null;
    }

    const performance = {
      totalInterviews: interviews.length,
      completedInterviews: interviews.filter(i => i.status === 'COMPLETED').length,
      averageRating: 0,
      interviewerFeedback: [],
      skillAssessments: {},
    };

    let totalRating = 0;
    let ratedInterviews = 0;

    interviews.forEach(interview => {
      if (interview.feedback?.rating) {
        totalRating += interview.feedback.rating;
        ratedInterviews++;
      }

      if (interview.feedback?.comments) {
        performance.interviewerFeedback.push(interview.feedback.comments);
      }

      // Extract skill assessments from feedback
      if (interview.feedback?.skillAssessments) {
        interview.feedback.skillAssessments.forEach(assessment => {
          if (!performance.skillAssessments[assessment.skill]) {
            performance.skillAssessments[assessment.skill] = [];
          }
          performance.skillAssessments[assessment.skill].push(assessment.rating);
        });
      }
    });

    performance.averageRating = ratedInterviews > 0 ? totalRating / ratedInterviews : 0;

    // Calculate average per skill
    Object.keys(performance.skillAssessments).forEach(skill => {
      const ratings = performance.skillAssessments[skill];
      performance.skillAssessments[skill] = {
        average: ratings.reduce((a, b) => a + b, 0) / ratings.length,
        count: ratings.length,
      };
    });

    return performance;
  }

  async predictApplicationOutcome(application) {
    const factors = {
      kfnScore: application.kfnScore / 100,
      engagement: await this.calculateEngagementScore(application.id),
      interviewPerformance: await this.getInterviewScore(application.id),
      timeInPipeline: this.calculateTimeInPipeline(application),
      competition: await this.getCompetitionLevel(application.jobId),
    };

    // Weighted prediction model
    const predictionScore = (
      factors.kfnScore * 0.3 +
      factors.engagement * 0.2 +
      factors.interviewPerformance * 0.3 +
      (1 - Math.min(factors.timeInPipeline / 30, 1)) * 0.1 +
      (1 - factors.competition) * 0.1
    );

    const confidence = this.calculatePredictionConfidence(factors);

    return {
      score: predictionScore,
      confidence,
      factors,
      predictedOutcome: predictionScore > 0.7 ? 'HIRED' : 
                       predictionScore > 0.4 ? 'UNDER_REVIEW' : 'REJECTED',
      recommendedActions: this.generateOutcomeRecommendations(factors),
    };
  }

  async calculateEngagementScore(applicationId) {
    const metrics = await this.calculateEngagementMetrics(applicationId);
    
    let score = 0.5; // Base score
    
    // Positive factors
    if (metrics.noteCount > 0) score += 0.1;
    if (metrics.interviewCount > 0) score += 0.2;
    if (metrics.responseTime && metrics.responseTime < 48 * 60 * 60 * 1000) { // 48 hours
      score += 0.2;
    }

    return Math.min(score, 1);
  }

  async getInterviewScore(applicationId) {
    const performance = await this.analyzeInterviewPerformance(applicationId);
    
    if (!performance || performance.completedInterviews === 0) {
      return 0.5; // Neutral score if no interviews
    }

    return performance.averageRating / 5; // Normalize to 0-1
  }

  calculateTimeInPipeline(application) {
    const now = new Date();
    const created = new Date(application.createdAt);
    const days = (now - created) / (1000 * 60 * 60 * 24);
    
    return Math.min(days / 90, 1); // Normalize to 0-1 over 90 days
  }

  async getCompetitionLevel(jobId) {
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where: { jobId },
      _count: { id: true },
    });

    const totalApplications = stats.reduce((sum, stat) => sum + stat._count.id, 0);
    const activeApplications = stats
      .filter(stat => ['UNDER_REVIEW', 'INTERVIEWING', 'OFFERED'].includes(stat.status))
      .reduce((sum, stat) => sum + stat._count.id, 0);

    return totalApplications > 0 ? activeApplications / totalApplications : 0;
  }

  calculatePredictionConfidence(factors) {
    let confidence = 0.5;
    
    // More data = higher confidence
    if (factors.interviewPerformance > 0) confidence += 0.3;
    if (factors.engagement > 0.5) confidence += 0.1;
    
    // Consistency = higher confidence
    const consistency = Math.abs(factors.kfnScore - factors.interviewPerformance);
    confidence += (1 - consistency) * 0.1;
    
    return Math.min(confidence, 0.9);
  }

  generateOutcomeRecommendations(factors) {
    const recommendations = [];
    
    if (factors.kfnScore < 0.6) {
      recommendations.push({
        action: 'REVIEW_SKILLS',
        priority: 'HIGH',
        description: 'Candidate has low skill match score',
      });
    }
    
    if (factors.engagement < 0.3) {
      recommendations.push({
        action: 'INCREASE_ENGAGEMENT',
        priority: 'MEDIUM',
        description: 'Low engagement with candidate',
      });
    }
    
    if (factors.interviewPerformance === 0) {
      recommendations.push({
        action: 'SCHEDULE_INTERVIEW',
        priority: 'HIGH',
        description: 'No interviews conducted yet',
      });
    }
    
    if (factors.timeInPipeline > 0.7) {
      recommendations.push({
        action: 'ACCELERATE_PROCESS',
        priority: 'MEDIUM',
        description: 'Application has been in pipeline for too long',
      });
    }
    
    return recommendations;
  }

  generateRecommendations(application) {
    const recommendations = [];
    
    // Based on KFN score
    if (application.kfnScore < 70) {
      recommendations.push({
        type: 'SCORE_IMPROVEMENT',
        priority: 'HIGH',
        action: 'Request additional information or assessment',
        reason: `KFN score is ${application.kfnScore}, below threshold of 70`,
      });
    }
    
    // Based on timeline
    const daysSinceSubmission = (new Date() - new Date(application.createdAt)) / (1000 * 60 * 60 * 24);
    if (daysSinceSubmission > 14 && application.status === 'SUBMITTED') {
      recommendations.push({
        type: 'FOLLOW_UP',
        priority: 'MEDIUM',
        action: 'Follow up with candidate',
        reason: 'Application submitted over 14 days ago',
      });
    }
    
    // Based on missing information
    if (!application.data?.answers && application.job?.screeningQuestions?.length > 0) {
      recommendations.push({
        type: 'REQUEST_ANSWERS',
        priority: 'MEDIUM',
        action: 'Request answers to screening questions',
        reason: 'Screening questions not answered',
      });
    }
    
    return recommendations;
  }

  // APPLICATION AUTOMATION
  async autoScreenApplications(jobId, criteria) {
    const applications = await this.prisma.application.findMany({
      where: {
        jobId,
        status: 'SUBMITTED',
        createdAt: {
          gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        },
      },
      include: {
        worker: {
          include: {
            skills: true,
            experiences: true,
            education: true,
          },
        },
      },
      take: 1000,
    });

    const results = {
      total: applications.length,
      passed: 0,
      failed: 0,
      flagged: 0,
      decisions: [],
    };

    for (const application of applications) {
      const decision = await this.evaluateAgainstCriteria(application, criteria);
      results.decisions.push(decision);

      if (decision.status === 'PASSED') {
        results.passed++;
        await this.updateApplicationStatus(
          application.id,
          'UNDER_REVIEW',
          'system',
          'Auto-screened: passed criteria'
        );
      } else if (decision.status === 'FAILED') {
        results.failed++;
        await this.updateApplicationStatus(
          application.id,
          'REJECTED',
          'system',
          `Auto-screened: ${decision.reasons.join(', ')}`
        );
      } else {
        results.flagged++;
        await this.addApplicationNote(
          application.id,
          'system',
          `Auto-screened: requires manual review. Reasons: ${decision.reasons.join(', ')}`,
          'INTERNAL'
        );
      }
    }

    return results;
  }

  async evaluateAgainstCriteria(application, criteria) {
    const evaluation = {
      status: 'PENDING',
      reasons: [],
      score: 0,
      details: {},
    };

    let totalScore = 0;
    let maxScore = 0;

    // Minimum KFN score
    if (criteria.minKfnScore) {
      maxScore++;
      if (application.kfnScore >= criteria.minKfnScore) {
        totalScore++;
        evaluation.details.kfnScore = { passed: true, value: application.kfnScore };
      } else {
        evaluation.reasons.push(`KFN score ${application.kfnScore} below minimum ${criteria.minKfnScore}`);
        evaluation.details.kfnScore = { passed: false, value: application.kfnScore };
      }
    }

    // Required skills
    if (criteria.requiredSkills?.length > 0) {
      const workerSkills = application.worker.skills.map(s => s.name.toLowerCase());
      const missingSkills = criteria.requiredSkills.filter(
        skill => !workerSkills.includes(skill.toLowerCase())
      );
      
      maxScore++;
      if (missingSkills.length === 0) {
        totalScore++;
        evaluation.details.requiredSkills = { passed: true, matched: criteria.requiredSkills };
      } else {
        evaluation.reasons.push(`Missing required skills: ${missingSkills.join(', ')}`);
        evaluation.details.requiredSkills = { passed: false, missing: missingSkills };
      }
    }

    // Minimum experience
    if (criteria.minExperience) {
      const totalExperience = application.worker.experiences.reduce((sum, exp) => {
        const start = new Date(exp.startDate);
        const end = exp.endDate ? new Date(exp.endDate) : new Date();
        return sum + (end.getFullYear() - start.getFullYear());
      }, 0);
      
      maxScore++;
      if (totalExperience >= criteria.minExperience) {
        totalScore++;
        evaluation.details.experience = { passed: true, years: totalExperience };
      } else {
        evaluation.reasons.push(`Experience ${totalExperience} years below minimum ${criteria.minExperience}`);
        evaluation.details.experience = { passed: false, years: totalExperience };
      }
    }

    // Location requirements
    if (criteria.location) {
      const workerLocation = application.worker.preferences?.location;
      maxScore++;
      
      if (this.isLocationMatch(criteria.location, workerLocation)) {
        totalScore++;
        evaluation.details.location = { passed: true, match: true };
      } else {
        evaluation.reasons.push('Location mismatch');
        evaluation.details.location = { passed: false, workerLocation, requiredLocation: criteria.location };
      }
    }

    // Calculate overall score
    evaluation.score = maxScore > 0 ? totalScore / maxScore : 0;

    // Determine status
    if (evaluation.score >= 0.8) {
      evaluation.status = 'PASSED';
    } else if (evaluation.score >= 0.5) {
      evaluation.status = 'FLAGGED';
    } else {
      evaluation.status = 'FAILED';
    }

    return evaluation;
  }

  async batchUpdateApplications(applicationIds, updates, userId) {
    const results = {
      updated: 0,
      failed: 0,
      errors: [],
    };

    for (const applicationId of applicationIds) {
      try {
        await this.prisma.application.update({
          where: { id: applicationId },
          data: {
            ...updates,
            metadata: {
              ...(await this.prisma.application.findUnique({ where: { id: applicationId } })).metadata,
              batchUpdatedAt: new Date().toISOString(),
              batchUpdatedBy: userId,
            },
          },
        });
        
        results.updated++;
        
        // Clear cache
        await this.redis.del(`application:${applicationId}`);
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          applicationId,
          error: error.message,
        });
      }
    }

    return results;
  }

  // APPLICATION EXPORT
  async exportApplications(filters, format = 'CSV') {
    const applications = await this.prisma.application.findMany({
      where: this.buildExportFilters(filters),
      include: {
        job: {
          select: {
            title: true,
            department: true,
            location: true,
            salaryRange: true,
          },
        },
        worker: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
              },
            },
            skills: {
              select: {
                name: true,
                level: true,
              },
            },
            experiences: {
              select: {
                title: true,
                company: true,
                startDate: true,
                endDate: true,
              },
            },
          },
        },
        interviews: {
          select: {
            type: true,
            scheduledAt: true,
            status: true,
            feedback: true,
          },
        },
        feedback: {
          select: {
            rating: true,
            comments: true,
            createdAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    switch (format) {
      case 'CSV':
        return this.convertToCSV(applications);
      case 'JSON':
        return applications;
      case 'EXCEL':
        return this.convertToExcel(applications);
      default:
        return applications;
    }
  }

  buildExportFilters(filters) {
    const where = {};
    
    if (filters.jobId) where.jobId = filters.jobId;
    if (filters.employerId) where.job = { employerId: filters.employerId };
    if (filters.status) where.status = filters.status;
    if (filters.dateFrom) where.createdAt = { gte: new Date(filters.dateFrom) };
    if (filters.dateTo) where.createdAt = { lte: new Date(filters.dateTo) };
    if (filters.minKfnScore) where.kfnScore = { gte: filters.minKfnScore };
    
    return where;
  }

  convertToCSV(applications) {
    const headers = [
      'Application ID',
      'Job Title',
      'Candidate Name',
      'Candidate Email',
      'Status',
      'KFN Score',
      'Submitted Date',
      'Last Updated',
      'Skills',
      'Experience',
      'Interviews',
      'Average Feedback Rating',
    ];

    const rows = applications.map(app => {
      const candidateName = `${app.worker.user.firstName} ${app.worker.user.lastName}`;
      const skills = app.worker.skills.map(s => s.name).join('; ');
      const experience = app.worker.experiences
        .map(exp => `${exp.title} at ${exp.company}`)
        .join('; ');
      const interviews = app.interviews.length;
      const avgRating = app.feedback.length > 0 
        ? app.feedback.reduce((sum, f) => sum + f.rating, 0) / app.feedback.length
        : 'N/A';

      return [
        app.id,
        app.job.title,
        candidateName,
        app.worker.user.email,
        app.status,
        app.kfnScore,
        app.createdAt,
        app.updatedAt,
        skills,
        experience,
        interviews,
        avgRating,
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    return csvContent;
  }

  // CACHE MANAGEMENT
  async clearApplicationCaches(jobId, workerId) {
    const patterns = [
      `application:*:${jobId}`,
      `application:*:${workerId}`,
      `applications:stats:*`,
      `applications:search:*`,
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  async updateApplicationAnalytics(applicationId, newStatus) {
    const analyticsKey = `application:analytics:${applicationId}`;
    await this.redis.del(analyticsKey);
    
    // Update aggregate statistics
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      select: { jobId: true, workerId: true },
    });
    
    if (application) {
      await this.updateJobApplicationStats(application.jobId);
      await this.updateWorkerApplicationStats(application.workerId);
    }
  }

  async updateJobApplicationStats(jobId) {
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where: { jobId },
      _count: { id: true },
    });

    await this.redis.setex(
      `job:${jobId}:application_stats`,
      this.CACHE_TTL,
      JSON.stringify(stats)
    );
  }

  async updateWorkerApplicationStats(workerId) {
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where: { workerId },
      _count: { id: true },
    });

    await this.redis.setex(
      `worker:${workerId}:application_stats`,
      this.CACHE_TTL,
      JSON.stringify(stats)
    );
  }

  // NOTIFICATIONS
  async notifyNewApplication(jobId, applicationId) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: {
          include: {
            employer: {
              include: {
                user: true,
              },
            },
          },
        },
        worker: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!application) return;

    // Notify employer
    await this.prisma.notification.create({
      data: {
        userId: application.job.employer.user.id,
        type: 'NEW_APPLICATION',
        title: 'New Application Received',
        message: `${application.worker.user.firstName} ${application.worker.user.lastName} applied for "${application.job.title}"`,
        metadata: {
          jobId,
          applicationId,
          candidateName: `${application.worker.user.firstName} ${application.worker.user.lastName}`,
          kfnScore: application.kfnScore,
        },
        priority: 'HIGH',
      },
    });

    // Notify hiring team if exists
    const hiringTeam = await this.prisma.teamMember.findMany({
      where: {
        team: {
          jobs: {
            some: { id: jobId },
          },
        },
      },
      include: {
        user: true,
      },
    });

    for (const member of hiringTeam) {
      await this.prisma.notification.create({
        data: {
          userId: member.userId,
          type: 'NEW_APPLICATION',
          title: 'New Application Received',
          message: `New application for job "${application.job.title}"`,
          metadata: {
            jobId,
            applicationId,
          },
          priority: 'MEDIUM',
        },
      });
    }
  }

  async notifyStatusChange(applicationId, newStatus, reason) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: {
          select: {
            title: true,
          },
        },
        worker: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!application) return;

    const statusMessages = {
      'UNDER_REVIEW': 'Your application is under review',
      'INTERVIEWING': 'You have been selected for an interview',
      'OFFERED': 'Congratulations! You have received an offer',
      'REJECTED': 'Update on your application',
      'WITHDRAWN': 'Your application has been withdrawn',
      'HIRED': 'Congratulations! You have been hired',
    };

    await this.prisma.notification.create({
      data: {
        userId: application.worker.user.id,
        type: 'APPLICATION_STATUS_CHANGE',
        title: statusMessages[newStatus] || 'Application Status Update',
        message: `Your application for "${application.job.title}" is now ${newStatus}. ${reason ? `Reason: ${reason}` : ''}`,
        metadata: {
          applicationId,
          jobId: application.jobId,
          newStatus,
          reason,
        },
        priority: newStatus === 'OFFERED' || newStatus === 'HIRED' ? 'HIGH' : 'MEDIUM',
      },
    });
  }

  // SEARCH INDEXING
  async indexApplicationInElasticsearch(application) {
    if (!this.es) return;

    try {
      await this.es.index({
        index: 'applications',
        id: application.id,
        body: {
          id: application.id,
          jobId: application.jobId,
          workerId: application.workerId,
          status: application.status,
          kfnScore: application.kfnScore,
          submittedAt: application.createdAt,
          updatedAt: application.updatedAt,
          data: application.data,
          metadata: application.metadata,
        },
      });
    } catch (error) {
      console.error('Failed to index application:', error);
    }
  }

  async searchApplicationsInElasticsearch(query, filters = {}) {
    if (!this.es) return { applications: [], total: 0 };

    const esQuery = {
      bool: {
        must: [],
        filter: [],
      },
    };

    if (query) {
      esQuery.bool.must.push({
        multi_match: {
          query,
          fields: [
            'data.coverLetter',
            'data.answers^2',
            'metadata.source',
          ],
          fuzziness: 'AUTO',
        },
      });
    }

    if (filters.jobId) {
      esQuery.bool.filter.push({ term: { jobId: filters.jobId } });
    }
    if (filters.status) {
      esQuery.bool.filter.push({ term: { status: filters.status } });
    }
    if (filters.minKfnScore) {
      esQuery.bool.filter.push({ range: { kfnScore: { gte: filters.minKfnScore } } });
    }
    if (filters.dateFrom) {
      esQuery.bool.filter.push({ range: { submittedAt: { gte: filters.dateFrom } } });
    }
    if (filters.dateTo) {
      esQuery.bool.filter.push({ range: { submittedAt: { lte: filters.dateTo } } });
    }

    const result = await this.es.search({
      index: 'applications',
      body: {
        query: esQuery,
        sort: [
          { kfnScore: { order: 'desc' } },
          { submittedAt: { order: 'desc' } },
        ],
        from: ((filters.page || 1) - 1) * (filters.limit || 20),
        size: filters.limit || 20,
      },
    });

    return {
      applications: result.hits.hits.map(hit => hit._source),
      total: result.hits.total.value,
    };
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
      case 'QUARTER':
        return new Date(now.setMonth(now.getMonth() - 3));
      case 'YEAR':
        return new Date(now.setFullYear(now.getFullYear() - 1));
      default:
        return new Date(now.setDate(now.getDate() - 30));
    }
  }

  async getWorkerRecentActivity(workerId) {
    const activities = await this.prisma.application.count({
      where: {
        workerId,
        createdAt: {
          gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
        },
      },
    });

    // Normalize to 0-5 points
    return Math.min(activities * 0.5, 5);
  }
}

module.exports = ApplicationRepository;
