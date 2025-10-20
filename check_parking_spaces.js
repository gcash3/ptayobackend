const mongoose = require('mongoose');
const ParkingSpace = require('./src/models/ParkingSpace');

async function checkParkingSpaces() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    const totalSpaces = await ParkingSpace.countDocuments();
    console.log(`Total parking spaces: ${totalSpaces}`);

    const activeSpaces = await ParkingSpace.countDocuments({ status: 'active' });
    console.log(`Active parking spaces: ${activeSpaces}`);

    const verifiedSpaces = await ParkingSpace.countDocuments({ isVerified: true });
    console.log(`Verified parking spaces: ${verifiedSpaces}`);

    const availableSpaces = await ParkingSpace.countDocuments({ availableSpots: { $gt: 0 } });
    console.log(`Spaces with available spots: ${availableSpaces}`);

    // Get a sample space
    const sampleSpace = await ParkingSpace.findOne().select('name address latitude longitude status isVerified availableSpots');
    if (sampleSpace) {
      console.log('\nSample parking space:');
      console.log(JSON.stringify(sampleSpace, null, 2));
    } else {
      console.log('\nNo parking spaces found in database');
    }

    // Check if location index exists
    const indexes = await ParkingSpace.collection.getIndexes();
    console.log('\nAvailable indexes:');
    console.log(Object.keys(indexes));

    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

checkParkingSpaces();