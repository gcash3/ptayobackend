const logger = require('../config/logger');
const manilaGovernmentPricingService = require('./manilaGovernmentPricingService');

/**
 * Commission Service
 * Handles platform fees, booking fees, and revenue sharing
 */
class CommissionService {
  constructor() {
    // Commission structure - Platform Fee is recommended
    this.COMMISSION_STRUCTURE = {
      PLATFORM_FEE: {
        type: 'percentage',
        rate: 0.15, // 15% platform fee
        description: 'Platform maintenance, insurance, customer support, payment processing',
        applies_to: 'total_booking_amount',
        min_fee: 5,  // Minimum ₱5 fee
        max_fee: 200, // Maximum ₱200 fee
        benefits: [
          'App maintenance and updates',
          'Customer support 24/7',
          'Insurance coverage',
          'Payment processing',
          'GPS tracking and geofencing',
          'Dispute resolution'
        ]
      },
      
      BOOKING_FEE: {
        type: 'fixed',
        amount: 15, // ₱15 fixed booking fee
        description: 'Transaction processing and booking management fee',
        applies_to: 'per_booking',
        benefits: [
          'Booking confirmation',
          'SMS notifications',
          'Transaction processing',
          'Basic customer support'
        ]
      }
    };

    // Recommended commission type
    this.RECOMMENDED_TYPE = 'PLATFORM_FEE';

    // Revenue sharing breakdown
    this.REVENUE_SHARING = {
      PLATFORM_PERCENTAGE: 15,  // 15% to platform
      LANDLORD_PERCENTAGE: 85,  // 85% to landlord
      PAYMENT_PROCESSING: 3.5,  // 3.5% payment processing (within platform fee)
      OPERATIONAL_COSTS: 8,     // 8% operational costs
      PROFIT_MARGIN: 3.5        // 3.5% platform profit
    };

    // Tier-based commission (based on landlord volume)
    this.TIER_SYSTEM = {
      BRONZE: { min_monthly_bookings: 0, max_monthly_bookings: 10, commission_rate: 0.15 }, // 15%
      SILVER: { min_monthly_bookings: 11, max_monthly_bookings: 50, commission_rate: 0.12 }, // 12%
      GOLD: { min_monthly_bookings: 51, max_monthly_bookings: 100, commission_rate: 0.10 },  // 10%
      PLATINUM: { min_monthly_bookings: 101, max_monthly_bookings: Infinity, commission_rate: 0.08 } // 8%
    };
  }

  /**
   * Calculate commission for a booking
   * @param {Object} bookingDetails - Booking details
   * @returns {Object} Commission breakdown
   */
  calculateCommission(bookingDetails) {
    const {
      bookingAmount,
      duration,
      landlordId,
      commissionType = this.RECOMMENDED_TYPE,
      bookingType = 'traditional' // traditional or smart
    } = bookingDetails;

    const commissionConfig = this.COMMISSION_STRUCTURE[commissionType];
    
    if (!commissionConfig) {
      throw new Error('Invalid commission type');
    }

    let commission = 0;
    let commissionDetails = {};

    // Calculate base commission
    if (commissionConfig.type === 'percentage') {
      commission = Math.round(bookingAmount * commissionConfig.rate);
      
      // Apply min/max limits
      if (commissionConfig.min_fee && commission < commissionConfig.min_fee) {
        commission = commissionConfig.min_fee;
      }
      if (commissionConfig.max_fee && commission > commissionConfig.max_fee) {
        commission = commissionConfig.max_fee;
      }
      
      commissionDetails = {
        type: 'percentage',
        rate: `${(commissionConfig.rate * 100)}%`,
        calculated_amount: Math.round(bookingAmount * commissionConfig.rate),
        final_amount: commission,
        min_fee_applied: commission === commissionConfig.min_fee,
        max_fee_applied: commission === commissionConfig.max_fee
      };
    } else if (commissionConfig.type === 'fixed') {
      commission = commissionConfig.amount;
      commissionDetails = {
        type: 'fixed',
        amount: commission
      };
    }

    // Apply smart booking bonus (optional incentive)
    let smartBookingBonus = 0;
    if (bookingType === 'smart') {
      smartBookingBonus = Math.round(commission * 0.1); // 10% bonus for smart bookings
      commission += smartBookingBonus;
    }

    const landlordEarnings = bookingAmount - commission;
    const customerTotal = bookingAmount + (commissionType === 'BOOKING_FEE' ? commission : 0);

    const breakdown = {
      booking_amount: bookingAmount,
      commission_type: commissionType,
      commission_amount: commission,
      smart_booking_bonus: smartBookingBonus,
      
      customer_breakdown: {
        parking_fee: bookingAmount,
        platform_fee: commissionType === 'PLATFORM_FEE' ? commission : 0,
        booking_fee: commissionType === 'BOOKING_FEE' ? commission : 0,
        total_amount: customerTotal
      },
      
      landlord_breakdown: {
        gross_earnings: bookingAmount,
        platform_commission: commission,
        net_earnings: landlordEarnings,
        earnings_percentage: Math.round((landlordEarnings / bookingAmount) * 100)
      },
      
      platform_breakdown: {
        total_commission: commission,
        payment_processing: Math.round(commission * 0.23), // 23% of commission
        operational_costs: Math.round(commission * 0.53),  // 53% of commission
        platform_profit: Math.round(commission * 0.24),    // 24% of commission
      },
      
      commission_details: commissionDetails,
      benefits: commissionConfig.benefits,
      description: commissionConfig.description
    };

    return breakdown;
  }

  /**
   * Calculate tier-based commission (for high-volume landlords)
   * @param {String} landlordId - Landlord ID
   * @param {Number} monthlyBookings - Number of bookings this month
   * @param {Number} bookingAmount - Current booking amount
   * @returns {Object} Tier-based commission
   */
  async calculateTierBasedCommission(landlordId, monthlyBookings, bookingAmount) {
    const tier = this.getLandlordTier(monthlyBookings);
    const tierConfig = this.TIER_SYSTEM[tier];
    
    const commission = Math.round(bookingAmount * tierConfig.commission_rate);
    const landlordEarnings = bookingAmount - commission;

    return {
      landlord_id: landlordId,
      tier: tier,
      monthly_bookings: monthlyBookings,
      commission_rate: `${(tierConfig.commission_rate * 100)}%`,
      
      booking_breakdown: {
        booking_amount: bookingAmount,
        commission: commission,
        landlord_earnings: landlordEarnings
      },
      
      tier_benefits: this.getTierBenefits(tier),
      next_tier: this.getNextTier(tier),
      next_tier_requirements: this.getNextTierRequirements(tier, monthlyBookings)
    };
  }

  /**
   * Get commission transparency for customers
   * @param {Object} bookingDetails - Booking details
   * @returns {Object} Transparent breakdown for customers
   */
  getCustomerCommissionTransparency(bookingDetails) {
    const commission = this.calculateCommission(bookingDetails);
    
    return {
      total_you_pay: commission.customer_breakdown.total_amount,
      parking_fee: commission.customer_breakdown.parking_fee,
      platform_fee: commission.customer_breakdown.platform_fee,
      booking_fee: commission.customer_breakdown.booking_fee,
      
      what_platform_fee_covers: [
        '🛡️ Insurance coverage for your vehicle',
        '📱 App maintenance and updates',
        '🆘 24/7 customer support',
        '💳 Secure payment processing', 
        '📍 GPS tracking and geofencing',
        '⚖️ Dispute resolution service'
      ],
      
      value_proposition: {
        convenience: 'Book instantly without calling landlords',
        safety: 'Verified parking spaces with insurance',
        support: 'Get help anytime if issues arise',
        technology: 'Smart features like auto-checkout'
      },
      
      fee_comparison: {
        our_fee: commission.commission_amount,
        typical_parking_meter: 60, // ₱60 typical meter rate
        mall_parking: 50,          // ₱50 typical mall rate
        our_value: 'More convenient + insurance included'
      }
    };
  }

  /**
   * Get commission transparency for landlords
   * @param {Object} bookingDetails - Booking details
   * @returns {Object} Transparent breakdown for landlords
   */
  getLandlordCommissionTransparency(bookingDetails) {
    const commission = this.calculateCommission(bookingDetails);
    
    return {
      you_earn: commission.landlord_breakdown.net_earnings,
      gross_booking: commission.landlord_breakdown.gross_earnings,
      platform_commission: commission.landlord_breakdown.platform_commission,
      your_percentage: `${commission.landlord_breakdown.earnings_percentage}%`,
      
      what_commission_covers: [
        '🎯 Customer acquisition and marketing',
        '💳 Payment processing and security',
        '📱 Mobile app development and maintenance',
        '🆘 Customer support and dispute resolution',
        '📊 Analytics and reporting tools',
        '🔒 Insurance and liability coverage'
      ],
      
      platform_advantages: {
        no_advertising_costs: 'We bring customers to you',
        automated_payments: 'Get paid instantly without chasing',
        zero_maintenance: 'No app or website to maintain',
        customer_support: 'We handle all customer issues'
      },
      
      revenue_comparison: {
        without_platform: 0, // ₱0 if no bookings
        with_platform: commission.landlord_breakdown.net_earnings,
        additional_bookings_per_month: '5-15 more bookings expected'
      }
    };
  }

  /**
   * Calculate monthly revenue projections
   * @param {Object} projectionData - Projection parameters
   * @returns {Object} Revenue projections
   */
  calculateMonthlyProjections(projectionData) {
    const {
      avgBookingAmount = 100,
      avgBookingsPerDay = 3,
      daysActive = 30,
      commissionType = this.RECOMMENDED_TYPE
    } = projectionData;

    const totalBookings = avgBookingsPerDay * daysActive;
    const grossRevenue = totalBookings * avgBookingAmount;
    
    const sampleBooking = this.calculateCommission({
      bookingAmount: avgBookingAmount,
      commissionType
    });
    
    const totalCommission = totalBookings * sampleBooking.commission_amount;
    const landlordEarnings = grossRevenue - totalCommission;

    return {
      monthly_projections: {
        total_bookings: totalBookings,
        gross_revenue: grossRevenue,
        platform_commission: totalCommission,
        landlord_earnings: landlordEarnings
      },
      
      daily_averages: {
        bookings: avgBookingsPerDay,
        revenue: avgBookingAmount * avgBookingsPerDay,
        commission: avgBookingsPerDay * sampleBooking.commission_amount,
        landlord_earnings: avgBookingsPerDay * sampleBooking.landlord_breakdown.net_earnings
      },
      
      growth_scenarios: {
        conservative: this.calculateGrowthScenario(grossRevenue, 1.2), // 20% growth
        moderate: this.calculateGrowthScenario(grossRevenue, 1.5),     // 50% growth
        optimistic: this.calculateGrowthScenario(grossRevenue, 2.0)    // 100% growth
      }
    };
  }

  /**
   * Helper methods
   */
  getLandlordTier(monthlyBookings) {
    for (const [tier, config] of Object.entries(this.TIER_SYSTEM)) {
      if (monthlyBookings >= config.min_monthly_bookings && monthlyBookings <= config.max_monthly_bookings) {
        return tier;
      }
    }
    return 'BRONZE';
  }

  getTierBenefits(tier) {
    const benefits = {
      BRONZE: ['Standard commission rate', 'Basic analytics'],
      SILVER: ['Reduced commission rate', 'Enhanced analytics', 'Priority support'],
      GOLD: ['Lower commission rate', 'Advanced analytics', 'Marketing boost'],
      PLATINUM: ['Lowest commission rate', 'Premium analytics', 'Dedicated account manager']
    };
    return benefits[tier] || benefits.BRONZE;
  }

  getNextTier(tier) {
    const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM'];
    const currentIndex = tiers.indexOf(tier);
    return currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
  }

  getNextTierRequirements(tier, currentBookings) {
    const nextTier = this.getNextTier(tier);
    if (!nextTier) return null;
    
    const nextTierConfig = this.TIER_SYSTEM[nextTier];
    const bookingsNeeded = nextTierConfig.min_monthly_bookings - currentBookings;
    
    return {
      next_tier: nextTier,
      bookings_needed: Math.max(0, bookingsNeeded),
      commission_reduction: `${((this.TIER_SYSTEM[tier].commission_rate - nextTierConfig.commission_rate) * 100).toFixed(1)}%`
    };
  }

  calculateGrowthScenario(baseRevenue, multiplier) {
    const newRevenue = baseRevenue * multiplier;
    const commission = this.calculateCommission({ bookingAmount: newRevenue });
    
    return {
      gross_revenue: newRevenue,
      platform_commission: commission.commission_amount,
      landlord_earnings: commission.landlord_breakdown.net_earnings,
      growth_factor: `${((multiplier - 1) * 100)}%`
    };
  }
}

module.exports = new CommissionService();
