// utils/jwt.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

class JWTService {
  constructor(config = {}) {
    this.config = {
      accessTokenSecret: config.accessTokenSecret || process.env.JWT_ACCESS_SECRET,
      refreshTokenSecret: config.refreshTokenSecret || process.env.JWT_REFRESH_SECRET,
      resetTokenSecret: config.resetTokenSecret || process.env.JWT_RESET_SECRET,
      verifyTokenSecret: config.verifyTokenSecret || process.env.JWT_VERIFY_SECRET,
      apiTokenSecret: config.apiTokenSecret || process.env.JWT_API_SECRET,
      
      accessTokenExpiry: config.accessTokenExpiry || '15m',
      refreshTokenExpiry: config.refreshTokenExpiry || '7d',
      resetTokenExpiry: config.resetTokenExpiry || '1h',
      verifyTokenExpiry: config.verifyTokenExpiry || '24h',
      apiTokenExpiry: config.apiTokenExpiry || '30d',
      
      algorithm: config.algorithm || 'HS256',
      issuer: config.issuer || process.env.APP_NAME || 'JobPortal',
      audience: config.audience || process.env.APP_URL || 'https://app.example.com',
    };

    // Validate required configuration
    this.validateConfig();
  }

  validateConfig() {
    const required = [
      'accessTokenSecret',
      'refreshTokenSecret',
      'resetTokenSecret',
      'verifyTokenSecret',
      'apiTokenSecret',
    ];

    const missing = required.filter(key => !this.config[key]);
    if (missing.length > 0) {
      throw new Error(`Missing JWT configuration: ${missing.join(', ')}`);
    }

    // Ensure secrets are strong enough in production
    if (process.env.NODE_ENV === 'production') {
      required.forEach(key => {
        if (this.config[key].length < 32) {
          console.warn(`Warning: ${key} is less than 32 characters, consider using a stronger secret`);
        }
      });
    }
  }

  // ACCESS TOKEN
  generateAccessToken(user, additionalClaims = {}) {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      role: user.role,
      email: user.email,
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
      ...additionalClaims,
    };

    const options = {
      expiresIn: this.config.accessTokenExpiry,
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.accessTokenSecret, options),
      payload,
      expiresIn: this.parseExpiry(this.config.accessTokenExpiry),
    };
  }

  verifyAccessToken(token, options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [this.config.algorithm],
      ...options,
    };

    try {
      return jwt.verify(token, this.config.accessTokenSecret, verifyOptions);
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // REFRESH TOKEN
  generateRefreshToken(user, deviceInfo = {}) {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      role: user.role,
      type: 'refresh',
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
      device: {
        ip: deviceInfo.ip || '',
        userAgent: deviceInfo.userAgent || '',
        fingerprint: deviceInfo.fingerprint || '',
      },
    };

    const options = {
      expiresIn: this.config.refreshTokenExpiry,
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.refreshTokenSecret, options),
      payload,
      expiresIn: this.parseExpiry(this.config.refreshTokenExpiry),
    };
  }

  verifyRefreshToken(token, options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [this.config.algorithm],
      ...options,
    };

    try {
      return jwt.verify(token, this.config.refreshTokenSecret, verifyOptions);
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // PASSWORD RESET TOKEN
  generateResetToken(user, additionalClaims = {}) {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      email: user.email,
      type: 'reset',
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
      ...additionalClaims,
    };

    const options = {
      expiresIn: this.config.resetTokenExpiry,
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.resetTokenSecret, options),
      payload,
      expiresIn: this.parseExpiry(this.config.resetTokenExpiry),
    };
  }

  verifyResetToken(token, options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [this.config.algorithm],
      ...options,
    };

    try {
      return jwt.verify(token, this.config.resetTokenSecret, verifyOptions);
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // EMAIL VERIFICATION TOKEN
  generateVerifyToken(user, additionalClaims = {}) {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      email: user.email,
      type: 'verify',
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
      ...additionalClaims,
    };

    const options = {
      expiresIn: this.config.verifyTokenExpiry,
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.verifyTokenSecret, options),
      payload,
      expiresIn: this.parseExpiry(this.config.verifyTokenExpiry),
    };
  }

  verifyVerifyToken(token, options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [this.config.algorithm],
      ...options,
    };

    try {
      return jwt.verify(token, this.config.verifyTokenSecret, verifyOptions);
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // API TOKEN (for machine-to-machine communication)
  generateApiToken(clientId, scopes = [], metadata = {}) {
    const payload = {
      jti: uuidv4(),
      sub: clientId,
      type: 'api',
      scopes,
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
      metadata,
    };

    const options = {
      expiresIn: this.config.apiTokenExpiry,
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.apiTokenSecret, options),
      payload,
      expiresIn: this.parseExpiry(this.config.apiTokenExpiry),
    };
  }

  verifyApiToken(token, requiredScopes = [], options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [this.config.algorithm],
      ...options,
    };

    try {
      const decoded = jwt.verify(token, this.config.apiTokenSecret, verifyOptions);
      
      // Check token type
      if (decoded.type !== 'api') {
        throw new Error('Invalid token type');
      }

      // Check scopes
      if (requiredScopes.length > 0) {
        const hasRequiredScopes = requiredScopes.every(scope => 
          decoded.scopes.includes(scope)
        );
        if (!hasRequiredScopes) {
          throw new Error('Insufficient permissions');
        }
      }

      return decoded;
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // TWO-FACTOR AUTHENTICATION TOKEN
  generate2FAToken(user, method = 'totp') {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      type: '2fa',
      method,
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
    };

    const options = {
      expiresIn: '5m', // Short-lived for 2FA
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.accessTokenSecret, options),
      payload,
      expiresIn: 300, // 5 minutes in seconds
    };
  }

  // INVITATION TOKEN (for inviting users to the platform)
  generateInvitationToken(email, role, invitedBy, metadata = {}) {
    const payload = {
      jti: uuidv4(),
      email,
      role,
      invitedBy,
      type: 'invitation',
      iat: Math.floor(Date.now() / 1000),
      iss: this.config.issuer,
      aud: this.config.audience,
      metadata,
    };

    const options = {
      expiresIn: '7d',
      algorithm: this.config.algorithm,
    };

    return {
      token: jwt.sign(payload, this.config.verifyTokenSecret, options),
      payload,
      expiresIn: this.parseExpiry('7d'),
    };
  }

  verifyInvitationToken(token, options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: [this.config.algorithm],
      ...options,
    };

    try {
      const decoded = jwt.verify(token, this.config.verifyTokenSecret, verifyOptions);
      if (decoded.type !== 'invitation') {
        throw new Error('Invalid token type');
      }
      return decoded;
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // TOKEN PAIR GENERATION (Access + Refresh)
  generateTokenPair(user, deviceInfo = {}) {
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user, deviceInfo);

    return {
      accessToken: accessToken.token,
      refreshToken: refreshToken.token,
      expiresIn: accessToken.expiresIn,
      tokenType: 'Bearer',
    };
  }

  // TOKEN REFRESH
  refreshTokens(refreshToken, user, deviceInfo = {}) {
    // Verify the refresh token
    const decoded = this.verifyRefreshToken(refreshToken);
    if (!decoded || decoded.type !== 'refresh') {
      throw new Error('Invalid refresh token');
    }

    // Check if refresh token has been revoked (this would require database check)
    // In a real implementation, you'd check against a refresh token blacklist/whitelist

    // Generate new token pair
    return this.generateTokenPair(user, deviceInfo);
  }

  // TOKEN DECODING (without verification)
  decodeToken(token) {
    try {
      return jwt.decode(token, { complete: true });
    } catch (error) {
      return null;
    }
  }

  // TOKEN REVOCATION (blacklisting)
  async revokeToken(tokenId, reason = '', revokedBy = 'system') {
    // In a real implementation, you would:
    // 1. Store the token ID in a blacklist (Redis/database)
    // 2. Set an expiration time based on the token's original expiry
    // 3. Log the revocation reason

    const blacklistEntry = {
      jti: tokenId,
      revokedAt: new Date().toISOString(),
      revokedBy,
      reason,
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
    };

    // Store in Redis (example)
    // await redis.setex(`token:blacklist:${tokenId}`, 2592000, JSON.stringify(blacklistEntry));
    
    return blacklistEntry;
  }

  async isTokenRevoked(tokenId) {
    // Check if token is in blacklist
    // const blacklisted = await redis.get(`token:blacklist:${tokenId}`);
    // return blacklisted !== null;
    return false;
  }

  // JWT ERROR HANDLING
  handleJWTError(error) {
    if (error instanceof jwt.TokenExpiredError) {
      return {
        valid: false,
        error: 'TOKEN_EXPIRED',
        message: 'Token has expired',
        expiredAt: error.expiredAt,
      };
    }

    if (error instanceof jwt.JsonWebTokenError) {
      switch (error.message) {
        case 'invalid signature':
          return {
            valid: false,
            error: 'INVALID_SIGNATURE',
            message: 'Invalid token signature',
          };
        case 'jwt malformed':
          return {
            valid: false,
            error: 'MALFORMED_TOKEN',
            message: 'Token is malformed',
          };
        case 'invalid token':
          return {
            valid: false,
            error: 'INVALID_TOKEN',
            message: 'Invalid token',
          };
        default:
          return {
            valid: false,
            error: 'JWT_ERROR',
            message: error.message,
          };
      }
    }

    if (error instanceof jwt.NotBeforeError) {
      return {
        valid: false,
        error: 'TOKEN_NOT_ACTIVE',
        message: 'Token is not yet active',
        activeAt: error.date,
      };
    }

    return {
      valid: false,
      error: 'UNKNOWN_ERROR',
      message: error.message,
    };
  }

  // TOKEN VALIDATION WITH CUSTOM RULES
  validateToken(token, tokenType, options = {}) {
    let decoded;
    
    switch (tokenType) {
      case 'access':
        decoded = this.verifyAccessToken(token, options);
        break;
      case 'refresh':
        decoded = this.verifyRefreshToken(token, options);
        break;
      case 'reset':
        decoded = this.verifyResetToken(token, options);
        break;
      case 'verify':
        decoded = this.verifyVerifyToken(token, options);
        break;
      case 'api':
        decoded = this.verifyApiToken(token, options.scopes || [], options);
        break;
      case 'invitation':
        decoded = this.verifyInvitationToken(token, options);
        break;
      default:
        throw new Error(`Unknown token type: ${tokenType}`);
    }

    // Additional validation rules
    if (options.requiredClaims) {
      for (const [claim, value] of Object.entries(options.requiredClaims)) {
        if (decoded[claim] !== value) {
          throw new Error(`Missing or invalid claim: ${claim}`);
        }
      }
    }

    return decoded;
  }

  // TOKEN ROTATION (for enhanced security)
  rotateRefreshToken(oldRefreshToken, user, deviceInfo = {}) {
    // Verify old refresh token
    const decoded = this.verifyRefreshToken(oldRefreshToken);
    
    // Revoke old token
    this.revokeToken(decoded.jti, 'rotated', user.id);
    
    // Generate new token pair
    return this.generateTokenPair(user, deviceInfo);
  }

  // BATCH TOKEN VERIFICATION
  async verifyMultipleTokens(tokens, tokenType = 'access') {
    const results = await Promise.allSettled(
      tokens.map(token => {
        try {
          const decoded = this.validateToken(token, tokenType);
          return {
            token,
            valid: true,
            decoded,
          };
        } catch (error) {
          return {
            token,
            valid: false,
            error: error.message,
          };
        }
      })
    );

    return results.map(result => result.value);
  }

  // TOKEN EXPIRY CHECK
  getTokenExpiry(token) {
    const decoded = this.decodeToken(token);
    if (!decoded || !decoded.payload.exp) {
      return null;
    }

    const expiryDate = new Date(decoded.payload.exp * 1000);
    const now = new Date();
    const timeLeft = expiryDate - now;

    return {
      expiresAt: expiryDate,
      isExpired: timeLeft <= 0,
      timeLeft: Math.max(0, timeLeft),
      timeLeftFormatted: this.formatTimeLeft(timeLeft),
    };
  }

  formatTimeLeft(milliseconds) {
    if (milliseconds <= 0) return 'Expired';
    
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  // PARSE EXPIRY STRING TO SECONDS
  parseExpiry(expiryString) {
    const units = {
      s: 1,
      m: 60,
      h: 3600,
      d: 86400,
      w: 604800,
      y: 31536000,
    };

    const match = expiryString.match(/^(\d+)([smhdwy])$/);
    if (!match) {
      throw new Error(`Invalid expiry format: ${expiryString}`);
    }

    const [, value, unit] = match;
    return parseInt(value) * units[unit];
  }

  // GENERATE JWT WITH CUSTOM HEADERS
  generateTokenWithHeaders(payload, secret, options = {}) {
    const defaultOptions = {
      expiresIn: this.config.accessTokenExpiry,
      algorithm: this.config.algorithm,
      issuer: this.config.issuer,
      audience: this.config.audience,
    };

    const tokenOptions = {
      ...defaultOptions,
      ...options,
      header: {
        typ: 'JWT',
        alg: this.config.algorithm,
        kid: options.keyId || 'default',
        ...options.headers,
      },
    };

    return jwt.sign(payload, secret, tokenOptions);
  }

  // ASYMMETRIC ENCRYPTION SUPPORT (RSA)
  generateRSAToken(payload, privateKey, options = {}) {
    const tokenOptions = {
      expiresIn: options.expiresIn || this.config.accessTokenExpiry,
      algorithm: 'RS256',
      issuer: this.config.issuer,
      audience: this.config.audience,
      ...options,
    };

    return jwt.sign(payload, privateKey, tokenOptions);
  }

  verifyRSAToken(token, publicKey, options = {}) {
    const verifyOptions = {
      issuer: this.config.issuer,
      audience: this.config.audience,
      algorithms: ['RS256'],
      ...options,
    };

    try {
      return jwt.verify(token, publicKey, verifyOptions);
    } catch (error) {
      return this.handleJWTError(error);
    }
  }

  // TOKEN COMPRESSION (for large payloads)
  generateCompressedToken(payload, secret, options = {}) {
    // Compress payload if it's large
    const compressedPayload = this.compressPayload(payload);
    
    const tokenOptions = {
      expiresIn: options.expiresIn || this.config.accessTokenExpiry,
      algorithm: this.config.algorithm,
      ...options,
    };

    return jwt.sign(compressedPayload, secret, tokenOptions);
  }

  compressPayload(payload) {
    // Simple compression for demonstration
    // In production, consider using a proper compression library
    if (JSON.stringify(payload).length > 1000) {
      return {
        compressed: true,
        data: Buffer.from(JSON.stringify(payload)).toString('base64'),
      };
    }
    return payload;
  }

  decompressPayload(payload) {
    if (payload.compressed && payload.data) {
      return JSON.parse(Buffer.from(payload.data, 'base64').toString());
    }
    return payload;
  }

  // TOKEN FINGERPRINTING (for additional security)
  generateTokenWithFingerprint(user, fingerprint, options = {}) {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      role: user.role,
      email: user.email,
      fp: this.hashFingerprint(fingerprint),
      iat: Math.floor(Date.now() / 1000),
      ...options.claims,
    };

    const tokenOptions = {
      expiresIn: options.expiresIn || this.config.accessTokenExpiry,
      algorithm: this.config.algorithm,
      ...options,
    };

    const token = jwt.sign(payload, this.config.accessTokenSecret, tokenOptions);
    
    return {
      token,
      fingerprint: payload.fp,
    };
  }

  hashFingerprint(fingerprint) {
    return crypto
      .createHash('sha256')
      .update(fingerprint)
      .digest('hex');
  }

  validateTokenWithFingerprint(token, fingerprint) {
    const decoded = this.verifyAccessToken(token);
    
    if (!decoded.fp) {
      throw new Error('Token does not contain fingerprint');
    }

    const expectedFp = this.hashFingerprint(fingerprint);
    if (decoded.fp !== expectedFp) {
      throw new Error('Token fingerprint mismatch');
    }

    return decoded;
  }

  // RATE LIMITING BASED ON TOKEN
  async checkTokenRateLimit(tokenId, action, limit = 100, window = 3600) {
    const key = `rate_limit:${tokenId}:${action}`;
    const current = await this.incrementCounter(key, window);
    
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      reset: Math.floor(Date.now() / 1000) + window,
    };
  }

  async incrementCounter(key, window) {
    // Implement with Redis or similar
    // const current = await redis.incr(key);
    // if (current === 1) {
    //   await redis.expire(key, window);
    // }
    // return current;
    return 1; // Placeholder
  }

  // TOKEN METADATA EXTRACTION
  extractTokenMetadata(token) {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;

    const payload = decoded.payload;
    const now = Math.floor(Date.now() / 1000);

    return {
      tokenId: payload.jti,
      userId: payload.sub,
      role: payload.role,
      type: payload.type || 'access',
      issuedAt: new Date(payload.iat * 1000),
      expiresAt: new Date(payload.exp * 1000),
      isExpired: payload.exp < now,
      timeToExpiry: Math.max(0, payload.exp - now),
      scopes: payload.scopes || [],
      claims: Object.keys(payload).reduce((acc, key) => {
        if (!['jti', 'sub', 'iat', 'exp', 'iss', 'aud'].includes(key)) {
          acc[key] = payload[key];
        }
        return acc;
      }, {}),
    };
  }

  // BULK TOKEN OPERATIONS
  async revokeMultipleTokens(tokenIds, reason = 'bulk_revocation') {
    const results = await Promise.allSettled(
      tokenIds.map(tokenId => this.revokeToken(tokenId, reason, 'system'))
    );

    return {
      total: tokenIds.length,
      succeeded: results.filter(r => r.status === 'fulfilled').length,
      failed: results.filter(r => r.status === 'rejected').length,
      details: results.map((result, index) => ({
        tokenId: tokenIds[index],
        success: result.status === 'fulfilled',
        error: result.status === 'rejected' ? result.reason.message : null,
      })),
    };
  }

  // TOKEN VERSIONING
  generateVersionedToken(user, version = 'v1', options = {}) {
    const payload = {
      jti: uuidv4(),
      sub: user.id,
      role: user.role,
      ver: version,
      iat: Math.floor(Date.now() / 1000),
      ...options.claims,
    };

    const secret = this.getSecretForVersion(version);
    const tokenOptions = {
      expiresIn: options.expiresIn || this.config.accessTokenExpiry,
      algorithm: this.config.algorithm,
      ...options,
    };

    return jwt.sign(payload, secret, tokenOptions);
  }

  getSecretForVersion(version) {
    // Map versions to different secrets for rotation
    const versionSecrets = {
      'v1': this.config.accessTokenSecret,
      'v2': process.env.JWT_ACCESS_SECRET_V2 || this.config.accessTokenSecret,
      'v3': process.env.JWT_ACCESS_SECRET_V3 || this.config.accessTokenSecret,
    };

    return versionSecrets[version] || this.config.accessTokenSecret;
  }

  // TOKEN HEALTH CHECK
  getTokenHealth(token) {
    try {
      const metadata = this.extractTokenMetadata(token);
      if (!metadata) {
        return { status: 'INVALID', score: 0 };
      }

      let score = 100;

      // Deduct points for being close to expiry
      if (metadata.timeToExpiry < 300) { // 5 minutes
        score -= 30;
      } else if (metadata.timeToExpiry < 3600) { // 1 hour
        score -= 10;
      }

      // Check for suspicious claims
      if (metadata.claims.ip && metadata.claims.ip === '0.0.0.0') {
        score -= 20;
      }

      // Determine status
      let status;
      if (metadata.isExpired) {
        status = 'EXPIRED';
        score = 0;
      } else if (score >= 80) {
        status = 'HEALTHY';
      } else if (score >= 50) {
        status = 'WARNING';
      } else {
        status = 'CRITICAL';
      }

      return {
        status,
        score,
        metadata,
        recommendations: this.generateTokenRecommendations(metadata, score),
      };
    } catch (error) {
      return {
        status: 'ERROR',
        score: 0,
        error: error.message,
      };
    }
  }

  generateTokenRecommendations(metadata, score) {
    const recommendations = [];

    if (metadata.timeToExpiry < 300) {
      recommendations.push('Token will expire soon, consider refreshing');
    }

    if (score < 50) {
      recommendations.push('Consider regenerating this token for security');
    }

    if (!metadata.tokenId) {
      recommendations.push('Token missing unique identifier (jti)');
    }

    return recommendations;
  }

  // EXPORT UTILITIES
  exportTokenInfo(token) {
    const decoded = this.decodeToken(token);
    if (!decoded) return null;

    return {
      header: decoded.header,
      payload: decoded.payload,
      signature: decoded.signature,
      encoded: token,
      metadata: this.extractTokenMetadata(token),
      health: this.getTokenHealth(token),
    };
  }

  // STATIC METHODS
  static generateRandomSecret(length = 64) {
    return crypto.randomBytes(length).toString('hex');
  }

  static validateJWTStructure(token) {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return false;
    }

    try {
      parts.forEach(part => {
        Buffer.from(part, 'base64').toString('utf-8');
      });
      return true;
    } catch (error) {
      return false;
    }
  }

  static getAlgorithmInfo(algorithm) {
    const algorithms = {
      HS256: { type: 'symmetric', keySize: 256 },
      HS384: { type: 'symmetric', keySize: 384 },
      HS512: { type: 'symmetric', keySize: 512 },
      RS256: { type: 'asymmetric', keySize: 2048 },
      RS384: { type: 'asymmetric', keySize: 3072 },
      RS512: { type: 'asymmetric', keySize: 4096 },
      ES256: { type: 'asymmetric', keySize: 256 },
      ES384: { type: 'asymmetric', keySize: 384 },
      ES512: { type: 'asymmetric', keySize: 512 },
    };

    return algorithms[algorithm] || null;
  }
}

// Middleware factory for Express
const createJWTMiddleware = (jwtService, options = {}) => {
  return {
    // Authentication middleware
    authenticate: (requiredRole = null, tokenType = 'access') => {
      return async (req, res, next) => {
        try {
          // Extract token from various sources
          const token = extractTokenFromRequest(req, options);
          if (!token) {
            return res.status(401).json({
              error: 'NO_TOKEN',
              message: 'No authentication token provided',
            });
          }

          // Verify token
          const decoded = jwtService.validateToken(token, tokenType, options);
          if (!decoded || !decoded.valid) {
            return res.status(401).json({
              error: 'INVALID_TOKEN',
              message: 'Invalid or expired token',
            });
          }

          // Check if token is revoked
          const isRevoked = await jwtService.isTokenRevoked(decoded.jti);
          if (isRevoked) {
            return res.status(401).json({
              error: 'TOKEN_REVOKED',
              message: 'Token has been revoked',
            });
          }

          // Check role if required
          if (requiredRole && decoded.role !== requiredRole) {
            return res.status(403).json({
              error: 'INSUFFICIENT_PERMISSIONS',
              message: `Required role: ${requiredRole}`,
            });
          }

          // Attach user info to request
          req.user = {
            id: decoded.sub,
            role: decoded.role,
            email: decoded.email,
            tokenId: decoded.jti,
            claims: decoded,
          };

          // Add token metadata
          req.token = {
            type: tokenType,
            expiresAt: decoded.exp ? new Date(decoded.exp * 1000) : null,
          };

          next();
        } catch (error) {
          console.error('Authentication error:', error);
          return res.status(401).json({
            error: 'AUTHENTICATION_FAILED',
            message: error.message,
          });
        }
      };
    },

    // Optional authentication
    optionalAuth: (tokenType = 'access') => {
      return async (req, res, next) => {
        try {
          const token = extractTokenFromRequest(req, options);
          if (token) {
            const decoded = jwtService.validateToken(token, tokenType, options);
            if (decoded && decoded.valid) {
              const isRevoked = await jwtService.isTokenRevoked(decoded.jti);
              if (!isRevoked) {
                req.user = {
                  id: decoded.sub,
                  role: decoded.role,
                  email: decoded.email,
                  tokenId: decoded.jti,
                  claims: decoded,
                };
              }
            }
          }
          next();
        } catch (error) {
          // Don't fail for optional auth, just continue
          next();
        }
      };
    },

    // Rate limiting middleware
    rateLimitByToken: (limit = 100, window = 3600) => {
      return async (req, res, next) => {
        if (!req.user || !req.user.tokenId) {
          return next();
        }

        const action = `${req.method}:${req.path}`;
        const rateLimit = await jwtService.checkTokenRateLimit(
          req.user.tokenId,
          action,
          limit,
          window
        );

        if (!rateLimit.allowed) {
          res.setHeader('X-RateLimit-Limit', limit);
          res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
          res.setHeader('X-RateLimit-Reset', rateLimit.reset);
          
          return res.status(429).json({
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests',
            retryAfter: rateLimit.reset - Math.floor(Date.now() / 1000),
          });
        }

        // Add rate limit headers
        res.setHeader('X-RateLimit-Limit', limit);
        res.setHeader('X-RateLimit-Remaining', rateLimit.remaining);
        res.setHeader('X-RateLimit-Reset', rateLimit.reset);

        next();
      };
    },

    // Token refresh middleware
    refreshToken: () => {
      return async (req, res, next) => {
        try {
          const refreshToken = req.body.refreshToken || 
                              req.headers['x-refresh-token'] ||
                              req.cookies?.refreshToken;

          if (!refreshToken) {
            return res.status(400).json({
              error: 'NO_REFRESH_TOKEN',
              message: 'Refresh token is required',
            });
          }

          const decoded = jwtService.verifyRefreshToken(refreshToken);
          if (!decoded || decoded.type !== 'refresh') {
            return res.status(401).json({
              error: 'INVALID_REFRESH_TOKEN',
              message: 'Invalid refresh token',
            });
          }

          // Get user from database based on decoded.sub (userId)
          // const user = await getUserById(decoded.sub);
          
          // For now, create a mock user
          const user = {
            id: decoded.sub,
            role: decoded.role,
            email: decoded.email,
          };

          // Generate new token pair
          const deviceInfo = {
            ip: req.ip,
            userAgent: req.headers['user-agent'],
          };

          const tokens = jwtService.refreshTokens(refreshToken, user, deviceInfo);

          // Set tokens in response
          res.locals.tokens = tokens;
          next();
        } catch (error) {
          console.error('Token refresh error:', error);
          return res.status(401).json({
            error: 'REFRESH_FAILED',
            message: error.message,
          });
        }
      };
    },
  };
};

// Helper function to extract token from request
function extractTokenFromRequest(req, options = {}) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  if (req.headers['x-access-token']) {
    return req.headers['x-access-token'];
  }

  if (req.headers['x-api-token']) {
    return req.headers['x-api-token'];
  }

  if (req.cookies && req.cookies.accessToken) {
    return req.cookies.accessToken;
  }

  if (req.query.token && options.allowQueryToken) {
    return req.query.token;
  }

  return null;
}

// Token blacklist manager
class TokenBlacklist {
  constructor(redis) {
    this.redis = redis;
    this.prefix = 'token:blacklist:';
  }

  async add(tokenId, expirySeconds = 86400) {
    const key = this.prefix + tokenId;
    await this.redis.setex(key, expirySeconds, 'revoked');
    return true;
  }

  async has(tokenId) {
    const key = this.prefix + tokenId;
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async remove(tokenId) {
    const key = this.prefix + tokenId;
    await this.redis.del(key);
    return true;
  }

  async cleanup() {
    // Tokens are automatically removed by Redis TTL
    // This method could be used for additional cleanup if needed
    return true;
  }
}

// Token validator with caching
class CachedTokenValidator {
  constructor(jwtService, cache, options = {}) {
    this.jwtService = jwtService;
    this.cache = cache;
    this.options = options;
    this.cachePrefix = 'token:valid:';
    this.cacheTtl = options.cacheTtl || 300; // 5 minutes
  }

  async validate(token, tokenType = 'access', options = {}) {
    const cacheKey = this.cachePrefix + this.hashToken(token);
    
    // Check cache first
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Validate token
    const result = this.jwtService.validateToken(token, tokenType, options);
    
    // Cache valid tokens
    if (result && result.valid) {
      await this.cache.setex(cacheKey, this.cacheTtl, JSON.stringify(result));
    }

    return result;
  }

  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  async invalidateCache(token) {
    const cacheKey = this.cachePrefix + this.hashToken(token);
    await this.cache.del(cacheKey);
  }
}

// Token factory for different user types
class TokenFactory {
  constructor(jwtService) {
    this.jwtService = jwtService;
  }

  createCandidateToken(candidate) {
    return this.jwtService.generateAccessToken(candidate, {
      candidateId: candidate.id,
      profileComplete: candidate.profileCompleteness >= 70,
    });
  }

  createEmployerToken(employer) {
    return this.jwtService.generateAccessToken(employer, {
      employerId: employer.id,
      companyId: employer.companyId,
      subscriptionTier: employer.subscriptionTier || 'FREE',
    });
  }

  createAdminToken(admin) {
    return this.jwtService.generateAccessToken(admin, {
      adminId: admin.id,
      permissions: admin.permissions || ['*'],
    });
  }

  createSystemToken() {
    return this.jwtService.generateApiToken('system', ['*'], {
      system: true,
      internal: true,
    });
  }
}

// Token interceptor for logging and monitoring
class TokenInterceptor {
  constructor(options = {}) {
    this.options = options;
    this.logger = options.logger || console;
  }

  intercept(req, res, next) {
    const startTime = Date.now();
    const originalSend = res.send;

    // Intercept response to log token usage
    res.send = function(body) {
      const responseTime = Date.now() - startTime;
      
      // Log token usage if present
      if (req.user) {
        const logEntry = {
          timestamp: new Date().toISOString(),
          userId: req.user.id,
          tokenId: req.user.tokenId,
          endpoint: req.path,
          method: req.method,
          statusCode: res.statusCode,
          responseTime,
          ip: req.ip,
          userAgent: req.headers['user-agent'],
        };

        // Log to console or external service
        this.logger.info('Token usage:', logEntry);
      }

      return originalSend.call(this, body);
    }.bind(this);

    next();
  }
}

// Export everything
module.exports = {
  JWTService,
  createJWTMiddleware,
  TokenBlacklist,
  CachedTokenValidator,
  TokenFactory,
  TokenInterceptor,
  // Helper functions
  extractTokenFromRequest,
};
