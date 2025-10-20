const Booking = require('../models/Booking');
const User = require('../models/User');
const abTestingService = require('../services/abTestingService');
const logger = require('../config/logger');

/**
 * Get ML model performance metrics (Fallback - ML removed)
 */
const getMLMetrics = async (req, res) => {
  try {
    // Return fallback metrics since ML has been removed
    const metrics = {
      modelVersion: 'fallback',
      totalSamples: 0,
      averageError: 0,
      averageAbsoluteError: 0,
      onTimeRate: 0,
      lastUpdated: new Date(),
      status: 'ML removed - using 30-minute fallback'
    };
    
    res.status(200).json({
      status: 'success',
      data: metrics
    });

  } catch (error) {
    logger.error('Get ML metrics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve ML metrics'
    });
  }
};

/**
 * Get comprehensive smart booking analytics
 */
const getSmartBookingAnalytics = async (req, res) => {
  try {
    const { timeRange = '7d' } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    switch (timeRange) {
      case '1d':
        startDate.setDate(endDate.getDate() - 1);
        break;
      case '7d':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case '30d':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case '90d':
        startDate.setDate(endDate.getDate() - 90);
        break;
      default:
        startDate.setDate(endDate.getDate() - 7);
    }

    // Get booking overview
    const overview = await getBookingOverview(startDate, endDate);
    
    // Get prediction accuracy history
    const predictionHistory = await getPredictionHistory(startDate, endDate);
    
    // Get traffic impact analysis
    const trafficImpacts = await getTrafficImpactAnalysis(startDate, endDate);
    
    // Get user behavior analysis
    const userBehaviors = await getUserBehaviorAnalysis(startDate, endDate);

    res.status(200).json({
      status: 'success',
      data: {
        overview,
        predictionHistory,
        trafficImpacts,
        userBehaviors,
        timeRange: {
          start: startDate,
          end: endDate,
          range: timeRange
        }
      }
    });

  } catch (error) {
    logger.error('Get smart booking analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve analytics data'
    });
  }
};

/**
 * Get booking overview statistics
 */
async function getBookingOverview(startDate, endDate) {
  const totalBookings = await Booking.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate }
  });

  const smartBookings = await Booking.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    bookingMode: 'book_now'
  });

  const reservationBookings = await Booking.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    bookingMode: 'reservation'
  });

  // Calculate success rate (completed bookings)
  const completedBookings = await Booking.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    status: 'completed'
  });

  // Calculate on-time rate for smart bookings
  const onTimeBookings = await Booking.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    bookingMode: 'book_now',
    'arrivalPrediction.wasOnTime': true
  });

  const smartBookingsWithArrival = await Booking.countDocuments({
    createdAt: { $gte: startDate, $lte: endDate },
    bookingMode: 'book_now',
    'arrivalPrediction.actualArrivalTime': { $exists: true }
  });

  // Calculate average confidence score
  const confidenceAggregation = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        bookingMode: 'book_now',
        'arrivalPrediction.confidenceScore': { $exists: true }
      }
    },
    {
      $group: {
        _id: null,
        averageConfidence: { $avg: '$arrivalPrediction.confidenceScore' }
      }
    }
  ]);

  return {
    totalBookings,
    smartBookings,
    reservationBookings,
    successRate: totalBookings > 0 ? Math.round((completedBookings / totalBookings) * 100) : 0,
    averageConfidence: confidenceAggregation.length > 0 ? Math.round(confidenceAggregation[0].averageConfidence) : 0,
    onTimeRate: smartBookingsWithArrival > 0 ? Math.round((onTimeBookings / smartBookingsWithArrival) * 100) : 0
  };
}

/**
 * Get prediction accuracy history over time
 */
async function getPredictionHistory(startDate, endDate) {
  const dailyStats = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        bookingMode: 'book_now',
        'arrivalPrediction.actualArrivalTime': { $exists: true }
      }
    },
    {
      $addFields: {
        date: {
          $dateToString: {
            format: "%Y-%m-%d",
            date: "$createdAt"
          }
        },
        wasOnTime: '$arrivalPrediction.wasOnTime',
        predictedTime: '$arrivalPrediction.predictedArrivalTime',
        actualTime: '$arrivalPrediction.actualArrivalTime'
      }
    },
    {
      $addFields: {
        errorMinutes: {
          $abs: {
            $divide: [
              { $subtract: ['$actualTime', '$predictedTime'] },
              60000 // Convert ms to minutes
            ]
          }
        }
      }
    },
    {
      $group: {
        _id: '$date',
        predictions: { $sum: 1 },
        onTime: { $sum: { $cond: ['$wasOnTime', 1, 0] } },
        totalError: { $sum: '$errorMinutes' }
      }
    },
    {
      $addFields: {
        accuracy: {
          $multiply: [
            { $divide: ['$onTime', '$predictions'] },
            100
          ]
        },
        averageError: { $divide: ['$totalError', '$predictions'] }
      }
    },
    {
      $project: {
        date: '$_id',
        accuracy: { $round: ['$accuracy', 1] },
        predictions: 1,
        averageError: { $round: ['$averageError', 1] }
      }
    },
    { $sort: { date: 1 } }
  ]);

  return dailyStats;
}

/**
 * Get traffic impact analysis
 */
async function getTrafficImpactAnalysis(startDate, endDate) {
  // This would analyze how different traffic conditions affect prediction accuracy
  const trafficImpacts = await Booking.aggregate([
    {
      $match: {
        createdAt: { $gte: startDate, $lte: endDate },
        bookingMode: 'book_now',
        'arrivalPrediction.factors.trafficDelay': { $exists: true }
      }
    },
    {
      $addFields: {
        trafficCondition: {
          $switch: {
            branches: [
              { case: { $gte: ['$arrivalPrediction.factors.trafficDelay', 20] }, then: 'heavy' },
              { case: { $gte: ['$arrivalPrediction.factors.trafficDelay', 10] }, then: 'moderate' },
              { case: { $gte: ['$arrivalPrediction.factors.trafficDelay', 5] }, then: 'light' }
            ],
            default: 'clear'
          }
        }
      }
    },
    {
      $group: {
        _id: '$trafficCondition',
        count: { $sum: 1 },
        averageDelay: { $avg: '$arrivalPrediction.factors.trafficDelay' },
        onTime: { $sum: { $cond: ['$arrivalPrediction.wasOnTime', 1, 0] } }
      }
    },
    {
      $addFields: {
        accuracy: {
          $multiply: [
            { $divide: ['$onTime', '$count'] },
            100
          ]
        }
      }
    },
    {
      $project: {
        condition: '$_id',
        count: 1,
        averageDelay: { $round: ['$averageDelay', 1] },
        accuracy: { $round: ['$accuracy', 1] }
      }
    }
  ]);

  return trafficImpacts;
}

/**
 * Get user behavior analysis
 */
async function getUserBehaviorAnalysis(startDate, endDate) {
  const userBehaviors = await User.aggregate([
    {
      $match: {
        'behaviorMetrics.totalBookings': { $gt: 0 }
      }
    },
    {
      $lookup: {
        from: 'bookings',
        localField: '_id',
        foreignField: 'userId',
        as: 'recentBookings',
        pipeline: [
          {
            $match: {
              createdAt: { $gte: startDate, $lte: endDate },
              bookingMode: 'book_now'
            }
          }
        ]
      }
    },
    {
      $match: {
        'recentBookings.0': { $exists: true } // Only users with recent bookings
      }
    },
    {
      $project: {
        userId: '$_id',
        userName: { $concat: ['$firstName', ' ', '$lastName'] },
        reliabilityScore: '$behaviorMetrics.reliabilityScore',
        totalBookings: '$behaviorMetrics.totalBookings',
        onTimeBookings: '$behaviorMetrics.onTimeBookings',
        averageDelay: '$behaviorMetrics.latenessPatterns.averageDelay',
        recentBookingCount: { $size: '$recentBookings' }
      }
    },
    { $sort: { totalBookings: -1 } },
    { $limit: 50 }
  ]);

  return userBehaviors;
}

/**
 * Get system performance summary
 */
const getSystemPerformance = async (req, res) => {
  try {
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Get 24h stats
    const stats24h = await getBookingOverview(last24h, now);
    
    // Get 7d stats
    const stats7d = await getBookingOverview(last7d, now);

    // ML model status (Fallback - ML removed)
    const mlMetrics = {
      modelVersion: 'fallback',
      totalSamples: 0,
      averageError: 0,
      averageAbsoluteError: 0,
      onTimeRate: 0,
      lastUpdated: new Date(),
      status: 'ML removed - using 30-minute fallback'
    };

    // System health indicators
    const systemHealth = {
      mlModelAccuracy: 0,
      totalTrainingSamples: 0,
      isModelTraining: false,
      
      // Booking performance
      smartBookingAdoption: stats7d.totalBookings > 0 ? 
        Math.round((stats7d.smartBookings / stats7d.totalBookings) * 100) : 0,
      
      overallOnTimeRate: stats7d.onTimeRate,
      averageConfidence: stats7d.averageConfidence,
      
      // Growth indicators
      bookingGrowth: calculateGrowthRate(stats24h.totalBookings, stats7d.totalBookings / 7),
      smartBookingGrowth: calculateGrowthRate(stats24h.smartBookings, stats7d.smartBookings / 7)
    };

    res.status(200).json({
      status: 'success',
      data: {
        last24h: stats24h,
        last7d: stats7d,
        mlMetrics,
        systemHealth
      }
    });

  } catch (error) {
    logger.error('Get system performance error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to retrieve system performance data'
    });
  }
};

/**
 * Helper function to calculate growth rate
 */
function calculateGrowthRate(current, previous) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100);
}

/**
 * Export analytics data
 */
const exportAnalyticsData = async (req, res) => {
  try {
    const { format = 'json', timeRange = '30d' } = req.query;
    
    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - (timeRange === '30d' ? 30 : 7));

    // Get comprehensive data
    const overview = await getBookingOverview(startDate, endDate);
    const predictionHistory = await getPredictionHistory(startDate, endDate);
    const trafficImpacts = await getTrafficImpactAnalysis(startDate, endDate);
    const userBehaviors = await getUserBehaviorAnalysis(startDate, endDate);
    const mlMetrics = {
      modelVersion: 'fallback',
      totalSamples: 0,
      averageError: 0,
      averageAbsoluteError: 0,
      onTimeRate: 0,
      lastUpdated: new Date(),
      status: 'ML removed - using 30-minute fallback'
    };

    const exportData = {
      exportDate: new Date().toISOString(),
      timeRange: { start: startDate, end: endDate },
      overview,
      predictionHistory,
      trafficImpacts,
      userBehaviors,
      mlMetrics
    };

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename=analytics-${timeRange}-${Date.now()}.json`);
      res.status(200).json(exportData);
    } else {
      // For CSV format, you could convert the data
      res.status(400).json({
        status: 'error',
        message: 'CSV export not yet implemented'
      });
    }

  } catch (error) {
    logger.error('Export analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to export analytics data'
    });
  }
};

/**
 * Get A/B test results
 */
const getABTestResults = async (req, res) => {
  try {
    const { testId } = req.params;
    
    if (testId) {
      // Get specific test results
      const results = abTestingService.getTestResults(testId);
      res.status(200).json({
        status: 'success',
        data: results
      });
    } else {
      // Get all active tests
      const activeTests = abTestingService.getActiveTests();
      res.status(200).json({
        status: 'success',
        data: { activeTests }
      });
    }

  } catch (error) {
    logger.error('Get A/B test results error:', error);
    res.status(500).json({
      status: 'error',
      message: error.message || 'Failed to retrieve A/B test results'
    });
  }
};

/**
 * Create new A/B test
 */
const createABTest = async (req, res) => {
  try {
    const testConfig = req.body;
    
    const test = abTestingService.createTest(testConfig);
    
    res.status(201).json({
      status: 'success',
      message: 'A/B test created successfully',
      data: { test }
    });

  } catch (error) {
    logger.error('Create A/B test error:', error);
    res.status(400).json({
      status: 'error',
      message: error.message || 'Failed to create A/B test'
    });
  }
};

/**
 * End A/B test
 */
const endABTest = async (req, res) => {
  try {
    const { testId } = req.params;
    
    const finalResults = abTestingService.endTest(testId);
    
    res.status(200).json({
      status: 'success',
      message: 'A/B test ended successfully',
      data: { finalResults }
    });

  } catch (error) {
    logger.error('End A/B test error:', error);
    res.status(400).json({
      status: 'error',
      message: error.message || 'Failed to end A/B test'
    });
  }
};

/**
 * Get user's A/B test assignment
 */
const getUserABTestAssignment = async (req, res) => {
  try {
    const { userId, testId } = req.params;
    
    const variant = abTestingService.getUserVariant(userId, testId);
    
    res.status(200).json({
      status: 'success',
      data: {
        userId,
        testId,
        variant: variant ? {
          id: variant.id,
          name: variant.name,
          config: variant.config
        } : null
      }
    });

  } catch (error) {
    logger.error('Get user A/B test assignment error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get user assignment'
    });
  }
};

module.exports = {
  getMLMetrics,
  getSmartBookingAnalytics,
  getSystemPerformance,
  exportAnalyticsData,
  getABTestResults,
  createABTest,
  endABTest,
  getUserABTestAssignment
};