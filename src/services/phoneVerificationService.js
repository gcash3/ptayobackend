const PhoneVerification = require('../models/PhoneVerification');
const smsService = require('./smsService');
const logger = require('../config/logger');

class PhoneVerificationService {
  constructor() {
    this.smsService = smsService;
  }

  /**
   * Format phone number to ensure +63 format
   * Accepts exactly 10 digits starting with 9
   * @param {string} phoneNumber - Phone number in various formats
   * @returns {string} Formatted phone number with +63
   */
  formatPhoneNumber(phoneNumber) {
    // Remove all non-digits
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // Handle different input formats
    if (cleaned.startsWith('09') && cleaned.length === 11) {
      // Convert 09XXXXXXXXX to 9XXXXXXXXX
      cleaned = cleaned.substring(1);
    } else if (cleaned.startsWith('639') && cleaned.length === 12) {
      // Convert 639XXXXXXXXX to 9XXXXXXXXX
      cleaned = cleaned.substring(2);
    } else if (cleaned.startsWith('63') && cleaned.length === 12) {
      // Convert 63XXXXXXXXX to 9XXXXXXXXX (handle gracefully)
      cleaned = `9${cleaned.substring(2)}`;
    }
    
    // Now we should have exactly 10 digits starting with 9
    if (cleaned.length === 10 && cleaned.startsWith('9')) {
      return `+63${cleaned}`;
    }
    
    throw new Error('Phone number must be exactly 10 digits starting with 9 (e.g., 9424638843)');
  }

  /**
   * Send OTP verification code
   * @param {string} phoneNumber - Phone number to send OTP to
   * @param {Object} registrationData - Optional registration data to store temporarily
   * @returns {Object} Verification result
   */
  async sendVerificationCode(phoneNumber, registrationData = null) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      logger.info(`📱 Sending verification code to: ${formattedPhone}`);

      // Create or update verification record
      const verification = await PhoneVerification.createVerification(
        formattedPhone, 
        registrationData
      );

      // Prepare SMS message
      const message = `🔐 Your ParkTayo verification code is: ${verification.verificationCode}

This code will expire in 10 minutes. DO NOT share this code with anyone.`;

      // Send SMS
      await this.smsService.sendSMS(formattedPhone, message);

      logger.info(`✅ Verification code sent successfully to ${formattedPhone}`);

      return {
        success: true,
        message: 'Verification code sent successfully',
        phoneNumber: formattedPhone,
        expiresAt: verification.expiresAt,
        canResend: verification.canResend(),
        resendCount: verification.resendCount
      };

    } catch (error) {
      logger.error(`❌ Failed to send verification code: ${error.message}`);
      throw error;
    }
  }

  /**
   * Verify OTP code
   * @param {string} phoneNumber - Phone number
   * @param {string} code - 6-digit verification code
   * @returns {Object} Verification result
   */
  async verifyCode(phoneNumber, code) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      logger.info(`🔍 Verifying code for phone: ${formattedPhone}`);

      // Find verification record
      const verification = await PhoneVerification.findOne({ 
        phoneNumber: formattedPhone 
      });

      if (!verification) {
        throw new Error('Verification record not found. Please request a new code.');
      }

      // Verify the code
      const isValid = verification.verifyCode(code);
      await verification.save();

      if (isValid) {
        logger.info(`✅ Phone verification successful for ${formattedPhone}`);
        
        return {
          success: true,
          message: 'Phone number verified successfully',
          phoneNumber: formattedPhone,
          registrationData: verification.registrationData,
          verificationId: verification._id
        };
      } else {
        logger.warn(`❌ Invalid verification code for ${formattedPhone}. Attempts: ${verification.attempts}`);
        
        return {
          success: false,
          message: 'Invalid verification code',
          remainingAttempts: Math.max(0, 5 - verification.attempts)
        };
      }

    } catch (error) {
      logger.error(`❌ Verification failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Resend verification code
   * @param {string} phoneNumber - Phone number
   * @returns {Object} Resend result
   */
  async resendVerificationCode(phoneNumber) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      logger.info(`🔄 Resending verification code to: ${formattedPhone}`);

      // Find existing verification
      const verification = await PhoneVerification.findOne({ 
        phoneNumber: formattedPhone 
      });

      if (!verification) {
        throw new Error('No verification session found. Please start a new verification.');
      }

      // Generate new code
      const newCode = verification.resendCode();
      await verification.save();

      // Prepare SMS message
      const message = `🔐 Your new ParkTayo verification code is: ${newCode}

This code will expire in 10 minutes. DO NOT share this code with anyone.

- ParkTayo Team`;

      // Send SMS
      await this.smsService.sendSMS(formattedPhone, message);

      logger.info(`✅ Verification code resent successfully to ${formattedPhone}`);

      return {
        success: true,
        message: 'New verification code sent successfully',
        phoneNumber: formattedPhone,
        expiresAt: verification.expiresAt,
        canResend: verification.canResend(),
        resendCount: verification.resendCount
      };

    } catch (error) {
      logger.error(`❌ Failed to resend verification code: ${error.message}`);
      throw error;
    }
  }

  /**
   * Check verification status
   * @param {string} phoneNumber - Phone number
   * @returns {Object} Verification status
   */
  async getVerificationStatus(phoneNumber) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      const verification = await PhoneVerification.findOne({ 
        phoneNumber: formattedPhone 
      });

      if (!verification) {
        return {
          exists: false,
          message: 'No verification session found'
        };
      }

      const isExpired = verification.expiresAt < new Date();

      return {
        exists: true,
        isVerified: verification.isVerified,
        isExpired,
        attempts: verification.attempts,
        remainingAttempts: Math.max(0, 5 - verification.attempts),
        canResend: verification.canResend(),
        resendCount: verification.resendCount,
        expiresAt: verification.expiresAt
      };

    } catch (error) {
      logger.error(`❌ Failed to get verification status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Clean up verified phone verification records (called after successful registration)
   * @param {string} phoneNumber - Phone number
   */
  async cleanupVerification(phoneNumber) {
    try {
      const formattedPhone = this.formatPhoneNumber(phoneNumber);
      
      await PhoneVerification.findOneAndDelete({ 
        phoneNumber: formattedPhone,
        isVerified: true
      });

      logger.info(`🧹 Cleaned up verification record for ${formattedPhone}`);
    } catch (error) {
      logger.error(`❌ Failed to cleanup verification: ${error.message}`);
      // Non-critical error, don't throw
    }
  }

  /**
   * Clean up expired verification records
   * This method can be called periodically to clean up the database
   */
  async cleanupExpiredVerifications() {
    try {
      const result = await PhoneVerification.deleteMany({
        expiresAt: { $lt: new Date() }
      });

      logger.info(`🧹 Cleaned up ${result.deletedCount} expired verification records`);
      return result.deletedCount;
    } catch (error) {
      logger.error(`❌ Failed to cleanup expired verifications: ${error.message}`);
      throw error;
    }
  }
}

module.exports = new PhoneVerificationService();
