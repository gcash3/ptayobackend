const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    required: true,
    trim: true,
    lowercase: true
  },
  subject: {
    type: String,
    required: true,
    trim: true
  },
  message: {
    type: String,
    required: true
  },
  category: {
    type: String,
    required: true,
    enum: ['General', 'Bug Report', 'Feature Request', 'User Experience', 'Performance', 'Payment Issues', 'App Crash', 'Other'],
    default: 'General'
  },
  rating: {
    type: Number,
    min: 1,
    max: 5,
    default: 5
  },
  status: {
    type: String,
    enum: ['pending', 'in_progress', 'resolved', 'closed'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  userType: {
    type: String,
    enum: ['user', 'landlord', 'admin', 'anonymous'],
    default: 'anonymous'
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  adminNotes: {
    type: String
  },
  responseMessage: {
    type: String
  },
  resolvedAt: {
    type: Date
  },
  resolvedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Admin'
  },
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }],
  attachments: [{
    filename: String,
    originalName: String,
    mimeType: String,
    size: Number,
    url: String
  }],
  platform: {
    type: String,
    enum: ['web', 'ios', 'android', 'unknown'],
    default: 'unknown'
  },
  appVersion: {
    type: String
  },
  deviceInfo: {
    type: String
  }
}, {
  timestamps: true
});

// Indexes for better performance
feedbackSchema.index({ status: 1, createdAt: -1 });
feedbackSchema.index({ category: 1, status: 1 });
feedbackSchema.index({ assignedTo: 1, status: 1 });
feedbackSchema.index({ email: 1 });
feedbackSchema.index({ rating: 1 });

// Instance methods
feedbackSchema.methods.toJSON = function() {
  const feedback = this.toObject();
  return {
    id: feedback._id,
    name: feedback.name,
    email: feedback.email,
    subject: feedback.subject,
    message: feedback.message,
    category: feedback.category,
    rating: feedback.rating,
    status: feedback.status,
    priority: feedback.priority,
    userType: feedback.userType,
    adminNotes: feedback.adminNotes,
    responseMessage: feedback.responseMessage,
    resolvedAt: feedback.resolvedAt,
    tags: feedback.tags,
    attachments: feedback.attachments,
    platform: feedback.platform,
    appVersion: feedback.appVersion,
    deviceInfo: feedback.deviceInfo,
    createdAt: feedback.createdAt,
    updatedAt: feedback.updatedAt
  };
};

feedbackSchema.methods.assignTo = function(adminId) {
  this.assignedTo = adminId;
  this.status = 'in_progress';
  return this.save();
};

feedbackSchema.methods.resolve = function(adminId, responseMessage = '') {
  this.status = 'resolved';
  this.resolvedAt = new Date();
  this.resolvedBy = adminId;
  if (responseMessage) {
    this.responseMessage = responseMessage;
  }
  return this.save();
};

// Static methods
feedbackSchema.statics.getByStatus = function(status) {
  return this.find({ status }).sort({ createdAt: -1 });
};

feedbackSchema.statics.getByCategory = function(category) {
  return this.find({ category }).sort({ createdAt: -1 });
};

feedbackSchema.statics.getAnalytics = function(startDate, endDate) {
  const matchQuery = {};
  if (startDate && endDate) {
    matchQuery.createdAt = {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    };
  }

  return this.aggregate([
    { $match: matchQuery },
    {
      $group: {
        _id: null,
        totalFeedback: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        categoryBreakdown: {
          $push: {
            category: '$category',
            rating: '$rating',
            status: '$status'
          }
        },
        statusBreakdown: {
          $push: {
            status: '$status'
          }
        }
      }
    }
  ]);
};

module.exports = mongoose.model('Feedback', feedbackSchema);