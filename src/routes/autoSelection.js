const express = require('express');
const { body, query } = require('express-validator');
const autoSelectionController = require('../controllers/autoSelectionController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   POST /api/v1/auto-selection/select
 * @desc    Auto-select best parking space based on destination
 * @access  Private
 */
router.post('/select',
  authenticateToken,
  [
    body('destinationName').notEmpty().withMessage('Destination name is required'),
    body('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('userPreference').optional().isIn([
      'cheapest', 'closest', 'balanced', 'highest_rated', 'safest', 'covered', 'fastest_access'
    ]).withMessage('Invalid user preference'),
    body('bookingTime').optional().isISO8601().withMessage('Valid booking time required'),
    body('duration').optional().isInt({ min: 1, max: 24 }).withMessage('Duration must be 1-24 hours'),
    body('searchRadius').optional().isInt({ min: 500, max: 5000 }).withMessage('Search radius must be 500-5000m'),
    body('vehicleType').optional().isIn(['car', 'motorcycle', 'van', 'truck']).withMessage('Invalid vehicle type')
  ],
  autoSelectionController.autoSelectParkingSpace
);

/**
 * @route   GET /api/v1/auto-selection/destinations
 * @desc    Get destination suggestions with parking availability
 * @access  Private
 */
router.get('/destinations',
  authenticateToken,
  [
    query('query').optional().isString().isLength({ min: 1, max: 100 }).withMessage('Query must be 1-100 characters'),
    query('userLat').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid user latitude required'),
    query('userLng').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid user longitude required')
  ],
  autoSelectionController.getDestinationSuggestions
);

/**
 * @route   GET /api/v1/auto-selection/preview
 * @desc    Get parking preview for a destination before booking
 * @access  Private
 */
router.get('/preview',
  authenticateToken,
  [
    query('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    query('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    query('destinationName').notEmpty().withMessage('Destination name is required'),
    query('bookingTime').optional().isISO8601().withMessage('Valid booking time required'),
    query('duration').optional().isInt({ min: 1, max: 24 }).withMessage('Duration must be 1-24 hours')
  ],
  autoSelectionController.getDestinationParkingPreview
);

module.exports = router;
