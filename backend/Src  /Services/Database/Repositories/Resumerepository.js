const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

class ResumeRepository {
  // Create or update resume
  async upsertResume(userId, data) {
    return await prisma.resume.upsert({
      where: { userId },
      update: {
        fileUrl: data.fileUrl,
        textContent: data.textContent,
        parsedData: data.parsedData || {},
        skills: data.skills || [],
        experience: data.experience || [],
        education: data.education || [],
        certifications: data.certifications || [],
        languages: data.languages || [],
        version: { increment: 1 },
      },
      create: {
        userId,
        fileUrl: data.fileUrl,
        textContent: data.textContent,
        parsedData: data.parsedData || {},
        skills: data.skills || [],
        experience: data.experience || [],
        education: data.education || [],
        certifications: data.certifications || [],
        languages: data.languages || [],
        version: 1,
      },
    });
  }

  // Get resume by user ID
  async getByUserId(userId) {
    return await prisma.resume.findUnique({
      where: { userId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            profile: true,
          },
        },
      },
    });
  }

  // Get resume by ID
  async getById(resumeId) {
    return await prisma.resume.findUnique({
      where: { id: resumeId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            profile: true,
          },
        },
      },
    });
  }

  // Update resume skills
  async updateSkills(userId, skills) {
    return await prisma.resume.update({
      where: { userId },
      data: {
        skills,
        updatedAt: new Date(),
      },
    });
  }

  // Update resume experience
  async updateExperience(userId, experience) {
    return await prisma.resume.update({
      where: { userId },
      data: {
        experience,
        updatedAt: new Date(),
      },
    });
  }

  // Add AI analysis result to resume
  async addAIAnalysis(userId, analysis) {
    return await prisma.resume.update({
      where: { userId },
      data: {
        aiAnalysis: analysis,
        aiAnalyzedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  // Get resumes by skill
  async findBySkill(skill, options = {}) {
    const { page = 1, limit = 50 } = options;
    const skip = (page - 1) * limit;

    return await prisma.resume.findMany({
      where: {
        skills: {
          has: skill,
        },
      },
      skip,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profile: true,
          },
        },
      },
    });
  }

  // Search resumes
  async searchResumes(query, options = {}) {
    const { page = 1, limit = 50, skills = [] } = options;
    const skip = (page - 1) * limit;

    const where = {};

    if (query) {
      where.OR = [
        { textContent: { contains: query, mode: 'insensitive' } },
        { skills: { hasSome: [query] } },
      ];
    }

    if (skills.length > 0) {
      where.skills = {
        hasSome: skills,
      };
    }

    return await prisma.resume.findMany({
      where,
      skip,
      take: limit,
      orderBy: { updatedAt: 'desc' },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            profile: true,
          },
        },
      },
    });
  }

  // Delete resume
  async deleteResume(userId) {
    return await prisma.resume.delete({
      where: { userId },
    });
  }

  // Get resume version history
  async getVersionHistory(userId) {
    return await prisma.resumeVersion.findMany({
      where: { userId },
      orderBy: { versionNumber: 'desc' },
    });
  }

  // Save resume version snapshot
  async saveVersion(userId, data) {
    const current = await this.getByUserId(userId);
    if (!current) return null;

    return await prisma.resumeVersion.create({
      data: {
        userId,
        versionNumber: current.version,
        data: {
          textContent: current.textContent,
          skills: current.skills,
          experience: current.experience,
          education: current.education,
        },
        createdAt: new Date(),
      },
    });
  }
}

module.exports = new ResumeRepository();
