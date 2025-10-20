const express = require('express');
const router = express.Router();
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const { authenticateToken } = require('../middleware/auth');
const smsService = require('../services/smsService');
const logger = require('../config/logger');

// Test SMS validation
const testSmsValidation = [
  body('phoneNumber')
    .isMobilePhone('en-PH')
    .withMessage('Please provide a valid Philippine mobile number'),
  body('message')
    .isLength({ min: 1, max: 160 })
    .withMessage('Message must be between 1 and 160 characters'),
  validateRequest
];

// SMS preferences validation
const smsPreferencesValidation = [
  body('enableBookingConfirmations')
    .optional()
    .isBoolean()
    .withMessage('enableBookingConfirmations must be boolean'),
  body('enableBookingUpdates')
    .optional()
    .isBoolean()
    .withMessage('enableBookingUpdates must be boolean'),
  body('enableArrivalNotifications')
    .optional()
    .isBoolean()
    .withMessage('enableArrivalNotifications must be boolean'),
  body('enablePaymentNotifications')
    .optional()
    .isBoolean()
    .withMessage('enablePaymentNotifications must be boolean'),
  validateRequest
];

// Message ID validation
const messageIdValidation = [
  param('messageId').isNumeric().withMessage('Message ID must be numeric'),
  validateRequest
];

/**
 * @route GET /api/v1/sms/status
 * @desc Get SMS service status
 * @access Public
 */
router.get('/status', async (req, res) => {
  try {
    const balance = await smsService.getBalance();
    
    res.status(200).json({
      status: 'success',
      data: {
        isEnabled: smsService.isEnabled,
        balance: balance.success ? balance.credits : 'Unknown',
        defaultSimSlot: smsService.defaultSimSlot,
        serverUrl: smsService.serverUrl
      }
    });
  } catch (error) {
    logger.error('Error getting SMS status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get SMS service status'
    });
  }
});

/**
 * @route POST /api/v1/sms/test
 * @desc Send test SMS (admin only)
 * @access Private
 */
router.post('/test', authenticateToken, ...testSmsValidation, async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    const userId = req.user.id;
    
    logger.info(`📱 Test SMS requested by user ${userId} to ${phoneNumber}`);
    
    const result = await smsService.sendSMS(phoneNumber, `TEST: ${message}`, {
      prioritize: false
    });
    
    if (result.success) {
      res.status(200).json({
        status: 'success',
        message: 'Test SMS sent successfully',
        data: {
          messageId: result.data.ID,
          status: result.data.status,
          sentDate: result.data.sentDate
        }
      });
    } else {
      res.status(400).json({
        status: 'error',
        message: 'Failed to send test SMS',
        error: result.error
      });
    }
  } catch (error) {
    logger.error('Error sending test SMS:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error while sending test SMS'
    });
  }
});

/**
 * @route GET /api/v1/sms/status/:messageId
 * @desc Check SMS delivery status
 * @access Private
 */
router.get('/status/:messageId', authenticateToken, ...messageIdValidation, async (req, res) => {
  try {
    const { messageId } = req.params;
    
    const result = await smsService.getMessageStatus(messageId);
    
    if (result.success) {
      res.status(200).json({
        status: 'success',
        data: {
          messageId: result.data.ID,
          status: result.data.status,
          sentDate: result.data.sentDate,
          deliveredDate: result.data.deliveredDate,
          number: result.data.number,
          message: result.data.message
        }
      });
    } else {
      res.status(404).json({
        status: 'error',
        message: 'Message not found or failed to get status',
        error: result.error
      });
    }
  } catch (error) {
    logger.error('Error checking SMS status:', error);
    res.status(500).json({
      status: 'error',
      message: 'Internal server error while checking SMS status'
    });
  }
});

/**
 * @route GET /api/v1/sms/statistics
 * @desc Get SMS usage statistics (admin only)
 * @access Private
 */
router.get('/statistics', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Get SMS balance
    const balanceResult = await smsService.getBalance();
    
    res.status(200).json({
      status: 'success',
      data: {
        balance: balanceResult.success ? balanceResult.credits : 'Unknown',
        isEnabled: smsService.isEnabled,
        defaultSimSlot: smsService.defaultSimSlot,
        serverUrl: smsService.serverUrl,
        lastChecked: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error getting SMS statistics:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get SMS statistics'
    });
  }
});

/**
 * @route PUT /api/v1/sms/preferences
 * @desc Update user SMS notification preferences
 * @access Private
 */
router.put('/preferences', authenticateToken, ...smsPreferencesValidation, async (req, res) => {
  try {
    const userId = req.user.id;
    const preferences = req.body;
    
    logger.info(`📱 SMS preferences updated for user ${userId}:`, preferences);
    
    res.status(200).json({
      status: 'success',
      message: 'SMS preferences updated successfully',
      data: {
        userId: userId,
        preferences: preferences,
        updatedAt: new Date().toISOString()
      }
    });
  } catch (error) {
    logger.error('Error updating SMS preferences:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update SMS preferences'
    });
  }
});

/**
 * @route GET /api/v1/sms/preferences
 * @desc Get user SMS notification preferences
 * @access Private
 */
router.get('/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Default preferences
    const defaultPreferences = {
      enableBookingConfirmations: true,
      enableBookingUpdates: true,
      enableArrivalNotifications: true,
      enablePaymentNotifications: true
    };
    
    res.status(200).json({
      status: 'success',
      data: {
        userId: userId,
        preferences: defaultPreferences
      }
    });
  } catch (error) {
    logger.error('Error getting SMS preferences:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get SMS preferences'
    });
  }
});

module.exports = router;
