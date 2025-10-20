const mongoose = require('mongoose');
const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const UserBehavior = require('../models/UserBehavior');
const SearchLocation = require('../models/SearchLocation');
const logger = require('../config/logger');

class RecentLocationsService {
  /**
   * Get recent locations based on user's search history and booking history
   * @param {string} userId - User ID
   * @param {Object} options - Options for recent locations
   * @returns {Array} Recent locations with metadata
   */
  async getRecentLocationsFromBookings(userId, options = {}) {
    const {
      limit = 3,
      includeCancelled = false,
      timeframe = 90 // days
    } = options;

    try {
      logger.info(`📍 Getting recent locations (search + booking history) for user ${userId}`);

      // Get recent search locations using the SearchLocation model
      const searchLocations = await SearchLocation.getRecentLocationsForUser(userId, {
        limit: limit * 2, // Get more search locations
        timeframe: timeframe,
        includeBookingData: true
      });

      logger.info(`🔍 Found ${searchLocations.length} recent search locations`);

      // Convert search locations to the format expected by processRecentLocations
      const formattedSearchLocations = searchLocations.map(searchLoc => {
        return {
          _id: searchLoc._id,
          searchLocation: searchLoc, // Store the search location data
          lastSearchDate: searchLoc.lastSearched,
          firstSearchDate: searchLoc.firstSearched,
          searchCount: searchLoc.searchCount,
          totalBookings: searchLoc.totalBookings || 0,
          avgRating: 0, // Search locations don't have ratings
          avgDuration: 0,
          bookingStatuses: [],
          isSearchLocation: true,
          // Create a fake parking space structure for compatibility
          parkingSpace: {
            _id: null,
            name: searchLoc.name,
            address: `${searchLoc.name} (Search Location)`,
            latitude: searchLoc.latitude,
            longitude: searchLoc.longitude,
            status: 'active',
            type: 'search_location',
            availableSpots: 0,
            pricePer3Hours: 0,
            amenities: []
          },
          // Add fields for compatibility with existing processing
          successfulBookings: searchLoc.totalBookings || 0,
          cancelledBookings: 0,
          completionRate: searchLoc.totalBookings > 0 ? 1 : 0,
          daysSinceLastVisit: Math.floor((new Date() - searchLoc.lastSearched) / (1000 * 60 * 60 * 24)),
          visitFrequency: searchLoc.searchCount / Math.max(1, (searchLoc.lastSearched - searchLoc.firstSearched) / (1000 * 60 * 60 * 24))
        };
      });

      if (formattedSearchLocations.length === 0) {
        logger.info(`📍 No recent search locations found for user ${userId}`);
        return [];
      }

      // Process and categorize the search locations
      const processedLocations = await this.processRecentSearchLocations(formattedSearchLocations, userId);

      // Apply final limit
      const finalLocations = processedLocations.slice(0, limit);

      logger.info(`✅ Found ${finalLocations.length} recent search locations for user ${userId}`);
      return finalLocations;

    } catch (error) {
      logger.error(`❌ Error getting recent locations: ${error.message}`, error);
      throw error;
    }
  }

  /**
   * Process and categorize recent search locations with AI insights
   */
  async processRecentSearchLocations(recentSearches, userId) {
    try {
      const processedLocations = recentSearches.map(search => {
        const searchLocation = search.searchLocation;
        const category = this.categorizeSearchLocation(search);
        const insights = this.generateSearchLocationInsights(search);

        return {
          _id: search._id,
          name: searchLocation.name,
          address: searchLocation.name, // Search locations use name as address
          latitude: searchLocation.latitude,
          longitude: searchLocation.longitude,

          // Visual indicators
          icon: this.getSearchLocationIcon(category, search),
          label: this.getSearchLocationLabel(category, search),

          // Search statistics (instead of booking statistics)
          searchCount: search.searchCount,
          lastVisited: search.lastSearchDate,
          firstVisited: search.firstSearchDate,
          daysSinceLastVisit: search.daysSinceLastVisit,

          // Performance metrics adapted for search
          completionRate: 100, // Search locations always have 100% "completion"
          avgRating: 5, // Default high rating for search locations
          totalBookings: search.totalBookings,
          totalSpent: 0, // No spending on search locations

          // AI categorization
          category: category.type,
          categoryReason: category.reason,
          insights: insights,

          // Recommendation data
          recommendationScore: this.calculateSearchRecommendationScore(search),
          isRecommended: this.shouldRecommendSearch(search),

          // Quick actions for search locations
          quickActions: this.getSearchQuickActions(search, userId),

          // Metadata for frontend
          metadata: {
            searchLocationId: searchLocation._id,
            locationType: 'search_location',
            category: searchLocation.category,
            searchSource: searchLocation.searchSource,
            userInterestScore: searchLocation.aiMetrics?.userInterestScore || 0,
            searchFrequency: searchLocation.aiMetrics?.searchFrequency || 'rare',
            isUniversity: searchLocation.category === 'university',
            placeId: searchLocation.placeId
          }
        };
      });

      // Sort by recommendation score and recency
      return processedLocations.sort((a, b) => {
        // Primary sort: recommendation score
        if (b.recommendationScore !== a.recommendationScore) {
          return b.recommendationScore - a.recommendationScore;
        }

        // Secondary sort: days since last visit (more recent = better)
        return a.daysSinceLastVisit - b.daysSinceLastVisit;
      });

    } catch (error) {
      logger.error(`Error processing recent search locations: ${error.message}`);
      return [];
    }
  }

  /**
   * Process and categorize recent booking locations with AI insights (LEGACY)
   */
  async processRecentLocations(recentBookings, userId) {
    try {
      const processedLocations = recentBookings.map(booking => {
        const parkingSpace = booking.parkingSpace;
        const category = this.categorizeLocation(booking);
        const insights = this.generateLocationInsights(booking);

        return {
          _id: booking._id,
          name: parkingSpace.name,
          address: parkingSpace.address,
          latitude: parkingSpace.latitude,
          longitude: parkingSpace.longitude,

          // Visual indicators
          icon: this.getLocationIcon(category, booking),
          label: this.getLocationLabel(category, booking),

          // Booking statistics
          bookingCount: booking.bookingCount,
          lastVisited: booking.lastBookingDate,
          firstVisited: booking.firstBookingDate,
          daysSinceLastVisit: booking.daysSinceLastVisit,

          // Performance metrics
          completionRate: Math.round(booking.completionRate * 100),
          avgRating: Math.round((booking.avgRating || 0) * 10) / 10,
          avgDuration: Math.round(booking.avgDuration || 0),
          totalSpent: Math.round(booking.totalSpent || 0),

          // AI categorization
          category: category.type,
          categoryReason: category.reason,
          insights: insights,

          // Recommendation data
          recommendationScore: this.calculateRecommendationScore(booking),
          isRecommended: this.shouldRecommend(booking),

          // Quick actions
          quickActions: this.getQuickActions(booking, userId),

          // Metadata for frontend
          metadata: {
            parkingSpaceId: parkingSpace._id,
            parkingSpaceType: parkingSpace.type,
            amenities: parkingSpace.amenities,
            currentPrice: parkingSpace.pricePer3Hours,
            currentAvailability: parkingSpace.availableSpots,
            averagePrice: Math.round(booking.totalSpent / booking.bookingCount) || 0,
            visitFrequency: booking.visitFrequency || 0
          }
        };
      });

      // Sort by recommendation score and recency
      return processedLocations.sort((a, b) => {
        // Primary sort: recommendation score
        if (b.recommendationScore !== a.recommendationScore) {
          return b.recommendationScore - a.recommendationScore;
        }

        // Secondary sort: days since last visit (more recent = better)
        return a.daysSinceLastVisit - b.daysSinceLastVisit;
      });

    } catch (error) {
      logger.error(`Error processing recent locations: ${error.message}`);
      return [];
    }
  }

  /**
   * Categorize location based on usage patterns
   */
  categorizeLocation(booking) {
    const { bookingCount, completionRate, avgRating, daysSinceLastVisit } = booking;

    // Favorite: High usage, good ratings, recent visits
    if (bookingCount >= 3 && avgRating >= 4.0 && daysSinceLastVisit <= 14) {
      return {
        type: 'favorite',
        reason: `Booked ${bookingCount} times with ${Math.round(avgRating * 10) / 10}★ rating`
      };
    }

    // Frequent: Multiple visits with good completion rate
    if (bookingCount >= 3 && completionRate >= 0.8) {
      return {
        type: 'frequent',
        reason: `${bookingCount} successful bookings`
      };
    }

    // Recent: Visited within last week
    if (daysSinceLastVisit <= 7) {
      return {
        type: 'recent',
        reason: daysSinceLastVisit === 0 ? 'Visited today' : `${daysSinceLastVisit} days ago`
      };
    }

    // Budget: Good value based on spending
    const avgSpend = booking.totalSpent / bookingCount;
    if (avgSpend <= 60) {
      return {
        type: 'budget',
        reason: `Average ₱${Math.round(avgSpend)} per visit`
      };
    }

    // Reliable: High completion rate
    if (completionRate >= 0.9) {
      return {
        type: 'reliable',
        reason: `${Math.round(completionRate * 100)}% completion rate`
      };
    }

    // Default: Regular
    return {
      type: 'regular',
      reason: `${bookingCount} bookings`
    };
  }

  /**
   * Get appropriate icon for location category
   */
  getLocationIcon(category, booking) {
    const iconMap = {
      favorite: '⭐',
      frequent: '🔥',
      recent: '🕒',
      budget: '💰',
      reliable: '✅',
      regular: '📍'
    };

    return iconMap[category.type] || '📍';
  }

  /**
   * Get appropriate label for location
   */
  getLocationLabel(category, booking) {
    const labelMap = {
      favorite: 'Favorite',
      frequent: `${booking.bookingCount}x`,
      recent: 'Recent',
      budget: 'Budget',
      reliable: 'Reliable',
      regular: 'Visited'
    };

    return labelMap[category.type] || 'Visited';
  }

  /**
   * Generate insights about the location
   */
  generateLocationInsights(booking) {
    const insights = [];
    const { bookingCount, avgRating, completionRate, daysSinceLastVisit, avgDuration } = booking;

    // Usage pattern insights
    if (bookingCount === 1) {
      insights.push("First time parking here");
    } else if (bookingCount >= 5) {
      insights.push(`One of your top parking spots (${bookingCount} visits)`);
    }

    // Rating insights
    if (avgRating >= 4.5) {
      insights.push("Excellent experience here");
    } else if (avgRating <= 3.0 && avgRating > 0) {
      insights.push("Mixed experience at this location");
    }

    // Timing insights
    if (daysSinceLastVisit <= 3) {
      insights.push("Recently visited");
    } else if (daysSinceLastVisit >= 30) {
      insights.push("Haven't been here in a while");
    }

    // Duration insights
    if (avgDuration >= 6) {
      insights.push("Typically park for long durations here");
    } else if (avgDuration <= 2) {
      insights.push("Usually quick visits here");
    }

    // Completion rate insights
    if (completionRate >= 0.9) {
      insights.push("Very reliable for your bookings");
    } else if (completionRate <= 0.6) {
      insights.push("Some booking issues in the past");
    }

    return insights.slice(0, 3); // Limit to top 3 insights
  }

  /**
   * Calculate recommendation score (0-100)
   */
  calculateRecommendationScore(booking) {
    let score = 50; // Base score

    const { bookingCount, avgRating, completionRate, daysSinceLastVisit } = booking;

    // Frequency bonus (0-25 points)
    score += Math.min(bookingCount * 5, 25);

    // Rating bonus (0-20 points)
    if (avgRating > 0) {
      score += (avgRating / 5) * 20;
    }

    // Completion rate bonus (0-15 points)
    score += completionRate * 15;

    // Recency bonus/penalty (-10 to +10 points)
    if (daysSinceLastVisit <= 7) {
      score += 10; // Recent visit bonus
    } else if (daysSinceLastVisit <= 30) {
      score += 5; // Moderate recency
    } else if (daysSinceLastVisit >= 90) {
      score -= 10; // Long time ago penalty
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Determine if location should be recommended
   */
  shouldRecommend(booking) {
    const { bookingCount, avgRating, completionRate, daysSinceLastVisit } = booking;

    // Don't recommend if too many cancellations
    if (completionRate < 0.5) return false;

    // Don't recommend if poor rating
    if (avgRating > 0 && avgRating < 3.0) return false;

    // Don't recommend if very old visit
    if (daysSinceLastVisit > 180) return false;

    // Recommend if good track record
    if (bookingCount >= 2 && completionRate >= 0.8) return true;

    // Recommend if recent and good rating
    if (daysSinceLastVisit <= 30 && (avgRating >= 4.0 || avgRating === 0)) return true;

    return false;
  }

  /**
   * Get quick actions for the location
   */
  getQuickActions(booking, userId) {
    const actions = ['view_details'];

    // Add book action if recommended and parking space is available
    if (this.shouldRecommend(booking) && booking.parkingSpace.availableSpots > 0) {
      actions.unshift('book_again');
    }

    // Add bookmark action
    actions.push('bookmark');

    // Add navigation action
    actions.push('get_directions');

    return actions;
  }

  /**
   * Get full paginated recent locations (for "View All" functionality)
   */
  async getFullRecentLocations(userId, options = {}) {
    const {
      page = 1,
      limit = 20,
      sortBy = 'lastVisited', // 'lastVisited', 'bookingCount', 'rating'
      sortOrder = -1,
      category = null, // Filter by category
      timeframe = 365 // Extended timeframe for full view
    } = options;

    try {
      const allLocations = await this.getRecentLocationsFromBookings(userId, {
        limit: 100, // Get more locations
        timeframe
      });

      let filteredLocations = allLocations;

      // Apply category filter
      if (category) {
        filteredLocations = allLocations.filter(loc => loc.category === category);
      }

      // Apply sorting
      const sortField = sortBy === 'lastVisited' ? 'lastVisited' :
                       sortBy === 'bookingCount' ? 'bookingCount' :
                       sortBy === 'rating' ? 'avgRating' : 'lastVisited';

      filteredLocations.sort((a, b) => {
        const aVal = a[sortField] || 0;
        const bVal = b[sortField] || 0;
        return sortOrder === -1 ? bVal - aVal : aVal - bVal;
      });

      // Apply pagination
      const startIndex = (page - 1) * limit;
      const endIndex = startIndex + limit;
      const paginatedLocations = filteredLocations.slice(startIndex, endIndex);

      // Get statistics
      const stats = this.getLocationStats(allLocations);

      return {
        locations: paginatedLocations,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(filteredLocations.length / limit),
          totalItems: filteredLocations.length,
          hasNextPage: endIndex < filteredLocations.length,
          hasPrevPage: page > 1
        },
        stats,
        categories: this.getCategoryCounts(allLocations)
      };

    } catch (error) {
      logger.error(`Error getting full recent locations: ${error.message}`);
      throw error;
    }
  }

  /**
   * Get statistics about user's location history
   */
  getLocationStats(locations) {
    if (locations.length === 0) {
      return {
        totalLocations: 0,
        totalBookings: 0,
        totalSpent: 0,
        averageRating: 0,
        favoriteCount: 0,
        completionRate: 0
      };
    }

    const totalBookings = locations.reduce((sum, loc) => sum + loc.bookingCount, 0);
    const totalSpent = locations.reduce((sum, loc) => sum + loc.totalSpent, 0);
    const ratingsSum = locations.reduce((sum, loc) => sum + (loc.avgRating * loc.bookingCount), 0);
    const favoriteCount = locations.filter(loc => loc.category === 'favorite').length;

    // Calculate overall completion rate
    const totalCompletions = locations.reduce((sum, loc) =>
      sum + (loc.bookingCount * loc.completionRate / 100), 0
    );

    return {
      totalLocations: locations.length,
      totalBookings,
      totalSpent: Math.round(totalSpent),
      averageRating: totalBookings > 0 ? Math.round((ratingsSum / totalBookings) * 10) / 10 : 0,
      favoriteCount,
      completionRate: totalBookings > 0 ? Math.round((totalCompletions / totalBookings) * 100) : 0
    };
  }

  /**
   * Get category counts for filtering
   */
  getCategoryCounts(locations) {
    const counts = {
      all: locations.length,
      favorite: 0,
      frequent: 0,
      recent: 0,
      budget: 0,
      reliable: 0,
      regular: 0
    };

    locations.forEach(location => {
      if (counts[location.category] !== undefined) {
        counts[location.category]++;
      }
    });

    return counts;
  }

  /**
   * Categorize search location based on usage patterns
   */
  categorizeSearchLocation(search) {
    const { searchCount, daysSinceLastVisit, totalBookings } = search;
    const searchLocation = search.searchLocation;

    // Favorite: High search count with bookings
    if (searchCount >= 5 && totalBookings > 0) {
      return {
        type: 'favorite',
        reason: `Searched ${searchCount} times with ${totalBookings} bookings`
      };
    }

    // Frequent: Multiple searches
    if (searchCount >= 3) {
      return {
        type: 'frequent',
        reason: `Searched ${searchCount} times`
      };
    }

    // Recent: Searched within last week
    if (daysSinceLastVisit <= 7) {
      return {
        type: 'recent',
        reason: daysSinceLastVisit === 0 ? 'Searched today' : `${daysSinceLastVisit} days ago`
      };
    }

    // University: Educational institution
    if (searchLocation.category === 'university') {
      return {
        type: 'reliable',
        reason: 'University location'
      };
    }

    // Default: Regular
    return {
      type: 'regular',
      reason: `${searchCount} searches`
    };
  }

  /**
   * Get appropriate icon for search location category
   */
  getSearchLocationIcon(category, search) {
    const iconMap = {
      favorite: '⭐',
      frequent: '🔥',
      recent: '🕒',
      budget: '💰',
      reliable: '🏫', // University icon
      regular: '📍'
    };

    return iconMap[category.type] || '📍';
  }

  /**
   * Get appropriate label for search location
   */
  getSearchLocationLabel(category, search) {
    const labelMap = {
      favorite: 'Favorite',
      frequent: `${search.searchCount}x`,
      recent: 'Recent',
      budget: 'Budget',
      reliable: 'University',
      regular: 'Searched'
    };

    return labelMap[category.type] || 'Searched';
  }

  /**
   * Generate insights about the search location
   */
  generateSearchLocationInsights(search) {
    const insights = [];
    const { searchCount, daysSinceLastVisit, totalBookings } = search;
    const searchLocation = search.searchLocation;

    // Usage pattern insights
    if (searchCount === 1) {
      insights.push("Recently searched location");
    } else if (searchCount >= 5) {
      insights.push(`Frequently searched (${searchCount} times)`);
    }

    // Booking insights
    if (totalBookings > 0) {
      insights.push(`${totalBookings} bookings made here`);
    } else {
      insights.push("No bookings yet at this location");
    }

    // Category insights
    if (searchLocation.category === 'university') {
      insights.push("Educational institution");
    }

    // Timing insights
    if (daysSinceLastVisit <= 1) {
      insights.push("Very recently searched");
    } else if (daysSinceLastVisit >= 30) {
      insights.push("Haven't searched in a while");
    }

    return insights.slice(0, 3); // Limit to top 3 insights
  }

  /**
   * Calculate recommendation score for search locations (0-100)
   */
  calculateSearchRecommendationScore(search) {
    let score = 50; // Base score

    const { searchCount, daysSinceLastVisit, totalBookings } = search;
    const searchLocation = search.searchLocation;

    // Search frequency bonus (0-30 points)
    score += Math.min(searchCount * 6, 30);

    // University bonus (0-20 points)
    if (searchLocation.category === 'university') {
      score += 20;
    }

    // Booking bonus (0-20 points)
    score += Math.min(totalBookings * 10, 20);

    // User interest score bonus (0-15 points)
    const interestScore = searchLocation.aiMetrics?.userInterestScore || 0;
    score += (interestScore / 100) * 15;

    // Recency bonus/penalty (-10 to +15 points)
    if (daysSinceLastVisit <= 3) {
      score += 15; // Very recent search bonus
    } else if (daysSinceLastVisit <= 7) {
      score += 10; // Recent search bonus
    } else if (daysSinceLastVisit <= 30) {
      score += 5; // Moderate recency
    } else if (daysSinceLastVisit >= 90) {
      score -= 10; // Long time ago penalty
    }

    return Math.max(0, Math.min(100, Math.round(score)));
  }

  /**
   * Determine if search location should be recommended
   */
  shouldRecommendSearch(search) {
    const { searchCount, daysSinceLastVisit } = search;
    const searchLocation = search.searchLocation;

    // Always recommend universities
    if (searchLocation.category === 'university') return true;

    // Recommend if searched multiple times
    if (searchCount >= 2) return true;

    // Recommend if searched recently
    if (daysSinceLastVisit <= 14) return true;

    return false;
  }

  /**
   * Get quick actions for search locations
   */
  getSearchQuickActions(search, userId) {
    const actions = ['view_nearby_parking'];

    // Add search again action
    actions.push('search_again');

    // Add bookmark action
    actions.push('bookmark');

    // Add navigation action
    actions.push('get_directions');

    return actions;
  }
}

module.exports = new RecentLocationsService();