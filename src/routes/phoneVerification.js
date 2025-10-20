const express = require('express');
const { body, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const phoneVerificationService = require('../services/phoneVerificationService');
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
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .custom((value) => {
      // Remove all non-digits
      const cleaned = value.replace(/\D/g, '');
      
      // Check if it's exactly 10 digits starting with 9 (after conversion)
      if (cleaned.startsWith('09') && cleaned.length === 11) {
        return true; // 09XXXXXXXXX format
      } else if (cleaned.startsWith('9') && cleaned.length === 10) {
        return true; // 9XXXXXXXXX format
      } else if (cleaned.startsWith('639') && cleaned.length === 12) {
        return true; // 639XXXXXXXXX format
      } else if (cleaned.startsWith('+639') || cleaned.startsWith('63') && cleaned.length === 12) {
        return true; // +639XXXXXXXXX or 63XXXXXXXXX format
      }
      
      throw new Error('Phone number must be 10 digits starting with 9 (e.g., 9424638843)');
    }),
  
  body('registrationData')
    .optional()
    .isObject()
    .withMessage('Registration data must be an object'),
    
  body('registrationData.firstName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be 2-50 characters'),
    
  body('registrationData.lastName')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be 2-50 characters'),
    
  body('registrationData.email')
    .optional()
    .isEmail()
    .withMessage('Invalid email format'),
    
  body('registrationData.password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
    
  body('registrationData.userType')
    .optional()
    .isIn(['client', 'landlord'])
    .withMessage('User type must be either client or landlord')
];

const verifyCodeValidation = [
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .custom((value) => {
      // Remove all non-digits
      const cleaned = value.replace(/\D/g, '');
      
      // Check if it's exactly 10 digits starting with 9 (after conversion)
      if (cleaned.startsWith('09') && cleaned.length === 11) {
        return true; // 09XXXXXXXXX format
      } else if (cleaned.startsWith('9') && cleaned.length === 10) {
        return true; // 9XXXXXXXXX format
      } else if (cleaned.startsWith('639') && cleaned.length === 12) {
        return true; // 639XXXXXXXXX format
      } else if (cleaned.startsWith('+639') || cleaned.startsWith('63') && cleaned.length === 12) {
        return true; // +639XXXXXXXXX or 63XXXXXXXXX format
      }
      
      throw new Error('Phone number must be 10 digits starting with 9 (e.g., 9424638843)');
    }),
    
  body('code')
    .notEmpty()
    .withMessage('Verification code is required')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('Verification code must be exactly 6 digits')
];

const resendCodeValidation = [
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .custom((value) => {
      // Remove all non-digits
      const cleaned = value.replace(/\D/g, '');
      
      // Check if it's exactly 10 digits starting with 9 (after conversion)
      if (cleaned.startsWith('09') && cleaned.length === 11) {
        return true; // 09XXXXXXXXX format
      } else if (cleaned.startsWith('9') && cleaned.length === 10) {
        return true; // 9XXXXXXXXX format
      } else if (cleaned.startsWith('639') && cleaned.length === 12) {
        return true; // 639XXXXXXXXX format
      } else if (cleaned.startsWith('+639') || cleaned.startsWith('63') && cleaned.length === 12) {
        return true; // +639XXXXXXXXX or 63XXXXXXXXX format
      }
      
      throw new Error('Phone number must be 10 digits starting with 9 (e.g., 9424638843)');
    })
];

/**
 * @route POST /api/v1/phone-verification/send
 * @desc Send verification code to phone number
 * @access Public
 */
router.post('/send', 
  verificationRateLimit,
  ...sendCodeValidation,
  validateRequest,
  async (req, res, next) => {
    try {
      const { phoneNumber, registrationData } = req.body;

      logger.info(`📱 Phone verification request for: ${phoneNumber}`);

      const result = await phoneVerificationService.sendVerificationCode(
        phoneNumber, 
        registrationData
      );

      res.status(200).json({
        status: 'success',
        message: result.message,
        data: {
          phoneNumber: result.phoneNumber,
          expiresAt: result.expiresAt,
          canResend: result.canResend,
          resendCount: result.resendCount
        }
      });

    } catch (error) {
      logger.error(`❌ Send verification error: ${error.message}`);
      next(new AppError(error.message, 400));
    }
  }
);

/**
 * @route POST /api/v1/phone-verification/verify
 * @desc Verify the OTP code
 * @access Public
 */
router.post('/verify',
  verificationRateLimit,
  ...verifyCodeValidation,
  validateRequest,
  async (req, res, next) => {
    try {
      const { phoneNumber, code } = req.body;

      logger.info(`🔍 Verification attempt for phone: ${phoneNumber}`);

      const result = await phoneVerificationService.verifyCode(phoneNumber, code);

      if (result.success) {
        res.status(200).json({
          status: 'success',
          message: result.message,
          data: {
            phoneNumber: result.phoneNumber,
            verified: true,
            registrationData: result.registrationData,
            verificationId: result.verificationId
          }
        });
      } else {
        res.status(400).json({
          status: 'error',
          message: result.message,
          data: {
            verified: false,
            remainingAttempts: result.remainingAttempts
          }
        });
      }

    } catch (error) {
      logger.error(`❌ Verification error: ${error.message}`);
      next(new AppError(error.message, 400));
    }
  }
);

/**
 * @route POST /api/v1/phone-verification/resend
 * @desc Resend verification code
 * @access Public
 */
router.post('/resend',
  resendRateLimit,
  ...resendCodeValidation,
  validateRequest,
  async (req, res, next) => {
    try {
      const { phoneNumber } = req.body;

      logger.info(`🔄 Resend verification request for: ${phoneNumber}`);

      const result = await phoneVerificationService.resendVerificationCode(phoneNumber);

      res.status(200).json({
        status: 'success',
        message: result.message,
        data: {
          phoneNumber: result.phoneNumber,
          expiresAt: result.expiresAt,
          canResend: result.canResend,
          resendCount: result.resendCount
        }
      });

    } catch (error) {
      logger.error(`❌ Resend verification error: ${error.message}`);
      next(new AppError(error.message, 400));
    }
  }
);

/**
 * @route GET /api/v1/phone-verification/status/:phoneNumber
 * @desc Get verification status for a phone number
 * @access Public
 */
router.get('/status/:phoneNumber',
  param('phoneNumber')
    .custom((value) => {
      // Remove all non-digits
      const cleaned = value.replace(/\D/g, '');
      
      // Check if it's exactly 10 digits starting with 9 (after conversion)
      if (cleaned.startsWith('09') && cleaned.length === 11) {
        return true; // 09XXXXXXXXX format
      } else if (cleaned.startsWith('9') && cleaned.length === 10) {
        return true; // 9XXXXXXXXX format
      } else if (cleaned.startsWith('639') && cleaned.length === 12) {
        return true; // 639XXXXXXXXX format
      } else if (cleaned.startsWith('+639') || cleaned.startsWith('63') && cleaned.length === 12) {
        return true; // +639XXXXXXXXX or 63XXXXXXXXX format
      }
      
      throw new Error('Phone number must be 10 digits starting with 9 (e.g., 9424638843)');
    }),
  validateRequest,
  async (req, res, next) => {
    try {
      const { phoneNumber } = req.params;

      const status = await phoneVerificationService.getVerificationStatus(phoneNumber);

      res.status(200).json({
        status: 'success',
        data: status
      });

    } catch (error) {
      logger.error(`❌ Get verification status error: ${error.message}`);
      next(new AppError(error.message, 400));
    }
  }
);

/**
 * @route POST /api/v1/phone-verification/cleanup-expired
 * @desc Clean up expired verification records (admin endpoint)
 * @access Private (Admin only)
 */
router.post('/cleanup-expired',
  // Add admin authentication middleware here if needed
  async (req, res, next) => {
    try {
      const deletedCount = await phoneVerificationService.cleanupExpiredVerifications();

      res.status(200).json({
        status: 'success',
        message: `Cleaned up ${deletedCount} expired verification records`,
        data: {
          deletedCount
        }
      });

    } catch (error) {
      logger.error(`❌ Cleanup expired verifications error: ${error.message}`);
      next(new AppError(error.message, 500));
    }
  }
);

module.exports = router;
