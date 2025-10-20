const express = require('express');
const { body, query } = require('express-validator');
const smartBookingController = require('../controllers/smartBookingController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/v1/smart-booking/recommendations
 * @desc    Get smart booking recommendations for a destination
 * @access  Private
 */
router.get('/recommendations', 
  authenticateToken,
  [
    query('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    query('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    query('bookingTime').optional().isISO8601().withMessage('Valid booking time required'),
    query('duration').optional().isInt({ min: 1, max: 24 }).withMessage('Duration must be 1-24 hours'),
    query('preference').optional().isIn(['cheapest', 'closest', 'balanced', 'highest_rated', 'safest', 'covered', 'fastest_access']).withMessage('Invalid preference'),
    query('searchRadius').optional().isInt({ min: 500, max: 5000 }).withMessage('Search radius must be 500-5000m')
  ],
  smartBookingController.getSmartRecommendations
);

/**
 * @route   POST /api/v1/smart-booking/create
 * @desc    Create a smart booking with auto-selected space
 * @access  Private
 */
router.post('/create',
  authenticateToken,
  [
    body('spaceId').isMongoId().withMessage('Valid parking space ID required'),
    body('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('userCurrentLat').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid user current latitude'),
    body('userCurrentLng').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid user current longitude'),
    body('vehicleId').isMongoId().withMessage('Valid vehicle ID required'),
    body('totalAmount').isFloat({ min: 0 }).withMessage('Valid total amount required'),
    body('bookingTime').optional().isISO8601().withMessage('Valid booking time required'),
    body('duration').optional().isInt({ min: 1, max: 24 }).withMessage('Duration must be 1-24 hours'),
    body('preference').optional().isIn(['cheapest', 'closest', 'balanced', 'highest_rated', 'safest', 'covered', 'fastest_access']).withMessage('Invalid preference'),
    body('userNotes').optional().isString().isLength({ max: 500 }).withMessage('Notes too long')
  ],
  smartBookingController.createSmartBooking
);

/**
 * @route   GET /api/v1/smart-booking/pricing/:spaceId
 * @desc    Get dynamic pricing for a specific parking space
 * @access  Private
 */
router.get('/pricing/:spaceId',
  authenticateToken,
  [
    query('bookingTime').optional().isISO8601().withMessage('Valid booking time required'),
    query('duration').optional().isInt({ min: 1, max: 24 }).withMessage('Duration must be 1-24 hours')
  ],
  smartBookingController.getDynamicPricing
);

/**
 * @route   GET /api/v1/smart-booking/price-prediction/:spaceId
 * @desc    Get price predictions for next few hours
 * @access  Private
 */
router.get('/price-prediction/:spaceId',
  authenticateToken,
  smartBookingController.getPricePrediction
);

/**
 * @route   POST /api/v1/smart-booking/compare
 * @desc    Compare traditional vs smart booking options
 * @access  Private
 */
router.post('/compare',
  authenticateToken,
  [
    body('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    body('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    body('selectedSpaceId').optional().isMongoId().withMessage('Valid space ID for traditional booking'),
    body('bookingTime').optional().isISO8601().withMessage('Valid booking time required'),
    body('duration').optional().isInt({ min: 1, max: 24 }).withMessage('Duration must be 1-24 hours')
  ],
  smartBookingController.compareBookingOptions
);

/**
 * @route   GET /api/v1/smart-booking/available-count
 * @desc    Get count of available parking spaces near destination
 * @access  Public
 */
router.get('/available-count',
  [
    query('destinationLat').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    query('destinationLng').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    query('searchRadius').optional().isInt({ min: 500, max: 5000 }).withMessage('Search radius must be 500-5000m')
  ],
  smartBookingController.getAvailableSpacesCount
);

/**
 * @route   GET /api/v1/smart-booking/debug/all-spaces
 * @desc    Get all parking spaces for debugging
 * @access  Public (for testing only)
 */
router.get('/debug/all-spaces', smartBookingController.getAllParkingSpaces);

module.exports = router;

