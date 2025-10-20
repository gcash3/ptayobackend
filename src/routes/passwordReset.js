const express = require('express');
const router = express.Router();
const passwordResetService = require('../services/passwordResetService');
const { body, validationResult } = require('express-validator');
const logger = require('../config/logger');

// Validation middleware
const validateEmail = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
];

const validateResetCode = [
  ...validateEmail,
  body('code')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('Reset code must be a 6-digit number')
];

const validatePasswordReset = [
  body('resetToken')
    .notEmpty()
    .isMongoId()
    .withMessage('Invalid reset token'),
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
];

// Error handling middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    logger.warn('Password reset validation failed:', { 
      errors: errors.array(),
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

/**
 * @route   POST /api/password-reset/send-code
 * @desc    Send password reset code to email
 * @access  Public
 */
router.post('/send-code', validateEmail, handleValidationErrors, async (req, res) => {
  try {
    const { email } = req.body;
    
    logger.info(`🔐 Password reset code requested for ${email}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    const result = await passwordResetService.sendResetCode(email);
    
    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        expiresAt: result.expiresAt
      }
    });

  } catch (error) {
    logger.error('Send reset code error:', {
      error: error.message,
      email: req.body.email,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to send reset code'
    });
  }
});

/**
 * @route   POST /api/password-reset/verify-code
 * @desc    Verify password reset code
 * @access  Public
 */
router.post('/verify-code', validateResetCode, handleValidationErrors, async (req, res) => {
  try {
    const { email, code } = req.body;
    
    logger.info(`🔐 Password reset code verification attempted for ${email}`, {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    const result = await passwordResetService.verifyResetCode(email, code);
    
    res.status(200).json({
      success: true,
      message: result.message,
      data: {
        resetToken: result.resetToken
      }
    });

  } catch (error) {
    logger.error('Verify reset code error:', {
      error: error.message,
      email: req.body.email,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to verify reset code'
    });
  }
});

/**
 * @route   POST /api/password-reset/reset-password
 * @desc    Reset password using verified token
 * @access  Public
 */
router.post('/reset-password', validatePasswordReset, handleValidationErrors, async (req, res) => {
  try {
    const { resetToken, newPassword } = req.body;
    
    logger.info(`🔐 Password reset attempted with token`, {
      resetToken,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    const result = await passwordResetService.resetPassword(resetToken, newPassword);
    
    res.status(200).json({
      success: true,
      message: result.message
    });

  } catch (error) {
    logger.error('Reset password error:', {
      error: error.message,
      resetToken: req.body.resetToken,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });

    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      success: false,
      message: error.message || 'Failed to reset password'
    });
  }
});

/**
 * @route   POST /api/password-reset/cleanup
 * @desc    Cleanup expired reset records (admin only)
 * @access  Private
 */
router.post('/cleanup', async (req, res) => {
  try {
    const deletedCount = await passwordResetService.cleanup();
    
    res.status(200).json({
      success: true,
      message: `Cleaned up ${deletedCount} expired records`
    });

  } catch (error) {
    logger.error('Password reset cleanup error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cleanup expired records'
    });
  }
});

module.exports = router;
