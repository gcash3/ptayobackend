const mongoose = require('mongoose');

const exploreDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('📊 Connected to parktayo database');

    // List all collections
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`\n📋 Found ${collections.length} collections:`);

    for (const collection of collections) {
      const count = await mongoose.connection.db.collection(collection.name).countDocuments();
      console.log(`  - ${collection.name}: ${count} documents`);
    }

    // Check if there are any transactions
    console.log('\n🔍 Checking transactions collection...');
    const transactionCount = await mongoose.connection.db.collection('transactions').countDocuments();
    console.log(`Total transactions: ${transactionCount}`);

    if (transactionCount > 0) {
      console.log('\n📄 Sample transaction documents:');
      const sampleTransactions = await mongoose.connection.db.collection('transactions').find({}).limit(3).toArray();
      sampleTransactions.forEach((txn, index) => {
        console.log(`\n${index + 1}. Transaction ID: ${txn._id}`);
        console.log(`   Amount: ${txn.amount || 'N/A'}`);
        console.log(`   Payment Method: ${txn.paymentMethod || 'N/A'}`);
        console.log(`   Status: ${txn.status || 'N/A'}`);
        console.log(`   Created: ${txn.createdAt || 'N/A'}`);
      });
    }

    // Check users
    console.log('\n👥 Checking users...');
    const userCount = await mongoose.connection.db.collection('users').countDocuments();
    console.log(`Total users: ${userCount}`);

    if (userCount > 0) {
      const usersSample = await mongoose.connection.db.collection('users').find({}).limit(3).toArray();
      console.log('\n📄 Sample users:');
      usersSample.forEach((user, index) => {
        console.log(`${index + 1}. ${user.firstName} ${user.lastName} (${user.email}) - Role: ${user.role}`);
      });
    }

    // Check bookings
    console.log('\n📅 Checking bookings...');
    const bookingCount = await mongoose.connection.db.collection('bookings').countDocuments();
    console.log(`Total bookings: ${bookingCount}`);

    // Check parking spaces
    console.log('\n🅿️ Checking parking spaces...');
    const spaceCount = await mongoose.connection.db.collection('parkingspaces').countDocuments();
    console.log(`Total parking spaces: ${spaceCount}`);

    console.log('\n✅ Database exploration complete!');
    console.log('\n💡 Next steps:');
    console.log('1. If you have transactions with different payment methods, we can update them to wallet_credit');
    console.log('2. If you need to create sample transactions, we can generate them');
    console.log('3. The Transaction Monitoring page will show data once wallet_credit transactions exist');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error exploring database:', error);
    process.exit(1);
  }
};

exploreDB();