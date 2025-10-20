const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  messageId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'MSG-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    }
  },
  senderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  senderType: {
    type: String,
    enum: ['user', 'admin', 'system'],
    required: true
  },
  content: {
    type: String,
    required: true,
    trim: true
  },
  attachments: [{
    fileName: String,
    fileUrl: String,
    fileType: String,
    fileSize: Number
  }],
  isInternal: {
    type: Boolean,
    default: false // Internal notes only visible to admins
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
}, {
  _id: false
});

const supportTicketSchema = new mongoose.Schema({
  // Ticket ID
  ticketId: {
    type: String,
    unique: true,
    required: true,
    default: function() {
      return 'TICKET-' + Date.now() + '-' + Math.random().toString(36).substr(2, 6).toUpperCase();
    }
  },

  // User information
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  userType: {
    type: String,
    enum: ['client', 'landlord'],
    required: true
  },

  // Ticket details
  subject: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    required: true,
    trim: true,
    maxlength: 2000
  },
  
  // Classification
  category: {
    type: String,
    enum: [
      'account',
      'booking',
      'payment',
      'space',
      'technical',
      'billing',
      'feature_request',
      'bug_report',
      'other'
    ],
    required: true
  },
  subcategory: String,
  
  // Priority and status
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  status: {
    type: String,
    enum: ['open', 'in_progress', 'waiting_user', 'waiting_admin', 'resolved', 'closed', 'cancelled'],
    default: 'open'
  },

  // Assignment
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User' // Admin user
  },
  assignedAt: Date,
  department: {
    type: String,
    enum: ['general', 'technical', 'billing', 'operations'],
    default: 'general'
  },

  // Related entities
  relatedBookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking'
  },
  relatedTransactionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Transaction'
  },
  relatedParkingSpaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParkingSpace'
  },

  // Communication
  messages: [messageSchema],
  
  // Timestamps
  firstResponseAt: Date,
  resolvedAt: Date,
  closedAt: Date,
  
  // Resolution
  resolution: {
    type: String,
    trim: true
  },
  resolutionCategory: {
    type: String,
    enum: ['solved', 'workaround', 'duplicate', 'invalid', 'wont_fix']
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  // Satisfaction survey
  satisfaction: {
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    feedback: String,
    submittedAt: Date
  },

  // Tags for organization
  tags: [String],
  
  // Escalation
  escalation: {
    isEscalated: {
      type: Boolean,
      default: false
    },
    escalatedAt: Date,
    escalatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    escalationReason: String,
    escalationLevel: {
      type: Number,
      default: 1
    }
  },

  // SLA tracking
  sla: {
    responseTime: Number, // in minutes
    resolutionTime: Number, // in minutes
    responseDeadline: Date,
    resolutionDeadline: Date,
    isResponseOverdue: {
      type: Boolean,
      default: false
    },
    isResolutionOverdue: {
      type: Boolean,
      default: false
    }
  },

  // Additional metadata
  source: {
    type: String,
    enum: ['web', 'mobile', 'email', 'phone', 'chat'],
    default: 'web'
  },
  language: {
    type: String,
    default: 'en'
  },
  timezone: String,
  
  // Internal notes (only visible to admins)
  internalNotes: [{
    note: String,
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }]

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
supportTicketSchema.index({ userId: 1, createdAt: -1 });
supportTicketSchema.index({ status: 1, priority: 1 });
supportTicketSchema.index({ assignedTo: 1, status: 1 });
supportTicketSchema.index({ category: 1 });
// supportTicketSchema.index({ ticketId: 1 }, { unique: true }); // Removed - already unique in schema
supportTicketSchema.index({ tags: 1 });
supportTicketSchema.index({ 'escalation.isEscalated': 1 });

// Text search index
supportTicketSchema.index({
  subject: 'text',
  description: 'text',
  'messages.content': 'text'
});

// Middleware to handle SLA calculations
supportTicketSchema.pre('save', function(next) {
  const now = new Date();
  
  // Set SLA deadlines for new tickets
  if (this.isNew) {
    // Response time SLA based on priority
    const responseMinutes = {
      urgent: 30,
      high: 120,
      medium: 480, // 8 hours
      low: 1440    // 24 hours
    };
    
    // Resolution time SLA based on priority
    const resolutionMinutes = {
      urgent: 240,     // 4 hours
      high: 1440,      // 24 hours  
      medium: 4320,    // 3 days
      low: 10080       // 7 days
    };
    
    this.sla.responseDeadline = new Date(now.getTime() + responseMinutes[this.priority] * 60000);
    this.sla.resolutionDeadline = new Date(now.getTime() + resolutionMinutes[this.priority] * 60000);
  }
  
  // Check for first response
  if (!this.firstResponseAt && this.messages.length > 1) {
    // Find first admin response
    const firstAdminMessage = this.messages.find(msg => msg.senderType === 'admin');
    if (firstAdminMessage) {
      this.firstResponseAt = firstAdminMessage.timestamp;
      this.sla.responseTime = (this.firstResponseAt - this.createdAt) / (1000 * 60); // in minutes
    }
  }
  
  // Check if resolution time should be calculated
  if (this.isModified('status') && ['resolved', 'closed'].includes(this.status) && !this.resolvedAt) {
    this.resolvedAt = now;
    this.sla.resolutionTime = (this.resolvedAt - this.createdAt) / (1000 * 60); // in minutes
  }
  
  // Check SLA violations
  if (this.sla.responseDeadline && now > this.sla.responseDeadline && !this.firstResponseAt) {
    this.sla.isResponseOverdue = true;
  }
  
  if (this.sla.resolutionDeadline && now > this.sla.resolutionDeadline && !this.resolvedAt) {
    this.sla.isResolutionOverdue = true;
  }
  
  next();
});

// Virtual for ticket age
supportTicketSchema.virtual('ageInHours').get(function() {
  return Math.floor((new Date() - this.createdAt) / (1000 * 60 * 60));
});

// Virtual for last message
supportTicketSchema.virtual('lastMessage').get(function() {
  return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
});

// Static methods
supportTicketSchema.statics.getTicketsByStatus = function(status, limit = 10) {
  return this.find({ status })
    .populate('userId', 'firstName lastName email')
    .populate('assignedTo', 'firstName lastName')
    .limit(limit)
    .sort({ createdAt: -1 });
};

supportTicketSchema.statics.getTicketStats = function() {
  return this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ]);
};

supportTicketSchema.statics.getOverdueTickets = function() {
  const now = new Date();
  return this.find({
    $or: [
      { 'sla.isResponseOverdue': true },
      { 'sla.isResolutionOverdue': true }
    ],
    status: { $nin: ['resolved', 'closed', 'cancelled'] }
  }).populate('userId assignedTo');
};

supportTicketSchema.statics.getAvgResolutionTime = function(category = null) {
  const matchStage = category ? { category, status: 'resolved' } : { status: 'resolved' };
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        avgResolutionTime: { $avg: '$sla.resolutionTime' },
        count: { $sum: 1 }
      }
    }
  ]);
};

// Instance methods
supportTicketSchema.methods.addMessage = function(senderId, senderType, content, attachments = []) {
  this.messages.push({
    senderId,
    senderType,
    content,
    attachments,
    timestamp: new Date()
  });
  
  return this.save();
};

supportTicketSchema.methods.escalate = function(escalatedBy, reason) {
  this.escalation = {
    isEscalated: true,
    escalatedAt: new Date(),
    escalatedBy,
    escalationReason: reason,
    escalationLevel: (this.escalation.escalationLevel || 0) + 1
  };
  
  // Increase priority if not already urgent
  if (this.priority !== 'urgent') {
    const priorityLevels = ['low', 'medium', 'high', 'urgent'];
    const currentIndex = priorityLevels.indexOf(this.priority);
    if (currentIndex < priorityLevels.length - 1) {
      this.priority = priorityLevels[currentIndex + 1];
    }
  }
  
  return this.save();
};

const SupportTicket = mongoose.model('SupportTicket', supportTicketSchema);

module.exports = SupportTicket;