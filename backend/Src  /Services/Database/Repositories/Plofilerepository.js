const BaseRepository = require('../BaseRepository');

class ProfileRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'profile');
  }

  /**
   * Find profile by user ID
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
   * Update profile by user ID
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
   * Create or update profile
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
   * Get complete profile with user data
   */
  async getCompleteProfile(userId) {
    try {
      return await this.prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          workerProfile: true,
          employerProfile: true,
          skills: {
            include: { skill: true },
          },
          experiences: {
            orderBy: { startDate: 'desc' },
          },
          educations: {
            orderBy: { startDate: 'desc' },
          },
          certificates: {
            orderBy: { issuedAt: 'desc' },
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Increment profile views
   */
  async incrementViews(userId) {
    try {
      return await this.model.update({
        where: { userId },
        data: {
          profileViews: {
            increment: 1,
          },
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update profile privacy settings
   */
  async updatePrivacySettings(userId, settings) {
    try {
      const profile = await this.findByUserId(userId);
      if (!profile) {
        throw new Error('Profile not found');
      }

      const currentSettings = profile.privacySettings || {};
      const updatedSettings = { ...currentSettings, ...settings };

      return await this.model.update({
        where: { userId },
        data: { privacySettings: updatedSettings },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Search profiles
   */
  async searchProfiles(query, filters = {}) {
    try {
      const {
        industry,
        yearsExperienceMin,
        yearsExperienceMax,
        location,
        skills = [],
        availability,
        ...otherFilters
      } = filters;

      const where = {
        user: {
          status: 'ACTIVE',
        },
      };

      // Text search
      if (query) {
        where.OR = [
          { headline: { contains: query, mode: 'insensitive' } },
          { summary: { contains: query, mode: 'insensitive' } },
          { user: { 
            OR: [
              { firstName: { contains: query, mode: 'insensitive' } },
              { lastName: { contains: query, mode: 'insensitive' } },
            ],
          } },
        ];
      }

      // Industry filter
      if (industry) {
        where.industry = industry;
      }

      // Experience range filter
      if (yearsExperienceMin !== undefined || yearsExperienceMax !== undefined) {
        where.yearsExperience = {};
        if (yearsExperienceMin !== undefined) {
          where.yearsExperience.gte = yearsExperienceMin;
        }
        if (yearsExperienceMax !== undefined) {
          where.yearsExperience.lte = yearsExperienceMax;
        }
      }

      // Location filter
      if (location) {
        where.user.OR = [
          { city: { contains: location, mode: 'insensitive' } },
          { state: { contains: location, mode: 'insensitive' } },
          { country: { contains: location, mode: 'insensitive' } },
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
          },
        };
      }

      // Availability filter (for workers)
      if (availability) {
        where.user.workerProfile = {
          availability: availability,
        };
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      return await this.model.findMany({
        where,
        include: {
          user: {
            include: {
              workerProfile: true,
              skills: {
                include: { skill: true },
              },
            },
          },
        },
        orderBy: { profileViews: 'desc' },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get profile statistics
   */
  async getProfileStats(userId) {
    try {
      const [
        profile,
        skillsCount,
        experiencesCount,
        educationsCount,
        applicationsCount,
        interviewsCount,
        profileViews,
      ] = await Promise.all([
        this.findByUserId(userId),
        this.prisma.userSkill.count({ where: { userId } }),
        this.prisma.experience.count({ where: { userId } }),
        this.prisma.education.count({ where: { userId } }),
        this.prisma.application.count({ where: { userId } }),
        this.prisma.interview.count({ where: { intervieweeId: userId } }),
        this.model.findUnique({
          where: { userId },
          select: { profileViews: true },
        }),
      ]);

      return {
        profile,
        counts: {
          skills: skillsCount,
          experiences: experiencesCount,
          educations: educationsCount,
          applications: applicationsCount,
          interviews: interviewsCount,
          profileViews: profileViews?.profileViews || 0,
        },
        completeness: this.calculateProfileCompleteness(profile, {
          skillsCount,
          experiencesCount,
          educationsCount,
        }),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate profile completeness percentage
   */
  calculateProfileCompleteness(profile, counts) {
    const weights = {
      basicInfo: 20,
      profileInfo: 30,
      skills: 15,
      experience: 20,
      education: 15,
    };

    let score = 0;

    // Basic info (from user table)
    if (profile?.user?.firstName && profile?.user?.lastName) score += weights.basicInfo;

    // Profile info
    if (profile?.headline) score += 10;
    if (profile?.summary) score += 10;
    if (profile?.currentTitle) score += 10;

    // Skills
    if (counts.skillsCount > 0) score += weights.skills;

    // Experience
    if (counts.experiencesCount > 0) score += weights.experience;

    // Education
    if (counts.educationsCount > 0) score += weights.education;

    return Math.min(100, score);
  }

  /**
   * Get trending profiles
   */
  async getTrendingProfiles(limit = 10) {
    try {
      return await this.model.findMany({
        where: {
          user: {
            status: 'ACTIVE',
          },
        },
        include: {
          user: {
            include: {
              skills: {
                include: { skill: true },
                take: 5,
              },
            },
          },
        },
        orderBy: [
          { profileViews: 'desc' },
          { updatedAt: 'desc' },
        ],
        take: limit,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get profiles by industry
   */
  async getProfilesByIndustry(industry, options = {}) {
    try {
      return await this.findMany({
        where: { industry },
        include: {
          user: {
            include: {
              skills: {
                include: { skill: true },
                take: 3,
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
   * Update profile completion status
   */
  async updateProfileCompletion(userId, completedSections = []) {
    try {
      const profile = await this.findByUserId(userId);
      if (!profile) {
        throw new Error('Profile not found');
      }

      const currentCompleted = profile.completedSections || [];
      const updatedCompleted = [...new Set([...currentCompleted, ...completedSections])];

      return await this.model.update({
        where: { userId },
        data: { completedSections: updatedCompleted },
      });
    } catch (error) {
      this.handleError(error);
    }
  }
}

module.exports = ProfileRepository;
