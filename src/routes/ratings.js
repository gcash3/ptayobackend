const express = require('express');
const { body, param, query } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const {
  submitRating,
  getParkingSpaceRatings,
  getUserRatings,
  getLandlordRatings,
  updateRating,
  deleteRating,
  checkCanRate,
  respondToRating
} = require('../controllers/ratingController');

const router = express.Router();

// All rating routes require authentication
router.use(authenticateToken);

// Validation schemas
const submitRatingValidation = [
  body('parkingSpaceId')
    .isMongoId()
    .withMessage('Valid parking space ID is required'),
  body('bookingId')
    .isMongoId()
    .withMessage('Valid booking ID is required'),
  body('rating')
    .isFloat({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5')
    .custom((value) => {
      // Allow whole numbers or half stars (1, 1.5, 2, 2.5, etc.)
      return Number.isInteger(value) || (value % 0.5 === 0);
    })
    .withMessage('Rating must be whole numbers or half stars'),
  body('review')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Review cannot exceed 500 characters')
    .trim(),
  body('aspects.cleanliness')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Cleanliness rating must be between 1 and 5'),
  body('aspects.security')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Security rating must be between 1 and 5'),
  body('aspects.accessibility')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Accessibility rating must be between 1 and 5'),
  body('aspects.valueForMoney')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Value for money rating must be between 1 and 5'),
  body('isAnonymous')
    .optional()
    .isBoolean()
    .withMessage('isAnonymous must be a boolean')
];

const updateRatingValidation = [
  param('ratingId')
    .isMongoId()
    .withMessage('Valid rating ID is required'),
  body('rating')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Rating must be between 1 and 5')
    .custom((value) => {
      if (value === undefined) return true;
      return Number.isInteger(value) || (value % 0.5 === 0);
    })
    .withMessage('Rating must be whole numbers or half stars'),
  body('review')
    .optional()
    .isLength({ max: 500 })
    .withMessage('Review cannot exceed 500 characters')
    .trim(),
  body('aspects.cleanliness')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Cleanliness rating must be between 1 and 5'),
  body('aspects.security')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Security rating must be between 1 and 5'),
  body('aspects.accessibility')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Accessibility rating must be between 1 and 5'),
  body('aspects.valueForMoney')
    .optional()
    .isFloat({ min: 1, max: 5 })
    .withMessage('Value for money rating must be between 1 and 5')
];

const paginationValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 50 })
    .withMessage('Limit must be between 1 and 50')
];

const respondToRatingValidation = [
  param('ratingId')
    .isMongoId()
    .withMessage('Valid rating ID is required'),
  body('message')
    .notEmpty()
    .withMessage('Response message is required')
    .isLength({ max: 300 })
    .withMessage('Response cannot exceed 300 characters')
    .trim()
];

// Routes

/**
 * @route   POST /api/v1/ratings
 * @desc    Submit a rating for a parking space
 * @access  Private (User must have completed booking)
 */
router.post('/', submitRatingValidation, validateRequest, submitRating);

/**
 * @route   GET /api/v1/ratings/parking-space/:parkingSpaceId
 * @desc    Get all ratings for a parking space
 * @access  Private
 */
router.get('/parking-space/:parkingSpaceId', 
  [
    param('parkingSpaceId').isMongoId().withMessage('Valid parking space ID is required'),
    ...paginationValidation,
    query('sortBy')
      .optional()
      .isIn(['createdAt', 'rating', 'helpfulVotes'])
      .withMessage('Sort by must be createdAt, rating, or helpfulVotes'),
    query('sortOrder')
      .optional()
      .isIn(['asc', 'desc'])
      .withMessage('Sort order must be asc or desc')
  ],
  validateRequest, 
  getParkingSpaceRatings
);

/**
 * @route   GET /api/v1/ratings/my-ratings
 * @desc    Get current user's ratings
 * @access  Private
 */
router.get('/my-ratings', paginationValidation, validateRequest, getUserRatings);

/**
 * @route   GET /api/v1/ratings/landlord
 * @desc    Get ratings for all landlord's parking spaces
 * @access  Private (Landlord only)
 */
router.get('/landlord', paginationValidation, validateRequest, getLandlordRatings);

/**
 * @route   PUT /api/v1/ratings/:ratingId
 * @desc    Update an existing rating
 * @access  Private (Rating owner only)
 */
router.put('/:ratingId', updateRatingValidation, validateRequest, updateRating);

/**
 * @route   DELETE /api/v1/ratings/:ratingId
 * @desc    Delete a rating
 * @access  Private (Rating owner only)
 */
router.delete('/:ratingId', 
  [param('ratingId').isMongoId().withMessage('Valid rating ID is required')],
  validateRequest, 
  deleteRating
);

/**
 * @route   GET /api/v1/ratings/can-rate/:parkingSpaceId/:bookingId
 * @desc    Check if user can rate a specific parking space/booking
 * @access  Private
 */
router.get('/can-rate/:parkingSpaceId/:bookingId',
  [
    param('parkingSpaceId').isMongoId().withMessage('Valid parking space ID is required'),
    param('bookingId').isMongoId().withMessage('Valid booking ID is required')
  ],
  validateRequest,
  checkCanRate
);

/**
 * @route   POST /api/v1/ratings/:ratingId/respond
 * @desc    Landlord response to a rating
 * @access  Private (Parking space owner only)
 */
router.post('/:ratingId/respond', 
  respondToRatingValidation, 
  validateRequest, 
  respondToRating
);

module.exports = router;
