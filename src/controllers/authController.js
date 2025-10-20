const crypto = require('crypto');
const { validationResult } = require('express-validator');
const User = require('../models/User');
const Landlord = require('../models/Landlord');
const PhoneVerification = require('../models/PhoneVerification');
const phoneVerificationService = require('../services/phoneVerificationService');
const emailService = require('../services/emailService');
const { catchAsync, AppError, createValidationError } = require('../middleware/errorHandler');
const { createSendToken } = require('../middleware/auth');
const logger = require('../config/logger');
const { getEmailVerificationSetting } = require('../middleware/systemSettings');

// Helper function to create and send token
const createAndSendToken = (user, statusCode, res, message = 'Success') => {
  createSendToken(user, statusCode, res, message);
};

// Helper function to format phone number
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
  if (cleaned.length === 13 && cleaned.startsWith('63')) {
    return '0' + cleaned.substring(2);
  }

  // Return original if can't format
  return phoneNumber;
};

// Signup
const signup = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { firstName, lastName, email, password, phoneNumber, role = 'client' } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('User with this email already exists', 400));
  }

  // Create new user
  const newUser = await User.create({
    firstName,
    lastName,
    email,
    password,
    phoneNumber,
    role
  });

  // Check if email verification is required by system settings
  const emailVerificationRequired = await getEmailVerificationSetting();

  let message = 'User registered successfully!';

  if (emailVerificationRequired) {
    // Generate email verification token
    const verificationToken = newUser.createEmailVerificationToken();
    await newUser.save({ validateBeforeSave: false });

    // TODO: Send verification email
    message = 'User registered successfully! Please check your email to verify your account.';

    logger.info('User registered with email verification required', {
      userId: newUser._id,
      email: newUser.email,
      role: newUser.role,
      emailVerificationRequired: true
    });
  } else {
    // Email verification not required, mark as verified
    newUser.emailVerified = true;
    newUser.emailVerifiedAt = new Date();
    await newUser.save({ validateBeforeSave: false });

    message = 'User registered successfully! Account is ready to use.';

    logger.info('User registered without email verification', {
      userId: newUser._id,
      email: newUser.email,
      role: newUser.role,
      emailVerificationRequired: false
    });
  }

  // Remove password from output
  newUser.password = undefined;

  // Send response with token
  createAndSendToken(newUser, 201, res, message);
});

// Phone-verified registration (RECOMMENDED METHOD)
const signupWithPhoneVerification = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { phoneNumber, verificationCode, userType: requestUserType } = req.body;

  logger.info(`📱 Phone-verified registration attempt for: ${phoneNumber}`);

  // Verify phone number first
  const verificationResult = await phoneVerificationService.verifyCode(phoneNumber, verificationCode);
  
  if (!verificationResult.success) {
    logger.warn(`❌ Phone verification failed for registration: ${phoneNumber}`);
    return next(new AppError(verificationResult.message, 400));
  }

  // Get registration data from verification record
  const registrationData = verificationResult.registrationData;
  if (!registrationData) {
    logger.error(`❌ No registration data found for verified phone: ${phoneNumber}`);
    return next(new AppError('Registration data not found. Please start registration again.', 400));
  }

  const { firstName, lastName, email, password, userType = 'client' } = registrationData;

  // Use userType from request body if provided, otherwise fall back to registration data
  const finalUserType = requestUserType || userType || 'client';

  // Check if user already exists with email
  const existingUser = await User.findOne({ 
    $or: [
      { email },
      { phoneNumber: phoneVerificationService.formatPhoneNumber(phoneNumber) }
    ]
  });
  
  if (existingUser) {
    await phoneVerificationService.cleanupVerification(phoneNumber);
    return next(new AppError('User with this email or phone number already exists', 400));
  }

  // For phone-verified registrations, skip email verification
  // Phone verification is considered sufficient for client app users
  const formattedPhoneNumber = formatPhoneNumber(phoneNumber);

  // Create user in User model regardless of type - use role field to differentiate
  // This ensures all users are in the same collection for consistent lookups
  let userFields = {
    firstName,
    lastName,
    email,
    password,
    phoneNumber: formattedPhoneNumber,
    role: finalUserType, // 'client' or 'landlord'
    phoneVerified: true, // Mark as verified since we verified via SMS
    active: true, // Explicitly set to true - this is crucial!
    isEmailVerified: true, // Phone-verified users get email verified automatically
    emailVerified: true, // Mark as verified
    emailVerifiedAt: new Date(), // Set verification timestamp
  };

  // Add type-specific defaults
  if (finalUserType === 'landlord') {
    // Landlord-specific defaults - note: these should be moved to separate landlord profile collection
    userFields.isVerifiedLandlord = false;
    userFields.totalEarnings = 0;
    userFields.monthlyEarnings = 0;
    userFields.stats = {
      totalSpaces: 0,
      activeSpaces: 0,
      totalBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
      responseTimeMinutes: 0
    };
  } else {
    // Client-specific defaults
    userFields.vehicleType = 'car';
    userFields.preferredUniversities = [];
  }

  const newUser = await User.create(userFields);

  // No email verification needed for phone-verified registrations
  const message = 'Registration completed successfully! Your phone number has been verified.';

  // Clean up verification record
  await phoneVerificationService.cleanupVerification(phoneNumber);

  logger.info('✅ User registered with phone verification', {
    userId: newUser._id,
    email: newUser.email,
    userType: finalUserType,
    model: 'User', // All users now created in User model
    phoneNumber: newUser.phoneNumber,
    active: newUser.active,
    role: newUser.role,
    isEmailVerified: newUser.isEmailVerified
  });

  // Remove password from output
  newUser.password = undefined;

  createAndSendToken(newUser, 201, res, message);
});

// Login
const login = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { email, password } = req.body;

  logger.debug('🔐 Login attempt initiated', {
    email,
    hasPassword: !!password,
    passwordLength: password ? password.length : 0,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Check if user exists - try User model first, then Admin model
  let user = await User.findOne({ email }).select('+password +active +status +suspensionReason +suspendedAt');

  // If not found in User model, check Admin model
  if (!user) {
    const Admin = require('../models/Admin');
    user = await Admin.findOne({ email }).select('+password +active +status +suspensionReason +suspendedAt');

    if (user) {
      logger.debug('👤 Admin user found', {
        userId: user._id,
        email: user.email,
        adminLevel: user.adminLevel
      });
    }
  }

  if (!user) {
    logger.security('❌ Failed login attempt - user not found', {
      email,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }, req);
    return next(new AppError('Incorrect email or password', 401));
  }

  logger.debug('👤 User found, checking password', {
    userId: user._id,
    email: user.email,
    isActive: user.active,
    hasStoredPassword: !!user.password
  });

  if (!(await user.correctPassword(password, user.password))) {
    logger.security('❌ Failed login attempt - incorrect password', { 
      email,
      userId: user._id,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }, req);
    return next(new AppError('Incorrect email or password', 401));
  }

  // Enhanced user status check
  // For Admin users, only check the 'active' field
  // For regular users, check both 'active' and 'status'
  const isAdmin = user.__t === 'Admin' || user.role === 'admin';
  const isInactive = !user.active || (!isAdmin && user.status && user.status !== 'active');

  if (isInactive) {
    let errorMessage = 'Your account has been deactivated. Please contact support.';
    let statusCode = 401;

    if (user.status === 'suspended') {
      errorMessage = user.suspensionReason
        ? `Your account has been suspended. Reason: ${user.suspensionReason}. Please contact support for more information.`
        : 'Your account has been suspended. Please contact support for more information.';
      statusCode = 403;
    } else if (user.status === 'deactivated') {
      errorMessage = 'Your account has been deactivated. Please contact support to reactivate your account.';
      statusCode = 403;
    }

    logger.security('Login attempt on inactive/suspended account', {
      email,
      userId: user._id,
      status: user.status,
      active: user.active,
      suspensionReason: user.suspensionReason,
      isAdmin
    }, req);

    return next(new AppError(errorMessage, statusCode));
  }

  // Update last login
  await user.updateLastLogin();

  logger.info('✅ User login successful', {
    userId: user._id,
    email: user.email,
    role: user.role,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    lastLogin: user.lastLogin
  });

  // Send token
  createAndSendToken(user, 200, res, 'Login successful');
});

// Logout
const logout = catchAsync(async (req, res, next) => {
  // Clear refresh token cookie
  res.cookie('refreshToken', 'loggedout', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true,
  });

  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully'
  });
});

// Forgot password
const forgotPassword = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { email } = req.body;

  // Get user based on email (clients only)
  const user = await User.findOne({ email, role: 'client' });
  if (!user) {
    return next(new AppError('There is no client account with that email address.', 404));
  }

  // Generate random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });

  try {
    // Send password reset email with HTML template
    await emailService.sendClientPasswordReset(
      user.email,
      resetToken,
      user.firstName || 'User'
    );

    logger.info('Client password reset email sent', {
      userId: user._id,
      email: user.email
    });

    res.status(200).json({
      status: 'success',
      message: 'Password reset link has been sent to your email address!'
    });
  } catch (error) {
    // If email fails, clear the reset token
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });

    logger.error('Failed to send password reset email:', error);
    return next(new AppError('There was an error sending the email. Please try again later.', 500));
  }
});

// Reset password
const resetPassword = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  // Get user based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // If token has not expired and there is a user, set the new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  user.password = req.body.password;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  logger.info('Password reset successful', {
    userId: user._id,
    email: user.email
  });

  // Log the user in, send JWT
  createAndSendToken(user, 200, res, 'Password reset successful');
});

// Verify email
const verifyEmail = catchAsync(async (req, res, next) => {
  // Get user based on token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    emailVerificationToken: hashedToken,
    emailVerificationExpires: { $gt: Date.now() },
  });

  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }

  // Verify the email
  user.isEmailVerified = true;
  user.emailVerificationToken = undefined;
  user.emailVerificationExpires = undefined;
  await user.save({ validateBeforeSave: false });

  logger.info('Email verified', {
    userId: user._id,
    email: user.email
  });

  res.status(200).json({
    status: 'success',
    message: 'Email verified successfully!'
  });
});

// Resend verification email
const resendVerificationEmail = catchAsync(async (req, res, next) => {
  const { email } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return next(new AppError('No user found with that email address', 404));
  }

  if (user.isEmailVerified) {
    return next(new AppError('Email is already verified', 400));
  }

  // Generate new verification token
  const verificationToken = user.createEmailVerificationToken();
  await user.save({ validateBeforeSave: false });

  // TODO: Send verification email
  logger.info('Verification email resent', {
    userId: user._id,
    email: user.email
  });

  res.status(200).json({
    status: 'success',
    message: 'Verification email sent!'
  });
});

// Change password
const changePassword = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { currentPassword, newPassword } = req.body;

  // Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  // Check if current password is correct
  if (!(await user.correctPassword(currentPassword, user.password))) {
    return next(new AppError('Your current password is incorrect.', 401));
  }

  // Update password
  user.password = newPassword;
  await user.save();

  logger.info('Password changed', {
    userId: user._id,
    email: user.email
  });

  // Log user in with new password
  createAndSendToken(user, 200, res, 'Password changed successfully');
});

// Get current user (works with legacy User model)
const getMe = catchAsync(async (req, res, next) => {
  // req.user is injected by authenticateToken
  let user = req.user;

  if (!user) {
    // Fallback to legacy query if middleware was bypassed
    user = await User.findById(req.user?.id);
  }

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Get wallet balance and update user's walletBalance field
  const { Wallet } = require('../models/Wallet');
  try {
    const wallet = await Wallet.findByUserId(user._id);
    const walletBalance = wallet ? wallet.balance : 0.0;
    
    // Update user's walletBalance field if it's different
    if (user.walletBalance !== walletBalance) {
      await User.findByIdAndUpdate(user._id, { walletBalance });
      user.walletBalance = walletBalance;
    }
  } catch (error) {
    logger.warn('Failed to get wallet balance for user', {
      userId: user._id,
      error: error.message
    });
  }

  // Normalize output and include role for backward compatibility
  const plain = user.toObject ? user.toObject() : user;
  if (!plain.role && plain.userType) {
    plain.role = String(plain.userType).toLowerCase();
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: plain
    }
  });
});

// Update current user
const updateMe = catchAsync(async (req, res, next) => {
  // Check if user is trying to update password
  if (req.body.password || req.body.passwordConfirm) {
    return next(new AppError('This route is not for password updates. Please use /change-password.', 400));
  }

  // Allowed fields to update
  const allowedFields = [
    'firstName', 
    'lastName', 
    'phoneNumber', 
    'address', 
    'preferredUniversities', 
    'vehicleType',
    'notificationPreferences'
  ];

  const filteredBody = {};
  Object.keys(req.body).forEach(el => {
    if (allowedFields.includes(el)) {
      filteredBody[el] = req.body[el];
    }
  });

  // Update user document
  const updatedUser = await User.findByIdAndUpdate(
    req.user.id,
    filteredBody,
    {
      new: true,
      runValidators: true
    }
  );

  logger.info('User profile updated', {
    userId: updatedUser._id,
    updatedFields: Object.keys(filteredBody)
  });

  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser
    }
  });
});

// Delete current user (deactivate)
const deleteMe = catchAsync(async (req, res, next) => {
  await User.findByIdAndUpdate(req.user.id, { active: false });

  logger.info('User account deactivated', {
    userId: req.user.id,
    email: req.user.email
  });

  res.status(204).json({
    status: 'success',
    data: null
  });
});

// Middleware to protect routes (used in auth routes)
const protect = catchAsync(async (req, res, next) => {
  // This is a basic implementation
  // The actual protection is handled by authenticateToken middleware
  if (!req.user) {
    return next(new AppError('You are not logged in! Please log in to get access.', 401));
  }
  next();
});

// Test account login (for development/demo)
const testAccountLogin = catchAsync(async (req, res, next) => {
  const testEmail = 'test@parktayo.com';
  
  // Find or create test account
  let testUser = await User.findOne({ email: testEmail });
  
  if (!testUser) {
    testUser = await User.create({
      firstName: 'Test',
      lastName: 'User',
      email: testEmail,
      password: 'test123456',
      role: 'client',
      isEmailVerified: true
    });
  }

  logger.info('Test account login', {
    userId: testUser._id,
    email: testUser.email
  });

  createAndSendToken(testUser, 200, res, 'Test account login successful');
});

// Add FCM token for push notifications
const addFCMToken = catchAsync(async (req, res, next) => {
  // Debug logging for FCM token data
  logger.info('FCM token request received', {
    body: req.body,
    userId: req.user?.id,
    headers: {
      'content-type': req.headers['content-type'],
      'user-agent': req.headers['user-agent']
    }
  });

  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.error('FCM token validation errors', {
      errors: errors.array(),
      body: req.body,
      userId: req.user?.id
    });
    return next(createValidationError(errors));
  }

  const { fcmToken, deviceId, platform, appVersion } = req.body;
  const userId = req.user.id;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  await user.addOrUpdateFCMToken(fcmToken, deviceId, platform, appVersion);

  logger.info('FCM token added/updated', {
    userId: user._id,
    deviceId,
    platform
  });

  res.status(200).json({
    status: 'success',
    message: 'FCM token added successfully',
    data: {
      deviceId,
      platform,
      isActive: true
    }
  });
});

// Remove FCM token
const removeFCMToken = catchAsync(async (req, res, next) => {
  const { deviceId } = req.params;
  const userId = req.user.id;

  const user = await User.findById(userId);
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  await user.removeFCMToken(deviceId);

  logger.info('FCM token removed', {
    userId: user._id,
    deviceId
  });

  res.status(200).json({
    status: 'success',
    message: 'FCM token removed successfully'
  });
});

// Role-specific login for landlord app
const landlordLogin = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { email, password } = req.body;

  // Check if user exists and get password field plus status fields
  const user = await User.findOne({ email }).select('+password +active +status +suspensionReason +suspendedAt');

  if (!user || !(await user.correctPassword(password, user.password))) {
    logger.security('Failed landlord login attempt', { email }, req);
    return next(new AppError('Incorrect email or password', 401));
  }

  // Check if user is a landlord
  if (user.role !== 'landlord') {
    logger.security('Non-landlord attempted landlord login', {
      email,
      userRole: user.role
    }, req);
    return next(new AppError('Access denied. This app is for landlords only.', 403));
  }

  // Enhanced user status check for landlords
  if (!user.active || user.status !== 'active') {
    let errorMessage = 'Your account has been deactivated. Please contact support.';
    let statusCode = 401;

    if (user.status === 'suspended') {
      errorMessage = user.suspensionReason
        ? `Your account has been suspended. Reason: ${user.suspensionReason}. Please contact support for more information.`
        : 'Your account has been suspended. Please contact support for more information.';
      statusCode = 403;
    } else if (user.status === 'deactivated') {
      errorMessage = 'Your landlord account has been deactivated. Please contact support to reactivate your account.';
      statusCode = 403;
    }

    logger.security('Login attempt on inactive/suspended landlord account', {
      email,
      userId: user._id,
      status: user.status,
      active: user.active,
      suspensionReason: user.suspensionReason
    }, req);

    return next(new AppError(errorMessage, statusCode));
  }

  // Update last login
  await user.updateLastLogin();

  logger.info('Landlord login successful', {
    userId: user._id,
    email: user.email,
    active: user.active,
    isVerifiedLandlord: user.isVerifiedLandlord
  });

  // Send token with user status
  createAndSendToken(user, 200, res, 'Login successful');
});

// Role-specific registration for landlord app
const landlordRegister = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.error('Landlord registration validation failed', {
      errors: errors.array(),
      requestBody: req.body
    });
    return next(createValidationError(errors));
  }

  const { firstName, lastName, email, password, phoneNumber } = req.body;

  logger.info('Landlord registration attempt', {
    email,
    firstName,
    lastName,
    hasPhoneNumber: !!phoneNumber
  });

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('User with this email already exists', 400));
  }

  // Check if email verification is required
  const emailVerificationRequired = await getEmailVerificationSetting();

  // Format phone number before creating user
  const formattedPhoneNumber = formatPhoneNumber(phoneNumber);

  // Create new landlord user using Landlord model
  const newUser = await Landlord.create({
    firstName,
    lastName,
    email,
    password,
    phoneNumber: formattedPhoneNumber,
    userType: 'Landlord', // Set discriminator
    active: false, // Landlords are inactive until admin approval
    isEmailVerified: !emailVerificationRequired, // Set based on system setting
    // Landlord-specific defaults
    isVerifiedLandlord: false,
    totalEarnings: 0,
    monthlyEarnings: 0,
    stats: {
      totalSpaces: 0,
      activeSpaces: 0,
      totalBookings: 0,
      completedBookings: 0,
      cancelledBookings: 0,
      responseTimeMinutes: 0
    }
  });

  // Handle email verification if required
  let message = 'Landlord registered successfully!';
  if (emailVerificationRequired) {
    const verificationToken = newUser.createEmailVerificationToken();
    await newUser.save({ validateBeforeSave: false });

    try {
      await emailService.sendEmailVerification(newUser.email, verificationToken);
      message += ' Please verify your email to complete the registration process.';
    } catch (error) {
      logger.error('Failed to send email verification:', error);
      message += ' However, there was an issue sending the verification email. You can request a new one from the app.';
    }
  } else {
    newUser.emailVerified = true;
    newUser.emailVerifiedAt = new Date();
    await newUser.save({ validateBeforeSave: false });
    message += ' Your account is ready to use once approved by an admin.';
  }

  logger.info('Landlord registered successfully', {
    userId: newUser._id,
    email: newUser.email,
    emailVerificationRequired,
    isEmailVerified: newUser.isEmailVerified
  });

  // Remove password from output
  newUser.password = undefined;

  // Create response without sending token - they need admin approval first
  res.status(201).json({
    status: 'success',
    message,
    data: {
      user: {
        id: newUser._id,
        firstName: newUser.firstName,
        lastName: newUser.lastName,
        email: newUser.email,
        role: newUser.role,
        isEmailVerified: newUser.isEmailVerified
      }
    }
  });
});

// Role-specific login for client app
const clientLogin = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { email, password } = req.body;

  // Check if user exists and get password field plus status fields
  const user = await User.findOne({ email }).select('+password +active +status +suspensionReason +suspendedAt');

  if (!user || !(await user.correctPassword(password, user.password))) {
    logger.security('Failed client login attempt', { email }, req);
    return next(new AppError('Incorrect email or password', 401));
  }

  // Check if user is a client
  if (user.role !== 'client') {
    logger.security('Non-client attempted client login', {
      email,
      userRole: user.role
    }, req);
    return next(new AppError('Access denied. This app is for clients only.', 403));
  }

  // Enhanced user status check for clients
  if (!user.active || user.status !== 'active') {
    let errorMessage = 'Your account has been deactivated. Please contact support.';
    let statusCode = 401;

    if (user.status === 'suspended') {
      errorMessage = user.suspensionReason
        ? `Your account has been suspended. Reason: ${user.suspensionReason}. Please contact support for more information.`
        : 'Your account has been suspended. Please contact support for more information.';
      statusCode = 403;
    } else if (user.status === 'deactivated') {
      errorMessage = 'Your account has been deactivated. Please contact support to reactivate your account.';
      statusCode = 403;
    }

    logger.security('Login attempt on inactive/suspended client account', {
      email,
      userId: user._id,
      status: user.status,
      active: user.active,
      suspensionReason: user.suspensionReason
    }, req);

    return next(new AppError(errorMessage, statusCode));
  }

  // Update last login
  await user.updateLastLogin();

  logger.info('Client login successful', {
    userId: user._id,
    email: user.email
  });

  // Send token
  createAndSendToken(user, 200, res, 'Login successful');
});

// Role-specific registration for client app
const clientRegister = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const { firstName, lastName, email, password, phoneNumber } = req.body;

  // Check if user already exists
  const existingUser = await User.findOne({ email });
  if (existingUser) {
    return next(new AppError('User with this email already exists', 400));
  }

  // Check if email verification is required
  const emailVerificationRequired = await getEmailVerificationSetting();

  // Format phone number before creating user
  const formattedPhoneNumber = formatPhoneNumber(phoneNumber);

  // Create new client user
  const newUser = await User.create({
    firstName,
    lastName,
    email,
    password,
    phoneNumber: formattedPhoneNumber,
    userType: 'Client', // Set discriminator
    active: true, // Explicitly set active
    isEmailVerified: !emailVerificationRequired, // Set based on system setting
    // Client-specific defaults
    vehicleType: 'car',
    preferredUniversities: [],
    totalBookings: 0,
    totalAmountSpent: 0
  });

  // Handle email verification if required
  let message = 'Client registered successfully!';
  if (emailVerificationRequired) {
    const verificationToken = newUser.createEmailVerificationToken();
    await newUser.save({ validateBeforeSave: false });

    try {
      await emailService.sendEmailVerification(newUser.email, verificationToken);
      message += ' Please check your email to verify your account.';
    } catch (error) {
      logger.error('Failed to send email verification:', error);
      message += ' However, there was an issue sending the verification email. You can request a new one from the app.';
    }
  } else {
    newUser.emailVerified = true;
    newUser.emailVerifiedAt = new Date();
    await newUser.save({ validateBeforeSave: false });
    message += ' Your account is ready to use.';
  }

  logger.info('Client registered', {
    userId: newUser._id,
    email: newUser.email,
    emailVerificationRequired,
    isEmailVerified: newUser.isEmailVerified
  });

  // Remove password from output
  newUser.password = undefined;

  // Send response with token
  createAndSendToken(newUser, 201, res, message);
});

module.exports = {
  signup,
  signupWithPhoneVerification,
  login,
  logout,
  forgotPassword,
  resetPassword,
  verifyEmail,
  resendVerificationEmail,
  changePassword,
  getMe,
  updateMe,
  deleteMe,
  protect,
  testAccountLogin,
  addFCMToken,
  removeFCMToken,
  landlordLogin,
  landlordRegister,
  clientLogin,
  clientRegister
}; 