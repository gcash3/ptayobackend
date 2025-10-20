const Booking = require('../models/Booking');
const RecentLocation = require('../models/RecentLocation');
const ParkingSpace = require('../models/ParkingSpace');
const logger = require('../config/logger');

class AiAnalyticsService {
  
  /**
   * Analyzes user booking patterns to identify home/work locations and behavioral patterns
   */
  static async identifyUserPatterns(userId) {
    try {
      const bookings = await Booking.find({
        userId: userId,
        status: { $in: ['completed', 'checked_out'] }
      })
      .populate('parkingSpaceId', 'name address latitude longitude')
      .sort({ createdAt: -1 })
      .limit(100);

      if (bookings.length === 0) {
        return {
          homeLocation: null,
          workLocation: null,
          patterns: {
            weekdayPattern: {},
            weekendPattern: {},
            timeSlots: {}
          }
        };
      }

      // Group locations by proximity and time patterns
      const locationClusters = this._clusterLocationsByProximity(bookings);
      const timePatterns = this._analyzeTimePatterns(bookings);
      
      // Identify home and work based on time patterns
      const { homeLocation, workLocation } = this._identifyHomeWorkLocations(
        locationClusters, 
        timePatterns
      );

      return {
        homeLocation,
        workLocation,
        patterns: timePatterns,
        locationClusters,
        totalBookings: bookings.length
      };

    } catch (error) {
      logger.error('Error identifying user patterns:', error);
      throw error;
    }
  }

  /**
   * Calculates AI-driven location importance score
   */
  static async calculateLocationScore(userId, location, currentTime = new Date()) {
    try {
      // Get user's booking history for this location
      const bookings = await this._getLocationBookings(userId, location);
      const searches = await this._getLocationSearches(userId, location);
      
      // Calculate frequency score (0-100)
      const frequencyScore = this._calculateFrequencyScore(bookings, searches);
      
      // Calculate recency score (0-100) 
      const recencyScore = this._calculateRecencyScore(bookings, searches, currentTime);
      
      // Calculate success rate score (0-100)
      const successRate = this._calculateSuccessRate(bookings, searches);
      
      // Calculate time pattern score (0-100)
      const timePatternScore = await this._calculateTimePatternScore(
        userId, location, currentTime
      );

      // Calculate contextual bonus
      const contextualBonus = await this._calculateContextualBonus(
        userId, location, currentTime
      );

      // Apply weighted formula
      const totalScore = (
        (frequencyScore * 0.4) +
        (recencyScore * 0.3) +
        (successRate * 0.2) +
        (timePatternScore * 0.1) +
        (contextualBonus * 0.1)
      );

      return {
        totalScore: Math.min(100, totalScore),
        breakdown: {
          frequency: frequencyScore,
          recency: recencyScore,
          successRate: successRate,
          timePattern: timePatternScore,
          contextualBonus: contextualBonus
        },
        metadata: {
          totalBookings: bookings.length,
          totalSearches: searches.length,
          lastVisit: bookings.length > 0 ? bookings[0].createdAt : null
        }
      };

    } catch (error) {
      logger.error('Error calculating location score:', error);
      return { totalScore: 0, breakdown: {}, metadata: {} };
    }
  }

  /**
   * Gets AI-driven top 3 recent locations for user
   */
  static async calculateTopRecentLocations(userId, currentLocation, timeContext = new Date(), limit = 3) {
    try {
      // Get all potential recent locations (bookings + searches)
      const recentSearches = await RecentLocation.find({ userId }).sort({ lastSearched: -1 });
      const bookingLocations = await this._getUniqueBookingLocations(userId);

      // Combine and deduplicate locations
      const allLocations = this._combineAndDeduplicateLocations(recentSearches, bookingLocations);
      
      // Calculate AI scores for each location
      const scoredLocations = await Promise.all(
        allLocations.map(async (location) => {
          const score = await this.calculateLocationScore(userId, location, timeContext);
          return {
            ...location,
            aiScore: score.totalScore,
            aiBreakdown: score.breakdown,
            metadata: score.metadata
          };
        })
      );

      // Sort by AI score and return top 3
      const topLocations = scoredLocations
        .sort((a, b) => b.aiScore - a.aiScore)
        .slice(0, limit)
        .map(location => ({
          id: location._id || location.id,
          name: location.name,
          address: location.address,
          latitude: location.latitude,
          longitude: location.longitude,
          type: this._determineLocationType(location, timeContext),
          aiScore: location.aiScore,
          lastVisited: location.lastSearched || location.lastVisited,
          visitCount: location.searchCount || location.visitCount || 1,
          icon: this._getLocationIcon(location),
          label: this._getLocationLabel(location, timeContext)
        }));

      return topLocations;

    } catch (error) {
      logger.error('Error calculating top recent locations:', error);
      return [];
    }
  }

  /**
   * Gets personalized parking suggestions based on AI analysis
   */
  static async getPersonalizedSuggestions(userId, filterType = 'nearby', userLocation, limit = 10) {
    try {
      const userPatterns = await this.identifyUserPatterns(userId);
      let baseQuery = {};
      let sortCriteria = {};

      // Build query based on filter type
      switch (filterType) {
        case 'near_current':
          if (userLocation && userLocation.latitude && userLocation.longitude) {
            baseQuery = this._buildProximityQuery(userLocation, 2); // 2km radius
          }
          break;
        
        case 'near_work':
          if (userPatterns.workLocation) {
            baseQuery = this._buildProximityQuery(userPatterns.workLocation, 3); // 3km radius
          }
          break;
          
        case 'near_home':
          if (userPatterns.homeLocation) {
            baseQuery = this._buildProximityQuery(userPatterns.homeLocation, 3); // 3km radius
          }
          break;
          
        case 'frequent_areas':
          const frequentAreas = userPatterns.locationClusters || [];
          if (frequentAreas.length > 0) {
            baseQuery = this._buildFrequentAreasQuery(frequentAreas);
          }
          break;
          
        case 'time_based':
          baseQuery = await this._buildTimeBasedQuery(userId, new Date());
          break;
          
        default: // 'nearby' (fallback to last search or any known context)
          if (userLocation && userLocation.latitude && userLocation.longitude) {
            baseQuery = this._buildProximityQuery(userLocation, 5); // 5km radius
          } else {
            // No device location and no patterns: return active+verified without geofilter, sorted by rating/recency
            baseQuery = {};
            sortCriteria = { rating: -1 };
          }
      }

      // Get parking spaces matching criteria
      const parkingSpaces = await ParkingSpace.find({
        ...baseQuery,
        isActive: true,
        isVerified: true
      }).sort(sortCriteria || {}).limit(50);

      // Score each parking space with AI
      const scoredSpaces = await Promise.all(
        parkingSpaces.map(async (space) => {
          const aiScore = await this._calculateParkingSuggestionScore(
            userId, space, filterType, userLocation, userPatterns
          );
          
          return {
            ...space.toObject(),
            aiScore: aiScore.totalScore,
            aiBreakdown: aiScore.breakdown,
            recommendationReason: aiScore.reason
          };
        })
      );

      // Sort by AI score and return top results
      return scoredSpaces
        .sort((a, b) => b.aiScore - a.aiScore)
        .slice(0, limit);

    } catch (error) {
      logger.error('Error getting personalized suggestions:', error);
      return [];
    }
  }

  // Private helper methods
  static _clusterLocationsByProximity(bookings, threshold = 0.005) {
    const clusters = [];
    const proximityThreshold = threshold; // ~500 meters

    bookings.forEach(booking => {
      if (!booking.parkingSpaceId || !booking.parkingSpaceId.latitude) return;

      const space = booking.parkingSpaceId;
      let addedToCluster = false;

      // Try to add to existing cluster
      for (const cluster of clusters) {
        const latDiff = Math.abs(cluster.centerLat - space.latitude);
        const lngDiff = Math.abs(cluster.centerLng - space.longitude);
        
        if (latDiff < proximityThreshold && lngDiff < proximityThreshold) {
          cluster.bookings.push(booking);
          cluster.visitCount++;
          addedToCluster = true;
          break;
        }
      }

      // Create new cluster if not added to existing
      if (!addedToCluster) {
        clusters.push({
          centerLat: space.latitude,
          centerLng: space.longitude,
          name: space.name,
          address: space.address,
          bookings: [booking],
          visitCount: 1
        });
      }
    });

    return clusters.sort((a, b) => b.visitCount - a.visitCount);
  }

  static _analyzeTimePatterns(bookings) {
    const patterns = {
      weekdayPattern: {},
      weekendPattern: {},
      timeSlots: {},
      hourlyDistribution: new Array(24).fill(0)
    };

    bookings.forEach(booking => {
      const date = new Date(booking.createdAt);
      const hour = date.getHours();
      const dayOfWeek = date.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      // Hour distribution
      patterns.hourlyDistribution[hour]++;

      // Time slot categorization
      let timeSlot;
      if (hour >= 6 && hour < 12) timeSlot = 'morning';
      else if (hour >= 12 && hour < 18) timeSlot = 'afternoon';
      else if (hour >= 18 && hour < 22) timeSlot = 'evening';
      else timeSlot = 'night';

      if (isWeekend) {
        patterns.weekendPattern[timeSlot] = (patterns.weekendPattern[timeSlot] || 0) + 1;
      } else {
        patterns.weekdayPattern[timeSlot] = (patterns.weekdayPattern[timeSlot] || 0) + 1;
      }

      patterns.timeSlots[timeSlot] = (patterns.timeSlots[timeSlot] || 0) + 1;
    });

    return patterns;
  }

  static _identifyHomeWorkLocations(locationClusters, timePatterns) {
    let homeLocation = null;
    let workLocation = null;

    if (locationClusters.length === 0) return { homeLocation, workLocation };

    // Work location: most frequent during weekday mornings/afternoons
    const workCandidates = locationClusters.filter(cluster => {
      const workHourBookings = cluster.bookings.filter(booking => {
        const hour = new Date(booking.createdAt).getHours();
        const isWeekday = ![0, 6].includes(new Date(booking.createdAt).getDay());
        return isWeekday && (hour >= 8 && hour <= 18);
      });
      return workHourBookings.length >= cluster.bookings.length * 0.6;
    });

    if (workCandidates.length > 0) {
      workLocation = workCandidates[0];
    }

    // Home location: frequent during evenings/nights or weekends
    const homeCandidates = locationClusters.filter(cluster => {
      if (workLocation && cluster.centerLat === workLocation.centerLat) return false;
      
      const homeHourBookings = cluster.bookings.filter(booking => {
        const hour = new Date(booking.createdAt).getHours();
        const isWeekend = [0, 6].includes(new Date(booking.createdAt).getDay());
        return isWeekend || (hour >= 18 || hour <= 8);
      });
      return homeHourBookings.length >= cluster.bookings.length * 0.4;
    });

    if (homeCandidates.length > 0) {
      homeLocation = homeCandidates[0];
    }

    return { homeLocation, workLocation };
  }

  static async _getLocationBookings(userId, location) {
    const proximityThreshold = 0.001; // ~100 meters
    
    return await Booking.find({
      userId: userId,
      status: { $in: ['completed', 'checked_out'] },
      'parkingSpaceId.latitude': {
        $gte: location.latitude - proximityThreshold,
        $lte: location.latitude + proximityThreshold
      },
      'parkingSpaceId.longitude': {
        $gte: location.longitude - proximityThreshold,
        $lte: location.longitude + proximityThreshold
      }
    }).sort({ createdAt: -1 });
  }

  static async _getLocationSearches(userId, location) {
    const proximityThreshold = 0.001; // ~100 meters
    
    return await RecentLocation.find({
      userId: userId,
      latitude: {
        $gte: location.latitude - proximityThreshold,
        $lte: location.latitude + proximityThreshold
      },
      longitude: {
        $gte: location.longitude - proximityThreshold,
        $lte: location.longitude + proximityThreshold
      }
    }).sort({ lastSearched: -1 });
  }

  static _calculateFrequencyScore(bookings, searches) {
    const totalInteractions = bookings.length + searches.reduce((sum, search) => sum + search.searchCount, 0);
    // Normalize to 0-100 scale (assuming max 50 interactions is 100 points)
    return Math.min(100, (totalInteractions / 50) * 100);
  }

  static _calculateRecencyScore(bookings, searches, currentTime) {
    const allDates = [
      ...bookings.map(b => b.createdAt),
      ...searches.map(s => s.lastSearched)
    ];

    if (allDates.length === 0) return 0;

    const mostRecent = new Date(Math.max(...allDates.map(d => new Date(d).getTime())));
    const daysSinceLastVisit = (currentTime - mostRecent) / (1000 * 60 * 60 * 24);
    
    // Score decreases exponentially with days (30 days = 0 points, 0 days = 100 points)
    return Math.max(0, 100 - (daysSinceLastVisit * 3.33));
  }

  static _calculateSuccessRate(bookings, searches) {
    const totalSearches = searches.reduce((sum, search) => sum + search.searchCount, 0);
    const totalBookings = bookings.length;
    
    if (totalSearches === 0 && totalBookings === 0) return 50; // Neutral score
    if (totalSearches === 0) return 100; // All interactions were successful bookings
    
    return (totalBookings / (totalBookings + totalSearches)) * 100;
  }

  static async _calculateTimePatternScore(userId, location, currentTime) {
    try {
      const userPatterns = await this.identifyUserPatterns(userId);
      const currentHour = currentTime.getHours();
      const isWeekend = [0, 6].includes(currentTime.getDay());
      
      let timeSlot;
      if (currentHour >= 6 && currentHour < 12) timeSlot = 'morning';
      else if (currentHour >= 12 && currentHour < 18) timeSlot = 'afternoon';
      else if (currentHour >= 18 && currentHour < 22) timeSlot = 'evening';
      else timeSlot = 'night';

      const relevantPattern = isWeekend ? 
        userPatterns.patterns.weekendPattern : 
        userPatterns.patterns.weekdayPattern;
      
      const timeSlotCount = relevantPattern[timeSlot] || 0;
      const totalPatternCount = Object.values(relevantPattern).reduce((sum, count) => sum + count, 0);
      
      if (totalPatternCount === 0) return 50; // Neutral score
      
      return (timeSlotCount / totalPatternCount) * 100;
    } catch (error) {
      return 50; // Neutral score on error
    }
  }

  static async _calculateContextualBonus(userId, location, currentTime) {
    // Add bonus points based on special contexts
    let bonus = 0;
    
    try {
      const userPatterns = await this.identifyUserPatterns(userId);
      
      // Work location bonus during work hours
      if (userPatterns.workLocation && 
          this._isLocationNear(location, userPatterns.workLocation) &&
          this._isWorkHours(currentTime)) {
        bonus += 20;
      }
      
      // Home location bonus during evening/night
      if (userPatterns.homeLocation && 
          this._isLocationNear(location, userPatterns.homeLocation) &&
          this._isHomeHours(currentTime)) {
        bonus += 15;
      }

      return Math.min(30, bonus); // Max 30 bonus points
    } catch (error) {
      return 0;
    }
  }

  static _isLocationNear(location1, location2, threshold = 0.005) {
    const latDiff = Math.abs(location1.latitude - location2.centerLat);
    const lngDiff = Math.abs(location1.longitude - location2.centerLng);
    return latDiff < threshold && lngDiff < threshold;
  }

  static _isWorkHours(currentTime) {
    const hour = currentTime.getHours();
    const isWeekday = ![0, 6].includes(currentTime.getDay());
    return isWeekday && hour >= 8 && hour <= 18;
  }

  static _isHomeHours(currentTime) {
    const hour = currentTime.getHours();
    const isWeekend = [0, 6].includes(currentTime.getDay());
    return isWeekend || hour >= 18 || hour <= 8;
  }

  static async _getUniqueBookingLocations(userId) {
    const bookings = await Booking.aggregate([
      {
        $match: {
          userId: userId,
          status: { $in: ['completed', 'checked_out'] }
        }
      },
      {
        $lookup: {
          from: 'parkingspaces',
          localField: 'parkingSpaceId',
          foreignField: '_id',
          as: 'parkingSpace'
        }
      },
      {
        $unwind: '$parkingSpace'
      },
      {
        $group: {
          _id: {
            lat: { $round: ['$parkingSpace.latitude', 3] },
            lng: { $round: ['$parkingSpace.longitude', 3] }
          },
          name: { $first: '$parkingSpace.name' },
          address: { $first: '$parkingSpace.address' },
          latitude: { $first: '$parkingSpace.latitude' },
          longitude: { $first: '$parkingSpace.longitude' },
          visitCount: { $sum: 1 },
          lastVisited: { $max: '$createdAt' },
          firstVisited: { $min: '$createdAt' }
        }
      },
      {
        $sort: { visitCount: -1 }
      }
    ]);

    return bookings.map(booking => ({
      ...booking,
      id: booking._id,
      type: 'booking_history'
    }));
  }

  static _combineAndDeduplicateLocations(searches, bookings) {
    const combined = [];
    const seen = new Set();

    // Add searches
    searches.forEach(search => {
      const key = `${search.latitude.toFixed(3)}_${search.longitude.toFixed(3)}`;
      if (!seen.has(key)) {
        combined.push(search);
        seen.add(key);
      }
    });

    // Add bookings (check for duplicates)
    bookings.forEach(booking => {
      const key = `${booking.latitude.toFixed(3)}_${booking.longitude.toFixed(3)}`;
      if (!seen.has(key)) {
        combined.push({
          ...booking,
          searchCount: booking.visitCount,
          lastSearched: booking.lastVisited
        });
        seen.add(key);
      }
    });

    return combined;
  }

  static _determineLocationType(location, timeContext) {
    // Enhanced type determination based on context
    if (location.type) return location.type;
    
    const hour = timeContext.getHours();
    const isWeekday = ![0, 6].includes(timeContext.getDay());
    
    if (isWeekday && hour >= 8 && hour <= 18) {
      return 'work';
    } else if (!isWeekday || hour >= 18 || hour <= 8) {
      return 'home';
    }
    
    return 'frequent_location';
  }

  static _getLocationIcon(location) {
    switch (location.type) {
      case 'work': return '🏢';
      case 'home': return '🏠';
      case 'bookmark': return '⭐';
      case 'search': return '🔍';
      case 'frequent_location': return '🎯';
      default: return '📍';
    }
  }

  static _getLocationLabel(location, timeContext) {
    const type = this._determineLocationType(location, timeContext);
    switch (type) {
      case 'work': return 'Work';
      case 'home': return 'Home';
      case 'frequent_location': return 'Frequent';
      default: return 'Recent';
    }
  }

  // Additional helper methods for parking suggestions
  static _buildProximityQuery(location, radiusKm) {
    const earthRadiusKm = 6371;
    const radiusRad = radiusKm / earthRadiusKm;
    
    return {
      location: {
        $geoWithin: {
          $centerSphere: [[location.longitude, location.latitude], radiusRad]
        }
      }
    };
  }

  static _buildFrequentAreasQuery(frequentAreas) {
    const areaQueries = frequentAreas.slice(0, 3).map(area => 
      this._buildProximityQuery({ 
        latitude: area.centerLat, 
        longitude: area.centerLng 
      }, 2)
    );

    return { $or: areaQueries };
  }

  static async _buildTimeBasedQuery(userId, currentTime) {
    const userPatterns = await this.identifyUserPatterns(userId);
    const hour = currentTime.getHours();
    
    // Return query based on current time and historical patterns
    if (hour >= 8 && hour <= 18 && userPatterns.workLocation) {
      return this._buildProximityQuery(userPatterns.workLocation, 5);
    } else if ((hour >= 18 || hour <= 8) && userPatterns.homeLocation) {
      return this._buildProximityQuery(userPatterns.homeLocation, 5);
    }
    
    return {}; // Return all if no specific pattern
  }

  static async _calculateParkingSuggestionScore(userId, parkingSpace, filterType, userLocation, userPatterns) {
    let proximityScore = 0;
    let patternMatchScore = 0;
    let availabilityScore = 0;
    let preferenceScore = 0;
    let reason = '';

    // Calculate proximity score based on filter type
    switch (filterType) {
      case 'near_current':
        if (userLocation) {
          const distance = this._calculateDistance(userLocation, parkingSpace);
          proximityScore = Math.max(0, 100 - (distance * 20)); // 100 points at 0km, 0 points at 5km
          reason = `${distance.toFixed(1)}km from current location`;
        }
        break;
      case 'near_work':
        if (userPatterns.workLocation) {
          const distance = this._calculateDistance(userPatterns.workLocation, parkingSpace);
          proximityScore = Math.max(0, 100 - (distance * 15));
          reason = `Near your work area`;
        }
        break;
      case 'near_home':
        if (userPatterns.homeLocation) {
          const distance = this._calculateDistance(userPatterns.homeLocation, parkingSpace);
          proximityScore = Math.max(0, 100 - (distance * 15));
          reason = `Near your home area`;
        }
        break;
    }

    // Pattern match score (historical usage)
    const historicalBookings = await this._getLocationBookings(userId, parkingSpace);
    patternMatchScore = Math.min(100, historicalBookings.length * 10);

    // Availability prediction score
    availabilityScore = parkingSpace.isActive ? 80 : 20;

    // User preference score (ratings, price range, amenities)
    preferenceScore = this._calculatePreferenceScore(parkingSpace, userPatterns);

    const totalScore = (
      (proximityScore * 0.4) +
      (patternMatchScore * 0.25) +
      (availabilityScore * 0.2) +
      (preferenceScore * 0.15)
    );

    return {
      totalScore,
      breakdown: {
        proximity: proximityScore,
        patternMatch: patternMatchScore,
        availability: availabilityScore,
        preference: preferenceScore
      },
      reason: reason || 'Personalized recommendation'
    };
  }

  static _calculateDistance(location1, location2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (location2.latitude - location1.latitude) * Math.PI / 180;
    const dLon = (location2.longitude - location1.longitude) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(location1.latitude * Math.PI / 180) * Math.cos(location2.latitude * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  static _calculatePreferenceScore(parkingSpace, userPatterns) {
    let score = 50; // Base score
    
    // Price preference (placeholder - would need user's historical price ranges)
    if (parkingSpace.pricing && parkingSpace.pricing.hourlyRate) {
      const price = parkingSpace.pricing.hourlyRate;
      if (price >= 20 && price <= 60) score += 20; // Reasonable price range
    }

    // Rating boost
    if (parkingSpace.rating && parkingSpace.rating >= 4.0) {
      score += 15;
    }

    // Amenities boost (security, covered, etc.)
    if (parkingSpace.amenities && parkingSpace.amenities.length > 2) {
      score += 10;
    }

    return Math.min(100, score);
  }
}

module.exports = AiAnalyticsService;