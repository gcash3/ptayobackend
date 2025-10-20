const logger = require('../config/logger');

/**
 * Time Validation Utilities for ParkTayo
 * Handles operating hours validation for parking spaces
 */
class TimeValidationUtils {
  constructor() {
    // Hong Kong timezone offset (UTC+8)
    this.HONG_KONG_OFFSET = 8 * 60; // minutes
  }

  /**
   * Get Hong Kong time from UTC or local time
   * @param {Date} date - Date to convert (optional, defaults to now)
   * @returns {Date} Hong Kong time
   */
  getHongKongTime(date = new Date()) {
    const utc = date.getTime() + (date.getTimezoneOffset() * 60000);
    return new Date(utc + (this.HONG_KONG_OFFSET * 60000));
  }

  /**
   * Parse time string (HH:MM format) to minutes since midnight
   * @param {string} timeStr - Time in "HH:MM" format
   * @returns {number} Minutes since midnight, or null if invalid
   */
  parseTimeToMinutes(timeStr) {
    if (!timeStr || typeof timeStr !== 'string') return null;

    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;

    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);

    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

    return hours * 60 + minutes;
  }

  /**
   * Get day name from date
   * @param {Date} date - Date to get day name from
   * @returns {string} Day name in lowercase (monday, tuesday, etc.)
   */
  getDayName(date) {
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[date.getDay()];
  }

  /**
   * Get current time in minutes since midnight
   * @param {Date} date - Date to get time from (optional, defaults to Hong Kong time)
   * @returns {number} Minutes since midnight
   */
  getCurrentTimeMinutes(date = null) {
    const hkTime = date ? this.getHongKongTime(date) : this.getHongKongTime();
    return hkTime.getHours() * 60 + hkTime.getMinutes();
  }

  /**
   * Check if a parking space is open at a specific time
   * @param {Object} operatingHours - Operating hours object from parking space
   * @param {Date} checkTime - Time to check (optional, defaults to current Hong Kong time)
   * @returns {Object} Availability status with details
   */
  isSpaceOpenAt(operatingHours, checkTime = null) {
    try {
      // If no operating hours defined, assume closed
      if (!operatingHours || typeof operatingHours !== 'object') {
        return {
          isOpen: false,
          reason: 'NO_SCHEDULE_DEFINED',
          message: 'Operating hours not defined',
          nextOpenTime: null
        };
      }

      // If 24/7 operation
      if (operatingHours.isOpen24_7 === true) {
        return {
          isOpen: true,
          reason: 'OPEN_24_7',
          message: 'Open 24/7',
          nextOpenTime: null
        };
      }

      // Use provided time or current Hong Kong time
      const hkTime = checkTime ? this.getHongKongTime(checkTime) : this.getHongKongTime();
      const dayName = this.getDayName(hkTime);
      const currentMinutes = this.getCurrentTimeMinutes(hkTime);

      // Check if schedule exists for current day
      if (!operatingHours.schedule || !operatingHours.schedule[dayName]) {
        return {
          isOpen: false,
          reason: 'NO_SCHEDULE_FOR_DAY',
          message: `No schedule defined for ${dayName}`,
          nextOpenTime: this.getNextOpenTime(operatingHours, hkTime)
        };
      }

      const daySchedule = operatingHours.schedule[dayName];

      // Check if day schedule has open/close times
      if (!daySchedule.open || !daySchedule.close) {
        return {
          isOpen: false,
          reason: 'INCOMPLETE_SCHEDULE',
          message: `Incomplete schedule for ${dayName}`,
          nextOpenTime: this.getNextOpenTime(operatingHours, hkTime)
        };
      }

      const openMinutes = this.parseTimeToMinutes(daySchedule.open);
      const closeMinutes = this.parseTimeToMinutes(daySchedule.close);

      if (openMinutes === null || closeMinutes === null) {
        return {
          isOpen: false,
          reason: 'INVALID_TIME_FORMAT',
          message: `Invalid time format for ${dayName}`,
          nextOpenTime: this.getNextOpenTime(operatingHours, hkTime)
        };
      }

      // Handle overnight operations (e.g., 22:00 - 06:00)
      let isCurrentlyOpen;
      if (closeMinutes < openMinutes) {
        // Overnight operation
        isCurrentlyOpen = currentMinutes >= openMinutes || currentMinutes <= closeMinutes;
      } else {
        // Same day operation
        isCurrentlyOpen = currentMinutes >= openMinutes && currentMinutes <= closeMinutes;
      }

      if (isCurrentlyOpen) {
        return {
          isOpen: true,
          reason: 'WITHIN_OPERATING_HOURS',
          message: `Open until ${daySchedule.close}`,
          nextCloseTime: this.getNextCloseTime(operatingHours, hkTime)
        };
      } else {
        return {
          isOpen: false,
          reason: 'OUTSIDE_OPERATING_HOURS',
          message: `Closed. Opens at ${daySchedule.open}`,
          nextOpenTime: this.getNextOpenTime(operatingHours, hkTime)
        };
      }

    } catch (error) {
      logger.error('Time validation error:', error);
      return {
        isOpen: false,
        reason: 'VALIDATION_ERROR',
        message: 'Error checking operating hours',
        error: error.message,
        nextOpenTime: null
      };
    }
  }

  /**
   * Get next opening time for a parking space
   * @param {Object} operatingHours - Operating hours object
   * @param {Date} fromTime - Starting time to check from
   * @returns {Date|null} Next opening time or null if always closed
   */
  getNextOpenTime(operatingHours, fromTime) {
    try {
      if (!operatingHours || !operatingHours.schedule) return null;
      if (operatingHours.isOpen24_7) return fromTime; // Already open

      const hkTime = this.getHongKongTime(fromTime);
      const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

      // Check next 7 days for opening time
      for (let i = 0; i < 7; i++) {
        const checkDate = new Date(hkTime.getTime() + (i * 24 * 60 * 60 * 1000));
        const dayName = this.getDayName(checkDate);
        const daySchedule = operatingHours.schedule[dayName];

        if (daySchedule && daySchedule.open) {
          const openMinutes = this.parseTimeToMinutes(daySchedule.open);
          if (openMinutes !== null) {
            const openTime = new Date(checkDate);
            openTime.setHours(Math.floor(openMinutes / 60), openMinutes % 60, 0, 0);

            // If it's today, make sure the open time is in the future
            if (i === 0 && openTime <= hkTime) {
              continue; // Try next day
            }

            return openTime;
          }
        }
      }

      return null; // No opening time found in next 7 days
    } catch (error) {
      logger.error('Error getting next open time:', error);
      return null;
    }
  }

  /**
   * Get next closing time for a parking space
   * @param {Object} operatingHours - Operating hours object
   * @param {Date} fromTime - Starting time to check from
   * @returns {Date|null} Next closing time or null if 24/7
   */
  getNextCloseTime(operatingHours, fromTime) {
    try {
      if (!operatingHours || !operatingHours.schedule) return null;
      if (operatingHours.isOpen24_7) return null; // Never closes

      const hkTime = this.getHongKongTime(fromTime);
      const dayName = this.getDayName(hkTime);
      const daySchedule = operatingHours.schedule[dayName];

      if (daySchedule && daySchedule.close) {
        const closeMinutes = this.parseTimeToMinutes(daySchedule.close);
        const openMinutes = this.parseTimeToMinutes(daySchedule.open);

        if (closeMinutes !== null && openMinutes !== null) {
          const closeTime = new Date(hkTime);

          // Handle overnight operations
          if (closeMinutes < openMinutes) {
            // Close time is next day
            closeTime.setDate(closeTime.getDate() + 1);
          }

          closeTime.setHours(Math.floor(closeMinutes / 60), closeMinutes % 60, 0, 0);
          return closeTime;
        }
      }

      return null;
    } catch (error) {
      logger.error('Error getting next close time:', error);
      return null;
    }
  }

  /**
   * Check if a time range (booking period) overlaps with operating hours
   * @param {Object} operatingHours - Operating hours object
   * @param {Date} startTime - Booking start time
   * @param {Date} endTime - Booking end time
   * @returns {Object} Validation result with details
   */
  validateBookingTimeRange(operatingHours, startTime, endTime) {
    try {
      if (!startTime || !endTime) {
        return {
          isValid: false,
          reason: 'INVALID_TIME_RANGE',
          message: 'Start time and end time are required'
        };
      }

      if (endTime <= startTime) {
        return {
          isValid: false,
          reason: 'INVALID_TIME_ORDER',
          message: 'End time must be after start time'
        };
      }

      // If 24/7, always valid
      if (operatingHours && operatingHours.isOpen24_7) {
        return {
          isValid: true,
          reason: 'OPEN_24_7',
          message: 'Parking space operates 24/7'
        };
      }

      // Check start time
      const startStatus = this.isSpaceOpenAt(operatingHours, startTime);
      if (!startStatus.isOpen) {
        return {
          isValid: false,
          reason: 'START_TIME_OUTSIDE_HOURS',
          message: `Parking space is closed at booking start time: ${startStatus.message}`,
          nextOpenTime: startStatus.nextOpenTime
        };
      }

      // Check end time
      const endStatus = this.isSpaceOpenAt(operatingHours, endTime);
      if (!endStatus.isOpen) {
        return {
          isValid: false,
          reason: 'END_TIME_OUTSIDE_HOURS',
          message: `Parking space will be closed at booking end time: ${endStatus.message}`
        };
      }

      // Additional check: ensure the entire period is within operating hours
      // This is more complex for multi-day bookings, but for now we'll assume
      // that if start and end are both within hours, the booking is valid
      return {
        isValid: true,
        reason: 'WITHIN_OPERATING_HOURS',
        message: 'Booking time is within operating hours'
      };

    } catch (error) {
      logger.error('Booking time validation error:', error);
      return {
        isValid: false,
        reason: 'VALIDATION_ERROR',
        message: 'Error validating booking time',
        error: error.message
      };
    }
  }

  /**
   * Generate MongoDB query filter for spaces open at specific time
   * @param {Date} checkTime - Time to check (optional, defaults to current time)
   * @returns {Object} MongoDB query filter
   */
  generateTimeBasedFilter(checkTime = null) {
    const hkTime = checkTime ? this.getHongKongTime(checkTime) : this.getHongKongTime();
    const dayName = this.getDayName(hkTime);
    const currentMinutes = this.getCurrentTimeMinutes(hkTime);
    const currentHour = Math.floor(currentMinutes / 60);
    const currentMinute = currentMinutes % 60;
    const currentTimeStr = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;

    return {
      $or: [
        // 24/7 spaces
        { 'operatingHours.isOpen24_7': true },

        // Spaces with schedule for current day
        {
          $and: [
            { 'operatingHours.isOpen24_7': { $ne: true } },
            { [`operatingHours.schedule.${dayName}.open`]: { $exists: true, $ne: null } },
            { [`operatingHours.schedule.${dayName}.close`]: { $exists: true, $ne: null } },
            {
              $or: [
                // Same day operation (open <= current <= close)
                {
                  $and: [
                    { $expr: { $lte: [{ $convert: { input: { $substr: [`$operatingHours.schedule.${dayName}.open`, 0, 2] }, to: "int", onError: 25 } }, currentHour] } },
                    { $expr: { $gte: [{ $convert: { input: { $substr: [`$operatingHours.schedule.${dayName}.close`, 0, 2] }, to: "int", onError: 0 } }, currentHour] } }
                  ]
                },
                // Overnight operation (current >= open OR current <= close)
                {
                  $and: [
                    { $expr: { $gt: [{ $convert: { input: { $substr: [`$operatingHours.schedule.${dayName}.open`, 0, 2] }, to: "int", onError: 25 } }, { $convert: { input: { $substr: [`$operatingHours.schedule.${dayName}.close`, 0, 2] }, to: "int", onError: 0 } }] } },
                    {
                      $or: [
                        { $expr: { $gte: [currentHour, { $convert: { input: { $substr: [`$operatingHours.schedule.${dayName}.open`, 0, 2] }, to: "int", onError: 25 } }] } },
                        { $expr: { $lte: [currentHour, { $convert: { input: { $substr: [`$operatingHours.schedule.${dayName}.close`, 0, 2] }, to: "int", onError: 0 } }] } }
                      ]
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
  }
}

module.exports = new TimeValidationUtils();