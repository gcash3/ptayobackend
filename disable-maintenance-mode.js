const mongoose = require('mongoose');
require('dotenv').config();

const SystemSettings = require('./src/models/SystemSettings');

async function disableMaintenanceMode() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB\n');

    // Get Maintenance settings
    const maintenanceSettings = await SystemSettings.getSettingsByType('Maintenance');

    console.log('📊 CURRENT MAINTENANCE SETTINGS:');
    console.log('====================================');

    if (maintenanceSettings) {
      console.log(`🔧 Enabled: ${maintenanceSettings.enabled}`);
      console.log(`📝 Title: ${maintenanceSettings.title}`);
      console.log(`💬 Message: ${maintenanceSettings.message}`);
      console.log(`⏰ Expected End: ${maintenanceSettings.expectedEndTime || 'Not set'}`);
      console.log(`📱 Affects Client: ${maintenanceSettings.affectsClient}`);
      console.log(`🏠 Affects Host: ${maintenanceSettings.affectsHost}\n`);

      if (maintenanceSettings.enabled) {
        console.log('🔄 Disabling maintenance mode...');
        maintenanceSettings.enabled = false;
        await SystemSettings.updateSettings('Maintenance', maintenanceSettings);
        console.log('✅ Maintenance mode has been DISABLED!');
        console.log('✅ Users can now access the system normally.');
      } else {
        console.log('ℹ️  Maintenance mode is already disabled.');
      }
    } else {
      console.log('❌ No Maintenance settings found');
      console.log('💡 Creating default maintenance settings with enabled: false...');

      await SystemSettings.updateSettings('Maintenance', {
        enabled: false,
        title: 'Maintenance Mode',
        message: 'We are currently performing scheduled maintenance. Please check back soon.',
        expectedEndTime: null,
        affectsClient: true,
        affectsHost: true
      });

      console.log('✅ Default maintenance settings created (disabled)');
    }

    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

disableMaintenanceMode();
