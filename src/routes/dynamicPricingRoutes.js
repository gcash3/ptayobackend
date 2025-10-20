const express = require('express');
const dynamicPricingController = require('../controllers/dynamicPricingController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// All routes require admin authentication
router.use(authenticateToken);
router.use(authorizeRoles('admin'));

// Configuration management
router
  .route('/config')
  .get(dynamicPricingController.getPricingConfig)
  .put(dynamicPricingController.updatePricingConfig);

router
  .route('/config/reset')
  .post(dynamicPricingController.resetPricingConfig);

// Peak hours management
router
  .route('/peak-hours')
  .put(dynamicPricingController.updatePeakHours);

// Holiday management
router
  .route('/holidays')
  .post(dynamicPricingController.addHoliday);

router
  .route('/holidays/:holidayId')
  .delete(dynamicPricingController.removeHoliday);

// Testing and analytics
router
  .route('/test')
  .post(dynamicPricingController.testPricingCalculation);

router
  .route('/analytics')
  .get(dynamicPricingController.getPricingAnalytics);

module.exports = router;