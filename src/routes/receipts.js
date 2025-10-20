const express = require('express');
const receiptController = require('../controllers/receiptController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');
const cloudinaryService = require('../services/cloudinaryService');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @route   POST /api/v1/receipts/upload
 * @desc    Upload receipt for top-up verification
 * @access  Private (User)
 */
router.post('/upload',
  (req, res, next) => {
    const upload = cloudinaryService.getUploadMiddleware('receipt');
    upload(req, res, (err) => {
      if (err) {
        // Handle Multer errors
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({
            status: 'error',
            message: 'File size too large. Maximum size is 5MB.'
          });
        } else if (err.message.includes('Only image files are allowed')) {
          return res.status(400).json({
            status: 'error',
            message: 'Only image files are allowed. Please select a valid image file (JPG, PNG, GIF, etc.)'
          });
        } else {
          return res.status(400).json({
            status: 'error',
            message: err.message || 'File upload error'
          });
        }
      }
      next();
    });
  },
  receiptController.uploadReceipt
);

/**
 * @route   GET /api/v1/receipts/my-receipts
 * @desc    Get user's receipts
 * @access  Private (User)
 */
router.get('/my-receipts', receiptController.getMyReceipts);

/**
 * @route   GET /api/v1/receipts/:receiptId
 * @desc    Get receipt by ID (user can only access their own)
 * @access  Private (User)
 */
router.get('/:receiptId', receiptController.getReceiptById);

// Admin routes - require admin role
router.use(requireAdmin);

/**
 * @route   GET /api/v1/receipts/admin/all
 * @desc    Get all receipts
 * @access  Private (Admin)
 */
router.get('/admin/all', receiptController.getAllReceipts);

/**
 * @route   GET /api/v1/receipts/admin/pending
 * @desc    Get pending receipts
 * @access  Private (Admin)
 */
router.get('/admin/pending', receiptController.getPendingReceipts);

/**
 * @route   GET /api/v1/receipts/admin/stats
 * @desc    Get receipt statistics
 * @access  Private (Admin)
 */
router.get('/admin/stats', receiptController.getReceiptStats);

/**
 * @route   POST /api/v1/receipts/admin/:receiptId/approve
 * @desc    Approve receipt
 * @access  Private (Admin)
 */
router.post('/admin/:receiptId/approve', receiptController.approveReceipt);

/**
 * @route   POST /api/v1/receipts/admin/:receiptId/reject
 * @desc    Reject receipt
 * @access  Private (Admin)
 */
router.post('/admin/:receiptId/reject', receiptController.rejectReceipt);

module.exports = router;