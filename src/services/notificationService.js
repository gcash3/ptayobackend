const Notification = require('../models/Notification');
const firebaseService = require('./firebaseNotificationService');
const logger = require('../config/logger');
const User = require('../models/User');

// Global io store to avoid circular dependencies
let globalIO = null;

// Function to set the io instance (called from server.js)
const setIO = (io) => {
  globalIO = io;
};

class NotificationService {
  constructor() {
    this.templates = Notification.templates;
  }

  // Get Socket.IO instance
  getIO() {
    return globalIO;
  }

  // Send notification with all configured channels
  async sendNotification(recipientId, notificationData, options = {}) {
    try {
      // Create notification record
      const notification = await Notification.create({
        recipientId,
        recipientType: options.recipientType || 'client',
        title: notificationData.title,
        message: notificationData.message,
        type: notificationData.type,
        category: notificationData.category,
        priority: notificationData.priority || 'medium',
        relatedEntityId: notificationData.relatedEntityId,
        relatedEntityType: notificationData.relatedEntityType,
        channels: notificationData.channels || {},
        actionData: notificationData.actionData || { actionType: 'none' },
        metadata: notificationData.metadata || {},
        overrideUserPreferences: options.overrideUserPreferences || false
      });

      const deliveryResults = {
        notificationId: notification._id,
        inApp: { success: false },
        push: { success: false },
        email: { success: false },
        realTime: { success: false }
      };

      // Send real-time notification via Socket.IO
      if (notification.channels.inApp?.enabled !== false) {
        try {
          await this.sendRealTimeNotification(recipientId, notification);
          await notification.markAsDelivered('inApp');
          deliveryResults.inApp = { success: true };
          deliveryResults.realTime = { success: true };
        } catch (error) {
          logger.error('Real-time notification failed:', error);
          await notification.markAsFailed('inApp', error.message);
          deliveryResults.inApp = { success: false, error: error.message };
        }
      }

      // Send push notification
      if (notification.channels.push?.enabled !== false) {
        try {
          const pushResult = await firebaseService.sendToUser(recipientId, {
            title: notification.title,
            message: notification.message,
            type: notification.type,
            category: notification.category,
            priority: notification.priority,
            imageUrl: notification.metadata?.imageUrl,
            deepLink: notification.metadata?.deepLink,
            id: notification._id,
            overrideUserPreferences: notification.overrideUserPreferences
          }, {
            notificationId: notification._id.toString(),
            relatedEntityId: notification.relatedEntityId?.toString(),
            actionType: notification.actionData?.actionType
          });

          if (pushResult.success) {
            await notification.markAsDelivered('push');
            deliveryResults.push = { success: true, data: pushResult };
          } else {
            await notification.markAsFailed('push', pushResult.error);
            deliveryResults.push = { success: false, error: pushResult.error };
          }
        } catch (error) {
          logger.error('Push notification failed:', error);
          await notification.markAsFailed('push', error.message);
          deliveryResults.push = { success: false, error: error.message };
        }
      }

      // Send email notification (if enabled)
      if (notification.channels.email?.enabled === true) {
        try {
          // TODO: Implement email service
          // const emailResult = await this.sendEmailNotification(recipientId, notification);
          deliveryResults.email = { success: false, error: 'Email service not implemented' };
        } catch (error) {
          logger.error('Email notification failed:', error);
          await notification.markAsFailed('email', error.message);
          deliveryResults.email = { success: false, error: error.message };
        }
      }

      return {
        success: true,
        notification,
        deliveryResults
      };

    } catch (error) {
      logger.error('Failed to send notification:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Send real-time notification via Socket.IO
  async sendRealTimeNotification(recipientId, notification) {
    const io = this.getIO();
    if (!io) {
      logger.warn('Socket.IO not available, skipping real-time notification');
      return; // Gracefully skip real-time notification
    }

    const payload = {
      id: notification._id,
      title: notification.title,
      message: notification.message,
      type: notification.type,
      category: notification.category,
      priority: notification.priority,
      actionData: notification.actionData,
      metadata: notification.metadata,
      createdAt: notification.createdAt,
      isActionable: notification.isActionable
    };

    // Send to user's room
    io.to(`user_${recipientId}`).emit('new_notification', payload);
    
    // Also send to landlord room if it's a landlord notification
    if (notification.recipientType === 'landlord') {
      io.to(`landlord_${recipientId}`).emit('landlord_notification', payload);
    }

    // Send to admin room if it's an admin notification
    if (notification.recipientType === 'admin') {
      io.to('admin_room').emit('admin_notification', payload);
    }

    logger.info(`Real-time notification sent to user ${recipientId}: ${notification.type}`);
  }

  // Send notification using predefined template
  async sendTemplatedNotification(recipientId, templateKey, templateData, options = {}) {
    const template = this.templates[templateKey];
    if (!template) {
      throw new Error(`Notification template '${templateKey}' not found`);
    }

    // Replace placeholders in template
    const title = this.replacePlaceholders(template.title, templateData);
    const message = this.replacePlaceholders(template.message, templateData);

    const notificationData = {
      title,
      message,
      type: templateKey,
      category: template.category,
      priority: template.priority,
      channels: template.channels,
      ...options.additionalData
    };

    return await this.sendNotification(recipientId, notificationData, options);
  }

  // Replace placeholders in text with actual data
  replacePlaceholders(text, data) {
    let result = text;
    Object.keys(data).forEach(key => {
      const placeholder = `{${key}}`;
      result = result.replace(new RegExp(placeholder, 'g'), data[key]);
    });
    return result;
  }

  // Send space approval notification
  async sendSpaceApprovalNotification(landlordId, parkingSpace, approvedBy, adminNotes = '') {
    return await this.sendTemplatedNotification(
      landlordId,
      'space_approved',
      {
        spaceName: parkingSpace.name,
        spaceAddress: parkingSpace.address
      },
      {
        recipientType: 'landlord',
        additionalData: {
          relatedEntityId: parkingSpace._id,
          relatedEntityType: 'parking_space',
          actionData: {
            actionType: 'view',
            actionText: 'View Space',
            actionUrl: `/spaces/${parkingSpace._id}`,
            actionPayload: { spaceId: parkingSpace._id }
          },
          metadata: {
            deepLink: `parktayo://spaces/${parkingSpace._id}`,
            customData: { approvedBy, adminNotes }
          }
        }
      }
    );
  }

  // Send space rejection notification
  async sendSpaceRejectionNotification(landlordId, parkingSpace, rejectedBy, rejectionReason, adminNotes = '') {
    return await this.sendTemplatedNotification(
      landlordId,
      'space_rejected',
      {
        spaceName: parkingSpace.name,
        rejectionReason: rejectionReason
      },
      {
        recipientType: 'landlord',
        additionalData: {
          relatedEntityId: parkingSpace._id,
          relatedEntityType: 'parking_space',
          actionData: {
            actionType: 'view',
            actionText: 'Edit Space',
            actionUrl: `/spaces/${parkingSpace._id}/edit`,
            actionPayload: { spaceId: parkingSpace._id, action: 'edit' }
          },
          metadata: {
            deepLink: `parktayo://spaces/${parkingSpace._id}/edit`,
            customData: { rejectedBy, rejectionReason, adminNotes }
          }
        },
        overrideUserPreferences: true // Important notification
      }
    );
  }

  // Send booking confirmation notification
  async sendBookingConfirmationNotification(clientId, booking, parkingSpace) {
    const bookingDate = new Date(booking.startTime).toLocaleDateString('en-PH', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    return await this.sendTemplatedNotification(
      clientId,
      'booking_confirmed',
      {
        spaceName: parkingSpace.name,
        date: bookingDate,
        bookingId: booking.bookingId
      },
      {
        recipientType: 'client',
        additionalData: {
          relatedEntityId: booking._id,
          relatedEntityType: 'booking',
          actionData: {
            actionType: 'view',
            actionText: 'View Booking',
            actionUrl: `/bookings/${booking._id}`,
            actionPayload: { bookingId: booking._id }
          },
          metadata: {
            deepLink: `parktayo://bookings/${booking._id}`,
            customData: { 
        
              checkInTime: booking.startTime,
              checkOutTime: booking.endTime
            }
          }
        }
      }
    );
  }

  // Send payment received notification to landlord
  async sendPaymentReceivedNotification(landlordId, booking, amount, parkingSpace) {
    return await this.sendTemplatedNotification(
      landlordId,
      'payment_received',
      {
        amount: amount.toFixed(2),
        spaceName: parkingSpace.name,
        bookingId: booking.bookingId
      },
      {
        recipientType: 'landlord',
        additionalData: {
          relatedEntityId: booking._id,
          relatedEntityType: 'booking',
          actionData: {
            actionType: 'view',
            actionText: 'View Earnings',
            actionUrl: '/earnings',
            actionPayload: { bookingId: booking._id }
          },
          metadata: {
            deepLink: 'parktayo://earnings',
            customData: { amount, currency: 'PHP' }
          }
        }
      }
    );
  }

  // Send booking reminder notification
  async sendBookingReminderNotification(clientId, booking, parkingSpace, reminderType = '1hour') {
    const reminderMessages = {
      '1hour': 'Your parking booking starts in 1 hour',
      '30min': 'Your parking booking starts in 30 minutes',
      '15min': 'Your parking booking starts in 15 minutes',
      'expired': 'Your parking booking has expired'
    };

    return await this.sendNotification(clientId, {
      title: 'Booking Reminder 🕐',
      message: reminderMessages[reminderType] || 'Booking reminder',
      type: 'booking_reminder',
      category: 'booking',
      priority: reminderType === 'expired' ? 'high' : 'medium',
      relatedEntityId: booking._id,
      relatedEntityType: 'booking',
      actionData: {
        actionType: 'view',
        actionText: 'View Booking',
        actionUrl: `/bookings/${booking._id}`,
        actionPayload: { bookingId: booking._id }
      },
      metadata: {
        deepLink: `parktayo://bookings/${booking._id}`,
        customData: { reminderType, spaceName: parkingSpace.name }
      }
    }, { recipientType: 'client' });
  }

  // Broadcast system maintenance notification
  async broadcastMaintenanceNotification(title, message, scheduledTime, duration) {
    const notificationData = {
      title,
      message,
      type: 'maintenance_notice',
      category: 'system',
      priority: 'high',
      channels: {
        inApp: { enabled: true },
        push: { enabled: true },
        email: { enabled: true }
      },
      metadata: {
        scheduledTime,
        duration,
        deepLink: 'parktayo://maintenance'
      }
    };

    // Send to all active users
    const activeUsers = await User.find({ 
      isActive: true,
      lastLogin: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Active in last 30 days
    }).select('_id role');

    const results = [];
    for (const user of activeUsers) {
      try {
        const result = await this.sendNotification(user._id, notificationData, {
          recipientType: user.role,
          overrideUserPreferences: true
        });
        results.push(result);
      } catch (error) {
        logger.error(`Failed to send maintenance notification to user ${user._id}:`, error);
      }
    }

    return results;
  }

  // Get user notifications with pagination
  async getUserNotifications(userId, options = {}) {
    return await Notification.getUserNotifications(userId, options);
  }

  // Mark notification as read
  async markAsRead(notificationId, userId) {
    const notification = await Notification.findOne({
      _id: notificationId,
      recipientId: userId
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    return await notification.markAsRead();
  }

  // Mark all notifications as read
  async markAllAsRead(userId, category = null) {
    return await Notification.markAllAsRead(userId, category);
  }

  // Get unread notification count
  async getUnreadCount(userId) {
    return await Notification.getUnreadCount(userId);
  }

  // Clean up expired notifications
  async cleanupExpiredNotifications() {
    const result = await Notification.cleanupExpired();
    logger.info(`Cleaned up ${result.deletedCount} expired notifications`);
    return result;
  }

  // Send test notification (for debugging)
  async sendTestNotification(userId, type = 'test') {
    return await this.sendNotification(userId, {
      title: 'Test Notification 🧪',
      message: 'This is a test notification to verify the system is working.',
      type: 'system_test',
      category: 'system',
      priority: 'low',
      actionData: {
        actionType: 'none'
      }
    });
  }

  // Send notification to admins when a new parking space is submitted
  async sendNewSpaceSubmissionNotification(spaceId, landlordId, spaceName) {
    try {
      // Find all admin users
      const adminUsers = await User.find({ role: 'admin', active: true });

      for (const admin of adminUsers) {
        // Create notification with correct structure
        const notificationData = {
          title: 'New Parking Space Submitted',
          message: `A new parking space "${spaceName}" has been submitted for approval.`,
          type: 'space_approved', // Using valid enum value (will be updated when space is actually approved)
          category: 'space',
          priority: 'medium',
          relatedEntityId: spaceId,
          relatedEntityType: 'parking_space',
          channels: {
            inApp: { enabled: true },
            push: { enabled: true },
            email: { enabled: false },
            sms: { enabled: false }
          },
          actionData: {
            actionType: 'view',
            actionText: 'Review Space',
            actionUrl: `/admin/spaces/${spaceId}/review`,
            actionPayload: { spaceId, landlordId }
          },
          metadata: {
            deepLink: `parktayo://admin/spaces/${spaceId}/review`,
            customData: { 
              landlordId,
              spaceName,
              actionRequired: true
            }
          }
        };

        await this.sendNotification(admin._id, notificationData, {
          recipientType: 'admin',
          overrideUserPreferences: true
        });
      }

      // Send real-time notification to admin room
      const io = this.getIO();
      if (io) {
        io.to('admin_room').emit('new_space_submission', {
          spaceId,
          spaceName,
          landlordId,
          message: `New parking space "${spaceName}" submitted for approval`,
          timestamp: new Date()
        });
      }

      logger.info('New space submission notification sent to admins', { 
        spaceId, 
        landlordId, 
        spaceName,
        adminCount: adminUsers.length 
      });

    } catch (error) {
      logger.error('Failed to send new space submission notification:', error);
      throw error;
    }
  }
}

const notificationService = new NotificationService();

// Legacy functions for backward compatibility
const sendSpaceApprovalNotification = async (landlordId, parkingSpace, adminId, adminNotes) => {
  return await notificationService.sendSpaceApprovalNotification(landlordId, parkingSpace, adminId, adminNotes);
};

const sendSpaceRejectionNotification = async (landlordId, parkingSpace, adminId, rejectionReason, adminNotes) => {
  return await notificationService.sendSpaceRejectionNotification(landlordId, parkingSpace, adminId, rejectionReason, adminNotes);
};

const sendNewSpaceSubmissionNotification = async (spaceId, landlordId, spaceName) => {
  return await notificationService.sendNewSpaceSubmissionNotification(spaceId, landlordId, spaceName);
};

module.exports = {
  setIO, // Export setIO function
  sendSpaceApprovalNotification,
  sendSpaceRejectionNotification,
  sendNewSpaceSubmissionNotification,
  // Export the service instance methods
  sendNotification: (userId, notificationData, options) => notificationService.sendNotification(userId, notificationData, options),
  sendToAllUsers: (notificationData, criteria) => notificationService.sendToAllUsers(notificationData, criteria),
  broadcastToAdmins: (notificationData) => notificationService.broadcastToAdmins(notificationData),
  notificationService // Export the service instance
}; 