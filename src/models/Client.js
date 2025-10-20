const mongoose = require('mongoose');
const BaseUser = require('./BaseUser');

// Client-specific schema extending BaseUser
const clientSchema = new mongoose.Schema({
  // Client-specific fields
  preferredUniversities: [{
    type: String
  }],
  
  vehicleType: {
    type: String,
    enum: ['motorcycle', 'car', 'both'],
    default: 'car'
  },

  // Client-specific stats
  totalBookings: {
    type: Number,
    default: 0
  },

  totalAmountSpent: {
    type: Number,
    default: 0.00,
    min: 0
  },

  favoriteSpaces: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ParkingSpace'
  }],

  // Client preferences
  preferences: {
    autoAcceptBookings: {
      type: Boolean,
      default: false
    },
    preferredPaymentMethod: {
      type: String,
      enum: ['wallet', 'gcash', 'paymaya', 'card'],
      default: 'wallet'
    },
    maxWalkingDistance: {
      type: Number,
      default: 500, // meters
      min: 0
    },
    reminderMinutes: {
      type: Number,
      default: 15,
      min: 0
    }
  },

  // Emergency contact
  emergencyContact: {
    name: String,
    phoneNumber: String,
    relationship: String
  },

  // Student information (optional)
  studentInfo: {
    studentId: String,
    university: String,
    course: String,
    yearLevel: {
      type: String,
      enum: ['1st', '2nd', '3rd', '4th', '5th', 'graduate']
    }
  }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for client-specific queries
clientSchema.index({ totalBookings: -1 });
clientSchema.index({ totalAmountSpent: -1 });
clientSchema.index({ 'studentInfo.university': 1 });
clientSchema.index({ 'preferences.preferredPaymentMethod': 1 });

// Virtual for loyalty tier based on total bookings
clientSchema.virtual('loyaltyTier').get(function() {
  if (this.totalBookings >= 100) return 'platinum';
  if (this.totalBookings >= 50) return 'gold';
  if (this.totalBookings >= 20) return 'silver';
  if (this.totalBookings >= 5) return 'bronze';
  return 'starter';
});

// Instance method to add favorite space
clientSchema.methods.addFavoriteSpace = function(spaceId) {
  if (!this.favoriteSpaces.includes(spaceId)) {
    this.favoriteSpaces.push(spaceId);
    return this.save();
  }
  return Promise.resolve(this);
};

// Instance method to remove favorite space
clientSchema.methods.removeFavoriteSpace = function(spaceId) {
  this.favoriteSpaces = this.favoriteSpaces.filter(id => !id.equals(spaceId));
  return this.save();
};

// Instance method to update booking stats
clientSchema.methods.incrementBookingStats = function(amount) {
  this.totalBookings += 1;
  this.totalAmountSpent += amount;
  return this.save({ validateBeforeSave: false });
};

// Static method to find clients by university
clientSchema.statics.findByUniversity = function(university) {
  return this.find({ 
    'studentInfo.university': university,
    active: { $ne: false }
  });
};

// Static method to find top clients by spending
clientSchema.statics.findTopSpenders = function(limit = 10) {
  return this.find({ active: { $ne: false } })
    .sort({ totalAmountSpent: -1 })
    .limit(limit);
};

// Static method to find frequent clients
clientSchema.statics.findFrequentClients = function(minBookings = 5) {
  return this.find({ 
    totalBookings: { $gte: minBookings },
    active: { $ne: false }
  }).sort({ totalBookings: -1 });
};

// Create Client model as discriminator of BaseUser
const Client = BaseUser.discriminator('Client', clientSchema);

module.exports = Client;
