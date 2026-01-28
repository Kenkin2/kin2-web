class ReportRepository {
  constructor(prisma, redis, storageService) {
    this.prisma = prisma;
    this.redis = redis;
    this.storageService = storageService;
    this.CACHE_TTL = 3600; // 1 hour
  }

  // REPORT GENERATION
  async generateReport(data) {
    const report = await this.prisma.report.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        parameters: data.parameters || {},
        status: 'PENDING',
        metadata: {
          requestedAt: new Date().toISOString(),
          format: data.format || 'PDF',
          deliveryMethod: data.deliveryMethod || 'DOWNLOAD',
        },
      },
    });

    // Start async report generation
    this.generateReportAsync(report.id);

    return report;
  }

  async generateReportAsync(reportId) {
    try {
      const report = await this.prisma.report.findUnique({
        where: { id: reportId },
      });

      if (!report) {
        throw new Error('Report not found');
      }

      // Update status to processing
      await this.prisma.report.update({
        where: { id: reportId },
        data: { status: 'PROCESSING' },
      });

      // Generate report based on type
      let reportData;
      switch (report.type) {
        case 'APPLICATION_ANALYTICS':
          reportData = await this.generateApplicationAnalyticsReport(report);
          break;
        case 'INTERVIEW_ANALYTICS':
          reportData = await this.generateInterviewAnalyticsReport(report);
          break;
        case 'CANDIDATE_POOL':
          reportData = await this.generateCandidatePoolReport(report);
          break;
        case 'HIRING_METRICS':
          reportData = await this.generateHiringMetricsReport(report);
          break;
        case 'SYSTEM_USAGE':
          reportData = await this.generateSystemUsageReport(report);
          break;
        default:
          throw new Error(`Unknown report type: ${report.type}`);
      }

      // Generate file
      const fileBuffer = await this.generateReportFile(reportData, report.metadata.format);

      // Upload to storage
      const filePath = `reports/${report.userId}/${reportId}.${report.metadata.format.toLowerCase()}`;
      const fileUrl = await this.storageService.uploadFile(filePath, fileBuffer);

      // Update report with results
      await this.prisma.report.update({
        where: { id: reportId },
        data: {
          status: 'COMPLETED',
          fileUrl,
          fileSize: fileBuffer.length,
          generatedAt: new Date(),
          metadata: {
            ...report.metadata,
            generationTime: new Date().toISOString(),
            recordCount: reportData.recordCount || 0,
            filePath,
          },
        },
      });

      // Send notification
      await this.sendReportReadyNotification(reportId);

    } catch (error) {
      console.error(`Failed to generate report ${reportId}:`, error);
      
      await this.prisma.report.update({
        where: { id: reportId },
        data: {
          status: 'FAILED',
          metadata: {
            ...report.metadata,
            error: error.message,
            failedAt: new Date().toISOString(),
          },
        },
      });
    }
  }

  async generateApplicationAnalyticsReport(report) {
    const { startDate, endDate, employerId, status } = report.parameters;
    
    const where = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    if (employerId) {
      where.job = { employerId };
    }
    if (status) {
      where.status = status;
    }

    const applications = await this.prisma.application.findMany({
      where,
      include: {
        job: {
          select: {
            title: true,
            employer: {
              select: {
                name: true,
              },
            },
          },
        },
        worker: {
          select: {
            user: {
              select: {
                firstName: true,
                lastName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate statistics
    const stats = await this.prisma.application.groupBy({
      by: ['status'],
      where,
      _count: { id: true },
      _avg: { kfnScore:
