#!/usr/bin/env node

/**
 * Wallet Index Fix Script
 * 
 * This script fixes the MongoDB index issue by:
 * 1. Dropping the old problematic index
 * 2. Creating a new partial index that ignores null values
 * 3. Cleaning up existing null referenceIds
 * 
 * Run with: node scripts/fix-wallet-index.js
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

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

// Fix wallet index issues
const fixWalletIndex = async () => {
  try {
    const db = mongoose.connection.db;
    const collection = db.collection('wallets');
    
    console.log('🔧 Starting wallet index fix...');
    
    // Step 1: Drop the problematic index
    try {
      await collection.dropIndex('transactions.referenceId_1');
      console.log('✅ Dropped old referenceId index');
    } catch (e) {
      console.log('ℹ️ Old index not found or already dropped:', e.message);
    }
    
    // Step 2: Clean up existing null referenceIds first
    console.log('🧹 Cleaning up null referenceIds...');
    const cleanupResult = await collection.updateMany(
      { 
        $or: [
          { 'transactions.referenceId': null },
          { 'transactions.referenceId': 'null' },
          { 'transactions.referenceId': '' },
          { 'transactions.referenceId': { $exists: false } }
        ]
      },
      { 
        $pull: { 
          transactions: { 
            $or: [
              { referenceId: null },
              { referenceId: 'null' },
              { referenceId: '' },
              { referenceId: { $exists: false } }
            ]
          } 
        } 
      }
    );
    console.log(`✅ Cleaned up ${cleanupResult.modifiedCount} wallets with null referenceIds`);
    
    // Step 3: Create new partial index that ignores null values
    try {
      await collection.createIndex(
        { 'transactions.referenceId': 1 },
        { 
          unique: true,
          partialFilterExpression: { 
            'transactions.referenceId': { 
              $exists: true,
              $type: 'string'
            } 
          },
          name: 'transactions_referenceId_partial_unique'
        }
      );
      console.log('✅ Created new partial index for referenceId');
    } catch (e) {
      console.log('ℹ️ Index creation result:', e.message);
    }
    
    // Step 4: Verify the fix by trying to create a wallet
    console.log('🧪 Testing wallet creation...');
    const testWallet = {
      userId: new mongoose.Types.ObjectId(),
      balance: 0,
      heldAmount: 0,
      availableBalance: 0,
      transactions: [],
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    const insertResult = await collection.insertOne(testWallet);
    console.log('✅ Test wallet created successfully:', insertResult.insertedId);
    
    // Clean up test wallet
    await collection.deleteOne({ _id: insertResult.insertedId });
    console.log('✅ Test wallet cleaned up');
    
    console.log('🎉 Wallet index fix completed successfully!');
    
  } catch (error) {
    console.error('❌ Error fixing wallet index:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    await fixWalletIndex();
  } catch (error) {
    console.error('❌ Script failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('👋 Disconnected from MongoDB');
    process.exit(0);
  }
};

// Run the script
if (require.main === module) {
  main();
}

module.exports = { fixWalletIndex };
