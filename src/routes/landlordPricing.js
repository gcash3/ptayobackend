const express = require('express');
const { body, query } = require('express-validator');
const landlordPricingController = require('../controllers/landlordPricingController');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

/**
 * @route   GET /api/v1/landlord-pricing/guidelines
 * @desc    Get Manila government pricing guidelines for landlords
 * @access  Private (Landlords only)
 */
router.get('/guidelines',
  authenticateToken,
  [
    query('areaType').optional().isIn(['residential', 'commercial', 'university', 'hospital', 'mall_area', 'cbd', 'tourist_area']).withMessage('Invalid area type'),
    query('isSecured').optional().isBoolean().withMessage('isSecured must be boolean'),
    query('hasCCTV').optional().isBoolean().withMessage('hasCCTV must be boolean'),
    query('isRoofed').optional().isBoolean().withMessage('isRoofed must be boolean')
  ],
  landlordPricingController.getPricingGuidelines
);

/**
 * @route   POST /api/v1/landlord-pricing/validate
 * @desc    Validate proposed pricing against government guidelines
 * @access  Private (Landlords only)
 */
router.post('/validate',
  authenticateToken,
  [
    body('hourlyRate').isFloat({ min: 1, max: 500 }).withMessage('Hourly rate must be between ₱1-₱500'),
    body('dailyRate').optional().isFloat({ min: 1, max: 5000 }).withMessage('Daily rate must be between ₱1-₱5000'),
    body('areaType').optional().isIn(['residential', 'commercial', 'university', 'hospital', 'mall_area', 'cbd', 'tourist_area']).withMessage('Invalid area type')
  ],
  landlordPricingController.validatePricing
);

/**
 * @route   GET /api/v1/landlord-pricing/insights/:spaceId
 * @desc    Get comprehensive pricing insights for a specific parking space
 * @access  Private (Landlords only)
 */
router.get('/insights/:spaceId',
  authenticateToken,
  landlordPricingController.getPricingInsights
);

/**
 * @route   GET /api/v1/landlord-pricing/market-analysis
 * @desc    Get market analysis for a specific area
 * @access  Private (Landlords only)
 */
router.get('/market-analysis',
  authenticateToken,
  [
    query('latitude').isFloat({ min: -90, max: 90 }).withMessage('Valid latitude required'),
    query('longitude').isFloat({ min: -180, max: 180 }).withMessage('Valid longitude required'),
    query('radius').optional().isInt({ min: 500, max: 5000 }).withMessage('Radius must be 500-5000 meters')
  ],
  landlordPricingController.getMarketAnalysis
);

/**
 * @route   PUT /api/v1/landlord-pricing/update/:spaceId
 * @desc    Update parking space pricing with government compliance validation
 * @access  Private (Landlords only)
 */
router.put('/update/:spaceId',
  authenticateToken,
  [
    body('hourlyRate').isFloat({ min: 1, max: 500 }).withMessage('Hourly rate must be between ₱1-₱500'),
    body('dailyRate').optional().isFloat({ min: 1, max: 5000 }).withMessage('Daily rate must be between ₱1-₱5000'),
    body('weeklyRate').optional().isFloat({ min: 1, max: 20000 }).withMessage('Weekly rate must be between ₱1-₱20000'),
    body('monthlyRate').optional().isFloat({ min: 1, max: 50000 }).withMessage('Monthly rate must be between ₱1-₱50000')
  ],
  landlordPricingController.updatePricing
);

module.exports = router;
