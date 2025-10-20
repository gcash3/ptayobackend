const express = require('express');
const { body } = require('express-validator');
const router = express.Router();

const {
  generateCheckoutQR,
  processQRCheckout,
  calculateCheckoutPreview,
  getLandlordActiveBookings
} = require('../controllers/qrCheckoutController');

const { authenticateToken, authorizeRoles } = require('../middleware/auth');
// Temporarily disable rate limiting to fix server startup
// const { rateLimiters } = require('../middleware/rateLimiter');

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @route   GET /api/v1/qr/bookings
 * @desc    Get landlord's active bookings for QR generation
 * @access  Private (Landlord only)
 */
router.get('/bookings', 
  authorizeRoles('landlord'),
  // rateLimiters.standard, // 30 requests per minute - temporarily disabled
  getLandlordActiveBookings
);

/**
 * @route   POST /api/v1/qr/generate/:bookingId
 * @desc    Generate QR code for manual checkout
 * @access  Private (Landlord only)
 */
router.post('/generate/:bookingId',
  authorizeRoles('landlord'),
  // rateLimiters.qr, // 10 QR generations per minute - temporarily disabled
  [
    // Validate bookingId parameter
    body().custom((value, { req }) => {
      const { bookingId } = req.params;
      if (!bookingId || !bookingId.match(/^[0-9a-fA-F]{24}$/)) {
        throw new Error('Invalid booking ID format');
      }
      return true;
    })
  ],
  generateCheckoutQR
);

/**
 * @route   GET /api/v1/qr/calculate/:bookingId
 * @desc    Calculate checkout preview (for client to see overtime charges)
 * @access  Private (Client only)
 */
router.get('/calculate/:bookingId',
  authorizeRoles('client'),
  // rateLimiters.standard, // 30 requests per minute - temporarily disabled
  calculateCheckoutPreview
);

/**
 * @route   POST /api/v1/qr/checkout
 * @desc    Process QR code checkout
 * @access  Private (Client only)
 */
router.post('/checkout',
  authorizeRoles('client'),
  // rateLimiters.strict, // 5 QR checkouts per minute - temporarily disabled
  [
    body('qrData')
      .notEmpty()
      .withMessage('QR data is required')
      .isLength({ min: 10, max: 5000 })
      .withMessage('QR data must be between 10 and 5000 characters')
  ],
  processQRCheckout
);

module.exports = router;
