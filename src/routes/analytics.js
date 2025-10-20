const express = require('express');
const { getDashboardAnalytics } = require('../controllers/analyticsController');
const { authenticateToken } = require('../middleware/auth');
const logger = require('../config/logger');

const router = express.Router();

// Add logging middleware for all analytics routes
router.use((req, res, next) => {
  logger.info(`📊 [ANALYTICS-ROUTE] ${req.method} ${req.originalUrl} accessed`, {
    method: req.method,
    originalUrl: req.originalUrl,
    query: req.query,
    timestamp: new Date().toISOString()
  });
  next();
});

/**
 * @route   GET /api/v1/analytics/test
 * @desc    Test route to verify analytics routing works
 * @access  Public (for testing)
 */
router.get('/test', (req, res) => {
  logger.info('🧪 [ANALYTICS] Test route accessed successfully');
  res.json({
    status: 'success',
    message: 'Analytics routes are working!',
    timestamp: new Date().toISOString()
  });
});

/**
 * @route   GET /api/v1/analytics/dashboard
 * @desc    Get comprehensive dashboard analytics for landlord
 * @access  Private (Landlord only)
 */
router.get('/dashboard', authenticateToken, getDashboardAnalytics);

module.exports = router;