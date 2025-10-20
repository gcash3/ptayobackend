const UserBookmarks = require('../models/UserBookmarks');
const ParkingSpace = require('../models/ParkingSpace');
const { catchAsync } = require('../middleware/errorHandler');
const { AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// Add or remove bookmark (toggle functionality)
const toggleBookmark = catchAsync(async (req, res, next) => {
  const { parkingSpaceId } = req.params;
  const userId = req.user.id;
  const { notes, tags, customRating } = req.body;

  logger.info(`🔖 Toggling bookmark for parking space ${parkingSpaceId} by user ${userId}`);

  // Validate parking space exists and is active
  const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
  if (!parkingSpace || parkingSpace.status !== 'active') {
    return next(new AppError('Parking space not found or not available', 404));
  }

  // Check if bookmark already exists
  const existingBookmark = await UserBookmarks.findOne({ userId, parkingSpaceId });

  if (existingBookmark) {
    // Remove bookmark
    await UserBookmarks.deleteOne({ _id: existingBookmark._id });

    // Update parking space bookmark stats
    await ParkingSpace.updateBookmarkStats(parkingSpaceId, 'remove');

    logger.info(`❌ Removed bookmark for parking space ${parkingSpaceId}`);

    res.status(200).json({
      status: 'success',
      message: 'Bookmark removed successfully',
      data: {
        action: 'removed',
        parkingSpaceId,
        bookmarkId: existingBookmark._id
      }
    });
  } else {
    // Add bookmark
    const bookmarkData = {
      userId,
      parkingSpaceId,
      personalNotes: notes || '',
      tags: tags || [],
      customRating: customRating || {},
      metadata: {
        bookmarkedFrom: req.body.source || 'search',
        deviceType: req.headers['user-agent'] ? 'mobile' : 'web',
        userLocation: {
          type: 'Point',
          coordinates: req.body.userLocation ? [req.body.userLocation.longitude, req.body.userLocation.latitude] : [0, 0]
        }
      }
    };

    const bookmark = new UserBookmarks(bookmarkData);
    await bookmark.save();

    // Update parking space bookmark stats
    await ParkingSpace.updateBookmarkStats(parkingSpaceId, 'add', tags || []);

    // Populate parking space details for response
    await bookmark.populate('parkingSpaceId');

    logger.info(`✅ Added bookmark for parking space ${parkingSpaceId}`);

    res.status(201).json({
      status: 'success',
      message: 'Bookmark added successfully',
      data: {
        action: 'added',
        bookmark,
        parkingSpace: bookmark.parkingSpaceId
      }
    });
  }
});

// Get user's bookmarks with filtering and pagination
const getUserBookmarks = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const {
    page = 1,
    limit = 20,
    sortBy = 'bookmarkedAt',
    sortOrder = 'desc',
    tags,
    search,
    includeInactive = false
  } = req.query;

  logger.info(`📚 Getting bookmarks for user ${userId}`);

  const options = {
    tags: tags ? tags.split(',') : null,
    sortBy,
    sortOrder: sortOrder === 'desc' ? -1 : 1,
    limit: parseInt(limit),
    skip: (parseInt(page) - 1) * parseInt(limit),
    includeInactive: includeInactive === 'true'
  };

  // Get bookmarks with filtering
  let query = { userId, isActive: true };

  if (!includeInactive) {
    query.isActive = true;
  }

  if (options.tags && options.tags.length > 0) {
    query.tags = { $in: options.tags };
  }

  // Build aggregation pipeline for search functionality
  const pipeline = [
    { $match: query },
    {
      $lookup: {
        from: 'parkingspaces',
        localField: 'parkingSpaceId',
        foreignField: '_id',
        as: 'parkingSpace'
      }
    },
    { $unwind: '$parkingSpace' },
    {
      $match: {
        'parkingSpace.status': 'active'
      }
    }
  ];

  // Add search filtering if provided
  if (search) {
    pipeline.push({
      $match: {
        $or: [
          { 'parkingSpace.name': { $regex: search, $options: 'i' } },
          { 'parkingSpace.address': { $regex: search, $options: 'i' } },
          { personalNotes: { $regex: search, $options: 'i' } },
          { tags: { $in: [new RegExp(search, 'i')] } }
        ]
      }
    });
  }

  // Add sorting and pagination
  const sortObj = {};
  sortObj[sortBy === 'name' ? 'parkingSpace.name' : sortBy] = options.sortOrder;
  pipeline.push({ $sort: sortObj });
  pipeline.push({ $skip: options.skip });
  pipeline.push({ $limit: options.limit });

  // Add computed fields
  pipeline.push({
    $addFields: {
      ageInDays: {
        $floor: {
          $divide: [
            { $subtract: [new Date(), '$bookmarkedAt'] },
            1000 * 60 * 60 * 24
          ]
        }
      },
      isRecentlyVisited: {
        $lte: ['$visitHistory.lastVisited', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)]
      }
    }
  });

  const bookmarks = await UserBookmarks.aggregate(pipeline);

  // Get total count for pagination
  const countPipeline = [...pipeline.slice(0, -3)]; // Remove sort, skip, limit, addFields
  countPipeline.push({ $count: 'total' });
  const countResult = await UserBookmarks.aggregate(countPipeline);
  const totalItems = countResult[0]?.total || 0;

  // Get bookmark statistics
  const stats = await UserBookmarks.getBookmarkStats(userId);

  res.status(200).json({
    status: 'success',
    results: bookmarks.length,
    data: {
      bookmarks,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(totalItems / parseInt(limit)),
        totalItems,
        hasNextPage: parseInt(page) * parseInt(limit) < totalItems,
        hasPrevPage: parseInt(page) > 1
      },
      stats,
      filters: {
        availableTags: await this.getAvailableTags(userId),
        sortOptions: ['bookmarkedAt', 'name', 'visitHistory.totalVisits', 'customRating.overall']
      }
    }
  });
});

// Get single bookmark details
const getBookmarkDetails = catchAsync(async (req, res, next) => {
  const { bookmarkId } = req.params;
  const userId = req.user.id;

  const bookmark = await UserBookmarks.findOne({
    _id: bookmarkId,
    userId,
    isActive: true
  }).populate('parkingSpaceId');

  if (!bookmark) {
    return next(new AppError('Bookmark not found', 404));
  }

  // Add real-time parking space data
  const enhancedBookmark = {
    ...bookmark.toObject(),
    parkingSpace: {
      ...bookmark.parkingSpaceId.toObject(),
      // Add current availability and pricing
      currentAvailability: bookmark.parkingSpaceId.availableSpots,
      currentPrice: bookmark.parkingSpaceId.pricePer3Hours *
        (bookmark.parkingSpaceId.realTimeData?.dynamicPricing?.currentMultiplier || 1.0),
      isCurrentlyAvailable: bookmark.parkingSpaceId.availableSpots > 0
    }
  };

  res.status(200).json({
    status: 'success',
    data: {
      bookmark: enhancedBookmark
    }
  });
});

// Update bookmark (notes, tags, rating)
const updateBookmark = catchAsync(async (req, res, next) => {
  const { bookmarkId } = req.params;
  const userId = req.user.id;
  const { personalNotes, tags, customRating, preferences } = req.body;

  const bookmark = await UserBookmarks.findOne({
    _id: bookmarkId,
    userId,
    isActive: true
  });

  if (!bookmark) {
    return next(new AppError('Bookmark not found', 404));
  }

  // Update fields
  if (personalNotes !== undefined) bookmark.personalNotes = personalNotes;
  if (tags !== undefined) bookmark.tags = tags;
  if (customRating !== undefined) {
    bookmark.customRating = { ...bookmark.customRating, ...customRating };
  }
  if (preferences !== undefined) {
    bookmark.preferences = { ...bookmark.preferences, ...preferences };
  }

  await bookmark.save();
  await bookmark.populate('parkingSpaceId');

  // Update parking space bookmark stats if tags changed
  if (tags !== undefined) {
    await ParkingSpace.updateBookmarkStats(bookmark.parkingSpaceId._id, 'update', tags);
  }

  logger.info(`📝 Updated bookmark ${bookmarkId} for user ${userId}`);

  res.status(200).json({
    status: 'success',
    message: 'Bookmark updated successfully',
    data: {
      bookmark
    }
  });
});

// Remove bookmark
const removeBookmark = catchAsync(async (req, res, next) => {
  const { parkingSpaceId } = req.params;
  const userId = req.user.id;

  const bookmark = await UserBookmarks.findOneAndDelete({
    userId,
    parkingSpaceId,
    isActive: true
  });

  if (!bookmark) {
    return next(new AppError('Bookmark not found', 404));
  }

  // Update parking space bookmark stats
  await ParkingSpace.updateBookmarkStats(parkingSpaceId, 'remove');

  logger.info(`🗑️ Removed bookmark for parking space ${parkingSpaceId} by user ${userId}`);

  res.status(200).json({
    status: 'success',
    message: 'Bookmark removed successfully',
    data: {
      bookmarkId: bookmark._id,
      parkingSpaceId
    }
  });
});

// Get bookmarks near a location
const getNearbyBookmarks = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { latitude, longitude, maxDistance = 5000 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const nearbyBookmarks = await UserBookmarks.findNearbyBookmarks(
    userId,
    parseFloat(longitude),
    parseFloat(latitude),
    parseInt(maxDistance)
  );

  res.status(200).json({
    status: 'success',
    results: nearbyBookmarks.length,
    data: {
      bookmarks: nearbyBookmarks,
      searchLocation: {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        maxDistance: parseInt(maxDistance)
      }
    }
  });
});

// Get available tags for user's bookmarks
const getAvailableTags = async (userId) => {
  try {
    const pipeline = [
      { $match: { userId: new mongoose.Types.ObjectId(userId), isActive: true } },
      { $unwind: '$tags' },
      { $group: { _id: '$tags', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 20 }
    ];

    const tagResults = await UserBookmarks.aggregate(pipeline);
    return tagResults.map(result => ({
      tag: result._id,
      count: result.count
    }));
  } catch (error) {
    logger.error(`Error getting available tags: ${error.message}`);
    return [];
  }
};

// Check if parking space is bookmarked by user
const checkBookmarkStatus = catchAsync(async (req, res, next) => {
  const { parkingSpaceId } = req.params;
  const userId = req.user.id;

  const bookmark = await UserBookmarks.findOne({
    userId,
    parkingSpaceId,
    isActive: true
  });

  res.status(200).json({
    status: 'success',
    data: {
      isBookmarked: !!bookmark,
      bookmarkId: bookmark?._id || null,
      bookmarkedAt: bookmark?.bookmarkedAt || null
    }
  });
});

// Bulk bookmark operations
const bulkBookmarkOperation = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { operation, parkingSpaceIds, tags } = req.body;

  if (!['add', 'remove', 'tag'].includes(operation)) {
    return next(new AppError('Invalid operation. Must be add, remove, or tag', 400));
  }

  if (!Array.isArray(parkingSpaceIds) || parkingSpaceIds.length === 0) {
    return next(new AppError('parkingSpaceIds must be a non-empty array', 400));
  }

  const results = {
    successful: [],
    failed: []
  };

  for (const parkingSpaceId of parkingSpaceIds) {
    try {
      if (operation === 'add') {
        const { action } = await UserBookmarks.toggleBookmark(userId, parkingSpaceId, { tags });
        if (action === 'added') {
          results.successful.push(parkingSpaceId);
          await ParkingSpace.updateBookmarkStats(parkingSpaceId, 'add', tags || []);
        }
      } else if (operation === 'remove') {
        const bookmark = await UserBookmarks.findOneAndDelete({
          userId,
          parkingSpaceId,
          isActive: true
        });
        if (bookmark) {
          results.successful.push(parkingSpaceId);
          await ParkingSpace.updateBookmarkStats(parkingSpaceId, 'remove');
        }
      } else if (operation === 'tag') {
        const bookmark = await UserBookmarks.findOne({
          userId,
          parkingSpaceId,
          isActive: true
        });
        if (bookmark) {
          bookmark.tags = [...new Set([...bookmark.tags, ...(tags || [])])];
          await bookmark.save();
          results.successful.push(parkingSpaceId);
        }
      }
    } catch (error) {
      results.failed.push({
        parkingSpaceId,
        error: error.message
      });
    }
  }

  logger.info(`📦 Bulk ${operation} operation completed for user ${userId}: ${results.successful.length} successful, ${results.failed.length} failed`);

  res.status(200).json({
    status: 'success',
    message: `Bulk ${operation} operation completed`,
    data: {
      operation,
      results,
      summary: {
        totalRequested: parkingSpaceIds.length,
        successful: results.successful.length,
        failed: results.failed.length
      }
    }
  });
});

module.exports = {
  toggleBookmark,
  getUserBookmarks,
  getBookmarkDetails,
  updateBookmark,
  removeBookmark,
  getNearbyBookmarks,
  checkBookmarkStatus,
  bulkBookmarkOperation
};