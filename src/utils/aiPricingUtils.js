const newDynamicPricingService = require('../services/newDynamicPricingService');
const logger = require('../config/logger');

/**
 * AI Pricing Utilities
 * Provides accurate pricing calculations for AI suggestions and user behavior analysis
 */
class AIPricingUtils {
  constructor() {
    this.dynamicPricingService = newDynamicPricingService;

    // Default duration for AI suggestions (most common booking length)
    this.DEFAULT_DURATION = 3; // hours

    // Cache pricing calculations for performance
    this.pricingCache = new Map();
    this.CACHE_TTL = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Calculate total cost for AI suggestions
   * This is what users will actually pay including all fees
   * @param {Object} parkingSpace - Parking space document
   * @param {Date} bookingTime - When user plans to book (optional)
   * @param {number} duration - Booking duration in hours (optional)
   * @param {string} vehicleType - Vehicle type (optional)
   * @returns {Object} Total cost and breakdown
   */
  async calculateTotalCostForAI(parkingSpace, bookingTime = new Date(), duration = this.DEFAULT_DURATION, vehicleType = 'car') {
    try {
      const cacheKey = `${parkingSpace._id}_${bookingTime.getHours()}_${duration}_${vehicleType}`;

      // Check cache first
      const cached = this.pricingCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.CACHE_TTL) {
        return cached.data;
      }

      // Calculate full pricing using the production pricing service
      const pricingResult = await this.dynamicPricingService.calculatePricing({
        parkingSpaceId: parkingSpace._id,
        startTime: bookingTime,
        duration: duration,
        vehicleType: vehicleType,
        isWeekend: this.isWeekend(bookingTime),
        isHoliday: false // Could be enhanced with holiday service
      });

      const totalCost = pricingResult.customer.totalAmount;

      // Validate that totalCost is a valid number
      if (!totalCost || isNaN(totalCost) || totalCost <= 0) {
        logger.warn(`Invalid totalCost (${totalCost}) from dynamic pricing, using fallback`);
        return this.getFallbackPricing(parkingSpace, duration);
      }

      const breakdown = {
        basePrice: pricingResult.customer.breakdown.baseAmount || 0,
        dynamicAdjustments: pricingResult.customer.breakdown.dynamicAdjustments || 0,
        serviceFee: pricingResult.customer.breakdown.serviceFee || 0,
        total: totalCost,
        factors: pricingResult.metadata.appliedFactors || {}
      };

      // Cache the result
      this.pricingCache.set(cacheKey, {
        data: { totalCost, breakdown },
        timestamp: Date.now()
      });

      return { totalCost, breakdown };

    } catch (error) {
      logger.warn(`AI pricing calculation failed for space ${parkingSpace._id}: ${error.message}`);

      // Fallback to simple calculation
      return this.getFallbackPricing(parkingSpace, duration);
    }
  }

  /**
   * Analyze user's actual spending patterns from booking history
   * This replaces the broken price range analysis in AI suggestions
   * @param {Array} userBookings - User's booking history
   * @returns {Object} User's pricing preferences and patterns
   */
  analyzeUserSpendingPatterns(userBookings) {
    if (!userBookings || userBookings.length === 0) {
      return this.getDefaultSpendingPatterns();
    }

    const validBookings = userBookings.filter(booking =>
      booking.totalAmount && booking.totalAmount > 0
    );

    if (validBookings.length === 0) {
      return this.getDefaultSpendingPatterns();
    }

    // Calculate actual spending statistics
    const amounts = validBookings.map(b => b.totalAmount);
    const totalSpent = amounts.reduce((sum, amount) => sum + amount, 0);
    const averageSpent = totalSpent / amounts.length;
    const minSpent = Math.min(...amounts);
    const maxSpent = Math.max(...amounts);

    // Calculate price sensitivity (how much variance in their spending)
    const variance = amounts.reduce((sum, amount) => sum + Math.pow(amount - averageSpent, 2), 0) / amounts.length;
    const priceSensitivity = Math.sqrt(variance) / averageSpent; // Coefficient of variation

    // Analyze price-to-rating correlation (do they pay more for better spaces?)
    const ratedBookings = validBookings.filter(b => b.rating && b.rating > 0);
    let priceQualityPreference = 'balanced';

    if (ratedBookings.length >= 3) {
      const correlation = this.calculatePriceRatingCorrelation(ratedBookings);
      if (correlation > 0.3) {
        priceQualityPreference = 'quality_focused'; // Willing to pay more for quality
      } else if (correlation < -0.1) {
        priceQualityPreference = 'budget_focused'; // Prefers cheaper regardless of rating
      }
    }

    // Define comfortable spending ranges
    const comfortRange = {
      min: Math.max(minSpent * 0.8, 30), // Never go below ₱30
      preferred: averageSpent,
      max: Math.min(maxSpent * 1.2, averageSpent * 2), // Don't suggest 2x their average
      absolute_max: maxSpent
    };

    return {
      totalSpent,
      averageSpent: Math.round(averageSpent),
      comfortRange,
      priceSensitivity: Math.round(priceSensitivity * 100), // As percentage
      priceQualityPreference,
      bookingCount: validBookings.length,
      spendingTrend: this.calculateSpendingTrend(validBookings),
      lastUpdateDate: new Date()
    };
  }

  /**
   * Calculate price compatibility score for AI suggestions
   * @param {number} spaceTotalCost - Total cost of the parking space
   * @param {Object} userSpendingPattern - User's spending analysis
   * @returns {Object} Price score and reasoning
   */
  calculatePriceCompatibilityScore(spaceTotalCost, userSpendingPattern) {
    const { comfortRange, priceSensitivity, priceQualityPreference } = userSpendingPattern;

    let score = 0;
    let factors = [];

    // Base score based on price range
    if (spaceTotalCost <= comfortRange.preferred) {
      score += 25; // Within preferred range
      factors.push(`Within your typical ₱${Math.round(comfortRange.preferred)} budget`);
    } else if (spaceTotalCost <= comfortRange.max) {
      score += 15; // Acceptable range
      factors.push(`Slightly above usual but within range`);
    } else if (spaceTotalCost <= comfortRange.absolute_max) {
      score += 5; // Upper limit
      factors.push(`Higher than usual but you've paid this before`);
    } else {
      score -= 10; // Too expensive
      factors.push(`Above your typical budget of ₱${Math.round(comfortRange.max)}`);
    }

    // Adjust for price sensitivity
    if (priceSensitivity < 20) { // Low sensitivity = consistent spending
      score += 5;
      factors.push('Consistent with your spending pattern');
    } else if (priceSensitivity > 50) { // High sensitivity = price conscious
      if (spaceTotalCost > comfortRange.preferred) {
        score -= 5;
        factors.push('Higher than your usual price range');
      } else {
        score += 10;
        factors.push('Great value for your budget');
      }
    }

    // Adjust for quality preference
    if (priceQualityPreference === 'budget_focused' && spaceTotalCost <= comfortRange.preferred * 0.9) {
      score += 10;
      factors.push('Budget-friendly option');
    } else if (priceQualityPreference === 'quality_focused' && spaceTotalCost <= comfortRange.max) {
      score += 5;
      factors.push('Worth the investment for quality');
    }

    return {
      score: Math.max(0, Math.min(25, score)), // Capped at 25 points
      factors,
      priceCategory: this.categorizePricePoint(spaceTotalCost, comfortRange)
    };
  }

  /**
   * Get default spending patterns for new users
   */
  getDefaultSpendingPatterns() {
    return {
      totalSpent: 0,
      averageSpent: 60, // Reasonable default for Metro Manila
      comfortRange: {
        min: 30,
        preferred: 60,
        max: 120,
        absolute_max: 200
      },
      priceSensitivity: 30, // Moderate sensitivity
      priceQualityPreference: 'balanced',
      bookingCount: 0,
      spendingTrend: 'no_data',
      lastUpdateDate: new Date(),
      isDefault: true
    };
  }

  /**
   * Helper functions
   */
  isWeekend(date) {
    const day = date.getDay();
    return day === 0 || day === 6; // Sunday = 0, Saturday = 6
  }

  getFallbackPricing(parkingSpace, duration) {
    // Simple fallback when dynamic pricing fails
    let basePrice = 20; // Default fallback

    if (parkingSpace.pricePerHour && !isNaN(parkingSpace.pricePerHour)) {
      basePrice = parkingSpace.pricePerHour;
    } else if (parkingSpace.pricePer3Hours && !isNaN(parkingSpace.pricePer3Hours)) {
      basePrice = parkingSpace.pricePer3Hours / 3;
    }

    // Ensure all values are valid numbers
    basePrice = Math.max(basePrice || 20, 20); // Minimum ₱20/hour
    duration = Math.max(duration || 3, 1); // Minimum 1 hour

    const baseCost = basePrice * duration;
    const serviceFee = 5;
    const totalCost = baseCost + serviceFee;

    return {
      totalCost,
      breakdown: {
        basePrice: baseCost,
        dynamicAdjustments: 0,
        serviceFee: serviceFee,
        total: totalCost,
        factors: { fallback: true }
      }
    };
  }

  calculatePriceRatingCorrelation(ratedBookings) {
    if (ratedBookings.length < 2) return 0;

    const n = ratedBookings.length;
    const prices = ratedBookings.map(b => b.totalAmount);
    const ratings = ratedBookings.map(b => b.rating);

    const sumX = prices.reduce((a, b) => a + b, 0);
    const sumY = ratings.reduce((a, b) => a + b, 0);
    const sumXY = prices.reduce((sum, price, i) => sum + price * ratings[i], 0);
    const sumX2 = prices.reduce((sum, price) => sum + price * price, 0);
    const sumY2 = ratings.reduce((sum, rating) => sum + rating * rating, 0);

    const numerator = n * sumXY - sumX * sumY;
    const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));

    return denominator === 0 ? 0 : numerator / denominator;
  }

  calculateSpendingTrend(bookings) {
    if (bookings.length < 3) return 'insufficient_data';

    const sortedBookings = bookings.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    const firstHalf = sortedBookings.slice(0, Math.floor(bookings.length / 2));
    const secondHalf = sortedBookings.slice(Math.floor(bookings.length / 2));

    const firstAvg = firstHalf.reduce((sum, b) => sum + b.totalAmount, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, b) => sum + b.totalAmount, 0) / secondHalf.length;

    const change = (secondAvg - firstAvg) / firstAvg;

    if (change > 0.15) return 'increasing'; // Spending more over time
    if (change < -0.15) return 'decreasing'; // Spending less over time
    return 'stable'; // Consistent spending
  }

  categorizePricePoint(price, comfortRange) {
    if (price <= comfortRange.preferred * 0.8) return 'budget';
    if (price <= comfortRange.preferred) return 'preferred';
    if (price <= comfortRange.max) return 'acceptable';
    if (price <= comfortRange.absolute_max) return 'expensive';
    return 'too_expensive';
  }

  /**
   * Clear pricing cache (call periodically or when pricing config changes)
   */
  clearCache() {
    this.pricingCache.clear();
    logger.info('AI pricing cache cleared');
  }
}

module.exports = new AIPricingUtils();