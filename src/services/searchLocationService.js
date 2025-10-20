const SearchLocation = require('../models/SearchLocation');
const UserBehavior = require('../models/UserBehavior');
const logger = require('../config/logger');

/**
 * Search Location Service
 * Handles tracking and management of user search-based locations
 */
class SearchLocationService {
  /**
   * Log a search location interaction
   * @param {Object} data - Search location data
   * @returns {Object} Search location record
   */
  async logSearchLocation(data) {
    try {
      const {
        userId,
        name,
        latitude,
        longitude,
        category = 'university',
        interactionType = 'search_click',
        searchSource = 'google_places',
        placeId = null,
        metadata = {}
      } = data;

      logger.info(`📍 Logging search location for user ${userId}: ${name}`);

      // Determine category from name if not provided
      const detectedCategory = this.detectLocationCategory(name);
      const finalCategory = category === 'general' ? detectedCategory : category;

      // Create or update search location
      const searchLocation = await SearchLocation.findOrCreateSearchLocation({
        userId,
        name: name.trim(),
        latitude,
        longitude,
        category: finalCategory,
        interactionType,
        searchSource,
        placeId,
        metadata
      });

      // Update time patterns for AI learning
      await this.updateTimePatterns(searchLocation);

      // Update user behavior for AI suggestions
      await this.updateUserBehaviorFromSearch(userId, searchLocation);

      logger.info(`✅ Search location logged: ${searchLocation._id}`);

      return {
        success: true,
        searchLocation: searchLocation.toObject(),
        message: 'Search location logged successfully'
      };

    } catch (error) {
      logger.error(`❌ Error logging search location: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get recent search locations for user
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Array} Recent search locations
   */
  async getRecentSearchLocations(userId, options = {}) {
    try {
      const {
        limit = 5,
        categoryFilter = null,
        includeBookingData = true,
        timeframe = 90
      } = options;

      logger.info(`📍 Getting recent search locations for user ${userId}`);

      const locations = await SearchLocation.getRecentLocationsForUser(userId, {
        limit,
        categoryFilter,
        includeBookingData,
        timeframe
      });

      // Process locations for frontend consumption
      const processedLocations = locations.map(location => ({
        _id: location._id,
        name: location.name,
        latitude: location.latitude,
        longitude: location.longitude,
        category: location.category,

        // Usage statistics
        searchCount: location.searchCount,
        lastSearched: location.lastSearched,
        firstSearched: location.firstSearched,

        // Booking integration
        hasBookings: location.hasBookings,
        totalBookings: location.totalBookings,
        lastBookingDate: location.lastBookingDate,

        // AI metrics
        userInterestScore: location.aiMetrics.userInterestScore,
        searchFrequency: location.aiMetrics.searchFrequency,

        // UI helpers
        icon: this.getLocationIcon(location),
        label: this.getLocationLabel(location),
        subtitle: this.getLocationSubtitle(location),

        // Quick actions
        quickActions: this.getQuickActions(location),

        // Metadata
        daysSinceLastSearch: Math.floor((Date.now() - location.lastSearched) / (1000 * 60 * 60 * 24)),
        isUniversity: location.category === 'university',

        metadata: {
          type: 'search_location',
          source: location.searchSource,
          interactionType: location.interactionType
        }
      }));

      logger.info(`✅ Found ${processedLocations.length} recent search locations`);

      return {
        success: true,
        locations: processedLocations,
        total: processedLocations.length
      };

    } catch (error) {
      logger.error(`❌ Error getting recent search locations: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Get combined recent locations (searches + bookings)
   * @param {string} userId - User ID
   * @param {Object} options - Query options
   * @returns {Array} Combined recent locations
   */
  async getCombinedRecentLocations(userId, options = {}) {
    try {
      const { limit = 8 } = options;

      // Get search locations
      const searchResult = await this.getRecentSearchLocations(userId, {
        limit: limit,
        includeBookingData: true
      });

      // Get booking locations from existing service
      const recentLocationsService = require('./recentLocationsService');
      const bookingLocations = await recentLocationsService.getRecentLocationsFromBookings(userId, {
        limit: Math.ceil(limit / 2),
        timeframe: 90
      });

      // Combine and deduplicate
      const allLocations = [
        ...searchResult.locations.map(loc => ({ ...loc, priority: this.calculateLocationPriority(loc) })),
        ...bookingLocations.map(loc => ({ ...loc, priority: this.calculateLocationPriority(loc), metadata: { ...loc.metadata, type: 'booking_location' } }))
      ];

      // Remove duplicates (same location within 200m)
      const uniqueLocations = this.deduplicateLocations(allLocations);

      // Sort by priority and recency
      uniqueLocations.sort((a, b) => {
        if (b.priority !== a.priority) {
          return b.priority - a.priority;
        }
        return new Date(b.lastSearched || b.lastVisited) - new Date(a.lastSearched || a.lastVisited);
      });

      const finalLocations = uniqueLocations.slice(0, limit);

      logger.info(`✅ Combined recent locations: ${finalLocations.length} unique locations`);

      return {
        success: true,
        locations: finalLocations,
        total: finalLocations.length,
        breakdown: {
          searchBased: searchResult.locations.length,
          bookingBased: bookingLocations.length,
          unique: finalLocations.length
        }
      };

    } catch (error) {
      logger.error(`❌ Error getting combined recent locations: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Helper methods
   */
  detectLocationCategory(name) {
    const nameLower = name.toLowerCase();

    if (nameLower.includes('university') || nameLower.includes('univ.')) {
      return 'university';
    } else if (nameLower.includes('college')) {
      return 'college';
    } else if (nameLower.includes('school')) {
      return 'school';
    } else if (nameLower.includes('institute') || nameLower.includes('academy')) {
      return 'institute';
    }

    return 'university'; // Default for our university-focused app
  }

  async updateTimePatterns(searchLocation) {
    const currentHour = new Date().getHours();
    const currentDay = new Date().toLocaleDateString('en', { weekday: 'long' }).toLowerCase();

    let timeSlot;
    if (currentHour >= 6 && currentHour < 12) timeSlot = 'morning';
    else if (currentHour >= 12 && currentHour < 17) timeSlot = 'afternoon';
    else if (currentHour >= 17 && currentHour < 22) timeSlot = 'evening';
    else timeSlot = 'night';

    // Update preferred time slots
    if (!searchLocation.aiMetrics.preferredTimeSlots.includes(timeSlot)) {
      searchLocation.aiMetrics.preferredTimeSlots.push(timeSlot);
    }

    // Update preferred days
    if (!searchLocation.aiMetrics.preferredDays.includes(currentDay)) {
      searchLocation.aiMetrics.preferredDays.push(currentDay);
    }

    await searchLocation.save();
  }

  async updateUserBehaviorFromSearch(userId, searchLocation) {
    try {
      let userBehavior = await UserBehavior.findOne({ userId });

      if (!userBehavior) {
        userBehavior = new UserBehavior({ userId });
      }

      // Initialize search patterns if not exists
      if (!userBehavior.searchPatterns) {
        userBehavior.searchPatterns = {
          frequentUniversities: [],
          preferredCategories: [],
          searchFrequency: 'low',
          totalSearches: 0
        };
      }

      // Update search count
      userBehavior.searchPatterns.totalSearches = (userBehavior.searchPatterns.totalSearches || 0) + 1;

      // Update frequent universities
      if (searchLocation.category === 'university') {
        const frequentUniversities = userBehavior.searchPatterns.frequentUniversities || [];

        if (!frequentUniversities.includes(searchLocation.name)) {
          frequentUniversities.push(searchLocation.name);
          userBehavior.searchPatterns.frequentUniversities = frequentUniversities;
        }
      }

      // Update preferred categories
      const categories = userBehavior.searchPatterns.preferredCategories || [];
      if (!categories.includes(searchLocation.category)) {
        categories.push(searchLocation.category);
        userBehavior.searchPatterns.preferredCategories = categories;
      }

      userBehavior.lastAnalyzed = new Date();
      await userBehavior.save();

    } catch (error) {
      logger.warn(`Failed to update user behavior from search: ${error.message}`);
    }
  }

  getLocationIcon(location) {
    const iconMap = {
      university: '🎓',
      college: '📚',
      school: '🏫',
      institute: '🔬',
      academy: '🎭'
    };

    if (location.hasBookings) {
      return '⭐'; // Star for places with bookings
    }

    return iconMap[location.category] || '📍';
  }

  getLocationLabel(location) {
    if (location.hasBookings) {
      return `${location.totalBookings}x booked`;
    }

    if (location.searchCount > 1) {
      return `${location.searchCount}x searched`;
    }

    return 'Recently searched';
  }

  getLocationSubtitle(location) {
    const daysSince = Math.floor((Date.now() - location.lastSearched) / (1000 * 60 * 60 * 24));

    if (location.hasBookings) {
      return `Last booked ${daysSince} days ago`;
    }

    if (daysSince === 0) {
      return 'Searched today';
    } else if (daysSince === 1) {
      return 'Searched yesterday';
    } else {
      return `Searched ${daysSince} days ago`;
    }
  }

  getQuickActions(location) {
    const actions = ['view_on_map'];

    if (location.hasBookings) {
      actions.unshift('book_again');
    } else {
      actions.unshift('find_parking');
    }

    actions.push('get_directions');

    if (!location.hasBookings) {
      actions.push('add_to_favorites');
    }

    return actions;
  }

  calculateLocationPriority(location) {
    let priority = 0;

    // Booking-based locations get higher priority
    if (location.hasBookings || location.totalBookings > 0) {
      priority += 50;
      priority += Math.min(location.totalBookings * 10, 30); // Up to 30 extra points
    }

    // Search frequency bonus
    if (location.searchCount > 1) {
      priority += Math.min(location.searchCount * 5, 25); // Up to 25 extra points
    }

    // Recency bonus
    const daysSince = Math.floor((Date.now() - (location.lastSearched || location.lastVisited)) / (1000 * 60 * 60 * 24));
    if (daysSince <= 1) priority += 20;
    else if (daysSince <= 7) priority += 10;
    else if (daysSince <= 30) priority += 5;

    // Interest score bonus
    if (location.userInterestScore) {
      priority += Math.round(location.userInterestScore / 5); // Up to 20 points
    }

    return priority;
  }

  deduplicateLocations(locations) {
    const unique = [];
    const RADIUS_THRESHOLD = 200; // 200 meters

    for (const location of locations) {
      const isDuplicate = unique.some(existing => {
        const distance = this.calculateDistance(
          location.latitude, location.longitude,
          existing.latitude, existing.longitude
        );
        return distance <= RADIUS_THRESHOLD;
      });

      if (!isDuplicate) {
        unique.push(location);
      }
    }

    return unique;
  }

  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371000; // Earth's radius in meters
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

module.exports = new SearchLocationService();