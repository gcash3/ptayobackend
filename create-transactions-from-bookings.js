const mongoose = require('mongoose');

const createTransactionsFromBookings = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('📊 Connected to parktayo database');

    // Get all completed bookings
    const bookings = await mongoose.connection.db.collection('bookings').find({
      status: { $in: ['completed', 'parked'] }
    }).toArray();

    console.log(`\n🔍 Found ${bookings.length} completed/parked bookings to convert...`);

    const transactions = [];

    for (const booking of bookings) {
      const amount = booking.totalAmount || booking.pricing?.totalAmount || 52; // Default to 52 if not found
      const platformFee = Math.round(amount * 0.15); // 15% platform fee
      const landlordPayout = amount - platformFee;

      // Get parking space and landlord info
      const parkingSpace = await mongoose.connection.db.collection('parkingspaces').findOne({
        _id: new mongoose.Types.ObjectId(booking.parkingSpaceId)
      });

      const transaction = {
        transactionId: `TXN-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        userId: new mongoose.Types.ObjectId(booking.userId),
        bookingId: booking._id,
        parkingSpaceId: new mongoose.Types.ObjectId(booking.parkingSpaceId),
        landlordId: parkingSpace ? new mongoose.Types.ObjectId(parkingSpace.landlordId) : new mongoose.Types.ObjectId(booking.userId), // Fallback

        // Transaction amounts
        amount: amount,
        platformFee: platformFee,
        landlordPayout: landlordPayout,

        // Payment details - Always wallet credit for this migration
        paymentMethod: 'wallet_credit',
        paymentProvider: 'wallet',

        // Transaction status
        status: booking.status === 'parked' ? 'completed' : 'completed',

        // Timestamps
        initiatedAt: booking.createdAt,
        completedAt: booking.status === 'completed' ? booking.createdAt : new Date(),

        // Additional metadata
        currency: 'PHP',
        description: `Wallet credit payment for parking booking`,

        // Audit trail
        events: [
          {
            type: 'created',
            timestamp: booking.createdAt,
            description: 'Transaction created from booking migration'
          },
          {
            type: 'completed',
            timestamp: booking.status === 'completed' ? booking.createdAt : new Date(),
            description: 'Transaction completed successfully'
          }
        ],

        createdAt: booking.createdAt,
        updatedAt: new Date()
      };

      transactions.push(transaction);
    }

    if (transactions.length > 0) {
      // Insert transactions
      await mongoose.connection.db.collection('transactions').insertMany(transactions);
      console.log(`✅ Created ${transactions.length} wallet credit transactions!`);

      // Show created transactions
      console.log('\n📋 Created transactions:');
      transactions.forEach((txn, index) => {
        console.log(`${index + 1}. ${txn.transactionId}`);
        console.log(`   Amount: ₱${txn.amount} (Platform Fee: ₱${txn.platformFee})`);
        console.log(`   Status: ${txn.status}`);
        console.log(`   Date: ${txn.createdAt.toLocaleDateString()}`);
        console.log('');
      });

      // Verify the total
      const totalTransactions = await mongoose.connection.db.collection('transactions').countDocuments({
        paymentMethod: 'wallet_credit'
      });

      console.log(`🎯 Total wallet credit transactions in database: ${totalTransactions}`);
      console.log('💰 Total transaction volume: ₱' + transactions.reduce((sum, txn) => sum + txn.amount, 0));
      console.log('🏦 Total platform fees: ₱' + transactions.reduce((sum, txn) => sum + txn.platformFee, 0));

      console.log('\n✨ Success! Your Transaction Monitoring page should now show real data.');
      console.log('🚀 Visit the admin panel to see your wallet credit transactions.');

    } else {
      console.log('❌ No eligible bookings found to convert.');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error creating transactions:', error);
    process.exit(1);
  }
};

createTransactionsFromBookings();