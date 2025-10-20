const { validationResult } = require('express-validator');
const smartBookingService = require('../services/smartBookingService');
const dynamicPricingService = require('../services/dynamicPricingService');
const walletService = require('../services/walletService');
const noShowSchedulerService = require('../services/noShowSchedulerService');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const { catchAsync, AppError, createValidationError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const { getHongKongTime } = require('../utils/dateTime');

// Import fetch for Node.js (if not available globally)
const fetch = require('node-fetch') || globalThis.fetch;

// Google Routes API ETA calculation with traffic awareness
async function calculateETAToParking(fromLat, fromLng, toLat, toLng) {
  const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY || "AIzaSyDPcpTxLOh52BWvMXu9CqOSVDXG9eC6klI";
  const URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
  
  try {
    // Headers for Google Routes API
    const headers = {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": GOOGLE_API_KEY,
      "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.travelAdvisory"
    };

     // Departure time: now +5 seconds (RFC3339 format) - Google requires future time with buffer
     const departureTime = new Date(Date.now() + 5000).toISOString();

    // Request payload
    const payload = {
      origin: {
        location: {
          latLng: {
            latitude: fromLat,
            longitude: fromLng
          }
        }
      },
      destination: {
        location: {
          latLng: {
            latitude: toLat,
            longitude: toLng
          }
        }
      },
      travelMode: "DRIVE",
      routingPreference: "TRAFFIC_AWARE",
      departureTime: departureTime
    };

    logger.info(`🗺️ Calculating ETA using Google Routes API from (${fromLat}, ${fromLng}) to (${toLat}, ${toLng})`);

    logger.info(`🌐 Making Google Routes API request:`, JSON.stringify(payload, null, 2));
    
    const response = await fetch(URL, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify(payload)
    });

    if (response.ok) {
      const data = await response.json();
      
      if (data.routes && data.routes.length > 0) {
        const route = data.routes[0];
        const duration = route.duration || "0s";
        const distance = route.distanceMeters || 0;
        const advisory = route.travelAdvisory || {};
        const trafficDelay = advisory.trafficInfo?.delay || "0s";
        
        // Parse duration (format: "1402s" -> 1402 seconds)
        const durationSeconds = parseInt(duration.replace('s', ''));
        const etaMinutes = Math.ceil(durationSeconds / 60);
        
        // Parse traffic delay
        const delaySeconds = parseInt(trafficDelay.replace('s', ''));
        const delayMinutes = Math.ceil(delaySeconds / 60);
        
        logger.info(`✅ Google Routes API Result:`);
        logger.info(`- Distance: ${distance} meters`);
        logger.info(`- Duration (base): ${duration} (${etaMinutes} minutes)`);
        logger.info(`- Traffic delay: ${trafficDelay} (${delayMinutes} minutes)`);
        
        // Return total ETA including traffic delay
        const totalETA = Math.max(5, Math.min(120, etaMinutes)); // Min 5 min, max 2 hours
        
        return {
          etaMinutes: totalETA,
          distance: distance,
          baseTime: etaMinutes - delayMinutes,
          trafficDelay: delayMinutes,
          realTime: true,
          source: 'google_routes_api'
        };
      } else {
        logger.warn('⚠️ No route found in Google Routes API response');
        return await fallbackETACalculation(fromLat, fromLng, toLat, toLng);
      }
    } else {
      const errorText = await response.text();
      logger.warn(`❌ Google Routes API Error ${response.status}: ${errorText}`);
      
      // If 400 error (invalid timestamp), retry without departureTime
      if (response.status === 400) {
        logger.info('🔄 Retrying without departureTime (average ETA)...');
        delete payload.departureTime;
        
        const retryResponse = await fetch(URL, {
          method: 'POST',
          headers: headers,
          body: JSON.stringify(payload)
        });
        
        if (retryResponse.ok) {
          const retryData = await retryResponse.json();
          if (retryData.routes && retryData.routes.length > 0) {
            const route = retryData.routes[0];
            const duration = route.duration || "0s";
            const durationSeconds = parseInt(duration.replace('s', ''));
            const etaMinutes = Math.ceil(durationSeconds / 60);
            
            logger.info(`✅ Google Routes API Retry Result: ${etaMinutes} minutes`);
            
            return {
              etaMinutes: Math.max(5, Math.min(120, etaMinutes)),
              distance: route.distanceMeters || 0,
              baseTime: etaMinutes,
              trafficDelay: 0,
              realTime: true,
              source: 'google_routes_api_retry'
            };
          }
        }
      }
      
      return await fallbackETACalculation(fromLat, fromLng, toLat, toLng);
    }
  } catch (error) {
    logger.error('❌ Google Routes API calculation failed:', error.message);
    logger.error('📍 Coordinates:', { fromLat, fromLng, toLat, toLng });
    return await fallbackETACalculation(fromLat, fromLng, toLat, toLng);
  }
}

// Fallback ETA calculation using simple distance
async function fallbackETACalculation(fromLat, fromLng, toLat, toLng) {
  try {
    // Calculate distance using Haversine formula
    const R = 6371; // Earth's radius in kilometers
    const dLat = (toLat - fromLat) * Math.PI / 180;
    const dLng = (toLng - fromLng) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(fromLat * Math.PI / 180) * Math.cos(toLat * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c; // Distance in kilometers
    
    // Estimate travel time (assuming average speed of 20 km/h in city traffic)
    const averageSpeed = 20; // km/h
    const etaHours = distance / averageSpeed;
    const etaMinutes = Math.ceil(etaHours * 60);
    
    const fallbackETA = Math.max(5, Math.min(60, etaMinutes));
    
    logger.info(`🔄 Using fallback ETA calculation: ${fallbackETA} minutes`);
    
    return {
      etaMinutes: fallbackETA,
      distance: distance * 1000, // Convert to meters
      baseTime: fallbackETA,
      trafficDelay: 0,
      realTime: false,
      source: 'fallback_calculation'
    };
  } catch (error) {
    logger.warn('Fallback ETA calculation failed, using default:', error.message);
    return {
      etaMinutes: 20,
      distance: 0,
      baseTime: 20,
      trafficDelay: 0,
      realTime: false,
      source: 'default_fallback'
    };
  }
}

/**
 * Get smart booking recommendations
 */
const getSmartRecommendations = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.error('Smart booking validation failed:', errors.array());
    return next(createValidationError(errors));
  }

  const {
    destinationLat,
    destinationLng,
    bookingTime = new Date(),
    duration = 3, // Changed to 3 hours (minimum for standard rate)
    preference = 'balanced',
    searchRadius = 1000
  } = req.query;

  logger.info('🎯 Smart booking request:', {
    destinationLat: parseFloat(destinationLat),
    destinationLng: parseFloat(destinationLng),
    bookingTime,
    duration: parseInt(duration),
    preference,
    searchRadius: parseInt(searchRadius),
    userId: req.user?.id || 'anonymous'
  });

  try {
    const recommendations = await smartBookingService.getSmartRecommendations({
      destinationLat: parseFloat(destinationLat),
      destinationLng: parseFloat(destinationLng),
      bookingTime: new Date(bookingTime),
      duration: parseInt(duration),
      preference,
      searchRadius: parseInt(searchRadius)
    });

    logger.info('✅ Smart booking recommendations generated:', {
      success: recommendations.success,
      totalSpaces: recommendations.spaces?.length || 0,
      preference: recommendations.preference
    });

    res.status(200).json({
      status: 'success',
      data: recommendations
    });

  } catch (error) {
    logger.error('❌ Smart booking error:', {
      error: error.message,
      stack: error.stack,
      destinationLat,
      destinationLng,
      preference
    });
    
    return next(new AppError('Failed to get smart recommendations', 500));
  }
});

/**
 * Create smart booking with wallet hold
 */
const createSmartBooking = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const {
    spaceId,
    destinationLat,
    destinationLng,
    userCurrentLat,
    userCurrentLng,
    preference = 'balanced',
    duration = 3, // Standard 3-hour rate for smart booking
    bookingTime,
    totalAmount,
    vehicleId,
    userNotes
  } = req.body;

  logger.info(`🎯 Creating smart booking for user ${userId}:`, {
    spaceId,
    destinationLat,
    destinationLng,
    preference,
    duration,
    totalAmount
  });
  
  logger.info(`📍 Coordinate validation:`);
  logger.info(`   Destination: ${destinationLat}, ${destinationLng} (${typeof destinationLat}, ${typeof destinationLng})`);
  logger.info(`   User Current: ${userCurrentLat}, ${userCurrentLng} (${typeof userCurrentLat}, ${typeof userCurrentLng})`);

  try {
    // Validate parking space
    const parkingSpace = await ParkingSpace.findById(spaceId);
    if (!parkingSpace) {
      return next(new AppError('Parking space not found', 404));
    }

    if (parkingSpace.status !== 'active' || !parkingSpace.isVerified) {
      return next(new AppError('Parking space is not available', 400));
    }

    // Calculate booking times with ETA first (needed for availability check)
    const startTime = bookingTime ? new Date(bookingTime) : getHongKongTime();

    // Validate operating hours for booking time
    const operatingStatus = parkingSpace.getOperatingStatus(startTime);
    if (!operatingStatus.isOpen) {
      logger.warn(`🕐 Smart booking rejected - parking space closed: ${operatingStatus.message}`);
      return next(new AppError(`Parking space is closed: ${operatingStatus.message}`, 400));
    }

    logger.info(`✅ Operating hours validated: ${operatingStatus.message}`);
    
    // Calculate ETA from user's current location to parking space using Google Routes API
    const fromLat = userCurrentLat || destinationLat; // Use user current location if available, fallback to destination
    const fromLng = userCurrentLng || destinationLng;
    
    logger.info(`🎯 Starting ETA calculation from USER LOCATION (${fromLat}, ${fromLng}) to PARKING SPACE (${parkingSpace.latitude}, ${parkingSpace.longitude})`);
    
    const etaData = await calculateETAToParking(fromLat, fromLng, parkingSpace.latitude, parkingSpace.longitude);
    
    logger.info(`📊 ETA calculation result:`, etaData);
    
    const etaMinutes = etaData.etaMinutes;
    const gracePeriodMinutes = 15; // 15-minute grace period for production
    const totalWindowMinutes = etaMinutes + gracePeriodMinutes; // ETA + grace period
    const maxArrivalWindow = new Date(startTime.getTime() + (totalWindowMinutes * 60 * 1000));
    
    // No-show check should happen at the end of grace period (which is already in maxArrivalWindow)
    const noShowCheckTime = maxArrivalWindow; // ETA + 15min grace period
    
    logger.info(`⏰ Time calculations: startTime=${startTime.toISOString()}, etaMinutes=${etaMinutes}, gracePeriod=${gracePeriodMinutes}min, noShowCheckTime=${noShowCheckTime.toISOString()}`);

    // For smart bookings, end time is the exact arrival time (no grace period)
    const endTime = maxArrivalWindow;

    // Check slot availability for the calculated time window
    const conflicts = await Booking.checkConflicts(
      spaceId,
      startTime,
      endTime
    );

    const occupiedSlots = conflicts.length;
    const totalSlots = parkingSpace.totalSpots || 1;
    const availableSlots = Math.max(0, totalSlots - occupiedSlots);

    logger.info(`🔍 Smart booking availability check: ${availableSlots}/${totalSlots} slots available (${occupiedSlots} occupied)`);

    if (availableSlots === 0) {
      return next(new AppError('No available slots for this time window. All spots are booked.', 400));
    }

    // Validate minimum duration requirement
    const manilaGovernmentPricingService = require('../services/manilaGovernmentPricingService');
    const durationValidation = manilaGovernmentPricingService.validateBookingDuration(duration);
    
    if (!durationValidation.isValid) {
      return next(new AppError(durationValidation.message, 400));
    }

    // Get vehicle information if vehicleId is provided
    let vehicleInfo = {
      vehicleType: 'car', // default
      plateNumber: 'UNKNOWN' // default fallback
    };

    // Import Vehicle model at the top level to avoid repeated requires
    const Vehicle = require('../models/Vehicle');

    if (vehicleId) {
      try {
        const vehicle = await Vehicle.findById(vehicleId);
        logger.info(`🔍 Looking up vehicle by ID: ${vehicleId}`);
        if (vehicle) {
          logger.info(`✅ Found vehicle: ${vehicle.plateNumber} (${vehicle.vehicleType})`);
          vehicleInfo = {
            vehicleType: vehicle.vehicleType,
            plateNumber: vehicle.plateNumber,
            vehicleColor: vehicle.color,
            vehicleModel: `${vehicle.brand} ${vehicle.model}`
          };
        } else {
          logger.warn(`❌ Vehicle not found with ID: ${vehicleId}`);
        }
      } catch (error) {
        logger.warn(`Failed to get vehicle info for ${vehicleId}:`, error.message);
        // Use defaults if vehicle lookup fails
      }
    } else {
      // If no vehicleId provided, try to get user's default vehicle
      try {
        logger.info(`🔍 Looking for default vehicle for user: ${userId}`);
        const defaultVehicle = await Vehicle.findOne({ 
          userId, 
          isDefault: true, 
          status: 'active' 
        });
        
        if (defaultVehicle) {
          logger.info(`✅ Found default vehicle: ${defaultVehicle.plateNumber} (${defaultVehicle.vehicleType})`);
          vehicleInfo = {
            vehicleType: defaultVehicle.vehicleType,
            plateNumber: defaultVehicle.plateNumber,
            vehicleColor: defaultVehicle.color,
            vehicleModel: `${defaultVehicle.brand} ${defaultVehicle.model}`
          };
        } else {
          // Try to get any active vehicle for the user
          logger.info(`🔍 No default vehicle found, looking for any active vehicle for user: ${userId}`);
          const anyVehicle = await Vehicle.findOne({ 
            userId, 
            status: 'active' 
          }).sort({ createdAt: -1 }); // Get the most recent one
          
          if (anyVehicle) {
            logger.info(`✅ Found active vehicle: ${anyVehicle.plateNumber} (${anyVehicle.vehicleType})`);
            vehicleInfo = {
              vehicleType: anyVehicle.vehicleType,
              plateNumber: anyVehicle.plateNumber,
              vehicleColor: anyVehicle.color,
              vehicleModel: `${anyVehicle.brand} ${anyVehicle.model}`
            };
          } else {
            logger.warn(`❌ No vehicles found for user: ${userId}`);
          }
        }
      } catch (error) {
        logger.warn(`Failed to get default vehicle for user ${userId}:`, error.message);
      }
    }

    logger.info(`🚗 Final vehicle info for booking:`, vehicleInfo);

    // Calculate new tiered pricing with service fees
    const pricingDetails = await dynamicPricingService.calculateDynamicPrice(
      spaceId,
      startTime,
      duration,
      vehicleInfo.vehicleType
    );

    logger.info(`💰 Calculated pricing details:`, {
      vehicleType: vehicleInfo.vehicleType,
      duration,
      baseParkingFee: pricingDetails.baseParkingFee,
      dynamicParkingFee: pricingDetails.dynamicParkingFee,
      serviceFee: pricingDetails.serviceFee,
      totalPrice: pricingDetails.totalPrice
    });

    // Use calculated total price instead of frontend-provided amount
    const calculatedTotalAmount = pricingDetails.totalPrice;

    // Hold the calculated amount in wallet
    const holdResult = await walletService.holdAmount(
      userId,
      calculatedTotalAmount,
      null, // We'll update this with booking ID after creating the booking
      `Smart booking hold for ${parkingSpace.name}`
    );

    if (!holdResult.success) {
      return next(new AppError(holdResult.error || 'Failed to hold amount in wallet', 400));
    }

    // Create the booking with all required fields
    logger.info(`💾 Creating booking with ETA data:`, {
      etaMinutes,
      gracePeriodMinutes,
      maxArrivalWindow: maxArrivalWindow.toISOString(),
      etaDataSource: etaData.source
    });
    
    const booking = new Booking({
      userId,
      parkingSpaceId: spaceId,
      landlordId: parkingSpace.landlordId, // Required field: get from parking space
      vehicleId: vehicleId || null,
      startTime,
      endTime,
      duration, // Required field: duration in hours
      vehicleInfo, // Required field: vehicle information
      status: 'accepted', // Valid enum value for auto-accepted smart bookings
      pricing: {
        hourlyRate: pricingDetails.basePrice, // Base tiered rate
        baseParkingFee: pricingDetails.baseParkingFee,
        dynamicParkingFee: pricingDetails.dynamicParkingFee,
        serviceFee: pricingDetails.serviceFee,
        totalAmount: calculatedTotalAmount, // Use calculated amount
        paymentMethod: 'wallet',
        paymentStatus: 'held',
        walletHoldReference: holdResult.holdReference, // Add this for wallet capture
        demandFactor: pricingDetails.demandFactor,
        pricingModel: 'tiered_with_service_fee'
      },
      bookingType: 'smart',
      bookingMode: 'smart', // Add bookingMode for frontend detection
      userNotes: userNotes || `Smart booking via ${preference} preference`,
      smartBookingData: {
        destinationLat: parseFloat(destinationLat),
        destinationLng: parseFloat(destinationLng),
        preference,
        searchRadius: 1000,
        isSmartBooking: true,
        originalDuration: duration
      },
      // Add arrival prediction with Google Routes API data
      arrivalPrediction: {
        realETAMinutes: etaMinutes,
        gracePeriodMinutes: gracePeriodMinutes,
        maxArrivalWindow: maxArrivalWindow,
        noShowCheckTime: noShowCheckTime, // When to check for no-show
        totalWindowMinutes: totalWindowMinutes,
        userCurrentLocation: {
          latitude: parseFloat(fromLat),
          longitude: parseFloat(fromLng),
          timestamp: startTime
        },
        predictedArrivalTime: maxArrivalWindow,
        factors: {
          baseTime: etaData.baseTime,
          realTime: etaData.realTime,
          trafficDelay: etaData.trafficDelay,
          distance: etaData.distance,
          fallback: !etaData.realTime,
          reason: `ETA calculated using ${etaData.source}`,
          trafficFactor: etaData.trafficDelay > 0 ? (etaData.trafficDelay / etaData.baseTime) : 0
        }
      },
      holdReference: holdResult.holdReference,
      autoAccepted: true, // Smart bookings are auto-accepted
      landlordResponse: {
        action: 'auto_accepted',
        message: 'Smart booking automatically accepted',
        respondedAt: getHongKongTime()
      },
      createdAt: getHongKongTime(),
      updatedAt: getHongKongTime()
    });

    await booking.save();
    
    // Schedule no-show evaluation
    await noShowSchedulerService.scheduleBooking(booking._id, noShowCheckTime);

    logger.info(`✅ Booking saved with ID: ${booking._id}`);
    logger.info(`📊 Saved booking arrivalPrediction:`, booking.arrivalPrediction);

    // Update the hold transaction with the booking ID
    await walletService.updateHoldWithBookingId(holdResult.holdReference, booking._id);

    // Record service fee for tracking app revenue
    try {
      if (pricingDetails.serviceFeeBreakdown) {
        const serviceFeeTrackingService = require('../services/serviceFeeTrackingService');
        await serviceFeeTrackingService.recordServiceFee({
          bookingId: booking._id,
          parkingSpaceId: spaceId,
          userId: userId,
          landlordId: parkingSpace.landlordId,
          baseParkingFee: pricingDetails.dynamicParkingFee,
          serviceFeeBreakdown: pricingDetails.serviceFeeBreakdown,
          vehicleType: vehicleInfo.vehicleType,
          vehicleCategory: pricingDetails.vehicleCategory,
          bookingDuration: duration,
          bookingType: 'smart',
          bookingDate: startTime
        });
      } else {
        logger.warn('Service fee breakdown not available for tracking');
      }
    } catch (serviceFeeError) {
      logger.warn('Failed to record service fee:', serviceFeeError.message);
      // Don't fail the booking if service fee recording fails
    }

    // Update parking space availability
    parkingSpace.availableSpots -= 1;
    await parkingSpace.save();

    logger.info(`✅ Smart booking created successfully:`, {
      bookingId: booking._id,
      holdReference: holdResult.holdReference,
      amount: calculatedTotalAmount,
      pricingModel: 'tiered_with_service_fee'
    });

    // Helper function to format time
    const formatTime = (date) => {
      return date.toLocaleTimeString('en-US', { 
        hour: 'numeric', 
        minute: '2-digit', 
        hour12: true 
      });
    };

    // Build response data with smart booking context
    const responseData = {
      booking: {
        id: booking._id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        totalAmount: calculatedTotalAmount,
        status: booking.status,
        paymentStatus: booking.paymentStatus,
        holdReference: booking.holdReference,
        bookingMode: 'smart' // Indicate this is a smart booking
      },
      parkingSpace: {
        id: parkingSpace._id,
        name: parkingSpace.name,
        address: parkingSpace.address,
        availableSpots: parkingSpace.availableSpots
      },
      pricingBreakdown: {
        vehicleType: vehicleInfo.vehicleType,
        vehicleCategory: pricingDetails.vehicleCategory,
        duration: duration,
        minimumHours: 3,
        baseParkingFee: pricingDetails.baseParkingFee,
        dynamicParkingFee: pricingDetails.dynamicParkingFee,
        serviceFee: pricingDetails.serviceFee,
        serviceFeeBreakdown: pricingDetails.serviceFeeBreakdown,
        totalAmount: calculatedTotalAmount,
        demandFactor: pricingDetails.demandFactor,
        pricingModel: 'tiered_with_service_fee'
      },
      wallet: holdResult.newBalance
    };

    // Add smart booking context with real ETA data (no grace period)
    responseData.smartBookingContext = {
      isSmartBooking: true,
      bookingTime: booking.startTime,
      etaMinutes: etaMinutes,
      graceMinutes: gracePeriodMinutes, // 15 minutes for production
      arrivalWindow: maxArrivalWindow,
      preference: preference,
      calculation: `${formatTime(booking.startTime)} + ${etaMinutes}min (ETA) + ${gracePeriodMinutes}min grace = ${formatTime(maxArrivalWindow)} arrival window`,
      billingNote: 'Billing starts only when you arrive and park',
      displayInfo: {
        showDuration: false, // Don't show fixed duration for smart bookings
        showEndTime: false,  // Don't show fixed end time for smart bookings
        billingType: 'usage_based'
      }
    };

    res.status(201).json({
      status: 'success',
      message: 'Smart booking created successfully with new tiered pricing',
      data: responseData
    });

  } catch (error) {
    logger.error(`❌ Failed to create smart booking:`, error);
    return next(new AppError('Failed to create booking', 500));
  }
});

/**
 * Get dynamic pricing for a specific space
 */
const getDynamicPricing = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const {
    bookingTime = new Date(),
    duration = 3, // Updated minimum to 3 hours
    vehicleType = 'car' // Default to car if not specified
  } = req.query;

  // Validate minimum duration
  const manilaGovernmentPricingService = require('../services/manilaGovernmentPricingService');
  const durationValidation = manilaGovernmentPricingService.validateBookingDuration(parseInt(duration));
  
  if (!durationValidation.isValid) {
    return next(new AppError(durationValidation.message, 400));
  }

  const pricing = await dynamicPricingService.calculateDynamicPrice(
    spaceId,
    new Date(bookingTime),
    parseInt(duration),
    vehicleType
  );

  res.status(200).json({
    status: 'success',
    data: {
      parkingSpaceId: spaceId,
      pricing,
      minimumDuration: manilaGovernmentPricingService.getMinimumBookingHours(),
      message: 'Dynamic pricing calculated with new tiered structure'
    }
  });
});

/**
 * Get price predictions for next few hours
 */
const getPricePrediction = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const { hoursAhead = 6 } = req.query;

  const predictions = await dynamicPricingService.getPricePrediction(
    spaceId,
    parseInt(hoursAhead)
  );

  res.status(200).json({
    status: 'success',
    data: {
      parkingSpaceId: spaceId,
      predictions
    }
  });
});

/**
 * Compare traditional vs smart booking options
 */
const compareBookingOptions = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const {
    destinationLat,
    destinationLng,
    selectedSpaceId,
    bookingTime = new Date(),
    duration = 3 // Standard 3-hour rate for smart booking
  } = req.body;

  const comparison = {
    destination: { lat: destinationLat, lng: destinationLng },
    bookingTime,
    duration
  };

  // Get smart booking recommendations
  const smartOptions = await smartBookingService.getSmartRecommendations({
    destinationLat: parseFloat(destinationLat),
    destinationLng: parseFloat(destinationLng),
    bookingTime: new Date(bookingTime),
    duration: parseInt(duration),
    preference: 'balanced'
  });

  comparison.smartBooking = {
    available: smartOptions.success,
    bestOption: smartOptions.success ? smartOptions.spaces[0] : null,
    totalOptions: smartOptions.success ? smartOptions.spaces.length : 0,
    insights: smartOptions.insights || null
  };

  // Get traditional booking option if space ID provided
  if (selectedSpaceId) {
    try {
      const selectedSpace = await ParkingSpace.findById(selectedSpaceId);
      if (selectedSpace) {
        const pricing = await dynamicPricingService.calculateDynamicPrice(
          selectedSpaceId,
          new Date(bookingTime),
          parseInt(duration),
          'car' // Default to car for comparison - could be enhanced to use actual vehicle type
        );

        // Calculate distance from destination
        const distance = smartBookingService.calculateDistance(
          destinationLat,
          destinationLng,
          selectedSpace.location.coordinates[1],
          selectedSpace.location.coordinates[0]
        );

        comparison.traditionalBooking = {
          available: true,
          parkingSpace: selectedSpace,
          pricing,
          distance: Math.round(distance * 1000), // meters
          walkingTime: Math.round(distance * 1000 / 80) // minutes
        };

        // Compare savings
        if (smartOptions.success && smartOptions.spaces[0]) {
          const smartPrice = smartOptions.spaces[0].pricing.totalPrice;
          const traditionalPrice = pricing.totalPrice;
          
          comparison.savings = {
            amount: traditionalPrice - smartPrice,
            percentage: traditionalPrice > 0 ? Math.round(((traditionalPrice - smartPrice) / traditionalPrice) * 100) : 0,
            recommendation: smartPrice < traditionalPrice ? 'smart' : 'traditional'
          };
        }
      }
    } catch (error) {
      logger.error('Traditional booking comparison error:', error);
      comparison.traditionalBooking = {
        available: false,
        error: 'Selected space not available'
      };
    }
  }

  res.status(200).json({
    status: 'success',
    data: comparison
  });
});

/**
 * Get available spaces count for a destination (enhanced with time filtering)
 */
const getAvailableSpacesCount = catchAsync(async (req, res, next) => {
  const {
    destinationLat,
    destinationLng,
    searchRadius = 1000,
    checkTime // Optional: specific time to check availability for
  } = req.query;

  if (!destinationLat || !destinationLng) {
    return next(new AppError('Destination coordinates are required', 400));
  }

  // Parse check time if provided
  const timeToCheck = checkTime ? new Date(checkTime) : new Date();

  logger.info('🎯 Getting available spaces count:', {
    destinationLat: parseFloat(destinationLat),
    destinationLng: parseFloat(destinationLng),
    searchRadius: parseInt(searchRadius),
    checkTime: timeToCheck.toISOString()
  });

  const count = await smartBookingService.getAvailableSpacesCount(
    parseFloat(destinationLat),
    parseFloat(destinationLng),
    parseInt(searchRadius),
    timeToCheck
  );

  // Also get total spaces in DB for debugging
  const totalSpaces = await ParkingSpace.countDocuments({ status: 'active' });
  const verifiedSpaces = await ParkingSpace.countDocuments({ status: 'active', isVerified: true });
  const availableSpaces = await ParkingSpace.countDocuments({ 
    status: 'active', 
    isVerified: true, 
    availableSpots: { $gt: 0 } 
  });

  logger.info('📊 Database stats:', {
    totalActiveSpaces: totalSpaces,
    verifiedSpaces,
    availableSpaces,
    foundNearDestination: count
  });

  res.status(200).json({
    status: 'success',
    data: {
      count,
      destination: { lat: parseFloat(destinationLat), lng: parseFloat(destinationLng) },
      searchRadius: parseInt(searchRadius),
      debug: {
        totalActiveSpaces: totalSpaces,
        verifiedSpaces,
        availableSpaces
      }
    }
  });
});

/**
 * Get all parking spaces for debugging
 */
const getAllParkingSpaces = catchAsync(async (req, res, next) => {
  const allSpaces = await ParkingSpace.find({})
    .select('name address latitude longitude status isVerified availableSpots totalSpots pricePerHour')
    .sort({ createdAt: -1 })
    .limit(50);

  const totalSpaces = await ParkingSpace.countDocuments();
  const activeSpaces = await ParkingSpace.countDocuments({ status: 'active' });
  const verifiedSpaces = await ParkingSpace.countDocuments({ status: 'active', isVerified: true });
  const availableSpaces = await ParkingSpace.countDocuments({ 
    status: 'active', 
    isVerified: true, 
    availableSpots: { $gt: 0 } 
  });

  // University of the East coordinates for distance calculation
  const ueCoords = { lat: 14.5997, lng: 120.9821 };
  
  // Add distance from UE to each space
  const spacesWithDistance = allSpaces.map(space => {
    const distance = calculateDistance(
      ueCoords.lat, ueCoords.lng,
      space.latitude, space.longitude
    ) * 1000; // Convert to meters
    
    return {
      ...space.toObject(),
      distanceFromUE: Math.round(distance)
    };
  }).sort((a, b) => a.distanceFromUE - b.distanceFromUE);

  res.status(200).json({
    status: 'success',
    data: {
      summary: {
        totalSpaces,
        activeSpaces,
        verifiedSpaces,
        availableSpaces
      },
      universityOfEast: ueCoords,
      spaces: spacesWithDistance
    }
  });
});

// Helper function for distance calculation
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

/**
 * Check for no-shows in smart bookings (scheduled job)
 * @route POST /api/v1/smart-booking/check-no-shows
 */
module.exports = {
  getSmartRecommendations,
  createSmartBooking,
  getDynamicPricing,
  getPricePrediction,
  compareBookingOptions,
  getAvailableSpacesCount,
  getAllParkingSpaces
};

