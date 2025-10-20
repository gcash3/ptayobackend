const express = require('express');
const aiSuggestionController = require('../controllers/aiSuggestionController');
const bookmarkController = require('../controllers/bookmarkController');
const searchLocationService = require('../services/searchLocationService');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { body, query, param } = require('express-validator');
const { catchAsync } = require('../middleware/errorHandler');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// AI Parking Suggestions Routes
router.get('/parking-suggestions',
  [
    query('latitude').notEmpty().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    query('longitude').notEmpty().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    query('filterType').optional().isIn(['nearby', 'price', 'rating', 'availability']).withMessage('Invalid filter type - only nearby, price, rating, and availability are supported'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('radiusKm').optional().isFloat({ min: 0.5, max: 50 }).withMessage('Radius must be between 0.5 and 50 km'),
    validateRequest
  ],
  aiSuggestionController.getAIParkingSuggestions
);

// Recent Locations Routes
router.get('/recent-locations',
  [
    query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20'),
    query('timeframe').optional().isInt({ min: 1, max: 730 }).withMessage('Timeframe must be between 1 and 730 days'),
    validateRequest
  ],
  aiSuggestionController.getRecentLocationsFromBookings
);

router.get('/recent-locations/full',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
    query('sortBy').optional().isIn(['lastVisited', 'bookingCount', 'rating', 'name']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
    query('category').optional().isIn(['favorite', 'frequent', 'recent', 'budget', 'reliable', 'regular']).withMessage('Invalid category'),
    validateRequest
  ],
  aiSuggestionController.getFullRecentLocations
);

// Filter Options
router.get('/filter-options',
  [
    query('latitude').optional().isFloat({ min: -90, max: 90 }),
    query('longitude').optional().isFloat({ min: -180, max: 180 }),
    validateRequest
  ],
  aiSuggestionController.getFilterOptions
);

// User Behavior Analytics
router.get('/behavior-analytics',
  aiSuggestionController.getUserBehaviorAnalytics
);

// Cache Management
router.post('/cache/invalidate',
  [
    body('filterType').optional().isIn(['nearby', 'price', 'rating', 'distance', 'availability', 'smart']).withMessage('Invalid filter type'),
    validateRequest
  ],
  aiSuggestionController.invalidateUserCache
);

// Search Location Tracking Routes
router.post('/search-locations',
  [
    body('name').notEmpty().isString().withMessage('Location name is required'),
    body('latitude').notEmpty().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    body('longitude').notEmpty().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    body('category').optional().isIn(['university', 'college', 'school', 'institute', 'academy', 'general']).withMessage('Invalid category'),
    body('searchSource').optional().isIn(['google_places', 'manual_entry', 'suggestion_chip', 'recent_location']).withMessage('Invalid search source'),
    body('placeId').optional().isString().withMessage('Place ID must be a string'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const result = await searchLocationService.logSearchLocation({
      userId: req.user.id,
      ...req.body
    });
    res.status(200).json(result);
  })
);

router.get('/search-locations/recent',
  [
    query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be between 1 and 20'),
    query('categoryFilter').optional().isIn(['university', 'college', 'school', 'institute', 'academy']).withMessage('Invalid category filter'),
    query('timeframe').optional().isInt({ min: 1, max: 365 }).withMessage('Timeframe must be between 1 and 365 days'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const result = await searchLocationService.getRecentSearchLocations(req.user.id, req.query);
    res.status(200).json(result);
  })
);

router.get('/recent-locations/combined',
  [
    query('limit').optional().isInt({ min: 1, max: 15 }).withMessage('Limit must be between 1 and 15'),
    validateRequest
  ],
  catchAsync(async (req, res) => {
    const result = await searchLocationService.getCombinedRecentLocations(req.user.id, req.query);
    res.status(200).json(result);
  })
);

// Bookmark Routes
router.get('/bookmarks',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be between 1 and 100'),
    query('sortBy').optional().isIn(['bookmarkedAt', 'name', 'visitHistory.totalVisits', 'customRating.overall']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Sort order must be asc or desc'),
    validateRequest
  ],
  bookmarkController.getUserBookmarks
);

router.get('/bookmarks/nearby',
  [
    query('latitude').notEmpty().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude is required'),
    query('longitude').notEmpty().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude is required'),
    query('maxDistance').optional().isInt({ min: 100, max: 50000 }).withMessage('Max distance must be between 100m and 50km'),
    validateRequest
  ],
  bookmarkController.getNearbyBookmarks
);

router.get('/bookmarks/:bookmarkId',
  [
    param('bookmarkId').isMongoId().withMessage('Valid bookmark ID is required'),
    validateRequest
  ],
  bookmarkController.getBookmarkDetails
);

router.post('/bookmarks/:parkingSpaceId/toggle',
  [
    param('parkingSpaceId').isMongoId().withMessage('Valid parking space ID is required'),
    body('notes').optional().isString().isLength({ max: 500 }).withMessage('Notes must be a string with max 500 characters'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    body('tags.*').optional().isString().isIn([
      'convenient', 'cheap', 'safe', 'covered', 'security',
      'close-to-entrance', 'good-lighting', 'wide-spaces',
      'fast-exit', 'regular-spot', 'backup-option',
      'weekend-only', 'weekday-only', 'morning-preferred',
      'afternoon-preferred', 'evening-preferred'
    ]).withMessage('Invalid tag'),
    body('customRating').optional().isObject().withMessage('Custom rating must be an object'),
    body('customRating.overall').optional().isFloat({ min: 1, max: 5 }).withMessage('Overall rating must be between 1 and 5'),
    body('userLocation').optional().isObject().withMessage('User location must be an object'),
    body('source').optional().isString().isIn(['search', 'suggestion', 'map', 'recent', 'booking-history']).withMessage('Invalid source'),
    validateRequest
  ],
  bookmarkController.toggleBookmark
);

router.patch('/bookmarks/:bookmarkId',
  [
    param('bookmarkId').isMongoId().withMessage('Valid bookmark ID is required'),
    body('personalNotes').optional().isString().isLength({ max: 500 }).withMessage('Notes must be a string with max 500 characters'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    body('customRating').optional().isObject().withMessage('Custom rating must be an object'),
    body('preferences').optional().isObject().withMessage('Preferences must be an object'),
    validateRequest
  ],
  bookmarkController.updateBookmark
);

router.delete('/bookmarks/:parkingSpaceId',
  [
    param('parkingSpaceId').isMongoId().withMessage('Valid parking space ID is required'),
    validateRequest
  ],
  bookmarkController.removeBookmark
);

router.get('/bookmarks/:parkingSpaceId/status',
  [
    param('parkingSpaceId').isMongoId().withMessage('Valid parking space ID is required'),
    validateRequest
  ],
  bookmarkController.checkBookmarkStatus
);

router.post('/bookmarks/bulk',
  [
    body('operation').isIn(['add', 'remove', 'tag']).withMessage('Operation must be add, remove, or tag'),
    body('parkingSpaceIds').isArray({ min: 1 }).withMessage('parkingSpaceIds must be a non-empty array'),
    body('parkingSpaceIds.*').isMongoId().withMessage('All parking space IDs must be valid'),
    body('tags').optional().isArray().withMessage('Tags must be an array'),
    validateRequest
  ],
  bookmarkController.bulkBookmarkOperation
);

module.exports = router;