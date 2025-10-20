const mongoose = require('mongoose');

const passwordResetSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  resetCode: {
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
  used: {
    type: Boolean,
    default: false
  },
  usedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: '15m' // Document expires after 15 minutes
  }
});

// Index for automatic cleanup and fast lookups
passwordResetSchema.index({ email: 1, createdAt: 1 });
passwordResetSchema.index({ userId: 1 });

// Generate a random 6-digit reset code
passwordResetSchema.methods.generateResetCode = function() {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  this.resetCode = code;
  this.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
  return code;
};

// Check if reset code is expired
passwordResetSchema.methods.isExpired = function() {
  return Date.now() > this.expiresAt.getTime();
};

// Check if reset code is valid
passwordResetSchema.methods.isValidCode = function(inputCode) {
  return this.resetCode === inputCode && !this.isExpired() && !this.used;
};

// Increment attempt count (without auto-save)
passwordResetSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  this.lastAttempt = new Date();
  // Note: Caller must save() manually to avoid parallel save conflicts
};

// Check if max attempts reached
passwordResetSchema.methods.isAttemptsExceeded = function() {
  return this.attempts >= 5;
};

// Mark as used (without auto-save)
passwordResetSchema.methods.markAsUsed = function() {
  this.used = true;
  this.usedAt = new Date();
  // Note: Caller must save() manually to avoid parallel save conflicts
};

// Check if can resend (cooldown period)
passwordResetSchema.methods.canResend = function() {
  if (this.resendCount >= 3) return false;
  
  if (!this.lastResend) return true;
  
  const cooldownPeriod = 60 * 1000; // 1 minute cooldown
  return Date.now() - this.lastResend.getTime() > cooldownPeriod;
};

// Increment resend count (without auto-save)
passwordResetSchema.methods.incrementResend = function() {
  this.resendCount += 1;
  this.lastResend = new Date();
  this.attempts = 0; // Reset attempts on resend
  // Note: Caller must save() manually to avoid parallel save conflicts
};

// Static method to cleanup expired or used records
passwordResetSchema.statics.cleanup = async function() {
  const result = await this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { used: true, usedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } // Remove used records older than 24 hours
    ]
  });
  return result.deletedCount;
};

// Static method to find active reset for email
passwordResetSchema.statics.findActiveReset = function(email) {
  return this.findOne({
    email: email.toLowerCase(),
    used: false,
    expiresAt: { $gt: new Date() }
  }).sort({ createdAt: -1 });
};

module.exports = mongoose.model('PasswordReset', passwordResetSchema);
