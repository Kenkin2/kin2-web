/**
 * █▀▀ ▀█▀ ▄▀█ █▀ ▀█▀ █▀█ █▀▄ █▀▀ █▀█
 * ██▄ ░█░ █▀█ ▄█ ░█░ █▄█ █▄▀ ██▄ █▀▄
 * Kin2 Workforce Platform - Database Service Layer v2.5.0
 * Advanced database operations, caching, and query optimization
 */

// ======================================================
// 1. IMPORTS & DEPENDENCIES
// ======================================================

const { PrismaClient, Prisma } = require('@prisma/client');
const redis = require('redis');
const { systemLogger, errorLogger } = require('../../utils/logger');
const { AppError, NotFoundError, ValidationError } = require('../../middleware/errorHandler');
const crypto = require('crypto');

// ======================================================
// 2. DATABASE SERVICE CLASS
// ======================================================

class DatabaseService {
  constructor() {
    this.prisma = null;
    this.redis = null;
    this.cacheEnabled = false;
    this.isConnected = false;
    this.queryCount = 0;
    this.queryCache = new Map();
    this.lastCleanup = Date.now();
  }

  /**
   * Initialize database service
   */
  async initialize() {
    try {
      systemLogger.info('🔌 Initializing database service...');
      
      // Initialize Prisma
      await this.initializePrisma();
      
      // Initialize Redis if available
      await this.initializeRedis();
      
      // Set up cleanup interval
      this.setupCleanupInterval();
      
      this.isConnected = true;
      systemLogger.info('✅ Database service initialized successfully');
      
      return this;
    } catch (error) {
      systemLogger.error('❌ Failed to initialize database service:', error);
      throw error;
    }
  }

  /**
   * Initialize Prisma ORM
   */
  async initializePrisma() {
    this.prisma = new PrismaClient({
      log: this.getPrismaLogLevel(),
      errorFormat: 'pretty',
      datasources: {
        db: {
          url: process.env.DATABASE_URL
        }
      },
      // Connection pool settings
      ...this.getConnectionPoolConfig()
    });

    // Add query logging middleware
    this.prisma.$use(this.queryLoggerMiddleware());
    
    // Add soft delete middleware
    this.prisma.$use(this.softDeleteMiddleware());
    
    // Add caching middleware
    if (process.env.ENABLE_QUERY_CACHE === 'true') {
      this.prisma.$use(this.cacheMiddleware());
    }

    // Test connection
    await this.prisma.$connect();
    systemLogger.info('✅ Prisma connected successfully');
  }

  /**
   * Initialize Redis cache
   */
  async initializeRedis() {
    if (!process.env.REDIS_URL) {
      systemLogger.warn('⚠️  Redis URL not configured, caching disabled');
      return;
    }

    try {
      this.redis = redis.createClient({
        url: process.env.REDIS_URL,
        password: process.env.REDIS_PASSWORD,
        socket: {
          tls: process.env.REDIS_TLS === 'true',
          reconnectStrategy: (retries) => Math.min(retries * 100, 3000)
        }
      });

      this.redis.on('error', (err) => {
        errorLogger.error('Redis connection error:', err);
        this.cacheEnabled = false;
      });

      this.redis.on('connect', () => {
        systemLogger.info('✅ Redis connected successfully');
        this.cacheEnabled = true;
      });

      await this.redis.connect();
    } catch (error) {
      systemLogger.error('❌ Failed to connect to Redis:', error.message);
      this.cacheEnabled = false;
    }
  }

  /**
   * Get Prisma log level based on environment
   */
  getPrismaLogLevel() {
    const env = process.env.NODE_ENV;
    
    if (env === 'development') {
      return ['query', 'info', 'warn', 'error'];
    }
    
    if (env === 'production') {
      return ['warn', 'error'];
    }
    
    return ['error'];
  }

  /**
   * Get connection pool configuration
   */
  getConnectionPoolConfig() {
    return {
      // Connection pool settings
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
          connection_limit: parseInt(process.env.DB_POOL_SIZE) || 10,
          pool_timeout: parseInt(process.env.DB_POOL_TIMEOUT) || 10000,
          idle_timeout: parseInt(process.env.DB_POOL_IDLE_TIMEOUT) || 30000
        }
      }
    };
  }

  // ======================================================
  // 3. QUERY MIDDLEWARE
  // ======================================================

  /**
   * Query logging middleware
   */
  queryLoggerMiddleware() {
    return async (params, next) => {
      const start = Date.now();
      this.queryCount++;
      
      try {
        const result = await next(params);
        const duration = Date.now() - start;
        
        // Log slow queries
        if (duration > parseInt(process.env.QUERY_LOG_THRESHOLD || 1000)) {
          systemLogger.warn('Slow query detected', {
            model: params.model,
            action: params.action,
            duration: `${duration}ms`,
            query: params.args,
            timestamp: new Date().toISOString()
          });
        }
        
        // Log in development
        if (process.env.NODE_ENV === 'development' && process.env.DEBUG_DATABASE === 'true') {
          console.log(`📊 Query [${duration}ms]: ${params.model}.${params.action}`);
        }
        
        return result;
      } catch (error) {
        const duration = Date.now() - start;
        errorLogger.error('Query failed', {
          model: params.model,
          action: params.action,
          duration: `${duration}ms`,
          error: error.message,
          query: params.args
        });
        throw error;
      }
    };
  }

  /**
   * Soft delete middleware
   */
  softDeleteMiddleware() {
    return async (params, next) => {
      // Handle read operations (findUnique, findMany, findFirst)
      if (params.action === 'findUnique' || params.action === 'findFirst') {
        // Add deletedAt filter to WHERE clause
        params.args.where = {
          ...params.args.where,
          deletedAt: null
        };
      }
      
      if (params.action === 'findMany') {
        // Add deletedAt filter to WHERE clause if not already present
        if (!params.args.where) {
          params.args.where = { deletedAt: null };
        } else if (!params.args.where.deletedAt) {
          params.args.where.deletedAt = null;
        }
      }
      
      // Handle update operations
      if (params.action === 'update') {
        // Add deletedAt filter to WHERE clause
        params.args.where = {
          ...params.args.where,
          deletedAt: null
        };
      }
      
      // Handle delete operations - convert to soft delete
      if (params.action === 'delete') {
        params.action = 'update';
        params.args.data = { deletedAt: new Date() };
      }
      
      if (params.action === 'deleteMany') {
        params.action = 'updateMany';
        params.args.data = { deletedAt: new Date() };
      }
      
      return next(params);
    };
  }

  /**
   * Cache middleware
   */
  cacheMiddleware() {
    return async (params, next) => {
      // Only cache read operations
      if (!['findUnique', 'findFirst', 'findMany', 'count', 'aggregate'].includes(params.action)) {
        return next(params);
      }
      
      // Check if caching is enabled for this query
      if (!this.shouldCacheQuery(params)) {
        return next(params);
      }
      
      const cacheKey = this.generateCacheKey(params);
      
      // Try to get from cache
      if (this.cacheEnabled) {
        try {
          const cached = await this.redis.get(cacheKey);
          if (cached) {
            // Update in-memory cache
            this.queryCache.set(cacheKey, {
              data: JSON.parse(cached),
              timestamp: Date.now(),
              ttl: this.getCacheTTL(params)
            });
            
            // Return cached data
            return JSON.parse(cached);
          }
        } catch (error) {
          // If Redis fails, fall back to in-memory cache
          const inMemoryCache = this.queryCache.get(cacheKey);
          if (inMemoryCache && Date.now() - inMemoryCache.timestamp < inMemoryCache.ttl) {
            return inMemoryCache.data;
          }
        }
      }
      
      // Execute query
      const result = await next(params);
      
      // Cache the result
      await this.cacheResult(cacheKey, result, params);
      
      return result;
    };
  }

  // ======================================================
  // 4. CACHE MANAGEMENT
  // ======================================================

  /**
   * Generate cache key for query
   */
  generateCacheKey(params) {
    const keyData = {
      model: params.model,
      action: params.action,
      args: params.args,
      timestamp: Math.floor(Date.now() / 60000) // Minute precision
    };
    
    const hash = crypto
      .createHash('md5')
      .update(JSON.stringify(keyData))
      .digest('hex');
    
    return `kin2:cache:query:${hash}`;
  }

  /**
   * Check if query should be cached
   */
  shouldCacheQuery(params) {
    // Don't cache complex queries
    if (params.args?.include || params.args?.select || params.args?.orderBy) {
      return false;
    }
    
    // Don't cache queries with many results
    if (params.action === 'findMany' && params.args?.take && params.args.take > 100) {
      return false;
    }
    
    // Cache based on model
    const cacheableModels = ['User', 'Job', 'Employer', 'Worker', 'Product', 'Category'];
    return cacheableModels.includes(params.model);
  }

  /**
   * Get cache TTL for query
   */
  getCacheTTL(params) {
    const defaultTTL = parseInt(process.env.CACHE_TTL_DEFAULT) || 3600; // 1 hour
    
    // Shorter TTL for frequently changing data
    const shortTTLModels = ['User', 'Application', 'Payment'];
    if (shortTTLModels.includes(params.model)) {
      return parseInt(process.env.CACHE_TTL_SHORT) || 300; // 5 minutes
    }
    
    // Longer TTL for stable data
    const longTTLModels = ['Category', 'Skill', 'Language'];
    if (longTTLModels.includes(params.model)) {
      return parseInt(process.env.CACHE_TTL_LONG) || 86400; // 24 hours
    }
    
    return defaultTTL;
  }

  /**
   * Cache query result
   */
  async cacheResult(key, result, params) {
    const ttl = this.getCacheTTL(params);
    
    // Store in in-memory cache
    this.queryCache.set(key, {
      data: result,
      timestamp: Date.now(),
      ttl: ttl * 1000 // Convert to milliseconds
    });
    
    // Store in Redis if available
    if (this.cacheEnabled) {
      try {
        await this.redis.setEx(key, ttl, JSON.stringify(result));
      } catch (error) {
        errorLogger.error('Failed to cache in Redis:', error);
      }
    }
  }

  /**
   * Invalidate cache for a model
   */
  async invalidateCache(model, id = null) {
    if (!this.cacheEnabled) return;
    
    try {
      // Invalidate all queries for this model
      const pattern = `kin2:cache:query:*model=${model}*`;
      const keys = await this.redis.keys(pattern);
      
      if (keys.length > 0) {
        await this.redis.del(keys);
      }
      
      // Invalidate specific item cache if ID provided
      if (id) {
        const itemKey = `kin2:cache:model:${model}:${id}`;
        await this.redis.del(itemKey);
      }
      
      // Clear in-memory cache
      this.clearInMemoryCache(model, id);
      
    } catch (error) {
      errorLogger.error('Failed to invalidate cache:', error);
    }
  }

  /**
   * Clear in-memory cache
   */
  clearInMemoryCache(model, id = null) {
    for (const [key, value] of this.queryCache.entries()) {
      if (key.includes(`model=${model}`)) {
        if (!id || key.includes(`id=${id}`)) {
          this.queryCache.delete(key);
        }
      }
    }
  }

  /**
   * Setup cleanup interval for in-memory cache
   */
  setupCleanupInterval() {
    setInterval(() => {
      const now = Date.now();
      for (const [key, value] of this.queryCache.entries()) {
        if (now - value.timestamp > value.ttl) {
          this.queryCache.delete(key);
        }
      }
      this.lastCleanup = now;
    }, 60000); // Cleanup every minute
  }

  // ======================================================
  // 5. DATABASE OPERATIONS
  // ======================================================

  /**
   * Execute transaction with retry logic
   */
  async transaction(operations, options = {}) {
    const maxRetries = options.maxRetries || 3;
    const retryDelay = options.retryDelay || 100;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.prisma.$transaction(operations, {
          maxWait: options.maxWait || 5000,
          timeout: options.timeout || 10000,
          isolationLevel: options.isolationLevel || Prisma.TransactionIsolationLevel.Serializable
        });
      } catch (error) {
        // Check if error is retryable
        if (this.isRetryableError(error) && attempt < maxRetries) {
          const delay = retryDelay * Math.pow(2, attempt - 1);
          systemLogger.warn(`Transaction failed, retrying in ${delay}ms (attempt ${attempt}/${maxRetries})`, {
            error: error.message,
            attempt
          });
          
          await this.sleep(delay);
          continue;
        }
        
        // If not retryable or max retries reached, throw error
        errorLogger.error('Transaction failed', {
          error: error.message,
          attempts: attempt,
          operations: operations.toString()
        });
        
        throw new AppError('Transaction failed', 500);
      }
    }
  }

  /**
   * Check if error is retryable
   */
  isRetryableError(error) {
    // Prisma errors that can be retried
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      return ['P2028', 'P2034', 'P1001', 'P1002', 'P1008'].includes(error.code);
    }
    
    // Network/timeout errors
    if (error.message.includes('timeout') || 
        error.message.includes('network') || 
        error.message.includes('connection')) {
      return true;
    }
    
    return false;
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Bulk operations with chunking
   */
  async bulkOperation(operation, data, chunkSize = 1000, options = {}) {
    const results = [];
    const chunks = this.chunkArray(data, chunkSize);
    
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const chunkResults = await operation(chunk, options);
      results.push(...chunkResults);
      
      // Log progress
      if (options.logProgress) {
        const progress = ((i + 1) / chunks.length) * 100;
        systemLogger.info(`Bulk operation progress: ${progress.toFixed(1)}%`);
      }
      
      // Add delay between chunks if specified
      if (options.chunkDelay && i < chunks.length - 1) {
        await this.sleep(options.chunkDelay);
      }
    }
    
    return results;
  }

  /**
   * Chunk array into smaller arrays
   */
  chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Find with pagination
   */
  async findWithPagination(model, options = {}) {
    const {
      where = {},
      include,
      select,
      orderBy = { createdAt: 'desc' },
      page = 1,
      limit = 20,
      cursor,
      distinct
    } = options;
    
    const skip = (page - 1) * limit;
    
    const [data, total] = await Promise.all([
      this.prisma[model].findMany({
        where,
        include,
        select,
        orderBy,
        skip: cursor ? undefined : skip,
        take: limit,
        cursor: cursor ? { id: cursor } : undefined,
        distinct
      }),
      this.prisma[model].count({ where })
    ]);
    
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;
    
    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage,
        hasPreviousPage,
        nextPage: hasNextPage ? page + 1 : null,
        previousPage: hasPreviousPage ? page - 1 : null
      }
    };
  }

  /**
   * Search with full-text search
   */
  async search(model, searchTerm, fields, options = {}) {
    const {
      where = {},
      include,
      select,
      orderBy,
      page = 1,
      limit = 20
    } = options;
    
    // Build search conditions
    const searchConditions = fields.map(field => ({
      [field]: {
        contains: searchTerm,
        mode: 'insensitive'
      }
    }));
    
    const searchWhere = {
      ...where,
      OR: searchConditions
    };
    
    return this.findWithPagination(model, {
      where: searchWhere,
      include,
      select,
      orderBy,
      page,
      limit
    });
  }

  // ======================================================
  // 6. USER OPERATIONS
  // ======================================================

  /**
   * Find user by email with all related data
   */
  async findUserByEmail(email, options = {}) {
    const {
      includeProfile = true,
      includeEmployer = true,
      includeWorker = true,
      includeAdmin = true,
      includeSessions = false,
      includeTokens = false
    } = options;
    
    const include = {};
    
    if (includeProfile) include.profile = true;
    if (includeEmployer) include.employer = true;
    if (includeWorker) include.worker = true;
    if (includeAdmin) include.admin = true;
    if (includeSessions) include.sessions = true;
    if (includeTokens) include.refreshTokens = true;
    
    return this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      include: Object.keys(include).length > 0 ? include : undefined
    });
  }

  /**
   * Find user by ID with all related data
   */
  async findUserById(id, options = {}) {
    const {
      includeProfile = true,
      includeEmployer = true,
      includeWorker = true,
      includeAdmin = true,
      includeSessions = false,
      includeTokens = false,
      includeJobs = false,
      includeApplications = false
    } = options;
    
    const include = {};
    
    if (includeProfile) include.profile = true;
    if (includeEmployer) include.employer = true;
    if (includeWorker) include.worker = true;
    if (includeAdmin) include.admin = true;
    if (includeSessions) include.sessions = true;
    if (includeTokens) include.refreshTokens = true;
    if (includeJobs) include.jobs = true;
    if (includeApplications) include.applications = true;
    
    return this.prisma.user.findUnique({
      where: { id, deletedAt: null },
      include: Object.keys(include).length > 0 ? include : undefined
    });
  }

  /**
   * Create user with profile
   */
  async createUserWithProfile(userData, profileData = {}) {
    return this.transaction(async (prisma) => {
      // Create user
      const user = await prisma.user.create({
        data: {
          email: userData.email,
          passwordHash: userData.passwordHash,
          role: userData.role,
          status: userData.status || 'PENDING',
          isEmailVerified: userData.isEmailVerified || false,
          profile: {
            create: {
              firstName: profileData.firstName || '',
              lastName: profileData.lastName || '',
              preferredLanguage: profileData.preferredLanguage || 'en',
              currency: profileData.currency || 'USD'
            }
          }
        },
        include: {
          profile: true
        }
      });
      
      // Create role-specific records
      if (user.role === 'EMPLOYER' && profileData.companyName) {
        await prisma.employer.create({
          data: {
            userId: user.id,
            companyName: profileData.companyName,
            contactPerson: `${profileData.firstName} ${profileData.lastName}`,
            contactEmail: user.email
          }
        });
      }
      
      if (user.role === 'WORKER') {
        await prisma.worker.create({
          data: {
            userId: user.id,
            workerId: `WRK-${Date.now().toString(36).toUpperCase()}`,
            availabilityType: 'FULL_TIME',
            salaryCurrency: profileData.currency || 'USD'
          }
        });
      }
      
      return this.findUserById(user.id);
    });
  }

  /**
   * Update user password
   */
  async updateUserPassword(userId, newPasswordHash) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash: newPasswordHash,
        lastPasswordChange: new Date(),
        resetToken: null,
        resetTokenExpiry: null
      }
    });
  }

  // ======================================================
  // 7. JOB OPERATIONS
  // ======================================================

  /**
   * Create job with AI analysis
   */
  async createJob(jobData, employerId, userId) {
    return this.transaction(async (prisma) => {
      // Generate job ID
      const jobId = `JOB-${Date.now().toString(36).toUpperCase()}`;
      
      // Create job
      const job = await prisma.job.create({
        data: {
          ...jobData,
          employerId,
          userId,
          jobId,
          slug: this.generateSlug(jobData.title)
        }
      });
      
      // Invalidate cache
      await this.invalidateCache('Job');
      
      return job;
    });
  }

  /**
   * Update job with validation
   */
  async updateJob(jobId, updateData, userId) {
    return this.transaction(async (prisma) => {
      // Check if job exists and user has permission
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: { employer: true }
      });
      
      if (!job) {
        throw new NotFoundError('Job');
      }
      
      // Check permissions
      if (job.userId !== userId && job.employer.userId !== userId) {
        throw new AppError('Not authorized to update this job', 403);
      }
      
      // Update job
      const updatedJob = await prisma.job.update({
        where: { id: jobId },
        data: updateData
      });
      
      // Invalidate cache
      await this.invalidateCache('Job', jobId);
      
      return updatedJob;
    });
  }

  /**
   * Search jobs with filters
   */
  async searchJobs(filters = {}, pagination = {}) {
    const {
      query = '',
      location = '',
      jobType = [],
      workType = [],
      experienceLevel = [],
      minSalary,
      maxSalary,
      isRemote,
      industry = [],
      skills = []
    } = filters;
    
    const where = {
      deletedAt: null,
      status: 'PUBLISHED',
      expiresAt: { gt: new Date() }
    };
    
    // Text search
    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { requirements: { contains: query, mode: 'insensitive' } }
      ];
    }
    
    // Location filter
    if (location) {
      where.OR = [
        { location: { contains: location, mode: 'insensitive' } },
        { city: { contains: location, mode: 'insensitive' } },
        { country: { contains: location, mode: 'insensitive' } }
      ];
    }
    
    // Job type filter
    if (jobType.length > 0) {
      where.jobType = { in: jobType };
    }
    
    // Work type filter
    if (workType.length > 0) {
      where.workType = { in: workType };
    }
    
    // Experience level filter
    if (experienceLevel.length > 0) {
      where.experienceLevel = { in: experienceLevel };
    }
    
    // Salary filter
    if (minSalary || maxSalary) {
      where.AND = [];
      
      if (minSalary) {
        where.AND.push({
          OR: [
            { salaryMin: { gte: minSalary } },
            { salaryMax: { gte: minSalary } }
          ]
        });
      }
      
      if (maxSalary) {
        where.AND.push({
          OR: [
            { salaryMax: { lte: maxSalary } },
            { salaryMin: { lte: maxSalary } }
          ]
        });
      }
    }
    
    // Remote filter
    if (isRemote !== undefined) {
      where.isRemote = isRemote;
    }
    
    // Industry filter (through employer)
    if (industry.length > 0) {
      where.employer = {
        industry: { in: industry }
      };
    }
    
    // Skills filter
    if (skills.length > 0) {
      where.AND = where.AND || [];
      skills.forEach(skill => {
        where.AND.push({
          OR: [
            { requiredSkills: { has: skill } },
            { preferredSkills: { has: skill } }
          ]
        });
      });
    }
    
    return this.findWithPagination('Job', {
      where,
      include: {
        employer: {
          include: {
            user: {
              include: {
                profile: true
              }
            }
          }
        }
      },
      ...pagination
    });
  }

  // ======================================================
  // 8. AI & MATCHING OPERATIONS
  // ======================================================

  /**
   * Get job matches for worker
   */
  async getJobMatchesForWorker(workerId, options = {}) {
    const {
      limit = 10,
      includeScores = true,
      includeAIanalysis = true,
      minScore = 60
    } = options;
    
    // Get worker profile
    const worker = await this.prisma.worker.findUnique({
      where: { id: workerId },
      include: {
        user: {
          include: {
            profile: true
          }
        }
      }
    });
    
    if (!worker) {
      throw new NotFoundError('Worker');
    }
    
    // Get worker skills from profile
    const workerSkills = worker.user.profile?.skills || [];
    
    // Find matching jobs
    const jobs = await this.prisma.job.findMany({
      where: {
        deletedAt: null,
        status: 'PUBLISHED',
        expiresAt: { gt: new Date() },
        OR: [
          { requiredSkills: { hasSome: workerSkills.map(s => s.name) } },
          { preferredSkills: { hasSome: workerSkills.map(s => s.name) } }
        ]
      },
      include: {
        employer: {
          include: {
            user: {
              include: {
                profile: true
              }
            }
          }
        },
        kfnScores: {
          where: { workerId }
        }
      },
      take: limit * 3 // Get more jobs to filter
    });
    
    // Calculate scores for each job
    const jobsWithScores = await Promise.all(
      jobs.map(async (job) => {
        let kfnScore = job.kfnScores[0];
        
        // Calculate KFN score if not already calculated
        if (!kfnScore && includeScores) {
          kfnScore = await this.calculateKFNScore(worker, job);
        }
        
        // Get AI analysis if requested
        let aiAnalysis = null;
        if (includeAIanalysis) {
          aiAnalysis = await this.analyzeJobMatch(worker, job);
        }
        
        return {
          job,
          kfnScore: kfnScore?.overallScore || 0,
          aiAnalysis
        };
      })
    );
    
    // Filter by minimum score and sort
    const filteredJobs = jobsWithScores
      .filter(job => job.kfnScore >= minScore)
      .sort((a, b) => b.kfnScore - a.kfnScore)
      .slice(0, limit);
    
    return filteredJobs;
  }

  /**
   * Calculate KFN score for worker-job match
   */
  async calculateKFNScore(worker, job) {
    // This is a simplified version - in reality would use the full KFN algorithm
    
    let totalScore = 0;
    let breakdown = {};
    
    // Skills match (30%)
    const workerSkills = worker.user.profile?.skills?.map(s => s.name) || [];
    const jobRequiredSkills = job.requiredSkills || [];
    const jobPreferredSkills = job.preferredSkills || [];
    
    const requiredMatch = this.calculateSkillsMatch(workerSkills, jobRequiredSkills);
    const preferredMatch = this.calculateSkillsMatch(workerSkills, jobPreferredSkills);
    const skillsScore = (requiredMatch * 0.7 + preferredMatch * 0.3) * 100;
    breakdown.skills = skillsScore;
    totalScore += skillsScore * 0.3;
    
    // Experience match (25%)
    const workerExperience = worker.user.profile?.yearsExperience || 0;
    const jobExperience = this.parseExperienceLevel(job.experienceLevel);
    const experienceScore = Math.min((workerExperience / jobExperience) * 100, 100);
    breakdown.experience = experienceScore;
    totalScore += experienceScore * 0.25;
    
    // Location match (15%)
    let locationScore = 100;
    if (!job.isRemote && worker.user.profile?.city) {
      // Simple location matching - in production would use geolocation
      locationScore = worker.user.profile.city === job.city ? 100 : 50;
    }
    breakdown.location = locationScore;
    totalScore += locationScore * 0.15;
    
    // Salary match (15%)
    let salaryScore = 100;
    if (worker.minSalary && job.salaryMin) {
      const match = worker.minSalary <= job.salaryMax && worker.maxSalary >= job.salaryMin;
      salaryScore = match ? 100 : 50;
    }
    breakdown.salary = salaryScore;
    totalScore += salaryScore * 0.15;
    
    // Availability match (15%)
    let availabilityScore = 100;
    if (job.jobType === 'FULL_TIME' && worker.availabilityType !== 'FULL_TIME') {
      availabilityScore = 50;
    }
    breakdown.availability = availabilityScore;
    totalScore += availabilityScore * 0.15;
    
    // Save score to database
    const kfnScore = await this.prisma.kFNScore.create({
      data: {
        jobId: job.id,
        workerId: worker.id,
        userId: worker.userId,
        scoreId: `KFN-${Date.now().toString(36).toUpperCase()}`,
        version: '2.0.0',
        overallScore: totalScore,
        skillsScore: breakdown.skills,
        skillsBreakdown: { requiredMatch, preferredMatch },
        experienceScore: breakdown.experience,
        experienceBreakdown: { workerExperience, jobExperience },
        locationScore: breakdown.location,
        locationBreakdown: { remote: job.isRemote },
        salaryScore: breakdown.salary,
        salaryBreakdown: { 
          workerMin: worker.minSalary, 
          workerMax: worker.maxSalary,
          jobMin: job.salaryMin,
          jobMax: job.salaryMax
        },
        availabilityScore: breakdown.availability,
        availabilityBreakdown: { 
          worker: worker.availabilityType,
          job: job.jobType 
        },
        cultureScore: 0,
        cultureBreakdown: {},
        recommendation: this.getRecommendation(totalScore),
        insights: this.generateInsights(breakdown),
        calculationTime: 0,
        dataPointsUsed: Object.keys(breakdown).length
      }
    });
    
    return kfnScore;
  }

  /**
   * Calculate skills match percentage
   */
  calculateSkillsMatch(workerSkills, jobSkills) {
    if (!jobSkills.length) return 1;
    
    const matchingSkills = workerSkills.filter(skill => 
      jobSkills.includes(skill)
    );
    
    return matchingSkills.length / jobSkills.length;
  }

  /**
   * Parse experience level to years
   */
  parseExperienceLevel(level) {
    const map = {
      'ENTRY': 1,
      'JUNIOR': 2,
      'MID_LEVEL': 3,
      'SENIOR': 5,
      'LEAD': 8,
      'EXPERT': 10
    };
    
    return map[level] || 3;
  }

  /**
   * Get recommendation based on score
   */
  getRecommendation(score) {
    if (score >= 85) return 'STRONG_MATCH';
    if (score >= 70) return 'GOOD_MATCH';
    if (score >= 60) return 'FAIR_MATCH';
    if (score >= 50) return 'WEAK_MATCH';
    return 'NO_MATCH';
  }

  /**
   * Generate insights from score breakdown
   */
  generateInsights(breakdown) {
    const insights = [];
    
    if (breakdown.skills >= 80) {
      insights.push('Excellent skills match');
    } else if (breakdown.skills >= 60) {
      insights.push('Good skills alignment');
    }
    
    if (breakdown.experience >= 80) {
      insights.push('Experience requirements met');
    }
    
    if (breakdown.location === 100) {
      insights.push('Location match perfect');
    }
    
    if (breakdown.salary === 100) {
      insights.push('Salary expectations aligned');
    }
    
    if (breakdown.availability === 100) {
      insights.push('Availability matches job requirements');
    }
    
    return insights;
  }

  /**
   * Analyze job match with AI
   */
  async analyzeJobMatch(worker, job) {
    // This would call the AI service
    // For now, return mock analysis
    return {
      strengths: ['Skills alignment', 'Experience match'],
      weaknesses: ['Location mismatch', 'Salary expectations'],
      recommendations: ['Consider remote work', 'Negotiate salary'],
      confidence: 0.85
    };
  }

  // ======================================================
  // 9. UTILITY METHODS
  // ======================================================

  /**
   * Generate slug from title
   */
  generateSlug(title) {
    return title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .substring(0, 100);
  }

  /**
   * Get database statistics
   */
  async getDatabaseStats() {
    const stats = {};
    
    // Get counts for all major tables
    const models = ['User', 'Job', 'Application', 'Employer', 'Worker', 'Payment', 'AIAgent'];
    
    for (const model of models) {
      try {
        stats[model] = await this.prisma[model].count({
          where: { deletedAt: null }
        });
      } catch (error) {
        stats[model] = 'N/A';
      }
    }
    
    // Get cache stats
    if (this.cacheEnabled) {
      try {
        const cacheInfo = await this.redis.info('memory');
        stats.cache = {
          hits: this.queryCache.size,
          enabled: true,
          redisInfo: cacheInfo
        };
      } catch (error) {
        stats.cache = { enabled: false, error: error.message };
      }
    } else {
      stats.cache = { enabled: false };
    }
    
    // Get query performance
    stats.performance = {
      queryCount: this.queryCount,
      cacheHits: this.queryCache.size,
      lastCleanup: new Date(this.lastCleanup).toISOString()
    };
    
    return stats;
  }

  /**
   * Backup database
   */
  async backupDatabase(options = {}) {
    const backupDir = options.backupDir || './backups';
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `backup-${timestamp}.sql`;
    const filepath = `${backupDir}/${filename}`;
    
    // Ensure backup directory exists
    const fs = require('fs');
    if (!fs.existsSync(backupDir)) {
      fs.mkdirSync(backupDir, { recursive: true });
    }
    
    // This is a simplified backup - in production you would use pg_dump
    const backupData = {
      timestamp: new Date().toISOString(),
      tables: {},
      stats: await this.getDatabaseStats()
    };
    
    // Save backup to file
    fs.writeFileSync(filepath, JSON.stringify(backupData, null, 2));
    
    return {
      filename,
      filepath,
      size: fs.statSync(filepath).size,
      timestamp: backupData.timestamp
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    const checks = [];
    
    // Database connection check
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.push({
        service: 'database',
        status: 'healthy',
        latency: 'N/A'
      });
    } catch (error) {
      checks.push({
        service: 'database',
        status: 'unhealthy',
        error: error.message
      });
    }
    
    // Redis connection check
    if (this.cacheEnabled) {
      try {
        await this.redis.ping();
        checks.push({
          service: 'redis',
          status: 'healthy'
        });
      } catch (error) {
        checks.push({
          service: 'redis',
          status: 'unhealthy',
          error: error.message
        });
      }
    }
    
    // Connection pool check
    const poolStatus = {
      queryCount: this.queryCount,
      cacheEnabled: this.cacheEnabled,
      cacheSize: this.queryCache.size,
      connected: this.isConnected
    };
    
    checks.push({
      service: 'pool',
      status: 'healthy',
      details: poolStatus
    });
    
    return {
      status: checks.every(c => c.status === 'healthy') ? 'healthy' : 'degraded',
      checks,
      timestamp: new Date().toISOString()
    };
  }

  // ======================================================
  // 10. CLEANUP & MAINTENANCE
  // ======================================================

  /**
   * Cleanup expired data
   */
  async cleanupExpiredData() {
    const results = {};
    
    // Cleanup expired sessions
    try {
      const expiredSessions = await this.prisma.session.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });
      results.sessions = expiredSessions.count;
    } catch (error) {
      results.sessions = { error: error.message };
    }
    
    // Cleanup expired jobs
    try {
      const expiredJobs = await this.prisma.job.updateMany({
        where: {
          expiresAt: { lt: new Date() },
          status: { not: 'EXPIRED' }
        },
        data: { status: 'EXPIRED' }
      });
      results.jobs = expiredJobs.count;
    } catch (error) {
      results.jobs = { error: error.message };
    }
    
    // Cleanup old refresh tokens
    try {
      const oldTokens = await this.prisma.refreshToken.deleteMany({
        where: {
          expiresAt: { lt: new Date() }
        }
      });
      results.tokens = oldTokens.count;
    } catch (error) {
      results.tokens = { error: error.message };
    }
    
    // Cleanup old cache entries
    if (this.cacheEnabled) {
      try {
        const pattern = 'kin2:cache:*';
        const keys = await this.redis.keys(pattern);
        
        if (keys.length > 0) {
          // Delete keys older than 7 days
          const pipeline = this.redis.pipeline();
          keys.forEach(key => pipeline.ttl(key));
          
          const ttlResults = await pipeline.exec();
          const keysToDelete = [];
          
          ttlResults.forEach(([err, ttl], index) => {
            if (!err && ttl === -1) {
              keysToDelete.push(keys[index]);
            }
          });
          
          if (keysToDelete.length > 0) {
            await this.redis.del(keysToDelete);
          }
          
          results.cache = { deleted: keysToDelete.length };
        }
      } catch (error) {
        results.cache = { error: error.message };
      }
    }
    
    return results;
  }

  /**
   * Close all connections
   */
  async close() {
    systemLogger.info('🔌 Closing database connections...');
    
    // Close Prisma connection
    if (this.prisma) {
      await this.prisma.$disconnect();
      systemLogger.info('✅ Prisma connection closed');
    }
    
    // Close Redis connection
    if (this.redis) {
      await this.redis.quit();
      systemLogger.info('✅ Redis connection closed');
    }
    
    // Clear in-memory cache
    this.queryCache.clear();
    
    this.isConnected = false;
    systemLogger.info('✅ Database service closed');
  }

  // ======================================================
  // 11. ERROR HANDLING WRAPPERS
  // ======================================================

  /**
   * Execute operation with error handling
   */
  async execute(operation, context = {}) {
    try {
      return await operation();
    } catch (error) {
      // Log error with context
      errorLogger.error('Database operation failed', {
        error: error.message,
        stack: error.stack,
        ...context
      });
      
      // Convert Prisma errors to AppError
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        throw this.handlePrismaError(error);
      }
      
      // Re-throw AppError as is
      if (error instanceof AppError) {
        throw error;
      }
      
      // Wrap other errors
      throw new AppError('Database operation failed', 500, false);
    }
  }

  /**
   * Handle Prisma errors
   */
  handlePrismaError(error) {
    switch (error.code) {
      case 'P2002':
        return new ValidationError([{
          field: error.meta?.target?.[0] || 'field',
          message: 'A record with this value already exists'
        }]);
      
      case 'P2025':
        return new NotFoundError('Record');
      
      case 'P2003':
        return new ValidationError([{
          field: error.meta?.field_name || 'field',
          message: 'Foreign key constraint failed'
        }]);
      
      default:
        return new AppError(`Database error: ${error.message}`, 500);
    }
  }
}

// ======================================================
// 12. SINGLETON INSTANCE & EXPORTS
// ======================================================

// Create singleton instance
const databaseService = new DatabaseService();

// Export singleton and class
module.exports = {
  database: databaseService,
  DatabaseService
};

// Auto-initialize if not in test mode
if (process.env.NODE_ENV !== 'test') {
  databaseService.initialize().catch(error => {
    console.error('Failed to initialize database service:', error);
    process.exit(1);
  });
                            }
