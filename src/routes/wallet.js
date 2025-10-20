const express = require('express');
const { body, query } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const walletController = require('../controllers/walletController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

// Validation rules
const topUpValidation = [
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be a positive number'),
  body('paymentMethod')
    .isIn(['gcash', 'paymaya', 'card', 'wallet_transfer'])
    .withMessage('Invalid payment method'),
  validateRequest
];

const payValidation = [
  body('bookingId')
    .isMongoId()
    .withMessage('Invalid booking ID'),
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be a positive number'),
  validateRequest
];

const refundValidation = [
  body('bookingId')
    .isMongoId()
    .withMessage('Invalid booking ID'),
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be a positive number'),
  body('reason')
    .isString()
    .isLength({ min: 1, max: 500 })
    .withMessage('Reason must be between 1 and 500 characters'),
  validateRequest
];

const transactionsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  query('type')
    .optional()
    .isIn(['credit', 'debit', 'refund', 'hold', 'release', 'capture', 'transfer_in', 'transfer_out'])
    .withMessage('Invalid transaction type'),
  query('status')
    .optional()
    .isIn(['pending', 'completed', 'failed', 'cancelled'])
    .withMessage('Invalid transaction status'),
  validateRequest
];

const holdValidation = [
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be a positive number'),
  body('bookingId')
    .isMongoId()
    .withMessage('Invalid booking ID'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  validateRequest
];

const releaseValidation = [
  body('holdReference')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Hold reference is required'),
  body('reason')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Reason must be less than 500 characters'),
  validateRequest
];

const captureValidation = [
  body('holdReference')
    .isString()
    .isLength({ min: 1 })
    .withMessage('Hold reference is required'),
  body('description')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Description must be less than 500 characters'),
  validateRequest
];

const payoutValidation = [
  body('amount')
    .isFloat({ min: 1 })
    .withMessage('Amount must be a positive number'),
  body('bankAccount')
    .isString()
    .isLength({ min: 5, max: 50 })
    .withMessage('Bank account must be between 5 and 50 characters'),
  body('accountName')
    .isString()
    .isLength({ min: 2, max: 100 })
    .withMessage('Account name must be between 2 and 100 characters'),
  body('notes')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Notes must be less than 500 characters'),
  validateRequest
];

// Routes

/**
 * @route   GET /api/v1/wallet
 * @desc    Get user's wallet
 * @access  Private
 */
router.get('/', walletController.getWallet);

/**
 * @route   POST /api/v1/wallet
 * @desc    Create a new wallet
 * @access  Private
 */
router.post('/', walletController.createWallet);

/**
 * @route   GET /api/v1/wallet/balance
 * @desc    Get wallet balance only
 * @access  Private
 */
router.get('/balance', walletController.getWalletBalance);
// Schema-agnostic summary endpoint
router.get('/summary', walletController.getWalletSummary);

/**
 * @route   POST /api/v1/wallet/cleanup
 * @desc    Clean up wallet referenceId issues
 * @access  Private
 */
router.post('/cleanup', walletController.cleanupWalletReferenceIds);

/**
 * @route   GET /api/v1/wallet/earnings-summary
 * @desc    Get earnings summary for landlords (timeframe: weekly, monthly, yearly)
 * @access  Private
 */
router.get('/earnings-summary', walletController.getEarningsSummary);

/**
 * @route   GET /api/v1/wallet/transactions
 * @desc    Get wallet transactions with pagination
 * @access  Private
 */
router.get('/transactions', walletController.getWalletTransactions);

/**
 * @route   GET /api/v1/wallet/gcash-qr
 * @desc    Get GCash QR and account info for manual top-up
 * @access  Private
 */
router.get('/gcash-qr', walletController.getGcashQr);

/**
 * @route   POST /api/v1/wallet/top-up
 * @desc    Top up wallet
 * @access  Private
 */
router.post('/top-up', topUpValidation, walletController.topUpWallet);

/**
 * @route   GET /api/v1/wallet/transactions
 * @desc    Get wallet transactions
 * @access  Private
 */
router.get('/transactions', transactionsValidation, walletController.getTransactions);

/**
 * @route   POST /api/v1/wallet/pay
 * @desc    Pay for booking using wallet
 * @access  Private
 */
router.post('/pay', payValidation, walletController.payWithWallet);

/**
 * @route   POST /api/v1/wallet/refund
 * @desc    Request refund
 * @access  Private
 */
router.post('/refund', refundValidation, walletController.requestRefund);

/**
 * @route   POST /api/v1/wallet/hold
 * @desc    Hold amount for booking reservation
 * @access  Private
 */
router.post('/hold', holdValidation, walletController.holdAmount);

/**
 * @route   POST /api/v1/wallet/release
 * @desc    Release held amount (refund)
 * @access  Private
 */
router.post('/release', releaseValidation, walletController.releaseHold);

/**
 * @route   POST /api/v1/wallet/capture
 * @desc    Capture held amount (convert to payment)
 * @access  Private
 */
router.post('/capture', captureValidation, walletController.captureHold);

/**
 * @route   POST /api/v1/wallet/payout
 * @desc    Request payout to bank account (for landlords)
 * @access  Private
 */
router.post('/payout', payoutValidation, walletController.requestPayout);

module.exports = router;
