const express = require('express');
const { body, query } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const recentLocationsController = require('../controllers/recentLocationsController');

const router = express.Router();

// Protect all routes
router.use(authenticateToken);

// Validation rules
const addLocationValidation = [
  body('name').notEmpty().withMessage('Location name is required'),
  body('address').notEmpty().withMessage('Address is required'),
  body('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
  body('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
  body('type').optional().isIn(['search', 'manual', 'bookmark', 'frequent_location']).withMessage('Invalid location type'),
  validateRequest
];

const getLocationsValidation = [
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  validateRequest
];

/**
 * @route   GET /api/v1/recent-locations
 * @desc    Get user's recent/frequent locations
 * @access  Private
 */
router.get('/', getLocationsValidation, recentLocationsController.getRecentLocations);

/**
 * @route   GET /api/v1/recent-locations/ai-driven
 * @desc    Get AI-driven recent locations (max 3) based on user patterns
 * @access  Private
 */
router.get('/ai-driven', [
  query('latitude').optional().isFloat().withMessage('Valid latitude is required if provided'),
  query('longitude').optional().isFloat().withMessage('Valid longitude is required if provided'),
  validateRequest
], recentLocationsController.getAiDrivenRecentLocations);

/**
 * @route   GET /api/v1/recent-locations/patterns
 * @desc    Get user's behavioral patterns and insights
 * @access  Private
 */
router.get('/patterns', recentLocationsController.getUserPatterns);

/**
 * @route   POST /api/v1/recent-locations
 * @desc    Add a location to user's recent locations
 * @access  Private
 */
router.post('/', addLocationValidation, recentLocationsController.addRecentLocation);

module.exports = router;
