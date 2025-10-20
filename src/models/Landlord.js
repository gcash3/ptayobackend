const mongoose = require('mongoose');
const BaseUser = require('./BaseUser');

// Landlord-specific schema extending BaseUser
const landlordSchema = new mongoose.Schema({
  // Landlord verification fields
  isVerifiedLandlord: {
    type: Boolean,
    default: false
  },
  
  verificationDocuments: [{
    type: String, // URLs to uploaded documents
    documentType: {
      type: String,
      enum: ['id', 'proof_of_ownership', 'business_permit', 'tax_certificate']
    },
    uploadDate: {
      type: Date,
      default: Date.now
    }
  }],

  // KYC ID Verification fields
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
      ref: 'Admin'
    },
    rejectionReason: String,
    // Cloudinary public IDs for deletion
    cloudinaryIds: {
      frontId: String,
      backId: String,
      selfieId: String
    }
  },
  
  // Financial information
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

  // Business information
  businessInfo: {
    businessName: String,
    businessType: {
      type: String,
      enum: ['individual', 'corporation', 'partnership', 'cooperative']
    },
    tinNumber: String,
    businessPermitNumber: String,
    businessAddress: {
      street: String,
      city: String,
      province: String,
      postalCode: String
    }
  },

  // Banking information for payouts
  bankAccount: {
    bankName: String,
    accountNumber: String,
    accountName: String,
    accountType: {
      type: String,
      enum: ['savings', 'checking']
    },
    isVerified: {
      type: Boolean,
      default: false
    }
  },

  // Performance metrics
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

  // Landlord preferences
  preferences: {
    autoAcceptBookings: {
      type: Boolean,
      default: false
    },
    minimumBookingDuration: {
      type: Number,
      default: 1, // hours
      min: 0.5
    },
    maximumBookingDuration: {
      type: Number,
      default: 24, // hours
      min: 1
    },
    advanceBookingDays: {
      type: Number,
      default: 30,
      min: 1
    },
    cancellationPolicy: {
      type: String,
      enum: ['flexible', 'moderate', 'strict'],
      default: 'flexible'
    }
  },

  // Payout settings
  payoutSettings: {
    minimumPayout: {
      type: Number,
      default: 500.00,
      min: 100
    },
    payoutSchedule: {
      type: String,
      enum: ['weekly', 'bi-weekly', 'monthly'],
      default: 'weekly'
    },
    lastPayoutDate: Date,
    nextPayoutDate: Date
  },

  // Compliance and legal
  compliance: {
    taxRegistered: {
      type: Boolean,
      default: false
    },
    businessLicenseValid: {
      type: Boolean,
      default: false
    },
    insuranceCoverage: {
      type: Boolean,
      default: false
    },
    lastComplianceCheck: Date
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for landlord-specific queries
landlordSchema.index({ isVerifiedLandlord: 1 });
landlordSchema.index({ 'idVerification.verificationStatus': 1 });
landlordSchema.index({ totalEarnings: -1 });
landlordSchema.index({ 'stats.totalSpaces': -1 });
landlordSchema.index({ 'stats.averageRating': -1 });
landlordSchema.index({ 'businessInfo.businessType': 1 });

// Virtual for completion rate
landlordSchema.virtual('completionRate').get(function() {
  if (this.stats.totalBookings === 0) return 0;
  return (this.stats.completedBookings / this.stats.totalBookings) * 100;
});

// Virtual for verification level
landlordSchema.virtual('verificationLevel').get(function() {
  let level = 0;
  if (this.isEmailVerified) level += 1;
  if (this.phoneNumber) level += 1;
  if (this.idVerification && this.idVerification.verificationStatus === 'approved') level += 2;
  if (this.bankAccount && this.bankAccount.isVerified) level += 1;
  return level;
});

// Instance method to update earnings
landlordSchema.methods.addEarnings = function(amount) {
  this.totalEarnings += amount;
  this.monthlyEarnings += amount;
  return this.save({ validateBeforeSave: false });
};

// Instance method to update space stats
landlordSchema.methods.updateSpaceStats = function(totalSpaces, activeSpaces) {
  this.stats.totalSpaces = totalSpaces;
  this.stats.activeSpaces = activeSpaces;
  return this.save({ validateBeforeSave: false });
};

// Instance method to increment booking stats
landlordSchema.methods.incrementBookingStats = function(type = 'total') {
  this.stats.totalBookings += 1;
  if (type === 'completed') {
    this.stats.completedBookings += 1;
  } else if (type === 'cancelled') {
    this.stats.cancelledBookings += 1;
  }
  return this.save({ validateBeforeSave: false });
};

// Instance method to update response time
landlordSchema.methods.updateResponseTime = function(responseTimeMinutes) {
  // Calculate moving average
  const currentAvg = this.stats.responseTimeMinutes || 0;
  const totalBookings = this.stats.totalBookings || 1;
  this.stats.responseTimeMinutes = ((currentAvg * (totalBookings - 1)) + responseTimeMinutes) / totalBookings;
  return this.save({ validateBeforeSave: false });
};

// Static method to find verified landlords
landlordSchema.statics.findVerified = function() {
  return this.find({ 
    isVerifiedLandlord: true,
    active: { $ne: false }
  });
};

// Static method to find pending verifications
landlordSchema.statics.findPendingVerification = function() {
  return this.find({ 
    'idVerification.verificationStatus': 'under_review',
    active: { $ne: false }
  });
};

// Static method to find top earning landlords
landlordSchema.statics.findTopEarners = function(limit = 10) {
  return this.find({ 
    isVerifiedLandlord: true,
    active: { $ne: false }
  })
  .sort({ totalEarnings: -1 })
  .limit(limit);
};

// Static method to find landlords by city
landlordSchema.statics.findByCity = function(city) {
  return this.find({ 
    'address.city': new RegExp(city, 'i'),
    isVerifiedLandlord: true,
    active: { $ne: false }
  });
};

// Create Landlord model as discriminator of BaseUser
const Landlord = BaseUser.discriminator('Landlord', landlordSchema);

module.exports = Landlord;
