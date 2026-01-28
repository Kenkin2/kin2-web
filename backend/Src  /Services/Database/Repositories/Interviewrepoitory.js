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
