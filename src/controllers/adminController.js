const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User'); // Legacy
const { BaseUser, Client, Landlord, Admin: AdminUser, findUserById } = require('../models/UserModels');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');
const SupportTicket = require('../models/SupportTicket');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const googleMapsService = require('../services/googleMapsService');
const notificationService = require('../services/notificationService');
const { Wallet } = require('../models/Wallet');
const Receipt = require('../models/Receipt');
const smsService = require('../services/smsService');
const systemHealthService = require('../services/systemHealthService');
const realTimeDashboardService = require('../services/realTimeDashboardService');
const errorTrackingService = require('../services/errorTrackingService');
const queryOptimizationService = require('../services/queryOptimizationService');
const { checkDBHealth, getConnectionMetrics, getPerformanceStats } = require('../config/database');
const SystemSettings = require('../models/SystemSettings');
const AdminActionLog = require('../models/AdminActionLog');

// Get all pending parking spaces for admin approval
const getPendingParkingSpaces = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;
  
  const pendingSpaces = await ParkingSpace.find({ 'adminApproval.status': 'pending' })
    .populate('landlordId', 'firstName lastName email phoneNumber isVerifiedLandlord totalEarnings averageRating totalReviews createdAt')
    .populate('adminApproval.approvedBy', 'firstName lastName')
    .populate('adminApproval.rejectedBy', 'firstName lastName')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const totalPending = await ParkingSpace.countDocuments({ 'adminApproval.status': 'pending' });

  // Transform the data to include image previews and enhanced landlord info
  const enhancedSpaces = pendingSpaces.map(space => {
    const spaceObj = space.toObject();
    
    // Enhance image data
    if (spaceObj.images && spaceObj.images.length > 0) {
      spaceObj.mainImage = spaceObj.images.find(img => img.isMain) || spaceObj.images[0];
      spaceObj.imageCount = spaceObj.images.length;
      spaceObj.hasImages = true;
    } else {
      spaceObj.mainImage = null;
      spaceObj.imageCount = 0;
      spaceObj.hasImages = false;
    }
    
    // Enhance landlord data
    if (spaceObj.landlordId) {
      spaceObj.landlord = {
        ...spaceObj.landlordId,
        fullName: `${spaceObj.landlordId.firstName} ${spaceObj.landlordId.lastName}`,
        isNewLandlord: new Date() - new Date(spaceObj.landlordId.createdAt) < 30 * 24 * 60 * 60 * 1000, // Less than 30 days
        experienceLevel: spaceObj.landlordId.totalEarnings > 0 ? 'experienced' : 'new'
      };
      delete spaceObj.landlordId;
    }
    
    // Add submission duration
    spaceObj.submissionAge = Math.floor((new Date() - new Date(spaceObj.createdAt)) / (1000 * 60 * 60 * 24)); // days
    
    // Add validation flags
    spaceObj.validationFlags = {
      hasImages: spaceObj.hasImages,
      hasDescription: spaceObj.description && spaceObj.description.length >= 10,
      hasPricing: spaceObj.pricePerHour > 0,
      hasLocation: spaceObj.latitude && spaceObj.longitude,
      hasOperatingHours: spaceObj.operatingHours && Object.keys(spaceObj.operatingHours).length > 0,
      hasAmenities: spaceObj.amenities && spaceObj.amenities.length > 0
    };
    
    spaceObj.validationScore = Object.values(spaceObj.validationFlags).filter(Boolean).length;
    
    return spaceObj;
  });

  res.status(200).json({
    status: 'success',
    results: enhancedSpaces.length,
    data: {
      parkingSpaces: enhancedSpaces,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalPending / parseInt(limit)),
        totalItems: totalPending,
        hasNextPage: page * limit < totalPending,
        hasPrevPage: page > 1
      },
      summary: {
        totalPending,
        withImages: enhancedSpaces.filter(space => space.hasImages).length,
        newLandlords: enhancedSpaces.filter(space => space.landlord?.isNewLandlord).length,
        highQuality: enhancedSpaces.filter(space => space.validationScore >= 5).length
      }
    }
  });
});

// Get parking space details for admin review
const getParkingSpaceForReview = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;

  const parkingSpace = await ParkingSpace.findById(spaceId)
    .populate('landlord', 'firstName lastName email phoneNumber isVerifiedLandlord')
    .populate('adminApproval.approvedBy', 'firstName lastName')
    .populate('adminApproval.rejectedBy', 'firstName lastName');

  if (!parkingSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  // Get nearby universities using Google Maps API
  let nearbyPlaces = [];
  try {
    const placesResult = await googleMapsService.getNearbyPlaces(
      parkingSpace.latitude,
      parkingSpace.longitude,
      1000, // 1km radius
      'university'
    );
    if (placesResult.success) {
      nearbyPlaces = placesResult.data;
    }
  } catch (error) {
    logger.error('Error fetching nearby places:', error);
  }

  // Validate coordinates are in Philippines
  const isInPhilippines = googleMapsService.isWithinPhilippines(
    parkingSpace.latitude,
    parkingSpace.longitude
  );

  res.status(200).json({
    status: 'success',
    data: {
      parkingSpace,
      nearbyPlaces,
      isInPhilippines,
      adminInfo: {
        canApprove: parkingSpace.adminApproval.status === 'pending',
        canReject: parkingSpace.adminApproval.status === 'pending',
        canSuspend: parkingSpace.status === 'active'
      }
    }
  });
});

// Auto-approve all parking spaces
const autoApproveAllParkingSpaces = catchAsync(async (req, res, next) => {
  try {
    // Find all pending parking spaces
    const pendingSpaces = await ParkingSpace.find({
      'adminApproval.status': 'pending'
    });

    const adminId = req.user.id;
    let approvedCount = 0;

    // Approve each pending space
    for (const space of pendingSpaces) {
      space.isVerified = true;
      await space.approve(adminId, 'Auto-approved by system');
      approvedCount++;
    }

    logger.info(`Auto-approved ${approvedCount} parking spaces by admin ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: `Successfully auto-approved ${approvedCount} parking spaces`,
      data: {
        approvedCount
      }
    });
  } catch (error) {
    logger.error('Error auto-approving all parking spaces:', error);
    return next(new AppError('Failed to auto-approve parking spaces', 500));
  }
});

// Approve a parking space
const approveParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const { adminNotes } = req.body;
  const adminId = req.user.id;

  const parkingSpace = await ParkingSpace.findById(spaceId);

  if (!parkingSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  if (parkingSpace.adminApproval.status !== 'pending') {
    return next(new AppError('This parking space has already been reviewed', 400));
  }

  // Auto-verify the parking space when approved
  parkingSpace.isVerified = true;
  
  await parkingSpace.approve(adminId, adminNotes);

  // Send approval notification to landlord
  try {
    await notificationService.sendSpaceApprovalNotification(
      parkingSpace.landlordId,
      parkingSpace,
      adminId,
      adminNotes
    );
    
    // Send real-time update to admin panel
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('space_approved', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name,
        landlordId: parkingSpace.landlordId,
        approvedBy: adminId,
        timestamp: new Date()
      });
      
      // Send real-time update directly to the landlord
      io.to(`user_${parkingSpace.landlordId}`).emit('space_approved', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name,
        status: 'approved',
        approvedBy: adminId,
        adminNotes: adminNotes,
        timestamp: new Date()
      });
      
      io.to(`landlord_${parkingSpace.landlordId}`).emit('space_approved', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name,
        status: 'approved',
        approvedBy: adminId,
        adminNotes: adminNotes,
        timestamp: new Date()
      });
    }
  } catch (notificationError) {
    logger.error('Failed to send approval notification:', notificationError);
  }

  // Log the approval
  logger.info('Parking space approved', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    landlordId: parkingSpace.landlordId,
    adminId: adminId,
    adminNotes: adminNotes
  });

  res.status(200).json({
    status: 'success',
    message: 'Parking space approved successfully',
    data: {
      parkingSpace
    }
  });
});

// Reject a parking space
const rejectParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const { rejectionReason, adminNotes } = req.body;
  const adminId = req.user.id;

  if (!rejectionReason) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const parkingSpace = await ParkingSpace.findById(spaceId);

  if (!parkingSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  if (parkingSpace.adminApproval.status !== 'pending') {
    return next(new AppError('This parking space has already been reviewed', 400));
  }

  await parkingSpace.reject(adminId, rejectionReason, adminNotes);

  // Send rejection notification to landlord
  try {
    await notificationService.sendSpaceRejectionNotification(
      parkingSpace.landlordId,
      parkingSpace,
      adminId,
      rejectionReason,
      adminNotes
    );
    
    // Send real-time update to admin panel
    const io = req.app.get('io');
    if (io) {
      io.to('admin_room').emit('space_rejected', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name,
        landlordId: parkingSpace.landlordId,
        rejectedBy: adminId,
        rejectionReason: rejectionReason,
        timestamp: new Date()
      });
      
      // Send real-time update directly to the landlord
      io.to(`user_${parkingSpace.landlordId}`).emit('space_rejected', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name,
        status: 'rejected',
        rejectedBy: adminId,
        rejectionReason: rejectionReason,
        adminNotes: adminNotes,
        timestamp: new Date()
      });
      
      io.to(`landlord_${parkingSpace.landlordId}`).emit('space_rejected', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name,
        status: 'rejected',
        rejectedBy: adminId,
        rejectionReason: rejectionReason,
        adminNotes: adminNotes,
        timestamp: new Date()
      });
    }
  } catch (notificationError) {
    logger.error('Failed to send rejection notification:', notificationError);
  }

  // Log the rejection
  logger.info('Parking space rejected', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    landlordId: parkingSpace.landlordId,
    adminId: adminId,
    rejectionReason: rejectionReason
  });

  res.status(200).json({
    status: 'success',
    message: 'Parking space rejected',
    data: {
      parkingSpace
    }
  });
});

// Suspend an active parking space
const suspendParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const { suspensionReason } = req.body;
  const adminId = req.user.id;

  if (!suspensionReason) {
    return next(new AppError('Suspension reason is required', 400));
  }

  const parkingSpace = await ParkingSpace.findById(spaceId);

  if (!parkingSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  if (parkingSpace.status !== 'active') {
    return next(new AppError('Only active parking spaces can be suspended', 400));
  }

  await parkingSpace.suspend(adminId, suspensionReason);

  logger.info('Parking space suspended', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    adminId: adminId,
    reason: suspensionReason
  });

  res.status(200).json({
    status: 'success',
    message: 'Parking space suspended',
    data: {
      parkingSpace
    }
  });
});

// Reactivate a suspended parking space
const reactivateParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const adminId = req.user.id;

  const parkingSpace = await ParkingSpace.findById(spaceId);

  if (!parkingSpace) {
    return next(new AppError('Parking space not found', 404));
  }

  if (parkingSpace.status !== 'suspended') {
    return next(new AppError('Only suspended parking spaces can be reactivated', 400));
  }

  await parkingSpace.reactivate();

  logger.info('Parking space reactivated', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    adminId: adminId
  });

  res.status(200).json({
    status: 'success',
    message: 'Parking space reactivated',
    data: {
      parkingSpace
    }
  });
});

// Get admin dashboard statistics
// Enhanced Admin Dashboard with Real-time Data
const getAdminDashboard = catchAsync(async (req, res, next) => {
  try {
    // Get timeRange from query parameter (day, week, month)
    const { timeRange = 'week' } = req.query;

    // Get comprehensive dashboard data from real-time service
    const dashboardState = realTimeDashboardService.getCurrentState();

    // If metrics are older than 1 minute, refresh them
    const lastUpdated = new Date(dashboardState.metrics.lastUpdated);
    const oneMinuteAgo = new Date(Date.now() - 60000);

    if (!lastUpdated || lastUpdated < oneMinuteAgo) {
      await realTimeDashboardService.updateMetrics();
    }

    const updatedState = realTimeDashboardService.getCurrentState();

    // Get chart data with the requested time range
    const chartData = await realTimeDashboardService.getChartData(timeRange);

    // Update metrics with new chart data
    updatedState.metrics.chartData = chartData;

    res.status(200).json({
      status: 'success',
      data: {
        metrics: updatedState.metrics,
        realtimeData: updatedState.realtimeData,
        systemHealth: updatedState.metrics.performanceMetrics?.system || {},
        connectedClients: updatedState.connectedClients,
        lastUpdated: updatedState.lastUpdated,
        timeRange: timeRange
      }
    });

  } catch (error) {
    logger.error('Admin dashboard error:', error);

    // Fallback to basic metrics if real-time service fails
    const [
      totalSpaces,
      pendingSpaces,
      approvedSpaces,
      rejectedSpaces,
      totalLandlords,
      totalUsers
    ] = await Promise.all([
      ParkingSpace.countDocuments(),
      ParkingSpace.countDocuments({ 'adminApproval.status': 'pending' }),
      ParkingSpace.countDocuments({ 'adminApproval.status': 'approved' }),
      ParkingSpace.countDocuments({ 'adminApproval.status': 'rejected' }),
      User.countDocuments({ role: 'landlord' }),
      User.countDocuments({ role: 'client' })
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        metrics: {
          totalParkingSpaces: totalSpaces,
          pendingApprovals: pendingSpaces,
          totalLandlords: totalLandlords,
          totalUsers: totalUsers,
          lastUpdated: new Date()
        },
        fallback: true,
        error: 'Real-time service unavailable'
      }
    });
  }
});

// Get Dashboard Analytics for specific time periods
const getDashboardAnalytics = catchAsync(async (req, res, next) => {
  try {
    const { timeRange = '24h' } = req.query;

    // First collect/update the main dashboard metrics
    await realTimeDashboardService.collectDashboardMetrics();

    // Get the main metrics
    const mainMetrics = realTimeDashboardService.metrics;

    // Get trend analytics for the specific time range
    const trendAnalytics = await realTimeDashboardService.getAnalyticsData(timeRange);

    // Combine both datasets
    const combinedData = {
      ...mainMetrics,
      chartData: trendAnalytics,
      timeRange: timeRange,
      trends: trendAnalytics
    };

    logger.info('✅ Dashboard analytics successful:', {
      totalRevenue: combinedData.totalRevenue,
      totalTransactions: combinedData.totalTransactions,
      totalBookings: combinedData.totalBookings,
      totalUsers: combinedData.totalUsers,
      timeRange
    });

    res.status(200).json({
      status: 'success',
      data: combinedData
    });
  } catch (error) {
    logger.error('Dashboard analytics error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to load analytics data',
      error: error.message
    });
  }
});

// Get all parking spaces with filters for admin management
const getAllParkingSpacesAdmin = catchAsync(async (req, res, next) => {
  const {
    status,
    adminStatus,
    landlordId,
    city,
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  let query = {};

  if (status) query.status = status;
  if (adminStatus) query['adminApproval.status'] = adminStatus;
  if (landlordId) query.landlordId = landlordId;
  if (city) query.address = { $regex: city, $options: 'i' };

  const sortOption = {};
  sortOption[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const parkingSpaces = await ParkingSpace.find(query)
    .populate('landlord', 'firstName lastName email phoneNumber isVerifiedLandlord')
    .populate('adminApproval.approvedBy', 'firstName lastName')
    .populate('adminApproval.rejectedBy', 'firstName lastName')
    .sort(sortOption)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await ParkingSpace.countDocuments(query);

  // Transform parking spaces to include proper pricing and rating info
  const Rating = require('../models/Rating');
  const transformedSpaces = await Promise.all(parkingSpaces.map(async (space) => {
    const spaceObj = space.toObject({ virtuals: true });

    // Add pricePerHour - send the actual 3-hour pricing
    spaceObj.pricePerHour = space.pricePer3Hours;

    // Get rating info
    const ratingInfo = await Rating.getAverageRating(space._id);
    spaceObj.rating = ratingInfo.averageRating;
    spaceObj.reviewCount = ratingInfo.totalRatings;

    return spaceObj;
  }));

  res.status(200).json({
    status: 'success',
    results: transformedSpaces.length,
    data: {
      parkingSpaces: transformedSpaces,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        hasNextPage: page * limit < total,
        hasPrevPage: page > 1
      }
    }
  });
});

// Enhanced System Health Check
const getSystemHealth = catchAsync(async (req, res) => {
  try {
    // Get comprehensive health data from the system health service
    const healthData = await systemHealthService.getComprehensiveHealth();

    res.status(200).json({
      status: 'success',
      data: healthData
    });
  } catch (error) {
    logger.error('System health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get system health',
      data: {
        status: 'critical',
        timestamp: new Date(),
        error: error.message
      }
    });
  }
});

// Get detailed database health
const getDatabaseHealth = catchAsync(async (req, res) => {
  try {
    const [dbHealth, connectionMetrics, performanceStats] = await Promise.all([
      checkDBHealth(),
      getConnectionMetrics(),
      getPerformanceStats()
    ]);

    res.status(200).json({
      status: 'success',
      data: {
        health: dbHealth,
        metrics: connectionMetrics,
        performance: performanceStats,
        timestamp: new Date()
      }
    });
  } catch (error) {
    logger.error('Database health check failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get database health',
      error: error.message
    });
  }
});

// Get system performance metrics
const getSystemMetrics = catchAsync(async (req, res) => {
  try {
    const systemMetrics = await systemHealthService.getSystemMetrics();

    res.status(200).json({
      status: 'success',
      data: systemMetrics
    });
  } catch (error) {
    logger.error('System metrics retrieval failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get system metrics',
      error: error.message
    });
  }
});

// Get Error Tracking Statistics
const getErrorStats = catchAsync(async (req, res) => {
  try {
    const errorStats = errorTrackingService.getErrorStats();

    res.status(200).json({
      status: 'success',
      data: errorStats
    });
  } catch (error) {
    logger.error('Error stats retrieval failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get error statistics',
      error: error.message
    });
  }
});

// Get Query Performance Statistics
const getQueryPerformanceStats = catchAsync(async (req, res) => {
  try {
    const performanceStats = queryOptimizationService.getPerformanceStats();

    res.status(200).json({
      status: 'success',
      data: performanceStats
    });
  } catch (error) {
    logger.error('Query performance stats retrieval failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to get query performance statistics',
      error: error.message
    });
  }
});

// Clear Query Cache
const clearQueryCache = catchAsync(async (req, res) => {
  try {
    const { pattern } = req.query;
    queryOptimizationService.clearCache(pattern);

    res.status(200).json({
      status: 'success',
      message: pattern ? `Cache cleared for pattern: ${pattern}` : 'All cache cleared'
    });
  } catch (error) {
    logger.error('Cache clear failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to clear cache',
      error: error.message
    });
  }
});

// Recreate Database Indexes
const recreateIndexes = catchAsync(async (req, res) => {
  try {
    await queryOptimizationService.recreateIndexes();

    res.status(200).json({
      status: 'success',
      message: 'Database indexes recreated successfully'
    });
  } catch (error) {
    logger.error('Index recreation failed:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to recreate indexes',
      error: error.message
    });
  }
});

// Get System Alerts
const getAlerts = catchAsync(async (req, res) => {
  const now = new Date();
  const alerts = [];

  // Check for pending approvals alert
  const pendingSpaces = await ParkingSpace.countDocuments({ 'adminApproval.status': 'pending' });
  if (pendingSpaces > 20) {
    alerts.push({
      id: `alert-pending-${Date.now()}`,
      type: 'warning',
      message: `High volume of pending space approvals. Current count: ${pendingSpaces}`,
      timestamp: now,
      read: false,
      actionRequired: true,
      link: '/approvals'
    });
  }

  // Check for failed transactions (if model exists)
  try {
    const failedTransactions = await Transaction.countDocuments({
      status: 'failed',
      createdAt: { $gte: new Date(now.getTime() - 24 * 60 * 60 * 1000) }
    });
    
    if (failedTransactions > 10) {
      alerts.push({
        id: `alert-transactions-${Date.now()}`,
        type: 'error',
        message: `High number of failed transactions in last 24h: ${failedTransactions}`,
        timestamp: now,
        read: false,
        actionRequired: true,
        link: '/transactions'
      });
    }
  } catch (error) {
    // Transaction model might not exist yet
  }

  // Add general system status alert
  alerts.push({
    id: `alert-system-${Date.now()}`,
    type: 'success',
    message: 'All systems operational',
    timestamp: now,
    read: true,
    actionRequired: false
  });

  res.status(200).json({
    status: 'success',
    data: alerts
  });
});

// User Management
const getAllUsers = catchAsync(async (req, res) => {
  const {
    page = 1,
    limit = 10,
    userType,
    status,
    search
  } = req.query;

  let query = {};

  if (userType) {
    query.role = userType;
  }

  if (status) {
    query.status = status;
  }

  if (search) {
    query.$or = [
      { firstName: { $regex: search, $options: 'i' } },
      { lastName: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }

  const users = await User.find(query)
    .select('firstName lastName email phoneNumber userType isVerified isVerifiedLandlord totalEarnings averageRating totalReviews createdAt updatedAt active status currentSuspension suspensionReason suspendedAt suspendedBy suspendedByName')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await User.countDocuments(query);

  // Enhanced user data with computed properties for frontend compatibility
  const enhancedUsers = users.map(user => {
    const userObj = user.toObject();

    // Normalize status values (handle legacy users without proper status)
    const normalizedStatus = userObj.status || 'active';
    const normalizedActive = userObj.active !== false; // Default to true if undefined

    // Calculate derived status properties
    const isSuspended = normalizedStatus === 'suspended' && (userObj.currentSuspension?.isActive !== false);
    const isVerified = userObj.role === 'client' ? userObj.isVerified : userObj.isVerifiedLandlord;

    return {
      ...userObj,
      // Normalize core status fields
      status: normalizedStatus,
      active: normalizedActive,
      // Add derived properties for frontend compatibility
      isSuspended,
      isVerified,
      // Add status info for enhanced display
      statusInfo: user.getStatusInfo ? user.getStatusInfo() : {
        currentStatus: normalizedStatus,
        isActive: normalizedActive,
        isSuspended,
        suspensionDetails: isSuspended ? {
          reason: userObj.currentSuspension?.reason || userObj.suspensionReason,
          suspendedAt: userObj.currentSuspension?.suspendedAt || userObj.suspendedAt,
          suspendedBy: userObj.currentSuspension?.suspendedBy?.adminName || userObj.suspendedByName,
          expiresAt: userObj.currentSuspension?.expiresAt,
          notes: userObj.currentSuspension?.notes
        } : null
      }
    };
  });

  res.status(200).json({
    status: 'success',
    results: enhancedUsers.length,
    data: {
      users: enhancedUsers,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      }
    }
  });
});

const getUserById = catchAsync(async (req, res, next) => {
  const user = await User.findById(req.params.userId).select('firstName lastName email phoneNumber userType isVerified isVerifiedLandlord totalEarnings averageRating totalReviews createdAt updatedAt active status currentSuspension suspensionReason suspendedAt suspendedBy suspendedByName');
  
  if (!user) {
    return next(new AppError('User not found', 404));
  }

  // Get user's bookings count
  let bookingsCount = 0;
  try {
    bookingsCount = await Booking.countDocuments({ userId: user._id });
  } catch (error) {
    // Booking model might not exist yet
  }

  // Get user's parking spaces count (if landlord)
  let spacesCount = 0;
  if (user.role === 'landlord') {
    spacesCount = await ParkingSpace.countDocuments({ landlordId: user._id });
  }

  res.status(200).json({
    status: 'success',
    data: {
      user: {
        ...user.toObject(),
        stats: {
          bookingsCount,
          spacesCount
        }
      }
    }
  });
});

const suspendUser = catchAsync(async (req, res, next) => {
  const { reason, notes, expiresAt } = req.body;
  const user = await User.findById(req.params.userId);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  if (!reason) {
    return next(new AppError('Suspension reason is required', 400));
  }

  const adminInfo = {
    adminId: req.user._id,
    adminName: `${req.user.firstName} ${req.user.lastName}`,
    adminEmail: req.user.email
  };

  // Use the enhanced changeStatus method if available
  if (user.changeStatus) {
    await user.changeStatus('suspended', adminInfo, {
      reason,
      notes,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
  } else {
    // Fallback to manual update
    user.status = 'suspended';
    user.active = false;
    user.suspensionReason = reason;
    user.suspendedAt = new Date();
    user.suspendedBy = req.user._id;
    user.suspendedByName = adminInfo.adminName;

    // Update current suspension details
    user.currentSuspension = {
      isActive: true,
      reason,
      suspendedAt: new Date(),
      suspendedBy: {
        adminId: req.user._id,
        adminName: adminInfo.adminName,
        adminEmail: adminInfo.adminEmail
      },
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      notes
    };

    await user.save();
  }

  logger.info(`User ${user.email} suspended by admin ${req.user.email} - Reason: ${reason}`);

  res.status(200).json({
    status: 'success',
    message: 'User suspended successfully',
    data: {
      user: {
        id: user._id,
        status: user.status,
        active: user.active,
        isSuspended: true,
        currentSuspension: user.currentSuspension
      }
    }
  });
});

const reactivateUser = catchAsync(async (req, res, next) => {
  const { notes } = req.body;
  const user = await User.findById(req.params.userId);

  if (!user) {
    return next(new AppError('User not found', 404));
  }

  const adminInfo = {
    adminId: req.user._id,
    adminName: `${req.user.firstName} ${req.user.lastName}`,
    adminEmail: req.user.email
  };

  // Use the enhanced changeStatus method if available
  if (user.changeStatus) {
    await user.changeStatus('active', adminInfo, {
      reason: 'Admin reactivation',
      notes,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent')
    });
  } else {
    // Fallback to manual update
    user.status = 'active';
    user.active = true;
    user.suspensionReason = undefined;
    user.suspendedAt = undefined;
    user.suspendedBy = undefined;
    user.reactivatedAt = new Date();
    user.reactivatedBy = req.user._id;
    user.reactivatedByName = adminInfo.adminName;
    user.reactivationNotes = notes;

    // Clear current suspension
    user.currentSuspension = {
      isActive: false
    };

    await user.save();
  }

  logger.info(`User ${user.email} reactivated by admin ${req.user.email}`);

  res.status(200).json({
    status: 'success',
    message: 'User reactivated successfully',
    data: {
      user: {
        id: user._id,
        status: user.status,
        active: user.active,
        isSuspended: false,
        currentSuspension: user.currentSuspension
      }
    }
  });
});

// Booking Management
const getAllBookings = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  try {
    let query = {};
    if (status) query.status = status;

    const bookings = await Booking.find(query)
      .populate('userId', 'firstName lastName email')
      .populate('parkingSpaceId', 'name address')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await Booking.countDocuments(query);

    res.status(200).json({
      status: 'success',
      results: bookings.length,
      data: {
        bookings,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total
        }
      }
    });
  } catch (error) {
    // Booking model might not exist yet, return empty data
    res.status(200).json({
      status: 'success',
      results: 0,
      data: {
        bookings: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0
        }
      }
    });
  }
});

const getBookingById = catchAsync(async (req, res, next) => {
  try {
    const booking = await Booking.findById(req.params.bookingId)
      .populate('userId', 'firstName lastName email phoneNumber')
      .populate('parkingSpaceId', 'name address pricing')
      .populate('landlordId', 'firstName lastName email');

    if (!booking) {
      return next(new AppError('Booking not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { booking }
    });
  } catch (error) {
    return next(new AppError('Booking model not available', 500));
  }
});

// Transaction Management - Get ALL transactions from all sources
const getAllTransactions = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status } = req.query;

  try {
    const allTransactions = [];
    
    // 1. Get wallet transactions from all users and calculate platform fees from bookings
    const wallets = await Wallet.find({ isActive: true })
      .populate('userId', 'firstName lastName email phoneNumber');

    logger.info(`📊 Found ${wallets.length} active wallets`);

    for (const wallet of wallets) {
      logger.info(`📊 Wallet ${wallet._id} has ${wallet.transactions.length} transactions`);
      for (const transaction of wallet.transactions) {
        // Filter by status if provided
        if (status && transaction.status !== status) continue;

        // Calculate platform fee from booking if this is a booking transaction AND it's completed
        let platformFee = 0;
        if (transaction.bookingId && (transaction.status === 'completed' || transaction.type === 'capture')) {
          try {
            const booking = await Booking.findById(transaction.bookingId);
            if (booking && booking.pricing && (booking.status === 'completed' || booking.status === 'parked')) {
              // Calculate platform fee: serviceFee (10% of base) + dynamic pricing cut (50% of surge)
              const basePrice = booking.dynamicPricing?.basePrice || booking.pricing.totalAmount;
              const serviceFee = basePrice * 0.10;

              let dynamicCut = 0;
              if (booking.dynamicPricing && booking.dynamicPricing.demandFactor > 0) {
                const dynamicSurge = basePrice * booking.dynamicPricing.demandFactor;
                dynamicCut = dynamicSurge * 0.5;
              }

              platformFee = serviceFee + dynamicCut;
            }
          } catch (err) {
            logger.error('Error calculating platform fee for booking:', err);
          }
        }

        allTransactions.push({
          _id: transaction._id,
          transactionId: transaction.referenceId,
          type: 'wallet',
          subType: transaction.type,
          amount: transaction.amount,
          platformFee: platformFee,
          status: transaction.status,
          description: transaction.description,
          paymentMethod: transaction.paymentMethod,
          userId: wallet.userId,
          bookingId: transaction.bookingId || null,
          metadata: transaction.metadata,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
          source: 'wallet_transaction'
        });
      }
    }

    // 2. Get booking transactions (if Transaction model exists)
    try {
      const bookingTransactions = await Transaction.find(status ? { status } : {})
        .populate('userId', 'firstName lastName email phoneNumber')
        .populate('bookingId', 'startTime endTime dynamicPricing pricing status')
        .populate('parkingSpaceId', 'name address')
        .populate('landlordId', 'firstName lastName email');

      for (const transaction of bookingTransactions) {
        // Calculate platform fee from booking data - only for completed bookings
        let platformFee = 0;
        if (transaction.bookingId && transaction.bookingId.pricing &&
            (transaction.status === 'completed' || transaction.bookingId.status === 'completed' || transaction.bookingId.status === 'parked')) {
          const basePrice = transaction.bookingId.dynamicPricing?.basePrice || transaction.bookingId.pricing.totalAmount;
          const serviceFee = basePrice * 0.10;

          let dynamicCut = 0;
          if (transaction.bookingId.dynamicPricing && transaction.bookingId.dynamicPricing.demandFactor > 0) {
            const dynamicSurge = basePrice * transaction.bookingId.dynamicPricing.demandFactor;
            dynamicCut = dynamicSurge * 0.5;
          }

          platformFee = serviceFee + dynamicCut;
        }

        allTransactions.push({
          _id: transaction._id,
          transactionId: transaction.transactionId,
          type: 'booking',
          subType: transaction.paymentMethod,
          amount: transaction.amount,
          status: transaction.status,
          description: `Booking payment - ${transaction.parkingSpaceId?.name || 'Parking Space'}`,
          paymentMethod: transaction.paymentMethod,
          userId: transaction.userId,
          landlordId: transaction.landlordId,
          bookingId: transaction.bookingId,
          parkingSpaceId: transaction.parkingSpaceId,
          platformFee: platformFee,
          createdAt: transaction.createdAt,
          updatedAt: transaction.updatedAt,
          source: 'booking_transaction'
        });
      }
    } catch (error) {
      logger.info('Transaction model not available, skipping booking transactions');
    }

    // 3. Get receipt transactions
    try {
      const receipts = await Receipt.find(status ? { status } : {})
        .populate('userId', 'firstName lastName email phoneNumber')
        .populate('reviewedBy', 'firstName lastName');

      for (const receipt of receipts) {
        allTransactions.push({
          _id: receipt._id,
          transactionId: `RECEIPT-${receipt._id}`,
          type: 'receipt',
          subType: receipt.status,
          amount: receipt.amount,
          status: receipt.status,
          description: `Receipt ${receipt.status} - ${receipt.senderName} (${receipt.mobileNumber})`,
          paymentMethod: 'receipt_approval',
          userId: receipt.userId,
          reviewedBy: receipt.reviewedBy,
          walletTransactionId: receipt.walletTransactionId,
          receiptImage: receipt.receiptImage,
          createdAt: receipt.createdAt,
          updatedAt: receipt.updatedAt,
          source: 'receipt_transaction'
        });
      }
    } catch (error) {
      logger.info('Receipt model not available, skipping receipt transactions');
    }

    // Sort all transactions by creation date (newest first)
    allTransactions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    // Pagination
    const startIndex = (parseInt(page) - 1) * parseInt(limit);
    const endIndex = startIndex + parseInt(limit);
    const paginatedTransactions = allTransactions.slice(startIndex, endIndex);

    logger.info(`📊 Admin transactions query:`, {
      totalTransactions: allTransactions.length,
      returnedTransactions: paginatedTransactions.length,
      page: parseInt(page),
      limit: parseInt(limit),
      statusFilter: status || 'all'
    });

    res.status(200).json({
      status: 'success',
      results: paginatedTransactions.length,
      data: {
        transactions: paginatedTransactions,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(allTransactions.length / parseInt(limit)),
          totalItems: allTransactions.length
        }
      }
    });

  } catch (error) {
    logger.error('Error fetching admin transactions:', error);
    logger.error('Error stack:', error.stack);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch transactions: ' + error.message,
      data: {
        transactions: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0
        }
      }
    });
  }
});

const getTransactionById = catchAsync(async (req, res, next) => {
  try {
    const transaction = await Transaction.findById(req.params.transactionId)
      .populate('userId', 'firstName lastName email')
      .populate('bookingId', 'startTime endTime parkingSpaceId')
      .populate('landlordId', 'firstName lastName email');

    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { transaction }
    });
  } catch (error) {
    return next(new AppError('Transaction model not available', 500));
  }
});

const processRefund = catchAsync(async (req, res, next) => {
  const { amount, reason } = req.body;

  try {
    // Find the wallet transaction to refund
    const walletTransaction = await Wallet.findOne({
      'transactions._id': req.params.transactionId
    });

    if (!walletTransaction) {
      return next(new AppError('Transaction not found', 404));
    }

    // Find the specific transaction within the wallet
    const transaction = walletTransaction.transactions.id(req.params.transactionId);

    if (!transaction) {
      return next(new AppError('Transaction not found', 404));
    }

    if (transaction.status === 'refunded') {
      return next(new AppError('Transaction already refunded', 400));
    }

    // Get the refund amount (use transaction amount if not specified)
    const refundAmount = amount || transaction.amount;

    // Update transaction to refunded status
    transaction.status = 'refunded';
    transaction.refundedAt = new Date();
    transaction.refundedBy = req.user.id;
    transaction.refundReason = reason || 'Admin refund';

    // Add the refund amount back to the wallet balance
    walletTransaction.balance += refundAmount;

    // Create a new refund transaction record
    walletTransaction.transactions.push({
      type: 'refund',
      amount: refundAmount,
      description: `Refund for transaction ${transaction.transactionId}`,
      status: 'completed',
      completedAt: new Date(),
      metadata: {
        originalTransactionId: transaction._id,
        refundedBy: req.user.id,
        reason: reason || 'Admin refund'
      }
    });

    await walletTransaction.save();

    logger.info(`Refund processed for transaction ${transaction._id} by admin ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'Refund processed successfully',
      data: {
        transaction,
        refundAmount,
        newBalance: walletTransaction.balance
      }
    });
  } catch (error) {
    logger.error('Error processing refund:', error);
    return next(new AppError('Failed to process refund', 500));
  }
});

// User Creation and Updates
const createUser = catchAsync(async (req, res, next) => {
  const { userType, firstName, lastName, email, phoneNumber, password } = req.body;
  
  try {
    // Import helper functions
    const { findUserByEmail, createUser } = require('../models/UserModels');
    
    // Check if user already exists
    const existingUser = await findUserByEmail(email);
    if (existingUser) {
      return next(new AppError('User with this email already exists', 400));
    }

    // Create new user with appropriate discriminator model
    const newUser = await createUser({
      firstName,
      lastName,
      email,
      phoneNumber,
      password,
      userType,
      isEmailVerified: true, // Admin-created users are pre-verified
      active: true,
      createdBy: req.user.id
    });

    await newUser.save();

    logger.info(`New ${userType} created by admin ${req.user.email}: ${email}`);

    res.status(201).json({
      status: 'success',
      message: `${userType} created successfully`,
      data: {
        user: {
          id: newUser._id,
          firstName: newUser.firstName,
          lastName: newUser.lastName,
          email: newUser.email,
          phoneNumber: newUser.phoneNumber,
          userType: newUser.userType,
          isVerified: newUser.isVerified,
          createdAt: newUser.createdAt
        }
      }
    });
  } catch (error) {
    logger.error('Error creating user:', error);
    return next(new AppError('Failed to create user', 500));
  }
});

const updateUser = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const updateData = req.body;
  
  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Update user fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined && key !== 'password') {
        user[key] = updateData[key];
      }
    });

    user.updatedAt = new Date();
    user.updatedBy = req.user.id;

    await user.save();

    logger.info(`User ${userId} updated by admin ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'User updated successfully',
      data: { user }
    });
  } catch (error) {
    logger.error('Error updating user:', error);
    return next(new AppError('Failed to update user', 500));
  }
});

// Parking Space Creation and Updates
const createParkingSpace = catchAsync(async (req, res, next) => {
  const { 
    title, 
    description, 
    address, 
    coordinates, 
    pricePerHour, 
    availability, 
    features,
    ownerId 
  } = req.body;
  
  try {
    // Check if owner exists
    const owner = await User.findById(ownerId);
    if (!owner || owner.userType !== 'landlord') {
      return next(new AppError('Invalid landlord ID', 400));
    }

    const newSpace = new ParkingSpace({
      title,
      description,
      address,
      coordinates,
      pricePerHour,
      availability,
      features: features || [],
      owner: ownerId,
      isApproved: true, // Admin-created spaces are pre-approved
      status: 'active',
      createdBy: req.user.id,
      approvedBy: req.user.id,
      approvedAt: new Date()
    });

    await newSpace.save();

    logger.info(`New parking space created by admin ${req.user.email}: ${title}`);

    res.status(201).json({
      status: 'success',
      message: 'Parking space created successfully',
      data: { space: newSpace }
    });
  } catch (error) {
    logger.error('Error creating parking space:', error);
    return next(new AppError('Failed to create parking space', 500));
  }
});

const updateParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const updateData = req.body;
  
  try {
    const space = await ParkingSpace.findById(spaceId);
    if (!space) {
      return next(new AppError('Parking space not found', 404));
    }

    // Update space fields
    Object.keys(updateData).forEach(key => {
      if (updateData[key] !== undefined) {
        space[key] = updateData[key];
      }
    });

    space.updatedAt = new Date();
    space.updatedBy = req.user.id;

    await space.save();

    logger.info(`Parking space ${spaceId} updated by admin ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'Parking space updated successfully',
      data: { space }
    });
  } catch (error) {
    logger.error('Error updating parking space:', error);
    return next(new AppError('Failed to update parking space', 500));
  }
});

// Admin: Get a user's wallet
const getUserWallet = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  let wallet = await Wallet.findByUserId(userId);
  if (!wallet) {
    wallet = await Wallet.createWallet(userId, 0);
  }
  res.status(200).json({
    status: 'success',
    data: {
      wallet: {
        userId: wallet.userId,
        availableBalance: wallet.availableBalance,
        totalBalance: wallet.totalBalance,
        isActive: wallet.isActive,
        transactions: wallet.transactions.slice(-50)
      }
    }
  });
});

// Admin: Credit a user's wallet (manual top-up)
const creditUserWallet = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { amount, description } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const wallet = await Wallet.findByUserId(userId) || await Wallet.createWallet(userId, 0);
    const previousBalance = wallet.availableBalance;

    await wallet.addTransaction({
      type: 'credit',
      amount,
      description: description || 'Manual credit by admin',
      paymentMethod: 'wallet_transfer',
      status: 'completed'
    });
    await wallet.updateBalance(amount, 'credit');

    // Log admin action
    await AdminActionLog.logAction({
      adminId: req.user._id,
      adminName: `${req.user.firstName} ${req.user.lastName}`,
      adminEmail: req.user.email,
      action: 'wallet_credit',
      actionDescription: `Credited ₱${amount} to ${user.firstName} ${user.lastName}'s wallet`,
      targetUserId: userId,
      targetUserEmail: user.email,
      targetUserName: `${user.firstName} ${user.lastName}`,
      targetUserType: user.role,
      details: {
        amount: amount,
        walletAction: 'credit',
        previousBalance: previousBalance,
        newBalance: wallet.availableBalance,
        reason: description || 'Manual credit by admin'
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      status: 'success'
    });

    res.status(200).json({
      status: 'success',
      message: 'Wallet credited successfully',
      data: {
        balance: wallet.availableBalance,
        previousBalance: previousBalance,
        amountAdded: amount
      }
    });
  } catch (error) {
    logger.error('Error crediting wallet:', error);
    return next(new AppError('Failed to credit wallet', 500));
  }
});

// Admin: Debit a user's wallet (manual adjustment)
const debitUserWallet = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { amount, description } = req.body;

  if (!amount || amount <= 0) {
    return next(new AppError('Amount must be greater than 0', 400));
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Check if user is suspended and restrict debit operations
    if (user.status === 'suspended') {
      return next(new AppError('Cannot debit wallet of suspended user', 403));
    }

    const wallet = await Wallet.findByUserId(userId);
    if (!wallet) {
      return next(new AppError('Wallet not found', 404));
    }
    if (!wallet.hasSufficientBalance(amount)) {
      return next(new AppError('Insufficient wallet balance', 400));
    }

    const previousBalance = wallet.availableBalance;

    await wallet.addTransaction({
      type: 'debit',
      amount,
      description: description || 'Manual debit by admin',
      status: 'completed'
    });
    await wallet.updateBalance(amount, 'debit');

    // Log admin action
    await AdminActionLog.logAction({
      adminId: req.user._id,
      adminName: `${req.user.firstName} ${req.user.lastName}`,
      adminEmail: req.user.email,
      action: 'wallet_debit',
      actionDescription: `Debited ₱${amount} from ${user.firstName} ${user.lastName}'s wallet`,
      targetUserId: userId,
      targetUserEmail: user.email,
      targetUserName: `${user.firstName} ${user.lastName}`,
      targetUserType: user.role,
      details: {
        amount: amount,
        walletAction: 'debit',
        previousBalance: previousBalance,
        newBalance: wallet.availableBalance,
        reason: description || 'Manual debit by admin'
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      status: 'success'
    });

    res.status(200).json({
      status: 'success',
      message: 'Wallet debited successfully',
      data: {
        balance: wallet.availableBalance,
        previousBalance: previousBalance,
        amountDeducted: amount
      }
    });
  } catch (error) {
    logger.error('Error debiting wallet:', error);
    return next(new AppError('Failed to debit wallet', 500));
  }
});

// Support Ticket Management
const getAllTickets = catchAsync(async (req, res) => {
  const { page = 1, limit = 10, status, priority } = req.query;

  try {
    let query = {};
    if (status) query.status = status;
    if (priority) query.priority = priority;

    const tickets = await SupportTicket.find(query)
      .populate('userId', 'firstName lastName email')
      .populate('assignedTo', 'firstName lastName')
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    const total = await SupportTicket.countDocuments(query);

    res.status(200).json({
      status: 'success',
      results: tickets.length,
      data: {
        tickets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total
        }
      }
    });
  } catch (error) {
    // Support ticket model might not exist yet
    res.status(200).json({
      status: 'success',
      results: 0,
      data: {
        tickets: [],
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0
        }
      }
    });
  }
});

const getTicketById = catchAsync(async (req, res, next) => {
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId)
      .populate('userId', 'firstName lastName email phoneNumber')
      .populate('assignedTo', 'firstName lastName email')
      .populate('messages.senderId', 'firstName lastName');

    if (!ticket) {
      return next(new AppError('Support ticket not found', 404));
    }

    res.status(200).json({
      status: 'success',
      data: { ticket }
    });
  } catch (error) {
    return next(new AppError('Support ticket model not available', 500));
  }
});

const updateTicketStatus = catchAsync(async (req, res, next) => {
  const { status } = req.body;
  
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId);
    
    if (!ticket) {
      return next(new AppError('Support ticket not found', 404));
    }

    ticket.status = status;
    if (status === 'resolved' || status === 'closed') {
      ticket.resolvedAt = new Date();
      ticket.resolvedBy = req.user.id;
    }

    await ticket.save();

    logger.info(`Ticket ${ticket.ticketId} status updated to ${status} by admin ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'Ticket status updated successfully',
      data: { ticket }
    });
  } catch (error) {
    return next(new AppError('Support ticket model not available', 500));
  }
});

const addTicketMessage = catchAsync(async (req, res, next) => {
  const { content } = req.body;
  
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId);
    
    if (!ticket) {
      return next(new AppError('Support ticket not found', 404));
    }

    await ticket.addMessage(req.user.id, 'admin', content);

    logger.info(`Message added to ticket ${ticket.ticketId} by admin ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'Message added successfully'
    });
  } catch (error) {
    return next(new AppError('Support ticket model not available', 500));
  }
});

const assignTicket = catchAsync(async (req, res, next) => {
  const { adminId } = req.body;
  
  try {
    const ticket = await SupportTicket.findById(req.params.ticketId);
    
    if (!ticket) {
      return next(new AppError('Support ticket not found', 404));
    }

    ticket.assignedTo = adminId;
    ticket.assignedAt = new Date();
    
    if (ticket.status === 'open') {
      ticket.status = 'in_progress';
    }

    await ticket.save();

    logger.info(`Ticket ${ticket.ticketId} assigned to admin ${adminId} by ${req.user.email}`);

    res.status(200).json({
      status: 'success',
      message: 'Ticket assigned successfully'
    });
  } catch (error) {
    return next(new AppError('Support ticket model not available', 500));
  }
});

// Landlord ID Verification Management
const getLandlordApplications = catchAsync(async (req, res) => {
  const { 
    page = 1, 
    limit = 20, 
    status,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = req.query;

  try {
    logger.info('🔍 Fetching landlord applications', {
      page: parseInt(page),
      limit: parseInt(limit),
      status,
      sortBy,
      sortOrder,
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    // Build query for landlords with ID verification
    let query = { 
      role: 'landlord'
    };

    // Filter by verification status
    if (status) {
      if (status === 'pending') {
        query.$and = [
          { idVerification: { $exists: true } },
          { 'idVerification.verificationStatus': 'under_review' }
        ];
      } else if (status === 'approved') {
        query['idVerification.verificationStatus'] = 'approved';
      } else if (status === 'rejected') {
        query['idVerification.verificationStatus'] = 'rejected';
      } else if (status === 'incomplete') {
        query.idVerification = { $exists: false };
      }
    } else {
      // Show only landlords who have submitted ID verification
      query.idVerification = { $exists: true };
    }

    logger.debug('🔍 Query built:', { query: JSON.stringify(query) });

    const sortOption = {};
    if (sortBy === 'submittedAt') {
      sortOption['idVerification.submittedAt'] = sortOrder === 'desc' ? -1 : 1;
    } else {
      sortOption[sortBy] = sortOrder === 'desc' ? -1 : 1;
    }

    logger.debug('🔍 Sort options:', { sortOption });

    const landlords = await User.find(query)
      .select('firstName lastName email phoneNumber createdAt idVerification emailVerification')
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));

    logger.info('📊 Landlord applications found', {
      count: landlords.length,
      query: JSON.stringify(query),
      page: parseInt(page),
      limit: parseInt(limit)
    });

    const total = await User.countDocuments(query);

    logger.debug('📊 Total count:', { total });

    // Transform data for admin panel
    const transformedLandlords = landlords.map(landlord => {
      const obj = landlord.toObject();
      
      const transformed = {
        _id: obj._id,
        fullName: `${obj.firstName} ${obj.lastName}`,
        firstName: obj.firstName,
        lastName: obj.lastName,
        email: obj.email,
        phoneNumber: obj.phoneNumber,
        registeredAt: obj.createdAt,
        phoneVerified: !!obj.phoneNumber, // Phone verification completed if they made it this far
        emailVerified: obj.emailVerification?.isVerified || false,
        idVerification: obj.idVerification ? {
          status: obj.idVerification.verificationStatus,
          verificationStatus: obj.idVerification.verificationStatus, // Add this for compatibility
          idType: obj.idVerification.idType,
          submittedAt: obj.idVerification.submittedAt,
          reviewedAt: obj.idVerification.reviewedAt,
          rejectionReason: obj.idVerification.rejectionReason,
          hasPhotos: !!(obj.idVerification.idFrontUrl && obj.idVerification.idBackUrl && obj.idVerification.selfieUrl),
          // Add photo URLs for frontend
          idFrontUrl: obj.idVerification.idFrontUrl,
          idBackUrl: obj.idVerification.idBackUrl,
          selfieUrl: obj.idVerification.selfieUrl
        } : null,
        registrationAge: Math.floor((new Date() - new Date(obj.createdAt)) / (1000 * 60 * 60 * 24)) // days
      };

      logger.debug('🔍 Transformed landlord:', {
        id: transformed._id,
        name: transformed.fullName,
        hasIdVerification: !!transformed.idVerification,
        verificationStatus: transformed.idVerification?.verificationStatus,
        hasPhotos: transformed.idVerification?.hasPhotos
      });

      return transformed;
    });

    logger.info('✅ Landlord applications transformed successfully', {
      transformedCount: transformedLandlords.length,
      sampleData: transformedLandlords[0] ? {
        id: transformedLandlords[0]._id,
        name: transformedLandlords[0].fullName,
        hasIdVerification: !!transformedLandlords[0].idVerification,
        verificationStatus: transformedLandlords[0].idVerification?.verificationStatus
      } : 'No data'
    });

    res.status(200).json({
      status: 'success',
      results: transformedLandlords.length,
      data: {
        landlords: transformedLandlords,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          hasNextPage: page * limit < total,
          hasPrevPage: page > 1
        }
      }
    });

  } catch (error) {
    logger.error('❌ Error fetching landlord applications:', {
      error: error.message,
      stack: error.stack,
      page: parseInt(page),
      limit: parseInt(limit),
      status
    });
    throw error;
  }
});

const getLandlordApplicationById = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  const landlord = await User.findById(userId)
    .select('firstName lastName email phoneNumber createdAt idVerification emailVerification role');

  if (!landlord) {
    return next(new AppError('Landlord not found', 404));
  }

  if (landlord.role !== 'landlord') {
    return next(new AppError('User is not a landlord', 400));
  }

  // Get additional stats
  const parkingSpacesCount = await ParkingSpace.countDocuments({ landlordId: userId });
  
  res.status(200).json({
    status: 'success',
    data: {
      landlord: {
        _id: landlord._id,
        fullName: `${landlord.firstName} ${landlord.lastName}`,
        firstName: landlord.firstName,
        lastName: landlord.lastName,
        email: landlord.email,
        phoneNumber: landlord.phoneNumber,
        registeredAt: landlord.createdAt,
        phoneVerified: !!landlord.phoneNumber,
        emailVerified: landlord.emailVerification?.isVerified || false,
        idVerification: landlord.idVerification,
        stats: {
          parkingSpaces: parkingSpacesCount,
          registrationAge: Math.floor((new Date() - new Date(landlord.createdAt)) / (1000 * 60 * 60 * 24))
        }
      }
    }
  });
});

const approveLandlordApplication = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { adminNotes } = req.body;
  const adminId = req.user.id;

  const landlord = await User.findById(userId);

  if (!landlord) {
    return next(new AppError('Landlord not found', 404));
  }

  if (!landlord.idVerification) {
    return next(new AppError('No ID verification found for this landlord', 404));
  }

  if (landlord.idVerification.verificationStatus !== 'under_review') {
    return next(new AppError('This application has already been reviewed', 400));
  }

  // Update verification status
  landlord.idVerification.verificationStatus = 'approved';
  landlord.idVerification.reviewedAt = new Date();
  landlord.idVerification.reviewedBy = adminId;
  landlord.idVerification.rejectionReason = undefined;

  // Mark landlord as verified and activate account
  landlord.isVerifiedLandlord = true;
  landlord.active = true; // Allow landlord to login

  await landlord.save();

  // Send SMS notification to landlord about approval
  try {
    if (landlord.phoneNumber) {
      const message = `🎉 Congratulations ${landlord.firstName}! Your ParkTayo landlord application has been APPROVED. You can now start listing your parking spaces. Welcome to the ParkTayo family!`;
      await smsService.sendSMS(landlord.phoneNumber, message);
      logger.info('✅ Approval SMS sent to landlord', {
        landlordId: landlord._id,
        phoneNumber: landlord.phoneNumber
      });
    }
  } catch (smsError) {
    logger.error('❌ Failed to send approval SMS:', {
      landlordId: landlord._id,
      phoneNumber: landlord.phoneNumber,
      error: smsError.message
    });
    // Don't fail the approval process if SMS fails
  }

  logger.info('Landlord application approved', {
    landlordId: landlord._id,
    landlordEmail: landlord.email,
    adminId: adminId,
    adminNotes: adminNotes
  });

  res.status(200).json({
    status: 'success',
    message: 'Landlord application approved successfully',
    data: {
      landlord: {
        _id: landlord._id,
        fullName: `${landlord.firstName} ${landlord.lastName}`,
        verificationStatus: landlord.idVerification.verificationStatus,
        reviewedAt: landlord.idVerification.reviewedAt
      }
    }
  });
});

const rejectLandlordApplication = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { rejectionReason, adminNotes } = req.body;
  const adminId = req.user.id;

  if (!rejectionReason) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const landlord = await User.findById(userId);

  if (!landlord) {
    return next(new AppError('Landlord not found', 404));
  }

  if (!landlord.idVerification) {
    return next(new AppError('No ID verification found for this landlord', 404));
  }

  if (landlord.idVerification.verificationStatus !== 'under_review') {
    return next(new AppError('This application has already been reviewed', 400));
  }

  // Update verification status
  landlord.idVerification.verificationStatus = 'rejected';
  landlord.idVerification.reviewedAt = new Date();
  landlord.idVerification.reviewedBy = adminId;
  landlord.idVerification.rejectionReason = rejectionReason;

  // Keep landlord as unverified and inactive (cannot login)
  landlord.isVerifiedLandlord = false;
  // Note: landlord.active remains false - they cannot login until approved

  await landlord.save();

  // Send SMS notification to landlord about rejection
  try {
    if (landlord.phoneNumber) {
      const message = `❌ Dear ${landlord.firstName}, your ParkTayo landlord application has been declined. Reason: ${rejectionReason}. You may resubmit after addressing the concerns. Contact support for assistance.`;
      await smsService.sendSMS(landlord.phoneNumber, message);
      logger.info('✅ Rejection SMS sent to landlord', {
        landlordId: landlord._id,
        phoneNumber: landlord.phoneNumber,
        rejectionReason
      });
    }
  } catch (smsError) {
    logger.error('❌ Failed to send rejection SMS:', {
      landlordId: landlord._id,
      phoneNumber: landlord.phoneNumber,
      rejectionReason,
      error: smsError.message
    });
    // Don't fail the rejection process if SMS fails
  }

  logger.info('Landlord application rejected', {
    landlordId: landlord._id,
    landlordEmail: landlord.email,
    adminId: adminId,
    rejectionReason: rejectionReason
  });

  res.status(200).json({
    status: 'success',
    message: 'Landlord application rejected',
    data: {
      landlord: {
        _id: landlord._id,
        fullName: `${landlord.firstName} ${landlord.lastName}`,
        verificationStatus: landlord.idVerification.verificationStatus,
        reviewedAt: landlord.idVerification.reviewedAt,
        rejectionReason: rejectionReason
      }
    }
  });
});

const getLandlordApplicationStats = catchAsync(async (req, res) => {
  try {
    logger.info('📊 Fetching landlord application stats', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    });

    const [
      totalApplications,
      pendingApplications,
      approvedApplications,
      rejectedApplications,
      incompleteApplications
    ] = await Promise.all([
      User.countDocuments({ role: 'landlord', idVerification: { $exists: true } }),
      User.countDocuments({ role: 'landlord', 'idVerification.verificationStatus': 'under_review' }),
      User.countDocuments({ role: 'landlord', 'idVerification.verificationStatus': 'approved' }),
      User.countDocuments({ role: 'landlord', 'idVerification.verificationStatus': 'rejected' }),
      User.countDocuments({ role: 'landlord', idVerification: { $exists: false } })
    ]);

    const stats = {
      total: totalApplications,
      pending: pendingApplications,
      approved: approvedApplications,
      rejected: rejectedApplications,
      incomplete: incompleteApplications
    };

    logger.info('✅ Landlord application stats fetched successfully', {
      stats,
      totalApplications,
      pendingApplications,
      approvedApplications,
      rejectedApplications,
      incompleteApplications
    });

    res.status(200).json({
      status: 'success',
      data: stats
    });

  } catch (error) {
    logger.error('❌ Error fetching landlord application stats:', {
      error: error.message,
      stack: error.stack
    });
    throw error;
  }
});

// Fix verified landlords - set correct flags for approved ID verifications
const fixVerifiedLandlords = catchAsync(async (req, res, next) => {
  const adminId = req.user.id;

  logger.info('🔧 Admin fixing verified landlords', {
    adminId,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Find landlords with approved ID verification but incorrect flags
  const landlordsToFix = await User.find({
    role: 'landlord',
    'idVerification.verificationStatus': 'approved',
    $or: [
      { isVerifiedLandlord: { $ne: true } },
      { active: { $ne: true } }
    ]
  });

  logger.info(`Found ${landlordsToFix.length} landlords to fix`);

  let fixedCount = 0;
  for (const landlord of landlordsToFix) {
    const before = {
      isVerifiedLandlord: landlord.isVerifiedLandlord,
      active: landlord.active
    };

    // Update the flags
    landlord.isVerifiedLandlord = true;
    landlord.active = true;

    await landlord.save();
    fixedCount++;

    logger.info('✅ Fixed landlord flags', {
      landlordId: landlord._id,
      email: landlord.email,
      before,
      after: {
        isVerifiedLandlord: landlord.isVerifiedLandlord,
        active: landlord.active
      }
    });
  }

  res.status(200).json({
    status: 'success',
    message: `Fixed ${fixedCount} verified landlords`,
    data: {
      fixedCount,
      landlordsFixed: landlordsToFix.map(l => ({
        id: l._id,
        email: l.email,
        name: `${l.firstName} ${l.lastName}`
      }))
    }
  });
});

// Get system settings
const getSystemSettings = catchAsync(async (req, res, next) => {
  try {
    const allSettings = await SystemSettings.getAllSettings();

    res.status(200).json({
      status: 'success',
      data: allSettings
    });
  } catch (error) {
    logger.error('Error fetching system settings:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to fetch system settings',
      error: error.message
    });
  }
});

// Update system settings
const updateSystemSettings = catchAsync(async (req, res, next) => {
  try {
    const { settingsType, settings } = req.body;
    const adminId = req.user.id;

    if (!settingsType || !settings) {
      return next(new AppError('Settings type and settings data are required', 400));
    }

    // Validate settingsType
    const validTypes = ['General', 'Security', 'Notification', 'Payment', 'API', 'AppVersion', 'Maintenance'];
    if (!validTypes.includes(settingsType)) {
      return next(new AppError('Invalid settings type', 400));
    }

    // Update the settings
    const updatedSettings = await SystemSettings.updateSettings(settingsType, settings, adminId);

    logger.info('✅ System settings updated successfully', {
      settingsType,
      adminId,
      version: updatedSettings.version
    });

    res.status(200).json({
      status: 'success',
      message: `${settingsType} settings updated successfully`,
      data: {
        settingsType: updatedSettings.settingsType,
        settings: updatedSettings.settings,
        version: updatedSettings.version,
        lastUpdated: updatedSettings.updatedAt
      }
    });
  } catch (error) {
    logger.error('Error updating system settings:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to update system settings',
      error: error.message
    });
  }
});

// App Version Management
// Get all pending payout requests
const getPendingPayouts = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20, status = 'pending' } = req.query;

  // Find all wallets with payout transactions
  const { Wallet } = require('../models/Wallet');
  const User = require('../models/User');

  // Always find wallets with transfer_out transactions
  const wallets = await Wallet.find({
    'transactions.type': 'transfer_out'
  }).populate('userId', 'firstName lastName email phoneNumber');

  // Extract payout transactions based on status
  const payouts = [];
  for (const wallet of wallets) {
    // Filter transactions by type and status
    const payoutTransactions = wallet.transactions.filter(t => {
      if (t.type !== 'transfer_out') return false;
      if (status === 'all') return true;
      return t.status === status;
    });

    for (const transaction of payoutTransactions) {
      payouts.push({
        _id: transaction._id,
        userId: wallet.userId,
        userName: wallet.userId ? `${wallet.userId.firstName} ${wallet.userId.lastName}` : 'Unknown',
        userEmail: wallet.userId ? wallet.userId.email : '',
        amount: transaction.amount,
        bankAccount: transaction.metadata?.get('bankAccount') || '',
        accountName: transaction.metadata?.get('accountName') || '',
        notes: transaction.metadata?.get('notes') || '',
        requestedAt: transaction.metadata?.get('requestedAt') || transaction.createdAt,
        holdReference: transaction.holdReference,
        referenceId: transaction.referenceId,
        status: transaction.status,
        walletId: wallet._id,
        approvedAt: transaction.metadata?.get('approvedAt')
      });
    }
  }

  // Sort by requested date (newest first)
  payouts.sort((a, b) => new Date(b.requestedAt) - new Date(a.requestedAt));

  // Calculate statistics
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const processedToday = payouts.filter(p => {
    if (p.status === 'completed' && p.approvedAt) {
      const approvedDate = new Date(p.approvedAt);
      return approvedDate >= today && approvedDate < tomorrow;
    }
    return false;
  }).length;

  const pendingCount = payouts.filter(p => p.status === 'pending').length;
  const totalPendingAmount = payouts
    .filter(p => p.status === 'pending')
    .reduce((sum, p) => sum + p.amount, 0);

  // Pagination
  const startIndex = (parseInt(page) - 1) * parseInt(limit);
  const endIndex = startIndex + parseInt(limit);
  const paginatedPayouts = payouts.slice(startIndex, endIndex);

  res.status(200).json({
    status: 'success',
    results: paginatedPayouts.length,
    data: {
      payouts: paginatedPayouts,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(payouts.length / parseInt(limit)),
        totalItems: payouts.length
      },
      statistics: {
        processedToday,
        pendingCount,
        totalPendingAmount
      }
    }
  });
});

// Approve a payout request
const approvePayout = catchAsync(async (req, res, next) => {
  const { payoutId } = req.params;
  const { adminNotes, processingMethod = 'manual' } = req.body;
  const adminId = req.user.id;

  const { Wallet } = require('../models/Wallet');

  // Find the wallet containing this payout transaction
  const wallet = await Wallet.findOne({
    'transactions._id': payoutId
  }).populate('userId', 'firstName lastName email');

  if (!wallet) {
    return next(new AppError('Payout request not found', 404));
  }

  const payoutTransaction = wallet.transactions.id(payoutId);

  if (!payoutTransaction) {
    return next(new AppError('Payout transaction not found', 404));
  }

  if (payoutTransaction.status !== 'pending') {
    return next(new AppError('Payout request has already been processed', 400));
  }

  // Update transaction status to completed
  payoutTransaction.status = 'completed';
  payoutTransaction.metadata.set('approvedBy', adminId.toString());
  payoutTransaction.metadata.set('approvedAt', new Date().toISOString());
  payoutTransaction.metadata.set('adminNotes', adminNotes || '');
  payoutTransaction.metadata.set('processingMethod', processingMethod);

  await wallet.save();

  logger.info(`Payout approved by admin ${adminId}:`, {
    payoutId,
    userId: wallet.userId._id,
    amount: payoutTransaction.amount,
    bankAccount: payoutTransaction.metadata.get('bankAccount')
  });

  // TODO: Trigger actual bank transfer or payment gateway integration here

  res.status(200).json({
    status: 'success',
    message: 'Payout approved and processed successfully',
    data: {
      payout: {
        _id: payoutTransaction._id,
        userId: wallet.userId._id,
        userName: `${wallet.userId.firstName} ${wallet.userId.lastName}`,
        amount: payoutTransaction.amount,
        status: payoutTransaction.status,
        approvedBy: adminId,
        approvedAt: payoutTransaction.metadata.get('approvedAt')
      }
    }
  });
});

// Reject a payout request
const rejectPayout = catchAsync(async (req, res, next) => {
  const { payoutId } = req.params;
  const { rejectionReason, adminNotes } = req.body;
  const adminId = req.user.id;

  if (!rejectionReason) {
    return next(new AppError('Rejection reason is required', 400));
  }

  const { Wallet } = require('../models/Wallet');

  // Find the wallet containing this payout transaction
  const wallet = await Wallet.findOne({
    'transactions._id': payoutId
  }).populate('userId', 'firstName lastName email');

  if (!wallet) {
    return next(new AppError('Payout request not found', 404));
  }

  const payoutTransaction = wallet.transactions.id(payoutId);

  if (!payoutTransaction) {
    return next(new AppError('Payout transaction not found', 404));
  }

  if (payoutTransaction.status !== 'pending') {
    return next(new AppError('Payout request has already been processed', 400));
  }

  // Release the held amount (refund to user's available balance)
  if (payoutTransaction.holdReference) {
    await wallet.releaseHold(payoutTransaction.holdReference, `Payout rejected: ${rejectionReason}`);
  }

  // Update transaction status to rejected/cancelled
  payoutTransaction.status = 'cancelled';
  payoutTransaction.metadata.set('rejectedBy', adminId.toString());
  payoutTransaction.metadata.set('rejectedAt', new Date().toISOString());
  payoutTransaction.metadata.set('rejectionReason', rejectionReason);
  payoutTransaction.metadata.set('adminNotes', adminNotes || '');

  await wallet.save();

  logger.info(`Payout rejected by admin ${adminId}:`, {
    payoutId,
    userId: wallet.userId._id,
    amount: payoutTransaction.amount,
    reason: rejectionReason
  });

  res.status(200).json({
    status: 'success',
    message: 'Payout request rejected and funds returned to user wallet',
    data: {
      payout: {
        _id: payoutTransaction._id,
        userId: wallet.userId._id,
        userName: `${wallet.userId.firstName} ${wallet.userId.lastName}`,
        amount: payoutTransaction.amount,
        status: payoutTransaction.status,
        rejectedBy: adminId,
        rejectedAt: payoutTransaction.metadata.get('rejectedAt'),
        rejectionReason
      }
    }
  });
});

// Create a support user with limited permissions
const createSupportUser = catchAsync(async (req, res, next) => {
  const { email, password, firstName, lastName, phoneNumber, department = 'customer_support', adminLevel = 'support' } = req.body;
  const adminId = req.user.id;

  if (!email || !password || !firstName || !lastName) {
    return next(new AppError('Email, password, first name, and last name are required', 400));
  }

  const Admin = require('../models/Admin');

  // Check if admin already exists
  const existingAdmin = await Admin.findOne({ email });
  if (existingAdmin) {
    return next(new AppError('Admin with this email already exists', 400));
  }

  // Don't hash password here - BaseUser pre-save hook will handle it automatically

  // Define permissions based on adminLevel
  const permissionsByLevel = {
    support: [
      'user_management',
      'space_management',
      'booking_management',
      'support_tickets',
      'analytics_access'
    ],
    moderator: [
      'user_management',
      'space_management',
      'booking_management',
      'support_tickets',
      'analytics_access',
      'content_management'
    ],
    admin: [
      'user_management',
      'space_management',
      'booking_management',
      'financial_management',
      'content_management',
      'analytics_access',
      'support_tickets',
      'verification_approval'
    ],
    super_admin: [
      'user_management',
      'space_management',
      'booking_management',
      'financial_management',
      'content_management',
      'system_settings',
      'analytics_access',
      'support_tickets',
      'verification_approval',
      'emergency_actions'
    ]
  };

  // Create admin user with appropriate permissions
  const adminData = {
    email,
    password: password, // BaseUser pre-save hook will hash this automatically
    firstName,
    lastName,
    adminLevel: adminLevel,
    department,
    permissions: permissionsByLevel[adminLevel] || permissionsByLevel.support,
    active: true,
    isEmailVerified: true
  };

  // Only add phoneNumber if it's provided and not empty
  if (phoneNumber && phoneNumber.trim()) {
    adminData.phoneNumber = phoneNumber.trim();
  }

  const newAdmin = await Admin.create(adminData);

  logger.info(`Admin user created by super admin ${adminId}:`, {
    newAdminId: newAdmin._id,
    email: newAdmin.email,
    adminLevel: newAdmin.adminLevel,
    createdBy: adminId
  });

  res.status(201).json({
    status: 'success',
    message: `${adminLevel} user created successfully`,
    data: {
      admin: {
        _id: newAdmin._id,
        email: newAdmin.email,
        firstName: newAdmin.firstName,
        lastName: newAdmin.lastName,
        adminLevel: newAdmin.adminLevel,
        department: newAdmin.department,
        permissions: newAdmin.permissions
      }
    }
  });
});

// Get all admin users
const getAllAdminUsers = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 20 } = req.query;

  const Admin = require('../models/Admin');

  // Get all users from Admin model (discriminator pattern - no need to filter by role)
  const admins = await Admin.find()
    .select('-password -twoFactorSecret')
    .sort({ createdAt: -1 })
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await Admin.countDocuments();

  res.status(200).json({
    status: 'success',
    results: admins.length,
    data: {
      admins,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      }
    }
  });
});

// Update admin permissions (super_admin only)
const updateAdminPermissions = catchAsync(async (req, res, next) => {
  const { adminUserId } = req.params;
  const { permissions, adminLevel } = req.body;
  const requestingAdminId = req.user.id;

  const Admin = require('../models/Admin');

  // Check if requesting admin is super_admin
  const requestingAdmin = await Admin.findById(requestingAdminId);
  if (requestingAdmin.adminLevel !== 'super_admin') {
    return next(new AppError('Only super admins can update admin permissions', 403));
  }

  const adminUser = await Admin.findById(adminUserId);
  if (!adminUser) {
    return next(new AppError('Admin user not found', 404));
  }

  // Update permissions if provided
  if (permissions) {
    adminUser.permissions = permissions;
  }

  // Update admin level if provided
  if (adminLevel) {
    adminUser.adminLevel = adminLevel;
  }

  await adminUser.save();

  logger.info(`Admin permissions updated by ${requestingAdminId}:`, {
    targetAdminId: adminUserId,
    newPermissions: adminUser.permissions,
    newAdminLevel: adminUser.adminLevel
  });

  res.status(200).json({
    status: 'success',
    message: 'Admin permissions updated successfully',
    data: {
      admin: {
        _id: adminUser._id,
        email: adminUser.email,
        adminLevel: adminUser.adminLevel,
        permissions: adminUser.permissions
      }
    }
  });
});

// Delete admin user (super_admin only)
const deleteAdminUser = catchAsync(async (req, res, next) => {
  const { adminUserId } = req.params;
  const requestingAdminId = req.user.id;

  const Admin = require('../models/Admin');

  // Check if requesting admin is super_admin
  const requestingAdmin = await Admin.findById(requestingAdminId);
  if (requestingAdmin.adminLevel !== 'super_admin') {
    return next(new AppError('Only super admins can delete admin users', 403));
  }

  const adminToDelete = await Admin.findById(adminUserId);
  if (!adminToDelete) {
    return next(new AppError('Admin user not found', 404));
  }

  // Prevent deleting yourself
  if (adminUserId === requestingAdminId) {
    return next(new AppError('Cannot delete your own account', 400));
  }

  // Prevent deleting other super_admins
  if (adminToDelete.adminLevel === 'super_admin') {
    return next(new AppError('Cannot delete super admin accounts', 400));
  }

  await Admin.findByIdAndDelete(adminUserId);

  logger.info(`Admin user deleted by ${requestingAdminId}:`, {
    deletedAdminId: adminUserId,
    deletedEmail: adminToDelete.email,
    deletedAdminLevel: adminToDelete.adminLevel
  });

  res.status(200).json({
    status: 'success',
    message: 'Admin user deleted successfully'
  });
});

const checkAppVersion = catchAsync(async (req, res, next) => {
  try {
    const { current_version, platform, user_type } = req.body;

    logger.info('📱 App version check request received:', {
      current_version,
      platform,
      user_type,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      timestamp: new Date().toISOString()
    });

    // Mock response for testing - you can later integrate with your admin panel database
    const mockVersionData = {
      client: {
        android: {
          latest_version: '1.2.1',  // Minor update - should show optional modal
          minimum_version: '1.0.0',
          force_update: false,
          update_message: 'New features and improvements available!',
          download_url: 'http://parktayo.com/android/',
          release_notes: [
            'Improved parking detection accuracy',
            'New payment options available',
            'Enhanced user interface',
            'Bug fixes and performance improvements'
          ]
        },
        ios: {
          latest_version: '1.5.5',
          minimum_version: '1.0.0',
          force_update: false,
          update_message: 'New features and improvements available!',
          download_url: 'http://parktayo.com/ios/',
          release_notes: [
            'Improved parking detection accuracy',
            'New payment options available',
            'Enhanced user interface',
            'Bug fixes and performance improvements'
          ]
        }
      },
      landlord: {
        android: {
          latest_version: '1.4.2',
          minimum_version: '1.0.0',
          force_update: false,
          update_message: 'Landlord app improvements available!',
          download_url: 'http://parktayo.com/landlord-android/',
          release_notes: [
            'Improved space management',
            'Better analytics dashboard',
            'Enhanced notifications',
            'Performance optimizations'
          ]
        },
        ios: {
          latest_version: '1.4.2',
          minimum_version: '1.0.0',
          force_update: false,
          update_message: 'Landlord app improvements available!',
          download_url: 'http://parktayo.com/landlord-ios/',
          release_notes: [
            'Improved space management',
            'Better analytics dashboard',
            'Enhanced notifications',
            'Performance optimizations'
          ]
        }
      }
    };

    // Get version data based on user type and platform
    const versionData = mockVersionData[user_type]?.[platform] || mockVersionData.client[platform];

    if (!versionData) {
      logger.warn('⚠️ Version data not found for:', { user_type, platform });
      return next(new AppError('Version information not available', 404));
    }

    logger.info('✅ App version check response:', {
      current_version,
      latest_version: versionData.latest_version,
      platform,
      user_type,
      force_update: versionData.force_update
    });

    res.status(200).json({
      status: 'success',
      message: 'Version check successful',
      data: versionData
    });

  } catch (error) {
    logger.error('❌ App version check error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Failed to check app version',
      error: error.message
    });
  }
});

// Enhanced Admin Action Methods

// Get user status history
const getUserStatusHistory = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Log admin action
    await AdminActionLog.logAction({
      adminId: req.user._id,
      adminName: `${req.user.firstName} ${req.user.lastName}`,
      adminEmail: req.user.email,
      action: 'view_details',
      actionDescription: `Viewed status history for ${user.firstName} ${user.lastName}`,
      targetUserId: userId,
      targetUserEmail: user.email,
      targetUserName: `${user.firstName} ${user.lastName}`,
      targetUserType: user.role,
      details: { section: 'status_history' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      status: 'success'
    });

    res.status(200).json({
      status: 'success',
      data: {
        userId: user._id,
        currentStatus: user.getStatusInfo(),
        statusHistory: user.statusHistory.sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt))
      }
    });
  } catch (error) {
    logger.error('Error getting user status history:', error);
    return next(new AppError('Failed to get user status history', 500));
  }
});

// Send notification to user
const sendUserNotification = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { title, message, type = 'info' } = req.body;

  if (!title || !message) {
    return next(new AppError('Title and message are required', 400));
  }

  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    // Send notification using existing service
    await notificationService.sendToUser(userId, {
      title,
      body: message,
      data: {
        type,
        sender: 'admin',
        adminName: `${req.user.firstName} ${req.user.lastName}`
      }
    });

    // Log admin action
    await AdminActionLog.logAction({
      adminId: req.user._id,
      adminName: `${req.user.firstName} ${req.user.lastName}`,
      adminEmail: req.user.email,
      action: 'send_notification',
      actionDescription: `Sent notification to ${user.firstName} ${user.lastName}`,
      targetUserId: userId,
      targetUserEmail: user.email,
      targetUserName: `${user.firstName} ${user.lastName}`,
      targetUserType: user.role,
      details: {
        notificationType: type,
        notificationTitle: title,
        notificationMessage: message
      },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      status: 'success'
    });

    res.status(200).json({
      status: 'success',
      message: 'Notification sent successfully'
    });
  } catch (error) {
    logger.error('Error sending user notification:', error);
    return next(new AppError('Failed to send notification', 500));
  }
});

// Get user wallet transactions
const getUserWalletTransactions = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { page = 1, limit = 50 } = req.query;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const wallet = await Wallet.findByUserId(userId);
    if (!wallet) {
      return res.status(200).json({
        status: 'success',
        data: {
          transactions: [],
          pagination: { totalItems: 0, currentPage: 1, totalPages: 0 }
        }
      });
    }

    const transactions = wallet.transactions
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice((page - 1) * limit, page * limit);

    // Log admin action
    await AdminActionLog.logAction({
      adminId: req.user._id,
      adminName: `${req.user.firstName} ${req.user.lastName}`,
      adminEmail: req.user.email,
      action: 'view_details',
      actionDescription: `Viewed wallet transactions for ${user.firstName} ${user.lastName}`,
      targetUserId: userId,
      targetUserEmail: user.email,
      targetUserName: `${user.firstName} ${user.lastName}`,
      targetUserType: user.role,
      details: { section: 'wallet_transactions' },
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      status: 'success'
    });

    res.status(200).json({
      status: 'success',
      data: {
        transactions,
        walletBalance: wallet.availableBalance,
        pagination: {
          currentPage: parseInt(page),
          totalItems: wallet.transactions.length,
          totalPages: Math.ceil(wallet.transactions.length / limit)
        }
      }
    });
  } catch (error) {
    logger.error('Error getting user wallet transactions:', error);
    return next(new AppError('Failed to get wallet transactions', 500));
  }
});

// Get admin action logs
const getAdminActionLogs = catchAsync(async (req, res, next) => {
  const { page = 1, limit = 50, action, targetUserId, adminId, startDate, endDate } = req.query;

  try {
    // Build query filter
    const filter = {};
    if (action) filter.action = action;
    if (targetUserId) filter.targetUserId = targetUserId;
    if (adminId) filter.adminId = adminId;
    if (startDate || endDate) {
      filter.timestamp = {};
      if (startDate) filter.timestamp.$gte = new Date(startDate);
      if (endDate) filter.timestamp.$lte = new Date(endDate);
    }

    const logs = await AdminActionLog.find(filter)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('adminId', 'firstName lastName email')
      .populate('targetUserId', 'firstName lastName email role');

    const totalCount = await AdminActionLog.countDocuments(filter);

    res.status(200).json({
      status: 'success',
      data: {
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalItems: totalCount
        }
      }
    });
  } catch (error) {
    logger.error('Error getting admin action logs:', error);
    return next(new AppError('Failed to get admin action logs', 500));
  }
});

// Get user-specific action logs
const getUserActionLogs = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  const { page = 1, limit = 20 } = req.query;

  try {
    const user = await User.findById(userId);
    if (!user) {
      return next(new AppError('User not found', 404));
    }

    const logs = await AdminActionLog.find({ targetUserId: userId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit))
      .populate('adminId', 'firstName lastName email');

    const totalCount = await AdminActionLog.countDocuments({ targetUserId: userId });

    res.status(200).json({
      status: 'success',
      data: {
        user: {
          id: user._id,
          name: `${user.firstName} ${user.lastName}`,
          email: user.email,
          role: user.role
        },
        logs,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(totalCount / parseInt(limit)),
          totalItems: totalCount
        }
      }
    });
  } catch (error) {
    logger.error('Error getting user action logs:', error);
    return next(new AppError('Failed to get user action logs', 500));
  }
});

module.exports = {
  getPendingParkingSpaces,
  getParkingSpaceForReview,
  autoApproveAllParkingSpaces,
  approveParkingSpace,
  rejectParkingSpace,
  suspendParkingSpace,
  reactivateParkingSpace,
  getAdminDashboard,
  getDashboardAnalytics,
  getAllParkingSpacesAdmin,
  createParkingSpace,
  updateParkingSpace,
  getSystemHealth,
  getDatabaseHealth,
  getSystemMetrics,
  getErrorStats,
  getQueryPerformanceStats,
  clearQueryCache,
  recreateIndexes,
  getAlerts,
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  suspendUser,
  reactivateUser,
  getAllBookings,
  getBookingById,
  getAllTransactions,
  getTransactionById,
  processRefund,
  getAllTickets,
  getTicketById,
  updateTicketStatus,
  addTicketMessage,
  assignTicket,
  // Wallet admin controls
  getUserWallet,
  creditUserWallet,
  debitUserWallet,
  getUserWalletTransactions,
  // Enhanced user management
  getUserStatusHistory,
  sendUserNotification,
  getAdminActionLogs,
  getUserActionLogs,
  // Landlord ID verification management
  getLandlordApplications,
  getLandlordApplicationById,
  approveLandlordApplication,
  fixVerifiedLandlords,
  rejectLandlordApplication,
  getLandlordApplicationStats,
  // System Settings
  getSystemSettings,
  updateSystemSettings,
  // App Version Management
  checkAppVersion,
  // Payout Management
  getPendingPayouts,
  approvePayout,
  rejectPayout,
  // Admin User Management
  createSupportUser,
  getAllAdminUsers,
  updateAdminPermissions,
  deleteAdminUser
}; 