const ViolationTracking = require('../models/ViolationTracking');
const CancellationPolicy = require('../models/CancellationPolicy');
const walletService = require('./walletService');
const logger = require('../config/logger');
const { getHongKongTime, isUserLateForBooking, getMinutesLate } = require('../utils/dateTime');

class ViolationTrackingService {
  /**
   * Check if user is a no-show for their booking
   * @param {Object} booking - Booking object
   * @returns {Object} No-show check result
   */
  async checkNoShow(booking) {
    try {
      const currentTime = getHongKongTime();
      const scheduledTime = new Date(booking.startTime);
      
      // Get active cancellation policy
      const policy = await CancellationPolicy.getActivePolicy();
      if (!policy) {
        throw new Error('No active cancellation policy found');
      }

      // Check if user is late beyond grace period
      const isLate = isUserLateForBooking(scheduledTime, policy.noShowGracePeriod);
      const minutesLate = getMinutesLate(scheduledTime);

      if (isLate) {
        logger.info(`🚨 No-show detected for booking ${booking._id}. User is ${minutesLate} minutes late.`);
        
        // Process the no-show violation
        const violationResult = await this.processNoShowViolation(booking, minutesLate);
        
        return {
          isNoShow: true,
          minutesLate,
          violationProcessed: violationResult.success,
          refundAmount: violationResult.refundAmount,
          penaltyAmount: violationResult.penaltyAmount
        };
      }

      return {
        isNoShow: false,
        minutesLate: Math.max(0, minutesLate),
        withinGracePeriod: minutesLate <= policy.noShowGracePeriod
      };

    } catch (error) {
      logger.error(`❌ Error checking no-show for booking ${booking._id}:`, error);
      throw error;
    }
  }

  /**
   * Process a no-show violation
   * @param {Object} booking - Booking object
   * @param {Number} minutesLate - How many minutes late the user was
   * @returns {Object} Violation processing result
   */
  async processNoShowViolation(booking, minutesLate) {
    try {
      // Extract user ID (handle both populated and unpopulated cases)
      const userId = booking.userId?._id || booking.userId;
      
      if (!userId) {
        logger.warn(`⚠️ Skipping booking ${booking._id} - no valid userId, marking as no_show to prevent reprocessing`);
        
        // Mark this booking as no_show to prevent it from being checked again
        try {
          booking.status = 'no_show';
          booking.violationData = {
            type: 'no_show',
            note: 'Automatically marked as no-show due to missing userId',
            processedAt: new Date()
          };
          await booking.save();
          logger.info(`✅ Marked corrupted booking ${booking._id} as no_show`);
        } catch (saveError) {
          logger.error(`❌ Failed to update corrupted booking ${booking._id}:`, saveError);
        }
        
        return {
          success: false,
          reason: 'No valid userId - booking marked as no_show',
          violationTier: 0,
          refundPercentage: 0,
          refundAmount: 0,
          penaltyAmount: 0,
          walletProcessed: false
        };
      }

      logger.info(`⚖️ Processing no-show violation for user ${userId}, booking ${booking._id}`);

      // Find or create violation tracking for user
      const violationTracking = await ViolationTracking.findOrCreateForUser(userId);

      // Get cancellation policy
      const policy = await CancellationPolicy.getActivePolicy();

      // Get the original amount (handle different booking formats)
      const originalAmount = booking.pricing?.totalAmount || booking.totalAmount || 0;
      
      if (originalAmount <= 0) {
        logger.error(`❌ Invalid booking amount for ${booking._id}: ${originalAmount}`);
        throw new Error('Valid booking amount is required for violation processing');
      }

      logger.info(`💰 Processing violation for amount: PHP ${originalAmount}`);

      // Calculate refund based on violation tier
      const refundCalculation = violationTracking.calculateRefund(originalAmount);

      // Add the violation
      const violationData = {
        bookingId: booking._id,
        violationType: 'no_show',
        scheduledTime: booking.startTime,
        actualTime: null, // No-show means they never arrived
        minutesLate,
        refundPercentage: refundCalculation.refundPercentage,
        originalAmount: refundCalculation.originalAmount,
        refundAmount: refundCalculation.refundAmount,
        penaltyAmount: refundCalculation.penaltyAmount,
        status: 'pending'
      };

      await violationTracking.addViolation(violationData);

      // Process the refund in wallet
      let walletResult = { success: false };
      
      if (booking.holdReference && refundCalculation.refundAmount > 0) {
        try {
          // Release the held amount with partial refund
          walletResult = await walletService.releaseHeldAmount(
            userId.toString(),
            booking.holdReference,
            refundCalculation.refundAmount,
            `No-show refund (${refundCalculation.refundPercentage}%) - Violation #${violationTracking.totalViolations}`
          );
        } catch (walletError) {
          logger.error(`❌ Wallet refund failed for no-show:`, walletError);
        }
      }

      // Update booking status
      booking.status = 'no_show';
      
      // Update pricing payment status (handle both formats)
      if (booking.pricing) {
        booking.pricing.paymentStatus = 'partially_refunded'; // ✅ VALID enum value
      } else {
        booking.paymentStatus = 'partially_refunded'; // ✅ VALID enum value
      }
      
      booking.violationData = {
        type: 'no_show',
        minutesLate,
        refundPercentage: refundCalculation.refundPercentage,
        refundAmount: refundCalculation.refundAmount,
        penaltyAmount: refundCalculation.penaltyAmount,
        originalAmount: refundCalculation.originalAmount,
        processedAt: getHongKongTime()
      };
      await booking.save();

      logger.info(`📝 Booking ${booking._id} marked as no-show and penalty applied`);

      logger.info(`✅ No-show violation processed:`, {
        bookingId: booking._id,
        violationTier: violationTracking.currentTier,
        refundPercentage: refundCalculation.refundPercentage,
        refundAmount: refundCalculation.refundAmount,
        penaltyAmount: refundCalculation.penaltyAmount
      });

      return {
        success: true,
        violationTier: violationTracking.currentTier,
        refundPercentage: refundCalculation.refundPercentage,
        refundAmount: refundCalculation.refundAmount,
        penaltyAmount: refundCalculation.penaltyAmount,
        walletProcessed: walletResult.success
      };

    } catch (error) {
      logger.error(`❌ Failed to process no-show violation:`, error);
      throw error;
    }
  }

  /**
   * Calculate refund for booking cancellation
   * @param {Object} booking - Booking object
   * @param {Number} minutesBeforeBooking - How many minutes before booking
   * @returns {Object} Refund calculation
   */
  async calculateCancellationRefund(booking, minutesBeforeBooking) {
    try {
      const policy = await CancellationPolicy.getActivePolicy();
      if (!policy) {
        throw new Error('No active cancellation policy found');
      }

      const refundCalculation = policy.getRefundAmount(
        booking.totalAmount,
        0, // Not a violation-based refund
        true, // This is a cancellation
        minutesBeforeBooking
      );

      return refundCalculation;

    } catch (error) {
      logger.error(`❌ Error calculating cancellation refund:`, error);
      throw error;
    }
  }

  /**
   * Process booking cancellation
   * @param {Object} booking - Booking object
   * @param {String} reason - Cancellation reason
   * @returns {Object} Cancellation result
   */
  async processCancellation(booking, reason = 'User cancelled') {
    try {
      logger.info(`🚫 Processing cancellation for booking ${booking._id}`);

      const currentTime = getHongKongTime();
      const scheduledTime = new Date(booking.startTime);
      const minutesBeforeBooking = Math.max(0, (scheduledTime.getTime() - currentTime.getTime()) / (1000 * 60));

      // Calculate refund
      const refundCalculation = await this.calculateCancellationRefund(booking, minutesBeforeBooking);

      // Process wallet refund
      let walletResult = { success: false };
      
      if (booking.holdReference && refundCalculation.refundAmount > 0) {
        try {
          walletResult = await walletService.releaseHeldAmount(
            booking.userId.toString(),
            booking.holdReference,
            refundCalculation.refundAmount,
            `Booking cancellation refund (${refundCalculation.refundPercentage}%)`
          );
        } catch (walletError) {
          logger.error(`❌ Wallet refund failed for cancellation:`, walletError);
        }
      }

      // Update booking status
      booking.status = 'cancelled';
      booking.paymentStatus = refundCalculation.isFullRefund ? 'refunded' : 'partial_refund';
      booking.cancellationData = {
        reason,
        minutesBeforeBooking,
        refundPercentage: refundCalculation.refundPercentage,
        refundAmount: refundCalculation.refundAmount,
        penaltyAmount: refundCalculation.penaltyAmount,
        processedAt: currentTime
      };
      await booking.save();

      logger.info(`✅ Cancellation processed:`, {
        bookingId: booking._id,
        refundPercentage: refundCalculation.refundPercentage,
        refundAmount: refundCalculation.refundAmount
      });

      return {
        success: true,
        refundCalculation,
        walletProcessed: walletResult.success
      };

    } catch (error) {
      logger.error(`❌ Failed to process cancellation:`, error);
      throw error;
    }
  }

  /**
   * Record a successful booking completion (good behavior)
   * @param {String} userId - User ID
   * @param {String} bookingId - Booking ID
   * @returns {Object} Success result
   */
  async recordGoodBooking(userId, bookingId) {
    try {
      const violationTracking = await ViolationTracking.findOrCreateForUser(userId);
      await violationTracking.recordGoodBooking();

      logger.info(`✅ Good booking recorded for user ${userId}. Consecutive good bookings: ${violationTracking.consecutiveGoodBookings}`);

      return {
        success: true,
        consecutiveGoodBookings: violationTracking.consecutiveGoodBookings,
        violationsReset: violationTracking.currentTier === 0
      };

    } catch (error) {
      logger.error(`❌ Error recording good booking:`, error);
      throw error;
    }
  }

  /**
   * Get user's violation summary
   * @param {String} userId - User ID
   * @returns {Object} Violation summary
   */
  async getUserViolationSummary(userId) {
    try {
      return await ViolationTracking.getUserViolationSummary(userId);
    } catch (error) {
      logger.error(`❌ Error getting violation summary:`, error);
      throw error;
    }
  }

  /**
   * Check all pending bookings for no-shows (scheduled job)
   * @returns {Object} Batch processing result
   */
  async checkAllPendingBookingsForNoShows() {
    try {
      logger.info('🔍 Starting batch no-show check...');

      const Booking = require('../models/Booking');
      const currentTime = getHongKongTime();

      // Find bookings that might be no-shows
      // Check bookings that:
      // 1. Are in 'accepted' status (auto-accepted smart bookings)
      // 2. Have passed their grace period (startTime + 1 hour < currentTime)
      // 3. Still have held payment
      const graceHours = 1; // 1 hour grace period
      const gracePeriodAgo = new Date(currentTime.getTime() - (graceHours * 60 * 60 * 1000));
      
      const pendingBookings = await Booking.find({
        status: 'accepted', // ✅ Look for ONLY 'accepted' bookings
        startTime: { $lt: gracePeriodAgo }, // ✅ Grace period logic (1 hour after start time)
        userId: { $ne: null }, // ✅ Only process bookings with valid userId
        // ✅ ADDITIONAL: Ensure booking hasn't been processed for violations already
        violationData: { $exists: false }, // ✅ Skip bookings that already have violation data
        $or: [
          { paymentStatus: 'held' },
          { 'pricing.paymentStatus': 'held' }
        ]
      }).populate('userId parkingSpaceId');

      logger.info(`🔍 Checking ${pendingBookings.length} bookings for no-shows (grace period: ${graceHours} hour(s))`);

      let processedCount = 0;
      let noShowCount = 0;

      for (const booking of pendingBookings) {
        try {
          const noShowResult = await this.checkNoShow(booking);
          
          if (noShowResult.isNoShow && noShowResult.violationProcessed) {
            noShowCount++;
          }
          
          processedCount++;
        } catch (error) {
          logger.error(`❌ Error checking no-show for booking ${booking._id}:`, error);
        }
      }

      logger.info(`✅ Batch no-show check completed. Processed: ${processedCount}, No-shows: ${noShowCount}`);

      return {
        success: true,
        processedCount,
        noShowCount
      };

    } catch (error) {
      logger.error(`❌ Error in batch no-show check:`, error);
      throw error;
    }
  }
}

module.exports = new ViolationTrackingService();
