const logger = require('../config/logger');
const errorTrackingService = require('../services/errorTrackingService');

// Custom error class for API errors
class AppError extends Error {
  constructor(message, statusCode) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

// Handle JWT errors
const handleJWTError = () =>
  new AppError('Invalid token. Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again.', 401);

// Handle Mongoose cast errors
const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

// Handle Mongoose duplicate field errors
const handleDuplicateFieldsDB = (err) => {
  const field = Object.keys(err.keyValue)[0];
  const value = err.keyValue[field];
  const message = `${field} '${value}' already exists. Please use another value!`;
  return new AppError(message, 400);
};

// Handle Mongoose validation errors
const handleValidationErrorDB = (err) => {
  const errors = Object.values(err.errors).map(el => el.message);
  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

// Handle rate limit errors
const handleRateLimitError = () => {
  return new AppError('Too many requests from this IP, please try again later.', 429);
};

// Log API errors safely
const logApiError = (message, error, req = null) => {
  try {
    const logData = {
      errorName: error.name,
      errorMessage: error.message,
      errorStack: error.stack,
      ...(req && {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        body: req.body ? JSON.stringify(req.body).substring(0, 500) : 'No body', // Limit body size
        ...(req.user && { userId: req.user.id })
      })
    };
    
    // Use standard logger.error if apiError is not available
    if (typeof logger.apiError === 'function') {
      logger.apiError(message, error, req);
    } else {
      logger.error(message, logData);
    }
  } catch (logError) {
    // Fallback to console if logger fails
    console.error('Logger error:', logError);
    console.error('Original error:', message, error.message);
  }
};

// Send error response for development
const sendErrorDev = (err, req, res) => {
  // Log the full error for debugging
  logApiError('Development Error', err, req);

  // API error
  if (req.originalUrl.startsWith('/api')) {
    return res.status(err.statusCode).json({
      status: err.status,
      error: err,
      message: err.message,
      stack: err.stack,
      timestamp: new Date().toISOString(),
      path: req.originalUrl,
      method: req.method
    });
  }

  // Rendered website error (if you have web routes)
  return res.status(err.statusCode).json({
    status: err.status,
    message: err.message,
    timestamp: new Date().toISOString()
  });
};

// Send error response for production
const sendErrorProd = (err, req, res) => {
  // API error
  if (req.originalUrl.startsWith('/api')) {
    // Operational, trusted error: send message to client
    if (err.isOperational) {
      return res.status(err.statusCode).json({
        status: err.status,
        message: err.message,
        timestamp: new Date().toISOString(),
        ...(err.statusCode === 422 && err.errors && { errors: err.errors })
      });
    }
    
    // Programming or other unknown error: don't leak error details
    logApiError(`Unhandled Error: ${err.name || 'Unknown'} - ${err.message || 'No message'}`, err, req);
    
    return res.status(500).json({
      status: 'error',
      message: 'Something went wrong!',
      timestamp: new Date().toISOString()
    });
  }

  // Rendered website error (if you have web routes)
  if (err.isOperational) {
    return res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
      timestamp: new Date().toISOString()
    });
  }

  // Programming or other unknown error: don't leak error details
  logApiError(`Unhandled Non-API Error: ${err.name || 'Unknown'} - ${err.message || 'No message'}`, err, req);
  
  return res.status(500).json({
    status: 'error',
    message: 'Something went wrong!',
    timestamp: new Date().toISOString()
  });
};

// Enhanced Global error handling middleware with tracking
const globalErrorHandler = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  // Track the error with our error tracking service
  try {
    const context = {
      statusCode: err.statusCode,
      endpoint: req.path,
      method: req.method,
      userId: req.user?.id || req.user?._id,
      userAgent: req.get('User-Agent'),
      ip: req.ip,
      requestId: req.id,
      additional: {
        query: req.query,
        params: req.params,
        body: Object.keys(req.body || {}).length > 0 ?
              JSON.stringify(req.body).substring(0, 500) : undefined
      }
    };

    errorTrackingService.trackError(err, context);
  } catch (trackingError) {
    logger.error('Failed to track error:', trackingError);
  }

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, req, res);
  } else {
    let error = { ...err };
    error.message = err.message;

    // Handle specific error types
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (error.code === 11000) error = handleDuplicateFieldsDB(error);
    if (error.name === 'ValidationError') error = handleValidationErrorDB(error);
    if (error.name === 'JsonWebTokenError') error = handleJWTError();
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    if (error.statusCode === 429) error = handleRateLimitError();

    sendErrorProd(error, req, res);
  }
};

// Async error handler wrapper
const catchAsync = (fn) => {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
};

// 404 handler for API routes
const notFound = (req, res, next) => {
  const error = new AppError(`Not found - ${req.originalUrl}`, 404);
  next(error);
};

// Validation error formatter
const formatValidationErrors = (errors) => {
  return errors.array().map(error => ({
    field: error.path || error.param,
    message: error.msg,
    value: error.value
  }));
};

// Create validation error
const createValidationError = (errors) => {
  const formattedErrors = formatValidationErrors(errors);
  const error = new AppError('Validation failed', 422);
  error.errors = formattedErrors;
  return error;
};

module.exports = {
  AppError,
  globalErrorHandler,
  catchAsync,
  notFound,
  formatValidationErrors,
  createValidationError
}; 