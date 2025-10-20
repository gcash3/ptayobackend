const logger = require('../config/logger');

/**
 * Route Service - Handles route generation and navigation
 */
class RouteService {
  constructor() {
    this.logger = logger;
  }

  /**
   * Generate navigation URLs for different map applications
   */
  generateNavigationUrls(origin, destination, parkingSpaceName = 'Parking Space') {
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destinationStr = `${destination.latitude},${destination.longitude}`;
    const encodedParkingName = encodeURIComponent(parkingSpaceName);

    return {
      googleMaps: {
        web: `https://www.google.com/maps/dir/${originStr}/${destinationStr}`,
        mobile: `https://maps.google.com/?saddr=${originStr}&daddr=${destinationStr}&directionsmode=driving`,
        app: `comgooglemaps://?saddr=${originStr}&daddr=${destinationStr}&directionsmode=driving`
      },
      appleMaps: {
        url: `http://maps.apple.com/?saddr=${originStr}&daddr=${destinationStr}&dirflg=d`,
        app: `maps://?saddr=${originStr}&daddr=${destinationStr}&dirflg=d`
      },
      waze: {
        url: `https://waze.com/ul?ll=${destinationStr}&navigate=yes&from=${originStr}`,
        app: `waze://?ll=${destinationStr}&navigate=yes&from=${originStr}`
      },
      defaultNavigation: {
        url: `geo:${destinationStr}?q=${destinationStr}(${encodedParkingName})`,
        intent: `geo:${destinationStr}?q=${destinationStr}(${encodedParkingName})`
      }
    };
  }

  /**
   * Generate route waypoints for Flutter map display
   */
  generateRouteWaypoints(origin, destination, travelData = null) {
    const waypoints = [
      {
        latitude: origin.latitude,
        longitude: origin.longitude,
        type: 'origin',
        title: 'Your Location',
        icon: 'person_pin_circle'
      },
      {
        latitude: destination.latitude,
        longitude: destination.longitude,
        type: 'destination',
        title: 'Parking Space',
        icon: 'local_parking'
      }
    ];

    // Add intermediate waypoints if available from Google Directions API
    if (travelData && travelData.steps) {
      travelData.steps.forEach((step, index) => {
        if (step.start_location && index > 0) { // Skip first step
          waypoints.splice(-1, 0, {
            latitude: step.start_location.lat,
            longitude: step.start_location.lng,
            type: 'waypoint',
            title: `Step ${index}`,
            icon: 'navigation',
            instruction: step.html_instructions
          });
        }
      });
    }

    return waypoints;
  }

  /**
   * Generate route overview data for the smart booking analysis
   */
  generateRouteOverview(origin, destination, travelData, parkingSpaceName) {
    const navigationUrls = this.generateNavigationUrls(origin, destination, parkingSpaceName);
    const waypoints = this.generateRouteWaypoints(origin, destination, travelData);

    return {
      navigationUrls,
      waypoints,
      mapCenter: {
        latitude: (origin.latitude + destination.latitude) / 2,
        longitude: (origin.longitude + destination.longitude) / 2
      },
      mapZoom: this.calculateOptimalZoom(origin, destination),
      routePolyline: this.generateSimplePolyline(origin, destination),
      estimatedBounds: this.calculateRouteBounds(origin, destination)
    };
  }

  /**
   * Calculate optimal map zoom level based on distance
   */
  calculateOptimalZoom(origin, destination) {
    const distance = this.calculateDistance(origin, destination);
    
    if (distance < 1) return 15;      // Very close - city level
    if (distance < 5) return 13;      // Close - district level
    if (distance < 20) return 11;     // Medium - city/metro level
    if (distance < 50) return 9;      // Far - regional level
    return 7;                         // Very far - state level
  }

  /**
   * Calculate distance between two points (Haversine formula)
   */
  calculateDistance(origin, destination) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(destination.latitude - origin.latitude);
    const dLon = this.toRadians(destination.longitude - origin.longitude);
    const lat1 = this.toRadians(origin.latitude);
    const lat2 = this.toRadians(destination.latitude);

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Generate a simple polyline for route display
   */
  generateSimplePolyline(origin, destination) {
    // Simple straight line polyline - in production, this would use actual route data
    return [
      [origin.latitude, origin.longitude],
      [destination.latitude, destination.longitude]
    ];
  }

  /**
   * Calculate route bounds for map display
   */
  calculateRouteBounds(origin, destination) {
    const padding = 0.01; // Add some padding around the route
    
    return {
      northeast: {
        latitude: Math.max(origin.latitude, destination.latitude) + padding,
        longitude: Math.max(origin.longitude, destination.longitude) + padding
      },
      southwest: {
        latitude: Math.min(origin.latitude, destination.latitude) - padding,
        longitude: Math.min(origin.longitude, destination.longitude) - padding
      }
    };
  }

  /**
   * Generate turn-by-turn directions (fallback when Google Directions API unavailable)
   */
  generateBasicDirections(origin, destination, parkingSpaceName = 'Parking Space') {
    const distance = this.calculateDistance(origin, destination);
    const bearing = this.calculateBearing(origin, destination);
    const direction = this.bearingToDirection(bearing);

    return [
      {
        step: 1,
        instruction: `Head ${direction} towards ${parkingSpaceName}`,
        distance: `${distance.toFixed(1)} km`,
        duration: `${Math.round((distance / 30) * 60)} min`, // Assuming 30 km/h average
        maneuver: 'start'
      },
      {
        step: 2,
        instruction: `You have arrived at ${parkingSpaceName}`,
        distance: '0 m',
        duration: '0 min',
        maneuver: 'destination'
      }
    ];
  }

  /**
   * Calculate bearing between two points
   */
  calculateBearing(origin, destination) {
    const dLon = this.toRadians(destination.longitude - origin.longitude);
    const lat1 = this.toRadians(origin.latitude);
    const lat2 = this.toRadians(destination.latitude);

    const y = Math.sin(dLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

    const bearing = Math.atan2(y, x);
    return (bearing * 180 / Math.PI + 360) % 360; // Convert to degrees and normalize
  }

  /**
   * Convert bearing to cardinal direction
   */
  bearingToDirection(bearing) {
    const directions = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
    const index = Math.round(bearing / 45) % 8;
    return directions[index];
  }

  /**
   * Generate route summary for the smart booking analysis
   */
  generateRouteSummary(origin, destination, travelData, parkingSpaceName) {
    const routeOverview = this.generateRouteOverview(origin, destination, travelData, parkingSpaceName);
    const directions = this.generateBasicDirections(origin, destination, parkingSpaceName);

    return {
      ...routeOverview,
      directions,
      summary: {
        totalDistance: travelData.distance?.text || 'Unknown',
        estimatedTime: travelData.estimatedTime || travelData.duration?.text || 'Unknown',
        trafficCondition: travelData.trafficCondition || 'unknown',
        isRealData: travelData.isRealData || false
      }
    };
  }
}

module.exports = new RouteService();