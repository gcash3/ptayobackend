const { validationResult } = require('express-validator');
const manilaGovernmentPricingService = require('../services/manilaGovernmentPricingService');
const commissionService = require('../services/commissionService');
const ParkingSpace = require('../models/ParkingSpace');
const { catchAsync, AppError, createValidationError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Get Manila government pricing guidelines for landlords
 */
const getPricingGuidelines = catchAsync(async (req, res, next) => {
  const {
    areaType = 'residential',
    proximityToLandmarks = [],
    vehicleCapacity = 'light',
    amenities = [],
    isSecured = false,
    hasCCTV = false,
    isRoofed = false
  } = req.query;

  // Parse proximityToLandmarks if it's a string
  let landmarks = [];
  if (typeof proximityToLandmarks === 'string') {
    try {
      landmarks = JSON.parse(proximityToLandmarks);
    } catch (e) {
      landmarks = [];
    }
  } else if (Array.isArray(proximityToLandmarks)) {
    landmarks = proximityToLandmarks;
  }

  const spaceData = {
    areaType,
    proximityToLandmarks: landmarks,
    vehicleCapacity,
    amenities: Array.isArray(amenities) ? amenities : [],
    isSecured: isSecured === 'true',
    hasCCTV: hasCCTV === 'true',
    isRoofed: isRoofed === 'true'
  };

  const recommendations = manilaGovernmentPricingService.getPriceRecommendations(spaceData);

  res.status(200).json({
    status: 'success',
    data: {
      guidelines: recommendations,
      government_info: {
        ordinance: 'Manila Ordinance 7988',
        effective_date: 'March 25, 2020',
        authority: 'Manila Traffic and Parking Bureau (MTPB)',
        minimum_rate: 50,
        applicable_vehicles: 'Light Vehicles (Car, Jeep, Motorcycles, Pedicabs)'
      },
      helpful_tips: [
        '💡 Start with government-compliant pricing for safety',
        '📈 Use dynamic pricing during peak hours for extra revenue',
        '⭐ Higher ratings allow for premium pricing',
        '🔒 Security features justify 10-20% price premium',
        '🏠 Location near landmarks increases value significantly'
      ]
    }
  });
});

/**
 * Validate landlord's proposed pricing
 */
const validatePricing = catchAsync(async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      logger.warn('❌ LGU Validation - Request validation failed', {
        errors: errors.array(),
        userId: req.user?.id
      });
      return next(createValidationError(errors));
    }

  const {
    hourlyRate,
    dailyRate,
    areaType = 'residential',
    spaceFeatures = {}
  } = req.body;

  // 🐛 DEBUG: Log incoming request data
  logger.info('🔍 LGU Pricing Validation Request', {
    userId: req.user?.id,
    hourlyRate,
    dailyRate,
    areaType,
    spaceFeatures,
    requestBody: req.body,
    timestamp: new Date().toISOString()
  });

  // Validate hourly rate
  const hourlyValidation = manilaGovernmentPricingService.validatePriceCompliance(
    hourlyRate, 
    areaType
  );

  // 🐛 DEBUG: Log validation results
  logger.info('📊 LGU Validation Results', {
    userId: req.user?.id,
    hourlyValidation,
    isCompliant: hourlyValidation.is_compliant,
    complianceLevel: hourlyValidation.compliance_level,
    timestamp: new Date().toISOString()
  });

  // Validate daily rate compliance with LGU guidelines
  let dailyValidation = null;
  if (dailyRate && dailyRate > 0) {
    dailyValidation = manilaGovernmentPricingService.validateDailyRateCompliance(
      dailyRate, 
      areaType
    );
    
    // 🐛 DEBUG: Log daily rate validation
    logger.info('📅 Daily Rate LGU Validation', {
      userId: req.user?.id,
      dailyValidation,
      isDailyCompliant: dailyValidation.is_compliant,
      dailyComplianceLevel: dailyValidation.compliance_level,
      timestamp: new Date().toISOString()
    });
  }

  // Validate daily rate ratio (should be reasonable compared to hourly)
  const expectedDailyRate = hourlyRate * 24;
  const dailyRateRatio = dailyRate / expectedDailyRate;
  
  let dailyRateWarnings = [];
  if (dailyRateRatio > 1.2) {
    dailyRateWarnings.push('Daily rate seems high compared to hourly rate');
  } else if (dailyRateRatio < 0.7) {
    dailyRateWarnings.push('Daily rate might be too low - consider increasing for better revenue');
  }

  // Get commission breakdown
  const commissionBreakdown = commissionService.calculateCommission({
    bookingAmount: hourlyRate * 8, // 8-hour average booking
    commissionType: 'PLATFORM_FEE'
  });

  const validation = {
    hourly_rate: {
      rate: hourlyRate,
      validation: hourlyValidation,
      commission_example: {
        booking_amount: hourlyRate * 8,
        your_earnings: commissionBreakdown.landlord_breakdown.net_earnings,
        platform_fee: commissionBreakdown.commission_amount,
        earnings_percentage: commissionBreakdown.landlord_breakdown.earnings_percentage
      }
    },
    
    daily_rate: {
      rate: dailyRate,
      lgu_validation: dailyValidation,
      expected_range: {
        min: Math.round(hourlyRate * 20), // 20 hours effective
        max: Math.round(hourlyRate * 24), // 24 hours maximum
        recommended: Math.round(hourlyRate * 22) // 22 hours sweet spot
      },
      warnings: dailyRateWarnings,
      commission_example: {
        booking_amount: dailyRate,
        your_earnings: dailyRate - Math.round(dailyRate * 0.15),
        platform_fee: Math.round(dailyRate * 0.15),
        earnings_percentage: 85
      }
    },
    
    overall_assessment: {
      government_compliant: hourlyValidation.is_compliant,
      daily_rate_compliant: dailyValidation ? dailyValidation.is_compliant : true,
      market_competitive: hourlyValidation.compliance_level !== 'excessive',
      revenue_optimized: hourlyRate >= 45 && hourlyRate <= 80,
      recommended_action: getRecommendedAction(hourlyValidation, hourlyRate)
    }
  };

  // 🐛 DEBUG: Log final response
  logger.info('✅ LGU Validation Response', {
    userId: req.user?.id,
    isGovernmentCompliant: validation.overall_assessment.government_compliant,
    recommendedAction: validation.overall_assessment.recommended_action,
    fullValidation: validation,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    status: 'success',
    data: validation
  });

  } catch (error) {
    logger.error('❌ LGU Validation Error', {
      error: error.message,
      stack: error.stack,
      userId: req.user?.id,
      requestBody: req.body,
      timestamp: new Date().toISOString()
    });
    throw error; // Re-throw to let catchAsync handle it
  }
});

/**
 * Get comprehensive pricing insights for a landlord's space
 */
const getPricingInsights = catchAsync(async (req, res, next) => {
  const landlordId = req.user.id;
  const { spaceId } = req.params;

  // Get parking space details
  const parkingSpace = await ParkingSpace.findOne({
    _id: spaceId,
    landlordId
  }).populate('landlordId', 'firstName lastName');

  if (!parkingSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  const currentHourlyRate = parkingSpace.pricing?.hourlyRate || 50;
  
  // Prepare space data for analysis
  const spaceData = {
    areaType: parkingSpace.areaType || 'residential',
    proximityToLandmarks: parkingSpace.proximityToLandmarks || [],
    vehicleCapacity: 'light',
    amenities: parkingSpace.amenities || [],
    isSecured: parkingSpace.features?.isSecured || false,
    hasCCTV: parkingSpace.features?.hasCCTV || false,
    isRoofed: parkingSpace.features?.isCovered || false
  };

  // Get comprehensive insights
  const insights = manilaGovernmentPricingService.getLandlordPricingInsights(
    currentHourlyRate,
    spaceData
  );

  // Get monthly projections
  const projections = commissionService.calculateMonthlyProjections({
    avgBookingAmount: currentHourlyRate * 6, // 6-hour average
    avgBookingsPerDay: 2, // Conservative estimate
    daysActive: 30
  });

  // Get customer and landlord transparency
  const customerTransparency = commissionService.getCustomerCommissionTransparency({
    bookingAmount: currentHourlyRate * 6
  });

  const landlordTransparency = commissionService.getLandlordCommissionTransparency({
    bookingAmount: currentHourlyRate * 6
  });

  res.status(200).json({
    status: 'success',
    data: {
      parking_space: {
        id: parkingSpace._id,
        title: parkingSpace.title,
        location: parkingSpace.location,
        current_pricing: parkingSpace.pricing,
        features: parkingSpace.features,
        rating: parkingSpace.rating || 0
      },
      
      pricing_insights: insights,
      revenue_projections: projections,
      commission_transparency: {
        for_customers: customerTransparency,
        for_you: landlordTransparency
      },
      
      action_items: [
        {
          priority: 'high',
          action: 'Update pricing based on recommendations',
          impact: 'Increase revenue by up to 30%'
        },
        {
          priority: 'medium', 
          action: 'Add security features (CCTV, lighting)',
          impact: 'Justify 10-20% premium pricing'
        },
        {
          priority: 'low',
          action: 'Encourage customer reviews',
          impact: 'Higher ratings enable premium pricing'
        }
      ]
    }
  });
});

/**
 * Get market analysis for landlord's area
 */
const getMarketAnalysis = catchAsync(async (req, res, next) => {
  const { latitude, longitude, radius = 2000 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  // Find competing parking spaces in the area
  const competingSpaces = await ParkingSpace.find({
    location: {
      $near: {
        $geometry: { type: "Point", coordinates: [parseFloat(longitude), parseFloat(latitude)] },
        $maxDistance: parseInt(radius)
      }
    },
    status: 'active',
    'pricing.hourlyRate': { $exists: true }
  }).select('title pricing.hourlyRate features rating location');

  if (competingSpaces.length === 0) {
    return res.status(200).json({
      status: 'success',
      data: {
        message: 'No competing parking spaces found in your area',
        opportunity: 'You could be the first to list in this area!',
        suggested_pricing: manilaGovernmentPricingService.getPriceRecommendations({
          areaType: 'residential'
        })
      }
    });
  }

  // Analyze market data
  const hourlyRates = competingSpaces.map(space => space.pricing.hourlyRate);
  const ratings = competingSpaces.map(space => space.rating || 0);

  const marketAnalysis = {
    area_overview: {
      total_competitors: competingSpaces.length,
      search_radius: `${radius}m`,
      center_location: { latitude: parseFloat(latitude), longitude: parseFloat(longitude) }
    },
    
    pricing_analysis: {
      lowest_rate: Math.min(...hourlyRates),
      highest_rate: Math.max(...hourlyRates),
      average_rate: Math.round(hourlyRates.reduce((a, b) => a + b, 0) / hourlyRates.length),
      median_rate: this.calculateMedian(hourlyRates),
      government_minimum: 50
    },
    
    quality_analysis: {
      average_rating: ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : 0,
      highly_rated_count: ratings.filter(r => r >= 4.0).length,
      premium_spaces: competingSpaces.filter(s => s.pricing.hourlyRate > 70).length
    },
    
    competitive_positioning: {
      price_to_beat_cheapest: Math.min(...hourlyRates) - 5,
      competitive_price_range: {
        min: Math.round(Math.min(...hourlyRates) * 0.9),
        max: Math.round(Math.max(...hourlyRates) * 1.1)
      },
      premium_opportunity: Math.max(...hourlyRates) + 10
    },
    
    recommendations: [
      `💰 Price between ₱${Math.round(Math.min(...hourlyRates) * 0.9)}-₱${Math.round(Math.max(...hourlyRates) * 1.1)} to be competitive`,
      `⭐ Aim for 4+ star rating to justify premium pricing`,
      `🔒 Add security features to differentiate from competition`,
      `📍 Highlight unique location advantages`
    ]
  };

  res.status(200).json({
    status: 'success',
    data: marketAnalysis
  });
});

/**
 * Update parking space pricing with validation
 */
const updatePricing = catchAsync(async (req, res, next) => {
  const landlordId = req.user.id;
  const { spaceId } = req.params;
  const { hourlyRate, dailyRate, weeklyRate, monthlyRate } = req.body;

  // Validate pricing
  const validation = manilaGovernmentPricingService.validatePriceCompliance(hourlyRate);
  
  if (!validation.is_compliant) {
    return next(new AppError(`Pricing not compliant: ${validation.warnings.join(', ')}`, 400));
  }

  // Update parking space
  const updatedSpace = await ParkingSpace.findOneAndUpdate(
    { _id: spaceId, landlordId },
    {
      $set: {
        'pricing.hourlyRate': hourlyRate,
        'pricing.dailyRate': dailyRate,
        'pricing.weeklyRate': weeklyRate,
        'pricing.monthlyRate': monthlyRate,
        'pricing.lastUpdated': new Date(),
        'pricing.isGovernmentCompliant': true
      }
    },
    { new: true, runValidators: true }
  );

  if (!updatedSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  logger.info(`Pricing updated for space ${spaceId} by landlord ${landlordId}: ₱${hourlyRate}/hour`);

  res.status(200).json({
    status: 'success',
    message: 'Pricing updated successfully',
    data: {
      parking_space: updatedSpace,
      validation: validation,
      commission_preview: commissionService.calculateCommission({
        bookingAmount: hourlyRate * 6 // 6-hour example
      })
    }
  });
});

/**
 * Helper function to get recommended action
 */
function getRecommendedAction(validation, currentPrice) {
  if (!validation.is_compliant) {
    return 'INCREASE_TO_COMPLY';
  } else if (validation.compliance_level === 'below_standard') {
    return 'INCREASE_TO_MINIMUM';
  } else if (validation.compliance_level === 'excessive') {
    return 'DECREASE_TO_MARKET';
  } else {
    return 'OPTIMIZE_WITH_FEATURES';
  }
}

/**
 * Helper function to calculate median
 */
function calculateMedian(numbers) {
  const sorted = numbers.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  } else {
    return sorted[middle];
  }
}

module.exports = {
  getPricingGuidelines,
  validatePricing,
  getPricingInsights,
  getMarketAnalysis,
  updatePricing
};
