const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
  // Source database (your production parktayo database)
  sourceDB: 'parktayo',

  // Target database for debugging
  targetDB: 'parktayo_debug',

  // MongoDB connection string (update as needed)
  mongoHost: 'localhost:27017',

  // Backup directory
  backupDir: './db-backup'
};

console.log('🔄 Starting MongoDB database cloning process...');
console.log(`📦 Source: ${config.sourceDB}`);
console.log(`🎯 Target: ${config.targetDB}`);

try {
  // Create backup directory if it doesn't exist
  if (!fs.existsSync(config.backupDir)) {
    fs.mkdirSync(config.backupDir, { recursive: true });
    console.log(`📁 Created backup directory: ${config.backupDir}`);
  }

  // Step 1: Export the production database
  console.log('\n📤 Step 1: Exporting production database...');
  const exportCommand = `mongodump --host ${config.mongoHost} --db ${config.sourceDB} --out ${config.backupDir}`;

  try {
    execSync(exportCommand, { stdio: 'inherit' });
    console.log('✅ Export completed successfully!');
  } catch (error) {
    console.error('❌ Export failed:', error.message);
    process.exit(1);
  }

  // Step 2: Import to debug database
  console.log('\n📥 Step 2: Importing to debug database...');
  const importCommand = `mongorestore --host ${config.mongoHost} --db ${config.targetDB} ${path.join(config.backupDir, config.sourceDB)}`;

  try {
    execSync(importCommand, { stdio: 'inherit' });
    console.log('✅ Import completed successfully!');
  } catch (error) {
    console.error('❌ Import failed:', error.message);
    process.exit(1);
  }

  // Step 3: Verify the cloned database
  console.log('\n🔍 Step 3: Verifying cloned database...');

  // Connect to MongoDB and check collections
  const mongoose = require('mongoose');

  mongoose.connect(`mongodb://${config.mongoHost}/${config.targetDB}`)
    .then(async () => {
      console.log('📊 Connected to debug database');

      const collections = await mongoose.connection.db.listCollections().toArray();
      console.log(`📋 Found ${collections.length} collections:`);

      for (const collection of collections) {
        const count = await mongoose.connection.db.collection(collection.name).countDocuments();
        console.log(`  - ${collection.name}: ${count} documents`);
      }

      console.log('\n✨ Database cloning completed successfully!');
      console.log(`🎯 Debug database ready: ${config.targetDB}`);
      console.log('\n📝 To use the debug database, update your .env file:');
      console.log(`MONGODB_URI=mongodb://${config.mongoHost}/${config.targetDB}`);

      process.exit(0);
    })
    .catch(error => {
      console.error('❌ Verification failed:', error.message);
      process.exit(1);
    });

} catch (error) {
  console.error('❌ Database cloning failed:', error.message);
  process.exit(1);
}