// routes/api-tokens.js
const express = require('express');
const router = express.Router();
const { jwtService, jwtMiddleware } = require('../config/jwt.config');

// Generate API token
router.post('/api-tokens',
  jwtMiddleware.authenticate('ADMIN'),
  async (req, res) => {
    const { name, scopes, expiresIn } = req.body;
    
    const apiToken = jwtService.generateApiToken(
      `client_${Date.now()}`,
      scopes,
      { name }
    );

    // Store token metadata in database
    await storeApiToken({
      tokenId: apiToken.payload.jti,
      name,
      scopes,
      createdBy: req.user.id,
      expiresAt: new Date(Date.now() + apiToken.expiresIn * 1000),
    });

    res.json({
      success: true,
      token: apiToken.token,
      metadata: {
        tokenId: apiToken.payload.jti,
        expiresAt: new Date(Date.now() + apiToken.expiresIn * 1000),
        scopes,
      },
    });
  }
);

// API endpoint using token authentication
router.get('/api/data',
  // Authenticate using API token
  async (req, res, next) => {
    const token = req.headers['x-api-token'];
    
    if (!token) {
      return res.status(401).json({ error: 'API token required' });
    }

    const decoded = jwtService.verifyApiToken(token, ['data:read']);
    if (!decoded || decoded.type !== 'api') {
      return res.status(401).json({ error: 'Invalid API token' });
    }

    req.apiClient = {
      id: decoded.sub,
      scopes: decoded.scopes,
    };

    next();
  },
  async (req, res) => {
    const data = await getAPIData(req.apiClient.scopes);
    res.json(data);
  }
);
