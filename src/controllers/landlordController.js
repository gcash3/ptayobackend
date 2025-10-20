const ParkingSpace = require('../models/ParkingSpace');
const User = require('../models/User');
const Booking = require('../models/Booking');
const Rating = require('../models/Rating');
const { Wallet } = require('../models/Wallet'); // Add wallet import
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const googleMapsService = require('../services/googleMapsService');
const notificationService = require('../services/notificationService');
const { imageUploadService } = require('../services/imageUploadService');
const { getAutoApproveSetting } = require('../middleware/systemSettings');

// Helper function to map amenities to valid enum values
const mapAmenities = (amenitiesList) => {
  const amenityMap = {
    'covered': 'Covered',
    'cctv': 'CCTV',
    'security': 'Security Guard',
    'security_guard': 'Security Guard',
    '24_7': '24/7 Access',
    '24/7': '24/7 Access',
    'well_lit': 'Well-lit',
    'budget_friendly': 'Budget-friendly',
    'car_wash': 'Car Wash',
    'wheelchair_accessible': 'Well-lit', // Map to closest available
    'electric_charging': 'Electric Charging'
  };
  
  return amenitiesList.map(amenity => 
    amenityMap[amenity.toLowerCase()] || amenity
  ).filter(amenity => 
    ['CCTV', 'Security Guard', '24/7 Access', 'Covered', 
     'Well-lit', 'Budget-friendly', 'Car Wash', 'Electric Charging'].includes(amenity)
  );
};

// Get landlord's parking spaces
const getLandlordParkingSpaces = catchAsync(async (req, res, next) => {
  const landlordId = req.user.id;
  const { 
    page = 1, 
    limit = 10, 
    status,
    sortBy = 'createdAt',
    sortOrder = 'desc' 
  } = req.query;

  let query = { landlordId };
  
  if (status) {
    query.adminApproval = { status };
  }

  const sortOption = {};
  sortOption[sortBy] = sortOrder === 'desc' ? -1 : 1;

  const parkingSpaces = await ParkingSpace.find(query)
    .populate('adminApproval.approvedBy', 'firstName lastName')
    .populate('adminApproval.rejectedBy', 'firstName lastName')
    .sort(sortOption)
    .limit(parseInt(limit))
    .skip((parseInt(page) - 1) * parseInt(limit));

  const total = await ParkingSpace.countDocuments(query);

  res.status(200).json({
    status: 'success',
    results: parkingSpaces.length,
    data: {
      parkingSpaces,
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

// Get single parking space details for landlord
const getParkingSpaceDetails = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const landlordId = req.user.id;

  const parkingSpace = await ParkingSpace.findOne({ 
    _id: spaceId, 
    landlordId 
  })
    .populate('adminApproval.approvedBy', 'firstName lastName')
    .populate('adminApproval.rejectedBy', 'firstName lastName');

  if (!parkingSpace) {
    return next(new AppError('Parking space not found or you do not have permission to access it', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      parkingSpace
    }
  });
});

// Create new parking space
const createParkingSpace = catchAsync(async (req, res, next) => {
  const landlordId = req.user.id;
  
  // Validate required fields
  const {
    name,
    description,
    address,
    latitude,
    longitude,
    pricePerHour,  // This is ACTUAL hourly rate from mobile app (e.g., 50)
    dailyRate,     // This is ACTUAL daily rate from mobile app (e.g., 400)
    totalSpots,
    vehicleTypes,
    amenities,
    operatingHours,
    images
  } = req.body;

  // Basic validation
  if (!name || !description || !address || !latitude || !longitude || !pricePerHour || !totalSpots) {
    return next(new AppError('Missing required fields', 400));
  }

  // **NEW STRUCTURE**: Mobile app now sends 3-hour base rate directly
  const basePricePer3Hours = parseFloat(pricePerHour); // e.g., 50 PHP for 3 hours (mobile app sends this as "hourlyRate" for API compatibility)
  const overtimeRatePerHour = basePricePer3Hours / 3; // e.g., 16.67 PHP/hour (auto-calculated)
  const actualDailyRate = dailyRate ? parseFloat(dailyRate) : basePricePer3Hours * 8; // Respect landlord's daily rate or calculate fallback

  // Validate coordinates are in Philippines
  const isInPhilippines = googleMapsService.isWithinPhilippines(latitude, longitude);
  if (!isInPhilippines) {
    return next(new AppError('Parking space must be located within the Philippines', 400));
  }

  // Validate and geocode address (make it optional to not block space creation)
  let validatedAddress = address; // Use original address as fallback
  try {
    if (googleMapsService && googleMapsService.geocodeAddress) {
      const geocodeResult = await googleMapsService.geocodeAddress(address);
      if (geocodeResult.success && geocodeResult.data) {
        validatedAddress = geocodeResult.data.formattedAddress;
        logger.info('Address geocoded successfully', { original: address, formatted: validatedAddress });
      } else {
        logger.warn('Geocoding failed, using original address', { address, error: geocodeResult.error });
      }
    }
  } catch (error) {
    logger.warn('Address geocoding failed, using original address', { address, error: error.message });
    // Continue with original address - don't block space creation
  }

  // Check if auto-approve is enabled
  const autoApproveEnabled = await getAutoApproveSetting();

  // Create parking space with status based on auto-approve setting
  const status = autoApproveEnabled ? 'active' : 'pending';
  const isVerified = autoApproveEnabled;
  const adminApprovalStatus = autoApproveEnabled ? 'approved' : 'pending';

  const parkingSpaceData = {
    landlordId,
    name: name.trim(),
    description: description.trim(),
    address: validatedAddress,
    latitude: parseFloat(latitude),
    longitude: parseFloat(longitude),
    pricePer3Hours: basePricePer3Hours,      // e.g., 50 (landlord's 3-hour base rate)
    overtimeRatePerHour: overtimeRatePerHour, // e.g., 16.67 (auto-calculated: 50÷3)
    dailyRate: actualDailyRate,              // e.g., 400 (landlord's input) or calculated fallback
    location: {
      type: 'Point',
      coordinates: [parseFloat(longitude), parseFloat(latitude)]
    },
    totalSpots: parseInt(totalSpots),
    availableSpots: parseInt(totalSpots),
    vehicleTypes: vehicleTypes || ['motorcycle', 'car'],
    amenities: mapAmenities(amenities || []),
    operatingHours: operatingHours || {
      isOpen24_7: true,
      schedule: {
        monday: { open: '06:00', close: '22:00' },
        tuesday: { open: '06:00', close: '22:00' },
        wednesday: { open: '06:00', close: '22:00' },
        thursday: { open: '06:00', close: '22:00' },
        friday: { open: '06:00', close: '22:00' },
        saturday: { open: '06:00', close: '22:00' },
        sunday: { open: '06:00', close: '22:00' }
      }
    },
    images: images || [],
    status,
    adminApproval: {
      status: adminApprovalStatus,
      ...(autoApproveEnabled && {
        approvedBy: 'system',
        approvedAt: new Date(),
        notes: 'Auto-approved by system setting'
      })
    },
    isVerified
  };

  const parkingSpace = await ParkingSpace.create(parkingSpaceData);

  // Send notification based on auto-approve setting
  try {
    if (autoApproveEnabled) {
      // Note: sendSpaceAutoApprovedNotification might not exist yet
      // For now, we'll log it and optionally send a different notification
      logger.info('Parking space auto-approved', {
        spaceId: parkingSpace._id,
        spaceName: parkingSpace.name
      });
    } else {
      // Send notification to admins about new space submission
      await notificationService.sendNewSpaceSubmissionNotification(
        parkingSpace._id,
        landlordId,
        parkingSpace.name
      );
    }
  } catch (notificationError) {
    logger.error('Failed to send space notification:', notificationError);
  }

  logger.info('New parking space created', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    landlordId: landlordId,
    address: parkingSpace.address,
    autoApproveEnabled,
    status: parkingSpace.status,
    isVerified: parkingSpace.isVerified
  });

  const message = autoApproveEnabled
    ? 'Parking space created and automatically approved! It is now visible to users.'
    : 'Parking space created successfully and submitted for admin approval';

  res.status(201).json({
    status: 'success',
    message,
    data: {
      parkingSpace
    }
  });
});

// Update parking space
const updateParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const landlordId = req.user.id;

  const parkingSpace = await ParkingSpace.findOne({ 
    _id: spaceId, 
    landlordId 
  });

  if (!parkingSpace) {
    return next(new AppError('Parking space not found or you do not have permission to update it', 404));
  }

  // Don't allow updates to rejected spaces
  if (parkingSpace.adminApproval.status === 'rejected') {
    return next(new AppError('Cannot update rejected parking space. Please create a new one.', 400));
  }

  // For approved spaces, only allow "safe" operational updates that don't require re-approval
  const safeUpdatesForApproved = [
    'autoAccept', 'operatingHours', 'pricePer3Hours', 'pricePerHour' // Support both for compatibility
  ];

  // All allowed updates for pending/draft spaces
  const allowedUpdates = [
    'name', 'description', 'pricePer3Hours', 'pricePerHour', 'totalSpots',
    'vehicleTypes', 'amenities', 'operatingHours', 'images', 'autoAccept'
  ];

  // Restrict updates for approved spaces to safe fields only
  if (parkingSpace.adminApproval.status === 'approved') {
    const requestedUpdates = Object.keys(req.body);
    const unsafeUpdates = requestedUpdates.filter(field => 
      !safeUpdatesForApproved.includes(field)
    );
    
    if (unsafeUpdates.length > 0) {
      return next(new AppError(
        `Cannot update these fields on approved parking space: ${unsafeUpdates.join(', ')}. Only ${safeUpdatesForApproved.join(', ')} can be modified.`, 
        400
      ));
    }
  }

  const updates = {};
  
  // Use appropriate allowed fields based on approval status
  const fieldsToCheck = parkingSpace.adminApproval.status === 'approved' 
    ? safeUpdatesForApproved 
    : allowedUpdates;
    
  fieldsToCheck.forEach(field => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });

  // Handle pricing updates correctly
  if (req.body.pricePerHour) {
    // Mobile app sends 3-hour base rate as "pricePerHour" for API compatibility
    const basePricePer3Hours = parseFloat(req.body.pricePerHour);
    updates.pricePer3Hours = basePricePer3Hours;
    updates.overtimeRatePerHour = basePricePer3Hours / 3; // Auto-calculate overtime rate
    delete updates.pricePerHour; // Remove the old field from updates
  }

  // Handle daily rate updates
  if (req.body.dailyRate) {
    updates.dailyRate = parseFloat(req.body.dailyRate);
  }

  // Update available spots if total spots changed
  if (updates.totalSpots) {
    const spotDifference = parseInt(updates.totalSpots) - parkingSpace.totalSpots;
    updates.availableSpots = Math.max(0, parkingSpace.availableSpots + spotDifference);
  }

  Object.assign(parkingSpace, updates);
  await parkingSpace.save();

  logger.info('Parking space updated', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    landlordId: landlordId,
    updates: Object.keys(updates)
  });

  res.status(200).json({
    status: 'success',
    message: 'Parking space updated successfully',
    data: {
      parkingSpace
    }
  });
});

// Delete parking space
const deleteParkingSpace = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const landlordId = req.user.id;

  const parkingSpace = await ParkingSpace.findOne({ 
    _id: spaceId, 
    landlordId 
  });

  if (!parkingSpace) {
    return next(new AppError('Parking space not found or you do not have permission to delete it', 404));
  }

  // Check if there are active bookings
  const Booking = require('../models/Booking');
  const activeBookings = await Booking.countDocuments({
    parkingSpaceId: spaceId,
    status: { $in: ['confirmed', 'active', 'checked_in'] }
  });

  if (activeBookings > 0) {
    return next(new AppError('Cannot delete parking space with active bookings', 400));
  }

  await ParkingSpace.findByIdAndDelete(spaceId);

  logger.info('Parking space deleted', {
    spaceId: spaceId,
    spaceName: parkingSpace.name,
    landlordId: landlordId
  });

  res.status(200).json({
    status: 'success',
    message: 'Parking space deleted successfully'
  });
});

// Toggle parking space availability
const toggleSpaceAvailability = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const landlordId = req.user.id;

  const parkingSpace = await ParkingSpace.findOne({ 
    _id: spaceId, 
    landlordId 
  });

  if (!parkingSpace) {
    return next(new AppError('Parking space not found or you do not have permission to modify it', 404));
  }

  if (parkingSpace.adminApproval.status !== 'approved') {
    return next(new AppError('Only approved parking spaces can be activated/deactivated', 400));
  }

  // Toggle between active and inactive
  const newStatus = parkingSpace.status === 'active' ? 'inactive' : 'active';
  parkingSpace.status = newStatus;
  await parkingSpace.save();

  logger.info('Parking space availability toggled', {
    spaceId: parkingSpace._id,
    spaceName: parkingSpace.name,
    landlordId: landlordId,
    newStatus: newStatus
  });

  res.status(200).json({
    status: 'success',
    message: `Parking space ${newStatus === 'active' ? 'activated' : 'deactivated'} successfully`,
    data: {
      parkingSpace
    }
  });
});

// Upload images for parking space
const uploadSpaceImages = catchAsync(async (req, res, next) => {
  const { spaceId } = req.params;
  const landlordId = req.user.id;

  // Verify ownership
  const parkingSpace = await ParkingSpace.findOne({ 
    _id: spaceId, 
    landlordId 
  });

  if (!parkingSpace) {
    return next(new AppError('Parking space not found or you do not have permission to upload images', 404));
  }

  if (!req.files || req.files.length === 0) {
    return next(new AppError('No images provided', 400));
  }

  try {
    // Upload images to Cloudinary
    const uploadResults = await imageUploadService.uploadMultipleImages(req.files, {
      folder: `parktayo/parking-spaces/${spaceId}`,
      public_id_prefix: `space-${spaceId}-`
    });

    if (!uploadResults.success) {
      return next(new AppError('Failed to upload images', 500));
    }

    // Update parking space with new image URLs
    const newImages = uploadResults.data.successful.map(result => ({
      url: result.url,
      thumbnailUrl: result.thumbnailUrl,
      publicId: result.publicId,
      uploadedAt: new Date()
    }));

    parkingSpace.images = parkingSpace.images.concat(newImages);
    await parkingSpace.save();

    logger.info('Images uploaded for parking space', {
      spaceId: parkingSpace._id,
      landlordId: landlordId,
      imageCount: newImages.length
    });

    res.status(200).json({
      status: 'success',
      message: `${uploadResults.data.successCount} images uploaded successfully`,
      data: {
        uploadedImages: newImages,
        uploadStats: uploadResults.data,
        totalImages: parkingSpace.images.length
      }
    });

  } catch (error) {
    logger.error('Image upload failed:', error);
    return next(new AppError('Image upload failed', 500));
  }
});

// Delete specific image from parking space
const deleteSpaceImage = catchAsync(async (req, res, next) => {
  const { spaceId, imageId } = req.params;
  const landlordId = req.user.id;

  // Verify ownership
  const parkingSpace = await ParkingSpace.findOne({ 
    _id: spaceId, 
    landlordId 
  });

  if (!parkingSpace) {
    return next(new AppError('Parking space not found or you do not have permission to modify it', 404));
  }

  // Find the image to delete
  const imageIndex = parkingSpace.images.findIndex(img => 
    img._id.toString() === imageId || img.publicId === imageId
  );

  if (imageIndex === -1) {
    return next(new AppError('Image not found', 404));
  }

  const imageToDelete = parkingSpace.images[imageIndex];

  try {
    // Delete from Cloudinary if it has a publicId
    if (imageToDelete.publicId) {
      await imageUploadService.deleteImage(imageToDelete.publicId);
    }

    // Remove from parking space
    parkingSpace.images.splice(imageIndex, 1);
    await parkingSpace.save();

    logger.info('Image deleted from parking space', {
      spaceId: parkingSpace._id,
      landlordId: landlordId,
      imageId: imageId
    });

    res.status(200).json({
      status: 'success',
      message: 'Image deleted successfully',
      data: {
        remainingImages: parkingSpace.images.length
      }
    });

  } catch (error) {
    logger.error('Image deletion failed:', error);
    return next(new AppError('Failed to delete image', 500));
  }
});

// Get landlord dashboard statistics
const getLandlordDashboard = catchAsync(async (req, res, next) => {
  const landlordId = req.user.id;
  const { period = 'overall' } = req.query; // overall or number of days
  
  // Set up date filtering - default to "overall" (no time limit)
  let startDate = null;
  if (period !== 'overall' && !isNaN(parseInt(period))) {
    const daysAgo = parseInt(period);
    startDate = new Date();
    startDate.setDate(startDate.getDate() - daysAgo);
  }

  logger.info(`🏠 Dashboard requested for landlord ${landlordId}, period: ${period}`);
  logger.info(`📅 Date range: ${startDate ? startDate.toISOString() : 'Overall (no limit)'} to ${new Date().toISOString()}`);

  try {
    // Basic parking space statistics
    const [
      totalSpaces,
      pendingSpaces,
      approvedSpaces,
      rejectedSpaces,
      activeSpaces,
      inactiveSpaces,
      landlordUser
    ] = await Promise.all([
      ParkingSpace.countDocuments({ landlordId }),
      ParkingSpace.countDocuments({ landlordId, 'adminApproval.status': 'pending' }),
      ParkingSpace.countDocuments({ landlordId, 'adminApproval.status': 'approved' }),
      ParkingSpace.countDocuments({ landlordId, 'adminApproval.status': 'rejected' }),
      ParkingSpace.countDocuments({
        landlordId,
        status: 'active',
        'adminApproval.status': 'approved'
      }),
      ParkingSpace.countDocuments({
        landlordId,
        status: 'inactive',
        'adminApproval.status': 'approved'
      }),
      User.findById(landlordId).select('totalEarnings averageRating totalReviews')
    ]);

    logger.info(`📊 Basic stats - Total spaces: ${totalSpaces}, Pending: ${pendingSpaces}, Approved: ${approvedSpaces}`);
    logger.info(`📊 Status counts - Active: ${activeSpaces}, Inactive: ${inactiveSpaces}, Rejected: ${rejectedSpaces}`);
    logger.info(`👤 User data - Earnings: ${landlordUser?.totalEarnings}, Rating: ${landlordUser?.averageRating}, Reviews: ${landlordUser?.totalReviews}`);

    // Get parking spaces for analytics
    const parkingSpaces = await ParkingSpace.find({ landlordId })
      .populate('adminApproval.approvedBy', 'firstName lastName')
      .populate('adminApproval.rejectedBy', 'firstName lastName')
      .sort({ createdAt: -1 });

    // Get parking space IDs for this landlord
    const spaceIds = parkingSpaces.map(space => space._id);
    logger.info(`🏗️ Found ${parkingSpaces.length} parking spaces with IDs: ${spaceIds.slice(0, 3).join(', ')}${spaceIds.length > 3 ? '...' : ''}`);

    // Debug: Check if there are any bookings at all for this landlord
    const allBookingsForLandlord = await Booking.find({ parkingSpaceId: { $in: spaceIds } })
      .select('status pricing.totalAmount pricing.overtimeAmount rating.userRating.score createdAt startTime')
      .sort({ createdAt: -1 })
      .limit(10);
    
    logger.info(`🔍 Debug: Found ${allBookingsForLandlord.length} total bookings for this landlord:`);
    allBookingsForLandlord.forEach((booking, index) => {
      logger.info(`   ${index + 1}. Status: ${booking.status}, Amount: ${booking.pricing?.totalAmount}, Rating: ${booking.rating?.userRating?.score}, Created: ${booking.createdAt}`);
    });

    // Get wallet balance for total earnings display
    const landlordWallet = await Wallet.findByUserId(landlordId);
    const walletAvailableBalance = landlordWallet?.availableBalance || 0;
    
    // Calculate real revenue analytics from bookings
    logger.info(`🔍 About to run booking aggregations for spaces: ${JSON.stringify(spaceIds)}`);
    const [
      totalBookingsCount,
      periodBookingsCount,
      completedBookings,
      todaysBookings,
      totalEarningsFromBookings,
      periodEarningsFromBookings
    ] = await Promise.all([
      Booking.countDocuments({ 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] }
      }),
      Booking.countDocuments({ 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] },
        ...(startDate && { createdAt: { $gte: startDate } })
      }),
      Booking.find({ 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] }
      }).select('pricing.totalAmount pricing.overtimeAmount'),
      Booking.countDocuments({ 
        parkingSpaceId: { $in: spaceIds },
        $or: [
          { createdAt: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } },
          { startTime: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) } }
        ]
      }),
      // Calculate total earnings from completed and parked bookings
      Booking.aggregate([
        { $match: { 
          parkingSpaceId: { $in: spaceIds },
          status: { $in: ['completed', 'parked'] },
          'pricing.totalAmount': { $exists: true }
        }},
        { $group: { 
          _id: null,
          totalEarnings: { 
            $sum: { 
              $add: [
                { $ifNull: ['$pricing.totalAmount', 0] },
                { $ifNull: ['$pricing.overtimeAmount', 0] }
              ]
            }
          }
        }}
      ]),
      // Calculate period earnings
      Booking.aggregate([
        { $match: { 
          parkingSpaceId: { $in: spaceIds },
          status: { $in: ['completed', 'parked'] },
          'pricing.totalAmount': { $exists: true },
          ...(startDate && { createdAt: { $gte: startDate } })
        }},
        { $group: { 
          _id: null,
          periodEarnings: { 
            $sum: { 
              $add: [
                { $ifNull: ['$pricing.totalAmount', 0] },
                { $ifNull: ['$pricing.overtimeAmount', 0] }
              ]
            }
          }
        }}
      ])
    ]);

    const totalEarningsCalc = totalEarningsFromBookings[0]?.totalEarnings || 0;
    const periodEarningsCalc = periodEarningsFromBookings[0]?.periodEarnings || 0;

    logger.info(`💰 Wallet and booking calculations:`);
    logger.info(`   Wallet available balance: ${walletAvailableBalance}`);
    logger.info(`   Total bookings: ${totalBookingsCount}, Period bookings: ${periodBookingsCount}, Today's bookings: ${todaysBookings}`);
    logger.info(`   Booking earnings: ${totalEarningsCalc}, Period earnings: ${periodEarningsCalc}`);
    logger.info(`   Completed bookings found: ${completedBookings.length}`);

    const revenueAnalytics = {
      totalEarnings: walletAvailableBalance, // Use wallet available balance instead of booking calculations
      periodEarnings: periodEarningsCalc,
      monthlyBookings: totalBookingsCount, // Show total bookings, not just period
      pendingPayouts: walletAvailableBalance, // Available for withdrawal (wallet balance)
      averageHourlyRate: 0,
      totalBookings: totalBookingsCount,
      periodBookings: periodBookingsCount,
      todaysBookings: todaysBookings,
      conversionRate: totalBookingsCount > 0 && parkingSpaces.length > 0 ? 
        (totalBookingsCount / parkingSpaces.length).toFixed(1) : 0
    };

    logger.info(`💰 Dashboard revenue analytics for landlord ${landlordId}:`, {
      totalEarnings: walletAvailableBalance, // Now shows wallet balance
      periodEarnings: periodEarningsCalc,
      totalBookings: totalBookingsCount,
      periodBookings: periodBookingsCount,
      todaysBookings: todaysBookings
    });

    // Calculate average pricing (convert 3-hour rate to hourly for display)
    if (parkingSpaces.length > 0) {
      const totalPrice = parkingSpaces.reduce((sum, space) => sum + (space.pricePer3Hours || space.pricePerHour || 0), 0);
      revenueAnalytics.averageHourlyRate = (totalPrice / parkingSpaces.length) / 3; // Convert to hourly rate
    }

    // Calculate real performance metrics from ratings - FIXED
    const ratingStats = await Rating.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        rating: { $exists: true, $ne: null }
      }},
      { $group: { 
        _id: null,
        averageRating: { $avg: '$rating' },
        totalReviews: { $sum: 1 }
      }}
    ]);

    logger.info(`⭐ Rating calculation (FIXED):`);
    logger.info(`   Rating stats result: ${JSON.stringify(ratingStats)}`);
    logger.info(`   Raw average: ${ratingStats[0]?.averageRating}, Reviews: ${ratingStats[0]?.totalReviews}`);

    const performanceMetrics = {
      averageRating: ratingStats[0]?.averageRating ? 
        parseFloat(ratingStats[0].averageRating.toFixed(1)) : 0,
      totalReviews: ratingStats[0]?.totalReviews || 0,
      responseTime: '< 1 hour', // Could be calculated from booking approval times
      approvalRate: totalSpaces > 0 ? (approvedSpaces / totalSpaces * 100).toFixed(1) : 0
    };

    logger.info(`   Final performance metrics: ${JSON.stringify(performanceMetrics)}`);

    // Space utilization analytics with real booking data
    const spaceBookingStats = await Booking.aggregate([
      { $match: { 
        parkingSpaceId: { $in: spaceIds },
        status: { $in: ['completed', 'parked'] }
      }},
      { $group: { 
        _id: '$parkingSpaceId',
        bookingCount: { $sum: 1 },
        totalEarnings: { 
          $sum: { 
            $add: [
              { $ifNull: ['$pricing.totalAmount', 0] },
              { $ifNull: ['$pricing.overtimeAmount', 0] }
            ]
          }
        }
      }},
      { $sort: { bookingCount: -1 } }
    ]);

    let mostPopularSpace = null;
    let leastPopularSpace = null;
    
    if (spaceBookingStats.length > 0) {
      const mostPopularStats = spaceBookingStats[0];
      const leastPopularStats = spaceBookingStats[spaceBookingStats.length - 1];
      
      const mostPopularSpaceData = parkingSpaces.find(s => 
        s._id.toString() === mostPopularStats._id.toString()
      );
      const leastPopularSpaceData = parkingSpaces.find(s => 
        s._id.toString() === leastPopularStats._id.toString()
      );

      if (mostPopularSpaceData) {
        mostPopularSpace = {
          id: mostPopularSpaceData._id,
          name: mostPopularSpaceData.name,
          totalSpots: mostPopularSpaceData.totalSpots,
          pricePer3Hours: mostPopularSpaceData.pricePer3Hours || mostPopularSpaceData.pricePerHour,
          bookingCount: mostPopularStats.bookingCount,
          totalEarnings: mostPopularStats.totalEarnings
        };
      }

      if (leastPopularSpaceData && spaceBookingStats.length > 1) {
        leastPopularSpace = {
          id: leastPopularSpaceData._id,
          name: leastPopularSpaceData.name,
          totalSpots: leastPopularSpaceData.totalSpots,
          pricePer3Hours: leastPopularSpaceData.pricePer3Hours || leastPopularSpaceData.pricePerHour,
          bookingCount: leastPopularStats.bookingCount,
          totalEarnings: leastPopularStats.totalEarnings
        };
      }
    }

    const spaceAnalytics = {
      mostPopularSpace,
      leastPopularSpace,
      averageOccupancy: spaceBookingStats.length > 0 && parkingSpaces.length > 0 ? 
        (spaceBookingStats.reduce((sum, stat) => sum + stat.bookingCount, 0) / parkingSpaces.length).toFixed(1) : 0,
      peakHours: [], // Could be implemented with hourly booking analysis
      weeklyTrends: [] // Could be implemented with daily booking analysis
    };

    // Recent activities (space creation, approval, etc.)
    const recentActivities = parkingSpaces.slice(0, 5).map(space => {
      let activityType = 'created';
      let activityDate = space.createdAt;
      let activityDescription = `Created parking space "${space.name}"`;

      if (space.adminApproval.status === 'approved' && space.adminApproval.approvedAt) {
        activityType = 'approved';
        activityDate = space.adminApproval.approvedAt;
        activityDescription = `Parking space "${space.name}" was approved`;
      } else if (space.adminApproval.status === 'rejected' && space.adminApproval.rejectedAt) {
        activityType = 'rejected';
        activityDate = space.adminApproval.rejectedAt;
        activityDescription = `Parking space "${space.name}" was rejected`;
      }

      return {
        id: space._id,
        type: activityType,
        description: activityDescription,
        date: activityDate,
        spaceId: space._id,
        spaceName: space.name
      };
    });

    // Monthly trends with real data
    const monthlyTrends = [];
    for (let i = 5; i >= 0; i--) {
      const monthStart = new Date();
      monthStart.setMonth(monthStart.getMonth() - i);
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      
      const monthEnd = new Date(monthStart);
      monthEnd.setMonth(monthEnd.getMonth() + 1);
      
      // Get monthly bookings and earnings
      const [monthlyBookings, monthlyEarnings] = await Promise.all([
        Booking.countDocuments({ 
          parkingSpaceId: { $in: spaceIds },
          status: { $in: ['completed', 'parked'] },
          createdAt: { $gte: monthStart, $lt: monthEnd }
        }),
        Booking.aggregate([
          { $match: { 
            parkingSpaceId: { $in: spaceIds },
            status: { $in: ['completed', 'parked'] },
            'pricing.totalAmount': { $exists: true },
            createdAt: { $gte: monthStart, $lt: monthEnd }
          }},
          { $group: { 
            _id: null,
            earnings: { 
              $sum: { 
                $add: [
                  { $ifNull: ['$pricing.totalAmount', 0] },
                  { $ifNull: ['$pricing.overtimeAmount', 0] }
                ]
              }
            }
          }}
        ])
      ]);

      monthlyTrends.push({
        month: monthStart.toISOString().substring(0, 7),
        earnings: monthlyEarnings[0]?.earnings || 0,
        bookings: monthlyBookings,
        newSpaces: i === 0 ? pendingSpaces : 0 // Only show current pending spaces
      });
    }

    // Status breakdown for charts
    const statusBreakdown = {
      approved: approvedSpaces,
      pending: pendingSpaces,
      rejected: rejectedSpaces,
      active: activeSpaces,
      inactive: inactiveSpaces
    };

    const responseData = {
      overview: {
        totalSpaces,
        pendingSpaces,
        approvedSpaces,
        rejectedSpaces,
        activeSpaces,
        conversionRate: totalSpaces > 0 ? (approvedSpaces / totalSpaces * 100).toFixed(1) : 0
      },
      revenue: revenueAnalytics,
      performance: performanceMetrics,
      analytics: spaceAnalytics,
      trends: {
        monthly: monthlyTrends,
        statusBreakdown
      },
      recentActivities,
      period: {
        period: period,
        startDate,
        endDate: new Date()
      }
    };

    logger.info(`📤 Final dashboard response data:`);
    logger.info(`   Overview: ${JSON.stringify(responseData.overview)}`);
    logger.info(`   Revenue: ${JSON.stringify(responseData.revenue)}`);
    logger.info(`   Performance: ${JSON.stringify(responseData.performance)}`);

    res.status(200).json({
      status: 'success',
      data: responseData
    });

  } catch (error) {
    logger.error('Dashboard analytics failed:', error);
    return next(new AppError('Failed to load dashboard analytics', 500));
  }
});

module.exports = {
  getLandlordParkingSpaces,
  getParkingSpaceDetails,
  createParkingSpace,
  updateParkingSpace,
  deleteParkingSpace,
  toggleSpaceAvailability,
  getLandlordDashboard,
  uploadSpaceImages,
  deleteSpaceImage
}; 