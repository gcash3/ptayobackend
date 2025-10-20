const EscrowTransaction = require('../models/EscrowTransaction');
const Booking = require('../models/Booking');
const User = require('../models/User');
const logger = require('../config/logger');
const walletService = require('./walletService');

/**
 * Escrow Service
 * Handles holding funds in escrow until checkout completion
 */
class EscrowService {

  /**
   * Create escrow transaction when user makes payment
   * @param {Object} bookingData - Booking information
   * @param {Object} pricingDetails - Revenue split from dynamic pricing service
   * @param {String} paymentTransactionId - Payment processor transaction ID
   */
  async createEscrow(bookingData, pricingDetails, paymentTransactionId) {
    try {
      const { bookingId, clientId, landlordId } = bookingData;

      // Validate pricing breakdown
      if (!pricingDetails.landlordEarnings || !pricingDetails.platformEarnings) {
        throw new Error('Invalid pricing details: missing earnings breakdown');
      }

      const escrowData = {
        bookingId,
        clientId,
        landlordId,
        totalAmount: pricingDetails.totalPrice,

        // Landlord earnings breakdown
        landlordShare: {
          basePrice: pricingDetails.landlordEarnings.basePrice,
          dynamicPricingBonus: pricingDetails.landlordEarnings.dynamicPricingBonus || 0,
          overtimeCharges: 0, // Will be added later if needed
          total: pricingDetails.landlordEarnings.total
        },

        // Platform earnings breakdown
        platformShare: {
          dynamicPricingCut: pricingDetails.platformEarnings.dynamicPricingCut || 0,
          serviceFee: pricingDetails.platformEarnings.serviceFee,
          platformFee: pricingDetails.platformEarnings.platformFee || 0,
          total: pricingDetails.platformEarnings.total
        },

        // Revenue split configuration
        revenueSplit: {
          dynamicPricingPercentage: {
            landlord: 50,
            platform: 50
          },
          appliedAt: new Date()
        },

        // Transaction tracking
        paymentTransactionId,
        status: 'held',

        // Metadata
        metadata: {
          paymentMethod: 'Wallet',
          currency: 'PHP',
          processingFees: 0
        }
      };

      const escrowTransaction = new EscrowTransaction(escrowData);
      await escrowTransaction.save();

      logger.info(`💰 Escrow created for booking ${bookingId}:
        Total held: ₱${escrowTransaction.totalAmount}
        Landlord share: ₱${escrowTransaction.landlordShare.total}
        Platform share: ₱${escrowTransaction.platformShare.total}
        Status: ${escrowTransaction.status}`);

      return escrowTransaction;

    } catch (error) {
      logger.error('Error creating escrow transaction:', error);
      throw error;
    }
  }

  /**
   * Release funds from escrow after checkout completion
   * @param {String} bookingId - Booking ID
   * @param {Object} additionalCharges - Any overtime/additional charges
   */
  async releaseFunds(bookingId, additionalCharges = null) {
    try {
      const escrow = await EscrowTransaction.findOne({ bookingId, status: 'held' })
        .populate('booking')
        .populate('client', 'firstName lastName email')
        .populate('landlord', 'firstName lastName email');

      if (!escrow) {
        throw new Error(`No active escrow found for booking ${bookingId}`);
      }

      // Add any additional charges (overtime)
      if (additionalCharges && additionalCharges.amount > 0) {
        await escrow.addAdditionalCharge(
          additionalCharges.type || 'overtime',
          additionalCharges.amount,
          additionalCharges.description || 'Additional charges'
        );
      }

      // Process transfers
      const landlordTransferId = await this.transferToLandlord(escrow);
      const adminTransferId = await this.transferToAdmin(escrow);

      // Mark escrow as released
      await escrow.releaseFunds(landlordTransferId, adminTransferId);

      logger.info(`✅ Funds released for booking ${bookingId}:
        Landlord received: ₱${escrow.landlordShare.total}
        Platform received: ₱${escrow.platformShare.total}
        Landlord transfer ID: ${landlordTransferId}
        Admin transfer ID: ${adminTransferId}`);

      return {
        success: true,
        escrowId: escrow._id,
        landlordShare: escrow.landlordShare.total,
        platformShare: escrow.platformShare.total,
        transfers: {
          landlord: landlordTransferId,
          admin: adminTransferId
        }
      };

    } catch (error) {
      logger.error(`Error releasing funds for booking ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Transfer landlord share to landlord wallet
   * @param {EscrowTransaction} escrow - Escrow transaction
   */
  async transferToLandlord(escrow) {
    try {
      const transfer = await walletService.transferFunds({
        fromWalletId: 'escrow_wallet', // System escrow wallet
        toUserId: escrow.landlordId,
        amount: escrow.landlordShare.total,
        type: 'booking_payout',
        description: `Parking booking payout - Booking ${escrow.bookingId}`,
        metadata: {
          bookingId: escrow.bookingId,
          escrowId: escrow._id,
          breakdown: {
            basePrice: escrow.landlordShare.basePrice,
            dynamicBonus: escrow.landlordShare.dynamicPricingBonus,
            overtime: escrow.landlordShare.overtimeCharges
          }
        }
      });

      logger.info(`💸 Landlord payout completed:
        Landlord: ${escrow.landlordId}
        Amount: ₱${escrow.landlordShare.total}
        Transfer ID: ${transfer.transactionId}`);

      return transfer.transactionId;

    } catch (error) {
      logger.error('Error transferring to landlord:', error);
      throw new Error(`Landlord transfer failed: ${error.message}`);
    }
  }

  /**
   * Transfer platform share to admin wallet
   * @param {EscrowTransaction} escrow - Escrow transaction
   */
  async transferToAdmin(escrow) {
    try {
      const transfer = await walletService.transferFunds({
        fromWalletId: 'escrow_wallet', // System escrow wallet
        toWalletId: 'admin_wallet', // Platform admin wallet
        amount: escrow.platformShare.total,
        type: 'platform_revenue',
        description: `Platform revenue - Booking ${escrow.bookingId}`,
        metadata: {
          bookingId: escrow.bookingId,
          escrowId: escrow._id,
          breakdown: {
            dynamicPricingCut: escrow.platformShare.dynamicPricingCut,
            serviceFee: escrow.platformShare.serviceFee,
            platformFee: escrow.platformShare.platformFee
          }
        }
      });

      logger.info(`🏦 Platform revenue collected:
        Amount: ₱${escrow.platformShare.total}
        Transfer ID: ${transfer.transactionId}`);

      return transfer.transactionId;

    } catch (error) {
      logger.error('Error transferring to admin wallet:', error);
      throw new Error(`Admin transfer failed: ${error.message}`);
    }
  }

  /**
   * Process refund (for cancellations)
   * @param {String} bookingId - Booking ID
   * @param {String} reason - Refund reason
   * @param {String} processedBy - Admin user ID
   * @param {Number} refundAmount - Amount to refund (optional, defaults to full)
   */
  async processRefund(bookingId, reason, processedBy, refundAmount = null) {
    try {
      const escrow = await EscrowTransaction.findOne({ bookingId, status: 'held' });

      if (!escrow) {
        throw new Error(`No active escrow found for booking ${bookingId}`);
      }

      const actualRefundAmount = refundAmount || escrow.totalAmount;

      // Process refund to client wallet
      const refundTransfer = await walletService.transferFunds({
        fromWalletId: 'escrow_wallet',
        toUserId: escrow.clientId,
        amount: actualRefundAmount,
        type: 'refund',
        description: `Booking refund - ${reason}`,
        metadata: {
          bookingId: escrow.bookingId,
          escrowId: escrow._id,
          originalAmount: escrow.totalAmount,
          refundReason: reason
        }
      });

      // Mark escrow as refunded
      await escrow.processRefund(actualRefundAmount, reason, processedBy, refundTransfer.transactionId);

      logger.info(`💰 Refund processed for booking ${bookingId}:
        Amount: ₱${actualRefundAmount}
        Reason: ${reason}
        Refund ID: ${refundTransfer.transactionId}`);

      return {
        success: true,
        refundAmount: actualRefundAmount,
        refundTransactionId: refundTransfer.transactionId
      };

    } catch (error) {
      logger.error(`Error processing refund for booking ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Get escrow status for a booking
   * @param {String} bookingId - Booking ID
   */
  async getEscrowStatus(bookingId) {
    try {
      const escrow = await EscrowTransaction.findOne({ bookingId })
        .populate('booking', 'status startTime endTime')
        .populate('client', 'firstName lastName email')
        .populate('landlord', 'firstName lastName email');

      if (!escrow) {
        return { exists: false };
      }

      return {
        exists: true,
        status: escrow.status,
        totalAmount: escrow.totalAmount,
        landlordShare: escrow.landlordShare,
        platformShare: escrow.platformShare,
        heldAt: escrow.heldAt,
        releasedAt: escrow.releasedAt,
        refundedAt: escrow.refundedAt,
        booking: escrow.booking,
        client: escrow.client,
        landlord: escrow.landlord
      };

    } catch (error) {
      logger.error(`Error getting escrow status for booking ${bookingId}:`, error);
      throw error;
    }
  }

  /**
   * Get landlord earnings summary
   * @param {String} landlordId - Landlord user ID
   * @param {Date} startDate - Start date filter
   * @param {Date} endDate - End date filter
   */
  async getLandlordEarnings(landlordId, startDate = null, endDate = null) {
    try {
      return await EscrowTransaction.getLandlordEarnings(landlordId, startDate, endDate);
    } catch (error) {
      logger.error(`Error getting landlord earnings for ${landlordId}:`, error);
      throw error;
    }
  }

  /**
   * Get platform revenue summary
   * @param {Date} startDate - Start date filter
   * @param {Date} endDate - End date filter
   */
  async getPlatformRevenue(startDate = null, endDate = null) {
    try {
      return await EscrowTransaction.getPlatformRevenue(startDate, endDate);
    } catch (error) {
      logger.error('Error getting platform revenue:', error);
      throw error;
    }
  }

  /**
   * Get all held funds (for admin monitoring)
   */
  async getHeldFunds() {
    try {
      const heldEscrows = await EscrowTransaction.findByStatus('held');

      const summary = {
        totalHeld: 0,
        totalTransactions: heldEscrows.length,
        landlordShareHeld: 0,
        platformShareHeld: 0,
        transactions: heldEscrows.map(escrow => ({
          bookingId: escrow.bookingId,
          amount: escrow.totalAmount,
          heldSince: escrow.heldAt,
          client: escrow.client,
          landlord: escrow.landlord
        }))
      };

      heldEscrows.forEach(escrow => {
        summary.totalHeld += escrow.totalAmount;
        summary.landlordShareHeld += escrow.landlordShare.total;
        summary.platformShareHeld += escrow.platformShare.total;
      });

      return summary;

    } catch (error) {
      logger.error('Error getting held funds summary:', error);
      throw error;
    }
  }
}

module.exports = new EscrowService();