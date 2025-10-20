const mongoose = require('mongoose');

const escrowTransactionSchema = new mongoose.Schema({
  // Core booking information
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
    unique: true // One escrow per booking
  },

  // Payment parties
  clientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  landlordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Total amount breakdown
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },

  // Landlord earnings breakdown
  landlordShare: {
    basePrice: {
      type: Number,
      required: true,
      min: 0
    },
    dynamicPricingBonus: {
      type: Number,
      default: 0,
      min: 0
    },
    overtimeCharges: {
      type: Number,
      default: 0,
      min: 0
    },
    total: {
      type: Number,
      required: true,
      min: 0
    }
  },

  // Platform earnings breakdown
  platformShare: {
    dynamicPricingCut: {
      type: Number,
      default: 0,
      min: 0
    },
    serviceFee: {
      type: Number,
      required: true,
      min: 0
    },
    platformFee: {
      type: Number,
      default: 0,
      min: 0
    },
    total: {
      type: Number,
      required: true,
      min: 0
    }
  },

  // Revenue split configuration (for audit purposes)
  revenueSplit: {
    dynamicPricingPercentage: {
      landlord: { type: Number, default: 50 },
      platform: { type: Number, default: 50 }
    },
    appliedAt: {
      type: Date,
      default: Date.now
    }
  },

  // Escrow status tracking
  status: {
    type: String,
    enum: [
      'held',           // Money is in escrow, waiting for checkout
      'released',       // Money distributed to landlord + admin wallet
      'refunded',       // Money refunded to client (cancellation)
      'disputed',       // In dispute resolution
      'partially_released' // Partial release (rare edge case)
    ],
    default: 'held',
    required: true
  },

  // Status timestamps
  heldAt: {
    type: Date,
    default: Date.now
  },

  releasedAt: {
    type: Date
  },

  refundedAt: {
    type: Date
  },

  // Transaction IDs for traceability
  paymentTransactionId: {
    type: String, // Reference to payment processor transaction
    required: true
  },

  releaseTransactionIds: {
    landlordTransfer: String, // Transaction ID for landlord payment
    adminTransfer: String     // Transaction ID for admin wallet transfer
  },

  refundTransactionId: {
    type: String // Transaction ID for refund if applicable
  },

  // Additional charges (overtime, etc.)
  additionalCharges: [{
    type: {
      type: String,
      enum: ['overtime', 'damage', 'cleaning', 'other']
    },
    amount: Number,
    description: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Refund information
  refundInfo: {
    reason: String,
    amount: Number,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    processedAt: Date
  },

  // Dispute information
  disputeInfo: {
    initiatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    reason: String,
    status: {
      type: String,
      enum: ['open', 'investigating', 'resolved']
    },
    resolution: String,
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    resolvedAt: Date
  },

  // Audit trail
  auditLog: [{
    action: {
      type: String,
      enum: [
        'created', 'held', 'released', 'refunded',
        'disputed', 'additional_charges_added', 'status_updated'
      ]
    },
    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    details: String,
    previousStatus: String,
    newStatus: String
  }],

  // Metadata
  metadata: {
    paymentMethod: String,
    currency: {
      type: String,
      default: 'PHP'
    },
    exchangeRate: {
      type: Number,
      default: 1
    },
    processingFees: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
// escrowTransactionSchema.index({ bookingId: 1 }, { unique: true }); // Removed - already unique in schema
escrowTransactionSchema.index({ clientId: 1 });
escrowTransactionSchema.index({ landlordId: 1 });
escrowTransactionSchema.index({ status: 1 });
escrowTransactionSchema.index({ paymentTransactionId: 1 });
escrowTransactionSchema.index({ createdAt: -1 });
escrowTransactionSchema.index({ releasedAt: -1 });

// Compound indexes
escrowTransactionSchema.index({ status: 1, createdAt: -1 });
escrowTransactionSchema.index({ landlordId: 1, status: 1 });
escrowTransactionSchema.index({ clientId: 1, status: 1 });

// Virtual for total verification
escrowTransactionSchema.virtual('isTotalValid').get(function() {
  const calculatedTotal = this.landlordShare.total + this.platformShare.total;
  return Math.abs(calculatedTotal - this.totalAmount) < 0.01; // Allow for rounding
});

// Virtual for booking details
escrowTransactionSchema.virtual('booking', {
  ref: 'Booking',
  localField: 'bookingId',
  foreignField: '_id',
  justOne: true
});

// Virtual for client details
escrowTransactionSchema.virtual('client', {
  ref: 'User',
  localField: 'clientId',
  foreignField: '_id',
  justOne: true
});

// Virtual for landlord details
escrowTransactionSchema.virtual('landlord', {
  ref: 'User',
  localField: 'landlordId',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware to validate totals
escrowTransactionSchema.pre('save', function(next) {
  // Validate that landlord share totals match
  const landlordCalculated = this.landlordShare.basePrice +
                            this.landlordShare.dynamicPricingBonus +
                            this.landlordShare.overtimeCharges;

  if (Math.abs(landlordCalculated - this.landlordShare.total) > 0.01) {
    return next(new Error('Landlord share total does not match calculated amount'));
  }

  // Validate that platform share totals match
  const platformCalculated = this.platformShare.dynamicPricingCut +
                           this.platformShare.serviceFee +
                           this.platformShare.platformFee;

  if (Math.abs(platformCalculated - this.platformShare.total) > 0.01) {
    return next(new Error('Platform share total does not match calculated amount'));
  }

  // Validate that grand total matches
  const grandCalculated = this.landlordShare.total + this.platformShare.total;
  if (Math.abs(grandCalculated - this.totalAmount) > 0.01) {
    return next(new Error('Total amount does not match sum of shares'));
  }

  next();
});

// Pre-save middleware to add audit log entries
escrowTransactionSchema.pre('save', function(next) {
  if (this.isNew) {
    this.auditLog.push({
      action: 'created',
      timestamp: new Date(),
      details: `Escrow created for booking ${this.bookingId}`,
      newStatus: this.status
    });
  } else if (this.isModified('status')) {
    this.auditLog.push({
      action: 'status_updated',
      timestamp: new Date(),
      details: `Status changed from ${this.constructor.findOne({_id: this._id}).status} to ${this.status}`,
      previousStatus: this.constructor.findOne({_id: this._id}).status,
      newStatus: this.status
    });
  }

  next();
});

// Instance method to release funds
escrowTransactionSchema.methods.releaseFunds = async function(landlordTransactionId, adminTransactionId) {
  if (this.status !== 'held') {
    throw new Error(`Cannot release funds: escrow status is ${this.status}`);
  }

  this.status = 'released';
  this.releasedAt = new Date();
  this.releaseTransactionIds = {
    landlordTransfer: landlordTransactionId,
    adminTransfer: adminTransactionId
  };

  this.auditLog.push({
    action: 'released',
    timestamp: new Date(),
    details: `Funds released: ₱${this.landlordShare.total} to landlord, ₱${this.platformShare.total} to platform`,
    newStatus: 'released'
  });

  return this.save();
};

// Instance method to process refund
escrowTransactionSchema.methods.processRefund = async function(refundAmount, reason, processedBy, refundTransactionId) {
  if (this.status !== 'held') {
    throw new Error(`Cannot process refund: escrow status is ${this.status}`);
  }

  this.status = 'refunded';
  this.refundedAt = new Date();
  this.refundTransactionId = refundTransactionId;
  this.refundInfo = {
    reason,
    amount: refundAmount,
    processedBy,
    processedAt: new Date()
  };

  this.auditLog.push({
    action: 'refunded',
    performedBy: processedBy,
    timestamp: new Date(),
    details: `Refund processed: ₱${refundAmount}. Reason: ${reason}`,
    newStatus: 'refunded'
  });

  return this.save();
};

// Instance method to add additional charges
escrowTransactionSchema.methods.addAdditionalCharge = async function(type, amount, description) {
  this.additionalCharges.push({
    type,
    amount,
    description,
    addedAt: new Date()
  });

  // Recalculate totals if needed
  if (type === 'overtime') {
    this.landlordShare.overtimeCharges += amount;
    this.landlordShare.total += amount;
    this.totalAmount += amount;
  }

  this.auditLog.push({
    action: 'additional_charges_added',
    timestamp: new Date(),
    details: `Added ${type} charge: ₱${amount} - ${description}`
  });

  return this.save();
};

// Static method to find escrows by status
escrowTransactionSchema.statics.findByStatus = function(status) {
  return this.find({ status })
    .populate('booking')
    .populate('client', 'firstName lastName email')
    .populate('landlord', 'firstName lastName email')
    .sort({ createdAt: -1 });
};

// Static method to get landlord earnings summary
escrowTransactionSchema.statics.getLandlordEarnings = function(landlordId, startDate, endDate) {
  const matchStage = {
    landlordId: mongoose.Types.ObjectId(landlordId),
    status: 'released'
  };

  if (startDate && endDate) {
    matchStage.releasedAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: landlordId,
        totalEarnings: { $sum: '$landlordShare.total' },
        baseEarnings: { $sum: '$landlordShare.basePrice' },
        dynamicBonus: { $sum: '$landlordShare.dynamicPricingBonus' },
        overtimeEarnings: { $sum: '$landlordShare.overtimeCharges' },
        transactionCount: { $sum: 1 },
        averageEarning: { $avg: '$landlordShare.total' }
      }
    }
  ]);
};

// Static method to get platform revenue summary
escrowTransactionSchema.statics.getPlatformRevenue = function(startDate, endDate) {
  const matchStage = {
    status: 'released'
  };

  if (startDate && endDate) {
    matchStage.releasedAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$platformShare.total' },
        serviceFeeRevenue: { $sum: '$platformShare.serviceFee' },
        dynamicPricingRevenue: { $sum: '$platformShare.dynamicPricingCut' },
        platformFeeRevenue: { $sum: '$platformShare.platformFee' },
        transactionCount: { $sum: 1 },
        averageRevenue: { $avg: '$platformShare.total' }
      }
    }
  ]);
};

const EscrowTransaction = mongoose.model('EscrowTransaction', escrowTransactionSchema);

module.exports = EscrowTransaction;