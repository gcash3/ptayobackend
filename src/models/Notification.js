const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  // Recipient information
  recipientId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  recipientType: {
    type: String,
    enum: ['client', 'landlord', 'admin'],
    required: true
  },

  // Notification content
  title: {
    type: String,
    required: true,
    maxlength: 100
  },

  message: {
    type: String,
    required: true,
    maxlength: 500
  },

  // Notification type and category
  type: {
    type: String,
    enum: [
      // Booking notifications
      'booking_confirmed',
      'booking_cancelled',
      'booking_reminder',
      'booking_started',
      'booking_completed',
      'booking_expired',
      
      // Payment notifications
      'payment_received',
      'payment_failed',
      'refund_processed',
      'payout_sent',
      
      // Space management
      'space_approved',
      'space_rejected',
      'space_suspended',
      'space_reactivated',
      
      // System notifications
      'account_verified',
      'password_changed',
      'profile_updated',
      'maintenance_notice',
      'security_alert',
      
      // Marketing
      'promotion',
      'new_feature',
      'survey'
    ],
    required: true
  },

  category: {
    type: String,
    enum: ['booking', 'payment', 'space', 'account', 'system', 'marketing'],
    required: true
  },

  // Priority level
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },

  // Related entities
  relatedEntityId: {
    type: mongoose.Schema.Types.ObjectId,
    required: false // ID of related booking, space, payment, etc.
  },

  relatedEntityType: {
    type: String,
    enum: ['booking', 'parking_space', 'payment', 'user', 'transaction'],
    required: false
  },

  // Delivery channels
  channels: {
    inApp: {
      enabled: { type: Boolean, default: true },
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      read: { type: Boolean, default: false },
      readAt: Date
    },
    
    push: {
      enabled: { type: Boolean, default: true },
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      attempts: { type: Number, default: 0 },
      lastAttempt: Date,
      errorMessage: String
    },
    
    email: {
      enabled: { type: Boolean, default: false }, // Only for important notifications
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      attempts: { type: Number, default: 0 },
      lastAttempt: Date,
      errorMessage: String
    },
    
    sms: {
      enabled: { type: Boolean, default: false }, // Only for critical notifications
      delivered: { type: Boolean, default: false },
      deliveredAt: Date,
      attempts: { type: Number, default: 0 },
      lastAttempt: Date,
      errorMessage: String
    }
  },

  // Scheduling
  scheduledFor: {
    type: Date,
    default: Date.now
  },

  expiresAt: {
    type: Date,
    default: function() {
      // Default expiration: 30 days from creation
      return new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    }
  },

  // Action data (for actionable notifications)
  actionData: {
    actionType: {
      type: String,
      enum: ['none', 'approve', 'reject', 'view', 'rate', 'pay', 'extend'],
      default: 'none'
    },
    actionUrl: String,
    actionText: String,
    actionPayload: mongoose.Schema.Types.Mixed
  },

  // Metadata
  metadata: {
    imageUrl: String,
    deepLink: String,
    customData: mongoose.Schema.Types.Mixed
  },

  // Delivery status
  status: {
    type: String,
    enum: ['pending', 'sent', 'delivered', 'failed', 'expired'],
    default: 'pending'
  },

  // Tracking
  sentAt: Date,
  deliveredAt: Date,
  failedAt: Date,
  
  // User preferences override
  overrideUserPreferences: {
    type: Boolean,
    default: false
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
notificationSchema.index({ recipientId: 1, createdAt: -1 });
notificationSchema.index({ recipientType: 1, type: 1 });
notificationSchema.index({ status: 1, scheduledFor: 1 });
notificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index
notificationSchema.index({ 'channels.inApp.read': 1, recipientId: 1 });

// Virtual for checking if notification is actionable
notificationSchema.virtual('isActionable').get(function() {
  return this.actionData.actionType !== 'none';
});

// Virtual for checking if notification is expired
notificationSchema.virtual('isExpired').get(function() {
  return this.expiresAt && this.expiresAt < new Date();
});

// Virtual for overall delivery status
notificationSchema.virtual('isDelivered').get(function() {
  return this.channels.inApp.delivered || 
         this.channels.push.delivered || 
         this.channels.email.delivered || 
         this.channels.sms.delivered;
});

// Pre-save middleware
notificationSchema.pre('save', function(next) {
  // Set category based on type if not set
  if (!this.category) {
    if (this.type.startsWith('booking_')) this.category = 'booking';
    else if (this.type.startsWith('payment_') || this.type.includes('payout') || this.type.includes('refund')) this.category = 'payment';
    else if (this.type.startsWith('space_')) this.category = 'space';
    else if (this.type.includes('account') || this.type.includes('profile') || this.type.includes('password')) this.category = 'account';
    else if (this.type === 'promotion' || this.type === 'new_feature' || this.type === 'survey') this.category = 'marketing';
    else this.category = 'system';
  }
  
  next();
});

// Instance methods
notificationSchema.methods.markAsRead = function() {
  this.channels.inApp.read = true;
  this.channels.inApp.readAt = new Date();
  return this.save();
};

notificationSchema.methods.markAsDelivered = function(channel) {
  if (this.channels[channel]) {
    this.channels[channel].delivered = true;
    this.channels[channel].deliveredAt = new Date();
    
    // Update overall status
    if (this.status === 'pending') {
      this.status = 'delivered';
      this.deliveredAt = new Date();
    }
  }
  return this.save();
};

notificationSchema.methods.markAsFailed = function(channel, errorMessage) {
  if (this.channels[channel]) {
    this.channels[channel].attempts += 1;
    this.channels[channel].lastAttempt = new Date();
    this.channels[channel].errorMessage = errorMessage;
    
    // Mark as failed if all channels failed or max attempts reached
    if (this.channels[channel].attempts >= 3) {
      this.status = 'failed';
      this.failedAt = new Date();
    }
  }
  return this.save();
};

// Static methods
notificationSchema.statics.createNotification = async function(data) {
  const notification = new this(data);
  await notification.save();
  
  // Trigger real-time delivery
  const io = require('../server').io;
  if (io) {
    io.to(`user_${data.recipientId}`).emit('new_notification', {
      id: notification._id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      category: notification.category,
      priority: notification.priority,
      createdAt: notification.createdAt,
      actionData: notification.actionData
    });
  }
  
  return notification;
};

notificationSchema.statics.getUnreadCount = function(recipientId) {
  return this.countDocuments({
    recipientId,
    'channels.inApp.read': false,
    status: { $in: ['sent', 'delivered'] }
  });
};

notificationSchema.statics.getUserNotifications = function(recipientId, options = {}) {
  const {
    page = 1,
    limit = 20,
    category = null,
    unreadOnly = false
  } = options;

  const query = { recipientId };
  
  if (category) query.category = category;
  if (unreadOnly) query['channels.inApp.read'] = false;
  
  return this.find(query)
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit)
    .populate('relatedEntityId');
};

notificationSchema.statics.markAllAsRead = function(recipientId, category = null) {
  const query = { 
    recipientId,
    'channels.inApp.read': false
  };
  
  if (category) query.category = category;
  
  return this.updateMany(query, {
    'channels.inApp.read': true,
    'channels.inApp.readAt': new Date()
  });
};

notificationSchema.statics.cleanupExpired = function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

// Notification templates
notificationSchema.statics.templates = {
  space_approved: {
    title: 'Parking Space Approved! 🎉',
    message: 'Your parking space "{spaceName}" has been approved and is now live!',
    category: 'space',
    priority: 'high',
    channels: { inApp: { enabled: true }, push: { enabled: true }, email: { enabled: true } }
  },
  
  space_rejected: {
    title: 'Parking Space Needs Review',
    message: 'Your parking space "{spaceName}" requires some updates before approval.',
    category: 'space',
    priority: 'high',
    channels: { inApp: { enabled: true }, push: { enabled: true }, email: { enabled: true } }
  },
  
  booking_confirmed: {
    title: 'Booking Confirmed! 🚗',
    message: 'Your parking booking at {spaceName} is confirmed for {date}.',
    category: 'booking',
    priority: 'high',
    channels: { inApp: { enabled: true }, push: { enabled: true } }
  },
  
  payment_received: {
    title: 'Payment Received 💰',
    message: 'You received ₱{amount} for your parking space booking.',
    category: 'payment',
    priority: 'medium',
    channels: { inApp: { enabled: true }, push: { enabled: true } }
  }
};

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification; 