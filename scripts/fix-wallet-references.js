const mongoose = require('mongoose');
require('dotenv').config();

const { Wallet } = require('../src/models/Wallet');

async function fixWalletReferences() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/parktayo');
    console.log('🔄 Connected to MongoDB');

    // Find all wallets with problematic transactions
    const walletsWithIssues = await Wallet.find({
      $or: [
        { 'transactions.referenceId': null },
        { 'transactions.referenceId': 'null' },
        { 'transactions.referenceId': '' }
      ]
    });

    console.log(`📊 Found ${walletsWithIssues.length} wallets with referenceId issues`);

    let totalFixed = 0;
    let totalRemoved = 0;

    for (const wallet of walletsWithIssues) {
      console.log(`🔧 Fixing wallet for user: ${wallet.userId}`);
      
      const seenReferenceIds = new Set();
      const cleanedTransactions = [];
      let fixedCount = 0;

      wallet.transactions.forEach((transaction, index) => {
        // Fix null or invalid referenceIds
        if (!transaction.referenceId || transaction.referenceId === 'null' || transaction.referenceId === '') {
          transaction.referenceId = `TXN-${Date.now()}-FIX-${index}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
          fixedCount++;
        }

        // Only keep transactions with unique referenceIds
        if (!seenReferenceIds.has(transaction.referenceId)) {
          seenReferenceIds.add(transaction.referenceId);
          cleanedTransactions.push(transaction);
        } else {
          // Found duplicate, generate new referenceId
          transaction.referenceId = `TXN-${Date.now()}-DUP-${index}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
          cleanedTransactions.push(transaction);
          fixedCount++;
        }
      });

      const removedCount = wallet.transactions.length - cleanedTransactions.length;
      wallet.transactions = cleanedTransactions;

      // Save the cleaned wallet
      await wallet.save();

      console.log(`  ✅ Fixed ${fixedCount} referenceIds, removed ${removedCount} duplicates`);
      totalFixed += fixedCount;
      totalRemoved += removedCount;
    }

    console.log('\n📈 Summary:');
    console.log(`✅ Processed ${walletsWithIssues.length} wallets`);
    console.log(`🔧 Fixed ${totalFixed} referenceIds`);
    console.log(`🗑️ Removed ${totalRemoved} duplicate transactions`);

    // Verify the fix
    const remainingIssues = await Wallet.find({
      $or: [
        { 'transactions.referenceId': null },
        { 'transactions.referenceId': 'null' },
        { 'transactions.referenceId': '' }
      ]
    });

    if (remainingIssues.length === 0) {
      console.log('🎉 All wallet referenceId issues have been resolved!');
    } else {
      console.log(`⚠️ ${remainingIssues.length} wallets still have issues`);
    }

  } catch (error) {
    console.error('💥 Error fixing wallet references:', error);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run the fix if called directly
if (require.main === module) {
  fixWalletReferences().then(() => {
    console.log('🎉 Wallet reference fix completed!');
    process.exit(0);
  }).catch(error => {
    console.error('💥 Fix script error:', error);
    process.exit(1);
  });
}

module.exports = { fixWalletReferences };
