// advanced-token-examples.js
const { jwtService } = require('./config/jwt.config');

// Token with custom claims
const tokenWithClaims = jwtService.generateAccessToken(user, {
  permissions: ['read:profile', 'write:profile'],
  department: 'engineering',
  location: 'remote',
});

// Token with fingerprint
const fingerprint = generateDeviceFingerprint(req);
const { token, fingerprint: fp } = jwtService.generateTokenWithFingerprint(
  user,
  fingerprint
);

// Validate with fingerprint
try {
  const decoded = jwtService.validateTokenWithFingerprint(token, fingerprint);
  console.log('Valid token with matching fingerprint');
} catch (error) {
  console.error('Token validation failed:', error.message);
}

// Batch token validation
const tokens = [token1, token2, token3];
const results = await jwtService.verifyMultipleTokens(tokens, 'access');
console.log('Valid tokens:', results.filter(r => r.valid).length);

// Token compression for large payloads
const largePayload = {
  // ... large data set
  permissions: ['*'],
  preferences: { /* ... */ },
  metadata: { /* ... */ },
};

const compressedToken = jwtService.generateCompressedToken(
  largePayload,
  jwtService.config.accessTokenSecret
);

// Token versioning for secret rotation
const v1Token = jwtService.generateVersionedToken(user, 'v1');
const v2Token = jwtService.generateVersionedToken(user, 'v2');
