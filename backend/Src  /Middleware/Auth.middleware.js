const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const authMiddleware = {
  verifyToken: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'No token provided' });
      }

      const token = authHeader.split(' ')[1];
      
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        
        // Check if user exists and is active
        const user = await prisma.user.findUnique({
          where: { id: decoded.userId },
          select: { id: true, role: true, status: true }
        });

        if (!user) {
          return res.status(401).json({ error: 'User not found' });
        }

        if (user.status !== 'ACTIVE') {
          return res.status(403).json({ 
            error: 'Account not active', 
            status: user.status 
          });
        }

        // Attach user info to request
        req.userId = decoded.userId;
        req.userRole = decoded.role;
        
        next();
      } catch (tokenError) {
        if (tokenError.name === 'TokenExpiredError') {
          return res.status(401).json({ error: 'Token expired' });
        }
        return res.status(401).json({ error: 'Invalid token' });
      }
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({ error: 'Authentication failed' });
    }
  },

  authorizeRoles: (...allowedRoles) => {
    return (req, res, next) => {
      if (!req.userRole) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      if (!allowedRoles.includes(req.userRole)) {
        return res.status(403).json({ 
          error: 'Access denied. Insufficient permissions.',
          required: allowedRoles,
          current: req.userRole
        });
      }

      next();
    };
  },

  optionalAuth: async (req, res, next) => {
    try {
      const authHeader = req.headers.authorization;
      
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        
        try {
          const decoded = jwt.verify(token, process.env.JWT_SECRET);
          
          const user = await prisma.user.findUnique({
            where: { id: decoded.userId },
            select: { id: true, role: true, status: true }
          });

          if (user && user.status === 'ACTIVE') {
            req.userId = decoded.userId;
            req.userRole = decoded.role;
          }
        } catch (tokenError) {
          // Token is invalid, but that's OK for optional auth
          console.log('Optional auth token invalid:', tokenError.message);
        }
      }

      next();
    } catch (error) {
      console.error('Optional auth middleware error:', error);
      next();
    }
  }
};

module.exports = authMiddleware;
