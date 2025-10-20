const mongoose = require('mongoose');

const dynamicPricingConfigSchema = new mongoose.Schema({
  // Unique identifier for the configuration
  configId: {
    type: String,
    unique: true,
    default: 'default_pricing_config'
  },

  // Platform fees
  platformCommission: {
    type: Number,
    default: 0.10, // 10% commission
    min: 0,
    max: 1,
    required: true
  },

  serviceFee: {
    type: Number,
    default: 5.00, // Fixed service fee in PHP
    min: 0,
    required: true
  },

  // Peak hours configuration
  peakHours: [{
    start: {
      type: Number,
      min: 0,
      max: 23,
      required: true
    },
    end: {
      type: Number,
      min: 0,
      max: 23,
      required: true
    },
    description: {
      type: String,
      default: ''
    }
  }],

  // Dynamic pricing multipliers
  peakHourMultiplier: {
    type: Number,
    default: 1.25, // +25% during peak hours
    min: 1.0,
    max: 3.0,
    required: true
  },

  offPeakMultiplier: {
    type: Number,
    default: 0.85, // -15% during off-peak hours
    min: 0.5,
    max: 1.0,
    required: true
  },

  // Occupancy-based pricing
  highOccupancyThreshold: {
    type: Number,
    default: 0.80, // 80% occupancy
    min: 0.5,
    max: 1.0,
    required: true
  },

  lowOccupancyThreshold: {
    type: Number,
    default: 0.40, // 40% occupancy
    min: 0.1,
    max: 0.5,
    required: true
  },

  highOccupancyMultiplier: {
    type: Number,
    default: 1.20, // +20% when >80% occupied
    min: 1.0,
    max: 2.0,
    required: true
  },

  lowOccupancyMultiplier: {
    type: Number,
    default: 0.90, // -10% when <40% occupied
    min: 0.5,
    max: 1.0,
    required: true
  },

  // Special day multipliers
  weekendMultiplier: {
    type: Number,
    default: 1.15, // +15% on weekends
    min: 1.0,
    max: 2.0,
    required: true
  },

  holidayMultiplier: {
    type: Number,
    default: 1.30, // +30% on holidays
    min: 1.0,
    max: 2.0,
    required: true
  },

  // Minimum rates
  minimumHourlyRate: {
    type: Number,
    default: 15.00, // PHP 15 minimum per hour
    min: 5.0,
    max: 50.0,
    required: true
  },

  // Base overtime pricing
  baseOvertimeRate: {
    type: Number,
    default: 15.00, // PHP 15 per hour base overtime
    min: 5.0,
    max: 100.0,
    required: true
  },

  // Admin controls
  isDynamicPricingEnabled: {
    type: Boolean,
    default: true
  },

  isOccupancyBasedPricingEnabled: {
    type: Boolean,
    default: true
  },

  isPeakHourPricingEnabled: {
    type: Boolean,
    default: true
  },

  isWeekendPricingEnabled: {
    type: Boolean,
    default: true
  },

  // Holiday configuration
  holidays: [{
    date: {
      type: Date,
      required: true
    },
    name: {
      type: String,
      required: true
    },
    multiplier: {
      type: Number,
      default: 1.30,
      min: 1.0,
      max: 2.0
    },
    isRecurring: {
      type: Boolean,
      default: false
    }
  }],

  // Advanced settings
  maxPriceMultiplier: {
    type: Number,
    default: 2.0, // Maximum total multiplier (200% of base price)
    min: 1.0,
    max: 5.0,
    required: true
  },

  minPriceMultiplier: {
    type: Number,
    default: 0.7, // Minimum total multiplier (70% of base price)
    min: 0.3,
    max: 1.0,
    required: true
  },

  // Regional settings
  currency: {
    type: String,
    default: 'PHP',
    enum: ['PHP', 'USD', 'EUR']
  },

  timezone: {
    type: String,
    default: 'Asia/Manila'
  },

  // Audit fields
  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },

  lastUpdatedAt: {
    type: Date,
    default: Date.now
  },

  version: {
    type: Number,
    default: 1
  },

  // Backup of previous configuration
  previousConfig: {
    type: mongoose.Schema.Types.Mixed
  },

  notes: {
    type: String,
    maxlength: 500
  }

}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Validation middleware
dynamicPricingConfigSchema.pre('save', function(next) {
  // Ensure low occupancy threshold is less than high occupancy threshold
  if (this.lowOccupancyThreshold >= this.highOccupancyThreshold) {
    next(new Error('Low occupancy threshold must be less than high occupancy threshold'));
    return;
  }

  // Ensure min price multiplier is less than max price multiplier
  if (this.minPriceMultiplier >= this.maxPriceMultiplier) {
    next(new Error('Minimum price multiplier must be less than maximum price multiplier'));
    return;
  }

  // Store previous configuration for backup
  if (this.isModified() && !this.isNew) {
    this.previousConfig = this.toObject();
    this.version += 1;
    this.lastUpdatedAt = new Date();
  }

  next();
});

// Static method to get current configuration
dynamicPricingConfigSchema.statics.getCurrentConfig = async function() {
  let config = await this.findOne({ configId: 'default_pricing_config' });

  if (!config) {
    // Create default configuration if it doesn't exist
    config = await this.create({
      configId: 'default_pricing_config',
      peakHours: [
        { start: 7, end: 10, description: 'Morning rush hour' },
        { start: 16, end: 19, description: 'Evening rush hour' }
      ]
    });
  }

  return config;
};

// Instance method to apply configuration to pricing service
dynamicPricingConfigSchema.methods.applyToPricingService = function() {
  const pricingService = require('../services/newDynamicPricingService');

  pricingService.updateConfiguration({
    platformCommission: this.platformCommission,
    serviceFee: this.serviceFee,
    peakHours: this.peakHours,
    peakHourMultiplier: this.peakHourMultiplier,
    offPeakMultiplier: this.offPeakMultiplier,
    highOccupancyThreshold: this.highOccupancyThreshold,
    lowOccupancyThreshold: this.lowOccupancyThreshold,
    highOccupancyMultiplier: this.highOccupancyMultiplier,
    lowOccupancyMultiplier: this.lowOccupancyMultiplier,
    weekendMultiplier: this.weekendMultiplier,
    holidayMultiplier: this.holidayMultiplier,
    minimumHourlyRate: this.minimumHourlyRate,
    baseOvertimeRate: this.baseOvertimeRate,
    maxPriceMultiplier: this.maxPriceMultiplier,
    minPriceMultiplier: this.minPriceMultiplier,
    isDynamicPricingEnabled: this.isDynamicPricingEnabled,
    isOccupancyBasedPricingEnabled: this.isOccupancyBasedPricingEnabled,
    isPeakHourPricingEnabled: this.isPeakHourPricingEnabled,
    isWeekendPricingEnabled: this.isWeekendPricingEnabled,
    holidays: this.holidays
  });
};

// Virtual for total configuration score (for analytics)
dynamicPricingConfigSchema.virtual('configurationIntensity').get(function() {
  const factors = [
    this.peakHourMultiplier - 1,
    this.highOccupancyMultiplier - 1,
    this.weekendMultiplier - 1,
    this.holidayMultiplier - 1
  ];

  const totalIntensity = factors.reduce((sum, factor) => sum + factor, 0);
  return Math.round(totalIntensity * 100) / 100;
});

module.exports = mongoose.model('DynamicPricingConfig', dynamicPricingConfigSchema);