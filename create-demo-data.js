const mongoose = require('mongoose');
const User = require('./src/models/User');
const ParkingSpace = require('./src/models/ParkingSpace');
const Booking = require('./src/models/Booking');
const Transaction = require('./src/models/Transaction');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/parktayo_db', {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

async function createDemoData() {
  try {
    console.log('🔧 Creating demo data...');

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
      console.log('✅ Demo client created');
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
      console.log('✅ Demo landlord created');
    }

    // Get parking spaces and approve them if pending
    let parkingSpaces = await ParkingSpace.find().limit(3);
    if (parkingSpaces.length === 0) {
      console.log('❌ No parking spaces found. Run seed first.');
      return;
    }

    // Approve any pending spaces
    for (let space of parkingSpaces) {
      if (space.status === 'pending') {
        await ParkingSpace.updateOne(
          { _id: space._id },
          {
            $set: {
              status: 'approved',
              'adminApproval.status': 'approved',
              'adminApproval.approvedAt': new Date(),
              isVerified: true,
            },
          }
        );
        console.log(`✅ Approved parking space: ${space.name}`);
      }
    }

    // Refetch after approval
    parkingSpaces = await ParkingSpace.find({ status: 'approved' }).limit(3);

    // Create bookings for the last 7 days
    const bookings = [];
    const transactions = [];

    for (let i = 0; i < 7; i++) {
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
          status: Math.random() > 0.3 ? 'completed' : 'active',
          pricing: {
            hourlyRate: space.pricePerHour,
            totalAmount,
          },
          createdAt: date,
        };

        bookings.push(booking);

        // Create corresponding transaction if booking is completed
        if (booking.status === 'completed') {
          const platformFee = Math.round(totalAmount * 0.15);
          transactions.push({
            userId: client._id,
            bookingId: null, // Will be set after booking creation
            parkingSpaceId: space._id,
            landlordId: space.landlordId,
            amount: totalAmount,
            platformFee,
            landlordPayout: totalAmount - platformFee,
            paymentMethod: 'gcash',
            status: 'completed',
            initiatedAt: date,
            completedAt: new Date(date.getTime() + Math.random() * 60000),
            createdAt: date,
          });
        }
      }
    }

    // Insert bookings
    const createdBookings = await Booking.insertMany(bookings);
    console.log(`✅ Created ${createdBookings.length} demo bookings`);

    // Update transactions with booking IDs
    for (let i = 0; i < transactions.length && i < createdBookings.length; i++) {
      if (createdBookings[i] && createdBookings[i].status === 'completed') {
        transactions[i].bookingId = createdBookings[i]._id;
      }
    }

    // Insert transactions
    const validTransactions = transactions.filter(t => t.bookingId);
    if (validTransactions.length > 0) {
      const createdTransactions = await Transaction.insertMany(validTransactions);
      console.log(`✅ Created ${createdTransactions.length} demo transactions`);
    }

    // Create some users for today
    const today = new Date();
    const todayUsers = [];
    for (let i = 0; i < 3; i++) {
      todayUsers.push({
        firstName: `User${i}`,
        lastName: 'Today',
        email: `user${i}_${Date.now()}@demo.com`,
        password: 'password123',
        role: 'client',
        isEmailVerified: true,
        createdAt: today,
      });
    }

    const createdTodayUsers = await User.insertMany(todayUsers);
    console.log(`✅ Created ${createdTodayUsers.length} users for today`);

    console.log('🎉 Demo data creation completed!');
    console.log('📊 Summary:');
    console.log(`  - Bookings: ${createdBookings.length}`);
    console.log(`  - Transactions: ${validTransactions.length}`);
    console.log(`  - Today's Users: ${createdTodayUsers.length}`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating demo data:', error);
    process.exit(1);
  }
}

createDemoData();