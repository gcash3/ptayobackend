const mongoose = require('mongoose');
const crypto = require('crypto');

const emailVerificationSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  verificationCode: {
    type: String,
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  expiresAt: {
    type: Date,
    required: true,
    default: function() {
      return new Date(Date.now() + 10 * 60 * 1000); // 10 minutes from now
    }
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5
  },
  lastAttempt: {
    type: Date
  },
  resendCount: {
    type: Number,
    default: 0,
    max: 3
  },
  lastResend: {
    type: Date
  },
  verified: {
    type: Boolean,
    default: false
  },
  verifiedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '15m' // Document expires after 15 minutes
  }
});

// Index for automatic cleanup and fast lookups
emailVerificationSchema.index({ email: 1, createdAt: 1 });
emailVerificationSchema.index({ userId: 1 });

// Generate a random 6-digit verification code
emailVerificationSchema.methods.generateVerificationCode = function() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  this.verificationCode = code;
  this.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  return code;
};

// Check if verification code is expired
emailVerificationSchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt.getTime();
};

// Check if verification code is valid
emailVerificationSchema.methods.isValidCode = function(inputCode) {
  return this.verificationCode === inputCode && !this.isExpired() && !this.verified;
};

// Increment attempt count
emailVerificationSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  this.lastAttempt = new Date();
  return this.save();
};

// Check if max attempts reached
emailVerificationSchema.methods.isAttemptsExceeded = function() {
  return this.attempts >= 5;
};

// Mark as verified
emailVerificationSchema.methods.markAsVerified = function() {
  this.verified = true;
  this.verifiedAt = new Date();
  return this.save();
};

// Check if can resend (cooldown period)
emailVerificationSchema.methods.canResend = function() {
  if (this.resendCount >= 3) return false;
  
  if (!this.lastResend) return true;
  
  const cooldownPeriod = 60 * 1000; // 1 minute cooldown
  return Date.now() - this.lastResend.getTime() > cooldownPeriod;
};

// Increment resend count
emailVerificationSchema.methods.incrementResend = function() {
  this.resendCount += 1;
  this.lastResend = new Date();
  this.attempts = 0; // Reset attempts on resend
  return this.save();
};

// Static method to cleanup expired or verified records
emailVerificationSchema.statics.cleanup = async function() {
  const result = await this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { verified: true, verifiedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } // Remove verified records older than 24 hours
    ]
  });
  return result.deletedCount;
};

// Static method to find active verification for email
emailVerificationSchema.statics.findActiveVerification = function(email) {
  return this.findOne({
    email: email.toLowerCase(),
    verified: false,
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('EmailVerification', emailVerificationSchema);
