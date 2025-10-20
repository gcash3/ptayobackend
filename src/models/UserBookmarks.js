const mongoose = require('mongoose');

const userBookmarksSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  parkingSpaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParkingSpace',
    required: true
  },
  bookmarkedAt: {
    type: Date,
    default: Date.now
  },
  personalNotes: {
    type: String,
    maxlength: 500,
    trim: true
  },
  tags: [{
    type: String,
    enum: [
      'convenient', 'cheap', 'safe', 'covered', 'security',
      'close-to-entrance', 'good-lighting', 'wide-spaces',
      'fast-exit', 'regular-spot', 'backup-option',
      'weekend-only', 'weekday-only', 'morning-preferred',
      'afternoon-preferred', 'evening-preferred'
    ]
  }],
  accessibilityFeatures: [{
    type: String,
    enum: ['wheelchair-accessible', 'elevator-nearby', 'ramp-access', 'wide-parking-space']
  }],
  customRating: {
    overall: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    convenience: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    safety: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    },
    value: {
      type: Number,
      min: 1,
      max: 5,
      default: null
    }
  },
  visitHistory: {
    totalVisits: {
      type: Number,
      default: 0
    },
    lastVisited: Date,
    firstVisited: Date,
    averageStayDuration: Number, // minutes
    totalSpent: {
      type: Number,
      default: 0
    }
  },
  preferences: {
    notifyOnAvailability: {
      type: Boolean,
      default: false
    },
    notifyOnPriceChange: {
      type: Boolean,
      default: false
    },
    preferredTimeSlots: [String], // ['morning', 'afternoon', 'evening']
    maxWalkingDistance: Number, // meters
    priceAlertThreshold: Number // alert if price goes below this
  },
  metadata: {
    bookmarkedFrom: {
      type: String,
      enum: ['search', 'suggestion', 'map', 'recent', 'booking-history'],
      default: 'search'
    },
    deviceType: String,
    appVersion: String,
    userLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
      }
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Create compound unique index to prevent duplicate bookmarks
userBookmarksSchema.index({ userId: 1, parkingSpaceId: 1 }, { unique: true });

// Create indexes for efficient queries
userBookmarksSchema.index({ userId: 1, bookmarkedAt: -1 });
userBookmarksSchema.index({ parkingSpaceId: 1 });
userBookmarksSchema.index({ tags: 1 });
userBookmarksSchema.index({ isActive: 1 });
userBookmarksSchema.index({ 'metadata.userLocation': '2dsphere' });

// Virtual for calculating bookmark age
userBookmarksSchema.virtual('ageInDays').get(function() {
  return Math.floor((Date.now() - this.bookmarkedAt) / (1000 * 60 * 60 * 24));
});

// Instance methods
userBookmarksSchema.methods.updateVisitHistory = function(bookingData) {
  this.visitHistory.totalVisits += 1;
  this.visitHistory.lastVisited = new Date();

  if (!this.visitHistory.firstVisited) {
    this.visitHistory.firstVisited = new Date();
  }

  if (bookingData.totalAmount) {
    this.visitHistory.totalSpent += bookingData.totalAmount;
  }

  if (bookingData.duration) {
    const currentAvg = this.visitHistory.averageStayDuration || 0;
    const totalVisits = this.visitHistory.totalVisits;
    this.visitHistory.averageStayDuration =
      ((currentAvg * (totalVisits - 1)) + bookingData.duration) / totalVisits;
  }

  return this.save();
};

userBookmarksSchema.methods.addTag = function(tag) {
  if (!this.tags.includes(tag)) {
    this.tags.push(tag);
    return this.save();
  }
  return this;
};

userBookmarksSchema.methods.removeTag = function(tag) {
  this.tags = this.tags.filter(t => t !== tag);
  return this.save();
};

userBookmarksSchema.methods.updateRating = function(ratings) {
  Object.assign(this.customRating, ratings);
  return this.save();
};

// Static methods
userBookmarksSchema.statics.getBookmarksByUser = async function(userId, options = {}) {
  const {
    tags = null,
    sortBy = 'bookmarkedAt',
    sortOrder = -1,
    limit = 20,
    skip = 0,
    includeInactive = false
  } = options;

  const query = { userId };

  if (!includeInactive) {
    query.isActive = true;
  }

  if (tags && tags.length > 0) {
    query.tags = { $in: tags };
  }

  return this.find(query)
    .populate('parkingSpaceId')
    .sort({ [sortBy]: sortOrder })
    .skip(skip)
    .limit(limit)
    .lean();
};

userBookmarksSchema.statics.getBookmarkStats = async function(userId) {
  const stats = await this.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId), isActive: true } },
    {
      $group: {
        _id: null,
        totalBookmarks: { $sum: 1 },
        totalVisits: { $sum: '$visitHistory.totalVisits' },
        totalSpent: { $sum: '$visitHistory.totalSpent' },
        averageRating: { $avg: '$customRating.overall' },
        mostCommonTags: { $push: '$tags' }
      }
    }
  ]);

  return stats[0] || {
    totalBookmarks: 0,
    totalVisits: 0,
    totalSpent: 0,
    averageRating: 0,
    mostCommonTags: []
  };
};

userBookmarksSchema.statics.findNearbyBookmarks = async function(userId, longitude, latitude, maxDistance = 5000) {
  return this.find({
    userId,
    isActive: true,
    'metadata.userLocation': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    }
  })
  .populate('parkingSpaceId')
  .limit(10);
};

userBookmarksSchema.statics.getFrequentlyBookmarked = async function(limit = 10) {
  return this.aggregate([
    { $match: { isActive: true } },
    {
      $group: {
        _id: '$parkingSpaceId',
        bookmarkCount: { $sum: 1 },
        totalVisits: { $sum: '$visitHistory.totalVisits' },
        averageRating: { $avg: '$customRating.overall' },
        commonTags: { $push: '$tags' }
      }
    },
    {
      $lookup: {
        from: 'parkingspaces',
        localField: '_id',
        foreignField: '_id',
        as: 'parkingSpace'
      }
    },
    {
      $unwind: '$parkingSpace'
    },
    {
      $match: {
        'parkingSpace.status': 'active'
      }
    },
    {
      $sort: { bookmarkCount: -1, totalVisits: -1 }
    },
    {
      $limit: limit
    }
  ]);
};

userBookmarksSchema.statics.toggleBookmark = async function(userId, parkingSpaceId, bookmarkData = {}) {
  const existingBookmark = await this.findOne({ userId, parkingSpaceId });

  if (existingBookmark) {
    // Remove bookmark
    await this.deleteOne({ _id: existingBookmark._id });
    return { action: 'removed', bookmark: null };
  } else {
    // Add bookmark
    const bookmark = new this({
      userId,
      parkingSpaceId,
      ...bookmarkData
    });
    await bookmark.save();
    return { action: 'added', bookmark };
  }
};

module.exports = mongoose.model('UserBookmarks', userBookmarksSchema);