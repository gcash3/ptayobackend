const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User');
const { Wallet } = require('../models/Wallet');
const { catchAsync } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Debug analytics data
 * @route GET /api/v1/debug/analytics/:userId
 */
const debugAnalytics = catchAsync(async (req, res) => {
  const { userId } = req.params;
  
  logger.info(`🔍 [DEBUG] Analytics debug requested for user ${userId}`);

  try {
    // Get user info
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Get parking spaces
    const parkingSpaces = await ParkingSpace.find({ landlordId: userId });
    const spaceIds = parkingSpaces.map(space => space._id);
    
    // Get all bookings for this landlord
    const allBookings = await Booking.find({ parkingSpaceId: { $in: spaceIds } })
      .sort({ createdAt: -1 })
      .limit(20);

    // Get completed bookings specifically
    const completedBookings = await Booking.find({ 
      parkingSpaceId: { $in: spaceIds },
      status: { $in: ['completed', 'parked'] }
    }).sort({ createdAt: -1 });

    // Get booking status breakdown
    const statusBreakdown = await Booking.aggregate([
      { $match: { parkingSpaceId: { $in: spaceIds } } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    // Get earnings calculation
    const earningsCalc = await Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true }
      }},
      { $group: { 
        _id: null,
        totalEarnings: { 
          $sum: { 
            $add: [
              { $ifNull: ['$pricing.totalAmount', 0] },
              { $ifNull: ['$pricing.overtimeAmount', 0] }
            ]
          }
        },
        bookingCount: { $sum: 1 },
        avgAmount: { $avg: '$pricing.totalAmount' }
      }}
    ]);

    // Get wallet info
    const wallet = await Wallet.findByUserId(userId);

    const debugData = {
      user: {
        id: user._id,
        name: `${user.firstName} ${user.lastName}`,
        role: user.role,
        email: user.email
      },
      parkingSpaces: {
        count: parkingSpaces.length,
        spaces: parkingSpaces.map(space => ({
          id: space._id,
          name: space.name,
          status: space.status,
          pricePerHour: space.pricePerHour
        }))
      },
      bookings: {
        total: allBookings.length,
        completed: completedBookings.length,
        statusBreakdown,
        recentBookings: allBookings.slice(0, 5).map(booking => ({
          id: booking._id,
          status: booking.status,
          amount: booking.pricing?.totalAmount,
          overtime: booking.pricing?.overtimeAmount,
          createdAt: booking.createdAt,
          startTime: booking.startTime
        }))
      },
      earnings: earningsCalc[0] || { totalEarnings: 0, bookingCount: 0, avgAmount: 0 },
      wallet: wallet ? {
        id: wallet._id,
        availableBalance: wallet.availableBalance,
        transactionCount: wallet.transactions.length
      } : null
    };

    logger.info(`🔍 [DEBUG] Analytics debug completed for user ${userId}:`, {
      parkingSpaces: debugData.parkingSpaces.count,
      totalBookings: debugData.bookings.total,
      completedBookings: debugData.bookings.completed,
      totalEarnings: debugData.earnings.totalEarnings,
      walletBalance: debugData.wallet?.availableBalance
    });

    res.status(200).json({
      status: 'success',
      data: debugData
    });

  } catch (error) {
    logger.error(`❌ [DEBUG] Error in analytics debug:`, error);
    res.status(500).json({
      status: 'error',
      message: 'Debug failed',
      error: error.message
    });
  }
});

module.exports = {
  debugAnalytics
};