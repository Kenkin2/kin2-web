const BaseRepository = require('../BaseRepository');

class ExperienceRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'experience');
  }

  /**
   * Find experiences by user ID
   */
  async findByUserId(userId, options = {}) {
    try {
      return await this.findMany({
        where: { userId },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get user's work experience timeline
   */
  async getWorkTimeline(userId) {
    try {
      const experiences = await this.findByUserId(userId, {
        orderBy: { startDate: 'desc' },
      });

      // Calculate total experience
      let totalExperience = 0;
      experiences.forEach(exp => {
        const endDate = exp.current ? new Date() : exp.endDate;
        const years = (endDate - exp.startDate) / (1000 * 60 * 60 * 24 * 365.25);
        totalExperience += years;
      });

      // Group by year
      const timeline = experiences.map(exp => ({
        ...exp,
        duration: this.calculateDuration(exp.startDate, exp.endDate, exp.current),
        skills: exp.skills || [],
        achievements: exp.achievements || [],
      }));

      return {
        timeline,
        totalExperience: parseFloat(totalExperience.toFixed(1)),
        currentPosition: experiences.find(exp => exp.current),
        previousPositions: experiences.filter(exp => !exp.current),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate duration in years and months
   */
  calculateDuration(startDate, endDate, isCurrent) {
    const start = new Date(startDate);
    const end = isCurrent ? new Date() : new Date(endDate);
    
    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    
    if (months < 0) {
      years--;
      months += 12;
    }
    
    // Adjust for days
    if (end.getDate() < start.getDate()) {
      months--;
      if (months < 0) {
        years--;
        months += 12;
      }
    }
    
    return { years, months };
  }

  /**
   * Add experience with validation
   */
  async create(data) {
    try {
      // Validate date ranges
      if (data.startDate && data.endDate && !data.current) {
        const start = new Date(data.startDate);
        const end = new Date(data.endDate);
        
        if (end <= start) {
          throw new Error('End date must be after start date');
        }
      }

      // If current is true, set endDate to null
      if (data.current) {
        data.endDate = null;
      }

      return await super.create(data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Update experience
   */
  async update(id, data) {
    try {
      const experience = await this.findById(id);
      if (!experience) {
        throw new Error('Experience not found');
      }

      // Validate date ranges
      if (data.startDate || data.endDate || data.current !== undefined) {
        const startDate = new Date(data.startDate || experience.startDate);
        const endDate = data.current ? null : new Date(data.endDate || experience.endDate);
        
        if (!data.current && endDate && endDate <= startDate) {
          throw new Error('End date must be after start date');
        }
      }

      // If setting to current, clear endDate
      if (data.current) {
        data.endDate = null;
      }

      return await super.update(id, data);
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate total years of experience
   */
  async calculateTotalExperience(userId) {
    try {
      const experiences = await this.findByUserId(userId);
      
      let totalMonths = 0;
      let currentDate = new Date();
      
      experiences.forEach(exp => {
        const start = new Date(exp.startDate);
        const end = exp.current ? currentDate : new Date(exp.endDate);
        
        let months = (end.getFullYear() - start.getFullYear()) * 12;
        months += end.getMonth() - start.getMonth();
        
        // Adjust for days
        if (end.getDate() < start.getDate()) {
          months--;
        }
        
        totalMonths += months;
      });
      
      const years = Math.floor(totalMonths / 12);
      const months = totalMonths % 12;
      
      return { years, months, totalMonths };
    } catch (error) {
      return { years: 0, months: 0, totalMonths: 0 };
    }
  }

  /**
   * Get experience by industry
   */
  async getExperienceByIndustry(userId) {
    try {
      const experiences = await this.findByUserId(userId);
      
      const industryMap = {};
      experiences.forEach(exp => {
        const industry = exp.industry || 'Other';
        if (!industryMap[industry]) {
          industryMap[industry] = {
            count: 0,
            totalMonths: 0,
            positions: [],
          };
        }
        
        industryMap[industry].count++;
        
        // Calculate duration in months
        const start = new Date(exp.startDate);
        const end = exp.current ? new Date() : new Date(exp.endDate);
        let months = (end.getFullYear() - start.getFullYear()) * 12;
        months += end.getMonth() - start.getMonth();
        
        industryMap[industry].totalMonths += months;
        industryMap[industry].positions.push({
          title: exp.title,
          company: exp.company,
          duration: months,
        });
      });
      
      // Convert to array and calculate percentages
      return Object.entries(industryMap).map(([industry, data]) => {
        const totalMonths = Object.values(industryMap).reduce((sum, d) => sum + d.totalMonths, 0);
        const percentage = totalMonths > 0 ? (data.totalMonths / totalMonths) * 100 : 0;
        
        return {
          industry,
          positions: data.count,
          totalMonths: data.totalMonths,
          years: parseFloat((data.totalMonths / 12).toFixed(1)),
          percentage: parseFloat(percentage.toFixed(1)),
          positionsList: data.positions,
        };
      }).sort((a, b) => b.totalMonths - a.totalMonths);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get skills gained from experience
   */
  async getExperienceSkills(userId) {
    try {
      const experiences = await this.findByUserId(userId);
      
      const skillsMap = {};
      experiences.forEach(exp => {
        const expSkills = exp.skills || [];
        expSkills.forEach(skill => {
          if (!skillsMap[skill]) {
            skillsMap[skill] = {
              count: 0,
              positions: [],
              totalMonths: 0,
            };
          }
          
          skillsMap[skill].count++;
          skillsMap[skill].positions.push({
            title: exp.title,
            company: exp.company,
          });
          
          // Add duration for weighting
          const start = new Date(exp.startDate);
          const end = exp.current ? new Date() : new Date(exp.endDate);
          let months = (end.getFullYear() - start.getFullYear()) * 12;
          months += end.getMonth() - start.getMonth();
          
          skillsMap[skill].totalMonths += months;
        });
      });
      
      // Convert to array and sort by frequency and duration
      return Object.entries(skillsMap)
        .map(([skill, data]) => ({
          skill,
          frequency: data.count,
          totalMonths: data.totalMonths,
          positions: data.positions,
          relevance: data.count * 2 + data.totalMonths / 6, // Weighted score
        }))
        .sort((a, b) => b.relevance - a.relevance);
    } catch (error) {
      return [];
    }
  }

  /**
   * Verify work experience
   */
  async verifyExperience(experienceId, verifiedBy, evidence = null) {
    try {
      const experience = await this.findById(experienceId);
      if (!experience) {
        throw new Error('Experience not found');
      }

      const updated = await this.update(experienceId, {
        verified: true,
        verifiedBy,
        verifiedAt: new Date(),
        verificationEvidence: evidence,
      });

      // Create verification log
      await this.prisma.adminLog.create({
        data: {
          adminId: verifiedBy,
          action: 'EXPERIENCE_VERIFICATION',
          targetType: 'EXPERIENCE',
          targetId: experienceId,
          details: {
            userId: experience.userId,
            company: experience.company,
            title: experience.title,
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
   * Get employment gaps
   */
  async getEmploymentGaps(userId) {
    try {
      const experiences = await this.findByUserId(userId, {
        orderBy: { startDate: 'asc' },
      });

      if (experiences.length < 2) {
        return [];
      }

      const gaps = [];
      for (let i = 0; i < experiences.length - 1; i++) {
        const current = experiences[i];
        const next = experiences[i + 1];

        const currentEnd = current.current ? new Date() : new Date(current.endDate);
        const nextStart = new Date(next.startDate);

        // Check for gap (more than 30 days)
        const gapDays = (nextStart - currentEnd) / (1000 * 60 * 60 * 24);
        if (gapDays > 30) {
          const gapMonths = gapDays / 30.44;
          gaps.push({
            start: currentEnd,
            end: nextStart,
            durationDays: Math.round(gapDays),
            durationMonths: parseFloat(gapMonths.toFixed(1)),
            betweenPositions: `${current.title} at ${current.company} → ${next.title} at ${next.company}`,
          });
        }
      }

      // Check gap after last position if not current
      const lastExperience = experiences[experiences.length - 1];
      if (!lastExperience.current) {
        const lastEnd = new Date(lastExperience.endDate);
        const today = new Date();
        const gapDays = (today - lastEnd) / (1000 * 60 * 60 * 24);
        
        if (gapDays > 30) {
          const gapMonths = gapDays / 30.44;
          gaps.push({
            start: lastEnd,
            end: today,
            durationDays: Math.round(gapDays),
            durationMonths: parseFloat(gapMonths.toFixed(1)),
            betweenPositions: `${lastExperience.title} at ${lastExperience.company} → Present`,
            isCurrent: true,
          });
        }
      }

      return gaps.sort((a, b) => b.durationDays - a.durationDays);
    } catch (error) {
      return [];
    }
  }

  /**
   * Generate experience summary
   */
  async generateExperienceSummary(userId) {
    try {
      const [
        timeline,
        totalExperience,
        byIndustry,
        skills,
        gaps,
        achievements,
      ] = await Promise.all([
        this.getWorkTimeline(userId),
        this.calculateTotalExperience(userId),
        this.getExperienceByIndustry(userId),
        this.getExperienceSkills(userId),
        this.getEmploymentGaps(userId),
        this.getCareerAchievements(userId),
      ]);

      // Calculate career progression
      const progression = this.calculateCareerProgression(timeline.timeline);

      // Generate strengths
      const strengths = this.identifyStrengths(skills, byIndustry, timeline.totalExperience);

      return {
        summary: {
          totalYears: totalExperience.years,
          totalMonths: totalExperience.months,
          positions: timeline.timeline.length,
          industries: byIndustry.length,
          uniqueSkills: skills.length,
          employmentGaps: gaps.length,
        },
        timeline: timeline.timeline.slice(0, 10), // Recent 10 positions
        byIndustry: byIndustry.slice(0, 5), // Top 5 industries
        topSkills: skills.slice(0, 10), // Top 10 skills
        employmentGaps: gaps,
        careerProgression: progression,
        achievements,
        strengths,
        recommendations: this.generateCareerRecommendations(gaps, strengths, progression),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get career achievements
   */
  async getCareerAchievements(userId) {
    try {
      const experiences = await this.findByUserId(userId);
      
      const achievements = [];
      experiences.forEach(exp => {
        const expAchievements = exp.achievements || [];
        expAchievements.forEach(achievement => {
          achievements.push({
            title: exp.title,
            company: exp.company,
            achievement,
            date: exp.startDate,
          });
        });
      });
      
      return achievements.sort((a, b) => new Date(b.date) - new Date(a.date));
    } catch (error) {
      return [];
    }
  }

  /**
   * Calculate career progression
   */
  calculateCareerProgression(timeline) {
    if (timeline.length < 2) {
      return { progression: 'EARLY_CAREER', details: 'Just starting career journey' };
    }

    // Analyze title progression
    const titles = timeline.map(exp => exp.title.toLowerCase());
    const seniorityKeywords = {
      'junior': 1,
      'associate': 2,
      'mid': 3,
      'senior': 4,
      'lead': 5,
      'principal': 6,
      'director': 7,
      'vp': 8,
      'c-level': 9,
      'founder': 10,
    };

    let progressionScore = 0;
    let hasProgression = false;

    for (let i = 1; i < titles.length; i++) {
      const current = titles[i];
      const previous = titles[i - 1];

      let currentScore = 0;
      let previousScore = 0;

      Object.entries(seniorityKeywords).forEach(([keyword, score]) => {
        if (current.includes(keyword)) currentScore = Math.max(currentScore, score);
        if (previous.includes(keyword)) previousScore = Math.max(previousScore, score);
      });

      if (currentScore > previousScore) {
        hasProgression = true;
        progressionScore += (currentScore - previousScore);
      }
    }

    // Determine career stage
    const avgDuration = timeline.reduce((sum, exp) => 
      sum + (exp.duration.years + exp.duration.months / 12), 0) / timeline.length;

    if (avgDuration < 2) {
      return { progression: 'EARLY_CAREER', score: progressionScore, hasProgression };
    } else if (avgDuration < 5) {
      return { progression: 'MID_CAREER', score: progressionScore, hasProgression };
    } else if (avgDuration < 10) {
      return { progression: 'EXPERIENCED', score: progressionScore, hasProgression };
    } else {
      return { progression: 'SEASONED', score: progressionScore, hasProgression };
    }
  }

  /**
   * Identify strengths
   */
  identifyStrengths(skills, industries, totalExperience) {
    const strengths = [];

    // Industry expertise
    if (industries.length > 0) {
      const primaryIndustry = industries[0];
      if (primaryIndustry.years >= 3) {
        strengths.push({
          type: 'INDUSTRY_EXPERTISE',
          description: `${primaryIndustry.years} years in ${primaryIndustry.industry}`,
          strengthLevel: primaryIndustry.years >= 5 ? 'STRONG' : 'MODERATE',
        });
      }
    }

    // Technical skills
    const technicalSkills = skills.filter(s => 
      ['javascript', 'python', 'java', 'react', 'node', 'sql', 'aws'].some(tech => 
        s.skill.toLowerCase().includes(tech)
      )
    );

    if (technicalSkills.length >= 3) {
      strengths.push({
        type: 'TECHNICAL_SKILLS',
        description: `Proficient in ${technicalSkills.length} technical skills`,
        strengthLevel: 'STRONG',
        skills: technicalSkills.slice(0, 3).map(s => s.skill),
      });
    }

    // Leadership experience
    const leadershipRoles = skills.filter(s => 
      ['lead', 'manage', 'direct', 'supervise', 'mentor'].some(keyword => 
        s.skill.toLowerCase().includes(keyword)
      )
    );

    if (leadershipRoles.length > 0) {
      strengths.push({
        type: 'LEADERSHIP',
        description: 'Experience in leadership and management',
        strengthLevel: 'MODERATE',
      });
    }

    // Career longevity
    if (totalExperience >= 10) {
      strengths.push({
        type: 'EXPERIENCE',
        description: `${totalExperience} years of professional experience`,
        strengthLevel: 'STRONG',
      });
    }

    return strengths;
  }

  /**
   * Generate career recommendations
   */
  generateCareerRecommendations(gaps, strengths, progression) {
    const recommendations = [];

    // Gap recommendations
    if (gaps.length > 0) {
      const totalGapMonths = gaps.reduce((sum, gap) => sum + gap.durationMonths, 0);
      if (totalGapMonths > 6) {
        recommendations.push({
          type: 'EMPLOYMENT_GAP',
          title: 'Address Employment Gaps',
          description: `Consider explaining ${totalGapMonths.toFixed(1)} months of employment gaps in your profile`,
          priority: 'MEDIUM',
        });
      }
    }

    // Progression recommendations
    if (!progression.hasProgression && progression.progression !== 'EARLY_CAREER') {
      recommendations.push({
        type: 'CAREER_PROGRESSION',
        title: 'Career Progression',
        description: 'Consider seeking positions with increased responsibility',
        priority: 'LOW',
      });
    }

    // Skill development recommendations
    const hasTechnical = strengths.some(s => s.type === 'TECHNICAL_SKILLS');
    if (!hasTechnical) {
      recommendations.push({
        type: 'SKILL_DEVELOPMENT',
        title: 'Develop Technical Skills',
        description: 'Consider learning in-demand technical skills',
        priority: 'HIGH',
      });
    }

    return recommendations;
  }

  /**
   * Import experience from LinkedIn
   */
  async importFromLinkedIn(userId, linkedInData) {
    try {
      const results = [];

      for (const position of linkedInData.positions) {
        try {
          // Check if similar experience already exists
          const existing = await this.findFirst({
            userId,
            company: { contains: position.company, mode: 'insensitive' },
            title: { contains: position.title, mode: 'insensitive' },
          });

          if (existing) {
            // Update existing experience
            const updated = await this.update(existing.id, {
              description: position.description || existing.description,
              location: position.location || existing.location,
              startDate: position.startDate || existing.startDate,
              endDate: position.endDate || existing.endDate,
              current: position.current || existing.current,
              skills: position.skills || existing.skills,
              achievements: position.achievements || existing.achievements,
              externalSource: 'LINKEDIN',
              externalData: position,
            });
            results.push({ action: 'UPDATED', company: position.company, title: position.title });
          } else {
            // Create new experience
            const created = await this.create({
              userId,
              title: position.title,
              company: position.company,
              description: position.description,
              location: position.location,
              startDate: position.startDate,
              endDate: position.endDate,
              current: position.current,
              employmentType: position.employmentType,
              industry: position.industry,
              skills: position.skills,
              achievements: position.achievements,
              externalSource: 'LINKEDIN',
              externalData: position,
            });
            results.push({ action: 'CREATED', company: position.company, title: position.title });
          }
        } catch (error) {
          results.push({ 
            action: 'ERROR', 
            company: position.company, 
            title: position.title,
            error: error.message 
          });
        }
      }

      return {
        total: linkedInData.positions.length,
        processed: results.length,
        results,
        source: 'LINKEDIN',
        importedAt: new Date(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Export experience data
   */
  async exportExperienceData(userId, format = 'JSON') {
    try {
      const experiences = await this.findByUserId(userId, {
        orderBy: { startDate: 'desc' },
      });

      // Calculate summary statistics
      const totalExperience = await this.calculateTotalExperience(userId);
      const byIndustry = await this.getExperienceByIndustry(userId);
      const skills = await this.getExperienceSkills(userId);

      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          format,
          userId,
          totalPositions: experiences.length,
          totalExperience: `${totalExperience.years} years ${totalExperience.months} months`,
        },
        experiences,
        statistics: {
          byIndustry: byIndustry.slice(0, 5),
          topSkills: skills.slice(0, 10),
          totalMonths: totalExperience.totalMonths,
        },
      };

      if (format === 'PDF') {
        // This would generate a PDF in production
        return {
          data: exportData,
          message: 'PDF generation would be implemented here',
        };
      }

      return exportData;
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get experience recommendations for jobs
   */
  async getExperienceRecommendations(userId, jobId) {
    try {
      const experiences = await this.findByUserId(userId);
      const job = await this.prisma.job.findUnique({
        where: { id: jobId },
        select: {
          title: true,
          requirements: true,
          experienceLevel: true,
        },
      });

      if (!job) {
        throw new Error('Job not found');
      }

      const recommendations = [];

      // Check for relevant experience
      const relevantExperience = experiences.filter(exp => 
        exp.title.toLowerCase().includes(job.title.toLowerCase().split(' ')[0]) ||
        (exp.description && exp.description.toLowerCase().includes(job.title.toLowerCase().split(' ')[0]))
      );

      if (relevantExperience.length > 0) {
        recommendations.push({
          type: 'RELEVANT_EXPERIENCE',
          title: 'Relevant Experience Found',
          description: `You have ${relevantExperience.length} position(s) relevant to this role`,
          experience: relevantExperience.map(exp => ({
            title: exp.title,
            company: exp.company,
            duration: `${exp.duration?.years || 0} years`,
          })),
          priority: 'HIGH',
        });
      }

      // Check experience level match
      const experienceLevels = {
        'ENTRY': 0,
        'JUNIOR': 1,
        'MID': 3,
        'SENIOR': 5,
        'LEAD': 8,
        'EXECUTIVE': 10,
      };

      const requiredYears = experienceLevels[job.experienceLevel] || 3;
      const userExperience = await this.calculateTotalExperience(userId);
      const userYears = userExperience.totalMonths / 12;

      if (userYears >= requiredYears) {
        recommendations.push({
          type: 'EXPERIENCE_LEVEL',
          title: 'Experience Level Match',
          description: `Your ${userYears.toFixed(1)} years of experience meets the ${requiredYears}+ years requirement`,
          priority: 'HIGH',
        });
      } else {
        recommendations.push({
          type: 'EXPERIENCE_GAP',
          title: 'Experience Gap',
          description: `You have ${userYears.toFixed(1)} years of experience but ${requiredYears}+ years are required`,
          priority: 'MEDIUM',
        });
      }

      // Check for required skills in experience
      const requiredSkills = this.extractSkillsFromText(job.requirements);
      const userSkills = await this.getExperienceSkills(userId);
      const userSkillNames = userSkills.map(s => s.skill.toLowerCase());

      const matchedSkills = requiredSkills.filter(skill => 
        userSkillNames.some(userSkill => userSkill.includes(skill.toLowerCase()))
      );

      if (matchedSkills.length > 0) {
        recommendations.push({
          type: 'SKILL_VALIDATION',
          title: 'Skills Validated by Experience',
          description: `${matchedSkills.length} required skills are validated by your work experience`,
          skills: matchedSkills.slice(0, 5),
          priority: 'HIGH',
        });
      }

      return {
        job: { title: job.title, experienceLevel: job.experienceLevel },
        userExperience: { years: userYears },
        recommendations,
        matchScore: this.calculateExperienceMatchScore(relevantExperience.length, userYears, requiredYears, matchedSkills.length),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Extract skills from text
   */
  extractSkillsFromText(text) {
    if (!text) return [];
    
    const commonSkills = [
      'javascript', 'python', 'java', 'react', 'node.js', 'typescript',
      'html', 'css', 'sql', 'mongodb', 'aws', 'docker', 'kubernetes',
      'git', 'agile', 'scrum', 'machine learning', 'ai', 'data science',
      'product management', 'ux', 'ui', 'design', 'devops', 'cloud',
    ];

    const textLower = text.toLowerCase();
    return commonSkills.filter(skill => textLower.includes(skill));
  }

  /**
   * Calculate experience match score
   */
  calculateExperienceMatchScore(relevantPositions, userYears, requiredYears, matchedSkills) {
    let score = 0;
    
    // Relevant positions score (max 30)
    score += Math.min(30, relevantPositions * 10);
    
    // Experience years score (max 40)
    if (userYears >= requiredYears) {
      score += 40;
    } else {
      score += (userYears / requiredYears) * 40;
    }
    
    // Skills match score (max 30)
    score += Math.min(30, matchedSkills * 6);
    
    return Math.min(100, score);
  }

  /**
   * Bulk update experience
   */
  async bulkUpdateExperience(userId, updates) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        const results = [];

        for (const update of updates) {
          try {
            const experience = await prisma.experience.findUnique({
              where: { id: update.id },
            });

            if (!experience || experience.userId !== userId) {
              throw new Error('Experience not found or unauthorized');
            }

            const updated = await prisma.experience.update({
              where: { id: update.id },
              data: update.data,
            });

            results.push({
              success: true,
              id: update.id,
              action: 'UPDATED',
            });
          } catch (error) {
            results.push({
              success: false,
              id: update.id,
              action: 'ERROR',
              error: error.message,
            });
          }
        }

        return {
          total: updates.length,
          processed: results.length,
          results,
        };
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get experience analytics
   */
  async getExperienceAnalytics(userId) {
    try {
      const [
        timeline,
        totalExperience,
        byIndustry,
        skills,
        gaps,
        achievements,
      ] = await Promise.all([
        this.getWorkTimeline(userId),
        this.calculateTotalExperience(userId),
        this.getExperienceByIndustry(userId),
        this.getExperienceSkills(userId),
        this.getEmploymentGaps(userId),
        this.getCareerAchievements(userId),
      ]);

      // Calculate analytics
      const analytics = {
        careerDuration: {
          totalYears: totalExperience.years,
          totalMonths: totalExperience.months,
          averagePositionDuration: this.calculateAveragePositionDuration(timeline.timeline),
          longestPosition: this.findLongestPosition(timeline.timeline),
          shortestPosition: this.findShortestPosition(timeline.timeline),
        },
        industryAnalysis: {
          primaryIndustry: byIndustry[0] || null,
          industryDiversity: byIndustry.length,
          industryConcentration: this.calculateIndustryConcentration(byIndustry),
        },
        skillAnalysis: {
          totalSkills: skills.length,
          technicalSkills: skills.filter(s => this.isTechnicalSkill(s.skill)).length,
          softSkills: skills.filter(s => !this.isTechnicalSkill(s.skill)).length,
          mostFrequentSkill: skills[0] || null,
          skillDiversity: this.calculateSkillDiversity(skills),
        },
        employmentPatterns: {
          totalGaps: gaps.length,
          totalGapMonths: gaps.reduce((sum, gap) => sum + gap.durationMonths, 0),
          averageGapDuration: gaps.length > 0 ? 
            gaps.reduce((sum, gap) => sum + gap.durationMonths, 0) / gaps.length : 0,
          hasCurrentGap: gaps.some(gap => gap.isCurrent),
        },
        achievementAnalysis: {
          totalAchievements: achievements.length,
          achievementsPerPosition: achievements.length / timeline.timeline.length || 0,
          recentAchievements: achievements.slice(0, 5),
        },
      };

      // Generate insights
      const insights = this.generateExperienceInsights(analytics);

      return {
        analytics,
        insights,
        summary: {
          careerStage: this.determineCareerStage(totalExperience.years),
          marketValue: this.estimateMarketValue(analytics),
          growthPotential: this.assessGrowthPotential(analytics),
        },
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate average position duration
   */
  calculateAveragePositionDuration(timeline) {
    if (timeline.length === 0) return 0;
    
    const totalMonths = timeline.reduce((sum, exp) => {
      const months = exp.duration.years * 12 + exp.duration.months;
      return sum + months;
    }, 0);
    
    return parseFloat((totalMonths / timeline.length).toFixed(1));
  }

  /**
   * Find longest position
   */
  findLongestPosition(timeline) {
    if (timeline.length === 0) return null;
    
    return timeline.reduce((longest, current) => {
      const currentMonths = current.duration.years * 12 + current.duration.months;
      const longestMonths = longest.duration.years * 12 + longest.duration.months;
      return currentMonths > longestMonths ? current : longest;
    });
  }

  /**
   * Find shortest position
   */
  findShortestPosition(timeline) {
    if (timeline.length === 0) return null;
    
    return timeline.reduce((shortest, current) => {
      const currentMonths = current.duration.years * 12 + current.duration.months;
      const shortestMonths = shortest.duration.years * 12 + shortest.duration.months;
      return currentMonths < shortestMonths ? current : shortest;
    });
  }

  /**
   * Calculate industry concentration
   */
  calculateIndustryConcentration(industries) {
    if (industries.length === 0) return 0;
    
    const totalMonths = industries.reduce((sum, industry) => sum + industry.totalMonths, 0);
    const primaryIndustryMonths = industries[0]?.totalMonths || 0;
    
    return parseFloat(((primaryIndustryMonths / totalMonths) * 100).toFixed(1));
  }

  /**
   * Check if skill is technical
   */
  isTechnicalSkill(skill) {
    const technicalKeywords = [
      'javascript', 'python', 'java', 'react', 'node', 'sql', 'aws',
      'docker', 'kubernetes', 'git', 'api', 'database', 'cloud',
      'machine learning', 'ai', 'devops', 'frontend', 'backend',
    ];
    
    return technicalKeywords.some(keyword => 
      skill.toLowerCase().includes(keyword)
    );
  }

  /**
   * Calculate skill diversity
   */
  calculateSkillDiversity(skills) {
    if (skills.length === 0) return 0;
    
    const technicalCount = skills.filter(s => this.isTechnicalSkill(s.skill)).length;
    const softCount = skills.length - technicalCount;
    
    const diversity = 1 - Math.abs(technicalCount - softCount) / skills.length;
    return parseFloat((diversity * 100).toFixed(1));
  }

  /**
   * Generate experience insights
   */
  generateExperienceInsights(analytics) {
    const insights = [];

    // Position duration insight
    const avgDuration = analytics.careerDuration.averagePositionDuration;
    if (avgDuration < 12) {
      insights.push({
        type: 'POSITION_DURATION',
        title: 'Frequent Job Changes',
        description: `Average position duration is ${avgDuration} months. Consider longer tenure for career stability.`,
        severity: 'MEDIUM',
      });
    } else if (avgDuration > 48) {
      insights.push({
        type: 'POSITION_DURATION',
        title: 'Long Tenure',
        description: `Average position duration is ${avgDuration} months. Shows commitment and deep expertise.`,
        severity: 'LOW',
        positive: true,
      });
    }

    // Industry concentration insight
    const concentration = analytics.industryAnalysis.industryConcentration;
    if (concentration > 80) {
      insights.push({
        type: 'INDUSTRY_CONCENTRATION',
        title: 'Specialized Industry Experience',
        description: `${concentration}% of experience in primary industry. Demonstrates deep expertise.`,
        severity: 'LOW',
        positive: true,
      });
    } else if (concentration < 40) {
      insights.push({
        type: 'INDUSTRY_CONCENTRATION',
        title: 'Diverse Industry Experience',
        description: 'Experience spans multiple industries. Shows adaptability.',
        severity: 'LOW',
        positive: true,
      });
    }

    // Skill diversity insight
    const skillDiversity = analytics.skillAnalysis.skillDiversity;
    if (skillDiversity < 30) {
      insights.push({
        type: 'SKILL_DIVERSITY',
        title: 'Specialized Skill Set',
        description: 'Skills are concentrated in specific areas. Consider broadening skill set.',
        severity: 'MEDIUM',
      });
    } else if (skillDiversity > 70) {
      insights.push({
        type: 'SKILL_DIVERSITY',
        title: 'Broad Skill Set',
        description: 'Diverse skills across technical and soft skills.',
        severity: 'LOW',
        positive: true,
      });
    }

    // Employment gap insight
    const totalGapMonths = analytics.employmentPatterns.totalGapMonths;
    if (totalGapMonths > 12) {
      insights.push({
        type: 'EMPLOYMENT_GAPS',
        title: 'Significant Employment Gaps',
        description: `${totalGapMonths} months of employment gaps. Consider addressing in job applications.`,
        severity: 'HIGH',
      });
    }

    return insights;
  }

  /**
   * Determine career stage
   */
  determineCareerStage(years) {
    if (years < 2) return 'EARLY_CAREER';
    if (years < 5) return 'MID_CAREER';
    if (years < 10) return 'EXPERIENCED';
    if (years < 20) return 'SEASONED';
    return 'EXECUTIVE';
  }

  /**
   * Estimate market value
   */
  estimateMarketValue(analytics) {
    let baseValue = 50000; // Base salary
    
    // Add for experience years
    const years = analytics.careerDuration.totalYears;
    baseValue += years * 5000;
    
    // Add for industry specialization
    const concentration = analytics.industryAnalysis.industryConcentration;
    if (concentration > 70) baseValue += 10000;
    
    // Add for skill diversity
    const skillDiversity = analytics.skillAnalysis.skillDiversity;
    if (skillDiversity > 60) baseValue += 5000;
    
    // Adjust for position stability
    const avgDuration = analytics.careerDuration.averagePositionDuration;
    if (avgDuration > 24) baseValue += 5000;
    
    return baseValue;
  }

  /**
   * Assess growth potential
   */
  assessGrowthPotential(analytics) {
    let score = 0;
    
    // Experience years (max 30)
    const years = analytics.careerDuration.totalYears;
    score += Math.min(30, years * 3);
    
    // Industry diversity (max 20)
    const industryCount = analytics.industryAnalysis.industryDiversity;
    score += Math.min(20, industryCount * 4);
    
    // Skill diversity (max 25)
    const skillDiversity = analytics.skillAnalysis.skillDiversity;
    score += (skillDiversity / 100) * 25;
    
    // Achievement density (max 25)
    const achievementDensity = analytics.achievementAnalysis.achievementsPerPosition;
    score += Math.min(25, achievementDensity * 5);
    
    const level = score >= 70 ? 'HIGH' : score >= 40 ? 'MEDIUM' : 'LOW';
    
    return { score, level };
  }
}

module.exports = ExperienceRepository;
