#!/usr/bin/env node

/**
 * User Migration Script
 * 
 * This script migrates users from the legacy User model to the new discriminator models:
 * - BaseUser (base schema)
 * - Client (discriminator)
 * - Landlord (discriminator) 
 * - Admin (discriminator)
 * 
 * Run with: node scripts/migrate-users.js
 */

const mongoose = require('mongoose');
const path = require('path');

// Load environment variables
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import models
const User = require('../src/models/User'); // Legacy model (to migrate FROM)
const { BaseUser, Client, Landlord, Admin } = require('../src/models/UserModels');

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

// Migration functions
const migrateUsers = async () => {
  console.log('🚀 Starting user migration...');
  
  try {
    // Get all users from legacy User model
    const legacyUsers = await User.find({});
    console.log(`📊 Found ${legacyUsers.length} users to migrate`);

    let migratedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const legacyUser of legacyUsers) {
      try {
        // Check if user already exists in new BaseUser collection
        const existingUser = await BaseUser.findOne({ 
          $or: [
            { email: legacyUser.email },
            { _id: legacyUser._id }
          ]
        });
        
        if (existingUser) {
          console.log(`⏭️  User ${legacyUser.email} already migrated, skipping...`);
          skippedCount++;
          continue;
        }

        // Determine the appropriate model based on role
        let TargetModel;
        let userType;
        
        switch (legacyUser.role) {
          case 'admin':
            TargetModel = Admin;
            userType = 'Admin';
            break;
          case 'landlord':
            TargetModel = Landlord;
            userType = 'Landlord';
            break;
          case 'client':
          default:
            TargetModel = Client;
            userType = 'Client';
            break;
        }

        // Prepare user data for new model
        const userData = {
          ...legacyUser.toObject(),
          userType: userType,
          // Remove legacy fields that might conflict
          _id: legacyUser._id, // Keep the same ID
          __v: undefined,
        };

        // Remove the role field since it's replaced by userType discriminator
        delete userData.role;

        // Create new user with appropriate model
        const newUser = new TargetModel(userData);
        
        // Validate before saving
        await newUser.validate();
        
        // Save the new user
        await newUser.save();
        
        console.log(`✅ Migrated ${legacyUser.role} user: ${legacyUser.email} -> ${userType}`);
        migratedCount++;

      } catch (error) {
        console.error(`❌ Error migrating user ${legacyUser.email}:`, error.message);
        errorCount++;
      }
    }

    console.log('\n📈 Migration Summary:');
    console.log(`✅ Migrated: ${migratedCount} users`);
    console.log(`⏭️  Skipped: ${skippedCount} users (already migrated)`);
    console.log(`❌ Errors: ${errorCount} users`);
    console.log(`📊 Total processed: ${legacyUsers.length} users`);

    if (migratedCount > 0) {
      console.log('\n⚠️  IMPORTANT: After verifying the migration, you can remove legacy users with:');
      console.log('   node scripts/cleanup-legacy-users.js');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  }
};

// Verification function
const verifyMigration = async () => {
  console.log('\n🔍 Verifying migration...');
  
  try {
    const legacyUserCount = await User.countDocuments();
    const newUserCounts = {
      total: await BaseUser.countDocuments(),
      clients: await Client.countDocuments(),
      landlords: await Landlord.countDocuments(),
      admins: await Admin.countDocuments()
    };

    console.log('📊 User counts:');
    console.log(`   Legacy users: ${legacyUserCount}`);
    console.log(`   New users (total): ${newUserCounts.total}`);
    console.log(`   - Clients: ${newUserCounts.clients}`);
    console.log(`   - Landlords: ${newUserCounts.landlords}`);
    console.log(`   - Admins: ${newUserCounts.admins}`);

    // Verify discriminator totals match
    const discriminatorTotal = newUserCounts.clients + newUserCounts.landlords + newUserCounts.admins;
    if (discriminatorTotal === newUserCounts.total) {
      console.log('✅ Discriminator counts match total');
    } else {
      console.log('⚠️  Discriminator count mismatch - check for issues');
    }

  } catch (error) {
    console.error('❌ Verification failed:', error);
  }
};

// Main execution
const main = async () => {
  try {
    await connectDB();
    
    console.log('🔄 Starting database migration process...');
    console.log('⚠️  This will migrate users from the legacy User model to new discriminator models');
    console.log('⚠️  Make sure you have a database backup before proceeding!');
    
    // Wait for user confirmation in production
    if (process.env.NODE_ENV === 'production') {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      const answer = await new Promise(resolve => {
        rl.question('Continue with migration? (yes/no): ', resolve);
      });
      
      rl.close();
      
      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Migration cancelled');
        process.exit(0);
      }
    }
    
    await migrateUsers();
    await verifyMigration();
    
    console.log('\n🎉 Migration completed successfully!');
    
  } catch (error) {
    console.error('💥 Migration process failed:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    console.log('🔌 Database connection closed');
  }
};

// Handle script termination
process.on('SIGINT', async () => {
  console.log('\n⚠️  Migration interrupted by user');
  await mongoose.connection.close();
  process.exit(0);
});

process.on('unhandledRejection', async (err) => {
  console.error('💥 Unhandled rejection:', err);
  await mongoose.connection.close();
  process.exit(1);
});

// Run the migration
if (require.main === module) {
  main();
}

module.exports = { migrateUsers, verifyMigration };