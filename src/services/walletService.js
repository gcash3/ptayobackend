const { Wallet, WalletTransaction } = require('../models/Wallet');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');
const { getHongKongTime } = require('../utils/dateTime');

class WalletService {
  /**
   * Hold amount in user's wallet for booking
   * @param {String} userId - User ID
   * @param {Number} amount - Amount to hold
   * @param {String} bookingId - Booking ID reference
   * @param {String} description - Transaction description
   * @returns {Object} Hold transaction result
   */
  async holdAmount(userId, amount, bookingId, description = 'Parking booking hold') {
    try {
      logger.info(`💰 Holding ₱${amount} for user ${userId}, booking ${bookingId}`);

      // Find or create wallet
      let wallet = await Wallet.findByUserId(userId);
      if (!wallet) {
        wallet = await Wallet.createWallet(userId, 0);
      }

      // Populate transactions to calculate current balance
      await wallet.populate('transactions');

      // Calculate current available balance using consistent method
      const { availableBalance } = this.computeWalletSummary(wallet);
      
      // Update the wallet model fields to stay in sync
      wallet.balance = this.computeWalletSummary(wallet).balance;
      wallet.heldAmount = this.computeWalletSummary(wallet).heldAmount;
      wallet.availableBalance = availableBalance;

      // Check if user has sufficient balance
      if (availableBalance < amount) {
        throw new Error(`Insufficient balance. Available: ₱${availableBalance.toFixed(2)}, Required: ₱${amount.toFixed(2)}`);
      }

      // Generate unique hold reference
      const holdReference = `HOLD_${uuidv4().slice(0, 8).toUpperCase()}`;
      const referenceId = `TXN_${uuidv4().slice(0, 12).toUpperCase()}`;

      // Create hold transaction
      const holdTransaction = new WalletTransaction({
        userId,
        type: 'hold',
        amount,
        description,
        bookingId,
        referenceId,
        holdReference,
        status: 'completed',
        metadata: {
          holdType: 'booking',
          originalAmount: amount,
          timestamp: getHongKongTime().toISOString()
        }
      });

      // Add transaction to wallet
      wallet.transactions.push(holdTransaction);

      // Update wallet balances
      const newSummary = this.computeWalletSummary(wallet);
      wallet.balance = newSummary.balance;
      wallet.availableBalance = newSummary.availableBalance;
      wallet.heldAmount = newSummary.heldAmount;

      // Save wallet and transaction
      await wallet.save();
      await holdTransaction.save();

      logger.info(`✅ Successfully held ₱${amount} for booking ${bookingId}. Hold ref: ${holdReference}`);

      return {
        success: true,
        holdReference,
        transaction: holdTransaction,
        newBalance: {
          balance: wallet.balance,
          availableBalance: wallet.availableBalance,
          heldAmount: wallet.heldAmount
        }
      };

    } catch (error) {
      logger.error(`❌ Failed to hold amount for user ${userId}:`, error);
      throw error;
    }
  }

  /**
   * Capture held amount (complete the payment)
   * @param {String} userId - User ID
   * @param {String} holdReference - Hold reference ID
   * @param {String} bookingId - Booking ID
   * @param {String} description - Transaction description
   * @returns {Object} Capture transaction result
   */
  async captureHeldAmount(userId, holdReference, bookingId, description = 'Parking booking payment') {
    try {
      logger.info(`💳 Capturing held amount for user ${userId}, hold ${holdReference}`);

      // Find wallet and populate transactions
      const wallet = await Wallet.findByUserId(userId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      await wallet.populate('transactions');

      // Find the hold transaction
      const holdTransaction = wallet.transactions.find(t => 
        t.holdReference === holdReference && 
        t.type === 'hold' && 
        t.status === 'completed'
      );

      if (!holdTransaction) {
        throw new Error(`Hold transaction not found: ${holdReference}`);
      }

      const holdAmount = holdTransaction.amount;
      const referenceId = `TXN_${uuidv4().slice(0, 12).toUpperCase()}`;

      // Create capture transaction
      const captureTransaction = new WalletTransaction({
        userId,
        type: 'capture',
        amount: holdAmount,
        description,
        bookingId,
        referenceId,
        holdReference,
        relatedTransactionId: holdTransaction._id,
        status: 'completed',
        metadata: {
          captureType: 'booking_payment',
          originalHoldAmount: holdAmount,
          timestamp: getHongKongTime().toISOString()
        }
      });

      // Create release transaction to remove the hold
      const releaseTransaction = new WalletTransaction({
        userId,
        type: 'release',
        amount: holdAmount,
        description: `Release hold for ${description}`,
        bookingId,
        referenceId: `REL_${referenceId}`,
        holdReference,
        relatedTransactionId: holdTransaction._id,
        status: 'completed',
        metadata: {
          releaseType: 'booking_capture',
          originalHoldAmount: holdAmount,
          timestamp: getHongKongTime().toISOString()
        }
      });

      // Add transactions to wallet
      wallet.transactions.push(captureTransaction, releaseTransaction);

      // Update wallet balances
      const newSummary = this.computeWalletSummary(wallet);
      wallet.balance = newSummary.balance;
      wallet.availableBalance = newSummary.availableBalance;
      wallet.heldAmount = newSummary.heldAmount;

      // Save all
      await wallet.save();
      await captureTransaction.save();
      await releaseTransaction.save();

      logger.info(`✅ Successfully captured ₱${holdAmount} for booking ${bookingId}`);

      return {
        success: true,
        capturedAmount: holdAmount,
        transactions: {
          capture: captureTransaction,
          release: releaseTransaction
        },
        newBalance: {
          balance: wallet.balance,
          availableBalance: wallet.availableBalance,
          heldAmount: wallet.heldAmount
        }
      };

    } catch (error) {
      logger.error(`❌ Failed to capture held amount:`, error);
      throw error;
    }
  }

  /**
   * Release held amount (refund without capture)
   * @param {String} userId - User ID
   * @param {String} holdReference - Hold reference ID
   * @param {Number} refundAmount - Amount to refund (can be partial)
   * @param {String} reason - Reason for release
   * @returns {Object} Release transaction result
   */
  async releaseHeldAmount(userId, holdReference, refundAmount = null, reason = 'Booking cancelled') {
    try {
      logger.info(`🔄 Releasing held amount for user ${userId}, hold ${holdReference}`);

      // Find wallet and populate transactions
      const wallet = await Wallet.findByUserId(userId);
      if (!wallet) {
        throw new Error('Wallet not found');
      }

      await wallet.populate('transactions');

      // Find the hold transaction
      const holdTransaction = wallet.transactions.find(t => 
        t.holdReference === holdReference && 
        t.type === 'hold' && 
        t.status === 'completed'
      );

      if (!holdTransaction) {
        throw new Error(`Hold transaction not found: ${holdReference}`);
      }

      const originalHoldAmount = holdTransaction.amount;
      const releaseAmount = refundAmount || originalHoldAmount;

      // Validate release amount
      if (releaseAmount > originalHoldAmount) {
        throw new Error(`Release amount (₱${releaseAmount}) cannot exceed held amount (₱${originalHoldAmount})`);
      }

      const referenceId = `TXN_${uuidv4().slice(0, 12).toUpperCase()}`;

      // Create release transaction
      const releaseTransaction = new WalletTransaction({
        userId,
        type: 'release',
        amount: releaseAmount,
        description: reason,
        bookingId: holdTransaction.bookingId,
        referenceId,
        holdReference,
        relatedTransactionId: holdTransaction._id,
        status: 'completed',
        metadata: {
          releaseType: 'booking_refund',
          originalHoldAmount,
          refundAmount: releaseAmount,
          timestamp: getHongKongTime().toISOString()
        }
      });

      // Add transaction to wallet
      wallet.transactions.push(releaseTransaction);

      // Update wallet balances
      const newSummary = this.computeWalletSummary(wallet);
      wallet.balance = newSummary.balance;
      wallet.availableBalance = newSummary.availableBalance;
      wallet.heldAmount = newSummary.heldAmount;

      // Save wallet and transaction
      await wallet.save();
      await releaseTransaction.save();

      logger.info(`✅ Successfully released ₱${releaseAmount} for hold ${holdReference}`);

      return {
        success: true,
        releasedAmount: releaseAmount,
        transaction: releaseTransaction,
        newBalance: {
          balance: wallet.balance,
          availableBalance: wallet.availableBalance,
          heldAmount: wallet.heldAmount
        }
      };

    } catch (error) {
      logger.error(`❌ Failed to release held amount:`, error);
      throw error;
    }
  }

  /**
   * Calculate wallet summary from transactions
   * @param {Object} wallet - Wallet object with transactions
   * @returns {Object} Balance summary
   */
  computeWalletSummary(wallet) {
    const txns = Array.isArray(wallet.transactions) ? wallet.transactions : [];
    let totalCredits = 0;
    let totalDebits = 0;
    let holds = 0;

    for (const t of txns) {
      if (!t || t.status !== 'completed') continue;
      switch (t.type) {
        case 'credit':
        case 'refund':
        case 'transfer_in':
          totalCredits += Number(t.amount) || 0;
          break;
        case 'debit':
        case 'transfer_out':
        case 'capture':
          totalDebits += Number(t.amount) || 0;
          break;
        case 'hold':
          holds += Number(t.amount) || 0;
          break;
        case 'release':
          holds -= Number(t.amount) || 0;
          break;
        default:
          break;
      }
    }

    const balance = Math.max(0, totalCredits - totalDebits);
    const heldAmount = Math.max(0, holds);
    const availableBalance = Math.max(0, balance - heldAmount);

    return { balance, availableBalance, heldAmount };
  }

  /**
   * Get holds for a specific booking
   * @param {String} userId - User ID
   * @param {String} bookingId - Booking ID
   * @returns {Array} Hold transactions
   */
  async getBookingHolds(userId, bookingId) {
    try {
      const wallet = await Wallet.findByUserId(userId);
      if (!wallet) {
        return [];
      }

      await wallet.populate('transactions');

      const holds = wallet.transactions.filter(t => 
        t.bookingId && 
        t.bookingId.toString() === bookingId &&
        t.type === 'hold' &&
        t.status === 'completed'
      );

      return holds;
    } catch (error) {
      logger.error(`Error getting booking holds:`, error);
      return [];
    }
  }

  /**
   * Update hold transaction with booking ID
   * @param {String} holdReference - Hold reference ID
   * @param {String} bookingId - Booking ID to associate
   * @returns {Boolean} Success status
   */
  async updateHoldWithBookingId(holdReference, bookingId) {
    try {
      const result = await WalletTransaction.findOneAndUpdate(
        { holdReference, type: 'hold', status: 'completed' },
        { bookingId },
        { new: true }
      );

      if (result) {
        logger.info(`✅ Updated hold ${holdReference} with booking ID ${bookingId}`);
        return true;
      } else {
        logger.warn(`⚠️ Hold transaction not found: ${holdReference}`);
        return false;
      }
    } catch (error) {
      logger.error(`❌ Failed to update hold with booking ID:`, error);
      return false;
    }
  }
}

module.exports = new WalletService();
