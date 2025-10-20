const logger = require('../config/logger');

class GeoFencingService {
  constructor() {
    // Enhanced geo-fencing zones in meters
    this.APPROACHING_RADIUS = 1000; // 1km - "approaching" notification
    this.ARRIVAL_RADIUS = 200;      // 200m - "arrived" notification & check-in
    this.PARKING_RADIUS = 300;      // 300m - actively parked zone
    this.DEPARTURE_RADIUS = 500;    // 500m - departure warning zone
    this.EXIT_RADIUS = 800;         // 800m - auto-checkout trigger zone
    
    // Active tracking sessions
    this.activeTrackingSessions = new Map();
    this.activeParkingSessions = new Map(); // Track users currently parked
    this.entryExitTracking = new Map(); // Track entry/exit counts for checkout logic
  }

  /**
   * Calculate distance between two coordinates using Haversine formula
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
  }

  /**
   * Check if user is within geo-fence zone
   */
  isWithinGeoFence(userLat, userLon, parkingLat, parkingLon, radius) {
    const distance = this.calculateDistance(userLat, userLon, parkingLat, parkingLon);
    return distance <= radius;
  }

  /**
   * Get enhanced geo-fence status for user location
   */
  getGeoFenceStatus(userLat, userLon, parkingLat, parkingLon, isParked = false) {
    const distance = this.calculateDistance(userLat, userLon, parkingLat, parkingLon);
    
    if (distance <= this.ARRIVAL_RADIUS) {
      return {
        status: 'arrived',
        distance: distance,
        zone: 'arrival',
        message: 'User has arrived at parking space - Check-in required',
        action: 'checkin_required'
      };
    } else if (distance <= this.PARKING_RADIUS && isParked) {
      return {
        status: 'parked',
        distance: distance,
        zone: 'parking',
        message: 'User is actively parked',
        action: 'maintain'
      };
    } else if (distance <= this.DEPARTURE_RADIUS && isParked) {
      return {
        status: 'departing',
        distance: distance,
        zone: 'departure',
        message: 'User is departing from parking space',
        action: 'checkout_warning'
      };
    } else if (distance > this.EXIT_RADIUS && isParked) {
      return {
        status: 'exited',
        distance: distance,
        zone: 'exit',
        message: 'User has exited parking area',
        action: 'track' // Don't auto-checkout here, wait for entry/exit logic
      };
    } else if (distance <= this.APPROACHING_RADIUS) {
      return {
        status: 'approaching',
        distance: distance,
        zone: 'approaching',
        message: 'User is approaching parking space',
        action: 'notify'
      };
    } else {
      return {
        status: 'en_route',
        distance: distance,
        zone: 'outside',
        message: 'User is en route to parking space',
        action: 'track'
      };
    }
  }

  /**
   * Start tracking session for a booking
   */
  startTrackingSession(bookingId, parkingSpaceLocation) {
    const session = {
      bookingId,
      parkingLat: parkingSpaceLocation.latitude,
      parkingLon: parkingSpaceLocation.longitude,
      startTime: new Date(),
      locationUpdates: [],
      lastStatus: 'en_route',
      notificationsSent: {
        approaching: false,
        arrived: false
      }
    };

    this.activeTrackingSessions.set(bookingId, session);
    logger.info(`Started tracking session for booking: ${bookingId}`);
    
    return session;
  }

  /**
   * Start parking session when user checks in
   */
  startParkingSession(bookingId, parkingSpaceLocation, userId) {
    const parkingSession = {
      bookingId,
      userId,
      parkingLat: parkingSpaceLocation.latitude,
      parkingLon: parkingSpaceLocation.longitude,
      checkedInAt: new Date(),
      lastStatus: 'parked',
      lastUpdate: new Date(),
      locationUpdates: [],
      autoCheckoutWarningsSent: 0,
      maxAutoCheckoutWarnings: 3
    };
    
    this.activeParkingSessions.set(bookingId, parkingSession);
    
    // Initialize entry/exit tracking for complex checkout logic
    this.entryExitTracking.set(bookingId, {
      entryCount: 1, // First entry is parking
      exitCount: 0,
      lastZone: 'arrival', // User started in arrival zone
      isCurrentlyInside: true,
      sessionStartTime: new Date(),
      totalDuration: 0
    });
    
    logger.info(`Started parking session for booking ${bookingId} with entry/exit tracking`);
    
    return parkingSession;
  }

  /**
   * End parking session
   */
  endParkingSession(bookingId) {
    const session = this.activeParkingSessions.get(bookingId);
    if (session) {
      this.activeParkingSessions.delete(bookingId);
      this.entryExitTracking.delete(bookingId); // Clean up entry/exit tracking
      logger.info(`Ended parking session for booking ${bookingId}`);
    }
    return session;
  }

  /**
   * Update user location and check geo-fence status (Enhanced with auto-checkout)
   */
  updateUserLocation(bookingId, userLat, userLon, accuracy = null) {
    const session = this.activeTrackingSessions.get(bookingId);
    const parkingSession = this.activeParkingSessions.get(bookingId);
    
    if (!session && !parkingSession) {
      logger.warn(`No tracking or parking session found for booking: ${bookingId}`);
      return null;
    }

    const currentSession = parkingSession || session;
    const isParked = !!parkingSession;

    // Add location update to session
    const locationUpdate = {
      timestamp: new Date(),
      latitude: userLat,
      longitude: userLon,
      accuracy: accuracy
    };
    currentSession.locationUpdates.push(locationUpdate);

    // Check geo-fence status with parking state
    const geoFenceStatus = this.getGeoFenceStatus(
      userLat, userLon, 
      currentSession.parkingLat, currentSession.parkingLon,
      isParked
    );

    // Track approach zone transitions
    const bookingApproach = currentSession.approachTracking || {
      hasEnteredApproachZone: false,
      firstApproachTimestamp: null,
      lastApproachTimestamp: null,
      lastStatus: null
    };

    if (geoFenceStatus.zone === 'approaching') {
      if (!bookingApproach.hasEnteredApproachZone) {
        bookingApproach.hasEnteredApproachZone = true;
        bookingApproach.firstApproachTimestamp = locationUpdate.timestamp;
      }
      bookingApproach.lastApproachTimestamp = locationUpdate.timestamp;
    }

    bookingApproach.lastStatus = {
      status: geoFenceStatus.status,
      zone: geoFenceStatus.zone,
      distance: geoFenceStatus.distance,
      timestamp: locationUpdate.timestamp
    };

    currentSession.approachTracking = bookingApproach;

    // 🎯 COMPLEX ENTRY/EXIT TRACKING for auto-checkout
    if (isParked) {
      const tracking = this.entryExitTracking.get(bookingId);
      if (tracking) {
        const isCurrentlyInParkingZone = geoFenceStatus.distance <= this.PARKING_RADIUS;
        
        // Detect zone transitions for entry/exit counting
        if (isCurrentlyInParkingZone && !tracking.isCurrentlyInside) {
          // USER RE-ENTERED PARKING ZONE
          tracking.entryCount++;
          tracking.isCurrentlyInside = true;
          logger.info(`📍 ENTRY DETECTED - Booking ${bookingId}: Entry #${tracking.entryCount}`);
        } else if (!isCurrentlyInParkingZone && tracking.isCurrentlyInside) {
          // USER EXITED PARKING ZONE
          tracking.exitCount++;
          tracking.isCurrentlyInside = false;
          logger.info(`🚪 EXIT DETECTED - Booking ${bookingId}: Exit #${tracking.exitCount}`);
          
          // 🎯 AUTO-CHECKOUT LOGIC: 2nd exit triggers checkout (FIXED)
          if (tracking.exitCount >= 2) {
            logger.info(`🏁 AUTO-CHECKOUT TRIGGERED - Booking ${bookingId}: Exit #${tracking.exitCount} (2nd exit detected)`);
            geoFenceStatus.action = 'auto_checkout';
            geoFenceStatus.status = 'auto_checkout';
            geoFenceStatus.message = `Auto-checkout triggered after ${tracking.exitCount} exits`;
          } else {
            logger.info(`🚶 Exit #${tracking.exitCount} detected - Auto-checkout requires 2 exits`);
          }
        }
        
        // Update tracking zone
        tracking.lastZone = geoFenceStatus.zone;
        
        logger.info(`📊 TRACKING STATUS - Booking ${bookingId}: Entries: ${tracking.entryCount}, Exits: ${tracking.exitCount}, Inside: ${tracking.isCurrentlyInside}`);
      }
    }

    // Update session status
    currentSession.lastStatus = geoFenceStatus.status;
    currentSession.lastUpdate = new Date();

    logger.info(`Location update for booking ${bookingId}: ${geoFenceStatus.status} (${geoFenceStatus.distance.toFixed(0)}m) - Parked: ${isParked}`);

    const notifications = this.shouldSendNotification(currentSession, geoFenceStatus, isParked);

    return {
      session: currentSession,
      geoFenceStatus,
      shouldNotify: notifications,
      isParked,
      autoCheckout: geoFenceStatus.action === 'auto_checkout'
    };
  }

  /**
   * Determine if notification should be sent (Enhanced for auto-checkout)
   */
  shouldSendNotification(session, geoFenceStatus, isParked = false) {
    const notifications = {
      approaching: false,
      arrived: false,
      departing: false,
      autoCheckout: false
    };

    // Initialize notifications sent if not exists
    if (!session.notificationsSent) {
      session.notificationsSent = {
        approaching: false,
        arrived: false,
        departing: false,
        autoCheckout: false
      };
    }

    // Check if approaching notification should be sent
    if (geoFenceStatus.status === 'approaching' && !session.notificationsSent.approaching) {
      notifications.approaching = true;
      session.notificationsSent.approaching = true;
    }

    // Check if arrived notification should be sent
    if (geoFenceStatus.status === 'arrived' && !session.notificationsSent.arrived) {
      notifications.arrived = true;
      session.notificationsSent.arrived = true;
    }

    // Check if departing notification should be sent (only for parked users)
    if (isParked && geoFenceStatus.status === 'departing' && !session.notificationsSent.departing) {
      notifications.departing = true;
      session.notificationsSent.departing = true;
      
      // Increment auto-checkout warnings
      if (session.autoCheckoutWarningsSent !== undefined) {
        session.autoCheckoutWarningsSent++;
      }
    }

    // Check if auto-checkout notification should be sent
    if (isParked && (geoFenceStatus.status === 'exited' || geoFenceStatus.status === 'auto_checkout') && !session.notificationsSent.autoCheckout) {
      notifications.autoCheckout = true;
      session.notificationsSent.autoCheckout = true;
    }

    return notifications;
  }

  /**
   * Get tracking session data
   */
  getTrackingSession(bookingId) {
    return this.activeTrackingSessions.get(bookingId);
  }

  /**
   * End tracking session
   */
  endTrackingSession(bookingId) {
    const session = this.activeTrackingSessions.get(bookingId);
    if (session) {
      session.endTime = new Date();
      session.duration = session.endTime - session.startTime;
      
      // Store session data for ML training
      this.storeSessionData(session);
      
      this.activeTrackingSessions.delete(bookingId);
      logger.info(`Ended tracking session for booking: ${bookingId}`);
    }
  }

  /**
   * Store session data for ML training
   */
  async storeSessionData(session) {
    try {
      // Calculate ML features from tracking data
      const mlFeatures = this.extractMLFeatures(session);
      
      // Store in database for ML training
      // This will be implemented when we add ML data collection
      logger.info(`Stored ML features for booking: ${session.bookingId}`, mlFeatures);
      
      return mlFeatures;
    } catch (error) {
      logger.error(`Error storing session data: ${error.message}`);
    }
  }

  /**
   * Extract ML features from tracking session
   */
  extractMLFeatures(session) {
    if (session.locationUpdates.length < 2) {
      return null;
    }

    const updates = session.locationUpdates;
    const firstUpdate = updates[0];
    const lastUpdate = updates[updates.length - 1];
    
    // Calculate travel statistics
    const totalDistance = this.calculateTotalDistance(updates);
    const averageSpeed = this.calculateAverageSpeed(updates);
    const routeEfficiency = this.calculateRouteEfficiency(updates, session);
    
    return {
      bookingId: session.bookingId,
      startTime: session.startTime,
      endTime: session.endTime,
      duration: session.duration,
      totalDistance,
      averageSpeed,
      routeEfficiency,
      locationUpdatesCount: updates.length,
      finalStatus: session.lastStatus,
      notificationsSent: session.notificationsSent
    };
  }

  /**
   * Calculate total distance traveled
   */
  calculateTotalDistance(locationUpdates) {
    let totalDistance = 0;
    
    for (let i = 1; i < locationUpdates.length; i++) {
      const prev = locationUpdates[i - 1];
      const curr = locationUpdates[i];
      
      totalDistance += this.calculateDistance(
        prev.latitude, prev.longitude,
        curr.latitude, curr.longitude
      );
    }
    
    return totalDistance;
  }

  /**
   * Calculate average speed in m/s
   */
  calculateAverageSpeed(locationUpdates) {
    if (locationUpdates.length < 2) return 0;
    
    const totalDistance = this.calculateTotalDistance(locationUpdates);
    const timeSpan = locationUpdates[locationUpdates.length - 1].timestamp - locationUpdates[0].timestamp;
    
    return totalDistance / (timeSpan / 1000); // m/s
  }

  /**
   * Calculate route efficiency (actual distance vs straight line distance)
   */
  calculateRouteEfficiency(locationUpdates, session) {
    if (locationUpdates.length < 2) return 1;
    
    const actualDistance = this.calculateTotalDistance(locationUpdates);
    const straightLineDistance = this.calculateDistance(
      locationUpdates[0].latitude, locationUpdates[0].longitude,
      session.parkingLat, session.parkingLon
    );
    
    return straightLineDistance / actualDistance; // Efficiency ratio
  }

  /**
   * Get all active tracking sessions
   */
  getActiveSessions() {
    return Array.from(this.activeTrackingSessions.values());
  }

  /**
   * Clean up old sessions
   */
  cleanupOldSessions() {
    const now = new Date();
    const maxAge = 24 * 60 * 60 * 1000; // 24 hours
    
    for (const [bookingId, session] of this.activeTrackingSessions.entries()) {
      if (now - session.startTime > maxAge) {
        this.endTrackingSession(bookingId);
      }
    }
  }
}

module.exports = new GeoFencingService(); 