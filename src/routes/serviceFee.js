const express = require('express');
const serviceFeeController = require('../controllers/serviceFeeController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Apply authentication to all routes
router.use(authenticateToken);

/**
 * @route   GET /api/service-fees/analytics
 * @desc    Get app revenue analytics
 * @access  Admin only
 * @query   startDate, endDate, vehicleCategory, bookingType, paymentStatus
 */
router.get('/analytics', requireAdmin, serviceFeeController.getRevenueAnalytics);

/**
 * @route   GET /api/service-fees/breakdown
 * @desc    Get service fee breakdown by vehicle category
 * @access  Admin only
 * @query   startDate, endDate, paymentStatus
 */
router.get('/breakdown', requireAdmin, serviceFeeController.getServiceFeeBreakdown);

/**
 * @route   GET /api/service-fees/trends
 * @desc    Get revenue trends and projections
 * @access  Admin only
 * @query   days
 */
router.get('/trends', requireAdmin, serviceFeeController.getRevenueTrends);

/**
 * @route   GET /api/service-fees/top-spaces
 * @desc    Get top earning parking spaces for the app
 * @access  Admin only
 * @query   startDate, endDate, paymentStatus, limit
 */
router.get('/top-spaces', requireAdmin, serviceFeeController.getTopEarningSpaces);

/**
 * @route   POST /api/service-fees/record
 * @desc    Record service fee for a booking (internal use)
 * @access  Admin only
 * @body    bookingData object
 */
router.post('/record', requireAdmin, serviceFeeController.recordServiceFee);

/**
 * @route   PUT /api/service-fees/:bookingId/payment-status
 * @desc    Update payment status of service fee record
 * @access  Admin only
 * @body    { status: 'paid' | 'refunded' | 'partially_refunded' }
 */
router.put('/:bookingId/payment-status', requireAdmin, serviceFeeController.updatePaymentStatus);

module.exports = router;
