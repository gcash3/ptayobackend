const mongoose = require('mongoose');

const cancellationPolicySchema = new mongoose.Schema({
  // Policy identification
  name: {
    type: String,
    required: true,
    default: 'Standard Cancellation Policy'
  },
  
  description: {
    type: String,
    required: true,
    default: 'Standard no-show and cancellation policy with violation tracking'
  },
  
  // Time limits (in minutes before booking time)
  freeCancellationLimit: {
    type: Number,
    default: 60, // 60 minutes before booking = free cancellation
    min: 0
  },
  
  lateCancellationLimit: {
    type: Number,
    default: 15, // 15 minutes before booking = late cancellation fee
    min: 0
  },
  
  noShowGracePeriod: {
    type: Number,
    default: 15, // 15 minutes after booking time = grace period
    min: 0
  },
  
  // Fees and refunds
  freeCancellationRefund: {
    type: Number,
    default: 100, // 100% refund for free cancellation
    min: 0,
    max: 100
  },
  
  lateCancellationRefund: {
    type: Number,
    default: 50, // 50% refund for late cancellation
    min: 0,
    max: 100
  },
  
  // Violation-based refunds (overrides above for no-shows)
  violationRefunds: {
    firstViolation: {
      type: Number,
      default: 80, // 80% refund for first no-show
      min: 0,
      max: 100
    },
    secondViolation: {
      type: Number,
      default: 70, // 70% refund for second no-show
      min: 0,
      max: 100
    },
    thirdViolation: {
      type: Number,
      default: 50, // 50% refund for third+ no-show
      min: 0,
      max: 100
    }
  },
  
  // Reset conditions
  violationResetAfterGoodBookings: {
    type: Number,
    default: 5, // Reset violations after 5 good bookings
    min: 1
  },
  
  violationResetAfterDays: {
    type: Number,
    default: 90, // Alternative: reset after 90 days of no violations
    min: 1
  },
  
  // Policy status
  isActive: {
    type: Boolean,
    default: true
  },
  
  effectiveFrom: {
    type: Date,
    default: Date.now
  },
  
  effectiveTo: {
    type: Date,
    default: null // null means indefinite
  }
}, {
  timestamps: true
});

// Methods
cancellationPolicySchema.methods.getRefundAmount = function(originalAmount, violationTier = 0, isCancellation = false, minutesBeforeBooking = 0) {
  let refundPercentage = 0;
  
  if (isCancellation) {
    // User initiated cancellation
    if (minutesBeforeBooking >= this.freeCancellationLimit) {
      refundPercentage = this.freeCancellationRefund;
    } else if (minutesBeforeBooking >= this.lateCancellationLimit) {
      refundPercentage = this.lateCancellationRefund;
    } else {
      refundPercentage = 0; // No refund for very late cancellation
    }
  } else {
    // No-show violation
    switch (violationTier) {
      case 0:
        refundPercentage = 100; // No previous violations
        break;
      case 1:
        refundPercentage = this.violationRefunds.firstViolation;
        break;
      case 2:
        refundPercentage = this.violationRefunds.secondViolation;
        break;
      default:
        refundPercentage = this.violationRefunds.thirdViolation;
        break;
    }
  }
  
  const refundAmount = (originalAmount * refundPercentage) / 100;
  const penaltyAmount = originalAmount - refundAmount;
  
  return {
    originalAmount,
    refundPercentage,
    refundAmount,
    penaltyAmount,
    isFullRefund: refundPercentage === 100
  };
};

cancellationPolicySchema.methods.canCancelWithoutFee = function(minutesBeforeBooking) {
  return minutesBeforeBooking >= this.freeCancellationLimit;
};

cancellationPolicySchema.methods.canCancel = function(minutesBeforeBooking) {
  return minutesBeforeBooking >= this.lateCancellationLimit;
};

cancellationPolicySchema.methods.isNoShow = function(minutesAfterBooking) {
  return minutesAfterBooking > this.noShowGracePeriod;
};

// Static methods
cancellationPolicySchema.statics.getActivePolicy = async function() {
  const now = new Date();
  return this.findOne({
    isActive: true,
    effectiveFrom: { $lte: now },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gte: now } }
    ]
  });
};

cancellationPolicySchema.statics.createDefaultPolicy = async function() {
  const existingPolicy = await this.getActivePolicy();
  if (!existingPolicy) {
    const defaultPolicy = new this({
      name: 'ParkTayo Standard Policy',
      description: 'Standard cancellation and no-show policy with progressive violation penalties'
    });
    return defaultPolicy.save();
  }
  return existingPolicy;
};

module.exports = mongoose.model('CancellationPolicy', cancellationPolicySchema);
