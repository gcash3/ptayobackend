const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth');
const {
  getSuggestedParkingSpaces,
  getPersonalizedSuggestions,
  getPopularParkingLocations,
  getParkingSpacesNearLocation,
  updateParkingAvailability,
  getParkingAnalytics,
  getUserParkingPatterns,
  addSearchHistory,
  getSearchHistory
} = require('../controllers/suggestedParkingController');

// Get suggested parking spaces based on location and filters
router.get('/suggested', authenticateToken, getSuggestedParkingSpaces);

// Get personalized parking suggestions based on user preferences
router.get('/personalized', authenticateToken, getPersonalizedSuggestions);

// Get popular parking locations
router.get('/popular', authenticateToken, getPopularParkingLocations);

// Get parking spaces near a specific location
router.get('/nearby', authenticateToken, getParkingSpacesNearLocation);

// Update parking space availability (real-time)
router.patch('/:parkingSpaceId/availability', authenticateToken, updateParkingAvailability);

// Get parking analytics
router.get('/:parkingSpaceId/analytics', authenticateToken, getParkingAnalytics);

// Get user parking patterns
router.get('/user/patterns', authenticateToken, getUserParkingPatterns);

// Record a search term (+ optional coordinates) for the user
router.post('/user/search-history', authenticateToken, addSearchHistory);

// Fetch user search history
router.get('/user/search-history', authenticateToken, getSearchHistory);

module.exports = router;
