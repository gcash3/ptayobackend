const mongoose = require('mongoose');

const recentLocationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  address: {
    type: String,
    required: true,
    trim: true
  },
  latitude: {
    type: Number,
    required: true,
    min: -90,
    max: 90
  },
  longitude: {
    type: Number,
    required: true,
    min: -180,
    max: 180
  },
  type: {
    type: String,
    enum: ['search', 'manual', 'bookmark', 'frequent_location'],
    default: 'search'
  },
  searchCount: {
    type: Number,
    default: 1
  },
  lastSearched: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
recentLocationSchema.index({ userId: 1, lastSearched: -1 });
recentLocationSchema.index({ userId: 1, searchCount: -1 });

// Compound index for location proximity queries
recentLocationSchema.index({ 
  userId: 1, 
  latitude: 1, 
  longitude: 1 
});

// Pre-save middleware to update lastSearched when searchCount increases
recentLocationSchema.pre('save', function(next) {
  if (this.isModified('searchCount') && !this.isNew) {
    this.lastSearched = new Date();
  }
  next();
});

// Method to increment search count
recentLocationSchema.methods.incrementSearchCount = function() {
  this.searchCount += 1;
  this.lastSearched = new Date();
  return this.save();
};

// Static method to find or create location
recentLocationSchema.statics.findOrCreate = async function(userId, locationData) {
  const proximityThreshold = 0.001; // ~100 meters
  
  // Try to find existing location within proximity
  const existing = await this.findOne({
    userId: userId,
    latitude: {
      $gte: locationData.latitude - proximityThreshold,
      $lte: locationData.latitude + proximityThreshold
    },
    longitude: {
      $gte: locationData.longitude - proximityThreshold,
      $lte: locationData.longitude + proximityThreshold
    }
  });

  if (existing) {
    // Update existing location
    await existing.incrementSearchCount();
    return existing;
  } else {
    // Create new location
    return await this.create({
      userId,
      ...locationData
    });
  }
};

// Static method to get user's recent locations with cleanup
recentLocationSchema.statics.getRecentForUser = async function(userId, limit = 10) {
  // Remove old entries (older than 30 days and less than 3 searches)
  await this.deleteMany({
    userId: userId,
    createdAt: { $lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    searchCount: { $lt: 3 }
  });

  // Return recent locations sorted by last searched
  return await this.find({ userId })
    .sort({ lastSearched: -1, searchCount: -1 })
    .limit(limit);
};

const RecentLocation = mongoose.model('RecentLocation', recentLocationSchema);

module.exports = RecentLocation;