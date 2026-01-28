// routes/password.js
const express = require('express');
const router = express.Router();
const { jwtService } = require('../config/jwt.config');

// Request password reset
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  
  const user = await getUserByEmail(email);
  if (!user) {
    // Don't reveal if user exists for security
    return res.json({ success: true });
  }

  // Generate reset token
  const resetToken = jwtService.generateResetToken(user);

  // Send reset email
  await sendResetEmail(user.email, resetToken.token);

  res.json({ success: true });
});

// Reset password
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;

  // Verify reset token
  const decoded = jwtService.verifyResetToken(token);
  if (!decoded || decoded.type !== 'reset') {
    return res.status(400).json({ error: 'Invalid or expired reset token' });
  }

  // Update password
  await updatePassword(decoded.sub, password);

  // Revoke the reset token
  await jwtService.revokeToken(decoded.jti, 'password_reset', decoded.sub);

  res.json({ success: true });
});
