const DynamicPricingConfig = require('../models/DynamicPricingConfig');
const dynamicPricingService = require('../services/newDynamicPricingService');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Get current dynamic pricing configuration
 * @route GET /api/v1/admin/dynamic-pricing/config
 * @access Private (Admin only)
 */
const getPricingConfig = catchAsync(async (req, res, next) => {
  const config = await DynamicPricingConfig.getCurrentConfig();

  res.status(200).json({
    status: 'success',
    data: {
      config,
      configurationIntensity: config.configurationIntensity
    }
  });
});

/**
 * Update dynamic pricing configuration
 * @route PUT /api/v1/admin/dynamic-pricing/config
 * @access Private (Admin only)
 */
const updatePricingConfig = catchAsync(async (req, res, next) => {
  const config = await DynamicPricingConfig.getCurrentConfig();

  // Update fields
  Object.keys(req.body).forEach(key => {
    if (config.schema.paths[key]) {
      config[key] = req.body[key];
    }
  });

  // Set audit fields
  config.lastUpdatedBy = req.user.id;
  config.lastUpdatedAt = new Date();

  await config.save();

  // Apply new configuration to pricing service
  config.applyToPricingService();

  logger.info('🎛️ Dynamic pricing configuration updated', {
    adminId: req.user.id,
    version: config.version,
    changes: Object.keys(req.body)
  });

  res.status(200).json({
    status: 'success',
    message: 'Dynamic pricing configuration updated successfully',
    data: {
      config,
      configurationIntensity: config.configurationIntensity
    }
  });
});

/**
 * Reset pricing configuration to defaults
 * @route POST /api/v1/admin/dynamic-pricing/config/reset
 * @access Private (Admin only)
 */
const resetPricingConfig = catchAsync(async (req, res, next) => {
  // Delete existing configuration
  await DynamicPricingConfig.deleteOne({ configId: 'default_pricing_config' });

  // Create new default configuration
  const config = await DynamicPricingConfig.getCurrentConfig();

  // Apply to pricing service
  config.applyToPricingService();

  logger.info('🔄 Dynamic pricing configuration reset to defaults', {
    adminId: req.user.id
  });

  res.status(200).json({
    status: 'success',
    message: 'Dynamic pricing configuration reset to defaults',
    data: {
      config
    }
  });
});

/**
 * Add holiday to pricing configuration
 * @route POST /api/v1/admin/dynamic-pricing/holidays
 * @access Private (Admin only)
 */
const addHoliday = catchAsync(async (req, res, next) => {
  const { date, name, multiplier = 1.30, isRecurring = false } = req.body;

  if (!date || !name) {
    return next(new AppError('Date and name are required for holiday', 400));
  }

  const config = await DynamicPricingConfig.getCurrentConfig();

  config.holidays.push({
    date: new Date(date),
    name,
    multiplier,
    isRecurring
  });

  config.lastUpdatedBy = req.user.id;
  await config.save();

  config.applyToPricingService();

  res.status(201).json({
    status: 'success',
    message: 'Holiday added successfully',
    data: {
      holiday: config.holidays[config.holidays.length - 1]
    }
  });
});

/**
 * Remove holiday from pricing configuration
 * @route DELETE /api/v1/admin/dynamic-pricing/holidays/:holidayId
 * @access Private (Admin only)
 */
const removeHoliday = catchAsync(async (req, res, next) => {
  const { holidayId } = req.params;

  const config = await DynamicPricingConfig.getCurrentConfig();

  config.holidays = config.holidays.filter(
    holiday => holiday._id.toString() !== holidayId
  );

  config.lastUpdatedBy = req.user.id;
  await config.save();

  config.applyToPricingService();

  res.status(200).json({
    status: 'success',
    message: 'Holiday removed successfully'
  });
});

/**
 * Test pricing calculation with current configuration
 * @route POST /api/v1/admin/dynamic-pricing/test
 * @access Private (Admin only)
 */
const testPricingCalculation = catchAsync(async (req, res, next) => {
  const {
    parkingSpaceId,
    startTime = new Date(),
    duration = 1,
    vehicleType = 'car'
  } = req.body;

  if (!parkingSpaceId) {
    return next(new AppError('Parking space ID is required for testing', 400));
  }

  const pricingResult = await dynamicPricingService.calculatePricing({
    parkingSpaceId,
    startTime: new Date(startTime),
    duration,
    vehicleType,
    isWeekend: dynamicPricingService.isWeekend(startTime),
    isHoliday: await dynamicPricingService.isHoliday(startTime)
  });

  res.status(200).json({
    status: 'success',
    message: 'Pricing calculation test completed',
    data: {
      pricingResult,
      testParameters: {
        parkingSpaceId,
        startTime,
        duration,
        vehicleType
      }
    }
  });
});

/**
 * Get pricing analytics and statistics
 * @route GET /api/v1/admin/dynamic-pricing/analytics
 * @access Private (Admin only)
 */
const getPricingAnalytics = catchAsync(async (req, res, next) => {
  const { timeRange = 7 } = req.query; // Last 7 days by default

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - parseInt(timeRange));

  // TODO: Implement comprehensive analytics
  // This would include:
  // - Average pricing by hour
  // - Peak vs off-peak revenue comparison
  // - Occupancy impact on pricing
  // - Landlord vs platform earnings breakdown
  // - Dynamic pricing effectiveness metrics

  const analytics = {
    timeRange: `${timeRange} days`,
    totalBookings: 0, // To be calculated from actual bookings
    averageDynamicMultiplier: 1.15,
    peakHourRevenue: 0,
    offPeakRevenue: 0,
    platformEarnings: 0,
    landlordEarnings: 0,
    dynamicPricingImpact: 12.5, // Percentage increase in revenue
    configurationIntensity: (await DynamicPricingConfig.getCurrentConfig()).configurationIntensity
  };

  res.status(200).json({
    status: 'success',
    data: {
      analytics,
      period: {
        start: startDate,
        end: endDate
      }
    }
  });
});

/**
 * Bulk update peak hours
 * @route PUT /api/v1/admin/dynamic-pricing/peak-hours
 * @access Private (Admin only)
 */
const updatePeakHours = catchAsync(async (req, res, next) => {
  const { peakHours } = req.body;

  if (!Array.isArray(peakHours)) {
    return next(new AppError('Peak hours must be an array', 400));
  }

  // Validate peak hours format
  for (const period of peakHours) {
    if (typeof period.start !== 'number' || typeof period.end !== 'number') {
      return next(new AppError('Each peak hour period must have numeric start and end', 400));
    }
    if (period.start < 0 || period.start > 23 || period.end < 0 || period.end > 23) {
      return next(new AppError('Peak hour times must be between 0 and 23', 400));
    }
  }

  const config = await DynamicPricingConfig.getCurrentConfig();

  config.peakHours = peakHours;
  config.lastUpdatedBy = req.user.id;

  await config.save();
  config.applyToPricingService();

  logger.info('⏰ Peak hours configuration updated', {
    adminId: req.user.id,
    peakHours: peakHours
  });

  res.status(200).json({
    status: 'success',
    message: 'Peak hours updated successfully',
    data: {
      peakHours: config.peakHours
    }
  });
});

module.exports = {
  getPricingConfig,
  updatePricingConfig,
  resetPricingConfig,
  addHoliday,
  removeHoliday,
  testPricingCalculation,
  getPricingAnalytics,
  updatePeakHours
};