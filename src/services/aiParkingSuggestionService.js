const ParkingSpace = require('../models/ParkingSpace');
const UserBehavior = require('../models/UserBehavior');
const AIScoringCache = require('../models/AIScoringCache');
const Booking = require('../models/Booking');
const aiPricingUtils = require('../utils/aiPricingUtils');
const logger = require('../config/logger');

class AIParkingSuggestionService {
  constructor() {
    // New simplified weights based on user requirements (40% distance, 25% rating, 20% pricing, 15% amenities)
    this.weights = {
      distance: 0.40,      // Distance from destination
      rating: 0.25,        // Rating and review quality
      pricing: 0.20,       // Price competitiveness and value
      amenities: 0.15      // Available features and facilities
    };

    // Enhanced scoring for frequent destinations
    this.frequentLocationBonus = 15; // Extra points for parking near frequently visited places
    this.universityBonus = 10;       // Extra points for university-related locations
  }

  /**
   * Generate AI-powered parking suggestions for a user
   * @param {string} userId - User ID
   * @param {Object} options - Options for suggestions
   * @returns {Array} Scored parking suggestions
   */
  async generateSuggestions(userId, options = {}) {
    const {
      filterType = 'nearby',
      latitude,
      longitude,
      limit = 10,
      radiusKm = 5,
      forceRefresh = false
    } = options;

    try {
      logger.info(`🤖 Generating AI suggestions for user ${userId}`, { filterType, limit });

      // Check cache first (unless force refresh)
      if (!forceRefresh) {
        const cachedSuggestions = await this.getCachedSuggestions(userId, filterType, { latitude, longitude }, limit);
        if (cachedSuggestions.length > 0) {
          logger.info(`📦 Returning ${cachedSuggestions.length} cached suggestions (${filterType})`);
          return this.enrichSuggestionsWithRealTimeData(cachedSuggestions);
        }
      }

      // Get user location and behavior
      const userLocation = { latitude, longitude };
      const userBehavior = await this.getUserBehaviorAnalysis(userId);

      // Get candidate parking spaces (returns both candidates and metadata)
      const candidateResult = await this.getCandidateParkingSpaces(userLocation, filterType, radiusKm, userId);
      const candidates = candidateResult.candidates || candidateResult; // Handle both old and new return format
      const searchMetadata = candidateResult.metadata || {};

      if (candidates.length === 0) {
        logger.warn(`⚠️ No candidate parking spaces found for user ${userId}`);
        return [];
      }

      // Calculate AI scores for each candidate
      const scoredCandidates = await Promise.all(
        candidates.map(async (space) => {
          const score = await this.calculateAIScore(space, userBehavior, userLocation, filterType);
          // Add search metadata to each suggestion
          if (score && score.metadata) {
            score.metadata = { ...score.metadata, ...searchMetadata };
          } else if (score) {
            score.metadata = { ...searchMetadata };
          }
          return score;
        })
      );

      // Sort by AI score and return only the best candidate
      const suggestions = scoredCandidates
        .filter(candidate => {
          // Only include spaces that are currently open and available
          const isCurrentlyOpen = candidate.aiScore > 0;
          const hasAvailableSpots = candidate.availableSpots > 0;
          const isActive = candidate.status === 'active';

          if (!isCurrentlyOpen) {
            logger.info(`❌ Excluded ${candidate.name}: Not currently open (score: ${candidate.aiScore})`);
          } else if (!hasAvailableSpots) {
            logger.info(`❌ Excluded ${candidate.name}: No available spots (${candidate.availableSpots}/${candidate.totalSpots})`);
          } else if (!isActive) {
            logger.info(`❌ Excluded ${candidate.name}: Not active (status: ${candidate.status})`);
          } else {
            logger.info(`✅ Qualified ${candidate.name}: Open, available (${candidate.availableSpots}/${candidate.totalSpots}), score: ${candidate.aiScore}`);
          }

          return isCurrentlyOpen && hasAvailableSpots && isActive;
        })
        .sort((a, b) => b.aiScore - a.aiScore)
        .slice(0, 1); // Always return only 1 best candidate

      // Cache the results
      await this.cacheSuggestions(userId, filterType, userLocation, suggestions);

      // Add search metadata to the first suggestion so controller can access it
      if (suggestions.length > 0 && searchMetadata) {
        suggestions[0].metadata = {
          ...suggestions[0].metadata,
          searchCenter: searchMetadata.searchCenter,
          locationSource: searchMetadata.locationSource,
          frequentDestination: searchMetadata.frequentDestination
        };
      }

      logger.info(`✅ Generated ${suggestions.length} AI suggestions for user ${userId}`);
      return suggestions;

    } catch (error) {
      logger.error(`❌ Error generating AI suggestions: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get user behavior analysis for AI scoring
   */
  async getUserBehaviorAnalysis(userId) {
    try {
      let userBehavior = await UserBehavior.findOne({ userId });

      if (!userBehavior) {
        // Create default behavior for new users
        userBehavior = new UserBehavior({ userId });
        await userBehavior.save();
      }

      // Update behavior if it's stale (older than 7 days)
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      if (userBehavior.lastAnalyzed < weekAgo) {
        await this.updateUserBehaviorFromBookings(userId);
        userBehavior = await UserBehavior.findOne({ userId });
      }

      return userBehavior;
    } catch (error) {
      logger.error(`Error getting user behavior analysis: ${error.message}`);
      // Return default behavior on error
      return {
        bookingPatterns: {
          preferredTimes: ['morning', 'afternoon'],
          averageDuration: 3,
          priceRange: { min: 25, max: 100, average: 60 },
          frequentUniversities: [],
          parkingPreferences: []
        },
        aiMetrics: {
          totalBookings: 0,
          loyaltyScore: 0,
          predictabilityScore: 0
        }
      };
    }
  }

  /**
   * Get user's most frequent search destination for intelligent nearby suggestions
   */
  async getUserMostFrequentDestination(userId) {
    try {
      const SearchLocation = require('../models/SearchLocation');

      // Get user's most searched location (universities/schools preferred)
      const frequentLocation = await SearchLocation.findOne({
        userId,
        isActive: true,
        $or: [
          { category: { $in: ['university', 'college', 'school', 'institute', 'academy'] } },
          { searchCount: { $gte: 2 } } // Or any location searched more than once
        ]
      })
      .sort({
        searchCount: -1,           // Most searched first
        lastSearched: -1          // Recently searched as tie-breaker
      })
      .select('name latitude longitude category searchCount lastSearched');

      if (frequentLocation) {
        logger.info(`🎓 Found frequent destination: ${frequentLocation.name} (${frequentLocation.category}, searched ${frequentLocation.searchCount}x)`);
        return frequentLocation;
      }

      return null;
    } catch (error) {
      logger.warn(`Error getting frequent destination for user ${userId}: ${error.message}`);
      return null;
    }
  }

  /**
   * Get candidate parking spaces for AI analysis
   */
  async getCandidateParkingSpaces(userLocation, filterType, radiusKm = 5, userId = null) {
    try {
      let aggregationPipeline = [];

      // For "nearby" filter, use user's frequent search destinations instead of current location
      let searchCenter = userLocation;
      let frequentDestination = null;
      let locationSource = 'gps';

      if (filterType === 'nearby' && userId) {
        frequentDestination = await this.getUserMostFrequentDestination(userId);
        if (frequentDestination) {
          searchCenter = {
            latitude: frequentDestination.latitude,
            longitude: frequentDestination.longitude
          };
          locationSource = 'frequent_search';
          logger.info(`🎯 Using frequent destination for nearby search: ${frequentDestination.name} (${frequentDestination.latitude}, ${frequentDestination.longitude})`);
        } else {
          logger.info(`📍 No frequent destinations found for user ${userId}, returning empty suggestions for 'nearby' filter`);
          // Return empty results when no search history exists
          return {
            candidates: [],
            metadata: {
              searchCenter: null,
              locationSource: 'no_search_history',
              frequentDestination: null,
              message: 'No recent search locations found. Search for places first to get nearby parking suggestions.'
            }
          };
        }
      }

      // Add geospatial filtering first if coordinates provided (must be first stage)
      if (searchCenter.latitude && searchCenter.longitude) {
        aggregationPipeline.push({
          $geoNear: {
            near: {
              type: 'Point',
              coordinates: [searchCenter.longitude, searchCenter.latitude]
            },
            distanceField: 'distance',
            maxDistance: radiusKm * 1000, // Convert km to meters
            spherical: true,
            distanceMultiplier: 0.001, // Convert meters to km
            query: {
              status: 'active',
              isVerified: true,
              availableSpots: { $gt: 0 }
              // Note: Operating hours validation will be done by time filter
            }
          }
        });
      } else {
        // Fallback: Base query for active, verified parking spaces (no geospatial filter)
        aggregationPipeline.push({
          $match: {
            status: 'active',
            isVerified: true,
            availableSpots: { $gt: 0 }
            // Note: Operating hours validation will be done by time filter
          }
        });
      }

      // Apply filter-specific constraints
      const filterConstraints = this.getFilterConstraints(filterType);
      if (filterConstraints) {
        aggregationPipeline.push({ $match: filterConstraints });
      }

      // Add calculated fields for AI scoring
      aggregationPipeline.push({
        $addFields: {
          occupancyRate: {
            $multiply: [
              { $divide: [{ $subtract: ['$totalSpots', '$availableSpots'] }, '$totalSpots'] },
              100
            ]
          },
          currentPrice: {
            $multiply: [
              '$pricePer3Hours',
              { $ifNull: ['$realTimeData.dynamicPricing.currentMultiplier', 1.0] }
            ]
          },
          demandScore: {
            $add: [
              { $multiply: ['$bookingStats.totalBookings', 0.4] },
              { $multiply: ['$averageRating', 20] },
              { $multiply: [{ $ifNull: ['$aiMetrics.popularityScore', 50] }, 0.4] }
            ]
          }
        }
      });

      // Filter by operating hours using TimeValidationUtils structure
      const timeValidationUtils = require('../utils/timeValidationUtils');
      const timeFilter = timeValidationUtils.generateTimeBasedFilter();
      aggregationPipeline.push({ $match: timeFilter });

      // Log current time filtering
      const hkTime = timeValidationUtils.getHongKongTime();
      const dayName = timeValidationUtils.getDayName(hkTime);
      const currentHour = hkTime.getHours();
      const currentMinute = hkTime.getMinutes();
      logger.info(`🕐 Filtering for spaces open NOW: ${dayName} ${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')} (Hong Kong time)`);

      // Apply additional quality filters (relaxed for testing)
      aggregationPipeline.push({
        $match: {
          $and: [
            { totalSpots: { $gte: 1 } }, // Minimum capacity (relaxed)
            { averageRating: { $gte: 0 } }, // Minimum quality (relaxed)
            // Temporarily disabled: { 'securityFeatures.hasLighting': true }, // Safety requirement
            { occupancyRate: { $lt: 99 } } // Not completely full (relaxed)
          ]
        }
      });

      // Sort by relevance and limit results
      const sortCriteria = this.getSortCriteria(filterType);
      aggregationPipeline.push({ $sort: sortCriteria });
      aggregationPipeline.push({ $limit: 50 });

      logger.info(`🔍 Filtering candidates with ${filterType} criteria within ${radiusKm}km`);

      const candidates = await ParkingSpace.aggregate(aggregationPipeline);

      // Mark candidates near frequent destinations for enhanced scoring
      if (frequentDestination && filterType === 'nearby') {
        candidates.forEach(candidate => {
          candidate.nearFrequentDestination = true;
          candidate.destinationType = frequentDestination.category || 'frequent';
          candidate.frequentDestinationName = frequentDestination.name;
        });
      }

      logger.info(`✅ Found ${candidates.length} qualified candidate parking spaces`);

      return {
        candidates,
        metadata: {
          searchCenter,
          locationSource,
          frequentDestination: frequentDestination ? {
            name: frequentDestination.name,
            latitude: frequentDestination.latitude,
            longitude: frequentDestination.longitude,
            category: frequentDestination.category,
            searchCount: frequentDestination.searchCount
          } : null
        }
      };
    } catch (error) {
      logger.error(`Error getting candidate parking spaces: ${error.message}`);
      return {
        candidates: [],
        metadata: {
          searchCenter: userLocation,
          locationSource: 'gps',
          frequentDestination: null
        }
      };
    }
  }

  /**
   * Get filter-specific constraints
   */
  getFilterConstraints(filterType) {
    switch (filterType) {
      case 'price':
        return {
          $and: [
            { pricePer3Hours: { $lte: 80 } }, // Budget-friendly threshold
            { currentPrice: { $lte: 100 } } // Including dynamic pricing
          ]
        };

      case 'rating':
        return {
          $and: [
            { averageRating: { $gte: 4.0 } },
            { 'bookingStats.totalBookings': { $gte: 10 } } // Minimum reviews for credibility
          ]
        };

      case 'availability':
        return {
          $and: [
            { availableSpots: { $gte: 3 } }, // Multiple spots available
            { occupancyRate: { $lt: 80 } } // Not too crowded
          ]
        };

      case 'smart':
        return {
          $and: [
            { 'aiMetrics.popularityScore': { $gte: 60 } },
            { demandScore: { $gte: 80 } },
            { averageRating: { $gte: 3.5 } }
          ]
        };

      case 'distance':
        return {
          distance: { $exists: true } // Ensure distance is calculated
        };

      default: // 'nearby'
        return null; // No additional constraints
    }
  }

  /**
   * Get sorting criteria based on filter type
   */
  getSortCriteria(filterType) {
    switch (filterType) {
      case 'price':
        return { currentPrice: 1, distance: 1 }; // Cheapest first, then closest

      case 'rating':
        return { averageRating: -1, 'bookingStats.totalBookings': -1 }; // Highest rated first

      case 'availability':
        return { availableSpots: -1, occupancyRate: 1 }; // Most available first

      case 'smart':
        return { demandScore: -1, 'aiMetrics.popularityScore': -1 }; // AI-determined relevance

      case 'distance':
        return { distance: 1 }; // Closest first

      default: // 'nearby'
        return { distance: 1, averageRating: -1 }; // Closest first, then best rated
    }
  }

  /**
   * Calculate AI score for a parking space with new weighted scoring (40% distance, 25% rating, 20% pricing, 15% amenities)
   */
  async calculateAIScore(parkingSpace, userBehavior, userLocation, filterType) {
    try {
      // Calculate individual component scores (0-100 scale)
      const distanceScore = this.calculateDistanceScore(parkingSpace, userLocation);
      const ratingScore = this.calculateRatingScore(parkingSpace);
      const pricingScore = await this.calculatePricingScore(parkingSpace, userBehavior);
      const amenitiesScore = this.calculateAmenitiesScore(parkingSpace);

      // Apply weighted scoring: 40% distance, 25% rating, 20% pricing, 15% amenities
      const weightedDistance = distanceScore.score * this.weights.distance;
      const weightedRating = ratingScore.score * this.weights.rating;
      const weightedPricing = pricingScore.score * this.weights.pricing;
      const weightedAmenities = amenitiesScore.score * this.weights.amenities;

      const compositeScore = weightedDistance + weightedRating + weightedPricing + weightedAmenities;

      // Log detailed scoring breakdown
      logger.info(`📊 Scoring breakdown for ${parkingSpace.name}:
        Distance: ${distanceScore.score.toFixed(1)}/100 × 40% = ${weightedDistance.toFixed(1)}
        Rating: ${ratingScore.score.toFixed(1)}/100 × 25% = ${weightedRating.toFixed(1)}
        Pricing: ${pricingScore.score.toFixed(1)}/100 × 20% = ${weightedPricing.toFixed(1)}
        Amenities: ${amenitiesScore.score.toFixed(1)}/100 × 15% = ${weightedAmenities.toFixed(1)}
        TOTAL: ${compositeScore.toFixed(1)}/100`);

      // Apply availability multiplier (if no spots available, heavily penalize)
      const availabilityMultiplier = this.getAvailabilityMultiplier(parkingSpace);
      const finalScore = Math.round(compositeScore * availabilityMultiplier);

      // Generate recommendation reason based on strongest factor
      const recommendationReason = this.generateRecommendationReason(
        distanceScore,
        ratingScore,
        pricingScore,
        amenitiesScore,
        availabilityMultiplier
      );

      // Calculate metadata for the suggestion
      const metadata = await this.calculateMetadata(parkingSpace, userLocation);

      return {
        ...parkingSpace,
        aiScore: Math.max(0, Math.min(100, finalScore)),
        factorScores: {
          distance: {
            score: distanceScore.score,
            weight: this.weights.distance,
            factors: distanceScore.factors
          },
          rating: {
            score: ratingScore.score,
            weight: this.weights.rating,
            factors: ratingScore.factors
          },
          pricing: {
            score: pricingScore.score,
            weight: this.weights.pricing,
            factors: pricingScore.factors
          },
          amenities: {
            score: amenitiesScore.score,
            weight: this.weights.amenities,
            factors: amenitiesScore.factors
          }
        },
        availabilityMultiplier,
        recommendationReason,
        metadata
      };

    } catch (error) {
      logger.error(`Error calculating AI score: ${error.message}`);
      return {
        ...parkingSpace,
        aiScore: 0,
        recommendationReason: 'Error calculating recommendation',
        metadata: {}
      };
    }
  }

  /**
   * Calculate distance score (0-100) - 40% weight
   * Closer distances get higher scores
   */
  calculateDistanceScore(parkingSpace, userLocation) {
    const factors = {};

    if (!userLocation?.latitude || !userLocation?.longitude) {
      // No location data - return neutral score
      return {
        score: 50,
        factors: { noLocation: true, message: 'Location unavailable' }
      };
    }

    const distance = this.calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      parkingSpace.latitude,
      parkingSpace.longitude
    );

    let score;
    if (distance <= 0.1) {        // 100m or less
      score = 100;
      factors.category = 'extremely_close';
    } else if (distance <= 0.2) { // 200m
      score = 90;
      factors.category = 'very_close';
    } else if (distance <= 0.5) { // 500m
      score = 80;
      factors.category = 'close';
    } else if (distance <= 1.0) { // 1km
      score = 60;
      factors.category = 'nearby';
    } else if (distance <= 2.0) { // 2km
      score = 40;
      factors.category = 'moderate';
    } else if (distance <= 5.0) { // 5km
      score = 20;
      factors.category = 'far';
    } else {                      // >5km
      score = 5;
      factors.category = 'very_far';
    }

    factors.distance = Math.round(distance * 1000); // meters
    factors.walkingTime = Math.ceil(distance * 12); // minutes (12 min/km walking)

    return { score, factors };
  }

  /**
   * Calculate rating score (0-100) - 25% weight
   * Higher ratings and more reviews get higher scores
   */
  calculateRatingScore(parkingSpace) {
    const factors = {};
    const rating = parkingSpace.averageRating || 0;
    // Use totalRatings (actual ratings) instead of totalBookings for accurate review count
    const reviewCount = parkingSpace.totalRatings || 0;

    // Debug logging for rating issues
    logger.info(`📊 ${parkingSpace.name}: averageRating=${rating}, totalRatings=${reviewCount}`);

    // If no reviews/ratings exist, score is 0
    if (reviewCount === 0) {
      factors.category = 'no_reviews';
      factors.rating = 0;
      factors.reviewCount = 0;
      factors.credibilityMultiplier = 0;
      factors.baseScore = 0;
      logger.info(`📊 ${parkingSpace.name}: No reviews - Rating score = 0`);
      return { score: 0, factors };
    }

    // Calculate base score from actual average rating
    let baseScore;
    if (rating >= 4.8) {
      baseScore = 100;
      factors.category = 'excellent';
    } else if (rating >= 4.5) {
      baseScore = 90;
      factors.category = 'very_good';
    } else if (rating >= 4.0) {
      baseScore = 75;
      factors.category = 'good';
    } else if (rating >= 3.5) {
      baseScore = 60;
      factors.category = 'fair';
    } else if (rating >= 3.0) {
      baseScore = 40;
      factors.category = 'average';
    } else if (rating >= 2.0) {
      baseScore = 25;
      factors.category = 'below_average';
    } else {
      baseScore = 10;
      factors.category = 'poor';
    }

    // Adjust score based on review count (credibility factor)
    let credibilityMultiplier = 1.0;
    if (reviewCount >= 50) {
      credibilityMultiplier = 1.0;   // High credibility
      factors.credibility = 'high';
    } else if (reviewCount >= 20) {
      credibilityMultiplier = 0.95;  // Good credibility
      factors.credibility = 'good';
    } else if (reviewCount >= 5) {
      credibilityMultiplier = 0.9;   // Fair credibility
      factors.credibility = 'fair';
    } else if (reviewCount >= 2) {
      credibilityMultiplier = 0.85;  // Low credibility
      factors.credibility = 'low';
    } else {
      credibilityMultiplier = 0.75;  // Very low credibility for 1 review
      factors.credibility = 'very_low';
    }

    const finalScore = Math.round(baseScore * credibilityMultiplier);

    factors.rating = rating;
    factors.reviewCount = reviewCount;
    factors.credibilityMultiplier = credibilityMultiplier;
    factors.baseScore = baseScore;

    logger.info(`📊 ${parkingSpace.name}: Rating score = ${finalScore} (base: ${baseScore}, multiplier: ${credibilityMultiplier})`);

    return { score: finalScore, factors };
  }

  /**
   * Calculate pricing score (0-100) - 20% weight
   * Better value (lower price, reasonable for area) gets higher score
   */
  async calculatePricingScore(parkingSpace, userBehavior) {
    const factors = {};

    try {
      // Get accurate total cost including all fees
      const { totalCost } = await aiPricingUtils.calculateTotalCostForAI(parkingSpace);

      // Analyze user spending patterns for personalization
      let userSpendingPattern;
      if (userBehavior && userBehavior.bookingPatterns?.priceRange) {
        userSpendingPattern = userBehavior.bookingPatterns.priceRange;
      } else {
        // Use default spending patterns for new users
        userSpendingPattern = { min: 30, max: 120, average: 70 };
      }

      factors.totalCost = totalCost;
      factors.userAverageSpend = userSpendingPattern.average;

      let score;
      const avgSpend = userSpendingPattern.average;

      if (totalCost <= avgSpend * 0.7) {      // 30% below user average
        score = 100;
        factors.category = 'excellent_value';
      } else if (totalCost <= avgSpend * 0.85) { // 15% below user average
        score = 90;
        factors.category = 'great_value';
      } else if (totalCost <= avgSpend) {        // At or below user average
        score = 80;
        factors.category = 'good_value';
      } else if (totalCost <= avgSpend * 1.2) {  // 20% above user average
        score = 60;
        factors.category = 'fair_value';
      } else if (totalCost <= avgSpend * 1.5) {  // 50% above user average
        score = 40;
        factors.category = 'expensive';
      } else {                                   // >50% above user average
        score = 20;
        factors.category = 'very_expensive';
      }

      // Bonus for transparent pricing (no hidden fees)
      if (parkingSpace.pricing?.transparentPricing) {
        score += 5;
        factors.transparencyBonus = 5;
      }

      return { score: Math.min(100, score), factors };

    } catch (error) {
      logger.warn(`Pricing calculation error for ${parkingSpace.name}: ${error.message}`);

      // Fallback to basic price evaluation
      const basePrice = parkingSpace.pricePer3Hours || 60;
      factors.fallbackUsed = true;
      factors.basePrice = basePrice;

      let score;
      if (basePrice <= 40) {
        score = 90;
        factors.category = 'budget_friendly';
      } else if (basePrice <= 60) {
        score = 75;
        factors.category = 'reasonable';
      } else if (basePrice <= 80) {
        score = 60;
        factors.category = 'moderate';
      } else if (basePrice <= 100) {
        score = 45;
        factors.category = 'expensive';
      } else {
        score = 30;
        factors.category = 'very_expensive';
      }

      return { score, factors };
    }
  }

  /**
   * Calculate amenities score (0-100) - 15% weight
   * More and better amenities get higher scores
   */
  calculateAmenitiesScore(parkingSpace) {
    const factors = {};
    const amenities = parkingSpace.amenities || [];
    const securityFeatures = parkingSpace.securityFeatures || {};

    let score = 30; // Base score

    // Essential amenities (high value)
    const essentialAmenities = [
      'security', 'lighting', 'cctv', 'security_guard', 'covered', 'roofed'
    ];

    // Convenience amenities (medium value)
    const convenienceAmenities = [
      'restroom', 'elevator', 'escalator', 'wheelchair_accessible', 'electric_charging'
    ];

    // Premium amenities (bonus value)
    const premiumAmenities = [
      'valet', 'car_wash', 'maintenance', '24_hour_access', 'air_conditioning'
    ];

    // Check essential amenities (up to 40 points)
    const hasEssential = amenities.filter(a =>
      essentialAmenities.some(ea => a.toLowerCase().includes(ea))
    );
    const essentialScore = Math.min(40, hasEssential.length * 10);
    score += essentialScore;
    factors.essentialAmenities = hasEssential.length;
    factors.essentialScore = essentialScore;

    // Check convenience amenities (up to 20 points)
    const hasConvenience = amenities.filter(a =>
      convenienceAmenities.some(ca => a.toLowerCase().includes(ca))
    );
    const convenienceScore = Math.min(20, hasConvenience.length * 5);
    score += convenienceScore;
    factors.convenienceAmenities = hasConvenience.length;
    factors.convenienceScore = convenienceScore;

    // Check premium amenities (up to 10 points)
    const hasPremium = amenities.filter(a =>
      premiumAmenities.some(pa => a.toLowerCase().includes(pa))
    );
    const premiumScore = Math.min(10, hasPremium.length * 3);
    score += premiumScore;
    factors.premiumAmenities = hasPremium.length;
    factors.premiumScore = premiumScore;

    // Security features bonus (from securityFeatures object)
    if (securityFeatures.hasLighting) {
      score += 5;
      factors.lightingBonus = 5;
    }
    if (securityFeatures.hasCCTV) {
      score += 5;
      factors.cctvBonus = 5;
    }
    if (securityFeatures.hasSecurityGuard) {
      score += 5;
      factors.guardBonus = 5;
    }

    factors.totalAmenities = amenities.length;
    factors.finalScore = Math.min(100, score);

    return { score: Math.min(100, score), factors };
  }

  /**
   * Calculate user behavior score (0-100) with accurate pricing
   */
  async calculateUserBehaviorScore(parkingSpace, userBehavior, userLocation) {
    const factors = {};
    let totalScore = 40; // Base score for new users

    // Handle new users with organic learning approach
    if (!userBehavior || !userBehavior.aiMetrics || userBehavior.aiMetrics.totalBookings === 0) {
      return await this.calculateNewUserScore(parkingSpace, userLocation);
    }

    // Factor 1: Time pattern compatibility (25 points)
    const currentHour = new Date().getHours();
    let timeSlot;
    if (currentHour >= 6 && currentHour < 12) timeSlot = 'morning';
    else if (currentHour >= 12 && currentHour < 17) timeSlot = 'afternoon';
    else if (currentHour >= 17 && currentHour < 22) timeSlot = 'evening';
    else timeSlot = 'night';

    if (userBehavior.bookingPatterns?.preferredTimes?.includes(timeSlot)) {
      factors.timePattern = 25;
      totalScore += 25;
    } else if (userBehavior.bookingPatterns?.preferredTimes?.length === 0) {
      factors.timePattern = 10; // Neutral for no pattern yet
      totalScore += 10;
    } else {
      factors.timePattern = -5; // Minor penalty for off-pattern
      totalScore -= 5;
    }

    // Factor 2: Accurate price compatibility with total cost (25 points)
    const userBookings = await Booking.find({ userId: userBehavior.userId }).limit(20);
    const userSpendingPattern = aiPricingUtils.analyzeUserSpendingPatterns(userBookings);

    // Get accurate total cost including dynamic pricing and service fees
    const { totalCost } = await aiPricingUtils.calculateTotalCostForAI(parkingSpace);

    const priceCompatibility = aiPricingUtils.calculatePriceCompatibilityScore(totalCost, userSpendingPattern);
    factors.priceCompatibility = priceCompatibility.score;
    factors.priceFactors = priceCompatibility.factors;
    factors.priceCategory = priceCompatibility.priceCategory;
    totalScore += priceCompatibility.score;

    // Factor 3: Location and university familiarity (20 points)
    const frequentSpaces = userBehavior.bookingPatterns?.frequentParkingSpaces || [];
    const frequentUniversities = userBehavior.bookingPatterns?.frequentUniversities || [];

    // Check exact space familiarity
    const isFrequentSpace = frequentSpaces.some(
      fps => fps.toString() === parkingSpace._id.toString()
    );

    // Check university familiarity
    const isFrequentUniversity = parkingSpace.university &&
      frequentUniversities.includes(parkingSpace.university);

    if (isFrequentSpace) {
      factors.locationFamiliarity = 20;
      totalScore += 20;
    } else if (isFrequentUniversity) {
      factors.locationFamiliarity = 12;
      totalScore += 12;
    } else {
      factors.locationFamiliarity = 2; // Small bonus for exploration
      totalScore += 2;
    }

    // Factor 4: Loyalty and predictability bonus (15 points)
    const loyaltyScore = userBehavior.aiMetrics?.loyaltyScore || 0;
    const predictabilityScore = userBehavior.aiMetrics?.predictabilityScore || 0;

    if (loyaltyScore >= 80) {
      factors.loyaltyBonus = 15;
      totalScore += 15;
    } else if (loyaltyScore >= 60) {
      factors.loyaltyBonus = 10;
      totalScore += 10;
    } else if (loyaltyScore >= 40) {
      factors.loyaltyBonus = 5;
      totalScore += 5;
    } else {
      factors.loyaltyBonus = 0;
    }

    // Factor 5: Frequent destination bonus (NEW - 15 points)
    // Check if parking space is near user's frequently searched destinations
    if (parkingSpace.nearFrequentDestination) {
      factors.frequentDestinationBonus = this.frequentLocationBonus;
      totalScore += this.frequentLocationBonus;

      // Extra bonus for university-related destinations
      if (parkingSpace.destinationType === 'university' || parkingSpace.category === 'university') {
        factors.universityBonus = this.universityBonus;
        totalScore += this.universityBonus;
      }
    } else {
      factors.frequentDestinationBonus = 0;
      factors.universityBonus = 0;
    }

    // Factor 6: Rating alignment (15 points - increased importance)
    const userAvgRating = userBehavior.aiMetrics?.averageRating || 0;
    const spaceRating = parkingSpace.averageRating || 0;

    // Enhanced rating scoring (up to 15 points) - absolute rating quality
    if (spaceRating >= 4.5) {
      factors.ratingAlignment = 15; // Excellent rating
      totalScore += 15;
    } else if (spaceRating >= 4.0) {
      factors.ratingAlignment = 12; // Very good rating
      totalScore += 12;
    } else if (spaceRating >= 3.5) {
      factors.ratingAlignment = 8;  // Good rating
      totalScore += 8;
    } else if (spaceRating >= 3.0) {
      factors.ratingAlignment = 4;  // Average rating
      totalScore += 4;
    } else {
      factors.ratingAlignment = 0;  // Below average
    }

    // Factor 6: Booking success pattern (5 points)
    const completionRate = userBehavior.aiMetrics?.completedBookings /
      Math.max(1, userBehavior.aiMetrics?.totalBookings || 1);

    if (completionRate >= 0.9) {
      factors.reliabilityBonus = 5;
      totalScore += 5;
    } else if (completionRate <= 0.6) {
      factors.reliabilityBonus = -3;
      totalScore -= 3;
    } else {
      factors.reliabilityBonus = 0;
    }

    return {
      score: Math.max(0, Math.min(100, totalScore)),
      factors
    };
  }

  /**
   * Calculate score for new users with organic learning approach
   * Focus on distance, quality, and university-specific factors
   */
  async calculateNewUserScore(parkingSpace, userLocation) {
    const factors = {};
    let totalScore = 50; // Better base score for new users

    // Factor 1: Distance-based scoring (35 points)
    if (userLocation?.latitude && userLocation?.longitude) {
      const distance = this.calculateDistance(
        userLocation.latitude,
        userLocation.longitude,
        parkingSpace.latitude,
        parkingSpace.longitude
      );

      if (distance <= 0.3) { // 300m
        factors.distance = 35;
        totalScore += 35;
      } else if (distance <= 0.5) { // 500m
        factors.distance = 25;
        totalScore += 25;
      } else if (distance <= 1.0) { // 1km
        factors.distance = 15;
        totalScore += 15;
      } else {
        factors.distance = 5;
        totalScore += 5;
      }
    } else {
      factors.distance = 10; // Neutral when no location
      totalScore += 10;
    }

    // Factor 2: Quality indicators (25 points)
    const rating = parkingSpace.averageRating || 0;
    const totalBookings = parkingSpace.bookingStats?.totalBookings || 0;

    if (rating >= 4.5 && totalBookings >= 10) {
      factors.quality = 25; // Excellent with good sample size
      totalScore += 25;
    } else if (rating >= 4.0 && totalBookings >= 5) {
      factors.quality = 20; // Very good
      totalScore += 20;
    } else if (rating >= 3.5) {
      factors.quality = 15; // Good
      totalScore += 15;
    } else if (rating >= 3.0) {
      factors.quality = 8; // Average
      totalScore += 8;
    } else if (totalBookings === 0) {
      factors.quality = 12; // No data yet, neutral
      totalScore += 12;
    } else {
      factors.quality = 0; // Poor rating
    }

    // Factor 3: Availability and reliability (20 points)
    const availabilityRatio = parkingSpace.availableSpots / parkingSpace.totalSpots;

    if (availabilityRatio >= 0.6) {
      factors.availability = 20; // Good availability
      totalScore += 20;
    } else if (availabilityRatio >= 0.3) {
      factors.availability = 10; // Limited availability
      totalScore += 10;
    } else {
      factors.availability = 0; // Very limited
    }

    // Factor 4: University/school proximity bonus (15 points)
    if (parkingSpace.nearbyUniversities && parkingSpace.nearbyUniversities.length > 0) {
      factors.universityProximity = 15;
      totalScore += 15;
    } else if (parkingSpace.category === 'university' || parkingSpace.type === 'university') {
      factors.universityProximity = 10;
      totalScore += 10;
    } else {
      factors.universityProximity = 5; // Neutral
      totalScore += 5;
    }

    // Factor 5: Transparent pricing for new users (5 points)
    try {
      const { totalCost } = await aiPricingUtils.calculateTotalCostForAI(parkingSpace);
      const defaultSpending = aiPricingUtils.getDefaultSpendingPatterns();

      if (totalCost <= defaultSpending.comfortRange.preferred) {
        factors.pricing = 5; // Within reasonable range
        totalScore += 5;
      } else if (totalCost <= defaultSpending.comfortRange.max) {
        factors.pricing = 2; // Acceptable
        totalScore += 2;
      } else {
        factors.pricing = -2; // Expensive for new users
        totalScore -= 2;
      }

      factors.estimatedCost = totalCost;
    } catch (error) {
      factors.pricing = 0; // Neutral on pricing error
    }

    return {
      score: Math.max(0, Math.min(100, totalScore)),
      factors: {
        ...factors,
        newUser: true,
        message: 'Learning your preferences as you use ParkTayo',
        strategy: 'distance_quality_focused'
      }
    };
  }

  /**
   * Calculate real-time score (0-100)
   */
  calculateRealTimeScore(parkingSpace) {
    const factors = {};
    let totalScore = 50; // Base score

    const realTimeData = parkingSpace.realTimeData || {};

    // Factor 1: Availability (30 points)
    const occupancyRate = (parkingSpace.totalSpots - parkingSpace.availableSpots) / parkingSpace.totalSpots;
    if (occupancyRate < 0.5) {
      factors.availability = 30; // Low occupancy - great availability
      totalScore += 30;
    } else if (occupancyRate < 0.8) {
      factors.availability = 15; // Medium occupancy
      totalScore += 15;
    } else {
      factors.availability = -10; // High occupancy
      totalScore -= 10;
    }

    // Factor 2: Dynamic pricing (20 points)
    const pricingMultiplier = realTimeData.dynamicPricing?.currentMultiplier || 1.0;
    if (pricingMultiplier < 1.0) {
      factors.pricing = 20; // Discount available
      totalScore += 20;
    } else if (pricingMultiplier <= 1.2) {
      factors.pricing = 10; // Slight premium
      totalScore += 10;
    } else {
      factors.pricing = -15; // High premium
      totalScore -= 15;
    }

    // Factor 3: Traffic conditions (15 points)
    const trafficLevel = realTimeData.trafficConditions?.level || 'moderate';
    switch (trafficLevel) {
      case 'light':
        factors.trafficCondition = 15;
        totalScore += 15;
        break;
      case 'moderate':
        factors.trafficCondition = 5;
        totalScore += 5;
        break;
      case 'heavy':
        factors.trafficCondition = -10;
        totalScore -= 10;
        break;
      case 'congested':
        factors.trafficCondition = -20;
        totalScore -= 20;
        break;
    }

    // Factor 4: Weather impact (10 points)
    const weatherMultiplier = realTimeData.weatherImpact?.demandMultiplier || 1.0;
    if (weatherMultiplier > 1.2) {
      factors.weatherImpact = -10; // Bad weather increasing demand
      totalScore -= 10;
    } else {
      factors.weatherImpact = 5;
      totalScore += 5;
    }

    // Factor 5: Event demand (15 points)
    const nearbyEvents = realTimeData.nearbyEvents || [];
    const activeEvents = nearbyEvents.filter(event =>
      new Date() >= new Date(event.startTime) && new Date() <= new Date(event.endTime)
    );

    if (activeEvents.length === 0) {
      factors.eventDemand = 10; // No competing events
      totalScore += 10;
    } else {
      const maxEventImpact = Math.max(...activeEvents.map(e => e.demandIncrease));
      if (maxEventImpact > 1.5) {
        factors.eventDemand = -15; // High event demand
        totalScore -= 15;
      } else {
        factors.eventDemand = -5; // Moderate event demand
        totalScore -= 5;
      }
    }

    return {
      score: Math.max(0, Math.min(100, totalScore)),
      factors
    };
  }

  /**
   * Calculate contextual score (0-100)
   */
  calculateContextualScore(parkingSpace, userLocation) {
    const factors = {};
    let totalScore = 50; // Base score

    const aiMetrics = parkingSpace.aiMetrics || {};

    // Factor 1: Time of day patterns (20 points)
    const currentHour = new Date().getHours();
    const peakHours = aiMetrics.peakHours || [];
    const currentDay = new Date().toLocaleDateString('en', { weekday: 'long' }).toLowerCase();

    const isPeakTime = peakHours.some(peak =>
      peak.day === currentDay &&
      currentHour >= peak.startHour &&
      currentHour <= peak.endHour
    );

    if (isPeakTime) {
      factors.timeOfDay = -10; // Peak time - less desirable
      totalScore -= 10;
    } else {
      factors.timeOfDay = 15; // Off-peak time - more desirable
      totalScore += 15;
    }

    // Factor 2: Day of week patterns (15 points)
    const isWeekend = [0, 6].includes(new Date().getDay()); // Sunday = 0, Saturday = 6
    if (isWeekend) {
      factors.dayOfWeek = 10; // Weekend - generally less busy
      totalScore += 10;
    } else {
      factors.dayOfWeek = 5; // Weekday
      totalScore += 5;
    }

    // Factor 3: Seasonality (10 points) - simplified
    const month = new Date().getMonth();
    const isSchoolSeason = month >= 8 || month <= 4; // Sep-May
    if (isSchoolSeason) {
      factors.seasonality = -5; // School season - higher demand
      totalScore -= 5;
    } else {
      factors.seasonality = 10; // Summer break - lower demand
      totalScore += 10;
    }

    // Factor 4: Walking distance (25 points)
    const distance = this.calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      parkingSpace.latitude,
      parkingSpace.longitude
    );

    if (distance <= 0.2) { // 200m
      factors.walkingDistance = 25;
      totalScore += 25;
    } else if (distance <= 0.5) { // 500m
      factors.walkingDistance = 15;
      totalScore += 15;
    } else if (distance <= 1.0) { // 1km
      factors.walkingDistance = 5;
      totalScore += 5;
    } else {
      factors.walkingDistance = -10;
      totalScore -= 10;
    }

    // Factor 5: Popularity trend (20 points)
    const popularityScore = aiMetrics.popularityScore || 50;
    if (popularityScore >= 80) {
      factors.popularityTrend = 20;
      totalScore += 20;
    } else if (popularityScore >= 60) {
      factors.popularityTrend = 10;
      totalScore += 10;
    } else if (popularityScore < 30) {
      factors.popularityTrend = -5;
      totalScore -= 5;
    } else {
      factors.popularityTrend = 0;
    }

    return {
      score: Math.max(0, Math.min(100, totalScore)),
      factors
    };
  }

  /**
   * Calculate availability multiplier
   */
  getAvailabilityMultiplier(parkingSpace) {
    const availabilityRatio = parkingSpace.availableSpots / parkingSpace.totalSpots;

    if (availabilityRatio >= 0.5) return 1.0; // Good availability
    if (availabilityRatio >= 0.3) return 0.8; // Limited availability
    if (availabilityRatio > 0) return 0.6; // Very limited availability
    return 0.1; // Almost no availability
  }

  /**
   * Generate human-readable recommendation reason based on new scoring factors
   */
  generateRecommendationReason(distanceScore, ratingScore, pricingScore, amenitiesScore, availabilityMultiplier) {
    const reasons = [];

    // Calculate weighted scores to determine primary reason
    const weightedScores = {
      distance: distanceScore.score * this.weights.distance,
      rating: ratingScore.score * this.weights.rating,
      pricing: pricingScore.score * this.weights.pricing,
      amenities: amenitiesScore.score * this.weights.amenities
    };

    // Find the strongest factor
    const topFactor = Object.keys(weightedScores).reduce((a, b) =>
      weightedScores[a] > weightedScores[b] ? a : b
    );

    // Generate primary reason based on strongest factor
    switch (topFactor) {
      case 'distance':
        if (distanceScore.factors.category === 'extremely_close' || distanceScore.factors.category === 'very_close') {
          reasons.push("Extremely close to your destination");
        } else if (distanceScore.factors.category === 'close') {
          reasons.push("Very convenient walking distance");
        } else {
          reasons.push("Reasonable distance from your location");
        }
        break;

      case 'rating':
        if (ratingScore.factors.category === 'excellent') {
          reasons.push("Excellent reviews from other users");
        } else if (ratingScore.factors.category === 'very_good') {
          reasons.push("Highly rated by previous users");
        } else if (ratingScore.factors.category === 'new') {
          reasons.push("New parking space with potential");
        } else {
          reasons.push("Good quality parking space");
        }
        break;

      case 'pricing':
        if (pricingScore.factors.category === 'excellent_value' || pricingScore.factors.category === 'great_value') {
          reasons.push("Excellent value for money");
        } else if (pricingScore.factors.category === 'good_value') {
          reasons.push("Reasonably priced");
        } else {
          reasons.push("Fair pricing");
        }
        break;

      case 'amenities':
        if (amenitiesScore.factors.essentialAmenities >= 3) {
          reasons.push("Great amenities and security features");
        } else if (amenitiesScore.factors.essentialAmenities >= 1) {
          reasons.push("Good amenities available");
        } else {
          reasons.push("Basic parking facilities");
        }
        break;
    }

    // Add secondary reasons based on other strong factors
    const secondaryReasons = [];

    // Distance secondary reasons
    if (topFactor !== 'distance' && distanceScore.score >= 80) {
      secondaryReasons.push("close to destination");
    }

    // Rating secondary reasons
    if (topFactor !== 'rating' && ratingScore.score >= 85) {
      secondaryReasons.push("highly rated");
    }

    // Pricing secondary reasons
    if (topFactor !== 'pricing' && pricingScore.score >= 85) {
      secondaryReasons.push("great value");
    }

    // Amenities secondary reasons
    if (topFactor !== 'amenities' && amenitiesScore.score >= 75) {
      secondaryReasons.push("good facilities");
    }

    // Add availability urgency
    if (availabilityMultiplier < 0.8) {
      secondaryReasons.push("limited spots available");
    }

    // Combine reasons
    if (secondaryReasons.length > 0) {
      reasons.push(secondaryReasons.slice(0, 2).join(" and "));
    }

    return reasons.join(" - ");
  }

  /**
   * Calculate metadata for the suggestion with accurate pricing
   */
  async calculateMetadata(parkingSpace, userLocation) {
    const distance = this.calculateDistance(
      userLocation.latitude,
      userLocation.longitude,
      parkingSpace.latitude,
      parkingSpace.longitude
    );

    const walkingTime = Math.ceil(distance * 12); // ~12 minutes per km walking

    // Get accurate total price including all fees
    let estimatedPrice = 0;
    let priceBreakdown = null;

    try {
      const { totalCost, breakdown } = await aiPricingUtils.calculateTotalCostForAI(parkingSpace);

      // Validate the result
      if (totalCost && !isNaN(totalCost) && totalCost > 0) {
        estimatedPrice = Math.round(totalCost);
        priceBreakdown = breakdown;
      } else {
        throw new Error(`Invalid totalCost: ${totalCost}`);
      }
    } catch (error) {
      // Fallback to basic calculation
      const fallbackPrice = Math.max((parkingSpace.pricePer3Hours || 60), 30) + 5; // Add service fee
      estimatedPrice = Math.round(fallbackPrice);
      logger.warn(`Using fallback pricing for ${parkingSpace.name}: ₱${estimatedPrice} (reason: ${error.message})`);
    }

    // Final safety check
    if (!estimatedPrice || isNaN(estimatedPrice) || estimatedPrice <= 0) {
      estimatedPrice = 65; // Safe default
      logger.warn(`Applied emergency fallback pricing for ${parkingSpace.name}: ₱${estimatedPrice}`);
    }

    return {
      distance: Math.round(distance * 1000), // meters
      walkingTime, // minutes
      estimatedPrice,
      priceBreakdown,
      availableSpaces: parkingSpace.availableSpots,
      weatherCondition: parkingSpace.realTimeData?.weatherImpact?.currentWeather || 'unknown',
      trafficLevel: parkingSpace.realTimeData?.trafficConditions?.level || 'moderate',
      eventNearby: (parkingSpace.realTimeData?.nearbyEvents || []).length > 0,
      isUniversityArea: !!(parkingSpace.nearbyUniversities && parkingSpace.nearbyUniversities.length > 0)
    };
  }

  /**
   * Calculate distance between two points in kilometers
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRad(lat2 - lat1);
    const dLon = this.toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) * Math.cos(this.toRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  toRad(deg) {
    return deg * (Math.PI / 180);
  }

  /**
   * Cache suggestions for performance
   */
  async cacheSuggestions(userId, filterType, userLocation, suggestions) {
    try {
      const cachePromises = suggestions.slice(0, 5).map(suggestion =>
        AIScoringCache.setCachedScore({
          userId,
          parkingSpaceId: suggestion._id,
          filterType,
          userLocation: {
            type: 'Point',
            coordinates: [userLocation.longitude, userLocation.latitude]
          },
          aiScore: suggestion.aiScore,
          factorScores: suggestion.factorScores,
          availabilityMultiplier: suggestion.availabilityMultiplier,
          recommendationReason: suggestion.recommendationReason,
          metadata: suggestion.metadata
        })
      );

      await Promise.all(cachePromises);
      logger.info(`📦 Cached ${cachePromises.length} suggestions for user ${userId}`);
    } catch (error) {
      logger.warn(`Warning: Failed to cache suggestions: ${error.message}`);
    }
  }

  /**
   * Get cached suggestions
   */
  async getCachedSuggestions(userId, filterType, userLocation, limit) {
    try {
      // Check for location-aware cache entries
      const cacheQuery = {
        userId,
        filterType,
        isValid: true,
        expiresAt: { $gt: new Date() }
      };

      // Add location proximity check if coordinates provided
      if (userLocation && userLocation.latitude && userLocation.longitude) {
        cacheQuery.location = {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [userLocation.longitude, userLocation.latitude]
            },
            $maxDistance: 2000 // 2km radius for cache validity
          }
        };
      }

      const cached = await AIScoringCache.find(cacheQuery)
        .sort({ aiScore: -1, createdAt: -1 })
        .limit(limit)
        .populate('parkingSpaceId');

      if (cached.length === 0) {
        return [];
      }

      logger.info(`📦 Found ${cached.length} cached suggestions for ${filterType} within location range`);

      return cached.map(item => ({
        ...item.parkingSpaceId.toObject(),
        aiScore: item.aiScore,
        factorScores: item.factorScores || {},
        recommendationReason: item.recommendationReason || `${filterType} recommendation`,
        metadata: {
          ...item.metadata,
          cached: true,
          cacheAge: Math.floor((new Date() - item.createdAt) / 1000 / 60) // minutes
        }
      }));
    } catch (error) {
      logger.warn(`Warning: Failed to get cached suggestions: ${error.message}`);
      return [];
    }
  }

  /**
   * Enrich cached suggestions with real-time data
   */
  async enrichSuggestionsWithRealTimeData(cachedSuggestions) {
    try {
      const enrichedSuggestions = await Promise.all(
        cachedSuggestions.map(async (suggestion) => {
          // Get fresh parking space data
          const freshSpace = await ParkingSpace.findById(suggestion._id);

          if (!freshSpace) {
            return null; // Skip if parking space no longer exists
          }

          // Update real-time fields
          return {
            ...suggestion,
            availableSpots: freshSpace.availableSpots,
            totalSpots: freshSpace.totalSpots,
            currentPrice: this.calculateCurrentPrice(freshSpace),
            isAvailable: freshSpace.availableSpots > 0 && freshSpace.status === 'active',
            occupancyRate: Math.round(((freshSpace.totalSpots - freshSpace.availableSpots) / freshSpace.totalSpots) * 100),
            metadata: {
              ...suggestion.metadata,
              refreshedAt: new Date(),
              realTimeData: true
            }
          };
        })
      );

      return enrichedSuggestions.filter(s => s !== null && s.isAvailable);
    } catch (error) {
      logger.warn(`Warning: Failed to enrich cached suggestions: ${error.message}`);
      return cachedSuggestions; // Return original if enrichment fails
    }
  }

  /**
   * Update user behavior based on recent bookings
   */
  async updateUserBehaviorFromBookings(userId) {
    try {
      const recentBookings = await Booking.find({ userId })
        .sort({ createdAt: -1 })
        .limit(50)
        .populate('parkingSpaceId');

      if (recentBookings.length === 0) return;

      const behavior = await UserBehavior.findOneAndUpdate(
        { userId },
        { $setOnInsert: { userId } },
        { upsert: true, new: true }
      );

      // Analyze patterns from bookings
      const analysis = this.analyzeBookingPatterns(recentBookings);

      // Update behavior patterns
      behavior.bookingPatterns = {
        ...behavior.bookingPatterns,
        ...analysis.patterns
      };

      behavior.aiMetrics = {
        ...behavior.aiMetrics,
        ...analysis.metrics
      };

      behavior.lastAnalyzed = new Date();
      await behavior.save();

      logger.info(`📊 Updated behavior analysis for user ${userId}`);
    } catch (error) {
      logger.error(`Error updating user behavior: ${error.message}`);
    }
  }

  /**
   * Analyze booking patterns to extract user behavior insights
   */
  analyzeBookingPatterns(bookings) {
    if (bookings.length === 0) {
      return {
        patterns: {
          preferredTimes: ['morning'],
          averageDuration: 3,
          priceRange: { min: 25, max: 100, average: 60 },
          frequentUniversities: [],
          frequentParkingSpaces: [],
          parkingPreferences: []
        },
        metrics: {
          totalBookings: 0,
          cancelledBookings: 0,
          completedBookings: 0,
          averageRating: 0,
          loyaltyScore: 0,
          predictabilityScore: 0,
          totalSpent: 0,
          averageBookingValue: 0
        }
      };
    }

    // Time analysis
    const timeDistribution = this.analyzeTimePatterns(bookings);
    const spaceUsage = this.analyzeSpaceUsage(bookings);
    const financialMetrics = this.analyzeFinancialPatterns(bookings);
    const loyaltyMetrics = this.calculateLoyaltyScore(bookings);
    const predictabilityMetrics = this.calculatePredictabilityScore(bookings);

    const patterns = {
      preferredTimes: timeDistribution.topTimes,
      averageDuration: timeDistribution.avgDuration,
      priceRange: {
        min: financialMetrics.minPrice,
        max: financialMetrics.maxPrice,
        average: Math.round(financialMetrics.avgPrice)
      },
      frequentUniversities: spaceUsage.topUniversities,
      frequentParkingSpaces: spaceUsage.topSpaces,
      parkingPreferences: this.extractParkingPreferences(bookings)
    };

    const completedBookings = bookings.filter(b => b.status === 'completed');
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled');

    const metrics = {
      totalBookings: bookings.length,
      completedBookings: completedBookings.length,
      cancelledBookings: cancelledBookings.length,
      averageRating: this.calculateAverageRating(completedBookings),
      loyaltyScore: loyaltyMetrics.score,
      predictabilityScore: predictabilityMetrics.score,
      totalSpent: financialMetrics.totalSpent,
      averageBookingValue: Math.round(financialMetrics.avgPrice),
      repeatUsageRate: loyaltyMetrics.repeatRate,
      timeConsistency: predictabilityMetrics.timeConsistency,
      locationConsistency: predictabilityMetrics.locationConsistency
    };

    return { patterns, metrics };
  }

  /**
   * Analyze time patterns from booking history
   */
  analyzeTimePatterns(bookings) {
    const timeSlots = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    let totalDuration = 0;

    bookings.forEach(booking => {
      const hour = new Date(booking.startTime).getHours();

      if (hour >= 6 && hour < 12) timeSlots.morning++;
      else if (hour >= 12 && hour < 17) timeSlots.afternoon++;
      else if (hour >= 17 && hour < 22) timeSlots.evening++;
      else timeSlots.night++;

      // Calculate duration in hours
      if (booking.endTime) {
        const duration = (new Date(booking.endTime) - new Date(booking.startTime)) / (1000 * 60 * 60);
        totalDuration += duration;
      }
    });

    const topTimes = Object.entries(timeSlots)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 2)
      .map(([time]) => time);

    return {
      topTimes,
      avgDuration: bookings.length > 0 ? Math.round(totalDuration / bookings.length) : 3,
      distribution: timeSlots
    };
  }

  /**
   * Analyze space usage patterns
   */
  analyzeSpaceUsage(bookings) {
    const spaceFrequency = {};
    const universityFrequency = {};

    bookings.forEach(booking => {
      if (booking.parkingSpaceId) {
        const spaceId = booking.parkingSpaceId._id.toString();
        spaceFrequency[spaceId] = (spaceFrequency[spaceId] || 0) + 1;

        if (booking.parkingSpaceId.university) {
          const uni = booking.parkingSpaceId.university;
          universityFrequency[uni] = (universityFrequency[uni] || 0) + 1;
        }
      }
    });

    const topSpaces = Object.entries(spaceFrequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 5)
      .map(([spaceId]) => spaceId);

    const topUniversities = Object.entries(universityFrequency)
      .sort(([,a], [,b]) => b - a)
      .slice(0, 3)
      .map(([uni]) => uni);

    return { topSpaces, topUniversities };
  }

  /**
   * Analyze financial patterns (enhanced with actual total costs)
   */
  analyzeFinancialPatterns(bookings) {
    // Use actual total amounts paid (including all fees)
    const amounts = bookings
      .filter(b => b.totalAmount && b.totalAmount > 0)
      .map(b => b.totalAmount);

    if (amounts.length === 0) {
      // Return realistic defaults for Metro Manila university parking
      return { minPrice: 30, maxPrice: 150, avgPrice: 70, totalSpent: 0 };
    }

    const totalSpent = amounts.reduce((sum, amt) => sum + amt, 0);
    const avgPrice = totalSpent / amounts.length;

    return {
      minPrice: Math.min(...amounts),
      maxPrice: Math.max(...amounts),
      avgPrice: avgPrice,
      totalSpent: totalSpent,
      medianPrice: this.calculateMedian(amounts),
      priceVariability: this.calculatePriceVariability(amounts, avgPrice)
    };
  }

  /**
   * Helper method to calculate median price
   */
  calculateMedian(amounts) {
    const sorted = amounts.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
  }

  /**
   * Helper method to calculate price variability
   */
  calculatePriceVariability(amounts, avgPrice) {
    if (amounts.length < 2) return 0;

    const variance = amounts.reduce((sum, price) =>
      sum + Math.pow(price - avgPrice, 2), 0) / amounts.length;

    return Math.sqrt(variance) / avgPrice; // Coefficient of variation
  }

  /**
   * Calculate loyalty score (0-100)
   */
  calculateLoyaltyScore(bookings) {
    const completedBookings = bookings.filter(b => b.status === 'completed');
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled');

    if (bookings.length === 0) return { score: 0, repeatRate: 0 };

    // Completion rate (60% weight)
    const completionRate = completedBookings.length / bookings.length;

    // Repeat usage rate (40% weight)
    const spaceUsage = {};
    completedBookings.forEach(booking => {
      if (booking.parkingSpaceId) {
        const spaceId = booking.parkingSpaceId._id.toString();
        spaceUsage[spaceId] = (spaceUsage[spaceId] || 0) + 1;
      }
    });

    const repeatBookings = Object.values(spaceUsage).filter(count => count > 1);
    const repeatRate = repeatBookings.length / Math.max(Object.keys(spaceUsage).length, 1);

    const loyaltyScore = Math.round((completionRate * 0.6 + repeatRate * 0.4) * 100);

    return {
      score: Math.min(loyaltyScore, 100),
      repeatRate: Math.round(repeatRate * 100)
    };
  }

  /**
   * Calculate predictability score (0-100)
   */
  calculatePredictabilityScore(bookings) {
    if (bookings.length < 3) return { score: 0, timeConsistency: 0, locationConsistency: 0 };

    // Time consistency
    const timeSlots = this.analyzeTimePatterns(bookings);
    const maxTimeFreq = Math.max(...Object.values(timeSlots.distribution));
    const timeConsistency = maxTimeFreq / bookings.length;

    // Location consistency
    const spaceUsage = this.analyzeSpaceUsage(bookings);
    const totalUniqueSpaces = Object.keys(spaceUsage).length;
    const locationConsistency = totalUniqueSpaces > 0 ? 1 / Math.sqrt(totalUniqueSpaces) : 0;

    // Combined predictability score
    const predictabilityScore = Math.round((timeConsistency * 0.6 + locationConsistency * 0.4) * 100);

    return {
      score: Math.min(predictabilityScore, 100),
      timeConsistency: Math.round(timeConsistency * 100),
      locationConsistency: Math.round(locationConsistency * 100)
    };
  }

  /**
   * Calculate average rating from completed bookings
   */
  calculateAverageRating(completedBookings) {
    const ratingsWithValues = completedBookings.filter(b => b.rating && b.rating > 0);
    if (ratingsWithValues.length === 0) return 0;

    const totalRating = ratingsWithValues.reduce((sum, b) => sum + b.rating, 0);
    return Math.round((totalRating / ratingsWithValues.length) * 10) / 10;
  }

  /**
   * Extract parking preferences from booking patterns
   */
  extractParkingPreferences(bookings) {
    const preferences = [];
    const completedBookings = bookings.filter(b => b.status === 'completed');

    // Analyze parking features from highly-rated bookings
    const highRatedBookings = completedBookings.filter(b => b.rating && b.rating >= 4);

    if (highRatedBookings.length > 0) {
      // This would analyze parking space features that correlate with high ratings
      // For now, return some common preferences based on booking patterns
      if (highRatedBookings.length / completedBookings.length > 0.7) {
        preferences.push('high-rating-preference');
      }
    }

    return preferences;
  }

  /**
   * Calculate current price with dynamic pricing
   */
  calculateCurrentPrice(parkingSpace) {
    const basePrice = parkingSpace.pricePer3Hours;
    const dynamicMultiplier = parkingSpace.realTimeData?.dynamicPricing?.currentMultiplier || 1.0;
    return Math.round(basePrice * dynamicMultiplier);
  }
}

module.exports = new AIParkingSuggestionService();