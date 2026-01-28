const BaseRepository = require('../BaseRepository');

class WorkerRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'workerProfile');
  }

  /**
   * Find worker profile by user ID
   */
  async findByUserId(userId, options = {}) {
    try {
      return await this.model.findUnique({
        where: { userId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update worker profile by user ID
   */
  async updateByUserId(userId, data) {
    try {
      return await this.model.update({
        where: { userId },
        data,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Create or update worker profile
   */
  async upsertByUserId(userId, data) {
    try {
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
