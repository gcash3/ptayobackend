const mongoose = require('mongoose');

const parkingSpaceSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Parking space name is required'],
    trim: true,
    maxlength: [100, 'Name cannot be more than 100 characters']
  },
  
  address: {
    type: String,
    required: [true, 'Address is required'],
    trim: true
  },
  
  location: {
    type: {
      type: String,
      enum: ['Point'],
      required: true
    },
    coordinates: {
      type: [Number], // [longitude, latitude]
      required: true,
      validate: {
        validator: function(val) {
          return val.length === 2;
        },
        message: 'Coordinates must be [longitude, latitude]'
      }
    }
  },
  
  // Separate latitude/longitude for easier frontend compatibility
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
  
  // Pricing (3-hour minimum baseline)
  pricePer3Hours: {
    type: Number,
    required: true,
    min: 0
  },

  // Auto-calculated overtime rate (per hour after 3 hours)
  overtimeRatePerHour: {
    type: Number,
    required: false, // Not required for backward compatibility
    min: 0,
    default: function() {
      return this.pricePer3Hours ? this.pricePer3Hours / 3 : 0;
    }
  },

  dailyRate: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Landlord who owns this space
  landlordId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Space details
  type: {
    type: String,
    enum: ['Open Lot', 'Covered Parking', 'Street Parking', 'Premium Parking', 'Empty Lot'],
    default: 'Open Lot'
  },
  
  amenities: [{
    type: String,
    enum: [
      'CCTV', 'Security Guard', '24/7 Access', 'Covered', 
      'Well-lit', 'Budget-friendly', 'Car Wash', 'Electric Charging'
    ]
  }],
  
  images: [{
    url: {
      type: String,
      required: true
    },
    thumbnailUrl: {
      type: String
    },
    publicId: {
      type: String // Cloudinary public ID for deletion
    },
    uploadedAt: {
      type: Date,
      default: Date.now
    },
    isMain: {
      type: Boolean,
      default: false
    }
  }],
  
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  
  // Availability
  totalSpots: {
    type: Number,
    required: true,
    min: 1
  },
  
  availableSpots: {
    type: Number,
    required: true,
    min: 0
  },
  
  // Status
  status: {
    type: String,
    enum: [
      'pending',     // Newly created by landlord, waiting for admin approval
      'active',      // Approved by admin, visible to customers
      'rejected',    // Rejected by admin, not visible to customers
      'inactive',    // Deactivated by landlord, not visible to customers  
      'maintenance', // Under maintenance, not bookable
      'suspended'    // Suspended by admin for violations
    ],
    default: 'pending',
    required: true
  },
  
  // Admin approval tracking
  adminApproval: {
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected'],
      default: 'pending'
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function() { return this.adminApproval.status === 'approved'; }
    },
    approvedAt: {
      type: Date,
      required: function() { return this.adminApproval.status === 'approved'; }
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: function() { return this.adminApproval.status === 'rejected'; }
    },
    rejectedAt: {
      type: Date,
      required: function() { return this.adminApproval.status === 'rejected'; }
    },
    rejectionReason: {
      type: String,
      required: function() { return this.adminApproval.status === 'rejected'; }
    },
    adminNotes: String
  },
  
  // Vehicle types accepted
  vehicleTypes: [{
    type: String,
    enum: ['motorcycle', 'car'],
    default: ['motorcycle', 'car']
  }],
  
  // Operating hours
  operatingHours: {
    isOpen24_7: {
      type: Boolean,
      default: true
    },
    schedule: {
      monday: { open: String, close: String },
      tuesday: { open: String, close: String },
      wednesday: { open: String, close: String },
      thursday: { open: String, close: String },
      friday: { open: String, close: String },
      saturday: { open: String, close: String },
      sunday: { open: String, close: String }
    }
  },
  
  // Ratings and reviews
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  
  totalRatings: {
    type: Number,
    default: 0
  },
  
  totalReviews: {
    type: Number,
    default: 0
  },
  
  ratingBreakdown: {
    fiveStars: { type: Number, default: 0 },
    fourStars: { type: Number, default: 0 },
    threeStars: { type: Number, default: 0 },
    twoStars: { type: Number, default: 0 },
    oneStar: { type: Number, default: 0 }
  },
  
  aspectRatings: {
    cleanliness: { type: Number, default: 0, min: 0, max: 5 },
    security: { type: Number, default: 0, min: 0, max: 5 },
    accessibility: { type: Number, default: 0, min: 0, max: 5 },
    valueForMoney: { type: Number, default: 0, min: 0, max: 5 }
  },
  
  // Verification
  isVerified: {
    type: Boolean,
    default: false
  },
  
  verifiedAt: Date,
  verifiedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  
  // Booking settings
  bookingSettings: {
    minBookingHours: {
      type: Number,
      default: 1
    },
    maxBookingDays: {
      type: Number,
      default: 30
    },
    instantBooking: {
      type: Boolean,
      default: true
    },
    requiresApproval: {
      type: Boolean,
      default: false
    }
  },
  
  // Auto-accept settings
  autoAccept: {
    type: Boolean,
    default: false
  },
  
  // Alternative naming for consistency with booking controller
  totalSlots: {
    type: Number,
    virtual: true,
    get: function() {
      return this.totalSpots;
    }
  },
  
  // Pricing virtual for booking controller compatibility
  pricing: {
    type: Object,
    virtual: true,
    get: function() {
      return {
        per3Hours: this.pricePer3Hours,
        hourlyRate: this.pricePer3Hours / 3, // For backward compatibility
        dailyRate: this.dailyRate
      };
    }
  },
  
  // Location metadata
  nearbyUniversities: [{
    name: String,
    distance: Number // in kilometers
  }],

  nearbyLandmarks: [{
    name: String,
    distance: Number
  }],

  // AI Metrics for Smart Recommendations
  aiMetrics: {
    popularityScore: {
      type: Number,
      default: 50, // 0-100
      min: 0,
      max: 100
    },
    averageOccupancy: {
      type: Number,
      default: 0.6, // 0-1 (60% occupancy)
      min: 0,
      max: 100 // Allow percentage values (will be normalized by pre-save hook)
    },
    peakHours: [{
      day: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },
      startHour: {
        type: Number,
        min: 0,
        max: 23
      },
      endHour: {
        type: Number,
        min: 0,
        max: 23
      },
      occupancyRate: {
        type: Number,
        min: 0,
        max: 1
      }
    }],
    weatherSensitivity: {
      type: Number,
      default: 0.1, // 0-1, how much weather affects demand
      min: 0,
      max: 1
    },
    userRatingTrend: {
      type: Number,
      default: 0, // -1 to 1, negative means declining ratings
      min: -1,
      max: 1
    },
    bookingFrequency: {
      daily: { type: Number, default: 0 },
      weekly: { type: Number, default: 0 },
      monthly: { type: Number, default: 0 }
    },
    loyalCustomers: {
      type: Number,
      default: 0 // Count of users who booked 3+ times
    },
    averageBookingDuration: {
      type: Number,
      default: 3 // hours
    },
    priceElasticity: {
      type: Number,
      default: 0.5, // 0-1, how sensitive demand is to price changes
      min: 0,
      max: 1
    },
    competitiveIndex: {
      type: Number,
      default: 0.5, // 0-1, compared to nearby parking spaces
      min: 0,
      max: 1
    },
    lastAnalyzed: {
      type: Date,
      default: Date.now
    }
  },

  // Real-time Data for Dynamic Recommendations
  realTimeData: {
    currentOccupancy: {
      type: Number,
      default: function() {
        return Math.max(0, this.totalSpots - this.availableSpots);
      }
    },
    lastUpdated: {
      type: Date,
      default: Date.now
    },
    estimatedAvailability: {
      nextHour: { type: Number, default: 0 },
      next2Hours: { type: Number, default: 0 },
      next4Hours: { type: Number, default: 0 },
      calculatedAt: { type: Date, default: Date.now }
    },
    dynamicPricing: {
      currentMultiplier: {
        type: Number,
        default: 1.0, // 1.0 = normal price
        min: 0.5,
        max: 3.0
      },
      reason: {
        type: String,
        enum: ['normal', 'high-demand', 'low-demand', 'weather', 'event', 'peak-hours'],
        default: 'normal'
      },
      validUntil: Date,
      basePrice: {
        type: Number,
        default: function() {
          return this.pricePer3Hours;
        }
      }
    },
    weatherImpact: {
      currentWeather: String, // 'sunny', 'rainy', 'stormy'
      demandMultiplier: {
        type: Number,
        default: 1.0
      },
      lastChecked: {
        type: Date,
        default: Date.now
      }
    },
    nearbyEvents: [{
      eventName: String,
      startTime: Date,
      endTime: Date,
      impactLevel: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'low'
      },
      demandIncrease: {
        type: Number,
        default: 1.0
      }
    }],
    trafficConditions: {
      level: {
        type: String,
        enum: ['light', 'moderate', 'heavy', 'congested'],
        default: 'moderate'
      },
      accessibilityScore: {
        type: Number,
        default: 0.8, // 0-1
        min: 0,
        max: 1
      },
      lastUpdated: {
        type: Date,
        default: Date.now
      }
    }
  },

  // Bookmark tracking for popularity metrics
  bookmarkStats: {
    totalBookmarks: {
      type: Number,
      default: 0
    },
    bookmarksThisMonth: {
      type: Number,
      default: 0
    },
    lastBookmarkAt: Date,
    popularTags: [{
      tag: String,
      count: Number
    }]
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance - avoiding duplicate 2dsphere index
parkingSpaceSchema.index({ landlordId: 1 });
parkingSpaceSchema.index({ status: 1 });
parkingSpaceSchema.index({ averageRating: -1 });
parkingSpaceSchema.index({ pricePer3Hours: 1 });
parkingSpaceSchema.index({ createdAt: -1 });

// AI-specific indexes for faster recommendations
parkingSpaceSchema.index({ 'aiMetrics.popularityScore': -1 });
parkingSpaceSchema.index({ 'aiMetrics.averageOccupancy': 1 });
parkingSpaceSchema.index({ 'aiMetrics.lastAnalyzed': 1 });
parkingSpaceSchema.index({ 'realTimeData.lastUpdated': 1 });
parkingSpaceSchema.index({ 'bookmarkStats.totalBookmarks': -1 });

// Compound indexes (includes the main 2dsphere index)
parkingSpaceSchema.index({ status: 1, isVerified: 1 });
parkingSpaceSchema.index({ 'location': '2dsphere', 'status': 1 }); // Primary geospatial index
parkingSpaceSchema.index({ status: 1, availableSpots: 1, 'aiMetrics.popularityScore': -1 }); // For AI recommendations

// Virtual for bookings
parkingSpaceSchema.virtual('bookings', {
  ref: 'Booking',
  localField: '_id',
  foreignField: 'parkingSpaceId'
});

// Virtual for reviews
parkingSpaceSchema.virtual('reviews', {
  ref: 'Review',
  localField: '_id',
  foreignField: 'parkingSpaceId'
});

// Virtual for landlord details
parkingSpaceSchema.virtual('landlord', {
  ref: 'User',
  localField: 'landlordId',
  foreignField: '_id',
  justOne: true
});

// Pre-save middleware to sync coordinates
parkingSpaceSchema.pre('save', function(next) {
  if (this.latitude && this.longitude) {
    this.location = {
      type: 'Point',
      coordinates: [this.longitude, this.latitude]
    };
  }
  next();
});

// Pre-save middleware to calculate available spots
parkingSpaceSchema.pre('save', function(next) {
  if (this.availableSpots > this.totalSpots) {
    this.availableSpots = this.totalSpots;
  }
  next();
});

// Pre-save middleware to sync status with adminApproval
parkingSpaceSchema.pre('save', function(next) {
  // Auto-sync main status with admin approval status
  if (this.adminApproval.status === 'approved' && this.status === 'pending') {
    this.status = 'active';
  } else if (this.adminApproval.status === 'rejected' && this.status === 'pending') {
    this.status = 'rejected';
  }

  next();
});

// Pre-save middleware to fix aiMetrics.averageOccupancy format
parkingSpaceSchema.pre('save', function(next) {
  // Fix averageOccupancy if it's stored as percentage instead of decimal
  if (this.aiMetrics && this.aiMetrics.averageOccupancy > 1) {
    this.aiMetrics.averageOccupancy = this.aiMetrics.averageOccupancy / 100;
    console.log(`🔧 Fixed averageOccupancy for ${this.name}: ${this.aiMetrics.averageOccupancy * 100}% -> ${this.aiMetrics.averageOccupancy}`);
  }

  next();
});

// Static method to find nearby parking spaces (enhanced with time filtering)
parkingSpaceSchema.statics.findNearby = function(longitude, latitude, radiusInKm = 5, options = {}) {
  const { checkTime, includeTimeFilter = true, ...otherOptions } = options;

  const query = {
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: radiusInKm * 1000 // Convert km to meters
      }
    },
    status: 'active',
    isVerified: true,
    availableSpots: { $gt: 0 },
    ...otherOptions
  };

  // Add time-based filtering if requested
  if (includeTimeFilter) {
    const timeFilter = timeValidationUtils.generateTimeBasedFilter(checkTime);
    query.$and = query.$and || [];
    query.$and.push(timeFilter);
  }

  return this.find(query);
};

// Static method to find spaces available at specific time
parkingSpaceSchema.statics.findAvailableAt = function(checkTime = null, additionalQuery = {}) {
  const timeFilter = timeValidationUtils.generateTimeBasedFilter(checkTime);

  const query = {
    status: 'active',
    isVerified: true,
    availableSpots: { $gt: 0 },
    ...additionalQuery,
    ...timeFilter
  };

  return this.find(query);
};

// Static method to search parking spaces
parkingSpaceSchema.statics.searchSpaces = function(searchTerm, latitude, longitude) {
  const searchRegex = new RegExp(searchTerm, 'i');
  
  const query = {
    $or: [
      { name: searchRegex },
      { address: searchRegex },
      { description: searchRegex },
      { 'nearbyUniversities.name': searchRegex }
    ],
    status: 'active',
    isVerified: true
  };
  
  if (latitude && longitude) {
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: 10000 // 10km
      }
    };
  }
  
  return this.find(query);
};

// Static method to find universities nearby
parkingSpaceSchema.statics.findUniversitiesNearby = async function(longitude, latitude, radiusKm) {
  return this.aggregate([
    {
      $geoNear: {
        near: { type: 'Point', coordinates: [longitude, latitude] },
        distanceField: 'distance',
        maxDistance: radiusKm * 1000, // Convert km to meters
        spherical: true,
        query: { status: 'active' } // Only show approved/active spaces
      }
    },
    { $unwind: '$nearbyUniversities' },
    {
      $group: {
        _id: '$nearbyUniversities.name',
        university: { $first: '$nearbyUniversities.name' },
        distance: { $min: '$distance' },
        parkingSpaces: { $sum: 1 }
      }
    },
    { $sort: { distance: 1 } }
  ]);
};

// Import time validation utilities
const timeValidationUtils = require('../utils/timeValidationUtils');

// Instance method to check availability (enhanced with time validation)
parkingSpaceSchema.methods.isAvailable = function(startTime, endTime) {
  // Basic availability checks
  if (this.availableSpots <= 0 || this.status !== 'active') {
    return false;
  }

  // If no time specified, just check basic availability
  if (!startTime) {
    return true;
  }

  // Check time-based availability
  const timeValidation = this.isOpenAt(startTime);
  return timeValidation.isOpen;
};

// Instance method to check if space is open at specific time
parkingSpaceSchema.methods.isOpenAt = function(checkTime = null) {
  return timeValidationUtils.isSpaceOpenAt(this.operatingHours, checkTime);
};

// Instance method to validate booking time range
parkingSpaceSchema.methods.validateBookingTime = function(startTime, endTime) {
  return timeValidationUtils.validateBookingTimeRange(this.operatingHours, startTime, endTime);
};

// Instance method to get next opening time
parkingSpaceSchema.methods.getNextOpenTime = function(fromTime = null) {
  return timeValidationUtils.getNextOpenTime(this.operatingHours, fromTime || new Date());
};

// Instance method to get operating status with details
parkingSpaceSchema.methods.getOperatingStatus = function(checkTime = null) {
  const timeStatus = this.isOpenAt(checkTime);

  return {
    ...timeStatus,
    hasSchedule: !!(this.operatingHours && (this.operatingHours.isOpen24_7 || this.operatingHours.schedule)),
    is24_7: this.operatingHours?.isOpen24_7 === true,
    currentAvailability: {
      isActive: this.status === 'active',
      isVerified: this.isVerified,
      hasSpots: this.availableSpots > 0,
      availableSpots: this.availableSpots,
      totalSpots: this.totalSpots
    }
  };
};

// Instance method to update rating
parkingSpaceSchema.methods.updateRating = async function() {
  const Rating = mongoose.model('Rating');
  const stats = await Rating.aggregate([
    { 
      $match: { 
        parkingSpaceId: this._id,
        status: 'active'
      } 
    },
    {
      $group: {
        _id: '$parkingSpaceId',
        averageRating: { $avg: '$rating' },
        totalRatings: { $sum: 1 },
        totalReviews: { 
          $sum: { 
            $cond: [{ $ne: ['$review', ''] }, 1, 0] 
          } 
        },
        ratingDistribution: { $push: '$rating' },
        aspectStats: {
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
        totalReviews: 1,
        breakdown: {
          fiveStars: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $gte: ['$$this', 4.5] }
              }
            }
          },
          fourStars: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $and: [{ $gte: ['$$this', 3.5] }, { $lt: ['$$this', 4.5] }] }
              }
            }
          },
          threeStars: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $and: [{ $gte: ['$$this', 2.5] }, { $lt: ['$$this', 3.5] }] }
              }
            }
          },
          twoStars: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $and: [{ $gte: ['$$this', 1.5] }, { $lt: ['$$this', 2.5] }] }
              }
            }
          },
          oneStar: {
            $size: {
              $filter: {
                input: '$ratingDistribution',
                cond: { $lt: ['$$this', 1.5] }
              }
            }
          }
        },
        aspectAverages: {
          cleanliness: {
            $round: [{
              $avg: {
                $filter: {
                  input: '$aspectStats.cleanliness',
                  cond: { $ne: ['$$this', null] }
                }
              }
            }, 1]
          },
          security: {
            $round: [{
              $avg: {
                $filter: {
                  input: '$aspectStats.security',
                  cond: { $ne: ['$$this', null] }
                }
              }
            }, 1]
          },
          accessibility: {
            $round: [{
              $avg: {
                $filter: {
                  input: '$aspectStats.accessibility',
                  cond: { $ne: ['$$this', null] }
                }
              }
            }, 1]
          },
          valueForMoney: {
            $round: [{
              $avg: {
                $filter: {
                  input: '$aspectStats.valueForMoney',
                  cond: { $ne: ['$$this', null] }
                }
              }
            }, 1]
          }
        }
      }
    }
  ]);
  
  if (stats.length > 0) {
    const data = stats[0];
    this.averageRating = data.averageRating || 0;
    this.totalRatings = data.totalRatings || 0;
    this.totalReviews = data.totalReviews || 0;
    this.ratingBreakdown = data.breakdown || {
      fiveStars: 0, fourStars: 0, threeStars: 0, twoStars: 0, oneStar: 0
    };
    this.aspectRatings = data.aspectAverages || {
      cleanliness: 0, security: 0, accessibility: 0, valueForMoney: 0
    };
  } else {
    this.averageRating = 0;
    this.totalRatings = 0;
    this.totalReviews = 0;
    this.ratingBreakdown = {
      fiveStars: 0, fourStars: 0, threeStars: 0, twoStars: 0, oneStar: 0
    };
    this.aspectRatings = {
      cleanliness: 0, security: 0, accessibility: 0, valueForMoney: 0
    };
  }
  
  return this.save();
};

// Instance methods for approval workflow
parkingSpaceSchema.methods.approve = function(adminId, adminNotes = '') {
  this.adminApproval.status = 'approved';
  this.adminApproval.approvedBy = adminId;
  this.adminApproval.approvedAt = new Date();
  this.adminApproval.adminNotes = adminNotes;
  this.status = 'active';
  return this.save();
};

parkingSpaceSchema.methods.reject = function(adminId, rejectionReason, adminNotes = '') {
  this.adminApproval.status = 'rejected';
  this.adminApproval.rejectedBy = adminId;
  this.adminApproval.rejectedAt = new Date();
  this.adminApproval.rejectionReason = rejectionReason;
  this.adminApproval.adminNotes = adminNotes;
  this.status = 'rejected';
  return this.save();
};

parkingSpaceSchema.methods.suspend = function(adminId, reason) {
  this.status = 'suspended';
  this.adminApproval.adminNotes = `Suspended: ${reason}`;
  return this.save();
};

parkingSpaceSchema.methods.reactivate = function() {
  if (this.adminApproval.status === 'approved') {
    this.status = 'active';
  }
  return this.save();
};

// Virtual for checking if space is customer-visible
parkingSpaceSchema.virtual('isCustomerVisible').get(function() {
  return this.status === 'active' && this.isVerified;
});

// Static method to get spaces by status for admin
parkingSpaceSchema.statics.findByAdminStatus = function(adminStatus) {
  return this.find({ 'adminApproval.status': adminStatus })
    .populate('landlord', 'firstName lastName email phoneNumber')
    .sort({ createdAt: -1 });
};

// Static method for customer-facing searches (only approved spaces)
parkingSpaceSchema.statics.findCustomerSpaces = function(query = {}) {
  const customerQuery = {
    ...query,
    status: 'active',
    isVerified: true
  };
  return this.find(customerQuery);
};

// AI-specific instance methods
parkingSpaceSchema.methods.updateAIMetrics = function(bookingData) {
  // Update popularity score based on recent bookings
  const bookingCount = bookingData.totalBookings || 0;
  const rating = this.averageRating || 0;

  // Calculate popularity score (0-100)
  const popularityBase = Math.min(bookingCount * 2, 80); // Max 80 from bookings
  const ratingBonus = (rating / 5) * 20; // Max 20 from ratings
  this.aiMetrics.popularityScore = Math.min(popularityBase + ratingBonus, 100);

  // Update booking frequency
  if (bookingData) {
    this.aiMetrics.bookingFrequency.daily = bookingData.dailyAverage || 0;
    this.aiMetrics.bookingFrequency.weekly = bookingData.weeklyAverage || 0;
    this.aiMetrics.bookingFrequency.monthly = bookingData.monthlyTotal || 0;
  }

  this.aiMetrics.lastAnalyzed = new Date();
  return this.save();
};

parkingSpaceSchema.methods.updateRealTimeData = function(realtimeInfo = {}) {
  const {
    occupancy,
    weather,
    traffic,
    events,
    availabilityForecast
  } = realtimeInfo;

  if (occupancy !== undefined) {
    this.realTimeData.currentOccupancy = occupancy;
  }

  if (weather) {
    this.realTimeData.weatherImpact.currentWeather = weather.condition;
    this.realTimeData.weatherImpact.demandMultiplier = weather.demandMultiplier || 1.0;
    this.realTimeData.weatherImpact.lastChecked = new Date();
  }

  if (traffic) {
    this.realTimeData.trafficConditions.level = traffic.level;
    this.realTimeData.trafficConditions.accessibilityScore = traffic.accessibilityScore || 0.8;
    this.realTimeData.trafficConditions.lastUpdated = new Date();
  }

  if (events && events.length > 0) {
    this.realTimeData.nearbyEvents = events;
  }

  if (availabilityForecast) {
    this.realTimeData.estimatedAvailability = {
      ...availabilityForecast,
      calculatedAt: new Date()
    };
  }

  this.realTimeData.lastUpdated = new Date();
  return this.save();
};

parkingSpaceSchema.methods.calculateDynamicPrice = function() {
  let multiplier = 1.0;
  let reason = 'normal';

  // Factor 1: Current occupancy
  const occupancyRate = this.realTimeData.currentOccupancy / this.totalSpots;
  if (occupancyRate > 0.8) {
    multiplier *= 1.3; // 30% increase for high occupancy
    reason = 'high-demand';
  } else if (occupancyRate < 0.3) {
    multiplier *= 0.8; // 20% discount for low occupancy
    reason = 'low-demand';
  }

  // Factor 2: Weather impact
  const weatherMultiplier = this.realTimeData.weatherImpact.demandMultiplier || 1.0;
  if (weatherMultiplier > 1.2) {
    multiplier *= weatherMultiplier;
    reason = 'weather';
  }

  // Factor 3: Nearby events
  const activeEvents = this.realTimeData.nearbyEvents.filter(event =>
    new Date() >= new Date(event.startTime) && new Date() <= new Date(event.endTime)
  );

  if (activeEvents.length > 0) {
    const eventMultiplier = Math.max(...activeEvents.map(e => e.demandIncrease));
    if (eventMultiplier > 1.1) {
      multiplier *= eventMultiplier;
      reason = 'event';
    }
  }

  // Factor 4: Peak hours
  const currentHour = new Date().getHours();
  const currentDay = new Date().toLocaleDateString('en', { weekday: 'long' }).toLowerCase();
  const peakHour = this.aiMetrics.peakHours.find(peak =>
    peak.day === currentDay &&
    currentHour >= peak.startHour &&
    currentHour <= peak.endHour
  );

  if (peakHour && peakHour.occupancyRate > 0.7) {
    multiplier *= 1.2;
    reason = 'peak-hours';
  }

  // Apply bounds
  multiplier = Math.max(0.5, Math.min(3.0, multiplier));

  this.realTimeData.dynamicPricing = {
    currentMultiplier: multiplier,
    reason,
    validUntil: new Date(Date.now() + 60 * 60 * 1000), // Valid for 1 hour
    basePrice: this.pricePer3Hours
  };

  return this.save();
};

// AI-specific static methods
parkingSpaceSchema.statics.findForAIRecommendation = function(userLocation, radiusKm = 5, limit = 50) {
  return this.find({
    status: 'active',
    isVerified: true,
    availableSpots: { $gt: 0 },
    location: {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [userLocation.longitude, userLocation.latitude]
        },
        $maxDistance: radiusKm * 1000
      }
    }
  })
  .select('+aiMetrics +realTimeData +bookmarkStats')
  .limit(limit)
  .lean();
};

parkingSpaceSchema.statics.getPopularSpaces = function(limit = 10) {
  return this.find({
    status: 'active',
    isVerified: true,
    'aiMetrics.popularityScore': { $gte: 70 }
  })
  .sort({ 'aiMetrics.popularityScore': -1, 'bookmarkStats.totalBookmarks': -1 })
  .limit(limit);
};

parkingSpaceSchema.statics.updateBookmarkStats = async function(parkingSpaceId, action, tags = []) {
  const updateData = {};

  if (action === 'add') {
    updateData.$inc = {
      'bookmarkStats.totalBookmarks': 1,
      'bookmarkStats.bookmarksThisMonth': 1
    };
    updateData.$set = {
      'bookmarkStats.lastBookmarkAt': new Date()
    };

    // Update popular tags
    if (tags.length > 0) {
      const space = await this.findById(parkingSpaceId);
      if (space) {
        const popularTags = [...space.bookmarkStats.popularTags];

        tags.forEach(tag => {
          const existingTag = popularTags.find(t => t.tag === tag);
          if (existingTag) {
            existingTag.count += 1;
          } else {
            popularTags.push({ tag, count: 1 });
          }
        });

        // Keep only top 5 tags
        updateData.$set['bookmarkStats.popularTags'] = popularTags
          .sort((a, b) => b.count - a.count)
          .slice(0, 5);
      }
    }
  } else if (action === 'remove') {
    updateData.$inc = {
      'bookmarkStats.totalBookmarks': -1,
      'bookmarkStats.bookmarksThisMonth': -1
    };
  }

  return this.findByIdAndUpdate(parkingSpaceId, updateData, { new: true });
};

const ParkingSpace = mongoose.model('ParkingSpace', parkingSpaceSchema);

module.exports = ParkingSpace; 