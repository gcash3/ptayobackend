#!/usr/bin/env node

/**
 * Legacy User Cleanup Script
 * 
 * This script removes legacy User model documents after successful migration
 * to the new discriminator models.
 * 
 * ⚠️ WARNING: This is destructive and irreversible!
 * Only run after verifying migration was successful.
 * 
 * Run with: node scripts/cleanup-legacy-users.js
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import models
const User = require('../src/models/User'); // Legacy model
const { BaseUser } = require('../src/models/UserModels');

// Database connection
const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });
    console.log('✅ Connected to MongoDB');
  } catch (error) {
    console.error('❌ MongoDB connection failed:', error);
    process.exit(1);
  }
};

// Verification before cleanup
const verifyBeforeCleanup = async () => {
  console.log('🔍 Verifying migration completeness before cleanup...');
  
  try {
    const legacyUsers = await User.find({});
    const legacyCount = legacyUsers.length;
    
    if (legacyCount === 0) {
      console.log('ℹ️  No legacy users found to cleanup');
      return false;
    }

    console.log(`📊 Found ${legacyCount} legacy users`);

    // Check if all legacy users have been migrated
    let migratedCount = 0;
    let unmigrated = [];

    for (const legacyUser of legacyUsers) {
      const migratedUser = await BaseUser.findOne({ 
        email: legacyUser.email,
        _id: legacyUser._id 
      });
      
      if (migratedUser) {
        migratedCount++;
      } else {
        unmigrated.push(legacyUser.email);
      }
    }

    console.log(`✅ Migrated: ${migratedCount}/${legacyCount} users`);
    
    if (unmigrated.length > 0) {
      console.log('❌ The following users have NOT been migrated:');
      unmigrated.forEach(email => console.log(`   - ${email}`));
      console.log('⚠️  Cannot proceed with cleanup until all users are migrated');
      return false;
    }

    console.log('✅ All legacy users have been successfully migrated');
    return true;

  } catch (error) {
    console.error('❌ Verification failed:', error);
    return false;
  }
};

// Cleanup function
const cleanupLegacyUsers = async () => {
  console.log('🗑️  Starting legacy user cleanup...');
  
  try {
    // Get count before deletion
    const countBefore = await User.countDocuments();
    
    if (countBefore === 0) {
      console.log('ℹ️  No legacy users to cleanup');
      return;
    }

    // Delete all legacy users
    const result = await User.deleteMany({});
    
    console.log(`✅ Cleaned up ${result.deletedCount} legacy users`);
    
    // Verify cleanup
    const countAfter = await User.countDocuments();
    if (countAfter === 0) {
      console.log('✅ Cleanup verified - no legacy users remaining');
    } else {
      console.log(`⚠️  Warning: ${countAfter} legacy users still remain`);
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
    
    console.log('🗑️  Legacy User Cleanup Process');
    console.log('⚠️  WARNING: This will permanently delete all legacy User model documents!');
    console.log('⚠️  Only proceed if migration has been verified and tested!');
    
    // Verify migration completeness
    const canProceed = await verifyBeforeCleanup();
    
    if (!canProceed) {
      console.log('❌ Cleanup cancelled - migration not complete');
      process.exit(1);
    }

    // Get user confirmation
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('\n⚠️  FINAL WARNING: This action cannot be undone!');
    const answer = await new Promise(resolve => {
      rl.question('Type "DELETE" to confirm cleanup: ', resolve);
    });
    
    rl.close();
    
    if (answer !== 'DELETE') {
      console.log('❌ Cleanup cancelled - confirmation not provided');
      process.exit(0);
    }
    
    await cleanupLegacyUsers();
    
    console.log('\n🎉 Cleanup completed successfully!');
    console.log('✅ Legacy User model documents have been removed');
    console.log('✅ Your application now uses the new discriminator models exclusively');
    
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
  console.log('\n⚠️  Cleanup interrupted by user');
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

module.exports = { cleanupLegacyUsers, verifyBeforeCleanup };
