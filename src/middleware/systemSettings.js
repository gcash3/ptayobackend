const SystemSettings = require('../models/SystemSettings');
const logger = require('../config/logger');
const { AppError } = require('./errorHandler');

/**
 * Middleware to check if the system is in maintenance mode
 */
const checkMaintenanceMode = async (req, res, next) => {
  try {
    const generalSettings = await SystemSettings.getSettingsByType('General');

    if (generalSettings && generalSettings.maintenanceMode) {
      // Allow admin routes during maintenance mode
      if (req.path.startsWith('/api/v1/admin')) {
        return next();
      }

      // Allow authentication routes for admins
      if (req.path.startsWith('/api/v1/auth') &&
          (req.path.includes('/login') || req.path.includes('/verify'))) {
        return next();
      }

      return res.status(503).json({
        status: 'error',
        message: 'System is currently under maintenance. Please try again later.',
        maintenanceMode: true
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking maintenance mode:', error);
    // If we can't check settings, allow request to proceed
    next();
  }
};

/**
 * Middleware to check if user registration is enabled
 */
const checkRegistrationEnabled = async (req, res, next) => {
  try {
    const generalSettings = await SystemSettings.getSettingsByType('General');

    if (generalSettings && !generalSettings.registrationEnabled) {
      return res.status(403).json({
        status: 'error',
        message: 'User registration is currently disabled.',
        registrationDisabled: true
      });
    }

    next();
  } catch (error) {
    logger.error('Error checking registration settings:', error);
    // If we can't check settings, allow registration to proceed
    next();
  }
};

/**
 * Get email verification requirement setting
 */
const getEmailVerificationSetting = async () => {
  try {
    const generalSettings = await SystemSettings.getSettingsByType('General');
    return generalSettings ? generalSettings.emailVerificationRequired : true; // Default to true
  } catch (error) {
    logger.error('Error getting email verification setting:', error);
    return true; // Default to requiring verification
  }
};

/**
 * Get auto-approve setting for parking spaces
 */
const getAutoApproveSetting = async () => {
  try {
    const generalSettings = await SystemSettings.getSettingsByType('General');
    return generalSettings ? generalSettings.autoApproveSpaces : false; // Default to false
  } catch (error) {
    logger.error('Error getting auto-approve setting:', error);
    return false; // Default to manual approval
  }
};

/**
 * Middleware to inject system settings into req object for controllers to use
 */
const injectSystemSettings = async (req, res, next) => {
  try {
    const allSettings = await SystemSettings.getAllSettings();
    req.systemSettings = allSettings;
    next();
  } catch (error) {
    logger.error('Error injecting system settings:', error);
    req.systemSettings = {};
    next();
  }
};

/**
 * Get all current system settings
 */
const getCurrentSettings = async () => {
  try {
    return await SystemSettings.getAllSettings();
  } catch (error) {
    logger.error('Error getting current settings:', error);
    return {};
  }
};

module.exports = {
  checkMaintenanceMode,
  checkRegistrationEnabled,
  getEmailVerificationSetting,
  getAutoApproveSetting,
  injectSystemSettings,
  getCurrentSettings
};