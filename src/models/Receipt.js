const mongoose = require('mongoose');

const receiptSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  walletTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WalletTransaction',
    default: null
  },

  amount: {
    type: Number,
    required: true,
    min: [1, 'Amount must be at least 1']
  },

  mobileNumber: {
    type: String,
    required: true
  },

  senderName: {
    type: String,
    required: true
  },

  receiptImage: {
    cloudinaryId: {
      type: String,
      required: true
    },
    secureUrl: {
      type: String,
      required: true
    },
    thumbnailUrl: {
      type: String,
      required: true
    },
    originalName: {
      type: String,
      required: true
    },
    size: {
      type: Number,
      required: true
    },
    format: {
      type: String,
      required: true
    }
  },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
    index: true
  },

  adminNotes: {
    type: String,
    default: ''
  },

  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    default: null
  },

  reviewedAt: {
    type: Date,
    default: null
  },

  rejectionReason: {
    type: String,
    default: ''
  },

  metadata: {
    userAgent: String,
    ipAddress: String,
    deviceInfo: String
  }
}, {
  timestamps: true
});

// Indexes for better query performance
receiptSchema.index({ userId: 1, status: 1 });
receiptSchema.index({ status: 1, createdAt: -1 });
receiptSchema.index({ reviewedBy: 1, reviewedAt: -1 });

// Instance method to approve receipt
receiptSchema.methods.approve = async function(adminId, notes = '') {
  this.status = 'approved';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.adminNotes = notes;
  return await this.save();
};

// Instance method to reject receipt
receiptSchema.methods.reject = async function(adminId, reason = '', notes = '') {
  this.status = 'rejected';
  this.reviewedBy = adminId;
  this.reviewedAt = new Date();
  this.rejectionReason = reason;
  this.adminNotes = notes;
  return await this.save();
};

// Static method to get pending receipts
receiptSchema.statics.getPendingReceipts = function(page = 1, limit = 20) {
  return this.find({ status: 'pending' })
    .populate('userId', 'firstName lastName email phoneNumber')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip((page - 1) * limit);
};

// Static method to get receipts by user
receiptSchema.statics.getReceiptsByUser = function(userId, page = 1, limit = 10) {
  return this.find({ userId })
    .populate('reviewedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(limit)
    .skip((page - 1) * limit);
};

// Static method to get receipt statistics
receiptSchema.statics.getReceiptStats = async function() {
  const [stats] = await this.aggregate([
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        pending: {
          $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] }
        },
        approved: {
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] }
        },
        rejected: {
          $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] }
        },
        totalAmount: {
          $sum: { $cond: [{ $eq: ['$status', 'approved'] }, '$amount', 0] }
        }
      }
    }
  ]);

  return stats || {
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    totalAmount: 0
  };
};

const Receipt = mongoose.model('Receipt', receiptSchema);

module.exports = Receipt;