const aiParkingSuggestionService = require('../services/aiParkingSuggestionService');
const recentLocationsService = require('../services/recentLocationsService');
const UserBehavior = require('../models/UserBehavior');
const AIScoringCache = require('../models/AIScoringCache');
const { catchAsync } = require('../middleware/errorHandler');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// Get AI-powered parking suggestions
const getAIParkingSuggestions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    filterType = 'nearby',
    latitude,
    longitude,
    limit = 10,
    radiusKm = 5,
    forceRefresh = false
  } = req.query;

  // Validate filter type - only nearby is supported now
  const validFilters = ['nearby'];
  if (!validFilters.includes(filterType)) {
    return next(new AppError(`Invalid filter type. Only 'nearby' filter is supported for AI suggestions`, 400));
  }

  // Validate required parameters - fallback GPS for when no search history available
  if (!latitude || !longitude) {
    // Allow missing GPS only if we might have search history
    if (filterType !== 'nearby') {
      return next(new AppError('Latitude and longitude are required for AI suggestions', 400));
    }
  }

  logger.info(`🤖 Getting AI parking suggestions for user ${userId}`, {
    filterType,
    location: { latitude, longitude },
    limit,
    radiusKm
  });

  try {
    // Let the AI service handle the logic of choosing search location vs GPS
    const suggestions = await aiParkingSuggestionService.generateSuggestions(userId, {
      filterType,
      latitude: latitude ? parseFloat(latitude) : null,
      longitude: longitude ? parseFloat(longitude) : null,
      limit: parseInt(limit),
      radiusKm: parseFloat(radiusKm),
      forceRefresh: forceRefresh === 'true'
    });

    // Add additional metadata
    const enhancedSuggestions = suggestions.map(suggestion => ({
      ...suggestion,
      // Ensure required fields for frontend
      isAvailable: suggestion.availableSpots > 0,
      distance: suggestion.metadata?.distance || 0,
      walkingTime: suggestion.metadata?.walkingTime || 0,
      price: suggestion.metadata?.estimatedPrice || suggestion.pricePer3Hours,
      rating: suggestion.averageRating || 0,
      // Add AI-specific fields
      aiScore: suggestion.aiScore,
      recommendationReason: suggestion.recommendationReason,
      confidence: suggestion.aiScore >= 70 ? 'high' : suggestion.aiScore >= 50 ? 'medium' : 'low'
    }));

    // Generate filter options for frontend
    const filterOptions = await generateFilterOptions(userId, { latitude, longitude });

    res.status(200).json({
      status: 'success',
      results: enhancedSuggestions.length,
      data: {
        suggestions: enhancedSuggestions,
        filter: {
          current: filterType,
          options: filterOptions
        },
        metadata: {
          userLocation: suggestions.length > 0 && suggestions[0].metadata?.searchCenter ?
            suggestions[0].metadata.searchCenter :
            { latitude: latitude ? parseFloat(latitude) : null, longitude: longitude ? parseFloat(longitude) : null },
          locationSource: suggestions.length > 0 && suggestions[0].metadata?.locationSource ?
            suggestions[0].metadata.locationSource : 'gps',
          originalGPS: latitude && longitude ? { latitude: parseFloat(latitude), longitude: parseFloat(longitude) } : null,
          searchRadius: parseFloat(radiusKm),
          generatedAt: new Date(),
          cacheStatus: forceRefresh ? 'refreshed' : 'auto',
          totalCandidatesAnalyzed: suggestions.length > 0 ? Math.min(50, suggestions.length * 5) : 0
        },
        analytics: {
          averageAiScore: suggestions.length > 0
            ? Math.round(suggestions.reduce((sum, s) => sum + s.aiScore, 0) / suggestions.length)
            : 0,
          highConfidenceCount: enhancedSuggestions.filter(s => s.confidence === 'high').length,
          availabilityRate: suggestions.length > 0
            ? Math.round((suggestions.filter(s => s.isAvailable).length / suggestions.length) * 100)
            : 0
        }
      }
    });

  } catch (error) {
    logger.error(`❌ Error generating AI suggestions: ${error.message}`, error);

    // Return fallback response instead of error
    res.status(200).json({
      status: 'success',
      results: 0,
      data: {
        suggestions: [],
        filter: {
          current: filterType,
          options: await generateFilterOptions(userId, { latitude, longitude })
        },
        error: {
          message: 'Unable to generate AI suggestions at the moment',
          fallback: 'Please try the map view for manual search'
        }
      }
    });
  }
});

// Get recent locations based on booking history
const getRecentLocationsFromBookings = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    limit = 3,
    includeCancelled = false,
    timeframe = 90
  } = req.query;

  logger.info(`📍 Getting recent locations from bookings for user ${userId}`);

  try {
    const recentLocations = await recentLocationsService.getRecentLocationsFromBookings(userId, {
      limit: parseInt(limit),
      includeCancelled: includeCancelled === 'true',
      timeframe: parseInt(timeframe)
    });

    res.status(200).json({
      status: 'success',
      results: recentLocations.length,
      data: {
        locations: recentLocations,
        metadata: {
          timeframe: parseInt(timeframe),
          includeCancelled: includeCancelled === 'true',
          generatedAt: new Date()
        },
        analytics: recentLocations.length > 0 ? {
          totalBookings: recentLocations.reduce((sum, loc) => sum + loc.bookingCount, 0),
          totalSpent: recentLocations.reduce((sum, loc) => sum + loc.totalSpent, 0),
          averageRating: Math.round(
            recentLocations.reduce((sum, loc) => sum + (loc.avgRating * loc.bookingCount), 0) /
            recentLocations.reduce((sum, loc) => sum + loc.bookingCount, 0) * 10
          ) / 10,
          favoriteCount: recentLocations.filter(loc => loc.category === 'favorite').length
        } : null
      }
    });

  } catch (error) {
    logger.error(`❌ Error getting recent locations: ${error.message}`, error);

    // Return empty response instead of error for better UX
    res.status(200).json({
      status: 'success',
      results: 0,
      data: {
        locations: [],
        message: 'No recent booking history found',
        suggestion: 'Start booking parking spaces to see your recent locations here'
      }
    });
  }
});

// Get full recent locations with pagination (for "View All")
const getFullRecentLocations = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 20,
    sortBy = 'lastVisited',
    sortOrder = 'desc',
    category = null,
    timeframe = 365
  } = req.query;

  logger.info(`📚 Getting full recent locations for user ${userId}`, {
    page,
    limit,
    sortBy,
    category
  });

  try {
    const result = await recentLocationsService.getFullRecentLocations(userId, {
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder: sortOrder === 'desc' ? -1 : 1,
      category,
      timeframe: parseInt(timeframe)
    });

    res.status(200).json({
      status: 'success',
      results: result.locations.length,
      data: result
    });

  } catch (error) {
    logger.error(`❌ Error getting full recent locations: ${error.message}`, error);
    return next(new AppError('Unable to retrieve recent locations', 500));
  }
});

// Get filter options for AI suggestions
const getFilterOptions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { latitude, longitude } = req.query;

  const filterOptions = await generateFilterOptions(userId, { latitude, longitude });

  res.status(200).json({
    status: 'success',
    data: {
      filterOptions,
      defaultFilter: 'nearby'
    }
  });
});

// Helper function to generate filter options - only nearby is supported
async function generateFilterOptions(userId, userLocation = {}) {
  try {
    const filterOptions = [
      {
        value: 'nearby',
        label: 'Nearby',
        description: 'Parking spaces near your most searched locations',
        icon: '📍',
        available: true
      }
    ];

    return filterOptions;

  } catch (error) {
    logger.error(`Error generating filter options: ${error.message}`);
    // Return default options on error
    return [
      { value: 'nearby', label: 'Nearby', description: 'Parking spaces near your most searched locations', icon: '📍', available: true }
    ];
  }
}

// Get user behavior analytics
const getUserBehaviorAnalytics = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const userBehavior = await UserBehavior.findOne({ userId });

  if (!userBehavior) {
    return res.status(200).json({
      status: 'success',
      data: {
        analytics: null,
        message: 'No behavior data available yet. Start booking to see personalized insights!'
      }
    });
  }

  // Calculate additional insights
  const insights = {
    parkingPersonality: determineParkingPersonality(userBehavior),
    recommendations: generatePersonalizedRecommendations(userBehavior),
    trends: analyzeUserTrends(userBehavior)
  };

  res.status(200).json({
    status: 'success',
    data: {
      behavior: userBehavior,
      insights,
      lastAnalyzed: userBehavior.lastAnalyzed
    }
  });
});

// Invalidate AI cache for user
const invalidateUserCache = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { filterType } = req.body;

  await AIScoringCache.invalidateUserCache(userId, filterType);

  logger.info(`🗑️ Invalidated AI cache for user ${userId}`, { filterType });

  res.status(200).json({
    status: 'success',
    message: 'AI cache invalidated successfully',
    data: {
      userId,
      filterType: filterType || 'all',
      invalidatedAt: new Date()
    }
  });
});

// Helper functions for user behavior analysis
function determineParkingPersonality(userBehavior) {
  const patterns = userBehavior.bookingPatterns;
  const metrics = userBehavior.aiMetrics;

  if (patterns.priceRange.average <= 50 && metrics.loyaltyScore >= 70) {
    return {
      type: 'Budget Optimizer',
      description: 'You consistently find great value parking spots',
      traits: ['price-conscious', 'loyal', 'practical']
    };
  }

  if (metrics.predictabilityScore >= 80) {
    return {
      type: 'Routine Parker',
      description: 'You prefer familiar, reliable parking locations',
      traits: ['predictable', 'reliable', 'habitual']
    };
  }

  if (patterns.frequentParkingSpaces?.length >= 3) {
    return {
      type: 'Location Explorer',
      description: 'You like to try different parking spots',
      traits: ['adventurous', 'flexible', 'explorer']
    };
  }

  return {
    type: 'Smart Parker',
    description: 'You make thoughtful parking decisions',
    traits: ['balanced', 'smart', 'adaptive']
  };
}

function generatePersonalizedRecommendations(userBehavior) {
  const recommendations = [];
  const patterns = userBehavior.bookingPatterns;

  if (patterns.priceRange.average > 80) {
    recommendations.push({
      type: 'cost-saving',
      message: 'Try our "Budget Friendly" filter to discover more affordable options',
      action: 'use_price_filter'
    });
  }

  if (patterns.preferredTimes.length === 1) {
    recommendations.push({
      type: 'flexibility',
      message: 'Consider booking at different times for better availability and prices',
      action: 'try_different_times'
    });
  }

  if ((userBehavior.aiMetrics.cancelledBookings / userBehavior.aiMetrics.totalBookings) > 0.2) {
    recommendations.push({
      type: 'reliability',
      message: 'Use our AI suggestions for more reliable parking experiences',
      action: 'use_ai_filter'
    });
  }

  return recommendations;
}

function analyzeUserTrends(userBehavior) {
  const trends = {
    spending: 'stable', // Could be 'increasing', 'decreasing', 'stable'
    frequency: 'regular', // Could be 'increasing', 'decreasing', 'regular'
    satisfaction: 'good' // Based on average ratings
  };

  // This could be enhanced with historical analysis
  if (userBehavior.aiMetrics.averageRating >= 4.5) {
    trends.satisfaction = 'excellent';
  } else if (userBehavior.aiMetrics.averageRating <= 3.5) {
    trends.satisfaction = 'needs_improvement';
  }

  return trends;
}

module.exports = {
  getAIParkingSuggestions,
  getRecentLocationsFromBookings,
  getFullRecentLocations,
  getFilterOptions,
  getUserBehaviorAnalytics,
  invalidateUserCache
};