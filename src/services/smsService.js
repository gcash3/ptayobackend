const axios = require('axios');
const qs = require('querystring');
const logger = require('../config/logger');

class SMSService {
  constructor() {
    // Hardcoded SMS configuration
    this.serverUrl = 'https://sms.parktayo.com';
    this.apiKey = '3347205ca1a5deeb578ad3b24e79705cfcda38ff';
    this.defaultDevice = 2;
    this.defaultSimSlot = 1; // Changed to SIM slot 1 (0-indexed: 0=first SIM, 1=second SIM)
    this.isEnabled = true;
    
    logger.info(`📱 SMS Service initialized - Enabled: ${this.isEnabled}, Device: ${this.defaultDevice}, SIM Slot: ${this.defaultSimSlot}`);
  }

  /**
   * Normalize phone number to international format (+63)
   * @param {string} phoneNumber - Phone number to normalize
   * @returns {string} Normalized phone number
   */
  normalizePhoneNumber(phoneNumber) {
    if (!phoneNumber) return null;
    
    // Remove all non-digit characters
    let cleaned = phoneNumber.replace(/\D/g, '');
    
    // If starts with 63, add +
    if (cleaned.startsWith('63')) {
      return `+${cleaned}`;
    }
    
    // If starts with 09, replace with +639
    if (cleaned.startsWith('09')) {
      return `+63${cleaned.substring(1)}`;
    }
    
    // If starts with 9, add +63
    if (cleaned.startsWith('9')) {
      return `+63${cleaned}`;
    }
    
    // If already has country code format
    if (cleaned.length === 12 && cleaned.startsWith('63')) {
      return `+${cleaned}`;
    }
    
    // Default: assume it's a local number starting with 9
    return `+63${cleaned}`;
  }

  /**
   * Validate if phone number is a valid Philippine mobile number
   * @param {string} phoneNumber - Phone number to validate
   * @returns {boolean} Is valid Philippine number
   */
  isValidPhilippineNumber(phoneNumber) {
    if (!phoneNumber) return false;
    
    // Should be +639XXXXXXXXX format (13 characters total)
    const phoneRegex = /^\+639\d{9}$/;
    return phoneRegex.test(phoneNumber);
  }

  /**
   * Get the numeric booking ID (now directly from the booking object)
   * @param {Object} booking - Booking object with bookingId field
   * @returns {string} Numeric booking ID
   */
  getNumericBookingId(booking) {
    return booking.bookingId ? booking.bookingId.toString() : '000000';
  }

  /**
   * Send a single SMS message
   * @param {string} number - Phone number
   * @param {string} message - Message content
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} SMS response
   */
  async sendSMS(number, message, options = {}) {
    if (!this.isEnabled) {
      logger.warn('📱 SMS service is disabled');
      return { success: false, error: 'SMS service disabled' };
    }

    try {
      const normalizedNumber = this.normalizePhoneNumber(number);
      if (!normalizedNumber) {
        logger.error('❌ Invalid phone number provided:', number);
        return { success: false, error: 'Invalid phone number' };
      }

      logger.info(`📤 Sending SMS to ${normalizedNumber}: ${message.substring(0, 50)}...`);

      const payload = {
        key: this.apiKey,
        number: normalizedNumber,
        message: message,
        devices: `${this.defaultDevice}|${this.defaultSimSlot}`, // Use environment variables
        type: 'sms',
        prioritize: 1 // Always prioritize as integer
      };

      // Only add schedule if it's not null to avoid "null" string
      if (options.schedule) {
        payload.schedule = options.schedule;
      }
      
      const response = await axios.post(`${this.serverUrl}/services/send.php`, qs.stringify(payload), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000 // 30 second timeout
      });

      if (response.data.success) {
        logger.info('✅ SMS sent successfully:', {
          number: normalizedNumber,
          messageId: response.data.data?.messages?.[0]?.ID,
          status: response.data.data?.messages?.[0]?.status
        });
        return {
          success: true,
          data: response.data.data?.messages?.[0]
        };
      } else {
        logger.error('❌ SMS failed:', response.data.error);
        return {
          success: false,
          error: response.data.error
        };
      }
    } catch (error) {
      logger.error('❌ SMS failed:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Send multiple SMS messages
   * @param {Array} messages - Array of {number, message} objects
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} SMS response
   */
  async sendBulkSMS(messages, options = {}) {
    if (!this.isEnabled) {
      logger.warn('📱 SMS service is disabled');
      return { success: false, error: 'SMS service disabled' };
    }

    try {
      const normalizedMessages = messages.map(msg => ({
        number: this.normalizePhoneNumber(msg.number),
        message: msg.message,
        type: 'sms',
        attachments: null
      })).filter(msg => msg.number); // Filter out invalid numbers

      if (normalizedMessages.length === 0) {
        return { success: false, error: 'No valid phone numbers provided' };
      }

      logger.info(`📤 Sending bulk SMS to ${normalizedMessages.length} recipients`);

      const payload = {
        key: this.apiKey,
        messages: JSON.stringify(normalizedMessages),
        option: 0, // Use devices specified in devices parameter
        devices: JSON.stringify([{ id: this.defaultDevice, sim: this.defaultSimSlot }]),
        useRandomDevice: 0, // Convert boolean to int
        prioritize: (options.prioritize || true) ? 1 : 0 // Convert boolean to int
      };

      // Only add schedule if it's not null to avoid "null" string
      if (options.schedule) {
        payload.schedule = options.schedule;
      }

      const response = await axios.post(`${this.serverUrl}/services/send.php`, qs.stringify(payload), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 30000
      });

      if (response.data.success) {
        logger.info('✅ Bulk SMS sent successfully:', {
          count: normalizedMessages.length,
          messageIds: response.data.data?.messages?.map(m => m.ID)
        });
        return {
          success: true,
          data: response.data.data
        };
      } else {
        logger.error('❌ Bulk SMS failed:', response.data.error);
        return {
          success: false,
          error: response.data.error
        };
      }
    } catch (error) {
      logger.error('❌ Bulk SMS failed:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Get SMS message status by ID
   * @param {string|number} messageId - Message ID
   * @returns {Promise<Object>} Message status
   */
  async getMessageStatus(messageId) {
    if (!this.isEnabled) {
      return { success: false, error: 'SMS service disabled' };
    }

    try {
      const payload = {
        key: this.apiKey,
        id: parseInt(messageId)
      };

      const response = await axios.post(`${this.serverUrl}/services/read-messages.php`, qs.stringify(payload), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000
      });

      if (response.data.success) {
        return {
          success: true,
          data: response.data.data
        };
      } else {
        return {
          success: false,
          error: response.data.error
        };
      }
    } catch (error) {
      logger.error('❌ Failed to get message status:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  /**
   * Get account balance/credits
   * @returns {Promise<Object>} Balance information
   */
  async getBalance() {
    if (!this.isEnabled) {
      return { success: false, error: 'SMS service disabled' };
    }

    try {
      const payload = {
        key: this.apiKey
      };

      const response = await axios.post(`${this.serverUrl}/services/send.php`, qs.stringify(payload), {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        timeout: 15000
      });

      if (response.data.success) {
        return {
          success: true,
          credits: response.data.credits || 'Unknown'
        };
      } else {
        return {
          success: false,
          error: response.data.error
        };
      }
    } catch (error) {
      logger.error('❌ Failed to get balance:', error.response?.data || error.message);
      return {
        success: false,
        error: error.response?.data?.error || error.message
      };
    }
  }

  // === BOOKING-RELATED SMS NOTIFICATIONS ===

  /**
   * Send booking confirmation SMS to user
   * @param {string} phoneNumber - User's phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendBookingConfirmation(phoneNumber, booking, parkingSpace) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping booking confirmation');
      return { success: false, error: 'SMS service disabled' };
    }

    const startDate = new Date(booking.startTime);
    const endDate = new Date(booking.endTime);
    
    // Get booking amount from multiple possible sources
    const bookingAmount = booking.pricing?.totalAmount || booking.totalAmount || (booking.duration * parkingSpace?.pricing?.hourlyRate) || 0;
    
    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `🅿️ ParkTayo: Booking Confirmed!
Location: ${parkingSpace?.name || 'Parking Space'}
Date: ${startDate.toLocaleDateString('en-PH')}
Time: ${startDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})} - ${endDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Amount: ₱${bookingAmount.toFixed(2)}
Vehicle: ${vehicleDisplay}
Booking ID: ${numericBookingId}

Please arrive on time. Thank you for choosing ParkTayo!`;

    logger.info(`📱 Sending booking confirmation SMS to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send new booking notification to landlord
   * @param {string} phoneNumber - Landlord's phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @param {Object} user - User object
   * @returns {Promise<Object>} SMS result
   */
  async sendLandlordNewBooking(phoneNumber, booking, parkingSpace, user) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping landlord notification');
      return { success: false, error: 'SMS service disabled' };
    }

    const startDate = new Date(booking.startTime);
    const endDate = new Date(booking.endTime);
    
    // Get booking amount from multiple possible sources
    const bookingAmount = booking.pricing?.totalAmount || booking.totalAmount || (booking.duration * parkingSpace?.pricing?.hourlyRate) || 0;
    
    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `🔔 ParkTayo: New Booking Request
Location: ${parkingSpace?.name || 'Your Parking Space'}
Customer: ${user?.firstName || 'Customer'} ${user?.lastName || ''}
Date: ${startDate.toLocaleDateString('en-PH')}
Time: ${startDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})} - ${endDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Amount: ₱${bookingAmount.toFixed(2)}
Vehicle: ${vehicleDisplay}

${booking.autoAccepted ? 'Status: Auto-Accepted ✅' : 'Action Required: Please review and approve 📋'}
Booking ID: ${numericBookingId}`;

    logger.info(`📱 Sending landlord booking notification to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send auto-checkout notification to user
   * @param {string} phoneNumber - User's phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendAutoCheckoutNotification(phoneNumber, booking, parkingSpace) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping auto-checkout notification');
      return { success: false, error: 'SMS service disabled' };
    }

    const checkoutTime = new Date();
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `🚗 ParkTayo: Auto-Checkout Complete
Location: ${parkingSpace?.name || 'Parking Space'}
Checkout Time: ${checkoutTime.toLocaleDateString('en-PH')} ${checkoutTime.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Amount: ₱${(booking.pricing?.totalAmount || 0).toFixed(2)}

You have been automatically checked out as you left the parking area. 
Please rate your parking experience! ⭐

Booking ID: ${numericBookingId}`;

    logger.info(`📱 Sending auto-checkout notification to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send auto-checkout notification to landlord
   * @param {string} phoneNumber - Landlord's phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @param {Object} user - User object
   * @returns {Promise<Object>} SMS result
   */
  async sendLandlordAutoCheckoutNotification(phoneNumber, booking, parkingSpace, user) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping landlord auto-checkout notification');
      return { success: false, error: 'SMS service disabled' };
    }

    const checkoutTime = new Date();
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `🚗 ParkTayo: Customer Auto-Checkout
Location: ${parkingSpace?.name || 'Your Parking Space'}
Customer: ${user?.firstName || 'Customer'} ${user?.lastName || ''}
Checkout Time: ${checkoutTime.toLocaleDateString('en-PH')} ${checkoutTime.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Amount: ₱${(booking.pricing?.totalAmount || 0).toFixed(2)}

Customer has automatically checked out via geofencing.
Space is now available for new bookings. ✅

Booking ID: ${numericBookingId}`;

    logger.info(`📱 Sending landlord auto-checkout notification to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send booking status update SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} booking - Booking object
   * @param {string} status - New status
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendBookingStatusUpdate(phoneNumber, booking, status, parkingSpace) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping booking status update');
      return { success: false, error: 'SMS service disabled' };
    }

    const startDate = new Date(booking.startTime);
    const endDate = new Date(booking.endTime);
    
    // Get booking amount from multiple possible sources
    const bookingAmount = booking.pricing?.totalAmount || booking.totalAmount || (booking.duration * parkingSpace?.pricing?.hourlyRate) || 0;
    
    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    let message = `🅿️ ParkTayo: Booking Update
Location: ${parkingSpace?.name || 'Parking Space'}
Vehicle: ${vehicleDisplay}
Booking ID: ${numericBookingId}
`;

    switch (status.toLowerCase()) {
      case 'accepted':
      case 'confirmed':
        message += `✅ Your booking has been APPROVED!
Date: ${startDate.toLocaleDateString('en-PH')}
Time: ${startDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})} - ${endDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Amount: ₱${bookingAmount.toFixed(2)}
Please arrive on time. Safe travels!`;
        break;
      case 'rejected':
        message += `❌ Your booking has been DECLINED.
Payment hold has been released. No charges were made.
Thank you for using ParkTayo!`;
        break;
      case 'cancelled':
        message += `🚫 Your booking has been CANCELLED.
Refund will be processed if applicable.
Thank you for using ParkTayo!`;
        break;
      case 'active':
        message += `🚗 You have successfully checked in!
Your parking session is now active.
Enjoy your stay!`;
        break;
      case 'completed':
        message += `✅ Parking session completed!
Thank you for using ParkTayo!
Total Amount: ₱${bookingAmount.toFixed(2)}`;
        break;
      default:
        message += `Status: ${status}
Please check the app for more details.`;
    }

    logger.info(`📱 Sending booking status update SMS (${status}) to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send booking request pending SMS (for manual approval)
   * @param {string} phoneNumber - User's phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendBookingRequestPending(phoneNumber, booking, parkingSpace) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping booking pending notification');
      return { success: false, error: 'SMS service disabled' };
    }

    const startDate = new Date(booking.startTime);
    const endDate = new Date(booking.endTime);
    
    // Get booking amount from multiple possible sources
    const bookingAmount = booking.pricing?.totalAmount || booking.totalAmount || (booking.duration * parkingSpace?.pricing?.hourlyRate) || 0;
    
    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `📋 ParkTayo: Booking Request Submitted
Location: ${parkingSpace?.name || 'Parking Space'}
Date: ${startDate.toLocaleDateString('en-PH')}
Time: ${startDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})} - ${endDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Amount: ₱${bookingAmount.toFixed(2)}
Vehicle: ${vehicleDisplay}
Booking ID: ${numericBookingId}

Your request has been sent to the parking space owner. Please wait for confirmation.`;

    logger.info(`📱 Sending booking pending SMS to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send booking rejection SMS (for rejectBooking function)
   * @param {string} phoneNumber - User's phone number
   * @param {Object} booking - Booking object
   * @returns {Promise<Object>} SMS result
   */
  async sendBookingRejection(phoneNumber, booking) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping booking rejection');
      return { success: false, error: 'SMS service disabled' };
    }

    const startDate = new Date(booking.startTime);
    const bookingAmount = booking.pricing?.totalAmount || booking.totalAmount || 0;
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    
    const message = `❌ ParkTayo: Booking Request Declined
Location: ${booking.parkingSpace?.name || 'Parking Space'}
Date: ${startDate.toLocaleDateString('en-PH')}
Amount: ₱${bookingAmount.toFixed(2)} (Hold Released)
Vehicle: ${vehicleInfo.plateNumber || 'N/A'}
Booking ID: ${(booking._id || booking.id).toString().substring(0, 8)}

Your booking request was declined. Payment hold released - no charges made.`;

    logger.info(`📱 Sending booking rejection SMS to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send user arrival/approaching notification SMS to landlord
   * @param {string} phoneNumber - Landlord's phone number
   * @param {Object} booking - Booking object
   * @param {Object} user - User object
   * @param {string} status - 'approaching' or 'arrived'
   * @returns {Promise<Object>} SMS result
   */
  async sendUserLocationUpdate(phoneNumber, booking, user, status) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping location update');
      return { success: false, error: 'SMS service disabled' };
    }

    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer';
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    let message = '';
    if (status === 'arrived') {
      message = `🎉 ParkTayo: Customer Arrived!
Customer: ${userName}
Vehicle: ${vehicleDisplay}
Location: ${booking.parkingSpaceId?.name || 'Your Parking Space'}
Booking ID: ${numericBookingId}

The customer has arrived at your parking space.`;
    } else if (status === 'approaching') {
      message = `🚗 ParkTayo: Customer Approaching
Customer: ${userName}
Vehicle: ${vehicleDisplay}
Location: ${booking.parkingSpaceId?.name || 'Your Parking Space'}
Booking ID: ${numericBookingId}

The customer is approaching your parking space.`;
    } else {
      message = `📍 ParkTayo: Location Update
Customer: ${userName}
Vehicle: ${vehicleDisplay}
Status: ${status}
Booking ID: ${numericBookingId}`;
    }

    logger.info(`📱 Sending location update SMS (${status}) to landlord ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send checkout/payment completion SMS to landlord
   * @param {string} phoneNumber - Landlord's phone number
   * @param {Object} booking - Booking object
   * @param {Object} user - User object
   * @param {number} totalAmount - Final payment amount
   * @returns {Promise<Object>} SMS result
   */
  async sendCustomerCheckout(phoneNumber, booking, user, totalAmount) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping checkout notification');
      return { success: false, error: 'SMS service disabled' };
    }

    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    const userName = `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'Customer';
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `💰 ParkTayo: Customer Checked Out
Customer: ${userName}
Vehicle: ${vehicleDisplay}
Location: ${booking.parkingSpaceId?.name || 'Your Parking Space'}
Amount Paid: ₱${totalAmount.toFixed(2)}
Booking ID: ${numericBookingId}

The customer has completed their parking session and payment has been processed.`;

    logger.info(`📱 Sending checkout SMS to landlord ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send parking session started SMS to user
   * @param {string} phoneNumber - User's phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendParkingSessionStarted(phoneNumber, booking, parkingSpace) {
    if (!this.isEnabled) {
      logger.info('📱 SMS disabled - skipping session start notification');
      return { success: false, error: 'SMS service disabled' };
    }

    // Get vehicle info from multiple possible sources
    const vehicleInfo = booking.vehicleInfo || booking.vehicleDetails || {};
    const plateNumber = vehicleInfo.plateNumber || vehicleInfo.plate || 'N/A';
    const vehicleType = vehicleInfo.vehicleType || vehicleInfo.type || '';
    const vehicleDisplay = plateNumber !== 'N/A' ? `${plateNumber} (${vehicleType})` : 'N/A';
    
    const endDate = new Date(booking.endTime);
    
    // Get numeric booking ID
    const numericBookingId = this.getNumericBookingId(booking);
    
    const message = `🚗 ParkTayo: Parking Session Started
Location: ${parkingSpace?.name || 'Parking Space'}
Vehicle: ${vehicleDisplay}
Session End Time: ${endDate.toLocaleTimeString('en-PH', {hour: '2-digit', minute: '2-digit'})}
Booking ID: ${numericBookingId}

Your parking session is now active. Enjoy your stay!`;

    logger.info(`📱 Sending parking session start SMS to ${phoneNumber.substring(0, 8)}...`);
    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send payment confirmation SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} booking - Booking object
   * @param {Object} payment - Payment object
   * @returns {Promise<Object>} SMS result
   */
  async sendPaymentConfirmation(phoneNumber, booking, payment) {
    const message = `💳 ParkTayo: Payment Confirmed!
Amount: ₱${payment.amount?.toFixed(2) || booking.totalAmount?.toFixed(2) || '0.00'}
Method: ${payment.method || 'Wallet'}
Booking ID: ${booking._id || booking.id}
Transaction ID: ${payment._id || payment.id}

Thank you for your payment!`;

    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send payment reminder SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendPaymentReminder(phoneNumber, booking, parkingSpace) {
    const message = `💰 ParkTayo: Payment Reminder
Location: ${parkingSpace?.name || 'Parking Space'}
Amount Due: ₱${booking.totalAmount?.toFixed(2) || '0.00'}
Booking ID: ${booking._id || booking.id}

Please complete your payment in the app to avoid late fees.
Thank you!`;

    return await this.sendSMS(phoneNumber, message, { prioritize: false });
  }

  /**
   * Send arrival reminder SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendArrivalReminder(phoneNumber, booking, parkingSpace) {
    const message = `⏰ ParkTayo: Arrival Reminder
Your booking starts in 15 minutes!
Location: ${parkingSpace?.name || 'Parking Space'}
Address: ${parkingSpace?.address || 'See app for directions'}
Time: ${new Date(booking.startTime).toLocaleTimeString()}

Please arrive on time. Safe travels!`;

    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send check-in reminder SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} booking - Booking object
   * @returns {Promise<Object>} SMS result
   */
  async sendCheckInReminder(phoneNumber, booking) {
    const message = `📍 ParkTayo: Check-in Available
You can now check in to your parking space!
Booking ID: ${booking._id || booking.id}

Open the app and tap "Check In" when you arrive.`;

    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send extension offer SMS
   * @param {string} phoneNumber - Phone number
   * @param {Object} booking - Booking object
   * @param {number} additionalHours - Additional hours offered
   * @param {number} additionalCost - Additional cost
   * @returns {Promise<Object>} SMS result
   */
  async sendExtensionOffer(phoneNumber, booking, additionalHours, additionalCost) {
    const message = `⏰ ParkTayo: Extend Your Parking
Your session ends in 30 minutes.
Extend for ${additionalHours} hour(s) for ₱${additionalCost.toFixed(2)}?

Open the app to extend your booking.
Booking ID: ${booking._id || booking.id}`;

    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send smart booking cancellation notification to user
   * @param {string} phoneNumber - User phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendSmartBookingCancellationNotification(phoneNumber, booking, parkingSpace) {
    const etaMinutes = booking.arrivalPrediction?.realETAMinutes || 30;
    const graceMinutes = booking.arrivalPrediction?.gracePeriodMinutes || 15;
    const totalWindow = etaMinutes + graceMinutes;

    const message = `🚫 ParkTayo: Smart Booking Cancelled
Your booking was automatically cancelled due to no-show.

Location: ${parkingSpace?.name || 'Parking Space'}
Window: ${totalWindow} minutes (ETA ${etaMinutes} + Grace ${graceMinutes})

This counts as a violation. Repeated no-shows may result in booking restrictions.

Book responsibly to avoid penalties.`;

    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }

  /**
   * Send smart booking cancellation notification to landlord
   * @param {string} phoneNumber - Landlord phone number
   * @param {Object} booking - Booking object
   * @param {Object} parkingSpace - Parking space object
   * @param {Object} user - User object
   * @returns {Promise<Object>} SMS result
   */
  async sendLandlordSmartBookingCancellationNotification(phoneNumber, booking, parkingSpace, user) {
    const message = `🚫 ParkTayo: Smart Booking Cancelled
A smart booking for your space was auto-cancelled.

Space: ${parkingSpace?.name || 'Your Parking Space'}
User: ${user?.firstName || 'User'} ${user?.lastName || ''}
Reason: User did not approach within ETA + grace period

Your space is now available for other bookings.`;

    return await this.sendSMS(phoneNumber, message, { prioritize: false });
  }

  /**
   * Send enhanced smart booking confirmation with ETA
   * @param {string} phoneNumber - User phone number
   * @param {Object} booking - Booking object with enhanced ETA data
   * @param {Object} parkingSpace - Parking space object
   * @returns {Promise<Object>} SMS result
   */
  async sendEnhancedSmartBookingConfirmation(phoneNumber, booking, parkingSpace) {
    const eta = booking.arrivalPrediction?.realETAMinutes || 30;
    const grace = booking.arrivalPrediction?.gracePeriodMinutes || 15;
    const deadline = new Date(booking.arrivalPrediction?.maxArrivalWindow || Date.now() + (eta + grace) * 60000);

    const message = `🎯 ParkTayo: Smart Booking Confirmed!
Location: ${parkingSpace?.name || 'Parking Space'}

⏰ Travel Time: ${eta} minutes
📍 Grace Period: ${grace} minutes
🚨 Arrive by: ${deadline.toLocaleTimeString()}

Navigation will start automatically. Your booking will be cancelled if you don't approach by the deadline.

Drive safely!`;

    return await this.sendSMS(phoneNumber, message, { prioritize: true });
  }
}

module.exports = new SMSService();
