const express = require('express');
const router = express.Router();
const legalController = require('../controllers/legalController');

/**
 * Legal Document Routes
 * Public endpoints for Terms of Service and Privacy Policy
 */

// @route   GET /api/legal
// @desc    Get all legal documents metadata
// @access  Public
router.get('/', legalController.getLegalDocuments);

// @route   GET /api/legal/terms
// @desc    Get Terms of Service
// @query   format: json|html|text (default: json)
// @access  Public
router.get('/terms', legalController.getTermsOfService);

// @route   GET /api/legal/privacy
// @desc    Get Privacy Policy
// @query   format: json|html|text (default: json)
// @access  Public
router.get('/privacy', legalController.getPrivacyPolicy);

module.exports = router;
