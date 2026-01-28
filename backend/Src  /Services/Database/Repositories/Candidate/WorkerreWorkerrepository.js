class CandidateRepository {
  constructor(prisma, redis, es, aiService, storageService) {
    this.prisma = prisma;
    this.redis = redis;
    this.es = es;
    this.aiService = aiService;
    this.storageService = storageService;
    this.CACHE_TTL = 3600; // 1 hour
  }

  // CANDIDATE PROFILE MANAGEMENT
  async createCandidate(userId, data) {
    // Check if candidate already exists
    const existing = await this.prisma.worker.findFirst({
      where: { userId },
    });

    if (existing) {
      throw new Error('Candidate profile already exists');
    }

    const candidate = await this.prisma.worker.create({
      data: {
        userId,
        title: data.title,
        summary: data.summary,
        location: data.location,
        phone: data.phone,
        dateOfBirth: data.dateOfBirth,
        gender: data.gender,
        nationality: data.nationality,
        visaStatus: data.visaStatus,
        availability: data.availability,
        expectedSalary: data.expectedSalary,
        noticePeriod: data.noticePeriod,
        languages: data.languages,
        certifications: data.certifications,
        portfolio: data.portfolio,
        socialLinks: data.socialLinks,
        metadata: {
          createdBy: userId,
          createdAt: new Date().toISOString(),
          profileCompleteness: this.calculateProfileCompleteness(data),
          visibility: 'PUBLIC',
          lastActive: new Date().toISOString(),
        },
        preferences: {
          jobTypes: data.preferences?.jobTypes || [],
          locations: data.preferences?.locations || [],
          remotePreference: data.preferences?.remotePreference || 'ANY',
          salaryRange: data.preferences?.salaryRange,
          industries: data.preferences?.industries || [],
          companySizes: data.preferences?.companySizes || [],
          workEnvironments: data.preferences?.workEnvironments || [],
          benefits: data.preferences?.benefits || [],
        },
      },
    });

    // Clear cache
    await this.redis.del(`user:${userId}:candidate`);

    // Index in search
    await this.indexCandidateInElasticsearch(candidate);

    return candidate;
  }

  async updateCandidate(workerId, updates, updatedBy) {
    const candidate = await this.prisma.worker.findUnique({
      where: { id: workerId },
    });

    if (!candidate) {
      throw new Error('Candidate not found');
    }

    // Calculate updated profile completeness
    const updatedData = { ...candidate, ...updates };
    const completeness = this.calculateProfileCompleteness(updatedData);

    const updated = await this.prisma.worker.update({
      where: { id: workerId },
      data: {
        ...updates,
        metadata: {
          ...candidate.metadata,
          updatedBy,
          updatedAt: new Date().toISOString(),
          profileCompleteness: completeness,
          updateHistory: [
            ...(candidate.metadata?.updateHistory || []),
            {
              updatedBy,
              updatedAt: new Date().toISOString(),
              changes: Object.keys(updates),
            },
          ],
        },
      },
    });

    // Clear caches
    await this.clearCandidateCaches(workerId, candidate.userId);

    // Re-index in search
    await this.indexCandidateInElasticsearch(updated);

    return updated;
  }

  async getCandidate(workerId, includeRelated = true) {
    const cacheKey = `candidate:${workerId}:${includeRelated}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const include = {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          avatar: true,
          phone: true,
          createdAt: true,
        },
      },
    };

    if (includeRelated) {
      include.skills = {
        include: {
          skill: true,
        },
        orderBy: { proficiency: 'desc' },
      };
      include.experiences = {
        orderBy: { startDate: 'desc' },
      };
      include.education = {
        orderBy: { endDate: 'desc' },
      };
      include.certifications = true;
      include.applications = {
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: {
          job: {
            select: {
              title: true,
              employer: {
                select: {
                  name: true,
                  logo: true,
                },
              },
            },
          },
        },
      };
      include.interviews = {
        take: 5,
        orderBy: { scheduledAt: 'desc' },
        include: {
          job: {
            select: {
              title: true,
            },
          },
        },
      };
      include._count = {
        select: {
          applications: true,
          interviews: true,
          skills: true,
          experiences: true,
        },
      };
    }

    const candidate = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include,
    });

    if (candidate) {
      // Calculate additional metrics
      candidate.metrics = await this.calculateCandidateMetrics(workerId);
      candidate.recommendations = await this.generateCandidateRecommendations(candidate);
      
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(candidate));
    }

    return candidate;
  }

  async getCandidateByUserId(userId) {
    const cacheKey = `user:${userId}:candidate`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const candidate = await this.prisma.worker.findFirst({
      where: { userId },
      include: {
        user: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            avatar: true,
          },
        },
        skills: {
          include: {
            skill: true,
          },
          take: 10,
        },
        experiences: {
          take: 5,
          orderBy: { startDate: 'desc' },
        },
      },
    });

    if (candidate) {
      await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(candidate));
    }

    return candidate;
  }

  calculateProfileCompleteness(data) {
    let score = 0;
    let total = 0;
    const weights = {
      basic: 20,
      skills: 25,
      experience: 30,
      education: 15,
      preferences: 10,
    };

    // Basic info (20 points)
    total += weights.basic;
    if (data.title) score += 5;
    if (data.summary && data.summary.length > 50) score += 5;
    if (data.location) score += 5;
    if (data.phone) score += 5;

    // Skills (25 points)
    total += weights.skills;
    if (data.skills?.length > 0) {
      score += Math.min(data.skills.length * 2, weights.skills);
    }

    // Experience (30 points)
    total += weights.experience;
    if (data.experiences?.length > 0) {
      score += Math.min(data.experiences.length * 6, weights.experience);
    }

    // Education (15 points)
    total += weights.education;
    if (data.education?.length > 0) {
      score += Math.min(data.education.length * 5, weights.education);
    }

    // Preferences (10 points)
    total += weights.preferences;
    if (data.preferences) {
      if (data.preferences.jobTypes?.length > 0) score += 3;
      if (data.preferences.locations?.length > 0) score += 3;
      if (data.preferences.salaryRange) score += 4;
    }

    return Math.round((score / total) * 100);
  }

  // SKILL MANAGEMENT
  async addSkill(workerId, skillData) {
    // Check if skill exists in system
    let skill = await this.prisma.skill.findFirst({
      where: { 
        name: { 
          equals: skillData.name,
          mode: 'insensitive'
        } 
      },
    });

    if (!skill) {
      skill = await this.prisma.skill.create({
        data: {
          name: skillData.name,
          category: skillData.category,
          metadata: {
            createdAt: new Date().toISOString(),
            createdBy: 'system',
          },
        },
      });
    }

    // Check if worker already has this skill
    const existing = await this.prisma.workerSkill.findFirst({
      where: { workerId, skillId: skill.id },
    });

    if (existing) {
      throw new Error('Skill already exists for this candidate');
    }

    const workerSkill = await this.prisma.workerSkill.create({
      data: {
        workerId,
        skillId: skill.id,
        proficiency: skillData.proficiency,
        yearsOfExperience: skillData.yearsOfExperience,
        lastUsed: skillData.lastUsed,
        projects: skillData.projects,
        certifications: skillData.certifications,
        metadata: {
          addedAt: new Date().toISOString(),
          verified: false,
        },
      },
    });

    // Clear cache
    await this.clearCandidateCaches(workerId);

    // Update skill graph
    await this.updateSkillGraph(workerId, skill.id);

    return workerSkill;
  }

  async updateSkill(workerId, skillId, updates) {
    const workerSkill = await this.prisma.workerSkill.findFirst({
      where: { workerId, skillId },
    });

    if (!workerSkill) {
      throw new Error('Skill not found for this candidate');
    }

    const updated = await this.prisma.workerSkill.update({
      where: { id: workerSkill.id },
      data: updates,
    });

    // Clear cache
    await this.clearCandidateCaches(workerId);

    return updated;
  }

  async removeSkill(workerId, skillId) {
    const workerSkill = await this.prisma.workerSkill.findFirst({
      where: { workerId, skillId },
    });

    if (!workerSkill) {
      throw new Error('Skill not found for this candidate');
    }

    await this.prisma.workerSkill.delete({
      where: { id: workerSkill.id },
    });

    // Clear cache
    await this.clearCandidateCaches(workerId);

    return { success: true };
  }

  async getSkills(workerId, filters = {}) {
    const where = { workerId };
    
    if (filters.category) {
      where.skill = { category: filters.category };
    }
    if (filters.minProficiency) {
      where.proficiency = { gte: filters.minProficiency };
    }

    const skills = await this.prisma.workerSkill.findMany({
      where,
      include: {
        skill: true,
      },
      orderBy: { proficiency: 'desc' },
    });

    return skills;
  }

  async analyzeSkillGap(workerId, targetJobId) {
    const [candidateSkills, jobSkills] = await Promise.all([
      this.getSkills(workerId),
      this.prisma.job.findUnique({
        where: { id: targetJobId },
        include: {
          skills: {
            include: {
              skill: true,
            },
          },
        },
      }).then(job => job?.skills || []),
    ]);

    const candidateSkillNames = candidateSkills.map(s => s.skill.name.toLowerCase());
    const requiredSkillNames = jobSkills.map(s => s.skill.name.toLowerCase());

    const matchedSkills = requiredSkillNames.filter(skill => 
      candidateSkillNames.includes(skill)
    );
    const missingSkills = requiredSkillNames.filter(skill => 
      !candidateSkillNames.includes(skill)
    );
    const additionalSkills = candidateSkillNames.filter(skill => 
      !requiredSkillNames.includes(skill)
    );

    // Calculate match score
    const matchScore = requiredSkillNames.length > 0 
      ? (matchedSkills.length / requiredSkillNames.length) * 100 
      : 0;

    // Identify critical skills
    const criticalSkills = jobSkills
      .filter(s => s.importance === 'REQUIRED')
      .map(s => s.skill.name.toLowerCase());

    const missingCriticalSkills = criticalSkills.filter(skill => 
      !candidateSkillNames.includes(skill)
    );

    return {
      matchScore,
      matchedSkills,
      missingSkills,
      additionalSkills,
      missingCriticalSkills,
      recommendations: this.generateSkillGapRecommendations(
        matchedSkills,
        missingSkills,
        missingCriticalSkills
      ),
    };
  }

  generateSkillGapRecommendations(matched, missing, missingCritical) {
    const recommendations = [];

    if (missingCritical.length > 0) {
      recommendations.push({
        type: 'CRITICAL_SKILL_GAP',
        priority: 'HIGH',
        message: `Missing critical skills: ${missingCritical.join(', ')}`,
        actions: [
          'Consider acquiring these skills through courses or certifications',
          'Highlight transferable skills that may compensate',
          'Gain practical experience through projects or volunteering',
        ],
      });
    }

    if (missing.length > 0) {
      recommendations.push({
        type: 'SKILL_GAP',
        priority: 'MEDIUM',
        message: `Missing ${missing.length} required skills`,
        actions: [
          'Consider online courses or certifications',
          'Look for opportunities to gain experience',
          'Network with professionals in these areas',
        ],
      });
    }

    return recommendations;
  }

  // EXPERIENCE MANAGEMENT
  async addExperience(workerId, experienceData) {
    const experience = await this.prisma.experience.create({
      data: {
        workerId,
        title: experienceData.title,
        company: experienceData.company,
        location: experienceData.location,
        startDate: experienceData.startDate,
        endDate: experienceData.endDate,
        current: experienceData.current,
        description: experienceData.description,
        achievements: experienceData.achievements,
        skillsUsed: experienceData.skillsUsed,
        metadata: {
          addedAt: new Date().toISOString(),
          verified: false,
        },
      },
    });

    // Clear cache
    await this.clearCandidateCaches(workerId);

    // Extract and add skills from experience
    await this.extractSkillsFromExperience(workerId, experience);

    return experience;
  }

  async extractSkillsFromExperience(workerId, experience) {
    const text = `${experience.title} ${experience.description} ${experience.achievements?.join(' ')}`;
    const extractedSkills = await this.aiService.extractSkills(text);

    for (const skillName of extractedSkills) {
      try {
        await this.addSkill(workerId, {
          name: skillName,
          proficiency: 'INTERMEDIATE',
          yearsOfExperience: this.calculateYearsFromExperience(experience),
          lastUsed: experience.endDate || new Date(),
        });
      } catch (error) {
        // Skill might already exist, continue
      }
    }
  }

  calculateYearsFromExperience(experience) {
    const start = new Date(experience.startDate);
    const end = experience.current ? new Date() : new Date(experience.endDate);
    const years = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    return Math.round(years * 10) / 10; // Round to 1 decimal
  }

  async updateExperience(experienceId, updates) {
    const experience = await this.prisma.experience.findUnique({
      where: { id: experienceId },
    });

    if (!experience) {
      throw new Error('Experience not found');
    }

    const updated = await this.prisma.experience.update({
      where: { id: experienceId },
      data: updates,
    });

    // Clear cache
    await this.clearCandidateCaches(experience.workerId);

    return updated;
  }

  async getExperiences(workerId, filters = {}) {
    const where = { workerId };
    
    if (filters.company) {
      where.company = { contains: filters.company, mode: 'insensitive' };
    }
    if (filters.title) {
      where.title = { contains: filters.title, mode: 'insensitive' };
    }
    if (filters.current !== undefined) {
      where.current = filters.current;
    }

    const experiences = await this.prisma.experience.findMany({
      where,
      orderBy: { startDate: 'desc' },
    });

    return experiences;
  }

  // EDUCATION MANAGEMENT
  async addEducation(workerId, educationData) {
    const education = await this.prisma.education.create({
      data: {
        workerId,
        institution: educationData.institution,
        degree: educationData.degree,
        field: educationData.field,
        startDate: educationData.startDate,
        endDate: educationData.endDate,
        grade: educationData.grade,
        description: educationData.description,
        activities: educationData.activities,
        metadata: {
          addedAt: new Date().toISOString(),
          verified: false,
        },
      },
    });

    // Clear cache
    await this.clearCandidateCaches(workerId);

    return education;
  }

  async getEducation(workerId) {
    const education = await this.prisma.education.findMany({
      where: { workerId },
      orderBy: { endDate: 'desc' },
    });

    return education;
  }

  // RESUME MANAGEMENT
  async uploadResume(workerId, file, metadata = {}) {
    // Upload file to storage
    const filePath = `resumes/${workerId}/${Date.now()}_${file.originalname}`;
    await this.storageService.uploadFile(filePath, file.buffer);

    // Parse resume
    const parsedResume = await this.parseResume(file.buffer, file.mimetype);

    // Create resume record
    const resume = await this.prisma.resume.create({
      data: {
        workerId,
        fileName: file.originalname,
        filePath,
        fileType: file.mimetype,
        fileSize: file.size,
        parsedData: parsedResume,
        metadata: {
          ...metadata,
          uploadedAt: new Date().toISOString(),
          parsedAt: new Date().toISOString(),
          parserVersion: '1.0',
        },
        isPrimary: metadata.isPrimary || false,
      },
    });

    // If this is primary, update other resumes
    if (resume.isPrimary) {
      await this.prisma.resume.updateMany({
        where: { 
          workerId,
          id: { not: resume.id }
        },
        data: { isPrimary: false },
      });
    }

    // Extract and update candidate data from resume
    await this.updateCandidateFromResume(workerId, parsedResume);

    // Clear cache
    await this.clearCandidateCaches(workerId);

    return resume;
  }

  async parseResume(fileBuffer, mimeType) {
    let text;
    
    if (mimeType === 'application/pdf') {
      text = await this.aiService.parsePDF(fileBuffer);
    } else if (mimeType.includes('word') || mimeType === 'application/msword') {
      text = await this.aiService.parseWord(fileBuffer);
    } else if (mimeType === 'text/plain') {
      text = fileBuffer.toString('utf-8');
    } else {
      throw new Error('Unsupported file format');
    }

    // Extract structured data using AI
    const extractedData = await this.aiService.extractResumeData(text);

    return {
      rawText: text,
      extractedData,
      parsedAt: new Date(),
    };
  }

  async updateCandidateFromResume(workerId, parsedResume) {
    const data = parsedResume.extractedData;
    const updates = {};

    // Update basic info
    if (data.title) updates.title = data.title;
    if (data.summary) updates.summary = data.summary;
    if (data.location) updates.location = data.location;
    if (data.phone) updates.phone = data.phone;

    // Update experiences
    if (data.experiences?.length > 0) {
      for (const exp of data.experiences) {
        await this.addExperience(workerId, {
          title: exp.title,
          company: exp.company,
          location: exp.location,
          startDate: exp.startDate,
          endDate: exp.endDate,
          current: exp.current || false,
          description: exp.description,
          achievements: exp.achievements,
        });
      }
    }

    // Update education
    if (data.education?.length > 0) {
      for (const edu of data.education) {
        await this.addEducation(workerId, {
          institution: edu.institution,
          degree: edu.degree,
          field: edu.field,
          startDate: edu.startDate,
          endDate: edu.endDate,
          grade: edu.grade,
          description: edu.description,
        });
      }
    }

    // Update skills
    if (data.skills?.length > 0) {
      for (const skillName of data.skills) {
        try {
          await this.addSkill(workerId, {
            name: skillName,
            proficiency: 'INTERMEDIATE',
          });
        } catch (error) {
          // Skill might already exist
        }
      }
    }

    // Update candidate
    if (Object.keys(updates).length > 0) {
      await this.updateCandidate(workerId, updates, 'system');
    }
  }

  async getResumes(workerId) {
    const resumes = await this.prisma.resume.findMany({
      where: { workerId },
      orderBy: [
        { isPrimary: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return resumes;
  }

  // APPLICATION HISTORY
  async getApplicationHistory(workerId, filters = {}) {
    const where = { workerId };
    
    if (filters.status) {
      where.status = filters.status;
    }
    if (filters.dateFrom) {
      where.createdAt = { gte: new Date(filters.dateFrom) };
    }
    if (filters.dateTo) {
      where.createdAt = { lte: new Date(filters.dateTo) };
    }
    if (filters.search) {
      where.job = {
        title: { contains: filters.search, mode: 'insensitive' },
      };
    }

    const [applications, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: {
          job: {
            include: {
              employer: {
                select: {
                  name: true,
                  logo: true,
                },
              },
            },
          },
          interviews: {
            select: {
              id: true,
              type: true,
              scheduledAt: true,
              status: true,
            },
            orderBy: { scheduledAt: 'desc' },
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
        skip: (filters.page - 1) * (filters.limit || 20),
        take: filters.limit || 20,
      }),
      this.prisma.application.count({ where }),
    ]);

    return {
      applications,
      pagination: {
        page: filters.page || 1,
        limit: filters.limit || 20,
        total,
        pages: Math.ceil(total / (filters.limit || 20)),
      },
    };
  }

  // CANDIDATE SEARCH
  async searchCandidates(filters, pagination = { page: 1, limit: 20 }) {
    const cacheKey = this.generateSearchCacheKey(filters, pagination);
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const where = this.buildCandidateSearchQuery(filters);

    const [candidates, total] = await Promise.all([
      this.prisma.worker.findMany({
        where,
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              avatar: true,
            },
          },
          skills: {
            include: {
              skill: true,
            },
            take: 5,
          },
          experiences: {
            take: 3,
            orderBy: { startDate: 'desc' },
          },
          _count: {
            select: {
              applications: true,
              skills: true,
            },
          },
        },
        orderBy: this.getCandidateSortOrder(filters.sortBy),
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.worker.count({ where }),
    ]);

    // Calculate match scores if jobId is provided
    if (filters.jobId) {
      for (const candidate of candidates) {
        const skillGap = await this.analyzeSkillGap(candidate.id, filters.jobId);
        candidate.matchScore = skillGap.matchScore;
        candidate.skillGap = skillGap;
      }

      // Sort by match score if not already sorted
      if (!filters.sortBy || filters.sortBy === 'match') {
        candidates.sort((a, b) => b.matchScore - a.matchScore);
      }
    }

    const result = {
      candidates,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  buildCandidateSearchQuery(filters) {
    const where = {};

    // Skills filter
    if (filters.skills?.length > 0) {
      where.skills = {
        some: {
          skill: {
            name: {
              in: filters.skills,
              mode: 'insensitive',
            },
          },
        },
      };
    }

    // Experience filter
    if (filters.minExperience) {
      where.experiences = {
        some: {
          startDate: {
            lte: new Date(new Date().getFullYear() - filters.minExperience, 0, 1),
          },
        },
      };
    }

    // Education filter
    if (filters.educationLevel) {
      where.education = {
        some: {
          degree: {
            in: this.getEducationLevelDegrees(filters.educationLevel),
          },
        },
      };
    }

    // Location filter
    if (filters.location) {
      where.location = {
        contains: filters.location,
        mode: 'insensitive',
      };
    }

    // Availability filter
    if (filters.availability) {
      where.availability = filters.availability;
    }

    // Remote preference filter
    if (filters.remotePreference) {
      where.preferences = {
        path: ['remotePreference'],
        equals: filters.remotePreference,
      };
    }

    // Salary expectations filter
    if (filters.maxSalary) {
      where.expectedSalary = {
        lte: filters.maxSalary,
      };
    }

    // Active candidates filter
    if (filters.activeOnly) {
      where.metadata = {
        path: ['lastActive'],
        gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    }

    // Profile completeness filter
    if (filters.minProfileCompleteness) {
      where.metadata = {
        ...where.metadata,
        path: ['profileCompleteness'],
        gte: filters.minProfileCompleteness,
      };
    }

    return where;
  }

  getEducationLevelDegrees(level) {
    const levels = {
      'HIGH_SCHOOL': ['High School Diploma', 'GED'],
      'ASSOCIATE': ['Associate Degree', 'AA', 'AS'],
      'BACHELOR': ['Bachelor Degree', 'BA', 'BS', 'BSc'],
      'MASTER': ['Master Degree', 'MA', 'MS', 'MSc', 'MBA'],
      'PHD': ['PhD', 'Doctorate'],
    };
    return levels[level] || [];
  }

  getCandidateSortOrder(sortBy) {
    switch (sortBy) {
      case 'recent':
        return { createdAt: 'desc' };
      case 'experience':
        return { experiences: { _count: 'desc' } };
      case 'skills':
        return { skills: { _count: 'desc' } };
      case 'profile_completeness':
        return { metadata: { path: ['profileCompleteness'], sort: 'desc' } };
      case 'last_active':
        return { metadata: { path: ['lastActive'], sort: 'desc' } };
      default:
        return { createdAt: 'desc' };
    }
  }

  generateSearchCacheKey(filters, pagination) {
    const filterStr = JSON.stringify(filters);
    const pageStr = JSON.stringify(pagination);
    return `candidate_search:${Buffer.from(filterStr + pageStr).toString('base64')}`;
  }

  // CANDIDATE ANALYTICS
  async getCandidateAnalytics(workerId) {
    const cacheKey = `candidate:${workerId}:analytics`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const [
      metrics,
      applicationStats,
      skillAnalysis,
      marketAnalysis,
      recommendations,
    ] = await Promise.all([
      this.calculateCandidateMetrics(workerId),
      this.getApplicationStatistics(workerId),
      this.analyzeSkills(workerId),
      this.analyzeMarketPosition(workerId),
      this.generateCareerRecommendations(workerId),
    ]);

    const analytics = {
      workerId,
      metrics,
      applicationStats,
      skillAnalysis,
      marketAnalysis,
      recommendations,
      generatedAt: new Date(),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL / 2, JSON.stringify(analytics));

    return analytics;
  }

  async calculateCandidateMetrics(workerId) {
    const candidate = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: {
        _count: {
          select: {
            applications: true,
            interviews: true,
            skills: true,
            experiences: true,
          },
        },
        applications: {
          select: {
            status: true,
            kfnScore: true,
            createdAt: true,
          },
        },
      },
    });

    if (!candidate) return null;

    const metrics = {
      profileCompleteness: candidate.metadata?.profileCompleteness || 0,
      totalApplications: candidate._count.applications,
      totalInterviews: candidate._count.interviews,
      totalSkills: candidate._count.skills,
      totalExperience: candidate._count.experiences,
      averageKfnScore: 0,
      applicationSuccessRate: 0,
      interviewSuccessRate: 0,
      responseTime: this.calculateAverageResponseTime(candidate.applications),
      skillDiversity: await this.calculateSkillDiversity(workerId),
    };

    // Calculate average KFN score
    const applicationsWithScores = candidate.applications.filter(app => app.kfnScore);
    if (applicationsWithScores.length > 0) {
      metrics.averageKfnScore = applicationsWithScores.reduce((sum, app) => 
        sum + app.kfnScore, 0) / applicationsWithScores.length;
    }

    // Calculate success rates
    const successfulApplications = candidate.applications.filter(app => 
      ['ACCEPTED', 'HIRED'].includes(app.status)
    ).length;
    
    const completedInterviews = await this.prisma.interview.count({
      where: { 
        workerId,
        status: 'COMPLETED'
      },
    });

    if (candidate._count.applications > 0) {
      metrics.applicationSuccessRate = (successfulApplications / candidate._count.applications) * 100;
    }

    if (candidate._count.interviews > 0) {
      metrics.interviewSuccessRate = (completedInterviews / candidate._count.interviews) * 100;
    }

    return metrics;
  }

  calculateAverageResponseTime(applications) {
    if (applications.length < 2) return null;

    let totalTime = 0;
    let count = 0;

    for (let i = 1; i < applications.length; i++) {
      const timeDiff = new Date(applications[i].createdAt) - 
                     new Date(applications[i-1].createdAt);
      totalTime += timeDiff;
      count++;
    }

    return count > 0 ? totalTime / count : null;
  }

  async calculateSkillDiversity(workerId) {
    const skills = await this.prisma.workerSkill.findMany({
      where: { workerId },
      include: {
        skill: true,
      },
    });

    if (skills.length === 0) return 0;

    // Group skills by category
    const categories = {};
    skills.forEach(ws => {
      const category = ws.skill.category || 'Other';
      categories[category] = (categories[category] || 0) + 1;
    });

    // Calculate diversity using Shannon entropy
    const totalSkills = skills.length;
    let diversity = 0;

    Object.values(categories).forEach(count => {
      const probability = count / totalSkills;
      diversity -= probability * Math.log(probability);
    });

    // Normalize to 0-100 scale
    const maxDiversity = Math.log(Object.keys(categories).length);
    return maxDiversity > 0 ? (diversity / maxDiversity) * 100 : 0;
  }

  async getApplicationStatistics(workerId) {
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where: { workerId },
      _count: { id: true },
      _avg: { kfnScore: true },
    });

    const timeSeries = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as count,
        AVG(kfn_score) as avg_score
      FROM applications
      WHERE worker_id = ${workerId}
        AND created_at >= NOW() - INTERVAL '90 days'
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    const sourceStats = await this.prisma.application.groupBy({
      by: ['metadata.source'],
      where: { workerId },
      _count: { id: true },
    });

    return {
      byStatus: stats.reduce((acc, stat) => {
        acc[stat.status] = {
          count: stat._count.id,
          avgScore: stat._avg.kfnScore,
        };
        return acc;
      }, {}),
      timeSeries,
      sources: sourceStats.reduce((acc, stat) => {
        acc[stat.metadata?.source || 'UNKNOWN'] = stat._count.id;
        return acc;
      }, {}),
    };
  }

  async analyzeSkills(workerId) {
    const skills = await this.getSkills(workerId);
    
    if (skills.length === 0) {
      return {
        totalSkills: 0,
        byCategory: {},
        proficiencyDistribution: {},
        demandAnalysis: null,
      };
    }

    // Group by category
    const byCategory = {};
    skills.forEach(ws => {
      const category = ws.skill.category || 'Other';
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push({
        name: ws.skill.name,
        proficiency: ws.proficiency,
        years: ws.yearsOfExperience,
      });
    });

    // Proficiency distribution
    const proficiencyDistribution = {
      EXPERT: 0,
      ADVANCED: 0,
      INTERMEDIATE: 0,
      BEGINNER: 0,
    };

    skills.forEach(ws => {
      proficiencyDistribution[ws.proficiency] = 
        (proficiencyDistribution[ws.proficiency] || 0) + 1;
    });

    // Market demand analysis
    const skillNames = skills.map(s => s.skill.name);
    const demandAnalysis = await this.analyzeSkillDemand(skillNames);

    return {
      totalSkills: skills.length,
      byCategory,
      proficiencyDistribution,
      demandAnalysis,
      recommendations: this.generateSkillAnalysisRecommendations(
        byCategory,
        proficiencyDistribution,
        demandAnalysis
      ),
    };
  }

  async analyzeSkillDemand(skillNames) {
    // Get job postings that require these skills
    const jobs = await this.prisma.job.findMany({
      where: {
        skills: {
          some: {
            skill: {
              name: {
                in: skillNames,
                mode: 'insensitive',
              },
            },
          },
        },
        status: 'ACTIVE',
      },
      select: {
        id: true,
        title: true,
        skills: {
          include: {
            skill: true,
          },
        },
      },
      take: 100,
    });

    const demand = {};

    skillNames.forEach(skillName => {
      const matchingJobs = jobs.filter(job => 
        job.skills.some(js => 
          js.skill.name.toLowerCase() === skillName.toLowerCase()
        )
      );

      demand[skillName] = {
        jobCount: matchingJobs.length,
        averageSalary: this.calculateAverageSalaryForSkill(matchingJobs),
        industries: this.extractIndustriesFromJobs(matchingJobs),
      };
    });

    return demand;
  }

  calculateAverageSalaryForSkill(jobs) {
    const salaries = jobs
      .map(job => (job.salaryMin + job.salaryMax) / 2)
      .filter(salary => salary > 0);

    return salaries.length > 0 
      ? salaries.reduce((sum, salary) => sum + salary, 0) / salaries.length 
      : 0;
  }

  extractIndustriesFromJobs(jobs) {
    const industries = new Set();
    jobs.forEach(job => {
      if (job.industry) {
        industries.add(job.industry);
      }
    });
    return Array.from(industries);
  }

  generateSkillAnalysisRecommendations(byCategory, proficiencyDistribution, demandAnalysis) {
    const recommendations = [];

    // Check for skill gaps in popular categories
    Object.entries(demandAnalysis).forEach(([skill, data]) => {
      if (data.jobCount > 10 && data.averageSalary > 0) {
        recommendations.push({
          type: 'HIGH_DEMAND_SKILL',
          priority: 'MEDIUM',
          skill,
          message: `${skill} is in high demand (${data.jobCount} jobs) with average salary $${data.averageSalary.toLocaleString()}`,
          action: 'Consider highlighting this skill in your profile',
        });
      }
    });

    // Check for proficiency distribution
    if (proficiencyDistribution.BEGINNER > proficiencyDistribution.EXPERT * 2) {
      recommendations.push({
        type: 'PROFICIENCY_BALANCE',
        priority: 'LOW',
        message: 'You have many beginner-level skills. Consider deepening your expertise in key areas.',
        action: 'Focus on advancing proficiency in your core skills',
      });
    }

    return recommendations;
  }

  async analyzeMarketPosition(workerId) {
    const candidate = await this.getCandidate(workerId);
    if (!candidate) return null;

    // Get similar candidates
    const similarCandidates = await this.findSimilarCandidates(workerId, 10);

    // Calculate market position
    const position = {
      skillRank: this.calculateSkillRank(candidate, similarCandidates),
      experienceRank: this.calculateExperienceRank(candidate, similarCandidates),
      salaryRank: this.calculateSalaryRank(candidate, similarCandidates),
      overallRank: 0,
    };

    position.overallRank = (
      position.skillRank + position.experienceRank + position.salaryRank
    ) / 3;

    return {
      position,
      competition: similarCandidates.length,
      averageCompetitorMetrics: this.calculateAverageCompetitorMetrics(similarCandidates),
      strengths: this.identifyMarketStrengths(candidate, similarCandidates),
      weaknesses: this.identifyMarketWeaknesses(candidate, similarCandidates),
    };
  }

  async findSimilarCandidates(workerId, limit = 10) {
    const candidate = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: {
        skills: {
          include: {
            skill: true,
          },
        },
        experiences: true,
      },
    });

    if (!candidate) return [];

    // Find candidates with similar skills
    const skillNames = candidate.skills.map(s => s.skill.name);
    
    const similar = await this.prisma.worker.findMany({
      where: {
        id: { not: workerId },
        skills: {
          some: {
            skill: {
              name: {
                in: skillNames,
                mode: 'insensitive',
              },
            },
          },
        },
      },
      include: {
        skills: {
          include: {
            skill: true,
          },
        },
        experiences: true,
        _count: {
          select: {
            applications: true,
          },
        },
      },
      take: limit,
    });

    return similar;
  }

  calculateSkillRank(candidate, competitors) {
    if (competitors.length === 0) return 1;

    const candidateSkillCount = candidate.skills?.length || 0;
    const competitorSkillCounts = competitors.map(c => c.skills?.length || 0);
    const betterCount = competitorSkillCounts.filter(count => count > candidateSkillCount).length;
    
    return 1 - (betterCount / competitors.length);
  }

  calculateExperienceRank(candidate, competitors) {
    if (competitors.length === 0) return 1;

    const candidateExperience = candidate.experiences?.length || 0;
    const competitorExperiences = competitors.map(c => c.experiences?.length || 0);
    const betterCount = competitorExperiences.filter(exp => exp > candidateExperience).length;
    
    return 1 - (betterCount / competitors.length);
  }

  calculateSalaryRank(candidate, competitors) {
    if (competitors.length === 0) return 1;

    const candidateSalary = candidate.expectedSalary || 0;
    const competitorSalaries = competitors.map(c => c.expectedSalary || 0).filter(s => s > 0);
    
    if (competitorSalaries.length === 0) return 1;

    const betterCount = competitorSalaries.filter(salary => salary > candidateSalary).length;
    return 1 - (betterCount / competitorSalaries.length);
  }

  calculateAverageCompetitorMetrics(competitors) {
    if (competitors.length === 0) return null;

    return {
      avgSkills: competitors.reduce((sum, c) => sum + (c.skills?.length || 0), 0) / competitors.length,
      avgExperience: competitors.reduce((sum, c) => sum + (c.experiences?.length || 0), 0) / competitors.length,
      avgSalary: competitors.reduce((sum, c) => sum + (c.expectedSalary || 0), 0) / competitors.filter(c => c.expectedSalary).length,
      avgApplications: competitors.reduce((sum, c) => sum + (c._count?.applications || 0), 0) / competitors.length,
    };
  }

  identifyMarketStrengths(candidate, competitors) {
    const strengths = [];

    // Skill-based strengths
    const candidateSkillNames = candidate.skills?.map(s => s.skill.name) || [];
    const allCompetitorSkills = new Set();
    competitors.forEach(c => {
      c.skills?.forEach(s => allCompetitorSkills.add(s.skill.name.toLowerCase()));
    });

    const uniqueSkills = candidateSkillNames.filter(skill => 
      !allCompetitorSkills.has(skill.toLowerCase())
    );

    if (uniqueSkills.length > 0) {
      strengths.push({
        type: 'UNIQUE_SKILLS',
        skills: uniqueSkills.slice(0, 3),
      });
    }

    // Experience-based strengths
    const candidateExperienceYears = this.calculateTotalExperienceYears(candidate.experiences || []);
    const avgCompetitorExperience = competitors.reduce((sum, c) => 
      sum + this.calculateTotalExperienceYears(c.experiences || []), 0) / competitors.length;

    if (candidateExperienceYears > avgCompetitorExperience * 1.2) {
      strengths.push({
        type: 'EXPERIENCE_ADVANTAGE',
        years: candidateExperienceYears,
        average: avgCompetitorExperience,
      });
    }

    return strengths;
  }

  identifyMarketWeaknesses(candidate, competitors) {
    const weaknesses = [];

    // Missing popular skills
    const candidateSkillNames = candidate.skills?.map(s => s.skill.name.toLowerCase()) || [];
    const popularSkills = this.calculatePopularSkills(competitors);
    
    const missingPopularSkills = popularSkills.filter(skill => 
      !candidateSkillNames.includes(skill.name.toLowerCase())
    );

    if (missingPopularSkills.length > 0) {
      weaknesses.push({
        type: 'MISSING_POPULAR_SKILLS',
        skills: missingPopularSkills.slice(0, 3).map(s => s.name),
        popularity: missingPopularSkills[0].count,
      });
    }

    return weaknesses;
  }

  calculateTotalExperienceYears(experiences) {
    let totalYears = 0;
    experiences.forEach(exp => {
      const start = new Date(exp.startDate);
      const end = exp.current ? new Date() : new Date(exp.endDate);
      const years = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
      totalYears += years;
    });
    return Math.round(totalYears * 10) / 10;
  }

  calculatePopularSkills(competitors) {
    const skillCounts = {};
    competitors.forEach(candidate => {
      candidate.skills?.forEach(ws => {
        const skillName = ws.skill.name;
        skillCounts[skillName] = (skillCounts[skillName] || 0) + 1;
      });
    });

    return Object.entries(skillCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }

  async generateCandidateRecommendations(candidate) {
    const recommendations = [];

    // Profile completeness recommendations
    const completeness = candidate.metadata?.profileCompleteness || 0;
    if (completeness < 70) {
      recommendations.push({
        type: 'PROFILE_COMPLETENESS',
        priority: 'HIGH',
        message: `Your profile is only ${completeness}% complete`,
        actions: [
          'Add missing work experiences',
          'Include more skills',
          'Update your profile summary',
        ],
      });
    }

    // Skill recommendations
    if (candidate.skills?.length < 5) {
      recommendations.push({
        type: 'SKILL_DIVERSITY',
        priority: 'MEDIUM',
        message: 'Consider adding more skills to your profile',
        actions: [
          'Take online courses to learn new skills',
          'Add skills from your past experiences',
          'Consider industry-relevant certifications',
        ],
      });
    }

    // Application recommendations
    const applications = await this.prisma.application.count({
      where: { workerId: candidate.id },
    });

    if (applications === 0) {
      recommendations.push({
        type: 'FIRST_APPLICATION',
        priority: 'HIGH',
        message: 'You haven\'t applied to any jobs yet',
        actions: [
          'Browse jobs matching your skills',
          'Set up job alerts',
          'Apply to 3-5 relevant positions',
        ],
      });
    }

    return recommendations;
  }

  async generateCareerRecommendations(workerId) {
    const candidate = await this.getCandidate(workerId);
    if (!candidate) return [];

    const recommendations = [];

    // Based on skills and market demand
    const skillAnalysis = await this.analyzeSkills(workerId);
    if (skillAnalysis.demandAnalysis) {
      Object.entries(skillAnalysis.demandAnalysis).forEach(([skill, data]) => {
        if (data.jobCount > 20 && data.averageSalary > 0) {
          recommendations.push({
            type: 'CAREER_PATH',
            priority: 'MEDIUM',
            title: `Consider roles requiring ${skill}`,
            description: `High demand (${data.jobCount} jobs) with average salary $${data.averageSalary.toLocaleString()}`,
            industries: data.industries,
            suggestedRoles: this.suggestRolesForSkill(skill, data.industries),
          });
        }
      });
    }

    // Based on experience
    const experienceYears = this.calculateTotalExperienceYears(candidate.experiences || []);
    if (experienceYears > 5) {
      recommendations.push({
        type: 'CAREER_ADVANCEMENT',
        priority: 'MEDIUM',
        title: 'Consider senior or leadership roles',
        description: `With ${experienceYears} years of experience, you may qualify for more senior positions`,
        suggestedActions: [
          'Look for Senior or Lead positions',
          'Consider management opportunities',
          'Highlight leadership experience',
        ],
      });
    }

    // Based on education
    const education = await this.getEducation(workerId);
    const highestDegree = this.getHighestDegree(education);
    
    if (highestDegree && ['BACHELOR', 'MASTER', 'PHD'].includes(highestDegree.level)) {
      recommendations.push({
        type: 'SPECIALIZATION',
        priority: 'LOW',
        title: `Leverage your ${highestDegree.degree} in ${highestDegree.field}`,
        description: 'Consider roles that specifically value your educational background',
        suggestedRoles: this.suggestRolesForEducation(highestDegree),
      });
    }

    return recommendations;
  }

  suggestRolesForSkill(skill, industries) {
    // This would typically come from a role-skill mapping database
    const roleMapping = {
      'JavaScript': ['Frontend Developer', 'Full Stack Developer', 'Web Developer'],
      'Python': ['Data Scientist', 'Backend Developer', 'Machine Learning Engineer'],
      'Project Management': ['Project Manager', 'Program Manager', 'Product Manager'],
      'Sales': ['Sales Executive', 'Account Manager', 'Business Development'],
      'Marketing': ['Marketing Manager', 'Digital Marketer', 'Content Strategist'],
    };

    return roleMapping[skill] || ['Related positions'];
  }

  getHighestDegree(education) {
    if (!education || education.length === 0) return null;

    const degreeLevels = {
      'PhD': 5,
      'Master': 4,
      'Bachelor': 3,
      'Associate': 2,
      'Diploma': 1,
    };

    return education.reduce((highest, current) => {
      const currentLevel = degreeLevels[current.degree] || 0;
      const highestLevel = degreeLevels[highest.degree] || 0;
      return currentLevel > highestLevel ? current : highest;
    });
  }

  suggestRolesForEducation(degree) {
    const fieldMapping = {
      'Computer Science': ['Software Engineer', 'Data Scientist', 'Systems Analyst'],
      'Business Administration': ['Business Analyst', 'Operations Manager', 'Consultant'],
      'Engineering': ['Engineer', 'Technical Lead', 'Project Engineer'],
      'Marketing': ['Marketing Specialist', 'Brand Manager', 'Digital Strategist'],
    };

    return fieldMapping[degree.field] || ['Related professional roles'];
  }

  // CACHE MANAGEMENT
  async clearCandidateCaches(workerId, userId = null) {
    const patterns = [
      `candidate:${workerId}:*`,
      `user:${userId}:candidate`,
      `candidate_search:*`,
    ];

    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  // SEARCH INDEXING
  async indexCandidateInElasticsearch(candidate) {
    if (!this.es) return;

    try {
      const user = await this.prisma.user.findUnique({
        where: { id: candidate.userId },
        select: { firstName: true, lastName: true, email: true },
      });

      const skills = await this.prisma.workerSkill.findMany({
        where: { workerId: candidate.id },
        include: { skill: true },
      });

      const experiences = await this.prisma.experience.findMany({
        where: { workerId: candidate.id },
        orderBy: { startDate: 'desc' },
        take: 5,
      });

      await this.es.index({
        index: 'candidates',
        id: candidate.id,
        body: {
          id: candidate.id,
          userId: candidate.userId,
          name: `${user?.firstName || ''} ${user?.lastName || ''}`,
          title: candidate.title,
          summary: candidate.summary,
          location: candidate.location,
          skills: skills.map(s => s.skill.name),
          experienceYears: this.calculateTotalExperienceYears(experiences),
          education: await this.getHighestEducationLevel(candidate.id),
          availability: candidate.availability,
          expectedSalary: candidate.expectedSalary,
          profileCompleteness: candidate.metadata?.profileCompleteness || 0,
          lastActive: candidate.metadata?.lastActive,
          createdAt: candidate.createdAt,
          updatedAt: candidate.updatedAt,
        },
      });
    } catch (error) {
      console.error('Failed to index candidate:', error);
    }
  }

  async getHighestEducationLevel(workerId) {
    const education = await this.prisma.education.findMany({
      where: { workerId },
      orderBy: { endDate: 'desc' },
      take: 1,
    });

    return education.length > 0 ? education[0].degree : null;
  }

  async searchCandidatesInElasticsearch(query, filters = {}) {
    if (!this.es) return { candidates: [], total: 0 };

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
            'name^3',
            'title^2',
            'summary',
            'skills',
            'location',
          ],
          fuzziness: 'AUTO',
        },
      });
    }

    if (filters.skills?.length > 0) {
      esQuery.bool.filter.push({
        terms: { skills: filters.skills },
      });
    }

    if (filters.location) {
      esQuery.bool.filter.push({
        match: { location: filters.location },
      });
    }

    if (filters.minExperience) {
      esQuery.bool.filter.push({
        range: { experienceYears: { gte: filters.minExperience } },
      });
    }

    if (filters.maxSalary) {
      esQuery.bool.filter.push({
        range: { expectedSalary: { lte: filters.maxSalary } },
      });
    }

    if (filters.minProfileCompleteness) {
      esQuery.bool.filter.push({
        range: { profileCompleteness: { gte: filters.minProfileCompleteness } },
      });
    }

    const result = await this.es.search({
      index: 'candidates',
      body: {
        query: esQuery,
        sort: [
          { profileCompleteness: { order: 'desc' } },
          { _score: { order: 'desc' } },
        ],
        from: ((filters.page || 1) - 1) * (filters.limit || 20),
        size: filters.limit || 20,
      },
    });

    return {
      candidates: result.hits.hits.map(hit => hit._source),
      total: result.hits.total.value,
    };
  }

  // SKILL GRAPH
  async updateSkillGraph(workerId, skillId) {
    // Get all workers with this skill
    const workersWithSkill = await this.prisma.workerSkill.findMany({
      where: { skillId },
      select: { workerId: true },
    });

    // Update skill popularity
    await this.prisma.skill.update({
      where: { id: skillId },
      data: {
        metadata: {
          popularity: workersWithSkill.length,
          lastUpdated: new Date().toISOString(),
        },
      },
    });

    // Update skill relationships
    await this.updateSkillRelationships(workerId, skillId);
  }

  async updateSkillRelationships(workerId, skillId) {
    const workerSkills = await this.prisma.workerSkill.findMany({
      where: { workerId },
      select: { skillId: true },
    });

    const workerSkillIds = workerSkills.map(ws => ws.skillId);

    // Find skills commonly found together
    for (const otherSkillId of workerSkillIds) {
      if (otherSkillId === skillId) continue;

      const cooccurrence = await this.prisma.workerSkill.count({
        where: {
          workerId: { not: workerId },
          OR: [
            { skillId, workerId: { in: await this.getWorkersWithSkill(otherSkillId) } },
            { skillId: otherSkillId, workerId: { in: await this.getWorkersWithSkill(skillId) } },
          ],
        },
      });

      if (cooccurrence > 0) {
        await this.upsertSkillRelationship(skillId, otherSkillId, cooccurrence);
      }
    }
  }

  async getWorkersWithSkill(skillId) {
    const workers = await this.prisma.workerSkill.findMany({
      where: { skillId },
      select: { workerId: true },
    });
    return workers.map(w => w.workerId);
  }

  async upsertSkillRelationship(skillId1, skillId2, strength) {
    const existing = await this.prisma.skillRelationship.findFirst({
      where: {
        OR: [
          { skillId1, skillId2 },
          { skillId1: skillId2, skillId2: skillId1 },
        ],
      },
    });

    if (existing) {
      await this.prisma.skillRelationship.update({
        where: { id: existing.id },
        data: {
          strength,
          lastUpdated: new Date(),
        },
      });
    } else {
      await this.prisma.skillRelationship.create({
        data: {
          skillId1: skillId1 < skillId2 ? skillId1 : skillId2,
          skillId2: skillId1 < skillId2 ? skillId2 : skillId1,
          strength,
          createdAt: new Date(),
          lastUpdated: new Date(),
        },
      });
    }
  }

  async getSkillRecommendations(workerId) {
    const workerSkills = await this.prisma.workerSkill.findMany({
      where: { workerId },
      include: { skill: true },
    });

    if (workerSkills.length === 0) return [];

    const recommendations = [];
    const workerSkillIds = workerSkills.map(ws => ws.skillId);

    // Find skills commonly paired with worker's skills
    const relatedSkills = await this.prisma.skillRelationship.findMany({
      where: {
        OR: [
          { skillId1: { in: workerSkillIds } },
          { skillId2: { in: workerSkillIds } },
        ],
        strength: { gt: 5 }, // Minimum co-occurrence threshold
      },
      include: {
        skill1: true,
        skill2: true,
      },
      orderBy: { strength: 'desc' },
      take: 10,
    });

    // Filter out skills the worker already has
    const suggestedSkillIds = new Set();
    for (const rel of relatedSkills) {
      const otherSkill = rel.skillId1 in workerSkillIds ? rel.skill2 : rel.skill1;
      if (!workerSkillIds.includes(otherSkill.id)) {
        suggestedSkillIds.add(otherSkill.id);
      }
    }

    // Get skill details
    const suggestedSkills = await this.prisma.skill.findMany({
      where: { id: { in: Array.from(suggestedSkillIds) } },
      include: {
        _count: {
          select: {
            jobs: true,
          },
        },
      },
    });

    // Format recommendations
    suggestedSkills.forEach(skill => {
      recommendations.push({
        skillId: skill.id,
        name: skill.name,
        category: skill.category,
        jobCount: skill._count.jobs,
        reason: 'Frequently paired with your existing skills',
        priority: skill._count.jobs > 50 ? 'HIGH' : 'MEDIUM',
      });
    });

    return recommendations.slice(0, 5);
  }
}

module.exports = CandidateRepository;    try {
      return await this.model.upsert({
        where: { userId },
        update: data,
        create: {
          userId,
          ...data,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get complete worker profile with all relations
   */
  async getCompleteWorkerProfile(userId) {
    try {
      return await this.prisma.user.findUnique({
        where: { 
          id: userId,
          OR: [
            { role: 'WORKER' },
            { role: 'FREELANCER' },
            { role: 'VOLUNTEER' },
          ],
        },
        include: {
          profile: true,
          workerProfile: true,
          skills: {
            include: { skill: true },
            orderBy: [{ isPrimary: 'desc' }, { yearsExperience: 'desc' }],
          },
          experiences: {
            orderBy: [{ current: 'desc' }, { startDate: 'desc' }],
          },
          educations: {
            orderBy: [{ current: 'desc' }, { startDate: 'desc' }],
          },
          certificates: {
            orderBy: { issuedAt: 'desc' },
          },
          resumes: {
            where: { isPrimary: true },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get worker statistics
   */
  async getWorkerStats(userId) {
    try {
      const [
        workerProfile,
        applications,
        interviews,
        kfnScores,
        skills,
      ] = await Promise.all([
        this.findByUserId(userId),
        this.prisma.application.findMany({
          where: { userId },
          include: { job: true },
        }),
        this.prisma.interview.findMany({
          where: { intervieweeId: userId },
        }),
        this.prisma.kFN.findMany({
          where: { userId },
          orderBy: { calculatedAt: 'desc' },
          take: 10,
        }),
        this.prisma.userSkill.findMany({
          where: { userId },
          include: { skill: true },
        }),
      ]);

      // Application statistics
      const appStats = applications.reduce((stats, app) => {
        stats[app.status] = (stats[app.status] || 0) + 1;
        return stats;
      }, {});

      // KFN statistics
      const kfnStats = {
        avgScore: kfnScores.length > 0
          ? kfnScores.reduce((sum, kfn) => sum + kfn.overallScore, 0) / kfnScores.length
          : 0,
        highestScore: kfnScores.length > 0
          ? Math.max(...kfnScores.map(k => k.overallScore))
          : 0,
        lowestScore: kfnScores.length > 0
          ? Math.min(...kfnScores.map(k => k.overallScore))
          : 0,
      };

      // Skill statistics
      const skillStats = {
        total: skills.length,
        primary: skills.filter(s => s.isPrimary).length,
        byProficiency: skills.reduce((stats, skill) => {
          stats[skill.proficiency] = (stats[skill.proficiency] || 0) + 1;
          return stats;
        }, {}),
        byCategory: skills.reduce((stats, skill) => {
          const category = skill.skill.category;
          stats[category] = (stats[category] || 0) + 1;
          return stats;
        }, {}),
      };

      // Interview statistics
      const interviewStats = interviews.reduce((stats, interview) => {
        stats[interview.status] = (stats[interview.status] || 0) + 1;
        return stats;
      }, {});

      return {
        workerProfile,
        stats: {
          applications: {
            total: applications.length,
            byStatus: appStats,
            successRate: applications.filter(a => 
              ['HIRED', 'OFFERED'].includes(a.status)
            ).length / (applications.length || 1) * 100,
          },
          interviews: {
            total: interviews.length,
            byStatus: interviewStats,
            upcoming: interviews.filter(i => 
              new Date(i.scheduledAt) > new Date() && i.status === 'SCHEDULED'
            ).length,
          },
          kfn: kfnStats,
          skills: skillStats,
        },
        recentApplications: applications.slice(0, 5),
        recentInterviews: interviews.slice(0, 5),
        topSkills: skills
          .filter(s => s.isPrimary)
          .slice(0, 5)
          .map(s => s.skill.name),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get job recommendations for worker
   */
  async getJobRecommendations(userId, limit = 10) {
    try {
      const worker = await this.getCompleteWorkerProfile(userId);
      if (!worker || !worker.workerProfile) {
        return [];
      }

      const {
        preferredRoles,
        preferredLocations,
        remotePreference,
        minSalary,
        maxSalary,
        workerType,
      } = worker.workerProfile;

      const workerSkills = worker.skills.map(s => s.skill.name);

      // Build query for job recommendations
      const where = {
        status: 'PUBLISHED',
        expiresAt: { gt: new Date() },
        OR: [],
      };

      // Preferred roles match
      if (preferredRoles && preferredRoles.length > 0) {
        where.OR.push({
          title: {
            contains: preferredRoles[0],
            mode: 'insensitive',
          },
        });
      }

      // Location match
      if (preferredLocations && preferredLocations.length > 0) {
        if (remotePreference === 'REMOTE') {
          where.isRemote = true;
        } else if (remotePreference === 'HYBRID') {
          where.OR.push(
            { isRemote: true },
            {
              OR: preferredLocations.map(location => ({
                location: { contains: location, mode: 'insensitive' },
              })),
            }
          );
        } else {
          where.OR.push(
            ...preferredLocations.map(location => ({
              location: { contains: location, mode: 'insensitive' },
            }))
          );
        }
      }

      // Salary range match
      if (minSalary !== undefined || maxSalary !== undefined) {
        where.AND = [];
        if (minSalary !== undefined) {
          where.AND.push({
            OR: [
              { minSalary: { gte: minSalary } },
              { minSalary: null },
            ],
          });
        }
        if (maxSalary !== undefined) {
          where.AND.push({
            OR: [
              { maxSalary: { lte: maxSalary } },
              { maxSalary: null },
            ],
          });
        }
      }

      // Worker type match
      if (workerType) {
        where.jobType = workerType;
      }

      // Get matching jobs
      const jobs = await this.prisma.job.findMany({
        where,
        include: {
          company: true,
        },
        orderBy: { postedAt: 'desc' },
        take: limit * 2, // Get more for filtering
      });

      // Score and rank jobs based on worker profile
      const scoredJobs = jobs.map(job => {
        let score = 50; // Base score

        // Role match score
        if (preferredRoles && preferredRoles.some(role =>
          job.title.toLowerCase().includes(role.toLowerCase())
        )) {
          score += 20;
        }

        // Location match score
        if (preferredLocations && preferredLocations.some(location =>
          job.location?.toLowerCase().includes(location.toLowerCase())
        )) {
          score += 15;
        }

        // Remote preference score
        if (job.isRemote && remotePreference === 'REMOTE') {
          score += 10;
        }

        // Salary match score
        if (minSalary !== undefined && job.minSalary && job.minSalary >= minSalary) {
          score += 10;
        }
        if (maxSalary !== undefined && job.maxSalary && job.maxSalary <= maxSalary) {
          score += 5;
        }

        // Skill match score
        const jobSkills = this.extractSkillsFromJob(job);
        const matchedSkills = jobSkills.filter(skill =>
          workerSkills.some(ws => ws.toLowerCase().includes(skill.toLowerCase()))
        );
        score += (matchedSkills.length / (jobSkills.length || 1)) * 20;

        return {
          ...job,
          matchScore: Math.min(100, score),
          matchedSkills,
        };
      });

      // Sort by match score and return top results
      return scoredJobs
        .sort((a, b) => b.matchScore - a.matchScore)
        .slice(0, limit);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Extract skills from job description
   */
  extractSkillsFromJob(job) {
    const text = `
      ${job.title}
      ${job.description}
      ${job.requirements}
      ${job.responsibilities}
    `.toLowerCase();

    const commonSkills = [
      'javascript', 'python', 'java', 'react', 'node.js', 'typescript',
      'html', 'css', 'sql', 'mongodb', 'aws', 'docker', 'kubernetes',
      'git', 'agile', 'scrum', 'machine learning', 'ai', 'data science',
      'product management', 'ux', 'ui', 'design', 'devops', 'cloud',
    ];

    return commonSkills.filter(skill => text.includes(skill));
  }

  /**
   * Update worker availability
   */
  async updateAvailability(userId, availability) {
    try {
      return await this.model.update({
        where: { userId },
        data: { availability },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get workers by availability
   */
  async getWorkersByAvailability(availability, options = {}) {
    try {
      return await this.findMany({
        where: { availability },
        include: {
          user: {
            include: {
              profile: true,
              skills: {
                include: { skill: true },
                take: 5,
              },
            },
          },
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Search workers
   */
  async searchWorkers(filters = {}, pagination = {}) {
    try {
      const {
        query,
        skills = [],
        experienceLevel,
        availability,
        remotePreference,
        location,
        minSalary,
        maxSalary,
        workerType,
        ...otherFilters
      } = filters;

      const where = {
        user: {
          status: 'ACTIVE',
          OR: [
            { role: 'WORKER' },
            { role: 'FREELANCER' },
          ],
        },
      };

      // Text search
      if (query) {
        where.user.OR = [
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
          { profile: {
            OR: [
              { headline: { contains: query, mode: 'insensitive' } },
              { summary: { contains: query, mode: 'insensitive' } },
            ],
          } },
        ];
      }

      // Skills filter
      if (skills.length > 0) {
        where.user.skills = {
          some: {
            skill: {
              name: {
                in: skills,
              },
            },
            proficiency: experienceLevel || undefined,
          },
        };
      }

      // Availability filter
      if (availability) {
        where.availability = availability;
      }

      // Remote preference filter
      if (remotePreference) {
        where.remotePreference = remotePreference;
      }

      // Location filter
      if (location) {
        where.user.OR = [
          { city: { contains: location, mode: 'insensitive' } },
          { state: { contains: location, mode: 'insensitive' } },
          { country: { contains: location, mode: 'insensitive' } },
        ];
      }

      // Salary range filter
      if (minSalary !== undefined || maxSalary !== undefined) {
        where.OR = [];
        if (minSalary !== undefined) {
          where.OR.push({ minSalary: { gte: minSalary } });
        }
        if (maxSalary !== undefined) {
          where.OR.push({ maxSalary: { lte: maxSalary } });
        }
      }

      // Worker type filter
      if (workerType) {
        where.workerType = workerType;
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      return await this.paginate(where, {
        include: {
          user: {
            include: {
              profile: true,
              skills: {
                include: { skill: true },
                take: 5,
              },
            },
          },
        },
        ...pagination,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get worker activity timeline
   */
  async getActivityTimeline(userId, limit = 20) {
    try {
      const [
        applications,
        interviews,
        skillsAdded,
        experiencesAdded,
        educationsAdded,
        kfnCalculations,
      ] = await Promise.all([
        this.prisma.application.findMany({
          where: { userId },
          select: { appliedAt: true, status: true, job: { select: { title: true } } },
          orderBy: { appliedAt: 'desc' },
          take: limit,
        }),
        this.prisma.interview.findMany({
          where: { intervieweeId: userId },
          select: { scheduledAt: true, type: true, status: true, title: true },
          orderBy: { scheduledAt: 'desc' },
          take: limit,
        }),
        this.prisma.userSkill.findMany({
          where: { userId },
          select: { createdAt: true, skill: { select: { name: true } } },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prisma.experience.findMany({
          where: { userId },
          select: { createdAt: true, title: true, company: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prisma.education.findMany({
          where: { userId },
          select: { createdAt: true, degree: true, institution: true },
          orderBy: { createdAt: 'desc' },
          take: limit,
        }),
        this.prisma.kFN.findMany({
          where: { userId },
          select: { calculatedAt: true, overallScore: true, job: { select: { title: true } } },
          orderBy: { calculatedAt: 'desc' },
          take: limit,
        }),
      ]);

      // Combine and sort all activities
      const activities = [
        ...applications.map(app => ({
          type: 'APPLICATION',
          date: app.appliedAt,
          title: `Applied for ${app.job.title}`,
          description: `Status: ${app.status}`,
          metadata: { status: app.status },
        })),
        ...interviews.map(interview => ({
          type: 'INTERVIEW',
          date: interview.scheduledAt,
          title: interview.title,
          description: `${interview.type} interview - ${interview.status}`,
          metadata: { type: interview.type, status: interview.status },
        })),
        ...skillsAdded.map(skill => ({
          type: 'SKILL',
          date: skill.createdAt,
          title: `Added skill: ${skill.skill.name}`,
          description: 'Skill added to profile',
          metadata: { skillName: skill.skill.name },
        })),
        ...experiencesAdded.map(exp => ({
          type: 'EXPERIENCE',
          date: exp.createdAt,
          title: `Added experience: ${exp.title}`,
          description: `at ${exp.company}`,
          metadata: { title: exp.title, company: exp.company },
        })),
        ...educationsAdded.map(edu => ({
          type: 'EDUCATION',
          date: edu.createdAt,
          title: `Added education: ${edu.degree}`,
          description: `at ${edu.institution}`,
          metadata: { degree: edu.degree, institution: edu.institution },
        })),
        ...kfnCalculations.map(kfn => ({
          type: 'KFN',
          date: kfn.calculatedAt,
          title: `KFN calculated: ${kfn.overallScore}%`,
          description: `for ${kfn.job.title}`,
          metadata: { score: kfn.overallScore },
        })),
      ];

      // Sort by date descending
      activities.sort((a, b) => new Date(b.date) - new Date(a.date));

      return activities.slice(0, limit);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update worker salary expectations
   */
  async updateSalaryExpectations(userId, minSalary, maxSalary, salaryType) {
    try {
      return await this.model.update({
        where: { userId },
        data: {
          minSalary,
          maxSalary,
          salaryType,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get workers ready for hire
   */
  async getWorkersReadyForHire(filters = {}) {
    try {
      const where = {
        availability: { in: ['AVAILABLE', 'SOON'] },
        user: {
          status: 'ACTIVE',
        },
      };

      // Apply additional filters
      if (filters.skills && filters.skills.length > 0) {
        where.user.skills = {
          some: {
            skill: {
              name: {
                in: filters.skills,
              },
            },
          },
        };
      }

      if (filters.location) {
        where.user.location = {
          contains: filters.location,
          mode: 'insensitive',
        };
      }

      if (filters.experienceLevel) {
        where.user.profile = {
          yearsExperience: {
            gte: this.getExperienceYears(filters.experienceLevel),
          },
        };
      }

      return await this.findMany({
        where,
        include: {
          user: {
            include: {
              profile: true,
              skills: {
                include: { skill: true },
                take: 5,
              },
              experiences: {
                take: 1,
                orderBy: { startDate: 'desc' },
              },
            },
          },
        },
        orderBy: { updatedAt: 'desc' },
        take: filters.limit || 20,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Convert experience level to years
   */
  getExperienceYears(level) {
    const levels = {
      ENTRY: 0,
      JUNIOR: 1,
      MID: 3,
      SENIOR: 5,
      LEAD: 8,
      EXECUTIVE: 10,
    };
    return levels[level] || 0;
  }
}

module.exports = WorkerRepository;
