/**
 * Booking Expiration Service
 * Handles all booking expiration logic, calculations, and resolution options
 */

const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User');
const logger = require('../config/logger');
const {
  calculateExpirationStatus,
  calculateExpirationCharges,
  RESOLUTION_OPTIONS,
  BOOKING_STATUS_RULES
} = require('../config/bookingExpiration');

class BookingExpirationService {
  /**
   * Analyze booking expiration and provide resolution options
   * @param {string} bookingId - The booking ID to analyze
   * @param {string} userId - The user requesting the analysis (for authorization)
   * @param {string} userRole - The role of the requesting user ('landlord', 'admin', etc.)
   * @returns {Object} Expiration analysis with resolution options
   */
  async analyzeBookingExpiration(bookingId, userId, userRole = 'landlord') {
    try {
      logger.info(`🔍 Analyzing booking expiration for booking ${bookingId} by user ${userId} (${userRole})`);

      // Fetch booking with all required data
      const booking = await Booking.findById(bookingId)
        .populate('parkingSpaceId', '_id name landlordId address')
        .populate('userId', '_id firstName lastName phoneNumber email')
        .populate('landlordId', '_id firstName lastName phoneNumber email');

      if (!booking) {
        throw new Error('Booking not found');
      }

      // Authorization check
      if (userRole === 'landlord' && booking.landlordId._id.toString() !== userId) {
        throw new Error('Unauthorized: You do not own this parking space');
      }

      // Calculate expiration status
      const expirationAnalysis = calculateExpirationStatus(booking);

      // Add booking context
      const analysisWithContext = {
        ...expirationAnalysis,
        booking: {
          id: booking._id,
          bookingId: booking.bookingId,
          status: booking.status,
          startTime: booking.startTime,
          endTime: booking.endTime,
          duration: booking.duration,
          checkinTime: booking.checkin?.time,
          checkoutTime: booking.checkout?.time,
          user: {
            id: booking.userId._id,
            name: `${booking.userId.firstName} ${booking.userId.lastName}`,
            phone: booking.userId.phoneNumber
          },
          space: {
            id: booking.parkingSpaceId._id,
            name: booking.parkingSpaceId.name,
            address: booking.parkingSpaceId.address
          },
          pricing: booking.pricing
        },
        analysis: {
          performedAt: new Date(),
          performedBy: userId,
          userRole: userRole
        }
      };

      // Log the analysis
      logger.info(`📊 Expiration analysis completed for booking ${bookingId}:`, {
        status: expirationAnalysis.status,
        windowType: expirationAnalysis.windowType,
        hoursSinceEnd: expirationAnalysis.hoursSinceEnd,
        canGenerate: expirationAnalysis.canGenerate,
        totalExtraCharges: expirationAnalysis.charges?.totalExtraCharges || 0
      });

      return analysisWithContext;

    } catch (error) {
      logger.error(`❌ Error analyzing booking expiration for ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Execute a resolution option for an expired booking
   * @param {string} bookingId - The booking ID
   * @param {string} resolutionId - The resolution option ID
   * @param {string} userId - The user executing the resolution
   * @param {string} userRole - The role of the user
   * @param {Object} options - Additional options for the resolution
   * @returns {Object} Resolution result
   */
  async executeResolution(bookingId, resolutionId, userId, userRole = 'landlord', options = {}) {
    try {
      logger.info(`🛠️ Executing resolution ${resolutionId} for booking ${bookingId} by user ${userId} (${userRole})`);

      // Get current expiration analysis
      const analysis = await this.analyzeBookingExpiration(bookingId, userId, userRole);
      
      if (!analysis.resolutionOptions.some(opt => opt.id === resolutionId)) {
        throw new Error(`Resolution option ${resolutionId} is not available for this booking`);
      }

      const resolutionOption = RESOLUTION_OPTIONS[Object.keys(RESOLUTION_OPTIONS).find(key => 
        RESOLUTION_OPTIONS[key].id === resolutionId
      )];

      if (!resolutionOption) {
        throw new Error(`Invalid resolution option: ${resolutionId}`);
      }

      // Check admin-only restrictions
      if (resolutionOption.adminOnly && userRole !== 'admin') {
        throw new Error('This resolution option requires administrator privileges');
      }

      let result = {};

      switch (resolutionOption.action) {
        case 'generate_qr':
          result = await this._handleGenerateWithOvertime(analysis, options);
          break;

        case 'manual_checkout':
          result = await this._handleManualCheckout(analysis, options);
          break;

        case 'mark_abandoned':
          result = await this._handleMarkAbandoned(analysis, options);
          break;

        case 'escalate':
          result = await this._handleEscalateToSupport(analysis, options);
          break;

        case 'admin_override':
          result = await this._handleAdminOverride(analysis, options);
          break;

        default:
          throw new Error(`Unsupported resolution action: ${resolutionOption.action}`);
      }

      // Log the resolution execution
      await this._logResolutionExecution(bookingId, resolutionId, userId, userRole, result);

      return {
        success: true,
        resolutionId,
        resolutionTitle: resolutionOption.title,
        result,
        executedAt: new Date(),
        executedBy: userId
      };

    } catch (error) {
      logger.error(`❌ Error executing resolution ${resolutionId} for booking ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Handle "Generate QR with Overtime" resolution
   */
  async _handleGenerateWithOvertime(analysis, options) {
    const booking = await Booking.findById(analysis.booking.id);
    
    // Update booking with calculated charges
    const updateData = {
      'pricing.overtimeAmount': analysis.charges.overtimeAmount,
      'pricing.penaltyAmount': analysis.charges.penaltyAmount,
      'pricing.finalTotalAmount': analysis.charges.finalAmount,
      'notes.systemNotes': `Expiration resolution: QR generated with ${analysis.windowType.toLowerCase()} charges. Extra charges: ₱${analysis.charges.totalExtraCharges}`,
      'expiration.resolvedAt': new Date(),
      'expiration.resolutionMethod': 'generate_with_overtime',
      'expiration.extraCharges': analysis.charges.totalExtraCharges
    };

    await Booking.findByIdAndUpdate(booking._id, { $set: updateData });

    logger.info(`💰 Updated booking ${booking._id} with expiration charges: ₱${analysis.charges.totalExtraCharges}`);

    return {
      action: 'qr_generation_allowed',
      message: 'QR code can now be generated with calculated overtime/penalty charges',
      charges: analysis.charges,
      allowQRGeneration: true
    };
  }

  /**
   * Handle "Manual Checkout" resolution
   */
  async _handleManualCheckout(analysis, options) {
    const booking = await Booking.findById(analysis.booking.id);
    const now = new Date();

    // Calculate session duration from checkin to now
    const checkinTime = booking.checkin?.time || booking.startTime;
    const sessionDuration = (now - checkinTime) / (1000 * 60 * 60); // Hours

    // Update booking to completed status
    const updateData = {
      status: 'completed',
      'checkout.time': now,
      'checkout.method': 'manual',
      'checkout.sessionDuration': sessionDuration,
      'checkout.overtimeHours': Math.max(0, sessionDuration - booking.duration),
      'checkout.overtimeAmount': analysis.charges.overtimeAmount,
      'pricing.overtimeAmount': analysis.charges.overtimeAmount,
      'pricing.penaltyAmount': analysis.charges.penaltyAmount,
      'pricing.finalTotalAmount': analysis.charges.finalAmount,
      'notes.systemNotes': `Manual checkout due to expiration. Resolution: ${analysis.windowType.toLowerCase()}. Extra charges: ₱${analysis.charges.totalExtraCharges}`,
      'expiration.resolvedAt': now,
      'expiration.resolutionMethod': 'manual_checkout',
      'expiration.extraCharges': analysis.charges.totalExtraCharges
    };

    await Booking.findByIdAndUpdate(booking._id, { $set: updateData });

    // Process payment for extra charges if applicable
    if (analysis.charges.totalExtraCharges > 0) {
      await this._processExtraCharges(booking, analysis.charges);
    }

    logger.info(`✅ Manual checkout completed for booking ${booking._id} with charges: ₱${analysis.charges.totalExtraCharges}`);

    return {
      action: 'manual_checkout_completed',
      message: 'Booking has been manually checked out',
      charges: analysis.charges,
      checkoutTime: now,
      sessionDuration: sessionDuration
    };
  }

  /**
   * Handle "Mark as Abandoned" resolution
   */
  async _handleMarkAbandoned(analysis, options) {
    const booking = await Booking.findById(analysis.booking.id);
    const now = new Date();

    // Mark as abandoned with penalty
    const updateData = {
      status: 'abandoned',
      'checkout.time': now,
      'checkout.method': 'abandoned',
      'pricing.penaltyAmount': analysis.charges.penaltyAmount,
      'pricing.finalTotalAmount': analysis.charges.finalAmount,
      'notes.systemNotes': `Marked as abandoned due to extended expiration (${analysis.daysSinceEnd} days). Penalty applied: ₱${analysis.charges.penaltyAmount}`,
      'expiration.resolvedAt': now,
      'expiration.resolutionMethod': 'mark_abandoned',
      'expiration.extraCharges': analysis.charges.totalExtraCharges,
      'abandonment.markedAt': now,
      'abandonment.reason': 'Extended expiration without checkout',
      'abandonment.daysSinceEnd': analysis.daysSinceEnd
    };

    await Booking.findByIdAndUpdate(booking._id, { $set: updateData });

    // Process penalty charges
    if (analysis.charges.totalExtraCharges > 0) {
      await this._processExtraCharges(booking, analysis.charges);
    }

    logger.info(`🚫 Booking ${booking._id} marked as abandoned with penalty: ₱${analysis.charges.penaltyAmount}`);

    return {
      action: 'marked_abandoned',
      message: 'Booking has been marked as abandoned',
      charges: analysis.charges,
      abandonedAt: now,
      reason: 'Extended expiration without checkout'
    };
  }

  /**
   * Handle "Escalate to Support" resolution
   */
  async _handleEscalateToSupport(analysis, options) {
    const booking = await Booking.findById(analysis.booking.id);
    const now = new Date();

    // Create support ticket
    const supportTicket = {
      ticketId: `EXP-${booking._id.toString().slice(-8)}-${Date.now()}`,
      type: 'booking_expiration',
      priority: analysis.windowType === 'CRITICAL' ? 'high' : 'medium',
      bookingId: booking._id,
      userId: booking.userId._id,
      landlordId: booking.landlordId._id,
      description: `Booking expiration requires manual resolution. ${analysis.message}`,
      charges: analysis.charges,
      createdAt: now,
      status: 'open'
    };

    // Update booking with escalation info
    const updateData = {
      'notes.systemNotes': `Escalated to customer support. Ticket: ${supportTicket.ticketId}`,
      'expiration.escalatedAt': now,
      'expiration.escalationTicket': supportTicket.ticketId,
      'expiration.resolutionMethod': 'escalated'
    };

    await Booking.findByIdAndUpdate(booking._id, { $set: updateData });

    // TODO: Integrate with actual support ticket system
    logger.info(`🎫 Booking ${booking._id} escalated to support. Ticket: ${supportTicket.ticketId}`);

    return {
      action: 'escalated_to_support',
      message: 'Booking has been escalated to customer support',
      supportTicket,
      escalatedAt: now
    };
  }

  /**
   * Handle "Admin Override" resolution
   */
  async _handleAdminOverride(analysis, options) {
    const booking = await Booking.findById(analysis.booking.id);
    const now = new Date();

    // Admin can override with custom resolution
    const overrideAction = options.overrideAction || 'manual_checkout';
    const overrideCharges = options.overrideCharges || analysis.charges;
    const overrideReason = options.overrideReason || 'Administrative override';

    let finalStatus = 'completed';
    if (overrideAction === 'waive_charges') {
      overrideCharges.overtimeAmount = 0;
      overrideCharges.penaltyAmount = 0;
      overrideCharges.totalExtraCharges = 0;
      overrideCharges.finalAmount = overrideCharges.originalAmount;
    } else if (overrideAction === 'mark_abandoned') {
      finalStatus = 'abandoned';
    }

    const updateData = {
      status: finalStatus,
      'checkout.time': now,
      'checkout.method': 'admin_override',
      'pricing.overtimeAmount': overrideCharges.overtimeAmount,
      'pricing.penaltyAmount': overrideCharges.penaltyAmount,
      'pricing.finalTotalAmount': overrideCharges.finalAmount,
      'notes.systemNotes': `Admin override: ${overrideReason}. Action: ${overrideAction}`,
      'expiration.resolvedAt': now,
      'expiration.resolutionMethod': 'admin_override',
      'expiration.extraCharges': overrideCharges.totalExtraCharges,
      'adminOverride.performedAt': now,
      'adminOverride.reason': overrideReason,
      'adminOverride.action': overrideAction
    };

    await Booking.findByIdAndUpdate(booking._id, { $set: updateData });

    logger.info(`⚡ Admin override applied to booking ${booking._id}: ${overrideAction}`);

    return {
      action: 'admin_override_applied',
      message: `Administrative override applied: ${overrideAction}`,
      charges: overrideCharges,
      overrideReason,
      overrideAction,
      appliedAt: now
    };
  }

  /**
   * Process extra charges (overtime/penalty)
   */
  async _processExtraCharges(booking, charges) {
    try {
      // If booking was paid via wallet, attempt to deduct extra charges
      if (booking.pricing?.paymentMethod === 'wallet' && charges.totalExtraCharges > 0) {
        const { Wallet } = require('../models/Wallet');
        const userWallet = await Wallet.findByUserId(booking.userId._id);
        
        if (userWallet && userWallet.availableBalance >= charges.totalExtraCharges) {
          userWallet.availableBalance -= charges.totalExtraCharges;
          userWallet.transactions.push({
            type: 'debit',
            amount: charges.totalExtraCharges,
            bookingId: booking._id,
            description: `Expiration charges: ${charges.breakdown.map(b => b.description).join(', ')}`,
            referenceId: `EXP-${booking._id}-${Date.now()}`,
            status: 'completed',
            createdAt: new Date()
          });
          await userWallet.save();
          
          logger.info(`💳 Extra charges deducted from wallet: ₱${charges.totalExtraCharges} for booking ${booking._id}`);
        } else {
          logger.warn(`💳 Insufficient wallet balance for extra charges: ₱${charges.totalExtraCharges} for booking ${booking._id}`);
          // TODO: Create payment request or send notification
        }
      }
    } catch (error) {
      logger.error(`❌ Error processing extra charges for booking ${booking._id}:`, error);
      // Don't throw - this shouldn't fail the main resolution
    }
  }

  /**
   * Log resolution execution for audit trail
   */
  async _logResolutionExecution(bookingId, resolutionId, userId, userRole, result) {
    const logEntry = {
      timestamp: new Date(),
      bookingId,
      resolutionId,
      executedBy: userId,
      userRole,
      result: result.action,
      charges: result.charges?.totalExtraCharges || 0
    };

    // TODO: Store in audit log collection
    logger.info(`📝 Resolution executed:`, logEntry);
  }

  /**
   * Get booking expiration summary for dashboard
   */
  async getExpirationSummary(landlordId) {
    try {
      // Get all parked bookings for this landlord
      const parkingSpaces = await ParkingSpace.find({ landlordId }).select('_id');
      const spaceIds = parkingSpaces.map(space => space._id);

      const parkedBookings = await Booking.find({
        parkingSpaceId: { $in: spaceIds },
        status: 'parked'
      }).populate('parkingSpaceId', 'name')
        .populate('userId', 'firstName lastName');

      const summary = {
        total: parkedBookings.length,
        standard: 0,
        extended: 0,
        longTerm: 0,
        critical: 0,
        totalPotentialCharges: 0
      };

      for (const booking of parkedBookings) {
        const analysis = calculateExpirationStatus(booking);
        summary[analysis.status]++;
        summary.totalPotentialCharges += analysis.charges?.totalExtraCharges || 0;
      }

      return summary;
    } catch (error) {
      logger.error(`❌ Error getting expiration summary for landlord ${landlordId}:`, error);
      throw error;
    }
  }
}

module.exports = new BookingExpirationService();
