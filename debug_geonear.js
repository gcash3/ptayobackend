const mongoose = require('mongoose');
const ParkingSpace = require('./src/models/ParkingSpace');

async function debugGeoNear() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    const userLocation = {
      latitude: 14.60318,
      longitude: 120.988805
    };

    const radiusKm = 5;

    console.log(`\nTesting $geoNear query from location (${userLocation.latitude}, ${userLocation.longitude}) within ${radiusKm}km`);

    // Test 1: Basic $geoNear query
    console.log('\n1. Testing basic $geoNear aggregation:');
    const pipeline1 = [
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [userLocation.longitude, userLocation.latitude]
          },
          distanceField: 'distance',
          maxDistance: radiusKm * 1000,
          spherical: true,
          distanceMultiplier: 0.001,
          query: {
            status: 'active',
            isVerified: true,
            availableSpots: { $gt: 0 }
          }
        }
      }
    ];

    const result1 = await ParkingSpace.aggregate(pipeline1);
    console.log(`Found ${result1.length} spaces with basic $geoNear`);
    result1.forEach(space => {
      console.log(`  - ${space.name}: ${space.distance.toFixed(2)}km away, ${space.availableSpots}/${space.totalSpots} spots`);
    });

    // Test 2: Query without availableSpots filter
    console.log('\n2. Testing without availableSpots filter:');
    const pipeline2 = [
      {
        $geoNear: {
          near: {
            type: 'Point',
            coordinates: [userLocation.longitude, userLocation.latitude]
          },
          distanceField: 'distance',
          maxDistance: radiusKm * 1000,
          spherical: true,
          distanceMultiplier: 0.001,
          query: {
            status: 'active',
            isVerified: true
          }
        }
      }
    ];

    const result2 = await ParkingSpace.aggregate(pipeline2);
    console.log(`Found ${result2.length} spaces without availableSpots filter`);
    result2.forEach(space => {
      console.log(`  - ${space.name}: ${space.distance.toFixed(2)}km away, ${space.availableSpots}/${space.totalSpots} spots`);
    });

    // Test 3: Simple find query for comparison
    console.log('\n3. Testing simple find query:');
    const simpleQuery = await ParkingSpace.find({
      status: 'active',
      isVerified: true,
      availableSpots: { $gt: 0 }
    }).select('name availableSpots totalSpots latitude longitude');

    console.log(`Found ${simpleQuery.length} spaces with simple find`);
    simpleQuery.forEach(space => {
      console.log(`  - ${space.name}: (${space.latitude}, ${space.longitude}), ${space.availableSpots}/${space.totalSpots} spots`);
    });

    // Test 4: Check geospatial indexes
    console.log('\n4. Checking geospatial indexes:');
    const indexes = await ParkingSpace.collection.getIndexes();
    const geoIndexes = Object.keys(indexes).filter(key =>
      indexes[key].some(field => field[1] === '2dsphere')
    );
    console.log('Geospatial indexes:', geoIndexes);

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

debugGeoNear();