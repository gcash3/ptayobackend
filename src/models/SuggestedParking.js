const mongoose = require('mongoose');

const suggestedParkingSchema = new mongoose.Schema({
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
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number],
      required: true
    }
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  rating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  totalReviews: {
    type: Number,
    default: 0
  },
  isAvailable: {
    type: Boolean,
    default: true
  },
  type: {
    type: String,
    enum: ['covered', 'open', 'secure'],
    default: 'open'
  },
  description: {
    type: String,
    trim: true
  },
  amenities: [{
    type: String,
    enum: ['security', 'cctv', 'lighting', 'guards', 'elevator', 'roof', '24h', 'valet']
  }],
  currentOccupancy: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  totalSpaces: {
    type: Number,
    required: true,
    min: 1
  },
  landlordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Landlord',
    required: true
  },
  landlordName: {
    type: String,
    required: true
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  isPopular: {
    type: Boolean,
    default: false
  },
  popularityScore: {
    type: Number,
    default: 0
  },
  operatingHours: {
    open: {
      type: String,
      default: '00:00'
    },
    close: {
      type: String,
      default: '23:59'
    }
  },
  specialFeatures: [{
    type: String,
    enum: ['electric_charging', 'disabled_access', 'motorcycle_friendly', 'truck_friendly']
  }],
  images: [{
    type: String
  }],
  tags: [{
    type: String
  }],
  // Analytics fields
  totalBookings: {
    type: Number,
    default: 0
  },
  averageBookingDuration: {
    type: Number,
    default: 0
  },
  peakHours: [{
    hour: Number,
    occupancy: Number
  }],
  revenue: {
    type: Number,
    default: 0
  },
  // User preference learning
  userPreferences: {
    favoriteByUsers: [{
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
      },
      frequency: {
        type: Number,
        default: 1
      },
      lastVisited: {
        type: Date,
        default: Date.now
      }
    }],
    averageRating: {
      type: Number,
      default: 0
    },
    reviewCount: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Index for geospatial queries
suggestedParkingSchema.index({ location: '2dsphere' });

// Index for popular searches
suggestedParkingSchema.index({ isPopular: 1, popularityScore: -1 });
suggestedParkingSchema.index({ isAvailable: 1, rating: -1 });
suggestedParkingSchema.index({ landlordId: 1 });

// Virtual for available spaces
suggestedParkingSchema.virtual('availableSpaces').get(function() {
  return Math.floor(this.totalSpaces * (1 - this.currentOccupancy / 100));
});

// Virtual for occupancy percentage
suggestedParkingSchema.virtual('occupancyPercentage').get(function() {
  return this.currentOccupancy;
});

// Method to update occupancy
suggestedParkingSchema.methods.updateOccupancy = function(bookedSpaces) {
  const availableSpaces = this.totalSpaces - bookedSpaces;
  this.currentOccupancy = ((this.totalSpaces - availableSpaces) / this.totalSpaces) * 100;
  this.isAvailable = availableSpaces > 0;
  return this.save();
};

// Method to calculate popularity score
suggestedParkingSchema.methods.calculatePopularityScore = function() {
  const bookingWeight = 0.4;
  const ratingWeight = 0.3;
  const reviewWeight = 0.2;
  const revenueWeight = 0.1;

  const normalizedBookings = Math.min(this.totalBookings / 100, 1);
  const normalizedRating = this.rating / 5;
  const normalizedReviews = Math.min(this.totalReviews / 50, 1);
  const normalizedRevenue = Math.min(this.revenue / 10000, 1);

  this.popularityScore = (
    normalizedBookings * bookingWeight +
    normalizedRating * ratingWeight +
    normalizedReviews * reviewWeight +
    normalizedRevenue * revenueWeight
  ) * 100;

  return this.save();
};

// Static method to get nearby parking spaces
suggestedParkingSchema.statics.findNearby = function(coordinates, maxDistance = 5000) {
  return this.find({
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: coordinates
        },
        $maxDistance: maxDistance
      }
    },
    isAvailable: true
  }).populate('landlordId', 'name email phone');
};

// Static method to get popular parking spaces
suggestedParkingSchema.statics.findPopular = function(limit = 10) {
  return this.find({
    isAvailable: true,
    isPopular: true
  })
  .sort({ popularityScore: -1, rating: -1 })
  .limit(limit)
  .populate('landlordId', 'name email phone');
};

// Static method to get parking spaces by user preferences
suggestedParkingSchema.statics.findByUserPreferences = function(userId, limit = 10) {
  return this.find({
    'userPreferences.favoriteByUsers.userId': userId,
    isAvailable: true
  })
  .sort({
    'userPreferences.favoriteByUsers.frequency': -1,
    'userPreferences.favoriteByUsers.lastVisited': -1
  })
  .limit(limit)
  .populate('landlordId', 'name email phone');
};

module.exports = mongoose.model('SuggestedParking', suggestedParkingSchema);
