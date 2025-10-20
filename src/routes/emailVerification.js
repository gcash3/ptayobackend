const express = require('express');
const { body, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const emailVerificationService = require('../services/emailVerificationService');
const { validateRequest } = require('../middleware/validation');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

const router = express.Router();

// Rate limiting for verification endpoints
const verificationRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Max 5 requests per window per IP
  message: {
    status: 'error',
    message: 'Too many verification attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

const resendRateLimit = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 minutes
  max: 3, // Max 3 resends per window per IP
  message: {
    status: 'error',
    message: 'Too many resend attempts. Please wait before requesting again.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schemas
const sendCodeValidation = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
];

const verifyCodeValidation = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
    
  body('code')
    .notEmpty()
    .withMessage('Verification code is required')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('Verification code must be exactly 6 digits')
];

const resendCodeValidation = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address')
];

/**
 * @route POST /api/v1/email-verification/send
 * @desc Send verification code to email address
 * @access Public
 */
router.post('/send', 
  verificationRateLimit,
  ...sendCodeValidation,
  validateRequest,
  async (req, res, next) => {
    try {
      const { email } = req.body;

      logger.info(`📧 Email verification request for: ${email}`);

      const result = await emailVerificationService.sendVerificationCode(email);

      res.status(200).json({
        status: 'success',
        message: result.message,
        data: {
          email: emailVerificationService.maskEmail(result.email),
          expiresAt: result.expiresAt,
          canResend: result.canResend,
          resendCount: result.resendCount
        }
      });

    } catch (error) {
      logger.error(`❌ Send email verification error: ${error.message}`);
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/email-verification/verify
 * @desc Verify the email code
 * @access Public
 */
router.post('/verify',
  verificationRateLimit,
  ...verifyCodeValidation,
  validateRequest,
  async (req, res, next) => {
    try {
      const { email, code } = req.body;

      logger.info(`🔍 Email verification attempt for: ${email}`);

      const result = await emailVerificationService.verifyCode(email, code);

      if (result.success) {
        res.status(200).json({
          status: 'success',
          message: result.message,
          data: {
            email: result.email,
            verified: true,
            user: result.user
          }
        });
      } else {
        res.status(400).json({
          status: 'error',
          message: result.message,
          data: {
            verified: false
          }
        });
      }

    } catch (error) {
      logger.error(`❌ Email verification error: ${error.message}`);
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/email-verification/resend
 * @desc Resend verification code
 * @access Public
 */
router.post('/resend',
  resendRateLimit,
  ...resendCodeValidation,
  validateRequest,
  async (req, res, next) => {
    try {
      const { email } = req.body;

      logger.info(`🔄 Resend email verification request for: ${email}`);

      const result = await emailVerificationService.resendVerificationCode(email);

      res.status(200).json({
        status: 'success',
        message: result.message,
        data: {
          email: emailVerificationService.maskEmail(result.email),
          expiresAt: result.expiresAt,
          canResend: result.canResend,
          resendCount: result.resendCount
        }
      });

    } catch (error) {
      logger.error(`❌ Resend email verification error: ${error.message}`);
      next(error);
    }
  }
);

/**
 * @route GET /api/v1/email-verification/status/:email
 * @desc Get verification status for an email address
 * @access Public
 */
router.get('/status/:email',
  param('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),
  validateRequest,
  async (req, res, next) => {
    try {
      const { email } = req.params;

      const status = await emailVerificationService.getVerificationStatus(email);

      res.status(200).json({
        status: 'success',
        data: {
          email: emailVerificationService.maskEmail(status.email),
          isVerified: status.isVerified,
          hasPendingVerification: status.hasPendingVerification,
          canResend: status.canResend,
          expiresAt: status.expiresAt,
          resendCount: status.resendCount
        }
      });

    } catch (error) {
      logger.error(`❌ Get email verification status error: ${error.message}`);
      next(error);
    }
  }
);

/**
 * @route POST /api/v1/email-verification/cleanup-expired
 * @desc Clean up expired verification records (admin endpoint)
 * @access Private (Admin only)
 */
router.post('/cleanup-expired',
  // Add admin authentication middleware here if needed
  async (req, res, next) => {
    try {
      const deletedCount = await emailVerificationService.cleanupExpiredVerifications();

      res.status(200).json({
        status: 'success',
        message: `Cleaned up ${deletedCount} expired email verification records`,
        data: {
          deletedCount
        }
      });

    } catch (error) {
      logger.error(`❌ Cleanup expired email verifications error: ${error.message}`);
      next(error);
    }
  }
);

module.exports = router;