const SuggestedParking = require('../models/SuggestedParking');
const UserPreference = require('../models/UserPreference');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const mongoose = require('mongoose');
const { validateRequest } = require('../middleware/validation');

// Local distance calculator (Haversine)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Helper: normalize to [0,1]
const normalize = (value, min, max) => {
  if (min === max) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
};

// Helper: logistic function to map score to 0..1
const sigmoid = (z) => 1 / (1 + Math.exp(-z));

// Helper: choose top destination center from past bookings
async function getTopDestinationFromBookings(userId) {
  const results = await Booking.aggregate([
    { $match: { userId: new mongoose.Types.ObjectId(userId) } },
    { $group: { _id: '$parkingSpaceId', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 1 }
  ]);

  if (!results.length) return null;
  const topSpaceId = results[0]._id;
  const space = await ParkingSpace.findById(topSpaceId).lean();
  if (!space || !space.location || !Array.isArray(space.location.coordinates)) return null;
  const [lng, lat] = space.location.coordinates;
  return { latitude: lat, longitude: lng, label: space.name };
}

// Helper: choose top area from user preferences (acts as search history proxy)
async function getTopAreaFromPreferences(userId) {
  const prefs = await UserPreference.findOne({ userId }).lean();
  if (!prefs) return null;

  // Prefer search history as proxy for destination intent
  if (Array.isArray(prefs.searchHistory) && prefs.searchHistory.length) {
    const topSearch = [...prefs.searchHistory].sort((a, b) => (b.count || 0) - (a.count || 0))[0];
    if (topSearch?.coordinates?.coordinates) {
      const [lng, lat] = topSearch.coordinates.coordinates;
      return { latitude: lat, longitude: lng, label: topSearch.term };
    }
  }

  // Fallback to favorite areas
  if (Array.isArray(prefs.favoriteAreas) && prefs.favoriteAreas.length) {
    const top = [...prefs.favoriteAreas].sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0))[0];
    if (top?.coordinates?.coordinates) {
      const [lng, lat] = top.coordinates.coordinates;
      return { latitude: lat, longitude: lng, label: top.name };
    }
  }

  return null;
}

// Helper: compute amenities score 0..1
const computeAmenitiesScore = (amenities = []) => {
  const MAX_AMENITIES = 8; // matches enum in SuggestedParking model
  return Math.max(0, Math.min(1, (amenities.length || 0) / MAX_AMENITIES));
};

// Helper: derive coefficients from user preferences (weights)
function getCoefficientsFromPreferences(userPreference) {
  // Base weights (distance, rating, amenities, price)
  let beta = { b0: 0, b1: 1.0, b2: 0.8, b3: 0.6, b4: 0.8 };

  if (!userPreference?.mlFeatures) return beta;

  const priceSensitivity = userPreference.mlFeatures.priceSensitivity ?? 0.5;
  const distanceSensitivity = userPreference.mlFeatures.distanceSensitivity ?? 0.5;

  // Adjust weights based on sensitivities (0..1)
  beta.b1 *= 0.8 + distanceSensitivity * 0.6; // 0.8..1.4
  beta.b4 *= 0.8 + priceSensitivity * 0.6;     // 0.8..1.4

  return beta;
}

// Get suggested parking spaces with smart ranking and fallbacks
const getSuggestedParkingSpaces = async (req, res) => {
  try {
    const { latitude, longitude, radius = 5000, filterType, maxPrice, availableOnly = true, limit = 10 } = req.query;
    const userId = req.user.id;

    const limitNum = parseInt(limit);
    const searchRadius = parseInt(radius); // meters
    const userLat = latitude ? parseFloat(latitude) : null;
    const userLng = longitude ? parseFloat(longitude) : null;

    // Determine target destination center using fallbacks
    let target = await getTopDestinationFromBookings(userId);
    if (!target) {
      target = await getTopAreaFromPreferences(userId);
    }

    // If we still don't have a target and no user coordinates, fallback to popularity
    if (!target && (userLat == null || userLng == null)) {
      const popularSpaces = await SuggestedParking.find({ isAvailable: availableOnly !== false })
        .sort({ popularityScore: -1, rating: -1 })
        .limit(limitNum * 2)
        .lean();

      const now = Date.now();
      const scored = popularSpaces.map((space) => {
        const ageDays = Math.max(0, (now - new Date(space.createdAt).getTime()) / (1000 * 60 * 60 * 24));
        const bookingScore = normalize(space.totalBookings || 0, 0, Math.max(...popularSpaces.map(s => s.totalBookings || 0), 1));
        const ratingScore = (space.rating || 0) / 5;
        const freshness = Math.max(0.5, 1 - (ageDays / 60)); // decay after ~2 months
        const popularityScore = 0.6 * bookingScore + 0.4 * ratingScore;
        const finalScore = popularityScore * 0.85 + freshness * 0.15;
        return { ...space, finalScore };
      }).sort((a, b) => b.finalScore - a.finalScore).slice(0, limitNum);

      return res.json({ success: true, data: scored, count: scored.length, strategy: 'popularity' });
    }

    // Use target (destination from history) if available, else user location as target
    const targetLat = target?.latitude ?? userLat;
    const targetLng = target?.longitude ?? userLng;

    if (targetLat == null || targetLng == null) {
      return res.status(400).json({ success: false, message: 'Latitude and longitude are required when no history is available' });
    }

    // Build base query near the target location
    const baseQuery = {
      location: {
        $near: {
          $geometry: { type: 'Point', coordinates: [targetLng, targetLat] },
          $maxDistance: searchRadius
        }
      }
    };

    if (availableOnly) baseQuery.isAvailable = true;
    if (filterType) baseQuery.type = filterType;
    if (maxPrice) baseQuery.price = { $lte: parseFloat(maxPrice) };

    // Fetch a wider candidate set for better scoring
    const candidates = await SuggestedParking.find(baseQuery)
      .populate('landlordId', 'name email phone')
      .limit(limitNum * 3)
      .lean();

    if (!candidates.length) {
      // fallback to popularity if no nearby
      const popular = await SuggestedParking.find({ isAvailable: availableOnly !== false })
        .sort({ popularityScore: -1, rating: -1 })
        .limit(limitNum)
        .lean();
      return res.json({ success: true, data: popular, count: popular.length, strategy: 'popularity_fallback' });
    }

    // For price normalization (avoid name collision with query param maxPrice)
    const priceMinCandidate = Math.min(...candidates.map(c => c.price || 0));
    const priceMaxCandidate = Math.max(
      ...candidates.map(c => c.price || 0),
      priceMinCandidate + 1
    );

    // Load user preferences for coefficients
    const userPreference = await UserPreference.findOne({ userId }).lean();
    const beta = getCoefficientsFromPreferences(userPreference);

    // Score candidates using logistic regression-like scoring
    const scored = candidates.map(space => {
      const distanceKm = calculateDistance(
        targetLat,
        targetLng,
        space.location.coordinates[1],
        space.location.coordinates[0]
      );
      // Convert distance to score (closer better). searchRadius is meters; convert to km
      const maxDistanceKm = Math.max(0.5, searchRadius / 1000);
      const distanceScore = Math.max(0, 1 - (distanceKm / maxDistanceKm));
      const ratingScore = (space.rating || 0) / 5;
      const amenitiesScore = computeAmenitiesScore(space.amenities);
      const priceNorm = normalize(space.price || 0, priceMinCandidate, priceMaxCandidate);
      const priceScore = 1 - priceNorm; // cheaper better

      const z = (beta.b0 || 0) + beta.b1 * distanceScore + beta.b2 * ratingScore + beta.b3 * amenitiesScore + beta.b4 * priceScore;
      const probability = sigmoid(z);

      const distanceFromUser = (userLat != null && userLng != null)
        ? calculateDistance(userLat, userLng, space.location.coordinates[1], space.location.coordinates[0])
        : null;

      return {
        ...space,
        distanceToTarget: distanceKm,
        distance: distanceFromUser ?? distanceKm,
        formattedDistance: (distanceFromUser ?? distanceKm) < 1 ? `${Math.round((distanceFromUser ?? distanceKm) * 1000)}m` : `${(distanceFromUser ?? distanceKm).toFixed(1)}km`,
        formattedPrice: `₱${(space.price || 0).toFixed(0)}/hr`,
        formattedRating: (space.rating || 0).toFixed(1),
        regressionScore: probability,
        features: { distanceScore, ratingScore, amenitiesScore, priceScore }
      };
    })
    .sort((a, b) => b.regressionScore - a.regressionScore)
    .slice(0, limitNum);

    res.json({
      success: true,
      data: scored,
      count: scored.length,
      strategy: target ? 'history_or_search' : 'location_based'
    });

  } catch (error) {
    console.error('Error getting suggested parking spaces:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get personalized parking suggestions using new AI-driven approach
const getPersonalizedSuggestions = async (req, res) => {
  try {
    const userId = req.user.id;
    const { latitude, longitude, limit = 1 } = req.query; // Default to 1 for best candidate

    console.log(`🤖 [PERSONALIZED] Request from user ${userId} for AI-driven suggestions`);

    // Use our new AI parking suggestion service
    const aiParkingSuggestionService = require('../services/aiParkingSuggestionService');

    const userLocation = (latitude && longitude) ? {
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude)
    } : null;

    // Get AI suggestions using the same service as the new controller
    const aiServiceResult = await aiParkingSuggestionService.generateSuggestions(
      userId,
      {
        filterType: 'nearby',
        latitude: userLocation?.latitude,
        longitude: userLocation?.longitude,
        limit: 1, // Always get only 1 best candidate
        radiusKm: 5
      }
    );

    // Handle the response - service returns array directly
    const suggestions = Array.isArray(aiServiceResult) ? aiServiceResult : [];

    console.log(`🤖 [PERSONALIZED] AI returned ${suggestions.length} suggestions`);

    if (suggestions.length === 0) {
      console.log(`📍 [PERSONALIZED] No suggestions found, returning empty response`);
      return res.json({
        success: true,
        message: 'No recent search locations found. Search for places first to get nearby parking suggestions.',
        data: {
          bestCandidate: null,
          totalCount: 0,
          aiDriven: true,
          generatedAt: new Date(),
          userContext: {
            hasCurrentLocation: !!userLocation,
            hasSearchHistory: false,
            locationSource: 'no_search_history'
          }
        }
      });
    }

    // Format the best candidate
    const bestCandidate = suggestions[0];
    const formattedCandidate = {
      id: bestCandidate._id,
      name: bestCandidate.name,
      address: bestCandidate.address,
      latitude: bestCandidate.latitude,
      longitude: bestCandidate.longitude,
      distance: userLocation ? calculateDistance(userLocation.latitude, userLocation.longitude, bestCandidate.latitude, bestCandidate.longitude) : null,
      price: bestCandidate.pricing?.hourlyRate || 0,
      rating: bestCandidate.rating || 4.0,
      totalReviews: bestCandidate.totalReviews || 0,
      isAvailable: bestCandidate.isActive && bestCandidate.isVerified,
      imageUrl: bestCandidate.images?.[0] || null,
      type: bestCandidate.type || 'open',
      description: bestCandidate.description || 'AI recommended parking space',
      amenities: bestCandidate.amenities || [],
      currentOccupancy: bestCandidate.currentOccupancy || null,
      landlordName: bestCandidate.landlordName,
      isVerified: bestCandidate.isVerified,
      aiScore: bestCandidate.aiScore,
      aiBreakdown: bestCandidate.aiBreakdown,
      recommendationReason: bestCandidate.recommendationReason
    };

    console.log(`✅ [PERSONALIZED] Returning best candidate: ${formattedCandidate.name} (score: ${bestCandidate.aiScore})`);

    res.json({
      success: true,
      message: 'Best parking space recommendation retrieved successfully',
      data: {
        bestCandidate: formattedCandidate,
        totalCount: 1,
        aiDriven: true,
        scoringMethod: 'Weighted scoring: 40% distance, 25% rating, 20% pricing, 15% amenities',
        generatedAt: new Date(),
        userContext: {
          hasCurrentLocation: !!userLocation,
          locationSource: 'ai_driven',
          timeContext: new Date().getHours() >= 8 && new Date().getHours() <= 18 ? 'work_hours' : 'personal_hours'
        }
      }
    });

  } catch (error) {
    console.error('🔥 [PERSONALIZED] Error getting AI suggestions:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to retrieve AI-driven parking suggestions',
      data: null
    });
  }
};

// Get popular parking locations
const getPopularParkingLocations = async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const popularParking = await SuggestedParking.findPopular(parseInt(limit));

    const enhancedParking = popularParking.map(space => ({
      ...space.toObject(),
      formattedPrice: `₱${space.price.toFixed(0)}/hr`,
      formattedRating: space.rating.toFixed(1),
      popularityScore: space.popularityScore.toFixed(1)
    }));

    res.json({
      success: true,
      data: enhancedParking,
      count: enhancedParking.length
    });

  } catch (error) {
    console.error('Error getting popular parking locations:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get parking spaces near a specific location
const getParkingSpacesNearLocation = async (req, res) => {
  try {
    const {
      latitude,
      longitude,
      radius = 2000, // 2km default
      limit = 20
    } = req.query;

    if (!latitude || !longitude) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required'
      });
    }

    const coordinates = [parseFloat(longitude), parseFloat(latitude)];

    const parkingSpaces = await SuggestedParking.findNearby(coordinates, parseInt(radius))
      .limit(parseInt(limit))
      .lean();

    const enhancedParkingSpaces = parkingSpaces.map(space => {
      const distance = calculateDistance(
        latitude,
        longitude,
        space.location.coordinates[1],
        space.location.coordinates[0]
      );

      return {
        ...space,
        distance: distance,
        formattedDistance: distance < 1 ? `${Math.round(distance * 1000)}m` : `${distance.toFixed(1)}km`,
        formattedPrice: `₱${space.price.toFixed(0)}/hr`,
        formattedRating: space.rating.toFixed(1)
      };
    });

    res.json({
      success: true,
      data: enhancedParkingSpaces,
      count: enhancedParkingSpaces.length
    });

  } catch (error) {
    console.error('Error getting parking spaces near location:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Update parking space availability (real-time)
const updateParkingAvailability = async (req, res) => {
  try {
    const { parkingSpaceId } = req.params;
    const { bookedSpaces } = req.body;

    const parkingSpace = await SuggestedParking.findById(parkingSpaceId);
    
    if (!parkingSpace) {
      return res.status(404).json({
        success: false,
        message: 'Parking space not found'
      });
    }

    await parkingSpace.updateOccupancy(bookedSpaces);

    res.json({
      success: true,
      data: {
        id: parkingSpace._id,
        isAvailable: parkingSpace.isAvailable,
        currentOccupancy: parkingSpace.currentOccupancy,
        availableSpaces: parkingSpace.availableSpaces
      }
    });

  } catch (error) {
    console.error('Error updating parking availability:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get parking analytics
const getParkingAnalytics = async (req, res) => {
  try {
    const { parkingSpaceId } = req.params;

    const parkingSpace = await SuggestedParking.findById(parkingSpaceId);
    
    if (!parkingSpace) {
      return res.status(404).json({
        success: false,
        message: 'Parking space not found'
      });
    }

    const analytics = {
      totalBookings: parkingSpace.totalBookings,
      averageBookingDuration: parkingSpace.averageBookingDuration,
      revenue: parkingSpace.revenue,
      peakHours: parkingSpace.peakHours,
      popularityScore: parkingSpace.popularityScore,
      currentOccupancy: parkingSpace.currentOccupancy,
      availableSpaces: parkingSpace.availableSpaces
    };

    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Error getting parking analytics:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Get user parking patterns
const getUserParkingPatterns = async (req, res) => {
  try {
    const userId = req.user.id;

    const userPreference = await UserPreference.findOne({ userId });
    
    if (!userPreference) {
      return res.json({
        success: true,
        data: {
          totalBookings: 0,
          totalSpent: 0,
          averageBookingDuration: 0,
          averageRating: 0,
          peakUsageHours: [],
          preferredDays: [],
          favoriteAreas: []
        }
      });
    }

    const patterns = {
      totalBookings: userPreference.totalBookings,
      totalSpent: userPreference.totalSpent,
      averageBookingDuration: userPreference.averageBookingDuration,
      averageRating: userPreference.averageRating,
      peakUsageHours: userPreference.peakUsageHours.sort((a, b) => b.frequency - a.frequency).slice(0, 5),
      preferredDays: userPreference.preferredDays.sort((a, b) => b.frequency - a.frequency),
      favoriteAreas: userPreference.favoriteAreas.sort((a, b) => b.visitCount - a.visitCount).slice(0, 5),
      preferences: userPreference.getPersonalizedRecommendations()
    };

    res.json({
      success: true,
      data: patterns
    });

  } catch (error) {
    console.error('Error getting user parking patterns:', error);
    res.status(500).json({
      success: false,
      message: 'Internal server error'
    });
  }
};

// Record user search history (term + optional coordinates)
const addSearchHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const { term, latitude, longitude } = req.body || {};

    if (!term || typeof term !== 'string') {
      return res.status(400).json({ success: false, message: 'term is required' });
    }

    // Upsert user preference doc
    let prefs = await UserPreference.findOne({ userId });
    if (!prefs) {
      prefs = new UserPreference({ userId, searchHistory: [] });
    }

    const normalizedTerm = term.trim();
    const existing = prefs.searchHistory.find(
      (e) => e.term && e.term.toLowerCase() === normalizedTerm.toLowerCase()
    );

    if (existing) {
      existing.count = (existing.count || 0) + 1;
      existing.lastSearched = new Date();
      if (latitude != null && longitude != null) {
        existing.coordinates = {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        };
      }
    } else {
      const entry = {
        term: normalizedTerm,
        count: 1,
        lastSearched: new Date()
      };
      if (latitude != null && longitude != null) {
        entry.coordinates = {
          type: 'Point',
          coordinates: [parseFloat(longitude), parseFloat(latitude)]
        };
      }
      prefs.searchHistory.push(entry);
    }

    // Keep only most recent 50 search entries
    prefs.searchHistory = prefs.searchHistory
      .sort((a, b) => new Date(b.lastSearched) - new Date(a.lastSearched))
      .slice(0, 50);

    prefs.lastActivity = new Date();
    await prefs.save();

    const response = prefs.searchHistory
      .map((e) => ({
        term: e.term,
        count: e.count,
        lastSearched: e.lastSearched,
        coordinates: e.coordinates?.coordinates
          ? { latitude: e.coordinates.coordinates[1], longitude: e.coordinates.coordinates[0] }
          : null
      }))
      .sort((a, b) => b.count - a.count);

    res.json({ success: true, data: response });
  } catch (error) {
    console.error('Error adding search history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

// Get user search history
const getSearchHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const prefs = await UserPreference.findOne({ userId }).lean();
    const history = (prefs?.searchHistory || [])
      .map((e) => ({
        term: e.term,
        count: e.count,
        lastSearched: e.lastSearched,
        coordinates: e.coordinates?.coordinates
          ? { latitude: e.coordinates.coordinates[1], longitude: e.coordinates.coordinates[0] }
          : null
      }))
      .sort((a, b) => new Date(b.lastSearched) - new Date(a.lastSearched));

    res.json({ success: true, data: history });
  } catch (error) {
    console.error('Error getting search history:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

module.exports = {
  getSuggestedParkingSpaces,
  getPersonalizedSuggestions,
  getPopularParkingLocations,
  getParkingSpacesNearLocation,
  updateParkingAvailability,
  getParkingAnalytics,
  getUserParkingPatterns,
  addSearchHistory,
  getSearchHistory
};
