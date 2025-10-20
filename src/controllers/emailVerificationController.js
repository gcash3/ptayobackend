const { validationResult } = require('express-validator');
const emailVerificationService = require('../services/emailVerificationService');
const logger = require('../config/logger');
const { catchAsync, AppError, createValidationError } = require('../middleware/errorHandler');

/**
 * Send email verification code
 */
const sendVerificationCode = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const userEmail = req.user.email;

  logger.info('📧 Email verification code requested', {
    userId,
    userEmail,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  const result = await emailVerificationService.sendVerificationCode(userEmail);

  if (!result.success) {
    if (result.message === 'Email is already verified') {
      return res.status(400).json({
        status: 'error',
        message: result.message
      });
    }

    if (result.message.includes('wait before requesting')) {
      return res.status(429).json({
        status: 'error',
        message: result.message,
        data: {
          canResend: result.canResend,
          nextResendTime: result.nextResendTime
        }
      });
    }

    return next(new AppError(result.message, 400));
  }

  res.status(200).json({
    status: 'success',
    message: result.message,
    data: {
      email: result.email,
      expiresAt: result.expiresAt,
      canResend: result.canResend,
      resendCount: result.resendCount
    }
  });
});

/**
 * Verify email with code
 */
const verifyCode = catchAsync(async (req, res, next) => {
  // Check validation errors
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return next(createValidationError(errors));
  }

  const userId = req.user.id;
  const userEmail = req.user.email;
  const { code } = req.body;

  logger.info('📧 Email verification attempt', {
    userId,
    userEmail,
    codeLength: code.length,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  const result = await emailVerificationService.verifyCode(userEmail, code);

  if (!result.success) {
    if (result.needsNewCode) {
      return res.status(400).json({
        status: 'error',
        message: result.message,
        data: {
          needsNewCode: true,
          verified: false
        }
      });
    }

    return res.status(400).json({
      status: 'error',
      message: result.message,
      data: {
        verified: false,
        remainingAttempts: result.remainingAttempts || 0,
        needsNewCode: result.needsNewCode || false
      }
    });
  }

  logger.info('✅ Email verification successful', {
    userId,
    timestamp: new Date().toISOString()
  });

  res.status(200).json({
    status: 'success',
    message: result.message,
    data: {
      verified: true
    }
  });
});

/**
 * Get email verification status
 */
const getVerificationStatus = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const userEmail = req.user.email;

  logger.info(`📧 Getting email verification status for user ${userId} (${userEmail})`);

  const result = await emailVerificationService.getVerificationStatus(userEmail);
  
  logger.info(`📧 Email verification result:`, result);

  if (!result.success) {
    return next(new AppError(result.message, 400));
  }

  res.status(200).json({
    status: 'success',
    data: {
      isVerified: result.isVerified,
      email: result.email,
      hasActiveCode: result.hasActiveCode || false,
      expiresAt: result.expiresAt || null,
      canResend: result.canResend || false,
      remainingAttempts: result.remainingAttempts || 0,
      resendCount: result.resendCount || 0
    }
  });
});

/**
 * Resend verification code (alias for sendVerificationCode)
 */
const resendVerificationCode = sendVerificationCode;

module.exports = {
  sendVerificationCode,
  verifyCode,
  getVerificationStatus,
  resendVerificationCode
};
