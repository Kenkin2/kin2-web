// routes/auth.js
const express = require('express');
const router = express.Router();
const { jwtService, jwtMiddleware } = require('../config/jwt.config');

// Login endpoint
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  
  // Validate credentials
  const user = await validateCredentials(email, password);
  
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  // Generate tokens
  const deviceInfo = {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    fingerprint: req.headers['x-device-fingerprint'],
  };

  const tokens = jwtService.generateTokenPair(user, deviceInfo);

  // Store refresh token in database
  await storeRefreshToken(user.id, tokens.refreshToken);

  res.json({
    success: true,
    tokens,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
    },
  });
});

// Refresh token endpoint
router.post('/refresh', jwtMiddleware.refreshToken(), (req, res) => {
  res.json({
    success: true,
    tokens: res.locals.tokens,
  });
});

// Logout endpoint
router.post('/logout', jwtMiddleware.authenticate(), async (req, res) => {
  // Revoke the current token
  await jwtService.revokeToken(req.user.tokenId, 'user_logout', req.user.id);
  
  // Clear refresh token from database
  await clearRefreshToken(req.user.id);

  res.json({ success: true });
});

// Protected route
router.get('/profile', 
  jwtMiddleware.authenticate(),
  async (req, res) => {
    const profile = await getUserProfile(req.user.id);
    res.json(profile);
  }
);

// Role-based route
router.get('/admin/dashboard',
  jwtMiddleware.authenticate('ADMIN'),
  async (req, res) => {
    const dashboard = await getAdminDashboard();
    res.json(dashboard);
  }
);

// Optional authentication route
router.get('/public/data',
  jwtMiddleware.optionalAuth(),
  async (req, res) => {
    const data = await getPublicData(req.user);
    res.json(data);
  }
);

module.exports = router;
