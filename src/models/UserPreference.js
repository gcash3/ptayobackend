const mongoose = require('mongoose');

const userPreferenceSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  // Parking preferences
  preferredParkingTypes: [{
    type: String,
    enum: ['covered', 'open', 'secure']
  }],
  preferredPriceRange: {
    min: {
      type: Number,
      default: 0
    },
    max: {
      type: Number,
      default: 1000
    }
  },
  preferredDistance: {
    type: Number,
    default: 5 // km
  },
  preferredAmenities: [{
    type: String,
    enum: ['security', 'cctv', 'lighting', 'guards', 'elevator', 'roof', '24h', 'valet']
  }],
  // Time-based preferences
  preferredHours: {
    morning: {
      type: Boolean,
      default: false
    },
    afternoon: {
      type: Boolean,
      default: false
    },
    evening: {
      type: Boolean,
      default: false
    },
    night: {
      type: Boolean,
      default: false
    }
  },
  // Location preferences
  favoriteAreas: [{
    name: String,
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number]
    },
    visitCount: {
      type: Number,
      default: 1
    },
    lastVisited: {
      type: Date,
      default: Date.now
    }
  }],
  // Search history (as a proxy for destination intent)
  searchHistory: [{
    term: { type: String, trim: true },
    coordinates: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: [Number]
    },
    count: { type: Number, default: 1 },
    lastSearched: { type: Date, default: Date.now }
  }],
  // Booking patterns
  bookingHistory: [{
    parkingSpaceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SuggestedParking'
    },
    bookingDate: {
      type: Date,
      required: true
    },
    duration: {
      type: Number, // in hours
      required: true
    },
    amount: {
      type: Number,
      required: true
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    review: String
  }],
  // Usage statistics
  totalBookings: {
    type: Number,
    default: 0
  },
  totalSpent: {
    type: Number,
    default: 0
  },
  averageBookingDuration: {
    type: Number,
    default: 0
  },
  averageRating: {
    type: Number,
    default: 0
  },
  // Behavioral patterns
  peakUsageHours: [{
    hour: Number,
    frequency: Number
  }],
  preferredDays: [{
    day: {
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    },
    frequency: Number
  }],
  // Machine learning features
  mlFeatures: {
    // Parking type preference score
    typePreferences: {
      covered: { type: Number, default: 0 },
      open: { type: Number, default: 0 },
      secure: { type: Number, default: 0 }
    },
    // Price sensitivity (0-1, where 1 is very price sensitive)
    priceSensitivity: {
      type: Number,
      default: 0.5
    },
    // Distance sensitivity (0-1, where 1 is very distance sensitive)
    distanceSensitivity: {
      type: Number,
      default: 0.5
    },
    // Time sensitivity (0-1, where 1 is very time sensitive)
    timeSensitivity: {
      type: Number,
      default: 0.5
    },
    // Amenity preferences
    amenityPreferences: {
      security: { type: Number, default: 0 },
      cctv: { type: Number, default: 0 },
      lighting: { type: Number, default: 0 },
      guards: { type: Number, default: 0 },
      elevator: { type: Number, default: 0 },
      roof: { type: Number, default: 0 },
      '24h': { type: Number, default: 0 },
      valet: { type: Number, default: 0 }
    }
  },
  // Last activity
  lastActivity: {
    type: Date,
    default: Date.now
  },
  // Preferences updated timestamp
  preferencesUpdated: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Index for efficient queries
// userPreferenceSchema.index({ userId: 1 }); // Removed - already unique in schema
userPreferenceSchema.index({ 'favoriteAreas.coordinates': '2dsphere' });
userPreferenceSchema.index({ 'searchHistory.coordinates': '2dsphere' });
userPreferenceSchema.index({ totalBookings: -1 });
userPreferenceSchema.index({ lastActivity: -1 });

// Method to update user preferences based on booking
userPreferenceSchema.methods.updateFromBooking = function(booking) {
  // Update booking history
  this.bookingHistory.push({
    parkingSpaceId: booking.parkingSpaceId,
    bookingDate: booking.bookingDate,
    duration: booking.duration,
    amount: booking.amount,
    rating: booking.rating,
    review: booking.review
  });

  // Update statistics
  this.totalBookings += 1;
  this.totalSpent += booking.amount;
  this.averageBookingDuration = (this.averageBookingDuration * (this.totalBookings - 1) + booking.duration) / this.totalBookings;
  
  if (booking.rating) {
    this.averageRating = (this.averageRating * (this.totalBookings - 1) + booking.rating) / this.totalBookings;
  }

  // Update peak usage hours
  const hour = new Date(booking.bookingDate).getHours();
  const existingHour = this.peakUsageHours.find(h => h.hour === hour);
  if (existingHour) {
    existingHour.frequency += 1;
  } else {
    this.peakUsageHours.push({ hour, frequency: 1 });
  }

  // Update preferred days
  const day = new Date(booking.bookingDate).toLocaleDateString('en-US', { weekday: 'lowercase' });
  const existingDay = this.preferredDays.find(d => d.day === day);
  if (existingDay) {
    existingDay.frequency += 1;
  } else {
    this.preferredDays.push({ day, frequency: 1 });
  }

  this.lastActivity = new Date();
  return this.save();
};

// Method to update ML features
userPreferenceSchema.methods.updateMLFeatures = function() {
  // Calculate type preferences
  const typeCounts = { covered: 0, open: 0, secure: 0 };
  this.bookingHistory.forEach(booking => {
    // This would need to be populated from the parking space
    // For now, we'll use a simple calculation
  });

  // Calculate price sensitivity based on price range preferences
  const priceRange = this.preferredPriceRange.max - this.preferredPriceRange.min;
  this.mlFeatures.priceSensitivity = Math.max(0, Math.min(1, 1 - (priceRange / 1000)));

  // Calculate distance sensitivity
  this.mlFeatures.distanceSensitivity = Math.max(0, Math.min(1, 1 - (this.preferredDistance / 10)));

  this.preferencesUpdated = new Date();
  return this.save();
};

// Method to get personalized recommendations
userPreferenceSchema.methods.getPersonalizedRecommendations = function() {
  const recommendations = {
    preferredTypes: this.preferredParkingTypes,
    priceRange: this.preferredPriceRange,
    maxDistance: this.preferredDistance,
    preferredAmenities: this.preferredAmenities,
    peakHours: this.peakUsageHours.sort((a, b) => b.frequency - a.frequency).slice(0, 3),
    favoriteAreas: this.favoriteAreas.sort((a, b) => b.visitCount - a.visitCount).slice(0, 5)
  };

  return recommendations;
};

// Static method to find users with similar preferences
userPreferenceSchema.statics.findSimilarUsers = function(userId, limit = 10) {
  return this.aggregate([
    { $match: { userId: { $ne: userId } } },
    {
      $addFields: {
        similarityScore: {
          $add: [
            {
              $size: {
                $setIntersection: ['$preferredParkingTypes', '$preferredParkingTypes']
              }
            },
            {
              $multiply: [
                {
                  $abs: {
                    $subtract: ['$mlFeatures.priceSensitivity', '$mlFeatures.priceSensitivity']
                  }
                },
                -1
              ]
            }
          ]
        }
      }
    },
    { $sort: { similarityScore: -1 } },
    { $limit: limit }
  ]);
};

module.exports = mongoose.model('UserPreference', userPreferenceSchema);
