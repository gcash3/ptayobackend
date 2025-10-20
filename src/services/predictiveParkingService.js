const SuggestedParking = require('../models/SuggestedParking');
const UserPreference = require('../models/UserPreference');
const Booking = require('../models/Booking');

class PredictiveParkingService {
  // Predict parking demand based on historical data
  async predictParkingDemand(parkingSpaceId, date, hour) {
    try {
      // Get historical booking data for the same day and hour
      const historicalBookings = await Booking.aggregate([
        {
          $match: {
            parkingSpaceId: parkingSpaceId,
            $expr: {
              $and: [
                { $eq: [{ $dayOfWeek: '$startTime' }, { $dayOfWeek: new Date(date) }] },
                { $eq: [{ $hour: '$startTime' }, hour] }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            totalBookings: { $sum: 1 },
            averageDuration: { $avg: '$duration' },
            totalRevenue: { $sum: '$amount' }
          }
        }
      ]);

      if (historicalBookings.length === 0) {
        return {
          predictedDemand: 0.5, // Default moderate demand
          confidence: 0.3,
          factors: ['No historical data available']
        };
      }

      const data = historicalBookings[0];
      
      // Calculate demand score (0-1)
      const demandScore = Math.min(1, data.totalBookings / 10); // Normalize to 10 bookings max
      
      // Calculate confidence based on data consistency
      const confidence = Math.min(1, data.totalBookings / 5); // More data = higher confidence

      return {
        predictedDemand: demandScore,
        confidence: confidence,
        factors: [
          `Historical bookings: ${data.totalBookings}`,
          `Average duration: ${data.averageDuration.toFixed(1)} hours`,
          `Total revenue: ₱${data.totalRevenue.toFixed(0)}`
        ]
      };

    } catch (error) {
      console.error('Error predicting parking demand:', error);
      return {
        predictedDemand: 0.5,
        confidence: 0.1,
        factors: ['Error in prediction']
      };
    }
  }

  // Predict optimal pricing based on demand and competition
  async predictOptimalPricing(parkingSpaceId, date, hour) {
    try {
      const parkingSpace = await SuggestedParking.findById(parkingSpaceId);
      if (!parkingSpace) {
        throw new Error('Parking space not found');
      }

      // Get nearby parking spaces for competition analysis
      const nearbySpaces = await SuggestedParking.find({
        location: {
          $near: {
            $geometry: parkingSpace.location,
            $maxDistance: 2000 // 2km radius
          }
        },
        _id: { $ne: parkingSpaceId }
      }).limit(10);

      // Calculate average price in the area
      const averagePrice = nearbySpaces.length > 0 
        ? nearbySpaces.reduce((sum, space) => sum + space.price, 0) / nearbySpaces.length
        : parkingSpace.price;

      // Get demand prediction
      const demandPrediction = await this.predictParkingDemand(parkingSpaceId, date, hour);

      // Calculate optimal price based on demand and competition
      let optimalPrice = parkingSpace.price;
      
      if (demandPrediction.predictedDemand > 0.7) {
        // High demand - can increase price
        optimalPrice = Math.min(parkingSpace.price * 1.2, averagePrice * 1.1);
      } else if (demandPrediction.predictedDemand < 0.3) {
        // Low demand - should decrease price
        optimalPrice = Math.max(parkingSpace.price * 0.8, averagePrice * 0.9);
      }

      return {
        currentPrice: parkingSpace.price,
        optimalPrice: Math.round(optimalPrice),
        averageCompetitorPrice: Math.round(averagePrice),
        demandLevel: demandPrediction.predictedDemand,
        recommendation: this.getPricingRecommendation(demandPrediction.predictedDemand, parkingSpace.price, optimalPrice)
      };

    } catch (error) {
      console.error('Error predicting optimal pricing:', error);
      return {
        currentPrice: 0,
        optimalPrice: 0,
        averageCompetitorPrice: 0,
        demandLevel: 0.5,
        recommendation: 'Unable to generate pricing recommendation'
      };
    }
  }

  // Predict user's next parking location
  async predictUserNextLocation(userId, currentLocation) {
    try {
      const userPreference = await UserPreference.findOne({ userId });
      if (!userPreference) {
        return {
          predictedLocation: null,
          confidence: 0,
          reason: 'No user preference data available'
        };
      }

      // Get user's favorite areas
      const favoriteAreas = userPreference.favoriteAreas
        .sort((a, b) => b.visitCount - a.visitCount)
        .slice(0, 3);

      if (favoriteAreas.length === 0) {
        return {
          predictedLocation: null,
          confidence: 0,
          reason: 'No favorite areas found'
        };
      }

      // Calculate distance from current location to favorite areas
      const scoredAreas = favoriteAreas.map(area => {
        const distance = this.calculateDistance(
          currentLocation.latitude,
          currentLocation.longitude,
          area.coordinates.coordinates[1],
          area.coordinates.coordinates[0]
        );

        // Score based on visit frequency and distance
        const frequencyScore = area.visitCount / Math.max(...favoriteAreas.map(a => a.visitCount));
        const distanceScore = Math.max(0, 1 - (distance / 10)); // 10km max distance
        const totalScore = (frequencyScore * 0.7) + (distanceScore * 0.3);

        return {
          ...area,
          distance,
          score: totalScore
        };
      });

      // Sort by score
      scoredAreas.sort((a, b) => b.score - a.score);

      const topPrediction = scoredAreas[0];

      return {
        predictedLocation: {
          name: topPrediction.name,
          coordinates: topPrediction.coordinates.coordinates,
          distance: topPrediction.distance
        },
        confidence: topPrediction.score,
        reason: `Based on ${topPrediction.visitCount} previous visits`,
        alternatives: scoredAreas.slice(1, 3).map(area => ({
          name: area.name,
          coordinates: area.coordinates.coordinates,
          distance: area.distance,
          confidence: area.score
        }))
      };

    } catch (error) {
      console.error('Error predicting user next location:', error);
      return {
        predictedLocation: null,
        confidence: 0,
        reason: 'Error in prediction'
      };
    }
  }

  // Predict parking availability for a specific time
  async predictParkingAvailability(parkingSpaceId, date, hour) {
    try {
      const parkingSpace = await SuggestedParking.findById(parkingSpaceId);
      if (!parkingSpace) {
        throw new Error('Parking space not found');
      }

      // Get demand prediction
      const demandPrediction = await this.predictParkingDemand(parkingSpaceId, date, hour);

      // Calculate predicted occupancy
      const predictedOccupancy = Math.min(100, demandPrediction.predictedDemand * 100);
      const predictedAvailableSpaces = Math.max(0, parkingSpace.totalSpaces - Math.ceil(predictedOccupancy * parkingSpace.totalSpaces / 100));

      return {
        parkingSpaceId,
        date,
        hour,
        predictedOccupancy: Math.round(predictedOccupancy),
        predictedAvailableSpaces,
        confidence: demandPrediction.confidence,
        recommendation: this.getAvailabilityRecommendation(predictedOccupancy, predictedAvailableSpaces)
      };

    } catch (error) {
      console.error('Error predicting parking availability:', error);
      return {
        parkingSpaceId,
        date,
        hour,
        predictedOccupancy: 50,
        predictedAvailableSpaces: Math.floor(parkingSpace?.totalSpaces / 2) || 0,
        confidence: 0.1,
        recommendation: 'Unable to predict availability'
      };
    }
  }

  // Get route optimization suggestions
  async getRouteOptimization(userLocation, destination, preferences = {}) {
    try {
      const { preferredPriceRange, preferredDistance, preferredTypes } = preferences;

      // Find parking spaces near destination
      const nearbyParking = await SuggestedParking.find({
        location: {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates: [destination.longitude, destination.latitude]
            },
            $maxDistance: (preferredDistance || 5) * 1000
          }
        },
        isAvailable: true
      }).limit(10);

      // Score parking spaces based on preferences
      const scoredParking = nearbyParking.map(space => {
        const distance = this.calculateDistance(
          destination.latitude,
          destination.longitude,
          space.location.coordinates[1],
          space.location.coordinates[0]
        );

        let score = 0;

        // Distance score
        const distanceScore = Math.max(0, 1 - (distance / (preferredDistance || 5)));
        score += distanceScore * 0.4;

        // Price score
        if (preferredPriceRange) {
          const priceScore = space.price >= preferredPriceRange.min && 
                           space.price <= preferredPriceRange.max ? 1 : 0.5;
          score += priceScore * 0.3;
        }

        // Type score
        if (preferredTypes && preferredTypes.length > 0) {
          const typeScore = preferredTypes.includes(space.type) ? 1 : 0.5;
          score += typeScore * 0.2;
        }

        // Rating score
        score += (space.rating / 5) * 0.1;

        return {
          ...space.toObject(),
          distance,
          score,
          estimatedTravelTime: this.estimateTravelTime(distance)
        };
      });

      // Sort by score
      scoredParking.sort((a, b) => b.score - a.score);

      return {
        destination,
        recommendedParking: scoredParking.slice(0, 5),
        routeOptions: this.generateRouteOptions(userLocation, destination, scoredParking.slice(0, 3))
      };

    } catch (error) {
      console.error('Error getting route optimization:', error);
      return {
        destination,
        recommendedParking: [],
        routeOptions: []
      };
    }
  }

  // Helper methods
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  estimateTravelTime(distance) {
    // Assume average speed of 30 km/h in city traffic
    const averageSpeed = 30;
    const travelTimeMinutes = (distance / averageSpeed) * 60;
    return Math.round(travelTimeMinutes);
  }

  getPricingRecommendation(demand, currentPrice, optimalPrice) {
    if (optimalPrice > currentPrice * 1.1) {
      return 'Consider increasing price due to high demand';
    } else if (optimalPrice < currentPrice * 0.9) {
      return 'Consider decreasing price to attract more customers';
    } else {
      return 'Current price is optimal for current demand';
    }
  }

  getAvailabilityRecommendation(occupancy, availableSpaces) {
    if (occupancy > 80) {
      return 'High demand expected - consider booking in advance';
    } else if (occupancy > 60) {
      return 'Moderate demand - book early to secure spot';
    } else {
      return 'Low demand expected - flexible booking options available';
    }
  }

  generateRouteOptions(userLocation, destination, parkingSpaces) {
    return parkingSpaces.map((space, index) => ({
      option: index + 1,
      parkingSpace: {
        name: space.name,
        address: space.address,
        distance: space.distance,
        price: space.price,
        rating: space.rating
      },
      route: {
        totalDistance: this.calculateDistance(
          userLocation.latitude,
          userLocation.longitude,
          space.location.coordinates[1],
          space.location.coordinates[0]
        ) + space.distance,
        estimatedTime: this.estimateTravelTime(
          this.calculateDistance(
            userLocation.latitude,
            userLocation.longitude,
            space.location.coordinates[1],
            space.location.coordinates[0]
          )
        ),
        waypoints: [
          { name: 'User Location', coordinates: [userLocation.longitude, userLocation.latitude] },
          { name: space.name, coordinates: space.location.coordinates },
          { name: 'Destination', coordinates: [destination.longitude, destination.latitude] }
        ]
      }
    }));
  }
}

module.exports = new PredictiveParkingService();
