const mongoose = require('mongoose');
const ParkingSpace = require('./src/models/ParkingSpace');

async function updateTestSpace() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    // Update the "Ue parking" space to have available spots
    const result = await ParkingSpace.updateOne(
      { name: 'Ue parking' },
      {
        $set: {
          availableSpots: 10,
          totalSpots: 15
        }
      }
    );

    console.log('Update result:', result);

    // Also update any other spaces to have available spots for testing
    const bulkResult = await ParkingSpace.updateMany(
      {
        status: 'active',
        isVerified: true,
        availableSpots: 0
      },
      {
        $set: {
          availableSpots: 5,
          totalSpots: 10
        }
      }
    );

    console.log('Bulk update result:', bulkResult);

    // Verify the changes
    const spaces = await ParkingSpace.find({
      status: 'active',
      isVerified: true
    }).select('name address availableSpots totalSpots latitude longitude');

    console.log('\nUpdated parking spaces:');
    spaces.forEach(space => {
      console.log(`${space.name}: ${space.availableSpots}/${space.totalSpots} spots available at (${space.latitude}, ${space.longitude})`);
    });

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

updateTestSpace();