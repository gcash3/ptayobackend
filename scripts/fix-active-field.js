const mongoose = require('mongoose');
require('dotenv').config();

const { BaseUser } = require('../src/models/UserModels');

async function fixActiveField() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/parktayo');
    console.log('🔄 Connected to MongoDB');

    // Find users with undefined active field
    const usersWithUndefinedActive = await BaseUser.find({
      $or: [
        { active: { $exists: false } },
        { active: null },
        { active: undefined }
      ]
    });

    console.log(`📊 Found ${usersWithUndefinedActive.length} users with undefined active field`);

    let fixedCount = 0;
    for (const user of usersWithUndefinedActive) {
      console.log(`🔧 Fixing user: ${user.email} (${user._id})`);
      
      user.active = true;
      await user.save();
      fixedCount++;
      
      console.log(`  ✅ Set active = true for ${user.email}`);
    }

    console.log('\n📈 Summary:');
    console.log(`✅ Fixed ${fixedCount} users`);

    // Verify the fix
    const stillUndefined = await BaseUser.find({
      $or: [
        { active: { $exists: false } },
        { active: null },
        { active: undefined }
      ]
    });

    if (stillUndefined.length === 0) {
      console.log('🎉 All users now have proper active field!');
    } else {
      console.log(`⚠️ ${stillUndefined.length} users still have undefined active field`);
    }

    // Show current status
    const allUsers = await BaseUser.find({});
    console.log('\n📊 Current user status:');
    allUsers.forEach(user => {
      console.log(`   ${user.email}: active = ${user.active} (${typeof user.active})`);
    });

  } catch (error) {
    console.error('💥 Error fixing active field:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the fix if called directly
if (require.main === module) {
  fixActiveField().then(() => {
    console.log('🎉 Active field fix completed!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Fix script error:', error);
    process.exit(1);
  });
}

module.exports = { fixActiveField };
