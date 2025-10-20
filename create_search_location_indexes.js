const mongoose = require('mongoose');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/parktayo', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function createSearchLocationIndexes() {
  console.log('🔧 Creating MongoDB indexes for SearchLocation...\n');

  try {
    // Wait for connection
    await new Promise((resolve, reject) => {
      if (mongoose.connection.readyState === 1) {
        resolve();
      } else {
        mongoose.connection.once('connected', resolve);
        mongoose.connection.once('error', reject);
      }
    });

    const db = mongoose.connection.db;
    const collection = db.collection('searchlocations');

    // Check existing indexes
    console.log('📋 Current indexes:');
    const existingIndexes = await collection.indexes();
    existingIndexes.forEach((index, i) => {
      console.log(`   ${i + 1}. ${index.name}: ${JSON.stringify(index.key)}`);
    });

    // Create geospatial index for location field
    console.log('\n🌍 Creating 2dsphere index for location field...');
    try {
      await collection.createIndex(
        { "location": "2dsphere" },
        {
          name: "location_2dsphere",
          background: true
        }
      );
      console.log('✅ Successfully created location_2dsphere index');
    } catch (error) {
      if (error.code === 85) {
        console.log('ℹ️ location_2dsphere index already exists');
      } else {
        console.error('❌ Error creating location_2dsphere index:', error.message);
      }
    }

    // Create compound index for userId and location (for better performance)
    console.log('\n👤 Creating compound index for userId + location...');
    try {
      await collection.createIndex(
        { "userId": 1, "location": "2dsphere" },
        {
          name: "userId_location_compound",
          background: true
        }
      );
      console.log('✅ Successfully created userId_location_compound index');
    } catch (error) {
      if (error.code === 85) {
        console.log('ℹ️ userId_location_compound index already exists');
      } else {
        console.error('❌ Error creating userId_location_compound index:', error.message);
      }
    }

    // Create additional useful indexes
    console.log('\n📊 Creating additional performance indexes...');

    // Index for searchCount queries
    try {
      await collection.createIndex(
        { "userId": 1, "searchCount": -1, "lastSearched": -1 },
        {
          name: "userId_searchCount_lastSearched",
          background: true
        }
      );
      console.log('✅ Successfully created userId_searchCount_lastSearched index');
    } catch (error) {
      if (error.code === 85) {
        console.log('ℹ️ userId_searchCount_lastSearched index already exists');
      } else {
        console.error('❌ Error creating userId_searchCount_lastSearched index:', error.message);
      }
    }

    // Index for category queries
    try {
      await collection.createIndex(
        { "userId": 1, "category": 1, "isActive": 1 },
        {
          name: "userId_category_isActive",
          background: true
        }
      );
      console.log('✅ Successfully created userId_category_isActive index');
    } catch (error) {
      if (error.code === 85) {
        console.log('ℹ️ userId_category_isActive index already exists');
      } else {
        console.error('❌ Error creating userId_category_isActive index:', error.message);
      }
    }

    // Verify final indexes
    console.log('\n📋 Final indexes after creation:');
    const finalIndexes = await collection.indexes();
    finalIndexes.forEach((index, i) => {
      console.log(`   ${i + 1}. ${index.name}: ${JSON.stringify(index.key)}`);
    });

    console.log('\n🎉 All indexes created successfully!');
    console.log('\n🔧 Now the SearchLocation geospatial queries should work correctly.');

  } catch (error) {
    console.error('❌ Error creating indexes:', error);
  } finally {
    mongoose.disconnect();
  }
}

createSearchLocationIndexes();