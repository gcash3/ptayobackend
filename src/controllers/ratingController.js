const Rating = require('../models/Rating');
const Booking = require('../models/Booking');
const ParkingSpace = require('../models/ParkingSpace');
const { catchAsync } = require('../middleware/errorHandler');
const logger = require('../config/logger');

/**
 * Submit a rating for a parking space
 */
const submitRating = catchAsync(async (req, res) => {
  const {
    parkingSpaceId,
    bookingId,
    rating,
    review,
    aspects,
    isAnonymous = false
  } = req.body;

  const userId = req.user.id;

  // Validate that user can rate this parking space
  const { canRate, reason, booking } = await Rating.canUserRate(userId, parkingSpaceId, bookingId);
  
  if (!canRate) {
    return res.status(400).json({
      status: 'error',
      message: reason
    });
  }

  // Create the rating
  const newRating = new Rating({
    userId,
    parkingSpaceId,
    bookingId,
    rating,
    review: review?.trim() || '',
    aspects: aspects || {},
    isAnonymous,
    isVerified: true // Since we validated the booking
  });

  await newRating.save();

  // Update parking space ratings
  const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
  if (parkingSpace) {
    await parkingSpace.updateRating();
  }

  logger.info(`User ${userId} submitted rating for parking space ${parkingSpaceId}`);

  res.status(201).json({
    status: 'success',
    message: 'Rating submitted successfully',
    data: {
      rating: newRating.toSafeObject(true)
    }
  });
});

/**
 * Get ratings for a parking space
 */
const getParkingSpaceRatings = catchAsync(async (req, res) => {
  const { parkingSpaceId } = req.params;
  const { 
    page = 1, 
    limit = 10, 
    sortBy = 'createdAt',
    sortOrder = 'desc',
    includeAspects = true 
  } = req.query;

  const sort = {};
  sort[sortBy] = sortOrder === 'asc' ? 1 : -1;

  const ratings = await Rating.find({ 
    parkingSpaceId, 
    status: 'active' 
  })
    .populate('user', 'firstName lastName')
    .populate('booking', 'startTime endTime duration')
    .sort(sort)
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Rating.countDocuments({ 
    parkingSpaceId, 
    status: 'active' 
  });

  // Get rating statistics
  const stats = await Rating.getAverageRating(parkingSpaceId);

  // Transform ratings for safe output
  const safeRatings = ratings.map(rating => rating.toSafeObject(true));

  res.status(200).json({
    status: 'success',
    message: 'Ratings retrieved successfully',
    data: {
      ratings: safeRatings,
      statistics: stats,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    }
  });
});

/**
 * Get user's ratings
 */
const getUserRatings = catchAsync(async (req, res) => {
  const userId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  const ratings = await Rating.find({ userId })
    .populate('parkingSpace', 'name address images')
    .populate('booking', 'startTime endTime totalAmount')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Rating.countDocuments({ userId });

  res.status(200).json({
    status: 'success',
    message: 'User ratings retrieved successfully',
    data: {
      ratings,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    }
  });
});

/**
 * Get landlord's parking space ratings summary
 */
const getLandlordRatings = catchAsync(async (req, res) => {
  const landlordId = req.user.id;
  const { page = 1, limit = 10 } = req.query;

  // Get all parking spaces for this landlord
  const parkingSpaces = await ParkingSpace.find({ landlordId }).select('_id name');
  const parkingSpaceIds = parkingSpaces.map(space => space._id);

  if (parkingSpaceIds.length === 0) {
    return res.status(200).json({
      status: 'success',
      message: 'No parking spaces found',
      data: {
        ratings: [],
        summary: {
          totalRatings: 0,
          averageRating: 0,
          totalSpaces: 0
        },
        pagination: {
          currentPage: 1,
          totalPages: 0,
          totalItems: 0,
          itemsPerPage: parseInt(limit)
        }
      }
    });
  }

  // Get ratings from Rating collection (separate rating documents)
  const ratings = await Rating.find({ 
    parkingSpaceId: { $in: parkingSpaceIds },
    status: 'active'
  })
    .populate('user', 'firstName lastName')
    .populate('parkingSpace', 'name address')
    .populate('booking', 'startTime endTime')
    .sort({ createdAt: -1 })
    .limit(limit * 1)
    .skip((page - 1) * limit);

  const total = await Rating.countDocuments({ 
    parkingSpaceId: { $in: parkingSpaceIds },
    status: 'active'
  });

  // Calculate summary statistics from Rating collection
  const summaryStats = await Rating.aggregate([
    { 
      $match: { 
        parkingSpaceId: { $in: parkingSpaceIds },
        status: 'active'
      } 
    },
    {
      $group: {
        _id: null,
        totalRatings: { $sum: 1 },
        averageRating: { $avg: '$rating' },
        spacesWithRatings: { $addToSet: '$parkingSpaceId' }
      }
    }
  ]);

  const summary = summaryStats[0] || { totalRatings: 0, averageRating: 0, spacesWithRatings: [] };
  summary.averageRating = Math.round((summary.averageRating || 0) * 10) / 10;
  summary.totalSpaces = parkingSpaces.length;
  summary.ratedSpaces = summary.spacesWithRatings ? summary.spacesWithRatings.length : 0;
  delete summary.spacesWithRatings;

  // Transform ratings for safe output
  const safeRatings = ratings.map(rating => rating.toSafeObject(true));

  res.status(200).json({
    status: 'success',
    message: 'Landlord ratings retrieved successfully',
    data: {
      ratings: safeRatings,
      summary,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / limit),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    }
  });
});

/**
 * Update rating (edit existing rating)
 */
const updateRating = catchAsync(async (req, res) => {
  const { ratingId } = req.params;
  const { rating, review, aspects } = req.body;
  const userId = req.user.id;

  const existingRating = await Rating.findOne({ _id: ratingId, userId });
  
  if (!existingRating) {
    return res.status(404).json({
      status: 'error',
      message: 'Rating not found or you do not have permission to edit it'
    });
  }

  // Update the rating
  if (rating !== undefined) existingRating.rating = rating;
  if (review !== undefined) existingRating.review = review.trim();
  if (aspects !== undefined) existingRating.aspects = { ...existingRating.aspects, ...aspects };

  await existingRating.save();

  // Update parking space ratings
  const parkingSpace = await ParkingSpace.findById(existingRating.parkingSpaceId);
  if (parkingSpace) {
    await parkingSpace.updateRating();
  }

  logger.info(`User ${userId} updated rating ${ratingId}`);

  res.status(200).json({
    status: 'success',
    message: 'Rating updated successfully',
    data: {
      rating: existingRating.toSafeObject(true)
    }
  });
});

/**
 * Delete rating
 */
const deleteRating = catchAsync(async (req, res) => {
  const { ratingId } = req.params;
  const userId = req.user.id;

  const rating = await Rating.findOne({ _id: ratingId, userId });
  
  if (!rating) {
    return res.status(404).json({
      status: 'error',
      message: 'Rating not found or you do not have permission to delete it'
    });
  }

  await Rating.findByIdAndDelete(ratingId);

  // Update parking space ratings
  const parkingSpace = await ParkingSpace.findById(rating.parkingSpaceId);
  if (parkingSpace) {
    await parkingSpace.updateRating();
  }

  logger.info(`User ${userId} deleted rating ${ratingId}`);

  res.status(200).json({
    status: 'success',
    message: 'Rating deleted successfully'
  });
});

/**
 * Check if user can rate a specific parking space/booking
 */
const checkCanRate = catchAsync(async (req, res) => {
  const { parkingSpaceId, bookingId } = req.params;
  const userId = req.user.id;

  const { canRate, reason, booking } = await Rating.canUserRate(userId, parkingSpaceId, bookingId);

  res.status(200).json({
    status: 'success',
    data: {
      canRate,
      reason: canRate ? null : reason,
      booking: canRate ? {
        id: booking._id,
        startTime: booking.startTime,
        endTime: booking.endTime,
        parkingSpace: booking.parkingSpaceId
      } : null
    }
  });
});

/**
 * Landlord response to rating
 */
const respondToRating = catchAsync(async (req, res) => {
  const { ratingId } = req.params;
  const { message } = req.body;
  const landlordId = req.user.id;

  const rating = await Rating.findById(ratingId).populate('parkingSpace');
  
  if (!rating) {
    return res.status(404).json({
      status: 'error',
      message: 'Rating not found'
    });
  }

  // Check if user is the landlord of this parking space
  if (rating.parkingSpace.landlordId.toString() !== landlordId) {
    return res.status(403).json({
      status: 'error',
      message: 'You do not have permission to respond to this rating'
    });
  }

  rating.landlordResponse = {
    message: message.trim(),
    respondedAt: new Date(),
    respondedBy: landlordId
  };

  await rating.save();

  logger.info(`Landlord ${landlordId} responded to rating ${ratingId}`);

  res.status(200).json({
    status: 'success',
    message: 'Response submitted successfully',
    data: {
      rating: rating.toSafeObject(true)
    }
  });
});

module.exports = {
  submitRating,
  getParkingSpaceRatings,
  getUserRatings,
  getLandlordRatings,
  updateRating,
  deleteRating,
  checkCanRate,
  respondToRating
};
