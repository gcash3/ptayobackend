const SuggestedParking = require('../models/SuggestedParking');
const UserPreference = require('../models/UserPreference');
const Booking = require('../models/Booking');
const User = require('../models/User');

class AnalyticsService {
  // Get overall platform analytics
  async getPlatformAnalytics(timeRange = '30d') {
    try {
      const startDate = this.getStartDate(timeRange);

      // Get booking statistics
      const bookingStats = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            totalRevenue: { $sum: '$amount' },
            averageBookingDuration: { $avg: '$duration' },
            averageBookingAmount: { $avg: '$amount' }
          }
        }
      ]);

      // Get user statistics
      const userStats = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: null,
            newUsers: { $sum: 1 },
            totalUsers: { $sum: 1 }
          }
        }
      ]);

      // Get parking space statistics
      const parkingStats = await SuggestedParking.aggregate([
        {
          $group: {
            _id: null,
            totalSpaces: { $sum: 1 },
            averageRating: { $avg: '$rating' },
            averagePrice: { $avg: '$price' },
            totalRevenue: { $sum: '$revenue' }
          }
        }
      ]);

      // Get daily booking trends
      const dailyTrends = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
            },
            bookings: { $sum: 1 },
            revenue: { $sum: '$amount' }
          }
        },
        {
          $sort: { _id: 1 }
        }
      ]);

      // Get peak hours analysis
      const peakHours = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: { $hour: '$startTime' },
            bookings: { $sum: 1 },
            revenue: { $sum: '$amount' }
          }
        },
        {
          $sort: { bookings: -1 }
        },
        {
          $limit: 5
        }
      ]);

      return {
        timeRange,
        bookingStats: bookingStats[0] || {
          totalBookings: 0,
          totalRevenue: 0,
          averageBookingDuration: 0,
          averageBookingAmount: 0
        },
        userStats: userStats[0] || {
          newUsers: 0,
          totalUsers: 0
        },
        parkingStats: parkingStats[0] || {
          totalSpaces: 0,
          averageRating: 0,
          averagePrice: 0,
          totalRevenue: 0
        },
        dailyTrends,
        peakHours
      };

    } catch (error) {
      console.error('Error getting platform analytics:', error);
      throw error;
    }
  }

  // Get popular parking locations analytics
  async getPopularLocationsAnalytics(limit = 10) {
    try {
      // Get most popular parking spaces by bookings
      const popularByBookings = await SuggestedParking.aggregate([
        {
          $lookup: {
            from: 'bookings',
            localField: '_id',
            foreignField: 'parkingSpaceId',
            as: 'bookings'
          }
        },
        {
          $addFields: {
            totalBookings: { $size: '$bookings' },
            totalRevenue: { $sum: '$bookings.amount' },
            averageRating: { $avg: '$bookings.rating' }
          }
        },
        {
          $sort: { totalBookings: -1 }
        },
        {
          $limit: limit
        },
        {
          $project: {
            name: 1,
            address: 1,
            totalBookings: 1,
            totalRevenue: 1,
            averageRating: 1,
            popularityScore: 1,
            currentOccupancy: 1
          }
        }
      ]);

      // Get most profitable parking spaces
      const profitableSpaces = await SuggestedParking.aggregate([
        {
          $lookup: {
            from: 'bookings',
            localField: '_id',
            foreignField: 'parkingSpaceId',
            as: 'bookings'
          }
        },
        {
          $addFields: {
            totalRevenue: { $sum: '$bookings.amount' },
            totalBookings: { $size: '$bookings' },
            averageRevenuePerBooking: {
              $cond: [
                { $gt: [{ $size: '$bookings' }, 0] },
                { $divide: [{ $sum: '$bookings.amount' }, { $size: '$bookings' }] },
                0
              ]
            }
          }
        },
        {
          $sort: { totalRevenue: -1 }
        },
        {
          $limit: limit
        },
        {
          $project: {
            name: 1,
            address: 1,
            totalRevenue: 1,
            totalBookings: 1,
            averageRevenuePerBooking: 1,
            price: 1
          }
        }
      ]);

      // Get highest rated parking spaces
      const topRatedSpaces = await SuggestedParking.find({
        rating: { $gte: 4.0 },
        totalReviews: { $gte: 5 }
      })
      .sort({ rating: -1, totalReviews: -1 })
      .limit(limit)
      .select('name address rating totalReviews');

      return {
        popularByBookings,
        profitableSpaces,
        topRatedSpaces
      };

    } catch (error) {
      console.error('Error getting popular locations analytics:', error);
      throw error;
    }
  }

  // Get user behavior analytics
  async getUserBehaviorAnalytics() {
    try {
      // Get user booking patterns
      const userBookingPatterns = await UserPreference.aggregate([
        {
          $lookup: {
            from: 'users',
            localField: 'userId',
            foreignField: '_id',
            as: 'user'
          }
        },
        {
          $unwind: '$user'
        },
        {
          $group: {
            _id: null,
            averageBookingsPerUser: { $avg: '$totalBookings' },
            averageSpentPerUser: { $avg: '$totalSpent' },
            averageBookingDuration: { $avg: '$averageBookingDuration' },
            averageRating: { $avg: '$averageRating' }
          }
        }
      ]);

      // Get user segments
      const userSegments = await UserPreference.aggregate([
        {
          $addFields: {
            segment: {
              $cond: [
                { $gte: ['$totalBookings', 10] },
                'Frequent User',
                {
                  $cond: [
                    { $gte: ['$totalBookings', 5] },
                    'Regular User',
                    'Occasional User'
                  ]
                }
              ]
            }
          }
        },
        {
          $group: {
            _id: '$segment',
            count: { $sum: 1 },
            averageSpent: { $avg: '$totalSpent' },
            averageBookings: { $avg: '$totalBookings' }
          }
        }
      ]);

      // Get peak usage hours by user type
      const peakUsageByUserType = await UserPreference.aggregate([
        {
          $unwind: '$peakUsageHours'
        },
        {
          $group: {
            _id: {
              hour: '$peakUsageHours.hour',
              userType: {
                $cond: [
                  { $gte: ['$totalBookings', 10] },
                  'Frequent',
                  {
                    $cond: [
                      { $gte: ['$totalBookings', 5] },
                      'Regular',
                      'Occasional'
                    ]
                  }
                ]
              }
            },
            totalFrequency: { $sum: '$peakUsageHours.frequency' }
          }
        },
        {
          $group: {
            _id: '$_id.userType',
            peakHours: {
              $push: {
                hour: '$_id.hour',
                frequency: '$totalFrequency'
              }
            }
          }
        }
      ]);

      return {
        userBookingPatterns: userBookingPatterns[0] || {
          averageBookingsPerUser: 0,
          averageSpentPerUser: 0,
          averageBookingDuration: 0,
          averageRating: 0
        },
        userSegments,
        peakUsageByUserType
      };

    } catch (error) {
      console.error('Error getting user behavior analytics:', error);
      throw error;
    }
  }

  // Get revenue optimization insights
  async getRevenueOptimizationInsights() {
    try {
      // Get pricing analysis
      const pricingAnalysis = await SuggestedParking.aggregate([
        {
          $lookup: {
            from: 'bookings',
            localField: '_id',
            foreignField: 'parkingSpaceId',
            as: 'bookings'
          }
        },
        {
          $addFields: {
            totalBookings: { $size: '$bookings' },
            totalRevenue: { $sum: '$bookings.amount' },
            averageRevenuePerBooking: {
              $cond: [
                { $gt: [{ $size: '$bookings' }, 0] },
                { $divide: [{ $sum: '$bookings.amount' }, { $size: '$bookings' }] },
                0
              ]
            }
          }
        },
        {
          $group: {
            _id: '$type',
            averagePrice: { $avg: '$price' },
            averageRevenue: { $avg: '$totalRevenue' },
            totalBookings: { $sum: '$totalBookings' },
            totalRevenue: { $sum: '$totalRevenue' }
          }
        }
      ]);

      // Get occupancy vs revenue correlation
      const occupancyRevenueCorrelation = await SuggestedParking.aggregate([
        {
          $lookup: {
            from: 'bookings',
            localField: '_id',
            foreignField: 'parkingSpaceId',
            as: 'bookings'
          }
        },
        {
          $addFields: {
            totalBookings: { $size: '$bookings' },
            totalRevenue: { $sum: '$bookings.amount' }
          }
        },
        {
          $match: {
            totalBookings: { $gt: 0 }
          }
        },
        {
          $group: {
            _id: {
              $cond: [
                { $gte: ['$currentOccupancy', 80] },
                'High Occupancy (80%+)',
                {
                  $cond: [
                    { $gte: ['$currentOccupancy', 60] },
                    'Medium Occupancy (60-79%)',
                    'Low Occupancy (<60%)'
                  ]
                }
              ]
            },
            averageRevenue: { $avg: '$totalRevenue' },
            averageOccupancy: { $avg: '$currentOccupancy' },
            count: { $sum: 1 }
          }
        }
      ]);

      // Get seasonal trends
      const seasonalTrends = await Booking.aggregate([
        {
          $group: {
            _id: {
              month: { $month: '$startTime' },
              year: { $year: '$startTime' }
            },
            bookings: { $sum: 1 },
            revenue: { $sum: '$amount' },
            averageAmount: { $avg: '$amount' }
          }
        },
        {
          $sort: { '_id.year': 1, '_id.month': 1 }
        }
      ]);

      return {
        pricingAnalysis,
        occupancyRevenueCorrelation,
        seasonalTrends
      };

    } catch (error) {
      console.error('Error getting revenue optimization insights:', error);
      throw error;
    }
  }

  // Get real-time analytics
  async getRealTimeAnalytics() {
    try {
      const now = new Date();
      const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // Current active bookings
      const activeBookings = await Booking.countDocuments({
        startTime: { $lte: now },
        endTime: { $gte: now }
      });

      // Recent bookings (last hour)
      const recentBookings = await Booking.countDocuments({
        createdAt: { $gte: oneHourAgo }
      });

      // Today's revenue
      const todayRevenue = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: oneDayAgo }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            totalBookings: { $sum: 1 }
          }
        }
      ]);

      // Current parking space availability
      const availabilityStats = await SuggestedParking.aggregate([
        {
          $group: {
            _id: null,
            totalSpaces: { $sum: 1 },
            availableSpaces: {
              $sum: {
                $cond: ['$isAvailable', 1, 0]
              }
            },
            averageOccupancy: { $avg: '$currentOccupancy' }
          }
        }
      ]);

      return {
        timestamp: now,
        activeBookings,
        recentBookings,
        todayRevenue: todayRevenue[0] || { totalRevenue: 0, totalBookings: 0 },
        availabilityStats: availabilityStats[0] || {
          totalSpaces: 0,
          availableSpaces: 0,
          averageOccupancy: 0
        }
      };

    } catch (error) {
      console.error('Error getting real-time analytics:', error);
      throw error;
    }
  }

  // Helper method to get start date based on time range
  getStartDate(timeRange) {
    const now = new Date();
    switch (timeRange) {
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      case '1y':
        return new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }
  }
}

module.exports = new AnalyticsService();
