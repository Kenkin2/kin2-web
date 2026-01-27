const axios = require('axios');
const { PrismaClient } = require('@prisma/client');
const kfnService = require('../kfn/kfn.service');

const prisma = new PrismaClient();

class AIService {
  constructor() {
    this.provider = process.env.AI_PROVIDER || 'deepseek';
    this.apiKey = this.provider === 'deepseek' 
      ? process.env.DEEPSEEK_API_KEY 
      : process.env.OPENAI_API_KEY;
    
    this.apiUrl = this.provider === 'deepseek'
      ? 'https://api.deepseek.com/v1/chat/completions'
      : 'https://api.openai.com/v1/chat/completions';
    
    this.model = this.provider === 'deepseek'
      ? 'deepseek-chat'
      : 'gpt-4';
  }

  async screenResume(applicationId) {
    try {
      // Get application details
      const application = await prisma.application.findUnique({
        where: { id: applicationId },
        include: {
          job: {
            include: {
              requiredSkills: {
                include: { skill: true }
              },
              preferredSkills: {
                include: { skill: true }
              }
            }
          },
          applicant: {
            include: {
              profile: true,
              workerProfile: true,
              workerSkills: {
                include: { skill: true }
              },
              experience: true,
              education: true,
              certifications: true
            }
          }
        }
      });

      if (!application) {
        throw new Error('Application not found');
      }

      // Prepare resume text from worker profile
      const resumeText = this.prepareResumeText(application.applicant);
      
      // Prepare job description
      const jobDescription = this.prepareJobDescription(application.job);

      // Call AI API
      const analysis = await this.analyzeResume(resumeText, jobDescription);

      // Calculate KFN score
      const kfnScore = await kfnService.calculateKFN(
        application.applicantId,
        application.jobId
      );

      // Update application with AI analysis
      await prisma.application.update({
        where: { id: applicationId },
        data: {
          kfnScore: kfnScore.overallScore,
          aiAnalysis: {
            ...analysis,
            kfnScore
          },
          strengths: analysis.strengths || [],
          weaknesses: analysis.weaknesses || [],
          aiRecommendation: this.getRecommendationLevel(kfnScore.overallScore)
        }
      });

      // Save KFN calculation
      await prisma.kFNCalculation.create({
        data: {
          workerId: application.applicantId,
          jobId: application.jobId,
          applicationId: application.id,
          ...kfnScore
        }
      });

      return {
        success: true,
        analysis,
        kfnScore
      };
    } catch (error) {
      console.error('Screen resume error:', error);
      
      // Fallback to basic KFN calculation
      try {
        const kfnScore = await kfnService.calculateKFN(
          application.applicantId,
          application.jobId
        );

        await prisma.application.update({
          where: { id: applicationId },
          data: {
            kfnScore: kfnScore.overallScore,
            aiAnalysis: { error: error.message, fallback: true },
            aiRecommendation: this.getRecommendationLevel(kfnScore.overallScore)
          }
        });

        return {
          success: false,
          error: error.message,
          fallback: true,
          kfnScore
        };
      } catch (fallbackError) {
        console.error('Fallback error:', fallbackError);
        throw error;
      }
    }
  }

  async screenResumeText(resumeText, jobId) {
    try {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
          requiredSkills: {
            include: { skill: true }
          }
        }
      });

      if (!job) {
        throw new Error('Job not found');
      }

      const jobDescription = this.prepareJobDescription(job);
      const analysis = await this.analyzeResume(resumeText, jobDescription);

      return analysis;
    } catch (error) {
      console.error('Screen resume text error:', error);
      throw error;
    }
  }

  async matchJobsForWorker(workerId, limit = 10, forceRecalculate = false) {
    try {
      // Get worker profile and skills
      const worker = await prisma.user.findUnique({
        where: { id: workerId },
        include: {
          workerProfile: true,
          workerSkills: {
            include: { skill: true }
          },
          experience: true,
          education: true
        }
      });

      if (!worker || !worker.workerProfile) {
        throw new Error('Worker profile not found');
      }

      // Get published jobs
      const jobs = await prisma.job.findMany({
        where: {
          status: 'PUBLISHED',
          expirationDate: { gt: new Date() }
        },
        include: {
          employer: {
            include: { employerProfile: true }
          },
          category: true,
          requiredSkills: {
            include: { skill: true }
          },
          preferredSkills: {
            include: { skill: true }
          }
        },
        orderBy: { postedDate: 'desc' },
        take: 100 // Get more jobs to filter
      });

      // Calculate KFN scores for each job
      const jobsWithScores = await Promise.all(
        jobs.map(async (job) => {
          try {
            // Check if calculation already exists
            if (!forceRecalculate) {
              const existingCalculation = await prisma.kFNCalculation.findFirst({
                where: {
                  workerId,
                  jobId: job.id
                },
                orderBy: { createdAt: 'desc' }
              });

              if (existingCalculation) {
                return {
                  ...job,
                  kfnScore: existingCalculation.overallScore,
                  recommendation: existingCalculation.recommendation,
                  strengths: existingCalculation.strengths
                };
              }
            }

            // Calculate new KFN score
            const kfnScore = await kfnService.calculateKFN(workerId, job.id);
            
            // Save calculation
            await prisma.kFNCalculation.create({
              data: {
                workerId,
                jobId: job.id,
                ...kfnScore
              }
            });

            return {
              ...job,
              kfnScore: kfnScore.overallScore,
              recommendation: kfnScore.recommendation,
              strengths: kfnScore.strengths
            };
          } catch (error) {
            console.error(`Error calculating KFN for job ${job.id}:`, error);
            return {
              ...job,
              kfnScore: null,
              error: error.message
            };
          }
        })
      );

      // Filter out jobs with errors and sort by KFN score
      const validJobs = jobsWithScores
        .filter(job => job.kfnScore !== null)
        .sort((a, b) => (b.kfnScore || 0) - (a.kfnScore || 0))
        .slice(0, limit);

      return validJobs;
    } catch (error) {
      console.error('Match jobs for worker error:', error);
      throw error;
    }
  }

  async matchWorkersForJob(jobId, limit = 10) {
    try {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
          requiredSkills: {
            include: { skill: true }
          }
        }
      });

      if (!job) {
        throw new Error('Job not found');
      }

      // Get workers with relevant skills
      const requiredSkillIds = job.requiredSkills.map(rs => rs.skillId);

      const workers = await prisma.user.findMany({
        where: {
          role: 'WORKER',
          status: 'ACTIVE',
          workerSkills: {
            some: {
              skillId: { in: requiredSkillIds }
            }
          }
        },
        include: {
          profile: true,
          workerProfile: true,
          workerSkills: {
            include: { skill: true }
          },
          experience: true,
          education: true
        },
        take: 50 // Limit for performance
      });

      // Calculate KFN scores for each worker
      const workersWithScores = await Promise.all(
        workers.map(async (worker) => {
          try {
            const kfnScore = await kfnService.calculateKFN(worker.id, jobId);
            
            // Save calculation
            await prisma.kFNCalculation.create({
              data: {
                workerId: worker.id,
                jobId,
                ...kfnScore
              }
            });

            return {
              worker: {
                id: worker.id,
                name: `${worker.profile.firstName} ${worker.profile.lastName}`,
                headline: worker.workerProfile?.headline,
                skills: worker.workerSkills.map(ws => ws.skill.name),
                experience: worker.experience.length,
                education: worker.education.length
              },
              kfnScore: kfnScore.overallScore,
              recommendation: kfnScore.recommendation,
              strengths: kfnScore.strengths,
              areasToImprove: kfnScore.areasToImprove
            };
          } catch (error) {
            console.error(`Error calculating KFN for worker ${worker.id}:`, error);
            return {
              worker: {
                id: worker.id,
                name: `${worker.profile.firstName} ${worker.profile.lastName}`
              },
              kfnScore: null,
              error: error.message
            };
          }
        })
      );

      // Filter out workers with errors and sort by KFN score
      const validWorkers = workersWithScores
        .filter(worker => worker.kfnScore !== null)
        .sort((a, b) => (b.kfnScore || 0) - (a.kfnScore || 0))
        .slice(0, limit);

      return validWorkers;
    } catch (error) {
      console.error('Match workers for job error:', error);
      throw error;
    }
  }

  async chatAssistant(userId, message, context = {}) {
    try {
      // Get user context
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          profile: true,
          workerProfile: true,
          employerProfile: true
        }
      });

      // Prepare system message based on user role and context
      const systemMessage = this.prepareSystemMessage(user, context);

      // Call AI API
      const response = await this.callChatAPI(systemMessage, message, context);

      // Save chat history (optional)
      await this.saveChatHistory(userId, message, response, context);

      return {
        success: true,
        response,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Chat assistant error:', error);
      return {
        success: false,
        error: error.message,
        response: "I'm sorry, I'm having trouble processing your request. Please try again later."
      };
    }
  }

  async analyzeContent(content, type, options = {}) {
    try {
      const prompt = this.getAnalysisPrompt(type, options);
      
      const messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: content }
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          max_tokens: options.maxTokens || 1000,
          temperature: options.temperature || 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const analysis = this.parseAnalysisResponse(response.data, type);

      return {
        success: true,
        analysis,
        tokensUsed: response.data.usage?.total_tokens || 0,
        model: this.model
      };
    } catch (error) {
      console.error('Analyze content error:', error);
      throw error;
    }
  }

  async optimizeResume(resumeText, options = {}) {
    try {
      const prompt = `You are a professional resume optimizer. Optimize the following resume for ${options.targetJobTitle || 'general job search'}.
      
      Optimization goals: ${options.optimizationGoals?.join(', ') || 'Make it ATS-friendly and highlight achievements'}
      
      Target industry: ${options.targetIndustry || 'Any'}
      
      Resume to optimize:
      ${resumeText}
      
      Please provide:
      1. An optimized version of the resume
      2. A list of changes made and why
      3. Keywords to include for ATS optimization
      4. Suggestions for further improvement`;

      const messages = [
        { role: 'system', content: 'You are a professional resume writer and career coach.' },
        { role: 'user', content: prompt }
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          max_tokens: 2000,
          temperature: 0.8
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const optimizedResume = this.parseOptimizedResume(response.data.choices[0].message.content);

      return {
        success: true,
        optimizedResume,
        originalLength: resumeText.length,
        optimizedLength: optimizedResume.resume.length,
        changes: optimizedResume.changes,
        keywords: optimizedResume.keywords,
        suggestions: optimizedResume.suggestions,
        tokensUsed: response.data.usage?.total_tokens || 0
      };
    } catch (error) {
      console.error('Optimize resume error:', error);
      throw error;
    }
  }

  async generateCoverLetter(jobDescription, resumeText, options = {}) {
    try {
      const prompt = `Generate a professional cover letter for the following job:
      
      Job Description:
      ${jobDescription}
      
      Resume:
      ${resumeText || 'Not provided'}
      
      Tone: ${options.tone || 'professional'}
      Length: ${options.length || 'medium'}
      
      Please include:
      1. A compelling opening paragraph
      2. 2-3 paragraphs highlighting relevant experience and skills
      3. A closing paragraph expressing enthusiasm
      4. Professional sign-off`;

      const messages = [
        { role: 'system', content: 'You are a professional cover letter writer.' },
        { role: 'user', content: prompt }
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          max_tokens: 1500,
          temperature: 0.8
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const coverLetter = response.data.choices[0].message.content;

      return {
        success: true,
        coverLetter,
        length: coverLetter.length,
        estimatedReadingTime: Math.ceil(coverLetter.length / 1000), // minutes
        tokensUsed: response.data.usage?.total_tokens || 0
      };
    } catch (error) {
      console.error('Generate cover letter error:', error);
      throw error;
    }
  }

  async analyzeInterview(transcript, options = {}) {
    try {
      const prompt = `Analyze the following interview transcript for a ${options.interviewType || 'general'} interview:
      
      Transcript:
      ${transcript}
      
      Job Description (if available):
      ${options.jobDescription || 'Not provided'}
      
      Questions asked:
      ${options.questions?.join('\n') || 'Not specified'}
      
      Please provide:
      1. Overall performance rating (1-10)
      2. Strengths demonstrated
      3. Areas for improvement
      4. Specific feedback on answers
      5. Suggestions for future interviews`;

      const messages = [
        { role: 'system', content: 'You are an experienced interview coach and recruiter.' },
        { role: 'user', content: prompt }
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          max_tokens: 2000,
          temperature: 0.7
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const analysis = this.parseInterviewAnalysis(response.data.choices[0].message.content);

      return {
        success: true,
        analysis,
        tokensUsed: response.data.usage?.total_tokens || 0
      };
    } catch (error) {
      console.error('Analyze interview error:', error);
      throw error;
    }
  }

  async suggestInterviewQuestions(jobDescription, resumeText, options = {}) {
    try {
      const prompt = `Suggest ${options.count || 10} interview questions for the following job:
      
      Job Description:
      ${jobDescription}
      
      Candidate Resume (optional):
      ${resumeText || 'Not provided'}
      
      Question type: ${options.questionType || 'all'}
      Difficulty level: ${options.difficulty || 'mixed'}
      
      Please provide questions in the following format:
      For each question:
      1. The question
      2. Question type (technical/behavioral/cultural)
      3. Difficulty level (easy/medium/hard)
      4. What the interviewer is looking for
      5. Tips for answering`;

      const messages = [
        { role: 'system', content: 'You are an experienced interviewer and hiring manager.' },
        { role: 'user', content: prompt }
      ];

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages,
          max_tokens: 2000,
          temperature: 0.8
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const questions = this.parseInterviewQuestions(response.data.choices[0].message.content);

      return {
        success: true,
        questions,
        count: questions.length,
        tokensUsed: response.data.usage?.total_tokens || 0
      };
    } catch (error) {
      console.error('Suggest interview questions error:', error);
      throw error;
    }
  }

  async getStatus() {
    try {
      // Test AI service connectivity
      await axios.post(
        this.apiUrl,
        {
          model: this.model,
          messages: [{ role: 'user', content: 'Hello' }],
          max_tokens: 1
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: 5000
        }
      );

      return {
        status: 'online',
        provider: this.provider,
        model: this.model,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        status: 'offline',
        provider: this.provider,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }

  async batchProcess(applicationIds, action, userId) {
    try {
      const results = await Promise.all(
        applicationIds.map(async (applicationId) => {
          try {
            let result;
            
            switch (action) {
              case 'SCREEN':
                result = await this.screenResume(applicationId);
                break;
              case 'MATCH':
                // This would require additional logic for batch matching
                result = { message: 'Batch matching not implemented' };
                break;
              case 'ANALYZE':
                result = await this.analyzeApplication(applicationId);
                break;
              default:
                throw new Error(`Unknown action: ${action}`);
            }

            return {
              applicationId,
              success: true,
              result
            };
          } catch (error) {
            return {
              applicationId,
              success: false,
              error: error.message
            };
          }
        })
      );

      return results;
    } catch (error) {
      console.error('Batch process error:', error);
      throw error;
    }
  }

  // Helper methods
  prepareResumeText(worker) {
    const { profile, workerProfile, workerSkills, experience, education, certifications } = worker;
    
    let resumeText = `Name: ${profile.firstName} ${profile.lastName}\n`;
    resumeText += `Headline: ${workerProfile?.headline || 'Not specified'}\n`;
    resumeText += `Summary: ${workerProfile?.summary || 'Not specified'}\n\n`;
    
    resumeText += 'Skills:\n';
    workerSkills.forEach(skill => {
      resumeText += `- ${skill.skill.name} (${skill.proficiency}, ${skill.yearsOfExperience || 0} years)\n`;
    });
    
    resumeText += '\nExperience:\n';
    experience.forEach(exp => {
      const duration = exp.current ? 
        `${exp.startDate.toLocaleDateString()} - Present` :
        `${exp.startDate.toLocaleDateString()} - ${exp.endDate?.toLocaleDateString() || 'Present'}`;
      
      resumeText += `- ${exp.title} at ${exp.company} (${duration})\n`;
      if (exp.description) resumeText += `  ${exp.description}\n`;
    });
    
    resumeText += '\nEducation:\n';
    education.forEach(edu => {
      const duration = edu.endDate ?
        `${edu.startDate.getFullYear()} - ${edu.endDate.getFullYear()}` :
        `${edu.startDate.getFullYear()} - Present`;
      
      resumeText += `- ${edu.degree} in ${edu.fieldOfStudy || 'Not specified'} at ${edu.institution} (${duration})\n`;
      if (edu.grade) resumeText += `  Grade: ${edu.grade}\n`;
    });
    
    if (certifications && certifications.length > 0) {
      resumeText += '\nCertifications:\n';
      certifications.forEach(cert => {
        resumeText += `- ${cert.name} from ${cert.issuer} (${cert.issueDate.toLocaleDateString()})\n`;
      });
    }
    
    return resumeText;
  }

  prepareJobDescription(job) {
    let description = `Job Title: ${job.title}\n`;
    description += `Company: ${job.employer.employerProfile?.companyName || 'Not specified'}\n`;
    description += `Location: ${job.location}\n`;
    description += `Employment Type: ${job.employmentType}\n`;
    description += `Experience Level: ${job.experienceLevel}\n\n`;
    
    description += 'Description:\n';
    description += `${job.description}\n\n`;
    
    description += 'Requirements:\n';
    description += `${job.requirements}\n\n`;
    
    if (job.responsibilities) {
      description += 'Responsibilities:\n';
      description += `${job.responsibilities}\n\n`;
    }
    
    description += 'Required Skills:\n';
    job.requiredSkills.forEach(skill => {
      description += `- ${skill.skill.name}\n`;
    });
    
    if (job.preferredSkills && job.preferredSkills.length > 0) {
      description += '\nPreferred Skills:\n';
      job.preferredSkills.forEach(skill => {
        description += `- ${skill.skill.name}\n`;
      });
    }
    
    if (job.salaryMin || job.salaryMax) {
      description += `\nSalary: ${job.salaryMin ? `$${job.salaryMin}` : ''}${job.salaryMax ? ` - $${job.salaryMax}` : ''} ${job.salaryCurrency || 'USD'}\n`;
    }
    
    return description;
  }

  async analyzeResume(resumeText, jobDescription) {
    const prompt = `You are an expert resume screener and recruiter. Analyze the resume against the job description.
    
    Resume:
    ${resumeText}
    
    Job Description:
    ${jobDescription}
    
    Please provide a detailed analysis including:
    1. Overall match score (0-100%)
    2. Key strengths that align with the job
    3. Gaps or areas of concern
    4. Specific skill matches
    5. Experience relevance
    6. Education match
    7. Cultural fit assessment
    8. Recommendations for improvement
    
    Format your response as JSON with the following structure:
    {
      "overallMatchScore": number,
      "strengths": array of strings,
      "weaknesses": array of strings,
      "skillMatches": array of { skill: string, matchLevel: "EXCELLENT" | "GOOD" | "FAIR" | "POOR" | "MISSING" },
      "experienceAssessment": string,
      "educationAssessment": string,
      "culturalFit": "EXCELLENT" | "GOOD" | "FAIR" | "POOR",
      "recommendation": "STRONGLY_RECOMMEND" | "RECOMMEND" | "CONSIDER" | "NOT_RECOMMEND",
      "confidence": number (0-1),
      "summary": string,
      "suggestionsForImprovement": array of strings
    }`;

    const messages = [
      { role: 'system', content: 'You are an expert resume screener. Provide detailed, actionable feedback.' },
      { role: 'user', content: prompt }
    ];

    const response = await axios.post(
      this.apiUrl,
      {
        model: this.model,
        messages,
        max_tokens: 2000,
        temperature: 0.7
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    try {
      const content = response.data.choices[0].message.content;
      // Extract JSON from response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        // Fallback parsing
        return this.parseTextAnalysis(content);
      }
    } catch (error) {
      console.error('Error parsing AI response:', error);
      return this.parseTextAnalysis(response.data.choices[0].message.content);
    }
  }

  prepareSystemMessage(user, context) {
    let systemMessage = 'You are a helpful career assistant for the Kin2 Workforce Platform. ';
    
    if (user.role === 'WORKER') {
      systemMessage += `You are assisting ${user.profile.firstName}, a job seeker. `;
      if (user.workerProfile?.headline) {
        systemMessage += `Their professional headline is: ${user.workerProfile.headline}. `;
      }
      systemMessage += 'Help them with job search, resume optimization, interview preparation, and career advice.';
    } else if (user.role === 'EMPLOYER') {
      systemMessage += `You are assisting ${user.profile.firstName} from ${user.employerProfile?.companyName || 'their company'}. `;
      systemMessage += 'Help them with hiring, candidate screening, interview questions, and recruitment strategies.';
    } else {
      systemMessage += 'Provide helpful advice about the platform, job search, hiring, and career development.';
    }

    if (context.topic) {
      systemMessage += ` Current topic: ${context.topic}.`;
    }

    return systemMessage;
  }

  async callChatAPI(systemMessage, userMessage, context) {
    const messages = [
      { role: 'system', content: systemMessage },
      { role: 'user', content: userMessage }
    ];

    // Add context if available
    if (context.history && context.history.length > 0) {
      const historyMessages = context.history.slice(-5); // Last 5 messages for context
      messages.unshift(...historyMessages.map(msg => ({
        role: msg.role || 'user',
        content: msg.content
      })));
    }

    const response = await axios.post(
      this.apiUrl,
      {
        model: this.model,
        messages,
        max_tokens: 1000,
        temperature: 0.8
      },
      {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      }
    );

    return response.data.choices[0].message.content;
  }

  async saveChatHistory(userId, userMessage, assistantResponse, context) {
    try {
      // Implement chat history saving if needed
      // This could save to a database table
    } catch (error) {
      console.error('Save chat history error:', error);
    }
  }

  getAnalysisPrompt(type, options) {
    const prompts = {
      RESUME: `Analyze the following resume and provide detailed feedback. Focus on: clarity, achievements, skills presentation, ATS optimization, and overall impact.`,
      JOB_DESCRIPTION: `Analyze the following job description. Identify: key requirements, desired skills, company culture indicators, salary range indicators, and red flags.`,
      COVER_LETTER: `Analyze the following cover letter. Assess: personalization, relevance to job, writing quality, persuasive elements, and professionalism.`,
      PROFILE: `Analyze the following professional profile. Evaluate: completeness, professionalism, value proposition, skill presentation, and overall appeal.`,
      SKILLS: `Analyze the following skills list. Identify: relevant skills for target roles, skill gaps, skill categorization, and skill level assessment.`
    };

    let prompt = prompts[type] || 'Analyze the following content.';
    
    if (options.targetRole) {
      prompt += ` Target role: ${options.targetRole}.`;
    }
    
    if (options.industry) {
      prompt += ` Industry: ${options.industry}.`;
    }

    return prompt;
  }

  parseAnalysisResponse(data, type) {
    const content = data.choices[0].message.content;
    
    // Different parsing for different analysis types
    switch (type) {
      case 'RESUME':
        return this.parseResumeAnalysis(content);
      case 'JOB_DESCRIPTION':
        return this.parseJobDescriptionAnalysis(content);
      case 'COVER_LETTER':
        return this.parseCoverLetterAnalysis(content);
      default:
        return { analysis: content, raw: data };
    }
  }

  parseResumeAnalysis(content) {
    // Extract structured information from resume analysis
    const sections = {
      strengths: [],
      weaknesses: [],
      recommendations: [],
      score: 0,
      summary: ''
    };

    // Simple parsing logic - in production, use more sophisticated NLP
    const lines = content.split('\n');
    
    lines.forEach(line => {
      if (line.toLowerCase().includes('strength') || line.includes('+')) {
        sections.strengths.push(line.replace(/^[+\-\*]\s*/, '').trim());
      } else if (line.toLowerCase().includes('weakness') || line.toLowerCase().includes('improve') || line.includes('-')) {
        sections.weaknesses.push(line.replace(/^[+\-\*]\s*/, '').trim());
      } else if (line.toLowerCase().includes('recommend') || line.toLowerCase().includes('suggestion')) {
        sections.recommendations.push(line.replace(/^[+\-\*]\s*/, '').trim());
      } else if (line.includes('%') || (line.includes('score') && line.match(/\d+/))) {
        const scoreMatch = line.match(/\d+/);
        if (scoreMatch) sections.score = parseInt(scoreMatch[0]);
      } else if (line.length > 50 && !sections.summary) {
        sections.summary = line;
      }
    });

    return sections;
  }

  parseOptimizedResume(content) {
    const sections = {
      resume: '',
      changes: [],
      keywords: [],
      suggestions: []
    };

    const lines = content.split('\n');
    let currentSection = 'resume';

    lines.forEach(line => {
      if (line.toLowerCase().includes('optimized resume') || line.toLowerCase().includes('resume:')) {
        currentSection = 'resume';
      } else if (line.toLowerCase().includes('changes') || line.toLowerCase().includes('changes made')) {
        currentSection = 'changes';
      } else if (line.toLowerCase().includes('keywords') || line.toLowerCase().includes('ats')) {
        currentSection = 'keywords';
      } else if (line.toLowerCase().includes('suggestion') || line.toLowerCase().includes('improvement')) {
        currentSection = 'suggestions';
      } else if (line.trim()) {
        if (currentSection === 'resume') {
          sections.resume += line + '\n';
        } else if (currentSection === 'changes' && (line.startsWith('-') || line.startsWith('•'))) {
          sections.changes.push(line.replace(/^[-\•]\s*/, '').trim());
        } else if (currentSection === 'keywords' && (line.startsWith('-') || line.includes(','))) {
          const keywords = line.replace(/^[-\•]\s*/, '').split(',').map(k => k.trim());
          sections.keywords.push(...keywords.filter(k => k));
        } else if (currentSection === 'suggestions' && (line.startsWith('-') || line.startsWith('•'))) {
          sections.suggestions.push(line.replace(/^[-\•]\s*/, '').trim());
        }
      }
    });

    return sections;
  }

  parseInterviewAnalysis(content) {
    const analysis = {
      rating: 0,
      strengths: [],
      areasForImprovement: [],
      feedback: [],
      suggestions: []
    };

    const lines = content.split('\n');
    let currentSection = '';

    lines.forEach(line => {
      const trimmedLine = line.trim().toLowerCase();
      
      if (trimmedLine.includes('rating') || trimmedLine.includes('score')) {
        const ratingMatch = line.match(/\d+/);
        if (ratingMatch) analysis.rating = parseInt(ratingMatch[0]);
      } else if (trimmedLine.includes('strength')) {
        currentSection = 'strengths';
      } else if (trimmedLine.includes('improvement') || trimmedLine.includes('area for')) {
        currentSection = 'areasForImprovement';
      } else if (trimmedLine.includes('feedback') || trimmedLine.includes('answer')) {
        currentSection = 'feedback';
      } else if (trimmedLine.includes('suggestion') || trimmedLine.includes('future')) {
        currentSection = 'suggestions';
      } else if (line.startsWith('-') || line.startsWith('•') || line.match(/^\d+\./)) {
        const item = line.replace(/^[-\•\d\.]\s*/, '').trim();
        if (currentSection && item) {
          analysis[currentSection].push(item);
        }
      }
    });

    return analysis;
  }

  parseInterviewQuestions(content) {
    const questions = [];
    const lines = content.split('\n');
    let currentQuestion = null;

    lines.forEach(line => {
      const trimmedLine = line.trim();
      
      if (trimmedLine.match(/^\d+\./) || trimmedLine.toLowerCase().startsWith('question')) {
        if (currentQuestion) {
          questions.push(currentQuestion);
        }
        currentQuestion = {
          question: trimmedLine.replace(/^\d+\.\s*/, '').replace(/^question\s*\d*:?\s*/i, ''),
          type: 'behavioral',
          difficulty: 'medium',
          lookingFor: '',
          tips: []
        };
      } else if (currentQuestion) {
        const lowerLine = trimmedLine.toLowerCase();
        if (lowerLine.includes('type:')) {
          currentQuestion.type = trimmedLine.split(':')[1]?.trim() || 'behavioral';
        } else if (lowerLine.includes('difficulty:')) {
          currentQuestion.difficulty = trimmedLine.split(':')[1]?.trim() || 'medium';
        } else if (lowerLine.includes('looking for') || lowerLine.includes('assessing')) {
          currentQuestion.lookingFor = trimmedLine.split(':')[1]?.trim() || '';
        } else if (lowerLine.includes('tip') && trimmedLine.includes(':')) {
          currentQuestion.tips.push(trimmedLine.split(':')[1]?.trim() || '');
        } else if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
          currentQuestion.tips.push(trimmedLine.replace(/^[-\•]\s*/, ''));
        }
      }
    });

    if (currentQuestion) {
      questions.push(currentQuestion);
    }

    return questions;
  }

  parseTextAnalysis(content) {
    // Fallback parser for when JSON parsing fails
    const analysis = {
      summary: '',
      strengths: [],
      weaknesses: [],
      score: 0
    };

    const lines = content.split('\n');
    let currentSection = '';

    lines.forEach(line => {
      const trimmedLine = line.trim().toLowerCase();
      
      if (trimmedLine.includes('summary') || trimmedLine.includes('overall')) {
        currentSection = 'summary';
      } else if (trimmedLine.includes('strength')) {
        currentSection = 'strengths';
      } else if (trimmedLine.includes('weakness') || trimmedLine.includes('improvement')) {
        currentSection = 'weaknesses';
      } else if (trimmedLine.includes('score') && line.match(/\d+/)) {
        const scoreMatch = line.match(/\d+/);
        if (scoreMatch) analysis.score = parseInt(scoreMatch[0]);
      } else if (line.startsWith('-') || line.startsWith('•')) {
        const item = line.replace(/^[-\•]\s*/, '').trim();
        if (currentSection === 'strengths' && item) {
          analysis.strengths.push(item);
        } else if (currentSection === 'weaknesses' && item) {
          analysis.weaknesses.push(item);
        }
      } else if (currentSection === 'summary' && line.length > 20) {
        analysis.summary = line;
      }
    });

    return analysis;
  }

  getRecommendationLevel(score) {
    if (score >= 90) return 'STRONGLY_RECOMMEND';
    if (score >= 75) return 'RECOMMEND';
    if (score >= 60) return 'CONSIDER';
    if (score >= 40) return 'NOT_RECOMMEND';
    return 'REJECT';
  }

  async analyzeApplication(applicationId) {
    // Comprehensive analysis of an application
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        applicant: {
          include: {
            profile: true,
            workerProfile: true
          }
        }
      }
    });

    if (!application) {
      throw new Error('Application not found');
    }

    // Combine multiple analyses
    const analyses = await Promise.allSettled([
      this.analyzeContent(application.coverLetter || '', 'COVER_LETTER'),
      this.analyzeContent(application.job.description, 'JOB_DESCRIPTION')
    ]);

    const results = analyses.map(result => 
      result.status === 'fulfilled' ? result.value : { error: result.reason }
    );

    return {
      applicationId,
      coverLetterAnalysis: results[0],
      jobAnalysis: results[1],
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new AIService();
