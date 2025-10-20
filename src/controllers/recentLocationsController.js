const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const Booking = require('../models/Booking');
const RecentLocation = require('../models/RecentLocation');
const AiAnalyticsService = require('../services/aiAnalyticsService');

/**
 * Get user's recent/frequent locations based on booking history
 * @route GET /api/v1/recent-locations
 */
const getRecentLocations = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { limit = 10 } = req.query;

  try {
    // Get search history from recent locations
    const searchHistory = await RecentLocation.getRecentForUser(userId, parseInt(limit));
    
    // Get user's completed bookings for frequent locations
    const bookings = await Booking.find({
      userId: userId,
      status: { $in: ['completed', 'checked_out'] }
    })
    .populate('parkingSpaceId', 'name address latitude longitude')
    .sort({ createdAt: -1 })
    .limit(50); // Analyze last 50 bookings

    // Group bookings by proximity and frequency
    const locationMap = new Map();
    const proximityThreshold = 0.005; // ~500 meters

    bookings.forEach(booking => {
      if (!booking.parkingSpaceId || !booking.parkingSpaceId.latitude || !booking.parkingSpaceId.longitude) {
        return;
      }

      const space = booking.parkingSpaceId;
      const key = `${space.latitude.toFixed(3)}_${space.longitude.toFixed(3)}`;
      
      let existingLocationKey = null;
      for (const [mapKey, location] of locationMap) {
        const latDiff = Math.abs(location.latitude - space.latitude);
        const lngDiff = Math.abs(location.longitude - space.longitude);
        
        if (latDiff < proximityThreshold && lngDiff < proximityThreshold) {
          existingLocationKey = mapKey;
          break;
        }
      }

      if (existingLocationKey) {
        const existing = locationMap.get(existingLocationKey);
        existing.visitCount++;
        existing.lastVisited = booking.createdAt > existing.lastVisited ? booking.createdAt : existing.lastVisited;
        existing.totalSpent += booking.pricing?.totalAmount || 0;
      } else {
        locationMap.set(key, {
          latitude: space.latitude,
          longitude: space.longitude,
          name: space.name,
          address: space.address,
          visitCount: 1,
          lastVisited: booking.createdAt,
          totalSpent: booking.pricing?.totalAmount || 0,
          type: 'frequent_location'
        });
      }
    });

    // Combine search history and frequent locations
    const allLocations = [];

    // Add search history
    searchHistory.forEach(location => {
      allLocations.push({
        name: location.name,
        address: location.address,
        latitude: location.latitude,
        longitude: location.longitude,
        type: location.type,
        lastVisited: location.lastSearched,
        searchCount: location.searchCount,
        source: 'search_history'
      });
    });

    // Add frequent locations from bookings
    Array.from(locationMap.values()).forEach(location => {
      // Only include if visited more than once and not already in search history
      if (location.visitCount > 1) {
        const isDuplicate = allLocations.some(existing => {
          const latDiff = Math.abs(existing.latitude - location.latitude);
          const lngDiff = Math.abs(existing.longitude - location.longitude);
          return latDiff < 0.001 && lngDiff < 0.001;
        });

        if (!isDuplicate) {
          allLocations.push({
            name: location.name,
            address: location.address,
            latitude: location.latitude,
            longitude: location.longitude,
            type: location.type,
            lastVisited: location.lastVisited,
            visitCount: location.visitCount,
            totalSpent: location.totalSpent,
            source: 'booking_history'
          });
        }
      }
    });

    // Sort by recency and frequency
    allLocations.sort((a, b) => {
      const aScore = (a.searchCount || a.visitCount || 1) * 2 + 
        (Date.now() - new Date(a.lastVisited).getTime()) / (1000 * 60 * 60 * 24 * -7);
      const bScore = (b.searchCount || b.visitCount || 1) * 2 + 
        (Date.now() - new Date(b.lastVisited).getTime()) / (1000 * 60 * 60 * 24 * -7);
      return bScore - aScore;
    });

    // Limit results
    const locations = allLocations.slice(0, parseInt(limit));

    res.status(200).json({
      status: 'success',
      message: 'Recent locations retrieved successfully',
      data: {
        locations: locations,
        totalCount: locations.length,
        analysisInfo: {
          searchHistoryCount: searchHistory.length,
          bookingClustersCount: locationMap.size,
          combinedResults: locations.length
        }
      }
    });

  } catch (error) {
    logger.error('Get recent locations error:', error);
    return next(new AppError('Failed to retrieve recent locations', 500));
  }
});

/**
 * Add a manual location to user's recent locations (DISABLED - Using AI-driven approach)
 * @route POST /api/v1/recent-locations
 */
const addRecentLocation = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { name, address, latitude, longitude, type = 'search' } = req.body;

  // Basic validation for request format
  if (!name || !address || !latitude || !longitude) {
    return next(new AppError('Name, address, latitude, and longitude are required', 400));
  }

  if (typeof latitude !== 'number' || typeof longitude !== 'number') {
    return next(new AppError('Latitude and longitude must be numbers', 400));
  }

  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return next(new AppError('Invalid coordinates', 400));
  }

  logger.info(`📍 Manual location add request received but DISABLED for user ${userId}:`, {
    name,
    address,
    coordinates: { latitude, longitude },
    type: type || 'search'
  });

  // Return success without actually storing the data
  // The system now uses AI-driven recent locations based on actual user behavior
  res.status(200).json({
    status: 'success',
    message: 'Location request received. Recent locations are now AI-driven based on your usage patterns.',
    data: {
      location: {
        name,
        address,
        coordinates: { latitude, longitude },
        type: type || 'search',
        processed: false,
        note: 'Manual location adding is disabled. System uses AI-driven recent locations based on booking history and search patterns.'
      }
    }
  });
});

/**
 * Get AI-driven recent locations (max 3) based on user patterns and behavior
 * @route GET /api/v1/recent-locations/ai-driven
 */
const getAiDrivenRecentLocations = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { latitude, longitude } = req.query;
  
  try {
    logger.info(`🤖 AI Recent Locations requested by user ${userId}`);
    
    // Get user's current location if provided
    const userLocation = (latitude && longitude) ? {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    } : null;

    // Get search history from SearchLocation model (same as suggestions controller)
    const SearchLocation = require('../models/SearchLocation');
    const searchLocations = await SearchLocation.find({
      userId,
      isActive: true
    })
    .sort({
      // Sort bookmarked locations first, then by search count and recency
      interactionType: -1, // 'search_click' comes before 'bookmark' alphabetically, so -1 puts bookmarks first
      searchCount: -1,
      lastSearched: -1
    })
    .limit(3)
    .select('name latitude longitude address category searchCount lastSearched interactionType');

    // Format for frontend
    const aiRecentLocations = searchLocations.map(loc => ({
      id: loc._id,
      name: loc.name,
      address: loc.address || '',
      latitude: loc.latitude,
      longitude: loc.longitude,
      category: loc.category,
      searchCount: loc.searchCount,
      lastSearched: loc.lastSearched,
      icon: loc.category === 'university' ? '🎓' : '📍',
      label: loc.category === 'university' ? 'University' : 'Recent',
      isBookmarked: loc.interactionType === 'bookmark'
    }));

    logger.info(`🤖 AI returned ${aiRecentLocations.length} recent locations for user ${userId}`);

    // Debug: Log the actual data being returned
    console.log('🔍 DEBUG - Recent locations data:', aiRecentLocations.map(loc => ({
      name: loc.name,
      category: loc.category,
      searchCount: loc.searchCount
    })));

    res.status(200).json({
      status: 'success',
      message: 'AI-driven recent locations retrieved successfully',
      data: {
        locations: aiRecentLocations,
        totalCount: aiRecentLocations.length,
        aiDriven: true,
        generatedAt: new Date(),
        userContext: {
          hasCurrentLocation: !!userLocation,
          timeContext: new Date().getHours() >= 8 && new Date().getHours() <= 18 ? 'work_hours' : 'personal_hours'
        }
      }
    });

  } catch (error) {
    logger.error('🤖 AI Recent locations error:', error);
    return next(new AppError('Failed to retrieve AI-driven recent locations', 500));
  }
});

/**
 * Get user patterns and insights for debugging/analytics
 * @route GET /api/v1/recent-locations/patterns
 */
const getUserPatterns = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  try {
    logger.info(`🧠 User patterns requested by user ${userId}`);
    
    const patterns = await AiAnalyticsService.identifyUserPatterns(userId);
    
    res.status(200).json({
      status: 'success',
      message: 'User patterns retrieved successfully',
      data: {
        patterns,
        analyzedAt: new Date()
      }
    });

  } catch (error) {
    logger.error('🧠 User patterns error:', error);
    return next(new AppError('Failed to retrieve user patterns', 500));
  }
});

module.exports = {
  getRecentLocations,
  addRecentLocation,
  getAiDrivenRecentLocations,
  getUserPatterns
};
