const moment = require('moment-timezone');

// Hong Kong timezone
const TIMEZONE = 'Asia/Hong_Kong';

/**
 * Get current Hong Kong time
 * @returns {Date} Current date/time in Hong Kong timezone
 */
const getHongKongTime = () => {
  return moment().tz(TIMEZONE).toDate();
};

/**
 * Format Hong Kong time to string
 * @param {Date} date - Date to format
 * @param {string} format - Moment.js format string
 * @returns {string} Formatted date string
 */
const formatHongKongTime = (date = null, format = 'YYYY-MM-DD HH:mm:ss') => {
  const dateToFormat = date || getHongKongTime();
  return moment(dateToFormat).tz(TIMEZONE).format(format);
};

/**
 * Convert any date to Hong Kong timezone
 * @param {Date|string} date - Date to convert
 * @returns {Date} Date in Hong Kong timezone
 */
const toHongKongTime = (date) => {
  return moment(date).tz(TIMEZONE).toDate();
};

/**
 * Get start of day in Hong Kong timezone
 * @param {Date} date - Optional date, defaults to today
 * @returns {Date} Start of day in Hong Kong timezone
 */
const getStartOfDayHK = (date = null) => {
  const targetDate = date || getHongKongTime();
  return moment(targetDate).tz(TIMEZONE).startOf('day').toDate();
};

/**
 * Get end of day in Hong Kong timezone
 * @param {Date} date - Optional date, defaults to today
 * @returns {Date} End of day in Hong Kong timezone
 */
const getEndOfDayHK = (date = null) => {
  const targetDate = date || getHongKongTime();
  return moment(targetDate).tz(TIMEZONE).endOf('day').toDate();
};

/**
 * Check if a booking time is in the past (Hong Kong time)
 * @param {Date} bookingTime - Booking time to check
 * @returns {boolean} True if booking time is in the past
 */
const isBookingTimeInPast = (bookingTime) => {
  const currentHKTime = getHongKongTime();
  return moment(bookingTime).isBefore(currentHKTime);
};

/**
 * Check if user is late for booking (grace period: 15 minutes)
 * @param {Date} bookingTime - Scheduled booking time
 * @param {number} gracePeriodMinutes - Grace period in minutes (default: 15)
 * @returns {boolean} True if user is late
 */
const isUserLateForBooking = (bookingTime, gracePeriodMinutes = 15) => {
  const currentHKTime = getHongKongTime();
  const gracePeriodEnd = moment(bookingTime).add(gracePeriodMinutes, 'minutes');
  return moment(currentHKTime).isAfter(gracePeriodEnd);
};

/**
 * Calculate minutes late for a booking
 * @param {Date} bookingTime - Scheduled booking time
 * @returns {number} Minutes late (0 if not late)
 */
const getMinutesLate = (bookingTime) => {
  const currentHKTime = getHongKongTime();
  const minutesLate = moment(currentHKTime).diff(moment(bookingTime), 'minutes');
  return Math.max(0, minutesLate);
};

module.exports = {
  TIMEZONE,
  getHongKongTime,
  formatHongKongTime,
  toHongKongTime,
  getStartOfDayHK,
  getEndOfDayHK,
  isBookingTimeInPast,
  isUserLateForBooking,
  getMinutesLate
};
