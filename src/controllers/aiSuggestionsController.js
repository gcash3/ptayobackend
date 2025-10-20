const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const AiAnalyticsService = require('../services/aiAnalyticsService');
const aiParkingSuggestionService = require('../services/aiParkingSuggestionService');
const ParkingSpace = require('../models/ParkingSpace');

/**
 * Get AI-driven parking suggestions based on user preferences and context
 * @route GET /api/v1/suggestions/parking
 */
const getAiDrivenParkingSuggestions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { 
    filterType = 'nearby', 
    latitude, 
    longitude, 
    limit = 10,
    vehicleType 
  } = req.query;

  try {
    logger.info(`🤖 AI Parking Suggestions requested by user ${userId} with filter: ${filterType}`);

    // Always use 'nearby' filter since we only return best candidate
    // No validation needed as we ignore filterType and always use 'nearby'

    // Get user's current location if provided
    const userLocation = (latitude && longitude) ? {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    } : null;

    // Resolve location: for 'nearby' filter, prefer recent search destinations over current GPS
    let resolvedLocation = null;
    let locationSource = 'gps';

    if (filterType === 'nearby') {
      // For 'nearby' filter, prioritize user's frequent search destinations
      try {
        const SearchLocation = require('../models/SearchLocation');
        const frequentDestination = await SearchLocation.findOne({
          userId,
          isActive: true,
          $or: [
            { category: { $in: ['university', 'college', 'school', 'institute', 'academy'] } },
            { searchCount: { $gte: 2 } }
          ]
        })
        .sort({
          searchCount: -1,
          lastSearched: -1
        })
        .select('name latitude longitude category searchCount lastSearched');

        if (frequentDestination) {
          resolvedLocation = {
            latitude: frequentDestination.latitude,
            longitude: frequentDestination.longitude
          };
          locationSource = 'frequent_search';
          logger.info(`🎯 Using frequent destination for nearby suggestions: ${frequentDestination.name} (${frequentDestination.searchCount} searches)`);
        } else {
          logger.info(`📍 No frequent destinations found for user ${userId}, returning empty suggestions for 'nearby' filter`);
          // Return empty suggestions when no search history exists for 'nearby' filter
          return res.status(200).json({
            status: 'success',
            message: 'No recent search locations found. Search for places first to get nearby parking suggestions.',
            data: {
              suggestions: [],
              totalCount: 0,
              filterApplied: filterType,
              aiDriven: true,
              generatedAt: new Date(),
              userContext: {
                hasCurrentLocation: !!userLocation,
                hasSearchHistory: false,
                locationSource: 'no_search_history',
                message: 'Search for universities or places to get personalized nearby parking suggestions'
              }
            }
          });
        }
      } catch (e) {
        logger.warn('⚠️ Failed to load frequent destinations:', e.message);
        // Fallback to GPS if search location lookup fails
        resolvedLocation = userLocation;
        locationSource = 'gps_fallback';
      }
    } else {
      // For other filters, use GPS location or fallback to recent search
      resolvedLocation = userLocation;
      if (!resolvedLocation) {
        try {
          const RecentLocation = require('../models/RecentLocation');
          const lastSearch = await RecentLocation.findOne({ userId }).sort({ lastSearched: -1 });
          if (lastSearch) {
            resolvedLocation = { latitude: lastSearch.latitude, longitude: lastSearch.longitude };
            locationSource = 'recent_search_fallback';
            logger.info('🤖 Using last searched destination for AI suggestions fallback', resolvedLocation);
          }
        } catch (e) {
          logger.warn('⚠️ Failed to load recent search for AI fallback:', e.message);
        }
      }
    }

    // Use AI parking suggestion service to get the best candidate only
    const aiServiceResult = await aiParkingSuggestionService.generateSuggestions(
      userId,
      {
        filterType: 'nearby', // Always use 'nearby' since we want best candidate based on search history
        latitude: resolvedLocation?.latitude,
        longitude: resolvedLocation?.longitude,
        limit: 1, // Always get only 1 best candidate
        radiusKm: 5
      }
    );

    // Handle the response - service now returns array directly
    const suggestions = Array.isArray(aiServiceResult) ? aiServiceResult : [];
    const metadata = {};

    // If the service returned metadata indicating no search history for 'nearby' filter, return early
    if (filterType === 'nearby' && metadata.locationSource === 'no_search_history') {
      logger.info(`📍 No search history found for user ${userId}, returning empty suggestions for 'nearby' filter`);
      return res.status(200).json({
        status: 'success',
        message: metadata.message || 'No recent search locations found. Search for places first to get nearby parking suggestions.',
        data: {
          suggestions: [],
          totalCount: 0,
          filterApplied: filterType,
          aiDriven: true,
          generatedAt: new Date(),
          userContext: {
            hasCurrentLocation: !!userLocation,
            hasSearchHistory: false,
            locationSource: 'no_search_history',
            message: 'Search for universities or places to get personalized nearby parking suggestions'
          },
          metadata: metadata
        }
      });
    }

    logger.info(`🤖 AI returned ${suggestions.length} parking suggestions for user ${userId}`);

    // Format response to match existing API structure
    const formattedSuggestions = suggestions.map(space => ({
      id: space._id,
      name: space.name,
      address: space.address,
      latitude: space.latitude,
      longitude: space.longitude,
      distance: resolvedLocation ? calculateDistance(resolvedLocation, space) : null,
      price: space.pricePer3Hours || 0,
      rating: space.rating || 4.0,
      totalReviews: space.totalReviews || 0,
      isAvailable: space.isActive && space.isVerified,
      imageUrl: space.images?.[0] || null,
      type: space.type || 'open',
      description: space.description || 'AI recommended parking space',
      amenities: space.amenities || [],
      currentOccupancy: space.currentOccupancy || null,
      landlordName: space.landlordName,
      isVerified: space.isVerified,
      aiScore: space.aiScore,
      aiBreakdown: space.aiBreakdown,
      recommendationReason: space.recommendationReason
    }));

    res.status(200).json({
      status: 'success',
      message: formattedSuggestions.length > 0
        ? 'Best parking space recommendation retrieved successfully'
        : 'No suitable parking space found based on your criteria',
      data: {
        bestCandidate: formattedSuggestions.length > 0 ? formattedSuggestions[0] : null,
        totalCount: formattedSuggestions.length,
        aiDriven: true,
        scoringMethod: 'Weighted scoring: 40% distance, 25% rating, 20% pricing, 15% amenities',
        generatedAt: new Date(),
        userContext: {
          hasCurrentLocation: !!userLocation,
          hasSearchHistory: locationSource === 'frequent_search' || metadata.locationSource === 'frequent_search',
          locationSource: metadata.locationSource || locationSource,
          timeContext: new Date().getHours() >= 8 && new Date().getHours() <= 18 ? 'work_hours' : 'personal_hours'
        }
      }
    });

  } catch (error) {
    logger.error('🤖 AI Parking suggestions error:', error);
    return next(new AppError('Failed to retrieve AI-driven parking suggestions', 500));
  }
});

/**
 * Get available filter options for user based on their patterns
 * @route GET /api/v1/suggestions/filter-options
 */
const getFilterOptions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    logger.info(`🎯 Filter options requested by user ${userId}`);

    const filterOptions = await getAvailableFilterOptions(userId);

    res.status(200).json({
      status: 'success',
      message: 'Filter options retrieved successfully',
      data: {
        filterOptions,
        defaultFilter: 'nearby'
      }
    });

  } catch (error) {
    logger.error('🎯 Filter options error:', error);
    return next(new AppError('Failed to retrieve filter options', 500));
  }
});

/**
 * Get smart suggestions based on current context (time, location, patterns)
 * @route GET /api/v1/suggestions/smart
 */
const getSmartContextualSuggestions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { latitude, longitude } = req.query;

  try {
    logger.info(`🧠 Smart contextual suggestions requested by user ${userId}`);

    const userLocation = (latitude && longitude) ? {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    } : null;

    // Get user patterns to determine best filter
    const userPatterns = await AiAnalyticsService.identifyUserPatterns(userId);
    const currentTime = new Date();
    const currentHour = currentTime.getHours();
    const isWeekday = ![0, 6].includes(currentTime.getDay());

    // Determine best filter based on context
    let smartFilter = 'nearby';
    let contextReason = 'General nearby suggestions';

    if (isWeekday && currentHour >= 8 && currentHour <= 18) {
      if (userPatterns.workLocation) {
        smartFilter = 'near_work';
        contextReason = 'Work hours detected - showing parking near your work area';
      } else {
        smartFilter = 'time_based';
        contextReason = 'Work hours detected - showing time-based suggestions';
      }
    } else if (!isWeekday || currentHour >= 18 || currentHour <= 8) {
      if (userPatterns.homeLocation) {
        smartFilter = 'near_home';
        contextReason = 'Personal time detected - showing parking near your home area';
      } else {
        smartFilter = 'frequent_areas';
        contextReason = 'Personal time detected - showing frequently visited areas';
      }
    }

    // Get suggestions using the smart filter
    const suggestions = await AiAnalyticsService.getPersonalizedSuggestions(
      userId, 
      smartFilter, 
      userLocation, 
      8
    );

    // Format response
    const formattedSuggestions = suggestions.map(space => ({
      id: space._id,
      name: space.name,
      address: space.address,
      latitude: space.latitude,
      longitude: space.longitude,
      distance: userLocation ? calculateDistance(userLocation, space) : null,
      price: space.pricePer3Hours || 0,
      rating: space.rating || 4.0,
      totalReviews: space.totalReviews || 0,
      isAvailable: space.isActive && space.isVerified,
      type: space.type || 'open',
      description: space.description || 'Smart AI recommendation',
      amenities: space.amenities || [],
      aiScore: space.aiScore,
      recommendationReason: space.recommendationReason
    }));

    res.status(200).json({
      status: 'success',
      message: 'Smart contextual suggestions retrieved successfully',
      data: {
        suggestions: formattedSuggestions,
        totalCount: formattedSuggestions.length,
        smartFilter: smartFilter,
        contextReason: contextReason,
        aiDriven: true,
        contextualData: {
          currentTime: currentTime,
          isWeekday: isWeekday,
          timeSlot: getTimeSlot(currentHour),
          hasWorkPattern: !!userPatterns.workLocation,
          hasHomePattern: !!userPatterns.homeLocation
        }
      }
    });

  } catch (error) {
    logger.error('🧠 Smart contextual suggestions error:', error);
    return next(new AppError('Failed to retrieve smart suggestions', 500));
  }
});

// Helper functions
async function getAvailableFilterOptions(userId) {
  try {
    const userPatterns = await AiAnalyticsService.identifyUserPatterns(userId);

    // Focus only on intelligent suggestions with enhanced weighting
    const options = [
      {
        value: 'nearby',
        label: 'Smart Nearby',
        icon: '🎓',
        description: 'Near your frequently visited places (universities, work, etc.)',
        available: true,
        priority: 1,
        weight: 'Optimized for frequent destinations'
      },
      {
        value: 'price',
        label: 'Best Value',
        icon: '💰',
        description: 'Best price with good ratings combination',
        available: true,
        priority: 2,
        weight: 'Price + Rating optimized'
      },
      {
        value: 'rating',
        label: 'Top Rated',
        icon: '⭐',
        description: 'Highest quality parking spaces',
        available: true,
        priority: 3,
        weight: 'Rating + Availability optimized'
      },
      {
        value: 'availability',
        label: 'High Availability',
        icon: '🅿️',
        description: 'Spaces with most available spots',
        available: true,
        priority: 4,
        weight: 'Availability + Distance optimized'
      }
    ];

    return options;
  } catch (error) {
    logger.error('Error getting filter options:', error);
    return [
      {
        value: 'nearby',
        label: 'Nearby',
        icon: '📍',
        description: 'Closest to your location',
        available: true
      }
    ];
  }
}

function calculateDistance(location1, location2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (location2.latitude - location1.latitude) * Math.PI / 180;
  const dLon = (location2.longitude - location1.longitude) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(location1.latitude * Math.PI / 180) * Math.cos(location2.latitude * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function getTimeSlot(hour) {
  if (hour >= 6 && hour < 12) return 'morning';
  else if (hour >= 12 && hour < 18) return 'afternoon';
  else if (hour >= 18 && hour < 22) return 'evening';
  else return 'night';
}

module.exports = {
  getAiDrivenParkingSuggestions,
  getFilterOptions,
  getSmartContextualSuggestions
};