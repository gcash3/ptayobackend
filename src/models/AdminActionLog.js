const mongoose = require('mongoose');

const adminActionLogSchema = new mongoose.Schema({
  // Admin who performed the action
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  adminName: {
    type: String,
    required: true
  },
  adminEmail: {
    type: String,
    required: true
  },

  // Action details
  action: {
    type: String,
    required: true,
    enum: [
      'user_suspend',
      'user_reactivate',
      'user_deactivate',
      'user_edit',
      'user_create',
      'wallet_credit',
      'wallet_debit',
      'send_notification',
      'view_details',
      'landlord_approve',
      'landlord_reject',
      'parking_space_approve',
      'parking_space_reject',
      'parking_space_suspend',
      'booking_refund',
      'system_settings_update'
    ]
  },
  actionDescription: {
    type: String,
    required: true
  },

  // Target user/entity
  targetUserId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  targetUserEmail: String,
  targetUserName: String,
  targetUserType: {
    type: String,
    enum: ['client', 'landlord', 'admin']
  },

  // Additional target (for non-user actions)
  targetEntityId: mongoose.Schema.Types.ObjectId,
  targetEntityType: {
    type: String,
    enum: ['parking_space', 'booking', 'transaction', 'system_settings']
  },

  // Action details and context
  details: {
    // For status changes
    previousStatus: String,
    newStatus: String,
    reason: String,

    // For wallet operations
    amount: Number,
    walletAction: String,
    previousBalance: Number,
    newBalance: Number,

    // For notifications
    notificationType: String,
    notificationMessage: String,

    // For entity approvals/rejections
    approvalStatus: String,
    approvalNotes: String,

    // Generic fields
    notes: String,
    metadata: mongoose.Schema.Types.Mixed
  },

  // Request context
  ipAddress: String,
  userAgent: String,
  requestId: String,

  // Timestamps
  timestamp: {
    type: Date,
    default: Date.now
  },

  // Success/failure status
  status: {
    type: String,
    enum: ['success', 'failed', 'partial'],
    default: 'success'
  },
  error: String
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
adminActionLogSchema.index({ adminId: 1, timestamp: -1 });
adminActionLogSchema.index({ targetUserId: 1, timestamp: -1 });
adminActionLogSchema.index({ action: 1, timestamp: -1 });
adminActionLogSchema.index({ timestamp: -1 });
adminActionLogSchema.index({ 'details.reason': 'text', actionDescription: 'text' });

// Static method to log admin action
adminActionLogSchema.statics.logAction = async function(actionData) {
  try {
    const logEntry = new this(actionData);
    await logEntry.save();
    return logEntry;
  } catch (error) {
    console.error('Failed to log admin action:', error);
    // Don't throw error to avoid breaking the main operation
    return null;
  }
};

// Virtual for formatted timestamp
adminActionLogSchema.virtual('formattedTimestamp').get(function() {
  return this.timestamp.toLocaleString();
});

// Virtual for action summary
adminActionLogSchema.virtual('summary').get(function() {
  let summary = `${this.adminName} performed ${this.action}`;

  if (this.targetUserName) {
    summary += ` on ${this.targetUserName}`;
  }

  if (this.details?.reason) {
    summary += ` (${this.details.reason})`;
  }

  return summary;
});

const AdminActionLog = mongoose.model('AdminActionLog', adminActionLogSchema);

module.exports = AdminActionLog;