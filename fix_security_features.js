const mongoose = require('mongoose');
const ParkingSpace = require('./src/models/ParkingSpace');

async function fixSecurityFeatures() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    // First, let's see the current state
    console.log('\nCurrent security features:');
    const spaces = await ParkingSpace.find({
      status: 'active',
      isVerified: true
    }).select('name securityFeatures');

    spaces.forEach(space => {
      console.log(`${space.name}:`, JSON.stringify(space.securityFeatures, null, 2));
    });

    // Update each space individually to ensure it works
    console.log('\nUpdating security features...');

    for (const space of spaces) {
      const updateResult = await ParkingSpace.updateOne(
        { _id: space._id },
        {
          $set: {
            securityFeatures: {
              hasLighting: true,
              hasCCTV: true,
              hasSecurityGuard: false,
              isGated: false
            }
          }
        }
      );
      console.log(`Updated ${space.name}:`, updateResult);
    }

    // Verify the changes
    console.log('\nVerifying updates:');
    const updatedSpaces = await ParkingSpace.find({
      status: 'active',
      isVerified: true
    }).select('name securityFeatures');

    updatedSpaces.forEach(space => {
      console.log(`${space.name}:`, JSON.stringify(space.securityFeatures, null, 2));
      console.log(`  hasLighting: ${space.securityFeatures?.hasLighting === true}`);
    });

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

fixSecurityFeatures();