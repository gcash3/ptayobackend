const express = require('express');
const { query } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const aiSuggestionsController = require('../controllers/aiSuggestionsController');

const router = express.Router();

// Protect all routes
router.use(authenticateToken);

// Validation rules
const getSuggestionsValidation = [
  query('filterType').optional().isIn(['nearby', 'price', 'rating', 'availability'])
    .withMessage('Invalid filter type - only nearby, price, rating, and availability are supported'),
  query('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required if provided'),
  query('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required if provided'),
  query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20'),
  query('vehicleType').optional().isString().withMessage('Vehicle type must be a string'),
  validateRequest
];

const getSmartSuggestionsValidation = [
  query('latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required if provided'),
  query('longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required if provided'),
  validateRequest
];

/**
 * @route   GET /api/v1/suggestions/parking
 * @desc    Get AI-driven parking suggestions based on user preferences and context
 * @access  Private
 */
router.get('/parking', getSuggestionsValidation, aiSuggestionsController.getAiDrivenParkingSuggestions);

/**
 * @route   GET /api/v1/suggestions/filter-options
 * @desc    Get available filter options based on user patterns
 * @access  Private
 */
router.get('/filter-options', aiSuggestionsController.getFilterOptions);

/**
 * @route   GET /api/v1/suggestions/smart
 * @desc    Get smart contextual suggestions based on current time and location
 * @access  Private
 */
router.get('/smart', getSmartSuggestionsValidation, aiSuggestionsController.getSmartContextualSuggestions);

module.exports = router;