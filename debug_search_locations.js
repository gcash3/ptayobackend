const mongoose = require('mongoose');
const SearchLocation = require('./src/models/SearchLocation');

// Database connection
mongoose.connect('mongodb://localhost:27017/parktayo', {
  useNewUrlParser: true,
  useUnifiedTopology: true
});

async function debugSearchLocations() {
  console.log('🔍 Debugging Search Locations Database...\n');

  try {
    const userId = '68dd40aca1fb21a809e7678e';

    // 1. Check all search locations for this user
    console.log('1. All search locations for user:');
    const allSearchLocations = await SearchLocation.find({ userId }).sort({ lastSearched: -1 });

    console.log(`   Found ${allSearchLocations.length} search locations`);
    allSearchLocations.forEach((loc, i) => {
      console.log(`   ${i+1}. ${loc.name}`);
      console.log(`      📍 ${loc.latitude}, ${loc.longitude}`);
      console.log(`      🔍 Search count: ${loc.searchCount}`);
      console.log(`      📅 Last searched: ${loc.lastSearched}`);
      console.log(`      🏷️ Category: ${loc.category}`);
      console.log(`      ✅ Active: ${loc.isActive}`);
      console.log('');
    });

    // 2. Test the getRecentLocationsForUser method
    console.log('2. Testing SearchLocation.getRecentLocationsForUser():');
    const recentFromMethod = await SearchLocation.getRecentLocationsForUser(userId, {
      limit: 10,
      timeframe: 90
    });

    console.log(`   Method returned ${recentFromMethod.length} locations`);
    recentFromMethod.forEach((loc, i) => {
      console.log(`   ${i+1}. ${loc.name} - ${loc.searchCount} searches`);
    });

    // 3. Check for any filters that might be excluding results
    console.log('\n3. Checking filtering criteria:');
    const dateThreshold = new Date();
    dateThreshold.setDate(dateThreshold.getDate() - 90);
    console.log(`   Date threshold (90 days ago): ${dateThreshold}`);

    const matchingLocations = await SearchLocation.find({
      userId: userId,
      isActive: true,
      lastSearched: { $gte: dateThreshold }
    });

    console.log(`   Locations matching criteria: ${matchingLocations.length}`);

  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    mongoose.disconnect();
  }
}

debugSearchLocations();