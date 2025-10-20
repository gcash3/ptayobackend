const googleMapsService = require('./googleMapsService');
const weatherService = require('./weatherService');
const smartArrivalService = require('./smartArrivalService');
const Booking = require('../models/Booking');
const logger = require('../config/logger');

class RealTimeTrackingService {
  constructor() {
    this.activeTracking = new Map(); // bookingId -> tracking data
    this.io = null; // Will be set by server
  }

  /**
   * Initialize with Socket.IO instance
   * @param {SocketIO} io 
   */
  initialize(io) {
    this.io = io;
    logger.info('Real-time tracking service initialized');
  }

  /**
   * Start tracking a smart booking
   * @param {String} bookingId 
   * @param {Object} userLocation 
   * @param {Object} destination 
   * @param {String} userId 
   */
  async startTracking(bookingId, userLocation, destination, userId) {
    try {
      const trackingData = {
        bookingId,
        userId,
        userLocation,
        destination,
        startTime: new Date(),
        lastUpdate: new Date(),
        etaHistory: [],
        isActive: true,
        updateInterval: null
      };

      // Store tracking data
      this.activeTracking.set(bookingId, trackingData);

      // Calculate initial ETA
      await this.updateETA(bookingId, userLocation);

      // Start periodic ETA updates (every 2 minutes)
      const interval = setInterval(async () => {
        if (this.activeTracking.has(bookingId)) {
          const tracking = this.activeTracking.get(bookingId);
          if (tracking.isActive && tracking.userLocation) {
            await this.updateETA(bookingId, tracking.userLocation);
          }
        } else {
          clearInterval(interval);
        }
      }, 120000); // 2 minutes

      trackingData.updateInterval = interval;

      logger.info(`Started real-time tracking for booking ${bookingId}`);
      
      // Notify user that tracking started
      if (this.io) {
        this.io.to(`user_${userId}`).emit('tracking_started', {
          bookingId,
          message: 'Real-time tracking activated',
          timestamp: new Date()
        });
      }

      return { success: true, message: 'Tracking started' };

    } catch (error) {
      logger.error('Error starting tracking:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Update user location and recalculate ETA
   * @param {String} bookingId 
   * @param {Object} newLocation 
   */
  async updateUserLocation(bookingId, newLocation) {
    try {
      const tracking = this.activeTracking.get(bookingId);
      if (!tracking || !tracking.isActive) {
        return { success: false, error: 'Tracking not active' };
      }

      // Update location
      tracking.userLocation = {
        latitude: newLocation.latitude,
        longitude: newLocation.longitude,
        timestamp: new Date()
      };
      tracking.lastUpdate = new Date();

      // Recalculate ETA
      await this.updateETA(bookingId, newLocation);

      return { success: true, message: 'Location updated' };

    } catch (error) {
      logger.error('Error updating location:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Calculate and broadcast updated ETA
   * @param {String} bookingId 
   * @param {Object} currentLocation 
   */
  async updateETA(bookingId, currentLocation) {
    try {
      const tracking = this.activeTracking.get(bookingId);
      if (!tracking) return;

      // Get travel data from Google Maps
      const origin = `${currentLocation.latitude},${currentLocation.longitude}`;
      const destination = `${tracking.destination.latitude},${tracking.destination.longitude}`;
      
      const trafficData = await googleMapsService.getTrafficInfo(origin, destination);
      
      if (!trafficData.success) {
        logger.warn(`Failed to get traffic data for booking ${bookingId}`);
        return;
      }

      // Get weather impact
      const weatherData = await weatherService.getCurrentWeather(
        currentLocation.latitude, 
        currentLocation.longitude
      );

      // Calculate updated ETA with all factors
      const baseTravelTime = trafficData.data.durationInTraffic?.minutes || 
                           trafficData.data.duration.minutes;
      
      const weatherImpact = weatherService.calculateWeatherImpact(weatherData, baseTravelTime);
      
      const totalTravelTime = baseTravelTime + weatherImpact;
      const newETA = new Date(Date.now() + totalTravelTime * 60 * 1000);

      // Store ETA history
      const etaUpdate = {
        timestamp: new Date(),
        eta: newETA,
        travelTimeMinutes: totalTravelTime,
        trafficDelay: trafficData.data.trafficDelay / 60, // Convert to minutes
        weatherImpact,
        distance: trafficData.data.distance.text,
        route: trafficData.data
      };

      tracking.etaHistory.push(etaUpdate);

      // Keep only last 10 ETA updates
      if (tracking.etaHistory.length > 10) {
        tracking.etaHistory = tracking.etaHistory.slice(-10);
      }

      // Check for significant ETA changes
      const prevETA = tracking.etaHistory.length > 1 ? 
        tracking.etaHistory[tracking.etaHistory.length - 2].eta : null;
      
      const etaChange = prevETA ? 
        Math.abs((newETA - prevETA) / (1000 * 60)) : 0; // Minutes difference

      // Determine notification type
      let notificationType = 'eta_update';
      let notificationMessage = `ETA updated: ${newETA.toLocaleTimeString()}`;

      if (etaChange > 10) {
        notificationType = 'significant_delay';
        notificationMessage = `⚠️ Significant delay detected! New ETA: ${newETA.toLocaleTimeString()}`;
      } else if (etaChange > 5) {
        notificationType = 'delay_warning';
        notificationMessage = `🚨 Traffic delay detected. New ETA: ${newETA.toLocaleTimeString()}`;
      }

      // Update booking in database
      await this.updateBookingETA(bookingId, etaUpdate);

      // Broadcast to user and landlord
      if (this.io) {
        const updateData = {
          bookingId,
          eta: newETA,
          travelTime: totalTravelTime,
          distance: trafficData.data.distance.text,
          trafficCondition: this.getTrafficCondition(trafficData.data.trafficDelay),
          weatherImpact: weatherService.getWeatherSummary(weatherData),
          timestamp: new Date(),
          etaChange: Math.round(etaChange)
        };

        // Notify user
        this.io.to(`user_${tracking.userId}`).emit(notificationType, {
          ...updateData,
          message: notificationMessage
        });

        // Notify landlord
        const booking = await Booking.findById(bookingId);
        if (booking) {
          this.io.to(`landlord_${booking.landlordId}`).emit('user_eta_update', {
            ...updateData,
            userName: booking.userId.firstName || 'User',
            message: `Customer ETA updated: ${newETA.toLocaleTimeString()}`
          });
        }
      }

      logger.info(`ETA updated for booking ${bookingId}: ${newETA.toLocaleTimeString()} (${Math.round(etaChange)}min change)`);

    } catch (error) {
      logger.error('Error updating ETA:', error);
    }
  }

  /**
   * Update booking record with new ETA
   * @param {String} bookingId 
   * @param {Object} etaUpdate 
   */
  async updateBookingETA(bookingId, etaUpdate) {
    try {
      await Booking.findByIdAndUpdate(bookingId, {
        $set: {
          'trackingData.lastLocation': {
            latitude: etaUpdate.route.lat || 0,
            longitude: etaUpdate.route.lng || 0,
            accuracy: null,
            timestamp: etaUpdate.timestamp
          },
          'trackingData.lastUpdate': new Date()
        },
        $push: {
          'trackingData.notifications': {
            type: 'eta_update',
            message: `ETA updated to ${etaUpdate.eta.toLocaleTimeString()}`,
            timestamp: etaUpdate.timestamp,
            sentTo: ['user', 'landlord']
          }
        }
      });
    } catch (error) {
      logger.error('Error updating booking ETA:', error);
    }
  }

  /**
   * Stop tracking a booking
   * @param {String} bookingId 
   */
  stopTracking(bookingId) {
    const tracking = this.activeTracking.get(bookingId);
    if (tracking) {
      tracking.isActive = false;
      
      if (tracking.updateInterval) {
        clearInterval(tracking.updateInterval);
      }

      this.activeTracking.delete(bookingId);
      
      logger.info(`Stopped tracking for booking ${bookingId}`);

      // Notify user
      if (this.io && tracking.userId) {
        this.io.to(`user_${tracking.userId}`).emit('tracking_stopped', {
          bookingId,
          message: 'Tracking stopped',
          timestamp: new Date()
        });
      }
    }
  }

  /**
   * Handle user arrival at destination
   * @param {String} bookingId 
   * @param {Object} arrivalLocation 
   */
  async handleUserArrival(bookingId, arrivalLocation) {
    try {
      const tracking = this.activeTracking.get(bookingId);
      if (!tracking) return;

      const arrivalTime = new Date();
      
      // Calculate distance to parking space
      const distance = this.calculateDistance(
        arrivalLocation,
        tracking.destination
      );

      // Check if user is close enough (within 100 meters)
      if (distance <= 0.1) { // 100 meters
        // User has arrived!
        await this.completeArrival(bookingId, arrivalTime, arrivalLocation);
      } else {
        // User is getting close
        if (this.io) {
          this.io.to(`user_${tracking.userId}`).emit('approaching_destination', {
            bookingId,
            distance: Math.round(distance * 1000), // meters
            message: `You're ${Math.round(distance * 1000)}m away from your parking space`,
            timestamp: arrivalTime
          });
        }
      }

    } catch (error) {
      logger.error('Error handling user arrival:', error);
    }
  }

  /**
   * Complete user arrival and update booking
   * @param {String} bookingId 
   * @param {Date} arrivalTime 
   * @param {Object} arrivalLocation 
   */
  async completeArrival(bookingId, arrivalTime, arrivalLocation) {
    try {
      const tracking = this.activeTracking.get(bookingId);
      const booking = await Booking.findById(bookingId).populate('landlordId');
      
      if (!booking || !tracking) return;

      // Calculate arrival accuracy
      const predictedArrival = booking.arrivalPrediction?.predictedArrivalTime;
      const wasOnTime = predictedArrival ? 
        arrivalTime <= predictedArrival : true;

      // 💰 WALLET PAYMENT CAPTURE ON ARRIVAL
      let walletCaptureSuccess = false;
      let walletCaptureData = null;
      
      if (booking.pricing?.walletHoldReference && booking.pricing?.paymentStatus === 'held') {
        try {
          const { Wallet } = require('../models/Wallet');
          const userWallet = await Wallet.findByUserId(booking.userId);
          
          if (userWallet) {
            // Capture the wallet hold (convert to payment)
            await userWallet.captureHold(
              booking.pricing.walletHoldReference,
              `Payment captured - User arrived at ${booking.parkingSpaceId?.name || 'parking space'}`
            );
            
            // Update booking payment status
            await Booking.findByIdAndUpdate(bookingId, {
              $set: {
                'pricing.paymentStatus': 'captured',
                'pricing.isPaid': true,
                'pricing.paidAt': arrivalTime
              }
            });
            
            walletCaptureSuccess = true;
            walletCaptureData = {
              amount: booking.pricing.totalAmount,
              holdReference: booking.pricing.walletHoldReference,
              capturedAt: arrivalTime
            };
            
            logger.info(`💳 Wallet payment captured for booking ${bookingId}: ₱${booking.pricing.totalAmount}`);
            
            // 🏢 TRANSFER TO LANDLORD WALLET (if landlord has wallet)
            try {
              let landlordWallet = await Wallet.findByUserId(booking.landlordId._id);
              if (!landlordWallet) {
                // Create landlord wallet if it doesn't exist
                landlordWallet = await Wallet.createWallet(booking.landlordId._id, 0);
              }
              
              // Add credit transaction to landlord wallet
              const transferTransaction = {
                type: 'transfer_in',
                amount: booking.pricing.totalAmount,
                description: `Payment received from ${booking.userId?.firstName || 'User'} for parking booking`,
                bookingId: bookingId,
                status: 'completed',
                metadata: new Map([
                  ['fromUserId', booking.userId.toString()],
                  ['parkingSpaceName', booking.parkingSpaceId?.name || 'Unknown'],
                  ['arrivalTime', arrivalTime.toISOString()]
                ])
              };
              
              await landlordWallet.addTransaction(transferTransaction);
              await landlordWallet.updateBalance(booking.pricing.totalAmount, 'credit');
              
              logger.info(`💰 Payment transferred to landlord ${booking.landlordId._id}: ₱${booking.pricing.totalAmount}`);
              
            } catch (transferError) {
              logger.error('Error transferring payment to landlord:', transferError);
              // Don't fail the arrival process if landlord transfer fails
            }
            
          } else {
            logger.warn(`No wallet found for user ${booking.userId} during arrival capture`);
          }
          
        } catch (walletError) {
          logger.error('Error capturing wallet payment on arrival:', walletError);
          // Don't fail the arrival process if wallet capture fails
        }
      }

      // Update booking with arrival data
      await Booking.findByIdAndUpdate(bookingId, {
        $set: {
          'arrivalPrediction.actualArrivalTime': arrivalTime,
          'arrivalPrediction.wasOnTime': wasOnTime,
          'trackingData.isActive': false,
          'trackingData.endedAt': new Date()
        }
      });

      // Update user behavior
      if (predictedArrival) {
        await smartArrivalService.updateUserBehavior(tracking.userId, {
          bookingId,
          predictedArrival,
          actualArrival: arrivalTime
        });
      }

      // Stop tracking
      this.stopTracking(bookingId);

      // Notify user and landlord
      if (this.io) {
        const arrivalData = {
          bookingId,
          arrivalTime,
          wasOnTime,
          message: walletCaptureSuccess 
            ? '🎯 You have arrived! Payment processed successfully.' 
            : '🎯 You have arrived! Ready to check in?',
          timestamp: arrivalTime,
          paymentProcessed: walletCaptureSuccess,
          paymentData: walletCaptureData
        };

        this.io.to(`user_${tracking.userId}`).emit('arrived_at_destination', arrivalData);

        const landlordNotificationData = {
          ...arrivalData,
          userName: booking.userId?.firstName || 'User',
          message: walletCaptureSuccess 
            ? `Customer has arrived and payment of ₱${booking.pricing.totalAmount} has been processed!`
            : 'Customer has arrived at parking space'
        };

        this.io.to(`landlord_${booking.landlordId._id}`).emit('user_arrived', landlordNotificationData);
      }

      logger.info(`User arrived for booking ${bookingId}: ${wasOnTime ? 'ON TIME' : 'LATE'}${walletCaptureSuccess ? ' - Payment captured' : ''}`);

    } catch (error) {
      logger.error('Error completing arrival:', error);
    }
  }

  /**
   * Get traffic condition description
   * @param {Number} delaySeconds 
   * @returns {String}
   */
  getTrafficCondition(delaySeconds) {
    if (delaySeconds > 600) return 'heavy';      // 10+ minutes delay
    if (delaySeconds > 180) return 'moderate';   // 3+ minutes delay
    if (delaySeconds > 60) return 'light';       // 1+ minute delay
    return 'clear';
  }

  /**
   * Calculate distance between two points in kilometers
   * @param {Object} point1 
   * @param {Object} point2 
   * @returns {Number}
   */
  calculateDistance(point1, point2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (point2.latitude - point1.latitude) * Math.PI / 180;
    const dLng = (point2.longitude - point1.longitude) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(point1.latitude * Math.PI / 180) * Math.cos(point2.latitude * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }

  /**
   * Get active tracking data for a booking
   * @param {String} bookingId 
   * @returns {Object|null}
   */
  getTrackingData(bookingId) {
    return this.activeTracking.get(bookingId) || null;
  }

  /**
   * Get all active trackings
   * @returns {Array}
   */
  getAllActiveTrackings() {
    return Array.from(this.activeTracking.values()).map(tracking => ({
      bookingId: tracking.bookingId,
      userId: tracking.userId,
      startTime: tracking.startTime,
      lastUpdate: tracking.lastUpdate,
      isActive: tracking.isActive
    }));
  }

  /**
   * Clean up expired trackings
   */
  cleanupExpiredTrackings() {
    const now = new Date();
    const expiredThreshold = 4 * 60 * 60 * 1000; // 4 hours

    for (const [bookingId, tracking] of this.activeTracking.entries()) {
      if (now - tracking.lastUpdate > expiredThreshold) {
        logger.info(`Cleaning up expired tracking for booking ${bookingId}`);
        this.stopTracking(bookingId);
      }
    }
  }
}

module.exports = new RealTimeTrackingService();