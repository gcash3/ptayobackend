const logger = require('../config/logger');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const manilaGovernmentPricingService = require('./manilaGovernmentPricingService');

/**
 * Dynamic Pricing Service
 *
 * Pricing Structure:
 * - Landlord sets base price (e.g., 60 PHP for first 3 hours)
 * - Platform applies dynamic pricing adjustments
 * - Landlord gets only their base price + base overtime charges
 * - Platform keeps all dynamic pricing, commission, and service fees
 */
class DynamicPricingService {
  constructor() {
    // Peak hours configuration (can be customized per location)
    this.PEAK_HOURS = [
      { start: 8, end: 10 },   // Morning rush: 8-10 AM
      { start: 17, end: 19 },  // Evening rush: 5-7 PM
      { start: 20, end: 22 }   // Night peak: 8-10 PM (for universities)
    ];
    
    // Pricing multipliers
    this.MULTIPLIERS = {
      PEAK_HOUR: 0.5,           // +50% during peak hours
      HIGH_OCCUPANCY: 0.2,      // +20% when occupancy > 80%
      SURGE_DEMAND: 0.3,        // +30% when booking requests spike
      WEEKEND: 0.15,            // +15% on weekends
      HOLIDAY: 0.25,            // +25% on holidays
      WEATHER_IMPACT: 0.1       // +10% during bad weather
    };
    
    // Occupancy thresholds
    this.HIGH_OCCUPANCY_THRESHOLD = 0.8; // 80%
    this.SURGE_BOOKING_THRESHOLD = 5;    // 5 bookings in last hour

    // Pricing stability cache to prevent rapid pricing changes
    this.pricingCache = new Map();
    this.PRICING_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  }

  /**
   * Calculate dynamic price for a parking space using new tiered system
   * @param {String} parkingSpaceId - Parking space ID
   * @param {Date} bookingTime - Requested booking time
   * @param {Number} duration - Booking duration in hours
   * @param {String} vehicleType - Type of vehicle (optional, defaults to 'car')
   * @returns {Object} Pricing details with tiered structure and service fees
   */
  async calculateDynamicPrice(parkingSpaceId, bookingTime = new Date(), duration = 1, vehicleType = 'car') {
    try {
      // Create cache key for pricing stability
      const cacheKey = `${parkingSpaceId}_${duration}_${vehicleType}_${Math.floor(bookingTime.getTime() / (5 * 60 * 1000))}`;

      // Check if we have a recent cached price (within 5 minutes)
      const cached = this.pricingCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.PRICING_CACHE_TTL) {
        logger.info(`🎯 Using cached pricing for space ${parkingSpaceId} (${(Date.now() - cached.timestamp) / 1000}s old)`);
        return cached.pricing;
      }

      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      if (!parkingSpace) {
        throw new Error('Parking space not found');
      }

      // Validate minimum duration requirement (3-hour minimum)
      const durationValidation = manilaGovernmentPricingService.validateBookingDuration(duration);
      if (!durationValidation.isValid) {
        throw new Error(durationValidation.message);
      }

      // Get landlord's pricing structure
      const landlordBasePricePer3Hours = parkingSpace.pricePer3Hours;
      const landlordOvertimeRate = parkingSpace.overtimeRatePerHour || (parkingSpace.pricePer3Hours / 3); // Auto-calculate if not set
      const landlordDailyRate = parkingSpace.dailyRate;

      // **DAILY RATE ALGORITHM** - Check if booking qualifies for daily rate
      let usesDailyRate = false;
      let basePrice;

      if (duration >= 24) {
        // 24+ hours: Use daily rate calculation
        const days = Math.floor(duration / 24);
        const remainingHours = duration % 24;

        // Calculate daily vs hourly pricing and use the cheaper option
        const dailyPricing = (days * landlordDailyRate) + (remainingHours > 0 ? remainingHours * landlordOvertimeRate : 0);
        const hourlyPricing = landlordBasePricePer3Hours + ((duration - 3) * landlordOvertimeRate);

        if (dailyPricing < hourlyPricing) {
          basePrice = dailyPricing;
          usesDailyRate = true;
        } else {
          basePrice = hourlyPricing;
        }
      } else {
        // Less than 24 hours: Use 3-hour rate system
        if (duration <= 3) {
          basePrice = landlordBasePricePer3Hours; // Minimum 3-hour charge
        } else {
          // Base 3 hours + overtime (charged per hour using auto-calculated rate)
          const overtimeHours = duration - 3;
          basePrice = landlordBasePricePer3Hours + (overtimeHours * landlordOvertimeRate);
        }
      }
      
      // Calculate demand factors for dynamic adjustments
      let demandFactor = 0;
      const factors = [];

      // 1. Peak Hours Factor
      const peakFactor = await this.calculatePeakHoursFactor(bookingTime);
      if (peakFactor > 0) {
        demandFactor += peakFactor;
        factors.push({
          type: 'peak_hours',
          multiplier: peakFactor,
          description: 'Peak hours surcharge'
        });
      }

      // 2. Occupancy Factor
      const occupancyFactor = await this.calculateOccupancyFactor(parkingSpaceId, bookingTime);
      if (occupancyFactor > 0) {
        demandFactor += occupancyFactor;
        factors.push({
          type: 'high_occupancy',
          multiplier: occupancyFactor,
          description: 'High demand area'
        });
      }

      // 3. Surge Demand Factor
      const surgeFactor = await this.calculateSurgeFactor(parkingSpaceId, bookingTime);
      if (surgeFactor > 0) {
        demandFactor += surgeFactor;
        factors.push({
          type: 'surge_demand',
          multiplier: surgeFactor,
          description: 'High booking activity'
        });
      }

      // 4. Weekend/Holiday Factor
      const specialDayFactor = this.calculateSpecialDayFactor(bookingTime);
      if (specialDayFactor > 0) {
        demandFactor += specialDayFactor;
        factors.push({
          type: 'special_day',
          multiplier: specialDayFactor,
          description: 'Weekend/Holiday pricing'
        });
      }

      // **FIXED PRICING LOGIC**
      // The landlord's pricePer3Hours should be the MINIMUM total customer pays
      // Dynamic pricing and service fees are added on top, then split

      // Calculate dynamic pricing surge amount
      const dynamicSurgeAmount = Math.round(basePrice * demandFactor);

      // **NEW LOGIC**: Landlord price is the minimum guaranteed
      // Dynamic pricing is split 50/50 between landlord and platform
      // Service fees are calculated as a percentage and go to platform

      // Fixed 10% service fee (production-ready, predictable pricing)
      const serviceFeeRate = 0.10; // Fixed 10% service fee (production-ready)

      let totalCustomerPays, landlordShare, platformShare, serviceFee;

      if (dynamicSurgeAmount > 0) {
        // With dynamic pricing: split the surge
        const landlordBaseGuarantee = basePrice; // Landlord's minimum
        const landlordDynamicBonus = Math.round(dynamicSurgeAmount * 0.5);
        const platformDynamicCut = Math.round(dynamicSurgeAmount * 0.5);

        // Calculate service fee as percentage of base price (not including surge)
        serviceFee = Math.round(basePrice * serviceFeeRate);

        landlordShare = {
          basePrice: landlordBaseGuarantee,
          dynamicPricingBonus: landlordDynamicBonus,
          total: landlordBaseGuarantee + landlordDynamicBonus
        };

        platformShare = {
          dynamicPricingCut: platformDynamicCut,
          serviceFee: serviceFee,
          total: platformDynamicCut + serviceFee
        };

        totalCustomerPays = basePrice + dynamicSurgeAmount + serviceFee;

      } else {
        // No dynamic pricing: Customer pays landlord's base price + service fee
        // Landlord gets their FULL base price, platform gets service fee
        serviceFee = Math.round(basePrice * serviceFeeRate);

        totalCustomerPays = basePrice + serviceFee; // ₱50 + ₱5 = ₱55

        landlordShare = {
          basePrice: basePrice, // Landlord gets ₱50 (100% of their base price)
          dynamicPricingBonus: 0,
          total: basePrice
        };

        platformShare = {
          dynamicPricingCut: 0,
          serviceFee: serviceFee, // Platform gets ₱5 (service fee)
          total: serviceFee
        };
      }

      const pricingDetails = {
        // Customer pricing
        totalPrice: totalCustomerPays,
        basePrice: basePrice,
        dynamicSurge: dynamicSurgeAmount,
        serviceFee: serviceFee,

        // Revenue split breakdown
        landlordEarnings: landlordShare,
        platformEarnings: platformShare,

        // Revenue split verification
        revenueBreakdown: {
          customerPays: totalCustomerPays,
          landlordGets: landlordShare.total,
          platformGets: platformShare.total,
          splitPercentage: {
            dynamicPricing: {
              landlord: 50,
              platform: 50
            }
          }
        },

        // Dynamic factors
        demandFactor: Math.round(demandFactor * 100) / 100,
        factors,

        // Duration and pricing info
        duration,
        basePricePer3Hours: landlordBasePricePer3Hours,
        dailyRate: landlordDailyRate,
        usesDailyRate: usesDailyRate,
        overtimeHours: duration > 3 && !usesDailyRate ? duration - 3 : 0,

        // Metadata
        parkingSpaceId: parkingSpaceId,
        vehicleType: vehicleType,
        timestamp: new Date()
      };

      logger.info(`🎯 Revenue split pricing calculated for space ${parkingSpaceId}:
        Vehicle: ${vehicleType}
        Duration: ${duration}h ${usesDailyRate ? '(Daily Rate Applied)' : ''}
        Landlord set price: ₱${landlordBasePricePer3Hours} per 3h ${usesDailyRate ? `| Daily: ₱${landlordDailyRate}` : ''}
        Calculated base: ₱${basePrice}
        Dynamic surge: ₱${dynamicSurgeAmount} (${(demandFactor * 100).toFixed(1)}% demand)
        Service fee rate: ${(serviceFeeRate * 100).toFixed(1)}% (fixed 10%)

        💰 Revenue Split (CORRECTED - Service Fee Added):
        Customer pays: ₱${totalCustomerPays} (₱${basePrice} base + ₱${serviceFee} service fee${dynamicSurgeAmount > 0 ? ` + ₱${dynamicSurgeAmount} surge` : ''})
        Landlord gets: ₱${landlordShare.total} (net: ₱${landlordShare.basePrice} + bonus: ₱${landlordShare.dynamicPricingBonus})
        Platform gets: ₱${platformShare.total} (commission/fee: ₱${platformShare.serviceFee} + dynamic cut: ₱${platformShare.dynamicPricingCut})`);

      // Cache the pricing result for stability
      this.pricingCache.set(cacheKey, {
        pricing: pricingDetails,
        timestamp: Date.now()
      });

      // Clean up old cache entries
      this.cleanupPricingCache();

      return pricingDetails;

    } catch (error) {
      logger.error('Dynamic pricing calculation error:', error);
      
      // Fallback to basic pricing without dynamic factors
      try {
        // Try to get parking space for basic pricing
        const fallbackSpace = await ParkingSpace.findById(parkingSpaceId);
        let fallbackBasePrice = 60; // Default 3-hour price

        if (fallbackSpace && fallbackSpace.pricePer3Hours) {
          if (duration <= 3) {
            fallbackBasePrice = fallbackSpace.pricePer3Hours;
          } else {
            const overtimeHours = duration - 3;
            const overtimeRate = fallbackSpace.pricePer3Hours / 3;
            fallbackBasePrice = fallbackSpace.pricePer3Hours + (overtimeHours * overtimeRate);
          }
        }

        const fallbackServiceFee = Math.round(fallbackBasePrice * 0.1); // 10% service fee

        return {
          totalPrice: fallbackBasePrice + fallbackServiceFee,
          basePrice: fallbackBasePrice,
          dynamicSurge: 0,
          serviceFee: fallbackServiceFee,
          landlordEarnings: {
            basePrice: fallbackBasePrice,
            dynamicPricingBonus: 0,
            total: fallbackBasePrice
          },
          platformEarnings: {
            dynamicPricingCut: 0,
            serviceFee: fallbackServiceFee,
            total: fallbackServiceFee
          },
          demandFactor: 0,
          factors: [],
          duration,
          error: 'Using fallback pricing due to calculation error',
          timestamp: new Date()
        };
      } catch (fallbackError) {
        logger.error('Fallback pricing also failed:', fallbackError);

        // Final emergency fallback
        const emergencyBasePrice = 60; // ₱60 for 3 hours default
        const emergencyServiceFee = 6;

        return {
          totalPrice: emergencyBasePrice + emergencyServiceFee,
          basePrice: emergencyBasePrice,
          dynamicSurge: 0,
          serviceFee: emergencyServiceFee,
          landlordEarnings: {
            basePrice: emergencyBasePrice,
            dynamicPricingBonus: 0,
            total: emergencyBasePrice
          },
          platformEarnings: {
            dynamicPricingCut: 0,
            serviceFee: emergencyServiceFee,
            total: emergencyServiceFee
          },
          demandFactor: 0,
          factors: [],
          duration,
          error: 'Using emergency fallback pricing',
          timestamp: new Date()
        };
      }
    }
  }

  /**
   * Calculate peak hours factor
   */
  async calculatePeakHoursFactor(bookingTime) {
    const hour = bookingTime.getHours();
    
    for (const peakPeriod of this.PEAK_HOURS) {
      if (hour >= peakPeriod.start && hour < peakPeriod.end) {
        return this.MULTIPLIERS.PEAK_HOUR;
      }
    }
    
    return 0;
  }

  /**
   * Calculate occupancy factor based on nearby bookings
   */
  async calculateOccupancyFactor(parkingSpaceId, bookingTime) {
    try {
      // Get parking space to find nearby spaces
      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      if (!parkingSpace?.location?.coordinates) return 0;

      const [longitude, latitude] = parkingSpace.location.coordinates;
      
      // Find all parking spaces within 1km radius
      const nearbySpaces = await ParkingSpace.find({
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [longitude, latitude] },
            $maxDistance: 1000 // 1km radius
          }
        },
        status: 'active'
      });

      if (nearbySpaces.length === 0) return 0;

      // Count active bookings in the area during the requested time
      const bookingStart = new Date(bookingTime);
      const bookingEnd = new Date(bookingTime.getTime() + (2 * 60 * 60 * 1000)); // +2 hours

      const activeBookings = await Booking.countDocuments({
        parkingSpaceId: { $in: nearbySpaces.map(s => s._id) },
        status: { $in: ['accepted', 'parked'] },
        $or: [
          {
            startTime: { $lte: bookingEnd },
            endTime: { $gte: bookingStart }
          }
        ]
      });

      const occupancyRate = activeBookings / nearbySpaces.length;
      
      if (occupancyRate >= this.HIGH_OCCUPANCY_THRESHOLD) {
        return this.MULTIPLIERS.HIGH_OCCUPANCY;
      }

      return 0;
    } catch (error) {
      logger.error('Occupancy factor calculation error:', error);
      return 0;
    }
  }

  /**
   * Calculate surge factor based on recent booking activity
   */
  async calculateSurgeFactor(parkingSpaceId, bookingTime) {
    try {
      const oneHourAgo = new Date(bookingTime.getTime() - (60 * 60 * 1000));
      
      // Get parking space location
      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      if (!parkingSpace?.location?.coordinates) return 0;

      const [longitude, latitude] = parkingSpace.location.coordinates;
      
      // Find nearby spaces
      const nearbySpaces = await ParkingSpace.find({
        location: {
          $near: {
            $geometry: { type: "Point", coordinates: [longitude, latitude] },
            $maxDistance: 500 // 500m radius for surge calculation
          }
        }
      });

      // Count recent bookings in the area
      const recentBookings = await Booking.countDocuments({
        parkingSpaceId: { $in: nearbySpaces.map(s => s._id) },
        createdAt: { $gte: oneHourAgo },
        status: { $ne: 'cancelled' }
      });

      if (recentBookings >= this.SURGE_BOOKING_THRESHOLD) {
        return this.MULTIPLIERS.SURGE_DEMAND;
      }

      return 0;
    } catch (error) {
      logger.error('Surge factor calculation error:', error);
      return 0;
    }
  }

  /**
   * Calculate weekend/holiday factor
   */
  calculateSpecialDayFactor(bookingTime) {
    const dayOfWeek = bookingTime.getDay(); // 0 = Sunday, 6 = Saturday
    
    // Weekend pricing (Friday evening, Saturday, Sunday)
    if (dayOfWeek === 0 || dayOfWeek === 6) { // Sunday or Saturday
      return this.MULTIPLIERS.WEEKEND;
    }
    
    if (dayOfWeek === 5 && bookingTime.getHours() >= 17) { // Friday evening
      return this.MULTIPLIERS.WEEKEND;
    }

    // TODO: Add holiday detection logic here
    // You can integrate with a holiday API or maintain a holiday calendar
    
    return 0;
  }

  /**
   * Get pricing for multiple parking spaces (for smart booking)
   */
  async calculateMultipleSpacesPricing(parkingSpaceIds, bookingTime, duration) {
    const promises = parkingSpaceIds.map(spaceId => 
      this.calculateDynamicPrice(spaceId, bookingTime, duration)
    );

    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => ({
      parkingSpaceId: parkingSpaceIds[index],
      pricing: result.status === 'fulfilled' ? result.value : null,
      error: result.status === 'rejected' ? result.reason.message : null
    }));
  }

  /**
   * Get price prediction for next few hours (helpful for users to plan)
   */
  async getPricePrediction(parkingSpaceId, hoursAhead = 6) {
    const predictions = [];
    const now = new Date();

    for (let i = 0; i < hoursAhead; i++) {
      const futureTime = new Date(now.getTime() + (i * 60 * 60 * 1000));
      const pricing = await this.calculateDynamicPrice(parkingSpaceId, futureTime, 1);
      
      predictions.push({
        time: futureTime,
        hour: futureTime.getHours(),
        price: pricing.dynamicPrice,
        demandFactor: pricing.demandFactor,
        factors: pricing.factors
      });
    }

    return predictions;
  }

  /**
   * Clean up old cache entries to prevent memory leaks
   */
  cleanupPricingCache() {
    const now = Date.now();
    for (const [key, cached] of this.pricingCache.entries()) {
      if (now - cached.timestamp > this.PRICING_CACHE_TTL) {
        this.pricingCache.delete(key);
      }
    }
  }

  /**
   * Clear pricing cache (for testing or manual reset)
   */
  clearPricingCache() {
    this.pricingCache.clear();
  }
}

module.exports = new DynamicPricingService();

