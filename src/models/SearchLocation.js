const mongoose = require('mongoose');

const searchLocationSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  // Location details
  name: {
    type: String,
    required: true,
    trim: true
  },

  latitude: {
    type: Number,
    required: true
  },

  longitude: {
    type: Number,
    required: true
  },

  // Location indexing for geospatial queries
  location: {
    type: {
      type: String,
      enum: ['Point'],
      default: 'Point'
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      index: '2dsphere'
    }
  },

  // Location categorization
  category: {
    type: String,
    enum: ['university', 'school', 'college', 'institute', 'academy', 'general'],
    default: 'university'
  },

  // Interaction type
  interactionType: {
    type: String,
    enum: ['search_click', 'bookmark', 'manual_add'],
    default: 'search_click'
  },

  // Usage tracking
  searchCount: {
    type: Number,
    default: 1
  },

  lastSearched: {
    type: Date,
    default: Date.now,
    index: true
  },

  firstSearched: {
    type: Date,
    default: Date.now
  },

  // Source tracking
  searchSource: {
    type: String,
    enum: ['google_places', 'manual_entry', 'suggestion_chip', 'recent_location'],
    default: 'google_places'
  },

  // Google Places integration
  placeId: {
    type: String,
    sparse: true // Only for Google Places results
  },

  // Related booking information
  hasBookings: {
    type: Boolean,
    default: false
  },

  totalBookings: {
    type: Number,
    default: 0
  },

  lastBookingDate: {
    type: Date
  },

  // AI learning metrics
  aiMetrics: {
    userInterestScore: {
      type: Number,
      default: 1,
      min: 0,
      max: 100
    },

    searchFrequency: {
      type: String,
      enum: ['rare', 'occasional', 'frequent', 'very_frequent'],
      default: 'rare'
    },

    // Time patterns
    preferredTimeSlots: [{
      type: String,
      enum: ['morning', 'afternoon', 'evening', 'night']
    }],

    // Day patterns
    preferredDays: [{
      type: String,
      enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
    }]
  },

  // University-specific data
  universityData: {
    isVerifiedUniversity: {
      type: Boolean,
      default: false
    },

    universityType: {
      type: String,
      enum: ['public', 'private', 'technical', 'medical', 'arts', 'business'],
      sparse: true
    },

    studentPopulation: {
      type: String,
      enum: ['small', 'medium', 'large', 'very_large'],
      sparse: true
    }
  },

  // Status
  isActive: {
    type: Boolean,
    default: true
  },

  // Metadata
  metadata: {
    deviceType: String,
    userAgent: String,
    ipAddress: String,
    sessionId: String
  }

}, {
  timestamps: true,
  collection: 'searchlocations'
});

// Indexes for performance
searchLocationSchema.index({ userId: 1, lastSearched: -1 });
searchLocationSchema.index({ userId: 1, searchCount: -1 });
searchLocationSchema.index({ userId: 1, category: 1 });
searchLocationSchema.index({ location: '2dsphere' });
searchLocationSchema.index({ name: 'text' });

// Compound index for AI queries
searchLocationSchema.index({
  userId: 1,
  'aiMetrics.userInterestScore': -1,
  lastSearched: -1
});

// Pre-save middleware to update location coordinates
searchLocationSchema.pre('save', function(next) {
  if (this.isModified('latitude') || this.isModified('longitude')) {
    this.location = {
      type: 'Point',
      coordinates: [this.longitude, this.latitude]
    };
  }
  next();
});

// Instance methods
searchLocationSchema.methods.incrementSearch = function() {
  this.searchCount += 1;
  this.lastSearched = new Date();

  // Update search frequency
  if (this.searchCount >= 10) {
    this.aiMetrics.searchFrequency = 'very_frequent';
  } else if (this.searchCount >= 5) {
    this.aiMetrics.searchFrequency = 'frequent';
  } else if (this.searchCount >= 2) {
    this.aiMetrics.searchFrequency = 'occasional';
  }

  // Update user interest score based on recency and frequency
  const daysSinceFirst = (Date.now() - this.firstSearched) / (1000 * 60 * 60 * 24);
  const searchesPerDay = this.searchCount / Math.max(daysSinceFirst, 1);

  this.aiMetrics.userInterestScore = Math.min(100,
    (this.searchCount * 10) + (searchesPerDay * 20)
  );

  return this.save();
};

searchLocationSchema.methods.updateBookingStatus = function(bookingCount, lastBookingDate) {
  this.hasBookings = bookingCount > 0;
  this.totalBookings = bookingCount;
  this.lastBookingDate = lastBookingDate;

  // Boost interest score for locations with actual bookings
  if (this.hasBookings) {
    this.aiMetrics.userInterestScore = Math.min(100,
      this.aiMetrics.userInterestScore + (bookingCount * 15)
    );
  }

  return this.save();
};

// Static methods
searchLocationSchema.statics.findOrCreateSearchLocation = async function(locationData) {
  const { userId, name, latitude, longitude } = locationData;

  // Try to find existing location (within 100m radius)
  let existingLocation = await this.findOne({
    userId: userId,
    location: {
      $near: {
        $geometry: { type: 'Point', coordinates: [longitude, latitude] },
        $maxDistance: 100 // 100 meters
      }
    }
  });

  if (existingLocation) {
    // Update existing location
    existingLocation.name = name; // Update name in case it's different
    return await existingLocation.incrementSearch();
  } else {
    // Create new location
    const newLocation = new this({
      ...locationData,
      location: {
        type: 'Point',
        coordinates: [longitude, latitude]
      }
    });

    return await newLocation.save();
  }
};

searchLocationSchema.statics.getRecentLocationsForUser = async function(userId, options = {}) {
  const {
    limit = 10,
    categoryFilter = null,
    includeBookingData = true,
    timeframe = 90 // days
  } = options;

  const dateThreshold = new Date();
  dateThreshold.setDate(dateThreshold.getDate() - timeframe);

  const query = {
    userId: userId,
    isActive: true,
    lastSearched: { $gte: dateThreshold }
  };

  if (categoryFilter) {
    query.category = categoryFilter;
  }

  let locations = await this.find(query)
    .sort({
      'aiMetrics.userInterestScore': -1,
      lastSearched: -1,
      searchCount: -1
    })
    .limit(limit);

  if (includeBookingData) {
    // Enhance with booking data
    const Booking = mongoose.model('Booking');

    for (let location of locations) {
      const bookingCount = await Booking.countDocuments({
        userId: userId,
        // Match bookings near this location (within 500m)
        $expr: {
          $lte: [
            {
              $sqrt: {
                $add: [
                  { $pow: [{ $multiply: [{ $subtract: ['$destinationLat', location.latitude] }, 111000] }, 2] },
                  { $pow: [{ $multiply: [{ $subtract: ['$destinationLng', location.longitude] }, 111000] }, 2] }
                ]
              }
            },
            500
          ]
        }
      });

      if (bookingCount !== location.totalBookings) {
        const lastBooking = await Booking.findOne({
          userId: userId,
          $expr: {
            $lte: [
              {
                $sqrt: {
                  $add: [
                    { $pow: [{ $multiply: [{ $subtract: ['$destinationLat', location.latitude] }, 111000] }, 2] },
                    { $pow: [{ $multiply: [{ $subtract: ['$destinationLng', location.longitude] }, 111000] }, 2] }
                  ]
                }
              },
              500
            ]
          }
        }).sort({ createdAt: -1 });

        await location.updateBookingStatus(bookingCount, lastBooking?.createdAt);
      }
    }
  }

  return locations;
};

module.exports = mongoose.model('SearchLocation', searchLocationSchema);