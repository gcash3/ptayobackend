const mongoose = require('mongoose');
const ParkingSpace = require('./src/models/ParkingSpace');

async function checkAIMetrics() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    const spaces = await ParkingSpace.find({
      status: 'active',
      isVerified: true,
      availableSpots: { $gt: 0 }
    }).select('name aiMetrics averageRating bookingStats pricePer3Hours totalSpots availableSpots');

    console.log('\nChecking AI metrics for all parking spaces:');

    spaces.forEach(space => {
      console.log(`\n${space.name}:`);
      console.log(`  - aiMetrics.popularityScore: ${space.aiMetrics?.popularityScore || 'undefined'}`);
      console.log(`  - averageRating: ${space.averageRating || 0}`);
      console.log(`  - bookingStats.totalBookings: ${space.bookingStats?.totalBookings || 0}`);
      console.log(`  - pricePer3Hours: ${space.pricePer3Hours || 0}`);
      console.log(`  - availableSpots: ${space.availableSpots}/${space.totalSpots}`);

      // Calculate demandScore like in the aggregation pipeline
      const totalBookings = space.bookingStats?.totalBookings || 0;
      const averageRating = space.averageRating || 0;
      const popularityScore = space.aiMetrics?.popularityScore || 50;

      const demandScore = (totalBookings * 0.4) + (averageRating * 20) + (popularityScore * 0.4);
      console.log(`  - calculated demandScore: ${demandScore.toFixed(2)}`);

      // Check if it would pass smart filter
      const passesSmartFilter =
        (space.aiMetrics?.popularityScore || 0) >= 60 &&
        demandScore >= 80;
      console.log(`  - passes smart filter: ${passesSmartFilter}`);
    });

    // Now let's update the spaces to have reasonable AI metrics for testing
    console.log('\n\nUpdating AI metrics for testing...');

    const updateResult = await ParkingSpace.updateMany(
      {
        status: 'active',
        isVerified: true
      },
      {
        $set: {
          'aiMetrics.popularityScore': 75,
          'aiMetrics.averageOccupancy': 65,
          'aiMetrics.lastAnalyzed': new Date(),
          'averageRating': 4.2,
          'bookingStats.totalBookings': 50,
          'bookingStats.totalReviews': 45
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

checkAIMetrics();