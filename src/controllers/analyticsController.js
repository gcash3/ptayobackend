const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User');
const { Wallet } = require('../models/Wallet');
const { catchAsync } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Get comprehensive landlord analytics dashboard
 * @route GET /api/v1/analytics/dashboard
 */
const getDashboardAnalytics = catchAsync(async (req, res) => {
  const landlordId = req.user.id;
  const { timeframe = 'weekly', compareWithPrevious = false } = req.query;

  // Log all request details for debugging
  logger.info(`📊 [ANALYTICS] Full request details:`, {
    landlordId,
    timeframe,
    compareWithPrevious,
    originalUrl: req.originalUrl,
    method: req.method,
    query: req.query,
    userAgent: req.get('User-Agent'),
    contentType: req.get('Content-Type'),
    authorization: req.get('Authorization') ? 'Present' : 'Missing'
  });

  logger.info(`📊 [ANALYTICS] Dashboard analytics REQUEST received:`, {
    landlordId,
    timeframe,
    compareWithPrevious,
    headers: {
      'user-agent': req.get('User-Agent'),
      'content-type': req.get('Content-Type')
    },
    timestamp: new Date().toISOString()
  });

  // Get landlord's parking spaces
  const parkingSpaces = await ParkingSpace.find({ landlordId }).select('_id name pricePerHour totalSpots');
  const spaceIds = parkingSpaces.map(space => space._id);

  logger.info(`🏢 [ANALYTICS] Parking spaces found for landlord ${landlordId}:`, {
    totalSpaces: parkingSpaces.length,
    spaceIds: spaceIds.map(id => id.toString()),
    spaceNames: parkingSpaces.map(s => s.name)
  });

  if (spaceIds.length === 0) {
    logger.warn(`⚠️ [ANALYTICS] No parking spaces found for landlord ${landlordId}`);
    return res.status(200).json({
      status: 'success',
      data: {
        message: 'No parking spaces found. Add parking spaces to view analytics.',
        hasData: false
      }
    });
  }

  // Calculate date ranges
  const now = new Date();
  let startDate, endDate = now;
  
  switch (timeframe) {
    case 'daily':
      startDate = new Date(now.getTime() - (24 * 60 * 60 * 1000));
      break;
    case 'weekly':
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      break;
    case 'monthly':
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      break;
    case 'yearly':
      startDate = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000));
      break;
    default:
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
  }

  // Get wallet for total earnings
  const wallet = await Wallet.findByUserId(landlordId);
  const totalLifetimeEarnings = wallet?.availableBalance || 0;

  // Comprehensive booking analysis
  const [
    allTimeBookings,
    periodBookings,
    recentBookings,
    spacePerformance
  ] = await Promise.all([
    // All time stats
    Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true }
      }},
      { $group: {
        _id: null,
        totalRevenue: { $sum: '$pricing.totalAmount' },
        totalBookings: { $sum: 1 },
        avgBookingValue: { $avg: '$pricing.totalAmount' }
      }}
    ]),
    
    // Period stats
    Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true },
        createdAt: { $gte: startDate, $lte: endDate }
      }},
      { $group: {
        _id: null,
        periodRevenue: { $sum: '$pricing.totalAmount' },
        periodBookings: { $sum: 1 },
        avgBookingValue: { $avg: '$pricing.totalAmount' }
      }}
    ]),

    // Recent bookings for trend analysis
    Booking.find({ 
      parkingSpaceId: { $in: spaceIds },
      status: { $in: ['completed', 'parked'] }
    })
    .populate('parkingSpaceId', 'name')
    .select('pricing.totalAmount createdAt status parkingSpaceId')
    .sort({ createdAt: -1 })
    .limit(10),

    // Space performance analysis
    Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true }
      }},
      { $group: {
        _id: '$parkingSpaceId',
        spaceRevenue: { $sum: '$pricing.totalAmount' },
        spaceBookings: { $sum: 1 },
        avgRate: { $avg: '$pricing.totalAmount' }
      }},
      { $sort: { spaceRevenue: -1 } }
    ])
  ]);

  // Generate trend chart data
  const chartData = await generateTrendData(spaceIds, timeframe, startDate, endDate);

  // Calculate performance metrics
  const allTimeStats = allTimeBookings[0] || { totalRevenue: 0, totalBookings: 0, avgBookingValue: 0 };
  const periodStats = periodBookings[0] || { periodRevenue: 0, periodBookings: 0, avgBookingValue: 0 };

  // Space performance with names
  const spacePerformanceWithNames = await Promise.all(
    spacePerformance.map(async (space) => {
      const parkingSpace = await ParkingSpace.findById(space._id).select('name pricePerHour');
      return {
        spaceId: space._id,
        spaceName: parkingSpace?.name || 'Unknown Space',
        revenue: space.spaceRevenue,
        bookings: space.spaceBookings,
        averageRate: Math.round(space.avgRate),
        hourlyRate: parkingSpace?.pricePerHour || 0
      };
    })
  );

  // Calculate growth metrics if comparison requested
  let growthMetrics = null;
  if (compareWithPrevious === 'true') {
    const periodDuration = endDate - startDate;
    const previousStart = new Date(startDate.getTime() - periodDuration);
    const previousEnd = startDate;

    const previousStats = await Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true },
        createdAt: { $gte: previousStart, $lt: previousEnd }
      }},
      { $group: {
        _id: null,
        previousRevenue: { $sum: '$pricing.totalAmount' },
        previousBookings: { $sum: 1 }
      }}
    ]);

    const prevStats = previousStats[0] || { previousRevenue: 0, previousBookings: 0 };
    
    growthMetrics = {
      revenueGrowth: prevStats.previousRevenue > 0 ? 
        (((periodStats.periodRevenue - prevStats.previousRevenue) / prevStats.previousRevenue) * 100).toFixed(1) : 0,
      bookingGrowth: prevStats.previousBookings > 0 ? 
        (((periodStats.periodBookings - prevStats.previousBookings) / prevStats.previousBookings) * 100).toFixed(1) : 0,
      previousPeriod: {
        revenue: prevStats.previousRevenue,
        bookings: prevStats.previousBookings
      }
    };
  }

  // Build comprehensive response
  const analyticsData = {
    timeframe,
    period: {
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      name: getPeriodName(timeframe)
    },
    
    // Core metrics
    summary: {
      totalLifetimeEarnings,
      totalAllTimeRevenue: allTimeStats.totalRevenue,
      totalAllTimeBookings: allTimeStats.totalBookings,
      
      periodRevenue: periodStats.periodRevenue,
      periodBookings: periodStats.periodBookings,
      avgBookingValue: Math.round(allTimeStats.avgBookingValue || 0),
      
      // Performance indicators
      occupancyRate: calculateOccupancyRate(periodStats.periodBookings, parkingSpaces.length, timeframe),
      revenuePerSpace: Math.round((periodStats.periodRevenue || 0) / parkingSpaces.length),
      conversionRate: allTimeStats.totalBookings > 0 ? 
        ((periodStats.periodBookings / allTimeStats.totalBookings) * 100).toFixed(1) : 0
    },

    // Growth comparison
    ...(growthMetrics && { growth: growthMetrics }),

    // Charts and breakdowns
    trendChart: chartData,
    spacePerformance: spacePerformanceWithNames,
    recentActivity: recentBookings.map(booking => ({
      id: booking._id,
      amount: booking.pricing.totalAmount,
      spaceName: booking.parkingSpaceId?.name || 'Unknown',
      status: booking.status,
      date: booking.createdAt,
      timeAgo: getTimeAgo(booking.createdAt)
    })),

    // Metadata
    metadata: {
      hasData: allTimeStats.totalBookings > 0,
      totalSpaces: parkingSpaces.length,
      dataGeneratedAt: new Date().toISOString(),
      includesComparison: compareWithPrevious === 'true'
    }
  };

  logger.info(`📊 [ANALYTICS] Dashboard response generated for landlord ${landlordId}:`, {
    totalEarnings: totalLifetimeEarnings,
    periodRevenue: periodStats.periodRevenue,
    periodBookings: periodStats.periodBookings,
    hasGrowthData: !!growthMetrics,
    chartDataPoints: chartData.length,
    responseSize: JSON.stringify(analyticsData).length
  });

  const responseData = {
    status: 'success',
    data: analyticsData
  };

  logger.info(`📤 [ANALYTICS] Sending response to client:`, {
    status: responseData.status,
    dataKeys: Object.keys(analyticsData),
    summaryKeys: Object.keys(analyticsData.summary || {}),
    trendDataPoints: analyticsData.trendChart?.length || 0,
    responseTimestamp: new Date().toISOString()
  });

  res.status(200).json(responseData);
});

/**
 * Generate trend data for charts
 */
async function generateTrendData(spaceIds, timeframe, startDate, endDate) {
  const dataPoints = getDataPoints(timeframe);
  const trendData = [];

  for (let i = 0; i < dataPoints; i++) {
    const { periodStart, periodEnd, label } = calculatePeriodRange(timeframe, dataPoints, i, endDate);

    const periodRevenue = await Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true },
        createdAt: { $gte: periodStart, $lt: periodEnd }
      }},
      { $group: {
        _id: null,
        revenue: { $sum: '$pricing.totalAmount' },
        bookings: { $sum: 1 }
      }}
    ]);

    const stats = periodRevenue[0] || { revenue: 0, bookings: 0 };

    trendData.push({
      label,
      amount: stats.revenue,
      bookings: stats.bookings,
      date: periodStart.toISOString()
    });
  }

  return trendData;
}

/**
 * Helper functions
 */
function getDataPoints(timeframe) {
  switch (timeframe) {
    case 'daily': return 24; // Hourly
    case 'weekly': return 7; // Daily
    case 'monthly': return 30; // Daily
    case 'yearly': return 12; // Monthly
    default: return 7;
  }
}

function getPeriodName(timeframe) {
  const names = {
    daily: 'Last 24 Hours',
    weekly: 'Last 7 Days', 
    monthly: 'Last 30 Days',
    yearly: 'Last 12 Months'
  };
  return names[timeframe] || 'Last 7 Days';
}

function calculatePeriodRange(timeframe, dataPoints, index, endDate) {
  let periodStart, periodEnd, label;
  
  if (timeframe === 'daily') {
    // Hourly data points
    periodStart = new Date(endDate.getTime() - ((dataPoints - index) * 60 * 60 * 1000));
    periodEnd = new Date(endDate.getTime() - ((dataPoints - index - 1) * 60 * 60 * 1000));
    label = periodStart.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
  } else if (timeframe === 'weekly' || timeframe === 'monthly') {
    // Daily data points
    periodStart = new Date(endDate.getTime() - ((dataPoints - index) * 24 * 60 * 60 * 1000));
    periodEnd = new Date(endDate.getTime() - ((dataPoints - index - 1) * 24 * 60 * 60 * 1000));
    label = periodStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } else {
    // Monthly data points
    const monthDate = new Date(endDate.getFullYear(), endDate.getMonth() - (dataPoints - index - 1), 1);
    periodStart = monthDate;
    periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    label = monthDate.toLocaleDateString('en-US', { month: 'short' });
  }

  return { periodStart, periodEnd, label };
}

function calculateOccupancyRate(bookings, totalSpaces, timeframe) {
  const periodDays = timeframe === 'daily' ? 1 : 
                    timeframe === 'weekly' ? 7 : 
                    timeframe === 'monthly' ? 30 : 365;
  
  const maxPossibleBookings = totalSpaces * periodDays * 12; // Assume 12 potential bookings per day per space
  return Math.min(((bookings / maxPossibleBookings) * 100), 100).toFixed(1);
}

function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - new Date(date);
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

module.exports = {
  getDashboardAnalytics
};