/**
 * Booking Expiration Routes
 * API endpoints for handling expired booking scenarios and resolutions
 */

const express = require('express');
const router = express.Router();
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const bookingExpirationService = require('../services/bookingExpirationService');
const logger = require('../config/logger');

/**
 * Analyze booking expiration status
 * @route GET /api/v1/booking-expiration/analyze/:bookingId
 * @desc Get detailed expiration analysis for a booking
 * @access Private (Landlord, Admin)
 */
router.get('/analyze/:bookingId', authenticateToken, catchAsync(async (req, res, next) => {
  const { bookingId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role || 'landlord';

  logger.info(`📊 Expiration analysis requested for booking ${bookingId} by ${userRole} ${userId}`);

  try {
    const analysis = await bookingExpirationService.analyzeBookingExpiration(
      bookingId, 
      userId, 
      userRole
    );

    res.status(200).json({
      status: 'success',
      message: 'Booking expiration analysis completed',
      data: {
        bookingId,
        expiration: analysis,
        canGenerate: analysis.canGenerate,
        requiresResolution: analysis.requiresConfirmation,
        recommendedAction: analysis.action,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`❌ Error analyzing expiration for booking ${bookingId}:`, error);
    
    if (error.message.includes('Unauthorized')) {
      return next(new AppError(error.message, 403));
    } else if (error.message.includes('not found')) {
      return next(new AppError(error.message, 404));
    } else {
      return next(new AppError('Failed to analyze booking expiration', 500));
    }
  }
}));

/**
 * Execute expiration resolution
 * @route POST /api/v1/booking-expiration/resolve/:bookingId
 * @desc Execute a resolution option for an expired booking
 * @access Private (Landlord, Admin)
 */
router.post('/resolve/:bookingId', authenticateToken, catchAsync(async (req, res, next) => {
  const { bookingId } = req.params;
  const { resolutionId, options = {} } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role || 'landlord';

  if (!resolutionId) {
    return next(new AppError('Resolution ID is required', 400));
  }

  logger.info(`🛠️ Resolution execution requested: ${resolutionId} for booking ${bookingId} by ${userRole} ${userId}`);

  try {
    const result = await bookingExpirationService.executeResolution(
      bookingId,
      resolutionId,
      userId,
      userRole,
      options
    );

    // Different response based on resolution type
    let statusCode = 200;
    let message = 'Resolution executed successfully';

    if (resolutionId === 'generate_overtime') {
      statusCode = 200;
      message = 'QR generation approved with calculated charges';
    } else if (resolutionId === 'manual_checkout') {
      statusCode = 200;
      message = 'Manual checkout completed successfully';
    } else if (resolutionId === 'mark_abandoned') {
      statusCode = 200;
      message = 'Booking marked as abandoned';
    } else if (resolutionId === 'contact_support') {
      statusCode = 202;
      message = 'Support ticket created successfully';
    }

    res.status(statusCode).json({
      status: 'success',
      message,
      data: {
        bookingId,
        resolution: result,
        nextSteps: getNextSteps(resolutionId, result),
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`❌ Error executing resolution ${resolutionId} for booking ${bookingId}:`, error);
    
    if (error.message.includes('Unauthorized') || error.message.includes('privileges')) {
      return next(new AppError(error.message, 403));
    } else if (error.message.includes('not found') || error.message.includes('not available')) {
      return next(new AppError(error.message, 404));
    } else if (error.message.includes('Invalid resolution')) {
      return next(new AppError(error.message, 400));
    } else {
      return next(new AppError('Failed to execute resolution', 500));
    }
  }
}));

/**
 * Get landlord's expiration summary
 * @route GET /api/v1/booking-expiration/summary
 * @desc Get summary of all bookings with expiration status
 * @access Private (Landlord, Admin)
 */
router.get('/summary', authenticateToken, catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const userRole = req.user.role || 'landlord';

  logger.info(`📋 Expiration summary requested by ${userRole} ${userId}`);

  try {
    const summary = await bookingExpirationService.getExpirationSummary(userId);

    res.status(200).json({
      status: 'success',
      message: 'Expiration summary retrieved successfully',
      data: {
        summary,
        generatedAt: new Date().toISOString(),
        landlordId: userId
      }
    });

  } catch (error) {
    logger.error(`❌ Error getting expiration summary for ${userId}:`, error);
    return next(new AppError('Failed to get expiration summary', 500));
  }
}));

/**
 * Get available resolution options for a booking
 * @route GET /api/v1/booking-expiration/options/:bookingId
 * @desc Get available resolution options without full analysis
 * @access Private (Landlord, Admin)
 */
router.get('/options/:bookingId', authenticateToken, catchAsync(async (req, res, next) => {
  const { bookingId } = req.params;
  const userId = req.user.id;
  const userRole = req.user.role || 'landlord';

  try {
    // Get quick analysis to determine options
    const analysis = await bookingExpirationService.analyzeBookingExpiration(
      bookingId, 
      userId, 
      userRole
    );

    res.status(200).json({
      status: 'success',
      message: 'Resolution options retrieved successfully',
      data: {
        bookingId,
        status: analysis.status,
        canGenerate: analysis.canGenerate,
        requiresResolution: analysis.requiresConfirmation,
        options: analysis.resolutionOptions,
        charges: analysis.charges,
        message: analysis.message
      }
    });

  } catch (error) {
    logger.error(`❌ Error getting resolution options for booking ${bookingId}:`, error);
    
    if (error.message.includes('Unauthorized')) {
      return next(new AppError(error.message, 403));
    } else if (error.message.includes('not found')) {
      return next(new AppError(error.message, 404));
    } else {
      return next(new AppError('Failed to get resolution options', 500));
    }
  }
}));

/**
 * Bulk expiration analysis for multiple bookings
 * @route POST /api/v1/booking-expiration/bulk-analyze
 * @desc Analyze multiple bookings for expiration status
 * @access Private (Landlord, Admin)
 */
router.post('/bulk-analyze', authenticateToken, catchAsync(async (req, res, next) => {
  const { bookingIds } = req.body;
  const userId = req.user.id;
  const userRole = req.user.role || 'landlord';

  if (!bookingIds || !Array.isArray(bookingIds) || bookingIds.length === 0) {
    return next(new AppError('Booking IDs array is required', 400));
  }

  if (bookingIds.length > 50) {
    return next(new AppError('Maximum 50 bookings can be analyzed at once', 400));
  }

  logger.info(`📊 Bulk expiration analysis requested for ${bookingIds.length} bookings by ${userRole} ${userId}`);

  try {
    const results = [];
    const errors = [];

    for (const bookingId of bookingIds) {
      try {
        const analysis = await bookingExpirationService.analyzeBookingExpiration(
          bookingId, 
          userId, 
          userRole
        );
        results.push({
          bookingId,
          status: 'success',
          analysis: {
            status: analysis.status,
            canGenerate: analysis.canGenerate,
            requiresResolution: analysis.requiresConfirmation,
            charges: analysis.charges,
            message: analysis.message
          }
        });
      } catch (error) {
        errors.push({
          bookingId,
          status: 'error',
          error: error.message
        });
      }
    }

    res.status(200).json({
      status: 'success',
      message: `Bulk analysis completed. ${results.length} successful, ${errors.length} errors.`,
      data: {
        results,
        errors,
        summary: {
          total: bookingIds.length,
          successful: results.length,
          failed: errors.length
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`❌ Error in bulk expiration analysis:`, error);
    return next(new AppError('Failed to perform bulk analysis', 500));
  }
}));

/**
 * Admin-only: Override expiration rules
 * @route POST /api/v1/booking-expiration/admin-override/:bookingId
 * @desc Administrative override for complex expiration cases
 * @access Private (Admin only)
 */
router.post('/admin-override/:bookingId', authenticateToken, requireAdmin, catchAsync(async (req, res, next) => {
  const { bookingId } = req.params;
  const { action, reason, charges } = req.body;
  const userId = req.user.id;

  if (!action || !reason) {
    return next(new AppError('Action and reason are required for admin override', 400));
  }

  logger.info(`⚡ Admin override requested for booking ${bookingId} by admin ${userId}: ${action}`);

  try {
    const result = await bookingExpirationService.executeResolution(
      bookingId,
      'admin_override',
      userId,
      'admin',
      {
        overrideAction: action,
        overrideReason: reason,
        overrideCharges: charges
      }
    );

    res.status(200).json({
      status: 'success',
      message: 'Administrative override applied successfully',
      data: {
        bookingId,
        override: result,
        appliedBy: userId,
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    logger.error(`❌ Error applying admin override for booking ${bookingId}:`, error);
    return next(new AppError('Failed to apply administrative override', 500));
  }
}));

/**
 * Helper function to provide next steps based on resolution
 */
function getNextSteps(resolutionId, result) {
  switch (resolutionId) {
    case 'generate_overtime':
      return [
        'QR code generation is now allowed',
        'Generate QR code using the standard endpoint',
        'Extra charges will be automatically applied',
        'User will see updated total when scanning QR'
      ];

    case 'manual_checkout':
      return [
        'Booking has been marked as completed',
        'User has been notified of checkout',
        'Extra charges have been processed',
        'No further action required'
      ];

    case 'mark_abandoned':
      return [
        'Booking has been marked as abandoned',
        'Penalty charges have been applied',
        'Parking space is now available',
        'User will be notified of abandonment'
      ];

    case 'contact_support':
      return [
        `Support ticket created: ${result.result.supportTicket?.ticketId}`,
        'Customer support has been notified',
        'You will be contacted within 24 hours',
        'Monitor ticket status in support dashboard'
      ];

    case 'admin_override':
      return [
        'Administrative override has been applied',
        'Resolution has been logged for audit',
        'User and landlord have been notified',
        'No further action required'
      ];

    default:
      return ['Resolution completed successfully'];
  }
}

module.exports = router;
