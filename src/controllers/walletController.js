const { Wallet, WalletTransaction } = require('../models/Wallet');
const { validationResult } = require('express-validator');
const { catchAsync, AppError, createValidationError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const SystemSettings = require('../models/SystemSettings');

// Helper: simplified wallet summary - just return the stored availableBalance
function computeWalletSummary(wallet) {
  // With simplified system, we just return the current availableBalance
  // No need to calculate holds separately since they're already deducted
  const availableBalance = wallet.availableBalance || 0;
  
  return { 
    availableBalance,
    // Keep these for backward compatibility but they're no longer used
    balance: availableBalance, 
    heldAmount: 0 
  };
}

/**
 * Get manual top-up information (mobile number instead of QR)
 * @route GET /api/v1/wallet/gcash-qr
 */
const getGcashQr = catchAsync(async (req, res) => {
  try {
    // Get payment settings from system settings
    const paymentSettings = await SystemSettings.getSettingsByType('Payment');

    // Fallback to environment variables if settings not found
    const mobileNumber = paymentSettings?.topupMobileNumber || process.env.GCASH_ACCOUNT_NUMBER || '09123456789';
    const accountName = paymentSettings?.topupAccountName || process.env.GCASH_ACCOUNT_NAME || 'ParkTayo Admin';
    const instructions = paymentSettings?.topupInstructions || 'Send payment to the mobile number above via GCash, then contact admin for verification.';

    res.status(200).json({
      status: 'success',
      data: {
        // Keep backward compatibility with existing field names
        accountNumber: mobileNumber,
        accountName: accountName,
        instructions: instructions,
        // New field names for clarity
        mobileNumber: mobileNumber,
        paymentMethod: 'GCash/PayMaya Mobile Transfer'
      }
    });
  } catch (error) {
    logger.error('Error fetching top-up info:', error);

    // Fallback to environment variables if database error
    const mobileNumber = process.env.GCASH_ACCOUNT_NUMBER || '09123456789';
    const accountName = process.env.GCASH_ACCOUNT_NAME || 'ParkTayo Admin';

    res.status(200).json({
      status: 'success',
      data: {
        accountNumber: mobileNumber,
        accountName: accountName,
        instructions: 'Send payment to the mobile number above via GCash, then contact admin for verification.',
        mobileNumber: mobileNumber,
        paymentMethod: 'GCash/PayMaya Mobile Transfer'
      }
    });
  }
});

/**
 * Get user's wallet
 * @route GET /api/v1/wallet
 */
const getWallet = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  logger.info(`💰 Wallet requested by user ${userId}`);

  let wallet = await Wallet.findByUserId(userId);

  if (!wallet) {
    try {
      // Create wallet if it doesn't exist
      wallet = await Wallet.createWallet(userId, 0);
      logger.info(`✅ Created new wallet for user ${userId}`);
    } catch (error) {
      logger.error(`❌ Error creating wallet for user ${userId}:`, error);
      
      // If creation fails, try to find again (might have been created by another request)
      wallet = await Wallet.findByUserId(userId);
      if (!wallet) {
        // Try one more time with different approach
        try {
          wallet = new Wallet({
            userId,
            availableBalance: 0,
            transactions: [],
            isActive: true
          });
          await wallet.save();
          logger.info(`✅ Created wallet manually for user ${userId}`);
        } catch (retryError) {
          logger.error(`❌ Final wallet creation attempt failed for user ${userId}:`, retryError);
          return next(new AppError(`Failed to create wallet: ${error.message}`, 500));
        }
      }
    }
  } else {
    try {
      // Fix any null referenceIds before calculating balance
      let needsSave = false;
      wallet.transactions.forEach(transaction => {
        if (!transaction.referenceId || transaction.referenceId === null || transaction.referenceId === 'null') {
          transaction.referenceId = `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;
          needsSave = true;
        }
      });
      
      // No need to recalculate with simplified system - just ensure we have a valid balance
      if (typeof wallet.availableBalance !== 'number') {
        wallet.availableBalance = 0;
      }
      
      if (needsSave) {
        await wallet.save();
        logger.info(`🔧 Fixed null referenceIds for wallet ${wallet._id}`);
      }
    } catch (error) {
      logger.warn(`⚠️ Error updating wallet ${wallet._id}:`, error.message);
      // Continue with existing wallet data
    }
  }

  logger.info(`📊 Wallet data for user ${userId}:`, {
    walletId: wallet._id,
    availableBalance: wallet.availableBalance,
    transactionCount: wallet.transactions.length,
    lastTransaction: wallet.transactions.length > 0 ? wallet.transactions[wallet.transactions.length - 1].createdAt : null
  });

  res.status(200).json({
    status: 'success',
    data: {
      _id: wallet._id,
      userId: wallet.userId,
      balance: wallet.availableBalance, // Use availableBalance for backward compatibility
      availableBalance: wallet.availableBalance,
      heldAmount: 0, // Always 0 in simplified system
      transactions: wallet.transactions.slice(-10), // Last 10 transactions
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt
    }
  });
});

/**
 * Get wallet balance only (lighter endpoint)
 * @route GET /api/v1/wallet/balance
 */
const getWalletBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  
  logger.info(`💰 Wallet balance requested by user ${userId}`);

  let wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    wallet = await Wallet.createWallet(userId, 0);
    logger.info(`✅ Created new wallet for user ${userId}`);
  }

  const summary = computeWalletSummary(wallet);
  
  logger.info(`📊 Wallet balance for user ${userId}:`, {
    availableBalance: summary.availableBalance,
    balance: summary.balance,
    heldAmount: summary.heldAmount
  });

  res.status(200).json({
    status: 'success',
    data: summary
  });
});

/**
 * Create a new wallet
 * @route POST /api/v1/wallet
 */
const createWallet = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { initialBalance = 0 } = req.body;

  // Check if wallet already exists
  const existingWallet = await Wallet.findByUserId(userId);
  if (existingWallet) {
    return next(new AppError('Wallet already exists for this user', 400));
  }

  const wallet = await Wallet.createWallet(userId, initialBalance);

  logger.info(`Created wallet for user ${userId} with initial balance ${initialBalance}`);

  res.status(201).json({
    status: 'success',
    message: 'Wallet created successfully',
    data: {
      _id: wallet._id,
      userId: wallet.userId,
      balance: wallet.balance,
      transactions: wallet.transactions,
      createdAt: wallet.createdAt,
      updatedAt: wallet.updatedAt
    }
  });
});

/**
 * Top up wallet
 * @route POST /api/v1/wallet/top-up
 */
const topUpWallet = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { amount, paymentMethod } = req.body;

  logger.info(`💰 Wallet top-up requested by user ${userId}:`, {
    amount,
    paymentMethod
  });

  if (amount <= 0) {
    logger.warn(`❌ Invalid top-up amount for user ${userId}: ${amount}`);
    return next(new AppError('Amount must be greater than 0', 400));
  }

  let wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    wallet = await Wallet.createWallet(userId, 0);
    logger.info(`✅ Created new wallet for user ${userId} during top-up`);
  }

  // Create transaction
  const transaction = {
    type: 'credit',
    amount: amount,
    description: `Top-up via ${paymentMethod}`,
    paymentMethod: paymentMethod || 'wallet_transfer',
    status: 'completed' // For now, assume immediate completion
  };

  // Add transaction and update balance
  await wallet.addTransaction(transaction);
  await wallet.updateBalance(amount, 'credit');

  logger.info(`✅ Wallet top-up successful for user ${userId}:`, {
    amount,
    paymentMethod,
    newBalance: wallet.availableBalance,
    transactionId: wallet.transactions[wallet.transactions.length - 1]._id
  });

  res.status(200).json({
    status: 'success',
    message: 'Wallet topped up successfully',
    data: {
      _id: wallet.transactions[wallet.transactions.length - 1]._id,
      type: 'credit',
      amount: amount,
      description: transaction.description,
      paymentMethod: paymentMethod,
      status: 'completed',
      referenceId: wallet.transactions[wallet.transactions.length - 1].referenceId,
      createdAt: wallet.transactions[wallet.transactions.length - 1].createdAt
    }
  });
});

/**
 * Get wallet transactions
 * @route GET /api/v1/wallet/transactions
 */
const getTransactions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, type, status } = req.query;

  logger.info(`📋 Wallet transactions requested by user ${userId}:`, {
    page,
    limit,
    type,
    status
  });

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    logger.error(`❌ Wallet not found for user ${userId}`);
    return res.status(404).json({
      status: 'error',
      message: 'Wallet not found'
    });
  }

  let transactions = wallet.transactions;

  // Filter by type
  if (type) {
    transactions = transactions.filter(t => t.type === type);
    logger.info(`🔍 Filtered by type ${type}: ${transactions.length} transactions`);
  }

  // Filter by status
  if (status) {
    transactions = transactions.filter(t => t.status === status);
    logger.info(` Filtered by status ${status}: ${transactions.length} transactions`);
  }

  // Sort by date (newest first)
  transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

  // Pagination
  const startIndex = (page - 1) * limit;
  const endIndex = page * limit;
  const paginatedTransactions = transactions.slice(startIndex, endIndex);

  logger.info(`📊 Transaction results for user ${userId}:`, {
    totalTransactions: transactions.length,
    returnedTransactions: paginatedTransactions.length,
    currentPage: parseInt(page),
    totalPages: Math.ceil(transactions.length / limit)
  });

  res.status(200).json({
    status: 'success',
    data: {
      transactions: paginatedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(transactions.length / limit),
        totalTransactions: transactions.length,
        hasNextPage: endIndex < transactions.length,
        hasPrevPage: page > 1
      }
    }
  });
});

/**
 * Pay for booking using wallet
 * @route POST /api/v1/wallet/pay
 */
const payWithWallet = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { bookingId, amount } = req.body;

  logger.info(`💳 Wallet payment requested by user ${userId}:`, {
    bookingId,
    amount
  });

  if (amount <= 0) {
    logger.warn(`❌ Invalid payment amount for user ${userId}: ${amount}`);
    return next(new AppError('Amount must be greater than 0', 400));
  }

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    logger.error(`❌ Wallet not found for user ${userId}`);
    return next(new AppError('Wallet not found', 404));
  }

  if (!wallet.hasSufficientBalance(amount)) {
    logger.warn(`❌ Insufficient balance for user ${userId}:`, {
      requested: amount,
      available: wallet.availableBalance
    });
    return next(new AppError('Insufficient wallet balance', 400));
  }

  // Create transaction
  const transaction = {
    type: 'debit',
    amount: amount,
    description: `Payment for booking ${bookingId}`,
    bookingId: bookingId,
    status: 'completed'
  };

  // Add transaction and update balance
  await wallet.addTransaction(transaction);
  await wallet.updateBalance(amount, 'debit');

  logger.info(`✅ Wallet payment successful for user ${userId}:`, {
    bookingId,
    amount,
    newBalance: wallet.availableBalance,
    transactionId: wallet.transactions[wallet.transactions.length - 1]._id
  });

  res.status(200).json({
    status: 'success',
    message: 'Payment successful',
    data: {
      _id: wallet.transactions[wallet.transactions.length - 1]._id,
      type: 'debit',
      amount: amount,
      description: transaction.description,
      bookingId: bookingId,
      status: 'completed',
      referenceId: wallet.transactions[wallet.transactions.length - 1].referenceId,
      createdAt: wallet.transactions[wallet.transactions.length - 1].createdAt
    }
  });
});

/**
 * Request refund
 * @route POST /api/v1/wallet/refund
 */
const requestRefund = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { bookingId, amount, reason } = req.body;

  if (amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return next(new AppError('Wallet not found', 404));
  }

  // Create refund transaction
  const transaction = {
    type: 'refund',
    amount: amount,
    description: `Refund for booking ${bookingId}: ${reason}`,
    bookingId: bookingId,
    status: 'pending' // Refunds need approval
  };

  // Add transaction
  await wallet.addTransaction(transaction);

  logger.info(`Refund requested for user ${userId}: ${amount} for booking ${bookingId}`);

  res.status(200).json({
    status: 'success',
    message: 'Refund request submitted successfully',
    data: {
      _id: wallet.transactions[wallet.transactions.length - 1]._id,
      type: 'refund',
      amount: amount,
      description: transaction.description,
      bookingId: bookingId,
      status: 'pending',
      referenceId: wallet.transactions[wallet.transactions.length - 1].referenceId,
      createdAt: wallet.transactions[wallet.transactions.length - 1].createdAt
    }
  });
});

/**
 * Get wallet balance only
 * @route GET /api/v1/wallet/balance
 */
const getBalance = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return res.status(404).json({
      status: 'error',
      message: 'Wallet not found'
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      balance: wallet.availableBalance, // Use availableBalance for backward compatibility
      availableBalance: wallet.availableBalance,
      heldAmount: 0 // Always 0 in simplified system
    }
  });
});

/**
 * Hold amount for booking reservation
 * @route POST /api/v1/wallet/hold
 */
const holdAmount = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { amount, bookingId, description } = req.body;

  if (amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return next(new AppError('Wallet not found', 404));
  }

  try {
    const holdReference = await wallet.holdAmount(amount, bookingId, description);
    
    logger.info(`Amount held for user ${userId}: ${amount} (Hold: ${holdReference})`);

    res.status(200).json({
      status: 'success',
      message: 'Amount held successfully',
      data: {
        holdReference: holdReference,
        amount: amount,
        bookingId: bookingId,
        availableBalance: wallet.availableBalance,
        heldAmount: 0 // Always 0 in simplified system
      }
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

/**
 * Get wallet summary (schema-agnostic)
 * @route GET /api/v1/wallet/summary
 */
const getWalletSummary = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  let wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    wallet = await Wallet.createWallet(userId, 0);
    logger.info(`Created new wallet for user ${userId}`);
  }

  const summary = computeWalletSummary(wallet);
  res.status(200).json({
    status: 'success',
    data: {
      ...summary,
      userId: wallet.userId,
      transactions: wallet.transactions.slice(-10)
    }
  });
});

/**
 * Release held amount (refund)
 * @route POST /api/v1/wallet/release
 */
const releaseHold = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { holdReference, reason } = req.body;

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return next(new AppError('Wallet not found', 404));
  }

  try {
    await wallet.releaseHold(holdReference, reason);
    
    logger.info(`Hold released for user ${userId}: ${holdReference}`);

    res.status(200).json({
      status: 'success',
      message: 'Hold released successfully',
      data: {
        holdReference: holdReference,
        availableBalance: wallet.availableBalance,
        heldAmount: 0 // Always 0 in simplified system
      }
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

/**
 * Capture held amount (convert to payment)
 * @route POST /api/v1/wallet/capture
 */
const captureHold = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { holdReference, description } = req.body;

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return next(new AppError('Wallet not found', 404));
  }

  try {
    await wallet.captureHold(holdReference, description);
    
    logger.info(`Hold captured for user ${userId}: ${holdReference}`);

    res.status(200).json({
      status: 'success',
      message: 'Hold captured successfully',
      data: {
        holdReference: holdReference,
        balance: wallet.balance,
        availableBalance: wallet.availableBalance,
        heldAmount: wallet.heldAmount
      }
    });
  } catch (error) {
    return next(new AppError(error.message, 400));
  }
});

/**
 * Get earnings summary for landlords
 * @route GET /api/v1/wallet/earnings
 */
const getEarningsSummary = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { timeframe = 'weekly', includeProjections = false, compareWithPrevious = false } = req.query;

  logger.info(`💰 [FINANCE] Earnings summary requested by user ${userId}:`, {
    timeframe,
    includeProjections,
    compareWithPrevious,
    timestamp: new Date().toISOString()
  });

  // Get landlord's parking spaces for earnings calculation
  const ParkingSpace = require('../models/ParkingSpace');
  const Booking = require('../models/Booking');
  
  const parkingSpaces = await ParkingSpace.find({ landlordId: userId }).select('_id');
  const spaceIds = parkingSpaces.map(space => space._id);

  logger.info(`️ Found ${parkingSpaces.length} parking spaces for user ${userId}:`, {
    spaceIds: spaceIds.slice(0, 3).join(', ') + (spaceIds.length > 3 ? '...' : '')
  });

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    logger.error(`❌ Wallet not found for user ${userId}`);
    return res.status(404).json({
      status: 'error',
      message: 'Wallet not found'
    });
  }

  // Calculate date range based on timeframe with enhanced options
  const now = new Date();
  let startDate, dataPoints, periodName;
  
  switch (timeframe) {
    case 'daily':
      startDate = new Date(now.getTime() - (1 * 24 * 60 * 60 * 1000));
      dataPoints = 24; // Hourly data points
      periodName = 'Last 24 Hours';
      break;
    case 'weekly':
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      dataPoints = 7; // Daily data points
      periodName = 'Last 7 Days';
      break;
    case 'bi-weekly':
      startDate = new Date(now.getTime() - (14 * 24 * 60 * 60 * 1000));
      dataPoints = 14; // Daily data points
      periodName = 'Last 14 Days';
      break;
    case 'monthly':
      startDate = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      dataPoints = 12; // Monthly data points (last year)
      periodName = 'Last 30 Days';
      break;
    case 'quarterly':
      startDate = new Date(now.getTime() - (90 * 24 * 60 * 60 * 1000));
      dataPoints = 12; // Weekly data points
      periodName = 'Last 3 Months';
      break;
    case 'yearly':
      startDate = new Date(now.getTime() - (365 * 24 * 60 * 60 * 1000));
      dataPoints = 12; // Monthly data points
      periodName = 'Last 12 Months';
      break;
    default:
      startDate = new Date(now.getTime() - (7 * 24 * 60 * 60 * 1000));
      dataPoints = 7;
      periodName = 'Last 7 Days';
  }

  logger.info(`📅 [FINANCE] Date range for earnings calculation:`, {
    timeframe,
    periodName,
    startDate: startDate.toISOString(),
    endDate: now.toISOString(),
    dataPoints,
    durationDays: Math.ceil((now - startDate) / (1000 * 60 * 60 * 24))
  });

  // Calculate real earnings from bookings
  logger.info(`🔍 Starting earnings calculation for user ${userId}:`, {
    spaceIds,
    timeframe,
    startDate: startDate.toISOString(),
    endDate: now.toISOString()
  });

  // Calculate current period and previous period for comparison
  const periodDuration = now - startDate;
  const previousPeriodStart = new Date(startDate.getTime() - periodDuration);
  const previousPeriodEnd = startDate;

  logger.info(`📊 [FINANCE] Period comparison setup:`, {
    currentPeriod: { start: startDate.toISOString(), end: now.toISOString() },
    previousPeriod: { start: previousPeriodStart.toISOString(), end: previousPeriodEnd.toISOString() },
    compareWithPrevious: compareWithPrevious === 'true'
  });

  const aggregationQueries = [
    // Total earnings from all completed bookings
    Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true }
      }},
      { $group: { 
        _id: null,
        totalEarnings: { 
          $sum: '$pricing.totalAmount'
        },
        bookingCount: { $sum: 1 },
        averageBookingValue: { $avg: '$pricing.totalAmount' }
      }}
    ]),
    // Current period earnings
    Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true },
        createdAt: { $gte: startDate, $lte: now }
      }},
      { $group: { 
        _id: null,
        periodEarnings: { 
          $sum: '$pricing.totalAmount'
        },
        periodBookings: { $sum: 1 },
        averageBookingValue: { $avg: '$pricing.totalAmount' }
      }}
    ])
  ];

  // Add previous period query if comparison is requested
  if (compareWithPrevious === 'true') {
    aggregationQueries.push(
      Booking.aggregate([
        { $match: { 
          parkingSpaceId: { $in: spaceIds },
          status: { $in: ['completed', 'parked'] },
          'pricing.totalAmount': { $exists: true },
          createdAt: { $gte: previousPeriodStart, $lt: previousPeriodEnd }
        }},
        { $group: { 
          _id: null,
          previousEarnings: { 
            $sum: '$pricing.totalAmount'
          },
          previousBookings: { $sum: 1 },
          averageBookingValue: { $avg: '$pricing.totalAmount' }
        }}
      ])
    );
  }

  const results = await Promise.all(aggregationQueries);
  const [totalBookingEarnings, periodBookingEarnings, previousPeriodEarnings] = results;

  // Add comprehensive debugging for booking status analysis
  const allBookingsDebug = await Booking.find({ parkingSpaceId: { $in: spaceIds } })
    .select('status pricing.totalAmount pricing.isPaid createdAt')
    .sort({ createdAt: -1 });
  
  const statusCounts = {};
  allBookingsDebug.forEach(booking => {
    statusCounts[booking.status] = (statusCounts[booking.status] || 0) + 1;
  });

  logger.info(`🔍 [FINANCE] COMPREHENSIVE booking analysis for user ${userId}:`, {
    totalBookingsFound: allBookingsDebug.length,
    statusBreakdown: statusCounts,
    recentBookings: allBookingsDebug.slice(0, 3).map(b => ({
      status: b.status,
      amount: b.pricing?.totalAmount,
      isPaid: b.pricing?.isPaid,
      createdAt: b.createdAt
    }))
  });

  logger.info(`📊 [FINANCE] Raw aggregation results for user ${userId}:`, {
    totalBookingEarnings: JSON.stringify(totalBookingEarnings[0]),
    periodBookingEarnings: JSON.stringify(periodBookingEarnings[0]),
    previousPeriodEarnings: previousPeriodEarnings ? JSON.stringify(previousPeriodEarnings[0]) : null
  });

  const totalEarnings = totalBookingEarnings[0]?.totalEarnings || 0;
  const totalBookings = totalBookingEarnings[0]?.bookingCount || 0;
  const totalAverageBookingValue = totalBookingEarnings[0]?.averageBookingValue || 0;
  
  const periodEarnings = periodBookingEarnings[0]?.periodEarnings || 0;
  const periodBookings = periodBookingEarnings[0]?.periodBookings || 0;
  const periodAverageBookingValue = periodBookingEarnings[0]?.averageBookingValue || 0;
  
  // Previous period data (for comparison)
  const previousEarnings = previousPeriodEarnings?.[0]?.previousEarnings || 0;
  const previousBookings = previousPeriodEarnings?.[0]?.previousBookings || 0;
  const previousAverageBookingValue = previousPeriodEarnings?.[0]?.averageBookingValue || 0;
  
  // Calculate growth metrics
  const earningsGrowth = previousEarnings > 0 ? 
    ((periodEarnings - previousEarnings) / previousEarnings * 100) : 0;
  const bookingsGrowth = previousBookings > 0 ? 
    ((periodBookings - previousBookings) / previousBookings * 100) : 0;
  const averageValueGrowth = previousAverageBookingValue > 0 ? 
    ((periodAverageBookingValue - previousAverageBookingValue) / previousAverageBookingValue * 100) : 0;

  logger.info(`💰 [FINANCE] Enhanced earnings calculation for user ${userId}:`, {
    timeframe,
    periodName,
    current: {
      earnings: periodEarnings,
      bookings: periodBookings,
      averageValue: periodAverageBookingValue
    },
    previous: compareWithPrevious === 'true' ? {
      earnings: previousEarnings,
      bookings: previousBookings,
      averageValue: previousAverageBookingValue
    } : null,
    growth: compareWithPrevious === 'true' ? {
      earnings: `${earningsGrowth.toFixed(1)}%`,
      bookings: `${bookingsGrowth.toFixed(1)}%`,
      averageValue: `${averageValueGrowth.toFixed(1)}%`
    } : null,
    totals: {
      allTimeEarnings: totalEarnings,
      allTimeBookings: totalBookings,
      allTimeAverageValue: totalAverageBookingValue
    }
  });

  // Debug: Check bookings like dashboard does
  const debugBookings = await Booking.find({ parkingSpaceId: { $in: spaceIds } })
    .select('status pricing.totalAmount createdAt')
    .sort({ createdAt: -1 })
    .limit(5);
  
  logger.info(`💼 Debug: Recent bookings for wallet calculation:`);
  debugBookings.forEach((booking, index) => {
    logger.info(`   ${index + 1}. Status: ${booking.status}, Total: ${booking.pricing?.totalAmount}`);
  });
  
  // Also include wallet expenses (withdrawals, fees)
  const expenseTransactions = wallet.transactions.filter(transaction => {
    const transactionDate = new Date(transaction.createdAt);
    return transactionDate >= startDate && 
           ['debit', 'transfer_out'].includes(transaction.type) &&
           transaction.status === 'completed';
  });
  const totalExpenses = expenseTransactions.reduce((sum, t) => sum + t.amount, 0);
  
  const netEarnings = periodEarnings - totalExpenses;

  logger.info(`💸 Expense calculation for user ${userId}:`, {
    expenseTransactions: expenseTransactions.length,
    totalExpenses,
    netEarnings
  });

  // Generate enhanced chart data based on timeframe using booking data
  let chartData = [];
  
  for (let i = 0; i < dataPoints; i++) {
    let periodStart, periodEnd, label;
    
    if (timeframe === 'daily') {
      // Hourly data points for daily view
      periodStart = new Date(now.getTime() - ((dataPoints - i) * 60 * 60 * 1000));
      periodEnd = new Date(now.getTime() - ((dataPoints - i - 1) * 60 * 60 * 1000));
      label = periodStart.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    } else if (timeframe === 'weekly' || timeframe === 'bi-weekly') {
      // Daily data points for weekly/bi-weekly view
      periodStart = new Date(now.getTime() - ((dataPoints - i) * 24 * 60 * 60 * 1000));
      periodEnd = new Date(now.getTime() - ((dataPoints - i - 1) * 24 * 60 * 60 * 1000));
      label = periodStart.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    } else if (timeframe === 'monthly') {
      // Monthly data points for yearly view
      const monthDate = new Date(now.getFullYear(), now.getMonth() - (dataPoints - i - 1), 1);
      periodStart = monthDate;
      periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      label = monthDate.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
    } else if (timeframe === 'quarterly') {
      // Weekly data points for quarterly view
      periodStart = new Date(now.getTime() - ((dataPoints - i) * 7 * 24 * 60 * 60 * 1000));
      periodEnd = new Date(now.getTime() - ((dataPoints - i - 1) * 7 * 24 * 60 * 60 * 1000));
      label = `W${Math.ceil((dataPoints - i) / 4)}`; // Week number
    } else { // yearly
      const monthDate = new Date(now.getFullYear(), now.getMonth() - (dataPoints - i - 1), 1);
      periodStart = monthDate;
      periodEnd = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
      label = monthDate.toLocaleDateString('en-US', { month: 'short' });
    }

    // Get period earnings from bookings
    const periodBookingEarnings = await Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        'pricing.totalAmount': { $exists: true },
        createdAt: { $gte: periodStart, $lt: periodEnd }
      }},
      { $group: { 
        _id: null,
        earnings: { 
          $sum: '$pricing.totalAmount'
        },
        bookingCount: { $sum: 1 }
      }}
    ]);

    chartData.push({
      label,
      amount: periodBookingEarnings[0]?.earnings || 0,
      bookings: periodBookingEarnings[0]?.bookingCount || 0,
      averageBookingValue: periodBookingEarnings[0]?.bookingCount > 0 ? 
        (periodBookingEarnings[0]?.earnings / periodBookingEarnings[0]?.bookingCount) : 0,
      date: periodStart.toISOString(),
      period: {
        start: periodStart.toISOString(),
        end: periodEnd.toISOString()
      }
    });
  }

  logger.info(`📈 Chart data generated for user ${userId}:`, {
    dataPoints: chartData.length,
    totalChartEarnings: chartData.reduce((sum, data) => sum + data.amount, 0)
  });

  const responseData = {
    timeframe,
    periodName,
    period: {
      start: startDate.toISOString(),
      end: now.toISOString(),
      durationDays: Math.ceil((now - startDate) / (1000 * 60 * 60 * 24))
    },
    summary: {
      // Current period metrics
      totalEarnings,
      periodEarnings,
      totalExpenses,
      netEarnings,
      totalBookings,
      periodBookings,
      
      // Enhanced metrics
      totalAverageBookingValue: parseFloat(totalAverageBookingValue.toFixed(2)),
      periodAverageBookingValue: parseFloat(periodAverageBookingValue.toFixed(2)),
      
      // Growth metrics (if comparison enabled)
      ...(compareWithPrevious === 'true' && {
        previousPeriod: {
          earnings: previousEarnings,
          bookings: previousBookings,
          averageBookingValue: parseFloat(previousAverageBookingValue.toFixed(2))
        },
        growth: {
          earnings: parseFloat(earningsGrowth.toFixed(1)),
          bookings: parseFloat(bookingsGrowth.toFixed(1)),
          averageBookingValue: parseFloat(averageValueGrowth.toFixed(1))
        }
      }),
      
      // Calculated metrics
      averageEarningsPerBooking: totalBookings > 0 ? parseFloat((totalEarnings / totalBookings).toFixed(2)) : 0,
      periodDailyAverage: parseFloat((periodEarnings / Math.max(1, Math.ceil((now - startDate) / (1000 * 60 * 60 * 24)))).toFixed(2)),
      
      // Performance indicators
      bookingFrequency: parseFloat((periodBookings / Math.max(1, Math.ceil((now - startDate) / (1000 * 60 * 60 * 24)))).toFixed(2)),
      conversionRate: totalBookings > 0 ? parseFloat(((periodBookings / totalBookings) * 100).toFixed(1)) : 0
    },
    chartData,
    metadata: {
      dataPointsGenerated: chartData.length,
      includesProjections: includeProjections === 'true',
      includesComparison: compareWithPrevious === 'true',
      calculatedAt: now.toISOString(),
      parkingSpacesAnalyzed: spaceIds.length
    }
  };

  logger.info(`📤 [FINANCE] Enhanced earnings response for user ${userId}:`, {
    timeframe: responseData.timeframe,
    periodName: responseData.periodName,
    summary: {
      periodEarnings: responseData.summary.periodEarnings,
      periodBookings: responseData.summary.periodBookings,
      periodAverageValue: responseData.summary.periodAverageBookingValue,
      periodDailyAverage: responseData.summary.periodDailyAverage,
      bookingFrequency: responseData.summary.bookingFrequency,
      growth: responseData.summary.growth || 'No comparison data'
    },
    chartDataPoints: responseData.chartData.length,
    metadata: responseData.metadata
  });

  res.status(200).json({
    status: 'success',
    data: responseData
  });
});

/**
 * Get wallet transactions with pagination
 * @route GET /api/v1/wallet/transactions
 */
const getWalletTransactions = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { page = 1, limit = 20, type, status } = req.query;
  
  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return next(new AppError('Wallet not found', 404));
  }
  
  let transactions = [...wallet.transactions];
  
  // Filter by type if provided
  if (type) {
    transactions = transactions.filter(t => t.type === type);
  }
  
  // Filter by status if provided  
  if (status) {
    transactions = transactions.filter(t => t.status === status);
  }
  
  // Sort by creation date (newest first)
  transactions = transactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  
  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedTransactions = transactions.slice(startIndex, endIndex);
  
  res.status(200).json({
    status: 'success',
    data: {
      transactions: paginatedTransactions,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(transactions.length / parseInt(limit)),
        totalItems: transactions.length,
        itemsPerPage: parseInt(limit)
      }
    }
  });
});

/**
 * Request payout to bank account for landlords
 * @route POST /api/v1/wallet/payout
 */
const requestPayout = catchAsync(async (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const { amount, bankAccount, accountName, notes } = req.body;

  if (amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  const wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    return next(new AppError('Wallet not found', 404));
  }

  if (!wallet.hasSufficientBalance(amount)) {
    return next(new AppError(
      `Insufficient wallet balance. Available: ₱${wallet.availableBalance}, Requested: ₱${amount}`, 
      400
    ));
  }

  // Create payout transaction (pending approval)
  const payoutTransaction = {
    type: 'transfer_out',
    amount: amount,
    description: `Payout request to ${accountName} (${bankAccount})`,
    status: 'pending',
    metadata: new Map([
      ['payoutType', 'bank_transfer'],
      ['bankAccount', bankAccount],
      ['accountName', accountName],
      ['notes', notes || ''],
      ['requestedAt', new Date().toISOString()]
    ])
  };

  // Hold the amount until payout is approved
  const holdReference = await wallet.holdAmount(
    amount,
    null, // No booking ID for payouts
    `Payout hold: ${accountName} (${bankAccount})`
  );

  // Add the pending transaction
  payoutTransaction.holdReference = holdReference;
  await wallet.addTransaction(payoutTransaction);

  logger.info(`Payout request created for user ${userId}: ₱${amount} to ${accountName}`);

  res.status(200).json({
    status: 'success',
    message: 'Payout request submitted successfully. It will be processed within 1-3 business days.',
    data: {
      payoutId: payoutTransaction.referenceId,
      amount: amount,
      bankAccount: bankAccount,
      accountName: accountName,
      status: 'pending',
      holdReference: holdReference
    }
  });
});

/**
 * Clean up wallet referenceId issues
 * @route POST /api/v1/wallet/cleanup
 */
const cleanupWalletReferenceIds = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  try {
    // Find user's wallet
    const wallet = await Wallet.findByUserId(userId);
    
    if (!wallet) {
      return res.status(404).json({
        status: 'error',
        message: 'Wallet not found'
      });
    }

    // Remove transactions with null or duplicate referenceIds
    const cleanedTransactions = [];
    const seenReferenceIds = new Set();
    let cleanedCount = 0;

    wallet.transactions.forEach((transaction, index) => {
      // Fix transactions with null or invalid referenceIds
      if (!transaction.referenceId || transaction.referenceId === 'null') {
        transaction.referenceId = `TXN-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        cleanedCount++;
      }

      // Only keep transactions with unique referenceIds
      if (!seenReferenceIds.has(transaction.referenceId)) {
        seenReferenceIds.add(transaction.referenceId);
        cleanedTransactions.push(transaction);
      } else {
        // Found duplicate, generate new referenceId
        transaction.referenceId = `TXN-${Date.now()}-DUP-${index}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
        cleanedTransactions.push(transaction);
        cleanedCount++;
      }
    });

    const removedCount = wallet.transactions.length - cleanedTransactions.length;
    wallet.transactions = cleanedTransactions;
    
    if (cleanedCount > 0 || removedCount > 0) {
      await wallet.save();
      logger.info(`✅ Cleaned up wallet for user ${userId}: fixed ${cleanedCount} referenceIds, removed ${removedCount} duplicates`);
    }

    res.status(200).json({
      status: 'success',
      message: 'Wallet cleaned up successfully',
      data: {
        fixedReferenceIds: cleanedCount,
        removedDuplicates: removedCount,
        totalTransactions: cleanedTransactions.length
      }
    });
  } catch (error) {
    logger.error('Error cleaning up wallet:', error);
    next(error);
  }
});

module.exports = {
  getWallet,
  getWalletBalance,
  getWalletSummary,
  getWalletTransactions,
  createWallet,
  cleanupWalletReferenceIds,
  topUpWallet,
  getTransactions,
  payWithWallet,
  requestRefund,
  getBalance,
  getGcashQr,
  holdAmount,
  releaseHold,
  captureHold,
  getEarningsSummary,
  requestPayout
};
