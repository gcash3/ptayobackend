const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const User = require('../src/models/User');
const { BaseUser, Client, Landlord, Admin, findUserById } = require('../src/models/UserModels');

async function debugUserLookup(userId) {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/parktayo');
    console.log('🔄 Connected to MongoDB');

    console.log(`\n🔍 Looking up user: ${userId}`);
    console.log('=' .repeat(50));

    // Try legacy User model
    console.log('\n1️⃣ Legacy User Model:');
    try {
      const legacyUser = await User.findById(userId);
      if (legacyUser) {
        console.log('✅ Found in User model');
        console.log(`   Email: ${legacyUser.email}`);
        console.log(`   Role: ${legacyUser.role}`);
        console.log(`   Active: ${legacyUser.active}`);
        console.log(`   Created: ${legacyUser.createdAt}`);
      } else {
        console.log('❌ Not found in User model');
      }
    } catch (error) {
      console.log(`❌ Error in User model: ${error.message}`);
    }

    // Try BaseUser model
    console.log('\n2️⃣ BaseUser Model:');
    try {
      const baseUser = await BaseUser.findById(userId);
      if (baseUser) {
        console.log('✅ Found in BaseUser model');
        console.log(`   Email: ${baseUser.email}`);
        console.log(`   UserType: ${baseUser.userType}`);
        console.log(`   Model: ${baseUser.constructor.modelName}`);
        console.log(`   Active: ${baseUser.active}`);
        console.log(`   Created: ${baseUser.createdAt}`);
      } else {
        console.log('❌ Not found in BaseUser model');
      }
    } catch (error) {
      console.log(`❌ Error in BaseUser model: ${error.message}`);
    }

    // Try Client model
    console.log('\n3️⃣ Client Model:');
    try {
      const client = await Client.findById(userId);
      if (client) {
        console.log('✅ Found in Client model');
        console.log(`   Email: ${client.email}`);
        console.log(`   Vehicle Type: ${client.vehicleType}`);
        console.log(`   Total Bookings: ${client.totalBookings}`);
        console.log(`   Active: ${client.active}`);
      } else {
        console.log('❌ Not found in Client model');
      }
    } catch (error) {
      console.log(`❌ Error in Client model: ${error.message}`);
    }

    // Try Landlord model
    console.log('\n4️⃣ Landlord Model:');
    try {
      const landlord = await Landlord.findById(userId);
      if (landlord) {
        console.log('✅ Found in Landlord model');
        console.log(`   Email: ${landlord.email}`);
        console.log(`   Verified: ${landlord.isVerifiedLandlord}`);
        console.log(`   Total Earnings: ${landlord.totalEarnings}`);
        console.log(`   Active: ${landlord.active}`);
      } else {
        console.log('❌ Not found in Landlord model');
      }
    } catch (error) {
      console.log(`❌ Error in Landlord model: ${error.message}`);
    }

    // Try unified lookup
    console.log('\n5️⃣ Unified Lookup (findUserById):');
    try {
      const unifiedUser = await findUserById(userId);
      if (unifiedUser) {
        console.log('✅ Found with unified lookup');
        console.log(`   Email: ${unifiedUser.email}`);
        console.log(`   UserType: ${unifiedUser.userType}`);
        console.log(`   Role: ${unifiedUser.role}`);
        console.log(`   Model: ${unifiedUser.constructor.modelName}`);
        console.log(`   Active: ${unifiedUser.active}`);
        console.log(`   Has Password Method: ${!!unifiedUser.changedPasswordAfter}`);
      } else {
        console.log('❌ Not found with unified lookup');
      }
    } catch (error) {
      console.log(`❌ Error in unified lookup: ${error.message}`);
    }

    // Summary
    console.log('\n📊 Summary:');
    const allUsers = await BaseUser.find({});
    const legacyUsers = await User.find({});
    console.log(`   Total users in BaseUser: ${allUsers.length}`);
    console.log(`   Total users in User: ${legacyUsers.length}`);
    
    const recentUsers = await BaseUser.find({}).sort({createdAt: -1}).limit(5);
    console.log('\n📅 Recent 5 users:');
    recentUsers.forEach((user, index) => {
      console.log(`   ${index + 1}. ${user.email} (${user.userType || user.role}) - ${user.constructor.modelName}`);
    });

  } catch (error) {
    console.error('💥 Debug failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// If userId provided as argument, use it, otherwise get latest user
if (require.main === module) {
  const userId = process.argv[2];
  
  if (userId) {
    debugUserLookup(userId);
  } else {
    // Get the most recent user ID and debug it
    mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/parktayo')
      .then(async () => {
        const { BaseUser } = require('../src/models/UserModels');
        const latestUser = await BaseUser.findOne().sort({createdAt: -1});
        await mongoose.disconnect();
        
        if (latestUser) {
          console.log(`No userId provided, using latest user: ${latestUser._id}`);
          debugUserLookup(latestUser._id.toString());
        } else {
          console.log('No users found in database');
        }
      })
      .catch(console.error);
  }
}

module.exports = { debugUserLookup };
