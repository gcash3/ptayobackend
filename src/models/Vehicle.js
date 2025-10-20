const mongoose = require('mongoose');

const vehicleSchema = new mongoose.Schema({
  // User who owns the vehicle
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  // Vehicle identification
  plateNumber: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    unique: true
  },
  
  // Vehicle type (simplified)
  vehicleType: {
    type: String,
    enum: ['motorcycle', 'car'],
    required: true
  },
  
  // Vehicle details
  brand: {
    type: String,
    required: true,
    trim: true
  },
  
  model: {
    type: String,
    required: true,
    trim: true
  },
  
  color: {
    type: String,
    required: true,
    trim: true
  },
  
  // Year of manufacture
  year: {
    type: Number,
    min: 1900,
    max: new Date().getFullYear() + 1
  },
  
  // Vehicle status
  status: {
    type: String,
    enum: ['active', 'inactive'],
    default: 'active' // Vehicles are active and ready for booking upon registration
  },
  
  // Usage statistics
  totalBookings: {
    type: Number,
    default: 0
  },
  
  lastUsed: Date,
  
  // Default vehicle flag
  isDefault: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true,
  toJSON: { 
    virtuals: true,
    transform: function(doc, ret) {
      ret.id = ret._id;
      delete ret._id;
      delete ret.__v;
      return ret;
    }
  }
});

// Indexes
vehicleSchema.index({ userId: 1 });
// vehicleSchema.index({ plateNumber: 1 }, { unique: true }); // Removed - already unique in schema
vehicleSchema.index({ userId: 1, isDefault: 1 });

// Virtual for full vehicle name
vehicleSchema.virtual('fullName').get(function() {
  return `${this.brand} ${this.model} (${this.plateNumber})`;
});

// Ensure only one default vehicle per user per type
vehicleSchema.pre('save', async function(next) {
  if (this.isDefault && this.isModified('isDefault')) {
    // Remove default flag from other vehicles of the same type for this user
    await this.constructor.updateMany(
      { 
        userId: this.userId, 
        vehicleType: this.vehicleType, 
        _id: { $ne: this._id } 
      },
      { isDefault: false }
    );
  }
  next();
});

// Static method to get user's vehicles
vehicleSchema.statics.getUserVehicles = function(userId, vehicleType = null) {
  const query = { userId, status: 'active' }; // Only return active vehicles
  if (vehicleType) {
    query.vehicleType = vehicleType;
  }
  return this.find(query).sort({ isDefault: -1, createdAt: -1 });
};

// Static method to deactivate vehicle (replaces reject/verify system)
vehicleSchema.statics.deactivateVehicle = async function(vehicleId, reason = '') {
  const vehicle = await this.findById(vehicleId);
  if (!vehicle) {
    throw new Error('Vehicle not found');
  }
  
  vehicle.status = 'inactive';
  vehicle.deactivationReason = reason;
  
  return vehicle.save();
};

// Instance method to update usage stats
vehicleSchema.methods.recordUsage = function() {
  this.totalBookings += 1;
  this.lastUsed = new Date();
  return this.save();
};

const Vehicle = mongoose.model('Vehicle', vehicleSchema);

module.exports = Vehicle; 