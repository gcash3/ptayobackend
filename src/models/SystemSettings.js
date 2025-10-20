const mongoose = require('mongoose');

const systemSettingsSchema = new mongoose.Schema({
  settingsType: {
    type: String,
    required: true,
    enum: ['General', 'Security', 'Notification', 'Payment', 'API', 'AppVersion', 'Maintenance'],
    unique: true
  },

  settings: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
    default: {}
  },

  lastUpdatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },

  version: {
    type: Number,
    default: 1
  }
}, {
  timestamps: true
});

// Index for faster lookups
// systemSettingsSchema.index({ settingsType: 1 }); // Removed - already unique in schema

// Static method to get settings by type
systemSettingsSchema.statics.getSettingsByType = async function(settingsType) {
  const settings = await this.findOne({ settingsType });
  return settings ? settings.settings : null;
};

// Static method to update settings
systemSettingsSchema.statics.updateSettings = async function(settingsType, newSettings, updatedBy = null) {
  const result = await this.findOneAndUpdate(
    { settingsType },
    {
      settings: newSettings,
      lastUpdatedBy: updatedBy,
      $inc: { version: 1 }
    },
    {
      new: true,
      upsert: true,
      runValidators: true
    }
  );
  return result;
};

// Method to get all settings
systemSettingsSchema.statics.getAllSettings = async function() {
  const settings = await this.find({});
  const result = {};

  settings.forEach(setting => {
    result[setting.settingsType] = setting.settings;
  });

  return result;
};

const SystemSettings = mongoose.model('SystemSettings', systemSettingsSchema);

module.exports = SystemSettings;