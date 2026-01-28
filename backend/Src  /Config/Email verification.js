// routes/verify.js
const express = require('express');
const router = express.Router();
const { jwtService } = require('../config/jwt.config');

// Send verification email
router.post('/send-verification', 
  jwtMiddleware.authenticate(),
  async (req, res) => {
    const user = await getUserById(req.user.id);
    
    const verifyToken = jwtService.generateVerifyToken(user);
    
    await sendVerificationEmail(user.email, verifyToken.token);
    
    res.json({ success: true });
  }
);

// Verify email
router.get('/verify-email', async (req, res) => {
  const { token } = req.query;

  const decoded = jwtService.verifyVerifyToken(token);
  if (!decoded || decoded.type !== 'verify') {
    return res.redirect('/verification-failed');
  }

  // Mark email as verified
  await markEmailAsVerified(decoded.sub);

  // Revoke verification token
  await jwtService.revokeToken(decoded.jti, 'email_verified', decoded.sub);

  res.redirect('/verification-success');
});
