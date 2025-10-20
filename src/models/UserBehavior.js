const mongoose = require('mongoose');

const userBehaviorSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true
  },
  bookingPatterns: {
    preferredTimes: [String], // ['morning', 'afternoon', 'evening', 'night']
    averageDuration: {
      type: Number,
      default: 2 // hours
    },
    priceRange: {
      min: {
        type: Number,
        default: 0
      },
      max: {
        type: Number,
        default: 100
      },
      average: {
        type: Number,
        default: 50
      }
    },
    frequentUniversities: [String], // Names of frequently visited universities
    frequentParkingSpaces: [{
      parkingSpaceId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ParkingSpace'
      },
      visitCount: {
        type: Number,
        default: 1
      },
      lastVisited: Date,
      averageRating: Number
    }],
    parkingPreferences: [String], // ['covered', 'security', 'price', 'distance', 'reviews']
    weekdayPatterns: {
      monday: { bookingCount: Number, averageTime: String },
      tuesday: { bookingCount: Number, averageTime: String },
      wednesday: { bookingCount: Number, averageTime: String },
      thursday: { bookingCount: Number, averageTime: String },
      friday: { bookingCount: Number, averageTime: String },
      saturday: { bookingCount: Number, averageTime: String },
      sunday: { bookingCount: Number, averageTime: String }
    }
  },
  locationPreferences: {
    preferredRadius: {
      type: Number,
      default: 1000 // meters
    },
    walkingTimeTolerance: {
      type: Number,
      default: 10 // minutes
    },
    homeLocation: {
      type: {
        type: String,
        enum: ['Point'],
        default: 'Point'
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0]
      }
    },
    workLocation: {
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
  aiMetrics: {
    totalBookings: {
      type: Number,
      default: 0
    },
    successfulBookings: {
      type: Number,
      default: 0
    },
    cancelledBookings: {
      type: Number,
      default: 0
    },
    averageRating: {
      type: Number,
      default: 5.0
    },
    loyaltyScore: {
      type: Number,
      default: 0 // 0-100
    },
    predictabilityScore: {
      type: Number,
      default: 0 // 0-100, how predictable user's patterns are
    }
  },
  lastAnalyzed: {
    type: Date,
    default: Date.now
  },
  dataQuality: {
    score: {
      type: Number,
      default: 0 // 0-100
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    sampleSize: {
      type: Number,
      default: 0
    }
  }
}, {
  timestamps: true
});

// Create geospatial indexes for location queries
userBehaviorSchema.index({ 'locationPreferences.homeLocation': '2dsphere' });
userBehaviorSchema.index({ 'locationPreferences.workLocation': '2dsphere' });

// Create indexes for efficient queries
// userBehaviorSchema.index({ userId: 1 }); // Removed - already unique in schema
userBehaviorSchema.index({ lastAnalyzed: 1 });
userBehaviorSchema.index({ 'aiMetrics.loyaltyScore': -1 });

// Instance methods
userBehaviorSchema.methods.updateFromBooking = function(booking) {
  // Update patterns based on new booking data
  this.bookingPatterns.totalBookings = (this.bookingPatterns.totalBookings || 0) + 1;

  // Update preferred times based on booking time
  const bookingHour = new Date(booking.startTime).getHours();
  let timeSlot;
  if (bookingHour < 6) timeSlot = 'night';
  else if (bookingHour < 12) timeSlot = 'morning';
  else if (bookingHour < 18) timeSlot = 'afternoon';
  else timeSlot = 'evening';

  if (!this.bookingPatterns.preferredTimes.includes(timeSlot)) {
    this.bookingPatterns.preferredTimes.push(timeSlot);
  }

  // Update price range
  if (booking.totalAmount) {
    this.bookingPatterns.priceRange.min = Math.min(
      this.bookingPatterns.priceRange.min,
      booking.totalAmount
    );
    this.bookingPatterns.priceRange.max = Math.max(
      this.bookingPatterns.priceRange.max,
      booking.totalAmount
    );

    // Recalculate average
    const currentAvg = this.bookingPatterns.priceRange.average;
    const newAvg = ((currentAvg * (this.aiMetrics.totalBookings - 1)) + booking.totalAmount) / this.aiMetrics.totalBookings;
    this.bookingPatterns.priceRange.average = Math.round(newAvg);
  }

  this.lastAnalyzed = new Date();
  return this.save();
};

userBehaviorSchema.methods.calculateLoyaltyScore = function() {
  const totalBookings = this.aiMetrics.totalBookings;
  const successfulBookings = this.aiMetrics.successfulBookings;
  const avgRating = this.aiMetrics.averageRating;

  if (totalBookings === 0) return 0;

  const completionRate = successfulBookings / totalBookings;
  const ratingNormalized = avgRating / 5.0;
  const frequencyBonus = Math.min(totalBookings / 10, 1); // Cap at 10 bookings

  const loyaltyScore = Math.round(
    (completionRate * 0.4 + ratingNormalized * 0.4 + frequencyBonus * 0.2) * 100
  );

  this.aiMetrics.loyaltyScore = loyaltyScore;
  return loyaltyScore;
};

// Static methods
userBehaviorSchema.statics.findOrCreateForUser = async function(userId) {
  let behavior = await this.findOne({ userId });

  if (!behavior) {
    behavior = new this({ userId });
    await behavior.save();
  }

  return behavior;
};

userBehaviorSchema.statics.updateFromBookingData = async function(userId, bookingData) {
  const behavior = await this.findOrCreateForUser(userId);
  return behavior.updateFromBooking(bookingData);
};

module.exports = mongoose.model('UserBehavior', userBehaviorSchema);