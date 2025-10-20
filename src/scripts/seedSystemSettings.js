const mongoose = require('mongoose');
require('dotenv').config();
const SystemSettings = require('../models/SystemSettings');

const defaultSettings = {
  General: {
    siteName: 'ParkTayo Admin',
    siteUrl: 'https://admin.parktayo.com',
    maintenanceMode: false,
    registrationEnabled: true,
    emailVerificationRequired: true,
    autoApproveSpaces: false,
    maxBookingDuration: 24,
    defaultBookingDuration: 2,
    timezone: 'Asia/Manila'
  },

  Security: {
    passwordMinLength: 8,
    passwordRequireUppercase: true,
    passwordRequireNumbers: true,
    passwordRequireSpecialChars: true,
    maxLoginAttempts: 5,
    lockoutDuration: 30,
    sessionTimeout: 60,
    twoFactorEnabled: false,
    allowedLoginIps: ''
  },

  Notification: {
    emailNotificationsEnabled: true,
    smsNotificationsEnabled: true,
    pushNotificationsEnabled: true,
    bookingConfirmationEmail: true,
    bookingReminderEmail: true,
    paymentSuccessEmail: true,
    paymentFailureAlerts: true,
    emailReportRecipients: 'admin@parktayo.com',
    slackWebhook: '',
    discordWebhook: ''
  },

  Payment: {
    platformFeePercentage: 10,
    payoutSchedule: 'weekly',
    minimumPayout: 100,
    gcashEnabled: true,
    paymentRetryAttempts: 3,
    refundPolicy: 'auto',
    autoRefundHours: 24,
    // Manual Top-up Settings
    topupMobileNumber: '09123456789',
    topupAccountName: 'ParkTayo Admin',
    topupInstructions: 'Send payment to the mobile number above via GCash, then upload your receipt for verification.'
  },

  API: {
    rateLimitEnabled: true,
    requestsPerMinute: 100,
    apiKeyRequired: true,
    corsEnabled: true,
    allowedOrigins: 'https://app.parktayo.com',
    webhooksEnabled: true,
    webhookSecret: '',
    apiVersion: 'v1'
  }
};

async function seedSystemSettings() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo');
    console.log('🍃 Connected to MongoDB');

    for (const [settingsType, settings] of Object.entries(defaultSettings)) {
      console.log(`📝 Seeding ${settingsType} settings...`);

      await SystemSettings.updateSettings(settingsType, settings);
      console.log(`✅ ${settingsType} settings created/updated`);
    }

    console.log('🎉 System settings seeded successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Error seeding system settings:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  seedSystemSettings();
}

module.exports = { seedSystemSettings, defaultSettings };