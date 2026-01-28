// config/redis-jwt.js
const Redis = require('ioredis');
const { JWTService, TokenBlacklist } = require('./utils/jwt');

const redis = new Redis(process.env.REDIS_URL);

const tokenBlacklist = new TokenBlacklist(redis);

const jwtService = new JWTService({
  // ... config
});

// Override isTokenRevoked method
jwtService.isTokenRevoked = async function(tokenId) {
  return await tokenBlacklist.has(tokenId);
};

// Override revokeToken method
jwtService.revokeToken = async function(tokenId, reason, revokedBy) {
  const blacklistEntry = {
    jti: tokenId,
    revokedAt: new Date().toISOString(),
    revokedBy,
    reason,
  };

  // Store in Redis with 30-day expiry
  await tokenBlacklist.add(tokenId, 30 * 24 * 60 * 60);
  
  // Also log to database
  await logTokenRevocation(blacklistEntry);

  return blacklistEntry;
};

module.exports = { jwtService, tokenBlacklist };
