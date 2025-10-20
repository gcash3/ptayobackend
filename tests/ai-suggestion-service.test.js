const mongoose = require('mongoose');
const aiParkingSuggestionService = require('../src/services/aiParkingSuggestionService');
const ParkingSpace = require('../src/models/ParkingSpace');
const UserBehavior = require('../src/models/UserBehavior');
const AIScoringCache = require('../src/models/AIScoringCache');
const Booking = require('../src/models/Booking');

// Mock data for testing
const mockUserId = new mongoose.Types.ObjectId();
const mockParkingSpaceId = new mongoose.Types.ObjectId();

describe('AI Parking Suggestion Service', () => {
  beforeAll(async () => {
    // Connect to test database
    if (process.env.NODE_ENV !== 'test') {
      process.env.NODE_ENV = 'test';
    }
  });

  beforeEach(async () => {
    // Clear test data before each test
    await UserBehavior.deleteMany({});
    await AIScoringCache.deleteMany({});
    await ParkingSpace.deleteMany({});
    await Booking.deleteMany({});
  });

  describe('1. Cache Check Functionality', () => {
    test('should return cached suggestions when available', async () => {
      // Create mock cached suggestions
      const cachedSuggestion = new AIScoringCache({
        userId: mockUserId,
        filterType: 'nearby',
        parkingSpaceId: mockParkingSpaceId,
        location: {
          type: 'Point',
          coordinates: [120.9842, 14.5995] // Manila coordinates
        },
        aiScore: 85,
        factorScores: {
          userBehavior: 70,
          realTime: 80,
          contextual: 90
        },
        recommendationReason: 'High availability and good rating',
        metadata: {
          distance: 0.5,
          walkingTime: 6,
          estimatedPrice: 45
        },
        expiresAt: new Date(Date.now() + 30 * 60 * 1000) // 30 minutes from now
      });

      await cachedSuggestion.save();

      // Mock parking space for enrichment
      const mockParkingSpace = new ParkingSpace({
        _id: mockParkingSpaceId,
        name: 'Test Parking Space',
        location: {
          type: 'Point',
          coordinates: [120.9842, 14.5995]
        },
        address: 'Test Address, Manila',
        totalSpots: 50,
        availableSpots: 25,
        pricePer3Hours: 45,
        status: 'active',
        isVerified: true,
        averageRating: 4.2,
        operatingHours: {
          isOpen: true,
          is24Hours: true
        },
        securityFeatures: {
          hasLighting: true
        }
      });

      await mockParkingSpace.save();

      const userLocation = { latitude: 14.5995, longitude: 120.9842 };
      const options = {
        filterType: 'nearby',
        latitude: 14.5995,
        longitude: 120.9842,
        limit: 10,
        radiusKm: 5
      };

      const suggestions = await aiParkingSuggestionService.generateSuggestions(mockUserId.toString(), options);

      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0].metadata.cached).toBe(true);
      expect(suggestions[0].metadata.realTimeData).toBe(true);
      expect(suggestions[0].aiScore).toBe(85);

      console.log('✅ Cache check test passed - returned cached suggestions with real-time enrichment');
    });

    test('should skip cache and generate new suggestions when forceRefresh is true', async () => {
      // Create cached suggestion
      const cachedSuggestion = new AIScoringCache({
        userId: mockUserId,
        filterType: 'nearby',
        parkingSpaceId: mockParkingSpaceId,
        location: {
          type: 'Point',
          coordinates: [120.9842, 14.5995]
        },
        aiScore: 60,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000)
      });

      await cachedSuggestion.save();

      const options = {
        filterType: 'nearby',
        latitude: 14.5995,
        longitude: 120.9842,
        forceRefresh: true,
        limit: 10,
        radiusKm: 5
      };

      // Mock ParkingSpace.aggregate to return test data
      const mockAggregateResult = [{
        _id: new mongoose.Types.ObjectId(),
        name: 'Fresh Test Space',
        location: {
          type: 'Point',
          coordinates: [120.9842, 14.5995]
        },
        address: 'Fresh Address, Manila',
        totalSpots: 30,
        availableSpots: 15,
        pricePer3Hours: 50,
        status: 'active',
        isVerified: true,
        averageRating: 4.0,
        distance: 1.2,
        currentPrice: 50,
        occupancyRate: 50,
        demandScore: 75
      }];

      // Mock the aggregate method
      jest.spyOn(ParkingSpace, 'aggregate').mockResolvedValue(mockAggregateResult);

      const suggestions = await aiParkingSuggestionService.generateSuggestions(mockUserId.toString(), options);

      expect(suggestions).toBeDefined();
      expect(suggestions[0]?.metadata?.cached).toBeUndefined(); // Should not be cached

      console.log('✅ Force refresh test passed - bypassed cache and generated new suggestions');

      // Clean up mock
      ParkingSpace.aggregate.mockRestore();
    });
  });

  describe('2. User Behavior Analysis', () => {
    test('should analyze user behavior and calculate loyalty and predictability scores', async () => {
      // Create test bookings for user behavior analysis
      const testBookings = [
        {
          _id: new mongoose.Types.ObjectId(),
          userId: mockUserId,
          parkingSpaceId: mockParkingSpaceId,
          startTime: new Date('2024-01-15T09:00:00Z'),
          endTime: new Date('2024-01-15T12:00:00Z'),
          totalAmount: 45,
          status: 'completed',
          rating: 4.5
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: mockUserId,
          parkingSpaceId: mockParkingSpaceId,
          startTime: new Date('2024-01-16T09:30:00Z'),
          endTime: new Date('2024-01-16T12:30:00Z'),
          totalAmount: 45,
          status: 'completed',
          rating: 4.0
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: mockUserId,
          parkingSpaceId: new mongoose.Types.ObjectId(),
          startTime: new Date('2024-01-17T14:00:00Z'),
          endTime: new Date('2024-01-17T17:00:00Z'),
          totalAmount: 60,
          status: 'completed',
          rating: 3.5
        },
        {
          _id: new mongoose.Types.ObjectId(),
          userId: mockUserId,
          parkingSpaceId: new mongoose.Types.ObjectId(),
          startTime: new Date('2024-01-18T09:15:00Z'),
          endTime: new Date('2024-01-18T12:15:00Z'),
          totalAmount: 50,
          status: 'cancelled',
          rating: null
        }
      ];

      // Mock the Booking.find method to return our test bookings
      jest.spyOn(Booking, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue(testBookings.map(booking => ({
          ...booking,
          parkingSpaceId: {
            _id: booking.parkingSpaceId,
            university: 'University of Santo Tomas'
          }
        })))
      });

      // Test the behavior analysis
      const userBehavior = await aiParkingSuggestionService.getUserBehaviorAnalysis(mockUserId.toString());

      expect(userBehavior).toBeDefined();
      expect(userBehavior.aiMetrics).toBeDefined();
      expect(userBehavior.aiMetrics.totalBookings).toBe(4);
      expect(userBehavior.aiMetrics.completedBookings).toBe(3);
      expect(userBehavior.aiMetrics.cancelledBookings).toBe(1);
      expect(userBehavior.aiMetrics.loyaltyScore).toBeGreaterThan(0);
      expect(userBehavior.aiMetrics.loyaltyScore).toBeLessThanOrEqual(100);
      expect(userBehavior.aiMetrics.predictabilityScore).toBeGreaterThan(0);
      expect(userBehavior.aiMetrics.predictabilityScore).toBeLessThanOrEqual(100);
      expect(userBehavior.aiMetrics.averageRating).toBeCloseTo(4.0, 1);

      // Test booking patterns
      expect(userBehavior.bookingPatterns).toBeDefined();
      expect(userBehavior.bookingPatterns.preferredTimes).toContain('morning');
      expect(userBehavior.bookingPatterns.priceRange).toBeDefined();
      expect(userBehavior.bookingPatterns.priceRange.average).toBe(50); // (45+45+60+50)/4
      expect(userBehavior.bookingPatterns.frequentUniversities).toContain('University of Santo Tomas');

      console.log('✅ User behavior analysis test passed');
      console.log(`   Loyalty Score: ${userBehavior.aiMetrics.loyaltyScore}`);
      console.log(`   Predictability Score: ${userBehavior.aiMetrics.predictabilityScore}`);
      console.log(`   Average Rating: ${userBehavior.aiMetrics.averageRating}`);
      console.log(`   Preferred Times: ${userBehavior.bookingPatterns.preferredTimes.join(', ')}`);

      // Clean up mock
      Booking.find.mockRestore();
    });

    test('should handle new users with default behavior', async () => {
      const userBehavior = await aiParkingSuggestionService.getUserBehaviorAnalysis('new_user_id');

      expect(userBehavior).toBeDefined();
      expect(userBehavior.aiMetrics.totalBookings).toBe(0);
      expect(userBehavior.bookingPatterns.preferredTimes).toEqual(['morning', 'afternoon']);
      expect(userBehavior.bookingPatterns.priceRange.average).toBe(60);

      console.log('✅ New user behavior test passed - returned default preferences');
    });
  });

  describe('3. Candidate Filtering with Constraints', () => {
    test('should filter candidates based on location radius and filter type', async () => {
      // Create test parking spaces
      const testSpaces = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Budget Parking',
          location: {
            type: 'Point',
            coordinates: [120.9842, 14.5995] // Manila
          },
          status: 'active',
          isVerified: true,
          availableSpots: 10,
          totalSpots: 20,
          pricePer3Hours: 30, // Budget-friendly
          averageRating: 3.8,
          operatingHours: {
            isOpen: true,
            is24Hours: true
          },
          securityFeatures: {
            hasLighting: true
          }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Premium Parking',
          location: {
            type: 'Point',
            coordinates: [120.9850, 14.5990] // Nearby Manila
          },
          status: 'active',
          isVerified: true,
          availableSpots: 5,
          totalSpots: 10,
          pricePer3Hours: 100, // Expensive
          averageRating: 4.8,
          operatingHours: {
            isOpen: true,
            is24Hours: true
          },
          securityFeatures: {
            hasLighting: true
          }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Far Parking',
          location: {
            type: 'Point',
            coordinates: [121.0500, 14.6500] // Far from search location
          },
          status: 'active',
          isVerified: true,
          availableSpots: 15,
          totalSpots: 30,
          pricePer3Hours: 50,
          averageRating: 4.0,
          operatingHours: {
            isOpen: true,
            is24Hours: true
          },
          securityFeatures: {
            hasLighting: true
          }
        }
      ];

      // Mock ParkingSpace.aggregate for different filter types
      jest.spyOn(ParkingSpace, 'aggregate').mockImplementation((pipeline) => {
        const filterStage = pipeline.find(stage => stage.$match && stage.$match.$and);

        if (filterStage && filterStage.$match.$and.some(condition => condition.pricePer3Hours)) {
          // Price filter - should return only budget parking
          return Promise.resolve([testSpaces[0]]);
        } else if (filterStage && filterStage.$match.$and.some(condition => condition.averageRating)) {
          // Rating filter - should return only premium parking
          return Promise.resolve([testSpaces[1]]);
        } else {
          // Default nearby filter - return spaces within radius
          return Promise.resolve(testSpaces.slice(0, 2)); // Exclude far parking
        }
      });

      // Test price filter
      const priceFilteredCandidates = await aiParkingSuggestionService.getCandidateParkingSpaces(
        { latitude: 14.5995, longitude: 120.9842 },
        'price',
        5
      );

      expect(priceFilteredCandidates).toBeDefined();
      expect(priceFilteredCandidates.length).toBe(1);
      expect(priceFilteredCandidates[0].name).toBe('Budget Parking');

      // Test rating filter
      const ratingFilteredCandidates = await aiParkingSuggestionService.getCandidateParkingSpaces(
        { latitude: 14.5995, longitude: 120.9842 },
        'rating',
        5
      );

      expect(ratingFilteredCandidates).toBeDefined();
      expect(ratingFilteredCandidates.length).toBe(1);
      expect(ratingFilteredCandidates[0].name).toBe('Premium Parking');

      // Test nearby filter (should return both nearby spaces)
      const nearbyCandidates = await aiParkingSuggestionService.getCandidateParkingSpaces(
        { latitude: 14.5995, longitude: 120.9842 },
        'nearby',
        5
      );

      expect(nearbyCandidates).toBeDefined();
      expect(nearbyCandidates.length).toBe(2);
      expect(nearbyCandidates.some(space => space.name === 'Budget Parking')).toBe(true);
      expect(nearbyCandidates.some(space => space.name === 'Premium Parking')).toBe(true);
      expect(nearbyCandidates.some(space => space.name === 'Far Parking')).toBe(false);

      console.log('✅ Candidate filtering test passed');
      console.log(`   Price filter returned: ${priceFilteredCandidates.length} spaces`);
      console.log(`   Rating filter returned: ${ratingFilteredCandidates.length} spaces`);
      console.log(`   Nearby filter returned: ${nearbyCandidates.length} spaces`);

      // Clean up mock
      ParkingSpace.aggregate.mockRestore();
    });
  });

  describe('4. AI Scoring Computation', () => {
    test('should calculate weighted AI scores correctly', async () => {
      // Create test user behavior
      const testUserBehavior = new UserBehavior({
        userId: mockUserId,
        bookingPatterns: {
          preferredTimes: ['morning'],
          priceRange: { min: 25, max: 80, average: 50 },
          frequentUniversities: ['University of Santo Tomas'],
          frequentParkingSpaces: [mockParkingSpaceId]
        },
        aiMetrics: {
          totalBookings: 10,
          completedBookings: 9,
          cancelledBookings: 1,
          loyaltyScore: 85,
          predictabilityScore: 70,
          averageRating: 4.2
        }
      });

      await testUserBehavior.save();

      // Create test parking space
      const testParkingSpace = {
        _id: mockParkingSpaceId,
        name: 'Test Space',
        pricePer3Hours: 45,
        currentPrice: 45,
        availableSpots: 8,
        totalSpots: 20,
        averageRating: 4.0,
        university: 'University of Santo Tomas',
        realTimeData: {
          dynamicPricing: {
            currentMultiplier: 1.0
          }
        }
      };

      const userLocation = { latitude: 14.5995, longitude: 120.9842 };

      // Calculate AI score during morning time
      const originalHours = Date.prototype.getHours;
      Date.prototype.getHours = jest.fn(() => 9); // Mock morning time

      const aiScore = await aiParkingSuggestionService.calculateAIScore(
        testParkingSpace,
        testUserBehavior,
        userLocation,
        'smart'
      );

      expect(aiScore).toBeDefined();
      expect(aiScore.aiScore).toBeGreaterThan(0);
      expect(aiScore.aiScore).toBeLessThanOrEqual(100);
      expect(aiScore.factorScores).toBeDefined();
      expect(aiScore.factorScores.userBehavior).toBeDefined();
      expect(aiScore.factorScores.realTime).toBeDefined();
      expect(aiScore.factorScores.contextual).toBeDefined();

      // Verify user behavior score factors
      expect(aiScore.factorScores.userBehavior.factors.timePattern).toBe(25); // Morning match
      expect(aiScore.factorScores.userBehavior.factors.priceCompatibility).toBeGreaterThan(0); // Price within range
      expect(aiScore.factorScores.userBehavior.factors.locationFamiliarity).toBe(20); // Frequent space

      console.log('✅ AI scoring computation test passed');
      console.log(`   Final AI Score: ${aiScore.aiScore}`);
      console.log(`   User Behavior Score: ${aiScore.factorScores.userBehavior.score}`);
      console.log(`   Real Time Score: ${aiScore.factorScores.realTime.score}`);
      console.log(`   Contextual Score: ${aiScore.factorScores.contextual.score}`);
      console.log(`   Recommendation Reason: ${aiScore.recommendationReason}`);

      // Restore original function
      Date.prototype.getHours = originalHours;
    });

    test('should handle new users appropriately in scoring', async () => {
      const testParkingSpace = {
        _id: new mongoose.Types.ObjectId(),
        name: 'Test Space for New User',
        pricePer3Hours: 60,
        currentPrice: 60,
        availableSpots: 10,
        totalSpots: 20,
        averageRating: 4.2
      };

      const userLocation = { latitude: 14.5995, longitude: 120.9842 };

      const aiScore = await aiParkingSuggestionService.calculateAIScore(
        testParkingSpace,
        null, // New user with no behavior data
        userLocation,
        'nearby'
      );

      expect(aiScore).toBeDefined();
      expect(aiScore.aiScore).toBeGreaterThan(0);
      expect(aiScore.factorScores.userBehavior.score).toBe(45); // Default score for new users
      expect(aiScore.factorScores.userBehavior.factors.newUser).toBe(true);

      console.log('✅ New user AI scoring test passed');
      console.log(`   New User AI Score: ${aiScore.aiScore}`);
      console.log(`   New User Message: ${aiScore.factorScores.userBehavior.factors.message}`);
    });
  });

  describe('5. Result Ranking and Caching', () => {
    test('should rank results by composite AI score and cache suggestions', async () => {
      // Create user behavior
      const testUserBehavior = new UserBehavior({
        userId: mockUserId,
        bookingPatterns: {
          preferredTimes: ['morning'],
          priceRange: { min: 30, max: 100, average: 60 }
        },
        aiMetrics: {
          totalBookings: 5,
          completedBookings: 4,
          loyaltyScore: 70
        }
      });
      await testUserBehavior.save();

      // Mock multiple parking spaces with different scores
      const mockSpaces = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Low Score Space',
          pricePer3Hours: 120, // Too expensive
          currentPrice: 120,
          availableSpots: 2,
          totalSpots: 20,
          averageRating: 2.5,
          distance: 3.0
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'High Score Space',
          pricePer3Hours: 50, // Good price
          currentPrice: 50,
          availableSpots: 15,
          totalSpots: 20,
          averageRating: 4.5,
          distance: 0.5
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Medium Score Space',
          pricePer3Hours: 80,
          currentPrice: 80,
          availableSpots: 8,
          totalSpots: 20,
          averageRating: 3.8,
          distance: 1.2
        }
      ];

      // Mock ParkingSpace.aggregate to return our test spaces
      jest.spyOn(ParkingSpace, 'aggregate').mockResolvedValue(mockSpaces);

      const options = {
        filterType: 'smart',
        latitude: 14.5995,
        longitude: 120.9842,
        limit: 10,
        radiusKm: 5,
        forceRefresh: true
      };

      const suggestions = await aiParkingSuggestionService.generateSuggestions(mockUserId.toString(), options);

      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBeGreaterThan(0);

      // Verify suggestions are ranked by AI score (highest first)
      for (let i = 0; i < suggestions.length - 1; i++) {
        expect(suggestions[i].aiScore).toBeGreaterThanOrEqual(suggestions[i + 1].aiScore);
      }

      // Verify top suggestion is the high score space
      expect(suggestions[0].name).toBe('High Score Space');

      // Check that results were cached
      const cachedSuggestions = await AIScoringCache.find({ userId: mockUserId });
      expect(cachedSuggestions.length).toBeGreaterThan(0);

      console.log('✅ Result ranking and caching test passed');
      console.log('   Ranking order:');
      suggestions.forEach((suggestion, index) => {
        console.log(`   ${index + 1}. ${suggestion.name} - Score: ${suggestion.aiScore}`);
      });
      console.log(`   Cached ${cachedSuggestions.length} suggestions`);

      // Clean up mock
      ParkingSpace.aggregate.mockRestore();
    });
  });

  describe('6. Integration Test - Complete AI Flow', () => {
    test('should execute complete AI suggestion flow with all components', async () => {
      console.log('\n🚀 Running Complete AI Suggestion Flow Integration Test\n');

      // Step 1: Create comprehensive user behavior data
      const testBookings = Array.from({ length: 8 }, (_, i) => ({
        _id: new mongoose.Types.ObjectId(),
        userId: mockUserId,
        parkingSpaceId: i < 4 ? mockParkingSpaceId : new mongoose.Types.ObjectId(),
        startTime: new Date(Date.now() - (i * 24 * 60 * 60 * 1000)), // Different days
        endTime: new Date(Date.now() - (i * 24 * 60 * 60 * 1000) + (3 * 60 * 60 * 1000)), // 3 hours later
        totalAmount: 40 + (i * 10), // Varying prices
        status: i < 7 ? 'completed' : 'cancelled', // Mostly completed
        rating: i < 7 ? (4.0 + (i % 2) * 0.5) : null // Good ratings
      }));

      jest.spyOn(Booking, 'find').mockReturnValue({
        sort: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        populate: jest.fn().mockResolvedValue(testBookings.map(booking => ({
          ...booking,
          parkingSpaceId: {
            _id: booking.parkingSpaceId,
            university: 'University of the Philippines'
          }
        })))
      });

      // Step 2: Mock comprehensive parking space data
      const comprehensiveSpaces = [
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Perfect Match Space',
          location: { type: 'Point', coordinates: [120.9842, 14.5995] },
          pricePer3Hours: 50, // Matches user's average
          currentPrice: 50,
          availableSpots: 12,
          totalSpots: 20,
          averageRating: 4.3,
          university: 'University of the Philippines', // User's frequent university
          distance: 0.3,
          occupancyRate: 40,
          demandScore: 85,
          status: 'active',
          isVerified: true,
          operatingHours: { isOpen: true, is24Hours: true },
          securityFeatures: { hasLighting: true }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Budget Option Space',
          location: { type: 'Point', coordinates: [120.9850, 14.5990] },
          pricePer3Hours: 30, // Cheaper option
          currentPrice: 30,
          availableSpots: 18,
          totalSpots: 25,
          averageRating: 3.8,
          distance: 0.7,
          occupancyRate: 28,
          demandScore: 70,
          status: 'active',
          isVerified: true,
          operatingHours: { isOpen: true, is24Hours: true },
          securityFeatures: { hasLighting: true }
        },
        {
          _id: new mongoose.Types.ObjectId(),
          name: 'Premium Space',
          location: { type: 'Point', coordinates: [120.9835, 14.6000] },
          pricePer3Hours: 90, // More expensive
          currentPrice: 90,
          availableSpots: 5,
          totalSpots: 15,
          averageRating: 4.8,
          distance: 0.9,
          occupancyRate: 67,
          demandScore: 92,
          status: 'active',
          isVerified: true,
          operatingHours: { isOpen: true, is24Hours: true },
          securityFeatures: { hasLighting: true }
        }
      ];

      jest.spyOn(ParkingSpace, 'aggregate').mockResolvedValue(comprehensiveSpaces);

      // Step 3: Execute complete AI suggestion flow
      const options = {
        filterType: 'smart',
        latitude: 14.5995,
        longitude: 120.9842,
        limit: 10,
        radiusKm: 5,
        forceRefresh: true
      };

      console.log('Step 1: Generating AI suggestions...');
      const suggestions = await aiParkingSuggestionService.generateSuggestions(mockUserId.toString(), options);

      // Step 4: Comprehensive validation
      expect(suggestions).toBeDefined();
      expect(suggestions.length).toBe(3);
      expect(suggestions.every(s => s.aiScore > 0)).toBe(true);
      expect(suggestions.every(s => s.factorScores)).toBeDefined();
      expect(suggestions.every(s => s.recommendationReason)).toBeDefined();

      // Validate that perfect match scores highest (should consider user behavior)
      console.log('Step 2: Validating AI scoring results...');
      const perfectMatch = suggestions.find(s => s.name === 'Perfect Match Space');
      expect(perfectMatch).toBeDefined();

      // Perfect match should score well due to:
      // - Price match with user's average
      // - University familiarity
      // - Good availability
      expect(perfectMatch.aiScore).toBeGreaterThan(60);

      console.log('Step 3: Verifying component scores...');
      suggestions.forEach((suggestion, index) => {
        console.log(`\n   ${index + 1}. ${suggestion.name}:`);
        console.log(`      Overall AI Score: ${suggestion.aiScore}`);
        console.log(`      User Behavior Score: ${suggestion.factorScores.userBehavior.score}`);
        console.log(`      Real Time Score: ${suggestion.factorScores.realTime.score}`);
        console.log(`      Contextual Score: ${suggestion.factorScores.contextual.score}`);
        console.log(`      Reason: ${suggestion.recommendationReason}`);

        // Validate score components
        expect(suggestion.factorScores.userBehavior.score).toBeGreaterThanOrEqual(0);
        expect(suggestion.factorScores.userBehavior.score).toBeLessThanOrEqual(100);
        expect(suggestion.factorScores.realTime.score).toBeGreaterThanOrEqual(0);
        expect(suggestion.factorScores.realTime.score).toBeLessThanOrEqual(100);
        expect(suggestion.factorScores.contextual.score).toBeGreaterThanOrEqual(0);
        expect(suggestion.factorScores.contextual.score).toBeLessThanOrEqual(100);
      });

      // Step 5: Validate caching occurred
      console.log('Step 4: Verifying caching system...');
      const cachedResults = await AIScoringCache.find({ userId: mockUserId });
      expect(cachedResults.length).toBeGreaterThan(0);
      console.log(`   ✅ Cached ${cachedResults.length} suggestions successfully`);

      // Step 6: Test cache retrieval
      console.log('Step 5: Testing cache retrieval...');
      const cachedSuggestions = await aiParkingSuggestionService.generateSuggestions(mockUserId.toString(), {
        ...options,
        forceRefresh: false // Should use cache
      });

      expect(cachedSuggestions).toBeDefined();
      console.log(`   ✅ Retrieved ${cachedSuggestions.length} suggestions from cache`);

      console.log('\n✅ Complete AI Suggestion Flow Integration Test PASSED!\n');
      console.log('🎯 All components working correctly:');
      console.log('   ✓ User behavior analysis with loyalty/predictability scoring');
      console.log('   ✓ Advanced candidate filtering with constraints');
      console.log('   ✓ Weighted AI scoring computation');
      console.log('   ✓ Result ranking by composite scores');
      console.log('   ✓ Intelligent caching system');
      console.log('   ✓ Real-time data enrichment');

      // Clean up mocks
      Booking.find.mockRestore();
      ParkingSpace.aggregate.mockRestore();
    });
  });

  afterAll(async () => {
    // Clean up test database
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
    }
  });
});

// Helper function to run manual test
async function runManualTest() {
  console.log('\n🧪 Manual AI Suggestion Test\n');

  try {
    const testUserId = new mongoose.Types.ObjectId();
    const options = {
      filterType: 'smart',
      latitude: 14.5995, // Manila coordinates
      longitude: 120.9842,
      limit: 5,
      radiusKm: 10,
      forceRefresh: true
    };

    console.log('Testing AI suggestion generation...');
    const suggestions = await aiParkingSuggestionService.generateSuggestions(testUserId.toString(), options);

    console.log(`\n📊 Results: ${suggestions.length} suggestions generated\n`);

    suggestions.forEach((suggestion, index) => {
      console.log(`${index + 1}. ${suggestion.name || 'Unnamed Space'}`);
      console.log(`   AI Score: ${suggestion.aiScore}/100`);
      console.log(`   Distance: ${suggestion.metadata?.distance || 'N/A'}km`);
      console.log(`   Price: ₱${suggestion.currentPrice || suggestion.pricePer3Hours || 'N/A'}`);
      console.log(`   Available: ${suggestion.availableSpots}/${suggestion.totalSpots} spots`);
      console.log(`   Rating: ${suggestion.averageRating || 'N/A'}/5`);
      console.log(`   Reason: ${suggestion.recommendationReason}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Manual test failed:', error.message);
  }
}

module.exports = { runManualTest };