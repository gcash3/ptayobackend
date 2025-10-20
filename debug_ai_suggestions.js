const mongoose = require('mongoose');
const aiParkingSuggestionService = require('./src/services/aiParkingSuggestionService');

async function debugAISuggestions() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    const userLocation = {
      latitude: 14.60318,
      longitude: 120.988805
    };

    const userId = '68ce0ba86175edd31612769a'; // The test user ID
    const filterType = 'smart';
    const radiusKm = 5;

    console.log('\nTesting AI suggestions step by step:');

    // Step 1: Test getCandidateParkingSpaces directly
    console.log('\n1. Testing getCandidateParkingSpaces:');
    try {
      const candidates = await aiParkingSuggestionService.getCandidateParkingSpaces(userLocation, filterType, radiusKm);
      console.log(`Found ${candidates.length} candidates`);
      candidates.forEach((candidate, index) => {
        console.log(`  ${index + 1}. ${candidate.name}: ${candidate.distance?.toFixed(2) || 'N/A'}km, ${candidate.availableSpots}/${candidate.totalSpots} spots, score: ${candidate.aiScore || 'N/A'}`);
      });
    } catch (error) {
      console.error('Error in getCandidateParkingSpaces:', error.message);
      console.error('Stack:', error.stack);
    }

    // Step 2: Test getUserBehaviorAnalysis
    console.log('\n2. Testing getUserBehaviorAnalysis:');
    try {
      const userBehavior = await aiParkingSuggestionService.getUserBehaviorAnalysis(userId);
      console.log('User behavior found:', !!userBehavior);
      console.log('User behavior data:', JSON.stringify(userBehavior, null, 2));
    } catch (error) {
      console.error('Error in getUserBehaviorAnalysis:', error.message);
    }

    // Step 3: Test full generateAISuggestions
    console.log('\n3. Testing full generateAISuggestions:');
    try {
      const suggestions = await aiParkingSuggestionService.generateAISuggestions(userId, userLocation, filterType, 5, radiusKm);
      console.log(`Generated ${suggestions.length} suggestions`);
      suggestions.forEach((suggestion, index) => {
        console.log(`  ${index + 1}. ${suggestion.name}: Score ${suggestion.aiScore}, Distance ${suggestion.distance?.toFixed(2)}km`);
      });
    } catch (error) {
      console.error('Error in generateAISuggestions:', error.message);
      console.error('Stack:', error.stack);
    }

    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  } catch (error) {
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

debugAISuggestions();