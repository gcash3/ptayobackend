const rateLimit = require('express-rate-limit');

/**
 * Rate limiter middleware factory
 * @param {Object} options - Rate limiting options
 * @param {number} options.windowMs - Time window in milliseconds (default: 15 minutes)
 * @param {number} options.max - Maximum number of requests per window (default: 100)
 * @param {string} options.message - Custom error message
 * @returns {Function} Express middleware function
 */
const rateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    message = 'Too many requests from this IP, please try again later.',
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: message,
    standardHeaders: true,
    legacyHeaders: false,
    // Custom key generator to include user ID if available
    keyGenerator: (req) => {
      // Use user ID if available, otherwise use IP
      return req.user?.id || req.ip;
    },
    // Custom handler for rate limit exceeded
    handler: (req, res) => {
      res.status(429).json({
        success: false,
        message: message,
        error: 'Rate limit exceeded',
        retryAfter: Math.ceil(windowMs / 1000)
      });
    },
    // Skip rate limiting for certain conditions
    skip: (req) => {
      // Skip for admin users or specific paths
      return req.user?.role === 'admin' || 
             req.path.includes('/health') ||
             req.path.includes('/status');
    }
  });
};

/**
 * Specific rate limiters for different use cases
 */
const rateLimiters = {
  // Strict rate limiter for sensitive operations
  strict: rateLimiter({ windowMs: 60000, max: 5 }), // 5 requests per minute
  
  // Standard rate limiter for general API usage
  standard: rateLimiter({ windowMs: 60000, max: 30 }), // 30 requests per minute
  
  // Loose rate limiter for public endpoints
  loose: rateLimiter({ windowMs: 60000, max: 100 }), // 100 requests per minute
  
  // Auth-specific rate limiter for login/register
  auth: rateLimiter({ 
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 attempts per 15 minutes
    message: 'Too many authentication attempts, please try again later.'
  }),
  
  // QR-specific rate limiter
  qr: rateLimiter({ 
    windowMs: 60000, // 1 minute
    max: 10, // 10 QR operations per minute
    message: 'Too many QR operations, please try again later.'
  }),
  
  // File upload rate limiter
  upload: rateLimiter({ 
    windowMs: 60000, // 1 minute
    max: 5, // 5 uploads per minute
    message: 'Too many file uploads, please try again later.'
  })
};

module.exports = {
  rateLimiter,
  rateLimiters
};
