// routes/token-health.js
const express = require('express');
const router = express.Router();
const { jwtService, jwtMiddleware } = require('../config/jwt.config');

// Check token health
router.get('/token/health',
  jwtMiddleware.authenticate(),
  async (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    
    if (!token) {
      return res.status(400).json({ error: 'No token provided' });
    }

    const health = jwtService.getTokenHealth(token);
    
    res.json({
      tokenHealth: health,
      recommendations: health.recommendations,
    });
  }
);

// Get all active tokens for user
router.get('/tokens',
  jwtMiddleware.authenticate(),
  async (req, res) => {
    const tokens = await getUserTokens(req.user.id);
    
    // Add token health info
    const enriched = await Promise.all(
      tokens.map(async (token) => {
        const health = jwtService.getTokenHealth(token.value);
        return {
          ...token,
          health,
        };
      })
    );

    res.json({ tokens: enriched });
  }
);

// Revoke specific token
router.delete('/tokens/:tokenId',
  jwtMiddleware.authenticate(),
  async (req, res) => {
    const { tokenId } = req.params;
    
    await jwtService.revokeToken(tokenId, 'user_requested', req.user.id);
    
    res.json({ success: true });
  }
);
