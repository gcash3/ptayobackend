const mongoose = require('mongoose');
const User = require('./src/models/User');
const ParkingSpace = require('./src/models/ParkingSpace');
const Booking = require('./src/models/Booking');
const Transaction = require('./src/models/Transaction');

mongoose.connect('mongodb://localhost:27017/parktayo_db');

async function createTransactionsData() {
  try {
    console.log('🔧 Creating parking spaces and transactions...');

    // Find or create users
    let client = await User.findOne({ email: 'client@parktayo.com' });
    if (!client) {
      client = await User.create({
        firstName: 'Demo',
        lastName: 'Client',
        email: 'client@parktayo.com',
        password: 'client123',
        role: 'client',
        isEmailVerified: true,
      });
    }

    let landlord = await User.findOne({ email: 'landlord@parktayo.com' });
    if (!landlord) {
      landlord = await User.create({
        firstName: 'Demo',
        lastName: 'Landlord',
        email: 'landlord@parktayo.com',
        password: 'landlord123',
        role: 'landlord',
        isEmailVerified: true,
        isVerifiedLandlord: true,
      });
    }

    // Create parking spaces if they don't exist
    let parkingSpaces = await ParkingSpace.find({ status: 'active' }).limit(3);
    if (parkingSpaces.length === 0) {
      const adminId = '68c72562ffa09e442d920705'; // Admin user ID
      const spaces = [
        {
          name: 'Downtown Parking Space A',
          description: 'Secure parking in downtown area',
          address: '123 Main St, Manila',
          latitude: 14.5995,
          longitude: 120.9822,
          location: {
            type: 'Point',
            coordinates: [120.9822, 14.5995]
          },
          pricePerHour: 50,
          dailyRate: 400,
          landlordId: landlord._id,
          status: 'active',
          totalSpots: 5,
          availableSpots: 5,
          adminApproval: {
            status: 'approved',
            approvedBy: adminId,
            approvedAt: new Date()
          },
          isVerified: true,
          vehicleTypes: ['car', 'motorcycle']
        },
        {
          name: 'Mall Parking Space B',
          description: 'Covered parking at shopping mall',
          address: '456 Mall Ave, Quezon City',
          latitude: 14.6760,
          longitude: 121.0437,
          location: {
            type: 'Point',
            coordinates: [121.0437, 14.6760]
          },
          pricePerHour: 35,
          dailyRate: 280,
          landlordId: landlord._id,
          status: 'active',
          totalSpots: 3,
          availableSpots: 3,
          adminApproval: {
            status: 'approved',
            approvedBy: adminId,
            approvedAt: new Date()
          },
          isVerified: true,
          vehicleTypes: ['car', 'motorcycle']
        },
        {
          name: 'Office Building Parking C',
          description: 'Business district parking',
          address: '789 Business St, Makati',
          latitude: 14.5547,
          longitude: 121.0244,
          location: {
            type: 'Point',
            coordinates: [121.0244, 14.5547]
          },
          pricePerHour: 75,
          dailyRate: 600,
          landlordId: landlord._id,
          status: 'active',
          totalSpots: 8,
          availableSpots: 8,
          adminApproval: {
            status: 'approved',
            approvedBy: adminId,
            approvedAt: new Date()
          },
          isVerified: true,
          vehicleTypes: ['car', 'motorcycle']
        }
      ];

      parkingSpaces = await ParkingSpace.insertMany(spaces);
      console.log(`✅ Created ${parkingSpaces.length} parking spaces`);
    }

    // Clear existing bookings and transactions
    await Booking.deleteMany({});
    await Transaction.deleteMany({});
    console.log('🧹 Cleared existing bookings and transactions');

    // Create bookings and transactions for the last 30 days
    const bookings = [];
    const transactions = [];

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);

      // Create 2-5 bookings per day
      const bookingsPerDay = Math.floor(Math.random() * 4) + 2;

      for (let j = 0; j < bookingsPerDay; j++) {
        const space = parkingSpaces[Math.floor(Math.random() * parkingSpaces.length)];
        const startTime = new Date(date);
        startTime.setHours(Math.floor(Math.random() * 12) + 8); // 8 AM to 8 PM

        const endTime = new Date(startTime);
        endTime.setHours(startTime.getHours() + Math.floor(Math.random() * 4) + 1); // 1-4 hours

        const duration = Math.ceil((endTime - startTime) / (1000 * 60 * 60));
        const totalAmount = duration * space.pricePerHour;

        const booking = {
          userId: client._id,
          parkingSpaceId: space._id,
          landlordId: space.landlordId,
          startTime,
          endTime,
          duration,
          vehicleInfo: {
            plateNumber: `ABC-${Math.floor(Math.random() * 9000) + 1000}`,
            vehicleType: 'car',
          },
          status: 'completed', // All bookings completed for consistent data
          pricing: {
            hourlyRate: space.pricePerHour,
            totalAmount,
          },
          createdAt: date,
          updatedAt: date
        };

        bookings.push(booking);
      }
    }

    // Insert bookings one by one to trigger auto bookingId generation
    const createdBookings = [];
    for (const bookingData of bookings) {
      const booking = new Booking(bookingData);
      const savedBooking = await booking.save();
      createdBookings.push(savedBooking);
    }
    console.log(`✅ Created ${createdBookings.length} demo bookings`);

    // Create transactions for each booking
    for (const booking of createdBookings) {
      const platformFee = Math.round(booking.pricing.totalAmount * 0.15); // 15% platform fee
      const landlordPayout = booking.pricing.totalAmount - platformFee;

      const completedTime = new Date(booking.createdAt.getTime() + Math.random() * 3600000); // Complete within 1 hour

      const transaction = {
        userId: booking.userId,
        bookingId: booking._id,
        parkingSpaceId: booking.parkingSpaceId,
        landlordId: booking.landlordId,
        amount: booking.pricing.totalAmount,
        platformFee,
        landlordPayout,
        paymentMethod: ['gcash', 'credit_card', 'paymaya'][Math.floor(Math.random() * 3)],
        status: 'completed',
        initiatedAt: booking.createdAt,
        completedAt: completedTime,
        createdAt: booking.createdAt,
        currency: 'PHP'
      };

      transactions.push(transaction);
    }

    // Insert transactions
    const createdTransactions = await Transaction.insertMany(transactions);
    console.log(`✅ Created ${createdTransactions.length} demo transactions`);

    // Summary
    const totalRevenue = transactions.reduce((sum, t) => sum + t.amount, 0);
    const totalPlatformFees = transactions.reduce((sum, t) => sum + t.platformFee, 0);

    console.log('🎉 Transaction data creation completed!');
    console.log('📊 Summary:');
    console.log(`  - Parking Spaces: ${parkingSpaces.length}`);
    console.log(`  - Bookings: ${createdBookings.length}`);
    console.log(`  - Transactions: ${createdTransactions.length}`);
    console.log(`  - Total Revenue: ₱${totalRevenue}`);
    console.log(`  - Platform Fees: ₱${totalPlatformFees}`);
    console.log(`  - Landlord Earnings: ₱${totalRevenue - totalPlatformFees}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating transaction data:', error);
    process.exit(1);
  }
}

createTransactionsData();