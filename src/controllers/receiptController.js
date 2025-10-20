const mongoose = require('mongoose');
const Receipt = require('../models/Receipt');
const { Wallet } = require('../models/Wallet');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const cloudinaryService = require('../services/cloudinaryService');

/**
 * Upload receipt for top-up verification
 * @route POST /api/v1/receipts/upload
 */
const uploadReceipt = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { amount, mobileNumber, senderName } = req.body;

  // Log request details for debugging
  logger.info('Receipt upload request:', {
    userId,
    amount,
    mobileNumber: mobileNumber ? '***' + mobileNumber.slice(-4) : 'missing',
    senderName,
    hasFile: !!req.file,
    fileInfo: req.file ? {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size
    } : 'No file'
  });

  // Validate required fields
  if (!amount || !mobileNumber || !senderName) {
    return next(new AppError('Amount, mobile number, and sender name are required', 400));
  }

  // Validate amount
  const numAmount = parseFloat(amount);
  if (isNaN(numAmount) || numAmount <= 0) {
    return next(new AppError('Invalid amount', 400));
  }

  // Check if file was uploaded
  if (!req.file) {
    return next(new AppError('Receipt image is required', 400));
  }

  try {
    // Upload image to Cloudinary
    const fileName = `receipt-${userId}-${Date.now()}`;
    const uploadResult = await cloudinaryService.uploadImage(
      req.file.buffer,
      'receipts',
      fileName
    );

    // Generate thumbnail URL
    const thumbnailUrl = cloudinaryService.getThumbnailUrl(uploadResult.public_id, 300, 300);

    // Create receipt record
    const receiptData = {
      userId,
      amount: numAmount,
      mobileNumber,
      senderName,
      receiptImage: {
        cloudinaryId: uploadResult.public_id,
        secureUrl: uploadResult.secure_url,
        thumbnailUrl,
        originalName: req.file.originalname,
        size: uploadResult.bytes,
        format: uploadResult.format
      },
      metadata: {
        userAgent: req.get('User-Agent'),
        ipAddress: req.ip,
        deviceInfo: req.get('X-Device-Info') || ''
      }
    };

    const receipt = new Receipt(receiptData);
    await receipt.save();

    logger.info('✅ Receipt uploaded successfully', {
      receiptId: receipt._id,
      userId,
      amount: numAmount,
      cloudinaryId: uploadResult.public_id
    });

    res.status(201).json({
      status: 'success',
      message: 'Receipt uploaded successfully. Admin will review and process your top-up request.',
      data: {
        receiptId: receipt._id,
        amount: receipt.amount,
        status: receipt.status,
        createdAt: receipt.createdAt,
        thumbnailUrl: receipt.receiptImage.thumbnailUrl
      }
    });

  } catch (error) {
    logger.error('Error uploading receipt:', error);
    return next(new AppError('Failed to upload receipt. Please try again.', 500));
  }
});

/**
 * Get user's receipts
 * @route GET /api/v1/receipts/my-receipts
 */
const getMyReceipts = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  const receipts = await Receipt.getReceiptsByUser(userId, parseInt(page), parseInt(limit));
  const totalReceipts = await Receipt.countDocuments({ userId });

  res.status(200).json({
    status: 'success',
    results: receipts.length,
    data: {
      receipts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalReceipts / parseInt(limit)),
        totalItems: totalReceipts,
        hasNextPage: page * limit < totalReceipts,
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * Get receipt by ID (user can only access their own receipts)
 * @route GET /api/v1/receipts/:receiptId
 */
const getReceiptById = catchAsync(async (req, res, next) => {
  const { receiptId } = req.params;
  const userId = req.user.id;

  const receipt = await Receipt.findOne({ _id: receiptId, userId })
    .populate('reviewedBy', 'firstName lastName');

  if (!receipt) {
    return next(new AppError('Receipt not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      receipt
    }
  });
});

// Admin functions

/**
 * Get all receipts (Admin only)
 * @route GET /api/v1/admin/receipts
 */
const getAllReceipts = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, status = 'all' } = req.query;

  let query = {};
  if (status !== 'all') {
    query.status = status;
  }

  const receipts = await Receipt.find(query)
    .populate('userId', 'firstName lastName email phoneNumber')
    .populate('reviewedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const totalReceipts = await Receipt.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: receipts.length,
    data: {
      receipts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalReceipts / parseInt(limit)),
        totalItems: totalReceipts,
        hasNextPage: page * limit < totalReceipts,
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * Get pending receipts (Admin only)
 * @route GET /api/v1/admin/receipts/pending
 */
const getPendingReceipts = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;

  const receipts = await Receipt.getPendingReceipts(parseInt(page), parseInt(limit));
  const totalPending = await Receipt.countDocuments({ status: 'pending' });

  res.status(200).json({
    status: 'success',
    results: receipts.length,
    data: {
      receipts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalPending / parseInt(limit)),
        totalItems: totalPending,
        hasNextPage: page * limit < totalPending,
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * Approve receipt (Admin only)
 * @route POST /api/v1/admin/receipts/:receiptId/approve
 */
const approveReceipt = catchAsync(async (req, res, next) => {
  const { receiptId } = req.params;
  const { notes = '' } = req.body;
  const adminId = req.user.id;

  const receipt = await Receipt.findById(receiptId)
    .populate('userId', 'firstName lastName email');

  if (!receipt) {
    return next(new AppError('Receipt not found', 404));
  }

  if (receipt.status !== 'pending') {
    return next(new AppError('Receipt has already been reviewed', 400));
  }

  // Start a transaction to ensure both receipt approval and wallet crediting succeed or fail together
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // 1. Approve the receipt
    await receipt.approve(adminId, notes);

    // 2. Credit the user's wallet
    let wallet = await Wallet.findByUserId(receipt.userId._id);
    if (!wallet) {
      wallet = await Wallet.createWallet(receipt.userId._id, 0);
      logger.info(`✅ Created new wallet for user ${receipt.userId._id} during receipt approval`);
    }

    // Create wallet transaction for the top-up
    const walletTransaction = {
      type: 'credit',
      amount: receipt.amount,
      description: `Top-up via receipt approval - ${receipt.senderName} (${receipt.mobileNumber})`,
      paymentMethod: 'receipt_approval',
      status: 'completed',
      metadata: new Map([
        ['receiptId', receipt._id.toString()],
        ['senderName', receipt.senderName],
        ['mobileNumber', receipt.mobileNumber],
        ['approvedBy', adminId],
        ['approvalNotes', notes]
      ])
    };

    // Add transaction and update balance
    await wallet.addTransaction(walletTransaction);
    await wallet.updateBalance(receipt.amount, 'credit');

    // Update receipt with wallet transaction reference
    receipt.walletTransactionId = wallet.transactions[wallet.transactions.length - 1]._id;
    await receipt.save();

    // Commit the transaction
    await session.commitTransaction();

    logger.info('✅ Receipt approved and wallet credited successfully', {
      receiptId,
      adminId,
      userId: receipt.userId._id,
      amount: receipt.amount,
      newWalletBalance: wallet.availableBalance,
      walletTransactionId: receipt.walletTransactionId
    });

    res.status(200).json({
      status: 'success',
      message: 'Receipt approved successfully and wallet credited',
      data: {
        receipt,
        walletCredit: {
          amount: receipt.amount,
          newBalance: wallet.availableBalance,
          transactionId: receipt.walletTransactionId
        }
      }
    });

  } catch (error) {
    // Rollback the transaction if anything fails
    await session.abortTransaction();
    logger.error('❌ Error during receipt approval and wallet crediting:', error);
    throw error;
  } finally {
    session.endSession();
  }
});

/**
 * Reject receipt (Admin only)
 * @route POST /api/v1/admin/receipts/:receiptId/reject
 */
const rejectReceipt = catchAsync(async (req, res, next) => {
  const { receiptId } = req.params;
  const { reason = '', notes = '' } = req.body;
  const adminId = req.user.id;

  const receipt = await Receipt.findById(receiptId)
    .populate('userId', 'firstName lastName email');

  if (!receipt) {
    return next(new AppError('Receipt not found', 404));
  }

  if (receipt.status !== 'pending') {
    return next(new AppError('Receipt has already been reviewed', 400));
  }

  await receipt.reject(adminId, reason, notes);

  logger.info('✅ Receipt rejected by admin', {
    receiptId,
    adminId,
    userId: receipt.userId._id,
    reason
  });

  res.status(200).json({
    status: 'success',
    message: 'Receipt rejected',
    data: {
      receipt
    }
  });
});

/**
 * Get receipt statistics (Admin only)
 * @route GET /api/v1/admin/receipts/stats
 */
const getReceiptStats = catchAsync(async (req, res, next) => {
  const stats = await Receipt.getReceiptStats();

  res.status(200).json({
    status: 'success',
    data: {
      stats
    }
  });
});

module.exports = {
  // User functions
  uploadReceipt,
  getMyReceipts,
  getReceiptById,

  // Admin functions
  getAllReceipts,
  getPendingReceipts,
  approveReceipt,
  rejectReceipt,
  getReceiptStats
};