const mongoose = require('mongoose');
require('dotenv').config();

const SystemSettings = require('./src/models/SystemSettings');

async function checkRegistrationEnabled() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');

    // Get General settings
    const generalSettings = await SystemSettings.getSettingsByType('General');

    console.log('\n📊 GENERAL SYSTEM SETTINGS:');
    console.log('====================================');

    if (generalSettings) {
      console.log('✅ General settings found');
      console.log('\n🔑 Registration Status:');
      console.log(`   registrationEnabled: ${generalSettings.registrationEnabled !== undefined ? generalSettings.registrationEnabled : 'NOT SET (defaults to allowing registration)'}`);

      console.log('\n📋 Other settings:');
      console.log(`   autoApproveSpaces: ${generalSettings.autoApproveSpaces}`);
      console.log(`   siteName: ${generalSettings.siteName}`);
      console.log(`   timezone: ${generalSettings.timezone}`);

      console.log('\n🔧 All General Settings:');
      console.log(JSON.stringify(generalSettings, null, 2));

      // Check if registrationEnabled needs to be set
      if (generalSettings.registrationEnabled === undefined || generalSettings.registrationEnabled === null) {
        console.log('\n⚠️  WARNING: registrationEnabled is not set!');
        console.log('   This means registration checks might fail.');
        console.log('\n💡 SOLUTION: Update General settings to include registrationEnabled: true');

        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });

        readline.question('\n❓ Do you want to set registrationEnabled to TRUE now? (yes/no): ', async (answer) => {
          if (answer.toLowerCase() === 'yes' || answer.toLowerCase() === 'y') {
            console.log('\n🔄 Updating settings...');
            generalSettings.registrationEnabled = true;
            await SystemSettings.updateSettings('General', generalSettings);
            console.log('✅ registrationEnabled has been set to TRUE');
            console.log('✅ Users can now register!');
          } else {
            console.log('❌ Skipped. Please update manually via admin panel.');
          }
          readline.close();
          await mongoose.connection.close();
          console.log('\n🔌 Disconnected from MongoDB');
        });

        return; // Don't close connection yet
      } else if (generalSettings.registrationEnabled === false) {
        console.log('\n🚫 REGISTRATION IS CURRENTLY DISABLED');
        console.log('   Users cannot register for new accounts.');
        console.log('\n💡 To enable registration:');
        console.log('   1. Go to Admin Panel > System Settings > General tab');
        console.log('   2. Toggle "Enable User Registration" ON');
        console.log('   3. Click "Save General Settings"');
      } else {
        console.log('\n✅ REGISTRATION IS ENABLED');
        console.log('   Users can register for new accounts.');
      }
    } else {
      console.log('❌ No General settings found');
      console.log('\n💡 Please set up system settings via the admin panel');
    }

    await mongoose.connection.close();
    console.log('\n🔌 Disconnected from MongoDB');

  } catch (error) {
    console.error('❌ Error:', error);
    await mongoose.connection.close();
    process.exit(1);
  }
}

checkRegistrationEnabled();
