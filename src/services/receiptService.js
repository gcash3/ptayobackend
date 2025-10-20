const fs = require('fs');
const path = require('path');
const Handlebars = require('handlebars');
const logger = require('../config/logger');
const emailService = require('./emailService');
const Booking = require('../models/Booking');

class ReceiptService {
  constructor() {
    this.templatePath = path.join(__dirname, '../templates/receiptTemplate.html');
    this.compiledTemplate = null;
    this.initializeTemplate();
  }

  /**
   * Initialize Handlebars template
   */
  initializeTemplate() {
    try {
      const templateContent = fs.readFileSync(this.templatePath, 'utf8');
      this.compiledTemplate = Handlebars.compile(templateContent);

      // Register Handlebars helpers
      this.registerHelpers();

      logger.info('📄 Receipt template initialized successfully');
    } catch (error) {
      logger.error('❌ Failed to initialize receipt template:', error);
    }
  }

  /**
   * Register Handlebars helpers
   */
  registerHelpers() {
    // Helper for conditional logic
    Handlebars.registerHelper('if', function(condition, options) {
      if (condition) {
        return options.fn(this);
      } else {
        return options.inverse(this);
      }
    });

    // Helper for each loop
    Handlebars.registerHelper('each', function(context, options) {
      let ret = '';
      if (context && context.length > 0) {
        for (let i = 0; i < context.length; i++) {
          ret += options.fn(context[i]);
        }
      }
      return ret;
    });

    // Helper for formatting currency
    Handlebars.registerHelper('currency', function(amount) {
      return '₱' + parseFloat(amount).toFixed(2);
    });

    // Helper for formatting dates
    Handlebars.registerHelper('formatDate', function(date) {
      return new Date(date).toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    });
  }

  /**
   * Generate receipt data from booking
   */
  generateReceiptData(booking) {
    const receiptNumber = `PR${booking._id.toString().slice(-8).toUpperCase()}`;
    const currentDate = new Date();

    // Customer information
    const customerName = `${booking.userId?.firstName || ''} ${booking.userId?.lastName || ''}`.trim() || 'N/A';
    const customerEmail = booking.userId?.email || 'N/A';

    // Parking space information
    const parkingSpaceName = booking.parkingSpaceId?.name || booking.parkingSpace?.name || 'N/A';
    const parkingSpaceAddress = booking.parkingSpaceId?.address || booking.parkingSpace?.address || 'N/A';

    // Vehicle information - Fix undefined model issue
    const vehicleInfo = booking.vehicleInfo
      ? `${booking.vehicleInfo.plateNumber}${booking.vehicleInfo.vehicleModel ? ` (${booking.vehicleInfo.vehicleModel})` : ''}`
      : (booking.vehicleInfo?.plateNumber || 'N/A');
    const vehicleType = booking.vehicleInfo?.vehicleType || booking.dynamicPricing?.vehicleType || 'car';

    // Time information
    const startTime = new Date(booking.startTime).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    const endTime = new Date(booking.endTime).toLocaleDateString('en-PH', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Calculate actual duration if checked out
    let actualDuration = booking.duration;
    let actualTimeLabel = 'Planned Duration';

    if (booking.checkout?.time) {
      const actualHours = (new Date(booking.checkout.time) - new Date(booking.checkin?.time || booking.startTime)) / (1000 * 60 * 60);
      actualDuration = Math.max(actualHours, 0).toFixed(1);
      actualTimeLabel = 'Actual Duration';
    }

    // Pricing information
    const baseRate = booking.pricing?.hourlyRate || booking.pricing?.baseRate || 0;
    const totalAmount = booking.pricing?.totalAmount || 0;

    // New dynamic pricing structure with proper fallbacks
    let baseAmount, dynamicAdjustments, serviceFee, landlordEarnings, platformEarnings;

    // Extract pricing from tiered model (baseParkingFee, dynamicParkingFee, serviceFee)
    const baseParkingFee = booking.pricing?.baseParkingFee || 0;
    const dynamicParkingFee = booking.pricing?.dynamicParkingFee || baseParkingFee;
    const pricingServiceFee = booking.pricing?.serviceFee || 0;

    if (booking.dynamicPricing) {
      // Use new dynamic pricing structure
      baseAmount = booking.dynamicPricing.customerBreakdown?.baseAmount ||
                   baseParkingFee ||
                   booking.pricing?.baseAmount ||
                   (booking.duration * baseRate);

      dynamicAdjustments = booking.dynamicPricing.customerBreakdown?.dynamicAdjustments ||
                          (dynamicParkingFee - baseParkingFee) ||
                          booking.pricing?.dynamicAdjustments || 0;

      serviceFee = booking.dynamicPricing.customerBreakdown?.serviceFee ||
                   pricingServiceFee ||
                   booking.pricing?.serviceFee || 0;

      // Landlord earnings: base rate + overtime only (no service fee or dynamic pricing)
      landlordEarnings = booking.dynamicPricing.landlordBreakdown?.total ||
                        booking.pricing?.landlordEarnings ||
                        baseParkingFee;

      // Platform fees: service fee + commission + dynamic pricing adjustments
      platformEarnings = booking.dynamicPricing.platformBreakdown?.total ||
                        booking.pricing?.platformEarnings ||
                        (serviceFee + dynamicAdjustments);
    } else {
      // Fallback to tiered pricing structure
      baseAmount = baseParkingFee || (booking.duration * baseRate);
      dynamicAdjustments = dynamicParkingFee - baseParkingFee;
      serviceFee = pricingServiceFee || 5;

      // Landlord gets base parking fee only
      landlordEarnings = booking.pricing?.landlordEarnings || baseParkingFee;

      // Platform gets service fee + dynamic adjustments
      platformEarnings = booking.pricing?.platformEarnings || (serviceFee + Math.max(0, dynamicAdjustments));
    }

    // Calculate overtime if applicable
    let overtimeCharges = 0;
    let overtimeHours = 0;
    let overtimeRate = 15; // Default fallback overtime rate

    if (actualDuration > booking.duration) {
      overtimeHours = (actualDuration - booking.duration).toFixed(1);

      // Use proper overtime rate hierarchy:
      // 1. From parking space (auto-calculated: basePricePer3Hours / 3)
      // 2. From dynamic pricing service
      // 3. From checkout calculation
      // 4. Default fallback
      overtimeRate = booking.parkingSpaceId?.overtimeRatePerHour ||
                    booking.dynamicPricing?.baseOvertimeRate ||
                    booking.checkout?.overtimeRate ||
                    (booking.parkingSpaceId?.pricePer3Hours ? booking.parkingSpaceId.pricePer3Hours / 3 : 15);

      overtimeCharges = overtimeHours * overtimeRate;
    }

    // Applied factors
    const appliedFactors = booking.dynamicPricing?.appliedFactors || booking.pricing?.appliedFactors || [];
    const formattedFactors = appliedFactors.map(factor => ({
      description: factor.description,
      multiplierDisplay: factor.multiplier > 1
        ? `+${((factor.multiplier - 1) * 100).toFixed(0)}%`
        : `${((factor.multiplier - 1) * 100).toFixed(0)}%`
    }));

    // Payment information
    const paymentMethod = booking.pricing?.paymentMethod || 'wallet';
    const paymentStatus = booking.pricing?.paymentStatus || 'pending';
    const transactionDate = booking.pricing?.paidAt
      ? new Date(booking.pricing.paidAt).toLocaleDateString('en-PH', {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      : 'N/A';

    const transactionId = booking.pricing?.walletHoldReference || booking._id.toString().slice(-12).toUpperCase();

    // Status formatting
    const statusClass = booking.status === 'completed' ? 'completed' :
                       booking.status === 'cancelled' ? 'cancelled' : 'completed';

    return {
      // Receipt metadata
      receiptNumber,
      receiptDate: currentDate.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      generatedDate: currentDate.toLocaleDateString('en-PH', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }),

      // Booking information
      bookingId: booking._id.toString(),
      status: booking.status.toUpperCase(),
      statusClass,
      customerName,
      customerEmail,

      // Parking information
      parkingSpaceName,
      parkingSpaceAddress,
      vehicleInfo,
      vehicleType: vehicleType.charAt(0).toUpperCase() + vehicleType.slice(1),

      // Time information
      startTime,
      endTime,
      duration: booking.duration,
      actualDuration,
      actualTimeLabel,

      // Pricing breakdown
      baseRate: baseRate.toFixed(2),
      baseAmount: baseAmount.toFixed(2),
      dynamicAdjustments: Math.abs(dynamicAdjustments).toFixed(2),
      dynamicAdjustmentsAbs: Math.abs(dynamicAdjustments).toFixed(2),
      dynamicAdjustmentSign: dynamicAdjustments >= 0 ? '+' : '-',
      dynamicAdjustmentClass: dynamicAdjustments >= 0 ? 'text-green-600' : 'text-red-600',
      serviceFee: serviceFee.toFixed(2),
      totalAmount: totalAmount.toFixed(2),
      landlordEarnings: landlordEarnings.toFixed(2),
      platformEarnings: platformEarnings.toFixed(2),

      // Overtime information
      overtimeCharges: overtimeCharges > 0 ? overtimeCharges.toFixed(2) : null,
      overtimeHours: overtimeHours > 0 ? overtimeHours : null,
      overtimeRate: overtimeRate.toFixed(2),

      // Dynamic factors
      appliedFactors: formattedFactors.length > 0 ? formattedFactors : null,

      // Payment information
      paymentMethod: paymentMethod.charAt(0).toUpperCase() + paymentMethod.slice(1),
      paymentStatus: paymentStatus.charAt(0).toUpperCase() + paymentStatus.slice(1),
      transactionDate,
      transactionId,

      // QR Code (if available)
      qrCode: booking.qrCode?.code || null
    };
  }

  /**
   * Generate HTML receipt
   */
  generateReceiptHTML(booking) {
    try {
      if (!this.compiledTemplate) {
        throw new Error('Receipt template not initialized');
      }

      const receiptData = this.generateReceiptData(booking);
      const html = this.compiledTemplate(receiptData);

      logger.info(`📄 Receipt HTML generated for booking ${booking._id}`);
      return { success: true, html, receiptData };

    } catch (error) {
      logger.error('❌ Failed to generate receipt HTML:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send receipt via email
   */
  async sendReceiptEmail(booking, recipientEmail = null) {
    try {
      const email = recipientEmail || booking.userId?.email;

      if (!email) {
        throw new Error('No email address available for receipt delivery');
      }

      // Generate receipt HTML
      const receiptResult = this.generateReceiptHTML(booking);
      if (!receiptResult.success) {
        throw new Error(`Receipt generation failed: ${receiptResult.error}`);
      }

      // Prepare email content
      const subject = `ParkTayo Parking Receipt - ${receiptResult.receiptData.receiptNumber}`;
      const customerName = receiptResult.receiptData.customerName;

      // Send email
      const emailResult = await emailService.sendReceiptEmail({
        to: email,
        subject,
        customerName,
        receiptHTML: receiptResult.html,
        receiptData: receiptResult.receiptData
      });

      if (emailResult.success) {
        logger.info(`📧 Receipt emailed successfully to ${email} for booking ${booking._id}`);

        // Update booking with receipt sent flag
        await Booking.findByIdAndUpdate(booking._id, {
          $set: {
            'receiptSent': true,
            'receiptSentAt': new Date(),
            'receiptSentTo': email
          }
        });

        return {
          success: true,
          message: 'Receipt sent successfully',
          receiptNumber: receiptResult.receiptData.receiptNumber
        };
      } else {
        throw new Error(emailResult.error);
      }

    } catch (error) {
      logger.error(`❌ Failed to send receipt email for booking ${booking._id}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send receipt for completed booking
   */
  async sendCompletionReceipt(bookingId) {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('userId', 'firstName lastName email')
        .populate('parkingSpaceId', 'name address')
        .populate('landlordId', 'firstName lastName');

      if (!booking) {
        throw new Error('Booking not found');
      }

      if (booking.status !== 'completed') {
        throw new Error('Can only send receipts for completed bookings');
      }

      const result = await this.sendReceiptEmail(booking);
      return result;

    } catch (error) {
      logger.error(`❌ Failed to send completion receipt for booking ${bookingId}:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Bulk send receipts for multiple bookings
   */
  async bulkSendReceipts(bookingIds) {
    const results = [];

    for (const bookingId of bookingIds) {
      try {
        const result = await this.sendCompletionReceipt(bookingId);
        results.push({ bookingId, ...result });
      } catch (error) {
        results.push({
          bookingId,
          success: false,
          error: error.message
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    logger.info(`📊 Bulk receipt sending completed: ${successCount}/${results.length} successful`);

    return {
      success: true,
      results,
      summary: {
        total: results.length,
        successful: successCount,
        failed: results.length - successCount
      }
    };
  }

  /**
   * Preview receipt (for testing)
   */
  async previewReceipt(bookingId) {
    try {
      const booking = await Booking.findById(bookingId)
        .populate('userId', 'firstName lastName email')
        .populate('parkingSpaceId', 'name address')
        .populate('landlordId', 'firstName lastName');

      if (!booking) {
        throw new Error('Booking not found');
      }

      const receiptResult = this.generateReceiptHTML(booking);
      if (!receiptResult.success) {
        throw new Error(`Receipt generation failed: ${receiptResult.error}`);
      }

      return {
        success: true,
        html: receiptResult.html,
        receiptData: receiptResult.receiptData
      };

    } catch (error) {
      logger.error(`❌ Failed to preview receipt for booking ${bookingId}:`, error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new ReceiptService();