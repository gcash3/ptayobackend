const ParkingSpace = require('../models/ParkingSpace');
const { catchAsync, AppError } = require('../middleware/errorHandler');
const logger = require('../config/logger');

// Get all parking spaces (with filters)
const getAllParkingSpaces = catchAsync(async (req, res, next) => {
  const {
    latitude,
    longitude,
    radius = 2, // default 5km radius
    minPrice,
    maxPrice,
    amenities,
    vehicleType,
    page = 1,
    limit = 20,
    sortBy = 'distance'
  } = req.query;

  let query = {
    status: 'active',  // Only show approved spaces
    isVerified: true,
    availableSpots: { $gt: 0 }
  };

  // Price filter (support both pricePer3Hours and legacy pricePerHour)
  if (minPrice || maxPrice) {
    const priceConditions = [];

    // Check pricePer3Hours (convert to hourly for comparison)
    if (minPrice || maxPrice) {
      const per3HourCondition = {};
      if (minPrice) per3HourCondition.$gte = parseFloat(minPrice) * 3; // Convert hourly to 3-hour
      if (maxPrice) per3HourCondition.$lte = parseFloat(maxPrice) * 3;
      priceConditions.push({ pricePer3Hours: per3HourCondition });
    }

    // Also check legacy pricePerHour field
    if (minPrice || maxPrice) {
      const perHourCondition = {};
      if (minPrice) perHourCondition.$gte = parseFloat(minPrice);
      if (maxPrice) perHourCondition.$lte = parseFloat(maxPrice);
      priceConditions.push({ pricePerHour: perHourCondition });
    }

    query.$or = priceConditions;
  }

  // Amenities filter
  if (amenities) {
    const amenityList = Array.isArray(amenities) ? amenities : [amenities];
    query.amenities = { $in: amenityList };
  }

  // Vehicle type filter
  if (vehicleType) {
    query.vehicleTypes = vehicleType;
  }

  let parkingSpaces;

  // Location-based search
  if (latitude && longitude) {
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);
    
    query.location = {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [lng, lat]
        },
        $maxDistance: parseFloat(radius) * 1000 // Convert km to meters
      }
    };

    parkingSpaces = await ParkingSpace.findCustomerSpaces(query)
      .populate('landlord', 'firstName lastName averageRating totalReviews')
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
  } else {
    // Regular search without location
    let sortOption = {};
    
    switch (sortBy) {
      case 'price_low':
        sortOption = { pricePer3Hours: 1 }; // Sort by 3-hour price
        break;
      case 'price_high':
        sortOption = { pricePer3Hours: -1 }; // Sort by 3-hour price
        break;
      case 'rating':
        sortOption = { averageRating: -1 };
        break;
      case 'newest':
        sortOption = { createdAt: -1 };
        break;
      default:
        sortOption = { averageRating: -1 };
    }

    parkingSpaces = await ParkingSpace.findCustomerSpaces(query)
      .populate('landlord', 'firstName lastName averageRating totalReviews')
      .sort(sortOption)
      .limit(parseInt(limit))
      .skip((parseInt(page) - 1) * parseInt(limit));
  }

  // Calculate distances if location is provided
  if (latitude && longitude) {
    parkingSpaces = parkingSpaces.map(space => {
      const distance = calculateDistance(
        parseFloat(latitude),
        parseFloat(longitude),
        space.latitude,
        space.longitude
      );
      return {
        ...space.toObject(),
        distance: Math.round(distance * 100) / 100 // Round to 2 decimal places
      };
    });
  }

  res.status(200).json({
    status: 'success',
    results: parkingSpaces.length,
    data: {
      parkingSpaces
    }
  });
});

// Search parking spaces
const searchParkingSpaces = catchAsync(async (req, res, next) => {
  const { 
    q: searchTerm, 
    latitude, 
    longitude,
    limit = 20 
  } = req.query;

  if (!searchTerm) {
    return next(new AppError('Search term is required', 400));
  }

  const parkingSpaces = await ParkingSpace.searchSpaces(
    searchTerm, 
    latitude ? parseFloat(latitude) : null, 
    longitude ? parseFloat(longitude) : null
  )
    .populate('landlord', 'firstName lastName averageRating totalReviews')
    .limit(parseInt(limit));

  // Filter to only show customer-visible spaces
  const customerSpaces = parkingSpaces.filter(space => 
    space.status === 'active' && space.isVerified
  );

  res.status(200).json({
    status: 'success',
    results: customerSpaces.length,
    data: {
      parkingSpaces: customerSpaces
    }
  });
});

// Get nearby parking spaces
const getNearbyParkingSpaces = catchAsync(async (req, res, next) => {
  const { latitude, longitude, radius = 2 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const parkingSpaces = await ParkingSpace.findNearby(
    parseFloat(longitude),
    parseFloat(latitude),
    parseFloat(radius)
  )
    .where('status').equals('active')  // Only active spaces
    .where('isVerified').equals(true)  // Only verified spaces
    .populate('landlord', 'firstName lastName averageRating totalReviews');

  // Add distance calculation
  const spacesWithDistance = parkingSpaces.map(space => {
    const distance = calculateDistance(
      parseFloat(latitude),
      parseFloat(longitude),
      space.latitude,
      space.longitude
    );
    return {
      ...space.toObject(),
      distance: Math.round(distance * 100) / 100
    };
  });

  res.status(200).json({
    status: 'success',
    results: spacesWithDistance.length,
    data: {
      parkingSpaces: spacesWithDistance
    }
  });
});

// Get single parking space
const getParkingSpace = catchAsync(async (req, res, next) => {
  const parkingSpace = await ParkingSpace.findById(req.params.id)
    .populate('landlord', 'firstName lastName averageRating totalReviews phoneNumber')
    .populate({
      path: 'reviews',
      populate: {
        path: 'clientId',
        select: 'firstName lastName'
      }
    });

  if (!parkingSpace) {
    return next(new AppError('No parking space found with that ID', 404));
  }

  // Check if space is available for customers (active and verified)
  if (parkingSpace.status !== 'active' || !parkingSpace.isVerified) {
    return next(new AppError('This parking space is not available', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      parkingSpace
    }
  });
});

// Check availability
const checkAvailability = catchAsync(async (req, res, next) => {
  const { startTime, endTime } = req.body;
  const parkingSpaceId = req.params.id;

  if (!startTime || !endTime) {
    return next(new AppError('Start time and end time are required', 400));
  }

  const parkingSpace = await ParkingSpace.findById(parkingSpaceId);
  
  if (!parkingSpace) {
    return next(new AppError('No parking space found with that ID', 404));
  }

  // Only allow availability check for active spaces
  if (parkingSpace.status !== 'active' || !parkingSpace.isVerified) {
    return next(new AppError('This parking space is not available for booking', 400));
  }

  // Check for conflicting bookings (overlapping time slots)
  const Booking = require('../models/Booking');
  const conflicts = await Booking.checkConflicts(
    parkingSpaceId,
    new Date(startTime),
    new Date(endTime)
  );

  // Count how many slots are occupied during the requested time
  const occupiedSlots = conflicts.length;
  const totalSlots = parkingSpace.totalSpots || 1;
  const availableSlots = Math.max(0, totalSlots - occupiedSlots);
  const isAvailable = availableSlots > 0;

  res.status(200).json({
    status: 'success',
    data: {
      available: isAvailable,
      availableSlots: availableSlots,
      totalSlots: totalSlots,
      occupiedSlots: occupiedSlots,
      conflicts: conflicts.length
    }
  });
});

// Get nearby universities
const getNearbyUniversities = catchAsync(async (req, res, next) => {
  const { latitude, longitude, radius = 5 } = req.query;

  if (!latitude || !longitude) {
    return next(new AppError('Latitude and longitude are required', 400));
  }

  const universities = await ParkingSpace.findUniversitiesNearby(
    parseFloat(longitude),
    parseFloat(latitude),
    parseFloat(radius)
  );

  res.status(200).json({
    status: 'success',
    results: universities.length,
    data: {
      universities
    }
  });
});

// Get parking spaces for map display with area bounds
const getParkingSpacesForMap = catchAsync(async (req, res, next) => {
  const {
    northEast, // { lat: number, lng: number }
    southWest, // { lat: number, lng: number }
    zoom = 15,
    limit = 100,
    minPrice,
    maxPrice,
    amenities,
    vehicleType,
    includePending = false // For admin view
  } = req.query;

  // Validate bounds
  if (!northEast || !southWest) {
    return next(new AppError('Map bounds (northEast and southWest) are required', 400));
  }

  let northEastCoords, southWestCoords;
  try {
    northEastCoords = typeof northEast === 'string' ? JSON.parse(northEast) : northEast;
    southWestCoords = typeof southWest === 'string' ? JSON.parse(southWest) : southWest;
  } catch (error) {
    return next(new AppError('Invalid bounds format. Expected: {lat: number, lng: number}', 400));
  }

  // Build query for spaces within map bounds
  let query = {
    location: {
      $geoWithin: {
        $box: [
          [southWestCoords.lng, southWestCoords.lat], // bottom-left
          [northEastCoords.lng, northEastCoords.lat]  // top-right
        ]
      }
    }
  };

  // Default to only active and verified spaces for customers
  if (!includePending) {
    query.status = 'active';
    query.isVerified = true;
    query.availableSpots = { $gt: 0 };
  }

  // Price filter
  if (minPrice || maxPrice) {
    query.pricePerHour = {};
    if (minPrice) query.pricePerHour.$gte = parseFloat(minPrice);
    if (maxPrice) query.pricePerHour.$lte = parseFloat(maxPrice);
  }

  // Amenities filter
  if (amenities) {
    const amenityList = Array.isArray(amenities) ? amenities : [amenities];
    query.amenities = { $in: amenityList };
  }

  // Vehicle type filter
  if (vehicleType) {
    query.vehicleTypes = vehicleType;
  }

  const parkingSpaces = await ParkingSpace.find(query)
    .populate('landlord', 'firstName lastName averageRating totalReviews')
    .select('name address latitude longitude pricePerHour pricePer3Hours overtimeRatePerHour dailyRate amenities images averageRating totalReviews availableSpots totalSpots type status isVerified landlord')
    .limit(parseInt(limit))
    .lean(); // Use lean() for better performance

  logger.info(`🗺️ Map API: Found ${parkingSpaces.length} spaces. First space pricePer3Hours: ${parkingSpaces[0]?.pricePer3Hours}, pricePerHour: ${parkingSpaces[0]?.pricePerHour}`);

  // Format for map display
  const mapSpaces = parkingSpaces.map(space => ({
    id: space._id,
    name: space.name,
    address: space.address,
    position: {
      lat: space.latitude,
      lng: space.longitude
    },
    pricing: {
      hourly: space.pricePerHour,
      per3Hours: space.pricePer3Hours,
      overtime: space.overtimeRatePerHour,
      daily: space.dailyRate
    },
    availability: {
      available: space.availableSpots,
      total: space.totalSpots,
      isAvailable: space.availableSpots > 0
    },
    amenities: space.amenities,
    rating: space.averageRating,
    totalReviews: space.totalReviews,
    type: space.type,
    status: space.status,
    isVerified: space.isVerified,
    imageUrl: space.images && space.images.length > 0 ? space.images[0].url : null,
    landlord: space.landlord ? {
      name: `${space.landlord.firstName} ${space.landlord.lastName}`,
      rating: space.landlord.averageRating || 0,
      totalReviews: space.landlord.totalReviews || 0
    } : null
  }));

  // Add clustering information based on zoom level
  const clusteringEnabled = parseInt(zoom) < 16;
  
  res.status(200).json({
    status: 'success',
    results: mapSpaces.length,
    data: {
      parkingSpaces: mapSpaces,
      bounds: {
        northEast: northEastCoords,
        southWest: southWestCoords
      },
      clustering: {
        enabled: clusteringEnabled,
        zoom: parseInt(zoom)
      },
      filters: {
        minPrice: minPrice ? parseFloat(minPrice) : null,
        maxPrice: maxPrice ? parseFloat(maxPrice) : null,
        amenities: amenities ? (Array.isArray(amenities) ? amenities : [amenities]) : [],
        vehicleType: vehicleType || null
      }
    }
  });
});

// Get parking space clusters for map optimization
const getParkingSpaceClusters = catchAsync(async (req, res, next) => {
  const {
    northEast,
    southWest,
    zoom = 15,
    clusterRadius = 50 // pixels
  } = req.query;

  // Validate bounds
  if (!northEast || !southWest) {
    return next(new AppError('Map bounds (northEast and southWest) are required', 400));
  }

  let northEastCoords, southWestCoords;
  try {
    northEastCoords = typeof northEast === 'string' ? JSON.parse(northEast) : northEast;
    southWestCoords = typeof southWest === 'string' ? JSON.parse(southWest) : southWest;
  } catch (error) {
    return next(new AppError('Invalid bounds format', 400));
  }

  // Use MongoDB aggregation for clustering
  const clusters = await ParkingSpace.aggregate([
    {
      $match: {
        location: {
          $geoWithin: {
            $box: [
              [southWestCoords.lng, southWestCoords.lat],
              [northEastCoords.lng, northEastCoords.lat]
            ]
          }
        },
        status: 'active',
        isVerified: true,
        availableSpots: { $gt: 0 }
      }
    },
    {
      $addFields: {
        // Create grid cells for clustering based on zoom level
        gridLat: {
          $floor: {
            $multiply: [
              '$latitude',
              { $pow: [10, { $subtract: [parseInt(zoom), 10] }] }
            ]
          }
        },
        gridLng: {
          $floor: {
            $multiply: [
              '$longitude',
              { $pow: [10, { $subtract: [parseInt(zoom), 10] }] }
            ]
          }
        }
      }
    },
    {
      $group: {
        _id: {
          gridLat: '$gridLat',
          gridLng: '$gridLng'
        },
        count: { $sum: 1 },
        avgPrice: { $avg: '$pricePerHour' },
        avgRating: { $avg: '$averageRating' },
        totalSpots: { $sum: '$availableSpots' },
        centerLat: { $avg: '$latitude' },
        centerLng: { $avg: '$longitude' },
        spaces: {
          $push: {
            id: '$_id',
            name: '$name',
            price: '$pricePerHour',
            rating: '$averageRating',
            available: '$availableSpots'
          }
        }
      }
    },
    {
      $match: {
        count: { $gte: 1 }
      }
    },
    {
      $sort: { count: -1 }
    },
    {
      $limit: 50
    }
  ]);

  const formattedClusters = clusters.map(cluster => ({
    position: {
      lat: cluster.centerLat,
      lng: cluster.centerLng
    },
    count: cluster.count,
    avgPrice: Math.round(cluster.avgPrice),
    avgRating: Math.round(cluster.avgRating * 10) / 10,
    totalSpots: cluster.totalSpots,
    spaces: cluster.spaces.slice(0, 5) // Limit to 5 spaces per cluster preview
  }));

  res.status(200).json({
    status: 'success',
    results: formattedClusters.length,
    data: {
      clusters: formattedClusters,
      bounds: {
        northEast: northEastCoords,
        southWest: southWestCoords
      },
      zoom: parseInt(zoom)
    }
  });
});

// Helper function to calculate distance between two points
function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Radius of the Earth in kilometers
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLng = (lng2 - lng1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c; // Distance in kilometers
}

// Seed database with sample parking spaces (for development/testing)
const seedParkingSpaces = catchAsync(async (req, res, next) => {
  // Check if seed data already exists
  const existingSpaces = await ParkingSpace.countDocuments();
  if (existingSpaces > 0) {
    return res.status(200).json({
      status: 'success',
      message: `Database already has ${existingSpaces} parking spaces. Skipping seed.`,
      data: { count: existingSpaces }
    });
  }

  // Create test landlord if not exists
  const User = require('../models/User');
  let testLandlord = await User.findOne({ email: 'landlord@parktayo.com' });
  
  if (!testLandlord) {
    testLandlord = await User.create({
      firstName: 'Demo',
      lastName: 'Landlord',
      email: 'landlord@parktayo.com',
      password: 'landlord123',
      role: 'landlord',
      isEmailVerified: true,
      isVerifiedLandlord: true
    });
  }

  // Create test admin if not exists
  let testAdmin = await User.findOne({ email: 'admin@parktayo.com' });
  
  if (!testAdmin) {
    testAdmin = await User.create({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@parktayo.com',
      password: 'admin123',
      role: 'admin',
      isEmailVerified: true
    });
  }

  // Sample parking spaces data (created as pending for approval workflow)
  const sampleSpaces = [
    {
      name: 'UE Large Parking Lot',
      description: 'Large parking area near University of the East main campus',
      address: 'Near UE, C.M. Recto Ave, Manila',
      location: {
        type: 'Point',
        coordinates: [120.9827, 14.5997] // [longitude, latitude]
      },
      latitude: 14.5997,
      longitude: 120.9827,
      pricePerHour: 20.0,
      dailyRate: 150.0,
      amenities: ['CCTV', 'Security Guard', '24/7 Access'],
      type: 'Open Lot',
      totalSpots: 45,
      availableSpots: 45,
      landlordId: testLandlord._id,
      status: 'pending',  // Starts as pending for admin approval
      adminApproval: {
        status: 'pending'
      },
      isVerified: false,  // Will be set to true when approved
      vehicleTypes: ['car', 'motorcycle'],
      nearbyUniversities: [{ name: 'University of the East', distance: 0.1 }]
    },
    {
      name: 'CM Recto Covered Parking',
      description: 'Covered parking with security near UE Manila',
      address: '2227 C.M. Recto Ave, Sampaloc, Manila',
      location: {
        type: 'Point',
        coordinates: [120.9806, 14.5994]
      },
      latitude: 14.5994,
      longitude: 120.9806,
      pricePerHour: 25.0,
      dailyRate: 200.0,
      amenities: ['Covered', 'Security Guard', 'CCTV', 'Well-lit'],
      type: 'Covered Parking',
      totalSpots: 30,
      availableSpots: 30,
      landlordId: testLandlord._id,
      status: 'pending',  // Starts as pending for admin approval
      adminApproval: {
        status: 'pending'
      },
      isVerified: false,  // Will be set to true when approved
      vehicleTypes: ['car'],
      nearbyUniversities: [{ name: 'University of the East', distance: 0.2 }]
    },
    {
      name: 'Legarda Budget Parking',
      description: 'Affordable parking option near UE and Legarda area',
      address: 'Legarda St., Sampaloc, Manila',
      location: {
        type: 'Point',
        coordinates: [120.9818, 14.5986]
      },
      latitude: 14.5986,
      longitude: 120.9818,
      pricePerHour: 15.0,
      dailyRate: 120.0,
      amenities: ['CCTV', 'Budget-friendly'],
      type: 'Empty Lot',
      totalSpots: 25,
      availableSpots: 25,
      landlordId: testLandlord._id,
      status: 'pending',  // Starts as pending for admin approval
      adminApproval: {
        status: 'pending'
      },
      isVerified: false,  // Will be set to true when approved
      vehicleTypes: ['car', 'motorcycle'],
      nearbyUniversities: [{ name: 'University of the East', distance: 0.3 }]
    }
  ];

  // Create parking spaces
  const createdSpaces = await ParkingSpace.create(sampleSpaces);

  logger.info('Sample parking spaces created with pending status', {
    count: createdSpaces.length,
    landlordId: testLandlord._id,
    adminId: testAdmin._id,
    status: 'pending'
  });

  res.status(201).json({
    status: 'success',
    message: `Successfully created ${createdSpaces.length} sample parking spaces (pending admin approval)`,
    data: {
      count: createdSpaces.length,
      parkingSpaces: createdSpaces,
      landlord: testLandlord,
      admin: testAdmin,
      note: 'Parking spaces created with pending status. Use admin endpoints to approve them.'
    }
  });
});

// Clear database and reseed (for development/testing only)
const clearAndReseed = catchAsync(async (req, res, next) => {
  if (process.env.NODE_ENV === 'production') {
    return next(new AppError('This operation is not allowed in production', 403));
  }

  const User = require('../models/User');

  // Clear existing data
  await ParkingSpace.deleteMany({});
  await User.deleteMany({});

  logger.info('Database cleared, reseeding...');

  // Now call the regular seed function
  req.body = {}; // Reset body for seed function
  await seedParkingSpaces(req, res, next);
});

module.exports = {
  getAllParkingSpaces,
  searchParkingSpaces,
  getNearbyParkingSpaces,
  getParkingSpace,
  getParkingSpacesForMap,
  getParkingSpaceClusters,
  checkAvailability,
  getNearbyUniversities,
  seedParkingSpaces,
  clearAndReseed
}; 