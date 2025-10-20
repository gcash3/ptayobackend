const Vehicle = require('../models/Vehicle');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// Get user's vehicles
const getUserVehicles = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { vehicleType } = req.query;

  const vehicles = await Vehicle.getUserVehicles(userId, vehicleType);

  res.status(200).json({
    status: 'success',
    results: vehicles.length,
    data: {
      vehicles
    }
  });
});

// Get single vehicle
const getVehicle = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const userId = req.user.id;

  const vehicle = await Vehicle.findOne({ _id: vehicleId, userId });

  if (!vehicle) {
    return next(new AppError('Vehicle not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      vehicle
    }
  });
});

// Add new vehicle
const addVehicle = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    plateNumber,
    vehicleType,
    brand,
    model,
    color,
    year,
    isDefault
  } = req.body;

  // Check if plate number already exists
  const existingVehicle = await Vehicle.findOne({ plateNumber });
  if (existingVehicle) {
    return next(new AppError('Vehicle with this plate number already exists', 400));
  }

  // Create vehicle (active by default for immediate booking)
  const vehicle = await Vehicle.create({
    userId,
    plateNumber,
    vehicleType,
    brand,
    model,
    color,
    year,
    isDefault: isDefault || false
    // status: 'active' is set by default in the model
  });

  logger.info('Vehicle added', {
    userId,
    vehicleId: vehicle._id,
    plateNumber: vehicle.plateNumber,
    vehicleType: vehicle.vehicleType
  });

  res.status(201).json({
    status: 'success',
    message: 'Vehicle added successfully',
    data: {
      vehicle
    }
  });
});

// Update vehicle
const updateVehicle = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const userId = req.user.id;
  const updateData = req.body;

  // Remove sensitive fields that shouldn't be updated by user
  delete updateData.status;
  delete updateData.documents;
  delete updateData.verificationNotes;

  const vehicle = await Vehicle.findOneAndUpdate(
    { _id: vehicleId, userId },
    updateData,
    { new: true, runValidators: true }
  );

  if (!vehicle) {
    return next(new AppError('Vehicle not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Vehicle updated successfully',
    data: {
      vehicle
    }
  });
});

// Delete vehicle
const deleteVehicle = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const userId = req.user.id;

  const vehicle = await Vehicle.findOneAndDelete({ _id: vehicleId, userId });

  if (!vehicle) {
    return next(new AppError('Vehicle not found', 404));
  }

  logger.info('Vehicle deleted', {
    userId,
    vehicleId: vehicle._id,
    plateNumber: vehicle.plateNumber
  });

  res.status(200).json({
    status: 'success',
    message: 'Vehicle deleted successfully'
  });
});

// Upload vehicle documents (MVFile)
const uploadVehicleDocuments = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const userId = req.user.id;
  const { mvFileUrl } = req.body;

  if (!mvFileUrl) {
    return next(new AppError('MVFile URL is required', 400));
  }

  const vehicle = await Vehicle.findOne({ _id: vehicleId, userId });

  if (!vehicle) {
    return next(new AppError('Vehicle not found', 404));
  }

  // Update vehicle documents
  vehicle.documents.mvFile = {
    url: mvFileUrl,
    uploadedAt: new Date(),
    verified: false
  };

  await vehicle.save();

  logger.info('Vehicle documents uploaded', {
    userId,
    vehicleId: vehicle._id,
    plateNumber: vehicle.plateNumber
  });

  res.status(200).json({
    status: 'success',
    message: 'Vehicle documents uploaded successfully',
    data: {
      vehicle
    }
  });
});

// Set default vehicle
const setDefaultVehicle = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const userId = req.user.id;

  const vehicle = await Vehicle.findOne({ _id: vehicleId, userId });

  if (!vehicle) {
    return next(new AppError('Vehicle not found', 404));
  }

  vehicle.isDefault = true;
  await vehicle.save();

  res.status(200).json({
    status: 'success',
    message: 'Default vehicle updated successfully',
    data: {
      vehicle
    }
  });
});

// Admin endpoints

// Get all vehicles for admin
const getAllVehicles = catchAsync(async (req, res, next) => {
  const {
    status,
    vehicleType,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  let query = {};
  if (status) query.status = status;
  if (vehicleType) query.vehicleType = vehicleType;

  const sortOption = {};
  sortOption[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const vehicles = await Vehicle.find(query)
    .populate('userId', 'firstName lastName email')
    .sort(sortOption)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await Vehicle.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: vehicles.length,
    data: {
      vehicles,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    }
  });
});

// Verify vehicle (admin only)
const verifyVehicle = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const { notes } = req.body;
  const adminId = req.user.id;

  const vehicle = await Vehicle.verifyVehicle(vehicleId, adminId, notes);

  logger.info('Vehicle verified by admin', {
    adminId,
    vehicleId: vehicle._id,
    plateNumber: vehicle.plateNumber
  });

  res.status(200).json({
    status: 'success',
    message: 'Vehicle verified successfully',
    data: {
      vehicle
    }
  });
});

// Reject vehicle (admin only)
const rejectVehicle = catchAsync(async (req, res, next) => {
  const { vehicleId } = req.params;
  const { reason } = req.body;
  const adminId = req.user.id;

  if (!reason) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const vehicle = await Vehicle.rejectVehicle(vehicleId, adminId, reason);

  logger.info('Vehicle rejected by admin', {
    adminId,
    vehicleId: vehicle._id,
    plateNumber: vehicle.plateNumber,
    reason
  });

  res.status(200).json({
    status: 'success',
    message: 'Vehicle rejected successfully',
    data: {
      vehicle
    }
  });
});

module.exports = {
  getUserVehicles,
  getVehicle,
  addVehicle,
  updateVehicle,
  deleteVehicle,
  uploadVehicleDocuments,
  setDefaultVehicle,
  getAllVehicles,
  verifyVehicle,
  rejectVehicle
}; 