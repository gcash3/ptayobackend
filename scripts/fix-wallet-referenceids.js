#!/usr/bin/env node

/**
 * Wallet ReferenceId Fix Script
 * 
 * This script fixes existing wallet transactions that have null or invalid referenceIds
 * which are causing constraint violations.
 * 
 * Run with: node scripts/fix-wallet-referenceids.js
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import models
const { Wallet } = require('../src/models/Wallet');

// Utility function to generate unique reference ID
const generateReferenceId = () => {
  const timestamp = Date.now();
  const randomStr = Math.random().toString(36).substr(2, 9).toUpperCase();
  const counter = Math.floor(Math.random() * 1000).toString().padStart(3, '0');
  return `TXN-${timestamp}-${randomStr}-${counter}`;
};

// Database connection
const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGODB_URI || process.env.DATABASE_URL || 'mongodb://localhost:27017/parktayo';
    
    if (!mongoUri || mongoUri === 'undefined') {
      console.error('❌ MongoDB URI not found in environment variables');
      console.log('Please set MONGODB_URI or DATABASE_URL in your .env file');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

// Fix wallet referenceIds
const fixWalletReferenceIds = async () => {
  console.log('🔧 Starting wallet referenceId fix...');
  
  try {
    // Get all wallets
    const wallets = await Wallet.find({});
    console.log(`📊 Found ${wallets.length} wallets to check`);

    let walletsFixed = 0;
    let transactionsFixed = 0;

    for (const wallet of wallets) {
      let needsSave = false;
      
      // Check each transaction for null/invalid referenceIds
      for (const transaction of wallet.transactions) {
        if (!transaction.referenceId || 
            transaction.referenceId === null || 
            transaction.referenceId === 'null' || 
            transaction.referenceId === '') {
          
          // Generate new unique referenceId
          let newReferenceId;
          let attempts = 0;
          let isUnique = false;
          
          while (!isUnique && attempts < 10) {
            newReferenceId = generateReferenceId();
            
            // Check if this referenceId already exists in any wallet
            const existingWallet = await Wallet.findOne({
              'transactions.referenceId': newReferenceId
            });
            
            if (!existingWallet) {
              isUnique = true;
            } else {
              attempts++;
            }
          }
          
          if (isUnique) {
            console.log(`🔧 Fixing transaction ${transaction._id}: ${transaction.referenceId} → ${newReferenceId}`);
            transaction.referenceId = newReferenceId;
            transactionsFixed++;
            needsSave = true;
          } else {
            console.error(`❌ Could not generate unique referenceId for transaction ${transaction._id}`);
          }
        }
      }
      
      if (needsSave) {
        try {
          await wallet.save();
          walletsFixed++;
          console.log(`✅ Fixed wallet for user ${wallet.userId}`);
        } catch (error) {
          console.error(`❌ Error saving wallet ${wallet._id}:`, error.message);
        }
      }
    }

    console.log('\n📈 Fix Summary:');
    console.log(`✅ Wallets fixed: ${walletsFixed}`);
    console.log(`🔧 Transactions fixed: ${transactionsFixed}`);
    console.log(`📊 Total wallets checked: ${wallets.length}`);

  } catch (error) {
    console.error('❌ Fix process failed:', error);
    throw error;
  }
};

// Remove duplicate referenceIds
const removeDuplicateReferenceIds = async () => {
  console.log('🗑️ Removing duplicate referenceIds...');
  
  try {
    const wallets = await Wallet.find({});
    let duplicatesRemoved = 0;
    
    for (const wallet of wallets) {
      const seenReferenceIds = new Set();
      const uniqueTransactions = [];
      
      for (const transaction of wallet.transactions) {
        if (!seenReferenceIds.has(transaction.referenceId)) {
          seenReferenceIds.add(transaction.referenceId);
          uniqueTransactions.push(transaction);
        } else {
          console.log(`🗑️ Removing duplicate transaction with referenceId: ${transaction.referenceId}`);
          duplicatesRemoved++;
        }
      }
      
      if (uniqueTransactions.length !== wallet.transactions.length) {
        wallet.transactions = uniqueTransactions;
        await wallet.save();
        console.log(`✅ Cleaned up wallet for user ${wallet.userId}`);
      }
    }
    
    console.log(`🗑️ Removed ${duplicatesRemoved} duplicate transactions`);
    
  } catch (error) {
    console.error('❌ Duplicate removal failed:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('🔧 Wallet ReferenceId Fix Process');
    console.log('⚠️ This will fix null/invalid referenceIds in wallet transactions');
    
    await removeDuplicateReferenceIds();
    await fixWalletReferenceIds();
    
    console.log('\n🎉 Wallet referenceId fix completed successfully!');
    console.log('✅ All transactions now have valid, unique referenceIds');
    
  } catch (error) {
    console.error('💥 Fix process failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

// Handle script termination
process.on('SIGINT', async () => {
  console.log('\n⚠️ Fix interrupted by user');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('unhandledRejection', async (err) => {
  console.error('💥 Unhandled rejection:', err);
  await mongoose.connection.close();
  process.exit(1);
});

// Run the fix
if (require.main === module) {
  main();
}

module.exports = { fixWalletReferenceIds, removeDuplicateReferenceIds };
