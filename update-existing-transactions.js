const mongoose = require('mongoose');

// Connect to your production database
const connectDB = async () => {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('📊 Connected to parktayo database');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
};

const updateTransactions = async () => {
  try {
    await connectDB();

    // Update all existing transactions to use wallet_credit
    const result = await mongoose.connection.db.collection('transactions').updateMany(
      { paymentMethod: { $ne: 'wallet_credit' } }, // Update any transaction that's not already wallet_credit
      {
        $set: {
          paymentMethod: 'wallet_credit',
          paymentProvider: 'wallet'
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} transactions to use wallet_credit`);

    // Check total transactions now
    const totalWalletTransactions = await mongoose.connection.db.collection('transactions').countDocuments({
      paymentMethod: 'wallet_credit'
    });

    console.log(`📊 Total wallet_credit transactions: ${totalWalletTransactions}`);

    // Show sample transactions
    const sampleTransactions = await mongoose.connection.db.collection('transactions').find({
      paymentMethod: 'wallet_credit'
    }).limit(5).toArray();

    console.log('\n📋 Sample wallet credit transactions:');
    sampleTransactions.forEach((txn, index) => {
      console.log(`${index + 1}. ${txn.transactionId} - ₱${txn.amount} - ${txn.status} - ${new Date(txn.createdAt).toLocaleDateString()}`);
    });

    console.log('\n✨ All transactions updated successfully!');
    console.log('🎯 Your Transaction Monitoring page should now show wallet credit data.');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating transactions:', error);
    process.exit(1);
  }
};

updateTransactions();