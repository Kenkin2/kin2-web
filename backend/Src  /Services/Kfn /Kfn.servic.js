const { PrismaClient } = require('@prisma/client');
const natural = require('natural');
const stringSimilarity = require('string-similarity');

const prisma = new PrismaClient();

class KFNService {
  constructor() {
    this.tokenizer = new natural.WordTokenizer();
    this.tfidf = new natural.TfIdf();
  }

  async calculateKFN(workerId, jobId) {
    try {
      // Get worker and job data
      const [worker, job] = await Promise.all([
        this.getWorkerData(workerId),
        this.getJobData(jobId)
      ]);

      if (!worker || !job) {
        throw new Error('Worker or job not found');
      }

      // Calculate individual component scores
      const skillsScore = await this.calculateSkillsScore(worker, job);
      const experienceScore = await this.calculateExperienceScore(worker, job);
      const locationScore = await this.calculateLocationScore(worker, job);
      const availabilityScore = await this.calculateAvailabilityScore(worker, job);
      const educationScore = await this.calculateEducationScore(worker, job);
      const culturalScore = await this.calculateCulturalScore(worker, job);

      // Calculate overall score with weights
      const overallScore = (
        skillsScore * 0.30 +      // 30%
        experienceScore * 0.25 +   // 25%
        locationScore * 0.15 +     // 15%
        availabilityScore * 0.15 + // 15%
        educationScore * 0.10 +    // 10%
        culturalScore * 0.05       // 5%
      );

      // Get detailed matches
      const skillMatches = await this.getSkillMatches(worker, job);
      const experienceMatches = await this.getExperienceMatches(worker, job);
      const locationMatch = await this.getLocationMatch(worker, job);
      const availabilityMatch = await this.getAvailabilityMatch(worker, job);
      const educationMatch = await this.getEducationMatch(worker, job);
      const culturalMatch = await this.getCulturalMatch(worker, job);

      // Determine recommendation level
      const recommendation = this.getRecommendation(overallScore);
      const confidence = this.calculateConfidence(worker, job);

      // Identify strengths and areas to improve
      const { strengths, areasToImprove } = this.identifyStrengthsAndAreas({
        skillsScore,
        experienceScore,
        locationScore,
        availabilityScore,
        educationScore,
        culturalScore,
        skillMatches,
        experienceMatches
      });

      return {
        overallScore: Math.round(overallScore * 100) / 100,
        skillsScore: Math.round(skillsScore * 100) / 100,
        experienceScore: Math.round(experienceScore * 100) / 100,
        locationScore: Math.round(locationScore * 100) / 100,
        availabilityScore: Math.round(availabilityScore * 100) / 100,
        educationScore: Math.round(educationScore * 100) / 100,
        culturalScore: Math.round(culturalScore * 100) / 100,
        skillMatches,
        experienceMatches,
        locationMatch,
        availabilityMatch,
        educationMatch,
        culturalMatch,
        recommendation,
        confidence,
        strengths,
        areasToImprove,
        calculatedAt: new Date().toISOString()
      };
    } catch (error) {
      console.error('Calculate KFN error:', error);
      throw error;
    }
  }

  async getWorkerData(workerId) {
    const worker = await prisma.user.findUnique({
      where: { id: workerId },
      include: {
        profile: true,
        workerProfile: true,
        workerSkills: {
          include: { skill: true }
        },
        experience: {
          orderBy: { startDate: 'desc' }
        },
        education: {
          orderBy: { startDate: 'desc' }
        },
        certifications: true
      }
    });

    if (!worker || !worker.workerProfile) {
      return null;
    }

    return {
      id: worker.id,
      profile: worker.profile,
      workerProfile: worker.workerProfile,
      skills: worker.workerSkills.map(ws => ({
        id: ws.skillId,
        name: ws.skill.name,
        proficiency: ws.proficiency,
        yearsOfExperience: ws.yearsOfExperience || 0,
        lastUsed: ws.lastUsed
      })),
      experience: worker.experience,
      education: worker.education,
      certifications: worker.certifications
    };
  }

  async getJobData(jobId) {
    const job = await prisma.job.findUnique({
      where: { id: jobId },
      include: {
        employer: {
          include: {
            employerProfile: true
          }
        },
        requiredSkills: {
          include: { skill: true }
        },
        preferredSkills: {
          include: { skill: true }
        },
        category: true,
        industry: true
      }
    });

    if (!job) {
      return null;
    }

    return {
      id: job.id,
      title: job.title,
      description: job.description,
      requirements: job.requirements,
      location: job.location,
      coordinates: job.coordinates,
      employmentType: job.employmentType,
      experienceLevel: job.experienceLevel,
      remotePreference: job.remotePreference,
      salaryMin: job.salaryMin,
      salaryMax: job.salaryMax,
      requiredSkills: job.requiredSkills.map(rs => ({
        id: rs.skillId,
        name: rs.skill.name,
        importance: rs.importance
      })),
      preferredSkills: job.preferredSkills.map(ps => ({
        id: ps.skillId,
        name: ps.skill.name,
        importance: ps.importance
      })),
      company: job.employer.employerProfile,
      category: job.category,
      industry: job.industry
    };
  }

  async calculateSkillsScore(worker, job) {
    if (!worker.skills.length || !job.requiredSkills.length) {
      return 0;
    }

    const workerSkillNames = worker.skills.map(s => s.name.toLowerCase());
    const requiredSkillNames = job.requiredSkills.map(s => s.name.toLowerCase());
    const preferredSkillNames = job.preferredSkills.map(s => s.name.toLowerCase());

    // Calculate required skills match
    let requiredMatchScore = 0;
    requiredSkillNames.forEach(skill => {
      const bestMatch = this.findBestSkillMatch(skill, workerSkillNames);
      requiredMatchScore += bestMatch.score;
    });
    requiredMatchScore = requiredSkillNames.length > 0 
      ? requiredMatchScore / requiredSkillNames.length 
      : 0;

    // Calculate preferred skills match (bonus)
    let preferredMatchScore = 0;
    if (preferredSkillNames.length > 0) {
      preferredSkillNames.forEach(skill => {
        const bestMatch = this.findBestSkillMatch(skill, workerSkillNames);
        preferredMatchScore += bestMatch.score;
      });
      preferredMatchScore = preferredMatchScore / preferredSkillNames.length;
    }

    // Weighted score: 70% required skills, 30% preferred skills (if any)
    const baseScore = requiredMatchScore * 0.7;
    const bonusScore = preferredSkillNames.length > 0 
      ? preferredMatchScore * 0.3 
      : 0;

    let score = baseScore + bonusScore;

    // Consider proficiency levels
    const proficiencyMultiplier = this.calculateProficiencyMultiplier(worker.skills, job);
    score *= proficiencyMultiplier;

    // Consider years of experience
    const experienceMultiplier = this.calculateExperienceMultiplier(worker.skills, job);
    score *= experienceMultiplier;

    return Math.min(score * 100, 30); // Max 30 points for skills
  }

  findBestSkillMatch(targetSkill, workerSkills) {
    let bestMatch = { skill: null, score: 0 };
    
    workerSkills.forEach(workerSkill => {
      const similarity = stringSimilarity.compareTwoStrings(
        targetSkill.toLowerCase(),
        workerSkill.toLowerCase()
      );
      
      if (similarity > bestMatch.score) {
        bestMatch = {
          skill: workerSkill,
          score: similarity
        };
      }
    });

    return bestMatch;
  }

  calculateProficiencyMultiplier(workerSkills, job) {
    const requiredSkills = [...job.requiredSkills, ...job.preferredSkills];
    let totalMultiplier = 0;
    let matchedSkills = 0;

    requiredSkills.forEach(jobSkill => {
      const workerSkill = workerSkills.find(ws => 
        this.areSkillsSimilar(ws.name, jobSkill.name)
      );

      if (workerSkill) {
        matchedSkills++;
        switch (workerSkill.proficiency) {
          case 'BEGINNER':
            totalMultiplier += 0.6;
            break;
          case 'INTERMEDIATE':
            totalMultiplier += 0.8;
            break;
          case 'ADVANCED':
            totalMultiplier += 1.0;
            break;
          case 'EXPERT':
            totalMultiplier += 1.2;
            break;
          default:
            totalMultiplier += 0.7;
        }
      }
    });

    return matchedSkills > 0 ? totalMultiplier / matchedSkills : 0.7;
  }

  calculateExperienceMultiplier(workerSkills, job) {
    const requiredSkills = job.requiredSkills;
    let totalYears = 0;
    let matchedSkills = 0;

    requiredSkills.forEach(jobSkill => {
      const workerSkill = workerSkills.find(ws => 
        this.areSkillsSimilar(ws.name, jobSkill.name)
      );

      if (workerSkill && workerSkill.yearsOfExperience) {
        matchedSkills++;
        // Normalize years (max 10 years = full multiplier)
        const normalizedYears = Math.min(workerSkill.yearsOfExperience, 10) / 10;
        totalYears += normalizedYears;
      }
    });

    if (matchedSkills === 0) return 0.8;

    const avgYears = totalYears / matchedSkills;
    // Map to multiplier: 0 years = 0.7, 10+ years = 1.2
    return 0.7 + (avgYears * 0.5);
  }

  areSkillsSimilar(skill1, skill2) {
    const similarity = stringSimilarity.compareTwoStrings(
      skill1.toLowerCase(),
      skill2.toLowerCase()
    );
    return similarity > 0.7; // 70% similarity threshold
  }

  async calculateExperienceScore(worker, job) {
    const workerExperience = worker.experience;
    const jobExperienceLevel = job.experienceLevel;
    
    if (!workerExperience.length) {
      return 0;
    }

    // Calculate total years of experience
    const totalYears = this.calculateTotalExperienceYears(workerExperience);

    // Map experience level to required years
    const requiredYears = this.getRequiredYearsForLevel(jobExperienceLevel);

    // Calculate base score based on years
    let yearsScore = 0;
    if (totalYears >= requiredYears) {
      yearsScore = 1.0;
    } else if (totalYears > 0) {
      yearsScore = totalYears / requiredYears;
    }

    // Calculate relevance score
    const relevanceScore = this.calculateExperienceRelevance(workerExperience, job);

    // Combined score: 60% years, 40% relevance
    const combinedScore = (yearsScore * 0.6) + (relevanceScore * 0.4);

    return Math.min(combinedScore * 100, 25); // Max 25 points for experience
  }

  calculateTotalExperienceYears(experience) {
    let totalYears = 0;
    const now = new Date();

    experience.forEach(exp => {
      const startDate = new Date(exp.startDate);
      const endDate = exp.current || !exp.endDate ? now : new Date(exp.endDate);
      
      const years = (endDate - startDate) / (1000 * 60 * 60 * 24 * 365.25);
      totalYears += years;
    });

    return Math.round(totalYears * 10) / 10; // Round to 1 decimal
  }

  getRequiredYearsForLevel(experienceLevel) {
    const requirements = {
      'ENTRY': 0,
      'JUNIOR': 1,
      'MID': 3,
      'SENIOR': 5,
      'LEAD': 8,
      'EXECUTIVE': 10
    };

    return requirements[experienceLevel] || 3;
  }

  calculateExperienceRelevance(experience, job) {
    if (!experience.length) return 0;

    let totalRelevance = 0;
    
    experience.forEach(exp => {
      let jobRelevance = 0;
      let industryRelevance = 0;
      let skillRelevance = 0;

      // Job title relevance
      if (exp.title && job.title) {
        jobRelevance = stringSimilarity.compareTwoStrings(
          exp.title.toLowerCase(),
          job.title.toLowerCase()
        );
      }

      // Industry relevance
      if (job.industry && exp.company) {
        // Simple keyword matching - in production, use NLP
        const industryKeywords = job.industry.name.toLowerCase().split(' ');
        const companyContext = exp.company.toLowerCase() + ' ' + (exp.description || '').toLowerCase();
        
        industryKeywords.forEach(keyword => {
          if (companyContext.includes(keyword)) {
            industryRelevance += 0.2;
          }
        });
        industryRelevance = Math.min(industryRelevance, 1);
      }

      // Skill relevance (from job description)
      const jobText = (job.description + ' ' + job.requirements).toLowerCase();
      const experienceText = (exp.description || '').toLowerCase();
      
      if (experienceText) {
        const jobTokens = new Set(this.tokenizer.tokenize(jobText));
        const expTokens = new Set(this.tokenizer.tokenize(experienceText));
        
        const intersection = new Set([...jobTokens].filter(x => expTokens.has(x)));
        skillRelevance = intersection.size / Math.max(jobTokens.size, 1);
      }

      // Weighted relevance for this experience item
      const itemRelevance = (jobRelevance * 0.4) + (industryRelevance * 0.3) + (skillRelevance * 0.3);
      totalRelevance += itemRelevance;
    });

    return totalRelevance / experience.length;
  }

  async calculateLocationScore(worker, job) {
    const workerLocation = worker.profile.location;
    const jobLocation = job.location;
    const workerRemotePreference = worker.workerProfile.remotePreference;
    const jobRemotePreference = job.remotePreference;

    if (!workerLocation || !jobLocation) {
      return 0.5 * 15; // Default 50% of location score
    }

    // Check remote compatibility
    const remoteCompatibility = this.checkRemoteCompatibility(workerRemotePreference, jobRemotePreference);
    
    if (remoteCompatibility === 1.0) {
      // Full remote compatibility, location doesn't matter
      return 15; // Max points
    }

    // Calculate distance score (simplified - in production use geocoding API)
    const distanceScore = this.calculateDistanceScore(workerLocation, jobLocation);

    // Combined score: remote compatibility * distance score
    const combinedScore = remoteCompatibility * distanceScore;

    return Math.min(combinedScore * 15, 15); // Max 15 points for location
  }

  checkRemoteCompatibility(workerPreference, jobPreference) {
    const compatibilityMatrix = {
      'ONSITE': {
        'ONSITE': 1.0,
        'REMOTE': 0.0,
        'HYBRID': 0.5
      },
      'REMOTE': {
        'ONSITE': 0.0,
        'REMOTE': 1.0,
        'HYBRID': 0.8
      },
      'HYBRID': {
        'ONSITE': 0.5,
        'REMOTE': 0.8,
        'HYBRID': 1.0
      }
    };

    return compatibilityMatrix[workerPreference]?.[jobPreference] || 0.5;
  }

  calculateDistanceScore(location1, location2) {
    // Simple location matching - in production, use geocoding and distance calculation
    const loc1 = location1.toLowerCase();
    const loc2 = location2.toLowerCase();

    // Exact match
    if (loc1 === loc2) {
      return 1.0;
    }

    // City match
    const city1 = loc1.split(',')[0]?.trim();
    const city2 = loc2.split(',')[0]?.trim();
    
    if (city1 === city2) {
      return 0.9;
    }

    // State/region match
    const state1 = loc1.split(',')[1]?.trim();
    const state2 = loc2.split(',')[1]?.trim();
    
    if (state1 && state2 && state1 === state2) {
      return 0.7;
    }

    // Country match
    const country1 = loc1.split(',')[2]?.trim() || loc1;
    const country2 = loc2.split(',')[2]?.trim() || loc2;
    
    if (country1 === country2) {
      return 0.5;
    }

    // Remote locations
    if (loc1.includes('remote') || loc2.includes('remote')) {
      return 0.8;
    }

    // Default low score for different locations
    return 0.3;
  }

  async calculateAvailabilityScore(worker, job) {
    const workerAvailability = worker.workerProfile.availability;
    const workerNoticePeriod = worker.workerProfile.noticePeriod || 30;
    const workerFullTime = worker.workerProfile.fullTime;
    const jobEmploymentType = job.employmentType;

    // Availability status score
    let availabilityScore = 0;
    switch (workerAvailability) {
      case 'AVAILABLE':
        availabilityScore = 1.0;
        break;
      case 'SOON':
        availabilityScore = 0.7;
        break;
      case 'UNAVAILABLE':
        availabilityScore = 0.3;
        break;
      default:
        availabilityScore = 0.5;
    }

    // Notice period score (shorter is better)
    let noticeScore = 1.0;
    if (workerNoticePeriod <= 14) {
      noticeScore = 1.0;
    } else if (workerNoticePeriod <= 30) {
      noticeScore = 0.8;
    } else if (workerNoticePeriod <= 60) {
      noticeScore = 0.6;
    } else {
      noticeScore = 0.4;
    }

    // Full-time compatibility
    let fullTimeScore = 1.0;
    if (jobEmploymentType === 'FULL_TIME' && !workerFullTime) {
      fullTimeScore = 0.5;
    } else if (jobEmploymentType === 'PART_TIME' && workerFullTime) {
      fullTimeScore = 0.7;
    }

    // Combined score: 40% availability, 30% notice, 30% full-time
    const combinedScore = (
      availabilityScore * 0.4 +
      noticeScore * 0.3 +
      fullTimeScore * 0.3
    );

    return Math.min(combinedScore * 15, 15); // Max 15 points for availability
  }

  async calculateEducationScore(worker, job) {
    const workerEducation = worker.education;
    
    if (!workerEducation.length) {
      return 0;
    }

    // Extract education level from job requirements
    const requiredEducationLevel = this.extractEducationLevel(job.requirements);
    
    if (!requiredEducationLevel) {
      // No specific education requirement
      return 5; // Half points for having education
    }

    // Get highest education level from worker
    const highestEducation = this.getHighestEducationLevel(workerEducation);

    // Calculate match score
    const educationScore = this.calculateEducationMatchScore(highestEducation, requiredEducationLevel);

    return Math.min(educationScore * 10, 10); // Max 10 points for education
  }

  extractEducationLevel(text) {
    if (!text) return null;

    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('phd') || lowerText.includes('doctorate')) {
      return 'PHD';
    } else if (lowerText.includes('master') || lowerText.includes('ms') || lowerText.includes('mba')) {
      return 'MASTER';
    } else if (lowerText.includes('bachelor') || lowerText.includes('bs') || lowerText.includes('ba')) {
      return 'BACHELOR';
    } else if (lowerText.includes('associate') || lowerText.includes('diploma')) {
      return 'ASSOCIATE';
    } else if (lowerText.includes('high school') || lowerText.includes('hs diploma')) {
      return 'HIGH_SCHOOL';
    }

    return null;
  }

  getHighestEducationLevel(education) {
    const levels = {
      'PHD': 5,
      'MASTER': 4,
      'BACHELOR': 3,
      'ASSOCIATE': 2,
      'HIGH_SCHOOL': 1,
      'OTHER': 0
    };

    let highestLevel = 'OTHER';
    let highestScore = 0;

    education.forEach(edu => {
      const degree = edu.degree.toLowerCase();
      let level = 'OTHER';

      if (degree.includes('phd') || degree.includes('doctor')) {
        level = 'PHD';
      } else if (degree.includes('master')) {
        level = 'MASTER';
      } else if (degree.includes('bachelor')) {
        level = 'BACHELOR';
      } else if (degree.includes('associate')) {
        level = 'ASSOCIATE';
      } else if (degree.includes('diploma') || degree.includes('high school')) {
        level = 'HIGH_SCHOOL';
      }

      if (levels[level] > highestScore) {
        highestScore = levels[level];
        highestLevel = level;
      }
    });

    return highestLevel;
  }

  calculateEducationMatchScore(workerLevel, requiredLevel) {
    const levelScores = {
      'PHD': 5,
      'MASTER': 4,
      'BACHELOR': 3,
      'ASSOCIATE': 2,
      'HIGH_SCHOOL': 1,
      'OTHER': 0
    };

    const workerScore = levelScores[workerLevel] || 0;
    const requiredScore = levelScores[requiredLevel] || 0;

    if (workerScore >= requiredScore) {
      return 1.0;
    } else if (requiredScore > 0) {
      return workerScore / requiredScore;
    }

    return 0.5; // No specific requirement but worker has education
  }

  async calculateCulturalScore(worker, job) {
    // Cultural fit is harder to quantify automatically
    // This is a simplified version
    
    let culturalScore = 0.5; // Base score

    // 1. Company size preference
    if (worker.workerProfile.preferredCompanySizes && job.company.companySize) {
      const sizeMatch = this.checkCompanySizeMatch(worker.workerProfile.preferredCompanySizes, job.company.companySize);
      culturalScore += sizeMatch * 0.1;
    }

    // 2. Industry preference
    if (worker.workerProfile.preferredIndustries && job.industry) {
      const industryMatch = this.checkIndustryMatch(worker.workerProfile.preferredIndustries, job.industry.name);
      culturalScore += industryMatch * 0.1;
    }

    // 3. Work style compatibility (remote vs onsite)
    const workStyleMatch = this.checkWorkStyleMatch(worker.workerProfile, job);
    culturalScore += workStyleMatch * 0.1;

    // 4. Values alignment (from job description)
    const valuesMatch = this.checkValuesMatch(worker, job);
    culturalScore += valuesMatch * 0.1;

    // 5. Growth opportunity alignment
    const growthMatch = this.checkGrowthMatch(worker, job);
    culturalScore += growthMatch * 0.1;

    // Normalize to 0-1 range
    culturalScore = Math.max(0, Math.min(culturalScore, 1));

    return Math.min(culturalScore * 5, 5); // Max 5 points for cultural fit
  }

  checkCompanySizeMatch(preferredSizes, companySize) {
    if (!preferredSizes || !companySize) return 0.5;
    
    const sizeHierarchy = {
      'MICRO': 1,
      'SMALL': 2,
      'MEDIUM': 3,
      'LARGE': 4,
      'ENTERPRISE': 5
    };

    const companySizeNum = sizeHierarchy[companySize] || 3;
    
    // Check if company size is within preferred range
    // For simplicity, assume any match gives partial points
    return preferredSizes.includes(companySize) ? 1.0 : 0.3;
  }

  checkIndustryMatch(preferredIndustries, jobIndustry) {
    if (!preferredIndustries || !jobIndustry) return 0.5;

    const jobIndustryLower = jobIndustry.toLowerCase();
    
    for (const preferred of preferredIndustries) {
      if (jobIndustryLower.includes(preferred.toLowerCase()) || 
          preferred.toLowerCase().includes(jobIndustryLower)) {
        return 1.0;
      }
    }

    return 0.3;
  }

  checkWorkStyleMatch(workerProfile, job) {
    const workerRemote = workerProfile.remotePreference;
    const jobRemote = job.remotePreference;

    if (workerRemote === 'REMOTE' && jobRemote === 'REMOTE') {
      return 1.0;
    } else if (workerRemote === 'ONSITE' && jobRemote === 'ONSITE') {
      return 1.0;
    } else if (workerRemote === 'HYBRID' || jobRemote === 'HYBRID') {
      return 0.8;
    } else if (workerRemote !== jobRemote) {
      return 0.3;
    }

    return 0.6;
  }

  checkValuesMatch(worker, job) {
    // Extract values from job description and worker profile
    const jobText = (job.description + ' ' + job.requirements).toLowerCase();
    const workerText = (worker.workerProfile.summary || '').toLowerCase();

    const valueKeywords = [
      'teamwork', 'collaboration', 'innovation', 'creativity', 
      'integrity', 'excellence', 'quality', 'customer',
      'growth', 'learning', 'development', 'diversity',
      'inclusion', 'balance', 'flexibility', 'autonomy'
    ];

    let matchingValues = 0;
    
    valueKeywords.forEach(value => {
      if (jobText.includes(value) && workerText.includes(value)) {
        matchingValues++;
      }
    });

    return matchingValues / valueKeywords.length;
  }

  checkGrowthMatch(worker, job) {
    // Check if job offers growth opportunities that match worker's career goals
    const jobText = job.description.toLowerCase();
    const workerGoals = (worker.workerProfile.summary || '').toLowerCase();

    const growthKeywords = [
      'growth', 'advancement', 'promotion', 'career path',
      'development', 'training', 'mentorship', 'leadership',
      'skills', 'learning', 'certification', 'education'
    ];

    let jobHasGrowth = 0;
    let workerWantsGrowth = 0;

    growthKeywords.forEach(keyword => {
      if (jobText.includes(keyword)) {
        jobHasGrowth++;
      }
      if (workerGoals.includes(keyword)) {
        workerWantsGrowth++;
      }
    });

    if (workerWantsGrowth === 0) return 0.5; // Worker doesn't specify growth goals
    
    const matchRatio = jobHasGrowth / Math.max(workerWantsGrowth, 1);
    return Math.min(matchRatio, 1);
  }

  async getSkillMatches(worker, job) {
    const matches = [];
    const workerSkills = worker.skills.map(s => s.name.toLowerCase());

    // Check required skills
    job.requiredSkills.forEach(jobSkill => {
      const bestMatch = this.findBestSkillMatch(jobSkill.name, workerSkills);
      
      matches.push({
        jobSkill: jobSkill.name,
        workerSkill: bestMatch.skill,
        matchLevel: this.getMatchLevel(bestMatch.score),
        score: bestMatch.score,
        required: true,
        importance: jobSkill.importance
      });
    });

    // Check preferred skills
    job.preferredSkills.forEach(jobSkill => {
      const bestMatch = this.findBestSkillMatch(jobSkill.name, workerSkills);
      
      matches.push({
        jobSkill: jobSkill.name,
        workerSkill: bestMatch.skill,
        matchLevel: this.getMatchLevel(bestMatch.score),
        score: bestMatch.score,
        required: false,
        importance: jobSkill.importance
      });
    });

    return matches;
  }

  getMatchLevel(score) {
    if (score >= 0.9) return 'EXCELLENT';
    if (score >= 0.7) return 'GOOD';
    if (score >= 0.5) return 'FAIR';
    if (score >= 0.3) return 'POOR';
    return 'MISSING';
  }

  async getExperienceMatches(worker, job) {
    const matches = [];
    
    worker.experience.forEach(exp => {
      const relevance = this.calculateExperienceRelevance([exp], job);
      
      matches.push({
        title: exp.title,
        company: exp.company,
        duration: this.getExperienceDuration(exp),
        relevance: relevance,
        matchLevel: this.getExperienceMatchLevel(relevance)
      });
    });

    return matches;
  }

  getExperienceDuration(experience) {
    const start = new Date(experience.startDate);
    const end = experience.current ? new Date() : new Date(experience.endDate);
    
    const years = (end - start) / (1000 * 60 * 60 * 24 * 365.25);
    return Math.round(years * 10) / 10;
  }

  getExperienceMatchLevel(relevance) {
    if (relevance >= 0.8) return 'EXCELLENT';
    if (relevance >= 0.6) return 'GOOD';
    if (relevance >= 0.4) return 'FAIR';
    return 'POOR';
  }

  async getLocationMatch(worker, job) {
    return {
      workerLocation: worker.profile.location,
      jobLocation: job.location,
      remoteCompatibility: this.checkRemoteCompatibility(
        worker.workerProfile.remotePreference,
        job.remotePreference
      ),
      distanceScore: this.calculateDistanceScore(worker.profile.location, job.location)
    };
  }

  async getAvailabilityMatch(worker, job) {
    return {
      workerAvailability: worker.workerProfile.availability,
      workerNoticePeriod: worker.workerProfile.noticePeriod,
      workerFullTime: worker.workerProfile.fullTime,
      jobEmploymentType: job.employmentType,
      compatibility: this.calculateAvailabilityScore(worker, job) / 15 // Normalize to 0-1
    };
  }

  async getEducationMatch(worker, job) {
    const requiredLevel = this.extractEducationLevel(job.requirements);
    const highestLevel = this.getHighestEducationLevel(worker.education);
    
    return {
      workerHighestEducation: highestLevel,
      jobRequiredEducation: requiredLevel,
      matchScore: this.calculateEducationMatchScore(highestLevel, requiredLevel)
    };
  }

  async getCulturalMatch(worker, job) {
    return {
      companySizeMatch: this.checkCompanySizeMatch(
        worker.workerProfile.preferredCompanySizes,
        job.company.companySize
      ),
      industryMatch: this.checkIndustryMatch(
        worker.workerProfile.preferredIndustries,
        job.industry.name
      ),
      workStyleMatch: this.checkWorkStyleMatch(worker.workerProfile, job),
      valuesMatch: this.checkValuesMatch(worker, job),
      growthMatch: this.checkGrowthMatch(worker, job)
    };
  }

  getRecommendation(score) {
    if (score >= 90) return 'STRONGLY_RECOMMEND';
    if (score >= 75) return 'RECOMMEND';
    if (score >= 60) return 'CONSIDER';
    if (score >= 40) return 'NOT_RECOMMEND';
    return 'REJECT';
  }

  calculateConfidence(worker, job) {
    // Confidence based on data completeness
    let confidence = 0.5; // Base confidence

    // Worker data completeness
    const workerDataScore = this.calculateWorkerDataCompleteness(worker);
    confidence += workerDataScore * 0.25;

    // Job data completeness
    const jobDataScore = this.calculateJobDataCompleteness(job);
    confidence += jobDataScore * 0.25;

    return Math.min(confidence, 1.0);
  }

  calculateWorkerDataCompleteness(worker) {
    let score = 0;
    let totalFields = 0;
    let filledFields = 0;

    // Profile fields
    const profileFields = ['firstName', 'lastName', 'location', 'bio'];
    totalFields += profileFields.length;
    profileFields.forEach(field => {
      if (worker.profile[field]) filledFields++;
    });

    // Skills
    if (worker.skills.length > 0) {
      filledFields += 2; // Skills and at least one skill
      totalFields += 2;
    }

    // Experience
    if (worker.experience.length > 0) {
      filledFields += 2; // Experience and at least one entry
      totalFields += 2;
    }

    // Education
    if (worker.education.length > 0) {
      filledFields += 2; // Education and at least one entry
      totalFields += 2;
    }

    return totalFields > 0 ? filledFields / totalFields : 0;
  }

  calculateJobDataCompleteness(job) {
    let score = 0;
    let totalFields = 0;
    let filledFields = 0;

    const jobFields = ['title', 'description', 'requirements', 'location'];
    totalFields += jobFields.length;
    jobFields.forEach(field => {
      if (job[field]) filledFields++;
    });

    // Required skills
    if (job.requiredSkills.length > 0) {
      filledFields += 2;
      totalFields += 2;
    }

    // Salary range
    if (job.salaryMin || job.salaryMax) {
      filledFields++;
      totalFields++;
    }

    return totalFields > 0 ? filledFields / totalFields : 0;
  }

  identifyStrengthsAndAreas(scores) {
    const strengths = [];
    const areasToImprove = [];

    // Skills
    if (scores.skillsScore >= 22.5) { // 75% of max
      strengths.push('Strong skills match with job requirements');
    } else if (scores.skillsScore <= 15) { // 50% of max
      areasToImprove.push('Develop skills matching job requirements');
    }

    // Experience
    if (scores.experienceScore >= 18.75) { // 75% of max
      strengths.push('Relevant experience for the role');
    } else if (scores.experienceScore <= 12.5) { // 50% of max
      areasToImprove.push('Gain more relevant experience');
    }

    // Location
    if (scores.locationScore >= 11.25) { // 75% of max
      strengths.push('Good location compatibility');
    } else if (scores.locationScore <= 7.5) { // 50% of max
      areasToImprove.push('Consider location flexibility');
    }

    // Availability
    if (scores.availabilityScore >= 11.25) { // 75% of max
      strengths.push('Good availability match');
    } else if (scores.availabilityScore <= 7.5) { // 50% of max
      areasToImprove.push('Improve availability alignment');
    }

    // Education
    if (scores.educationScore >= 7.5) { // 75% of max
      strengths.push('Education meets or exceeds requirements');
    } else if (scores.educationScore <= 5) { // 50% of max
      areasToImprove.push('Consider additional education or certifications');
    }

    // Cultural
    if (scores.culturalScore >= 3.75) { // 75% of max
      strengths.push('Good cultural fit with company');
    } else if (scores.culturalScore <= 2.5) { // 50% of max
      areasToImprove.push('Research company culture for better alignment');
    }

    // Add specific skill match feedback
    if (scores.skillMatches) {
      const excellentMatches = scores.skillMatches.filter(m => m.matchLevel === 'EXCELLENT');
      const missingMatches = scores.skillMatches.filter(m => m.matchLevel === 'MISSING' && m.required);
      
      if (excellentMatches.length > 0) {
        strengths.push(`Excellent match on ${excellentMatches.length} key skills`);
      }
      
      if (missingMatches.length > 0) {
        areasToImprove.push(`Missing ${missingMatches.length} required skills`);
      }
    }

    return { strengths, areasToImprove };
  }

  explainKFN(calculation) {
    return {
      summary: `Overall KFN Score: ${calculation.overallScore}/100 (${calculation.recommendation})`,
      breakdown: {
        skills: `Skills Match: ${calculation.skillsScore}/30 - ${this.getComponentFeedback(calculation.skillsScore, 30)}`,
        experience: `Experience: ${calculation.experienceScore}/25 - ${this.getComponentFeedback(calculation.experienceScore, 25)}`,
        location: `Location: ${calculation.locationScore}/15 - ${this.getComponentFeedback(calculation.locationScore, 15)}`,
        availability: `Availability: ${calculation.availabilityScore}/15 - ${this.getComponentFeedback(calculation.availabilityScore, 15)}`,
        education: `Education: ${calculation.educationScore}/10 - ${this.getComponentFeedback(calculation.educationScore, 10)}`,
        cultural: `Cultural Fit: ${calculation.culturalScore}/5 - ${this.getComponentFeedback(calculation.culturalScore, 5)}`
      },
      strengths: calculation.strengths,
      areasToImprove: calculation.areasToImprove,
      confidence: `Confidence Level: ${Math.round(calculation.confidence * 100)}%`
    };
  }

  getComponentFeedback(score, max) {
    const percentage = (score / max) * 100;
    
    if (percentage >= 90) return 'Excellent match';
    if (percentage >= 75) return 'Strong match';
    if (percentage >= 60) return 'Good match';
    if (percentage >= 40) return 'Fair match';
    return 'Needs improvement';
  }

  async getScoreBreakdown(workerId, jobId) {
    const calculation = await prisma.kFNCalculation.findFirst({
      where: {
        workerId,
        jobId
      },
      orderBy: { createdAt: 'desc' }
    });

    if (!calculation) {
      return null;
    }

    return this.explainKFN(calculation);
  }
}

module.exports = new KFNService();
