const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // Transaction ID
  transactionId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
  },

  // Related entities
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true
  },
  parkingSpaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParkingSpace',
    required: true
  },
  landlordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },

  // Transaction amounts
  amount: {
    type: Number,
    required: true,
    min: 0
  },
  platformFee: {
    type: Number,
    required: true,
    min: 0,
    default: function() {
      return this.amount * 0.10; // 10% platform fee
    }
  },
  landlordPayout: {
    type: Number,
    required: true,
    min: 0,
    default: function() {
      return this.amount - this.platformFee;
    }
  },

  // Payment details
  paymentMethod: {
    type: String,
    enum: ['wallet_credit', 'gcash', 'credit_card', 'debit_card', 'paymaya', 'bank_transfer', 'cash'],
    required: true
  },
  paymentProvider: {
    type: String,
    enum: ['stripe', 'paypal', 'gcash', 'paymaya', 'maya', 'grabpay'],
    default: 'stripe'
  },
  paymentIntentId: String, // For Stripe
  paymentMethodId: String, // For Stripe

  // Transaction status
  status: {
    type: String,
    enum: ['pending', 'processing', 'completed', 'failed', 'cancelled', 'refunded', 'disputed'],
    default: 'pending'
  },

  // Timestamps
  initiatedAt: {
    type: Date,
    default: Date.now
  },
  completedAt: Date,
  failedAt: Date,
  
  // Failure details
  failureReason: String,
  errorCode: String,
  
  // Refund information
  refund: {
    amount: Number,
    reason: String,
    processedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    processedAt: Date,
    refundId: String // Payment provider refund ID
  },

  // Additional metadata
  currency: {
    type: String,
    default: 'PHP'
  },
  exchangeRate: {
    type: Number,
    default: 1
  },
  description: String,
  
  // Audit trail
  events: [{
    type: {
      type: String,
      enum: ['created', 'processing', 'completed', 'failed', 'refunded', 'disputed']
    },
    timestamp: {
      type: Date,
      default: Date.now
    },
    description: String,
    metadata: mongoose.Schema.Types.Mixed
  }],

  // Analytics
  processingTime: Number, // in milliseconds
  
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes for performance
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ bookingId: 1 });
transactionSchema.index({ landlordId: 1, createdAt: -1 });
transactionSchema.index({ status: 1, createdAt: -1 });
transactionSchema.index({ paymentMethod: 1 });
// transactionSchema.index({ transactionId: 1 }, { unique: true }); // Removed - already unique in schema

// Middleware to add events
transactionSchema.pre('save', function(next) {
  if (this.isNew) {
    this.events.push({
      type: 'created',
      timestamp: new Date(),
      description: 'Transaction created'
    });
  }
  
  if (this.isModified('status') && !this.isNew) {
    this.events.push({
      type: this.status,
      timestamp: new Date(),
      description: `Transaction status changed to ${this.status}`
    });
    
    if (this.status === 'completed' && !this.completedAt) {
      this.completedAt = new Date();
      this.processingTime = this.completedAt - this.initiatedAt;
    }
    
    if (this.status === 'failed' && !this.failedAt) {
      this.failedAt = new Date();
    }
  }
  
  next();
});

// Virtual for total transaction time
transactionSchema.virtual('transactionDuration').get(function() {
  if (this.completedAt && this.initiatedAt) {
    return this.completedAt - this.initiatedAt;
  }
  return null;
});

// Static methods
transactionSchema.statics.getTransactionsByStatus = function(status, limit = 10) {
  return this.find({ status })
    .populate('userId', 'firstName lastName email')
    .populate('bookingId', 'startTime endTime')
    .populate('parkingSpaceId', 'name address')
    .limit(limit)
    .sort({ createdAt: -1 });
};

transactionSchema.statics.getRevenueStats = function(startDate, endDate) {
  return this.aggregate([
    {
      $match: {
        status: 'completed',
        completedAt: {
          $gte: startDate,
          $lte: endDate
        }
      }
    },
    {
      $group: {
        _id: null,
        totalRevenue: { $sum: '$amount' },
        totalPlatformFees: { $sum: '$platformFee' },
        totalTransactions: { $sum: 1 },
        averageTransactionAmount: { $avg: '$amount' }
      }
    }
  ]);
};

transactionSchema.statics.getPaymentMethodStats = function() {
  return this.aggregate([
    {
      $match: { status: 'completed' }
    },
    {
      $group: {
        _id: '$paymentMethod',
        count: { $sum: 1 },
        totalAmount: { $sum: '$amount' }
      }
    },
    {
      $sort: { count: -1 }
    }
  ]);
};

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;