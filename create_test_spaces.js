const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const ParkingSpace = require('./src/models/ParkingSpace');
const User = require('./src/models/User');

async function createTestSpaces() {
  try {
    // Connect to MongoDB
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo';
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB');

    // University of the East coordinates
    const ueCoords = { lat: 14.5997, lng: 120.9821 };
    console.log(`🎯 University of the East coordinates: [${ueCoords.lat}, ${ueCoords.lng}]`);

    // Check if we have any landlords
    let landlord = await User.findOne({ role: 'landlord' });
    if (!landlord) {
      console.log('👤 Creating test landlord...');
      landlord = new User({
        firstName: 'Test',
        lastName: 'Landlord',
        email: 'test.landlord@example.com',
        password: '$2b$10$abcdefghijklmnopqrstuvwxyz', // pre-hashed dummy password
        role: 'landlord',
        phoneNumber: '+639123456789',
        isEmailVerified: true
      });
      await landlord.save();
      console.log(`✅ Created landlord: ${landlord._id}`);
    } else {
      console.log(`👤 Using existing landlord: ${landlord._id}`);
    }

    // Check existing spaces
    const existingCount = await ParkingSpace.countDocuments({
      location: {
        $geoWithin: {
          $centerSphere: [[ueCoords.lng, ueCoords.lat], 2000 / 6378100]
        }
      }
    });
    console.log(`📊 Existing spaces within 2km of UE: ${existingCount}`);

    if (existingCount === 0) {
      console.log('🏗️ Creating test parking spaces...');

      const testSpaces = [
        {
          name: 'UE Main Campus Parking',
          address: 'C.M. Recto Ave, University of the East, Manila',
          latitude: 14.5995,
          longitude: 120.9819,
          pricePerHour: 35,
          dailyRate: 450,
          totalSpots: 30,
          availableSpots: 25,
          type: 'Open Lot',
          amenities: ['CCTV', 'Security Guard', 'Well-lit'],
          description: 'Main parking area for UE students and visitors'
        },
        {
          name: 'Recto Avenue Covered Parking',
          address: 'Recto Avenue, near UE, Sampaloc, Manila',
          latitude: 14.5999,
          longitude: 120.9823,
          pricePerHour: 40,
          dailyRate: 500,
          totalSpots: 20,
          availableSpots: 15,
          type: 'Covered Parking',
          amenities: ['CCTV', 'Covered', 'Security Guard'],
          description: 'Covered parking with premium security'
        },
        {
          name: 'Sampaloc Budget Parking',
          address: 'Legarda Street, Sampaloc, Manila',
          latitude: 14.6001,
          longitude: 120.9817,
          pricePerHour: 25,
          dailyRate: 350,
          totalSpots: 15,
          availableSpots: 12,
          type: 'Street Parking',
          amenities: ['Budget-friendly', 'Well-lit'],
          description: 'Affordable parking option for students'
        }
      ];

      for (const spaceData of testSpaces) {
        const space = new ParkingSpace({
          ...spaceData,
          landlordId: landlord._id,
          status: 'active',
          isVerified: true,
          location: {
            type: 'Point',
            coordinates: [spaceData.longitude, spaceData.latitude]
          }
        });

        await space.save();
        console.log(`✅ Created: ${space.name} - [${space.latitude}, ${space.longitude}]`);
      }
    }

    // Final test - count spaces using the same query as the API
    const finalCount = await ParkingSpace.countDocuments({
      location: {
        $geoWithin: {
          $centerSphere: [[ueCoords.lng, ueCoords.lat], 2000 / 6378100]
        }
      },
      status: 'active',
      isVerified: true,
      availableSpots: { $gt: 0 }
    });

    console.log(`\n🎉 SUCCESS! Found ${finalCount} available parking spaces within 2km of University of the East`);

    // Show some sample spaces
    const sampleSpaces = await ParkingSpace.find({
      location: {
        $near: {
          $geometry: { type: "Point", coordinates: [ueCoords.lng, ueCoords.lat] },
          $maxDistance: 2000
        }
      },
      status: 'active',
      isVerified: true,
      availableSpots: { $gt: 0 }
    }).limit(3);

    console.log('\n📍 Sample spaces:');
    sampleSpaces.forEach(space => {
      console.log(`  - ${space.name}: ${space.availableSpots}/${space.totalSpots} spots, ₱${space.pricePerHour}/hour`);
    });

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.connection.close();
    console.log('\n📱 Database connection closed');
  }
}

createTestSpaces();
