const receiptService = require('../services/receiptService');
const Booking = require('../models/Booking');
const logger = require('../config/logger');

/**
 * Preview receipt for a booking
 * @route GET /api/v1/booking-receipts/preview/:bookingId
 */
const previewReceipt = async (req, res) => {
  try {
    const { bookingId } = req.params;

    const result = await receiptService.previewReceipt(bookingId);

    if (!result.success) {
      return res.status(400).json({
        status: 'error',
        message: result.error
      });
    }

    res.status(200).json({
      status: 'success',
      data: {
        html: result.html,
        receiptData: result.receiptData
      }
    });

  } catch (error) {
    logger.error('❌ Preview receipt error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to preview receipt'
    });
  }
};

/**
 * Send receipt email manually
 * @route POST /api/v1/booking-receipts/send/:bookingId
 */
const sendReceipt = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { email } = req.body;

    const result = await receiptService.sendCompletionReceipt(bookingId);

    if (!result.success) {
      return res.status(400).json({
        status: 'error',
        message: result.error
      });
    }

    res.status(200).json({
      status: 'success',
      message: 'Receipt sent successfully',
      data: {
        receiptNumber: result.receiptNumber
      }
    });

  } catch (error) {
    logger.error('❌ Send receipt error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to send receipt'
    });
  }
};

/**
 * Bulk send receipts
 * @route POST /api/v1/booking-receipts/bulk-send
 */
const bulkSendReceipts = async (req, res) => {
  try {
    const { bookingIds } = req.body;

    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({
        status: 'error',
        message: 'BookingIds array is required'
      });
    }

    const result = await receiptService.bulkSendReceipts(bookingIds);

    res.status(200).json({
      status: 'success',
      message: `Bulk receipt sending completed: ${result.summary.successful}/${result.summary.total} successful`,
      data: result
    });

  } catch (error) {
    logger.error('❌ Bulk send receipts error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to bulk send receipts'
    });
  }
};

/**
 * Get receipt statistics
 * @route GET /api/v1/booking-receipts/stats
 */
const getReceiptStats = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;

    const matchFilter = {};
    if (startDate && endDate) {
      matchFilter.createdAt = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const stats = await Booking.aggregate([
      { $match: { status: 'completed', ...matchFilter } },
      {
        $group: {
          _id: null,
          totalCompletedBookings: { $sum: 1 },
          receiptsSent: {
            $sum: {
              $cond: [{ $eq: ['$receiptSent', true] }, 1, 0]
            }
          },
          receiptsNotSent: {
            $sum: {
              $cond: [{ $ne: ['$receiptSent', true] }, 1, 0]
            }
          }
        }
      }
    ]);

    const result = stats.length > 0 ? stats[0] : {
      totalCompletedBookings: 0,
      receiptsSent: 0,
      receiptsNotSent: 0
    };

    // Calculate percentage
    result.receiptDeliveryRate = result.totalCompletedBookings > 0
      ? ((result.receiptsSent / result.totalCompletedBookings) * 100).toFixed(1)
      : '0.0';

    res.status(200).json({
      status: 'success',
      data: result
    });

  } catch (error) {
    logger.error('❌ Get receipt stats error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get receipt statistics'
    });
  }
};

/**
 * Get bookings that need receipts sent
 * @route GET /api/v1/booking-receipts/pending
 */
const getPendingReceipts = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;

    const bookings = await Booking.find({
      status: 'completed',
      $or: [
        { receiptSent: { $ne: true } },
        { receiptSent: { $exists: false } }
      ]
    })
    .populate('userId', 'firstName lastName email')
    .populate('parkingSpaceId', 'name address')
    .sort({ updatedAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .lean();

    const total = await Booking.countDocuments({
      status: 'completed',
      $or: [
        { receiptSent: { $ne: true } },
        { receiptSent: { $exists: false } }
      ]
    });

    res.status(200).json({
      status: 'success',
      data: {
        bookings,
        pagination: {
          current: Number(page),
          pages: Math.ceil(total / limit),
          total
        }
      }
    });

  } catch (error) {
    logger.error('❌ Get pending receipts error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get pending receipts'
    });
  }
};

/**
 * Get recent receipt activity
 * @route GET /api/v1/booking-receipts/recent
 */
const getRecentReceiptActivity = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const recentReceipts = await Booking.find({
      receiptSent: true,
      receiptSentAt: { $exists: true }
    })
    .populate('userId', 'firstName lastName email')
    .populate('parkingSpaceId', 'name')
    .sort({ receiptSentAt: -1 })
    .limit(Number(limit))
    .select('_id receiptSentAt receiptSentTo pricing.totalAmount')
    .lean();

    res.status(200).json({
      status: 'success',
      data: recentReceipts
    });

  } catch (error) {
    logger.error('❌ Get recent receipt activity error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get recent receipt activity'
    });
  }
};

module.exports = {
  previewReceipt,
  sendReceipt,
  bulkSendReceipts,
  getReceiptStats,
  getPendingReceipts,
  getRecentReceiptActivity
};