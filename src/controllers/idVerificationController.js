const idVerificationService = require('../services/idVerificationService');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// Helper function to format phone number (same as authController)
const formatPhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return phoneNumber;

  // Remove all non-digits
  const cleaned = phoneNumber.replace(/\D/g, '');

  // If it's 10 digits starting with 9, add 0 prefix
  if (cleaned.length === 10 && cleaned.startsWith('9')) {
    return '0' + cleaned;
  }

  // If it's 11 digits starting with 09, it's already in correct format
  if (cleaned.length === 11 && cleaned.startsWith('09')) {
    return cleaned;
  }

  // If it's 12 digits starting with 63, convert to 0 format
  if (cleaned.length === 12 && cleaned.startsWith('63')) {
    return '0' + cleaned.substring(2);
  }

  // If it's 13 digits starting with +63, convert to 0 format
  if (cleaned.length === 13 && phoneNumber.startsWith('+63')) {
    return '0' + cleaned.substring(2);
  }

  // Return the cleaned number as fallback
  return cleaned;
};

/**
 * Submit ID verification
 * @route POST /api/v1/id-verification/submit
 * @access Private (Landlords only)
 */
const submitIdVerification = catchAsync(async (req, res, next) => {
  const { idType } = req.body;
  const userId = req.user.id;
  
  // Validate required fields
  if (!idType) {
    return next(new AppError('ID type is required', 400));
  }

  // Check if files are provided
  if (!req.files || Object.keys(req.files).length === 0) {
    return next(new AppError('ID photos are required', 400));
  }

  // Validate required photos
  const { front, back, selfie } = req.files;
  if (!front || !back || !selfie) {
    return next(new AppError('All three photos (front, back, selfie) are required', 400));
  }

  logger.info(`📋 ID verification submission started for user ${userId}`, {
    userId,
    idType,
    filesReceived: Object.keys(req.files)
  });

  try {
    const result = await idVerificationService.submitIdVerification(
      userId,
      { idType },
      { front: front[0], back: back[0], selfie: selfie[0] }
    );

    res.status(200).json({
      status: 'success',
      message: result.message,
      data: result.data
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Get ID verification status
 * @route GET /api/v1/id-verification/status
 * @access Private (Landlords only)
 */
const getVerificationStatus = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    const result = await idVerificationService.getVerificationStatus(userId);

    res.status(200).json({
      status: 'success',
      data: result.data
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Review ID verification (Admin only)
 * @route POST /api/v1/id-verification/review/:userId
 * @access Private (Admins only)
 */
const reviewIdVerification = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { status, rejectionReason } = req.body;
  const reviewerId = req.user.id;

  // Validate status
  const validStatuses = ['approved', 'rejected'];
  if (!validStatuses.includes(status)) {
    return next(new AppError('Status must be either approved or rejected', 400));
  }

  // Validate rejection reason if status is rejected
  if (status === 'rejected' && !rejectionReason) {
    return next(new AppError('Rejection reason is required when rejecting verification', 400));
  }

  try {
    const result = await idVerificationService.reviewIdVerification(
      userId,
      { status, rejectionReason },
      reviewerId
    );

    res.status(200).json({
      status: 'success',
      message: result.message,
      data: result.data
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Get pending verifications (Admin only)
 * @route GET /api/v1/id-verification/pending
 * @access Private (Admins only)
 */
const getPendingVerifications = catchAsync(async (req, res, next) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;

  try {
    const result = await idVerificationService.getPendingVerifications(page, limit);

    res.status(200).json({
      status: 'success',
      data: result.data
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Get verification statistics (Admin only)
 * @route GET /api/v1/id-verification/stats
 * @access Private (Admins only)
 */
const getVerificationStats = catchAsync(async (req, res, next) => {
  try {
    const result = await idVerificationService.getVerificationStats();

    res.status(200).json({
      status: 'success',
      data: result.data
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Delete verification photos (Admin only)
 * @route DELETE /api/v1/id-verification/:userId
 * @access Private (Admins only)
 */
const deleteVerificationPhotos = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  try {
    const result = await idVerificationService.deleteVerificationPhotos(userId);

    res.status(200).json({
      status: 'success',
      message: result.message
    });

  } catch (error) {
    next(error);
  }
});

/**
 * Submit ID verification during registration (no auth required)
 */
const submitIdVerificationRegistration = async (req, res) => {
  try {
    const { phoneNumber, idType } = req.body;

    // Format phone number to match database format
    const formattedPhoneNumber = formatPhoneNumber(phoneNumber);

    // Debug: Log request details
    logger.info('🔍 DEBUG: Validating request body:', {
      phoneNumber,
      formattedPhoneNumber,
      idType
    });

    // Debug: Log what files we received
    logger.info('🔍 Registration ID verification - received files:', {
      hasFiles: !!req.files,
      fileKeys: req.files ? Object.keys(req.files) : null,
      frontCount: req.files?.front?.length || 0,
      backCount: req.files?.back?.length || 0,
      selfieCount: req.files?.selfie?.length || 0
    });

    if (!req.files || !req.files.front || !req.files.back || !req.files.selfie) {
      return res.status(400).json({
        status: 'error',
        message: 'All three photos (front, back, selfie) are required'
      });
    }

    // Find user by phone number (they should have completed phone verification)
    // All users are now in the User model regardless of role
    const User = require('../models/User');

    // Debug: Check what's in the database
    const allUsers = await User.find({ phoneNumber: { $exists: true } }).select('phoneNumber email role');
    logger.info('🔍 DEBUG: All users with phone numbers:', {
      users: allUsers.map(u => ({ id: u._id, phone: u.phoneNumber, email: u.email, role: u.role }))
    });

    const user = await User.findOne({ phoneNumber: formattedPhoneNumber });
    logger.info('🔍 User lookup:', {
      phoneNumber,
      formattedPhoneNumber,
      found: !!user,
      userId: user?._id,
      role: user?.role
    });

    if (!user) {
      logger.warn('❌ User not found for ID verification', { phoneNumber });
      return res.status(404).json({
        status: 'error',
        message: 'User not found. Please complete phone verification first.'
      });
    }

    if (user.role !== 'landlord') {
      return res.status(403).json({
        status: 'error',
        message: 'ID verification is only available for landlords'
      });
    }

    // Debug: Log the user's current idVerification state
    logger.info('🔍 ID Verification Registration Debug:', {
      userId: user._id,
      hasIdVerification: !!user.idVerification,
      idVerificationValue: user.idVerification,
      idVerificationKeys: user.idVerification ? Object.keys(user.idVerification) : null
    });

    // Check if user has already submitted ID verification (has actual data, not just empty object)
    if (user.idVerification && 
        user.idVerification.idType && 
        user.idVerification.idFrontUrl && 
        user.idVerification.idBackUrl && 
        user.idVerification.selfieUrl) {
      logger.warn('❌ ID verification already submitted', {
        userId: user._id,
        idType: user.idVerification.idType,
        status: user.idVerification.verificationStatus
      });
      return res.status(400).json({
        status: 'error',
        message: 'ID verification already submitted'
      });
    }

    // Submit the verification using the service
    const result = await idVerificationService.submitIdVerification(
      user._id,
      { idType },
      {
        front: req.files.front[0],
        back: req.files.back[0],
        selfie: req.files.selfie[0]
      }
    );

    res.status(201).json(result);

  } catch (error) {
    logger.error('❌ Registration ID verification submission failed:', error);
    res.status(500).json({
      status: 'error',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Failed to submit ID verification'
    });
  }
};

module.exports = {
  submitIdVerification,
  submitIdVerificationRegistration,
  getVerificationStatus,
  reviewIdVerification,
  getPendingVerifications,
  getVerificationStats,
  deleteVerificationPhotos
};
