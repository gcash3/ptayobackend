const PasswordReset = require('../models/PasswordReset');
const User = require('../models/User');
const emailService = require('./emailService');
const bcrypt = require('bcryptjs');
const logger = require('../config/logger');
const { AppError } = require('../middleware/errorHandler');

class PasswordResetService {
  /**
   * Send email asynchronously to avoid blocking the API response
   */
  sendEmailAsync(email, code, userName, userId) {
    // Fire and forget email sending
    emailService.sendPasswordResetCode(email, code, userName)
      .then(emailResult => {
        if (emailResult.success) {
          logger.info(`✅ Password reset email sent successfully to ${email}`, {
            userId: userId,
            email: email,
            timestamp: new Date().toISOString()
          });
        } else {
          logger.error(`❌ Failed to send password reset email to ${email}`, {
            userId: userId,
            email: email,
            error: emailResult.error,
            timestamp: new Date().toISOString()
          });
        }
      })
      .catch(error => {
        logger.error(`❌ Email service error for ${email}`, {
          userId: userId,
          email: email,
          error: error.message,
          timestamp: new Date().toISOString()
        });
      });
  }

  /**
   * Send password reset code to email
   */
  async sendResetCode(email) {
    try {
      // Find user by email (landlord only)
      const user = await User.findOne({ email: email.toLowerCase(), role: 'landlord' });
      if (!user) {
        throw new AppError('No landlord account found with that email address', 404);
      }

      // Check if there's an existing reset request
      let passwordReset = await PasswordReset.findOne({ email: email.toLowerCase() });

      // Check rate limiting for resends
      if (passwordReset && !passwordReset.canResend()) {
        const remainingSeconds = Math.ceil((passwordReset.lastResend.getTime() + 60 * 1000 - Date.now()) / 1000);
        throw new AppError(`Please wait ${remainingSeconds} seconds before requesting another code.`, 429);
      }

      // Create or update password reset record
      if (!passwordReset) {
        passwordReset = new PasswordReset({ 
          email: email.toLowerCase(),
          userId: user._id 
        });
      }

      // Generate new code and update resend info in one operation
      const code = passwordReset.generateResetCode();
      passwordReset.incrementResend();
      
      // Save once with all changes
      await passwordReset.save();

      // Send email asynchronously for better performance
      this.sendEmailAsync(email, code, user.firstName || user.fullName?.split(' ')[0] || 'User', user._id);

      logger.info(`🔐 Password reset code generated for ${email}`, {
        userId: user._id,
        email: email,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: 'Password reset code is being sent to your email. Please check your inbox.',
        expiresAt: passwordReset.expiresAt,
        canProceed: true  // Indicates frontend can navigate to verification screen
      };

    } catch (error) {
      logger.error('Password reset code sending failed:', error);
      throw error;
    }
  }

  /**
   * Verify password reset code
   */
  async verifyResetCode(email, code) {
    try {
      const passwordReset = await PasswordReset.findActiveReset(email.toLowerCase());
      
      if (!passwordReset) {
        throw new AppError('Invalid or expired reset code', 400);
      }

      // Check if max attempts exceeded
      if (passwordReset.isAttemptsExceeded()) {
        throw new AppError('Maximum verification attempts exceeded. Please request a new code.', 429);
      }

      // Increment attempts and save
      passwordReset.incrementAttempts();
      await passwordReset.save();

      // Verify the code
      if (!passwordReset.isValidCode(code)) {
        if (passwordReset.isExpired()) {
          throw new AppError('Reset code has expired. Please request a new one.', 400);
        }
        throw new AppError('Invalid reset code', 400);
      }

      logger.info(`✅ Password reset code verified for ${email}`, {
        userId: passwordReset.userId,
        email: email,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: 'Reset code verified successfully',
        resetToken: passwordReset._id // Return the reset ID as a token for the next step
      };

    } catch (error) {
      logger.error('Password reset code verification failed:', error);
      throw error;
    }
  }

  /**
   * Reset password using verified token
   */
  async resetPassword(resetToken, newPassword) {
    try {
      const passwordReset = await PasswordReset.findById(resetToken);
      
      if (!passwordReset || passwordReset.used || passwordReset.isExpired()) {
        throw new AppError('Invalid or expired reset token', 400);
      }

      // Find the user
      const user = await User.findById(passwordReset.userId);
      if (!user) {
        throw new AppError('User not found', 404);
      }

      // Hash the new password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update user password
      await User.findByIdAndUpdate(user._id, { 
        password: hashedPassword,
        updatedAt: new Date()
      });

      // Mark reset as used and save
      passwordReset.markAsUsed();
      await passwordReset.save();

      logger.info(`🔐 Password reset successfully for user ${user._id}`, {
        userId: user._id,
        email: user.email,
        timestamp: new Date().toISOString()
      });

      return {
        success: true,
        message: 'Password reset successfully'
      };

    } catch (error) {
      logger.error('Password reset failed:', error);
      throw error;
    }
  }

  /**
   * Cleanup expired reset records
   */
  async cleanup() {
    try {
      const deletedCount = await PasswordReset.cleanup();
      logger.info(`🧹 Cleaned up ${deletedCount} expired password reset records`);
      return deletedCount;
    } catch (error) {
      logger.error('Password reset cleanup failed:', error);
      throw error;
    }
  }
}

module.exports = new PasswordResetService();
