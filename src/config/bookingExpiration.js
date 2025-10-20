/**
 * Booking Expiration Configuration
 * Defines rules and time windows for different booking expiration scenarios
 */

const EXPIRATION_WINDOWS = {
  // Standard checkout window - no extra charges
  STANDARD: {
    hours: 4,
    description: 'Standard checkout grace period',
    action: 'allow',
    extraCharges: false
  },
  
  // Extended window - with overtime charges
  EXTENDED: {
    hours: 24,
    description: 'Extended checkout with overtime charges',
    action: 'allow_with_overtime',
    extraCharges: true,
    overtimeRate: 17 // ₱17 per hour (₱15 base + ₱2 service fee)
  },
  
  // Long-term window - requires confirmation
  LONG_TERM: {
    days: 7,
    description: 'Long-term expiration requiring confirmation',
    action: 'require_confirmation',
    extraCharges: true,
    penaltyRate: 25, // ₱25 per day penalty
    maxPenalty: 500 // Maximum ₱500 penalty
  },
  
  // Critical expiration - manual resolution required
  CRITICAL: {
    description: 'Critical expiration requiring manual resolution',
    action: 'manual_resolution',
    extraCharges: true
  }
};

const BOOKING_STATUS_RULES = {
  'parked': {
    // User has checked in but not checked out
    allowQR: true,
    windows: ['STANDARD', 'EXTENDED', 'LONG_TERM', 'CRITICAL'],
    description: 'User is currently parked'
  },
  
  'accepted': {
    // Landlord accepted but user never showed up
    allowQR: false,
    autoExpireAfter: 24, // hours
    description: 'Booking accepted but user never arrived'
  },
  
  'pending': {
    // Booking waiting for landlord response
    allowQR: false,
    autoExpireAfter: 2, // hours after start time
    description: 'Booking pending landlord response'
  },
  
  'completed': {
    // Already completed
    allowQR: false,
    description: 'Booking already completed'
  },
  
  'expired': {
    // Already marked as expired
    allowQR: false,
    description: 'Booking has been marked as expired'
  },
  
  'cancelled': {
    // Cancelled booking
    allowQR: false,
    description: 'Booking has been cancelled'
  }
};

const RESOLUTION_OPTIONS = {
  GENERATE_WITH_OVERTIME: {
    id: 'generate_overtime',
    title: 'Generate QR with Overtime Charges',
    description: 'Allow checkout with calculated overtime and penalty fees',
    icon: 'qr_code',
    action: 'generate_qr',
    requiresConfirmation: true
  },
  
  MANUAL_CHECKOUT: {
    id: 'manual_checkout',
    title: 'Manual Checkout',
    description: 'Process checkout manually without QR code',
    icon: 'check_circle',
    action: 'manual_checkout',
    requiresConfirmation: true
  },
  
  MARK_ABANDONED: {
    id: 'mark_abandoned',
    title: 'Mark as Abandoned',
    description: 'Mark the booking as abandoned and apply penalty',
    icon: 'report_problem',
    action: 'mark_abandoned',
    requiresConfirmation: true
  },
  
  CONTACT_SUPPORT: {
    id: 'contact_support',
    title: 'Contact Customer Support',
    description: 'Escalate to customer support for manual resolution',
    icon: 'support_agent',
    action: 'escalate',
    requiresConfirmation: false
  },
  
  ADMIN_OVERRIDE: {
    id: 'admin_override',
    title: 'Admin Override',
    description: 'Administrative override for special cases',
    icon: 'admin_panel_settings',
    action: 'admin_override',
    requiresConfirmation: true,
    adminOnly: true
  }
};

/**
 * Calculate expiration status for a booking
 * @param {Object} booking - The booking object
 * @returns {Object} Expiration analysis result
 */
function calculateExpirationStatus(booking) {
  const now = new Date();
  let bookingEnd = new Date(booking.endTime);
  
  // For smart bookings (book_now mode), use the maxArrivalWindow if available
  // This accounts for the ETA + 15-minute grace period system
  if (booking.bookingMode === 'book_now' && booking.arrivalPrediction?.maxArrivalWindow) {
    bookingEnd = new Date(booking.arrivalPrediction.maxArrivalWindow);
    console.log(`🎯 Smart booking detected - using maxArrivalWindow: ${bookingEnd.toISOString()}`);
  }
  
  const timeSinceEnd = now.getTime() - bookingEnd.getTime();
  const hoursSinceEnd = timeSinceEnd / (1000 * 60 * 60);
  const daysSinceEnd = timeSinceEnd / (1000 * 60 * 60 * 24);

  // Check booking status rules
  const statusRule = BOOKING_STATUS_RULES[booking.status];
  if (!statusRule || !statusRule.allowQR) {
    return {
      status: 'not_eligible',
      window: null,
      action: 'blocked',
      reason: statusRule?.description || 'Booking status does not allow QR generation',
      canGenerate: false,
      resolutionOptions: []
    };
  }

  // Determine expiration window
  let currentWindow = null;
  let windowType = null;

  if (hoursSinceEnd <= EXPIRATION_WINDOWS.STANDARD.hours) {
    currentWindow = EXPIRATION_WINDOWS.STANDARD;
    windowType = 'STANDARD';
  } else if (hoursSinceEnd <= EXPIRATION_WINDOWS.EXTENDED.hours) {
    currentWindow = EXPIRATION_WINDOWS.EXTENDED;
    windowType = 'EXTENDED';
  } else if (daysSinceEnd <= EXPIRATION_WINDOWS.LONG_TERM.days) {
    currentWindow = EXPIRATION_WINDOWS.LONG_TERM;
    windowType = 'LONG_TERM';
  } else {
    currentWindow = EXPIRATION_WINDOWS.CRITICAL;
    windowType = 'CRITICAL';
  }

  // Calculate charges
  const charges = calculateExpirationCharges(booking, hoursSinceEnd, daysSinceEnd, windowType);

  // Determine available resolution options
  const resolutionOptions = getResolutionOptions(windowType, booking);

  return {
    status: windowType.toLowerCase(),
    window: currentWindow,
    windowType,
    action: currentWindow.action,
    hoursSinceEnd: Math.round(hoursSinceEnd * 100) / 100,
    daysSinceEnd: Math.round(daysSinceEnd * 100) / 100,
    canGenerate: currentWindow.action === 'allow',
    requiresConfirmation: currentWindow.action !== 'allow',
    charges,
    resolutionOptions,
    message: generateExpirationMessage(windowType, hoursSinceEnd, daysSinceEnd, booking)
  };
}

/**
 * Calculate expiration charges
 * @param {Object} booking - The booking object
 * @param {number} hoursSinceEnd - Hours since booking end time
 * @param {number} daysSinceEnd - Days since booking end time
 * @param {string} windowType - Current expiration window type
 * @returns {Object} Charge calculation
 */
function calculateExpirationCharges(booking, hoursSinceEnd, daysSinceEnd, windowType) {
  let overtimeAmount = 0;
  let penaltyAmount = 0;
  let totalExtraCharges = 0;
  let breakdown = [];

  const originalAmount = booking.pricing?.totalAmount || 0;
  
  // For smart bookings, provide context about the dynamic nature
  const isSmartBooking = booking.bookingMode === 'book_now';
  if (isSmartBooking) {
    console.log(`💡 Smart booking charge calculation - ETA was ${booking.arrivalPrediction?.realETAMinutes || 'unknown'} minutes + 15min grace`);
  }

  switch (windowType) {
    case 'STANDARD':
      // No extra charges
      break;

    case 'EXTENDED':
      // Calculate overtime charges
      const overtimeHours = Math.ceil(hoursSinceEnd - EXPIRATION_WINDOWS.STANDARD.hours);
      overtimeAmount = overtimeHours * EXPIRATION_WINDOWS.EXTENDED.overtimeRate;
      breakdown.push({
        type: 'overtime',
        description: `Overtime: ${overtimeHours}h × ₱${EXPIRATION_WINDOWS.EXTENDED.overtimeRate}`,
        amount: overtimeAmount
      });
      break;

    case 'LONG_TERM':
      // Calculate both overtime and penalty
      const totalOvertimeHours = Math.ceil(hoursSinceEnd);
      overtimeAmount = totalOvertimeHours * EXPIRATION_WINDOWS.EXTENDED.overtimeRate;
      
      const penaltyDays = Math.ceil(daysSinceEnd - 1); // First day is covered by overtime
      penaltyAmount = Math.min(
        penaltyDays * EXPIRATION_WINDOWS.LONG_TERM.penaltyRate,
        EXPIRATION_WINDOWS.LONG_TERM.maxPenalty
      );

      breakdown.push({
        type: 'overtime',
        description: `Extended overtime: ${totalOvertimeHours}h × ₱${EXPIRATION_WINDOWS.EXTENDED.overtimeRate}`,
        amount: overtimeAmount
      });

      breakdown.push({
        type: 'penalty',
        description: `Long-term penalty: ${penaltyDays} days × ₱${EXPIRATION_WINDOWS.LONG_TERM.penaltyRate}`,
        amount: penaltyAmount
      });
      break;

    case 'CRITICAL':
      // Maximum penalties - requires manual calculation
      overtimeAmount = 24 * EXPIRATION_WINDOWS.EXTENDED.overtimeRate; // Cap at 24 hours
      penaltyAmount = EXPIRATION_WINDOWS.LONG_TERM.maxPenalty;
      
      breakdown.push({
        type: 'overtime',
        description: `Maximum overtime charge (24h cap)`,
        amount: overtimeAmount
      });

      breakdown.push({
        type: 'penalty',
        description: `Maximum penalty charge`,
        amount: penaltyAmount
      });

      breakdown.push({
        type: 'notice',
        description: 'Additional charges may apply - requires manual review',
        amount: 0
      });
      break;
  }

  totalExtraCharges = overtimeAmount + penaltyAmount;

  return {
    originalAmount,
    overtimeAmount,
    penaltyAmount,
    totalExtraCharges,
    finalAmount: originalAmount + totalExtraCharges,
    breakdown
  };
}

/**
 * Get available resolution options for a window type
 * @param {string} windowType - The expiration window type
 * @param {Object} booking - The booking object
 * @returns {Array} Available resolution options
 */
function getResolutionOptions(windowType, booking) {
  const options = [];

  switch (windowType) {
    case 'STANDARD':
      // Standard window - just generate QR
      return [];

    case 'EXTENDED':
      options.push(RESOLUTION_OPTIONS.GENERATE_WITH_OVERTIME);
      options.push(RESOLUTION_OPTIONS.MANUAL_CHECKOUT);
      options.push(RESOLUTION_OPTIONS.CONTACT_SUPPORT);
      break;

    case 'LONG_TERM':
      options.push(RESOLUTION_OPTIONS.GENERATE_WITH_OVERTIME);
      options.push(RESOLUTION_OPTIONS.MANUAL_CHECKOUT);
      options.push(RESOLUTION_OPTIONS.MARK_ABANDONED);
      options.push(RESOLUTION_OPTIONS.CONTACT_SUPPORT);
      break;

    case 'CRITICAL':
      options.push(RESOLUTION_OPTIONS.MANUAL_CHECKOUT);
      options.push(RESOLUTION_OPTIONS.MARK_ABANDONED);
      options.push(RESOLUTION_OPTIONS.CONTACT_SUPPORT);
      options.push(RESOLUTION_OPTIONS.ADMIN_OVERRIDE);
      break;
  }

  return options;
}

/**
 * Generate user-friendly expiration message
 * @param {string} windowType - The expiration window type
 * @param {number} hoursSinceEnd - Hours since end time
 * @param {number} daysSinceEnd - Days since end time
 * @param {Object} booking - The booking object for context
 * @returns {string} User-friendly message
 */
function generateExpirationMessage(windowType, hoursSinceEnd, daysSinceEnd, booking = null) {
  const hours = Math.round(hoursSinceEnd);
  const days = Math.round(daysSinceEnd);
  
  // Add context for smart bookings
  const isSmartBooking = booking?.bookingMode === 'book_now';
  const etaContext = isSmartBooking ? 
    ` (Smart booking: ETA ${booking.arrivalPrediction?.realETAMinutes || '?'}min + 15min grace period)` : '';

  switch (windowType) {
    case 'STANDARD':
      return `Booking is within the standard checkout window (${hours}h past end time)${etaContext}.`;

    case 'EXTENDED':
      return `Booking expired ${hours} hours ago${etaContext}. Overtime charges will apply.`;

    case 'LONG_TERM':
      return `Booking expired ${days} days ago${etaContext}. Overtime and penalty charges will apply.`;

    case 'CRITICAL':
      return `Booking expired ${days} days ago${etaContext}. Manual resolution required due to extended delay.`;

    default:
      return 'Booking expiration status could not be determined.';
  }
}

module.exports = {
  EXPIRATION_WINDOWS,
  BOOKING_STATUS_RULES,
  RESOLUTION_OPTIONS,
  calculateExpirationStatus,
  calculateExpirationCharges,
  getResolutionOptions,
  generateExpirationMessage
};
