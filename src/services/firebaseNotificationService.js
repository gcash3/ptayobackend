const admin = require('firebase-admin');
const logger = require('../config/logger');
const User = require('../models/User');

class FirebaseNotificationService {
  constructor() {
    this.initialized = false;
    this.initialize();
  }

  initialize() {
    try {
      // Initialize Firebase Admin SDK
      if (!admin.apps.length) {
        // Check if service account key is provided
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
          const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
            projectId: serviceAccount.project_id
          });
        } else if (process.env.FIREBASE_PROJECT_ID) {
          // Use default credentials (for cloud environments)
          admin.initializeApp({
            projectId: process.env.FIREBASE_PROJECT_ID
          });
        } else {
          logger.warn('Firebase credentials not configured. Push notifications will be disabled.');
          return;
        }
      }

      this.messaging = admin.messaging();
      this.initialized = true;
      logger.info('🔥 Firebase Admin SDK initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Firebase Admin SDK:', error);
      this.initialized = false;
    }
  }

  // Send push notification to a single device
  async sendToDevice(fcmToken, notification, data = {}) {
    if (!this.initialized) {
      logger.warn('📱 Firebase not initialized. Skipping push notification.');
      return { success: false, error: 'Firebase not initialized' };
    }

    // Skip Firebase notifications if running in local development without proper credentials
    if (process.env.NODE_ENV === 'development' && !process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
      logger.info('📱 Development mode without Firebase credentials - skipping push notification');
      return { success: true, skipped: true, reason: 'Development mode without credentials' };
    }

    try {
      const message = {
        token: fcmToken,
        notification: {
          title: notification.title,
          body: notification.message,
          imageUrl: notification.imageUrl
        },
        data: this._ensureStringData({
          ...data,
          notificationId: notification.id?.toString() || '',
          type: notification.type || '',
          category: notification.category || '',
          priority: notification.priority || 'medium',
          deepLink: notification.deepLink || '',
          timestamp: new Date().toISOString()
        }),
        android: {
          priority: 'high',
          notification: {
            channelId: this.getChannelId(notification.category),
            priority: 'high',
            defaultSound: true,
            defaultVibrateTimings: true,
            defaultLightSettings: true,
            icon: 'ic_notification',
            color: '#2196F3' // ParkTayo brand color
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.message
              },
              badge: data.unreadCount || 1,
              sound: 'default',
              category: notification.category,
              'mutable-content': 1
            }
          }
        }
      };

      const response = await this.messaging.send(message);
      logger.info(`Push notification sent successfully: ${response}`);
      
      return {
        success: true,
        messageId: response,
        timestamp: new Date()
      };
    } catch (error) {
      logger.error('Failed to send push notification:', error);
      
      // Handle invalid tokens
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        await this.removeInvalidToken(fcmToken);
      }
      
      return {
        success: false,
        error: error.message,
        errorCode: error.code
      };
    }
  }

  // Send push notification to multiple devices
  async sendToMultipleDevices(fcmTokens, notification, data = {}) {
    if (!this.initialized) {
      logger.warn('Firebase not initialized. Skipping push notifications.');
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      // Split tokens into batches of 500 (FCM limit)
      const batchSize = 500;
      const results = [];

      for (let i = 0; i < fcmTokens.length; i += batchSize) {
        const batch = fcmTokens.slice(i, i + batchSize);
        
        const message = {
          tokens: batch,
          notification: {
            title: notification.title,
            body: notification.message,
            imageUrl: notification.imageUrl
          },
          data: {
            ...data,
            notificationId: notification.id?.toString() || '',
            type: notification.type || '',
            category: notification.category || '',
            priority: notification.priority || 'medium',
            deepLink: notification.deepLink || '',
            timestamp: new Date().toISOString()
          },
          android: {
            priority: 'high',
            notification: {
              channelId: this.getChannelId(notification.category),
              priority: 'high',
              defaultSound: true,
              defaultVibrateTimings: true,
              icon: 'ic_notification',
              color: '#2196F3'
            }
          },
          apns: {
            payload: {
              aps: {
                alert: {
                  title: notification.title,
                  body: notification.message
                },
                badge: data.unreadCount || 1,
                sound: 'default',
                category: notification.category
              }
            }
          }
        };

        const response = await this.messaging.sendMulticast(message);
        results.push({
          successCount: response.successCount,
          failureCount: response.failureCount,
          responses: response.responses
        });

        // Handle failed tokens
        if (response.failureCount > 0) {
          const failedTokens = [];
          response.responses.forEach((resp, idx) => {
            if (!resp.success) {
              const error = resp.error;
              if (error.code === 'messaging/invalid-registration-token' || 
                  error.code === 'messaging/registration-token-not-registered') {
                failedTokens.push(batch[idx]);
              }
            }
          });
          
          if (failedTokens.length > 0) {
            await this.removeInvalidTokens(failedTokens);
          }
        }
      }

      const totalSuccess = results.reduce((sum, r) => sum + r.successCount, 0);
      const totalFailure = results.reduce((sum, r) => sum + r.failureCount, 0);

      logger.info(`Multicast notification sent. Success: ${totalSuccess}, Failed: ${totalFailure}`);
      
      return {
        success: true,
        totalSuccess,
        totalFailure,
        results
      };
    } catch (error) {
      logger.error('Failed to send multicast push notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send notification to topic (for broadcast messages)
  async sendToTopic(topic, notification, data = {}) {
    if (!this.initialized) {
      logger.warn('Firebase not initialized. Skipping topic notification.');
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      const message = {
        topic: topic,
        notification: {
          title: notification.title,
          body: notification.message,
          imageUrl: notification.imageUrl
        },
        data: {
          ...data,
          type: notification.type || '',
          category: notification.category || '',
          timestamp: new Date().toISOString()
        },
        android: {
          priority: 'high',
          notification: {
            channelId: this.getChannelId(notification.category),
            priority: 'high',
            defaultSound: true,
            icon: 'ic_notification',
            color: '#2196F3'
          }
        },
        apns: {
          payload: {
            aps: {
              alert: {
                title: notification.title,
                body: notification.message
              },
              sound: 'default',
              category: notification.category
            }
          }
        }
      };

      const response = await this.messaging.send(message);
      logger.info(`Topic notification sent successfully: ${response}`);
      
      return {
        success: true,
        messageId: response
      };
    } catch (error) {
      logger.error('Failed to send topic notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Subscribe user to topic
  async subscribeToTopic(fcmTokens, topic) {
    if (!this.initialized) {
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      const tokens = Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens];
      const response = await this.messaging.subscribeToTopic(tokens, topic);
      
      logger.info(`Subscribed ${response.successCount} tokens to topic: ${topic}`);
      
      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount
      };
    } catch (error) {
      logger.error('Failed to subscribe to topic:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Unsubscribe user from topic
  async unsubscribeFromTopic(fcmTokens, topic) {
    if (!this.initialized) {
      return { success: false, error: 'Firebase not initialized' };
    }

    try {
      const tokens = Array.isArray(fcmTokens) ? fcmTokens : [fcmTokens];
      const response = await this.messaging.unsubscribeFromTopic(tokens, topic);
      
      logger.info(`Unsubscribed ${response.successCount} tokens from topic: ${topic}`);
      
      return {
        success: true,
        successCount: response.successCount,
        failureCount: response.failureCount
      };
    } catch (error) {
      logger.error('Failed to unsubscribe from topic:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Validate FCM token
  async validateToken(fcmToken) {
    if (!this.initialized) {
      return { valid: false, error: 'Firebase not initialized' };
    }

    try {
      // Try to send a test message (dry run)
      const message = {
        token: fcmToken,
        data: { test: 'true' },
        dryRun: true
      };

      await this.messaging.send(message);
      return { valid: true };
    } catch (error) {
      if (error.code === 'messaging/invalid-registration-token' || 
          error.code === 'messaging/registration-token-not-registered') {
        return { valid: false, error: 'Invalid token' };
      }
      return { valid: false, error: error.message };
    }
  }

  // Get notification channel ID based on category
  getChannelId(category) {
    const channels = {
      'booking': 'booking_notifications',
      'payment': 'payment_notifications',
      'space': 'space_notifications',
      'account': 'account_notifications',
      'system': 'system_notifications',
      'marketing': 'marketing_notifications'
    };
    return channels[category] || 'default_notifications';
  }

  // Remove invalid FCM token from user
  async removeInvalidToken(fcmToken) {
    try {
      await User.updateMany(
        { 'deviceTokens.fcmToken': fcmToken },
        { $pull: { deviceTokens: { fcmToken: fcmToken } } }
      );
      logger.info(`Removed invalid FCM token: ${fcmToken}`);
    } catch (error) {
      logger.error('Failed to remove invalid FCM token:', error);
    }
  }

  // Remove multiple invalid FCM tokens
  async removeInvalidTokens(fcmTokens) {
    try {
      await User.updateMany(
        { 'deviceTokens.fcmToken': { $in: fcmTokens } },
        { $pull: { deviceTokens: { fcmToken: { $in: fcmTokens } } } }
      );
      logger.info(`Removed ${fcmTokens.length} invalid FCM tokens`);
    } catch (error) {
      logger.error('Failed to remove invalid FCM tokens:', error);
    }
  }

  // Send notification to user (finds their FCM tokens)
  async sendToUser(userId, notification, data = {}) {
    try {
      // TEMPORARILY DISABLED - Firebase notifications causing connection issues
      logger.info(`🔇 Firebase notification temporarily disabled for user ${userId}: ${notification.title}`);
      return { success: false, error: 'Firebase notifications temporarily disabled' };
      
      /*
      const user = await User.findById(userId).select('deviceTokens notificationPreferences');
      if (!user || !user.deviceTokens || user.deviceTokens.length === 0) {
        return { success: false, error: 'No FCM tokens found for user' };
      }

      // Check user preferences
      const preferences = user.notificationPreferences || {};
      const categoryEnabled = preferences[notification.category];
      if (categoryEnabled === false && !notification.overrideUserPreferences) {
        return { success: false, error: 'User has disabled this notification category' };
      }

      // Get active FCM tokens
      const fcmTokens = user.deviceTokens
        .filter(token => token.fcmToken && token.isActive)
        .map(token => token.fcmToken);

      if (fcmTokens.length === 0) {
        return { success: false, error: 'No active FCM tokens found for user' };
      }

      // Add unread count to data
      const Notification = require('../models/Notification');
      const unreadCount = await Notification.getUnreadCount(userId);
      data.unreadCount = unreadCount + 1;

      if (fcmTokens.length === 1) {
        return await this.sendToDevice(fcmTokens[0], notification, data);
      } else {
        return await this.sendToMultipleDevices(fcmTokens, notification, data);
      }
      */
    } catch (error) {
      logger.error('Failed to send notification to user:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Broadcast notification to all users of a specific type
  async broadcastToUserType(userType, notification, data = {}) {
    try {
      const users = await User.find({ 
        role: userType,
        'deviceTokens.isActive': true
      }).select('deviceTokens');

      const allTokens = [];
      users.forEach(user => {
        if (user.deviceTokens) {
          const tokens = user.deviceTokens
            .filter(token => token.fcmToken && token.isActive)
            .map(token => token.fcmToken);
          allTokens.push(...tokens);
        }
      });

      if (allTokens.length === 0) {
        return { success: false, error: 'No FCM tokens found for user type' };
      }

      return await this.sendToMultipleDevices(allTokens, notification, data);
    } catch (error) {
      logger.error('Failed to broadcast notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Helper method to ensure all data values are strings (Firebase requirement)
  _ensureStringData(data) {
    const stringData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        stringData[key] = '';
      } else if (typeof value === 'object') {
        stringData[key] = JSON.stringify(value);
      } else {
        stringData[key] = String(value);
      }
    }
    return stringData;
  }
}

module.exports = new FirebaseNotificationService(); 