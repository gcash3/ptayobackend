const EmailVerification = require('../models/EmailVerification');
const User = require('../models/User');
const emailService = require('./emailService');
const logger = require('../config/logger');
const { AppError } = require('../middleware/errorHandler');

class EmailVerificationService {
  /**
   * Send verification code to email
   */
  async sendVerificationCode(email) {
    try {
      // Find user by email
      const user = await User.findOne({ email });
      if (!user) {
        return {
          success: false,
          message: 'No user found with that email address'
        };
      }

      // Check if user email is already verified
      if (user.isEmailVerified === true) {
        return {
          success: false,
          message: 'Email is already verified'
        };
      }

      // Check if there's an existing verification
      let verification = await EmailVerification.findOne({ email });

      // Check rate limiting for resends
      if (verification && !verification.canResend()) {
        const remainingSeconds = Math.ceil((verification.lastResend.getTime() + 60 * 1000 - Date.now()) / 1000);
        return {
          success: false,
          message: `Please wait ${remainingSeconds} seconds before requesting another code.`,
          canResend: false,
          nextResendTime: new Date(verification.lastResend.getTime() + 60 * 1000)
        };
      }

      // Create or update verification record
      if (!verification) {
        verification = new EmailVerification({
          email: email,
          userId: user._id
        });
      }

      // Generate new code and update resend tracking
      const code = verification.generateVerificationCode();
      // Manually update resend data (don't call incrementResend which has its own save)
      verification.resendCount += 1;
      verification.lastResend = new Date();
      verification.attempts = 0; // Reset attempts on resend

      // Single save to prevent parallel save conflicts
      await verification.save();

      // Send email using emailService
      const emailResult = await emailService.sendEmailVerification(
        email,
        code,
        user.firstName || 'User'
      );

      if (!emailResult.success) {
        return {
          success: false,
          message: 'Failed to send verification email'
        };
      }

      logger.info(`📧 Email verification code sent to ${email}`, {
        email,
        resendCount: verification.resendCount,
        expiresAt: verification.expiresAt
      });

      return {
        success: true,
        message: 'Verification code sent to your email.',
        email: email,
        expiresAt: verification.expiresAt,
        canResend: verification.canResend(),
        resendCount: verification.resendCount
      };

    } catch (error) {
      logger.error(`❌ Send email verification error: ${error.message}`, {
        email,
        error: error.stack
      });
      return {
        success: false,
        message: error.message || 'Failed to send verification code'
      };
    }
  }

  /**
   * Verify email code
   */
  async verifyCode(email, code) {
    try {
      const verification = await EmailVerification.findOne({ email });

      if (!verification) {
        return {
          success: false,
          message: 'No verification request found for this email.',
          needsNewCode: true
        };
      }

      if (verification.isExpired()) {
        await verification.deleteOne();
        return {
          success: false,
          message: 'Verification code has expired. Please request a new one.',
          needsNewCode: true
        };
      }

      // Track attempts manually (don't call incrementAttempts which has its own save)
      verification.attempts += 1;
      verification.lastAttempt = new Date();

      if (verification.isAttemptsExceeded()) {
        await verification.deleteOne();
        return {
          success: false,
          message: 'Too many incorrect attempts. Please request a new code.',
          needsNewCode: true
        };
      }

      if (!verification.isValidCode(code)) {
        // Save the incremented attempts count
        await verification.save();
        const remainingAttempts = 5 - verification.attempts;
        return {
          success: false,
          message: `Incorrect verification code. ${remainingAttempts} attempts remaining.`,
          remainingAttempts: remainingAttempts,
          needsNewCode: false
        };
      }

      // Code is correct - mark verification as complete manually
      verification.verified = true;
      verification.verifiedAt = new Date();
      await verification.save();

      // Mark user's email as verified
      const user = await User.findOneAndUpdate(
        { email: email },
        { isEmailVerified: true },
        { new: true }
      );

      if (!user) {
        return {
          success: false,
          message: 'User not found.'
        };
      }

      // Clean up verification record
      await verification.deleteOne();

      logger.info(`✅ Email ${email} successfully verified`);

      return {
        success: true,
        message: 'Email successfully verified.',
        email: user.email,
        isVerified: user.isEmailVerified,
        user: {
          id: user._id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email,
          role: user.role
        }
      };

    } catch (error) {
      logger.error(`❌ Email verification error: ${error.message}`, {
        email,
        error: error.stack
      });
      return {
        success: false,
        message: error.message || 'Failed to verify code'
      };
    }
  }

  /**
   * Resend verification code
   */
  async resendVerificationCode(email) {
    return this.sendVerificationCode(email);
  }

  /**
   * Get verification status
   */
  async getVerificationStatus(email) {
    try {
      const user = await User.findOne({ email });
      if (!user) {
        return {
          success: false,
          message: 'User not found.'
        };
      }

      const verification = await EmailVerification.findOne({ email });

      return {
        success: true,
        email: user.email,
        isVerified: user.isEmailVerified,
        hasPendingVerification: !!verification,
        hasActiveCode: !!verification,
        canResend: verification ? verification.canResend() : true,
        expiresAt: verification ? verification.expiresAt : null,
        resendCount: verification ? verification.resendCount : 0,
        remainingAttempts: verification ? (5 - verification.attempts) : 0
      };

    } catch (error) {
      logger.error(`❌ Get email verification status error: ${error.message}`);
      return {
        success: false,
        message: error.message || 'Failed to get verification status'
      };
    }
  }

  /**
   * Clean up expired verification records
   */
  async cleanupExpiredVerifications() {
    try {
      const result = await EmailVerification.deleteMany({
        expiresAt: { $lt: new Date() }
      });

      logger.info(`🧹 Cleaned up ${result.deletedCount} expired email verification records`);
      return result.deletedCount;

    } catch (error) {
      logger.error(`❌ Cleanup expired email verifications error: ${error.message}`);
      throw error;
    }
  }

  /**
   * Format email for display (mask for privacy)
   */
  maskEmail(email) {
    if (!email || !email.includes('@')) {
      return email;
    }
    
    const parts = email.split('@');
    const localPart = parts[0];
    const domainPart = parts[1];

    if (localPart.length <= 2) {
      return `${localPart[0]}***@${domainPart}`;
    } else {
      return `${localPart.substring(0, 1)}***${localPart.substring(localPart.length - 1)}@${domainPart}`;
    }
  }

  /**
   * Validate email format
   */
  isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}

module.exports = new EmailVerificationService();