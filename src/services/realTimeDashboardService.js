const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { BaseUser, Client, Landlord } = require('../models/UserModels');
const logger = require('../config/logger');
const systemHealthService = require('./systemHealthService');

class RealTimeDashboardService {
  constructor() {
    this.clients = new Set(); // Store connected admin clients
    this.metrics = {
      totalUsers: 0,
      totalLandlords: 0,
      totalParkingSpaces: 0,
      totalBookings: 0,
      pendingApprovals: 0,
      totalRevenue: 0,
      activeBookings: 0,
      recentActivity: [],
      performanceMetrics: {},
      lastUpdated: null
    };

    this.realtimeData = {
      bookingUpdates: [],
      approvalUpdates: [],
      userActivity: [],
      systemAlerts: []
    };

    // Add performance tracking
    this.isCollectingMetrics = false;
    this.isCheckingUpdates = false;
    this.lastMetricsUpdate = null;

    // Start background processes
    this.startMetricsCollection();
    this.startRealtimeUpdates();
  }

  // Register admin client for real-time updates
  addClient(socket) {
    // Check if client is already registered to avoid duplicate listeners
    if (this.clients.has(socket)) {
      logger.debug(`Admin client already registered: ${socket.id}`);
      return;
    }

    this.clients.add(socket);
    logger.info(`Admin client connected: ${socket.id}. Total clients: ${this.clients.size}`);

    // Send initial data to new client
    socket.emit('dashboard_initial_data', {
      metrics: this.metrics,
      realtimeData: this.realtimeData,
      timestamp: new Date()
    });

    // Create a single disconnect handler to avoid memory leaks
    const disconnectHandler = () => {
      this.clients.delete(socket);
      logger.info(`Admin client disconnected: ${socket.id}. Total clients: ${this.clients.size}`);

      // Remove the listener to prevent memory leaks
      socket.removeListener('disconnect', disconnectHandler);
    };

    // Handle client disconnect with single listener
    socket.once('disconnect', disconnectHandler);
  }

  // Broadcast data to all connected admin clients
  broadcast(event, data) {
    if (this.clients.size === 0) return;

    const payload = {
      ...data,
      timestamp: new Date()
    };

    this.clients.forEach(client => {
      try {
        client.emit(event, payload);
      } catch (error) {
        logger.error('Error broadcasting to client:', error);
        this.clients.delete(client);
      }
    });
  }

  // Start collecting metrics every 60 seconds (reduced frequency)
  startMetricsCollection() {
    const updateMetrics = async () => {
      // Skip if already collecting metrics or if no clients connected
      if (this.isCollectingMetrics || this.clients.size === 0) {
        return;
      }

      // Skip if last update was less than 30 seconds ago (additional throttling)
      if (this.lastMetricsUpdate && (Date.now() - this.lastMetricsUpdate) < 30000) {
        return;
      }

      this.isCollectingMetrics = true;
      try {
        await this.collectDashboardMetrics();
        this.lastMetricsUpdate = Date.now();
        this.broadcast('metrics_update', { metrics: this.metrics });
      } catch (error) {
        logger.error('Error collecting metrics:', error);
      } finally {
        this.isCollectingMetrics = false;
      }
    };

    // Initial collection
    updateMetrics();

    // Schedule periodic updates - reduced to every 60 seconds
    setInterval(updateMetrics, 60000);
  }

  // Start real-time updates monitoring
  startRealtimeUpdates() {
    // Monitor for new bookings, approvals, etc. every 15 seconds (reduced frequency)
    setInterval(async () => {
      // Skip if already checking updates or if no clients connected
      if (this.isCheckingUpdates || this.clients.size === 0) {
        return;
      }

      this.isCheckingUpdates = true;
      try {
        await this.checkForUpdates();
      } catch (error) {
        logger.error('Error checking for updates:', error);
      } finally {
        this.isCheckingUpdates = false;
      }
    }, 15000); // Reduced to every 15 seconds
  }

  async collectDashboardMetrics() {
    try {
      // Get date range for today
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date();
      todayEnd.setHours(23, 59, 59, 999);

      // Collect basic statistics with timeouts and better queries
      const [
        totalUsers,
        totalLandlords,
        todaysNewRegistrations,
        totalParkingSpaces,
        totalBookings,
        todaysBookings,
        pendingParkingSpaceApprovals,
        pendingLandlordApplications,
        activeBookings,
        recentTransactions,
        systemHealth
      ] = await Promise.all([
        User.countDocuments({ role: { $in: ['user', 'client'] } }).maxTimeMS(5000),
        User.countDocuments({ role: 'landlord' }).maxTimeMS(5000),
        User.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }).maxTimeMS(5000),
        ParkingSpace.countDocuments({ status: 'active' }).maxTimeMS(5000),
        Booking.countDocuments({}).maxTimeMS(5000),
        Booking.countDocuments({ createdAt: { $gte: todayStart, $lte: todayEnd } }).maxTimeMS(5000),
        ParkingSpace.countDocuments({ 'adminApproval.status': 'pending' }).maxTimeMS(5000),
        User.countDocuments({
          role: 'landlord',
          'idVerification.verificationStatus': 'under_review'
        }).maxTimeMS(5000),
        Booking.countDocuments({ status: 'active' }).maxTimeMS(5000),
        this.getRecentTransactions(),
        systemHealthService.getSystemMetrics()
      ]);

      // Calculate comprehensive revenue data
      const revenueData = await this.calculateTotalRevenue();

      // Calculate average stay duration
      const averageStayDuration = await this.calculateAverageStayDuration();

      // Get recent activity
      const recentActivity = await this.getRecentActivity();

      // Get chart data based on timeRange (default 7 days)
      const chartData = await this.getChartData('week');

      // Calculate total pending approvals (parking spaces + landlord applications)
      const totalPendingApprovals = pendingParkingSpaceApprovals + pendingLandlordApplications;

      // Update metrics with comprehensive revenue breakdown
      this.metrics = {
        totalUsers,
        totalLandlords,
        todaysNewRegistrations,
        totalParkingSpaces,
        totalBookings,
        todaysBookings,
        pendingApprovals: totalPendingApprovals,
        pendingParkingSpaceApprovals,
        pendingLandlordApplications,

        // Enhanced revenue data
        totalRevenue: revenueData.totalRevenue,
        platformFees: revenueData.platformFees,
        landlordEarnings: revenueData.landlordEarnings,
        totalTransactions: revenueData.totalTransactions,
        revenueSource: revenueData.source,

        // Additional metrics
        averageStayDuration,
        activeBookings,
        recentActivity,
        performanceMetrics: systemHealth,
        chartData,
        lastUpdated: new Date()
      };

      logger.info('Dashboard metrics updated successfully');
    } catch (error) {
      logger.error('Error collecting dashboard metrics:', error);
      throw error;
    }
  }

  async checkForUpdates() {
    try {
      // Check for new bookings in last 10 seconds with timeout
      const recentBookings = await Booking.find({
        createdAt: { $gte: new Date(Date.now() - 10000) }
      }).populate('userId', 'firstName lastName email')
        .populate('parkingSpaceId', 'name address')
        .sort({ createdAt: -1 })
        .maxTimeMS(5000)
        .lean();

      if (recentBookings.length > 0) {
        const bookingUpdates = recentBookings.map(booking => ({
          type: 'booking_created',
          bookingId: booking._id,
          userId: booking.userId,
          parkingSpace: booking.parkingSpaceId,
          status: booking.status,
          amount: booking.totalAmount,
          timestamp: booking.createdAt
        }));

        this.realtimeData.bookingUpdates.push(...bookingUpdates);
        this.broadcast('realtime_booking_update', { updates: bookingUpdates });
      }

      // Check for recent approvals/rejections with timeout
      const recentApprovals = await ParkingSpace.find({
        $or: [
          { 'adminApproval.approvedAt': { $gte: new Date(Date.now() - 10000) } },
          { 'adminApproval.rejectedAt': { $gte: new Date(Date.now() - 10000) } }
        ]
      }).populate('landlordId', 'firstName lastName email')
        .sort({ 'adminApproval.approvedAt': -1, 'adminApproval.rejectedAt': -1 })
        .maxTimeMS(5000)
        .lean();

      if (recentApprovals.length > 0) {
        const approvalUpdates = recentApprovals.map(space => ({
          type: space.adminApproval.status === 'approved' ? 'space_approved' : 'space_rejected',
          spaceId: space._id,
          spaceName: space.name,
          landlord: space.landlordId,
          status: space.adminApproval.status,
          timestamp: space.adminApproval.approvedAt || space.adminApproval.rejectedAt
        }));

        this.realtimeData.approvalUpdates.push(...approvalUpdates);
        this.broadcast('realtime_approval_update', { updates: approvalUpdates });
      }

      // Clean up old real-time data (keep only last 100 items)
      this.cleanupRealtimeData();

    } catch (error) {
      logger.error('Error checking for updates:', error);
    }
  }

  cleanupRealtimeData() {
    Object.keys(this.realtimeData).forEach(key => {
      if (Array.isArray(this.realtimeData[key]) && this.realtimeData[key].length > 100) {
        this.realtimeData[key] = this.realtimeData[key].slice(-100);
      }
    });
  }

  async calculateTotalRevenue() {
    try {
      // Primary: Calculate from completed transactions (most accurate)
      const transactionRevenue = await Transaction.aggregate([
        {
          $match: {
            status: 'completed',
            amount: { $exists: true, $ne: null }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$amount' },
            totalPlatformFees: { $sum: '$platformFee' },
            totalTransactions: { $sum: 1 }
          }
        }
      ]);

      if (transactionRevenue.length > 0) {
        return {
          totalRevenue: transactionRevenue[0].totalRevenue || 0,
          platformFees: transactionRevenue[0].totalPlatformFees || 0,
          landlordEarnings: (transactionRevenue[0].totalRevenue || 0) - (transactionRevenue[0].totalPlatformFees || 0),
          totalTransactions: transactionRevenue[0].totalTransactions || 0,
          source: 'transactions'
        };
      }

      // Fallback: Calculate from all bookings with pricing data
      // Platform revenue = Service Fees + Dynamic Pricing Cut
      const bookingRevenue = await Booking.aggregate([
        {
          $match: {
            'pricing.totalAmount': { $exists: true, $ne: null, $gt: 0 }
          }
        },
        {
          $project: {
            totalAmount: '$pricing.totalAmount',
            basePrice: { $ifNull: ['$dynamicPricing.basePrice', '$pricing.totalAmount'] },
            hasDynamicPricing: { $gt: [{ $ifNull: ['$dynamicPricing.demandFactor', 0] }, 0] },
            demandFactor: { $ifNull: ['$dynamicPricing.demandFactor', 0] }
          }
        },
        {
          $project: {
            totalAmount: 1,
            basePrice: 1,
            // Calculate components
            dynamicSurge: {
              $cond: {
                if: '$hasDynamicPricing',
                then: { $multiply: ['$basePrice', '$demandFactor'] },
                else: 0
              }
            },
            serviceFee: { $multiply: ['$basePrice', 0.10] } // 10% of base price
          }
        },
        {
          $project: {
            totalAmount: 1,
            basePrice: 1,
            dynamicSurge: 1,
            serviceFee: 1,
            // Platform gets: service fee + 50% of dynamic surge
            platformRevenue: {
              $add: [
                '$serviceFee',
                { $multiply: ['$dynamicSurge', 0.5] }
              ]
            },
            // Landlord gets: base price + 50% of dynamic surge
            landlordRevenue: {
              $add: [
                '$basePrice',
                { $multiply: ['$dynamicSurge', 0.5] }
              ]
            }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmount' },
            platformFees: { $sum: '$platformRevenue' },
            landlordEarnings: { $sum: '$landlordRevenue' },
            totalServiceFees: { $sum: '$serviceFee' },
            totalDynamicCut: { $sum: { $multiply: ['$dynamicSurge', 0.5] } },
            totalBookings: { $sum: 1 }
          }
        }
      ]);

      if (bookingRevenue.length > 0) {
        const result = bookingRevenue[0];

        return {
          totalRevenue: result.totalRevenue || 0,
          platformFees: Math.round(result.platformFees || 0),
          landlordEarnings: Math.round(result.landlordEarnings || 0),
          totalTransactions: result.totalBookings || 0,
          source: 'bookings',
          breakdown: {
            serviceFees: Math.round(result.totalServiceFees || 0),
            dynamicPricingCut: Math.round(result.totalDynamicCut || 0)
          }
        };
      }

      return {
        totalRevenue: 0,
        platformFees: 0,
        landlordEarnings: 0,
        totalTransactions: 0,
        source: 'none'
      };

    } catch (error) {
      logger.error('Error calculating total revenue:', error);
      return {
        totalRevenue: 0,
        platformFees: 0,
        landlordEarnings: 0,
        totalTransactions: 0,
        source: 'error'
      };
    }
  }

  async calculateAverageStayDuration() {
    try {
      // Calculate average stay duration from completed bookings
      const stayDurationData = await Booking.aggregate([
        {
          $match: {
            status: { $in: ['completed', 'ended'] },
            startTime: { $exists: true },
            endTime: { $exists: true }
          }
        },
        {
          $addFields: {
            durationInHours: {
              $divide: [
                { $subtract: ['$endTime', '$startTime'] },
                1000 * 60 * 60 // Convert milliseconds to hours
              ]
            }
          }
        },
        {
          $match: {
            durationInHours: { $gte: 0, $lte: 48 } // Filter out unrealistic durations
          }
        },
        {
          $group: {
            _id: null,
            averageDuration: { $avg: '$durationInHours' },
            totalBookings: { $sum: 1 }
          }
        }
      ]);

      if (stayDurationData.length > 0 && stayDurationData[0].totalBookings > 0) {
        return Math.round(stayDurationData[0].averageDuration * 10) / 10; // Round to 1 decimal place
      }

      return 0;
    } catch (error) {
      logger.error('Error calculating average stay duration:', error);
      return 0;
    }
  }

  async getRecentActivity() {
    try {
      const activities = [];

      // Recent bookings
      const recentBookings = await Booking.find()
        .populate('userId', 'firstName lastName')
        .populate('parkingSpaceId', 'name')
        .sort({ createdAt: -1 })
        .limit(10);

      recentBookings.forEach(booking => {
        activities.push({
          type: 'booking',
          action: 'created',
          details: `${booking.userId?.firstName || 'User'} booked ${booking.parkingSpaceId?.name || 'parking space'}`,
          timestamp: booking.createdAt,
          amount: booking.totalAmount
        });
      });

      // Recent approvals
      const recentApprovals = await ParkingSpace.find({
        'adminApproval.status': { $in: ['approved', 'rejected'] }
      }).populate('landlordId', 'firstName lastName')
        .sort({ 'adminApproval.approvedAt': -1, 'adminApproval.rejectedAt': -1 })
        .limit(10);

      recentApprovals.forEach(space => {
        activities.push({
          type: 'approval',
          action: space.adminApproval.status,
          details: `Parking space "${space.name}" ${space.adminApproval.status} for ${space.landlordId?.firstName || 'landlord'}`,
          timestamp: space.adminApproval.approvedAt || space.adminApproval.rejectedAt
        });
      });

      // Sort by timestamp and return latest 20
      return activities
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, 20);

    } catch (error) {
      logger.error('Error getting recent activity:', error);
      return [];
    }
  }

  async getRecentTransactions() {
    try {
      // Only get transactions from the last 7 days to improve performance
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const transactions = await Transaction.find({
        createdAt: { $gte: sevenDaysAgo },
        status: { $in: ['completed', 'pending', 'processing'] } // Only relevant statuses
      })
        .sort({ createdAt: -1 })
        .limit(10)
        .populate('userId', 'firstName lastName email')
        .lean(); // Use lean() for better performance

      return transactions.map(transaction => ({
        id: transaction._id,
        type: transaction.type,
        amount: transaction.amount,
        status: transaction.status,
        user: transaction.userId,
        createdAt: transaction.createdAt
      }));
    } catch (error) {
      logger.error('Error getting recent transactions:', error);
      return [];
    }
  }

  // Get analytics for specific time periods
  async getAnalyticsData(timeRange = '24h') {
    try {
      let startDate;
      const endDate = new Date();

      switch (timeRange) {
        case '1h':
          startDate = new Date(Date.now() - 60 * 60 * 1000);
          break;
        case '24h':
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          break;
        case '7d':
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          break;
        default:
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
      }

      const [
        bookingTrends,
        revenueTrends,
        userRegistrations,
        approvalTrends
      ] = await Promise.all([
        this.getBookingTrends(startDate, endDate),
        this.getRevenueTrends(startDate, endDate),
        this.getUserRegistrationTrends(startDate, endDate),
        this.getApprovalTrends(startDate, endDate)
      ]);

      return {
        timeRange,
        startDate,
        endDate,
        bookingTrends,
        revenueTrends,
        userRegistrations,
        approvalTrends
      };
    } catch (error) {
      logger.error('Error getting analytics data:', error);
      throw error;
    }
  }

  async getBookingTrends(startDate, endDate) {
    try {
      const trends = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
              hour: { $hour: '$createdAt' }
            },
            count: { $sum: 1 },
            revenue: { $sum: '$totalAmount' }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
      ]);

      return trends;
    } catch (error) {
      logger.error('Error getting booking trends:', error);
      return [];
    }
  }

  async getRevenueTrends(startDate, endDate) {
    try {
      const trends = await Transaction.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate },
            status: 'completed',
            type: 'payment'
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
              hour: { $hour: '$createdAt' }
            },
            totalRevenue: { $sum: '$amount' },
            transactionCount: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1, '_id.hour': 1 } }
      ]);

      return trends;
    } catch (error) {
      logger.error('Error getting revenue trends:', error);
      return [];
    }
  }

  async getUserRegistrationTrends(startDate, endDate) {
    try {
      const trends = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' },
              role: '$role'
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ]);

      return trends;
    } catch (error) {
      logger.error('Error getting user registration trends:', error);
      return [];
    }
  }

  async getApprovalTrends(startDate, endDate) {
    try {
      const trends = await ParkingSpace.aggregate([
        {
          $match: {
            $or: [
              { 'adminApproval.approvedAt': { $gte: startDate, $lte: endDate } },
              { 'adminApproval.rejectedAt': { $gte: startDate, $lte: endDate } }
            ]
          }
        },
        {
          $group: {
            _id: {
              status: '$adminApproval.status'
            },
            count: { $sum: 1 }
          }
        }
      ]);

      return trends;
    } catch (error) {
      logger.error('Error getting approval trends:', error);
      return [];
    }
  }

  async getChartData(timeRange = 'week') {
    try {
      // Calculate date range based on timeRange parameter
      const endDate = new Date();
      let startDate, dateRangeSize;

      switch (timeRange) {
        case 'day':
          startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
          dateRangeSize = 24; // 24 hours
          break;
        case 'month':
          startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
          dateRangeSize = 30; // 30 days
          break;
        case 'week':
        default:
          startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
          dateRangeSize = 7; // 7 days
          break;
      }

      // Create date range array for consistent chart data
      const dateRange = [];
      for (let i = dateRangeSize - 1; i >= 0; i--) {
        const date = new Date();
        if (timeRange === 'day') {
          date.setHours(date.getHours() - i);
          dateRange.push(date.toISOString().split('T')[0] + ' ' + date.getHours() + ':00');
        } else {
          date.setDate(date.getDate() - i);
          dateRange.push(date.toISOString().split('T')[0]);
        }
      }

      // User registration trends - Monthly aggregation for better display (last 12 months)
      const monthlyStartDate = new Date();
      monthlyStartDate.setMonth(monthlyStartDate.getMonth() - 11); // Last 12 months
      monthlyStartDate.setDate(1); // Start from beginning of month

      const userGrowthData = await User.aggregate([
        {
          $match: {
            createdAt: { $gte: monthlyStartDate, $lte: endDate },
            role: { $in: ['client', 'landlord'] } // Exclude admin users
          }
        },
        {
          $group: {
            _id: {
              month: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
              role: "$role"
            },
            count: { $sum: 1 }
          }
        },
        { $sort: { "_id.month": 1, "_id.role": 1 } }
      ]);

      // Revenue trends (last 7 days) - Using Transaction model for accurate revenue tracking
      let revenueTrends = [];

      try {
        revenueTrends = await Transaction.aggregate([
          {
            $match: {
              status: 'completed',
              completedAt: { $gte: startDate, $lte: endDate },
              amount: { $exists: true, $ne: null }
            }
          },
          {
            $group: {
              _id: { $dateToString: { format: "%Y-%m-%d", date: "$completedAt" } },
              totalRevenue: { $sum: "$amount" },
              platformFees: { $sum: "$platformFee" },
              landlordEarnings: { $sum: { $subtract: ["$amount", "$platformFee"] } },
              transactionCount: { $sum: 1 }
            }
          },
          { $sort: { _id: 1 } }
        ]);

        logger.info(`Revenue trends from transactions: ${revenueTrends.length} data points`);
      } catch (transactionError) {
        logger.warn('Transaction aggregation failed, falling back to Booking model');

        try {
          revenueTrends = await Booking.aggregate([
            {
              $match: {
                createdAt: { $gte: startDate, $lte: endDate },
                status: { $in: ['completed', 'parked'] },
                'pricing.totalAmount': { $exists: true, $ne: null }
              }
            },
            {
              $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                totalRevenue: { $sum: "$pricing.totalAmount" },
                transactionCount: { $sum: 1 }
              }
            },
            {
              $addFields: {
                platformFees: { $multiply: ["$totalRevenue", 0.10] }, // 10% commission
                landlordEarnings: { $multiply: ["$totalRevenue", 0.90] } // 90% for landlord
              }
            },
            { $sort: { _id: 1 } }
          ]);

          logger.info(`Revenue trends from bookings: ${revenueTrends.length} data points`);
        } catch (bookingError) {
          logger.error('Both transaction and booking revenue aggregation failed:', bookingError);
          revenueTrends = [];
        }
      }

      // Booking activity trends (last 7 days) - All booking statuses for activity tracking
      const bookingActivity = await Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: startDate, $lte: endDate }
          }
        },
        {
          $group: {
            _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
            count: { $sum: 1 }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      // Create monthly date range for user growth (last 12 months)
      const monthlyRange = [];
      for (let i = 11; i >= 0; i--) {
        const date = new Date();
        date.setMonth(date.getMonth() - i);
        const monthKey = date.toISOString().substring(0, 7); // YYYY-MM format
        const monthName = date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        monthlyRange.push({ key: monthKey, label: monthName });
      }

      // Format user growth data with separate client and landlord lines (monthly)
      const formatUserGrowthData = (aggregatedData) => {
        const clientMap = new Map();
        const landlordMap = new Map();

        // Group by role
        aggregatedData.forEach(item => {
          const month = item._id.month;
          const role = item._id.role;
          const count = item.count;

          if (role === 'client') {
            clientMap.set(month, count);
          } else if (role === 'landlord') {
            landlordMap.set(month, count);
          }
        });

        return monthlyRange.map(monthInfo => ({
          date: monthInfo.label, // Display month name (e.g., "January 2024")
          month: monthInfo.key,  // Keep YYYY-MM for sorting
          clients: clientMap.get(monthInfo.key) || 0,
          landlords: landlordMap.get(monthInfo.key) || 0,
          total: (clientMap.get(monthInfo.key) || 0) + (landlordMap.get(monthInfo.key) || 0)
        }));
      };

      // Ensure all dates have data (fill missing dates with 0)
      const formatChartData = (aggregatedData, field = 'count') => {
        const dataMap = new Map(aggregatedData.map(item => [item._id, item[field] || 0]));
        return dateRange.map(date => ({
          date,
          value: dataMap.get(date) || 0
        }));
      };

      // Enhanced revenue chart data with breakdown
      const formatRevenueChartData = (aggregatedData) => {
        const dataMap = new Map(aggregatedData.map(item => [item._id, item]));
        return dateRange.map(date => {
          const data = dataMap.get(date) || {};
          return {
            date,
            totalRevenue: data.totalRevenue || 0,
            platformFees: data.platformFees || 0,
            landlordEarnings: data.landlordEarnings || 0,
            transactionCount: data.transactionCount || 0,
            // For backwards compatibility, use totalRevenue as primary value
            value: data.totalRevenue || 0
          };
        });
      };

      return {
        userGrowth: formatUserGrowthData(userGrowthData),
        revenueTrends: formatRevenueChartData(revenueTrends),
        bookingActivity: formatChartData(bookingActivity, 'count')
      };
    } catch (error) {
      logger.error('Error getting chart data:', error);
      // Return empty data with proper structure
      const dateRange = [];
      for (let i = 6; i >= 0; i--) {
        const date = new Date();
        date.setDate(date.getDate() - i);
        dateRange.push({
          date: date.toISOString().split('T')[0],
          value: 0
        });
      }

      return {
        userGrowth: dateRange,
        revenueTrends: dateRange,
        bookingActivity: dateRange
      };
    }
  }

  // Manual trigger for metrics update
  async updateMetrics() {
    await this.collectDashboardMetrics();
    this.broadcast('metrics_update', { metrics: this.metrics });
  }

  // Get current state
  getCurrentState() {
    return {
      metrics: this.metrics,
      realtimeData: this.realtimeData,
      connectedClients: this.clients.size,
      lastUpdated: this.metrics.lastUpdated
    };
  }
}

// Create singleton instance
const realTimeDashboardService = new RealTimeDashboardService();

module.exports = realTimeDashboardService;