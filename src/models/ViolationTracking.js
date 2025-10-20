const mongoose = require('mongoose');

const violationTrackingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  
  // Violation tracking
  totalViolations: {
    type: Number,
    default: 0,
    min: 0
  },
  
  consecutiveViolations: {
    type: Number,
    default: 0,
    min: 0
  },
  
  lastViolationDate: {
    type: Date,
    default: null
  },
  
  // Violation history
  violations: [{
    bookingId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Booking',
      required: true
    },
    
    violationType: {
      type: String,
      enum: ['no_show', 'late_cancellation'],
      required: true
    },
    
    scheduledTime: {
      type: Date,
      required: true
    },
    
    actualTime: {
      type: Date, // When they actually showed up or when violation was detected
      default: null
    },
    
    minutesLate: {
      type: Number,
      default: 0
    },
    
    refundPercentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    },
    
    originalAmount: {
      type: Number,
      required: true,
      min: 0
    },
    
    refundAmount: {
      type: Number,
      required: true,
      min: 0
    },
    
    penaltyAmount: {
      type: Number,
      required: true,
      min: 0
    },
    
    status: {
      type: String,
      enum: ['pending', 'processed', 'disputed'],
      default: 'pending'
    },
    
    processedAt: {
      type: Date,
      default: null
    },
    
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Current penalty tier (affects refund percentage)
  currentTier: {
    type: Number,
    default: 0, // 0 = no violations, 1 = first violation (80%), 2 = second (70%), 3+ = (50%)
    min: 0
  },
  
  // Reset tracking (violations reset after good behavior)
  lastGoodBookingDate: {
    type: Date,
    default: null
  },
  
  consecutiveGoodBookings: {
    type: Number,
    default: 0,
    min: 0
  }
}, {
  timestamps: true
});

// Indexes for performance
violationTrackingSchema.index({ userId: 1, createdAt: -1 });
violationTrackingSchema.index({ 'violations.bookingId': 1 });
violationTrackingSchema.index({ lastViolationDate: -1 });

// Methods
violationTrackingSchema.methods.getRefundPercentage = function() {
  // Refund percentages based on violation tier
  const refundTiers = {
    0: 100, // No violations - full refund
    1: 80,  // First violation - 80% refund
    2: 70,  // Second violation - 70% refund
    3: 50   // Third+ violation - 50% refund (minimum)
  };
  
  const tier = Math.min(this.currentTier, 3);
  return refundTiers[tier];
};

violationTrackingSchema.methods.addViolation = function(violationData) {
  // Add new violation
  this.violations.push(violationData);
  this.totalViolations += 1;
  this.consecutiveViolations += 1;
  this.lastViolationDate = new Date();
  
  // Update tier
  this.currentTier = Math.min(this.consecutiveViolations, 3);
  
  // Reset good booking streak
  this.consecutiveGoodBookings = 0;
  
  return this.save();
};

violationTrackingSchema.methods.recordGoodBooking = function() {
  this.consecutiveGoodBookings += 1;
  this.lastGoodBookingDate = new Date();
  
  // Reset violations after 5 consecutive good bookings
  if (this.consecutiveGoodBookings >= 5) {
    this.consecutiveViolations = 0;
    this.currentTier = 0;
  }
  
  return this.save();
};

violationTrackingSchema.methods.calculateRefund = function(originalAmount) {
  const refundPercentage = this.getRefundPercentage();
  const refundAmount = (originalAmount * refundPercentage) / 100;
  const penaltyAmount = originalAmount - refundAmount;
  
  return {
    refundPercentage,
    refundAmount,
    penaltyAmount,
    originalAmount
  };
};

// Static methods
violationTrackingSchema.statics.findOrCreateForUser = async function(userId) {
  let tracking = await this.findOne({ userId });
  
  if (!tracking) {
    tracking = new this({ userId });
    await tracking.save();
  }
  
  return tracking;
};

violationTrackingSchema.statics.getUserViolationSummary = async function(userId) {
  const tracking = await this.findOne({ userId });
  
  if (!tracking) {
    return {
      totalViolations: 0,
      currentTier: 0,
      refundPercentage: 100,
      consecutiveGoodBookings: 0
    };
  }
  
  return {
    totalViolations: tracking.totalViolations,
    currentTier: tracking.currentTier,
    refundPercentage: tracking.getRefundPercentage(),
    consecutiveGoodBookings: tracking.consecutiveGoodBookings,
    lastViolationDate: tracking.lastViolationDate
  };
};

module.exports = mongoose.model('ViolationTracking', violationTrackingSchema);
