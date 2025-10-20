const express = require('express');
const router = express.Router();
const bookingReceiptController = require('../controllers/bookingReceiptController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

// Admin-only routes for receipt management
router.use(authenticateToken);
router.use(authorizeRoles('admin'));

// Receipt management routes
router.get('/stats', bookingReceiptController.getReceiptStats);
router.get('/pending', bookingReceiptController.getPendingReceipts);
router.get('/recent', bookingReceiptController.getRecentReceiptActivity);
router.get('/preview/:bookingId', bookingReceiptController.previewReceipt);
router.post('/send/:bookingId', bookingReceiptController.sendReceipt);
router.post('/bulk-send', bookingReceiptController.bulkSendReceipts);

module.exports = router;