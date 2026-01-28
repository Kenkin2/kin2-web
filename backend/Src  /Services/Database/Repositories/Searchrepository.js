class SearchRepository {
  constructor(prisma, redis, elasticsearch, aiService) {
    this.prisma = prisma;
    this.redis = redis;
    this.es = elasticsearch;
    this.aiService = aiService;
    this.CACHE_TTL = 600; // 10 minutes
  }

  // JOB SEARCH
  async searchJobs(query, filters = {}, pagination = { page: 1, limit: 20 }) {
    const cacheKey = this.generateSearchCacheKey('jobs', { query, filters, pagination });
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    let results;
    
    if (this.es) {
      // Use Elasticsearch for better search
      results = await this.searchJobsElasticsearch(query, filters, pagination);
    } else {
      // Fallback to database search
      results = await this.searchJobsDatabase(query, filters, pagination);
    }

    // Apply AI-powered ranking if no explicit sort
    if (!filters.sortBy && query) {
      results.jobs = await this.rankJobsByRelevance(results.jobs, query, filters);
    }

    // Cache results
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(results));

    return results;
  }

  async searchJobsElasticsearch(query, filters, pagination) {
    const esQuery = this.buildJobSearchQuery(query, filters);
    
    const result = await this.es.search({
      index: 'jobs',
      body: {
        query: esQuery,
        sort: this.getJobSortOrder(filters.sortBy),
        from: (pagination.page - 1) * pagination.limit,
        size: pagination.limit,
        aggs: this.buildJobAggregations(filters),
      },
    });

    // Extract job IDs
    const jobIds = result.hits.hits.map(hit => hit._id);
    
    // Get full job details from database
    const jobs = await this.prisma.job.findMany({
      where: { id: { in: jobIds } },
      include: this.getJobSearchIncludes(),
    });

    // Preserve Elasticsearch ranking
    const jobMap = new Map(jobs.map(job => [job.id, job]));
    const rankedJobs = jobIds.map(id => jobMap.get(id)).filter(Boolean);

    return {
      jobs: rankedJobs,
      total: result.hits.total.value,
      aggregations: result.aggregations,
    };
  }

  async searchJobsDatabase(query, filters, pagination) {
    const where = this.buildJobSearchWhere(query, filters);
    const orderBy = this.getJobSortOrder(filters.sortBy);

    const [jobs, total] = await Promise.all([
      this.prisma.job.findMany({
        where,
        include: this.getJobSearchIncludes(),
        orderBy,
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.job.count({ where }),
    ]);

    // Get aggregations
    const aggregations = await this.getJobAggregations(where);

    return {
      jobs,
      total,
      aggregations,
    };
  }

  buildJobSearchQuery(query, filters) {
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
            'title^3',
            'description^2',
            'requirements',
            'location',
            'companyName',
            'skills^2',
          ],
          fuzziness: 'AUTO',
          boost: 1,
        },
      });
    }

    // Apply filters
    if (filters.location) {
      esQuery.bool.filter.push({
        match: { location: filters.location },
      });
    }

    if (filters.remote !== undefined) {
      esQuery.bool.filter.push({
        term: { isRemote: filters.remote },
      });
    }

    if (filters.salaryMin) {
      esQuery.bool.filter.push({
        range: { salaryMin: { gte: filters.salaryMin } },
      });
    }

    if (filters.salaryMax) {
      esQuery.bool.filter.push({
        range: { salaryMax: { lte: filters.salaryMax } },
      });
    }

    if (filters.experience) {
      esQuery.bool.filter.push({
        range: { requiredExperience: { lte: filters.experience } },
      });
    }

    if (filters.industry) {
      esQuery.bool.filter.push({
        term: { industry: filters.industry },
      });
    }

    if (filters.jobType) {
      esQuery.bool.filter.push({
        terms: { jobType: Array.isArray(filters.jobType) ? filters.jobType : [filters.jobType] },
      });
    }

    if (filters.skills?.length > 0) {
      esQuery.bool.filter.push({
        terms: { skills: filters.skills },
      });
    }

    return esQuery;
  }

  buildJobSearchWhere(query, filters) {
    const where = {
      status: 'ACTIVE',
    };

    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { requirements: { contains: query, mode: 'insensitive' } },
        { location: { contains: query, mode: 'insensitive' } },
        {
          employer: {
            name: { contains: query, mode: 'insensitive' },
          },
        },
        {
          skills: {
            some: {
              skill: {
                name: { contains: query, mode: 'insensitive' },
              },
            },
          },
        },
      ];
    }

    if (filters.location) {
      where.location = { contains: filters.location, mode: 'insensitive' };
    }

    if (filters.remote !== undefined) {
      where.isRemote = filters.remote;
    }

    if (filters.salaryMin) {
      where.salaryMin = { gte: filters.salaryMin };
    }

    if (filters.salaryMax) {
      where.salaryMax = { lte: filters.salaryMax };
    }

    if (filters.experience) {
      where.requiredExperience = { lte: filters.experience };
    }

    if (filters.industry) {
      where.industry = { in: Array.isArray(filters.industry) ? filters.industry : [filters.industry] };
    }

    if (filters.jobType) {
      where.jobType = { in: Array.isArray(filters.jobType) ? filters.jobType : [filters.jobType] };
    }

    if (filters.skills?.length > 0) {
      where.skills = {
        some: {
          skill: {
            name: { in: filters.skills, mode: 'insensitive' },
          },
        },
      };
    }

    return where;
  }

  getJobSearchIncludes() {
    return {
      employer: {
        select: {
          id: true,
          name: true,
          logo: true,
          location: true,
        },
      },
      skills: {
        include: {
          skill: true,
        },
        take: 5,
      },
      _count: {
        select: {
          applications: true,
        },
      },
    };
  }

  getJobSortOrder(sortBy) {
    switch (sortBy) {
      case 'salary_desc':
        return { salaryMax: 'desc' };
      case 'salary_asc':
        return { salaryMin: 'asc' };
      case 'recent':
        return { createdAt: 'desc' };
      case 'applications':
        return { applications: { _count: 'desc' } };
      case 'relevance':
      default:
        // Default sorting handled by search engine
        return undefined;
    }
  }

  async rankJobsByRelevance(jobs, query, filters) {
    if (jobs.length === 0) return jobs;

    // Use AI to score job relevance
    const scoredJobs = await Promise.all(
      jobs.map(async (job) => {
        const relevanceScore = await this.calculateJobRelevance(job, query, filters);
        return { ...job, relevanceScore };
      })
    );

    // Sort by relevance score
    return scoredJobs.sort((a, b) => b.relevanceScore - a.relevanceScore);
  }

  async calculateJobRelevance(job, query, filters) {
    let score = 0;

    // Text match score
    const text = `${job.title} ${job.description} ${job.requirements} ${job.location}`;
    const textSimilarity = await this.aiService.calculateTextSimilarity(query, text);
    score += textSimilarity * 0.4;

    // Skill match score
    if (filters.skills?.length > 0) {
      const jobSkills = job.skills.map(s => s.skill.name.toLowerCase());
      const matchingSkills = filters.skills.filter(skill => 
        jobSkills.includes(skill.toLowerCase())
      );
      score += (matchingSkills.length / filters.skills.length) * 0.3;
    }

    // Location score
    if (filters.location && job.location) {
      const locationScore = await this.calculateLocationSimilarity(filters.location, job.location);
      score += locationScore * 0.2;
    }

    // Salary score (prefer higher salaries)
    if (job.salaryMax) {
      const normalizedSalary = Math.min(job.salaryMax / 200000, 1); // Cap at 200k
      score += normalizedSalary * 0.1;
    }

    return score;
  }

  async calculateLocationSimilarity(location1, location2) {
    // Simple location matching (could be enhanced with geocoding)
    const loc1 = location1.toLowerCase();
    const loc2 = location2.toLowerCase();
    
    if (loc1 === loc2) return 1;
    if (loc1.includes(loc2) || loc2.includes(loc1)) return 0.8;
    
    // Check for city/state matches
    const parts1 = loc1.split(/[,\s]+/);
    const parts2 = loc2.split(/[,\s]+/);
    const commonParts = parts1.filter(part => parts2.includes(part));
    
    return commonParts.length / Math.max(parts1.length, parts2.length);
  }

  buildJobAggregations(filters) {
    const aggs = {
      industries: {
        terms: { field: 'industry', size: 10 },
      },
      locations: {
        terms: { field: 'location', size: 10 },
      },
      jobTypes: {
        terms: { field: 'jobType', size: 10 },
      },
      salaryRanges: {
        range: {
          field: 'salaryMax',
          ranges: [
            { to: 50000 },
            { from: 50000, to: 100000 },
            { from: 100000, to: 150000 },
            { from: 150000 },
          ],
        },
      },
      experienceLevels: {
        range: {
          field: 'requiredExperience',
          ranges: [
            { to: 2 },
            { from: 2, to: 5 },
            { from: 5, to: 10 },
            { from: 10 },
          ],
        },
      },
    };

    return aggs;
  }

  async getJobAggregations(where) {
    const [
      industries,
      locations,
      jobTypes,
      salaryStats,
      experienceStats,
    ] = await Promise.all([
      this.prisma.job.groupBy({
        by: ['industry'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.job.groupBy({
        by: ['location'],
        where,
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 10,
      }),
      this.prisma.job.groupBy({
        by: ['jobType'],
        where,
        _count: { id: true },
      }),
      this.prisma.job.aggregate({
        where,
        _min: { salaryMin: true },
        _max: { salaryMax: true },
        _avg: { salaryMin: true, salaryMax: true },
      }),
      this.prisma.job.aggregate({
        where,
        _min: { requiredExperience: true },
        _max: { requiredExperience: true },
        _avg: { requiredExperience: true },
      }),
    ]);

    return {
      industries: industries.map(i => ({ value: i.industry, count: i._count.id })),
      locations: locations.map(l => ({ value: l.location, count: l._count.id })),
      jobTypes: jobTypes.map(j => ({ value: j.jobType, count: j._count.id })),
      salaryRanges: {
        min: salaryStats._min.salaryMin,
        max: salaryStats._max.salaryMax,
        avgMin: salaryStats._avg.salaryMin,
        avgMax: salaryStats._avg.salaryMax,
      },
      experienceLevels: {
        min: experienceStats._min.requiredExperience,
        max: experienceStats._max.requiredExperience,
        avg: experienceStats._avg.requiredExperience,
      },
    };
  }

  // CANDIDATE SEARCH
  async searchCandidates(query, filters = {}, pagination = { page: 1, limit: 20 }) {
    const cacheKey = this.generateSearchCacheKey('candidates', { query, filters, pagination });
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    let results;
    
    if (this.es) {
      results = await this.searchCandidatesElasticsearch(query, filters, pagination);
    } else {
      results = await this.searchCandidatesDatabase(query, filters, pagination);
    }

    // Calculate match scores if job ID provided
    if (filters.jobId) {
      results.candidates = await this.calculateCandidateMatches(results.candidates, filters.jobId);
    }

    // Cache results
    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(results));

    return results;
  }

  async calculateCandidateMatches(candidates, jobId) {
    const job = await this.prisma.job.findUnique({
      where: { id: jobId },
      include: {
        skills: {
          include: { skill: true },
        },
      },
    });

    if (!job) return candidates;

    const jobSkills = job.skills.map(js => js.skill.name.toLowerCase());
    const requiredSkills = job.skills
      .filter(js => js.importance === 'REQUIRED')
      .map(js => js.skill.name.toLowerCase());

    return Promise.all(
      candidates.map(async (candidate) => {
        const candidateSkills = await this.getCandidateSkills(candidate.id);
        const candidateSkillNames = candidateSkills.map(s => s.toLowerCase());

        const matchedSkills = jobSkills.filter(skill => 
          candidateSkillNames.includes(skill)
        );
        const missingRequiredSkills = requiredSkills.filter(skill => 
          !candidateSkillNames.includes(skill)
        );

        const matchScore = jobSkills.length > 0 ? 
          (matchedSkills.length / jobSkills.length) * 100 : 0;

        const penalty = missingRequiredSkills.length * 20;
        const finalScore = Math.max(0, matchScore - penalty);

        return {
          ...candidate,
          matchScore: finalScore,
          matchedSkills,
          missingRequiredSkills,
          skillMatch: `${matchedSkills.length}/${jobSkills.length}`,
        };
      })
    );
  }

  async getCandidateSkills(candidateId) {
    const skills = await this.prisma.workerSkill.findMany({
      where: { workerId: candidateId },
      include: { skill: true },
    });

    return skills.map(ws => ws.skill.name);
  }

  // EMPLOYER SEARCH
  async searchEmployers(query, filters = {}, pagination = { page: 1, limit: 20 }) {
    const cacheKey = this.generateSearchCacheKey('employers', { query, filters, pagination });
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const where = this.buildEmployerSearchWhere(query, filters);

    const [employers, total] = await Promise.all([
      this.prisma.employer.findMany({
        where,
        include: {
          _count: {
            select: {
              jobs: {
                where: { status: 'ACTIVE' },
              },
            },
          },
          jobs: {
            where: { status: 'ACTIVE' },
            take: 5,
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              title: true,
              jobType: true,
              location: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.employer.count({ where }),
    ]);

    const result = {
      employers,
      total,
      pagination,
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  buildEmployerSearchWhere(query, filters) {
    const where = {};

    if (query) {
      where.OR = [
        { name: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { industry: { contains: query, mode: 'insensitive' } },
        { location: { contains: query, mode: 'insensitive' } },
      ];
    }

    if (filters.industry) {
      where.industry = { in: Array.isArray(filters.industry) ? filters.industry : [filters.industry] };
    }

    if (filters.location) {
      where.location = { contains: filters.location, mode: 'insensitive' };
    }

    if (filters.size) {
      where.size = { in: Array.isArray(filters.size) ? filters.size : [filters.size] };
    }

    if (filters.minRating) {
      where.rating = { gte: filters.minRating };
    }

    return where;
  }

  // SKILL SEARCH
  async searchSkills(query, filters = {}) {
    const cacheKey = `search:skills:${query}:${JSON.stringify(filters)}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const where = {};

    if (query) {
      where.name = { contains: query, mode: 'insensitive' };
    }

    if (filters.category) {
      where.category = { in: Array.isArray(filters.category) ? filters.category : [filters.category] };
    }

    const skills = await this.prisma.skill.findMany({
      where,
      include: {
        _count: {
          select: {
            jobs: {
              where: { job: { status: 'ACTIVE' } },
            },
            workers: true,
          },
        },
      },
      orderBy: { name: 'asc' },
      take: filters.limit || 20,
    });

    // Calculate popularity score
    const enriched = skills.map(skill => ({
      ...skill,
      popularityScore: this.calculateSkillPopularity(skill),
    }));

    const result = {
      skills: enriched.sort((a, b) => b.popularityScore - a.popularityScore),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(result));

    return result;
  }

  calculateSkillPopularity(skill) {
    const jobCount = skill._count.jobs;
    const workerCount = skill._count.workers;
    
    // Weight job demand higher than candidate supply
    return (jobCount * 2) + workerCount;
  }

  // AUTOCOMPLETE
  async getAutocompleteSuggestions(type, query, limit = 10) {
    const cacheKey = `autocomplete:${type}:${query}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    let suggestions = [];

    switch (type) {
      case 'skills':
        suggestions = await this.prisma.skill.findMany({
          where: {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          select: {
            id: true,
            name: true,
            category: true,
          },
          take: limit,
          orderBy: { name: 'asc' },
        });
        break;

      case 'job_titles':
        suggestions = await this.prisma.job.findMany({
          where: {
            title: {
              contains: query,
              mode: 'insensitive',
            },
            status: 'ACTIVE',
          },
          select: {
            title: true,
          },
          distinct: ['title'],
          take: limit,
          orderBy: { title: 'asc' },
        });
        suggestions = suggestions.map(s => ({ name: s.title }));
        break;

      case 'locations':
        suggestions = await this.prisma.job.findMany({
          where: {
            location: {
              contains: query,
              mode: 'insensitive',
            },
            status: 'ACTIVE',
          },
          select: {
            location: true,
          },
          distinct: ['location'],
          take: limit,
          orderBy: { location: 'asc' },
        });
        suggestions = suggestions.map(s => ({ name: s.location }));
        break;

      case 'companies':
        suggestions = await this.prisma.employer.findMany({
          where: {
            name: {
              contains: query,
              mode: 'insensitive',
            },
          },
          select: {
            id: true,
            name: true,
            logo: true,
          },
          take: limit,
          orderBy: { name: 'asc' },
        });
        break;
    }

    await this.redis.setex(cacheKey, 300, JSON.stringify(suggestions)); // 5 minutes cache

    return suggestions;
  }

  // TRENDING SEARCHES
  async getTrendingSearches(type = 'jobs', limit = 10) {
    const cacheKey = `trending:${type}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    let trending = [];

    // Get from search analytics or calculate from recent searches
    const recentSearches = await this.prisma.searchLog.findMany({
      where: {
        type,
        createdAt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      select: {
        query: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    // Count occurrences
    const searchCounts = {};
    recentSearches.forEach(log => {
      searchCounts[log.query] = (searchCounts[log.query] || 0) + 1;
    });

    // Sort by frequency
    trending = Object.entries(searchCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([query, count]) => ({ query, count }));

    await this.redis.setex(cacheKey, 1800, JSON.stringify(trending)); // 30 minutes cache

    return trending;
  }

  // SEARCH ANALYTICS
  async logSearch(query, type, userId, filters = {}, resultsCount = 0) {
    await this.prisma.searchLog.create({
      data: {
        query,
        type,
        userId,
        filters: filters || {},
        resultsCount,
        metadata: {
          userAgent: '', // Would come from request
          ipAddress: '',
          timestamp: new Date().toISOString(),
        },
      },
    });

    // Update search trends
    await this.updateSearchTrends(query, type);
  }

  async updateSearchTrends(query, type) {
    const trendKey = `search_trend:${type}:${query}`;
    await this.redis.zincrby(`trending:${type}`, 1, query);
    
    // Expire old trends
    const now = Math.floor(Date.now() / 1000);
    await this.redis.zremrangebyscore(`trending:${type}`, 0, now - 604800); // Remove older than 7 days
  }

  async getSearchAnalytics(period = '7_DAYS') {
    const startDate = this.getPeriodStartDate(period);

    const [
      searchStats,
      topSearches,
      zeroResultSearches,
      conversionStats,
    ] = await Promise.all([
      this.getSearchStats(startDate),
      this.getTopSearches(startDate),
      this.getZeroResultSearches(startDate),
      this.getSearchConversionStats(startDate),
    ]);

    return {
      period,
      searchStats,
      topSearches,
      zeroResultSearches,
      conversionStats,
      insights: this.generateSearchInsights(searchStats, zeroResultSearches),
    };
  }

  async getSearchStats(startDate) {
    const stats = await this.prisma.searchLog.groupBy({
      by: ['type'],
      where: { createdAt: { gte: startDate } },
      _count: { id: true },
      _avg: { resultsCount: true },
    });

    const timeSeries = await this.prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as searches,
        AVG(results_count) as avg_results
      FROM search_logs
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date
    `;

    return {
      totalSearches: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      byType: stats.reduce((acc, stat) => {
        acc[stat.type] = {
          count: stat._count.id,
          avgResults: stat._avg.resultsCount,
        };
        return acc;
      }, {}),
      timeSeries,
    };
  }

  async getTopSearches(startDate, limit = 10) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        query,
        type,
        COUNT(*) as search_count,
        AVG(results_count) as avg_results
      FROM search_logs
      WHERE created_at >= ${startDate}
      GROUP BY query, type
      ORDER BY search_count DESC
      LIMIT ${limit}
    `;

    return result;
  }

  async getZeroResultSearches(startDate, limit = 10) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        query,
        type,
        COUNT(*) as zero_result_count
      FROM search_logs
      WHERE created_at >= ${startDate}
        AND results_count = 0
      GROUP BY query, type
      ORDER BY zero_result_count DESC
      LIMIT ${limit}
    `;

    return result;
  }

  async getSearchConversionStats(startDate) {
    // This would track how searches lead to applications or other actions
    // Implementation depends on conversion tracking system
    return {
      totalConversions: 0,
      conversionRate: 0,
      bySearchType: {},
    };
  }

  generateSearchInsights(searchStats, zeroResultSearches) {
    const insights = [];

    if (zeroResultSearches.length > 0) {
      const topZeroResult = zeroResultSearches[0];
      insights.push({
        type: 'ZERO_RESULT_SEARCHES',
        severity: 'MEDIUM',
        message: `Common searches returning zero results: ${topZeroResult.query}`,
        recommendation: 'Consider adding content or synonyms for these search terms',
      });
    }

    const zeroResultRate = searchStats.totalSearches > 0 ?
      zeroResultSearches.reduce((sum, z) => sum + z.zero_result_count, 0) / searchStats.totalSearches : 0;

    if (zeroResultRate > 0.3) {
      insights.push({
        type: 'HIGH_ZERO_RESULT_RATE',
        severity: 'HIGH',
        message: `High zero-result search rate: ${(zeroResultRate * 100).toFixed(1)}%`,
        recommendation: 'Review search algorithm and content coverage',
      });
    }

    return insights;
  }

  // PERSONALIZED SEARCH
  async getPersonalizedJobRecommendations(userId, limit = 10) {
    const cacheKey = `personalized:jobs:${userId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    // Get user profile and preferences
    const [candidate, applications, savedJobs] = await Promise.all([
      this.prisma.worker.findFirst({
        where: { userId },
        include: {
          skills: {
            include: { skill: true },
          },
          preferences: true,
        },
      }),
      this.prisma.application.findMany({
        where: { worker: { userId } },
        select: { jobId: true },
        take: 20,
      }),
      this.prisma.savedJob.findMany({
        where: { userId },
        select: { jobId: true },
        take: 20,
      }),
    ]);

    if (!candidate) return [];

    // Build search criteria based on user profile
    const searchCriteria = {
      skills: candidate.skills.map(s => s.skill.name),
      location: candidate.location,
      jobTypes: candidate.preferences?.jobTypes || [],
      salaryMin: candidate.expectedSalary ? candidate.expectedSalary * 0.8 : null,
      salaryMax: candidate.expectedSalary ? candidate.expectedSalary * 1.2 : null,
    };

    // Exclude already applied or saved jobs
    const excludedJobIds = [
      ...applications.map(a => a.jobId),
      ...savedJobs.map(s => s.jobId),
    ];

    // Search for matching jobs
    const jobs = await this.searchJobs('', {
      ...searchCriteria,
      excludeIds: excludedJobIds,
    }, { page: 1, limit });

    // Personalize ranking
    const personalized = await this.personalizeJobRanking(jobs.jobs, candidate);

    await this.redis.setex(cacheKey, 1800, JSON.stringify(personalized)); // 30 minutes cache

    return personalized;
  }

  async personalizeJobRanking(jobs, candidate) {
    return Promise.all(
      jobs.map(async (job) => {
        let score = 0;

        // Skill match
        const jobSkills = job.skills.map(s => s.skill.name.toLowerCase());
        const candidateSkills = candidate.skills.map(s => s.skill.name.toLowerCase());
        const skillMatch = jobSkills.filter(skill => 
          candidateSkills.includes(skill)
        ).length;
        score += (skillMatch / jobSkills.length) * 40;

        // Location preference
        if (candidate.preferences?.locations?.includes(job.location)) {
          score += 20;
        } else if (job.isRemote && candidate.preferences?.remotePreference === 'REMOTE') {
          score += 20;
        }

        // Salary match
        if (candidate.expectedSalary && job.salaryMin && job.salaryMax) {
          const jobAvgSalary = (job.salaryMin + job.salaryMax) / 2;
          const salaryDiff = Math.abs(jobAvgSalary - candidate.expectedSalary);
          const salaryMatch = Math.max(0, 100 - (salaryDiff / candidate.expectedSalary) * 100);
          score += salaryMatch * 0.2;
        }

        // Company size preference
        if (candidate.preferences?.companySizes?.includes(job.employer.size)) {
          score += 10;
        }

        return {
          ...job,
          personalizationScore: Math.min(score, 100),
        };
      })
    );
  }

  // CACHE MANAGEMENT
  generateSearchCacheKey(type, params) {
    const paramStr = JSON.stringify(params);
    const hash = require('crypto').createHash('md5').update(paramStr).digest('hex');
    return `search:${type}:${hash}`;
  }

  async clearSearchCache(type, params = null) {
    if (params) {
      const cacheKey = this.generateSearchCacheKey(type, params);
      await this.redis.del(cacheKey);
    } else {
      const pattern = `search:${type}:*`;
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
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
      default:
        return new Date(now.setDate(now.getDate() - 30));
    }
  }
}

module.exports = SearchRepository;
