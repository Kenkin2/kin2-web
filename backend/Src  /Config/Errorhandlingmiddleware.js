// middleware/error-handler.js
const { jwtService } = require('../config/jwt.config');

function jwtErrorHandler(err, req, res, next) {
  if (err.name === 'JsonWebTokenError') {
    const errorInfo = jwtService.handleJWTError(err);
    
    return res.status(401).json({
      error: errorInfo.error,
      message: errorInfo.message,
      code: 'JWT_ERROR',
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      error: 'TOKEN_EXPIRED',
      message: 'Access token has expired',
      code: 'TOKEN_EXPIRED',
      expiredAt: err.expiredAt,
    });
  }

  if (err.name === 'NotBeforeError') {
    return res.status(401).json({
      error: 'TOKEN_NOT_ACTIVE',
      message: 'Token is not yet valid',
      code: 'TOKEN_NOT_ACTIVE',
      activeAt: err.date,
    });
  }

  next(err);
}

// Usage in Express app
app.use(jwtErrorHandler);
