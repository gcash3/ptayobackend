const mongoose = require('mongoose');

const aiScoringCacheSchema = new mongoose.Schema({
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
  filterType: {
    type: String,
    enum: ['nearby', 'price', 'rating', 'distance', 'availability', 'smart'],
    default: 'nearby'
  },
  userLocation: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true
    }
  },
  aiScore: {
    type: Number,
    required: true,
    min: 0,
    max: 100
  },
  factorScores: {
    userBehavior: {
      score: Number,
      weight: { type: Number, default: 0.40 },
      factors: {
        timePattern: Number,
        priceCompatibility: Number,
        locationFamiliarity: Number,
        frequencyBonus: Number,
        preferenceMatch: Number
      }
    },
    realTime: {
      score: Number,
      weight: { type: Number, default: 0.35 },
      factors: {
        availability: Number,
        pricing: Number,
        trafficCondition: Number,
        weatherImpact: Number,
        eventDemand: Number
      }
    },
    contextual: {
      score: Number,
      weight: { type: Number, default: 0.25 },
      factors: {
        timeOfDay: Number,
        dayOfWeek: Number,
        seasonality: Number,
        walkingDistance: Number,
        popularityTrend: Number
      }
    }
  },
  availabilityMultiplier: {
    type: Number,
    default: 1.0,
    min: 0.1,
    max: 1.0
  },
  recommendationReason: {
    type: String,
    required: true
  },
  metadata: {
    distance: Number, // meters
    walkingTime: Number, // minutes
    estimatedPrice: Number,
    availableSpaces: Number,
    weatherCondition: String,
    trafficLevel: String,
    eventNearby: Boolean
  },
  calculatedAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    default: function() {
      // Cache expires in 15 minutes
      return new Date(Date.now() + 15 * 60 * 1000);
    },
    expires: 0 // TTL index will delete expired documents
  }
}, {
  timestamps: true
});

// Create compound indexes for efficient queries
aiScoringCacheSchema.index({
  userId: 1,
  filterType: 1,
  calculatedAt: -1
});

aiScoringCacheSchema.index({
  userId: 1,
  parkingSpaceId: 1,
  filterType: 1
}, {
  unique: true
});

// aiScoringCacheSchema.index({ expiresAt: 1 }); // Removed - already TTL index in schema
aiScoringCacheSchema.index({ 'userLocation': '2dsphere' });
aiScoringCacheSchema.index({ aiScore: -1 });

// Static methods
aiScoringCacheSchema.statics.getCachedScores = async function(userId, filterType, userLocation, limit = 10) {
  const now = new Date();

  // Find non-expired cached scores for this user and filter type
  const cachedScores = await this.find({
    userId,
    filterType,
    expiresAt: { $gt: now }
  })
  .populate('parkingSpaceId')
  .sort({ aiScore: -1 })
  .limit(limit * 2) // Get more to filter for availability
  .lean();

  return cachedScores.filter(score => score.parkingSpaceId) // Only return if parking space still exists
    .slice(0, limit);
};

aiScoringCacheSchema.statics.setCachedScore = async function(scoreData) {
  return this.findOneAndUpdate(
    {
      userId: scoreData.userId,
      parkingSpaceId: scoreData.parkingSpaceId,
      filterType: scoreData.filterType
    },
    {
      ...scoreData,
      calculatedAt: new Date(),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 minutes from now
    },
    {
      upsert: true,
      new: true
    }
  );
};

aiScoringCacheSchema.statics.invalidateUserCache = async function(userId, filterType = null) {
  const query = { userId };
  if (filterType) {
    query.filterType = filterType;
  }

  return this.deleteMany(query);
};

aiScoringCacheSchema.statics.invalidateParkingSpaceCache = async function(parkingSpaceId) {
  return this.deleteMany({ parkingSpaceId });
};

aiScoringCacheSchema.statics.getTopScoringSpaces = async function(userId, filterType, limit = 10) {
  return this.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(userId),
        filterType,
        expiresAt: { $gt: new Date() }
      }
    },
    {
      $lookup: {
        from: 'parkingspaces',
        localField: 'parkingSpaceId',
        foreignField: '_id',
        as: 'parkingSpace'
      }
    },
    {
      $unwind: '$parkingSpace'
    },
    {
      $match: {
        'parkingSpace.status': 'active',
        'parkingSpace.isAvailable': true
      }
    },
    {
      $sort: { aiScore: -1 }
    },
    {
      $limit: limit
    },
    {
      $project: {
        aiScore: 1,
        factorScores: 1,
        recommendationReason: 1,
        metadata: 1,
        parkingSpace: 1,
        calculatedAt: 1
      }
    }
  ]);
};

// Instance methods
aiScoringCacheSchema.methods.isExpired = function() {
  return new Date() > this.expiresAt;
};

aiScoringCacheSchema.methods.refresh = function() {
  this.calculatedAt = new Date();
  this.expiresAt = new Date(Date.now() + 15 * 60 * 1000);
  return this.save();
};

module.exports = mongoose.model('AIScoringCache', aiScoringCacheSchema);