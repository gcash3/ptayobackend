const mongoose = require('mongoose');
require('./src/config/database');
const Transaction = require('./src/models/Transaction');

async function updateTransactionsToWalletCredit() {
  try {
    // Wait for database connection
    await new Promise(resolve => setTimeout(resolve, 2000));

    console.log('🔄 Updating all transactions to use wallet_credit payment method...');

    // Update all existing transactions to use wallet_credit
    const result = await Transaction.updateMany(
      {}, // Update all transactions
      {
        $set: {
          paymentMethod: 'wallet_credit',
          paymentProvider: 'wallet'
        }
      }
    );

    console.log(`✅ Updated ${result.modifiedCount} transactions to wallet_credit`);

    // Check the count
    const walletCreditCount = await Transaction.countDocuments({ paymentMethod: 'wallet_credit' });
    console.log(`📊 Total wallet_credit transactions: ${walletCreditCount}`);

    // Show some sample transactions
    const sampleTransactions = await Transaction.find({ paymentMethod: 'wallet_credit' })
      .populate('userId', 'firstName lastName')
      .populate('landlordId', 'firstName lastName')
      .populate('parkingSpaceId', 'name')
      .sort({ createdAt: -1 })
      .limit(5);

    console.log('\n📋 Sample wallet credit transactions:');
    sampleTransactions.forEach((txn, index) => {
      console.log(`${index + 1}. ${txn.transactionId} - ₱${txn.amount} - ${txn.status} - ${txn.createdAt.toLocaleDateString()}`);
      console.log(`   Client: ${txn.userId?.firstName} ${txn.userId?.lastName}`);
      console.log(`   Landlord: ${txn.landlordId?.firstName} ${txn.landlordId?.lastName}`);
      console.log(`   Space: ${txn.parkingSpaceId?.name}`);
      console.log('');
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error updating transactions:', error);
    process.exit(1);
  }
}

updateTransactionsToWalletCredit();