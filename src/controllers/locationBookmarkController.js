const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');
const SearchLocation = require('../models/SearchLocation');

/**
 * Toggle location bookmark (add/remove bookmark for search location)
 * @route POST /api/v1/location-bookmark
 */
const toggleLocationBookmark = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { name, latitude, longitude, isBookmarked } = req.body;

  // Validate required fields
  if (!name || !latitude || !longitude || typeof isBookmarked !== 'boolean') {
    return next(new AppError('Name, latitude, longitude, and isBookmarked are required', 400));
  }

  try {
    logger.info(`🔖 ${isBookmarked ? 'Adding' : 'Removing'} location bookmark for "${name}" by user ${userId}`);

    // Find existing search location for this user and coordinates
    const proximityThreshold = 0.001; // ~100 meters
    const existingLocation = await SearchLocation.findOne({
      userId,
      name: { $regex: new RegExp(name.split(',')[0].trim(), 'i') }, // Match first part of name
      latitude: { $gte: latitude - proximityThreshold, $lte: latitude + proximityThreshold },
      longitude: { $gte: longitude - proximityThreshold, $lte: longitude + proximityThreshold },
      isActive: true
    });

    if (isBookmarked) {
      // Add bookmark
      if (existingLocation) {
        // Update existing location to bookmark
        existingLocation.interactionType = 'bookmark';
        existingLocation.searchCount += 1;
        existingLocation.lastSearched = new Date();
        await existingLocation.save();

        logger.info(`✅ Updated existing location to bookmark: ${existingLocation._id}`);
      } else {
        // Create new bookmarked location
        const newBookmark = new SearchLocation({
          userId,
          name,
          latitude,
          longitude,
          location: {
            type: 'Point',
            coordinates: [longitude, latitude]
          },
          category: name.toLowerCase().includes('university') ? 'university' : 'general',
          interactionType: 'bookmark',
          searchCount: 1,
          lastSearched: new Date(),
          firstSearched: new Date()
        });

        await newBookmark.save();
        logger.info(`✅ Created new bookmark location: ${newBookmark._id}`);
      }

      res.status(200).json({
        status: 'success',
        message: 'Location bookmarked successfully',
        data: {
          action: 'bookmarked',
          location: { name, latitude, longitude }
        }
      });
    } else {
      // Remove bookmark
      if (existingLocation && existingLocation.interactionType === 'bookmark') {
        // Change back to search_click or remove if only bookmark interaction
        if (existingLocation.searchCount > 1) {
          existingLocation.interactionType = 'search_click';
          await existingLocation.save();
          logger.info(`📍 Changed bookmark back to search location: ${existingLocation._id}`);
        } else {
          await SearchLocation.deleteOne({ _id: existingLocation._id });
          logger.info(`🗑️ Removed bookmark location: ${existingLocation._id}`);
        }

        res.status(200).json({
          status: 'success',
          message: 'Location bookmark removed successfully',
          data: {
            action: 'removed',
            location: { name, latitude, longitude }
          }
        });
      } else {
        res.status(200).json({
          status: 'success',
          message: 'Location was not bookmarked',
          data: {
            action: 'not_found',
            location: { name, latitude, longitude }
          }
        });
      }
    }

  } catch (error) {
    logger.error('Location bookmark toggle error:', error);
    return next(new AppError('Failed to toggle location bookmark', 500));
  }
});

module.exports = {
  toggleLocationBookmark
};