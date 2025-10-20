const googleMapsService = require('./googleMapsService');
const googleWeatherService = require('./googleWeatherService');
const routeService = require('./routeService');
const User = require('../models/User');
const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const logger = require('../config/logger');

class SmartArrivalService {
  constructor() {
    this.weatherApiKey = process.env.WEATHER_API_KEY; // You'll need to get this
  }

  /**
   * Main entry point for smart booking analysis
   * @param {Object} params - Analysis parameters
   * @param {String} params.userId - User ID
   * @param {Object} params.origin - {latitude, longitude}
   * @param {Object} params.destination - {latitude, longitude}
   * @param {String} params.parkingSpaceId - Parking space ID
   * @returns {Object} Smart booking analysis
   */
  async analyzeSmartBooking(params) {
    try {
      const { userId, origin, destination, parkingSpaceId } = params;

      logger.info(`🧠 Starting smart booking analysis for user ${userId}`);

      // 1. Get user behavior data
      const user = await User.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      // 2. Get parking space information
      const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
      const parkingSpaceName = parkingSpace ? parkingSpace.name : 'Parking Space';

      // 3. Calculate base travel data with traffic (for route info)
      const travelData = await this.calculateTravelData(origin, destination);

      // 4. Get REAL Google Maps ETA with traffic to parking space
      const parkingCoords = `${destination.latitude},${destination.longitude}`;
      const originCoords = `${origin.latitude},${origin.longitude}`;

      const trafficInfo = await googleMapsService.getTrafficInfo(originCoords, parkingCoords);

      let realETA, confidence, factors;

      if (trafficInfo.success && trafficInfo.data.durationInTraffic) {
        // Use real Google Maps ETA with traffic
        const etaMinutes = trafficInfo.data.durationInTraffic.minutes;
        const baseMinutes = trafficInfo.data.duration.minutes;
        const trafficDelay = Math.max(0, etaMinutes - baseMinutes);

        realETA = etaMinutes;
        confidence = this.calculateETAConfidence(etaMinutes, trafficDelay, trafficInfo.data.distance.kilometers);

        factors = {
          baseTime: baseMinutes,
          trafficDelay: trafficDelay,
          realTime: true,
          distance: trafficInfo.data.distance.kilometers,
          trafficFactor: trafficDelay > 0 ? (trafficDelay / baseMinutes) : 0
        };

        logger.info(`🗺️ Google Maps ETA: ${etaMinutes}min (base: ${baseMinutes}min, traffic: +${trafficDelay}min)`);
      } else {
        // Fallback to 30-minute estimate if Google Maps fails
        realETA = 30;
        confidence = 60; // Lower confidence for fallback
        factors = {
          base: 30,
          fallback: true,
          reason: trafficInfo.error || 'Google Maps API unavailable'
        };

        logger.warn(`⚠️ Using fallback ETA: 30min (Google Maps failed: ${trafficInfo.error})`);
      }

      // Calculate arrival times with 15-minute grace period
      const departureTime = new Date();
      const estimatedArrival = new Date(Date.now() + realETA * 60 * 1000);
      const gracePeriodMinutes = 15; // Your suggested 15-minute grace period
      const maxArrivalWindow = new Date(estimatedArrival.getTime() + gracePeriodMinutes * 60 * 1000);
      const totalBookingWindow = realETA + gracePeriodMinutes;

      const arrivalPrediction = {
        departureTime,
        estimatedArrival,
        maxArrivalWindow,
        totalWindowMinutes: totalBookingWindow,
        realETAMinutes: realETA,
        gracePeriodMinutes,
        confidence,
        factors
      };

      logger.info(`🎯 Enhanced Prediction: ETA ${realETA}min + ${gracePeriodMinutes}min grace = ${totalBookingWindow}min window, Confidence: ${confidence}%`);

      // 6. Generate route information for navigation
      const routeInfo = routeService.generateRouteSummary(
        origin, 
        destination, 
        travelData, 
        parkingSpaceName
      );

      // 7. Determine if smart booking is viable (enhanced criteria)
      const isBookNowViable = this.isSmartBookingViable(realETA, confidence, factors);
      
      logger.info(`🎯 Fallback Analysis: ETA ${arrivalPrediction.totalWindowMinutes}min, Confidence ${arrivalPrediction.confidence}%, Viable: ${isBookNowViable}`);

      // 8. Generate alternatives if smart booking not viable
      const alternatives = [];
      if (!isBookNowViable) {
        alternatives.push({
          type: 'reservation',
          title: 'Reserve Parking Space',
          description: 'Book this space for a specific time slot',
          estimatedTime: 'Flexible',
          confidence: 95,
          recommended: true
        });
      }

      // 9. Generate confidence score breakdown
      const confidenceScore = {
        overall: arrivalPrediction.confidence,
        breakdown: {
          traffic: 80,
          userReliability: 70,
          routeComplexity: 80,
          bufferAdequacy: 80,
          timeReliability: 75
        }
      };

      const result = {
        success: true,
        canBookNow: isBookNowViable,
        arrivalPrediction,
        confidenceScore,
        alternatives,
        recommendation: {
          action: isBookNowViable ? 'book_now' : 'reserve',
          reason: isBookNowViable ? 'Quick arrival possible with high confidence' : 'Reservation recommended for better planning',
          confidence: isBookNowViable ? arrivalPrediction.confidence : 95
        },
        travelData: {
          distance: `${travelData.distance?.kilometers?.toFixed(1) || 'Unknown'} km`,
          estimatedTime: `${arrivalPrediction.totalWindowMinutes} minutes`,
          trafficCondition: 'moderate'
        },
        routeInfo
      };

      logger.info(`✅ Smart booking analysis complete: ${isBookNowViable ? 'VIABLE' : 'NOT VIABLE'}`);
      return result;

    } catch (error) {
      logger.error('Smart booking analysis error:', error);
      return {
        success: false,
        error: error.message,
        canBookNow: false,
        recommendation: 'Use reservation mode for reliability'
      };
    }
  }

  /**
   * Calculate travel data with traffic information
   */
  async calculateTravelData(origin, destination) {
    const originStr = `${origin.latitude},${origin.longitude}`;
    const destinationStr = `${destination.latitude},${destination.longitude}`;

    try {
      // Try to get real traffic information
      const trafficInfo = await googleMapsService.getTrafficInfo(originStr, destinationStr);
      
      if (trafficInfo.success) {
        const data = trafficInfo.data;
        const trafficDelay = data.trafficDelay || 0;
        
        // Determine traffic condition
        let trafficCondition = 'light';
        if (trafficDelay > 600) { // 10+ minutes delay
          trafficCondition = 'heavy';
        } else if (trafficDelay > 180) { // 3+ minutes delay
          trafficCondition = 'moderate';
        }

        return {
          distance: data.distance,
          duration: data.duration,
          durationInTraffic: data.durationInTraffic,
          trafficDelay: trafficDelay / 60, // Convert to minutes
          trafficCondition,
          routeComplexity: this.calculateRouteComplexity(data.distance.kilometers),
          isRealData: true
        };
      }
    } catch (error) {
      logger.warn('Google Maps API unavailable, using estimated data:', error.message);
    }

    // Fallback: Calculate estimated data using coordinates
    return this.calculateEstimatedTravelData(origin, destination);
  }

  /**
   * Calculate estimated travel data using haversine distance formula
   * Used as fallback when Google Maps API is unavailable
   */
  calculateEstimatedTravelData(origin, destination) {
    // Calculate straight-line distance using Haversine formula
    const R = 6371; // Earth's radius in kilometers
    const dLat = this.toRadians(destination.latitude - origin.latitude);
    const dLon = this.toRadians(destination.longitude - origin.longitude);
    const lat1 = this.toRadians(origin.latitude);
    const lat2 = this.toRadians(destination.latitude);

    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const straightLineDistance = R * c;

    // Estimate actual driving distance (usually 20-40% longer than straight line)
    const drivingDistance = straightLineDistance * 1.3;
    
    // Estimate driving time based on urban speeds (25-40 km/h average)
    const averageSpeed = 30; // km/h
    const estimatedDuration = (drivingDistance / averageSpeed) * 60; // minutes

    // Add some estimated traffic delay based on time of day
    const hour = new Date().getHours();
    let trafficMultiplier = 1.0;
    let trafficCondition = 'light';
    
    // Rush hour estimation
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      trafficMultiplier = 1.5;
      trafficCondition = 'heavy';
    } else if ((hour >= 10 && hour <= 16) || (hour >= 20 && hour <= 22)) {
      trafficMultiplier = 1.2;
      trafficCondition = 'moderate';
    }

    const durationInTraffic = estimatedDuration * trafficMultiplier;
    const trafficDelay = durationInTraffic - estimatedDuration;

    return {
      distance: {
        text: `${drivingDistance.toFixed(1)} km`,
        value: Math.round(drivingDistance * 1000), // meters
        kilometers: drivingDistance
      },
      duration: {
        text: `${Math.round(estimatedDuration)} min`,
        value: Math.round(estimatedDuration * 60), // seconds
        minutes: Math.round(estimatedDuration)
      },
      durationInTraffic: {
        text: `${Math.round(durationInTraffic)} min`,
        value: Math.round(durationInTraffic * 60), // seconds
        minutes: Math.round(durationInTraffic)
      },
      trafficDelay: trafficDelay,
      trafficCondition,
      routeComplexity: this.calculateRouteComplexity(drivingDistance),
      isRealData: false,
      estimatedTime: `${Math.round(durationInTraffic)} min`
    };
  }

  /**
   * Convert degrees to radians
   */
  toRadians(degrees) {
    return degrees * (Math.PI / 180);
  }

  /**
   * Calculate dynamic buffer time based on multiple factors
   */
  async calculateDynamicBuffer(userId, travelData) {
    const user = await User.findById(userId);
    const now = new Date();
    const currentHour = now.getHours();

    // Base buffer (minimum 30 minutes)
    let baseBuffer = 30;

    // 1. Traffic-based buffer
    const trafficBuffer = Math.max(15, travelData.trafficDelay * 1.5);

    // 2. User reliability adjustment
    const userReliability = user.behaviorMetrics?.reliabilityScore || 85;
    const reliabilityAdjustment = (100 - userReliability) * 0.3; // 0-4.5 minutes

    // 3. Time of day factor
    const timeOfDayFactor = this.getTimeOfDayFactor(currentHour);

    // 4. Weather impact
    const weatherFactor = await this.getWeatherFactor(
      userId, // Pass user location or use default Manila coordinates
      travelData.duration.minutes || 30
    );

    // 5. Route complexity factor
    const complexityFactor = travelData.routeComplexity * 5; // 0-15 minutes

          // 6. User's historical pattern for this time
      const historicalPattern = this.getUserTimePattern(user, currentHour);

      // 7. Use fallback buffer calculation (no ML)
      const totalBuffer = Math.round(
        baseBuffer + 
        trafficBuffer + 
        reliabilityAdjustment + 
        timeOfDayFactor + 
        weatherFactor + 
        complexityFactor + 
        historicalPattern
      );

    return {
      totalBufferMinutes: Math.min(120, Math.max(30, totalBuffer)), // Cap between 30-120 minutes
      factors: {
        base: baseBuffer,
        traffic: trafficBuffer,
        userReliability: reliabilityAdjustment,
        timeOfDay: timeOfDayFactor,
        weather: weatherFactor,
        routeComplexity: complexityFactor,
        userPattern: historicalPattern
      },
      explanation: this.generateBufferExplanation({
        totalBuffer,
        trafficBuffer,
        reliabilityAdjustment,
        timeOfDayFactor
      })
    };
  }

  /**
   * Calculate confidence score for arrival prediction
   */
  async calculateConfidenceScore({ user, travelData, bufferData }) {
    // 1. Traffic confidence (based on real-time data quality)
    const trafficConfidence = travelData.durationInTraffic ? 85 : 70;

    // 2. User reliability score
    const userReliability = user.behaviorMetrics?.reliabilityScore || 85;

    // 3. Route complexity score (simpler routes = higher confidence)
    const routeScore = Math.max(0, 100 - (travelData.routeComplexity * 20));

    // 4. Buffer adequacy score
    const bufferRatio = bufferData.totalBufferMinutes / (travelData.duration.minutes || 60);
    const bufferAdequacy = Math.min(100, bufferRatio * 80);

    // 5. Time of day reliability
    const timeReliability = this.getTimeReliability(new Date().getHours());

    // 6. Use rule-based confidence calculation (no ML)
    const overallConfidence = Math.round(
      (trafficConfidence * 0.25) +
      (userReliability * 0.30) +
      (routeScore * 0.20) +
      (bufferAdequacy * 0.15) +
      (timeReliability * 0.10)
    );

    return {
      overall: overallConfidence,
      breakdown: {
        traffic: trafficConfidence,
        userReliability,
        routeComplexity: routeScore,
        bufferAdequacy,
        timeReliability
      },
      riskFactors: this.identifyRiskFactors({
        trafficDelay: travelData.trafficDelay,
        userReliability,
        bufferRatio,
        trafficCondition: travelData.trafficCondition
      })
    };
  }

  /**
   * Generate arrival prediction
   */
  generateArrivalPrediction({ travelData, bufferData, confidenceScore }) {
    const now = new Date();
    const travelTimeMs = (travelData.duration.minutes || 0) * 60 * 1000;
    const bufferTimeMs = bufferData.totalBufferMinutes * 60 * 1000;

    const estimatedArrival = new Date(now.getTime() + travelTimeMs);
    const maxArrivalWindow = new Date(now.getTime() + travelTimeMs + bufferTimeMs);

    return {
      departureTime: now,
      estimatedArrival,
      maxArrivalWindow,
      totalWindowMinutes: bufferData.totalBufferMinutes,
      confidence: confidenceScore.overall,
      factors: bufferData.factors
    };
  }

  /**
   * Generate alternatives when "Book Now" is not viable
   */
  async generateAlternatives({ userId, origin, destination, parkingSpaceId }) {
    const alternatives = [];

    // 1. Suggest reservation mode
    alternatives.push({
      type: 'reservation_mode',
      title: 'Switch to Reservation Mode',
      description: 'Book a specific time slot for more reliability',
      confidence: 95,
      icon: '📅'
    });

    // 2. Suggest earlier departure
    alternatives.push({
      type: 'earlier_departure',
      title: 'Leave 30 Minutes Earlier',
      description: 'Increase your arrival confidence by departing earlier',
      confidence: 85,
      icon: '⏰'
    });

    // 3. Find closer parking spaces (this would need additional logic)
    alternatives.push({
      type: 'closer_spaces',
      title: 'Find Closer Parking',
      description: 'Look for parking spaces with shorter travel time',
      confidence: 75,
      icon: '📍'
    });

    return alternatives;
  }

  /**
   * Generate user-friendly recommendation
   */
  generateRecommendation(confidence, prediction) {
    if (confidence >= 85) {
      return {
        type: 'high_confidence',
        message: `🎯 High confidence! You should arrive by ${prediction.estimatedArrival.toLocaleTimeString()}`,
        action: 'book_now'
      };
    } else if (confidence >= 70) {
      return {
        type: 'moderate_confidence',
        message: `⚡ Moderate confidence. Allow extra time - arrive by ${prediction.maxArrivalWindow.toLocaleTimeString()}`,
        action: 'book_now_with_caution'
      };
    } else {
      return {
        type: 'low_confidence',
        message: `⚠️ Low confidence due to traffic/distance. Consider reservation mode`,
        action: 'suggest_reservation'
      };
    }
  }

  // Helper methods
  calculateRouteComplexity(distanceKm) {
    // Simple heuristic: longer distance = more complex
    if (distanceKm > 20) return 3; // Very complex
    if (distanceKm > 10) return 2; // Moderate
    if (distanceKm > 5) return 1;  // Simple
    return 0; // Very simple
  }

  getTimeOfDayFactor(hour) {
    // Rush hours have higher delay factors
    if ((hour >= 7 && hour <= 9) || (hour >= 17 && hour <= 19)) {
      return 15; // Rush hour
    } else if (hour >= 11 && hour <= 13) {
      return 8; // Lunch time
    }
    return 5; // Normal hours
  }

  async getWeatherFactor(userId, baseTravelTimeMinutes) {
    try {
      // Use Manila coordinates as default for weather check
      const latitude = 14.6022;
      const longitude = 120.9897;
      
      const weatherData = await googleWeatherService.getCurrentWeather(latitude, longitude);
      
      if (!weatherData) {
        logger.warn('Weather data unavailable, using default impact');
        return 5; // Default small buffer for uncertainty
      }

      // Calculate weather impact in minutes
      const weatherImpact = googleWeatherService.calculateWeatherImpact(weatherData);

      // Convert to buffer factor (cap at 30 minutes)
      const weatherFactor = Math.min(weatherImpact.delayMinutes, 30);
      
      logger.info(`Weather impact: ${weatherFactor} minutes (${weatherData.condition}, ${weatherImpact.description})`);
      return weatherFactor;

    } catch (error) {
      logger.error('Weather factor calculation error:', error);
      return 5; // Default small buffer on error
    }
  }

  getUserTimePattern(user, currentHour) {
    if (!user.behaviorMetrics?.latenessPatterns?.timeOfDayPattern) {
      return 0;
    }

    const pattern = user.behaviorMetrics.latenessPatterns.timeOfDayPattern
      .find(p => p.hour === currentHour);
    
    return pattern ? pattern.averageDelay : 0;
  }

  getTimeReliability(hour) {
    // Off-peak hours are more reliable
    if (hour >= 10 && hour <= 16) return 90; // Mid-day
    if (hour >= 20 || hour <= 6) return 85;  // Evening/night
    return 70; // Rush hours
  }

  identifyRiskFactors({ trafficDelay, userReliability, bufferRatio, trafficCondition }) {
    const risks = [];

    if (trafficDelay > 15) {
      risks.push({
        factor: 'heavy_traffic',
        severity: 'high',
        message: 'Heavy traffic detected - expect delays'
      });
    }

    if (userReliability < 70) {
      risks.push({
        factor: 'user_history',
        severity: 'medium',
        message: 'Your arrival history shows frequent delays'
      });
    }

    if (bufferRatio < 0.5) {
      risks.push({
        factor: 'insufficient_buffer',
        severity: 'high',
        message: 'Buffer time may not be sufficient for this journey'
      });
    }

    return risks;
  }

  generateBufferExplanation({ totalBuffer, trafficBuffer, reliabilityAdjustment, timeOfDayFactor }) {
    const factors = [];
    
    if (trafficBuffer > 20) factors.push('heavy traffic conditions');
    if (reliabilityAdjustment > 3) factors.push('your arrival history');
    if (timeOfDayFactor > 10) factors.push('rush hour timing');
    
    return factors.length > 0 
      ? `Extra time added due to: ${factors.join(', ')}`
      : 'Standard buffer time applied';
  }

  /**
   * Calculate ETA confidence score based on traffic and distance
   */
  calculateETAConfidence(etaMinutes, trafficDelayMinutes, distanceKm) {
    let confidence = 85; // Base confidence for Google Maps

    // Reduce confidence for longer trips (uncertainty increases)
    if (etaMinutes > 60) {
      confidence -= Math.min(20, (etaMinutes - 60) / 3); // -1 point per 3 min over 60
    }

    // Reduce confidence for heavy traffic
    if (trafficDelayMinutes > 10) {
      confidence -= Math.min(15, trafficDelayMinutes - 10); // -1 point per min delay over 10
    }

    // Reduce confidence for very short trips (GPS accuracy issues)
    if (etaMinutes < 5 || distanceKm < 1) {
      confidence -= 10;
    }

    // Reduce confidence for very long trips (too many variables)
    if (distanceKm > 30) {
      confidence -= Math.min(15, (distanceKm - 30) / 2); // -1 point per 2km over 30km
    }

    return Math.max(40, Math.min(95, Math.round(confidence))); // Keep between 40-95%
  }

  /**
   * Determine if smart booking is viable based on enhanced criteria
   */
  isSmartBookingViable(etaMinutes, confidence, factors) {
    // Enhanced viability criteria
    const maxETA = 90; // Maximum 90 minutes ETA
    const minConfidence = 60; // Minimum 60% confidence

    // Basic checks
    if (etaMinutes > maxETA || confidence < minConfidence) {
      logger.info(`❌ Not viable: ETA ${etaMinutes}min (max ${maxETA}) or confidence ${confidence}% (min ${minConfidence}%)`);
      return false;
    }

    // Check for extreme traffic
    if (factors.trafficFactor && factors.trafficFactor > 0.5) { // 50%+ delay from traffic
      logger.info(`❌ Not viable: Heavy traffic causing ${Math.round(factors.trafficFactor * 100)}% delay`);
      return false;
    }

    // All checks passed
    logger.info(`✅ Smart booking viable: ETA ${etaMinutes}min, confidence ${confidence}%`);
    return true;
  }

  /**
   * Update user behavior after booking completion
   */
  async updateUserBehavior(userId, bookingData) {
    try {
      const user = await User.findById(userId);
      if (!user) return;

      const { predictedArrival, actualArrival, bookingId } = bookingData;
      const delayMinutes = actualArrival > predictedArrival 
        ? Math.round((actualArrival - predictedArrival) / (1000 * 60)) 
        : 0;
      const wasOnTime = delayMinutes <= 5; // 5-minute tolerance

      // Add to arrival history
      user.behaviorMetrics.arrivalHistory.push({
        bookingId,
        predictedArrival,
        actualArrival,
        wasOnTime,
        delayMinutes,
        timestamp: new Date()
      });

      // Update statistics
      user.behaviorMetrics.totalBookings += 1;
      if (wasOnTime) {
        user.behaviorMetrics.onTimeBookings += 1;
      }

      // Recalculate reliability score
      const onTimeRate = user.behaviorMetrics.onTimeBookings / user.behaviorMetrics.totalBookings;
      user.behaviorMetrics.reliabilityScore = Math.round(onTimeRate * 100);

      // Update lateness patterns
      this.updateLatenessPatterns(user, actualArrival, delayMinutes);

      await user.save();
      logger.info(`📊 Updated behavior metrics for user ${userId}: ${user.behaviorMetrics.reliabilityScore}% reliability`);

    } catch (error) {
      logger.error('Error updating user behavior:', error);
    }
  }

  updateLatenessPatterns(user, arrivalTime, delayMinutes) {
    const hour = arrivalTime.getHours();
    
    // Update time of day pattern
    let timePattern = user.behaviorMetrics.latenessPatterns.timeOfDayPattern
      .find(p => p.hour === hour);
    
    if (!timePattern) {
      user.behaviorMetrics.latenessPatterns.timeOfDayPattern.push({
        hour,
        averageDelay: delayMinutes
      });
    } else {
      // Simple moving average
      timePattern.averageDelay = (timePattern.averageDelay + delayMinutes) / 2;
    }

    // Update overall average delay
    const totalDelays = user.behaviorMetrics.arrivalHistory
      .reduce((sum, record) => sum + record.delayMinutes, 0);
    user.behaviorMetrics.latenessPatterns.averageDelay = 
      totalDelays / user.behaviorMetrics.arrivalHistory.length;
  }
}

module.exports = new SmartArrivalService();