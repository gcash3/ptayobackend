const express = require('express');
const notificationService = require('../services/notificationService');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const { body, query, param } = require('express-validator');
const { validateRequest } = require('../middleware/validation');

const router = express.Router();

// Get user notifications with pagination and filters
router.get('/', [
  query('page').optional().isInt({ min: 1 }).withMessage('Page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 50 }).withMessage('Limit must be between 1 and 50'),
  query('category').optional().isIn(['booking', 'payment', 'space', 'account', 'system', 'marketing']).withMessage('Invalid category'),
  query('unreadOnly').optional().isBoolean().withMessage('unreadOnly must be a boolean'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, category, unreadOnly } = req.query;
  const userId = req.user.id;

  const options = {
    page: parseInt(page),
    limit: parseInt(limit),
    category: category || null,
    unreadOnly: unreadOnly === 'true'
  };

  const notifications = await notificationService.getUserNotifications(userId, options);

  // Get total count for pagination
  const Notification = require('../models/Notification');
  const query = { recipientId: userId };
  if (category) query.category = category;
  if (unreadOnly === 'true') query['channels.inApp.read'] = false;
  
  const totalItems = await Notification.countDocuments(query);
  const totalPages = Math.ceil(totalItems / parseInt(limit));

  res.status(200).json({
    status: 'success',
    results: notifications.length,
    data: {
      notifications,
      pagination: {
        currentPage: parseInt(page),
        totalPages,
        totalItems,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    }
  });
}));

// Get unread notification count
router.get('/unread-count', catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const unreadCount = await notificationService.getUnreadCount(userId);

  res.status(200).json({
    status: 'success',
    data: {
      unreadCount
    }
  });
}));

// Mark specific notification as read
router.patch('/:notificationId/read', [
  param('notificationId').isMongoId().withMessage('Invalid notification ID'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const userId = req.user.id;

  const notification = await notificationService.markAsRead(notificationId, userId);

  res.status(200).json({
    status: 'success',
    message: 'Notification marked as read',
    data: {
      notification
    }
  });
}));

// Mark all notifications as read
router.patch('/mark-all-read', [
  body('category').optional().isIn(['booking', 'payment', 'space', 'account', 'system', 'marketing']).withMessage('Invalid category'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { category } = req.body;

  const result = await notificationService.markAllAsRead(userId, category);

  res.status(200).json({
    status: 'success',
    message: `All notifications${category ? ` in ${category} category` : ''} marked as read`,
    data: {
      modifiedCount: result.modifiedCount
    }
  });
}));

// Get notification by ID
router.get('/:notificationId', [
  param('notificationId').isMongoId().withMessage('Invalid notification ID'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const userId = req.user.id;

  const Notification = require('../models/Notification');
  const notification = await Notification.findOne({
    _id: notificationId,
    recipientId: userId
  }).populate('relatedEntityId');

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      notification
    }
  });
}));

// Delete notification
router.delete('/:notificationId', [
  param('notificationId').isMongoId().withMessage('Invalid notification ID'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const { notificationId } = req.params;
  const userId = req.user.id;

  const Notification = require('../models/Notification');
  const notification = await Notification.findOneAndDelete({
    _id: notificationId,
    recipientId: userId
  });

  if (!notification) {
    return next(new AppError('Notification not found', 404));
  }

  res.status(200).json({
    status: 'success',
    message: 'Notification deleted successfully'
  });
}));

// Get notification preferences
router.get('/preferences/settings', catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const User = require('../models/User');
  
  const user = await User.findById(userId).select('notificationPreferences');
  
  const defaultPreferences = {
    booking: true,
    payment: true,
    space: true,
    account: true,
    system: true,
    marketing: false
  };

  const preferences = user?.notificationPreferences || defaultPreferences;

  res.status(200).json({
    status: 'success',
    data: {
      preferences
    }
  });
}));

// Update notification preferences
router.patch('/preferences/settings', [
  body('preferences').isObject().withMessage('Preferences must be an object'),
  body('preferences.booking').optional().isBoolean().withMessage('booking preference must be boolean'),
  body('preferences.payment').optional().isBoolean().withMessage('payment preference must be boolean'),
  body('preferences.space').optional().isBoolean().withMessage('space preference must be boolean'),
  body('preferences.account').optional().isBoolean().withMessage('account preference must be boolean'),
  body('preferences.system').optional().isBoolean().withMessage('system preference must be boolean'),
  body('preferences.marketing').optional().isBoolean().withMessage('marketing preference must be boolean'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { preferences } = req.body;
  
  const User = require('../models/User');
  const user = await User.findByIdAndUpdate(
    userId,
    { notificationPreferences: preferences },
    { new: true, runValidators: true }
  ).select('notificationPreferences');

  res.status(200).json({
    status: 'success',
    message: 'Notification preferences updated',
    data: {
      preferences: user.notificationPreferences
    }
  });
}));

// Send test notification (for debugging)
router.post('/test', [
  body('type').optional().isString().withMessage('Type must be a string'),
  validateRequest
], catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { type = 'test' } = req.body;

  const result = await notificationService.sendTestNotification(userId, type);

  res.status(200).json({
    status: 'success',
    message: 'Test notification sent',
    data: result
  });
}));

// Admin only: Send system-wide notification
router.post('/broadcast', [
  body('title').notEmpty().withMessage('Title is required'),
  body('message').notEmpty().withMessage('Message is required'),
  body('type').notEmpty().withMessage('Type is required'),
  body('category').isIn(['booking', 'payment', 'space', 'account', 'system', 'marketing']).withMessage('Invalid category'),
  body('targetUserType').optional().isIn(['client', 'landlord', 'all']).withMessage('Invalid target user type'),
  validateRequest
], catchAsync(async (req, res, next) => {
  // Check if user is admin
  if (req.user.role !== 'admin') {
    return next(new AppError('Only admins can send broadcast notifications', 403));
  }

  const { title, message, type, category, targetUserType = 'all' } = req.body;

  const notificationData = {
    title,
    message,
    type,
    category,
    priority: 'high',
    channels: {
      inApp: { enabled: true },
      push: { enabled: true }
    }
  };

  const User = require('../models/User');
  let userQuery = { isActive: true };
  
  if (targetUserType !== 'all') {
    userQuery.role = targetUserType;
  }

  const users = await User.find(userQuery).select('_id role');
  const results = [];

  for (const user of users) {
    try {
      const result = await notificationService.sendNotification(user._id, notificationData, {
        recipientType: user.role,
        overrideUserPreferences: true
      });
      results.push(result);
    } catch (error) {
      console.error(`Failed to send notification to user ${user._id}:`, error);
    }
  }

  const successCount = results.filter(r => r.success).length;
  const failureCount = results.filter(r => !r.success).length;

  res.status(200).json({
    status: 'success',
    message: 'Broadcast notification sent',
    data: {
      targetUsers: users.length,
      successCount,
      failureCount,
      results: results.slice(0, 10) // Return first 10 results as sample
    }
  });
}));

module.exports = router; 