const logger = require('../config/logger');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');

/**
 * New Dynamic Pricing Service
 *
 * Pricing Structure:
 * - Landlord sets base price (e.g., 60 PHP for first 3 hours)
 * - Platform applies dynamic pricing adjustments
 * - Landlord gets only their base price + base overtime charges (15 PHP/hour)
 * - Platform keeps all dynamic pricing, commission, and service fees
 */
class NewDynamicPricingService {
  constructor() {
    // Default configuration - can be overridden by admin settings
    this.config = {
      // Platform fees (in percentage)
      platformCommission: 0.10, // 10% commission on base price
      serviceFee: 5.00, // Fixed service fee in PHP

      // Peak hours configuration
      peakHours: [
        { start: 7, end: 10 },  // 7:00-10:00 AM
        { start: 16, end: 19 }  // 4:00-7:00 PM
      ],

      // Dynamic pricing multipliers
      peakHourMultiplier: 1.25,     // +25% during peak hours
      offPeakMultiplier: 0.85,      // -15% during off-peak hours

      // Occupancy-based pricing
      highOccupancyThreshold: 0.80, // 80% occupancy
      lowOccupancyThreshold: 0.40,  // 40% occupancy
      highOccupancyMultiplier: 1.20, // +20% when >80% occupied
      lowOccupancyMultiplier: 0.90,  // -10% when <40% occupied

      // Special day multipliers
      weekendMultiplier: 1.15,      // +15% on weekends
      holidayMultiplier: 1.30,      // +30% on holidays

      // Minimum rates to ensure affordability for students
      minimumHourlyRate: 15.00,     // PHP 15 minimum per hour

      // Base overtime pricing
      baseOvertimeRate: 15.00       // PHP 15 per hour base overtime
    };
  }

  /**
   * Update pricing configuration (called by admin)
   */
  updateConfiguration(newConfig) {
    this.config = { ...this.config, ...newConfig };
    logger.info('📊 Dynamic pricing configuration updated', { config: this.config });
  }

  /**
   * Calculate dynamic pricing for a booking
   */
  async calculatePricing(params) {
    const {
      parkingSpaceId,
      startTime,
      duration,
      vehicleType = 'car',
      isWeekend = false,
      isHoliday = false
    } = params;

    try {
      // Get parking space details
      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      if (!parkingSpace) {
        throw new Error('Parking space not found');
      }

      // Base pricing set by landlord (convert from 3-hour rate to hourly rate)
      const landlordBasePrice = parkingSpace.pricePerHour || (parkingSpace.pricePer3Hours / 3);

      // Validate that we have a valid base price
      if (!landlordBasePrice || isNaN(landlordBasePrice) || landlordBasePrice <= 0) {
        logger.error(`❌ Invalid base price for parking space ${parkingSpaceId}`, {
          pricePerHour: parkingSpace.pricePerHour,
          pricePer3Hours: parkingSpace.pricePer3Hours,
          calculatedPrice: landlordBasePrice
        });
        throw new Error(`Invalid base price for parking space ${parkingSpaceId}: ${landlordBasePrice}`);
      }

      logger.info(`💰 Base price calculated for ${parkingSpace.name}`, {
        pricePerHour: parkingSpace.pricePerHour,
        pricePer3Hours: parkingSpace.pricePer3Hours,
        calculatedHourlyRate: landlordBasePrice
      });

      // Calculate occupancy rate
      const occupancyRate = await this.calculateOccupancyRate(parkingSpaceId, startTime);

      // Calculate all pricing factors
      const pricingFactors = this.calculatePricingFactors({
        startTime,
        duration,
        occupancyRate,
        isWeekend,
        isHoliday
      });

      // Calculate customer price (with dynamic adjustments)
      const customerPrice = this.calculateCustomerPrice(landlordBasePrice, pricingFactors, duration);

      // Calculate landlord earnings (base price only)
      const landlordEarnings = this.calculateLandlordEarnings(landlordBasePrice, duration);

      // Calculate platform earnings
      const platformEarnings = this.calculatePlatformEarnings(landlordBasePrice, customerPrice, duration);

      const pricingBreakdown = {
        // Customer pays this amount
        customer: {
          totalAmount: customerPrice.total,
          breakdown: {
            baseAmount: customerPrice.base,
            dynamicAdjustments: customerPrice.dynamicAdjustments,
            serviceFee: this.config.serviceFee,
            breakdown: customerPrice.factorBreakdown
          }
        },

        // Landlord receives this amount
        landlord: {
          totalEarnings: landlordEarnings.total,
          breakdown: {
            baseEarnings: landlordEarnings.base,
            overtimeEarnings: landlordEarnings.overtime
          }
        },

        // Platform keeps this amount
        platform: {
          totalEarnings: platformEarnings.total,
          breakdown: {
            commission: platformEarnings.commission,
            serviceFee: platformEarnings.serviceFee,
            dynamicPricingProfit: platformEarnings.dynamicPricingProfit
          }
        },

        // Calculation metadata
        metadata: {
          landlordBasePrice,
          occupancyRate,
          appliedFactors: pricingFactors,
          calculatedAt: new Date(),
          vehicleType,
          duration
        }
      };

      logger.info('💰 Dynamic pricing calculated', {
        parkingSpaceId,
        customerTotal: customerPrice.total,
        landlordEarnings: landlordEarnings.total,
        platformEarnings: platformEarnings.total,
        occupancyRate: Math.round(occupancyRate * 100) + '%'
      });

      return pricingBreakdown;

    } catch (error) {
      logger.error('❌ Dynamic pricing calculation failed', { error: error.message, params });
      throw error;
    }
  }

  /**
   * Calculate current occupancy rate for a parking space
   */
  async calculateOccupancyRate(parkingSpaceId, timeSlot) {
    try {
      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      if (!parkingSpace) return 0;

      // Count active bookings during the requested time slot
      const activeBookings = await Booking.countDocuments({
        parkingSpaceId,
        status: { $in: ['confirmed', 'checked_in'] },
        startTime: { $lte: timeSlot },
        endTime: { $gte: timeSlot }
      });

      const occupancyRate = activeBookings / parkingSpace.totalSpots;
      return Math.min(occupancyRate, 1.0); // Cap at 100%

    } catch (error) {
      logger.error('❌ Occupancy calculation failed', { error: error.message, parkingSpaceId });
      return 0.5; // Default to 50% if calculation fails
    }
  }

  /**
   * Calculate all pricing factors
   */
  calculatePricingFactors({ startTime, duration, occupancyRate, isWeekend, isHoliday }) {
    const factors = [];
    let totalMultiplier = 1.0;

    const hour = new Date(startTime).getHours();

    // Peak hours factor
    const isPeakHour = this.config.peakHours.some(peak =>
      hour >= peak.start && hour < peak.end
    );

    if (isPeakHour) {
      factors.push({
        type: 'peak_hour',
        multiplier: this.config.peakHourMultiplier,
        description: 'Peak hour pricing'
      });
      totalMultiplier *= this.config.peakHourMultiplier;
    } else {
      factors.push({
        type: 'off_peak',
        multiplier: this.config.offPeakMultiplier,
        description: 'Off-peak discount'
      });
      totalMultiplier *= this.config.offPeakMultiplier;
    }

    // Occupancy-based factor
    if (occupancyRate > this.config.highOccupancyThreshold) {
      factors.push({
        type: 'high_occupancy',
        multiplier: this.config.highOccupancyMultiplier,
        description: `High demand (${Math.round(occupancyRate * 100)}% occupied)`
      });
      totalMultiplier *= this.config.highOccupancyMultiplier;
    } else if (occupancyRate < this.config.lowOccupancyThreshold) {
      factors.push({
        type: 'low_occupancy',
        multiplier: this.config.lowOccupancyMultiplier,
        description: `Low demand discount (${Math.round(occupancyRate * 100)}% occupied)`
      });
      totalMultiplier *= this.config.lowOccupancyMultiplier;
    }

    // Weekend factor
    if (isWeekend) {
      factors.push({
        type: 'weekend',
        multiplier: this.config.weekendMultiplier,
        description: 'Weekend pricing'
      });
      totalMultiplier *= this.config.weekendMultiplier;
    }

    // Holiday factor
    if (isHoliday) {
      factors.push({
        type: 'holiday',
        multiplier: this.config.holidayMultiplier,
        description: 'Holiday pricing'
      });
      totalMultiplier *= this.config.holidayMultiplier;
    }

    return {
      factors,
      totalMultiplier,
      isPeakHour,
      occupancyRate
    };
  }

  /**
   * Calculate customer pricing (with dynamic adjustments)
   */
  calculateCustomerPrice(landlordBasePrice, pricingFactors, duration) {
    // Apply dynamic pricing to base price
    const dynamicPrice = landlordBasePrice * pricingFactors.totalMultiplier;

    // Ensure minimum rate for student affordability
    const adjustedPrice = Math.max(dynamicPrice, this.config.minimumHourlyRate);

    const baseAmount = adjustedPrice * duration;
    const serviceFee = this.config.serviceFee;
    const total = baseAmount + serviceFee;

    return {
      base: landlordBasePrice * duration,
      dynamicAdjustments: (adjustedPrice - landlordBasePrice) * duration,
      total,
      factorBreakdown: pricingFactors.factors.map(factor => ({
        ...factor,
        impact: ((factor.multiplier - 1) * landlordBasePrice * duration).toFixed(2)
      }))
    };
  }

  /**
   * Calculate landlord earnings (base price + base overtime only)
   */
  calculateLandlordEarnings(landlordBasePrice, duration) {
    // For first 3 hours or base duration, landlord gets their set price
    const baseHours = Math.min(duration, 3);
    const overtimeHours = Math.max(duration - 3, 0);

    const baseEarnings = landlordBasePrice * baseHours;
    const overtimeEarnings = this.config.baseOvertimeRate * overtimeHours;

    return {
      base: baseEarnings,
      overtime: overtimeEarnings,
      total: baseEarnings + overtimeEarnings
    };
  }

  /**
   * Calculate platform earnings (commission + service fee + dynamic pricing profit)
   */
  calculatePlatformEarnings(landlordBasePrice, customerPrice, duration) {
    const landlordEarnings = this.calculateLandlordEarnings(landlordBasePrice, duration);

    // Commission on landlord's earnings
    const commission = landlordEarnings.total * this.config.platformCommission;

    // Service fee
    const serviceFee = this.config.serviceFee;

    // Dynamic pricing profit (difference between customer price and landlord earnings)
    const dynamicPricingProfit = customerPrice.total - landlordEarnings.total - commission - serviceFee;

    return {
      commission,
      serviceFee,
      dynamicPricingProfit: Math.max(dynamicPricingProfit, 0),
      total: commission + serviceFee + Math.max(dynamicPricingProfit, 0)
    };
  }

  /**
   * Calculate overtime pricing for extended stays
   */
  calculateOvertimePricing(originalDuration, actualDuration, originalPricing) {
    if (actualDuration <= originalDuration) {
      return { additionalCharges: 0, breakdown: null };
    }

    const overtimeHours = actualDuration - originalDuration;

    // Landlord gets base overtime rate
    const landlordOvertimeEarnings = this.config.baseOvertimeRate * overtimeHours;

    // Platform commission on overtime
    const platformCommission = landlordOvertimeEarnings * this.config.platformCommission;

    // Customer pays landlord earnings + platform commission
    const customerOvertimeCharges = landlordOvertimeEarnings + platformCommission;

    return {
      additionalCharges: customerOvertimeCharges,
      breakdown: {
        overtimeHours,
        landlordEarnings: landlordOvertimeEarnings,
        platformCommission,
        totalCustomerCharge: customerOvertimeCharges
      }
    };
  }

  /**
   * Get pricing preview for frontend
   */
  async getPricingPreview(parkingSpaceId, startTime, duration) {
    const pricing = await this.calculatePricing({
      parkingSpaceId,
      startTime,
      duration,
      isWeekend: this.isWeekend(startTime),
      isHoliday: await this.isHoliday(startTime)
    });

    return {
      totalAmount: pricing.customer.totalAmount,
      basePrice: pricing.customer.breakdown.baseAmount,
      dynamicAdjustments: pricing.customer.breakdown.dynamicAdjustments,
      serviceFee: pricing.customer.breakdown.serviceFee,
      factors: pricing.customer.breakdown.breakdown,
      savings: pricing.customer.breakdown.dynamicAdjustments < 0 ?
        Math.abs(pricing.customer.breakdown.dynamicAdjustments) : 0
    };
  }

  /**
   * Utility methods
   */
  isWeekend(date) {
    const day = new Date(date).getDay();
    return day === 0 || day === 6; // Sunday or Saturday
  }

  async isHoliday(date) {
    // TODO: Implement holiday checking against a holidays database/API
    // For now, return false
    return false;
  }
}

module.exports = new NewDynamicPricingService();