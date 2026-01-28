// utils/ai.js
const axios = require('axios');
const natural = require('natural');
const tf = require('@tensorflow/tfjs');
const { NlpManager } = require('node-nlp');
const { Configuration, OpenAIApi } = require('openai');
const { HfInference } = require('@huggingface/inference');
const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const crypto = require('crypto');
const Redis = require('ioredis');

class AIService {
  constructor(config = {}) {
    this.config = {
      // OpenAI Configuration
      openaiApiKey: config.openaiApiKey || process.env.OPENAI_API_KEY,
      openaiOrganization: config.openaiOrganization || process.env.OPENAI_ORG_ID,
      openaiModel: config.openaiModel || 'gpt-4',
      
      // Hugging Face Configuration
      hfApiKey: config.hfApiKey || process.env.HUGGINGFACE_API_KEY,
      
      // TensorFlow Configuration
      tfModelPath: config.tfModelPath || './models',
      
      // Redis Configuration for caching
      redisUrl: config.redisUrl || process.env.REDIS_URL,
      
      // Rate limiting
      rateLimit: {
        openai: config.rateLimit?.openai || 1000,
        hf: config.rateLimit?.hf || 100,
        self: config.rateLimit?.self || 10000,
      },
      
      // Default parameters
      defaultTemperature: config.defaultTemperature || 0.7,
      defaultMaxTokens: config.defaultMaxTokens || 1000,
      
      // NLP Configuration
      nlpLanguages: config.nlpLanguages || ['en'],
      
      // Cache TTL (seconds)
      cacheTtl: config.cacheTtl || 3600,
      
      // Job Portal specific
      industryKeywords: config.industryKeywords || require('./industry-keywords.json'),
      skillDatabase: config.skillDatabase || require('./skills-database.json'),
      jobCategories: config.jobCategories || require('./job-categories.json'),
    };

    // Initialize services
    this.initializeServices();
    
    // Initialize cache
    this.initializeCache();
    
    // Load ML models
    this.loadModels();
    
    // Initialize NLP manager
    this.nlpManager = new NlpManager({
      languages: this.config.nlpLanguages,
      nlu: { useNoneFeature: false },
    });
  }

  async initializeServices() {
    // OpenAI
    if (this.config.openaiApiKey) {
      const configuration = new Configuration({
        organization: this.config.openaiOrganization,
        apiKey: this.config.openaiApiKey,
      });
      this.openai = new OpenAIApi(configuration);
    }

    // Hugging Face
    if (this.config.hfApiKey) {
      this.hf = new HfInference(this.config.hfApiKey);
    }

    // TensorFlow
    this.tf = tf;

    // Natural NLP
    this.natural = {
      tokenizer: new natural.WordTokenizer(),
      stemmer: natural.PorterStemmer,
      tfidf: new natural.TfIdf(),
      sentiment: new natural.SentimentAnalyzer(),
      classifier: new natural.BayesClassifier(),
    };

    // Initialize rate limit counters
    this.rateLimits = {
      openai: { count: 0, resetTime: Date.now() },
      hf: { count: 0, resetTime: Date.now() },
      self: { count: 0, resetTime: Date.now() },
    };
  }

  async initializeCache() {
    if (this.config.redisUrl) {
      this.cache = new Redis(this.config.redisUrl);
      this.cache.on('error', (err) => {
        console.error('Redis cache error:', err);
        this.cache = null;
      });
    } else {
      this.cache = new Map(); // Fallback to in-memory cache
    }
  }

  async loadModels() {
    try {
      // Load pre-trained models
      this.models = {
        // Resume parser model
        resumeParser: await this.loadOrDownloadModel('resume-parser'),
        
        // Job matcher model
        jobMatcher: await this.loadOrDownloadModel('job-matcher'),
        
        // Salary predictor model
        salaryPredictor: await this.loadOrDownloadModel('salary-predictor'),
        
        // Skill extractor model
        skillExtractor: await this.loadOrDownloadModel('skill-extractor'),
        
        // Sentiment analyzer model
        sentimentAnalyzer: await this.loadOrDownloadModel('sentiment-analyzer'),
      };
    } catch (error) {
      console.error('Failed to load models:', error);
      this.models = {};
    }
  }

  async loadOrDownloadModel(modelName) {
    const cacheKey = `model:${modelName}`;
    
    // Check cache
    if (this.cache instanceof Map) {
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
    } else if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    // Load or download model
    let model;
    switch (modelName) {
      case 'resume-parser':
        model = await this.downloadHFModel('resume-parser');
        break;
      case 'job-matcher':
        model = await this.trainJobMatcherModel();
        break;
      case 'salary-predictor':
        model = await this.trainSalaryPredictorModel();
        break;
      case 'skill-extractor':
        model = await this.downloadHFModel('skill-extractor');
        break;
      case 'sentiment-analyzer':
        model = await this.downloadHFModel('sentiment-analyzer');
        break;
      default:
        throw new Error(`Unknown model: ${modelName}`);
    }

    // Cache model
    if (this.cache instanceof Map) {
      this.cache.set(cacheKey, model);
    } else if (this.cache) {
      await this.cache.setex(cacheKey, this.config.cacheTtl * 24, JSON.stringify(model));
    }

    return model;
  }

  // RESUME PARSING AND ANALYSIS
  async parseResume(fileBuffer, fileType = 'pdf') {
    try {
      // Extract text from file
      const text = await this.extractTextFromFile(fileBuffer, fileType);
      
      // Generate cache key
      const cacheKey = `resume:${this.hashContent(text)}`;
      
      // Check cache
      const cached = await this.getFromCache(cacheKey);
      if (cached) return cached;

      // Parse resume using multiple methods
      const results = await Promise.allSettled([
        this.parseResumeWithOpenAI(text),
        this.parseResumeWithHF(text),
        this.parseResumeWithNLP(text),
      ]);

      // Combine results
      const parsedData = this.combineResumeResults(results, text);

      // Validate and normalize data
      const normalizedData = this.normalizeResumeData(parsedData);

      // Calculate scores and metrics
      const analysis = this.analyzeResume(normalizedData, text);

      const result = {
        success: true,
        data: normalizedData,
        analysis,
        rawText: text,
        confidence: this.calculateConfidence(results),
      };

      // Cache result
      await this.setToCache(cacheKey, result);

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        rawText: await this.extractTextFromFile(fileBuffer, fileType).catch(() => ''),
      };
    }
  }

  async parseResumeWithOpenAI(resumeText) {
    if (!this.openai) throw new Error('OpenAI not configured');

    const prompt = `
      Parse the following resume and extract structured information.
      Return JSON with these fields:
      - personal_info: { name, email, phone, location, linkedin, github, portfolio }
      - summary: string
      - work_experience: array of { company, title, location, start_date, end_date, description, achievements }
      - education: array of { institution, degree, field, location, start_date, end_date, gpa, honors }
      - skills: { technical: array, soft: array, tools: array, languages: array }
      - certifications: array of { name, issuer, date, credential_id }
      - projects: array of { name, description, technologies, url, role }
      - awards: array of { title, issuer, date, description }

      Resume text:
      ${resumeText.substring(0, 4000)}
    `;

    const response = await this.openai.createChatCompletion({
      model: this.config.openaiModel,
      messages: [
        { role: 'system', content: 'You are a resume parsing expert. Extract structured data from resumes.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    });

    return JSON.parse(response.data.choices[0].message.content);
  }

  async parseResumeWithHF(resumeText) {
    if (!this.hf) throw new Error('Hugging Face not configured');

    // Use Hugging Face model for resume parsing
    const response = await this.hf.fillMask({
      model: 'resume-parser',
      inputs: resumeText,
    });

    // Process HF response into structured format
    return this.processHFResumeResponse(response);
  }

  parseResumeWithNLP(resumeText) {
    // Use NLP techniques to parse resume
    const sentences = resumeText.split(/[.!?]+/);
    
    const result = {
      personal_info: this.extractPersonalInfo(resumeText),
      education: this.extractEducation(resumeText),
      skills: this.extractSkills(resumeText),
      experience: this.extractExperience(resumeText),
    };

    return result;
  }

  extractPersonalInfo(text) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
    const phoneRegex = /(\+\d{1,2}\s?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
    const linkedinRegex = /linkedin\.com\/in\/[a-zA-Z0-9-]+/gi;
    const githubRegex = /github\.com\/[a-zA-Z0-9-]+/gi;

    return {
      email: text.match(emailRegex)?.[0] || '',
      phone: text.match(phoneRegex)?.[0] || '',
      linkedin: text.match(linkedinRegex)?.[0] || '',
      github: text.match(githubRegex)?.[0] || '',
    };
  }

  extractEducation(text) {
    const educationKeywords = ['university', 'college', 'institute', 'school', 'bachelor', 'master', 'phd', 'degree'];
    const sentences = text.toLowerCase().split(/[.!?]+/);
    
    return sentences
      .filter(sentence => educationKeywords.some(keyword => sentence.includes(keyword)))
      .map(sentence => ({ institution: this.extractInstitution(sentence), description: sentence.trim() }));
  }

  extractSkills(text) {
    const normalizedSkills = new Set();
    const words = text.toLowerCase().split(/\W+/);
    
    // Check against skill database
    this.config.skillDatabase.forEach(skill => {
      if (text.toLowerCase().includes(skill.toLowerCase())) {
        normalizedSkills.add(skill);
      }
    });

    // Extract technical skills using patterns
    const skillPatterns = [
      /(?:proficient|experienced|skilled) in ([^,.]+)/gi,
      /(?:knowledge|experience) (?:of|in) ([^,.]+)/gi,
      /technologies?: ([^,.]+)/gi,
    ];

    skillPatterns.forEach(pattern => {
      const matches = text.matchAll(pattern);
      for (const match of matches) {
        const skills = match[1].split(/[,&]/).map(s => s.trim());
        skills.forEach(skill => {
          if (skill && skill.length > 2) {
            normalizedSkills.add(this.normalizeSkill(skill));
          }
        });
      }
    });

    return Array.from(normalizedSkills);
  }

  extractExperience(text) {
    const experiencePattern = /(?:worked at|employed at|experience at) ([^,]+) (?:as|from) ([^,.]+)/gi;
    const matches = [...text.matchAll(experiencePattern)];
    
    return matches.map(match => ({
      company: match[1].trim(),
      position: match[2].trim(),
    }));
  }

  // JOB MATCHING AND RECOMMENDATIONS
  async matchCandidateToJobs(candidateProfile, jobs, options = {}) {
    try {
      const {
        limit = 10,
        threshold = 0.6,
        weights = {
          skills: 0.4,
          experience: 0.3,
          education: 0.15,
          location: 0.1,
          salary: 0.05,
        },
      } = options;

      // Generate embeddings for candidate and jobs
      const candidateEmbedding = await this.generateEmbedding(
        this.createCandidateText(candidateProfile)
      );

      const jobEmbeddings = await Promise.all(
        jobs.map(async (job) => ({
          job,
          embedding: await this.generateEmbedding(this.createJobText(job)),
        }))
      );

      // Calculate similarity scores
      const scoredJobs = jobEmbeddings.map(({ job, embedding }) => {
        const similarity = this.calculateCosineSimilarity(candidateEmbedding, embedding);
        
        // Calculate weighted score
        const scores = {
          skills: this.calculateSkillMatch(candidateProfile.skills, job.requiredSkills),
          experience: this.calculateExperienceMatch(candidateProfile.experience, job.experienceRequired),
          education: this.calculateEducationMatch(candidateProfile.education, job.educationRequired),
          location: this.calculateLocationMatch(candidateProfile.location, job.location),
          salary: this.calculateSalaryMatch(candidateProfile.salaryExpectation, job.salaryRange),
        };

        const weightedScore = Object.entries(weights).reduce(
          (total, [key, weight]) => total + (scores[key] || 0) * weight,
          0
        );

        // Combine similarity and weighted score
        const finalScore = (similarity * 0.6 + weightedScore * 0.4);

        return {
          job,
          score: finalScore,
          similarity,
          breakdown: scores,
          matchReasons: this.generateMatchReasons(candidateProfile, job, scores),
          improvementSuggestions: this.generateImprovementSuggestions(candidateProfile, job, scores),
        };
      });

      // Sort and filter
      const matchedJobs = scoredJobs
        .filter(job => job.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // Generate insights
      const insights = this.generateMatchingInsights(candidateProfile, matchedJobs);

      return {
        success: true,
        matches: matchedJobs,
        insights,
        totalJobs: jobs.length,
        matchedCount: matchedJobs.length,
        candidateSummary: this.createCandidateSummary(candidateProfile),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        matches: [],
      };
    }
  }

  async matchJobToCandidates(job, candidates, options = {}) {
    try {
      const {
        limit = 20,
        threshold = 0.6,
      } = options;

      // Generate job embedding
      const jobEmbedding = await this.generateEmbedding(this.createJobText(job));

      // Score candidates
      const scoredCandidates = await Promise.all(
        candidates.map(async (candidate) => {
          const candidateEmbedding = await this.generateEmbedding(
            this.createCandidateText(candidate)
          );

          const similarity = this.calculateCosineSimilarity(jobEmbedding, candidateEmbedding);
          
          const scores = {
            skills: this.calculateSkillMatch(candidate.skills, job.requiredSkills),
            experience: this.calculateExperienceMatch(candidate.experience, job.experienceRequired),
            education: this.calculateEducationMatch(candidate.education, job.educationRequired),
            location: this.calculateLocationMatch(candidate.location, job.location),
          };

          const weightedScore = Object.entries({
            skills: 0.4,
            experience: 0.3,
            education: 0.2,
            location: 0.1,
          }).reduce((total, [key, weight]) => total + (scores[key] || 0) * weight, 0);

          const finalScore = (similarity * 0.5 + weightedScore * 0.5);

          return {
            candidate,
            score: finalScore,
            similarity,
            breakdown: scores,
            matchReasons: this.generateCandidateMatchReasons(candidate, job, scores),
            ranking: this.calculateCandidateRanking(candidate, job),
          };
        })
      );

      // Sort and filter
      const matchedCandidates = scoredCandidates
        .filter(c => c.score >= threshold)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);

      // Generate diversity metrics
      const diversity = this.calculateDiversityMetrics(matchedCandidates);

      return {
        success: true,
        matches: matchedCandidates,
        diversity,
        totalCandidates: candidates.length,
        matchedCount: matchedCandidates.length,
        jobSummary: this.createJobSummary(job),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        matches: [],
      };
    }
  }

  // SKILL ANALYSIS AND EXTRACTION
  async analyzeSkills(text, options = {}) {
    const {
      extractLevels = true,
      normalize = true,
      categorize = true,
    } = options;

    // Generate cache key
    const cacheKey = `skills:${this.hashContent(text)}`;

    // Check cache
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    // Extract skills using multiple methods
    const extractedSkills = await Promise.all([
      this.extractSkillsWithOpenAI(text),
      this.extractSkillsWithHF(text),
      this.extractSkillsWithPatterns(text),
    ]);

    // Combine and deduplicate
    const allSkills = extractedSkills.flat().filter(Boolean);
    const uniqueSkills = [...new Set(allSkills)];

    // Normalize skills
    const normalizedSkills = normalize ? 
      uniqueSkills.map(skill => this.normalizeSkill(skill)) : 
      uniqueSkills;

    // Categorize skills
    const categorizedSkills = categorize ? 
      this.categorizeSkills(normalizedSkills) : 
      { all: normalizedSkills };

    // Extract skill levels if requested
    const skillLevels = extractLevels ? 
      this.extractSkillLevels(text, normalizedSkills) : 
      {};

    // Calculate skill metrics
    const metrics = this.calculateSkillMetrics(normalizedSkills, text);

    const result = {
      success: true,
      skills: normalizedSkills,
      categorized: categorizedSkills,
      levels: skillLevels,
      metrics,
      confidence: this.calculateSkillConfidence(extractedSkills),
    };

    // Cache result
    await this.setToCache(cacheKey, result);

    return result;
  }

  async extractSkillsWithOpenAI(text) {
    if (!this.openai) return [];

    const prompt = `
      Extract all technical and professional skills mentioned in the following text.
      Return only a JSON array of skill names.
      
      Text: ${text.substring(0, 3000)}
    `;

    try {
      const response = await this.openai.createChatCompletion({
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'system', content: 'You are a skill extraction expert. Extract skill names from text.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 500,
      });

      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      console.error('OpenAI skill extraction failed:', error);
      return [];
    }
  }

  async extractSkillsWithHF(text) {
    if (!this.hf) return [];

    try {
      const response = await this.hf.tokenClassification({
        model: 'dslim/bert-base-NER',
        inputs: text,
      });

      // Filter for skill-related entities
      return response
        .filter(entity => ['SKILL', 'TECH', 'PROGRAMMING'].includes(entity.entity_group))
        .map(entity => entity.word);
    } catch (error) {
      console.error('HF skill extraction failed:', error);
      return [];
    }
  }

  categorizeSkills(skills) {
    const categories = {
      programming: [],
      frameworks: [],
      databases: [],
      tools: [],
      cloud: [],
      methodologies: [],
      soft: [],
      languages: [],
      domain: [],
    };

    const skillPatterns = {
      programming: /\b(javascript|python|java|c\+\+|c#|php|ruby|go|rust|swift|kotlin|typescript)\b/i,
      frameworks: /\b(react|angular|vue|node\.js|express|django|flask|spring|laravel|rails)\b/i,
      databases: /\b(mysql|postgresql|mongodb|redis|elasticsearch|oracle|sql server)\b/i,
      cloud: /\b(aws|azure|gcp|docker|kubernetes|terraform|ansible)\b/i,
      methodologies: /\b(agile|scrum|kanban|devops|ci\/cd|tdd|bdd)\b/i,
    };

    skills.forEach(skill => {
      let categorized = false;
      
      for (const [category, pattern] of Object.entries(skillPatterns)) {
        if (pattern.test(skill)) {
          categories[category].push(skill);
          categorized = true;
          break;
        }
      }

      if (!categorized) {
        // Check against skill database
        const skillData = this.config.skillDatabase.find(s => 
          s.name.toLowerCase() === skill.toLowerCase()
        );

        if (skillData) {
          categories[skillData.category || 'domain'].push(skill);
        } else {
          categories.domain.push(skill);
        }
      }
    });

    return categories;
  }

  // INTERVIEW QUESTION GENERATION
  async generateInterviewQuestions(candidate, job, options = {}) {
    const {
      count = 10,
      difficulty = 'mixed',
      types = ['technical', 'behavioral', 'situational'],
      focusAreas = [],
    } = options;

    const cacheKey = `questions:${this.hashContent(JSON.stringify({ candidate: candidate.id, job: job.id }))}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    // Generate questions based on candidate profile and job requirements
    const prompt = `
      Generate ${count} interview questions for a candidate applying for this position:
      
      Job Title: ${job.title}
      Job Description: ${job.description.substring(0, 2000)}
      Required Skills: ${job.requiredSkills.join(', ')}
      
      Candidate Profile:
      - Skills: ${candidate.skills.join(', ')}
      - Experience: ${candidate.experience} years
      - Education: ${candidate.education}
      
      Generate questions of these types: ${types.join(', ')}
      Difficulty level: ${difficulty}
      Focus areas: ${focusAreas.join(', ') || 'general'}
      
      Return JSON array with each question having:
      - text: The question
      - type: Question type
      - difficulty: easy/medium/hard
      - skill: Related skill
      - purpose: What this question assesses
      - sampleAnswer: Example of a good answer
      - evaluationCriteria: How to evaluate the answer
    `;

    try {
      const response = await this.openai.createChatCompletion({
        model: this.config.openaiModel,
        messages: [
          { role: 'system', content: 'You are an expert interview coach. Generate relevant interview questions.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 3000,
      });

      const questions = JSON.parse(response.data.choices[0].message.content);

      // Add follow-up questions
      const questionsWithFollowups = questions.map(q => ({
        ...q,
        followUpQuestions: this.generateFollowUpQuestions(q),
        scoringRubric: this.generateScoringRubric(q),
      }));

      // Group by type and difficulty
      const groupedQuestions = this.groupQuestions(questionsWithFollowups);

      const result = {
        success: true,
        questions: questionsWithFollowups,
        grouped: groupedQuestions,
        summary: this.generateQuestionSummary(questionsWithFollowups),
        interviewPlan: this.generateInterviewPlan(questionsWithFollowups, options),
      };

      await this.setToCache(cacheKey, result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        questions: [],
      };
    }
  }

  async evaluateInterviewAnswer(question, answer, candidateProfile) {
    try {
      const prompt = `
        Evaluate this interview answer:
        
        Question: ${question.text}
        Question Type: ${question.type}
        Question Purpose: ${question.purpose}
        
        Candidate Answer: ${answer}
        
        Candidate Background:
        - Experience: ${candidateProfile.experience} years
        - Skills: ${candidateProfile.skills.join(', ')}
        
        Evaluate on a scale of 1-10 considering:
        1. Relevance to question
        2. Depth of knowledge
        3. Clarity and structure
        4. Examples provided
        5. Confidence level
        
        Return JSON with:
        - score: number (1-10)
        - strengths: array of strengths
        - weaknesses: array of areas for improvement
        - feedback: constructive feedback
        - followUpQuestions: suggested follow-up questions
        - confidence: confidence in evaluation (0-1)
      `;

      const response = await this.openai.createChatCompletion({
        model: 'gpt-4',
        messages: [
          { role: 'system', content: 'You are an expert interview evaluator. Evaluate answers objectively.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.3,
        max_tokens: 1000,
      });

      return JSON.parse(response.data.choices[0].message.content);
    } catch (error) {
      return {
        success: false,
        error: error.message,
        score: 0,
        feedback: 'Unable to evaluate answer.',
      };
    }
  }

  // SENTIMENT ANALYSIS
  async analyzeSentiment(text, options = {}) {
    const {
      detailed = true,
      detectEmotions = true,
      extractTopics = true,
    } = options;

    const cacheKey = `sentiment:${this.hashContent(text)}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    // Multiple sentiment analysis methods
    const results = await Promise.all([
      this.analyzeSentimentWithOpenAI(text),
      this.analyzeSentimentWithHF(text),
      this.analyzeSentimentWithNLP(text),
    ]);

    // Combine results
    const combined = this.combineSentimentResults(results);

    // Extract emotions if requested
    const emotions = detectEmotions ? 
      await this.detectEmotions(text) : 
      {};

    // Extract topics if requested
    const topics = extractTopics ? 
      await this.extractTopics(text) : 
      [];

    const result = {
      success: true,
      sentiment: combined.sentiment,
      score: combined.score,
      confidence: combined.confidence,
      emotions,
      topics,
      detailedAnalysis: detailed ? this.generateDetailedSentimentAnalysis(text, combined) : null,
      language: this.detectLanguage(text),
    };

    await this.setToCache(cacheKey, result);
    return result;
  }

  async analyzeSentimentWithOpenAI(text) {
    if (!this.openai) return null;

    const prompt = `
      Analyze the sentiment of this text. Return JSON with:
      - sentiment: positive/negative/neutral/mixed
      - score: -1 to 1
      - confidence: 0 to 1
      - keyPhrases: array of key phrases that influenced sentiment
      - intensity: low/medium/high
      
      Text: ${text.substring(0, 2000)}
    `;

    const response = await this.openai.createChatCompletion({
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'system', content: 'You are a sentiment analysis expert.' },
        { role: 'user', content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 500,
    });

    return JSON.parse(response.data.choices[0].message.content);
  }

  async analyzeSentimentWithHF(text) {
    if (!this.hf) return null;

    try {
      const response = await this.hf.textClassification({
        model: 'distilbert-base-uncased-finetuned-sst-2-english',
        inputs: text,
      });

      return {
        sentiment: response[0].label.toLowerCase(),
        score: response[0].score,
        confidence: response[0].score,
      };
    } catch (error) {
      console.error('HF sentiment analysis failed:', error);
      return null;
    }
  }

  // CHATBOT SYSTEM
  async initializeChatbot() {
    // Train NLP manager with job portal intents
    await this.trainChatbotModel();
    
    return {
      process: async (message, context = {}) => {
        return await this.processChatMessage(message, context);
      },
      train: async (data) => {
        return await this.trainChatbotWithData(data);
      },
      getContext: () => this.chatbotContext,
      reset: () => this.resetChatbotContext(),
    };
  }

  async trainChatbotModel() {
    // Add job portal specific intents
    this.nlpManager.addDocument('en', 'How do I apply for a job?', 'job.application');
    this.nlpManager.addDocument('en', 'I want to apply for a position', 'job.application');
    this.nlpManager.addDocument('en', 'How to submit my application?', 'job.application');
    
    this.nlpManager.addDocument('en', 'What is the salary range?', 'job.salary');
    this.nlpManager.addDocument('en', 'How much does this job pay?', 'job.salary');
    
    this.nlpManager.addDocument('en', 'What skills are required?', 'job.requirements');
    this.nlpManager.addDocument('en', 'What are the job requirements?', 'job.requirements');
    
    this.nlpManager.addDocument('en', 'Update my profile', 'profile.update');
    this.nlpManager.addDocument('en', 'Edit my resume', 'profile.update');
    
    this.nlpManager.addDocument('en', 'Check application status', 'application.status');
    this.nlpManager.addDocument('en', 'Where is my application?', 'application.status');
    
    this.nlpManager.addDocument('en', 'Help with interview', 'interview.help');
    this.nlpManager.addDocument('en', 'Prepare for interview', 'interview.help');
    
    // Add responses
    this.nlpManager.addAnswer('en', 'job.application', 
      'To apply for a job: 1. Find a job you like 2. Click "Apply Now" 3. Fill the application form 4. Submit your resume 5. Complete any assessments if required.');
    
    this.nlpManager.addAnswer('en', 'job.salary',
      'Salary information is usually listed in the job description. If not specified, you can discuss it during the interview process.');
    
    this.nlpManager.addAnswer('en', 'job.requirements',
      'Job requirements are listed in the job description. They typically include required skills, experience, education, and sometimes specific certifications.');
    
    this.nlpManager.addAnswer('en', 'profile.update',
      'You can update your profile by going to your dashboard > Profile > Edit. Make sure to save your changes.');
    
    this.nlpManager.addAnswer('en', 'application.status',
      'You can check your application status in the "My Applications" section of your dashboard. Status updates are also sent via email.');
    
    this.nlpManager.addAnswer('en', 'interview.help',
      'We offer interview preparation resources including common questions, tips, and mock interviews. Check the "Career Resources" section.');

    // Train the model
    await this.nlpManager.train();
    this.nlpManager.save();
  }

  async processChatMessage(message, context = {}) {
    try {
      // Process with NLP manager
      const nlpResult = await this.nlpManager.process('en', message);
      
      // If confident intent detected
      if (nlpResult.intent && nlpResult.score > 0.7) {
        return {
          type: 'intent',
          intent: nlpResult.intent,
          answer: nlpResult.answer,
          confidence: nlpResult.score,
          entities: nlpResult.entities,
          followUp: this.generateFollowUpQuestions(nlpResult.intent),
        };
      }

      // Fallback to OpenAI for complex queries
      if (this.openai) {
        const response = await this.openai.createChatCompletion({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `You are a helpful job portal assistant. Context: ${JSON.stringify(context)}`,
            },
            { role: 'user', content: message },
          ],
          temperature: 0.7,
          max_tokens: 500,
        });

        return {
          type: 'ai',
          answer: response.data.choices[0].message.content,
          confidence: 0.9,
          source: 'openai',
        };
      }

      // Default response
      return {
        type: 'default',
        answer: 'I understand you\'re asking about our job portal. Can you please provide more details or rephrase your question?',
        confidence: 0.5,
      };
    } catch (error) {
      return {
        type: 'error',
        answer: 'I apologize, but I\'m having trouble processing your request. Please try again or contact our support team.',
        error: error.message,
      };
    }
  }

  // SALARY PREDICTION
  async predictSalary(features, options = {}) {
    const {
      location,
      experience,
      skills,
      education,
      jobTitle,
      industry,
      companySize,
    } = features;

    const cacheKey = `salary:${this.hashContent(JSON.stringify(features))}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      // Multiple prediction methods
      const predictions = await Promise.all([
        this.predictSalaryWithModel(features),
        this.predictSalaryWithMarketData(features),
        this.predictSalaryWithComparables(features),
      ]);

      // Combine predictions
      const combined = this.combineSalaryPredictions(predictions);

      // Add confidence interval
      const confidenceInterval = this.calculateSalaryConfidence(features, combined);

      // Generate explanation
      const explanation = this.generateSalaryExplanation(features, combined);

      const result = {
        success: true,
        predictedSalary: combined,
        confidence: confidenceInterval.confidence,
        range: {
          low: confidenceInterval.low,
          high: confidenceInterval.high,
        },
        breakdown: this.breakdownSalaryFactors(features, combined),
        explanation,
        marketComparison: this.compareToMarket(features, combined),
        negotiationTips: this.generateNegotiationTips(features, combined),
      };

      await this.setToCache(cacheKey, result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        predictedSalary: null,
      };
    }
  }

  // JOB DESCRIPTION GENERATION
  async generateJobDescription(template, variables = {}) {
    const {
      title,
      company,
      location,
      responsibilities = [],
      requirements = [],
      benefits = [],
      aboutCompany = '',
    } = variables;

    const cacheKey = `jd:${this.hashContent(JSON.stringify(variables))}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const prompt = `
        Generate a professional job description based on these details:
        
        Job Title: ${title}
        Company: ${company}
        Location: ${location}
        
        Key Responsibilities:
        ${responsibilities.join('\n')}
        
        Requirements:
        ${requirements.join('\n')}
        
        Benefits:
        ${benefits.join('\n')}
        
        About Company: ${aboutCompany}
        
        Generate a complete job description with:
        1. Compelling introduction
        2. Detailed responsibilities
        3. Clear requirements (separate required vs preferred)
        4. Company overview
        5. Benefits and perks
        6. Application instructions
        
        Make it engaging and professional.
      `;

      const response = await this.openai.createChatCompletion({
        model: this.config.openaiModel,
        messages: [
          { role: 'system', content: 'You are an expert HR professional who writes compelling job descriptions.' },
          { role: 'user', content: prompt },
        ],
        temperature: 0.7,
        max_tokens: 2000,
      });

      const description = response.data.choices[0].message.content;

      // Analyze generated description
      const analysis = await this.analyzeJobDescription(description);

      const result = {
        success: true,
        description,
        analysis,
        seoKeywords: this.extractSEOKeywords(description),
        readabilityScore: this.calculateReadability(description),
        inclusivityScore: this.checkInclusivity(description),
        suggestions: this.suggestJobDescriptionImprovements(description),
      };

      await this.setToCache(cacheKey, result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        description: '',
      };
    }
  }

  // PLAGIARISM DETECTION
  async detectPlagiarism(text, sources = [], options = {}) {
    const {
      threshold = 0.8,
      checkDatabase = true,
      checkInternet = false,
    } = options;

    try {
      // Generate text embedding
      const textEmbedding = await this.generateEmbedding(text);
      
      // Compare with source embeddings
      const sourceComparisons = await Promise.all(
        sources.map(async (source) => {
          const sourceEmbedding = await this.generateEmbedding(source.text);
          const similarity = this.calculateCosineSimilarity(textEmbedding, sourceEmbedding);
          
          return {
            source: source.id || source.url,
            similarity,
            matchingText: this.findMatchingText(text, source.text),
            percentage: similarity * 100,
          };
        })
      );

      // Check against internal database if enabled
      let databaseMatches = [];
      if (checkDatabase) {
        databaseMatches = await this.checkAgainstDatabase(text);
      }

      // Check internet if enabled (requires external API)
      let internetMatches = [];
      if (checkInternet) {
        internetMatches = await this.checkAgainstInternet(text);
      }

      // Calculate overall score
      const allMatches = [...sourceComparisons, ...databaseMatches, ...internetMatches];
      const maxSimilarity = allMatches.length > 0 ? 
        Math.max(...allMatches.map(m => m.similarity)) : 0;

      const result = {
        success: true,
        originalLength: text.length,
        plagiarismScore: maxSimilarity,
        isPlagiarized: maxSimilarity >= threshold,
        matches: allMatches.filter(m => m.similarity >= 0.3),
        summary: {
          totalMatches: allMatches.length,
          highMatches: allMatches.filter(m => m.similarity >= 0.7).length,
          mediumMatches: allMatches.filter(m => m.similarity >= 0.4 && m.similarity < 0.7).length,
          lowMatches: allMatches.filter(m => m.similarity >= 0.3 && m.similarity < 0.4).length,
        },
        originalityPercentage: (1 - maxSimilarity) * 100,
        recommendations: this.generatePlagiarismRecommendations(allMatches),
      };

      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        plagiarismScore: 0,
        matches: [],
      };
    }
  }

  // AUTOMATED SCREENING
  async screenCandidate(candidate, job, options = {}) {
    const {
      strictMode = false,
      weightSkills = 0.4,
      weightExperience = 0.3,
      weightEducation = 0.2,
      weightOther = 0.1,
    } = options;

    try {
      // Multiple screening criteria
      const criteria = await Promise.all([
        this.screenBySkills(candidate, job, strictMode),
        this.screenByExperience(candidate, job, strictMode),
        this.screenByEducation(candidate, job, strictMode),
        this.screenByLocation(candidate, job),
        this.screenBySalary(candidate, job),
        this.screenByAvailability(candidate, job),
      ]);

      // Calculate overall score
      const scores = {
        skills: criteria[0].score * weightSkills,
        experience: criteria[1].score * weightExperience,
        education: criteria[2].score * weightEducation,
        location: criteria[3].score * (weightOther / 3),
        salary: criteria[4].score * (weightOther / 3),
        availability: criteria[5].score * (weightOther / 3),
      };

      const overallScore = Object.values(scores).reduce((a, b) => a + b, 0);
      const isQualified = overallScore >= (strictMode ? 0.8 : 0.6);

      // Generate detailed report
      const report = {
        candidate: {
          id: candidate.id,
          name: candidate.name,
          summary: this.createCandidateSummary(candidate),
        },
        job: {
          id: job.id,
          title: job.title,
          requirements: job.requirements,
        },
        screening: {
          overallScore,
          isQualified,
          strictMode,
          criteria: criteria.map((c, i) => ({
            name: ['skills', 'experience', 'education', 'location', 'salary', 'availability'][i],
            ...c,
          })),
          scores,
        },
        strengths: this.identifyCandidateStrengths(candidate, job, criteria),
        weaknesses: this.identifyCandidateWeaknesses(candidate, job, criteria),
        recommendations: this.generateScreeningRecommendations(candidate, job, criteria, isQualified),
        nextSteps: this.suggestNextSteps(candidate, job, isQualified),
      };

      return {
        success: true,
        report,
        decision: isQualified ? 'QUALIFIED' : 'NOT_QUALIFIED',
        confidence: this.calculateScreeningConfidence(criteria),
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        report: null,
        decision: 'ERROR',
      };
    }
  }

  // TEXT GENERATION UTILITIES
  async generateText(prompt, options = {}) {
    const {
      model = this.config.openaiModel,
      temperature = this.config.defaultTemperature,
      maxTokens = this.config.defaultMaxTokens,
      systemPrompt = 'You are a helpful AI assistant.',
      format = 'text',
    } = options;

    const cacheKey = `textgen:${this.hashContent(prompt + JSON.stringify(options))}`;
    const cached = await this.getFromCache(cacheKey);
    if (cached) return cached;

    try {
      const response = await this.openai.createChatCompletion({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        temperature,
        max_tokens: maxTokens,
      });

      let content = response.data.choices[0].message.content;

      // Format based on requested format
      if (format === 'json') {
        try {
          content = JSON.parse(content);
        } catch {
          // If JSON parsing fails, return as text
        }
      }

      const result = {
        success: true,
        content,
        usage: response.data.usage,
        model: response.data.model,
        finishReason: response.data.choices[0].finish_reason,
      };

      await this.setToCache(cacheKey, result);
      return result;
    } catch (error) {
      return {
        success: false,
        error: error.message,
        content: '',
      };
    }
  }

  // EMBEDDING GENERATION
  async generateEmbedding(text, model = 'text-embedding-ada-002') {
    const cacheKey = `embedding:${this.hashContent(text)}:${model}`;
    
    if (this.cache instanceof Map) {
      if (this.cache.has(cacheKey)) {
        return this.cache.get(cacheKey);
      }
    } else if (this.cache) {
      const cached = await this.cache.get(cacheKey);
      if (cached) return JSON.parse(cached);
    }

    let embedding;
    
    if (model.startsWith('text-embedding')) {
      // Use OpenAI embeddings
      const response = await this.openai.createEmbedding({
        model,
        input: text,
      });
      embedding = response.data.data[0].embedding;
    } else {
      // Use Hugging Face embeddings
      const response = await this.hf.featureExtraction({
        model,
        inputs: text,
      });
      embedding = Array.isArray(response) ? response : response[0];
    }

    // Cache embedding
    if (this.cache instanceof Map) {
      this.cache.set(cacheKey, embedding);
    } else if (this.cache) {
      await this.cache.setex(cacheKey, this.config.cacheTtl, JSON.stringify(embedding));
    }

    return embedding;
  }

  // HELPER METHODS
  async getFromCache(key) {
    if (this.cache instanceof Map) {
      return this.cache.get(key);
    } else if (this.cache) {
      const cached = await this.cache.get(key);
      return cached ? JSON.parse(cached) : null;
    }
    return null;
  }

  async setToCache(key, value, ttl = this.config.cacheTtl) {
    if (this.cache instanceof Map) {
      this.cache.set(key, value);
    } else if (this.cache) {
      await this.cache.setex(key, ttl, JSON.stringify(value));
    }
  }

  hashContent(content) {
    return crypto.createHash('sha256').update(content).digest('hex');
  }

  calculateCosineSimilarity(vectorA, vectorB) {
    if (!vectorA || !vectorB || vectorA.length !== vectorB.length) {
      return 0;
    }

    const dotProduct = vectorA.reduce((sum, a, i) => sum + a * vectorB[i], 0);
    const magnitudeA = Math.sqrt(vectorA.reduce((sum, a) => sum + a * a, 0));
    const magnitudeB = Math.sqrt(vectorB.reduce((sum, b) => sum + b * b, 0));

    if (magnitudeA === 0 || magnitudeB === 0) return 0;
    
    return dotProduct / (magnitudeA * magnitudeB);
  }

  async extractTextFromFile(buffer, fileType) {
    switch (fileType.toLowerCase()) {
      case 'pdf':
        const pdfData = await pdfParse(buffer);
        return pdfData.text;
      
      case 'docx':
        const docxData = await mammoth.extractRawText({ buffer });
        return docxData.value;
      
      case 'txt':
        return buffer.toString('utf-8');
      
      case 'html':
        // Strip HTML tags
        return buffer.toString('utf-8').replace(/<[^>]*>/g, ' ');
      
      default:
        throw new Error(`Unsupported file type: ${fileType}`);
    }
  }

  // RATE LIMITING
  checkRateLimit(service) {
    const limit = this.rateLimits[service];
    if (!limit) return true;

    const now = Date.now();
    const hourAgo = now - 3600000;

    if (limit.resetTime < hourAgo) {
      // Reset counter if more than an hour has passed
      limit.count = 0;
      limit.resetTime = now;
    }

    if (limit.count >= this.config.rateLimit[service]) {
      return false;
    }

    limit.count++;
    return true;
  }

  // MODEL TRAINING
  async trainJobMatcherModel() {
    // Load training data
    const trainingData = await this.loadTrainingData('job-matches');
    
    // Create and train model
    const model = tf.sequential();
    
    model.add(tf.layers.dense({
      units: 128,
      activation: 'relu',
      inputShape: [trainingData.inputShape],
    }));
    
    model.add(tf.layers.dropout({ rate: 0.2 }));
    model.add(tf.layers.dense({ units: 64, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1, activation: 'sigmoid' }));
    
    model.compile({
      optimizer: 'adam',
      loss: 'binaryCrossentropy',
      metrics: ['accuracy'],
    });
    
    await model.fit(
      trainingData.features,
      trainingData.labels,
      {
        epochs: 10,
        batchSize: 32,
        validationSplit: 0.2,
      }
    );
    
    return model;
  }

  async trainSalaryPredictorModel() {
    // Similar implementation for salary prediction
    const trainingData = await this.loadTrainingData('salaries');
    
    const model = tf.sequential();
    model.add(tf.layers.dense({ units: 64, activation: 'relu', inputShape: [trainingData.inputShape] }));
    model.add(tf.layers.dense({ units: 32, activation: 'relu' }));
    model.add(tf.layers.dense({ units: 1 }));
    
    model.compile({
      optimizer: 'adam',
      loss: 'meanSquaredError',
      metrics: ['mse'],
    });
    
    await model.fit(
      trainingData.features,
      trainingData.labels,
      {
        epochs: 20,
        batchSize: 16,
        validationSplit: 0.2,
      }
    );
    
    return model;
  }

  // BATCH PROCESSING
  async processBatch(items, processor, options = {}) {
    const {
      batchSize = 10,
      parallel = true,
      progressCallback,
    } = options;

    const results = [];
    const errors = [];

    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      
      if (progressCallback) {
        progressCallback({
          total: items.length,
          processed: i,
          currentBatch: batch.length,
        });
      }

      if (parallel) {
        const batchPromises = batch.map((item, index) =>
          processor(item).catch(error => ({
            error: error.message,
            item,
            index: i + index,
          }))
        );

        const batchResults = await Promise.allSettled(batchPromises);
        
        batchResults.forEach((result, index) => {
          if (result.status === 'fulfilled') {
            results.push(result.value);
          } else {
            errors.push({
              item: batch[index],
              error: result.reason,
              index: i + index,
            });
          }
        });
      } else {
        // Sequential processing
        for (const item of batch) {
          try {
            const result = await processor(item);
            results.push(result);
          } catch (error) {
            errors.push({
              item,
              error: error.message,
            });
          }
        }
      }

      // Rate limiting delay
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    return {
      success: true,
      total: items.length,
      processed: results.length,
      failed: errors.length,
      results,
      errors,
      summary: {
        successRate: results.length / items.length,
        failureRate: errors.length / items.length,
      },
    };
  }

  // EXPORT AND IMPORT MODELS
  async exportModel(modelName, format = 'json') {
    const model = this.models[modelName];
    if (!model) {
      throw new Error(`Model not found: ${modelName}`);
    }

    switch (format) {
      case 'json':
        return await model.save(`localstorage://${modelName}`);
      
      case 'tensorflowjs':
        return await model.save(`downloads://${modelName}`);
      
      case 'weights':
        const weights = await model.getWeights();
        return weights.map(w => w.arraySync());
      
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  async importModel(modelName, data, format = 'json') {
    let model;
    
    switch (format) {
      case 'json':
        model = await tf.loadLayersModel(`localstorage://${modelName}`);
        break;
      
      case 'tensorflowjs':
        model = await tf.loadLayersModel(data);
        break;
      
      case 'weights':
        // Reconstruct model from weights
        model = this.createModelArchitecture(modelName);
        model.setWeights(data.map(w => tf.tensor(w)));
        break;
      
      default:
        throw new Error(`Unsupported import format: ${format}`);
    }

    this.models[modelName] = model;
    return model;
  }

  // MONITORING AND METRICS
  getMetrics() {
    return {
      apiCalls: {
        openai: this.rateLimits.openai.count,
        hf: this.rateLimits.hf.count,
        self: this.rateLimits.self.count,
      },
      cache: {
        size: this.cache instanceof Map ? this.cache.size : 'unknown',
        hits: this.cacheHits || 0,
        misses: this.cacheMisses || 0,
      },
      models: Object.keys(this.models).length,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      requests: this.requestCount || 0,
    };
  }

  // ERROR HANDLING
  handleAIError(error, context = {}) {
    console.error('AI Service Error:', {
      error: error.message,
      stack: error.stack,
      context,
      timestamp: new Date().toISOString(),
    });

    // Log to monitoring service
    // this.logToMonitoringService(error, context);

    // Return user-friendly error
    return {
      success: false,
      error: 'AI processing failed',
      message: 'We encountered an issue processing your request. Please try again.',
      code: 'AI_SERVICE_ERROR',
      timestamp: new Date().toISOString(),
      requestId: context.requestId,
    };
  }

  // CLEANUP
  async cleanup() {
    // Dispose TensorFlow models
    Object.values(this.models).forEach(model => {
      if (model.dispose) model.dispose();
    });

    // Clear cache
    if (this.cache instanceof Map) {
      this.cache.clear();
    } else if (this.cache) {
      await this.cache.quit();
    }

    // Reset counters
    this.rateLimits = {
      openai: { count: 0, resetTime: Date.now() },
      hf: { count: 0, resetTime: Date.now() },
      self: { count: 0, resetTime: Date.now() },
    };
  }
}

// Middleware for AI integration
const createAIMiddleware = (aiService) => {
  return {
    // Resume upload and parsing
    parseResumeUpload: () => {
      return async (req, res, next) => {
        try {
          if (!req.file) {
            return res.status(400).json({
              error: 'NO_FILE',
              message: 'No resume file uploaded',
            });
          }

          const result = await aiService.parseResume(
            req.file.buffer,
            req.file.mimetype.split('/')[1]
          );

          if (!result.success) {
            return res.status(400).json(result);
          }

          req.parsedResume = result;
          next();
        } catch (error) {
          console.error('Resume parsing error:', error);
          res.status(500).json({
            error: 'RESUME_PARSE_ERROR',
            message: 'Failed to parse resume',
          });
        }
      };
    },

    // Job matching for candidate
    matchCandidateJobs: () => {
      return async (req, res, next) => {
        try {
          const candidate = req.user;
          const jobs = await getActiveJobs(); // Your database function

          const result = await aiService.matchCandidateToJobs(candidate, jobs, {
            limit: req.query.limit || 10,
            threshold: req.query.threshold || 0.6,
          });

          req.matchedJobs = result;
          next();
        } catch (error) {
          console.error('Job matching error:', error);
          res.status(500).json({
            error: 'JOB_MATCH_ERROR',
            message: 'Failed to match jobs',
          });
        }
      };
    },

    // Interview question generation
    generateInterviewQuestions: () => {
      return async (req, res, next) => {
        try {
          const { candidateId, jobId } = req.params;
          
          const candidate = await getCandidateById(candidateId);
          const job = await getJobById(jobId);

          const result = await aiService.generateInterviewQuestions(
            candidate,
            job,
            req.body.options || {}
          );

          req.interviewQuestions = result;
          next();
        } catch (error) {
          console.error('Question generation error:', error);
          res.status(500).json({
            error: 'QUESTION_GEN_ERROR',
            message: 'Failed to generate questions',
          });
        }
      };
    },

    // Sentiment analysis for reviews
    analyzeSentiment: () => {
      return async (req, res, next) => {
        try {
          const { text } = req.body;
          
          const result = await aiService.analyzeSentiment(text, req.body.options || {});

          req.sentimentAnalysis = result;
          next();
        } catch (error) {
          console.error('Sentiment analysis error:', error);
          res.status(500).json({
            error: 'SENTIMENT_ANALYSIS_ERROR',
            message: 'Failed to analyze sentiment',
          });
        }
      };
    },

    // Chatbot endpoint
    chatbot: () => {
      return async (req, res) => {
        try {
          const { message, context = {} } = req.body;
          
          const response = await aiService.processChatMessage(message, context);

          res.json({
            success: true,
            response,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Chatbot error:', error);
          res.status(500).json({
            success: false,
            error: 'CHATBOT_ERROR',
            message: 'Failed to process message',
          });
        }
      };
    },

    // Salary prediction
    predictSalary: () => {
      return async (req, res, next) => {
        try {
          const result = await aiService.predictSalary(req.body.features, req.body.options || {});

          req.salaryPrediction = result;
          next();
        } catch (error) {
          console.error('Salary prediction error:', error);
          res.status(500).json({
            error: 'SALARY_PREDICTION_ERROR',
            message: 'Failed to predict salary',
          });
        }
      };
    },

    // Plagiarism detection
    detectPlagiarism: () => {
      return async (req, res, next) => {
        try {
          const { text, sources = [] } = req.body;
          
          const result = await aiService.detectPlagiarism(text, sources, req.body.options || {});

          req.plagiarismResult = result;
          next();
        } catch (error) {
          console.error('Plagiarism detection error:', error);
          res.status(500).json({
            error: 'PLAGIARISM_DETECTION_ERROR',
            message: 'Failed to detect plagiarism',
          });
        }
      };
    },

    // Automated screening
    screenCandidate: () => {
      return async (req, res, next) => {
        try {
          const { candidateId, jobId } = req.params;
          
          const candidate = await getCandidateById(candidateId);
          const job = await getJobById(jobId);

          const result = await aiService.screenCandidate(
            candidate,
            job,
            req.body.options || {}
          );

          req.screeningResult = result;
          next();
        } catch (error) {
          console.error('Screening error:', error);
          res.status(500).json({
            error: 'SCREENING_ERROR',
            message: 'Failed to screen candidate',
          });
        }
      };
    },
  };
};

// Export utilities
module.exports = {
  AIService,
  createAIMiddleware,
  // Helper functions
  normalizeSkill: (skill) => {
    // Skill normalization logic
    return skill.trim().toLowerCase();
  },
  calculateMatchScore: (candidateSkills, jobSkills) => {
    // Match scoring logic
    const intersection = candidateSkills.filter(skill => 
      jobSkills.includes(skill)
    );
    return intersection.length / jobSkills.length;
  },
  generateEmbeddingKey: (text) => {
    return crypto.createHash('md5').update(text).digest('hex');
  },
};
