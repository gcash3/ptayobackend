const { catchAsync, AppError } = require('../middleware/errorHandler');
const serviceFeeTrackingService = require('../services/serviceFeeTrackingService');
const logger = require('../config/logger');

/**
 * Get app revenue analytics
 */
const getRevenueAnalytics = catchAsync(async (req, res) => {
  const {
    startDate,
    endDate,
    vehicleCategory,
    bookingType,
    paymentStatus = 'paid'
  } = req.query;

  const filters = {};
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) filters.endDate = new Date(endDate);
  if (vehicleCategory) filters.vehicleCategory = vehicleCategory;
  if (bookingType) filters.bookingType = bookingType;
  if (paymentStatus) filters.paymentStatus = paymentStatus;

  const analytics = await serviceFeeTrackingService.getRevenueAnalytics(filters);

  res.status(200).json({
    status: 'success',
    data: {
      analytics,
      message: 'Revenue analytics retrieved successfully'
    }
  });
});

/**
 * Get top earning parking spaces
 */
const getTopEarningSpaces = catchAsync(async (req, res) => {
  const {
    startDate,
    endDate,
    paymentStatus = 'paid',
    limit = 10
  } = req.query;

  const filters = {};
  if (startDate) filters.startDate = new Date(startDate);
  if (endDate) filters.endDate = new Date(endDate);
  if (paymentStatus) filters.paymentStatus = paymentStatus;

  const topSpaces = await serviceFeeTrackingService.getTopEarningSpaces(filters, parseInt(limit));

  res.status(200).json({
    status: 'success',
    data: {
      topSpaces,
      message: `Top ${limit} earning parking spaces retrieved successfully`
    }
  });
});

/**
 * Get revenue trends and projections
 */
const getRevenueTrends = catchAsync(async (req, res) => {
  const { days = 30 } = req.query;

  const trends = await serviceFeeTrackingService.getRevenueTrends(parseInt(days));

  res.status(200).json({
    status: 'success',
    data: {
      trends,
      message: `Revenue trends for last ${days} days retrieved successfully`
    }
  });
});

/**
 * Get service fee breakdown by category
 */
const getServiceFeeBreakdown = catchAsync(async (req, res) => {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    paymentStatus = 'paid'
  } = req.query;

  // Get analytics for each vehicle category
  const lightVehicles = await serviceFeeTrackingService.getRevenueAnalytics({
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    vehicleCategory: 'LIGHT_VEHICLES',
    paymentStatus
  });

  const mediumVehicles = await serviceFeeTrackingService.getRevenueAnalytics({
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    vehicleCategory: 'MEDIUM_VEHICLES',
    paymentStatus
  });

  const heavyVehicles = await serviceFeeTrackingService.getRevenueAnalytics({
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    vehicleCategory: 'HEAVY_VEHICLES',
    paymentStatus
  });

  // Get overall analytics
  const overall = await serviceFeeTrackingService.getRevenueAnalytics({
    startDate: new Date(startDate),
    endDate: new Date(endDate),
    paymentStatus
  });

  const breakdown = {
    period: {
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      paymentStatus
    },
    overall: overall.summary,
    byCategory: {
      lightVehicles: {
        category: 'Light Vehicles (Motorcycles)',
        ...lightVehicles.summary
      },
      mediumVehicles: {
        category: 'Medium Vehicles (Cars)',
        ...mediumVehicles.summary
      },
      heavyVehicles: {
        category: 'Heavy Vehicles (Buses/Trucks)',
        ...heavyVehicles.summary
      }
    },
    insights: {
      mostProfitableCategory: getMostProfitableCategory([
        { name: 'Light', revenue: lightVehicles.summary.totalRevenue || 0 },
        { name: 'Medium', revenue: mediumVehicles.summary.totalRevenue || 0 },
        { name: 'Heavy', revenue: heavyVehicles.summary.totalRevenue || 0 }
      ]),
      totalProfitMargin: overall.profitMargin,
      averageServiceFeePerBooking: overall.summary.averageServiceFee || 0
    }
  };

  res.status(200).json({
    status: 'success',
    data: {
      breakdown,
      message: 'Service fee breakdown retrieved successfully'
    }
  });
});

/**
 * Helper function to determine most profitable category
 */
function getMostProfitableCategory(categories) {
  return categories.reduce((max, category) => 
    category.revenue > max.revenue ? category : max
  , { name: 'None', revenue: 0 });
}

/**
 * Record service fee for a booking (internal use)
 */
const recordServiceFee = catchAsync(async (req, res) => {
  const bookingData = req.body;

  const record = await serviceFeeTrackingService.recordServiceFee(bookingData);

  res.status(201).json({
    status: 'success',
    data: {
      record,
      message: 'Service fee recorded successfully'
    }
  });
});

/**
 * Update payment status (internal use)
 */
const updatePaymentStatus = catchAsync(async (req, res) => {
  const { bookingId } = req.params;
  const { status } = req.body;

  const record = await serviceFeeTrackingService.updatePaymentStatus(bookingId, status);

  if (!record) {
    return res.status(404).json({
      status: 'error',
      message: 'Service fee record not found'
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      record,
      message: 'Payment status updated successfully'
    }
  });
});

module.exports = {
  getRevenueAnalytics,
  getTopEarningSpaces,
  getRevenueTrends,
  getServiceFeeBreakdown,
  recordServiceFee,
  updatePaymentStatus
};
