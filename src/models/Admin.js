const mongoose = require('mongoose');
const BaseUser = require('./BaseUser');

// Admin-specific schema extending BaseUser
const adminSchema = new mongoose.Schema({
  // Admin role and permissions
  adminLevel: {
    type: String,
    enum: ['super_admin', 'admin', 'moderator', 'support'],
    default: 'admin'
  },

  permissions: [{
    type: String,
    enum: [
      'user_management',
      'space_management', 
      'booking_management',
      'financial_management',
      'content_management',
      'system_settings',
      'analytics_access',
      'support_tickets',
      'verification_approval',
      'emergency_actions'
    ]
  }],

  // Admin work information
  employeeId: {
    type: String,
    unique: true,
    sparse: true
  },

  department: {
    type: String,
    enum: ['operations', 'customer_support', 'finance', 'tech', 'marketing'],
    default: 'operations'
  },

  workSchedule: {
    timezone: {
      type: String,
      default: 'Asia/Manila'
    },
    workingHours: {
      start: {
        type: String,
        default: '09:00'
      },
      end: {
        type: String,
        default: '18:00'
      }
    },
    workingDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }]
  },

  // Security and access
  twoFactorEnabled: {
    type: Boolean,
    default: false
  },

  twoFactorSecret: {
    type: String,
    select: false
  },

  ipWhitelist: [{
    ip: String,
    description: String,
    addedAt: {
      type: Date,
      default: Date.now
    }
  }],

  // Activity tracking
  lastActiveAt: Date,
  
  sessionHistory: [{
    loginTime: Date,
    logoutTime: Date,
    ipAddress: String,
    userAgent: String,
    location: {
      country: String,
      city: String
    },
    isActive: {
      type: Boolean,
      default: true
    }
  }],

  // Performance metrics
  stats: {
    totalActionsPerformed: {
      type: Number,
      default: 0
    },
    usersManaged: {
      type: Number,
      default: 0
    },
    ticketsResolved: {
      type: Number,
      default: 0
    },
    verificationsApproved: {
      type: Number,
      default: 0
    },
    verificationsRejected: {
      type: Number,
      default: 0
    },
    averageResponseTimeHours: {
      type: Number,
      default: 0
    }
  },

  // Admin settings and preferences
  dashboardSettings: {
    defaultView: {
      type: String,
      enum: ['overview', 'users', 'bookings', 'analytics'],
      default: 'overview'
    },
    refreshInterval: {
      type: Number,
      default: 30000 // 30 seconds
    },
    notificationSettings: {
      newUserRegistration: {
        type: Boolean,
        default: true
      },
      urgentTickets: {
        type: Boolean,
        default: true
      },
      systemAlerts: {
        type: Boolean,
        default: true
      },
      verificationRequests: {
        type: Boolean,
        default: true
      }
    }
  },

  // Emergency contact and backup admin
  emergencyContacts: [{
    name: String,
    role: String,
    phoneNumber: String,
    email: String
  }],

  backupAdmin: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },

  // Account creation info
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },

  approvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },

  approvalDate: Date,

  // Account status
  isAccountLocked: {
    type: Boolean,
    default: false
  },

  lockReason: String,
  lockedAt: Date,
  lockedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },

  // Temporary access
  temporaryAccess: {
    isTemporary: {
      type: Boolean,
      default: false
    },
    expiresAt: Date,
    reason: String
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for admin-specific queries
adminSchema.index({ adminLevel: 1 });
adminSchema.index({ department: 1 });
// adminSchema.index({ employeeId: 1 }); // Removed - already unique in schema
adminSchema.index({ isAccountLocked: 1 });
adminSchema.index({ lastActiveAt: -1 });
adminSchema.index({ createdBy: 1 });

// Virtual for permission level (numeric)
adminSchema.virtual('permissionLevel').get(function() {
  const levels = {
    'super_admin': 5,
    'admin': 4,
    'moderator': 3,
    'support': 2
  };
  return levels[this.adminLevel] || 1;
});

// Virtual for working status
adminSchema.virtual('isWorking').get(function() {
  const now = new Date();
  const currentDay = now.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const currentTime = now.toTimeString().slice(0, 5);

  return this.workSchedule.workingDays.includes(currentDay) &&
         currentTime >= this.workSchedule.workingHours.start &&
         currentTime <= this.workSchedule.workingHours.end;
});

// Instance method to check permission
adminSchema.methods.hasPermission = function(permission) {
  if (this.adminLevel === 'super_admin') return true;
  return this.permissions.includes(permission);
};

// Instance method to add action to stats
adminSchema.methods.recordAction = function(actionType) {
  this.stats.totalActionsPerformed += 1;
  
  switch(actionType) {
    case 'user_managed':
      this.stats.usersManaged += 1;
      break;
    case 'ticket_resolved':
      this.stats.ticketsResolved += 1;
      break;
    case 'verification_approved':
      this.stats.verificationsApproved += 1;
      break;
    case 'verification_rejected':
      this.stats.verificationsRejected += 1;
      break;
  }
  
  return this.save({ validateBeforeSave: false });
};

// Instance method to log session
adminSchema.methods.logSession = function(ipAddress, userAgent, location) {
  this.sessionHistory.push({
    loginTime: new Date(),
    ipAddress,
    userAgent,
    location,
    isActive: true
  });
  
  this.lastActiveAt = new Date();
  
  // Keep only last 50 sessions
  if (this.sessionHistory.length > 50) {
    this.sessionHistory = this.sessionHistory.slice(-50);
  }
  
  return this.save({ validateBeforeSave: false });
};

// Instance method to end session
adminSchema.methods.endSession = function(sessionId) {
  const session = this.sessionHistory.id(sessionId);
  if (session) {
    session.logoutTime = new Date();
    session.isActive = false;
    return this.save({ validateBeforeSave: false });
  }
  return Promise.resolve(this);
};

// Instance method to lock account
adminSchema.methods.lockAccount = function(reason, lockedBy) {
  this.isAccountLocked = true;
  this.lockReason = reason;
  this.lockedAt = new Date();
  this.lockedBy = lockedBy;
  return this.save();
};

// Instance method to unlock account
adminSchema.methods.unlockAccount = function() {
  this.isAccountLocked = false;
  this.lockReason = undefined;
  this.lockedAt = undefined;
  this.lockedBy = undefined;
  return this.save();
};

// Static method to find by permission
adminSchema.statics.findByPermission = function(permission) {
  return this.find({
    $or: [
      { adminLevel: 'super_admin' },
      { permissions: permission }
    ],
    active: { $ne: false },
    isAccountLocked: false
  });
};

// Static method to find online admins
adminSchema.statics.findOnline = function() {
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
  return this.find({
    lastActiveAt: { $gte: fiveMinutesAgo },
    active: { $ne: false },
    isAccountLocked: false
  });
};

// Static method to find by department
adminSchema.statics.findByDepartment = function(department) {
  return this.find({
    department,
    active: { $ne: false },
    isAccountLocked: false
  });
};

// Create Admin model as discriminator of BaseUser
const Admin = BaseUser.discriminator('Admin', adminSchema);

module.exports = Admin;
