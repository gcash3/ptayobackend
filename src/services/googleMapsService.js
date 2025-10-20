const { Client } = require('@googlemaps/google-maps-services-js');
const logger = require('../config/logger');

class GoogleMapsService {
  constructor() {
    this.client = new Client({});
    this.apiKey = process.env.GOOGLE_MAPS_API_KEY;
    logger.info(`🗺️ Google Maps Service initialized with API key: ${this.apiKey ? 'SET' : 'NOT SET'}`);
  }

  // Geocode an address to get latitude and longitude
  async geocodeAddress(address) {
    try {
      const response = await this.client.geocode({
        params: {
          address: address,
          key: this.apiKey,
        },
      });

      if (response.data.results.length > 0) {
        const result = response.data.results[0];
        const location = result.geometry.location;
        
        return {
          success: true,
          data: {
            latitude: location.lat,
            longitude: location.lng,
            formattedAddress: result.formatted_address,
            placeId: result.place_id,
            addressComponents: result.address_components,
          }
        };
      } else {
        return {
          success: false,
          error: 'No results found for the given address'
        };
      }
    } catch (error) {
      logger.error('Geocoding error:', error);
      
      // Handle specific API errors
      if (error.response?.status === 403) {
        logger.warn('Google Maps API key may be invalid or expired');
        return {
          success: false,
          error: 'Google Maps API key error - please check configuration'
        };
      }
      
      return {
        success: false,
        error: 'Failed to geocode address'
      };
    }
  }

  // Reverse geocode coordinates to get address
  async reverseGeocode(latitude, longitude) {
    try {
      const response = await this.client.reverseGeocode({
        params: {
          latlng: { lat: latitude, lng: longitude },
          key: this.apiKey,
        },
      });

      if (response.data.results.length > 0) {
        const result = response.data.results[0];
        
        return {
          success: true,
          data: {
            formattedAddress: result.formatted_address,
            placeId: result.place_id,
            addressComponents: result.address_components,
          }
        };
      } else {
        return {
          success: false,
          error: 'No results found for the given coordinates'
        };
      }
    } catch (error) {
      logger.error('Reverse geocoding error:', error);
      return {
        success: false,
        error: 'Failed to reverse geocode coordinates'
      };
    }
  }

  // Calculate distance between two points using Google Distance Matrix API
  async calculateDistance(origin, destination, mode = 'driving') {
    try {
      const response = await this.client.distancematrix({
        params: {
          origins: [origin],
          destinations: [destination],
          mode: mode, // driving, walking
          units: 'metric',
          key: this.apiKey,
        },
      });

      const element = response.data.rows[0]?.elements[0];
      
      if (element && element.status === 'OK') {
        return {
          success: true,
          data: {
            distance: {
              text: element.distance.text,
              value: element.distance.value, // in meters
              kilometers: element.distance.value / 1000
            },
            duration: {
              text: element.duration.text,
              value: element.duration.value, // in seconds
              minutes: Math.round(element.duration.value / 60)
            }
          }
        };
      } else {
        return {
          success: false,
          error: 'Unable to calculate distance'
        };
      }
    } catch (error) {
      logger.error('Distance calculation error:', error);
      return {
        success: false,
        error: 'Failed to calculate distance'
      };
    }
  }

  // Get nearby places (like universities, landmarks)
  async getNearbyPlaces(latitude, longitude, radius = 1000, type = 'university') {
    try {
      const response = await this.client.placesNearby({
        params: {
          location: { lat: latitude, lng: longitude },
          radius: radius, // in meters
          type: type,
          key: this.apiKey,
        },
      });

      if (response.data.results.length > 0) {
        const places = response.data.results.map(place => ({
          name: place.name,
          placeId: place.place_id,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          vicinity: place.vicinity,
          rating: place.rating,
          types: place.types,
          distance: this.calculateStraightLineDistance(
            latitude, longitude,
            place.geometry.location.lat, place.geometry.location.lng
          )
        }));

        return {
          success: true,
          data: places
        };
      } else {
        return {
          success: true,
          data: []
        };
      }
    } catch (error) {
      logger.error('Nearby places error:', error);
      return {
        success: false,
        error: 'Failed to get nearby places'
      };
    }
  }

  // Get place details by place ID
  async getPlaceDetails(placeId) {
    try {
      const response = await this.client.placeDetails({
        params: {
          place_id: placeId,
          fields: ['name', 'formatted_address', 'geometry', 'rating', 'opening_hours', 'website', 'phone_number'],
          key: this.apiKey,
        },
      });

      if (response.data.result) {
        const place = response.data.result;
        return {
          success: true,
          data: {
            name: place.name,
            address: place.formatted_address,
            latitude: place.geometry?.location?.lat,
            longitude: place.geometry?.location?.lng,
            rating: place.rating,
            website: place.website,
            phoneNumber: place.formatted_phone_number,
            openingHours: place.opening_hours
          }
        };
      } else {
        return {
          success: false,
          error: 'Place not found'
        };
      }
    } catch (error) {
      logger.error('Place details error:', error);
      return {
        success: false,
        error: 'Failed to get place details'
      };
    }
  }

  // Calculate straight-line distance (fallback method)
  calculateStraightLineDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = this.toRadians(lat2 - lat1);
    const dLng = this.toRadians(lng2 - lng1);
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRadians(lat1)) * Math.cos(this.toRadians(lat2)) *
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in kilometers
  }

  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  // Validate if coordinates are within Philippines bounds
  isWithinPhilippines(latitude, longitude) {
    // Philippines approximate bounds
    const bounds = {
      north: 21.120611,
      south: 4.225000,
      east: 126.601563,
      west: 116.931641
    };

    return latitude >= bounds.south && latitude <= bounds.north &&
           longitude >= bounds.west && longitude <= bounds.east;
  }

  // Get timezone for coordinates
  async getTimezone(latitude, longitude, timestamp = null) {
    try {
      const params = {
        location: { lat: latitude, lng: longitude },
        timestamp: timestamp || Math.floor(Date.now() / 1000),
        key: this.apiKey,
      };

      const response = await this.client.timezone({ params });
      
      if (response.data.status === 'OK') {
        return {
          success: true,
          data: {
            timeZoneId: response.data.timeZoneId,
            timeZoneName: response.data.timeZoneName,
            dstOffset: response.data.dstOffset,
            rawOffset: response.data.rawOffset
          }
        };
      } else {
        return {
          success: false,
          error: 'Unable to get timezone information'
        };
      }
    } catch (error) {
      logger.error('Timezone error:', error);
      return {
        success: false,
        error: 'Failed to get timezone'
      };
    }
  }

  // Get route planning/directions between two points
  async getDirections(origin, destination, mode = 'driving', waypoints = []) {
    try {
      const params = {
        origin: origin,
        destination: destination,
                 mode: mode, // driving, walking
         waypoints: waypoints,
        optimize: waypoints.length > 0,
        units: 'metric',
        region: 'ph', // Philippines region
        key: this.apiKey,
      };

      const response = await this.client.directions({ params });

      if (response.data.routes && response.data.routes.length > 0) {
        const route = response.data.routes[0];
        const leg = route.legs[0];

        return {
          success: true,
          data: {
            route: {
              summary: route.summary,
              distance: {
                text: leg.distance.text,
                value: leg.distance.value,
                kilometers: leg.distance.value / 1000
              },
              duration: {
                text: leg.duration.text,
                value: leg.duration.value,
                minutes: Math.round(leg.duration.value / 60)
              },
              steps: leg.steps.map(step => ({
                instruction: step.html_instructions.replace(/<[^>]*>/g, ''), // Remove HTML tags
                distance: step.distance.text,
                duration: step.duration.text,
                startLocation: step.start_location,
                endLocation: step.end_location
              })),
              polyline: route.overview_polyline.points,
              bounds: route.bounds,
              warnings: route.warnings,
              copyrights: route.copyrights
            }
          }
        };
      } else {
        return {
          success: false,
          error: 'No route found'
        };
      }
    } catch (error) {
      logger.error('Directions error:', error);
      return {
        success: false,
        error: 'Failed to get directions'
      };
    }
  }

  // Search for places using text query
  async searchPlaces(query, latitude = null, longitude = null, radius = 5000) {
    try {
      const params = {
        query: query,
        key: this.apiKey,
      };

      // Add location bias if coordinates provided
      if (latitude && longitude) {
        params.location = { lat: latitude, lng: longitude };
        params.radius = radius;
      }

      const response = await this.client.textSearch({ params });

      if (response.data.results) {
        const places = response.data.results.map(place => ({
          name: place.name,
          placeId: place.place_id,
          address: place.formatted_address,
          latitude: place.geometry.location.lat,
          longitude: place.geometry.location.lng,
          rating: place.rating,
          priceLevel: place.price_level,
          types: place.types,
          photos: place.photos ? place.photos.map(photo => ({
            reference: photo.photo_reference,
            width: photo.width,
            height: photo.height
          })) : [],
          openingHours: place.opening_hours,
          distance: latitude && longitude ? this.calculateStraightLineDistance(
            latitude, longitude,
            place.geometry.location.lat, place.geometry.location.lng
          ) : null
        }));

        return {
          success: true,
          data: places
        };
      } else {
        return {
          success: true,
          data: []
        };
      }
    } catch (error) {
      logger.error('Places search error:', error);
      return {
        success: false,
        error: 'Failed to search places'
      };
    }
  }

  // Validate address and get standardized format
  async validateAddress(address, components = {}) {
    try {
      const params = {
        address: address,
        components: components, // Can include country, administrative_area, etc.
        region: 'ph', // Philippines
        key: this.apiKey,
      };

      const response = await this.client.geocode({ params });

      if (response.data.results.length > 0) {
        const result = response.data.results[0];
        const location = result.geometry.location;
        const addressComponents = result.address_components;

        // Extract address parts
        const getComponent = (type) => {
          const component = addressComponents.find(comp => comp.types.includes(type));
          return component ? component.long_name : null;
        };

        return {
          success: true,
          data: {
            isValid: true,
            formattedAddress: result.formatted_address,
            location: {
              latitude: location.lat,
              longitude: location.lng
            },
            components: {
              streetNumber: getComponent('street_number'),
              route: getComponent('route'),
              locality: getComponent('locality'),
              sublocality: getComponent('sublocality'),
              administrativeAreaLevel1: getComponent('administrative_area_level_1'),
              administrativeAreaLevel2: getComponent('administrative_area_level_2'),
              country: getComponent('country'),
              postalCode: getComponent('postal_code')
            },
            placeId: result.place_id,
            locationType: result.geometry.location_type,
            partialMatch: result.partial_match || false
          }
        };
      } else {
        return {
          success: true,
          data: {
            isValid: false,
            error: 'Address not found or invalid'
          }
        };
      }
    } catch (error) {
      logger.error('Address validation error:', error);
      return {
        success: false,
        error: 'Failed to validate address'
      };
    }
  }

  // Get elevation data for coordinates
  async getElevation(locations) {
    try {
      const params = {
        locations: locations, // Array of {lat, lng} objects or encoded polyline
        key: this.apiKey,
      };

      const response = await this.client.elevation({ params });

      if (response.data.results) {
        const elevationData = response.data.results.map(result => ({
          latitude: result.location.lat,
          longitude: result.location.lng,
          elevation: result.elevation,
          resolution: result.resolution
        }));

        return {
          success: true,
          data: elevationData
        };
      } else {
        return {
          success: false,
          error: 'No elevation data found'
        };
      }
    } catch (error) {
      logger.error('Elevation error:', error);
      return {
        success: false,
        error: 'Failed to get elevation data'
      };
    }
  }

  // Get traffic information for a route
  async getTrafficInfo(origin, destination, departureTime = null) {
    try {
      const params = {
        origins: [origin],
        destinations: [destination],
        mode: 'driving',
        units: 'metric',
        departure_time: departureTime || 'now',
        traffic_model: 'best_guess',
        key: this.apiKey,
      };

      logger.info(`🗺️ Google Maps API Request - Key: ${this.apiKey ? 'SET' : 'NOT SET'}`);
      logger.info(`🗺️ Distance Matrix params: ${JSON.stringify({
        origins: params.origins,
        destinations: params.destinations,
        mode: params.mode,
        departure_time: params.departure_time,
        traffic_model: params.traffic_model,
        apiKey: params.key ? 'SET' : 'NOT SET'
      }, null, 2)}`);

      const response = await this.client.distancematrix({ params });
      
      logger.info(`🗺️ Google Maps Response Status: ${response.status}`);
      logger.info(`🗺️ Google Maps Response Data: ${JSON.stringify({
        status: response.data.status,
        rows: response.data.rows?.length || 0,
        elementStatus: response.data.rows?.[0]?.elements?.[0]?.status,
        distance: response.data.rows?.[0]?.elements?.[0]?.distance?.text,
        duration: response.data.rows?.[0]?.elements?.[0]?.duration?.text,
        durationInTraffic: response.data.rows?.[0]?.elements?.[0]?.duration_in_traffic?.text
      }, null, 2)}`);
      const element = response.data.rows[0]?.elements[0];

      if (element && element.status === 'OK') {
        return {
          success: true,
          data: {
            distance: {
              text: element.distance.text,
              value: element.distance.value,
              kilometers: element.distance.value / 1000
            },
            duration: {
              text: element.duration.text,
              value: element.duration.value,
              minutes: Math.round(element.duration.value / 60)
            },
            durationInTraffic: element.duration_in_traffic ? {
              text: element.duration_in_traffic.text,
              value: element.duration_in_traffic.value,
              minutes: Math.round(element.duration_in_traffic.value / 60)
            } : null,
            trafficDelay: element.duration_in_traffic ? 
              element.duration_in_traffic.value - element.duration.value : 0
          }
        };
      } else {
        return {
          success: false,
          error: 'Unable to get traffic information'
        };
      }
    } catch (error) {
      logger.error('Traffic info error:', error);
      return {
        success: false,
        error: 'Failed to get traffic information'
      };
    }
  }

  // Batch geocoding for multiple addresses
  async batchGeocode(addresses) {
    try {
      const results = await Promise.allSettled(
        addresses.map(address => this.geocodeAddress(address))
      );

      return results.map((result, index) => ({
        address: addresses[index],
        success: result.status === 'fulfilled' && result.value.success,
        data: result.status === 'fulfilled' ? result.value.data : null,
        error: result.status === 'rejected' || !result.value.success ? 
          (result.reason?.message || result.value?.error || 'Unknown error') : null
      }));
    } catch (error) {
      logger.error('Batch geocode error:', error);
      throw new Error('Failed to batch geocode addresses');
    }
  }

  // Find optimal parking spaces based on route
  async findParkingAlongRoute(origin, destination, maxDetour = 1000, parkingSpaces = []) {
    try {
      // Get the main route
      const mainRoute = await this.getDirections(origin, destination);
      if (!mainRoute.success) {
        return mainRoute;
      }

      const suitableParkingSpaces = [];

      for (const space of parkingSpaces) {
        const spaceLocation = `${space.latitude},${space.longitude}`;
        
        // Calculate route with parking space as waypoint
        const routeWithParking = await this.getDirections(origin, destination, 'driving', [spaceLocation]);
        
        if (routeWithParking.success) {
          const originalDuration = mainRoute.data.route.duration.value;
          const detourDuration = routeWithParking.data.route.duration.value;
          const detourTime = detourDuration - originalDuration;

          if (detourTime <= maxDetour) {
            suitableParkingSpaces.push({
              ...space,
              detourTime: detourTime,
              detourDistance: routeWithParking.data.route.distance.value - mainRoute.data.route.distance.value,
              routeWithParking: routeWithParking.data.route
            });
          }
        }
      }

      // Sort by detour time
      suitableParkingSpaces.sort((a, b) => a.detourTime - b.detourTime);

      return {
        success: true,
        data: {
          mainRoute: mainRoute.data.route,
          suitableParkingSpaces
        }
      };
    } catch (error) {
      logger.error('Parking route optimization error:', error);
      return {
        success: false,
        error: 'Failed to optimize parking route'
      };
    }
  }
}

module.exports = new GoogleMapsService(); 