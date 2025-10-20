const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User');
const Vehicle = require('../models/Vehicle');
const { validationResult } = require('express-validator');
const { sendNotification } = require('../services/firebaseNotificationService');
const smartArrivalService = require('../services/smartArrivalService');
const realTimeTrackingService = require('../services/realTimeTrackingService');
const abTestingService = require('../services/abTestingService');
const logger = require('../config/logger');
const { Wallet } = require('../models/Wallet');
const smsService = require('../services/smsService');
const dynamicPricingService = require('../services/newDynamicPricingService');
const smartBookingService = require('../services/smartBookingService');
const receiptService = require('../services/receiptService');
const noShowSchedulerService = require('../services/noShowSchedulerService');

const { v4: uuidv4 } = require('uuid');

/**
 * Analyze smart booking feasibility
 * @route POST /api/v1/bookings/analyze-smart
 */
const analyzeSmartBooking = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      parkingSpaceId,
      userCurrentLocation, // { latitude, longitude }
      vehicleId
    } = req.body;

    const userId = req.user.id;

    logger.info(`🧠 Smart booking analysis request from user ${userId}`);

    // Check A/B testing - determine if user should see smart booking
    const smartVsTraditionalVariant = abTestingService.getUserVariant(userId, 'smart_vs_traditional');
    const confidenceThresholdVariant = abTestingService.getUserVariant(userId, 'confidence_threshold');
    
    // Track A/B test event
    abTestingService.trackBookingEvent(userId, 'booking_started', { type: 'smart_analysis' });

    // If user is in control group (traditional only), don't allow smart booking
    if (smartVsTraditionalVariant && smartVsTraditionalVariant.id === 'control') {
      return res.status(400).json({
        status: 'error',
        message: 'Smart booking not available',
        data: {
          reason: 'user_in_control_group',
          suggestedAction: 'Use reservation mode'
        }
      });
    }

    // Validate parking space exists
    const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
    if (!parkingSpace) {
      return res.status(404).json({
        status: 'error',
        message: 'Parking space not found'
      });
    }

    // Check if parking space is active
    if (parkingSpace.status !== 'active') {
      return res.status(400).json({
        status: 'error',
        message: 'Parking space is not available for booking'
      });
    }

    // Validate vehicle
    const vehicle = await Vehicle.findOne({ _id: vehicleId, userId });
    if (!vehicle || vehicle.status !== 'active') {
      return res.status(400).json({
        status: 'error',
        message: 'Valid active vehicle required for smart booking'
      });
    }

    // Check vehicle compatibility (with fallback for missing vehicleTypes)
    const acceptedVehicleTypes = parkingSpace.vehicleTypes && parkingSpace.vehicleTypes.length > 0
      ? parkingSpace.vehicleTypes
      : ['motorcycle', 'car']; // Default fallback

    if (!acceptedVehicleTypes.includes(vehicle.vehicleType)) {
      return res.status(400).json({
        status: 'error',
        message: `This parking space does not accept ${vehicle.vehicleType}s`
      });
    }

    // Validate operating hours - check if space is open now
    const currentTime = new Date();
    const operatingStatus = parkingSpace.getOperatingStatus(currentTime);
    if (!operatingStatus.isOpen) {
      logger.warn(`🕐 Booking analysis rejected - parking space closed: ${operatingStatus.message}`);
      return res.status(400).json({
        status: 'error',
        message: `Parking space is currently closed: ${operatingStatus.message}`,
        operatingStatus: operatingStatus
      });
    }

    logger.info(`✅ Operating hours validated for analysis: ${operatingStatus.message}`);

    // Run smart booking analysis
    const analysis = await smartArrivalService.analyzeSmartBooking({
      userId,
      origin: userCurrentLocation,
      destination: {
        latitude: parkingSpace.location.coordinates[1], // MongoDB GeoJSON format
        longitude: parkingSpace.location.coordinates[0]
      },
      parkingSpaceId
    });

    if (!analysis.success) {
      // Track A/B test failure
      abTestingService.trackBookingEvent(userId, 'smart_booking_rejected', { 
        reason: 'analysis_failed',
        error: analysis.error 
      });
      
      return res.status(500).json({
        status: 'error',
        message: 'Failed to analyze smart booking',
        error: analysis.error
      });
    }

    // Apply A/B testing for confidence threshold
    let confidenceThreshold = 70; // Default threshold
    if (confidenceThresholdVariant) {
      confidenceThreshold = confidenceThresholdVariant.config.confidenceThreshold;
    }

    // Override analysis result based on A/B test threshold
    const originalCanBookNow = analysis.canBookNow;
    analysis.canBookNow = analysis.confidenceScore.overall >= confidenceThreshold;

    // Track A/B testing events
    if (originalCanBookNow && !analysis.canBookNow) {
      abTestingService.trackBookingEvent(userId, 'smart_booking_rejected', {
        reason: 'confidence_threshold',
        originalConfidence: analysis.confidenceScore.overall,
        threshold: confidenceThreshold
      });
    } else if (analysis.canBookNow) {
      abTestingService.trackBookingEvent(userId, 'smart_booking_allowed', {
        confidence: analysis.confidenceScore.overall,
        threshold: confidenceThreshold
      });
    }

    // Enhance response with parking space info
    const response = {
      status: 'success',
      message: 'Smart booking analysis completed',
      data: {
        ...analysis,
        parkingSpace: {
          id: parkingSpace._id,
          name: parkingSpace.name,
          address: parkingSpace.address,
          pricing: parkingSpace.pricing,
          amenities: parkingSpace.amenities
        },
        vehicle: {
          id: vehicle._id,
          type: vehicle.vehicleType,
          plateNumber: vehicle.plateNumber
        }
      }
    };

    logger.info(`✅ Smart booking analysis completed: ${analysis.canBookNow ? 'VIABLE' : 'NOT VIABLE'}`);
    res.status(200).json(response);

  } catch (error) {
    logger.error('Smart booking analysis error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Create a new booking request (Enhanced for smart booking)
 */
const createBooking = async (req, res) => {
  try {
    console.log('🔍 DEBUG: Received booking request body:', JSON.stringify(req.body, null, 2));
    
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        status: 'error',
        message: 'Validation failed',
        errors: errors.array()
      });
    }

    const {
      parkingSpaceId,
      startTime,
      endTime,
      vehicleId,
      userNotes,
      bookingMode = 'reservation', // 'reservation' or 'book_now'
      userCurrentLocation, // Required for 'book_now' mode
      arrivalPrediction // From smart booking analysis
    } = req.body;

    const userId = req.user.id;

    // Fetch the user for SMS notifications
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // Check if vehicle exists and belongs to user
    const vehicle = await Vehicle.findOne({ _id: vehicleId, userId });
    if (!vehicle) {
      return res.status(404).json({
        status: 'error',
        message: 'Vehicle not found or does not belong to you'
      });
    }

    // Check if vehicle is active
    if (vehicle.status !== 'active') {
      return res.status(400).json({
        status: 'error',
        message: 'Vehicle must be active to make bookings'
      });
    }

    // Check if parking space exists
    const parkingSpace = await ParkingSpace.findById(parkingSpaceId).populate('landlordId');
    if (!parkingSpace) {
      return res.status(404).json({
        status: 'error',
        message: 'Parking space not found'
      });
    }

    // Check if parking space is active
    if (parkingSpace.status !== 'active') {
      return res.status(400).json({
        status: 'error',
        message: 'Parking space is not available for booking'
      });
    }

    // Check if vehicle type is compatible with parking space (with fallback for missing vehicleTypes)
    const acceptedVehicleTypes = parkingSpace.vehicleTypes && parkingSpace.vehicleTypes.length > 0 
      ? parkingSpace.vehicleTypes 
      : ['motorcycle', 'car']; // Default fallback
    
    if (!acceptedVehicleTypes.includes(vehicle.vehicleType)) {
      return res.status(400).json({
        status: 'error',
        message: `This parking space does not accept ${vehicle.vehicleType}s`
      });
    }

    // Handle different booking modes
    let start, end;
    let smartBookingData = null;

    if (bookingMode === 'book_now') {
      // Smart booking mode: calculate dynamic timing
      logger.info(`📱 Processing smart booking for user ${userId}`);

      if (!userCurrentLocation) {
        return res.status(400).json({
          status: 'error',
          message: 'Current location required for smart booking'
        });
      }

      if (!arrivalPrediction) {
        return res.status(400).json({
          status: 'error',
          message: 'Arrival prediction required for smart booking. Please run analysis first.'
        });
      }

      // Use prediction data for timing
      start = new Date(); // Start immediately
      end = new Date(arrivalPrediction.maxArrivalWindow); // End at max arrival window

      smartBookingData = {
        bookingMode: 'book_now',
        arrivalPrediction: {
          estimatedTravelTime: arrivalPrediction.travelData?.estimatedTime?.minutes || 0,
          bufferWindow: arrivalPrediction.totalWindowMinutes,
          confidenceScore: arrivalPrediction.confidence,
          userCurrentLocation: {
            latitude: userCurrentLocation.latitude,
            longitude: userCurrentLocation.longitude,
            timestamp: new Date()
          },
          predictedArrivalTime: new Date(arrivalPrediction.estimatedArrival),
          factors: arrivalPrediction.factors || {}
        },
        trackingData: {
          isActive: false, // Will be activated after booking creation
          startedAt: null,
          currentStatus: 'en_route',
          lastLocation: {
            latitude: userCurrentLocation.latitude,
            longitude: userCurrentLocation.longitude,
            accuracy: null,
            timestamp: new Date()
          },
          locationUpdates: [],
          geoFenceEvents: [],
          notifications: []
        }
      };

    } else {
      // Traditional reservation mode
      start = new Date(startTime);
      end = new Date(endTime);
      const now = new Date();

      if (start <= now) {
        return res.status(400).json({
          status: 'error',
          message: 'Start time must be in the future'
        });
      }

      if (end <= start) {
        return res.status(400).json({
          status: 'error',
          message: 'End time must be after start time'
        });
      }

      smartBookingData = {
        bookingMode: 'reservation'
      };
    }

    // Check availability
    const isAvailable = await Booking.checkAvailability(parkingSpaceId, start, end);
    if (!isAvailable) {
      return res.status(409).json({
        status: 'error',
        message: 'Parking space is not available for the selected time'
      });
    }

    // Get current active bookings to check slot availability
    const activeBookings = await Booking.getActiveBookings(parkingSpaceId);
    const availableSlots = parkingSpace.totalSlots - activeBookings.length;

    if (availableSlots <= 0 && !parkingSpace.autoAccept) {
      return res.status(409).json({
        status: 'error',
        message: 'No available slots for this parking space'
      });
    }

    // Calculate duration and pricing with dynamic adjustments
    const duration = Math.ceil((end - start) / (1000 * 60 * 60)); // Hours
    
    // Validate minimum duration requirement
    const manilaGovernmentPricingService = require('../services/manilaGovernmentPricingService');
    const durationValidation = manilaGovernmentPricingService.validateBookingDuration(duration);
    
    if (!durationValidation.isValid) {
      return res.status(400).json({
        status: 'error',
        message: durationValidation.message,
        minimumHours: manilaGovernmentPricingService.getMinimumBookingHours()
      });
    }

    // Apply new tiered pricing with service fees for all bookings
    let finalPricing;
    let dynamicPricingData = null;
    
    try {
      // Calculate comprehensive dynamic pricing with commission structure
      const pricingResult = await dynamicPricingService.calculatePricing({
        parkingSpaceId,
        startTime: start,
        duration,
        vehicleType: vehicle.vehicleType,
        isWeekend: dynamicPricingService.isWeekend(start),
        isHoliday: await dynamicPricingService.isHoliday(start)
      });
      
      finalPricing = {
        // Customer pricing (what customer pays)
        baseRate: pricingResult.metadata.landlordBasePrice,
        totalAmount: pricingResult.customer.totalAmount,
        baseAmount: pricingResult.customer.breakdown.baseAmount,
        dynamicAdjustments: pricingResult.customer.breakdown.dynamicAdjustments,
        serviceFee: pricingResult.customer.breakdown.serviceFee,

        // Landlord earnings (what landlord receives)
        landlordEarnings: pricingResult.landlord.totalEarnings,
        landlordBaseEarnings: pricingResult.landlord.breakdown.baseEarnings,
        landlordOvertimeEarnings: pricingResult.landlord.breakdown.overtimeEarnings,

        // Platform earnings (what platform keeps)
        platformEarnings: pricingResult.platform.totalEarnings,
        platformCommission: pricingResult.platform.breakdown.commission,
        platformServiceFee: pricingResult.platform.breakdown.serviceFee,
        dynamicPricingProfit: pricingResult.platform.breakdown.dynamicPricingProfit,

        // Metadata
        occupancyRate: pricingResult.metadata.occupancyRate,
        appliedFactors: pricingResult.metadata.appliedFactors.factors,
        pricingModel: 'dynamic_with_commission_structure'
      };
      
      dynamicPricingData = {
        ...pricingResult.metadata,
        customerBreakdown: pricingResult.customer.breakdown,
        landlordBreakdown: pricingResult.landlord.breakdown,
        platformBreakdown: pricingResult.platform.breakdown,
        vehicleType: vehicle.vehicleType,
        calculatedAt: new Date()
      };

      logger.info(`💰 Dynamic pricing applied for ${vehicle.vehicleType}:
        Duration: ${duration}h, Occupancy: ${(pricingResult.metadata.occupancyRate * 100).toFixed(1)}%
        Customer pays: ₱${pricingResult.customer.totalAmount} (₱${pricingResult.customer.breakdown.baseAmount} + ₱${pricingResult.customer.breakdown.dynamicAdjustments} + ₱${pricingResult.customer.breakdown.serviceFee})
        Landlord gets: ₱${pricingResult.landlord.totalEarnings} (base + overtime only)
        Platform keeps: ₱${pricingResult.platform.totalEarnings} (commission + service fee + dynamic pricing)`);
    } catch (pricingError) {
      logger.warn('Dynamic pricing calculation failed, using base pricing:', pricingError);
      
      // Fallback to base pricing with commission structure
      const baseTotalAmount = duration * parkingSpace.pricePerHour;
      const serviceFee = 5.00; // Default service fee
      const totalAmount = baseTotalAmount + serviceFee;
      const commission = baseTotalAmount * 0.1; // 10% default commission
      const landlordEarnings = baseTotalAmount - commission;

      finalPricing = {
        baseRate: parkingSpace.pricePerHour,
        totalAmount: totalAmount,
        baseAmount: baseTotalAmount,
        serviceFee: serviceFee,
        landlordEarnings: landlordEarnings,
        platformEarnings: commission + serviceFee,
        occupancyRate: 0,
        appliedFactors: [],
        pricingModel: 'fallback_basic'
      };
    }
    
    const totalAmount = finalPricing.totalAmount;

    // Prepare vehicle info for booking and notifications
    const vehicleInfo = {
      plateNumber: vehicle.plateNumber,
      vehicleType: vehicle.vehicleType,
      vehicleColor: vehicle.color,
      vehicleModel: `${vehicle.brand} ${vehicle.model}`
    };

    // Create booking with smart features
    const booking = new Booking({
      userId,
      parkingSpaceId,
      landlordId: parkingSpace.landlordId._id,
      startTime: start,
      endTime: end,
      duration,
      vehicleInfo,
      pricing: {
        hourlyRate: finalPricing.baseRate,
        dynamicRate: finalPricing.dynamicRate,
        totalAmount: finalPricing.totalAmount,
        demandFactor: finalPricing.demandFactor,
        paymentMethod: 'wallet',
        isPaid: false,
        paymentStatus: 'pending'
      },
      
      // Add dynamic pricing data
      dynamicPricing: dynamicPricingData,
      notes: {
        userNotes: userNotes || ''
      },
      // Smart booking features
      bookingMode: smartBookingData.bookingMode,
      arrivalPrediction: smartBookingData.arrivalPrediction,
      trackingData: smartBookingData.trackingData
    });

    // Ensure user has wallet and sufficient balance; place a wallet hold
    let userWallet = await Wallet.findByUserId(userId);
    if (!userWallet) {
      userWallet = await Wallet.createWallet(userId, 0);
    }

    // Check available balance (total balance minus existing holds)
    if (!userWallet.hasSufficientBalance(totalAmount)) {
      return res.status(400).json({
        status: 'error',
        message: `Insufficient wallet balance. Available: ₱${userWallet.availableBalance}, Required: ₱${totalAmount}`,
        data: {
          availableBalance: userWallet.availableBalance,
          requiredAmount: totalAmount,
          totalBalance: userWallet.balance,
          heldAmount: userWallet.heldAmount
        }
      });
    }

    // Save booking to get ID for hold transaction
    await booking.save();

    // Create wallet hold for the booking amount
    const holdReference = await userWallet.holdAmount(
      totalAmount, 
      booking._id, 
      `Hold for ${parkingSpace.name} booking`
    );

    // Update booking with hold reference and payment status
    booking.pricing.walletHoldReference = holdReference;
    booking.pricing.paymentStatus = 'held';
    booking.pricing.paymentMethod = 'wallet';

    // Check for auto-accept
    let shouldAutoAccept = false;
    if (parkingSpace.autoAccept && availableSlots > 0) {
      shouldAutoAccept = true;
      await booking.autoAccept();
      // Auto-accepted: capture hold immediately
      try {
        const tx = userWallet.transactions.find(t => t.bookingId?.toString() === booking._id.toString() && t.type === 'debit' && t.status === 'pending');
        if (tx) {
          tx.status = 'completed';
          // Capture the wallet hold instead of direct debit
          await userWallet.captureHold(booking.pricing.walletHoldReference, `Payment captured for auto-accepted booking ${booking._id}`);
          booking.pricing.paymentStatus = 'captured';
          booking.pricing.isPaid = true;
          booking.pricing.paidAt = new Date();
          // Do not auto-complete on acceptance. Booking is Confirmed; will become Active on arrival.
        }
      } catch (e) {
        logger.error('Wallet capture on auto-accept failed:', e);
      }
    }
    await booking.save();

    // Record service fee for tracking app revenue
    try {
      const serviceFeeTrackingService = require('../services/serviceFeeTrackingService');
      await serviceFeeTrackingService.recordServiceFee({
        bookingId: booking._id,
        parkingSpaceId: parkingSpaceId,
        userId: userId,
        landlordId: parkingSpace.landlordId._id,
        baseParkingFee: finalPricing.dynamicParkingFee || finalPricing.totalAmount,
        serviceFeeBreakdown: {
          serviceFee: finalPricing.serviceFee || 0,
          flatFee: finalPricing.serviceFee ? 5 : 0,
          percentageFee: finalPricing.serviceFee ? finalPricing.serviceFee - 5 : 0
        },
        vehicleType: vehicle.vehicleType,
        vehicleCategory: finalPricing.vehicleCategory || 'MEDIUM_VEHICLES',
        bookingDuration: duration,
        bookingType: 'traditional',
        bookingDate: start
      });
    } catch (serviceFeeError) {
      logger.warn('Failed to record service fee:', serviceFeeError.message);
      // Don't fail the booking if service fee recording fails
    }

    // 📱 Send SMS notifications
    try {
      if (shouldAutoAccept) {
        // Send confirmation SMS for auto-accepted booking
        if (user.phoneNumber) {
          await smsService.sendBookingConfirmation(user.phoneNumber, booking, parkingSpace);
        }
        
        // Send landlord notification for auto-accepted booking
        if (parkingSpace.landlordId.phoneNumber) {
          await smsService.sendLandlordNewBooking(parkingSpace.landlordId.phoneNumber, booking, parkingSpace, user);
        }
      } else {
        // Send pending notification to user for manual approval
        if (user.phoneNumber) {
          await smsService.sendBookingRequestPending(user.phoneNumber, booking, parkingSpace);
        }
        
        // Send landlord notification for manual approval  
        if (parkingSpace.landlordId.phoneNumber) {
          await smsService.sendLandlordNewBooking(parkingSpace.landlordId.phoneNumber, booking, parkingSpace, user);
        }
      }
    } catch (smsError) {
      logger.error('📱 SMS notification error:', smsError);
      // Don't fail the booking if SMS fails
    }

    // ML data collection removed - using 30-minute fallback
    if (smartBookingData.bookingMode === 'book_now') {
      logger.info(`Smart booking created with 30-minute fallback for booking: ${booking._id}`);
    }

    // Update vehicle usage statistics
    await vehicle.recordUsage();

    // Get Socket.IO instance
    const io = req.app.get('io');

    // Prepare notification data
    const notificationData = {
      bookingId: booking._id,
      userId,
      landlordId: parkingSpace.landlordId._id,
      parkingSpaceName: parkingSpace.name,
      startTime: start,
      endTime: end,
      totalAmount,
      vehicleInfo,
      status: booking.status,
      autoAccepted: shouldAutoAccept
    };

    if (shouldAutoAccept) {
      // Notify user about auto-acceptance
      io.to(`user_${userId}`).emit('booking_auto_accepted', {
        bookingId: booking._id,
        message: 'Your booking has been automatically accepted!',

      });

      // Send push notification to user
      try {
        if (user?.fcmToken) {
          await sendNotification(user.fcmToken, {
            title: '🎉 Booking Confirmed!',
            body: `Your booking for ${parkingSpace.name} has been automatically accepted.`,
            data: {
              type: 'booking_accepted',
              bookingId: booking._id.toString(),
              parkingSpaceName: parkingSpace.name
            }
          });
        }
      } catch (notificationError) {
        logger.error('Failed to send push notification to user:', notificationError);
      }

      // Notify landlord about auto-accepted booking
      io.to(`landlord_${parkingSpace.landlordId._id}`).emit('booking_auto_accepted', {
        ...notificationData,
        message: 'A booking has been automatically accepted for your parking space.'
      });

      // Send push notification to landlord
      try {
        if (parkingSpace.landlordId.fcmToken) {
          await sendNotification(parkingSpace.landlordId.fcmToken, {
            title: '📋 Auto-Accepted Booking',
            body: `A booking for ${parkingSpace.name} has been automatically accepted.`,
            data: {
              type: 'auto_accepted_booking',
              bookingId: booking._id.toString(),
              parkingSpaceName: parkingSpace.name
            }
          });
        }
      } catch (notificationError) {
        logger.error('Failed to send push notification to landlord:', notificationError);
      }

    } else {
      // Manual approval needed - notify landlord
      const landlordRoom = `landlord_${parkingSpace.landlordId._id}`;
      logger.info(`📡 Emitting new_booking_request to room: ${landlordRoom}`);
      logger.info(`📋 Notification data:`, notificationData);
      
      io.to(landlordRoom).emit('new_booking_request', {
        ...notificationData,
        message: 'You have a new booking request that requires your approval.'
      });

      // Log connected clients in the landlord room
      const socketsInRoom = await io.in(landlordRoom).allSockets();
      logger.info(`👥 Sockets in room ${landlordRoom}: ${socketsInRoom.size} clients`);

      // Send push notification to landlord for manual approval
      try {
        if (parkingSpace.landlordId.fcmToken) {
          logger.info(`📱 Sending Firebase notification to landlord: ${parkingSpace.landlordId.fcmToken.substring(0, 20)}...`);
          await sendNotification(parkingSpace.landlordId.fcmToken, {
            title: '🚗 New Booking Request',
            body: `You have a new booking request for ${parkingSpace.name}. Tap to review.`,
            data: {
              type: 'booking_request',
              bookingId: booking._id.toString(),
              parkingSpaceName: parkingSpace.name,
              requiresAction: 'true'
            }
          });
          logger.info(`✅ Firebase notification sent successfully`);
        } else {
          logger.warn(`⚠️ No FCM token found for landlord: ${parkingSpace.landlordId._id}`);
        }
      } catch (notificationError) {
        logger.error('Failed to send push notification to landlord:', notificationError);
      }

      // Notify user that booking is pending
      io.to(`user_${userId}`).emit('booking_pending', {
        bookingId: booking._id,
        message: 'Your booking request has been sent. Waiting for landlord approval.'
      });
    }

    // Populate booking data for response
    await booking.populate([
      { path: 'parkingSpace', select: 'name address pricing images' },
      { path: 'landlord', select: 'firstName lastName phoneNumber' }
    ]);

    // Helper function to format time
    const formatTime = (date) => {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
    };

    // Build response data
    const responseData = {
      booking: {
        id: booking._id,
        bookingId: booking.bookingId, // Add numeric booking ID
        status: booking.status,
        startTime: booking.startTime,
        endTime: booking.endTime,
        duration: booking.duration,
        totalAmount: booking.pricing.totalAmount,
        autoAccepted: booking.autoAccepted,
        qrCode: booking.qrCode?.code,
        parkingSpace: booking.parkingSpace,
        landlord: booking.landlord,
        bookingMode: bookingMode
      }
    };

    // Add smart booking context if this is a book_now booking
    if (bookingMode === 'book_now' && smartBookingData?.arrivalPrediction) {
      const bookingTime = booking.startTime;
      const etaMinutes = smartBookingData.arrivalPrediction.realETAMinutes;
      const graceMinutes = smartBookingData.arrivalPrediction.gracePeriodMinutes;
      const arrivalWindow = smartBookingData.arrivalPrediction.maxArrivalWindow;
      
      responseData.smartBookingContext = {
        isSmartBooking: true,
        bookingTime: bookingTime,
        etaMinutes: etaMinutes,
        graceMinutes: graceMinutes,
        arrivalWindow: arrivalWindow,
        calculation: `${formatTime(bookingTime)} + ${etaMinutes}min (ETA) + ${graceMinutes}min grace = ${formatTime(new Date(arrivalWindow))} arrival window`,
        billingNote: 'Billing starts only when you arrive and park',
        displayInfo: {
          showDuration: false, // Don't show fixed duration for smart bookings
          showEndTime: false,  // Don't show fixed end time for smart bookings
          billingType: 'usage_based'
        }
      };
    }

    res.status(201).json({
      status: 'success',
      message: shouldAutoAccept ? 'Booking automatically accepted!' : 'Booking request created successfully',
      data: responseData
    });

  } catch (error) {
    logger.error('Create booking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Landlord accepts a booking request
 */
const acceptBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { message } = req.body;
    const landlordId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('userId', 'firstName lastName fcmToken phoneNumber')
      .populate('parkingSpace', 'name');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if landlord owns this booking
    if (booking.landlordId.toString() !== landlordId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to accept this booking'
      });
    }

    // Check if booking is in pending status
    if (booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: `Cannot accept booking with status: ${booking.status}`
      });
    }

    // Check slot availability again
    const activeBookings = await Booking.getActiveBookings(booking.parkingSpaceId);
    const parkingSpace = await ParkingSpace.findById(booking.parkingSpaceId);
    const availableSlots = parkingSpace.totalSlots - activeBookings.length;

    if (availableSlots <= 0) {
      return res.status(409).json({
        status: 'error',
        message: 'No available slots left for this parking space'
      });
    }

    // Accept the booking
    await booking.accept(message);
    // Capture any pending hold
    try {
      const userWallet = await Wallet.findByUserId(booking.userId);
      const tx = userWallet?.transactions.find(t => t.bookingId?.toString() === booking._id.toString() && t.type === 'debit' && t.status === 'pending');
      if (tx) {
        tx.status = 'completed';
        // Capture the wallet hold for landlord-accepted booking
        await userWallet.captureHold(booking.pricing.walletHoldReference, `Payment captured for accepted booking ${booking._id}`);
        booking.pricing.paymentStatus = 'captured';
        booking.pricing.isPaid = true;
        booking.pricing.paidAt = new Date();
        // Note: Don't auto-complete here - wait for user arrival via geofencing
      }
    } catch (e) {
      logger.error('Wallet capture on acceptance failed:', e);
    }

    await booking.save();

    // 📱 Send SMS notification for booking approval
    try {
      if (booking.userId.phoneNumber) {
        logger.info(`📱 Sending SMS for booking acceptance to user: ${booking.userId.phoneNumber.substring(0, 8)}...`);
        await smsService.sendBookingStatusUpdate(
          booking.userId.phoneNumber, 
          booking, 
          'accepted', 
          booking.parkingSpace
        );
        logger.info(`✅ SMS sent successfully for booking acceptance`);
      } else {
        logger.warn(`⚠️ No phone number found for user ${booking.userId._id} - skipping SMS`);
      }
    } catch (smsError) {
      logger.error('📱 SMS notification error on booking approval:', smsError);
    }

    // Get Socket.IO instance
    const io = req.app.get('io');

    // Notify user about acceptance
    io.to(`user_${booking.userId._id}`).emit('booking_accepted', {
      bookingId: booking._id,
      message: 'Your booking has been accepted!',
      landlordMessage: message
    });

    // Send push notification to user
    try {
      if (booking.userId.fcmToken) {
        await sendNotification(booking.userId.fcmToken, {
          title: '✅ Booking Accepted!',
          body: `Your booking for ${booking.parkingSpace.name} has been accepted by the landlord.`,
          data: {
            type: 'booking_accepted',
            bookingId: booking._id.toString(),
            parkingSpaceName: booking.parkingSpace.name
          }
        });
      }
    } catch (notificationError) {
      logger.error('Failed to send push notification:', notificationError);
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking accepted successfully',
              data: {
          booking: {
            id: booking._id,
            status: booking.status,
            landlordResponse: booking.landlordResponse
          }
        }
    });

  } catch (error) {
    logger.error('Accept booking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Landlord rejects a booking request
 */
const rejectBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const landlordId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('userId', 'firstName lastName fcmToken phoneNumber')
      .populate('parkingSpace', 'name');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if landlord owns this booking
    if (booking.landlordId.toString() !== landlordId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to reject this booking'
      });
    }

    // Check if booking is in pending status
    if (booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: `Cannot reject booking with status: ${booking.status}`
      });
    }

    // Reject the booking
    await booking.reject(reason);

    // 📱 Send SMS notification for booking rejection
    try {
      if (booking.userId.phoneNumber) {
        logger.info(`📱 Sending SMS for booking rejection to user: ${booking.userId.phoneNumber.substring(0, 8)}...`);
        await smsService.sendBookingRejection(booking.userId.phoneNumber, booking);
        logger.info(`✅ SMS sent successfully for booking rejection`);
      } else {
        logger.warn(`⚠️ No phone number found for user ${booking.userId._id} - skipping SMS`);
      }
    } catch (smsError) {
      logger.error('📱 SMS notification error on booking rejection:', smsError);
    }

    // Cancel any pending hold (no balance change)
    try {
      const userWallet = await Wallet.findByUserId(booking.userId);
      const tx = userWallet?.transactions.find(t => t.bookingId?.toString() === booking._id.toString() && t.type === 'debit' && t.status === 'pending');
      if (tx) {
        tx.status = 'cancelled';
        await userWallet.save();
      }
    } catch (e) {
      logger.error('Wallet hold cancel on rejection failed:', e);
    }

    // Get Socket.IO instance
    const io = req.app.get('io');

    // Notify user about rejection
    io.to(`user_${booking.userId._id}`).emit('booking_rejected', {
      bookingId: booking._id,
      message: 'Your booking has been rejected',
      reason: reason
    });

    // Send push notification to user
    try {
      if (booking.userId.fcmToken) {
        await sendNotification(booking.userId.fcmToken, {
          title: '❌ Booking Rejected',
          body: `Your booking for ${booking.parkingSpace.name} has been rejected. ${reason ? 'Reason: ' + reason : ''}`,
          data: {
            type: 'booking_rejected',
            bookingId: booking._id.toString(),
            parkingSpaceName: booking.parkingSpace.name
          }
        });
      }
    } catch (notificationError) {
      logger.error('Failed to send push notification:', notificationError);
    }

    // 📱 Send SMS notification to user about rejection
    try {
      if (booking.userId.phoneNumber) {
        await smsService.sendBookingStatusUpdate(
          booking.userId.phoneNumber, 
          booking, 
          'rejected', 
          booking.parkingSpace
        );
      }
    } catch (smsError) {
      logger.error('📱 SMS notification error:', smsError);
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking rejected successfully',
      data: {
        booking: {
          id: booking._id,
          status: booking.status,
          landlordResponse: booking.landlordResponse
        }
      }
    });

  } catch (error) {
    logger.error('Reject booking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get landlord's booking requests (pending bookings)
 */
const getLandlordBookingRequests = async (req, res) => {
  try {
    const landlordId = req.user.id;
    const { page = 1, limit = 10, status = 'pending' } = req.query;

    const bookings = await Booking.find({
      landlordId,
      status
    })
    .populate('userId', 'firstName lastName phoneNumber email')
    .populate('parkingSpace', 'name address images')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

    const total = await Booking.countDocuments({ landlordId, status });

    res.status(200).json({
      status: 'success',
      message: 'Booking requests retrieved successfully',
      data: {
        bookings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get landlord booking requests error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get all landlord's bookings (all statuses)
 */
const getLandlordBookings = async (req, res) => {
  try {
    const landlordId = req.user.id;
    const { page = 1, limit = 20, status } = req.query;

    // Build filter object
    const filter = { landlordId };
    if (status) {
      filter.status = status;
    }

    const bookings = await Booking.find(filter)
      .populate('userId', 'firstName lastName phoneNumber email')
      .populate('parkingSpace', 'name address images')
      .populate({
        path: 'userId',
        select: 'firstName lastName phoneNumber email',
        options: { virtuals: true }
      })
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    // Transform the data to match frontend expectations
    const transformedBookings = bookings.map(booking => {
      const bookingObj = booking.toObject();
      // Add user field as alias for userId
      if (bookingObj.userId) {
        bookingObj.user = bookingObj.userId;
      }
      // Add parkingSpace field for consistency
      if (bookingObj.parkingSpace) {
        bookingObj.parkingSpace = bookingObj.parkingSpace;
      }
      // Expose payment status fields for UI
      bookingObj.pricing = bookingObj.pricing || {};
      bookingObj.pricing = {
        ...bookingObj.pricing,
        isPaid: booking.pricing?.isPaid ?? false,
        paymentStatus: booking.pricing?.paymentStatus ?? 'pending',
      };
      return bookingObj;
    });

    const total = await Booking.countDocuments(filter);

    res.status(200).json({
      status: 'success',
      message: 'Landlord bookings retrieved successfully',
      data: {
        bookings: transformedBookings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get landlord bookings error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get user's bookings
 */
const getUserBookings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { page = 1, limit = 10, status } = req.query;

    const filter = { userId };
    if (status) {
      filter.status = status;
    }

    const bookings = await Booking.find(filter)
      .populate('parkingSpaceId', 'name address images pricing latitude longitude')
      .populate('parkingSpace', 'name address images pricing latitude longitude') // Populate virtual field
      .populate('landlordId', 'firstName lastName phoneNumber')
      .sort({ createdAt: -1 })
      .limit(limit * 1)
      .skip((page - 1) * limit);

    const total = await Booking.countDocuments(filter);

    // Debug: Log parking space data for the first booking
    if (bookings.length > 0) {
      const firstBooking = bookings[0];
      console.log('🔍 DEBUG: First booking parking space data:');
      console.log('📍 parkingSpaceId:', firstBooking.parkingSpaceId);
      console.log('📍 parkingSpace virtual:', firstBooking.parkingSpace);
      console.log('📍 parkingSpaceId.latitude:', firstBooking.parkingSpaceId?.latitude);
      console.log('📍 parkingSpaceId.longitude:', firstBooking.parkingSpaceId?.longitude);
      console.log('📍 parkingSpace.latitude:', firstBooking.parkingSpace?.latitude);
      console.log('📍 parkingSpace.longitude:', firstBooking.parkingSpace?.longitude);
    }

    // Transform to include payment fields and smart booking context
    const transformed = bookings.map(booking => {
      const obj = booking.toObject({ virtuals: true }); // Include virtual fields
      obj.pricing = obj.pricing || {};
      obj.pricing = {
        ...obj.pricing,
        isPaid: booking.pricing?.isPaid ?? false,
        paymentStatus: booking.pricing?.paymentStatus ?? 'pending',
      };
      
      // Add smart booking context if this is a book_now booking OR smart booking
      if ((booking.bookingMode === 'book_now' && booking.arrivalPrediction) || booking.bookingType === 'smart') {
        const formatTime = (date) => {
          return date.toLocaleTimeString('en-US', { 
            hour: 'numeric', 
            minute: '2-digit', 
            hour12: true 
          });
        };
        
        if (booking.bookingMode === 'book_now' && booking.arrivalPrediction) {
          // ETA-based smart booking (book_now mode)
          obj.smartBookingContext = {
            isSmartBooking: true,
            bookingTime: booking.startTime,
            etaMinutes: booking.arrivalPrediction.realETAMinutes,
            graceMinutes: booking.arrivalPrediction.gracePeriodMinutes || 0,
            arrivalWindow: booking.arrivalPrediction.maxArrivalWindow,
            calculation: `${formatTime(booking.startTime)} + ${booking.arrivalPrediction.realETAMinutes}min (ETA) + ${booking.arrivalPrediction.gracePeriodMinutes}min grace = ${formatTime(new Date(booking.arrivalPrediction.maxArrivalWindow))} arrival window`,
            billingNote: 'Billing starts only when you arrive and park',
            displayInfo: {
              showDuration: false,
              showEndTime: false,
              billingType: 'usage_based'
            }
          };
        } else if (booking.bookingType === 'smart') {
          // Smart recommendation booking with ETA data
          if (booking.arrivalPrediction && booking.arrivalPrediction.realETAMinutes) {
            // Smart booking with ETA calculation
            obj.smartBookingContext = {
              isSmartBooking: true,
              bookingTime: booking.startTime,
              etaMinutes: booking.arrivalPrediction.realETAMinutes,
              graceMinutes: booking.arrivalPrediction.gracePeriodMinutes || 0,
              arrivalWindow: booking.arrivalPrediction.maxArrivalWindow,
              calculation: `${formatTime(booking.startTime)} + ${booking.arrivalPrediction.realETAMinutes}min (ETA) + ${booking.arrivalPrediction.gracePeriodMinutes}min grace = ${formatTime(new Date(booking.arrivalPrediction.maxArrivalWindow))} arrival window`,
              billingNote: 'Billing starts only when you arrive and park',
              displayInfo: {
                showDuration: false,
                showEndTime: false,
                billingType: 'usage_based'
              }
            };
          } else {
            // Fallback for older smart bookings without ETA
            const preference = booking.smartBookingData?.preference || 'balanced';
            obj.smartBookingContext = {
              isSmartBooking: true,
              bookingTime: booking.startTime,
              preference: preference,
              calculation: `Smart booking created at ${formatTime(booking.startTime)} with ${preference} preference`,
              billingNote: 'Smart booking with dynamic recommendations',
              displayInfo: {
                showDuration: false,
                showEndTime: false,
                billingType: 'smart_recommendation'
              }
            };
          }
        }
      }
      
      return obj;
    });

    res.status(200).json({
      status: 'success',
      message: 'User bookings retrieved successfully',
      data: {
        bookings: transformed,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / limit),
          totalItems: total,
          itemsPerPage: parseInt(limit)
        }
      }
    });

  } catch (error) {
    logger.error('Get user bookings error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Cancel a booking
 */
const cancelBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { reason } = req.body;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('parkingSpace', 'name')
      .populate('landlord', 'fcmToken firstName lastName');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if user owns this booking
    if (booking.userId.toString() !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to cancel this booking'
      });
    }

    // Check if booking can be cancelled
    if (!['pending', 'accepted'].includes(booking.status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot cancel booking with status: ${booking.status}`
      });
    }

    // NEW BUSINESS RULE: Cannot cancel if payment has been transferred to landlord
    if (booking.pricing?.paymentStatus === 'captured') {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot cancel booking - payment has already been transferred to the parking space owner. The booking is considered complete.',
        data: {
          paymentStatus: booking.pricing.paymentStatus,
          reason: 'Payment already captured and transferred'
        }
      });
    }

    // Calculate refund amount (if any)
    const now = new Date();
    const timeUntilStart = booking.startTime - now;
    const hoursUntilStart = timeUntilStart / (1000 * 60 * 60);
    
    let refundAmount = 0;
    if (hoursUntilStart >= 24) {
      refundAmount = booking.pricing.totalAmount; // Full refund
    } else if (hoursUntilStart >= 2) {
      refundAmount = booking.pricing.totalAmount * 0.5; // 50% refund
    }

    // Update booking
    booking.status = 'cancelled';
    booking.cancellation = {
      cancelledBy: 'user',
      reason: reason || 'Cancelled by user',
      cancelledAt: new Date(),
      refundAmount
    };
    await booking.save();

    // Handle wallet hold/payment depending on status
    try {
      const userWallet = await Wallet.findByUserId(booking.userId);
      
      if (userWallet && booking.pricing?.walletHoldReference) {
        // If booking has a wallet hold, release it (automatic refund)
        if (booking.pricing.paymentStatus === 'held') {
          await userWallet.releaseHold(
            booking.pricing.walletHoldReference,
            `Booking cancelled by user - ${reason || 'No reason provided'}`
          );
          logger.info(`Wallet hold released on user cancellation: ₱${refundAmount}`);
        } 
        // If payment was already captured, issue a manual refund based on refund amount
        else if (booking.pricing.paymentStatus === 'captured' && refundAmount > 0) {
          await userWallet.addTransaction({
            type: 'refund',
            amount: refundAmount,
            description: `Refund for cancelled booking ${booking._id} - ${reason || 'User cancelled'}`,
            bookingId: booking._id,
            status: 'completed'
          });
          await userWallet.updateBalance(refundAmount, 'refund');
          logger.info(`Manual refund issued for captured payment: ₱${refundAmount}`);
        }
        
        // Update booking payment status
        await Booking.findByIdAndUpdate(booking._id, {
          $set: {
            'pricing.paymentStatus': refundAmount === booking.pricing.totalAmount ? 'released' : 'partially_refunded'
          }
        });
      } else {
        // Legacy wallet handling for old bookings without hold references
        const pendingHold = userWallet?.transactions.find(t => t.bookingId?.toString() === booking._id.toString() && t.type === 'debit' && t.status === 'pending');
        if (pendingHold) {
          pendingHold.status = 'cancelled';
          await userWallet.save();
        } else if (refundAmount > 0) {
          // If already captured, process refund
          await userWallet.addTransaction({
            type: 'refund',
            amount: refundAmount,
            description: `Refund for booking ${booking._id}`,
            bookingId: booking._id,
            status: 'completed'
          });
          await userWallet.updateBalance(refundAmount, 'refund');
        }
      }
      
    } catch (e) {
      logger.error('Wallet refund/cancel on user cancellation failed:', e);
    }

    // Get Socket.IO instance
    const io = req.app.get('io');

    // Notify landlord about cancellation
    io.to(`landlord_${booking.landlordId}`).emit('booking_cancelled', {
      bookingId: booking._id,
      message: 'A booking has been cancelled by the user',
      reason: reason
    });

    // Send push notification to landlord
    try {
      if (booking.landlord.fcmToken) {
        await sendNotification(booking.landlord.fcmToken, {
          title: '🚫 Booking Cancelled',
          body: `A booking for ${booking.parkingSpace.name} has been cancelled by the user.`,
          data: {
            type: 'booking_cancelled',
            bookingId: booking._id.toString(),
            parkingSpaceName: booking.parkingSpace.name
          }
        });
      }
    } catch (notificationError) {
      logger.error('Failed to send push notification:', notificationError);
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking cancelled successfully',
      data: {
        booking: {
          id: booking._id,
          status: booking.status,
          refundAmount,
          cancellation: booking.cancellation
        }
      }
    });

  } catch (error) {
    logger.error('Cancel booking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Get booking details
 */
const getBookingDetails = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    console.log('🔍 DEBUG: Validating request body:', req.body);
    console.log('🔍 DEBUG: Getting booking details for:', bookingId);

    const booking = await Booking.findById(bookingId)
      .populate('userId', 'firstName lastName phoneNumber email')
      .populate('landlordId', 'firstName lastName phoneNumber email')
      .populate('parkingSpace');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    console.log('🔍 DEBUG: Booking found:', {
      id: booking._id,
      userId: booking.userId?._id,
      landlordId: booking.landlordId?._id,
      landlordPhone: booking.landlordId?.phoneNumber,
      landlordName: `${booking.landlordId?.firstName} ${booking.landlordId?.lastName}`
    });

    // Check if user has access to this booking
    if (booking.userId._id.toString() !== userId && booking.landlordId._id.toString() !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to view this booking'
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking details retrieved successfully',
      data: booking  // Return booking directly, not wrapped in { booking }
    });

  } catch (error) {
    logger.error('Get booking details error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Manual checkout for bookings
 * @route POST /api/v1/bookings/:bookingId/checkout
 */
const manualCheckout = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    console.log('🔍 DEBUG: Manual checkout requested');
    console.log('📍 Booking ID:', bookingId);
    console.log('👤 User ID:', userId);

    const booking = await Booking.findById(bookingId)
      .populate('parkingSpaceId', 'name location landlordId')
      .populate('landlordId', 'firstName lastName');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if user owns this booking
    if (booking.userId.toString() !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized to checkout this booking'
      });
    }

    // Check if booking is in a valid state for checkout
    if (!['accepted', 'active'].includes(booking.status)) {
      return res.status(400).json({
        status: 'error',
        message: `Cannot checkout booking with status: ${booking.status}`
      });
    }

    // Check if booking has already been completed
    if (booking.status === 'completed') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking has already been completed'
      });
    }

    // Check if checkout is within valid time range
    const now = new Date();
    const bookingStart = new Date(booking.startTime);
    const bookingEnd = new Date(booking.endTime);

    // Allow checkout from booking start time until 2 hours after end time
    const checkoutDeadline = new Date(bookingEnd.getTime() + (2 * 60 * 60 * 1000));

    if (now < bookingStart) {
      return res.status(400).json({
        status: 'error',
        message: 'Cannot checkout before booking start time'
      });
    }

    if (now > checkoutDeadline) {
      return res.status(400).json({
        status: 'error',
        message: 'Checkout deadline has passed. Please contact support.'
      });
    }

    // 💰 PROCESS PAYMENT IF NOT ALREADY CAPTURED
    const { Wallet } = require('../models/Wallet');
    let paymentProcessed = false;

    try {
      if (booking.pricing?.walletHoldReference && booking.pricing?.paymentStatus === 'held') {
        const userWallet = await Wallet.findByUserId(userId);
        
        if (userWallet) {
          // Capture the wallet hold (convert to payment)
          await userWallet.captureHold(
            booking.pricing.walletHoldReference,
            `Payment captured - Manual checkout at ${booking.parkingSpaceId?.name || 'parking space'}`
          );
          
          // Update booking payment status
          booking.pricing.paymentStatus = 'captured';
          booking.pricing.isPaid = true;
          booking.pricing.paidAt = new Date();
          paymentProcessed = true;
          
          logger.info(`💳 Wallet payment captured via manual checkout for booking ${bookingId}: ₱${booking.pricing.totalAmount}`);
          
          // 🏢 TRANSFER TO LANDLORD WALLET
          try {
            let landlordWallet = await Wallet.findByUserId(booking.landlordId);
            if (!landlordWallet) {
              landlordWallet = await Wallet.createWallet(booking.landlordId, 0);
            }
            
            const transferTransaction = {
              type: 'transfer_in',
              amount: booking.pricing.totalAmount,
              description: `Booking payment: Manual checkout at ${booking.parkingSpaceId?.name || 'parking space'}`,
              bookingId: bookingId,
              status: 'completed',
              metadata: new Map([
                ['fromUserId', userId],
                ['parkingSpaceName', booking.parkingSpaceId?.name || 'Parking Space'],
                ['parkingSpaceId', booking.parkingSpaceId?._id || booking.parkingSpaceId],
                ['captureMethod', 'manual_checkout'],
                ['checkoutTime', now.toISOString()],
                ['bookingStartTime', booking.startTime?.toISOString()],
                ['bookingEndTime', booking.endTime?.toISOString()]
              ])
            };
            
            // Calculate correct amounts for distribution
            const totalAmount = booking.pricing.totalAmount;
            const serviceFee = booking.pricing.serviceFee || 0;
            const landlordAmount = totalAmount - serviceFee;
            
            await landlordWallet.addTransaction({
              ...transferTransaction,
              amount: landlordAmount,
              description: `Parking fee payment from booking ${booking._id} (excludes ₱${serviceFee.toFixed(2)} service fee)`
            });
            await landlordWallet.updateBalance(landlordAmount, 'credit');
            
            logger.info(`💰 Payment distributed via manual checkout:
              Total: ₱${totalAmount}
              Landlord: ₱${landlordAmount} (to ${booking.landlordId})
              Platform: ₱${serviceFee} (service fee)`);
              
            // Update service fee tracking status
            try {
              const serviceFeeTrackingService = require('../services/serviceFeeTrackingService');
              await serviceFeeTrackingService.updatePaymentStatus(booking._id, 'paid');
            } catch (serviceFeeUpdateError) {
              logger.warn('Failed to update service fee status:', serviceFeeUpdateError.message);
            }
            
          } catch (transferError) {
            logger.error('Error transferring payment to landlord via manual checkout:', transferError);
            // Continue with checkout even if transfer fails
          }
        }
      }
    } catch (walletError) {
      logger.error('Error processing wallet payment via manual checkout:', walletError);
      // Continue with checkout even if wallet capture fails, but note the issue
    }

    // Update booking status to completed
    booking.status = 'completed';
    booking.checkout = {
      time: now,
      method: 'manual'
    };

    // If payment wasn't already processed (was captured via geofencing), mark it as captured
    if (!paymentProcessed && booking.pricing?.paymentStatus !== 'captured') {
      booking.pricing.paymentStatus = 'captured';
      booking.pricing.isPaid = true;
      booking.pricing.paidAt = now;
    }

    await booking.save();

    logger.info(`✅ Manual checkout completed for booking ${bookingId} by user ${userId}`);

    // 📱 Send SMS notification for manual checkout
    try {
      if (booking.userId.phoneNumber) {
        await smsService.sendCheckoutConfirmation(booking.userId.phoneNumber, booking);
      }
    } catch (smsError) {
      logger.error('📱 SMS notification error on manual checkout:', smsError);
    }

    // 📧 Send receipt email for completed booking
    try {
      await receiptService.sendCompletionReceipt(bookingId);
      logger.info(`📧 Receipt email sent for completed booking ${bookingId}`);
    } catch (receiptError) {
      logger.error('📧 Receipt email error on manual checkout:', receiptError);
      // Don't fail the checkout if receipt sending fails
    }

    res.status(200).json({
      status: 'success',
      message: 'Booking checkout completed successfully',
      data: {
        booking: {
          id: booking._id,
          status: booking.status,
          checkout: booking.checkout,
          pricing: {
            totalAmount: booking.pricing.totalAmount,
            paymentStatus: booking.pricing.paymentStatus,
            isPaid: booking.pricing.isPaid
          }
        },
        paymentProcessed
      }
    });

  } catch (error) {
    logger.error('Manual checkout error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Complete smart booking and update user behavior
 */
const completeSmartBooking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { actualArrivalTime, checkinLocation } = req.body;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check ownership
    if (booking.userId.toString() !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized'
      });
    }

    // Only process for smart bookings
    if (booking.bookingMode === 'book_now' && booking.arrivalPrediction) {
      // Update arrival prediction with actual data
      booking.arrivalPrediction.actualArrivalTime = new Date(actualArrivalTime);
      booking.arrivalPrediction.wasOnTime = 
        new Date(actualArrivalTime) <= booking.arrivalPrediction.predictedArrivalTime;

      // Start parking
      booking.startParking(checkinLocation);

      // Update user behavior metrics
      await smartArrivalService.updateUserBehavior(userId, {
        bookingId: booking._id,
        predictedArrival: booking.arrivalPrediction.predictedArrivalTime,
        actualArrival: booking.arrivalPrediction.actualArrivalTime
      });

      // Track A/B testing arrival event
      abTestingService.trackBookingEvent(userId, 'arrival_recorded', {
        bookingMode: 'book_now',
        wasOnTime: booking.arrivalPrediction.wasOnTime,
        confidence: booking.arrivalPrediction.confidenceScore || 0
      });

      logger.info(`🎯 Smart booking completed for user ${userId}: ${booking.arrivalPrediction.wasOnTime ? 'ON TIME' : 'LATE'}`);
    }

    await booking.save();

    res.status(200).json({
      status: 'success',
      message: 'Smart booking completed successfully',
      data: {
        booking: {
          id: booking._id,
          status: booking.status,
          wasOnTime: booking.arrivalPrediction?.wasOnTime
        }
      }
    });

  } catch (error) {
    logger.error('Complete smart booking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Start transit tracking for smart booking
 */
const startTransitTracking = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { currentLocation } = req.body;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('parkingSpaceId', 'location name')
      .populate('userId', 'firstName lastName');
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }
    
    // Check if user owns the booking (handle both populated and unpopulated userId)
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found or unauthorized'
      });
    }

    // Allow tracking for all booking types (not just book_now)
    // if (booking.bookingMode !== 'book_now') {
    //   return res.status(400).json({
    //     status: 'error',
    //     message: 'Transit tracking only available for smart bookings'
    //   });
    // }

    // Import geo-fencing service
    const geoFencingService = require('../services/geoFencingService');

    // Get parking space coordinates
    const parkingSpaceLocation = {
      latitude: booking.parkingSpaceId.location.coordinates[1],
      longitude: booking.parkingSpaceId.location.coordinates[0]
    };

    // Start tracking session
    const session = geoFencingService.startTrackingSession(bookingId, parkingSpaceLocation);

    // Update booking with tracking data
    await Booking.findByIdAndUpdate(bookingId, {
      'trackingData.isActive': true,
      'trackingData.startedAt': new Date(),
      'trackingData.currentStatus': 'en_route',
      'trackingData.lastLocation': currentLocation ? {
        latitude: currentLocation.latitude,
        longitude: currentLocation.longitude,
        accuracy: currentLocation.accuracy || null,
        timestamp: new Date()
      } : null
    });

    logger.info(`🚗 Real-time tracking started for booking ${bookingId}`);

    res.status(200).json({
      status: 'success',
      message: 'Real-time tracking started',
      data: {
        bookingId: booking._id,
        trackingActive: true,
        destination: parkingSpaceLocation,
        trackingSession: {
          isActive: true,
          startedAt: session.startTime,
          currentStatus: 'en_route'
        },
        trackingFeatures: [
          'Real-time location updates',
          'Geo-fencing notifications',
          'Arrival detection',
          'Landlord notifications'
        ]
      }
    });

  } catch (error) {
    logger.error('Start transit tracking error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Update user location during transit
 */
const updateUserLocation = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { currentLocation, accuracy } = req.body;
    const userId = req.user.id;

    console.log('🔍 DEBUG: updateUserLocation called');
    console.log('📍 Booking ID:', bookingId);
    console.log('👤 User ID:', userId);
    console.log('📍 Location:', currentLocation);

    if (!currentLocation || !currentLocation.latitude || !currentLocation.longitude) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid current location required'
      });
    }

    const booking = await Booking.findById(bookingId)
      .populate('parkingSpaceId', 'location name landlordId')
      .populate('userId', 'firstName lastName phoneNumber')
      .populate('landlordId', 'firstName lastName phoneNumber');
    
    console.log('🔍 DEBUG: Booking lookup result:');
    console.log('📍 Booking found:', !!booking);
    if (booking) {
      console.log('📍 Booking user ID:', booking.userId.toString());
      console.log('📍 Request user ID:', userId);
      console.log('📍 User match:', booking.userId.toString() === userId);
    }
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }
    
    // Check if user owns the booking (handle both populated and unpopulated userId)
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    
    // Debug logging
    logger.info(`🔍 DEBUG: User ID comparison`);
    logger.info(`📍 Booking user ID: ${bookingUserId}`);
    logger.info(`📍 Request user ID: ${userId}`);
    logger.info(`📍 User match: ${bookingUserId === userId}`);
    logger.info(`📍 Booking user object:`, booking.userId);
    
    if (bookingUserId !== userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found or unauthorized'
      });
    }

    // Import geo-fencing service
    const geoFencingService = require('../services/geoFencingService');

    // Update user location and check geo-fence status
    let trackingResult = geoFencingService.updateUserLocation(
      bookingId,
      currentLocation.latitude,
      currentLocation.longitude,
      accuracy
    );

    // If no tracking session exists, create one automatically for active bookings
    if (!trackingResult) {
      logger.info(`No tracking session found for booking ${bookingId}, attempting to create one...`);

      // Check if this is an active booking that should be tracked
      if (['parked', 'accepted', 'confirmed'].includes(booking.status)) {
        try {
          // Auto-create tracking session for active bookings
          const parkingSpaceLocation = {
            latitude: booking.parkingSpaceId?.location?.coordinates[1],
            longitude: booking.parkingSpaceId?.location?.coordinates[0]
          };

          if (parkingSpaceLocation.latitude && parkingSpaceLocation.longitude) {
            // Start tracking session
            geoFencingService.startTrackingSession(bookingId, parkingSpaceLocation);

            // If user is already parked (status = parked/confirmed), start parking session too
            if (['parked', 'confirmed'].includes(booking.status)) {
              geoFencingService.startParkingSession(bookingId, parkingSpaceLocation, userId);
            }

            // Try location update again
            trackingResult = geoFencingService.updateUserLocation(
              bookingId,
              currentLocation.latitude,
              currentLocation.longitude,
              accuracy
            );

            logger.info(`✅ Auto-created tracking session for booking ${bookingId}`);
          }
        } catch (sessionError) {
          logger.error(`Failed to auto-create tracking session for booking ${bookingId}:`, sessionError);
        }
      }

      // If still no tracking result, return error
      if (!trackingResult) {
        return res.status(400).json({
          status: 'error',
          message: 'Unable to track location - booking may not be active or location data missing'
        });
      }
    }

    if (trackingResult?.session?.approachTracking) {
      try {
        await Booking.updateOne({ _id: bookingId }, {
          $set: {
            'arrivalPrediction.hasEnteredApproachZone': trackingResult.session.approachTracking.hasEnteredApproachZone,
            'arrivalPrediction.firstApproachTimestamp': trackingResult.session.approachTracking.firstApproachTimestamp,
            'arrivalPrediction.lastApproachTimestamp': trackingResult.session.approachTracking.lastApproachTimestamp,
            'arrivalPrediction.lastLocationStatus': trackingResult.session.approachTracking.lastStatus,
            'arrivalPrediction.noShowStatus': trackingResult.session.approachTracking.hasEnteredApproachZone ? 'cleared' : 'pending'
          }
        });

        if (trackingResult.session.approachTracking.hasEnteredApproachZone) {
          await noShowSchedulerService.cancelBooking(bookingId, { silent: true });
        }
      } catch (error) {
        logger.error(`❌ Failed to persist approach tracking for booking ${bookingId}:`, error);
      }
    }

    const { geoFenceStatus, shouldNotify } = trackingResult;

    // 💰 WALLET PAYMENT CAPTURE ON GEOFENCE ARRIVAL (Only for confirmed bookings)
    if (shouldNotify.arrived && booking.status === 'accepted') {
      // 🔍 DEBUG: Log booking pricing data to diagnose issue
      logger.info(`🔍 DEBUG: First-time arrival detected for booking ${bookingId} (Status: ${booking.status})`);
      logger.info(`📊 Booking pricing data:`, JSON.stringify(booking.pricing, null, 2));
      logger.info(`📊 walletHoldReference: ${booking.pricing?.walletHoldReference}`);
      logger.info(`📊 paymentStatus: ${booking.pricing?.paymentStatus}`);
      logger.info(`📊 Condition check: ${!!(booking.pricing?.walletHoldReference && booking.pricing?.paymentStatus === 'held')}`);
      
      try {
        const { Wallet } = require('../models/Wallet');
        
        if (booking.pricing?.walletHoldReference && booking.pricing?.paymentStatus === 'held') {
          const userWallet = await Wallet.findByUserId(userId);
          
          if (userWallet) {
            // Capture the wallet hold (convert to payment)
            await userWallet.captureHold(
              booking.pricing.walletHoldReference,
              `Payment captured - User arrived at ${booking.parkingSpaceId?.name || 'parking space'} (Geofencing)`
            );
            
            // Update booking payment status and mark as PARKED on arrival
            // Do NOT complete the booking here; completion happens on checkout
            await Booking.findByIdAndUpdate(bookingId, {
              $set: {
                'pricing.paymentStatus': 'captured',
                'pricing.isPaid': true,
                'pricing.paidAt': new Date(),
                'status': 'parked',
                'checkin.time': new Date(),
                'checkin.method': 'auto'
              }
            });

            await noShowSchedulerService.cancelBooking(bookingId, { silent: true });
            
            // Start parking session for auto-checkout detection
            geoFencingService.startParkingSession(bookingId, {
              latitude: booking.parkingSpaceId?.location?.coordinates[1],
              longitude: booking.parkingSpaceId?.location?.coordinates[0]
            }, userId);
            
            logger.info(`💳 Wallet payment captured via geofencing for booking ${bookingId}: ₱${booking.pricing.totalAmount}`);
            
            // 🏢 TRANSFER TO LANDLORD WALLET (if landlord has wallet)
            try {
              let landlordWallet = await Wallet.findByUserId(booking.landlordId);
              if (!landlordWallet) {
                // Create landlord wallet if it doesn't exist
                landlordWallet = await Wallet.createWallet(booking.landlordId, 0);
              }
              
              // Add credit transaction to landlord wallet with enhanced metadata
              const customerName = booking.userId?.firstName && booking.userId?.lastName 
                ? `${booking.userId.firstName} ${booking.userId.lastName}`
                : booking.userId?.firstName || 'Customer';
              const parkingSpaceName = booking.parkingSpaceId?.name || 'Parking Space';
              
              // Calculate correct amounts for distribution
              const totalAmount = booking.pricing.totalAmount;
              const serviceFee = booking.pricing.serviceFee || 0;
              const landlordAmount = totalAmount - serviceFee;
              
              const transferTransaction = {
                type: 'transfer_in',
                amount: landlordAmount,
                description: `Parking fee payment: ${customerName} at ${parkingSpaceName} (excludes ₱${serviceFee.toFixed(2)} service fee)`,
                bookingId: bookingId,
                status: 'completed',
                metadata: new Map([
                  ['fromUserId', userId],
                  ['customerName', customerName],
                  ['parkingSpaceName', parkingSpaceName],
                  ['parkingSpaceId', booking.parkingSpaceId?._id || booking.parkingSpaceId],
                  ['captureMethod', 'geofencing'],
                  ['arrivalTime', new Date().toISOString()],
                  ['bookingStartTime', booking.startTime?.toISOString()],
                  ['bookingEndTime', booking.endTime?.toISOString()],
                  ['totalBookingAmount', totalAmount],
                  ['serviceFeeAmount', serviceFee],
                  ['landlordAmount', landlordAmount]
                ])
              };
              
              await landlordWallet.addTransaction(transferTransaction);
              await landlordWallet.updateBalance(landlordAmount, 'credit');
              
              logger.info(`💰 Payment distributed via geofencing:
                Total: ₱${totalAmount}
                Landlord: ₱${landlordAmount} (to ${booking.landlordId})
                Platform: ₱${serviceFee} (service fee)`);
                
              // Update service fee tracking status
              try {
                const serviceFeeTrackingService = require('../services/serviceFeeTrackingService');
                await serviceFeeTrackingService.updatePaymentStatus(booking._id, 'paid');
              } catch (serviceFeeUpdateError) {
                logger.warn('Failed to update service fee status:', serviceFeeUpdateError.message);
              }
              
            } catch (transferError) {
              logger.error('Error transferring payment to landlord via geofencing:', transferError);
            }
          }
        } else {
          logger.info(`❌ Wallet hold condition not met - walletHoldReference: ${booking.pricing?.walletHoldReference}, paymentStatus: ${booking.pricing?.paymentStatus}`);
        }
      } catch (walletError) {
        logger.error('Error capturing wallet payment via geofencing:', walletError);
      }
      
      // 🎯 FALLBACK: Update status to 'parked' on arrival (only for confirmed bookings)
      if (booking.status === 'accepted') {
        try {
          const updateResult = await Booking.findByIdAndUpdate(bookingId, {
            $set: {
              'status': 'parked',
              'checkin.time': new Date(),
              'checkin.method': 'auto'
            }
          }, { new: true });
          
          if (updateResult) {
            logger.info(`✅ Booking status updated to 'parked' on first arrival for booking ${bookingId}`);
            logger.info(`📊 Updated booking status: ${updateResult.status}`);
          } else {
            logger.error(`❌ Failed to update booking ${bookingId} - booking not found`);
          }
          
          // Start parking session only if not already started
          if (!geoFencingService.activeParkingSessions.has(bookingId)) {
            geoFencingService.startParkingSession(bookingId, {
              latitude: booking.parkingSpaceId?.location?.coordinates[1],
              longitude: booking.parkingSpaceId?.location?.coordinates[0]
            }, userId);
          }

          await noShowSchedulerService.cancelBooking(bookingId, { silent: true });
        } catch (statusError) {
          logger.error('Error updating booking status on arrival:', statusError);
        }
      } else {
        logger.info(`🔄 Booking ${bookingId} already in ${booking.status} status - skipping arrival processing`);
      }
    }

    // 📱 Send SMS notifications for geofencing events (only for first-time arrival)
    if ((shouldNotify.arrived && booking.status === 'accepted') || shouldNotify.approaching) {
      try {
        // Send location update notification to landlord
        if (booking.parkingSpaceId.landlordId.phoneNumber) {
          const status = (shouldNotify.arrived && booking.status === 'accepted') ? 'arrived' : 'approaching';
          await smsService.sendUserLocationUpdate(
            booking.parkingSpaceId.landlordId.phoneNumber, 
            booking, 
            booking.userId, 
            status
          );
          logger.info(`📱 SMS sent to landlord for ${status} event (Booking status: ${booking.status})`);
        }
      } catch (smsError) {
        logger.error('📱 SMS notification error on geofencing event:', smsError);
      }
    } else if (shouldNotify.arrived && booking.status !== 'accepted') {
      logger.info(`📱 Skipping arrival SMS - booking already in ${booking.status} status`);
    }

    // 🚗 AUTO-CHECKOUT ON EXIT GEOFENCING WITH OVERTIME BILLING
    if (trackingResult.autoCheckout && shouldNotify.autoCheckout) {
      try {
        logger.info(`🚗 Auto-checkout triggered for booking ${bookingId} - User exited parking area (2nd exit)`);
        
        // 💰 CALCULATE OVERTIME BILLING
        const checkoutTime = new Date();
        const sessionDuration = checkoutTime - booking.checkin?.time || checkoutTime - booking.startTime;
        const sessionHours = sessionDuration / (1000 * 60 * 60); // Convert to hours
        const flatRateHours = booking.duration || 3; // Original booking duration (flat rate)
        
        let overtimeAmount = 0;
        let overtimeHours = 0;
        
        if (sessionHours > flatRateHours) {
          overtimeHours = Math.ceil(sessionHours - flatRateHours); // Round up partial hours
          const overtimeBaseRate = 15; // ₱15 per hour overtime
          const overtimeServiceFee = 2; // ₱2 service fee per hour
          overtimeAmount = overtimeHours * (overtimeBaseRate + overtimeServiceFee); // ₱17 per hour total
          
          logger.info(`⏰ OVERTIME DETECTED - Booking ${bookingId}:`);
          logger.info(`📊 Session Duration: ${sessionHours.toFixed(2)} hours`);
          logger.info(`📊 Flat Rate Period: ${flatRateHours} hours`);
          logger.info(`📊 Overtime Hours: ${overtimeHours} hours`);
          logger.info(`💰 Overtime Amount: ₱${overtimeAmount} (₱${overtimeBaseRate} + ₱${overtimeServiceFee} × ${overtimeHours}h)`);
        }
        
        // 💳 DEDUCT OVERTIME FROM WALLET IF APPLICABLE
        if (overtimeAmount > 0 && booking.pricing?.paymentMethod === 'wallet') {
          const { Wallet } = require('../models/Wallet');
          const userWallet = await Wallet.findByUserId(booking.userId._id);
          
          if (userWallet && userWallet.availableBalance >= overtimeAmount) {
            // Deduct overtime amount
            userWallet.availableBalance -= overtimeAmount;
            userWallet.transactions.push({
              type: 'debit',
              amount: overtimeAmount,
              bookingId: booking._id,
              description: `Overtime charges: ${overtimeHours}h × ₱17/h (Auto-checkout)`,
              status: 'completed',
              createdAt: new Date()
            });
            await userWallet.save();
            
            logger.info(`💳 Overtime charges deducted: ₱${overtimeAmount} from wallet`);
            
            // Transfer overtime to landlord wallet (if landlord has wallet)
            try {
              const landlordWallet = await Wallet.findByUserId(booking.landlordId._id);
              if (landlordWallet) {
                const landlordShare = overtimeAmount * 0.85; // 85% to landlord, 15% platform fee
                landlordWallet.availableBalance += landlordShare;
                landlordWallet.transactions.push({
                  type: 'credit',
                  amount: landlordShare,
                  bookingId: booking._id,
                  description: `Overtime earnings from ${booking.userId.firstName || 'user'}: ${overtimeHours}h × ₱17/h`,
                  status: 'completed',
                  createdAt: new Date()
                });
                await landlordWallet.save();
                logger.info(`💰 Overtime earnings transferred to landlord: ₱${landlordShare}`);
              }
            } catch (landlordTransferError) {
              logger.error('Error transferring overtime to landlord:', landlordTransferError);
            }
          } else {
            logger.warn(`❌ Insufficient wallet balance for overtime charges: ₱${overtimeAmount}`);
          }
        }
        
        // End parking session
        geoFencingService.endParkingSession(bookingId);
        
        // Update booking with overtime details
        const updateData = {
          'status': 'completed',
          'checkout.time': checkoutTime,
          'checkout.method': 'auto_geofence_exit',
          'checkout.location': {
            latitude: currentLocation.latitude,
            longitude: currentLocation.longitude
          },
          'checkout.sessionDuration': sessionHours,
          'checkout.overtimeHours': overtimeHours,
          'checkout.overtimeAmount': overtimeAmount
        };
        
        // Update total amount if overtime occurred
        if (overtimeAmount > 0) {
          updateData['pricing.overtimeAmount'] = overtimeAmount;
          updateData['pricing.finalTotalAmount'] = booking.pricing.totalAmount + overtimeAmount;
        }
        
        await Booking.findByIdAndUpdate(bookingId, { $set: updateData });
        
        // Send auto-checkout notification to user
        const smsService = require('../services/smsService');
        if (booking.userId?.phoneNumber) {
          await smsService.sendAutoCheckoutNotification(
            booking.userId.phoneNumber,
            booking,
            booking.parkingSpaceId,
            { overtimeHours, overtimeAmount }
          );
        }
        
        // Send auto-checkout notification to landlord
        if (booking.landlordId?.phoneNumber) {
          await smsService.sendLandlordAutoCheckoutNotification(
            booking.landlordId.phoneNumber,
            booking,
            booking.parkingSpaceId,
            booking.userId,
            { overtimeHours, overtimeAmount }
          );
        }
        
        logger.info(`✅ Auto-checkout completed for booking ${bookingId} with ${overtimeHours > 0 ? `${overtimeHours}h overtime` : 'no overtime'}`);

        // 📧 Send receipt email for auto-completed booking
        try {
          await receiptService.sendCompletionReceipt(bookingId);
          logger.info(`📧 Receipt email sent for auto-completed booking ${bookingId}`);
        } catch (receiptError) {
          logger.error('📧 Receipt email error on auto-checkout:', receiptError);
          // Don't fail the auto-checkout if receipt sending fails
        }

      } catch (autoCheckoutError) {
        logger.error(`❌ Auto-checkout failed for booking ${bookingId}:`, autoCheckoutError);
      }
    }

    // Send notifications to landlord if needed (only for first-time arrival)
    if (shouldNotify.approaching || (shouldNotify.arrived && booking.status === 'accepted')) {
      // Debug logging for notification data
      console.log('🔍 DEBUG: Notification data preparation');
      console.log('📍 Booking user data:', booking.userId);
      console.log('📍 Booking parking space data:', booking.parkingSpaceId);
      
      const notificationData = {
        type: (shouldNotify.arrived && booking.status === 'accepted') ? 'user_arrived' : 'user_approaching',
        bookingId: bookingId,
        userId: userId,
        parkingSpaceId: booking.parkingSpaceId._id,
        landlordId: booking.landlordId,
        user: {
          firstName: booking.userId.firstName,
          lastName: booking.userId.lastName,
          id: booking.userId._id
        },
        parkingSpace: {
          name: booking.parkingSpaceId.name,
          id: booking.parkingSpaceId._id
        },
        vehicleInfo: {
          vehicleType: booking.vehicleType,
          plateNumber: booking.vehicleDetails?.plateNumber,
          vehicleModel: booking.vehicleDetails?.vehicleModel,
          vehicleColor: booking.vehicleDetails?.vehicleColor
        },
        arrivalTime: new Date(),
        userLocation: currentLocation,
        geoFenceStatus: geoFenceStatus,
        message: geoFenceStatus.message,
        timestamp: new Date()
      };
      
      console.log('🔍 DEBUG: Final notification data:', JSON.stringify(notificationData, null, 2));

      // Send WebSocket notification to landlord
      const io = req.app.get('io');
      if (io) {
        io.to(`landlord_${booking.landlordId}`).emit('user_location_update', notificationData);
        logger.info(`Sent location update to landlord ${booking.landlordId}: ${geoFenceStatus.status} (Booking status: ${booking.status})`);
      }
      // Send push notification
      try {
        const notificationService = require('../services/notificationService');
        await notificationService.sendNotification(
          booking.landlordId,
          {
            title: (shouldNotify.arrived && booking.status === 'accepted') ? 'User Arrived!' : 'User Approaching',
            message: `${booking.userId.firstName} ${booking.userId.lastName} ${(shouldNotify.arrived && booking.status === 'accepted') ? 'has arrived at' : 'is approaching'} ${booking.parkingSpaceId.name}`,
            type: 'booking_started', // Use valid enum value
            category: 'booking', // Use valid enum value
            priority: 'high',
            relatedEntityId: bookingId,
            relatedEntityType: 'booking',
            channels: {
              push: { enabled: true },
              inApp: { enabled: true }
            },
            actionData: {
              actionType: 'view', // Use valid enum value
              actionText: 'View Booking',
              actionPayload: { bookingId: bookingId }
            },
            metadata: notificationData
          },
          {
            recipientType: 'landlord',
            overrideUserPreferences: true
          }
        );
      } catch (notificationError) {
        logger.error('Push notification error:', notificationError);
      }
    } else if (shouldNotify.arrived && booking.status !== 'accepted') {
      logger.info(`🔔 Skipping arrival notification - booking already in ${booking.status} status`);
    }

    // Update booking with location tracking data
    await Booking.findByIdAndUpdate(bookingId, {
      $push: {
        'trackingData.locationUpdates': {
          timestamp: new Date(),
          latitude: currentLocation.latitude,
          longitude: currentLocation.longitude,
          accuracy: accuracy
        }
      },
      $set: {
        'trackingData.lastLocation': currentLocation,
        'trackingData.lastUpdate': new Date(),
        'trackingData.currentStatus': geoFenceStatus.status
      }
    });

    // Check if payment was just captured
    let paymentProcessed = false;
    if (shouldNotify.arrived) {
      // Re-fetch booking to check if payment was captured
      const updatedBooking = await Booking.findById(bookingId);
      paymentProcessed = updatedBooking?.pricing?.paymentStatus === 'captured';
    }

    res.status(200).json({
      status: 'success',
      message: 'Location updated successfully',
      data: {
        bookingId,
        location: currentLocation,
        geoFenceStatus: geoFenceStatus,
        timestamp: new Date(),
        shouldNotify: shouldNotify,
        paymentProcessed: paymentProcessed
      }
    });

  } catch (error) {
    logger.error('Update location error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Handle user arrival at parking space
 */
const handleUserArrival = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { arrivalLocation } = req.body;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }
    
    // Check if user owns the booking (handle both populated and unpopulated userId)
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found or unauthorized'
      });
    }

    const actualArrivalTime = new Date();

    // ML data collection removed - using 30-minute fallback
    if (booking.bookingMode === 'book_now') {
      try {
        const geoFencingService = require('../services/geoFencingService');
        
        // End tracking session
        geoFencingService.endTrackingSession(bookingId);
        logger.info(`Arrival processed with 30-minute fallback for booking: ${bookingId}`);
      } catch (error) {
        logger.error(`Error ending tracking session: ${error.message}`);
        // Don't fail arrival processing if tracking session cleanup fails
      }
    }

    // Handle arrival in tracking service
    await realTimeTrackingService.handleUserArrival(bookingId, arrivalLocation);

    res.status(200).json({
      status: 'success',
      message: 'Arrival processed',
      data: {
        bookingId,
        arrivalTime: actualArrivalTime
      }
    });

  } catch (error) {
    logger.error('Handle arrival error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

/**
 * Manual check-in for bookings (transition from 'accepted' to 'parked')
 * @route POST /api/v1/bookings/:bookingId/checkin
 */
const manualCheckin = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check ownership
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized'
      });
    }

    // Check if booking is in a valid state for check-in
    if (booking.status !== 'accepted') {
      return res.status(400).json({
        status: 'error',
        message: `Cannot check-in booking with status: ${booking.status}`
      });
    }

    // Check if check-in is within valid time range (can check-in up to 1 hour before start time)
    const now = new Date();
    const bookingStart = new Date(booking.startTime);
    const bookingEnd = new Date(booking.endTime);
    const earlyCheckinAllowed = new Date(bookingStart.getTime() - (60 * 60 * 1000)); // 1 hour before

    if (now < earlyCheckinAllowed) {
      return res.status(400).json({
        status: 'error',
        message: 'Check-in is too early'
      });
    }

    if (now > bookingEnd) {
      return res.status(400).json({
        status: 'error',
        message: 'Booking has expired'
      });
    }

    // Update booking status to indicate user has arrived
    booking.status = 'parked'; 
    if (booking.pricing) {
      booking.pricing.isPaid = true;
      booking.pricing.paidAt = now;
      if (booking.pricing.paymentStatus === 'held') {
        booking.pricing.paymentStatus = 'captured';
      }
    }

    // Add check-in timestamp
    booking.checkinTime = now;
    booking.checkinMethod = 'manual';

    await booking.save();

    logger.info(`✅ Manual check-in completed for booking ${bookingId} by user ${userId}`);

    res.status(200).json({
      status: 'success',
      message: 'Successfully checked in',
      data: {
        bookingId,
        checkinTime: now,
        status: booking.status
      }
    });

  } catch (error) {
    logger.error('Manual check-in error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

/**
 * Get tracking status for a booking
 */
const getTrackingStatus = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }
    
    // Check if user owns the booking (handle both populated and unpopulated userId)
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found or unauthorized'
      });
    }

    const trackingData = realTimeTrackingService.getTrackingData(bookingId);

    res.status(200).json({
      status: 'success',
      data: {
        bookingId,
        isActive: trackingData?.isActive || false,
        startTime: trackingData?.startTime || null,
        lastUpdate: trackingData?.lastUpdate || null,
        etaHistory: trackingData?.etaHistory || []
      }
    });

  } catch (error) {
    logger.error('Get tracking status error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

// Test Google Maps API endpoint
const testGoogleMaps = async (req, res) => {
  try {
    const googleMapsService = require('../services/googleMapsService');
    const { origin, destination } = req.body;
    
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destinationStr = `${destination.latitude},${destination.longitude}`;
    
    logger.info(`🧪 Testing Google Maps API directly...`);
    const result = await googleMapsService.getTrafficInfo(originStr, destinationStr);
    
    res.json({
      status: 'success',
      message: 'Google Maps API test completed',
      data: {
        result,
        apiKey: process.env.GOOGLE_MAPS_API_KEY ? 'SET' : 'NOT SET'
      }
    });
  } catch (error) {
    logger.error('Google Maps test error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Google Maps API test failed',
      error: error.message
    });
  }
};

/**
 * Get current parking duration (real-time)
 * @route GET /api/v1/bookings/:bookingId/parking-duration
 */
const getCurrentParkingDuration = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }
    
    // Check ownership
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized'
      });
    }
    
    const durationInfo = booking.getCurrentParkingDuration();
    
    res.status(200).json({
      status: 'success',
      data: {
        bookingId,
        bookingMode: booking.bookingMode,
        status: booking.status,
        
        // Navigation window info (for reference only)
        navigationWindow: booking.bookingMode === 'book_now' ? {
          etaMinutes: booking.arrivalPrediction?.realETAMinutes,
          graceMinutes: booking.arrivalPrediction?.gracePeriodMinutes,
          totalWindowMinutes: booking.arrivalPrediction?.totalWindowMinutes,
          purpose: 'arrival_tracking_only' // NOT for billing
        } : null,
        
        // Actual parking session info (for billing)
        parkingSession: {
          isActive: durationInfo.isParked,
          startTime: booking.parkingSession?.startTime,
          currentDurationMinutes: durationInfo.durationMinutes,
          currentDurationHours: durationInfo.durationHours,
          overtimeMinutes: durationInfo.overtimeMinutes,
          estimatedAmount: durationInfo.estimatedAmount,
          arrivedWithinWindow: durationInfo.arrivedWithinWindow,
          
          // Billing breakdown
          billing: {
            standardRateMinutes: durationInfo.standardRateMinutes,
            standardRateAmount: booking.pricing?.totalAmount || 50,
            overtimeRate: 17, // ₱15 + ₱2 service fee per hour
            currentOvertimeAmount: durationInfo.overtimeMinutes > 0 ? 
              Math.ceil(durationInfo.overtimeMinutes / 60) * 17 : 0
          }
        }
      }
    });
    
  } catch (error) {
    logger.error('Get parking duration error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

/**
 * Manual check-in for smart booking (when user arrives)
 * @route POST /api/v1/bookings/:bookingId/check-in
 */
const manualCheckIn = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('parkingSpaceId', 'location name landlordId')
      .populate('userId', 'firstName lastName phoneNumber')
      .populate('landlordId', 'firstName lastName phoneNumber');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if user owns the booking
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized access to booking'
      });
    }

    // Check if booking is in correct status
    if (booking.status !== 'accepted') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking must be accepted to check in'
      });
    }

    // Update booking status to parked and start parking session
    const now = new Date();
    booking.status = 'parked';
    booking.parkingSession = {
      startTime: now,
      isActive: true,
      lastLocationUpdate: now,
      checkInMethod: 'automatic'
    };

    // For smart bookings, update the actual parked time
    if (booking.bookingMode === 'smart' || booking.bookingMode === 'book_now') {
      booking.startTime = now; // Update start time to actual parked time
      booking.smartBookingContext = booking.smartBookingContext || {};
      booking.smartBookingContext.actualParkedTime = now.toISOString();
      booking.smartBookingContext.parkedStatus = 'confirmed';
    }

    await booking.save();

    logger.info(`✅ Automatic check-in completed for booking ${bookingId} at ${now.toISOString()}`);

    res.status(200).json({
      status: 'success',
      message: 'Check-in successful',
      data: {
        bookingId: booking._id,
        status: booking.status,
        parkingSession: booking.parkingSession,
        startTime: booking.startTime
      }
    });

  } catch (error) {
    logger.error('Automatic check-in error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

/**
 * Manual check-out for QR scanning (when user leaves via QR)
 * @route POST /api/v1/bookings/:bookingId/check-out
 */
const manualCheckOut = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    const booking = await Booking.findById(bookingId)
      .populate('parkingSpaceId', 'location name landlordId')
      .populate('userId', 'firstName lastName phoneNumber')
      .populate('landlordId', 'firstName lastName phoneNumber');

    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if user owns the booking
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized access to booking'
      });
    }

    // Check if booking is in correct status
    if (booking.status !== 'parked') {
      return res.status(400).json({
        status: 'error',
        message: 'Booking must be parked to check out'
      });
    }

    // Update booking status to completed
    const now = new Date();
    booking.status = 'completed';
    booking.endTime = now;
    
    if (booking.parkingSession) {
      booking.parkingSession.endTime = now;
      booking.parkingSession.isActive = false;
      booking.parkingSession.checkOutMethod = 'qr_manual';
    }

    await booking.save();

    logger.info(`✅ Manual QR check-out completed for booking ${bookingId} at ${now.toISOString()}`);

    res.status(200).json({
      status: 'success',
      message: 'Check-out successful',
      data: {
        bookingId: booking._id,
        status: booking.status,
        endTime: booking.endTime
      }
    });

  } catch (error) {
    logger.error('Manual QR check-out error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};


/**
 * Start parking session (when user arrives and checks in)
 * @route POST /api/v1/bookings/:bookingId/start-parking
 */
const startParkingSession = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { arrivalLocation } = req.body;
    const userId = req.user.id;
    
    const booking = await Booking.findById(bookingId);
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }
    
    // Check ownership
    const bookingUserId = booking.userId._id ? booking.userId._id.toString() : booking.userId.toString();
    if (bookingUserId !== userId) {
      return res.status(403).json({
        status: 'error',
        message: 'Unauthorized'
      });
    }
    
    // Check if booking is in correct status
    if (booking.status !== 'accepted') {
      return res.status(400).json({
        status: 'error',
        message: `Cannot start parking session. Booking status is: ${booking.status}`
      });
    }
    
    // Start parking session - THIS IS WHERE BILLING BEGINS
    await booking.startParking(arrivalLocation);
    
    logger.info(`🚗 Parking session started for booking ${bookingId} - BILLING BEGINS NOW`);
    
    res.status(200).json({
      status: 'success',
      message: 'Parking session started successfully',
      data: {
        bookingId,
        sessionStartTime: booking.parkingSession.startTime,
        billingStartTime: booking.parkingSession.billing.billingStartTime,
        standardRateMinutes: booking.parkingSession.billing.standardRateMinutes,
        message: 'Billing has started based on actual parking time'
      }
    });
    
  } catch (error) {
    logger.error('Start parking session error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error'
    });
  }
};

module.exports = {
  analyzeSmartBooking,
  createBooking,
  acceptBooking,
  rejectBooking,
  getLandlordBookingRequests,
  getLandlordBookings,
  getUserBookings,
  cancelBooking,
  getBookingDetails,
  manualCheckout,
  manualCheckin,
  completeSmartBooking,
  startTransitTracking,
  updateUserLocation,
  handleUserArrival,
  getTrackingStatus,
  testGoogleMaps,
  getCurrentParkingDuration,
  startParkingSession,
  manualCheckIn,
  manualCheckOut
}; 