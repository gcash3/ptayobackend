const logger = require('../config/logger');

/**
 * Manila Government Pricing Service
 * Implements Manila city parking rate guidelines and price standardization
 * Based on Manila Traffic and Parking Bureau (MTPB) Ordinance 7988
 */
class ManilaGovernmentPricingService {
  constructor() {
    // Updated Manila Government Rates (New Tiered Pricing Model)
    this.GOVERNMENT_RATES = {
      LIGHT_VEHICLES: {
        baseFeeMin: 20, // PHP 20 minimum for first 3 hours
        baseFeeMax: 30, // PHP 30 maximum for first 3 hours
        baseFeeDefault: 25, // PHP 25 default for first 3 hours
        baseHours: 3, // First 3 hours covered by base fee
        hourlyRateAfter: 20, // PHP 20 per hour after 3 hours
        category: 'light',
        description: 'Motorcycles, Pedicabs, Small Scooters',
        vehicles: ['motorcycle', 'scooter', 'pedicab']
      },
      MEDIUM_VEHICLES: {
        baseFeeMin: 40, // PHP 40 minimum for first 3 hours
        baseFeeMax: 50, // PHP 50 maximum for first 3 hours
        baseFeeDefault: 45, // PHP 45 default for first 3 hours
        baseHours: 3, // First 3 hours covered by base fee
        hourlyRateAfter: 30, // PHP 30 per hour after 3 hours
        category: 'medium',
        description: 'Cars, Jeeps, Vans, Small Trucks',
        vehicles: ['car', 'suv', 'van', 'jeep', 'pickup']
      },
      HEAVY_VEHICLES: {
        baseFeeMin: 60, // PHP 60 minimum for first 3 hours
        baseFeeMax: 80, // PHP 80 maximum for first 3 hours
        baseFeeDefault: 70, // PHP 70 default for first 3 hours
        baseHours: 3, // First 3 hours covered by base fee
        hourlyRateAfter: 50, // PHP 50 per hour after 3 hours
        category: 'heavy',
        description: 'Buses, Trucks, Heavy Equipment',
        vehicles: ['bus', 'truck', 'trailer']
      }
    };

    // Manila Market Analysis (Based on actual data from malls and private lots)
    this.MARKET_ANALYSIS = {
      MALL_RATES: {
        SM_STANDARD: { base: 50, type: 'fixed', succeeding: 0 },
        ROBINSONS: { base: 40, type: 'hourly', succeeding: 10 },
        LUCKY_CHINATOWN: { base: 50, type: 'hourly', succeeding: 20 },
        DIVISORIA_168: { base: 60, type: 'hourly', succeeding: 20, max: 130 }
      },
      AVERAGE_RATES: {
        minimum: 40,   // Lowest observed (Robinsons weekday)
        maximum: 130,  // Highest observed (Divisoria max)
        government: 50, // Government standard
        market_average: 55 // Market average
      },
      OVERNIGHT_PENALTY: 300, // Standard overnight penalty across Manila
      WEEKEND_PREMIUM: 1.2    // 20% premium on weekends
    };

    // Price Guidelines for Private Landlords
    this.PRICING_GUIDELINES = {
      RECOMMENDED_RANGES: {
        RESIDENTIAL: { min: 30, max: 60, recommended: 45 },
        COMMERCIAL: { min: 40, max: 80, recommended: 55 },
        UNIVERSITY: { min: 25, max: 50, recommended: 35 },
        HOSPITAL: { min: 35, max: 70, recommended: 50 },
        MALL_AREA: { min: 45, max: 90, recommended: 60 },
        CBD: { min: 60, max: 120, recommended: 80 },
        TOURIST_AREA: { min: 50, max: 100, recommended: 70 }
      },
      DAILY_RATE_RANGES: {
        RESIDENTIAL: { min: 360, max: 600, recommended: 450 },
        COMMERCIAL: { min: 400, max: 800, recommended: 550 },
        UNIVERSITY: { min: 300, max: 500, recommended: 350 },
        HOSPITAL: { min: 350, max: 700, recommended: 500 },
        MALL_AREA: { min: 450, max: 900, recommended: 600 },
        CBD: { min: 600, max: 1200, recommended: 800 },
        TOURIST_AREA: { min: 500, max: 1000, recommended: 700 }
      },
      COMPLIANCE_LEVELS: {
        BELOW_GOVERNMENT: 'below_standard',     // < PHP 50
        GOVERNMENT_COMPLIANT: 'compliant',      // PHP 50-70
        MARKET_RATE: 'market_rate',             // PHP 70-100
        PREMIUM: 'premium',                     // PHP 100-150
        EXCESSIVE: 'excessive'                  // > PHP 150
      }
    };

    // Service Fee Structure (Hybrid Model)
    this.SERVICE_FEES = {
      HYBRID_MODEL: {
        type: 'hybrid',
        flatFee: 5, // PHP 5 fixed fee per booking
        percentageRate: 0.05, // 5% of base parking fee
        description: 'Hybrid service fee: flat fee + percentage',
        applies_to: 'base_parking_fee'
      },
      PLATFORM_FEE: {
        type: 'percentage',
        rate: 0.15, // 15% platform fee (legacy)
        description: 'Platform maintenance, insurance, support',
        applies_to: 'booking_amount'
      },
      BOOKING_FEE: {
        type: 'fixed',
        amount: 10, // PHP 10 fixed booking fee (legacy)
        description: 'Transaction processing fee',
        applies_to: 'per_booking'
      },
      RECOMMENDED: 'hybrid_model' // New recommended hybrid model
    };
  }

  /**
   * Calculate tiered parking fee based on vehicle type and duration
   * @param {string} vehicleType - Type of vehicle (motorcycle, car, etc.)
   * @param {number} hours - Duration in hours
   * @param {Object} options - Additional options (baseFee override, etc.)
   * @returns {Object} Detailed pricing breakdown
   */
  calculateTieredParkingFee(vehicleType, hours, options = {}) {
    const vehicleCategory = this.getVehicleCategory(vehicleType);
    const rateConfig = this.GOVERNMENT_RATES[vehicleCategory];
    
    if (!rateConfig) {
      throw new Error(`Unknown vehicle category for type: ${vehicleType}`);
    }

    // Allow override of base fee (for landlord customization within range)
    const baseFee = options.baseFee || rateConfig.baseFeeDefault;
    
    // Validate base fee is within allowed range
    if (baseFee < rateConfig.baseFeeMin || baseFee > rateConfig.baseFeeMax) {
      throw new Error(`Base fee ₱${baseFee} is outside allowed range ₱${rateConfig.baseFeeMin}-₱${rateConfig.baseFeeMax}`);
    }

    let parkingFee = 0;
    let breakdown = {
      vehicleType,
      vehicleCategory,
      totalHours: hours,
      baseHours: rateConfig.baseHours,
      baseFee: baseFee,
      extraHours: 0,
      extraHourlyRate: rateConfig.hourlyRateAfter,
      extraHoursFee: 0
    };

    // Calculate parking fee using tiered structure
    if (hours <= rateConfig.baseHours) {
      // Within base hours - flat fee only
      parkingFee = baseFee;
    } else {
      // Beyond base hours - base fee + extra hourly charges
      const extraHours = hours - rateConfig.baseHours;
      const extraFee = extraHours * rateConfig.hourlyRateAfter;
      
      parkingFee = baseFee + extraFee;
      breakdown.extraHours = extraHours;
      breakdown.extraHoursFee = extraFee;
    }

    breakdown.totalParkingFee = parkingFee;

    // Calculate service fee using hybrid model
    const serviceFeeDetails = this.calculateHybridServiceFee(parkingFee);
    
    return {
      parkingFee: parkingFee,
      serviceFee: serviceFeeDetails.serviceFee,
      totalFee: parkingFee + serviceFeeDetails.serviceFee,
      breakdown: breakdown,
      serviceFeeBreakdown: serviceFeeDetails,
      rateConfig: {
        category: vehicleCategory,
        description: rateConfig.description,
        baseFeeRange: `₱${rateConfig.baseFeeMin}-₱${rateConfig.baseFeeMax}`,
        hourlyRateAfter: rateConfig.hourlyRateAfter
      }
    };
  }

  /**
   * Calculate hybrid service fee (flat + percentage)
   * @param {number} baseParkingFee - Base parking fee before service charges
   * @returns {Object} Service fee breakdown
   */
  calculateHybridServiceFee(baseParkingFee) {
    const hybridConfig = this.SERVICE_FEES.HYBRID_MODEL;
    
    const flatFee = hybridConfig.flatFee;
    const percentageFee = Math.round(baseParkingFee * hybridConfig.percentageRate);
    const serviceFee = flatFee + percentageFee;

    return {
      serviceFee: serviceFee,
      flatFee: flatFee,
      percentageFee: percentageFee,
      percentageRate: `${(hybridConfig.percentageRate * 100)}%`,
      baseParkingFee: baseParkingFee,
      breakdown: {
        flatComponent: flatFee,
        percentageComponent: percentageFee,
        totalServiceFee: serviceFee
      }
    };
  }

  /**
   * Determine vehicle category based on vehicle type
   * @param {string} vehicleType - Vehicle type (motorcycle, car, etc.)
   * @returns {string} Vehicle category (LIGHT_VEHICLES, MEDIUM_VEHICLES, HEAVY_VEHICLES)
   */
  getVehicleCategory(vehicleType) {
    const normalizedType = vehicleType.toLowerCase();
    
    for (const [category, config] of Object.entries(this.GOVERNMENT_RATES)) {
      if (config.vehicles && config.vehicles.includes(normalizedType)) {
        return category;
      }
    }
    
    // Default fallback based on common types
    if (['motorcycle', 'scooter', 'bike'].includes(normalizedType)) {
      return 'LIGHT_VEHICLES';
    } else if (['car', 'suv', 'sedan', 'hatchback'].includes(normalizedType)) {
      return 'MEDIUM_VEHICLES';
    } else {
      return 'HEAVY_VEHICLES'; // Conservative fallback
    }
  }

  /**
   * Get minimum booking duration requirement
   * @returns {number} Minimum hours required for booking
   */
  getMinimumBookingHours() {
    return 3; // Enforce minimum 3-hour booking
  }

  /**
   * Validate booking duration meets minimum requirements
   * @param {number} hours - Requested booking duration
   * @returns {Object} Validation result
   */
  validateBookingDuration(hours) {
    const minimumHours = this.getMinimumBookingHours();
    
    return {
      isValid: hours >= minimumHours,
      minimumRequired: minimumHours,
      requestedHours: hours,
      message: hours >= minimumHours 
        ? 'Duration meets minimum requirement'
        : `Minimum booking duration is ${minimumHours} hours. Please increase duration.`
    };
  }

  /**
   * Get government-compliant price recommendations for landlords
   * @param {Object} spaceData - Parking space details
   * @returns {Object} Price recommendations with compliance info
   */
  getPriceRecommendations(spaceData) {
    const {
      areaType = 'residential',
      proximityToLandmarks = [],
      vehicleCapacity = 'light',
      amenities = [],
      isSecured = false,
      hasCCTV = false,
      isRoofed = false
    } = spaceData;

    // Get base recommendation from area type
    const areaTypeUpper = areaType.toUpperCase();
    const baseGuideline = this.PRICING_GUIDELINES.RECOMMENDED_RANGES[areaTypeUpper] || 
                         this.PRICING_GUIDELINES.RECOMMENDED_RANGES.RESIDENTIAL;

    // Calculate premium factors
    let premiumMultiplier = 1.0;
    const premiumFactors = [];

    // Security premium
    if (isSecured || hasCCTV) {
      premiumMultiplier += 0.1; // +10%
      premiumFactors.push({ factor: 'security', bonus: '+10%' });
    }

    // Roof/covered premium
    if (isRoofed) {
      premiumMultiplier += 0.15; // +15%
      premiumFactors.push({ factor: 'covered', bonus: '+15%' });
    }

    // Proximity premiums
    proximityToLandmarks.forEach(landmark => {
      if (landmark.distance <= 200) { // Within 200m
        premiumMultiplier += 0.2; // +20%
        premiumFactors.push({ factor: `near_${landmark.type}`, bonus: '+20%' });
      } else if (landmark.distance <= 500) { // Within 500m
        premiumMultiplier += 0.1; // +10%
        premiumFactors.push({ factor: `close_${landmark.type}`, bonus: '+10%' });
      }
    });

    // Calculate final recommendations
    const recommendedPrice = Math.round(baseGuideline.recommended * premiumMultiplier);
    const minPrice = Math.max(baseGuideline.min, this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin);
    const maxPrice = Math.min(baseGuideline.max * premiumMultiplier, 200);

    // Determine compliance level
    const complianceLevel = this.getComplianceLevel(recommendedPrice);

    return {
      areaType,
      vehicleCategory: vehicleCapacity,
      government_baseline: this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeDefault,
      
      recommendations: {
        minimum: Math.round(minPrice),
        recommended: recommendedPrice,
        maximum: Math.round(maxPrice),
        premium_factors: premiumFactors,
        total_premium: `+${Math.round((premiumMultiplier - 1) * 100)}%`
      },
      
      compliance: {
        level: complianceLevel,
        description: this.getComplianceDescription(complianceLevel),
        government_compliant: recommendedPrice >= this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin
      },
      
      market_comparison: {
        vs_government: recommendedPrice - this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeDefault,
        vs_market_average: recommendedPrice - this.MARKET_ANALYSIS.AVERAGE_RATES.market_average,
        competitive_position: this.getCompetitivePosition(recommendedPrice)
      },

      guidelines: {
        ordinance: 'Manila Ordinance 7988 (March 2020)',
        last_updated: 'August 2025',
        source: 'Manila Traffic and Parking Bureau (MTPB)'
      }
    };
  }

  /**
   * Validate if a price is government compliant
   */
  validatePriceCompliance(price, areaType = 'residential') {
    const governmentMin = this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin;
    const areaGuideline = this.PRICING_GUIDELINES.RECOMMENDED_RANGES[areaType.toUpperCase()] || 
                         this.PRICING_GUIDELINES.RECOMMENDED_RANGES.RESIDENTIAL;

    const validation = {
      price,
      is_compliant: price >= governmentMin,
      government_minimum: governmentMin,
      area_recommended_range: areaGuideline,
      compliance_level: this.getComplianceLevel(price),
      warnings: [],
      suggestions: []
    };

    // Add warnings and suggestions
    if (price < governmentMin) {
      validation.warnings.push(`Price below government minimum of ₱${governmentMin}`);
      validation.suggestions.push(`Increase to at least ₱${governmentMin} for compliance`);
    }

    if (price > areaGuideline.max * 1.5) {
      validation.warnings.push('Price significantly above market rate');
      validation.suggestions.push(`Consider reducing to ₱${areaGuideline.max} for better competitiveness`);
    }

    if (price < areaGuideline.min) {
      validation.suggestions.push(`Consider increasing to ₱${areaGuideline.recommended} for better revenue`);
    }

    return validation;
  }

  /**
   * Validate daily rate compliance with Manila LGU guidelines
   */
  validateDailyRateCompliance(dailyRate, areaType = 'residential') {
    const areaGuideline = this.PRICING_GUIDELINES.DAILY_RATE_RANGES[areaType.toUpperCase()] || 
                         this.PRICING_GUIDELINES.DAILY_RATE_RANGES.RESIDENTIAL;

    const validation = {
      daily_rate: dailyRate,
      is_compliant: dailyRate >= areaGuideline.min && dailyRate <= areaGuideline.max,
      area_recommended_range: areaGuideline,
      compliance_level: this.getDailyRateComplianceLevel(dailyRate, areaGuideline),
      warnings: [],
      suggestions: []
    };

    // Add warnings and suggestions for daily rates
    if (dailyRate < areaGuideline.min) {
      validation.warnings.push(`Daily rate below recommended minimum of ₱${areaGuideline.min}`);
      validation.suggestions.push(`Consider increasing to at least ₱${areaGuideline.min} for better compliance`);
    } else if (dailyRate > areaGuideline.max) {
      validation.warnings.push(`Daily rate above recommended maximum of ₱${areaGuideline.max}`);
      validation.suggestions.push(`Consider reducing to ₱${areaGuideline.max} or below for better market acceptance`);
    } else {
      validation.suggestions.push(`Daily rate is within recommended range of ₱${areaGuideline.min}-₱${areaGuideline.max}`);
    }

    return validation;
  }

  /**
   * Get compliance level for daily rates
   */
  getDailyRateComplianceLevel(dailyRate, areaGuideline) {
    if (dailyRate < areaGuideline.min) {
      return 'below_recommended';
    } else if (dailyRate <= areaGuideline.recommended) {
      return 'optimal';
    } else if (dailyRate <= areaGuideline.max) {
      return 'acceptable';
    } else {
      return 'excessive';
    }
  }

  /**
   * Calculate service fees for a booking
   */
  calculateServiceFees(bookingAmount, feeType = 'platform_fee') {
    const feeConfig = this.SERVICE_FEES[feeType.toUpperCase()];
    
    if (!feeConfig) {
      throw new Error('Invalid fee type');
    }

    let serviceFee = 0;
    let feeDetails = {};

    if (feeConfig.type === 'percentage') {
      serviceFee = Math.round(bookingAmount * feeConfig.rate);
      feeDetails = {
        type: 'percentage',
        rate: `${(feeConfig.rate * 100)}%`,
        base_amount: bookingAmount,
        fee_amount: serviceFee,
        description: feeConfig.description
      };
    } else if (feeConfig.type === 'fixed') {
      serviceFee = feeConfig.amount;
      feeDetails = {
        type: 'fixed',
        fee_amount: serviceFee,
        description: feeConfig.description
      };
    }

    const totalAmount = bookingAmount + serviceFee;
    const landlordEarnings = bookingAmount - (feeType === 'platform_fee' ? serviceFee : 0);

    return {
      booking_amount: bookingAmount,
      service_fee: serviceFee,
      total_amount: totalAmount,
      landlord_earnings: landlordEarnings,
      platform_earnings: serviceFee,
      fee_details: feeDetails,
      breakdown: {
        customer_pays: totalAmount,
        landlord_receives: landlordEarnings,
        platform_receives: serviceFee
      }
    };
  }

  /**
   * Get comprehensive pricing insights for landlords
   */
  getLandlordPricingInsights(currentPrice, spaceData) {
    const recommendations = this.getPriceRecommendations(spaceData);
    const validation = this.validatePriceCompliance(currentPrice, spaceData.areaType);
    const serviceFeeExample = this.calculateServiceFees(currentPrice * 8); // 8-hour example

    const insights = {
      current_pricing: {
        hourly_rate: currentPrice,
        daily_rate: currentPrice * 24,
        compliance: validation,
        market_position: this.getCompetitivePosition(currentPrice)
      },
      
      recommendations,
      
      revenue_projection: {
        current_daily: currentPrice * 8, // 8-hour average
        recommended_daily: recommendations.recommendations.recommended * 8,
        potential_increase: (recommendations.recommendations.recommended - currentPrice) * 8,
        monthly_difference: (recommendations.recommendations.recommended - currentPrice) * 8 * 30
      },
      
      service_fees: serviceFeeExample,
      
      optimization_tips: this.getOptimizationTips(currentPrice, recommendations),
      
      government_compliance: {
        ordinance: 'Manila Ordinance 7988',
        minimum_required: this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin,
        is_compliant: validation.is_compliant,
        penalties_for_non_compliance: 'Possible fines and permit issues'
      }
    };

    return insights;
  }

  /**
   * Helper methods
   */
  getComplianceLevel(price) {
    if (price < this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin) {
      return this.PRICING_GUIDELINES.COMPLIANCE_LEVELS.BELOW_GOVERNMENT;
    } else if (price <= 70) {
      return this.PRICING_GUIDELINES.COMPLIANCE_LEVELS.GOVERNMENT_COMPLIANT;
    } else if (price <= 100) {
      return this.PRICING_GUIDELINES.COMPLIANCE_LEVELS.MARKET_RATE;
    } else if (price <= 150) {
      return this.PRICING_GUIDELINES.COMPLIANCE_LEVELS.PREMIUM;
    } else {
      return this.PRICING_GUIDELINES.COMPLIANCE_LEVELS.EXCESSIVE;
    }
  }

  getComplianceDescription(level) {
    const descriptions = {
      below_standard: '⚠️ Below government minimum - compliance issues possible',
      compliant: '✅ Government compliant - meets Manila city standards',
      market_rate: '📊 Market competitive - above government, within market range',
      premium: '💎 Premium pricing - high-end market segment',
      excessive: '❌ Potentially excessive - may deter customers'
    };
    return descriptions[level] || 'Unknown compliance level';
  }

  getCompetitivePosition(price) {
    const avgMarket = this.MARKET_ANALYSIS.AVERAGE_RATES.market_average;
    const diff = price - avgMarket;
    
    if (diff <= -15) return 'very_competitive';
    if (diff <= -5) return 'competitive';
    if (diff <= 5) return 'market_average';
    if (diff <= 15) return 'above_market';
    return 'premium_pricing';
  }

  getOptimizationTips(currentPrice, recommendations) {
    const tips = [];
    const recommended = recommendations.recommendations.recommended;

    if (currentPrice < recommended) {
      tips.push(`💡 Consider increasing price to ₱${recommended} for ${((recommended - currentPrice) / currentPrice * 100).toFixed(1)}% more revenue`);
    }

    if (currentPrice < this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin) {
      tips.push(`⚠️ Increase price to government minimum ₱${this.GOVERNMENT_RATES.LIGHT_VEHICLES.baseFeeMin} for legal compliance`);
    }

    if (recommendations.recommendations.premium_factors.length > 0) {
      tips.push('🚀 Highlight your premium features (security, covered, proximity) to justify higher rates');
    }

    tips.push('📱 Use dynamic pricing during peak hours for maximum revenue');
    tips.push('🎯 Monitor competitor prices in your area regularly');

    return tips;
  }
}

module.exports = new ManilaGovernmentPricingService();
