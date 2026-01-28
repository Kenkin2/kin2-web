const BaseRepository = require('../BaseRepository');

class EducationRepository extends BaseRepository {
  constructor(prisma) {
    super(prisma, 'education');
  }

  /**
   * Find education by user ID
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
   * Get user's education timeline
   */
  async getEducationTimeline(userId) {
    try {
      const educations = await this.findByUserId(userId, {
        orderBy: { startDate: 'desc' },
      });

      // Calculate highest degree
      const highestDegree = this.getHighestDegree(educations);

      // Group by type
      const byType = this.groupEducationByType(educations);

      return {
        timeline: educations.map(edu => ({
          ...edu,
          duration: this.calculateEducationDuration(edu.startDate, edu.endDate, edu.current),
        })),
        highestDegree,
        byType,
        totalInstitutions: new Set(educations.map(e => e.institution)).size,
        totalDegrees: educations.length,
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate education duration
   */
  calculateEducationDuration(startDate, endDate, isCurrent) {
    const start = new Date(startDate);
    const end = isCurrent ? new Date() : new Date(endDate);
    
    const years = end.getFullYear() - start.getFullYear();
    const months = end.getMonth() - start.getMonth();
    
    return { years, months: Math.max(0, years * 12 + months) };
  }

  /**
   * Get highest degree
   */
  getHighestDegree(educations) {
    if (educations.length === 0) return null;

    const degreeRank = {
      'PHD': 6,
      'MASTER': 5,
      'BACHELOR': 4,
      'ASSOCIATE': 3,
      'DIPLOMA': 2,
      'CERTIFICATE': 1,
      'HIGH_SCHOOL': 0,
    };

    return educations.reduce((highest, current) => {
      const currentRank = degreeRank[current.degree?.toUpperCase()] || 0;
      const highestRank = degreeRank[highest.degree?.toUpperCase()] || 0;
      return currentRank > highestRank ? current : highest;
    });
  }

  /**
   * Group education by type
   */
  groupEducationByType(educations) {
    const groups = {
      'FORMAL': [],
      'CERTIFICATION': [],
      'WORKSHOP': [],
      'ONLINE': [],
      'OTHER': [],
    };

    educations.forEach(edu => {
      const type = edu.educationType || 'FORMAL';
      if (groups[type]) {
        groups[type].push(edu);
      } else {
        groups['OTHER'].push(edu);
      }
    });

    return Object.entries(groups)
      .filter(([type, items]) => items.length > 0)
      .map(([type, items]) => ({
        type,
        count: items.length,
        items: items.slice(0, 3),
      }));
  }

  /**
   * Add education with validation
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
   * Update education
   */
  async update(id, data) {
    try {
      const education = await this.findById(id);
      if (!education) {
        throw new Error('Education not found');
      }

      // Validate date ranges
      if (data.startDate || data.endDate || data.current !== undefined) {
        const startDate = new Date(data.startDate || education.startDate);
        const endDate = data.current ? null : new Date(data.endDate || education.endDate);
        
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
   * Verify education
   */
  async verifyEducation(educationId, verifiedBy, evidence = null) {
    try {
      const education = await this.findById(educationId);
      if (!education) {
        throw new Error('Education not found');
      }

      const updated = await this.update(educationId, {
        verified: true,
        verifiedBy,
        verifiedAt: new Date(),
        verificationEvidence: evidence,
      });

      // Create verification log
      await this.prisma.adminLog.create({
        data: {
          adminId: verifiedBy,
          action: 'EDUCATION_VERIFICATION',
          targetType: 'EDUCATION',
          targetId: educationId,
          details: {
            userId: education.userId,
            institution: education.institution,
            degree: education.degree,
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
   * Get education by institution
   */
  async findByInstitution(institution, options = {}) {
    try {
      return await this.findMany({
        where: {
          institution: { contains: institution, mode: 'insensitive' },
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get education by degree level
   */
  async findByDegreeLevel(degree, options = {}) {
    try {
      return await this.findMany({
        where: {
          degree: { contains: degree, mode: 'insensitive' },
        },
        ...options,
      });
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Calculate education level score
   */
  async calculateEducationScore(userId) {
    try {
      const educations = await this.findByUserId(userId);
      if (educations.length === 0) return 0;

      const degreeScores = {
        'PHD': 100,
        'MASTER': 85,
        'BACHELOR': 70,
        'ASSOCIATE': 55,
        'DIPLOMA': 40,
        'CERTIFICATE': 30,
        'HIGH_SCHOOL': 20,
      };

      // Get highest degree score
      const highestDegree = this.getHighestDegree(educations);
      const baseScore = degreeScores[highestDegree?.degree?.toUpperCase()] || 0;

      // Add bonus for additional degrees
      const additionalBonus = Math.min(20, (educations.length - 1) * 5);

      // Add bonus for prestigious institutions
      const institutionBonus = this.calculateInstitutionBonus(educations);

      return Math.min(100, baseScore + additionalBonus + institutionBonus);
    } catch (error) {
      return 0;
    }
  }

  /**
   * Calculate institution bonus
   */
  calculateInstitutionBonus(educations) {
    // This would typically check against a list of prestigious institutions
    const prestigiousInstitutions = [
      'harvard', 'stanford', 'mit', 'cambridge', 'oxford',
      'princeton', 'yale', 'columbia', 'caltech', 'chicago',
    ];

    let bonus = 0;
    educations.forEach(edu => {
      const institutionLower = edu.institution.toLowerCase();
      if (prestigiousInstitutions.some(prestige => institutionLower.includes(prestige))) {
        bonus += 5;
      }
    });

    return Math.min(10, bonus);
  }

  /**
   * Get education recommendations
   */
  async getEducationRecommendations(userId, targetRole) {
    try {
      const userEducation = await this.findByUserId(userId);
      const roleRequirements = this.getEducationRequirementsForRole(targetRole);

      const recommendations = [];

      // Check degree requirements
      if (roleRequirements.minDegree) {
        const userHighest = this.getHighestDegree(userEducation);
        const userDegreeLevel = this.getDegreeLevel(userHighest?.degree);
        const requiredLevel = this.getDegreeLevel(roleRequirements.minDegree);

        if (userDegreeLevel < requiredLevel) {
          recommendations.push({
            type: 'DEGREE_REQUIREMENT',
            title: 'Higher Education Required',
            description: `This role requires at least ${roleRequirements.minDegree}, but your highest degree is ${userHighest?.degree || 'not specified'}`,
            priority: 'HIGH',
            action: 'Consider pursuing higher education',
          });
        }
      }

      // Check field of study requirements
      if (roleRequirements.recommendedFields?.length > 0) {
        const userFields = userEducation.map(edu => edu.fieldOfStudy).filter(Boolean);
        const matchedFields = roleRequirements.recommendedFields.filter(field =>
          userFields.some(userField => userField.toLowerCase().includes(field.toLowerCase()))
        );

        if (matchedFields.length === 0) {
          recommendations.push({
            type: 'FIELD_OF_STUDY',
            title: 'Field of Study Mismatch',
            description: `Recommended fields: ${roleRequirements.recommendedFields.join(', ')}`,
            priority: 'MEDIUM',
            action: 'Consider relevant certifications or courses',
          });
        }
      }

      // Check for ongoing education
      const ongoingEducation = userEducation.filter(edu => edu.current);
      if (ongoingEducation.length === 0 && roleRequirements.continuousLearning) {
        recommendations.push({
          type: 'CONTINUOUS_LEARNING',
          title: 'Continuous Learning',
          description: 'This field requires continuous learning and skill updates',
          priority: 'LOW',
          action: 'Consider taking relevant courses or certifications',
        });
      }

      return {
        userEducation,
        roleRequirements,
        recommendations,
        matchScore: this.calculateEducationMatchScore(userEducation, roleRequirements),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Get education requirements for role
   */
  getEducationRequirementsForRole(role) {
    // This would typically come from a database
    const requirements = {
      'software_engineer': {
        minDegree: 'BACHELOR',
        recommendedFields: ['Computer Science', 'Software Engineering', 'Information Technology'],
        continuousLearning: true,
      },
      'data_scientist': {
        minDegree: 'MASTER',
        recommendedFields: ['Data Science', 'Statistics', 'Computer Science', 'Mathematics'],
        continuousLearning: true,
      },
      'product_manager': {
        minDegree: 'BACHELOR',
        recommendedFields: ['Business', 'Computer Science', 'Engineering', 'Design'],
        continuousLearning: true,
      },
      'marketing_specialist': {
        minDegree: 'BACHELOR',
        recommendedFields: ['Marketing', 'Business', 'Communications'],
        continuousLearning: true,
      },
    };

    return requirements[role] || {
      minDegree: 'BACHELOR',
      recommendedFields: [],
      continuousLearning: false,
    };
  }

  /**
   * Get degree level
   */
  getDegreeLevel(degree) {
    if (!degree) return 0;

    const levels = {
      'PHD': 6,
      'MASTER': 5,
      'BACHELOR': 4,
      'ASSOCIATE': 3,
      'DIPLOMA': 2,
      'CERTIFICATE': 1,
      'HIGH_SCHOOL': 0,
    };

    const degreeUpper = degree.toUpperCase();
    for (const [key, value] of Object.entries(levels)) {
      if (degreeUpper.includes(key)) {
        return value;
      }
    }

    return 0;
  }

  /**
   * Calculate education match score
   */
  calculateEducationMatchScore(userEducation, roleRequirements) {
    let score = 0;

    // Degree level match (max 60)
    const userHighest = this.getHighestDegree(userEducation);
    const userLevel = this.getDegreeLevel(userHighest?.degree);
    const requiredLevel = this.getDegreeLevel(roleRequirements.minDegree);

    if (userLevel >= requiredLevel) {
      score += 60;
    } else if (userLevel > 0) {
      score += (userLevel / requiredLevel) * 60;
    }

    // Field of study match (max 30)
    if (roleRequirements.recommendedFields?.length > 0) {
      const userFields = userEducation.map(edu => edu.fieldOfStudy).filter(Boolean);
      const matchedFields = roleRequirements.recommendedFields.filter(reqField =>
        userFields.some(userField => 
          userField.toLowerCase().includes(reqField.toLowerCase())
        )
      );

      score += (matchedFields.length / roleRequirements.recommendedFields.length) * 30;
    }

    // Continuous learning bonus (max 10)
    const ongoingEducation = userEducation.filter(edu => edu.current);
    if (ongoingEducation.length > 0 && roleRequirements.continuousLearning) {
      score += 10;
    }

    return Math.min(100, score);
  }

  /**
   * Import education from LinkedIn
   */
  async importFromLinkedIn(userId, linkedInData) {
    try {
      const results = [];

      for (const education of linkedInData.educations) {
        try {
          // Check if similar education already exists
          const existing = await this.findFirst({
            userId,
            institution: { contains: education.institution, mode: 'insensitive' },
            degree: { contains: education.degree, mode: 'insensitive' },
          });

          if (existing) {
            // Update existing education
            const updated = await this.update(existing.id, {
              fieldOfStudy: education.fieldOfStudy || existing.fieldOfStudy,
              startDate: education.startDate || existing.startDate,
              endDate: education.endDate || existing.endDate,
              current: education.current || existing.current,
              grade: education.grade || existing.grade,
              activities: education.activities || existing.activities,
              description: education.description || existing.description,
              externalSource: 'LINKEDIN',
              externalData: education,
            });
            results.push({ action: 'UPDATED', institution: education.institution, degree: education.degree });
          } else {
            // Create new education
            const created = await this.create({
              userId,
              institution: education.institution,
              degree: education.degree,
              fieldOfStudy: education.fieldOfStudy,
              startDate: education.startDate,
              endDate: education.endDate,
              current: education.current,
              educationType: 'FORMAL',
              grade: education.grade,
              activities: education.activities,
              description: education.description,
              externalSource: 'LINKEDIN',
              externalData: education,
            });
            results.push({ action: 'CREATED', institution: education.institution, degree: education.degree });
          }
        } catch (error) {
          results.push({ 
            action: 'ERROR', 
            institution: education.institution, 
            degree: education.degree,
            error: error.message 
          });
        }
      }

      return {
        total: linkedInData.educations.length,
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
   * Get education statistics
   */
  async getEducationStatistics(userId) {
    try {
      const educations = await this.findByUserId(userId);

      const statistics = {
        totalDegrees: educations.length,
        byDegreeLevel: this.groupByDegreeLevel(educations),
        byInstitution: this.groupByInstitution(educations),
        byYear: this.groupByGraduationYear(educations),
        averageDuration: this.calculateAverageDuration(educations),
        verificationStatus: {
          verified: educations.filter(e => e.verified).length,
          unverified: educations.filter(e => !e.verified).length,
        },
      };

      // Calculate education diversity score
      statistics.diversityScore = this.calculateDiversityScore(statistics);

      return statistics;
    } catch (error) {
      return {
        totalDegrees: 0,
        byDegreeLevel: [],
        byInstitution: [],
        byYear: [],
        averageDuration: 0,
        verificationStatus: { verified: 0, unverified: 0 },
        diversityScore: 0,
      };
    }
  }

  /**
   * Group by degree level
   */
  groupByDegreeLevel(educations) {
    const groups = {};
    
    educations.forEach(edu => {
      const degree = edu.degree || 'Unknown';
      if (!groups[degree]) {
        groups[degree] = 0;
      }
      groups[degree]++;
    });

    return Object.entries(groups)
      .map(([degree, count]) => ({ degree, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Group by institution
   */
  groupByInstitution(educations) {
    const groups = {};
    
    educations.forEach(edu => {
      const institution = edu.institution;
      if (!groups[institution]) {
        groups[institution] = 0;
      }
      groups[institution]++;
    });

    return Object.entries(groups)
      .map(([institution, count]) => ({ institution, count }))
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Group by graduation year
   */
  groupByGraduationYear(educations) {
    const groups = {};
    
    educations.forEach(edu => {
      if (edu.endDate) {
        const year = new Date(edu.endDate).getFullYear();
        if (!groups[year]) {
          groups[year] = 0;
        }
        groups[year]++;
      }
    });

    return Object.entries(groups)
      .map(([year, count]) => ({ year, count }))
      .sort((a, b) => b.year - a.year);
  }

  /**
   * Calculate average duration
   */
  calculateAverageDuration(educations) {
    if (educations.length === 0) return 0;

    let totalMonths = 0;
    let count = 0;

    educations.forEach(edu => {
      if (edu.startDate && edu.endDate && !edu.current) {
        const start = new Date(edu.startDate);
        const end = new Date(edu.endDate);
        const months = (end.getFullYear() - start.getFullYear()) * 12 + 
                      (end.getMonth() - start.getMonth());
        totalMonths += months;
        count++;
      }
    });

    return count > 0 ? parseFloat((totalMonths / count).toFixed(1)) : 0;
  }

  /**
   * Calculate diversity score
   */
  calculateDiversityScore(statistics) {
    let score = 0;

    // Institution diversity (max 40)
    const institutionCount = statistics.byInstitution.length;
    score += Math.min(40, institutionCount * 10);

    // Degree level diversity (max 30)
    const degreeLevelCount = statistics.byDegreeLevel.length;
    score += Math.min(30, degreeLevelCount * 10);

    // Time span diversity (max 30)
    const yearSpan = this.calculateYearSpan(statistics.byYear);
    score += Math.min(30, yearSpan * 3);

    return Math.min(100, score);
  }

  /**
   * Calculate year span
   */
  calculateYearSpan(byYear) {
    if (byYear.length === 0) return 0;
    
    const years = byYear.map(item => parseInt(item.year));
    const minYear = Math.min(...years);
    const maxYear = Math.max(...years);
    
    return maxYear - minYear;
  }

  /**
   * Get alumni network
   */
  async getAlumniNetwork(userId) {
    try {
      const userEducation = await this.findByUserId(userId);
      const userInstitutions = userEducation.map(edu => edu.institution);

      if (userInstitutions.length === 0) {
        return { connections: [], totalAlumni: 0 };
      }

      // Find other users who studied at the same institutions
      const alumni = await this.prisma.$queryRaw`
        SELECT DISTINCT 
          u.id,
          u.first_name,
          u.last_name,
          u.avatar,
          e.institution,
          e.degree,
          e.field_of_study,
          e.end_date
        FROM "Education" e
        INNER JOIN "User" u ON e.user_id = u.id
        WHERE e.institution IN (${userInstitutions.join(', ')})
          AND e.user_id != ${userId}
          AND u.status = 'ACTIVE'
        ORDER BY e.end_date DESC
        LIMIT 50
      `;

      // Group by institution
      const byInstitution = {};
      alumni.forEach(alumnus => {
        const institution = alumnus.institution;
        if (!byInstitution[institution]) {
          byInstitution[institution] = [];
        }
        byInstitution[institution].push(alumnus);
      });

      return {
        connections: alumni,
        byInstitution,
        totalAlumni: alumni.length,
        userInstitutions,
      };
    } catch (error) {
      return { connections: [], byInstitution: {}, totalAlumni: 0, userInstitutions: [] };
    }
  }

  /**
   * Generate education report
   */
  async generateEducationReport(userId) {
    try {
      const [
        timeline,
        highestDegree,
        statistics,
        educationScore,
        alumniNetwork,
        recommendations,
      ] = await Promise.all([
        this.getEducationTimeline(userId),
        this.getHighestDegree(await this.findByUserId(userId)),
        this.getEducationStatistics(userId),
        this.calculateEducationScore(userId),
        this.getAlumniNetwork(userId),
        this.getEducationRecommendations(userId, 'software_engineer'), // Default role
      ]);

      // Analyze education quality
      const qualityAnalysis = this.analyzeEducationQuality(timeline.timeline);

      // Calculate ROI (Return on Education)
      const roiAnalysis = this.calculateEducationROI(timeline.timeline);

      return {
        summary: {
          highestDegree: highestDegree?.degree || 'Not specified',
          educationScore,
          totalInstitutions: timeline.totalInstitutions,
          totalDegrees: timeline.totalDegrees,
        },
        timeline: timeline.timeline,
        statistics,
        qualityAnalysis,
        roiAnalysis,
        alumniNetwork: {
          connections: alumniNetwork.connections.length,
          institutions: alumniNetwork.userInstitutions,
        },
        recommendations: recommendations.recommendations,
        reportGenerated: new Date().toISOString(),
      };
    } catch (error) {
      this.handleError(error);
    }
  }

  /**
   * Analyze education quality
   */
  analyzeEducationQuality(educations) {
    const analysis = {
      institutionRank: 0,
      degreeRelevance: 0,
      continuity: 0,
      achievements: 0,
      overall: 0,
    };

    if (educations.length === 0) return analysis;

    // Institution rank (simplified)
    const prestigiousCount = educations.filter(edu => 
      this.isPrestigiousInstitution(edu.institution)
    ).length;
    analysis.institutionRank = Math.min(100, (prestigiousCount / educations.length) * 100);

    // Degree relevance (simplified)
    const relevantFields = ['Computer Science', 'Engineering', 'Business', 'Science', 'Mathematics'];
    const relevantCount = educations.filter(edu =>
      relevantFields.some(field => edu.fieldOfStudy?.includes(field))
    ).length;
    analysis.degreeRelevance = Math.min(100, (relevantCount / educations.length) * 100);

    // Continuity (no large gaps)
    const sorted = [...educations].sort((a, b) => 
      new Date(a.startDate) - new Date(b.startDate)
    );
    let gapScore = 100;
    for (let i = 1; i < sorted.length; i++) {
      const prevEnd = sorted[i-1].endDate ? new Date(sorted[i-1].endDate) : new Date();
      const currStart = new Date(sorted[i].startDate);
      const gapYears = (currStart - prevEnd) / (1000 * 60 * 60 * 24 * 365);
      if (gapYears > 2) {
        gapScore -= 20;
      }
    }
    analysis.continuity = Math.max(0, gapScore);

    // Achievements (grades, honors, etc.)
    const achievementScore = educations.reduce((score, edu) => {
      let eduScore = 50; // Base
      if (edu.grade) {
        const grade = parseFloat(edu.grade);
        if (!isNaN(grade)) {
          eduScore += grade * 0.5; // 4.0 GPA = +2.0 points
        }
      }
      if (edu.activities && edu.activities.length > 0) {
        eduScore += 10;
      }
      if (edu.description && edu.description.length > 50) {
        eduScore += 10;
      }
      return score + eduScore;
    }, 0);
    analysis.achievements = Math.min(100, achievementScore / educations.length);

    // Overall score (weighted average)
    analysis.overall = (
      analysis.institutionRank * 0.3 +
      analysis.degreeRelevance * 0.3 +
      analysis.continuity * 0.2 +
      analysis.achievements * 0.2
    );

    return analysis;
  }

  /**
   * Check if institution is prestigious
   */
  isPrestigiousInstitution(institution) {
    const prestigious = [
      'harvard', 'stanford', 'mit', 'cambridge', 'oxford',
      'princeton', 'yale', 'columbia', 'caltech', 'chicago',
      'berkeley', 'cornell', 'pennsylvania', 'johns hopkins',
      'northwestern', 'duke', 'michigan', 'ucla', 'usc',
    ];

    const institutionLower = institution.toLowerCase();
    return prestigious.some(prestige => institutionLower.includes(prestige));
  }

  /**
   * Calculate Education ROI
   */
  calculateEducationROI(educations) {
    const analysis = {
      totalInvestment: 0,
      estimatedReturn: 0,
      roiPercentage: 0,
      paybackPeriod: 0,
    };

    if (educations.length === 0) return analysis;

    // Estimate costs (simplified)
    educations.forEach(edu => {
      let cost = 0;
      const degree = edu.degree?.toLowerCase() || '';

      if (degree.includes('phd')) cost = 150000;
      else if (degree.includes('master')) cost = 80000;
      else if (degree.includes('bachelor')) cost = 120000;
      else if (degree.includes('associate')) cost = 30000;
      else cost = 10000;

      // Adjust for institution prestige
      if (this.isPrestigiousInstitution(edu.institution)) {
        cost *= 1.5;
      }

      analysis.totalInvestment += cost;
    });

    // Estimate returns (simplified)
    const highestDegree = this.getHighestDegree(educations);
    const degreeReturns = {
      'PHD': 2000000,
      'MASTER': 1500000,
      'BACHELOR': 1000000,
      'ASSOCIATE': 500000,
      'DIPLOMA': 300000,
      'CERTIFICATE': 150000,
      'HIGH_SCHOOL': 50000,
    };

    const degreeKey = highestDegree?.degree?.toUpperCase() || 'HIGH_SCHOOL';
    for (const [key, value] of Object.entries(degreeReturns)) {
      if (degreeKey.includes(key)) {
        analysis.estimatedReturn = value;
        break;
      }
    }

    // Adjust for field of study
    const relevantFields = ['Computer Science', 'Engineering', 'Business', 'Data Science'];
    const hasRelevantField = educations.some(edu => 
      relevantFields.some(field => edu.fieldOfStudy?.includes(field))
    );
    if (hasRelevantField) {
      analysis.estimatedReturn *= 1.2;
    }

    // Calculate ROI
    if (analysis.totalInvestment > 0) {
      analysis.roiPercentage = ((analysis.estimatedReturn - analysis.totalInvestment) / 
                               analysis.totalInvestment) * 100;
    }

    // Estimate payback period (years)
    const annualSalary = analysis.estimatedReturn / 40; // Assume 40-year career
    if (annualSalary > 0) {
      analysis.paybackPeriod = analysis.totalInvestment / annualSalary;
    }

    return analysis;
  }

  /**
   * Search for education opportunities
   */
  async searchEducationOpportunities(filters = {}) {
    try {
      const {
        query,
        degree,
        field,
        location,
        delivery,
        duration,
        costRange,
        ...otherFilters
      } = filters;

      const where = {
        status: 'ACTIVE',
      };

      // Text search
      if (query) {
        where.OR = [
          { institution: { contains: query, mode: 'insensitive' } },
          { program: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ];
      }

      // Degree filter
      if (degree) {
        where.degree = degree;
      }

      // Field filter
      if (field) {
        where.fieldOfStudy = { contains: field, mode: 'insensitive' };
      }

      // Location filter
      if (location) {
        where.location = { contains: location, mode: 'insensitive' };
      }

      // Delivery method filter
      if (delivery) {
        where.deliveryMethod = delivery;
      }

      // Duration filter
      if (duration) {
        where.duration = duration;
      }

      // Cost range filter
      if (costRange?.min !== undefined || costRange?.max !== undefined) {
        where.cost = {};
        if (costRange.min !== undefined) {
          where.cost.gte = costRange.min;
        }
        if (costRange.max !== undefined) {
          where.cost.lte = costRange.max;
        }
      }

      // Apply other filters
      Object.assign(where, otherFilters);

      // This would query an external education opportunities database
      // For now, return sample data
      const sampleOpportunities = [
        {
          id: '1',
          institution: 'Coursera',
          program: 'Google Data Analytics Professional Certificate',
          degree: 'CERTIFICATE',
          fieldOfStudy: 'Data Analytics',
          duration: '6 months',
          deliveryMethod: 'ONLINE',
          cost: 39,
          url: 'https://coursera.org',
          rating: 4.8,
          enrolled: 15000,
        },
        {
          id: '2',
          institution: 'edX',
          program: 'MITx: Introduction to Computer Science',
          degree: 'CERTIFICATE',
          fieldOfStudy: 'Computer Science',
          duration: '3 months',
          deliveryMethod: 'ONLINE',
          cost: 0,
          url: 'https://edx.org',
          rating: 4.9,
          enrolled: 50000,
        },
      ];

      return {
        opportunities: sampleOpportunities,
        filters,
        total: sampleOpportunities.length,
      };
    } catch (error) {
      return { opportunities: [], filters: {}, total: 0 };
    }
  }

  /**
   * Get education path recommendations
   */
  async getEducationPathRecommendations(userId, careerGoals) {
    try {
      const userEducation = await this.findByUserId(userId);
      const currentLevel = this.getDegreeLevel(this.getHighestDegree(userEducation)?.degree);

      const recommendations = [];

      // Based on career goals
      careerGoals.forEach(goal => {
        const requiredLevel = this.getDegreeLevel(goal.minEducation);

        if (currentLevel < requiredLevel) {
          recommendations.push({
            goal,
            currentLevel,
            requiredLevel,
            gap: requiredLevel - currentLevel,
            path: this.generateEducationPath(currentLevel, requiredLevel, goal.field),
            timeline: this.estimateTimeline(currentLevel, requiredLevel),
            estimatedCost: this.estimateCost(currentLevel, requiredLevel),
          });
        }
      });

      // Sort by priority (gap size + goal priority)
      recommendations.sort((a, b) => {
        const aPriority = a.gap * (a.goal.priority || 1);
        const bPriority = b.gap * (b.goal.priority || 1);
        return bPriority - aPriority;
      });

      return {
        currentEducation: userEducation,
        recommendations,
        summary: {
          totalGoals: careerGoals.length,
          achievableGoals: careerGoals.filter(g => 
            this.getDegreeLevel(g.minEducation) <= currentLevel
          ).length,
          additionalEducationNeeded: recommendations.length,
        },
      };
    } catch (error) {
      return {
        currentEducation: [],
        recommendations: [],
        summary: { totalGoals: 0, achievableGoals: 0, additionalEducationNeeded: 0 },
      };
    }
  }

  /**
   * Generate education path
   */
  generateEducationPath(currentLevel, targetLevel, field) {
    const levels = [
      { level: 0, name: 'High School' },
      { level: 1, name: 'Certificate' },
      { level: 2, name: 'Diploma' },
      { level: 3, name: 'Associate' },
      { level: 4, name: 'Bachelor' },
      { level: 5, name: 'Master' },
      { level: 6, name: 'PhD' },
    ];

    const path = [];
    for (let i = currentLevel + 1; i <= targetLevel; i++) {
      path.push({
        level: i,
        degree: levels[i].name,
        field,
        duration: this.getLevelDuration(i),
        institutions: this.getInstitutionsForLevel(i, field),
      });
    }

    return path;
  }

  /**
   * Get level duration
   */
  getLevelDuration(level) {
    const durations = {
      1: '6-12 months',
      2: '1-2 years',
      3: '2 years',
      4: '4 years',
      5: '1-2 years',
      6: '3-5 years',
    };
    return durations[level] || 'Varies';
  }

  /**
   * Get institutions for level
   */
  getInstitutionsForLevel(level, field) {
    // This would come from a database
    const institutions = {
      1: ['Coursera', 'Udemy', 'LinkedIn Learning'],
      2: ['Community Colleges', 'Technical Schools'],
      3: ['Community Colleges'],
      4: ['Universities'],
      5: ['Graduate Schools'],
      6: ['Research Universities'],
    };

    return institutions[level] || ['Various Institutions'];
  }

  /**
   * Estimate timeline
   */
  estimateTimeline(currentLevel, targetLevel) {
    const levelDurations = {
      1: 0.75, // 9 months
      2: 1.5,  // 18 months
      3: 2,    // 2 years
      4: 4,    // 4 years
      5: 1.5,  // 18 months
      6: 4,    // 4 years
    };

    let totalYears = 0;
    for (let i = currentLevel + 1; i <= targetLevel; i++) {
      totalYears += levelDurations[i] || 0;
    }

    return totalYears;
  }

  /**
   * Estimate cost
   */
  estimateCost(currentLevel, targetLevel) {
    const levelCosts = {
      1: 5000,
      2: 15000,
      3: 20000,
      4: 50000,
      5: 40000,
      6: 100000,
    };

    let totalCost = 0;
    for (let i = currentLevel + 1; i <= targetLevel; i++) {
      totalCost += levelCosts[i] || 0;
    }

    return totalCost;
  }

  /**
   * Bulk add education records
   */
  async bulkAddEducation(userId, educationRecords) {
    try {
      return await this.prisma.$transaction(async (prisma) => {
        const results = [];

        for (const record of educationRecords) {
          try {
            // Check for duplicates
            const existing = await prisma.education.findFirst({
              where: {
                userId,
                institution: { contains: record.institution, mode: 'insensitive' },
                degree: { contains: record.degree, mode: 'insensitive' },
                startDate: record.startDate,
              },
            });

            if (existing) {
              results.push({
                success: false,
                institution: record.institution,
                degree: record.degree,
                error: 'Duplicate education record',
              });
              continue;
            }

            // Create education record
            const created = await prisma.education.create({
              data: {
                userId,
                institution: record.institution,
                degree: record.degree,
                fieldOfStudy: record.fieldOfStudy,
                startDate: record.startDate,
                endDate: record.endDate,
                current: record.current,
                educationType: record.educationType || 'FORMAL',
                grade: record.grade,
                activities: record.activities,
                description: record.description,
              },
            });

            results.push({
              success: true,
              id: created.id,
              institution: record.institution,
              degree: record.degree,
            });
          } catch (error) {
            results.push({
              success: false,
              institution: record.institution,
              degree: record.degree,
              error: error.message,
            });
          }
        }

        return {
          total: educationRecords.length,
          processed: results.length,
          results,
        };
      });
    } catch (error) {
      this.handleError(error);
    }
  }
}

module.exports = EducationRepository;
