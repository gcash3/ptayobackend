const mongoose = require('mongoose');

const migrateWalletTransactions = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('📊 Connected to parktayo database');

    // First, let's examine the wallet transactions
    console.log('\n🔍 Examining wallet transactions...');
    const walletTransactions = await mongoose.connection.db.collection('wallettransactions').find({}).toArray();

    console.log(`Found ${walletTransactions.length} wallet transactions:`);
    walletTransactions.forEach((wtxn, index) => {
      console.log(`\n${index + 1}. ID: ${wtxn._id}`);
      console.log(`   Type: ${wtxn.type}`);
      console.log(`   Amount: ₱${wtxn.amount}`);
      console.log(`   Status: ${wtxn.status || 'N/A'}`);
      console.log(`   User ID: ${wtxn.userId}`);
      console.log(`   Description: ${wtxn.description || 'N/A'}`);
      console.log(`   Created: ${wtxn.createdAt}`);
    });

    // Now let's examine bookings to see if we can link them
    console.log('\n📅 Examining bookings...');
    const bookings = await mongoose.connection.db.collection('bookings').find({}).toArray();

    console.log(`Found ${bookings.length} bookings:`);
    bookings.forEach((booking, index) => {
      console.log(`\n${index + 1}. ID: ${booking._id}`);
      console.log(`   User ID: ${booking.userId}`);
      console.log(`   Space ID: ${booking.parkingSpaceId}`);
      console.log(`   Total Amount: ₱${booking.totalAmount || booking.pricing?.totalAmount || 'N/A'}`);
      console.log(`   Status: ${booking.status}`);
      console.log(`   Created: ${booking.createdAt}`);
    });

    // Let's examine parking spaces
    console.log('\n🅿️ Examining parking spaces...');
    const parkingSpaces = await mongoose.connection.db.collection('parkingspaces').find({}).toArray();

    console.log(`Found ${parkingSpaces.length} parking spaces:`);
    parkingSpaces.forEach((space, index) => {
      console.log(`\n${index + 1}. ID: ${space._id}`);
      console.log(`   Name: ${space.name}`);
      console.log(`   Landlord ID: ${space.landlordId}`);
      console.log(`   Price: ₱${space.hourlyRate || space.pricing?.hourlyRate || 'N/A'}/hr`);
    });

    console.log('\n💡 Analysis complete!');
    console.log('Would you like me to:');
    console.log('1. Create Transaction records from wallet transactions');
    console.log('2. Create Transaction records from bookings');
    console.log('3. Generate sample wallet credit transactions for testing');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error exploring data:', error);
    process.exit(1);
  }
};

migrateWalletTransactions();