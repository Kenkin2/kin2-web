/**
 * 404 Not Found handler middleware
 */

const notFoundHandler = (req, res, next) => {
  const error = new Error(`Route ${req.method} ${req.originalUrl} not found`);
  error.statusCode = 404;
  error.status = 'fail';
  next(error);
};

module.exports = { notFoundHandler };
