class InterviewRepository {
  constructor(prisma, redis, calendarService, videoService) {
    this.prisma = prisma;
    this.redis = redis;
    this.calendarService = calendarService;
    this.videoService = videoService;
    this.CACHE_TTL = 1800; // 30 minutes
  }

  // INTERVIEW SCHEDULING
  async scheduleInterview(applicationId, scheduleData, scheduledBy) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        job: true,
        worker: {
          include: {
            user: true,
          },
        },
      },
    });

    if (!application) {
      throw new Error('Application not found');
    }

    // Check if interview already scheduled
    const existing = await this.prisma.interview.findFirst({
      where: {
        applicationId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      },
    });

    if (existing) {
      throw new Error('Interview already scheduled for this application');
    }

    // Validate schedule data
    const validation = await this.validateInterviewSchedule(
      applicationId,
      scheduleData,
      scheduledBy
    );

    if (!validation.valid) {
      throw new Error(`Schedule validation failed: ${validation.errors.join(', ')}`);
    }

    // Create calendar event
    const calendarEvent = await this.createCalendarEvent(
      application,
      scheduleData,
      scheduledBy
    );

    // Create interview record
    const interview = await this.prisma.interview.create({
      data: {
        applicationId,
        jobId: application.jobId,
        workerId: application.workerId,
        employerId: application.job.employerId,
        type: scheduleData.type,
        mode: scheduleData.mode,
        scheduledAt: scheduleData.scheduledAt,
        duration: scheduleData.duration,
        timezone: scheduleData.timezone,
        interviewers: scheduleData.interviewers,
        agenda: scheduleData.agenda,
        preparation: scheduleData.preparation,
        status: 'SCHEDULED',
        calendarEventId: calendarEvent.id,
        calendarLink: calendarEvent.link,
        videoLink: scheduleData.mode === 'VIDEO' ? await this.createVideoMeeting(scheduleData) : null,
        metadata: {
          scheduledBy,
          scheduledAt: new Date().toISOString(),
          calendarEvent,
          timezone: scheduleData.timezone,
        },
        reminders: this.setupReminders(scheduleData),
      },
    });

    // Send notifications
    await this.sendInterviewInvitations(interview, application, scheduleData);

    // Update application timeline
    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        timeline: {
          push: {
            action: 'INTERVIEW_SCHEDULED',
            timestamp: new Date(),
            interviewId: interview.id,
            scheduledBy,
            scheduledAt: scheduleData.scheduledAt,
          },
        },
      },
    });

    return interview;
  }

  async validateInterviewSchedule(applicationId, scheduleData, scheduledBy) {
    const errors = [];
    const warnings = [];

    // Check required fields
    if (!scheduleData.scheduledAt) {
      errors.push('Interview date and time required');
    }
    if (!scheduleData.duration || scheduleData.duration < 15) {
      errors.push('Duration must be at least 15 minutes');
    }
    if (!scheduleData.type) {
      errors.push('Interview type required');
    }
    if (!scheduleData.mode) {
      errors.push('Interview mode required');
    }

    // Check if in future
    const scheduledTime = new Date(scheduleData.scheduledAt);
    if (scheduledTime <= new Date()) {
      errors.push('Interview must be scheduled in the future');
    }

    // Check interviewer availability
    if (scheduleData.interviewers?.length > 0) {
      for (const interviewerId of scheduleData.interviewers) {
        const availability = await this.checkInterviewerAvailability(
          interviewerId,
          scheduleData.scheduledAt,
          scheduleData.duration
        );
        if (!availability.available) {
          errors.push(`${availability.name} is not available at that time`);
        }
      }
    }

    // Check candidate availability
    const candidateAvailability = await this.checkCandidateAvailability(
      applicationId,
      scheduleData.scheduledAt,
      scheduleData.duration
    );
    if (!candidateAvailability.available) {
      warnings.push('Candidate may have scheduling conflicts');
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  async checkInterviewerAvailability(interviewerId, startTime, duration) {
    const user = await this.prisma.user.findUnique({
      where: { id: interviewerId },
      select: { firstName: true, lastName: true, email: true },
    });

    const endTime = new Date(new Date(startTime).getTime() + duration * 60000);

    const conflicts = await this.prisma.interview.findMany({
      where: {
        interviewers: { has: interviewerId },
        scheduledAt: {
          lt: endTime,
        },
        endAt: {
          gt: startTime,
        },
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
      },
    });

    return {
      available: conflicts.length === 0,
      name: `${user.firstName} ${user.lastName}`,
      conflicts,
    };
  }

  async checkCandidateAvailability(applicationId, startTime, duration) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        worker: {
          include: {
            interviews: {
              where: {
                status: { in: ['SCHEDULED', 'CONFIRMED'] },
              },
            },
          },
        },
      },
    });

    const endTime = new Date(new Date(startTime).getTime() + duration * 60000);
    const conflicts = application.worker.interviews.filter(interview => {
      const interviewEnd = new Date(
        new Date(interview.scheduledAt).getTime() + interview.duration * 60000
      );
      return (
        interview.scheduledAt < endTime &&
        interviewEnd > startTime
      );
    });

    return {
      available: conflicts.length === 0,
      conflicts,
    };
  }

  async createCalendarEvent(application, scheduleData, scheduledBy) {
    const eventData = {
      summary: `Interview: ${application.job.title} - ${application.worker.user.firstName} ${application.worker.user.lastName}`,
      description: `Interview for position: ${application.job.title}\n\nAgenda:\n${scheduleData.agenda}\n\nPreparation:\n${scheduleData.preparation}`,
      start: {
        dateTime: scheduleData.scheduledAt,
        timeZone: scheduleData.timezone || 'UTC',
      },
      end: {
        dateTime: new Date(
          new Date(scheduleData.scheduledAt).getTime() + scheduleData.duration * 60000
        ),
        timeZone: scheduleData.timezone || 'UTC',
      },
      attendees: [
        {
          email: application.worker.user.email,
          displayName: `${application.worker.user.firstName} ${application.worker.user.lastName}`,
          responseStatus: 'needsAction',
        },
        ...scheduleData.interviewers.map(interviewerId => ({
          email: interviewerId, // Assuming interviewerId is email, adjust as needed
          responseStatus: 'needsAction',
        })),
      ],
      organizer: {
        email: scheduledBy,
      },
      reminders: {
        useDefault: false,
        overrides: [
          { method: 'email', minutes: 24 * 60 },
          { method: 'popup', minutes: 30 },
        ],
      },
      conferenceData: scheduleData.mode === 'VIDEO' ? {
        createRequest: {
          requestId: `interview-${applicationId}-${Date.now()}`,
          conferenceSolutionKey: { type: 'hangoutsMeet' },
        },
      } : undefined,
    };

    return await this.calendarService.createEvent(eventData);
  }

  async createVideoMeeting(scheduleData) {
    const meetingData = {
      topic: `Interview - ${scheduleData.type}`,
      start_time: scheduleData.scheduledAt,
      duration: scheduleData.duration,
      timezone: scheduleData.timezone || 'UTC',
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: true,
        waiting_room: true,
        recording: true,
      },
    };

    return await this.videoService.createMeeting(meetingData);
  }

  setupReminders(scheduleData) {
    const reminders = [];
    const scheduledTime = new Date(scheduleData.scheduledAt);

    // 24 hours before
    reminders.push({
      type: 'EMAIL',
      scheduledAt: new Date(scheduledTime.getTime() - 24 * 60 * 60 * 1000),
      sent: false,
    });

    // 1 hour before
    reminders.push({
      type: 'SMS',
      scheduledAt: new Date(scheduledTime.getTime() - 60 * 60 * 1000),
      sent: false,
    });

    // 15 minutes before
    reminders.push({
      type: 'PUSH',
      scheduledAt: new Date(scheduledTime.getTime() - 15 * 60 * 1000),
      sent: false,
    });

    return reminders;
  }

  async sendInterviewInvitations(interview, application, scheduleData) {
    // Send to candidate
    await this.prisma.notification.create({
      data: {
        userId: application.worker.user.id,
        type: 'INTERVIEW_INVITATION',
        title: 'Interview Invitation',
        message: `You have been invited for a ${scheduleData.type} interview for "${application.job.title}"`,
        metadata: {
          interviewId: interview.id,
          jobId: application.jobId,
          applicationId: application.id,
          scheduledAt: scheduleData.scheduledAt,
          duration: scheduleData.duration,
          mode: scheduleData.mode,
          calendarLink: interview.calendarLink,
          videoLink: interview.videoLink,
          agenda: scheduleData.agenda,
          preparation: scheduleData.preparation,
        },
        priority: 'HIGH',
      },
    });

    // Send to interviewers
    for (const interviewerId of scheduleData.interviewers) {
      await this.prisma.notification.create({
        data: {
          userId: interviewerId,
          type: 'INTERVIEW_SCHEDULED',
          title: 'Interview Scheduled',
          message: `You are scheduled to interview ${application.worker.user.firstName} ${application.worker.user.lastName} for "${application.job.title}"`,
          metadata: {
            interviewId: interview.id,
            candidateName: `${application.worker.user.firstName} ${application.worker.user.lastName}`,
            jobTitle: application.job.title,
            scheduledAt: scheduleData.scheduledAt,
            duration: scheduleData.duration,
            mode: scheduleData.mode,
            calendarLink: interview.calendarLink,
            videoLink: interview.videoLink,
          },
          priority: 'MEDIUM',
        },
      });
    }
  }

  // INTERVIEW MANAGEMENT
  async confirmInterview(interviewId, confirmedBy, notes = '') {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        application: {
          include: {
            worker: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    if (interview.status !== 'SCHEDULED') {
      throw new Error(`Interview is already ${interview.status}`);
    }

    const updated = await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmedBy,
        notes,
        metadata: {
          ...interview.metadata,
          confirmedBy,
          confirmedAt: new Date().toISOString(),
          confirmationNotes: notes,
        },
      },
    });

    // Notify interviewers
    await this.notifyInterviewConfirmation(interview, confirmedBy);

    // Update calendar event
    await this.updateCalendarEventStatus(interview.calendarEventId, 'CONFIRMED');

    return updated;
  }

  async rescheduleInterview(interviewId, newScheduleData, rescheduledBy, reason = '') {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        application: {
          include: {
            worker: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    if (!['SCHEDULED', 'CONFIRMED'].includes(interview.status)) {
      throw new Error(`Cannot reschedule ${interview.status} interview`);
    }

    // Validate new schedule
    const validation = await this.validateInterviewSchedule(
      interview.applicationId,
      newScheduleData,
      rescheduledBy
    );

    if (!validation.valid) {
      throw new Error(`Reschedule validation failed: ${validation.errors.join(', ')}`);
    }

    // Update calendar event
    const calendarEvent = await this.updateCalendarEvent(
      interview.calendarEventId,
      newScheduleData
    );

    // Update interview
    const updated = await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        type: newScheduleData.type,
        mode: newScheduleData.mode,
        scheduledAt: newScheduleData.scheduledAt,
        duration: newScheduleData.duration,
        timezone: newScheduleData.timezone,
        interviewers: newScheduleData.interviewers,
        agenda: newScheduleData.agenda,
        preparation: newScheduleData.preparation,
        status: 'SCHEDULED',
        calendarEventId: calendarEvent.id,
        calendarLink: calendarEvent.link,
        videoLink: newScheduleData.mode === 'VIDEO' ? await this.createVideoMeeting(newScheduleData) : null,
        metadata: {
          ...interview.metadata,
          rescheduledBy,
          rescheduledAt: new Date().toISOString(),
          rescheduleReason: reason,
          previousSchedule: {
            scheduledAt: interview.scheduledAt,
            duration: interview.duration,
            interviewers: interview.interviewers,
          },
        },
        reminders: this.setupReminders(newScheduleData),
        history: {
          push: {
            action: 'RESCHEDULED',
            timestamp: new Date(),
            rescheduledBy,
            reason,
            from: interview.scheduledAt,
            to: newScheduleData.scheduledAt,
          },
        },
      },
    });

    // Send reschedule notifications
    await this.sendRescheduleNotifications(interview, updated, reason);

    return updated;
  }

  async cancelInterview(interviewId, cancelledBy, reason = '') {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        application: {
          include: {
            worker: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    if (!['SCHEDULED', 'CONFIRMED'].includes(interview.status)) {
      throw new Error(`Cannot cancel ${interview.status} interview`);
    }

    const updated = await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy,
        cancellationReason: reason,
        metadata: {
          ...interview.metadata,
          cancelledBy,
          cancelledAt: new Date().toISOString(),
          cancellationReason: reason,
        },
        history: {
          push: {
            action: 'CANCELLED',
            timestamp: new Date(),
            cancelledBy,
            reason,
          },
        },
      },
    });

    // Cancel calendar event
    await this.cancelCalendarEvent(interview.calendarEventId, reason);

    // Send cancellation notifications
    await this.sendCancellationNotifications(interview, reason);

    // Update application timeline
    await this.prisma.application.update({
      where: { id: interview.applicationId },
      data: {
        timeline: {
          push: {
            action: 'INTERVIEW_CANCELLED',
            timestamp: new Date(),
            interviewId: interview.id,
            cancelledBy,
            reason,
          },
        },
      },
    });

    return updated;
  }

  async completeInterview(interviewId, completedBy, feedback = {}) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        application: {
          include: {
            worker: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    if (interview.status !== 'CONFIRMED') {
      throw new Error(`Cannot complete ${interview.status} interview`);
    }

    const updated = await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        completedBy,
        feedback,
        metadata: {
          ...interview.metadata,
          completedBy,
          completedAt: new Date().toISOString(),
          durationActual: feedback.durationActual,
          attendance: feedback.attendance,
        },
        history: {
          push: {
            action: 'COMPLETED',
            timestamp: new Date(),
            completedBy,
            feedbackSummary: feedback.summary,
          },
        },
      },
    });

    // Update application timeline
    await this.prisma.application.update({
      where: { id: interview.applicationId },
      data: {
        timeline: {
          push: {
            action: 'INTERVIEW_COMPLETED',
            timestamp: new Date(),
            interviewId: interview.id,
            completedBy,
          },
        },
      },
    });

    // Generate interview report
    const report = await this.generateInterviewReport(interviewId);

    // Update application with interview feedback
    await this.updateApplicationWithInterviewFeedback(interview.applicationId, feedback);

    return { interview: updated, report };
  }

  // INTERVIEW FEEDBACK
  async submitInterviewFeedback(interviewId, userId, feedback) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    if (!interview.interviewers.includes(userId)) {
      throw new Error('User is not an interviewer for this interview');
    }

    const existingFeedback = await this.prisma.interviewFeedback.findFirst({
      where: { interviewId, userId },
    });

    if (existingFeedback) {
      throw new Error('Feedback already submitted');
    }

    const feedbackRecord = await this.prisma.interviewFeedback.create({
      data: {
        interviewId,
        userId,
        rating: feedback.rating,
        comments: feedback.comments,
        strengths: feedback.strengths,
        weaknesses: feedback.weaknesses,
        skillAssessments: feedback.skillAssessments,
        recommendation: feedback.recommendation,
        confidence: feedback.confidence,
        submittedAt: new Date(),
      },
    });

    // Update interview with aggregated feedback
    await this.updateInterviewAggregatedFeedback(interviewId);

    return feedbackRecord;
  }

  async updateInterviewAggregatedFeedback(interviewId) {
    const feedbacks = await this.prisma.interviewFeedback.findMany({
      where: { interviewId },
    });

    if (feedbacks.length === 0) return;

    const aggregated = {
      averageRating: 0,
      recommendations: {
        STRONG_HIRE: 0,
        HIRE: 0,
        NO_HIRE: 0,
        STRONG_NO_HIRE: 0,
      },
      skillAssessments: {},
      comments: [],
      strengths: [],
      weaknesses: [],
    };

    let totalRating = 0;

    feedbacks.forEach(feedback => {
      totalRating += feedback.rating;
      aggregated.recommendations[feedback.recommendation] = 
        (aggregated.recommendations[feedback.recommendation] || 0) + 1;
      
      aggregated.comments.push(feedback.comments);
      aggregated.strengths.push(...(feedback.strengths || []));
      aggregated.weaknesses.push(...(feedback.weaknesses || []));

      // Aggregate skill assessments
      if (feedback.skillAssessments) {
        feedback.skillAssessments.forEach(assessment => {
          if (!aggregated.skillAssessments[assessment.skill]) {
            aggregated.skillAssessments[assessment.skill] = {
              total: 0,
              count: 0,
              comments: [],
            };
          }
          aggregated.skillAssessments[assessment.skill].total += assessment.rating;
          aggregated.skillAssessments[assessment.skill].count++;
          if (assessment.comment) {
            aggregated.skillAssessments[assessment.skill].comments.push(assessment.comment);
          }
        });
      }
    });

    aggregated.averageRating = totalRating / feedbacks.length;

    // Calculate average for each skill
    Object.keys(aggregated.skillAssessments).forEach(skill => {
      aggregated.skillAssessments[skill].average = 
        aggregated.skillAssessments[skill].total / aggregated.skillAssessments[skill].count;
    });

    // Remove duplicates from strengths and weaknesses
    aggregated.strengths = [...new Set(aggregated.strengths)];
    aggregated.weaknesses = [...new Set(aggregated.weaknesses)];

    await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        feedback: aggregated,
        metadata: {
          feedbackCount: feedbacks.length,
          lastFeedbackAt: new Date().toISOString(),
        },
      },
    });
  }

  async updateApplicationWithInterviewFeedback(applicationId, feedback) {
    const application = await this.prisma.application.findUnique({
      where: { id: applicationId },
    });

    if (!application) return;

    // Update KFN score based on interview feedback
    const interviewScore = this.calculateInterviewScore(feedback);
    const newKfnScore = (application.kfnScore * 0.7) + (interviewScore * 0.3);

    await this.prisma.application.update({
      where: { id: applicationId },
      data: {
        kfnScore: Math.round(newKfnScore),
        metadata: {
          ...application.metadata,
          interviewCompleted: true,
          interviewScore,
          lastInterviewAt: new Date().toISOString(),
        },
      },
    });
  }

  calculateInterviewScore(feedback) {
    let score = 50; // Base score

    if (feedback.averageRating) {
      score += (feedback.averageRating - 3) * 10; // -20 to +20
    }

    // Adjust based on recommendations
    if (feedback.recommendations) {
      const weights = {
        'STRONG_HIRE': 20,
        'HIRE': 10,
        'NO_HIRE': -10,
        'STRONG_NO_HIRE': -20,
      };

      Object.entries(feedback.recommendations).forEach(([rec, count]) => {
        if (weights[rec]) {
          score += weights[rec] * (count / Object.values(feedback.recommendations).reduce((a, b) => a + b, 0));
        }
      });
    }

    return Math.min(Math.max(score, 0), 100);
  }

  // INTERVIEW ANALYTICS
  async getInterviewAnalytics(interviewId) {
    const cacheKey = `interview:analytics:${interviewId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) {
      return JSON.parse(cached);
    }

    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        application: {
          include: {
            job: true,
            worker: {
              include: {
                user: true,
              },
            },
          },
        },
        feedbacks: true,
      },
    });

    const analytics = {
      interviewId,
      basicStats: await this.calculateBasicInterviewStats(interview),
      feedbackAnalysis: this.analyzeFeedback(interview.feedbacks),
      timelineAnalysis: this.analyzeInterviewTimeline(interview),
      performanceMetrics: await this.calculatePerformanceMetrics(interview),
      recommendations: this.generateInterviewRecommendations(interview),
    };

    await this.redis.setex(cacheKey, this.CACHE_TTL, JSON.stringify(analytics));

    return analytics;
  }

  async calculateBasicInterviewStats(interview) {
    const stats = {
      duration: interview.duration,
      mode: interview.mode,
      type: interview.type,
      interviewerCount: interview.interviewers?.length || 0,
      feedbackCount: interview.feedbacks?.length || 0,
      averageRating: 0,
      recommendationDistribution: {},
    };

    if (interview.feedbacks?.length > 0) {
      const totalRating = interview.feedbacks.reduce((sum, f) => sum + f.rating, 0);
      stats.averageRating = totalRating / interview.feedbacks.length;

      interview.feedbacks.forEach(feedback => {
        stats.recommendationDistribution[feedback.recommendation] = 
          (stats.recommendationDistribution[feedback.recommendation] || 0) + 1;
      });
    }

    return stats;
  }

  analyzeFeedback(feedbacks) {
    if (!feedbacks || feedbacks.length === 0) {
      return null;
    }

    const analysis = {
      commonStrengths: {},
      commonWeaknesses: {},
      skillAssessmentSummary: {},
      sentiment: this.analyzeFeedbackSentiment(feedbacks),
      consistency: this.calculateFeedbackConsistency(feedbacks),
    };

    feedbacks.forEach(feedback => {
      // Analyze strengths
      feedback.strengths?.forEach(strength => {
        analysis.commonStrengths[strength] = (analysis.commonStrengths[strength] || 0) + 1;
      });

      // Analyze weaknesses
      feedback.weaknesses?.forEach(weakness => {
        analysis.commonWeaknesses[weakness] = (analysis.commonWeaknesses[weakness] || 0) + 1;
      });

      // Analyze skill assessments
      feedback.skillAssessments?.forEach(assessment => {
        if (!analysis.skillAssessmentSummary[assessment.skill]) {
          analysis.skillAssessmentSummary[assessment.skill] = {
            total: 0,
            count: 0,
            comments: [],
          };
        }
        analysis.skillAssessmentSummary[assessment.skill].total += assessment.rating;
        analysis.skillAssessmentSummary[assessment.skill].count++;
        if (assessment.comment) {
          analysis.skillAssessmentSummary[assessment.skill].comments.push(assessment.comment);
        }
      });
    });

    // Calculate averages
    Object.keys(analysis.skillAssessmentSummary).forEach(skill => {
      analysis.skillAssessmentSummary[skill].average = 
        analysis.skillAssessmentSummary[skill].total / analysis.skillAssessmentSummary[skill].count;
    });

    return analysis;
  }

  analyzeFeedbackSentiment(feedbacks) {
    const sentiments = feedbacks.map(feedback => {
      const text = `${feedback.comments} ${feedback.strengths?.join(' ')} ${feedback.weaknesses?.join(' ')}`;
      // Simple sentiment analysis - in production, use NLP library
      const positiveWords = ['excellent', 'great', 'good', 'strong', 'impressive', 'positive'];
      const negativeWords = ['poor', 'weak', 'concern', 'negative', 'bad', 'issue'];
      
      let score = 0;
      const words = text.toLowerCase().split(/\s+/);
      
      words.forEach(word => {
        if (positiveWords.includes(word)) score += 1;
        if (negativeWords.includes(word)) score -= 1;
      });
      
      return score / Math.max(words.length, 1);
    });

    const averageSentiment = sentiments.reduce((a, b) => a + b, 0) / sentiments.length;
    
    return {
      average: averageSentiment,
      distribution: {
        POSITIVE: sentiments.filter(s => s > 0.1).length,
        NEUTRAL: sentiments.filter(s => s >= -0.1 && s <= 0.1).length,
        NEGATIVE: sentiments.filter(s => s < -0.1).length,
      },
    };
  }

  calculateFeedbackConsistency(feedbacks) {
    if (feedbacks.length < 2) return 1;

    const ratings = feedbacks.map(f => f.rating);
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length;
    const variance = ratings.reduce((sum, rating) => sum + Math.pow(rating - mean, 2), 0) / ratings.length;
    const stdDev = Math.sqrt(variance);

    // Higher consistency = lower standard deviation
    return Math.max(0, 1 - (stdDev / 2));
  }

  analyzeInterviewTimeline(interview) {
    const timeline = {
      scheduledToConfirmed: null,
      confirmedToCompleted: null,
      totalProcessingTime: null,
      onTime: true,
    };

    if (interview.confirmedAt) {
      timeline.scheduledToConfirmed = 
        (new Date(interview.confirmedAt) - new Date(interview.createdAt)) / (1000 * 60 * 60); // hours
    }

    if (interview.completedAt) {
      timeline.confirmedToCompleted = 
        (new Date(interview.completedAt) - new Date(interview.confirmedAt || interview.createdAt)) / (1000 * 60 * 60);
      
      timeline.totalProcessingTime = 
        (new Date(interview.completedAt) - new Date(interview.createdAt)) / (1000 * 60 * 60);
    }

    // Check if interview started on time
    if (interview.scheduledAt && interview.completedAt) {
      const scheduledStart = new Date(interview.scheduledAt);
      const actualStart = new Date(interview.completedAt);
      const timeDiff = Math.abs(actualStart - scheduledStart) / (1000 * 60); // minutes
      timeline.onTime = timeDiff <= 15; // 15 minutes tolerance
    }

    return timeline;
  }

  async calculatePerformanceMetrics(interview) {
    const metrics = {
      interviewerPerformance: {},
      candidateEngagement: await this.calculateCandidateEngagement(interview.applicationId),
      noShowRate: await this.calculateNoShowRate(interview.employerId),
      averageCompletionTime: await this.calculateAverageCompletionTime(interview.employerId),
    };

    // Calculate interviewer performance
    if (interview.interviewers?.length > 0) {
      for (const interviewerId of interview.interviewers) {
        const feedbacks = await this.prisma.interviewFeedback.findMany({
          where: {
            interview: {
              interviewers: { has: interviewerId },
            },
            userId: interviewerId,
          },
        });

        if (feedbacks.length > 0) {
          const avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;
          const completionRate = feedbacks.filter(f => f.submittedAt).length / feedbacks.length;

          metrics.interviewerPerformance[interviewerId] = {
            feedbackCount: feedbacks.length,
            averageRating: avgRating,
            completionRate,
            lastFeedback: feedbacks[feedbacks.length - 1]?.submittedAt,
          };
        }
      }
    }

    return metrics;
  }

  async calculateCandidateEngagement(applicationId) {
    const interviews = await this.prisma.interview.findMany({
      where: { applicationId },
      include: { feedbacks: true },
    });

    if (interviews.length === 0) return 0;

    let engagementScore = 0;
    
    interviews.forEach(interview => {
      // Attendance points
      if (interview.status === 'COMPLETED') engagementScore += 3;
      if (interview.status === 'CANCELLED') engagementScore -= 1;
      
      // Timeliness points
      if (interview.metadata?.onTime) engagementScore += 1;
      
      // Feedback response points
      if (interview.feedbacks?.length > 0) engagementScore += 1;
    });

    return Math.min(engagementScore / (interviews.length * 5), 1); // Normalize to 0-1
  }

  async calculateNoShowRate(employerId) {
    const interviews = await this.prisma.interview.findMany({
      where: { employerId },
    });

    if (interviews.length === 0) return 0;

    const noShows = interviews.filter(i => 
      i.status === 'CANCELLED' && 
      i.cancellationReason?.toLowerCase().includes('no show')
    ).length;

    return noShows / interviews.length;
  }

  async calculateAverageCompletionTime(employerId) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        AVG(EXTRACT(EPOCH FROM (completed_at - scheduled_at)) / 3600) as avg_hours
      FROM interviews
      WHERE employer_id = ${employerId}
        AND status = 'COMPLETED'
        AND completed_at IS NOT NULL
        AND scheduled_at IS NOT NULL
    `;

    return result[0]?.avg_hours || 0;
  }

  generateInterviewRecommendations(interview) {
    const recommendations = [];

    // Based on feedback
    if (interview.feedbacks?.length === 0) {
      recommendations.push({
        type: 'FEEDBACK_MISSING',
        priority: 'HIGH',
        action: 'Request feedback from interviewers',
        reason: 'No feedback submitted for completed interview',
      });
    }

    // Based on timing
    const scheduledTime = new Date(interview.scheduledAt);
    const now = new Date();
    if (scheduledTime < now && interview.status === 'SCHEDULED') {
      recommendations.push({
        type: 'INTERVIEW_OVERDUE',
        priority: 'HIGH',
        action: 'Update interview status',
        reason: 'Interview time has passed but status is still SCHEDULED',
      });
    }

    // Based on preparation
    if (!interview.preparation || interview.preparation.trim().length < 50) {
      recommendations.push({
        type: 'PREPARATION_INCOMPLETE',
        priority: 'MEDIUM',
        action: 'Add detailed preparation instructions',
        reason: 'Interview preparation is minimal or missing',
      });
    }

    // Based on interviewer count
    if (!interview.interviewers || interview.interviewers.length === 0) {
      recommendations.push({
        type: 'NO_INTERVIEWERS',
        priority: 'HIGH',
        action: 'Assign interviewers',
        reason: 'No interviewers assigned',
      });
    }

    return recommendations;
  }

  // INTERVIEW SEARCH & FILTERING
  async searchInterviews(filters, pagination = { page: 1, limit: 20 }) {
    const {
      employerId,
      jobId,
      applicationId,
      workerId,
      status,
      type,
      mode,
      interviewerId,
      dateFrom,
      dateTo,
      hasFeedback,
      search,
      sortBy = 'scheduledAt',
      sortOrder = 'desc',
    } = filters;

    const where = {};

    if (employerId) where.employerId = employerId;
    if (jobId) where.jobId = jobId;
    if (applicationId) where.applicationId = applicationId;
    if (workerId) where.workerId = workerId;
    if (status) where.status = status;
    if (type) where.type = type;
    if (mode) where.mode = mode;
    if (interviewerId) where.interviewers = { has: interviewerId };
    if (dateFrom) where.scheduledAt = { gte: new Date(dateFrom) };
    if (dateTo) where.scheduledAt = { lte: new Date(dateTo) };
    if (hasFeedback !== undefined) {
      where.feedbacks = hasFeedback ? { some: {} } : { none: {} };
    }

    // Text search
    if (search) {
      where.OR = [
        {
          application: {
            worker: {
              user: {
                OR: [
                  { firstName: { contains: search, mode: 'insensitive' } },
                  { lastName: { contains: search, mode: 'insensitive' } },
                ],
              },
            },
          },
        },
        {
          agenda: { contains: search, mode: 'insensitive' },
        },
        {
          preparation: { contains: search, mode: 'insensitive' },
        },
      ];
    }

    const [interviews, total] = await Promise.all([
      this.prisma.interview.findMany({
        where,
        include: {
          application: {
            include: {
              job: {
                select: {
                  title: true,
                  department: true,
                },
              },
              worker: {
                select: {
                  user: {
                    select: {
                      firstName: true,
                      lastName: true,
                      email: true,
                    },
                  },
                },
              },
            },
          },
          feedbacks: {
            select: {
              rating: true,
              recommendation: true,
            },
          },
        },
        orderBy: { [sortBy]: sortOrder },
        skip: (pagination.page - 1) * pagination.limit,
        take: pagination.limit,
      }),
      this.prisma.interview.count({ where }),
    ]);

    return {
      interviews,
      pagination: {
        page: pagination.page,
        limit: pagination.limit,
        total,
        pages: Math.ceil(total / pagination.limit),
      },
    };
  }

  async getInterviewStatistics(employerId, period = '30_DAYS') {
    const startDate = this.getPeriodStartDate(period);
    
    const stats = await this.prisma.interview.groupBy({
      by: ['status', 'type'],
      where: {
        employerId,
        scheduledAt: { gte: startDate },
      },
      _count: { id: true },
      _avg: {
        duration: true,
      },
    });

    const timeSeries = await this.prisma.$queryRaw`
      SELECT 
        DATE(scheduled_at) as date,
        COUNT(*) as count,
        AVG(duration) as avg_duration
      FROM interviews
      WHERE employer_id = ${employerId}
        AND scheduled_at >= ${startDate}
      GROUP BY DATE(scheduled_at)
      ORDER BY date
    `;

    const feedbackStats = await this.prisma.interviewFeedback.groupBy({
      by: ['recommendation'],
      where: {
        interview: {
          employerId,
          scheduledAt: { gte: startDate },
        },
      },
      _count: { id: true },
      _avg: { rating: true },
    });

    return {
      total: stats.reduce((sum, stat) => sum + stat._count.id, 0),
      byStatus: stats.reduce((acc, stat) => {
        if (!acc[stat.status]) acc[stat.status] = {};
        acc[stat.status][stat.type] = {
          count: stat._count.id,
          avgDuration: stat._avg.duration,
        };
        return acc;
      }, {}),
      timeSeries,
      feedbackDistribution: feedbackStats.reduce((acc, stat) => {
        acc[stat.recommendation] = {
          count: stat._count.id,
          avgRating: stat._avg.rating,
        };
        return acc;
      }, {}),
      completionRate: await this.calculateInterviewCompletionRate(employerId, startDate),
      averageRating: await this.calculateAverageInterviewRating(employerId, startDate),
    };
  }

  async calculateInterviewCompletionRate(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END) as completed
      FROM interviews
      WHERE employer_id = ${employerId}
        AND scheduled_at >= ${startDate}
    `;

    const total = parseInt(result[0].total) || 0;
    const completed = parseInt(result[0].completed) || 0;

    return total > 0 ? completed / total : 0;
  }

  async calculateAverageInterviewRating(employerId, startDate) {
    const result = await this.prisma.$queryRaw`
      SELECT AVG(rating) as avg_rating
      FROM interview_feedbacks
      WHERE interview_id IN (
        SELECT id FROM interviews 
        WHERE employer_id = ${employerId}
          AND scheduled_at >= ${startDate}
      )
    `;

    return result[0]?.avg_rating || 0;
  }

  // INTERVIEW AUTOMATION
  async sendReminders() {
    const now = new Date();
    const upcomingInterviews = await this.prisma.interview.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        scheduledAt: {
          gt: now,
          lte: new Date(now.getTime() + 25 * 60 * 60 * 1000), // Next 25 hours
        },
        reminders: {
          some: {
            sent: false,
            scheduledAt: {
              lte: now,
            },
          },
        },
      },
      include: {
        application: {
          include: {
            worker: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    const results = [];

    for (const interview of upcomingInterviews) {
      try {
        const unsentReminders = interview.reminders.filter(r => !r.sent && new Date(r.scheduledAt) <= now);
        
        for (const reminder of unsentReminders) {
          await this.sendReminderNotification(interview, reminder.type);
          
          // Mark as sent
          await this.prisma.interview.update({
            where: { id: interview.id },
            data: {
              reminders: interview.reminders.map(r => 
                r === reminder ? { ...r, sent: true, sentAt: new Date() } : r
              ),
            },
          });
          
          results.push({
            interviewId: interview.id,
            reminderType: reminder.type,
            sent: true,
          });
        }
      } catch (error) {
        results.push({
          interviewId: interview.id,
          reminderType: 'ERROR',
          sent: false,
          error: error.message,
        });
      }
    }

    return {
      processed: upcomingInterviews.length,
      results,
    };
  }

  async sendReminderNotification(interview, reminderType) {
    const notificationData = {
      title: 'Interview Reminder',
      message: `Reminder: ${interview.type} interview scheduled for ${interview.scheduledAt}`,
      metadata: {
        interviewId: interview.id,
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        mode: interview.mode,
        calendarLink: interview.calendarLink,
        videoLink: interview.videoLink,
      },
    };

    // Send to candidate
    await this.prisma.notification.create({
      data: {
        userId: interview.application.worker.user.id,
        type: 'INTERVIEW_REMINDER',
        ...notificationData,
        priority: reminderType === 'PUSH' ? 'HIGH' : 'MEDIUM',
      },
    });

    // Send to interviewers
    for (const interviewerId of interview.interviewers) {
      await this.prisma.notification.create({
        data: {
          userId: interviewerId,
          type: 'INTERVIEW_REMINDER',
          ...notificationData,
          priority: 'MEDIUM',
        },
      });
    }
  }

  async autoUpdateStatuses() {
    const now = new Date();
    const results = [];

    // Update overdue interviews (scheduled but not started)
    const overdueInterviews = await this.prisma.interview.findMany({
      where: {
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        scheduledAt: { lt: new Date(now.getTime() - 2 * 60 * 60 * 1000) }, // 2 hours ago
      },
    });

    for (const interview of overdueInterviews) {
      try {
        await this.prisma.interview.update({
          where: { id: interview.id },
          data: {
            status: 'NO_SHOW',
            metadata: {
              ...interview.metadata,
              autoUpdated: true,
              autoUpdatedAt: new Date().toISOString(),
            },
            history: {
              push: {
                action: 'AUTO_STATUS_UPDATE',
                timestamp: new Date(),
                from: interview.status,
                to: 'NO_SHOW',
                reason: 'Interview time passed without update',
              },
            },
          },
        });

        results.push({
          interviewId: interview.id,
          action: 'MARKED_NO_SHOW',
          success: true,
        });
      } catch (error) {
        results.push({
          interviewId: interview.id,
          action: 'MARKED_NO_SHOW',
          success: false,
          error: error.message,
        });
      }
    }

    // Update completed interviews without feedback for too long
    const oldCompletedInterviews = await this.prisma.interview.findMany({
      where: {
        status: 'COMPLETED',
        completedAt: { lt: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }, // 7 days ago
        feedbacks: { none: {} },
      },
    });

    for (const interview of oldCompletedInterviews) {
      try {
        await this.prisma.interview.update({
          where: { id: interview.id },
          data: {
            metadata: {
              ...interview.metadata,
              feedbackOverdue: true,
              lastReminderSent: new Date().toISOString(),
            },
          },
        });

        // Send reminder for feedback
        await this.sendFeedbackReminder(interview);

        results.push({
          interviewId: interview.id,
          action: 'SENT_FEEDBACK_REMINDER',
          success: true,
        });
      } catch (error) {
        results.push({
          interviewId: interview.id,
          action: 'SENT_FEEDBACK_REMINDER',
          success: false,
          error: error.message,
        });
      }
    }

    return {
      processed: results.length,
      results,
    };
  }

  async sendFeedbackReminder(interview) {
    for (const interviewerId of interview.interviewers) {
      await this.prisma.notification.create({
        data: {
          userId: interviewerId,
          type: 'FEEDBACK_REMINDER',
          title: 'Feedback Reminder',
          message: `Please submit feedback for interview with ${interview.application?.worker?.user?.firstName || 'candidate'}`,
          metadata: {
            interviewId: interview.id,
            candidateName: `${interview.application?.worker?.user?.firstName || ''} ${interview.application?.worker?.user?.lastName || ''}`,
            jobTitle: interview.application?.job?.title,
            completedAt: interview.completedAt,
          },
          priority: 'MEDIUM',
        },
      });
    }
  }

  // INTERVIEW TEMPLATES
  async createInterviewTemplate(employerId, templateData, createdBy) {
    const template = await this.prisma.interviewTemplate.create({
      data: {
        employerId,
        name: templateData.name,
        type: templateData.type,
        mode: templateData.mode,
        duration: templateData.duration,
        defaultAgenda: templateData.agenda,
        defaultPreparation: templateData.preparation,
        defaultQuestions: templateData.questions,
        scoringRubric: templateData.scoringRubric,
        requiredSkills: templateData.requiredSkills,
        metadata: {
          createdBy,
          createdAt: new Date().toISOString(),
          version: 1,
        },
        isActive: true,
      },
    });

    return template;
  }

  async applyInterviewTemplate(interviewId, templateId, appliedBy) {
    const template = await this.prisma.interviewTemplate.findUnique({
      where: { id: templateId },
    });

    if (!template) {
      throw new Error('Template not found');
    }

    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    const updated = await this.prisma.interview.update({
      where: { id: interviewId },
      data: {
        type: template.type,
        duration: template.duration,
        agenda: template.defaultAgenda,
        preparation: template.defaultPreparation,
        metadata: {
          ...interview.metadata,
          appliedTemplate: templateId,
          appliedTemplateBy: appliedBy,
          appliedTemplateAt: new Date().toISOString(),
          templateVersion: template.metadata?.version,
        },
        history: {
          push: {
            action: 'TEMPLATE_APPLIED',
            timestamp: new Date(),
            templateId,
            appliedBy,
          },
        },
      },
    });

    return updated;
  }

  // REPORT GENERATION
  async generateInterviewReport(interviewId) {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        application: {
          include: {
            job: true,
            worker: {
              include: {
                user: true,
                skills: true,
                experiences: true,
              },
            },
          },
        },
        feedbacks: {
          include: {
            user: {
              select: {
                firstName: true,
                lastName: true,
                title: true,
              },
            },
          },
        },
      },
    });

    if (!interview) {
      throw new Error('Interview not found');
    }

    const report = {
      interviewId,
      generatedAt: new Date(),
      basicInfo: {
        candidate: `${interview.application.worker.user.firstName} ${interview.application.worker.user.lastName}`,
        jobTitle: interview.application.job.title,
        interviewType: interview.type,
        interviewMode: interview.mode,
        scheduledAt: interview.scheduledAt,
        duration: interview.duration,
        status: interview.status,
      },
      feedbackSummary: this.createFeedbackSummary(interview.feedbacks),
      skillAssessment: this.createSkillAssessment(interview.feedbacks),
      recommendations: this.extractRecommendations(interview.feedbacks),
      interviewerComments: this.extractInterviewerComments(interview.feedbacks),
      overallAssessment: this.createOverallAssessment(interview),
      nextSteps: this.suggestNextSteps(interview),
    };

    // Store report
    await this.prisma.interviewReport.create({
      data: {
        interviewId,
        report,
        generatedAt: new Date(),
      },
    });

    return report;
  }

  createFeedbackSummary(feedbacks) {
    if (!feedbacks || feedbacks.length === 0) {
      return null;
    }

    const summary = {
      totalFeedbacks: feedbacks.length,
      averageRating: 0,
      ratingDistribution: {},
      recommendationDistribution: {},
      strengths: [],
      weaknesses: [],
    };

    let totalRating = 0;

    feedbacks.forEach(feedback => {
      totalRating += feedback.rating;
      
      // Rating distribution
      const rating = Math.round(feedback.rating);
      summary.ratingDistribution[rating] = (summary.ratingDistribution[rating] || 0) + 1;
      
      // Recommendation distribution
      summary.recommendationDistribution[feedback.recommendation] = 
        (summary.recommendationDistribution[feedback.recommendation] || 0) + 1;
      
      // Collect strengths and weaknesses
      if (feedback.strengths) summary.strengths.push(...feedback.strengths);
      if (feedback.weaknesses) summary.weaknesses.push(...feedback.weaknesses);
    });

    summary.averageRating = totalRating / feedbacks.length;
    
    // Remove duplicates and count frequencies
    summary.strengths = this.countFrequency([...new Set(summary.strengths)]);
    summary.weaknesses = this.countFrequency([...new Set(summary.weaknesses)]);

    return summary;
  }

  createSkillAssessment(feedbacks) {
    if (!feedbacks) return null;

    const skills = {};

    feedbacks.forEach(feedback => {
      feedback.skillAssessments?.forEach(assessment => {
        if (!skills[assessment.skill]) {
          skills[assessment.skill] = {
            total: 0,
            count: 0,
            comments: [],
            assessors: [],
          };
        }
        skills[assessment.skill].total += assessment.rating;
        skills[assessment.skill].count++;
        if (assessment.comment) {
          skills[assessment.skill].comments.push(assessment.comment);
        }
        if (feedback.user) {
          skills[assessment.skill].assessors.push(
            `${feedback.user.firstName} ${feedback.user.lastName}`
          );
        }
      });
    });

    // Calculate averages and unique assessors
    Object.keys(skills).forEach(skill => {
      skills[skill].average = skills[skill].total / skills[skill].count;
      skills[skill].assessors = [...new Set(skills[skill].assessors)];
    });

    return skills;
  }

  extractRecommendations(feedbacks) {
    if (!feedbacks) return null;

    const recommendations = {
      STRONG_HIRE: [],
      HIRE: [],
      NO_HIRE: [],
      STRONG_NO_HIRE: [],
    };

    feedbacks.forEach(feedback => {
      if (feedback.recommendation && feedback.comments) {
        recommendations[feedback.recommendation].push({
          interviewer: `${feedback.user?.firstName || ''} ${feedback.user?.lastName || ''}`,
          comment: feedback.comments,
          confidence: feedback.confidence,
        });
      }
    });

    return recommendations;
  }

  extractInterviewerComments(feedbacks) {
    if (!feedbacks) return [];

    return feedbacks
      .filter(f => f.comments)
      .map(f => ({
        interviewer: `${f.user?.firstName || ''} ${f.user?.lastName || ''}`,
        comment: f.comments,
        rating: f.rating,
        recommendation: f.recommendation,
      }));
  }

  createOverallAssessment(interview) {
    const feedbacks = interview.feedbacks || [];
    
    if (feedbacks.length === 0) {
      return {
        overallRating: null,
        finalRecommendation: 'NEEDS_MORE_DATA',
        confidence: 0,
        summary: 'No feedback received',
      };
    }

    const avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;
    const recommendations = feedbacks.map(f => f.recommendation);
    
    // Determine final recommendation
    let finalRecommendation = 'NO_HIRE';
    if (recommendations.includes('STRONG_HIRE')) {
      finalRecommendation = 'STRONG_HIRE';
    } else if (recommendations.includes('HIRE')) {
      finalRecommendation = 'HIRE';
    } else if (recommendations.includes('NO_HIRE') && !recommendations.includes('STRONG_NO_HIRE')) {
      finalRecommendation = 'NO_HIRE';
    }

    // Calculate confidence based on consistency
    const consistency = this.calculateFeedbackConsistency(feedbacks);
    
    return {
      overallRating: avgRating,
      finalRecommendation,
      confidence: consistency,
      summary: this.generateAssessmentSummary(feedbacks),
    };
  }

  generateAssessmentSummary(feedbacks) {
    const strengths = [...new Set(feedbacks.flatMap(f => f.strengths || []))];
    const weaknesses = [...new Set(feedbacks.flatMap(f => f.weaknesses || []))];
    
    let summary = '';
    
    if (strengths.length > 0) {
      summary += `Key strengths: ${strengths.join(', ')}. `;
    }
    
    if (weaknesses.length > 0) {
      summary += `Areas for improvement: ${weaknesses.join(', ')}. `;
    }
    
    const avgRating = feedbacks.reduce((sum, f) => sum + f.rating, 0) / feedbacks.length;
    summary += `Overall rating: ${avgRating.toFixed(1)}/5.`;
    
    return summary;
  }

  suggestNextSteps(interview) {
    const steps = [];
    const feedbacks = interview.feedbacks || [];
    
    if (feedbacks.length === 0) {
      steps.push({
        action: 'COLLECT_FEEDBACK',
        priority: 'HIGH',
        description: 'Collect feedback from all interviewers',
      });
    }
    
    if (interview.status === 'COMPLETED') {
      const recommendations = feedbacks.map(f => f.recommendation);
      
      if (recommendations.includes('STRONG_HIRE') || recommendations.includes('HIRE')) {
        steps.push({
          action: 'PROCEED_TO_NEXT_STAGE',
          priority: 'HIGH',
          description: 'Schedule next interview or extend offer',
        });
      } else if (recommendations.includes('NO_HIRE') || recommendations.includes('STRONG_NO_HIRE')) {
        steps.push({
          action: 'DECLINE_CANDIDATE',
          priority: 'HIGH',
          description: 'Send rejection notification',
        });
      } else {
        steps.push({
          action: 'ADDITIONAL_ASSESSMENT',
          priority: 'MEDIUM',
          description: 'Consider additional assessments or interviews',
        });
      }
    }
    
    return steps;
  }

  countFrequency(items) {
    const frequency = {};
    items.forEach(item => {
      frequency[item] = (frequency[item] || 0) + 1;
    });
    
    return Object.entries(frequency)
      .map(([item, count]) => ({ item, count }))
      .sort((a, b) => b.count - a.count);
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
      case 'QUARTER':
        return new Date(now.setMonth(now.getMonth() - 3));
      case 'YEAR':
        return new Date(now.setFullYear(now.getFullYear() - 1));
      default:
        return new Date(now.setDate(now.getDate() - 30));
    }
  }

  async notifyInterviewConfirmation(interview, confirmedBy) {
    // Notify interviewers
    for (const interviewerId of interview.interviewers) {
      await this.prisma.notification.create({
        data: {
          userId: interviewerId,
          type: 'INTERVIEW_CONFIRMED',
          title: 'Interview Confirmed',
          message: `Interview with candidate has been confirmed`,
          metadata: {
            interviewId: interview.id,
            candidateName: `${interview.application.worker.user.firstName} ${interview.application.worker.user.lastName}`,
            scheduledAt: interview.scheduledAt,
          },
          priority: 'MEDIUM',
        },
      });
    }
  }

  async sendRescheduleNotifications(oldInterview, newInterview, reason) {
    // Notify candidate
    await this.prisma.notification.create({
      data: {
        userId: newInterview.application.worker.user.id,
        type: 'INTERVIEW_RESCHEDULED',
        title: 'Interview Rescheduled',
        message: `Your interview has been rescheduled. ${reason ? `Reason: ${reason}` : ''}`,
        metadata: {
          interviewId: newInterview.id,
          oldTime: oldInterview.scheduledAt,
          newTime: newInterview.scheduledAt,
          reason,
        },
        priority: 'HIGH',
      },
    });

    // Notify interviewers
    const allInterviewers = [...new Set([
      ...(oldInterview.interviewers || []),
      ...(newInterview.interviewers || []),
    ])];

    for (const interviewerId of allInterviewers) {
      await this.prisma.notification.create({
        data: {
          userId: interviewerId,
          type: 'INTERVIEW_RESCHEDULED',
          title: 'Interview Rescheduled',
          message: `Interview has been rescheduled. ${reason ? `Reason: ${reason}` : ''}`,
          metadata: {
            interviewId: newInterview.id,
            oldTime: oldInterview.scheduledAt,
            newTime: newInterview.scheduledAt,
            reason,
          },
          priority: 'MEDIUM',
        },
      });
    }
  }

  async sendCancellationNotifications(interview, reason) {
    // Notify candidate
    await this.prisma.notification.create({
      data: {
        userId: interview.application.worker.user.id,
        type: 'INTERVIEW_CANCELLED',
        title: 'Interview Cancelled',
        message: `Your interview has been cancelled. ${reason ? `Reason: ${reason}` : ''}`,
        metadata: {
          interviewId: interview.id,
          reason,
        },
        priority: 'HIGH',
      },
    });

    // Notify interviewers
    for (const interviewerId of interview.interviewers) {
      await this.prisma.notification.create({
        data: {
          userId: interviewerId,
          type: 'INTERVIEW_CANCELLED',
          title: 'Interview Cancelled',
          message: `Interview has been cancelled. ${reason ? `Reason: ${reason}` : ''}`,
          metadata: {
            interviewId: interview.id,
            reason,
          },
          priority: 'MEDIUM',
        },
      });
    }
  }

  async updateCalendarEventStatus(calendarEventId, status) {
    try {
      await this.calendarService.updateEvent(calendarEventId, {
        status,
      });
    } catch (error) {
      console.error('Failed to update calendar event:', error);
    }
  }

  async updateCalendarEvent(calendarEventId, scheduleData) {
    try {
      return await this.calendarService.updateEvent(calendarEventId, {
        start: {
          dateTime: scheduleData.scheduledAt,
          timeZone: scheduleData.timezone || 'UTC',
        },
        end: {
          dateTime: new Date(
            new Date(scheduleData.scheduledAt).getTime() + scheduleData.duration * 60000
          ),
          timeZone: scheduleData.timezone || 'UTC',
        },
      });
    } catch (error) {
      console.error('Failed to update calendar event:', error);
      throw error;
    }
  }

  async cancelCalendarEvent(calendarEventId, reason) {
    try {
      await this.calendarService.deleteEvent(calendarEventId, reason);
    } catch (error) {
      console.error('Failed to cancel calendar event:', error);
    }
  }
}

module.exports = InterviewRepository;
