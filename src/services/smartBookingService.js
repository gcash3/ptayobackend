const logger = require('../config/logger');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const dynamicPricingService = require('./dynamicPricingService');

/**
 * Smart Booking Service
 * Handles intelligent parking space allocation based on user preferences
 */
class SmartBookingService {
  constructor() {
    this.SEARCH_RADIUS = 1000; // 2km default search radius
    this.MAX_RESULTS = 10;     // Maximum spaces to consider
    
    // Scoring weights for balanced selection
    this.WEIGHTS = {
      DISTANCE: 0.4,  // 40% weight on proximity
      PRICE: 0.3,     // 30% weight on price
      RATING: 0.2,    // 20% weight on rating
      AMENITIES: 0.1  // 10% weight on amenities
    };
    
    // Enhanced preference options
    this.PREFERENCE_OPTIONS = [
      'cheapest',     // Lowest price priority
      'closest',      // Nearest distance priority
      'balanced',     // Weighted combination
      'highest_rated', // Best rating priority
      'safest',       // Security features priority
      'covered',      // Roofed parking priority
      'fastest_access' // Quick entry/exit priority
    ];
  }

  /**
   * Get smart booking recommendations
   * @param {Object} options - Booking options
   * @returns {Object} Smart booking results with ranked spaces
   */
  async getSmartRecommendations(options) {
    try {
      const {
        destinationLat,
        destinationLng,
        bookingTime = new Date(),
        duration = 3, // Standard 3-hour rate for smart booking display
        preference = 'balanced', // 'cheapest', 'closest', 'balanced'
        searchRadius = this.SEARCH_RADIUS,
        maxResults = this.MAX_RESULTS
      } = options;

      logger.info(`Smart booking search: ${destinationLat}, ${destinationLng} - Preference: ${preference}`);

      // 1. Find available parking spaces near destination
      const availableSpaces = await this.findAvailableSpaces({
        destinationLat,
        destinationLng,
        bookingTime,
        duration,
        searchRadius,
        maxResults
      });

      if (availableSpaces.length === 0) {
        return {
          success: false,
          message: 'No available parking spaces found in the area',
          spaces: []
        };
      }

      // 2. Calculate dynamic pricing for all spaces
      // Note: duration is used for upfront pricing display only
      // Actual billing will be usage-based from parking session
      const spacesWithPricing = await this.calculatePricingForSpaces(
        availableSpaces,
        bookingTime,
        duration
      );

      // 3. Rank spaces based on user preference
      const rankedSpaces = await this.rankSpaces(
        spacesWithPricing,
        { destinationLat, destinationLng },
        preference
      );

      // 4. Return top recommendations
      const recommendations = rankedSpaces.slice(0, maxResults).map((space, index) => ({
        rank: index + 1,
        parkingSpace: space.parkingSpace,
        pricing: space.pricing,
        distance: space.distance,
        walkingTime: space.walkingTime,
        score: space.score,
        recommendation: space.recommendation
      }));

      return {
        success: true,
        preference,
        totalFound: availableSpaces.length,
        searchRadius,
        destination: { lat: destinationLat, lng: destinationLng },
        spaces: recommendations
      };

    } catch (error) {
      logger.error('❌ Smart booking service error:', {
        error: error.message,
        stack: error.stack,
        destinationLat: options.destinationLat,
        destinationLng: options.destinationLng,
        preference: options.preference
      });
      return {
        success: false,
        message: 'Smart booking search failed',
        error: error.message,
        spaces: []
      };
    }
  }

  /**
   * Alias for backward compatibility - calls the main implementation
   */
  async findSmartBookingOptions(options) {
    return this.getSmartRecommendations(options);
  }

  /**
   * Get count of available parking spaces near destination (enhanced with time filtering)
   */
  async getAvailableSpacesCount(destinationLat, destinationLng, searchRadius = 1000, checkTime = null){
    try {
      logger.info('🔍 Searching for parking spaces:', {
        destinationLat,
        destinationLng,
        searchRadius,
        checkTime: checkTime?.toISOString(),
        coordinates: [destinationLng, destinationLat]
      });

      // Use enhanced findNearby method with time filtering
      const spaces = await ParkingSpace.findNearby(
        destinationLng,
        destinationLat,
        searchRadius / 1000, // Convert meters to kilometers
        {
          checkTime: checkTime,
          includeTimeFilter: true
        }
      );

      const count = spaces.length;

      logger.info('📊 Available spaces count (time-filtered):', {
        count,
        destinationLat,
        destinationLng,
        searchRadius,
        timeFiltered: !!checkTime
      });

      // Get sample spaces for debugging
      const sampleSpaces = spaces.slice(0, 5);

      logger.info('🅿️ Sample spaces found:', sampleSpaces.map(s => ({
        name: s.name,
        location: [s.latitude, s.longitude],
        available: s.availableSpots,
        total: s.totalSpots,
        is24_7: s.operatingHours?.isOpen24_7,
        hasSchedule: !!(s.operatingHours?.schedule)
      })));

      return count;
    } catch (error) {
      logger.error('❌ Error getting spaces count:', error);
      return 0;
    }
  }

  /**
   * Find available parking spaces within radius (enhanced with time filtering)
   */
  async findAvailableSpaces({ destinationLat, destinationLng, bookingTime, duration, searchRadius, maxResults }) {
    logger.info('🔍 Searching for available spaces:', {
      destinationLat,
      destinationLng,
      searchRadius,
      duration,
      maxResults,
      bookingTime: bookingTime.toISOString()
    });

    const bookingStart = new Date(bookingTime);
    const bookingEnd = new Date(bookingTime.getTime() + (duration * 60 * 60 * 1000));

    // Use enhanced findNearby method with time filtering
    const nearbySpaces = await ParkingSpace.findNearby(
      destinationLng,
      destinationLat,
      searchRadius / 1000, // Convert meters to kilometers
      {
        checkTime: bookingStart,
        includeTimeFilter: true
      }
    ).populate('landlordId', 'firstName lastName phoneNumber').limit(maxResults * 2); // Get more for filtering

    logger.info('📍 Found nearby spaces (after time filtering):', {
      count: nearbySpaces.length,
      spaceIds: nearbySpaces.map(s => s._id.toString())
    });

    // Filter out spaces with conflicting bookings and validate operating hours
    const availableSpaces = [];

    for (const space of nearbySpaces) {
      // Double-check time availability for booking range
      const timeValidation = space.validateBookingTime(bookingStart, bookingEnd);

      if (!timeValidation.isValid) {
        logger.debug(`⏰ Space ${space._id} filtered out: ${timeValidation.message}`);
        continue;
      }

      const conflictingBookings = await Booking.countDocuments({
        parkingSpaceId: space._id,
        status: { $in: ['accepted', 'parked'] },
        $or: [
          {
            startTime: { $lte: bookingEnd },
            endTime: { $gte: bookingStart }
          }
        ]
      });

      if (conflictingBookings === 0) {
        // Calculate distance from destination
        const distance = this.calculateDistance(
          destinationLat, destinationLng,
          space.location.coordinates[1], space.location.coordinates[0]
        );

        // Get operating status for additional info
        const operatingStatus = space.getOperatingStatus(bookingStart);

        availableSpaces.push({
          ...space.toObject(),
          distance: Math.round(distance * 1000), // Convert to meters
          walkingTime: Math.round(distance * 1000 / 80), // Assuming 80m/min walking speed
          operatingStatus: operatingStatus,
          timeValidation: timeValidation
        });
      } else {
        logger.debug(`📅 Space ${space._id} has ${conflictingBookings} conflicting bookings`);
      }
    }

    return availableSpaces.slice(0, maxResults);
  }

  /**
   * Calculate dynamic pricing for multiple spaces
   */
  async calculatePricingForSpaces(spaces, bookingTime, duration) {
    const spacesWithPricing = [];

    for (const space of spaces) {
      try {
        const pricing = await dynamicPricingService.calculateDynamicPrice(
          space._id,
          bookingTime,
          duration
        );

        spacesWithPricing.push({
          parkingSpace: space,
          pricing,
          distance: space.distance,
          walkingTime: space.walkingTime
        });
      } catch (error) {
        logger.error(`Pricing calculation failed for space ${space._id}:`, error);
        
        // Fallback pricing
        spacesWithPricing.push({
          parkingSpace: space,
          pricing: {
            basePrice: space.pricing?.hourlyRate || 50,
            dynamicPrice: space.pricing?.hourlyRate || 50,
            totalPrice: (space.pricing?.hourlyRate || 50) * duration,
            demandFactor: 0,
            factors: [],
            error: 'Pricing calculation failed'
          },
          distance: space.distance,
          walkingTime: space.walkingTime
        });
      }
    }

    return spacesWithPricing;
  }

  /**
   * Rank spaces based on user preference
   */
  async rankSpaces(spacesWithPricing, destination, preference) {
    const rankedSpaces = spacesWithPricing.map(space => {
      let score = 0;
      let recommendation = '';

      // Calculate individual scores for each factor
      const maxPrice = Math.max(...spacesWithPricing.map(s => s.pricing.totalPrice));
      const maxDistance = Math.max(...spacesWithPricing.map(s => s.distance));
      const maxRating = Math.max(...spacesWithPricing.map(s => s.parkingSpace.rating || 0));
      
      const distanceScore = maxDistance > 0 ? (maxDistance - space.distance) / maxDistance : 0;
      const priceScore = maxPrice > 0 ? (maxPrice - space.pricing.totalPrice) / maxPrice : 0;
      const ratingScore = maxRating > 0 ? (space.parkingSpace.rating || 0) / maxRating : 0;
      
      // Calculate amenity score
      const amenityScore = this.calculateAmenityScore(space.parkingSpace);

      switch (preference) {
        case 'cheapest':
          score = priceScore;
          recommendation = `₱${space.pricing.totalPrice} - Best price`;
          break;

        case 'closest':
          score = distanceScore;
          recommendation = `${space.distance}m away - Closest option`;
          break;

        case 'highest_rated':
          score = ratingScore;
          const rating = space.parkingSpace.rating || 0;
          recommendation = `${rating.toFixed(1)}⭐ rating - Highly rated`;
          break;

        case 'safest':
          score = this.calculateSafetyScore(space.parkingSpace);
          const safetyFeatures = this.getSafetyFeatures(space.parkingSpace);
          recommendation = `${safetyFeatures.join(', ')} - Safest option`;
          break;

        case 'covered':
          score = space.parkingSpace.isCovered ? 1.0 : 0.3;
          recommendation = space.parkingSpace.isCovered ? 'Covered parking - Weather protected' : 'Open parking';
          break;

        case 'fastest_access':
          score = this.calculateAccessScore(space.parkingSpace);
          recommendation = `Quick ${space.parkingSpace.accessType || 'standard'} access`;
          break;

        case 'balanced':
        default:
          // Enhanced weighted combination
          score = (distanceScore * this.WEIGHTS.DISTANCE) + 
                  (priceScore * this.WEIGHTS.PRICE) + 
                  (ratingScore * this.WEIGHTS.RATING) + 
                  (amenityScore * this.WEIGHTS.AMENITIES);
          recommendation = `${space.distance}m, ₱${space.pricing.totalPrice}, ${(space.parkingSpace.rating || 0).toFixed(1)}⭐ - Best overall`;
          break;
      }

      return {
        ...space,
        score: Math.round(score * 100) / 100, // Round to 2 decimals
        recommendation,
        factors: {
          distance: distanceScore,
          price: priceScore,
          rating: ratingScore,
          amenities: amenityScore
        }
      };
    });

    // Sort by score (highest first)
    return rankedSpaces.sort((a, b) => b.score - a.score);
  }

  /**
   * Calculate amenity score based on parking space features
   */
  calculateAmenityScore(parkingSpace) {
    let score = 0;
    const features = parkingSpace.features || {};
    
    if (features.isCovered || parkingSpace.isCovered) score += 0.3;
    if (features.hasCCTV || parkingSpace.hasCCTV) score += 0.2;
    if (features.hasLighting || parkingSpace.hasLighting) score += 0.15;
    if (features.isSecured || parkingSpace.isSecured) score += 0.2;
    if (features.hasWashroom || parkingSpace.hasWashroom) score += 0.1;
    if (features.has24HourAccess || parkingSpace.has24HourAccess) score += 0.15;
    
    return Math.min(score, 1.0); // Cap at 1.0
  }

  /**
   * Calculate safety score
   */
  calculateSafetyScore(parkingSpace) {
    let score = 0;
    const features = parkingSpace.features || {};
    
    if (features.hasCCTV || parkingSpace.hasCCTV) score += 0.4;
    if (features.hasSecurityGuard || parkingSpace.hasSecurityGuard) score += 0.3;
    if (features.hasLighting || parkingSpace.hasLighting) score += 0.2;
    if (features.isGated || parkingSpace.isGated) score += 0.1;
    
    return Math.min(score, 1.0);
  }

  /**
   * Get safety features list
   */
  getSafetyFeatures(parkingSpace) {
    const features = [];
    const spaceFeatures = parkingSpace.features || {};
    
    if (spaceFeatures.hasCCTV || parkingSpace.hasCCTV) features.push('CCTV');
    if (spaceFeatures.hasSecurityGuard || parkingSpace.hasSecurityGuard) features.push('Security Guard');
    if (spaceFeatures.hasLighting || parkingSpace.hasLighting) features.push('Well-lit');
    if (spaceFeatures.isGated || parkingSpace.isGated) features.push('Gated');
    
    return features.length > 0 ? features : ['Basic security'];
  }

  /**
   * Calculate access speed score
   */
  calculateAccessScore(parkingSpace) {
    const accessType = parkingSpace.accessType || 'standard';
    const accessScores = {
      'automated': 1.0,     // Automated gates
      'qr_scan': 0.9,       // QR code access
      'remote': 0.8,        // Remote controlled
      'keycard': 0.7,       // Keycard access
      'standard': 0.5,      // Manual/attendant
      'manual': 0.3         // Fully manual
    };
    
    return accessScores[accessType] || 0.5;
  }

  /**
   * Create smart booking with auto-selected space
   * @param {Object} bookingData - Booking data
   * @returns {Object} Booking result
   */
  async createSmartBooking(bookingData) {
    try {
      const {
        userId,
        destinationLat,
        destinationLng,
        bookingTime,
        duration,
        vehicleId,
        preference = 'balanced',
        userNotes
      } = bookingData;

      // Find best parking space
      const smartOptions = await this.findSmartBookingOptions({
        destinationLat,
        destinationLng,
        bookingTime,
        duration,
        preference
      });

      if (!smartOptions.success || smartOptions.spaces.length === 0) {
        return {
          success: false,
          message: 'No suitable parking spaces found for smart booking',
          error: smartOptions.message
        };
      }

      // Select the top-ranked space
      const selectedSpace = smartOptions.spaces[0];
      
      // Create booking with selected space
      const bookingResult = {
        success: true,
        bookingType: 'smart',
        selectedSpace: selectedSpace,
        allOptions: smartOptions.spaces,
        message: `Smart booking created - ${selectedSpace.recommendation}`
      };

      logger.info(`Smart booking created: Space ${selectedSpace.parkingSpace._id} selected for user ${userId}`);
      
      return bookingResult;

    } catch (error) {
      logger.error('Smart booking creation error:', error);
      return {
        success: false,
        message: 'Smart booking creation failed',
        error: error.message
      };
    }
  }



  /**
   * Calculate distance between two coordinates (Haversine formula)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLon = this.toRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
              Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }
}

module.exports = new SmartBookingService();

