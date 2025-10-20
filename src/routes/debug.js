const express = require('express');
const { debugAnalytics } = require('../controllers/debugController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/v1/debug/analytics/:userId
 * @desc    Debug analytics data for a specific user
 * @access  Private (for debugging only)
 */
router.get('/analytics/:userId', authenticateToken, debugAnalytics);

module.exports = router;