// config/jwt.config.js
const { JWTService, createJWTMiddleware } = require('./utils/jwt');

const jwtService = new JWTService({
  accessTokenSecret: process.env.JWT_ACCESS_SECRET,
  refreshTokenSecret: process.env.JWT_REFRESH_SECRET,
  resetTokenSecret: process.env.JWT_RESET_SECRET,
  verifyTokenSecret: process.env.JWT_VERIFY_SECRET,
  apiTokenSecret: process.env.JWT_API_SECRET,
  
  accessTokenExpiry: '15m',
  refreshTokenExpiry: '7d',
  resetTokenExpiry: '1h',
  verifyTokenExpiry: '24h',
  apiTokenExpiry: '30d',
  
  algorithm: 'HS256',
  issuer: 'JobPortal',
  audience: 'https://app.jobportal.com',
});

const jwtMiddleware = createJWTMiddleware(jwtService);

module.exports = { jwtService, jwtMiddleware };
