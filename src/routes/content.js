const express = require('express');
const contentController = require('../controllers/contentController');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// =============================================
// Public Content Routes
// =============================================

// FAQ routes (public)
router.get('/faq', contentController.getFAQs);

// Content pages (public)
router.get('/:type', contentController.getContentPage); // about, terms, privacy

// Contact information (public)
router.get('/contact', contentController.getContactInfo);

// Feedback submission (public, but can be authenticated)
router.post('/feedback', contentController.submitFeedback);

// =============================================
// Admin Content Management Routes
// =============================================

// Apply authentication and admin role requirement to admin routes
router.use('/admin/*', authenticateToken);
router.use('/admin/*', requireAdmin);

// FAQ Management (Admin)
router.get('/admin/faq', contentController.getAllFAQsAdmin);
router.post('/admin/faq', contentController.createFAQ);
router.put('/admin/faq/:id', contentController.updateFAQ);
router.delete('/admin/faq/:id', contentController.deleteFAQ);

// Content Pages Management (Admin)
router.get('/admin/pages', contentController.getAllContentPages);
router.put('/admin/pages/:type', contentController.updateContentPage);

// Feedback Management (Admin)
router.get('/admin/feedback', contentController.getAllFeedback);
router.patch('/admin/feedback/:id/status', contentController.updateFeedbackStatus);
router.patch('/admin/feedback/:id/assign', contentController.assignFeedback);

module.exports = router;