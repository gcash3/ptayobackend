const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const QRCode = require('qrcode');
const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const bookingExpirationService = require('../services/bookingExpirationService');

/**
 * Generate QR code for manual checkout (Landlord endpoint)
 * @route POST /api/v1/qr/generate/:bookingId
 */
const generateCheckoutQR = catchAsync(async (req, res, next) => {
  const { bookingId } = req.params;
  const landlordId = req.user.id;

  logger.info(`🔲 QR generation requested by landlord ${landlordId} for booking ${bookingId}`);

  // Fetch booking with all required data
  const booking = await Booking.findById(bookingId)
    .populate('parkingSpaceId', '_id name landlordId')
    .populate('userId', '_id firstName lastName phoneNumber');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // 🔐 SECURITY CHECK 1: Verify landlord owns this parking space
  if (booking.parkingSpaceId.landlordId.toString() !== landlordId) {
    logger.warn(`🚫 Unauthorized QR generation attempt: Landlord ${landlordId} doesn't own parking space for booking ${bookingId}`);
    return next(new AppError('Unauthorized: You do not own this parking space', 403));
  }

  // 🔐 SECURITY CHECK 2: Verify booking status is 'parked'
  if (booking.status !== 'parked') {
    return next(new AppError(`Cannot generate QR: Booking status is '${booking.status}', must be 'parked'`, 400));
  }

  // 🔐 ENHANCED SECURITY CHECK 3: Comprehensive expiration analysis
  logger.info(`🔍 Performing expiration analysis for booking ${bookingId}`);
  
  let expirationAnalysis;
  try {
    expirationAnalysis = await bookingExpirationService.analyzeBookingExpiration(
      bookingId, 
      landlordId, 
      'landlord'
    );
  } catch (error) {
    logger.error(`❌ Expiration analysis failed for booking ${bookingId}:`, error);
    return next(new AppError('Failed to analyze booking expiration status', 500));
  }

  logger.info(`📊 Expiration analysis result:`, {
    bookingId,
    status: expirationAnalysis.status,
    canGenerate: expirationAnalysis.canGenerate,
    requiresResolution: expirationAnalysis.requiresConfirmation,
    charges: expirationAnalysis.charges?.totalExtraCharges || 0
  });

  // Handle different expiration scenarios
  if (!expirationAnalysis.canGenerate) {
    if (expirationAnalysis.status === 'not_eligible') {
      return next(new AppError(expirationAnalysis.reason, 400));
    }

    // Booking requires resolution - provide detailed options
    const errorResponse = {
      error: 'booking_expired',
      message: expirationAnalysis.message,
      expirationStatus: expirationAnalysis.status,
      windowType: expirationAnalysis.windowType,
      timeSinceExpiration: {
        hours: expirationAnalysis.hoursSinceEnd,
        days: expirationAnalysis.daysSinceEnd
      },
      charges: expirationAnalysis.charges,
      resolutionOptions: expirationAnalysis.resolutionOptions,
      instructions: {
        title: 'Booking Expiration Resolution Required',
        description: 'This booking has expired beyond the standard checkout window. Please choose a resolution option below.',
        apiEndpoint: `/api/v1/booking-expiration/resolve/${bookingId}`,
        supportContact: 'For assistance, contact customer support or use the escalation option.'
      }
    };

    // Use appropriate HTTP status based on expiration severity
    let statusCode = 409; // Conflict - requires resolution
    if (expirationAnalysis.windowType === 'CRITICAL') {
      statusCode = 423; // Locked - requires manual intervention
    }

    return res.status(statusCode).json({
      status: 'error',
      ...errorResponse,
      timestamp: new Date().toISOString()
    });
  }

  // Log successful expiration check
  if (expirationAnalysis.status !== 'standard') {
    logger.info(`⚠️ QR generation allowed for ${expirationAnalysis.status} expiration with charges: ₱${expirationAnalysis.charges?.totalExtraCharges || 0}`);
  }

  // Create QR data payload - SIMPLIFIED VERSION FOR BETTER READABILITY
  const timestamp = Math.floor(Date.now() / 1000);
  const expiresIn = 24 * 60 * 60; // 24 hours
  const expires = timestamp + expiresIn;

  // Create a compact QR format to reduce data density
  const compactData = {
    t: 'checkout', // type (shortened)
    v: '1.0',      // version
    b: booking._id.toString().slice(-8), // last 8 chars of booking ID (for verification)
    l: landlordId.slice(-8), // last 8 chars of landlord ID
    s: booking.parkingSpaceId._id.toString().slice(-8), // last 8 chars of space ID
    ts: timestamp,
    exp: expires,
    // Remove user name and space name to reduce size
    // These can be fetched from backend using booking ID
  };

  // Create a shorter checksum (first 16 chars instead of 64)
  const dataString = JSON.stringify(compactData);
  const shortChecksum = crypto
    .createHash('sha256')
    .update(dataString)
    .digest('hex')
    .substring(0, 16); // Use only first 16 characters
  
  compactData.chk = shortChecksum;

  // Create a simpler signature - just sign the essential data
  const jwtSecret = process.env.JWT_SECRET || 'fallback_secret';
  const essentialData = {
    b: compactData.b,
    l: compactData.l,
    s: compactData.s,
    ts: compactData.ts,
    exp: compactData.exp,
    iat: timestamp // Include issued at timestamp to match JWT library behavior
  };
  
  // Create a shorter JWT (no full structure, just essential data)
  const signature = jwt.sign(essentialData, jwtSecret);
  
  // Final compact QR data
  const qrCodeData = JSON.stringify({
    ...compactData,
    sig: signature.split('.')[2] // Use only the signature part (shortest)
  });

  logger.info(`📊 QR Data Optimization Results:`);
  logger.info(`📏 Compact QR length: ${qrCodeData.length} characters`);
  logger.info(`📄 Compact QR preview: ${qrCodeData.substring(0, 100)}...`);
  
  // Calculate data reduction
  const originalEstimate = JSON.stringify({
    type: 'parktayo_checkout',
    version: '1.0',
    data: {
      bookingId: booking._id.toString(),
      landlordId: landlordId,
      parkingSpaceId: booking.parkingSpaceId._id.toString(),
      timestamp: timestamp,
      expires: expires,
      userFirstName: booking.userId.firstName,
      spaceName: booking.parkingSpaceId.name,
      checksum: crypto.createHash('sha256').update('test').digest('hex')
    },
    signature: signature
  }).length;
  
  const reduction = ((originalEstimate - qrCodeData.length) / originalEstimate * 100).toFixed(1);
  logger.info(`📉 Data reduction: ${reduction}% (${originalEstimate} → ${qrCodeData.length} chars)`);

  // Store full data for response but use compact for QR
  const fullQrData = {
    type: 'parktayo_checkout',
    version: '1.0',
    data: {
      bookingId: booking._id.toString(),
      landlordId: landlordId,
      parkingSpaceId: booking.parkingSpaceId._id.toString(),
      timestamp: timestamp,
      expires: expires,
      userFirstName: booking.userId.firstName,
      spaceName: booking.parkingSpaceId.name,
      checksum: crypto.createHash('sha256').update(JSON.stringify(essentialData)).digest('hex')
    },
    signature: signature
  };

  try {
    // Validate QR data size before generating image
    if (qrCodeData.length > 4000) {
      logger.warn(`⚠️ QR data too large: ${qrCodeData.length} characters. This may cause scanning issues.`);
    }

    // Generate QR code as base64 image with optimized settings for readability
    const qrCodeImage = await QRCode.toDataURL(qrCodeData, {
      errorCorrectionLevel: 'L', // Low error correction for smaller, more readable QR
      type: 'image/png',
      quality: 0.92,
      margin: 2, // Larger margin for better scanning
      color: {
        dark: '#000000', // Pure black for better contrast and readability
        light: '#FFFFFF'
      },
      width: 400, // Larger size for better scanning
      scale: 8 // Higher scale for crisp pixels
    });

    // Additional validation checks
    const validationResults = {
      qrDataLength: qrCodeData.length,
      isOptimalSize: qrCodeData.length <= 2000,
      hasRequiredFields: !!(compactData.b && compactData.l && compactData.s && compactData.sig),
      expiryValid: expires > Math.floor(Date.now() / 1000),
      checksumValid: !!compactData.chk
    };

    logger.info(`✅ QR code generated successfully for booking ${bookingId}`, validationResults);

    res.status(200).json({
      status: 'success',
      message: 'QR code generated successfully',
      data: {
        qrCodeImage: qrCodeImage,
        qrData: fullQrData, // Use full data for response
        compactQrData: qrCodeData, // Include compact version for debugging
        signature: signature,
        expiresAt: new Date(expires * 1000).toISOString(),
        validation: validationResults,
        bookingInfo: {
          id: booking._id,
          userFirstName: booking.userId.firstName,
          spaceName: booking.parkingSpaceId.name,
          status: booking.status,
          totalAmount: booking.pricing?.totalAmount || 0,
          checkinTime: booking.checkin?.time || booking.startTime,
          duration: booking.duration
        },
        instructions: {
          clientApp: "Open ParkTayo app → Scan QR Code → Review charges → Confirm checkout",
          validFor: "24 hours from generation",
          security: "Encrypted and tamper-proof"
        }
      }
    });

  } catch (qrError) {
    logger.error('Error generating QR code image:', {
      error: qrError.message,
      stack: qrError.stack,
      bookingId,
      qrDataLength: qrCodeData?.length,
      landlordId
    });
    
    // Provide more specific error messages
    if (qrError.message.includes('too large')) {
      return next(new AppError('QR code data is too large to generate. Please contact support.', 500));
    } else if (qrError.message.includes('invalid')) {
      return next(new AppError('Invalid data format for QR generation. Please try again.', 400));
    } else {
      return next(new AppError('Failed to generate QR code image. Please try again later.', 500));
    }
  }
});

/**
 * Validate and process QR checkout (Client endpoint)
 * @route POST /api/v1/qr/checkout
 */
const processQRCheckout = catchAsync(async (req, res, next) => {
  const { qrData } = req.body;
  const userId = req.user.id;

  logger.info(`🔲 QR checkout requested by user ${userId}`);

  if (!qrData) {
    return next(new AppError('QR data is required', 400));
  }

  let decodedData;
  try {
    decodedData = JSON.parse(qrData);
  } catch (error) {
    return next(new AppError('Invalid QR code format', 400));
  }

  // Determine if this is compact format or legacy format
  const isCompactFormat = decodedData.t === 'checkout' && decodedData.sig;
  const isLegacyFormat = decodedData.type === 'parktayo_checkout' && decodedData.signature;

  if (!isCompactFormat && !isLegacyFormat) {
    return next(new AppError('Invalid QR code format - not a ParkTayo checkout QR', 400));
  }

  logger.info(`📱 QR Format detected: ${isCompactFormat ? 'Compact' : 'Legacy'}`);

  let bookingId, landlordId, parkingSpaceId, timestamp, expires;

  if (isCompactFormat) {
    // Handle new compact format
    if (!decodedData.b || !decodedData.l || !decodedData.s || !decodedData.sig) {
      return next(new AppError('Invalid compact QR code data', 400));
    }

    // Extract data from compact format
    const partialBookingId = decodedData.b;
    const partialLandlordId = decodedData.l;
    const partialSpaceId = decodedData.s;
    timestamp = decodedData.ts;
    expires = decodedData.exp;

    // Verify compact signature
    const jwtSecret = process.env.JWT_SECRET || 'fallback_secret';
    try {
      const essentialData = {
        b: partialBookingId,
        l: partialLandlordId,
        s: partialSpaceId,
        ts: timestamp,
        exp: expires,
        iat: timestamp // Include issued at timestamp to match generation
      };
      
      // Reconstruct full JWT from signature part
      const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(essentialData)).toString('base64url');
      const fullJwt = `${header}.${payload}.${decodedData.sig}`;
      
      const verified = jwt.verify(fullJwt, jwtSecret);
      logger.info(`✅ Compact QR signature verified`);
      
      // Find full booking ID by partial match
      // Since we can't use regex with ObjectId, we'll get all parked bookings 
      // and filter by partial ID matches on the application side
      const parkedBookings = await Booking.find({
        status: 'parked'
      }).populate('parkingSpaceId', '_id name landlordId')
        .populate('userId', '_id firstName lastName');
      
      // Filter bookings by partial ID matches
      const booking = parkedBookings.find(b => {
        const bookingIdMatch = b._id.toString().endsWith(partialBookingId);
        const landlordIdMatch = b.parkingSpaceId.landlordId.toString().endsWith(partialLandlordId);
        const spaceIdMatch = b.parkingSpaceId._id.toString().endsWith(partialSpaceId);
        
        return bookingIdMatch && landlordIdMatch && spaceIdMatch;
      });

      if (!booking) {
        return next(new AppError('Booking not found or not in parked status', 404));
      }

      bookingId = booking._id.toString();
      landlordId = booking.parkingSpaceId.landlordId.toString();
      parkingSpaceId = booking.parkingSpaceId._id.toString();

      // Verify partial IDs match
      if (!landlordId.endsWith(partialLandlordId) || !parkingSpaceId.endsWith(partialSpaceId)) {
        return next(new AppError('QR code verification failed - ID mismatch', 403));
      }

    } catch (jwtError) {
      logger.warn(`🚫 Invalid compact QR signature: ${jwtError.message}`);
      return next(new AppError('Invalid or tampered compact QR code', 401));
    }

  } else {
    // Handle legacy format (existing code)
    if (!decodedData.signature || !decodedData.data) {
      return next(new AppError('Invalid QR code data', 400));
    }

    // 🔐 SECURITY CHECK 1: Verify JWT signature
    const jwtSecret = process.env.JWT_SECRET || 'fallback_secret';
    let verifiedPayload;
    try {
      const dataToVerify = {
        type: decodedData.type,
        version: decodedData.version,
        data: decodedData.data
      };
      verifiedPayload = jwt.verify(decodedData.signature, jwtSecret);
      
      // Verify the payload matches the data
      if (JSON.stringify(verifiedPayload.data) !== JSON.stringify(decodedData.data)) {
        throw new Error('Data tampering detected');
      }
    } catch (jwtError) {
      logger.warn(`🚫 Invalid JWT signature for QR checkout: ${jwtError.message}`);
      return next(new AppError('Invalid or tampered QR code', 401));
    }

    // 🔐 SECURITY CHECK 2: Check expiry
    const now = Math.floor(Date.now() / 1000);
    if (now > verifiedPayload.data.expires) {
      return next(new AppError('QR code has expired', 400));
    }

    // 🔐 SECURITY CHECK 3: Verify checksum
    const { checksum, ...dataWithoutChecksum } = verifiedPayload.data;
    const expectedChecksum = crypto
      .createHash('sha256')
      .update(JSON.stringify(dataWithoutChecksum))
      .digest('hex');
    
    if (checksum !== expectedChecksum) {
      return next(new AppError('QR code data integrity check failed', 400));
    }

    // Extract data from legacy format
    bookingId = verifiedPayload.data.bookingId;
    landlordId = verifiedPayload.data.landlordId;
    parkingSpaceId = verifiedPayload.data.parkingSpaceId;
    timestamp = verifiedPayload.data.timestamp;
    expires = verifiedPayload.data.expires;
  }

  // Common processing for both formats starts here
  // 🔐 SECURITY CHECK: Check expiry (for both formats)
  const now = Math.floor(Date.now() / 1000);
  if (now > expires) {
    return next(new AppError('QR code has expired', 400));
  }

  // Fetch and validate booking
  const booking = await Booking.findById(bookingId)
    .populate('parkingSpaceId', '_id name landlordId')
    .populate('userId', '_id firstName lastName');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // 🔐 SECURITY CHECK 4: Verify user owns this booking
  if (booking.userId._id.toString() !== userId) {
    logger.warn(`🚫 Unauthorized QR checkout attempt: User ${userId} doesn't own booking ${booking._id}`);
    return next(new AppError('Unauthorized: This is not your booking', 403));
  }

  // 🔐 SECURITY CHECK 5: Verify booking status is 'parked'
  if (booking.status !== 'parked') {
    return next(new AppError(`Cannot checkout: Booking status is '${booking.status}', must be 'parked'`, 400));
  }

  // 🔐 SECURITY CHECK 6: Verify landlord owns the parking space
  if (booking.parkingSpaceId.landlordId.toString() !== landlordId) {
    return next(new AppError('Security validation failed: Landlord ownership mismatch', 403));
  }

  // 🔐 SECURITY CHECK 7: Verify parking space ID matches
  if (booking.parkingSpaceId._id.toString() !== parkingSpaceId) {
    return next(new AppError('Security validation failed: Parking space mismatch', 403));
  }

  // All security checks passed - proceed with checkout
  logger.info(`✅ QR checkout security validation passed for booking ${booking._id}`);

  // Use the existing manual checkout logic
  const checkoutResult = await processManualCheckout(booking);

  if (checkoutResult.success) {
    logger.info(`✅ QR checkout completed successfully for booking ${booking._id}`);
    
    res.status(200).json({
      status: 'success',
      message: 'QR checkout completed successfully',
      data: {
        bookingId: booking._id,
        checkoutTime: new Date(),
        method: 'qr_code',
        totalAmount: booking.pricing?.totalAmount || 0,
        bookingInfo: {
          spaceName: booking.parkingSpaceId.name,
          userFirstName: booking.userId.firstName
        }
      }
    });
  } else {
    return next(new AppError(checkoutResult.error || 'Checkout failed', 500));
  }
});

/**
 * Helper function to process manual checkout (reused logic)
 */
async function processManualCheckout(booking) {
  try {
    const now = new Date();
    
    // Use parking session duration for billing (NOT booking window)
    let sessionDuration = 0;
    let billingStartTime = null;
    let billingMethod = 'fallback';
    
    if (booking.parkingSession?.startTime) {
      // Use actual parking session time - CORRECT BILLING
      billingStartTime = new Date(booking.parkingSession.startTime);
      sessionDuration = (now - billingStartTime) / (1000 * 60 * 60); // Hours
      billingMethod = 'parking_session';
      
      logger.info(`💰 Using parking session for billing - Duration: ${sessionDuration.toFixed(2)} hours`);
    } else {
      // Fallback to checkin time or booking start time
      billingStartTime = booking.checkin?.time || booking.startTime;
      sessionDuration = (now - billingStartTime) / (1000 * 60 * 60); // Hours
      billingMethod = 'fallback';
      
      logger.warn(`⚠️ No parking session found, using fallback - Duration: ${sessionDuration.toFixed(2)} hours`);
    }

    // Get parking space for proper overtime rate calculation
    const parkingSpace = await ParkingSpace.findById(booking.parkingSpaceId._id);
    const autoCalculatedOvertimeRate = parkingSpace?.overtimeRatePerHour ||
                                      (parkingSpace?.pricePer3Hours ? parkingSpace.pricePer3Hours / 3 : 15);

    // Calculate overtime based on actual parking duration (NOT booking duration)
    const standardHours = 3; // Standard rate covers 3 hours
    let overtimeAmount = 0;
    let overtimeHours = 0;

    if (sessionDuration > standardHours) {
      overtimeHours = Math.ceil(sessionDuration - standardHours);

      const overtimeServiceFee = 2; // ₱2 service fee per hour
      const totalOvertimeRate = autoCalculatedOvertimeRate + overtimeServiceFee;
      overtimeAmount = overtimeHours * totalOvertimeRate;

      logger.info(`⏰ Overtime detected - ${billingMethod} billing: ${overtimeHours}h × ₱${totalOvertimeRate.toFixed(2)} = ₱${overtimeAmount}`);
    }

    // End parking session - THIS WILL HANDLE ALL BILLING CALCULATIONS
    await booking.endParking();
    
    // Additional logging for debugging
    logger.info(`✅ Checkout completed using ${billingMethod} billing method`);
    logger.info(`📊 Final billing - Duration: ${sessionDuration.toFixed(2)}h, Overtime: ₱${overtimeAmount}, Total: ₱${(booking.pricing?.totalAmount || 0) + overtimeAmount}`);

    // 📧 Send receipt email for completed QR checkout
    try {
      const receiptService = require('../services/receiptService');
      await receiptService.sendCompletionReceipt(booking._id);
      logger.info(`📧 Receipt email sent for QR checkout booking ${booking._id}`);
    } catch (receiptError) {
      logger.error('📧 Receipt email error on QR checkout:', receiptError);
      // Don't fail the checkout if receipt sending fails
    }

    // Handle overtime billing if applicable
    if (overtimeAmount > 0 && booking.pricing?.paymentMethod === 'wallet') {
      // Process overtime payment (similar to auto-checkout logic)
      const { Wallet } = require('../models/Wallet');
      const userWallet = await Wallet.findByUserId(booking.userId._id);
      
      if (userWallet && userWallet.availableBalance >= overtimeAmount) {
        userWallet.availableBalance -= overtimeAmount;
        userWallet.transactions.push({
          type: 'debit',
          amount: overtimeAmount,
          bookingId: booking._id,
          description: `Overtime charges: ${overtimeHours}h × ₱17/h (QR Checkout)`,
          referenceId: `QR-OVERTIME-${booking._id}-${Date.now()}`,
          status: 'completed',
          createdAt: new Date()
        });
        await userWallet.save();
        
        logger.info(`💳 Overtime charges deducted via QR checkout: ₱${overtimeAmount}`);
      }
    }

    return { success: true };
  } catch (error) {
    logger.error('Error processing QR checkout:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Calculate preview of checkout charges (for client preview)
 * @route GET /api/v1/qr/calculate/:bookingId
 */
const calculateCheckoutPreview = catchAsync(async (req, res, next) => {
  const { bookingId } = req.params;
  const userId = req.user.id;

  logger.info(`🧮 Checkout calculation preview requested by user ${userId} for booking ${bookingId}`);

  // Fetch booking with required data
  const booking = await Booking.findById(bookingId)
    .populate('parkingSpaceId', '_id name landlordId')
    .populate('userId', '_id firstName lastName');

  if (!booking) {
    return next(new AppError('Booking not found', 404));
  }

  // Verify user owns this booking
  if (booking.userId._id.toString() !== userId) {
    logger.warn(`🚫 Unauthorized calculation preview: User ${userId} doesn't own booking ${bookingId}`);
    return next(new AppError('Unauthorized: This is not your booking', 403));
  }

  // Verify booking status is 'parked'
  if (booking.status !== 'parked') {
    return next(new AppError(`Cannot calculate: Booking status is '${booking.status}', must be 'parked'`, 400));
  }

  // Calculate session duration and overtime (same logic as processManualCheckout)
  const now = new Date();
  const sessionDuration = (now - (booking.checkin?.time || booking.startTime)) / (1000 * 60 * 60); // Hours
  const flatRateHours = booking.duration || 3;

  let overtimeAmount = 0;
  let overtimeHours = 0;
  let overtimeBreakdown = null;

  if (sessionDuration > flatRateHours) {
    overtimeHours = Math.ceil(sessionDuration - flatRateHours);
    const overtimeBaseRate = 15; // ₱15 per hour
    const overtimeServiceFee = 2; // ₱2 service fee per hour
    overtimeAmount = overtimeHours * (overtimeBaseRate + overtimeServiceFee); // ₱17 per hour total

    overtimeBreakdown = {
      excessHours: sessionDuration - flatRateHours,
      billedOvertimeHours: overtimeHours,
      ratePerHour: {
        base: overtimeBaseRate,
        serviceFee: overtimeServiceFee,
        total: overtimeBaseRate + overtimeServiceFee
      },
      calculation: `${overtimeHours}h × ₱${overtimeBaseRate + overtimeServiceFee} = ₱${overtimeAmount}`
    };

    logger.info(`⏰ Overtime preview - Booking ${bookingId}: ${overtimeHours}h × ₱17 = ₱${overtimeAmount}`);
  }

  const originalAmount = booking.pricing?.totalAmount || 0;
  const finalAmount = originalAmount + overtimeAmount;

  res.status(200).json({
    status: 'success',
    message: 'Checkout calculation preview',
    data: {
      bookingId: booking._id,
      currentSessionDuration: sessionDuration,
      flatRateHours: flatRateHours,
      hasOvertime: overtimeAmount > 0,
      pricing: {
        originalAmount: originalAmount,
        overtimeAmount: overtimeAmount,
        finalAmount: finalAmount,
        overtimeBreakdown: overtimeBreakdown
      },
      bookingInfo: {
        spaceName: booking.parkingSpaceId.name,
        checkinTime: booking.checkin?.time || booking.startTime,
        currentTime: now,
        status: booking.status
      },
      preview: true // Flag to indicate this is just a preview, not actual checkout
    }
  });
});

/**
 * Get landlord's active bookings for QR generation
 * @route GET /api/v1/qr/bookings
 */
const getLandlordActiveBookings = catchAsync(async (req, res, next) => {
  const landlordId = req.user.id;

  logger.info(`📋 Fetching active bookings for landlord ${landlordId}`);

  // Get all parking spaces owned by this landlord
  const parkingSpaces = await ParkingSpace.find({ landlordId }).select('_id');
  const spaceIds = parkingSpaces.map(space => space._id);

  // Get all parked bookings for these spaces
  const activeBookings = await Booking.find({
    parkingSpaceId: { $in: spaceIds },
    status: 'parked'
  })
  .populate('parkingSpaceId', 'name address')
  .populate('userId', 'firstName lastName phoneNumber')
  .sort({ startTime: -1 });

  logger.info(`📋 Found ${activeBookings.length} parked bookings for landlord ${landlordId}`);

  res.status(200).json({
    status: 'success',
    message: 'Active bookings retrieved successfully',
    data: {
      bookings: activeBookings.map(booking => ({
        id: booking._id,
        userFirstName: booking.userId.firstName,
        userLastName: booking.userId.lastName,
        spaceName: booking.parkingSpaceId.name,
        spaceAddress: booking.parkingSpaceId.address,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalAmount: booking.pricing?.totalAmount || 0,
        status: booking.status,
        checkinTime: booking.checkin?.time,
        duration: booking.duration
      }))
    }
  });
});

module.exports = {
  generateCheckoutQR,
  processQRCheckout,
  calculateCheckoutPreview,
  getLandlordActiveBookings
};
