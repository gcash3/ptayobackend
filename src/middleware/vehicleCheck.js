const Vehicle = require('../models/Vehicle');
const { AppError, catchAsync } = require('./errorHandler');
const logger = require('../config/logger');

/**
 * Middleware to check if user has at least one registered vehicle
 * This ensures users cannot bypass the mandatory vehicle registration during onboarding
 * Should be used on endpoints that require a vehicle (e.g., booking, parking search)
 */
const requireVehicle = catchAsync(async (req, res, next) => {
  // Skip check for admin users
  if (req.user.role === 'admin' || req.user.userType === 'admin') {
    return next();
  }

  // Skip check for landlord users (they don't need vehicles)
  if (req.user.userType === 'landlord') {
    return next();
  }

  // Check if user has at least one vehicle
  const vehicleCount = await Vehicle.countDocuments({
    user: req.user._id,
    status: { $ne: 'deleted' } // Don't count deleted vehicles
  });

  if (vehicleCount === 0) {
    logger.warn('User attempted to access vehicle-required endpoint without a vehicle', {
      userId: req.user._id,
      email: req.user.email,
      url: req.originalUrl,
      method: req.method
    });

    return next(new AppError(
      'You must register at least one vehicle to use this feature. Please complete your registration.',
      403
    ));
  }

  logger.debug('✅ User has registered vehicle(s)', {
    userId: req.user._id,
    vehicleCount
  });

  next();
});

/**
 * Middleware to check if user has a specific vehicle
 * Validates that the vehicle belongs to the user
 */
const checkVehicleOwnership = catchAsync(async (req, res, next) => {
  const vehicleId = req.params.vehicleId || req.body.vehicleId || req.query.vehicleId;

  if (!vehicleId) {
    return next(new AppError('Vehicle ID is required', 400));
  }

  const vehicle = await Vehicle.findOne({
    _id: vehicleId,
    user: req.user._id,
    status: { $ne: 'deleted' }
  });

  if (!vehicle) {
    logger.warn('User attempted to access vehicle they do not own', {
      userId: req.user._id,
      vehicleId,
      url: req.originalUrl
    });

    return next(new AppError('Vehicle not found or you do not have permission to access it', 404));
  }

  // Attach vehicle to request for use in route handler
  req.vehicle = vehicle;
  next();
});

module.exports = {
  requireVehicle,
  checkVehicleOwnership
};
