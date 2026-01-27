const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

// Get all jobs (public)
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 20,
      category,
      industry,
      location,
      employmentType,
      experienceLevel,
      remotePreference,
      minSalary,
      maxSalary,
      search,
      sortBy = 'newest'
    } = req.query;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build filter conditions
    const where = {
      status: 'PUBLISHED'
    };

    if (category) where.categoryId = category;
    if (industry) where.industryId = industry;
    if (location) where.location = { contains: location, mode: 'insensitive' };
    if (employmentType) where.employmentType = employmentType;
    if (experienceLevel) where.experienceLevel = experienceLevel;
    if (remotePreference) where.remotePreference = remotePreference;
    
    if (minSalary || maxSalary) {
      where.OR = [];
      if (minSalary) where.OR.push({ salaryMin: { gte: parseInt(minSalary) } });
      if (maxSalary) where.OR.push({ salaryMax: { lte: parseInt(maxSalary) } });
      if (minSalary && maxSalary) {
        where.OR.push({
          AND: [
            { salaryMin: { gte: parseInt(minSalary) } },
            { salaryMax: { lte: parseInt(maxSalary) } }
          ]
        });
      }
    }

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { requirements: { contains: search, mode: 'insensitive' } },
        { location: { contains: search, mode: 'insensitive' } }
      ];
    }

    // Sort options
    const orderBy = {};
    switch (sortBy) {
      case 'newest':
        orderBy.postedDate = 'desc';
        break;
      case 'oldest':
        orderBy.postedDate = 'asc';
        break;
      case 'salary_high':
        orderBy.salaryMax = 'desc';
        break;
      case 'salary_low':
        orderBy.salaryMin = 'asc';
        break;
      case 'applications':
        orderBy.applicationsCount = 'desc';
        break;
      default:
        orderBy.postedDate = 'desc';
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          employer: {
            include: {
              employerProfile: true
            }
          },
          category: true,
          industry: true,
          requiredSkills: {
            include: { skill: true }
          },
          preferredSkills: {
            include: { skill: true }
          },
          _count: {
            select: { applications: true }
          }
        },
        orderBy,
        skip,
        take: parseInt(limit)
      }),
      prisma.job.count({ where })
    ]);

    // Increment view count for each job
    jobs.forEach(job => {
      prisma.job.update({
        where: { id: job.id },
        data: { views: { increment: 1 } }
      }).catch(console.error);
    });

    res.json({
      jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Get jobs error:', error);
    res.status(500).json({ error: 'Failed to get jobs' });
  }
});

// Get single job
router.get('/:id', async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { 
        id: req.params.id,
        status: 'PUBLISHED'
      },
      include: {
        employer: {
          include: {
            employerProfile: true,
            companyReviews: {
              take: 3,
              orderBy: { createdAt: 'desc' }
            }
          }
        },
        category: true,
        industry: true,
        requiredSkills: {
          include: { skill: true }
        },
        preferredSkills: {
          include: { skill: true }
        },
        _count: {
          select: { applications: true }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Increment view count
    await prisma.job.update({
      where: { id: job.id },
      data: { views: { increment: 1 } }
    });

    res.json(job);
  } catch (error) {
    console.error('Get job error:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

// Get job by slug
router.get('/slug/:slug', async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { 
        slug: req.params.slug,
        status: 'PUBLISHED'
      },
      include: {
        employer: {
          include: {
            employerProfile: true
          }
        },
        category: true,
        industry: true,
        requiredSkills: {
          include: { skill: true }
        },
        preferredSkills: {
          include: { skill: true }
        }
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    // Increment view count
    await prisma.job.update({
      where: { id: job.id },
      data: { views: { increment: 1 } }
    });

    res.json(job);
  } catch (error) {
    console.error('Get job by slug error:', error);
    res.status(500).json({ error: 'Failed to get job' });
  }
});

// Get similar jobs
router.get('/:id/similar', async (req, res) => {
  try {
    const job = await prisma.job.findUnique({
      where: { id: req.params.id },
      include: {
        requiredSkills: {
          include: { skill: true }
        },
        category: true
      }
    });

    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    const skillIds = job.requiredSkills.map(js => js.skillId);

    const similarJobs = await prisma.job.findMany({
      where: {
        id: { not: req.params.id },
        status: 'PUBLISHED',
        OR: [
          { categoryId: job.categoryId },
          {
            requiredSkills: {
              some: {
                skillId: { in: skillIds }
              }
            }
          }
        ]
      },
      include: {
        employer: {
          include: {
            employerProfile: true
          }
        },
        category: true,
        _count: {
          select: { applications: true }
        }
      },
      orderBy: { postedDate: 'desc' },
      take: 6
    });

    res.json(similarJobs);
  } catch (error) {
    console.error('Get similar jobs error:', error);
    res.status(500).json({ error: 'Failed to get similar jobs' });
  }
});

// Get job categories
router.get('/categories/all', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      include: {
        _count: {
          select: { jobs: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json(categories);
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// Get industries
router.get('/industries/all', async (req, res) => {
  try {
    const industries = await prisma.industry.findMany({
      include: {
        _count: {
          select: { jobs: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    res.json(industries);
  } catch (error) {
    console.error('Get industries error:', error);
    res.status(500).json({ error: 'Failed to get industries' });
  }
});

// Get skills
router.get('/skills/all', async (req, res) => {
  try {
    const { category, search } = req.query;

    const where = {};
    if (category) where.category = category;
    if (search) where.name = { contains: search, mode: 'insensitive' };

    const skills = await prisma.skill.findMany({
      where,
      orderBy: { popularity: 'desc' },
      take: 100
    });

    res.json(skills);
  } catch (error) {
    console.error('Get skills error:', error);
    res.status(500).json({ error: 'Failed to get skills' });
  }
});

// Get featured jobs
router.get('/featured/all', async (req, res) => {
  try {
    const featuredJobs = await prisma.job.findMany({
      where: {
        status: 'PUBLISHED',
        urgency: 'HIGH'
      },
      include: {
        employer: {
          include: {
            employerProfile: true
          }
        },
        category: true
      },
      orderBy: { postedDate: 'desc' },
      take: 10
    });

    res.json(featuredJobs);
  } catch (error) {
    console.error('Get featured jobs error:', error);
    res.status(500).json({ error: 'Failed to get featured jobs' });
  }
});

// Get recent jobs
router.get('/recent/all', async (req, res) => {
  try {
    const recentJobs = await prisma.job.findMany({
      where: {
        status: 'PUBLISHED'
      },
      include: {
        employer: {
          include: {
            employerProfile: true
          }
        },
        category: true
      },
      orderBy: { postedDate: 'desc' },
      take: 20
    });

    res.json(recentJobs);
  } catch (error) {
    console.error('Get recent jobs error:', error);
    res.status(500).json({ error: 'Failed to get recent jobs' });
  }
});

// Search jobs with filters
router.post('/search', async (req, res) => {
  try {
    const { 
      query,
      filters,
      page = 1,
      limit = 20,
      sortBy = 'relevance'
    } = req.body;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Build search conditions
    const where = {
      status: 'PUBLISHED'
    };

    if (query) {
      where.OR = [
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        { requirements: { contains: query, mode: 'insensitive' } },
        { location: { contains: query, mode: 'insensitive' } }
      ];
    }

    // Apply filters
    if (filters) {
      if (filters.categoryId) where.categoryId = filters.categoryId;
      if (filters.industryId) where.industryId = filters.industryId;
      if (filters.employmentType) where.employmentType = filters.employmentType;
      if (filters.experienceLevel) where.experienceLevel = filters.experienceLevel;
      if (filters.remotePreference) where.remotePreference = filters.remotePreference;
      if (filters.location) where.location = { contains: filters.location, mode: 'insensitive' };
      
      if (filters.salaryRange) {
        where.AND = [
          { salaryMin: { gte: filters.salaryRange.min } },
          { salaryMax: { lte: filters.salaryRange.max } }
        ];
      }

      if (filters.skills && filters.skills.length > 0) {
        where.requiredSkills = {
          some: {
            skillId: { in: filters.skills }
          }
        };
      }
    }

    // Sort options
    const orderBy = {};
    switch (sortBy) {
      case 'relevance':
        // For relevance, we might want to implement more sophisticated ranking
        orderBy.postedDate = 'desc';
        break;
      case 'date':
        orderBy.postedDate = 'desc';
        break;
      case 'salary':
        orderBy.salaryMax = 'desc';
        break;
      default:
        orderBy.postedDate = 'desc';
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({
        where,
        include: {
          employer: {
            include: {
              employerProfile: true
            }
          },
          category: true,
          industry: true,
          requiredSkills: {
            include: { skill: true }
          },
          _count: {
            select: { applications: true }
          }
        },
        orderBy,
        skip,
        take: parseInt(limit)
      }),
      prisma.job.count({ where })
    ]);

    res.json({
      jobs,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Search jobs error:', error);
    res.status(500).json({ error: 'Failed to search jobs' });
  }
});

// Get job statistics
router.get('/stats/overview', async (req, res) => {
  try {
    const [
      totalJobs,
      newJobsToday,
      totalApplications,
      avgSalary,
      popularCategories,
      popularLocations
    ] = await Promise.all([
      prisma.job.count({ where: { status: 'PUBLISHED' } }),
      prisma.job.count({
        where: {
          status: 'PUBLISHED',
          postedDate: {
            gte: new Date(new Date().setHours(0, 0, 0, 0))
          }
        }
      }),
      prisma.application.count(),
      prisma.job.aggregate({
        where: { 
          status: 'PUBLISHED',
          salaryMax: { not: null }
        },
        _avg: {
          salaryMax: true
        }
      }),
      prisma.category.findMany({
        include: {
          _count: {
            select: { jobs: true }
          }
        },
        orderBy: {
          jobs: { _count: 'desc' }
        },
        take: 5
      }),
      prisma.job.groupBy({
        by: ['location'],
        where: { status: 'PUBLISHED' },
        _count: {
          location: true
        },
        orderBy: {
          _count: {
            location: 'desc'
          }
        },
        take: 5
      })
    ]);

    res.json({
      totalJobs,
      newJobsToday,
      totalApplications,
      avgSalary: avgSalary._avg.salaryMax || 0,
      popularCategories,
      popularLocations: popularLocations.map(loc => ({
        location: loc.location,
        count: loc._count.location
      }))
    });
  } catch (error) {
    console.error('Get job stats error:', error);
    res.status(500).json({ error: 'Failed to get job statistics' });
  }
});

module.exports = router;
