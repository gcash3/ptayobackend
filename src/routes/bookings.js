const express = require('express');
const { body, query, param } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const bookingController = require('../controllers/bookingController');
const violationTrackingService = require('../services/violationTrackingService');

const router = express.Router();

// Validation rules
const createBookingValidation = [
  body('parkingSpaceId').isMongoId().withMessage('Invalid parking space ID'),
  body('startTime').isISO8601().withMessage('Start time must be a valid date'),
  body('endTime').isISO8601().withMessage('End time must be a valid date'),
  body('vehicleId').isMongoId().withMessage('Vehicle ID is required'),
  body('userNotes').optional().isString().withMessage('Notes must be a string'),
  validateRequest
];

const bookingIdValidation = [
  param('bookingId').isMongoId().withMessage('Invalid booking ID'),
  validateRequest
];

const paginationValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('status').optional().isIn(['pending', 'accepted', 'rejected', 'checked_in', 'parked', 'checked_out', 'completed', 'cancelled', 'expired', 'no_show']).withMessage('Invalid status'),
  validateRequest
];

// Smart booking validation rules
const smartBookingAnalysisValidation = [
  body('parkingSpaceId').isMongoId().withMessage('Invalid parking space ID'),
  body('userCurrentLocation').isObject().withMessage('Current location is required'),
  body('userCurrentLocation.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('userCurrentLocation.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  body('vehicleId').isMongoId().withMessage('Vehicle ID is required'),
  validateRequest
];

const enhancedCreateBookingValidation = [
  body('parkingSpaceId').isMongoId().withMessage('Invalid parking space ID'),
  body('vehicleId').isMongoId().withMessage('Vehicle ID is required'),
  body('bookingMode').optional().isIn(['reservation', 'book_now']).withMessage('Invalid booking mode'),
  // Conditional validation based on booking mode
  body('startTime').if(body('bookingMode').equals('reservation')).isISO8601().withMessage('Start time required for reservation mode'),
  body('endTime').if(body('bookingMode').equals('reservation')).isISO8601().withMessage('End time required for reservation mode'),
  body('userCurrentLocation').if(body('bookingMode').equals('book_now')).isObject().withMessage('Current location required for smart booking'),
  body('arrivalPrediction').if(body('bookingMode').equals('book_now')).isObject().withMessage('Arrival prediction required for smart booking'),
  body('userNotes').optional().isString().withMessage('Notes must be a string'),
  validateRequest
];

const completeSmartBookingValidation = [
  ...bookingIdValidation,
  body('actualArrivalTime').isISO8601().withMessage('Actual arrival time is required'),
  body('checkinLocation').optional().isObject().withMessage('Check-in location must be an object'),
  validateRequest
];

// Routes

/**
 * @route   POST /api/v1/bookings/analyze-smart
 * @desc    Analyze smart booking feasibility
 * @access  Private (User)
 */
router.post('/analyze-smart', smartBookingAnalysisValidation, bookingController.analyzeSmartBooking);

/**
 * @route   POST /api/v1/bookings
 * @desc    Create a new booking request (supports both reservation and smart booking)
 * @access  Private (User)
 */
router.post('/', enhancedCreateBookingValidation, bookingController.createBooking);

/**
 * @route   GET /api/v1/bookings
 * @desc    Get user's bookings
 * @access  Private (User)
 */
router.get('/', paginationValidation, bookingController.getUserBookings);

/**
 * @route   GET /api/v1/bookings/requests
 * @desc    Get landlord's booking requests (pending bookings)
 * @access  Private (Landlord)
 */
router.get('/requests', paginationValidation, bookingController.getLandlordBookingRequests);

/**
 * @route   GET /api/v1/bookings/:bookingId
 * @desc    Get booking details
 * @access  Private (User/Landlord)
 */
router.get('/:bookingId', bookingIdValidation, bookingController.getBookingDetails);

/**
 * @route   PATCH /api/v1/bookings/:bookingId/accept
 * @desc    Landlord accepts a booking request
 * @access  Private (Landlord)
 */
router.patch('/:bookingId/accept', [
  ...bookingIdValidation,
  body('message').optional().isString().withMessage('Message must be a string'),
  validateRequest
], bookingController.acceptBooking);

/**
 * @route   PATCH /api/v1/bookings/:bookingId/reject
 * @desc    Landlord rejects a booking request
 * @access  Private (Landlord)
 */
router.patch('/:bookingId/reject', [
  ...bookingIdValidation,
  body('reason').optional().isString().withMessage('Reason must be a string'),
  validateRequest
], bookingController.rejectBooking);

/**
 * @route   PATCH /api/v1/bookings/:bookingId/cancel
 * @desc    Cancel a booking
 * @access  Private (User/Landlord)
 */
router.patch('/:bookingId/cancel', [
  ...bookingIdValidation,
  body('reason').optional().isString().withMessage('Reason must be a string'),
  validateRequest
], bookingController.cancelBooking);

/**
 * @route   POST /api/v1/bookings/:bookingId/checkin
 * @desc    Manual check-in for booking (transition from 'accepted' to 'parked')
 * @access  Private (User)
 */
router.post('/:bookingId/checkin', bookingIdValidation, bookingController.manualCheckin);

/**
 * @route   POST /api/v1/bookings/:bookingId/checkout
 * @desc    Manual checkout for booking (fallback when geofencing fails)
 * @access  Private (User)
 */
router.post('/:bookingId/checkout', bookingIdValidation, bookingController.manualCheckout);

/**
 * @route   POST /api/v1/bookings/:bookingId/check-in
 * @desc    Smart booking automatic check-in (when user arrives)
 * @access  Private (User)
 */
router.post('/:bookingId/check-in', bookingIdValidation, bookingController.manualCheckIn);

/**
 * @route   POST /api/v1/bookings/:bookingId/check-out
 * @desc    Manual check-out for QR scanning (when user leaves via QR)
 * @access  Private (User)
 */
router.post('/:bookingId/check-out', bookingIdValidation, bookingController.manualCheckOut);

/**
 * @route   POST /api/v1/bookings/:bookingId/complete-smart
 * @desc    Complete a smart booking and update user behavior
 * @access  Private (User)
 */
router.post('/:bookingId/complete-smart', completeSmartBookingValidation, bookingController.completeSmartBooking);

/**
 * @route   POST /api/v1/bookings/:bookingId/start-tracking
 * @desc    Start transit tracking for a smart booking
 * @access  Private (User)
 */
router.post('/:bookingId/start-tracking', [
  ...bookingIdValidation,
  body('currentLocation').optional().isObject().withMessage('Current location must be an object'),
  validateRequest
], bookingController.startTransitTracking);

/**
 * @route   PUT /api/v1/bookings/:bookingId/location
 * @desc    Update user location during transit
 * @access  Private (User)
 */
router.put('/:bookingId/location', [
  ...bookingIdValidation,
  body('currentLocation').isObject().withMessage('Current location is required'),
  body('currentLocation.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('currentLocation.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  validateRequest
], bookingController.updateUserLocation);

/**
 * @route   POST /api/v1/bookings/:bookingId/arrival
 * @desc    Handle user arrival at parking space
 * @access  Private (User)
 */
router.post('/:bookingId/arrival', [
  ...bookingIdValidation,
  body('arrivalLocation').isObject().withMessage('Arrival location is required'),
  body('arrivalLocation.latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('arrivalLocation.longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  validateRequest
], bookingController.handleUserArrival);

/**
 * @route   GET /api/v1/bookings/:bookingId/tracking
 * @desc    Get tracking status for a booking
 * @access  Private (User)
 */
router.get('/:bookingId/tracking', bookingIdValidation, bookingController.getTrackingStatus);

/**
 * @route   GET /api/v1/bookings/:bookingId/parking-duration
 * @desc    Get current parking duration (real-time)
 * @access  Private (User)
 */
router.get('/:bookingId/parking-duration', bookingIdValidation, bookingController.getCurrentParkingDuration);

/**
 * @route   POST /api/v1/bookings/:bookingId/start-parking
 * @desc    Start parking session (when user arrives)
 * @access  Private (User)
 */
router.post('/:bookingId/start-parking', [
  ...bookingIdValidation,
  body('arrivalLocation').optional().isObject().withMessage('Arrival location must be an object'),
  body('arrivalLocation.latitude').optional().isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
  body('arrivalLocation.longitude').optional().isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
  validateRequest
], bookingController.startParkingSession);

/**
 * @route   POST /api/v1/bookings/test-google-maps
 * @desc    Test Google Maps API directly
 * @access  Private (Testing)
 */
router.post('/test-google-maps', [
  body('origin.latitude').isFloat().withMessage('Origin latitude is required'),
  body('origin.longitude').isFloat().withMessage('Origin longitude is required'),
  body('destination.latitude').isFloat().withMessage('Destination latitude is required'),
  body('destination.longitude').isFloat().withMessage('Destination longitude is required'),
  validateRequest
], bookingController.testGoogleMaps);

/**
 * @route   POST /api/v1/bookings/:bookingId/cancel
 * @desc    Cancel a booking with refund calculation
 * @access  Private (User)
 */
router.post('/:bookingId/cancel', [
  param('bookingId').isMongoId().withMessage('Invalid booking ID'),
  body('reason').optional().isString().withMessage('Reason must be a string'),
  validateRequest
], async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const { reason = 'User cancelled' } = req.body;
    const userId = req.user.id;

    // Find the booking
    const Booking = require('../models/Booking');
    const booking = await Booking.findOne({ _id: bookingId, userId });
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Check if booking can be cancelled
    if (booking.status !== 'confirmed' && booking.status !== 'pending') {
      return res.status(400).json({
        status: 'error',
        message: `Cannot cancel booking with status: ${booking.status}`
      });
    }

    // Process cancellation
    const cancellationResult = await violationTrackingService.processCancellation(booking, reason);

    res.status(200).json({
      status: 'success',
      message: 'Booking cancelled successfully',
      data: {
        bookingId: booking._id,
        refund: cancellationResult.refundCalculation,
        walletProcessed: cancellationResult.walletProcessed
      }
    });

  } catch (error) {
    next(error);
  }
});

/**
 * @route   GET /api/v1/bookings/:bookingId/violation-info
 * @desc    Get violation information for a booking
 * @access  Private (User)
 */
router.get('/:bookingId/violation-info', [
  param('bookingId').isMongoId().withMessage('Invalid booking ID'),
  validateRequest
], async (req, res, next) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;

    // Get user's violation summary
    const violationSummary = await violationTrackingService.getUserViolationSummary(userId);
    
    // Calculate potential refund if they no-show
    const { getHongKongTime } = require('../utils/dateTime');
    const currentTime = getHongKongTime();
    
    const Booking = require('../models/Booking');
    const booking = await Booking.findOne({ _id: bookingId, userId });
    
    if (!booking) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found'
      });
    }

    // Calculate cancellation refund
    const scheduledTime = new Date(booking.startTime);
    const minutesBeforeBooking = Math.max(0, (scheduledTime.getTime() - currentTime.getTime()) / (1000 * 60));
    const cancellationRefund = await violationTrackingService.calculateCancellationRefund(booking, minutesBeforeBooking);

    res.status(200).json({
      status: 'success',
      data: {
        userViolations: violationSummary,
        currentBooking: {
          id: booking._id,
          totalAmount: booking.totalAmount,
          scheduledTime: booking.startTime,
          minutesUntilBooking: Math.max(0, minutesBeforeBooking)
        },
        refundInfo: {
          cancellationRefund,
          noShowRefund: {
            refundPercentage: violationSummary.refundPercentage,
            refundAmount: (booking.totalAmount * violationSummary.refundPercentage) / 100,
            penaltyAmount: booking.totalAmount - (booking.totalAmount * violationSummary.refundPercentage) / 100
          }
        }
      }
    });

  } catch (error) {
    next(error);
  }
});

module.exports = router; 