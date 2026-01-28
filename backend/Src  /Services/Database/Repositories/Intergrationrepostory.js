class IntegrationRepository {
  constructor(prisma, redis, httpClient) {
    this.prisma = prisma;
    this.redis = redis;
    this.httpClient = httpClient;
    this.CACHE_TTL = 300; // 5 minutes
  }

  // THIRD-PARTY INTEGRATIONS
  async syncWithLinkedIn(userId, accessToken) {
    const cacheKey = `integration:linkedin:${userId}`;
    
    try {
      // Get LinkedIn profile data
      const profile = await this.fetchLinkedInProfile(accessToken);
      
      // Update user profile
      await this.updateUserFromLinkedIn(userId, profile);
      
      // Cache the sync
      await this.redis.setex(cacheKey, 86400, JSON.stringify({ // 24 hours
        syncedAt: new Date(),
        profile: {
          headline: profile.headline,
          industry: profile.industry,
          summary: profile.summary,
        },
      }));
      
      return {
        success: true,
        data: profile,
        message: 'Profile synced successfully',
      };
    } catch (error) {
      console.error('LinkedIn sync error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async fetchLinkedInProfile(accessToken) {
    const response = await this.httpClient.get('https://api.linkedin.com/v2/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        projection: '(id,localizedFirstName,localizedLastName,localizedHeadline,profilePicture(displayImage~:playableStreams))',
      },
    });
    
    return response.data;
  }

  async updateUserFromLinkedIn(userId, linkedInData) {
    const updates = {
      firstName: linkedInData.localizedFirstName,
      lastName: linkedInData.localizedLastName,
      metadata: {
        update: {
          path: ['linkedIn'],
          value: {
            profileId: linkedInData.id,
            headline: linkedInData.localizedHeadline,
            lastSynced: new Date().toISOString(),
          },
        },
      },
    };
    
    if (linkedInData.profilePicture) {
      updates.avatar = this.extractProfilePictureUrl(linkedInData.profilePicture);
    }
    
    await this.prisma.user.update({
      where: { id: userId },
      data: updates,
    });
    
    // Also update candidate profile if exists
    const candidate = await this.prisma.worker.findFirst({
      where: { userId },
    });
    
    if (candidate && linkedInData.localizedHeadline) {
      await this.prisma.worker.update({
        where: { id: candidate.id },
        data: {
          title: linkedInData.localizedHeadline,
          metadata: {
            update: {
              path: ['linkedInSynced'],
              value: true,
            },
          },
        },
      });
    }
  }

  extractProfilePictureUrl(profilePicture) {
    try {
      const images = profilePicture['displayImage~'].elements;
      const largestImage = images.reduce((largest, current) => {
        return current.data['com.linkedin.digitalmedia.mediaartifact.StillImage'].storageSize.width > 
               largest.data['com.linkedin.digitalmedia.mediaartifact.StillImage'].storageSize.width ? 
               current : largest;
      });
      return largestImage.identifiers[0].identifier;
    } catch (error) {
      return null;
    }
  }

  async syncWithGoogleCalendar(userId, accessToken) {
    try {
      // Get Google Calendar events
      const events = await this.fetchGoogleCalendarEvents(accessToken);
      
      // Sync with our interview system
      const syncedEvents = await this.syncCalendarEvents(userId, events);
      
      return {
        success: true,
        syncedCount: syncedEvents.length,
        events: syncedEvents,
      };
    } catch (error) {
      console.error('Google Calendar sync error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async fetchGoogleCalendarEvents(accessToken) {
    const now = new Date();
    const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    const response = await this.httpClient.get('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      params: {
        timeMin: now.toISOString(),
        timeMax: weekFromNow.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 100,
      },
    });
    
    return response.data.items;
  }

  async syncCalendarEvents(userId, googleEvents) {
    const syncedEvents = [];
    
    for (const event of googleEvents) {
      // Check if this is an interview event
      if (this.isInterviewEvent(event)) {
        const syncedEvent = await this.syncInterviewEvent(userId, event);
        if (syncedEvent) {
          syncedEvents.push(syncedEvent);
        }
      }
    }
    
    return syncedEvents;
  }

  isInterviewEvent(event) {
    const interviewKeywords = ['interview', 'meeting', 'call', 'hiring', 'recruitment'];
    const title = event.summary?.toLowerCase() || '';
    const description = event.description?.toLowerCase() || '';
    
    return interviewKeywords.some(keyword => 
      title.includes(keyword) || description.includes(keyword)
    );
  }

  async syncInterviewEvent(userId, googleEvent) {
    // Extract interview details
    const interviewDetails = this.extractInterviewDetails(googleEvent);
    
    // Check if interview already exists
    const existingInterview = await this.prisma.interview.findFirst({
      where: {
        OR: [
          { metadata: { path: ['googleEventId'], equals: googleEvent.id } },
          {
            scheduledAt: new Date(googleEvent.start.dateTime),
            employer: { userId }, // Assuming user is employer
          },
        ],
      },
    });
    
    if (existingInterview) {
      // Update existing interview
      const updated = await this.prisma.interview.update({
        where: { id: existingInterview.id },
        data: {
          ...interviewDetails,
          metadata: {
            ...existingInterview.metadata,
            googleEventId: googleEvent.id,
            lastSynced: new Date().toISOString(),
          },
        },
      });
      
      return { action: 'updated', interview: updated };
    } else {
      // Create new interview
      // Note: This would need more context to properly create an interview
      return null;
    }
  }

  extractInterviewDetails(googleEvent) {
    return {
      scheduledAt: new Date(googleEvent.start.dateTime),
      duration: this.calculateEventDuration(googleEvent),
      title: googleEvent.summary,
      description: googleEvent.description,
      meetingLink: googleEvent.hangoutLink || googleEvent.conferenceData?.entryPoints?.[0]?.uri,
    };
  }

  calculateEventDuration(googleEvent) {
    const start = new Date(googleEvent.start.dateTime);
    const end = new Date(googleEvent.end.dateTime);
    return (end - start) / (1000 * 60); // Duration in minutes
  }

  // ATS INTEGRATIONS
  async connectATS(userId, atsProvider, credentials) {
    const cacheKey = `integration:ats:${userId}:${atsProvider}`;
    
    try {
      // Validate ATS credentials
      const isValid = await this.validateATSCredentials(atsProvider, credentials);
      
      if (!isValid) {
        throw new Error('Invalid ATS credentials');
      }
      
      // Store ATS connection
      const connection = await this.prisma.integration.create({
        data: {
          userId,
          provider: atsProvider,
          type: 'ATS',
          credentials: this.encryptCredentials(credentials),
          status: 'ACTIVE',
          metadata: {
            connectedAt: new Date().toISOString(),
            lastSync: null,
            syncStatus: 'PENDING',
          },
        },
      });
      
      // Initial sync
      await this.syncATSData(userId, atsProvider);
      
      // Cache the connection
      await this.redis.setex(cacheKey, 3600, JSON.stringify({
        provider: atsProvider,
        connectedAt: new Date(),
      }));
      
      return {
        success: true,
        connectionId: connection.id,
        message: 'ATS connected successfully',
      };
    } catch (error) {
      console.error('ATS connection error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async validateATSCredentials(provider, credentials) {
    // Implement provider-specific validation
    switch (provider) {
      case 'GREENHOUSE':
        return await this.validateGreenhouseCredentials(credentials);
      case 'LEVER':
        return await this.validateLeverCredentials(credentials);
      case 'WORKABLE':
        return await this.validateWorkableCredentials(credentials);
      default:
        throw new Error(`Unsupported ATS provider: ${provider}`);
    }
  }

  async validateGreenhouseCredentials(credentials) {
    const { apiKey } = credentials;
    
    try {
      const response = await this.httpClient.get('https://harvest.greenhouse.io/v1/users', {
        headers: {
          Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
        },
      });
      
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  encryptCredentials(credentials) {
    // Implement encryption logic
    // This is a placeholder - use proper encryption in production
    return Buffer.from(JSON.stringify(credentials)).toString('base64');
  }

  async syncATSData(userId, provider) {
    const connection = await this.prisma.integration.findFirst({
      where: {
        userId,
        provider,
        type: 'ATS',
        status: 'ACTIVE',
      },
    });
    
    if (!connection) {
      throw new Error('ATS connection not found');
    }
    
    const credentials = this.decryptCredentials(connection.credentials);
    
    try {
      // Update sync status
      await this.prisma.integration.update({
        where: { id: connection.id },
        data: {
          metadata: {
            ...connection.metadata,
            syncStatus: 'IN_PROGRESS',
            lastSyncAttempt: new Date().toISOString(),
          },
        },
      });
      
      // Fetch data from ATS
      let atsData;
      switch (provider) {
        case 'GREENHOUSE':
          atsData = await this.fetchGreenhouseData(credentials);
          break;
        case 'LEVER':
          atsData = await this.fetchLeverData(credentials);
          break;
        case 'WORKABLE':
          atsData = await this.fetchWorkableData(credentials);
          break;
      }
      
      // Process and store ATS data
      await this.processATSData(userId, provider, atsData);
      
      // Update sync status
      await this.prisma.integration.update({
        where: { id: connection.id },
        data: {
          metadata: {
            ...connection.metadata,
            syncStatus: 'COMPLETED',
            lastSync: new Date().toISOString(),
            recordsSynced: atsData.jobs?.length || 0,
          },
        },
      });
      
      return {
        success: true,
        syncedJobs: atsData.jobs?.length || 0,
        syncedCandidates: atsData.candidates?.length || 0,
      };
    } catch (error) {
      // Update sync status to failed
      await this.prisma.integration.update({
        where: { id: connection.id },
        data: {
          metadata: {
            ...connection.metadata,
            syncStatus: 'FAILED',
            lastError: error.message,
            lastSyncAttempt: new Date().toISOString(),
          },
        },
      });
      
      throw error;
    }
  }

  decryptCredentials(encrypted) {
    // Implement decryption logic
    return JSON.parse(Buffer.from(encrypted, 'base64').toString());
  }

  async fetchGreenhouseData(credentials) {
    const { apiKey } = credentials;
    const headers = {
      Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`,
    };
    
    const [jobsResponse, candidatesResponse] = await Promise.all([
      this.httpClient.get('https://harvest.greenhouse.io/v1/jobs', { headers }),
      this.httpClient.get('https://harvest.greenhouse.io/v1/candidates', { headers }),
    ]);
    
    return {
      jobs: jobsResponse.data,
      candidates: candidatesResponse.data,
    };
  }

  async processATSData(userId, provider, atsData) {
    // Get employer associated with user
    const employer = await this.prisma.employer.findFirst({
      where: { userId },
    });
    
    if (!employer) {
      throw new Error('No employer found for user');
    }
    
    // Process jobs
    if (atsData.jobs) {
      for (const atsJob of atsData.jobs) {
        await this.syncATSJob(employer.id, provider, atsJob);
      }
    }
    
    // Process candidates
    if (atsData.candidates) {
      for (const atsCandidate of atsData.candidates) {
        await this.syncATSCandidate(employer.id, provider, atsCandidate);
      }
    }
  }

  async syncATSJob(employerId, provider, atsJob) {
    // Check if job already exists
    const existingJob = await this.prisma.job.findFirst({
      where: {
        employerId,
        metadata: {
          path: [`${provider}Id`],
          equals: atsJob.id.toString(),
        },
      },
    });
    
    const jobData = this.mapATSJobToOurFormat(provider, atsJob);
    
    if (existingJob) {
      // Update existing job
      await this.prisma.job.update({
        where: { id: existingJob.id },
        data: {
          ...jobData,
          metadata: {
            ...existingJob.metadata,
            [`${provider}Data`]: atsJob,
            lastSynced: new Date().toISOString(),
          },
        },
      });
    } else {
      // Create new job
      await this.prisma.job.create({
        data: {
          employerId,
          ...jobData,
          metadata: {
            [`${provider}Id`]: atsJob.id.toString(),
            [`${provider}Data`]: atsJob,
            importedAt: new Date().toISOString(),
          },
        },
      });
    }
  }

  mapATSJobToOurFormat(provider, atsJob) {
    // Map ATS job format to our job format
    switch (provider) {
      case 'GREENHOUSE':
        return {
          title: atsJob.name,
          description: atsJob.notes || '',
          requirements: atsJob.requirements || '',
          location: atsJob.location?.name || 'Remote',
          jobType: this.mapGreenhouseJobType(atsJob),
          status: this.mapGreenhouseJobStatus(atsJob),
        };
      default:
        return {
          title: atsJob.title || atsJob.name,
          description: atsJob.description || atsJob.notes || '',
          location: atsJob.location || 'Remote',
          status: 'ACTIVE',
        };
    }
  }

  mapGreenhouseJobType(atsJob) {
    const type = atsJob.employment_type?.toLowerCase() || '';
    if (type.includes('full')) return 'FULL_TIME';
    if (type.includes('part')) return 'PART_TIME';
    if (type.includes('contract')) return 'CONTRACT';
    return 'FULL_TIME';
  }

  mapGreenhouseJobStatus(atsJob) {
    const status = atsJob.status?.toLowerCase() || '';
    if (status === 'open') return 'ACTIVE';
    if (status === 'closed') return 'CLOSED';
    return 'DRAFT';
  }

  // BACKGROUND CHECK INTEGRATIONS
  async initiateBackgroundCheck(candidateId, checkType, metadata = {}) {
    try {
      // Get candidate details
      const candidate = await this.prisma.worker.findUnique({
        where: { id: candidateId },
        include: {
          user: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
        },
      });
      
      if (!candidate) {
        throw new Error('Candidate not found');
      }
      
      // Choose background check provider
      const provider = this.selectBackgroundCheckProvider(checkType);
      
      // Initiate check with provider
      const checkId = await this.initiateProviderBackgroundCheck(provider, {
        candidate: {
          firstName: candidate.user.firstName,
          lastName: candidate.user.lastName,
          email: candidate.user.email,
          phone: candidate.user.phone,
          dateOfBirth: candidate.dateOfBirth,
          ssn: metadata.ssn, // Should be handled securely
        },
        checkType,
        metadata,
      });
      
      // Create background check record
      const backgroundCheck = await this.prisma.backgroundCheck.create({
        data: {
          workerId: candidateId,
          checkType,
          status: 'PENDING',
          provider,
          externalId: checkId,
          metadata: {
            initiatedAt: new Date().toISOString(),
            checkType,
            package: metadata.package || 'STANDARD',
            turnaroundTime: metadata.turnaroundTime || '3_5_DAYS',
          },
        },
      });
      
      return {
        success: true,
        checkId: backgroundCheck.id,
        externalId: checkId,
        estimatedCompletion: this.calculateEstimatedCompletion(checkType),
      };
    } catch (error) {
      console.error('Background check initiation error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  selectBackgroundCheckProvider(checkType) {
    // Logic to select appropriate provider based on check type and region
    const providers = {
      STANDARD: 'CHECKR',
      ENHANCED: 'GOODHIRE',
      INTERNATIONAL: 'HIRE_RIGHT',
    };
    
    return providers[checkType] || 'CHECKR';
  }

  async initiateProviderBackgroundCheck(provider, data) {
    // Implement provider-specific initiation
    switch (provider) {
      case 'CHECKR':
        return await this.initiateCheckrBackgroundCheck(data);
      case 'GOODHIRE':
        return await this.initiateGoodHireBackgroundCheck(data);
      default:
        throw new Error(`Unsupported background check provider: ${provider}`);
    }
  }

  async initiateCheckrBackgroundCheck(data) {
    const response = await this.httpClient.post('https://api.checkr.com/v1/invitations', {
      candidate: {
        first_name: data.candidate.firstName,
        last_name: data.candidate.lastName,
        email: data.candidate.email,
        phone: data.candidate.phone,
        dob: data.candidate.dateOfBirth,
        ssn: data.candidate.ssn,
      },
      package: data.checkType === 'ENHANCED' ? 'driver_pro' : 'tasker_standard',
    }, {
      headers: {
        Authorization: `Bearer ${process.env.CHECKR_API_KEY}`,
      },
    });
    
    return response.data.id;
  }

  calculateEstimatedCompletion(checkType) {
    const estimates = {
      STANDARD: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
      ENHANCED: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days
      INTERNATIONAL: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000), // 10 days
    };
    
    return estimates[checkType] || estimates.STANDARD;
  }

  async handleBackgroundCheckWebhook(provider, event) {
    switch (provider) {
      case 'CHECKR':
        await this.handleCheckrWebhook(event);
        break;
      case 'GOODHIRE':
        await this.handleGoodHireWebhook(event);
        break;
    }
  }

  async handleCheckrWebhook(event) {
    const { type, data } = event;
    
    switch (type) {
      case 'invitation.completed':
        await this.updateBackgroundCheckStatus(data.invitation_id, 'COMPLETED', {
          reportId: data.report_id,
          completedAt: new Date().toISOString(),
        });
        break;
      
      case 'invitation.expired':
        await this.updateBackgroundCheckStatus(data.invitation_id, 'EXPIRED', {
          expiredAt: new Date().toISOString(),
        });
        break;
      
      case 'report.created':
        await this.updateBackgroundCheckWithReport(data.report_id, data);
        break;
    }
  }

  async updateBackgroundCheckStatus(externalId, status, metadata = {}) {
    const backgroundCheck = await this.prisma.backgroundCheck.update({
      where: { externalId },
      data: {
        status,
        metadata: {
          update: {
            path: [],
            value: {
              ...metadata,
              statusUpdatedAt: new Date().toISOString(),
            },
          },
        },
      },
    });
    
    // Notify relevant parties
    await this.notifyBackgroundCheckStatus(backgroundCheck);
  }

  async notifyBackgroundCheckStatus(backgroundCheck) {
    // Get candidate and employer details
    const candidate = await this.prisma.worker.findUnique({
      where: { id: backgroundCheck.workerId },
      include: {
        user: {
          select: { email: true, firstName: true },
        },
      },
    });
    
    // This would typically send notifications to both candidate and employer
    // await this.notificationService.sendBackgroundCheckUpdate(
    //   candidate.user.email,
    //   backgroundCheck.status
    // );
  }

  // VIDEO INTERVIEW INTEGRATIONS
  async scheduleVideoInterview(interviewId, provider = 'ZOOM') {
    const interview = await this.prisma.interview.findUnique({
      where: { id: interviewId },
      include: {
        candidate: {
          include: {
            user: {
              select: { email: true, firstName: true, lastName: true },
            },
          },
        },
        employer: {
          include: {
            user: {
              select: { email: true, firstName: true, lastName: true },
            },
          },
        },
      },
    });
    
    if (!interview) {
      throw new Error('Interview not found');
    }
    
    try {
      let meetingData;
      
      switch (provider) {
        case 'ZOOM':
          meetingData = await this.createZoomMeeting(interview);
          break;
        case 'GOOGLE_MEET':
          meetingData = await this.createGoogleMeet(interview);
          break;
        case 'MICROSOFT_TEAMS':
          meetingData = await this.createTeamsMeeting(interview);
          break;
        default:
          throw new Error(`Unsupported video provider: ${provider}`);
      }
      
      // Update interview with meeting details
      await this.prisma.interview.update({
        where: { id: interviewId },
        data: {
          meetingLink: meetingData.joinUrl,
          metadata: {
            ...interview.metadata,
            videoProvider: provider,
            meetingId: meetingData.id,
            password: meetingData.password,
            dialInNumbers: meetingData.dialInNumbers,
          },
        },
      });
      
      return {
        success: true,
        meetingLink: meetingData.joinUrl,
        meetingId: meetingData.id,
        password: meetingData.password,
      };
    } catch (error) {
      console.error('Video interview scheduling error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async createZoomMeeting(interview) {
    const response = await this.httpClient.post('https://api.zoom.us/v2/users/me/meetings', {
      topic: `Interview: ${interview.candidate.user.firstName} ${interview.candidate.user.lastName}`,
      type: 2, // Scheduled meeting
      start_time: interview.scheduledAt.toISOString(),
      duration: interview.duration,
      timezone: 'UTC',
      password: this.generateMeetingPassword(),
      settings: {
        host_video: true,
        participant_video: true,
        join_before_host: false,
        mute_upon_entry: true,
        waiting_room: true,
        audio: 'both',
        auto_recording: 'cloud', // If recording is needed
      },
    }, {
      headers: {
        Authorization: `Bearer ${this.getZoomAccessToken()}`,
      },
    });
    
    return {
      id: response.data.id,
      joinUrl: response.data.join_url,
      password: response.data.password,
      dialInNumbers: response.data.dial_in_numbers,
    };
  }

  generateMeetingPassword() {
    return Math.random().toString(36).slice(-8);
  }

  getZoomAccessToken() {
    // Implement Zoom OAuth token retrieval
    // This should handle token refresh
    return process.env.ZOOM_ACCESS_TOKEN;
  }

  // SSO INTEGRATIONS
  async setupSSO(employerId, provider, config) {
    try {
      // Validate SSO configuration
      const isValid = await this.validateSSOConfig(provider, config);
      
      if (!isValid) {
        throw new Error('Invalid SSO configuration');
      }
      
      // Generate SSO metadata
      const metadata = this.generateSSOMetadata(provider, config);
      
      // Store SSO configuration
      const ssoConfig = await this.prisma.ssoConfiguration.create({
        data: {
          employerId,
          provider,
          config: this.encryptConfig(config),
          metadata,
          isActive: true,
        },
      });
      
      return {
        success: true,
        configId: ssoConfig.id,
        metadata,
        setupInstructions: this.getSSOSetupInstructions(provider),
      };
    } catch (error) {
      console.error('SSO setup error:', error);
      return {
        success: false,
        error: error.message,
      };
    }
  }

  async validateSSOConfig(provider, config) {
    switch (provider) {
      case 'OKTA':
        return await this.validateOktaConfig(config);
      case 'AZURE_AD':
        return await this.validateAzureADConfig(config);
      case 'GOOGLE_WORKSPACE':
        return await this.validateGoogleWorkspaceConfig(config);
      default:
        throw new Error(`Unsupported SSO provider: ${provider}`);
    }
  }

  async validateOktaConfig(config) {
    const { issuer, clientId, clientSecret } = config;
    
    try {
      // Test Okta configuration
      const response = await this.httpClient.get(`${issuer}/.well-known/openid-configuration`);
      return response.status === 200;
    } catch (error) {
      return false;
    }
  }

  generateSSOMetadata(provider, config) {
    const metadata = {
      provider,
      configuredAt: new Date().toISOString(),
      entityId: `${process.env.APP_URL}/sso/${provider.toLowerCase()}`,
      acsUrl: `${process.env.APP_URL}/api/auth/sso/acs`,
    };
    
    switch (provider) {
      case 'OKTA':
        metadata.ssoUrl = `${config.issuer}/sso/saml`;
        metadata.certificate = config.certificate;
        break;
      case 'AZURE_AD':
        metadata.ssoUrl = `https://login.microsoftonline.com/${config.tenantId}/saml2`;
        metadata.certificate = config.certificate;
        break;
    }
    
    return metadata;
  }

  encryptConfig(config) {
    // Implement configuration encryption
    return Buffer.from(JSON.stringify(config)).toString('base64');
  }

  // INTEGRATION MANAGEMENT
  async getUserIntegrations(userId) {
    const integrations = await this.prisma.integration.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    
    // Group by type
    const grouped = {
      ATS: [],
      CALENDAR: [],
      BACKGROUND_CHECK: [],
      SSO: [],
      OTHER: [],
    };
    
    integrations.forEach(integration => {
      const type = integration.type || 'OTHER';
      if (grouped[type]) {
        grouped[type].push(integration);
      } else {
        grouped.OTHER.push(integration);
      }
    });
    
    return grouped;
  }

  async updateIntegration(integrationId, userId, updates) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });
    
    if (!integration) {
      throw new Error('Integration not found');
    }
    
    if (integration.userId !== userId) {
      throw new Error('Access denied');
    }
    
    const updated = await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        ...updates,
        metadata: {
          ...integration.metadata,
          updatedAt: new Date().toISOString(),
        },
      },
    });
    
    return updated;
  }

  async disconnectIntegration(integrationId, userId) {
    const integration = await this.prisma.integration.findUnique({
      where: { id: integrationId },
    });
    
    if (!integration) {
      throw new Error('Integration not found');
    }
    
    if (integration.userId !== userId) {
      throw new Error('Access denied');
    }
    
    // Perform provider-specific disconnect
    await this.performProviderDisconnect(integration.provider, integration.credentials);
    
    // Update integration status
    await this.prisma.integration.update({
      where: { id: integrationId },
      data: {
        status: 'DISCONNECTED',
        disconnectedAt: new Date(),
        metadata: {
          ...integration.metadata,
          disconnectedAt: new Date().toISOString(),
        },
      },
    });
    
    // Clear related cache
    await this.clearIntegrationCache(userId, integration.provider);
    
    return { success: true };
  }

  async performProviderDisconnect(provider, credentials) {
    // Implement provider-specific disconnect logic
    switch (provider) {
      case 'LINKEDIN':
        // Revoke LinkedIn access token
        break;
      case 'GOOGLE_CALENDAR':
        // Revoke Google Calendar access
        break;
      // Add other providers as needed
    }
  }

  async clearIntegrationCache(userId, provider) {
    const patterns = [
      `integration:${provider}:${userId}`,
      `integrations:${userId}:*`,
    ];
    
    for (const pattern of patterns) {
      const keys = await this.redis.keys(pattern);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    }
  }

  // WEBHOOK MANAGEMENT
  async registerWebhook(userId, webhookData) {
    const webhook = await this.prisma.webhook.create({
      data: {
        userId,
        url: webhookData.url,
        events: webhookData.events,
        secret: this.generateWebhookSecret(),
        isActive: true,
        metadata: {
          registeredAt: new Date().toISOString(),
          lastDelivery: null,
          failureCount: 0,
        },
      },
    });
    
    return {
      webhookId: webhook.id,
      secret: webhook.secret,
      verificationToken: this.generateVerificationToken(),
    };
  }

  generateWebhookSecret() {
    return require('crypto').randomBytes(32).toString('hex');
  }

  generateVerificationToken() {
    return require('crypto').randomBytes(16).toString('hex');
  }

  async triggerWebhook(event, data) {
    const webhooks = await this.prisma.webhook.findMany({
      where: {
        events: { has: event },
        isActive: true,
      },
    });
    
    const results = [];
    
    for (const webhook of webhooks) {
      try {
        const signature = this.createWebhookSignature(webhook.secret, data);
        
        const response = await this.httpClient.post(webhook.url, {
          event,
          data,
          timestamp: new Date().toISOString(),
        }, {
          headers: {
            'X-Webhook-Signature': signature,
            'X-Webhook-Id': webhook.id,
          },
          timeout: 5000, // 5 second timeout
        });
        
        // Update webhook metadata
        await this.prisma.webhook.update({
          where: { id: webhook.id },
          data: {
            metadata: {
              ...webhook.metadata,
              lastDelivery: new Date().toISOString(),
              lastStatus: response.status,
              failureCount: 0,
            },
          },
        });
        
        results.push({
          webhookId: webhook.id,
          success: true,
          status: response.status,
        });
      } catch (error) {
        // Update failure count
        const failureCount = (webhook.metadata?.failureCount || 0) + 1;
        
        await this.prisma.webhook.update({
          where: { id: webhook.id },
          data: {
            metadata: {
              ...webhook.metadata,
              lastError: error.message,
              failureCount,
              lastAttempt: new Date().toISOString(),
            },
            isActive: failureCount < 10, // Disable after 10 failures
          },
        });
        
        results.push({
          webhookId: webhook.id,
          success: false,
          error: error.message,
        });
      }
    }
    
    return results;
  }

  createWebhookSignature(secret, data) {
    const hmac = require('crypto').createHmac('sha256', secret);
    hmac.update(JSON.stringify(data));
    return hmac.digest('hex');
  }

  // API KEY MANAGEMENT
  async createApiKey(userId, keyData) {
    const apiKey = this.generateApiKey();
    const hashedKey = this.hashApiKey(apiKey);
    
    const key = await this.prisma.apiKey.create({
      data: {
        userId,
        name: keyData.name,
        keyHash: hashedKey,
        permissions: keyData.permissions || ['READ'],
        expiresAt: keyData.expiresAt,
        metadata: {
          createdBy: userId,
          createdAt: new Date().toISOString(),
          lastUsed: null,
          usageCount: 0,
        },
        isActive: true,
      },
    });
    
    return {
      id: key.id,
      apiKey, // Only returned once
      name: key.name,
      permissions: key.permissions,
      expiresAt: key.expiresAt,
    };
  }

  generateApiKey() {
    const prefix = 'sk_jp_';
    const random = require('crypto').randomBytes(32).toString('hex');
    return `${prefix}${random}`;
  }

  hashApiKey(apiKey) {
    return require('crypto')
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');
  }

  async validateApiKey(apiKey) {
    const hashedKey = this.hashApiKey(apiKey);
    
    const key = await this.prisma.apiKey.findFirst({
      where: {
        keyHash: hashedKey,
        isActive: true,
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: new Date() } },
        ],
      },
      include: {
        user: {
          select: {
            id: true,
            role: true,
            metadata: true,
          },
        },
      },
    });
    
    if (!key) {
      return null;
    }
    
    // Update usage statistics
    await this.prisma.apiKey.update({
      where: { id: key.id },
      data: {
        metadata: {
          ...key.metadata,
          lastUsed: new Date().toISOString(),
          usageCount: (key.metadata?.usageCount || 0) + 1,
        },
      },
    });
    
    return {
      userId: key.userId,
      permissions: key.permissions,
      user: key.user,
    };
  }

  async getUserApiKeys(userId) {
    const apiKeys = await this.prisma.apiKey.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        permissions: true,
        expiresAt: true,
        isActive: true,
        metadata: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    
    return apiKeys;
  }

  async revokeApiKey(keyId, userId) {
    const key = await this.prisma.apiKey.findUnique({
      where: { id: keyId },
    });
    
    if (!key) {
      throw new Error('API key not found');
    }
    
    if (key.userId !== userId) {
      throw new Error('Access denied');
    }
    
    await this.prisma.apiKey.update({
      where: { id: keyId },
      data: {
        isActive: false,
        revokedAt: new Date(),
        metadata: {
          ...key.metadata,
          revokedAt: new Date().toISOString(),
          revokedBy: userId,
        },
      },
    });
    
    return { success: true };
  }

  // RATE LIMITING
  async checkRateLimit(keyId, endpoint, limit = 100, window = 60) {
    const redisKey = `rate_limit:${keyId}:${endpoint}:${Math.floor(Date.now() / 1000 / window)}`;
    
    const current = await this.redis.incr(redisKey);
    
    if (current === 1) {
      await this.redis.expire(redisKey, window);
    }
    
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      reset: Math.floor(Date.now() / 1000 / window) * window + window,
    };
  }
}

module.exports = IntegrationRepository;
