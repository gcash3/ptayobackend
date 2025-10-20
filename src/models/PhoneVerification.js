const mongoose = require('mongoose');

const phoneVerificationSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    match: [/^\+63\d{10}$/, 'Phone number must be in +63XXXXXXXXXX format']
  },
  
  verificationCode: {
    type: String,
    required: true,
    length: 6
  },
  
  isVerified: {
    type: Boolean,
    default: false
  },
  
  attempts: {
    type: Number,
    default: 0,
    max: 5 // Maximum 5 attempts
  },
  
  lastAttempt: {
    type: Date,
    default: Date.now
  },
  
  expiresAt: {
    type: Date,
    required: true,
    default: () => new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    index: { expireAfterSeconds: 0 } // MongoDB TTL
  },
  
  // Track resend attempts
  resendCount: {
    type: Number,
    default: 0,
    max: 3 // Maximum 3 resends per session
  },
  
  // Optional: Track the user who initiated this verification
  temporaryUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    sparse: true
  },
  
  // Registration data (temporary storage)
  registrationData: {
    firstName: String,
    lastName: String,
    email: String,
    password: String, // This will be hashed before storage
    userType: {
      type: String,
      enum: ['client', 'landlord']
    }
  }
}, {
  timestamps: true
});

// Index for efficient lookups
// phoneVerificationSchema.index({ phoneNumber: 1 }); // Removed - already unique in schema
phoneVerificationSchema.index({ verificationCode: 1 });
// phoneVerificationSchema.index({ expiresAt: 1 }); // Removed - already TTL index in schema

// Static method to generate random 6-digit code
phoneVerificationSchema.statics.generateCode = function() {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Static method to create or update verification
phoneVerificationSchema.statics.createVerification = async function(phoneNumber, registrationData = null) {
  const code = this.generateCode();
  
  const verification = await this.findOneAndUpdate(
    { phoneNumber },
    {
      verificationCode: code,
      isVerified: false,
      attempts: 0,
      lastAttempt: new Date(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
      resendCount: 0,
      registrationData
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true
    }
  );
  
  return verification;
};

// Instance method to verify code
phoneVerificationSchema.methods.verifyCode = function(inputCode) {
  // Check if expired
  if (this.expiresAt < new Date()) {
    throw new Error('Verification code has expired');
  }
  
  // Check if too many attempts
  if (this.attempts >= 5) {
    throw new Error('Too many failed attempts. Please request a new code.');
  }
  
  // Increment attempts
  this.attempts += 1;
  this.lastAttempt = new Date();
  
  // Check if code matches
  if (this.verificationCode === inputCode) {
    this.isVerified = true;
    return true;
  }
  
  return false;
};

// Instance method to resend code
phoneVerificationSchema.methods.resendCode = function() {
  // Check resend limit
  if (this.resendCount >= 3) {
    throw new Error('Maximum resend attempts reached. Please try again later.');
  }
  
  // Generate new code
  this.verificationCode = this.constructor.generateCode();
  this.resendCount += 1;
  this.attempts = 0; // Reset attempts for new code
  this.expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Reset expiry
  this.lastAttempt = new Date();
  
  return this.verificationCode;
};

// Instance method to check if can resend
phoneVerificationSchema.methods.canResend = function() {
  return this.resendCount < 3;
};

const PhoneVerification = mongoose.model('PhoneVerification', phoneVerificationSchema);

module.exports = PhoneVerification;
