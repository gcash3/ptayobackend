const mongoose = require('mongoose');

const ratingSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },
  parkingSpaceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParkingSpace',
    required: true,
    index: true
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    required: true,
    unique: true // One rating per booking
  },
  rating: {
    type: Number,
    required: true,
    min: 1,
    max: 5,
    validate: {
      validator: function(v) {
        return Number.isInteger(v) || (v % 0.5 === 0); // Allow whole numbers or half stars
      },
      message: 'Rating must be between 1-5 in 0.5 increments'
    }
  },
  review: {
    type: String,
    maxlength: 500,
    trim: true
  },
  aspects: {
    cleanliness: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator: function(v) {
          return v === undefined || Number.isInteger(v) || (v % 0.5 === 0);
        }
      }
    },
    security: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator: function(v) {
          return v === undefined || Number.isInteger(v) || (v % 0.5 === 0);
        }
      }
    },
    accessibility: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator: function(v) {
          return v === undefined || Number.isInteger(v) || (v % 0.5 === 0);
        }
      }
    },
    valueForMoney: {
      type: Number,
      min: 1,
      max: 5,
      validate: {
        validator: function(v) {
          return v === undefined || Number.isInteger(v) || (v % 0.5 === 0);
        }
      }
    }
  },
  isAnonymous: {
    type: Boolean,
    default: false
  },
  isVerified: {
    type: Boolean,
    default: false // Set to true if booking was actually completed
  },
  helpfulVotes: {
    type: Number,
    default: 0
  },
  reportCount: {
    type: Number,
    default: 0
  },
  status: {
    type: String,
    enum: ['active', 'hidden', 'flagged'],
    default: 'active'
  },
  landlordResponse: {
    message: {
      type: String,
      maxlength: 300,
      trim: true
    },
    respondedAt: Date,
    respondedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    }
  }
}, {
  timestamps: true
});

// Compound indexes for efficient queries
ratingSchema.index({ parkingSpaceId: 1, createdAt: -1 });
ratingSchema.index({ userId: 1, parkingSpaceId: 1 });
// ratingSchema.index({ bookingId: 1 }, { unique: true }); // Removed - already unique in schema
ratingSchema.index({ status: 1, createdAt: -1 });

// Virtual for user details
ratingSchema.virtual('user', {
  ref: 'User',
  localField: 'userId',
  foreignField: '_id',
  justOne: true
});

// Virtual for parking space details
ratingSchema.virtual('parkingSpace', {
  ref: 'ParkingSpace',
  localField: 'parkingSpaceId',
  foreignField: '_id',
  justOne: true
});

// Virtual for booking details
ratingSchema.virtual('booking', {
  ref: 'Booking',
  localField: 'bookingId',
  foreignField: '_id',
  justOne: true
});

// Methods
ratingSchema.methods.toSafeObject = function(includeUser = false) {
  const obj = this.toObject();
  
  if (!includeUser || this.isAnonymous) {
    delete obj.userId;
    obj.user = this.isAnonymous ? { firstName: 'Anonymous', lastName: 'User' } : undefined;
  }
  
  delete obj.__v;
  return obj;
};

// Static methods
ratingSchema.statics.getAverageRating = async function(parkingSpaceId) {
  const result = await this.aggregate([
    {
      $match: {
        parkingSpaceId: new mongoose.Types.ObjectId(parkingSpaceId),
        status: 'active'
      }
    },
    {
      $group: {
        _id: null,
        averageRating: { $avg: '$rating' },
        totalRatings: { $sum: 1 },
        ratingDistribution: {
          $push: '$rating'
        },
        aspects: {
          $push: {
            cleanliness: '$aspects.cleanliness',
            security: '$aspects.security',
            accessibility: '$aspects.accessibility',
            valueForMoney: '$aspects.valueForMoney'
          }
        }
      }
    },
    {
      $project: {
        averageRating: { $round: ['$averageRating', 1] },
        totalRatings: 1,
        ratingDistribution: 1,
        averageAspects: {
          cleanliness: { 
            $round: [{ 
              $avg: { 
                $filter: { 
                  input: '$aspects.cleanliness', 
                  cond: { $ne: ['$$this', null] } 
                } 
              } 
            }, 1] 
          },
          security: { 
            $round: [{ 
              $avg: { 
                $filter: { 
                  input: '$aspects.security', 
                  cond: { $ne: ['$$this', null] } 
                } 
              } 
            }, 1] 
          },
          accessibility: { 
            $round: [{ 
              $avg: { 
                $filter: { 
                  input: '$aspects.accessibility', 
                  cond: { $ne: ['$$this', null] } 
                } 
              } 
            }, 1] 
          },
          valueForMoney: { 
            $round: [{ 
              $avg: { 
                $filter: { 
                  input: '$aspects.valueForMoney', 
                  cond: { $ne: ['$$this', null] } 
                } 
              } 
            }, 1] 
          }
        }
      }
    }
  ]);

  return result[0] || { 
    averageRating: 0, 
    totalRatings: 0, 
    ratingDistribution: [],
    averageAspects: {}
  };
};

ratingSchema.statics.canUserRate = async function(userId, parkingSpaceId, bookingId) {
  // Check if user has completed booking for this parking space
  const Booking = mongoose.model('Booking');
  const booking = await Booking.findOne({
    _id: bookingId,
    userId: userId,
    parkingSpaceId: parkingSpaceId,
    status: 'completed'
  });

  if (!booking) {
    return { canRate: false, reason: 'Booking not found or not completed' };
  }

  // Check if user already rated this booking
  const existingRating = await this.findOne({ bookingId: bookingId });
  if (existingRating) {
    return { canRate: false, reason: 'Already rated this booking' };
  }

  return { canRate: true, booking };
};

module.exports = mongoose.model('Rating', ratingSchema);
