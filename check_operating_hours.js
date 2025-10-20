const mongoose = require('mongoose');
const ParkingSpace = require('./src/models/ParkingSpace');

async function checkOperatingHours() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    const spaces = await ParkingSpace.find({
      status: 'active',
      isVerified: true
    }).select('name operatingHours totalSpots');

    console.log('\nChecking operating hours structure:');

    spaces.forEach(space => {
      console.log(`\n${space.name}:`);
      console.log(`  - totalSpots: ${space.totalSpots}`);
      console.log(`  - operatingHours:`, JSON.stringify(space.operatingHours, null, 4));

      // Check what the filter is looking for
      const hasIs24Hours = space.operatingHours?.is24Hours === true;
      const hasOpenTime = space.operatingHours?.openTime !== undefined;
      const hasCloseTime = space.operatingHours?.closeTime !== undefined;

      console.log(`  - has is24Hours: ${hasIs24Hours}`);
      console.log(`  - has openTime: ${hasOpenTime}`);
      console.log(`  - has closeTime: ${hasCloseTime}`);

      const currentHour = new Date().getHours();
      console.log(`  - current hour: ${currentHour}`);

      const passesOperatingHoursFilter = hasIs24Hours ||
        (hasOpenTime && hasCloseTime &&
         space.operatingHours.openTime <= currentHour &&
         space.operatingHours.closeTime >= currentHour);

      console.log(`  - passes operating hours filter: ${passesOperatingHoursFilter}`);
    });

    // Update all spaces to have proper operating hours for testing
    console.log('\n\nUpdating operating hours for testing...');

    const updateResult = await ParkingSpace.updateMany(
      {
        status: 'active',
        isVerified: true
      },
      {
        $set: {
          'operatingHours.is24Hours': true,
          'operatingHours.openTime': 0,
          'operatingHours.closeTime': 23
        }
      }
    );

    console.log('Update result:', updateResult);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

checkOperatingHours();