const express = require('express');
const adminController = require('../controllers/adminController');
const adminAnalyticsController = require('../controllers/adminAnalyticsController');
const { authenticateToken, requireAdmin, requirePermission, requireSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// Admin verification endpoint (token + admin role check)
router.get('/verify', authenticateToken, requireAdmin, (req, res) => {
  // If we reach here, the user is authenticated and has admin role
  res.status(200).json({
    status: 'success',
    message: 'Admin verification successful',
    data: {
      user: req.user
    }
  });
});

// Admin logout endpoint
router.post('/logout', authenticateToken, requireAdmin, (req, res) => {
  // Admin logout (could do admin-specific logout logic here if needed)
  res.status(200).json({
    status: 'success',
    message: 'Admin logged out successfully'
  });
});

// Apply authentication and admin role requirement to all admin routes
router.use(authenticateToken);
router.use(requireAdmin);

// Admin Dashboard
router.get('/dashboard', adminController.getAdminDashboard);
router.get('/dashboard/analytics', adminController.getDashboardAnalytics);

// Pending Spaces for Approval
router.get('/spaces/pending', adminController.getPendingParkingSpaces);

// Space Approval Actions (matching frontend API calls)
router.patch('/spaces/:spaceId/approve', adminController.approveParkingSpace);
router.patch('/spaces/:spaceId/reject', adminController.rejectParkingSpace);

// Parking Space Management
router.get('/parking-spaces', adminController.getAllParkingSpacesAdmin);
router.get('/parking-spaces/:spaceId/review', adminController.getParkingSpaceForReview);
router.post('/parking-spaces', adminController.createParkingSpace);
router.put('/parking-spaces/:spaceId', adminController.updateParkingSpace);

// Parking Space Approval Actions (legacy routes)
router.post('/parking-spaces/auto-approve-all', adminController.autoApproveAllParkingSpaces);
router.post('/parking-spaces/:spaceId/approve', adminController.approveParkingSpace);
router.post('/parking-spaces/:spaceId/reject', adminController.rejectParkingSpace);
router.post('/parking-spaces/:spaceId/suspend', adminController.suspendParkingSpace);
router.post('/parking-spaces/:spaceId/reactivate', adminController.reactivateParkingSpace);

// Smart Booking Analytics Routes
router.get('/ml-metrics', adminAnalyticsController.getMLMetrics);
router.get('/smart-booking-analytics', adminAnalyticsController.getSmartBookingAnalytics);
router.get('/system-performance', adminAnalyticsController.getSystemPerformance);
router.get('/export-analytics', adminAnalyticsController.exportAnalyticsData);

// A/B Testing Routes
router.get('/ab-tests', adminAnalyticsController.getABTestResults);
router.get('/ab-tests/:testId', adminAnalyticsController.getABTestResults);
router.post('/ab-tests', adminAnalyticsController.createABTest);
router.post('/ab-tests/:testId/end', adminAnalyticsController.endABTest);
router.get('/ab-tests/:testId/users/:userId', adminAnalyticsController.getUserABTestAssignment);

// System Management Routes
router.get('/system-health', adminController.getSystemHealth);
router.get('/database-health', adminController.getDatabaseHealth);
router.get('/system-metrics', adminController.getSystemMetrics);
router.get('/error-stats', adminController.getErrorStats);
router.get('/query-performance', adminController.getQueryPerformanceStats);
router.post('/clear-cache', adminController.clearQueryCache);
router.post('/recreate-indexes', adminController.recreateIndexes);
router.get('/alerts', adminController.getAlerts);

// User Management Routes
router.get('/users', adminController.getAllUsers);
router.get('/users/:userId', adminController.getUserById);
router.post('/users', adminController.createUser);
router.put('/users/:userId', adminController.updateUser);
router.post('/users/:userId/suspend', adminController.suspendUser);
router.post('/users/:userId/reactivate', adminController.reactivateUser);

// Enhanced User Status Management
router.get('/users/:userId/status-history', adminController.getUserStatusHistory);
router.post('/users/:userId/notify', adminController.sendUserNotification);

// Wallet Management Routes (Admin) - Enhanced for both clients and landlords
router.get('/users/:userId/wallet', adminController.getUserWallet);
router.get('/users/:userId/wallet/transactions', adminController.getUserWalletTransactions);
router.post('/users/:userId/wallet/credit', adminController.creditUserWallet);
router.post('/users/:userId/wallet/debit', adminController.debitUserWallet);

// Admin Action History
router.get('/action-logs', adminController.getAdminActionLogs);
router.get('/action-logs/:userId', adminController.getUserActionLogs);

// Booking Management Routes
router.get('/bookings', adminController.getAllBookings);
router.get('/bookings/:bookingId', adminController.getBookingById);

// Transaction Management Routes
router.get('/transactions', adminController.getAllTransactions);
router.get('/transactions/:transactionId', adminController.getTransactionById);
router.post('/transactions/:transactionId/refund', adminController.processRefund);

// Support System Routes
router.get('/support/tickets', adminController.getAllTickets);
router.get('/support/tickets/:ticketId', adminController.getTicketById);
router.patch('/support/tickets/:ticketId/status', adminController.updateTicketStatus);
router.post('/support/tickets/:ticketId/messages', adminController.addTicketMessage);
router.post('/support/tickets/:ticketId/assign', adminController.assignTicket);

// Landlord ID Verification Management Routes
router.get('/landlord-applications/stats', adminController.getLandlordApplicationStats);
router.get('/landlord-applications', adminController.getLandlordApplications);
router.get('/landlord-applications/:userId', adminController.getLandlordApplicationById);
router.post('/landlord-applications/:userId/approve', adminController.approveLandlordApplication);
router.post('/landlord-applications/:userId/reject', adminController.rejectLandlordApplication);
router.post('/fix-verified-landlords', adminController.fixVerifiedLandlords);

// System Settings Routes (requires super_admin level)
router.get('/system-settings', requireSuperAdmin, adminController.getSystemSettings);
router.put('/system-settings', requireSuperAdmin, adminController.updateSystemSettings);

// Payout Management Routes
router.get('/payouts', adminController.getPendingPayouts);
router.post('/payouts/:payoutId/approve', adminController.approvePayout);
router.post('/payouts/:payoutId/reject', adminController.rejectPayout);

// Admin User Management Routes (requires super_admin level)
router.post('/admin-users/support', requireSuperAdmin, adminController.createSupportUser);
router.get('/admin-users', requireSuperAdmin, adminController.getAllAdminUsers);
router.put('/admin-users/:adminUserId/permissions', requireSuperAdmin, adminController.updateAdminPermissions);
router.delete('/admin-users/:adminUserId', requireSuperAdmin, adminController.deleteAdminUser);

module.exports = router; 