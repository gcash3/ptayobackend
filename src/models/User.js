const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const userSchema = new mongoose.Schema({
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
  
  role: {
    type: String,
    enum: {
      values: ['client', 'landlord', 'admin'],
      message: 'Role must be either client, landlord, or admin'
    },
    default: 'client'
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

  emailVerified: {
    type: Boolean,
    default: false
  },

  emailVerifiedAt: Date,

  phoneVerified: {
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
    default: true,
    select: false
  },

  status: {
    type: String,
    enum: ['active', 'suspended', 'deactivated'],
    default: 'active'
  },

  // Enhanced suspension tracking
  suspensionReason: String,
  suspendedAt: Date,
  suspendedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  suspendedByName: String, // Cache admin name for performance

  // Reactivation fields
  reactivatedAt: Date,
  reactivatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  reactivatedByName: String, // Cache admin name for performance
  reactivationNotes: String,

  // Status history tracking
  statusHistory: [{
    status: {
      type: String,
      enum: ['active', 'suspended', 'deactivated'],
      required: true
    },
    reason: String,
    notes: String,
    changedAt: {
      type: Date,
      default: Date.now
    },
    changedBy: {
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      adminName: String,
      adminEmail: String
    },
    // Additional context
    previousStatus: String,
    ipAddress: String,
    userAgent: String
  }],

  // Current suspension details (for quick access)
  currentSuspension: {
    isActive: {
      type: Boolean,
      default: false
    },
    reason: String,
    suspendedAt: Date,
    suspendedBy: {
      adminId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      adminName: String,
      adminEmail: String
    },
    expiresAt: Date, // For temporary suspensions
    notes: String
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
  
  // Client-specific fields
  preferredUniversities: [{
    type: String
  }],
  
  vehicleType: {
    type: String,
    enum: ['motorcycle', 'car', 'both'],
    default: 'car'
  },
  
  // Landlord-specific fields
  isVerifiedLandlord: {
    type: Boolean,
    default: false
  },
  
  verificationDocuments: [{
    type: String, // URLs to uploaded documents
    documentType: {
      type: String,
      enum: ['id', 'proof_of_ownership', 'business_permit']
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],

  // KYC ID Verification fields (for landlords) - Optional, only created when user submits verification
  idVerification: {
    idType: {
      type: String,
      enum: [
        'PhilID (National ID)',
        'Driver\'s License', 
        'Philippine Passport',
        'Unified Multi-Purpose ID (UMID)',
        'Professional Regulation Commission (PRC) ID',
        'PhilHealth ID',
        'Postal ID',
        'Voter\'s ID',
        'TIN ID',
        'Barangay ID',
        'Senior Citizen ID'
      ]
    },
    idFrontUrl: String,
    idBackUrl: String,
    selfieUrl: String,
    verificationStatus: {
      type: String,
      enum: ['under_review', 'approved', 'rejected'],
      default: 'under_review'
    },
    submittedAt: {
      type: Date,
      default: Date.now
    },
    reviewedAt: Date,
    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User' // Admin who reviewed
    },
    rejectionReason: String,
    // Cloudinary public IDs for deletion
    cloudinaryIds: {
      frontId: String,
      backId: String,
      selfieId: String
    }
  },
  
  // Wallet and earnings
  walletBalance: {
    type: Number,
    default: 0.00,
    min: 0
  },
  
  totalEarnings: {
    type: Number,
    default: 0.00,
    min: 0
  },

  monthlyEarnings: {
    type: Number,
    default: 0.00,
    min: 0
  },

  // Landlord stats
  stats: {
    totalSpaces: {
      type: Number,
      default: 0
    },
    activeSpaces: {
      type: Number,
      default: 0
    },
    totalBookings: {
      type: Number,
      default: 0
    },
    completedBookings: {
      type: Number,
      default: 0
    },
    cancelledBookings: {
      type: Number,
      default: 0
    },
    responseTimeMinutes: {
      type: Number,
      default: 0
    }
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

  // Smart booking behavior tracking
  behaviorMetrics: {
    reliabilityScore: {
      type: Number,
      default: 85, // Start with 85% reliability
      min: 0,
      max: 100
    },
    arrivalHistory: [{
      bookingId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Booking'
      },
      predictedArrival: Date,
      actualArrival: Date,
      wasOnTime: Boolean,
      delayMinutes: Number,
      timestamp: {
        type: Date,
        default: Date.now
      }
    }],
    latenessPatterns: {
      averageDelay: {
        type: Number,
        default: 0 // minutes
      },
      timeOfDayPattern: [{
        hour: Number, // 0-23
        averageDelay: Number
      }],
      trafficConditionPattern: [{
        condition: String, // 'light', 'moderate', 'heavy'
        averageDelay: Number
      }]
    },
    preferredBufferTime: {
      type: Number,
      default: 30 // minutes
    },
    totalBookings: {
      type: Number,
      default: 0
    },
    onTimeBookings: {
      type: Number,
      default: 0
    }
  },
  
  // Device tokens for push notifications
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
      enum: ['ios', 'android', 'web'],
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
  toObject: { virtuals: true }
});

// Indexes for performance
userSchema.index({ role: 1 });
userSchema.index({ 'address.coordinates': '2dsphere' });
userSchema.index({ isEmailVerified: 1, active: 1 });

// Critical indexes for admin queries and performance
userSchema.index({ email: 1 }); // Unique index for email (already exists via unique: true)
userSchema.index({ phoneNumber: 1 }); // For phone number lookups
userSchema.index({ userType: 1 }); // For filtering by user type
userSchema.index({ status: 1 }); // For status filtering
userSchema.index({ active: 1 }); // For active/inactive filtering
userSchema.index({ createdAt: -1 }); // For sorting by creation date (most common)
userSchema.index({ updatedAt: -1 }); // For sorting by update date

// Compound indexes for common admin queries
userSchema.index({ status: 1, active: 1, createdAt: -1 }); // Status + active + sort
userSchema.index({ userType: 1, active: 1, createdAt: -1 }); // Type + active + sort
userSchema.index({ active: 1, status: 1, userType: 1 }); // Multi-filter queries

// Text search index for name and email searching
userSchema.index({
  firstName: 'text',
  lastName: 'text',
  email: 'text'
}, {
  name: 'user_search_index',
  weights: {
    firstName: 10,
    lastName: 10,
    email: 5
  }
});

// Virtual for full name
userSchema.virtual('fullName').get(function() {
  return `${this.firstName} ${this.lastName}`;
});

// Virtual for parking spaces (for landlords)
userSchema.virtual('parkingSpaces', {
  ref: 'ParkingSpace',
  localField: '_id',
  foreignField: 'landlordId'
});

// Virtual for bookings
userSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'clientId'
});

// Pre-save middleware to hash password
userSchema.pre('save', async function(next) {
  // Only run this function if password was actually modified
  if (!this.isModified('password')) return next();

  // Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);

  next();
});

// Pre-save middleware to set passwordChangedAt
userSchema.pre('save', function(next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

// Instance method to check password
userSchema.methods.correctPassword = async function(candidatePassword, userPassword) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

// Instance method to check if password changed after JWT was issued
userSchema.methods.changedPasswordAfter = function(JWTTimestamp) {
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
userSchema.methods.createPasswordResetToken = function() {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Instance method to create email verification token
userSchema.methods.createEmailVerificationToken = function() {
  const verificationToken = crypto.randomBytes(32).toString('hex');

  this.emailVerificationToken = crypto
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  this.emailVerificationExpires = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

  return verificationToken;
};

// Instance method to update last login
userSchema.methods.updateLastLogin = function() {
  this.lastLoginAt = new Date();
  this.loginCount += 1;
  return this.save({ validateBeforeSave: false });
};

// Instance method to add/update FCM token
userSchema.methods.addOrUpdateFCMToken = function(fcmToken, deviceId, platform, appVersion) {
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
userSchema.methods.removeFCMToken = function(deviceId) {
  this.deviceTokens = this.deviceTokens.filter(token => token.deviceId !== deviceId);
  return this.save({ validateBeforeSave: false });
};

// Instance method to update FCM token last used
userSchema.methods.updateFCMTokenUsage = function(deviceId) {
  const token = this.deviceTokens.find(token => token.deviceId === deviceId);
  if (token) {
    token.lastUsed = new Date();
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Instance method to get active FCM tokens
userSchema.methods.getActiveFCMTokens = function() {
  return this.deviceTokens
    .filter(token => token.isActive)
    .map(token => token.fcmToken);
};

// Static method to find active users
userSchema.statics.findActive = function() {
  return this.find({ active: { $ne: false } });
};

// Static method to find verified landlords
userSchema.statics.findVerifiedLandlords = function() {
  return this.find({
    role: 'landlord',
    isVerifiedLandlord: true,
    active: { $ne: false }
  });
};

// Instance method to change user status with history tracking
userSchema.methods.changeStatus = function(newStatus, adminInfo, details = {}) {
  const previousStatus = this.status;

  // Update status
  this.status = newStatus;

  // Add to status history
  this.statusHistory.push({
    status: newStatus,
    reason: details.reason,
    notes: details.notes,
    changedAt: new Date(),
    changedBy: {
      adminId: adminInfo.adminId,
      adminName: adminInfo.adminName,
      adminEmail: adminInfo.adminEmail
    },
    previousStatus: previousStatus,
    ipAddress: details.ipAddress,
    userAgent: details.userAgent
  });

  // Handle suspension-specific logic
  if (newStatus === 'suspended') {
    this.active = false;
    this.suspensionReason = details.reason;
    this.suspendedAt = new Date();
    this.suspendedBy = adminInfo.adminId;
    this.suspendedByName = adminInfo.adminName;

    // Update current suspension details
    this.currentSuspension = {
      isActive: true,
      reason: details.reason,
      suspendedAt: new Date(),
      suspendedBy: {
        adminId: adminInfo.adminId,
        adminName: adminInfo.adminName,
        adminEmail: adminInfo.adminEmail
      },
      expiresAt: details.expiresAt,
      notes: details.notes
    };
  } else if (newStatus === 'active' && previousStatus !== 'active') {
    // Reactivating user
    this.active = true;
    this.reactivatedAt = new Date();
    this.reactivatedBy = adminInfo.adminId;
    this.reactivatedByName = adminInfo.adminName;
    this.reactivationNotes = details.notes;

    // Clear current suspension
    this.currentSuspension = {
      isActive: false
    };

    // Clear suspension fields
    this.suspensionReason = undefined;
  } else if (newStatus === 'deactivated') {
    this.active = false;
  }

  return this.save();
};

// Instance method to get latest status info
userSchema.methods.getStatusInfo = function() {
  const latestHistory = this.statusHistory && this.statusHistory.length > 0
    ? this.statusHistory[this.statusHistory.length - 1]
    : null;

  return {
    currentStatus: this.status,
    isActive: this.active,
    isSuspended: this.status === 'suspended' && this.currentSuspension?.isActive,
    suspensionDetails: this.currentSuspension?.isActive ? {
      reason: this.currentSuspension.reason,
      suspendedAt: this.currentSuspension.suspendedAt,
      suspendedBy: this.currentSuspension.suspendedBy?.adminName,
      expiresAt: this.currentSuspension.expiresAt,
      notes: this.currentSuspension.notes
    } : null,
    lastChange: latestHistory ? {
      status: latestHistory.status,
      changedAt: latestHistory.changedAt,
      changedBy: latestHistory.changedBy?.adminName,
      reason: latestHistory.reason
    } : null,
    statusHistoryCount: this.statusHistory ? this.statusHistory.length : 0
  };
};

const User = mongoose.model('User', userSchema);

module.exports = User; 