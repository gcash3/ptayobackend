#!/usr/bin/env node

/**
 * Wallet Null ReferenceId Cleanup Script
 * 
 * This script removes transactions with null referenceIds from existing wallets
 * to fix the E11000 duplicate key error.
 * 
 * Run with: node scripts/cleanup-wallet-null-refs.js
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

// Clean up null referenceIds using MongoDB operations
const cleanupNullReferenceIds = async () => {
  console.log('🧹 Starting cleanup of null referenceIds...');
  
  try {
    const db = mongoose.connection.db;
    
    // Remove transactions with null, 'null', or empty referenceIds
    const result = await db.collection('wallets').updateMany(
      {},
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
    
    console.log(`✅ Updated ${result.modifiedCount} wallets`);
    
    // Also remove any duplicate index if it exists
    try {
      await db.collection('wallets').dropIndex('transactions.referenceId_1');
      console.log('✅ Dropped old referenceId index');
    } catch (e) {
      console.log('ℹ️ Old index not found (this is fine)');
    }
    
    // Get stats after cleanup
    const walletsWithNullRefs = await db.collection('wallets').countDocuments({
      'transactions.referenceId': { $in: [null, 'null', ''] }
    });
    
    console.log(`📊 Remaining wallets with null referenceIds: ${walletsWithNullRefs}`);
    
    if (walletsWithNullRefs === 0) {
      console.log('🎉 All null referenceIds cleaned up successfully!');
    } else {
      console.log('⚠️ Some null referenceIds remain - may need manual cleanup');
    }
    
  } catch (error) {
    console.error('❌ Cleanup failed:', error);
    throw error;
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('🧹 Wallet Null ReferenceId Cleanup');
    console.log('⚠️ This will remove transactions with null referenceIds');
    
    await cleanupNullReferenceIds();
    
    console.log('\n🎉 Cleanup completed successfully!');
    console.log('✅ You can now create wallets without duplicate key errors');
    
  } catch (error) {
    console.error('💥 Cleanup process failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

// Handle script termination
process.on('SIGINT', async () => {
  console.log('\n⚠️ Cleanup interrupted by user');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('unhandledRejection', async (err) => {
  console.error('💥 Unhandled rejection:', err);
  await mongoose.connection.close();
  process.exit(1);
});

// Run the cleanup
if (require.main === module) {
  main();
}

module.exports = { cleanupNullReferenceIds };
