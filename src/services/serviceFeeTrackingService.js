const mongoose = require('mongoose');
const logger = require('../config/logger');

/**
 * Service Fee Tracking Service
 * Tracks app revenue from service fees across all bookings
 */
class ServiceFeeTrackingService {
  constructor() {
    this.ServiceFeeRecord = this.createServiceFeeModel();
  }

  /**
   * Create ServiceFeeRecord model if it doesn't exist
   */
  createServiceFeeModel() {
    if (mongoose.models.ServiceFeeRecord) {
      return mongoose.models.ServiceFeeRecord;
    }

    const serviceFeeSchema = new mongoose.Schema({
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking',
        required: true,
        unique: true
      },
      parkingSpaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ParkingSpace',
        required: true
      },
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      landlordId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
      },
      
      // Fee breakdown
      baseParkingFee: {
        type: Number,
        required: true,
        min: 0
      },
      serviceFee: {
        type: Number,
        required: true,
        min: 0
      },
      flatFeeComponent: {
        type: Number,
        required: true,
        min: 0
      },
      percentageFeeComponent: {
        type: Number,
        required: true,
        min: 0
      },
      totalBookingAmount: {
        type: Number,
        required: true,
        min: 0
      },

      // Vehicle and booking details
      vehicleType: {
        type: String,
        required: true
      },
      vehicleCategory: {
        type: String,
        enum: ['LIGHT_VEHICLES', 'MEDIUM_VEHICLES', 'HEAVY_VEHICLES'],
        required: true
      },
      bookingDuration: {
        type: Number,
        required: true,
        min: 0
      },
      bookingType: {
        type: String,
        enum: ['smart', 'traditional', 'reservation'],
        required: true
      },

      // Payment status
      paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'refunded', 'partially_refunded'],
        default: 'pending'
      },
      
      // Revenue distribution
      landlordEarnings: {
        type: Number,
        required: true,
        min: 0
      },
      appRevenue: {
        type: Number,
        required: true,
        min: 0
      },

      // Timestamps
      bookingDate: {
        type: Date,
        required: true
      },
      recordedAt: {
        type: Date,
        default: Date.now
      },

      // Metadata
      feeModel: {
        type: String,
        default: 'hybrid', // hybrid, percentage, fixed
      },
      notes: String
    }, {
      timestamps: true,
      toJSON: { virtuals: true },
      toObject: { virtuals: true }
    });

    // Indexes for efficient querying
    serviceFeeSchema.index({ bookingDate: -1 });
    serviceFeeSchema.index({ paymentStatus: 1 });
    serviceFeeSchema.index({ landlordId: 1 });
    serviceFeeSchema.index({ vehicleCategory: 1 });
    serviceFeeSchema.index({ bookingType: 1 });
    serviceFeeSchema.index({ recordedAt: -1 });

    return mongoose.model('ServiceFeeRecord', serviceFeeSchema);
  }

  /**
   * Record service fee for a booking
   * @param {Object} bookingData - Booking details and fee breakdown
   */
  async recordServiceFee(bookingData) {
    try {
      const {
        bookingId,
        parkingSpaceId,
        userId,
        landlordId,
        baseParkingFee,
        serviceFeeBreakdown,
        vehicleType,
        vehicleCategory,
        bookingDuration,
        bookingType = 'traditional',
        bookingDate
      } = bookingData;

      const serviceFeeRecord = new this.ServiceFeeRecord({
        bookingId,
        parkingSpaceId,
        userId,
        landlordId,
        baseParkingFee,
        serviceFee: serviceFeeBreakdown.serviceFee,
        flatFeeComponent: serviceFeeBreakdown.flatFee,
        percentageFeeComponent: serviceFeeBreakdown.percentageFee,
        totalBookingAmount: baseParkingFee + serviceFeeBreakdown.serviceFee,
        vehicleType,
        vehicleCategory,
        bookingDuration,
        bookingType,
        landlordEarnings: baseParkingFee,
        appRevenue: serviceFeeBreakdown.serviceFee,
        bookingDate: bookingDate || new Date(),
        paymentStatus: 'pending'
      });

      await serviceFeeRecord.save();
      
      logger.info(`📊 Service fee recorded for booking ${bookingId}: ₱${serviceFeeBreakdown.serviceFee} app revenue`);
      
      return serviceFeeRecord;
    } catch (error) {
      logger.error('Failed to record service fee:', error);
      throw error;
    }
  }

  /**
   * Update payment status of service fee record
   * @param {string} bookingId - Booking ID
   * @param {string} status - New payment status
   */
  async updatePaymentStatus(bookingId, status) {
    try {
      const record = await this.ServiceFeeRecord.findOneAndUpdate(
        { bookingId },
        { paymentStatus: status },
        { new: true }
      );

      if (record) {
        logger.info(`💰 Service fee payment status updated for booking ${bookingId}: ${status}`);
      }

      return record;
    } catch (error) {
      logger.error('Failed to update service fee payment status:', error);
      throw error;
    }
  }

  /**
   * Get app revenue analytics
   * @param {Object} filters - Date range and other filters
   */
  async getRevenueAnalytics(filters = {}) {
    try {
      const {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // Last 30 days
        endDate = new Date(),
        vehicleCategory,
        bookingType,
        paymentStatus = 'paid'
      } = filters;

      const matchStage = {
        bookingDate: { $gte: startDate, $lte: endDate },
        paymentStatus
      };

      if (vehicleCategory) matchStage.vehicleCategory = vehicleCategory;
      if (bookingType) matchStage.bookingType = bookingType;

      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$appRevenue' },
            totalBookings: { $sum: 1 },
            totalFlatFees: { $sum: '$flatFeeComponent' },
            totalPercentageFees: { $sum: '$percentageFeeComponent' },
            totalParkingFees: { $sum: '$baseParkingFee' },
            totalLandlordEarnings: { $sum: '$landlordEarnings' },
            averageServiceFee: { $avg: '$serviceFee' },
            averageBookingValue: { $avg: '$totalBookingAmount' }
          }
        }
      ];

      const [analytics] = await this.ServiceFeeRecord.aggregate(pipeline);

      // Get breakdown by vehicle category
      const categoryBreakdown = await this.ServiceFeeRecord.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: '$vehicleCategory',
            revenue: { $sum: '$appRevenue' },
            bookings: { $sum: 1 },
            avgServiceFee: { $avg: '$serviceFee' }
          }
        },
        { $sort: { revenue: -1 } }
      ]);

      // Get daily revenue trend
      const dailyTrend = await this.ServiceFeeRecord.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              year: { $year: '$bookingDate' },
              month: { $month: '$bookingDate' },
              day: { $dayOfMonth: '$bookingDate' }
            },
            dailyRevenue: { $sum: '$appRevenue' },
            dailyBookings: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]);

      return {
        period: {
          startDate,
          endDate,
          filters: { vehicleCategory, bookingType, paymentStatus }
        },
        summary: analytics || {
          totalRevenue: 0,
          totalBookings: 0,
          totalFlatFees: 0,
          totalPercentageFees: 0,
          totalParkingFees: 0,
          totalLandlordEarnings: 0,
          averageServiceFee: 0,
          averageBookingValue: 0
        },
        categoryBreakdown,
        dailyTrend,
        profitMargin: analytics ? (analytics.totalRevenue / (analytics.totalRevenue + analytics.totalLandlordEarnings) * 100).toFixed(2) : 0
      };
    } catch (error) {
      logger.error('Failed to get revenue analytics:', error);
      throw error;
    }
  }

  /**
   * Get top earning parking spaces for the app
   * @param {Object} filters - Filters for the query
   * @param {number} limit - Number of results to return
   */
  async getTopEarningSpaces(filters = {}, limit = 10) {
    try {
      const {
        startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate = new Date(),
        paymentStatus = 'paid'
      } = filters;

      const pipeline = [
        {
          $match: {
            bookingDate: { $gte: startDate, $lte: endDate },
            paymentStatus
          }
        },
        {
          $group: {
            _id: '$parkingSpaceId',
            totalRevenue: { $sum: '$appRevenue' },
            totalBookings: { $sum: 1 },
            averageServiceFee: { $avg: '$serviceFee' },
            landlordId: { $first: '$landlordId' }
          }
        },
        {
          $lookup: {
            from: 'parkingspaces',
            localField: '_id',
            foreignField: '_id',
            as: 'parkingSpace'
          }
        },
        {
          $unwind: '$parkingSpace'
        },
        {
          $project: {
            parkingSpaceId: '$_id',
            spaceName: '$parkingSpace.name',
            spaceAddress: '$parkingSpace.address',
            totalRevenue: 1,
            totalBookings: 1,
            averageServiceFee: 1,
            landlordId: 1
          }
        },
        { $sort: { totalRevenue: -1 } },
        { $limit: limit }
      ];

      return await this.ServiceFeeRecord.aggregate(pipeline);
    } catch (error) {
      logger.error('Failed to get top earning spaces:', error);
      throw error;
    }
  }

  /**
   * Get service fee trends and projections
   */
  async getRevenueTrends(days = 30) {
    try {
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      
      const trends = await this.ServiceFeeRecord.aggregate([
        {
          $match: {
            bookingDate: { $gte: startDate },
            paymentStatus: 'paid'
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$bookingDate' },
              month: { $month: '$bookingDate' },
              day: { $dayOfMonth: '$bookingDate' }
            },
            revenue: { $sum: '$appRevenue' },
            bookings: { $sum: 1 },
            flatFees: { $sum: '$flatFeeComponent' },
            percentageFees: { $sum: '$percentageFeeComponent' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]);

      // Calculate growth rate
      const recentRevenue = trends.slice(-7).reduce((sum, day) => sum + day.revenue, 0);
      const previousRevenue = trends.slice(-14, -7).reduce((sum, day) => sum + day.revenue, 0);
      const growthRate = previousRevenue > 0 ? ((recentRevenue - previousRevenue) / previousRevenue * 100).toFixed(2) : 0;

      return {
        trends,
        summary: {
          totalDays: days,
          weeklyGrowthRate: `${growthRate}%`,
          averageDailyRevenue: trends.reduce((sum, day) => sum + day.revenue, 0) / trends.length || 0,
          totalRevenue: trends.reduce((sum, day) => sum + day.revenue, 0)
        }
      };
    } catch (error) {
      logger.error('Failed to get revenue trends:', error);
      throw error;
    }
  }
}

module.exports = new ServiceFeeTrackingService();
