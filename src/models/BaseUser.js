const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

// Base user schema with common fields for all user types
const baseUserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: [true, 'First name is required'],
    trim: true,
    maxlength: [50, 'First name cannot be more than 50 characters']
  },
  
  lastName: {
    type: String,
    required: [true, 'Last name is required'],
    trim: true,
    maxlength: [50, 'Last name cannot be more than 50 characters']
  },
  
  email: {
    type: String,
    required: [true, 'Email is required'],
    unique: true,
    lowercase: true,
    match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email']
  },
  
  phoneNumber: {
    type: String,
    match: [/^(\+63|0)[0-9]{10}$/, 'Please provide a valid Philippine phone number'],
    sparse: true
  },
  
  password: {
    type: String,
    required: [true, 'Password is required'],
    minlength: 8,
    select: false
  },
  
  profilePicture: {
    type: String,
    default: null
  },
  
  // Verification and security fields
  isEmailVerified: {
    type: Boolean,
    default: false
  },
  
  emailVerificationToken: String,
  emailVerificationExpires: Date,
  
  passwordResetToken: String,
  passwordResetExpires: Date,
  passwordChangedAt: Date,
  
  // Account status
  active: {
    type: Boolean,
    default: true
  },
  
  // Location and preferences
  address: {
    street: String,
    city: String,
    province: String,
    postalCode: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  
  // Wallet and financial
  walletBalance: {
    type: Number,
    default: 0.00,
    min: 0
  },
  
  // Ratings and reviews
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  
  totalReviews: {
    type: Number,
    default: 0
  },
  
  // Activity tracking
  lastLoginAt: Date,
  loginCount: {
    type: Number,
    default: 0
  },
  
  // FCM tokens for push notifications
  deviceTokens: [{
    fcmToken: {
      type: String,
      required: true
    },
    deviceId: {
      type: String,
      required: true
    },
    platform: {
      type: String,
      enum: ['android', 'ios', 'web'],
      required: true
    },
    appVersion: String,
    isActive: {
      type: Boolean,
      default: true
    },
    lastUsed: {
      type: Date,
      default: Date.now
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Notification preferences by category
  notificationPreferences: {
    booking: {
      type: Boolean,
      default: true
    },
    payment: {
      type: Boolean,
      default: true
    },
    space: {
      type: Boolean,
      default: true
    },
    account: {
      type: Boolean,
      default: true
    },
    system: {
      type: Boolean,
      default: true
    },
    marketing: {
      type: Boolean,
      default: false
    }
  },

  // Legacy notification preferences (for backwards compatibility)
  legacyNotificationPreferences: {
    email: {
      type: Boolean,
      default: true
    },
    push: {
      type: Boolean,
      default: true
    },
    sms: {
      type: Boolean,
      default: false
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true },
  discriminatorKey: 'userType' // This allows inheritance
});

// Indexes for performance
// baseUserSchema.index({ email: 1 }); // Removed - already unique in schema
baseUserSchema.index({ 'address.coordinates': '2dsphere' });
baseUserSchema.index({ userType: 1 });
baseUserSchema.index({ active: 1 });
baseUserSchema.index({ isEmailVerified: 1 });

// Virtual for full name
baseUserSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Pre-save hook to hash password
baseUserSchema.pre('save', async function(next) {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);

  next();
});

// Pre-save hook to set passwordChangedAt
baseUserSchema.pre('save', function(next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// Instance method to check password
baseUserSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

// Instance method to check if password changed after JWT was issued
baseUserSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10
    );
    return JWTTimestamp < changedTimestamp;
  }

  // False means NOT changed
  return false;
};

// Instance method to create password reset token
baseUserSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Instance method to create email verification token
baseUserSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return verificationToken;
};

// Instance method to update last login
baseUserSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  this.loginCount += 1;

  return this.save({ validateBeforeSave: false });
};

// Instance method to add/update FCM token
baseUserSchema.methods.addOrUpdateFCMToken = function(fcmToken, deviceId, platform, appVersion) {
  // Remove existing token for same device
  this.deviceTokens = this.deviceTokens.filter(token => token.deviceId !== deviceId);
  
  // Add new token
  this.deviceTokens.push({
    fcmToken,
    deviceId,
    platform,
    appVersion,
    isActive: true,
    lastUsed: new Date(),
    createdAt: new Date()
  });
  
  return this.save({ validateBeforeSave: false });
};

// Instance method to remove FCM token
baseUserSchema.methods.removeFCMToken = function(deviceId) {
  this.deviceTokens = this.deviceTokens.filter(token => token.deviceId !== deviceId);
  return this.save({ validateBeforeSave: false });
};

// Instance method to update FCM token last used
baseUserSchema.methods.updateFCMTokenUsage = function(deviceId) {
  const token = this.deviceTokens.find(token => token.deviceId === deviceId);
  if (token) {
    token.lastUsed = new Date();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Instance method to get active FCM tokens
baseUserSchema.methods.getActiveFCMTokens = function() {
  return this.deviceTokens
    .filter(token => token.isActive)
    .map(token => token.fcmToken);
};

// Static method to find active users
baseUserSchema.statics.findActive = function() {
  return this.find({ active: { $ne: false } });
};

const BaseUser = mongoose.model('BaseUser', baseUserSchema);

module.exports = BaseUser;
