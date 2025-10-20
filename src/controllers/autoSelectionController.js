const { validationResult } = require('express-validator');
const smartBookingService = require('../services/smartBookingService');
const dynamicPricingService = require('../services/dynamicPricingService');
const ParkingSpace = require('../models/ParkingSpace');
const { catchAsync, AppError, createValidationError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Auto-select parking space based on destination search
 * This is the core feature that automatically finds the best parking space
 * when a user searches for a destination like "University of the East"
 */
const autoSelectParkingSpace = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const {
    destinationName,
    destinationLat,
    destinationLng,
    userPreference = 'balanced', // Default to balanced if not specified
    bookingTime = new Date(),
    duration = 2,
    searchRadius = 2000,
    vehicleType = 'car'
  } = req.body;

  logger.info(`Auto-selecting parking for destination: ${destinationName} (${destinationLat}, ${destinationLng})`);

  try {
    // Use smart booking service to find the best options
    const smartOptions = await smartBookingService.findSmartBookingOptions({
      destinationLat: parseFloat(destinationLat),
      destinationLng: parseFloat(destinationLng),
      bookingTime: new Date(bookingTime),
      duration: parseInt(duration),
      preference: userPreference,
      searchRadius: parseInt(searchRadius),
      maxResults: 5 // Get top 5 options
    });

    if (!smartOptions.success || smartOptions.spaces.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'No suitable parking spaces found near this destination',
        data: {
          destinationName,
          searchRadius,
          suggestion: 'Try expanding your search radius or choosing a different time'
        }
      });
    }

    // Get the top recommendation (best match)
    const topRecommendation = smartOptions.spaces[0];
    
    // Enhanced selection reasoning
    const selectionReasoning = {
      primaryReason: getSelectionReason(userPreference, topRecommendation),
      factors: {
        distance: `${topRecommendation.distance}m from ${destinationName}`,
        price: `₱${topRecommendation.pricing.totalPrice} total (${duration} hours)`,
        rating: `${topRecommendation.parkingSpace.rating || 0}⭐ rating`,
        features: getSpaceFeatures(topRecommendation.parkingSpace)
      },
      dynamicPricing: {
        applied: topRecommendation.pricing.hasDynamicAdjustment,
        demandFactor: topRecommendation.pricing.demandFactorPercentage,
        factors: topRecommendation.pricing.factors.map(f => f.description)
      }
    };

    // Calculate alternative savings/comparisons
    const alternatives = smartOptions.spaces.slice(1, 3).map((option, index) => ({
      rank: index + 2,
      distance: option.distance,
      price: option.pricing.totalPrice,
      recommendation: option.recommendation,
      savingsVsTop: option.pricing.totalPrice - topRecommendation.pricing.totalPrice
    }));

    res.status(200).json({
      status: 'success',
      message: `Auto-selected best parking space for ${destinationName}`,
      data: {
        destination: {
          name: destinationName,
          coordinates: { lat: destinationLat, lng: destinationLng },
          searchRadius
        },
        autoSelected: {
          parkingSpace: topRecommendation.parkingSpace,
          pricing: topRecommendation.pricing,
          distance: topRecommendation.distance,
          walkingTime: topRecommendation.walkingTime,
          score: topRecommendation.score,
          recommendation: topRecommendation.recommendation
        },
        selectionReasoning,
        userPreference,
        alternatives,
        totalOptionsFound: smartOptions.spaces.length,
        searchMetadata: {
          searchRadius,
          bookingTime,
          duration,
          timestamp: new Date()
        }
      }
    });

  } catch (error) {
    logger.error('Auto-selection error:', error);
    return next(new AppError('Failed to auto-select parking space', 500));
  }
});

/**
 * Get smart suggestions based on popular destinations
 */
const getDestinationSuggestions = catchAsync(async (req, res, next) => {
  const { query, userLat, userLng } = req.query;

  // Popular destinations in Manila (this would typically come from a database)
  const popularDestinations = [
    {
      name: 'University of the East',
      category: 'university',
      coordinates: { lat: 14.5995, lng: 120.9842 },
      avgParkingPrice: 35,
      popularTimes: ['8-10 AM', '1-3 PM', '5-7 PM']
    },
    {
      name: 'De La Salle University Manila',
      category: 'university', 
      coordinates: { lat: 14.5648, lng: 120.9931 },
      avgParkingPrice: 40,
      popularTimes: ['7-9 AM', '12-2 PM', '4-6 PM']
    },
    {
      name: 'Robinsons Place Manila',
      category: 'mall',
      coordinates: { lat: 14.5790, lng: 120.9774 },
      avgParkingPrice: 50,
      popularTimes: ['10 AM-2 PM', '6-9 PM']
    },
    {
      name: 'SM City Manila',
      category: 'mall',
      coordinates: { lat: 14.5764, lng: 120.9831 },
      avgParkingPrice: 50,
      popularTimes: ['11 AM-3 PM', '7-10 PM']
    },
    {
      name: 'Manila City Hall',
      category: 'government',
      coordinates: { lat: 14.5764, lng: 120.9829 },
      avgParkingPrice: 45,
      popularTimes: ['8-11 AM', '1-4 PM']
    },
    {
      name: 'Philippine General Hospital',
      category: 'hospital',
      coordinates: { lat: 14.5764, lng: 120.9831 },
      avgParkingPrice: 40,
      popularTimes: ['24/7 varying demand']
    }
  ];

  let suggestions = popularDestinations;

  // Filter by query if provided
  if (query && query.length > 2) {
    suggestions = popularDestinations.filter(dest => 
      dest.name.toLowerCase().includes(query.toLowerCase()) ||
      dest.category.toLowerCase().includes(query.toLowerCase())
    );
  }

  // Sort by distance if user location provided
  if (userLat && userLng) {
    const userLatNum = parseFloat(userLat);
    const userLngNum = parseFloat(userLng);
    
    suggestions = suggestions.map(dest => ({
      ...dest,
      distance: calculateDistance(
        userLatNum, userLngNum,
        dest.coordinates.lat, dest.coordinates.lng
      )
    })).sort((a, b) => a.distance - b.distance);
  }

  // Add parking availability prediction for each destination
  const suggestionsWithAvailability = await Promise.all(
    suggestions.slice(0, 10).map(async (dest) => {
      try {
        const smartOptions = await smartBookingService.findSmartBookingOptions({
          destinationLat: dest.coordinates.lat,
          destinationLng: dest.coordinates.lng,
          bookingTime: new Date(),
          duration: 2,
          preference: 'balanced',
          searchRadius: 1500,
          maxResults: 3
        });

        return {
          ...dest,
          availableSpaces: smartOptions.success ? smartOptions.spaces.length : 0,
          priceRange: smartOptions.success && smartOptions.spaces.length > 0 ? {
            min: Math.min(...smartOptions.spaces.map(s => s.pricing.totalPrice)),
            max: Math.max(...smartOptions.spaces.map(s => s.pricing.totalPrice)),
            avg: Math.round(smartOptions.spaces.reduce((sum, s) => sum + s.pricing.totalPrice, 0) / smartOptions.spaces.length)
          } : null,
          hasSmartParking: smartOptions.success && smartOptions.spaces.length > 0
        };
      } catch (error) {
        logger.warn(`Failed to get availability for ${dest.name}:`, error);
        return {
          ...dest,
          availableSpaces: 0,
          priceRange: null,
          hasSmartParking: false
        };
      }
    })
  );

  res.status(200).json({
    status: 'success',
    data: {
      suggestions: suggestionsWithAvailability,
      query: query || '',
      userLocation: userLat && userLng ? { lat: userLat, lng: userLng } : null,
      total: suggestionsWithAvailability.length
    }
  });
});

/**
 * Get parking preview for a destination before booking
 */
const getDestinationParkingPreview = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const {
    destinationLat,
    destinationLng,
    destinationName,
    bookingTime = new Date(),
    duration = 2
  } = req.query;

  try {
    // Get smart recommendations for all preferences
    const preferences = ['cheapest', 'closest', 'balanced', 'highest_rated', 'safest'];
    
    const previewData = await Promise.all(
      preferences.map(async (preference) => {
        const options = await smartBookingService.findSmartBookingOptions({
          destinationLat: parseFloat(destinationLat),
          destinationLng: parseFloat(destinationLng),
          bookingTime: new Date(bookingTime),
          duration: parseInt(duration),
          preference,
          searchRadius: 2000,
          maxResults: 1
        });

        return {
          preference,
          available: options.success && options.spaces.length > 0,
          topOption: options.success && options.spaces.length > 0 ? {
            distance: options.spaces[0].distance,
            price: options.spaces[0].pricing.totalPrice,
            rating: options.spaces[0].parkingSpace.rating,
            features: getSpaceFeatures(options.spaces[0].parkingSpace).slice(0, 3),
            recommendation: options.spaces[0].recommendation
          } : null
        };
      })
    );

    // Get overall statistics
    const allOptions = await smartBookingService.findSmartBookingOptions({
      destinationLat: parseFloat(destinationLat),
      destinationLng: parseFloat(destinationLng),
      bookingTime: new Date(bookingTime),
      duration: parseInt(duration),
      preference: 'balanced',
      searchRadius: 2000,
      maxResults: 10
    });

    const statistics = allOptions.success && allOptions.spaces.length > 0 ? {
      totalAvailable: allOptions.spaces.length,
      priceRange: {
        min: Math.min(...allOptions.spaces.map(s => s.pricing.totalPrice)),
        max: Math.max(...allOptions.spaces.map(s => s.pricing.totalPrice)),
        avg: Math.round(allOptions.spaces.reduce((sum, s) => sum + s.pricing.totalPrice, 0) / allOptions.spaces.length)
      },
      distanceRange: {
        min: Math.min(...allOptions.spaces.map(s => s.distance)),
        max: Math.max(...allOptions.spaces.map(s => s.distance)),
        avg: Math.round(allOptions.spaces.reduce((sum, s) => sum + s.distance, 0) / allOptions.spaces.length)
      },
      averageRating: allOptions.spaces.reduce((sum, s) => sum + (s.parkingSpace.rating || 0), 0) / allOptions.spaces.length,
      securityFeatures: {
        withCCTV: allOptions.spaces.filter(s => s.parkingSpace.features?.hasCCTV).length,
        covered: allOptions.spaces.filter(s => s.parkingSpace.features?.isCovered).length,
        secured: allOptions.spaces.filter(s => s.parkingSpace.features?.isSecured).length
      }
    } : null;

    res.status(200).json({
      status: 'success',
      data: {
        destination: {
          name: destinationName,
          coordinates: { lat: destinationLat, lng: destinationLng }
        },
        bookingParameters: {
          time: bookingTime,
          duration: parseInt(duration)
        },
        preferencePreview: previewData,
        statistics,
        hasAvailableParking: statistics !== null,
        message: statistics 
          ? `Found ${statistics.totalAvailable} parking options near ${destinationName}`
          : `No parking spaces currently available near ${destinationName}`
      }
    });

  } catch (error) {
    logger.error('Destination preview error:', error);
    return next(new AppError('Failed to get destination parking preview', 500));
  }
});

// Helper functions
function getSelectionReason(preference, option) {
  switch (preference) {
    case 'cheapest':
      return `Selected for best price: ₱${option.pricing.totalPrice}`;
    case 'closest':
      return `Selected for proximity: ${option.distance}m from destination`;
    case 'highest_rated':
      return `Selected for rating: ${option.parkingSpace.rating}⭐ rating`;
    case 'safest':
      return `Selected for security: ${getSpaceFeatures(option.parkingSpace).filter(f => f.includes('🔒') || f.includes('📹')).join(', ')}`;
    case 'covered':
      return `Selected for weather protection: ${option.parkingSpace.features?.isCovered ? 'Covered parking' : 'Best available option'}`;
    case 'fastest_access':
      return `Selected for quick access: ${option.parkingSpace.accessType || 'Standard'} entry system`;
    case 'balanced':
    default:
      return `Selected for best overall value: Optimal balance of distance, price, and features`;
  }
}

function getSpaceFeatures(parkingSpace) {
  const features = [];
  const spaceFeatures = parkingSpace.features || {};
  
  if (spaceFeatures.isSecured) features.push('🔒 Secured');
  if (spaceFeatures.hasCCTV) features.push('📹 CCTV');
  if (spaceFeatures.isCovered) features.push('🏠 Covered');
  if (spaceFeatures.hasLighting) features.push('💡 Well-lit');
  if (spaceFeatures.hasWashroom) features.push('🚻 Washroom');
  if (spaceFeatures.has24HourAccess) features.push('🕐 24/7 Access');
  if (spaceFeatures.hasSecurityGuard) features.push('👮 Security Guard');
  
  return features.length > 0 ? features : ['Basic parking'];
}

function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

function toRadians(degrees) {
  return degrees * (Math.PI / 180);
}

module.exports = {
  autoSelectParkingSpace,
  getDestinationSuggestions,
  getDestinationParkingPreview
};
