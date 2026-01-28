const BaseRepository = require('../BaseRepository');

class SkillRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'skill');
  }

  /**
   * Find skill by name
   */
  async findByName(name, options = {}) {
    try {
      return await this.model.findUnique({
        where: { name },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Find skills by category
   */
  async findByCategory(category, options = {}) {
    try {
      return await this.findMany({
        where: { category },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Search skills
   */
  async searchSkills(query, options = {}) {
    try {
      return await this.findMany({
        where: {
          OR: [
            { name: { contains: query, mode: 'insensitive' } },
            { category: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get trending skills
   */
  async getTrendingSkills(limit = 10, timeframe = '30d') {
    try {
      const date = new Date();
      switch (timeframe) {
        case '7d':
          date.setDate(date.getDate() - 7);
          break;
        case '30d':
          date.setDate(date.getDate() - 30);
          break;
        case '90d':
          date.setDate(date.getDate() - 90);
          break;
      }

      const trending = await this.prisma.$queryRaw`
        SELECT 
          s.id,
          s.name,
          s.category,
          COUNT(DISTINCT us.user_id) as user_count,
          COUNT(DISTINCT js.job_id) as job_count,
          COUNT(DISTINCT us.user_id) + COUNT(DISTINCT js.job_id) * 2 as trend_score
        FROM "Skill" s
        LEFT JOIN "UserSkill" us ON us.skill_id = s.id
          AND us.created_at >= ${date}
        LEFT JOIN "JobSkill" js ON js.skill_id = s.id
          AND js.created_at >= ${date}
        GROUP BY s.id, s.name, s.category
        ORDER BY trend_score DESC
        LIMIT ${limit}
      `;

      return trending;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get skill demand
   */
  async getSkillDemand(skillName, timeframe = '30d') {
    try {
      const date = new Date();
      switch (timeframe) {
        case '7d':
          date.setDate(date.getDate() - 7);
          break;
        case '30d':
          date.setDate(date.getDate() - 30);
          break;
        case '90d':
          date.setDate(date.getDate() - 90);
          break;
        case '1y':
          date.setFullYear(date.getFullYear() - 1);
          break;
      }

      const skill = await this.findByName(skillName);
      if (!skill) {
        throw new Error('Skill not found');
      }

      const [
        jobDemand,
        userSupply,
        salaryData,
        relatedSkills,
      ] = await Promise.all([
        this.prisma.jobSkill.count({
          where: {
            skillId: skill.id,
            createdAt: { gte: date },
          },
        }),
        this.prisma.userSkill.count({
          where: {
            skillId: skill.id,
            createdAt: { gte: date },
          },
        }),
        this.getSkillSalaryData(skill.id),
        this.getRelatedSkills(skill.id),
      ]);

      // Calculate supply-demand ratio
      const demandRatio = jobDemand / (userSupply || 1);

      return {
        skill,
        demand: {
          jobDemand,
          userSupply,
          demandRatio,
          interpretation: this.interpretDemandRatio(demandRatio),
        },
        salary: salaryData,
        relatedSkills,
        timeframe,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get skill salary data
   */
  async getSkillSalaryData(skillId) {
    try {
      const salaryData = await this.prisma.$queryRaw`
        SELECT 
          percentile_cont(0.25) WITHIN GROUP (ORDER BY j.min_salary) as q1,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY j.min_salary) as median,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY j.min_salary) as q3,
          AVG(j.min_salary) as avg_min,
          AVG(j.max_salary) as avg_max
        FROM "Job" j
        INNER JOIN "JobSkill" js ON js.job_id = j.id
        WHERE js.skill_id = ${skillId}
          AND j.min_salary IS NOT NULL
          AND j.status = 'PUBLISHED'
          AND j.expires_at > NOW()
      `;

      const experienceLevelData = await this.prisma.$queryRaw`
        SELECT 
          j.experience_level,
          COUNT(*) as job_count,
          AVG(j.min_salary) as avg_salary
        FROM "Job" j
        INNER JOIN "JobSkill" js ON js.job_id = j.id
        WHERE js.skill_id = ${skillId}
          AND j.min_salary IS NOT NULL
          AND j.status = 'PUBLISHED'
          AND j.expires_at > NOW()
        GROUP BY j.experience_level
        ORDER BY job_count DESC
      `;

      return {
        salaryRange: salaryData[0] || {},
        byExperienceLevel: experienceLevelData,
      };
    } catch (error) {
      return {
        salaryRange: {},
        byExperienceLevel: [],
      };
    }
  }

  /**
   * Get related skills
   */
  async getRelatedSkills(skillId, limit = 5) {
    try {
      return await this.prisma.$queryRaw`
        SELECT 
          s2.id,
          s2.name,
          s2.category,
          COUNT(*) as co_occurrence
        FROM "JobSkill" js1
        INNER JOIN "JobSkill" js2 ON js1.job_id = js2.job_id
        INNER JOIN "Skill" s2 ON js2.skill_id = s2.id
        WHERE js1.skill_id = ${skillId}
          AND js2.skill_id != ${skillId}
        GROUP BY s2.id, s2.name, s2.category
        ORDER BY co_occurrence DESC
        LIMIT ${limit}
      `;
    } catch (error) {
      return [];
    }
  }

  /**
   * Interpret demand ratio
   */
  interpretDemandRatio(ratio) {
    if (ratio > 5) return 'HIGH_DEMAND';
    if (ratio > 2) return 'MODERATE_DEMAND';
    if (ratio > 0.5) return 'BALANCED';
    if (ratio > 0.2) return 'MODERATE_SURPLUS';
    return 'HIGH_SURPLUS';
  }

  /**
   * Get skill statistics
   */
  async getSkillStatistics() {
    try {
      const [
        totalSkills,
        byCategory,
        mostPopular,
        fastestGrowing,
        industryDistribution,
      ] = await Promise.all([
        this.count(),
        this.model.groupBy({
          by: ['category'],
          _count: { _all: true },
        }),
        this.getMostPopularSkills(10),
        this.getFastestGrowingSkills(10),
        this.getSkillIndustryDistribution(),
      ]);

      return {
        totalSkills,
        byCategory: byCategory.reduce((acc, item) => {
          acc[item.category] = item._count._all;
          return acc;
        }, {}),
        mostPopular,
        fastestGrowing,
        industryDistribution,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get most popular skills
   */
  async getMostPopularSkills(limit = 10) {
    try {
      return await this.prisma.$queryRaw`
        SELECT 
          s.id,
          s.name,
          s.category,
          COUNT(DISTINCT us.user_id) as user_count,
          COUNT(DISTINCT js.job_id) as job_count
        FROM "Skill" s
        LEFT JOIN "UserSkill" us ON us.skill_id = s.id
        LEFT JOIN "JobSkill" js ON js.skill_id = s.id
        GROUP BY s.id, s.name, s.category
        ORDER BY user_count DESC, job_count DESC
        LIMIT ${limit}
      `;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get fastest growing skills
   */
  async getFastestGrowingSkills(limit = 10) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

      return await this.prisma.$queryRaw`
        WITH recent_growth AS (
          SELECT 
            s.id,
            s.name,
            s.category,
            COUNT(CASE WHEN us.created_at >= ${thirtyDaysAgo} THEN 1 END) as recent_users,
            COUNT(CASE WHEN us.created_at >= ${sixtyDaysAgo} AND us.created_at < ${thirtyDaysAgo} THEN 1 END) as previous_users,
            COUNT(CASE WHEN js.created_at >= ${thirtyDaysAgo} THEN 1 END) as recent_jobs,
            COUNT(CASE WHEN js.created_at >= ${sixtyDaysAgo} AND js.created_at < ${thirtyDaysAgo} THEN 1 END) as previous_jobs
          FROM "Skill" s
          LEFT JOIN "UserSkill" us ON us.skill_id = s.id
          LEFT JOIN "JobSkill" js ON js.skill_id = s.id
          GROUP BY s.id, s.name, s.category
        )
        SELECT 
          id,
          name,
          category,
          recent_users,
          previous_users,
          recent_jobs,
          previous_jobs,
          CASE 
            WHEN previous_users = 0 THEN recent_users * 100.0
            ELSE ((recent_users - previous_users) * 100.0 / previous_users)
          END as user_growth_percent,
          CASE 
            WHEN previous_jobs = 0 THEN recent_jobs * 100.0
            ELSE ((recent_jobs - previous_jobs) * 100.0 / previous_jobs)
          END as job_growth_percent
        FROM recent_growth
        WHERE recent_users > 10 OR recent_jobs > 10
        ORDER BY (user_growth_percent + job_growth_percent) DESC
        LIMIT ${limit}
      `;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get skill industry distribution
   */
  async getSkillIndustryDistribution() {
    try {
      return await this.prisma.$queryRaw`
        SELECT 
          s.category as skill_category,
          j.category as job_category,
          COUNT(*) as frequency
        FROM "JobSkill" js
        INNER JOIN "Skill" s ON js.skill_id = s.id
        INNER JOIN "Job" j ON js.job_id = j.id
        WHERE j.category IS NOT NULL
        GROUP BY s.category, j.category
        ORDER BY skill_category, frequency DESC
      `;
    } catch (error) {
      return [];
    }
  }

  /**
   * Assign skill to user
   */
  async assignSkillToUser(userId, skillData) {
    try {
      const { skillId, proficiency, yearsExperience, isPrimary, verified } = skillData;

      // Check if skill exists
      const skill = await this.findById(skillId);
      if (!skill) {
        throw new Error('Skill not found');
      }

      // Check if user already has this skill
      const existing = await this.prisma.userSkill.findFirst({
        where: {
          userId,
          skillId,
        },
      });

      if (existing) {
        // Update existing skill
        return await this.prisma.userSkill.update({
          where: { id: existing.id },
          data: {
            proficiency,
            yearsExperience,
            isPrimary,
            verified,
            updatedAt: new Date(),
          },
        });
      }

      // Create new user skill
      return await this.prisma.userSkill.create({
        data: {
          userId,
          skillId,
          proficiency,
          yearsExperience,
          isPrimary,
          verified,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update user skill
   */
  async updateUserSkill(userId, skillId, data) {
    try {
      const userSkill = await this.prisma.userSkill.findFirst({
        where: {
          userId,
          skillId,
        },
      });

      if (!userSkill) {
        throw new Error('User skill not found');
      }

      return await this.prisma.userSkill.update({
        where: { id: userSkill.id },
        data: {
          ...data,
          updatedAt: new Date(),
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Remove user skill
   */
  async removeUserSkill(userId, skillId) {
    try {
      const userSkill = await this.prisma.userSkill.findFirst({
        where: {
          userId,
          skillId,
        },
      });

      if (!userSkill) {
        throw new Error('User skill not found');
      }

      return await this.prisma.userSkill.delete({
        where: { id: userSkill.id },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user skills
   */
  async getUserSkills(userId, options = {}) {
    try {
      return await this.prisma.userSkill.findMany({
        where: { userId },
        include: {
          skill: true,
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get skill gap analysis
   */
  async getSkillGapAnalysis(userId, targetRole) {
    try {
      const userSkills = await this.getUserSkills(userId);
      
      // Get required skills for target role
      const requiredSkills = await this.getRequiredSkillsForRole(targetRole);
      
      // Calculate skill gaps
      const skillGaps = requiredSkills.map(requiredSkill => {
        const userSkill = userSkills.find(us => 
          us.skill.name.toLowerCase() === requiredSkill.skill.toLowerCase()
        );

        const hasSkill = !!userSkill;
        const proficiencyMatch = userSkill ? 
          this.calculateProficiencyMatch(userSkill.proficiency, requiredSkill.requiredProficiency) : 0;

        return {
          skill: requiredSkill.skill,
          requiredProficiency: requiredSkill.requiredProficiency,
          userHasSkill: hasSkill,
          userProficiency: userSkill?.proficiency || null,
          proficiencyMatch,
          isCritical: requiredSkill.isCritical,
          gapScore: hasSkill ? 100 - proficiencyMatch : 100,
          recommendations: this.generateSkillGapRecommendations(
            hasSkill,
            proficiencyMatch,
            requiredSkill
          ),
        };
      });

      // Calculate overall gap score
      const totalGap = skillGaps.reduce((sum, gap) => sum + gap.gapScore, 0);
      const averageGap = skillGaps.length > 0 ? totalGap / skillGaps.length : 0;

      // Identify critical gaps
      const criticalGaps = skillGaps.filter(gap => gap.isCritical && gap.gapScore > 30);

      return {
        skillGaps,
        summary: {
          totalSkills: requiredSkills.length,
          matchedSkills: skillGaps.filter(gap => gap.userHasSkill).length,
          averageGap,
          criticalGaps: criticalGaps.length,
        },
        recommendations: this.generateOverallRecommendations(skillGaps, criticalGaps),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get required skills for role
   */
  async getRequiredSkillsForRole(role) {
    try {
      // This would typically come from a job analysis database
      // For now, return a sample based on common roles
      const roleSkills = {
        'frontend_developer': [
          { skill: 'JavaScript', requiredProficiency: 4, isCritical: true },
          { skill: 'HTML', requiredProficiency: 4, isCritical: true },
          { skill: 'CSS', requiredProficiency: 4, isCritical: true },
          { skill: 'React', requiredProficiency: 4, isCritical: true },
          { skill: 'TypeScript', requiredProficiency: 3, isCritical: false },
          { skill: 'Git', requiredProficiency: 3, isCritical: false },
          { skill: 'Responsive Design', requiredProficiency: 3, isCritical: false },
          { skill: 'API Integration', requiredProficiency: 3, isCritical: false },
        ],
        'backend_developer': [
          { skill: 'Node.js', requiredProficiency: 4, isCritical: true },
          { skill: 'Python', requiredProficiency: 4, isCritical: true },
          { skill: 'SQL', requiredProficiency: 4, isCritical: true },
          { skill: 'API Design', requiredProficiency: 4, isCritical: true },
          { skill: 'Docker', requiredProficiency: 3, isCritical: false },
          { skill: 'AWS', requiredProficiency: 3, isCritical: false },
          { skill: 'Git', requiredProficiency: 3, isCritical: false },
          { skill: 'Testing', requiredProficiency: 3, isCritical: false },
        ],
        'data_scientist': [
          { skill: 'Python', requiredProficiency: 4, isCritical: true },
          { skill: 'SQL', requiredProficiency: 4, isCritical: true },
          { skill: 'Machine Learning', requiredProficiency: 4, isCritical: true },
          { skill: 'Statistics', requiredProficiency: 4, isCritical: true },
          { skill: 'R', requiredProficiency: 3, isCritical: false },
          { skill: 'Data Visualization', requiredProficiency: 3, isCritical: false },
          { skill: 'Big Data', requiredProficiency: 3, isCritical: false },
          { skill: 'Deep Learning', requiredProficiency: 3, isCritical: false },
        ],
      };

      return roleSkills[role] || [];
    } catch (error) {
      return [];
    }
  }

  /**
   * Calculate proficiency match
   */
  calculateProficiencyMatch(userProficiency, requiredProficiency) {
    if (userProficiency >= requiredProficiency) return 100;
    return (userProficiency / requiredProficiency) * 100;
  }

  /**
   * Generate skill gap recommendations
   */
  generateSkillGapRecommendations(hasSkill, proficiencyMatch, requiredSkill) {
    const recommendations = [];

    if (!hasSkill) {
      recommendations.push(`Learn ${requiredSkill.skill}`);
      recommendations.push('Complete online courses or tutorials');
      recommendations.push('Build projects using this skill');
    } else if (proficiencyMatch < 70) {
      recommendations.push(`Improve proficiency in ${requiredSkill.skill}`);
      recommendations.push('Practice advanced concepts');
      recommendations.push('Work on real-world projects');
    }

    if (requiredSkill.isCritical && proficiencyMatch < 80) {
      recommendations.push('This is a critical skill - prioritize learning');
    }

    return recommendations;
  }

  /**
   * Generate overall recommendations
   */
  generateOverallRecommendations(skillGaps, criticalGaps) {
    const recommendations = [];

    // Sort gaps by gap score
    const sortedGaps = [...skillGaps].sort((a, b) => b.gapScore - a.gapScore);

    // Top 3 skills to learn
    const topSkills = sortedGaps.slice(0, 3).map(gap => gap.skill);
    if (topSkills.length > 0) {
      recommendations.push({
        type: 'PRIORITY_SKILLS',
        title: 'Priority Skills to Learn',
        description: `Focus on: ${topSkills.join(', ')}`,
        priority: 'HIGH',
      });
    }

    // Critical gaps
    if (criticalGaps.length > 0) {
      recommendations.push({
        type: 'CRITICAL_GAPS',
        title: 'Critical Skill Gaps',
        description: `${criticalGaps.length} critical skills need immediate attention`,
        priority: 'HIGH',
      });
    }

    // Learning path
    if (skillGaps.length > 5) {
      recommendations.push({
        type: 'LEARNING_PATH',
        title: 'Create Learning Path',
        description: 'Consider a structured learning path to address multiple gaps',
        priority: 'MEDIUM',
      });
    }

    // Resources
    recommendations.push({
      type: 'RESOURCES',
      title: 'Learning Resources',
      description: 'Check platform resources and recommended courses',
      priority: 'LOW',
    });

    return recommendations;
  }

  /**
   * Bulk assign skills to user
   */
  async bulkAssignSkillsToUser(userId, skillsData) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        const results = [];

        for (const skillData of skillsData) {
          try {
            // Find or create skill
            let skill = await prisma.skill.findUnique({
              where: { name: skillData.name },
            });

            if (!skill) {
              skill = await prisma.skill.create({
                data: {
                  name: skillData.name,
                  category: skillData.category || 'Other',
                  description: skillData.description || '',
                },
              });
            }

            // Assign skill to user
            const userSkill = await prisma.userSkill.upsert({
              where: {
                userId_skillId: {
                  userId,
                  skillId: skill.id,
                },
              },
              update: {
                proficiency: skillData.proficiency,
                yearsExperience: skillData.yearsExperience,
                isPrimary: skillData.isPrimary,
                verified: skillData.verified,
                updatedAt: new Date(),
              },
              create: {
                userId,
                skillId: skill.id,
                proficiency: skillData.proficiency,
                yearsExperience: skillData.yearsExperience,
                isPrimary: skillData.isPrimary,
                verified: skillData.verified,
              },
            });

            results.push({
              success: true,
              skill: skill.name,
              userSkill,
            });
          } catch (error) {
            results.push({
              success: false,
              skill: skillData.name,
              error: error.message,
            });
          }
        }

        return results;
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Verify user skill
   */
  async verifyUserSkill(userSkillId, verifiedBy, evidence = null) {
    try {
      const userSkill = await this.prisma.userSkill.findUnique({
        where: { id: userSkillId },
        include: { skill: true },
      });

      if (!userSkill) {
        throw new Error('User skill not found');
      }

      const updated = await this.prisma.userSkill.update({
        where: { id: userSkillId },
        data: {
          verified: true,
          verifiedBy,
          verifiedAt: new Date(),
          verificationEvidence: evidence,
        },
      });

      // Create verification log
      await this.prisma.adminLog.create({
        data: {
          adminId: verifiedBy,
          action: 'SKILL_VERIFICATION',
          targetType: 'USER_SKILL',
          targetId: userSkillId,
          details: {
            userId: userSkill.userId,
            skillId: userSkill.skillId,
            skillName: userSkill.skill.name,
            evidence,
          },
        },
      });

      return updated;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get skill endorsements
   */
  async getSkillEndorsements(skillId, userId = null) {
    try {
      const where = { skillId };
      if (userId) {
        where.userId = userId;
      }

      return await this.prisma.userSkill.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              profile: true,
            },
          },
          endorsements: {
            include: {
              endorser: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  avatar: true,
                },
              },
            },
          },
        },
        orderBy: [
          { verified: 'desc' },
          { yearsExperience: 'desc' },
        ],
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Endorse user skill
   */
  async endorseSkill(userId, skillId, endorserId, comment = null) {
    try {
      // Check if user has the skill
      const userSkill = await this.prisma.userSkill.findFirst({
        where: {
          userId,
          skillId,
        },
      });

      if (!userSkill) {
        throw new Error('User does not have this skill');
      }

      // Check if already endorsed
      const existingEndorsement = await this.prisma.endorsement.findFirst({
        where: {
          userSkillId: userSkill.id,
          endorserId,
        },
      });

      if (existingEndorsement) {
        throw new Error('Already endorsed this skill');
      }

      // Create endorsement
      return await this.prisma.endorsement.create({
        data: {
          userSkillId: userSkill.id,
          endorserId,
          comment,
        },
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get skill learning resources
   */
  async getLearningResources(skillId) {
    try {
      const skill = await this.findById(skillId);
      if (!skill) {
        throw new Error('Skill not found');
      }

      // This would typically come from an external API or database
      // For now, return sample resources
      const resourceTypes = {
        'JavaScript': [
          { type: 'COURSE', title: 'JavaScript Fundamentals', platform: 'Coursera', url: '#' },
          { type: 'TUTORIAL', title: 'MDN Web Docs', platform: 'Mozilla', url: '#' },
          { type: 'BOOK', title: 'Eloquent JavaScript', platform: 'Free Book', url: '#' },
          { type: 'PROJECT', title: 'Build a Todo App', platform: 'GitHub', url: '#' },
        ],
        'Python': [
          { type: 'COURSE', title: 'Python for Everybody', platform: 'Coursera', url: '#' },
          { type: 'TUTORIAL', title: 'Python.org Tutorial', platform: 'Python', url: '#' },
          { type: 'BOOK', title: 'Automate the Boring Stuff', platform: 'Free Book', url: '#' },
          { type: 'PROJECT', title: 'Build a Web Scraper', platform: 'GitHub', url: '#' },
        ],
        'React': [
          { type: 'COURSE', title: 'React - The Complete Guide', platform: 'Udemy', url: '#' },
          { type: 'TUTORIAL', title: 'React Official Docs', platform: 'React', url: '#' },
          { type: 'BOOK', title: 'Learning React', platform: 'OReilly', url: '#' },
          { type: 'PROJECT', title: 'Build a Weather App', platform: 'GitHub', url: '#' },
        ],
      };

      return {
        skill,
        resources: resourceTypes[skill.name] || [],
        recommendations: [
          'Complete at least one course',
          'Build 2-3 projects',
          'Practice daily for 30 minutes',
          'Join related communities',
        ],
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate skill market value
   */
  async calculateSkillMarketValue(skillId, location = null, experience = 'MID') {
    try {
      const skill = await this.findById(skillId);
      if (!skill) {
        throw new Error('Skill not found');
      }

      const where = {
        skillId,
        job: {
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
          minSalary: { not: null },
        },
      };

      if (location) {
        where.job.location = { contains: location, mode: 'insensitive' };
      }

      if (experience) {
        where.job.experienceLevel = experience;
      }

      const salaryData = await this.prisma.$queryRaw`
        SELECT 
          COUNT(*) as job_count,
          AVG(j.min_salary) as avg_min_salary,
          AVG(j.max_salary) as avg_max_salary,
          MIN(j.min_salary) as min_salary,
          MAX(j.max_salary) as max_salary
        FROM "JobSkill" js
        INNER JOIN "Job" j ON js.job_id = j.id
        WHERE js.skill_id = ${skillId}
          AND j.min_salary IS NOT NULL
          AND j.status = 'PUBLISHED'
          AND j.expires_at > NOW()
          ${location ? this.prisma.$raw(`AND j.location ILIKE '%${location}%'`) : ''}
          ${experience ? this.prisma.$raw(`AND j.experience_level = '${experience}'`) : ''}
      `;

      const data = salaryData[0] || {};
      const jobCount = parseInt(data.job_count) || 0;

      // Calculate skill demand score
      const demandScore = await this.calculateSkillDemandScore(skillId, location);

      return {
        skill,
        statistics: {
          jobCount,
          averageSalary: {
            min: parseFloat(data.avg_min_salary) || 0,
            max: parseFloat(data.avg_max_salary) || 0,
            range: `${parseFloat(data.min_salary) || 0} - ${parseFloat(data.max_salary) || 0}`,
          },
          demandScore: demandScore.score,
          demandLevel: demandScore.level,
          location: location || 'Global',
          experienceLevel: experience,
        },
        interpretation: this.interpretMarketValue(data, demandScore),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate skill demand score
   */
  async calculateSkillDemandScore(skillId, location = null) {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

      const demandData = await this.prisma.$queryRaw`
        WITH recent_data AS (
          SELECT 
            COUNT(CASE WHEN js.created_at >= ${thirtyDaysAgo} THEN 1 END) as recent_jobs,
            COUNT(CASE WHEN us.created_at >= ${thirtyDaysAgo} THEN 1 END) as recent_users,
            COUNT(CASE WHEN js.created_at >= ${sixtyDaysAgo} AND js.created_at < ${thirtyDaysAgo} THEN 1 END) as previous_jobs,
            COUNT(CASE WHEN us.created_at >= ${sixtyDaysAgo} AND us.created_at < ${thirtyDaysAgo} THEN 1 END) as previous_users
          FROM "Skill" s
          LEFT JOIN "JobSkill" js ON js.skill_id = s.id
            ${location ? this.prisma.$raw(`AND js.location ILIKE '%${location}%'`) : ''}
          LEFT JOIN "UserSkill" us ON us.skill_id = s.id
          WHERE s.id = ${skillId}
        )
        SELECT 
          recent_jobs,
          recent_users,
          previous_jobs,
          previous_users,
          CASE 
            WHEN previous_jobs = 0 THEN recent_jobs * 100.0
            ELSE ((recent_jobs - previous_jobs) * 100.0 / previous_jobs)
          END as job_growth,
          CASE 
            WHEN previous_users = 0 THEN recent_users * 100.0
            ELSE ((recent_users - previous_users) * 100.0 / previous_users)
          END as user_growth,
          CASE 
            WHEN recent_users = 0 THEN recent_jobs * 10.0
            ELSE (recent_jobs * 10.0 / recent_users)
          END as demand_ratio
        FROM recent_data
      `;

      const data = demandData[0] || {};
      const jobGrowth = parseFloat(data.job_growth) || 0;
      const demandRatio = parseFloat(data.demand_ratio) || 0;

      // Calculate composite score (0-100)
      let score = 0;
      score += Math.min(40, (jobGrowth / 10) * 4); // Growth component (max 40)
      score += Math.min(60, demandRatio * 6); // Demand ratio component (max 60)

      score = Math.min(100, Math.max(0, score));

      // Determine demand level
      let level = 'LOW';
      if (score >= 80) level = 'VERY_HIGH';
      else if (score >= 60) level = 'HIGH';
      else if (score >= 40) level = 'MEDIUM';
      else if (score >= 20) level = 'LOW';

      return {
        score,
        level,
        details: {
          recentJobs: parseInt(data.recent_jobs) || 0,
          recentUsers: parseInt(data.recent_users) || 0,
          jobGrowth,
          demandRatio,
        },
      };
    } catch (error) {
      return {
        score: 0,
        level: 'LOW',
        details: {},
      };
    }
  }

  /**
   * Interpret market value
   */
  interpretMarketValue(salaryData, demandScore) {
    const interpretations = [];

    const avgSalary = parseFloat(salaryData.avg_min_salary) || 0;

    if (avgSalary > 100000) {
      interpretations.push('High earning potential');
    } else if (avgSalary > 60000) {
      interpretations.push('Good earning potential');
    } else {
      interpretations.push('Moderate earning potential');
    }

    if (demandScore.level === 'VERY_HIGH') {
      interpretations.push('Very high market demand');
    } else if (demandScore.level === 'HIGH') {
      interpretations.push('High market demand');
    } else if (demandScore.level === 'MEDIUM') {
      interpretations.push('Moderate market demand');
    } else {
      interpretations.push('Lower market demand');
    }

    const jobCount = parseInt(salaryData.job_count) || 0;
    if (jobCount > 1000) {
      interpretations.push('Abundant job opportunities');
    } else if (jobCount > 100) {
      interpretations.push('Good job opportunities');
    } else if (jobCount > 10) {
      interpretations.push('Limited job opportunities');
    } else {
      interpretations.push('Few job opportunities');
    }

    return interpretations;
  }

  /**
   * Sync skills from external source (LinkedIn, etc.)
   */
  async syncSkillsFromExternal(userId, externalSkills, source = 'LINKEDIN') {
    try {
      const results = [];

      for (const externalSkill of externalSkills) {
        try {
          // Find or create skill
          let skill = await this.prisma.skill.findUnique({
            where: { name: externalSkill.name },
          });

          if (!skill) {
            skill = await this.prisma.skill.create({
              data: {
                name: externalSkill.name,
                category: externalSkill.category || 'Other',
                description: externalSkill.description || '',
                externalSource: source,
              },
            });
          }

          // Check if user already has this skill
          const existing = await this.prisma.userSkill.findFirst({
            where: {
              userId,
              skillId: skill.id,
            },
          });

          if (existing) {
            // Update with external data
            await this.prisma.userSkill.update({
              where: { id: existing.id },
              data: {
                proficiency: externalSkill.proficiency || existing.proficiency,
                yearsExperience: externalSkill.yearsExperience || existing.yearsExperience,
                externalSource: source,
                externalData: externalSkill,
                updatedAt: new Date(),
              },
            });
            results.push({ skill: skill.name, action: 'UPDATED' });
          } else {
            // Create new user skill
            await this.prisma.userSkill.create({
              data: {
                userId,
                skillId: skill.id,
                proficiency: externalSkill.proficiency || 3,
                yearsExperience: externalSkill.yearsExperience || 1,
                externalSource: source,
                externalData: externalSkill,
              },
            });
            results.push({ skill: skill.name, action: 'CREATED' });
          }
        } catch (error) {
          results.push({ 
            skill: externalSkill.name, 
            action: 'ERROR', 
            error: error.message 
          });
        }
      }

      return {
        total: externalSkills.length,
        processed: results.length,
        results,
        source,
        syncedAt: new Date(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get skill proficiency distribution
   */
  async getProficiencyDistribution(skillId) {
    try {
      const distribution = await this.prisma.userSkill.groupBy({
        by: ['proficiency'],
        where: { skillId },
        _count: { _all: true },
      });

      return distribution.map(item => ({
        proficiency: item.proficiency,
        count: item._count._all,
        percentage: 0, // Will be calculated client-side
      }));
    } catch (error) {
      return [];
    }
  }

  /**
   * Generate skill report
   */
  async generateSkillReport(skillId) {
    try {
      const [
        skill,
        marketValue,
        proficiencyDistribution,
        topUsers,
        relatedJobs,
        learningResources,
      ] = await Promise.all([
        this.findById(skillId),
        this.calculateSkillMarketValue(skillId),
        this.getProficiencyDistribution(skillId),
        this.getTopUsersBySkill(skillId, 10),
        this.getRelatedJobs(skillId, 10),
        this.getLearningResources(skillId),
      ]);

      // Calculate total statistics
      const totalUsers = proficiencyDistribution.reduce((sum, item) => sum + item.count, 0);
      const avgProficiency = proficiencyDistribution.reduce((sum, item) => 
        sum + (item.proficiency * item.count), 0) / totalUsers;

      return {
        skill,
        marketValue,
        userStatistics: {
          totalUsers,
          avgProficiency,
          distribution: proficiencyDistribution,
        },
        topUsers,
        relatedJobs,
        learningResources,
        reportGenerated: new Date().toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get top users by skill
   */
  async getTopUsersBySkill(skillId, limit = 10) {
    try {
      return await this.prisma.userSkill.findMany({
        where: { 
          skillId,
          verified: true,
        },
        include: {
          user: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              avatar: true,
              profile: true,
            },
          },
          endorsements: {
            select: { id: true },
          },
        },
        orderBy: [
          { yearsExperience: 'desc' },
          { endorsements: { _count: 'desc' } },
        ],
        take: limit,
      });
    } catch (error) {
      return [];
    }
  }

  /**
   * Get related jobs
   */
  async getRelatedJobs(skillId, limit = 10) {
    try {
      return await this.prisma.job.findMany({
        where: {
          skills: {
            some: { skillId },
          },
          status: 'PUBLISHED',
          expiresAt: { gt: new Date() },
        },
        include: {
          company: true,
          _count: {
            select: {
              applications: true,
            },
          },
        },
        orderBy: { postedAt: 'desc' },
        take: limit,
      });
    } catch (error) {
      return [];
    }
  }
}

module.exports = SkillRepository;
