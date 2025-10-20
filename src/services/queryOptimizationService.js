const mongoose = require('mongoose');
const logger = require('../config/logger');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const User = require('../models/User');
const Transaction = require('../models/Transaction');

class QueryOptimizationService {
  constructor() {
    this.queryCache = new Map();
    this.cacheExpiryTime = 5 * 60 * 1000; // 5 minutes
    this.indexCheckCompleted = false;
    this.queryMonitoringSetup = false; // Flag to prevent duplicate setup

    // Query performance tracking
    this.slowQueries = [];
    this.queryStats = new Map();

    this.initializeOptimizations();
  }

  async initializeOptimizations() {
    // Only ensure indexes if explicitly enabled (to avoid conflicts with schema indexes)
    if (process.env.ENABLE_PROGRAMMATIC_INDEXES === 'true') {
      await this.ensureIndexes();
    } else {
      logger.info('📊 Skipping programmatic index creation (using schema-defined indexes)');
      this.indexCheckCompleted = true;
    }

    // Set up query performance monitoring
    this.setupQueryMonitoring();

    // Start cache cleanup
    this.startCacheCleanup();
  }

  async ensureIndexes() {
    if (this.indexCheckCompleted) return;

    try {
      logger.info('🔍 Checking and creating database indexes...');

      // ParkingSpace indexes for better query performance
      await this.ensureIndex(ParkingSpace, {
        'adminApproval.status': 1,
        'createdAt': -1
      }, 'admin_approval_status_created');

      await this.ensureIndex(ParkingSpace, {
        'location': '2dsphere'
      }, 'location_geospatial');

      await this.ensureIndex(ParkingSpace, {
        'landlordId': 1,
        'status': 1
      }, 'landlord_status');

      await this.ensureIndex(ParkingSpace, {
        'status': 1,
        'isActive': 1,
        'pricePerHour': 1
      }, 'active_spaces_pricing');

      // Booking indexes
      await this.ensureIndex(Booking, {
        'userId': 1,
        'status': 1,
        'createdAt': -1
      }, 'user_bookings');

      await this.ensureIndex(Booking, {
        'parkingSpaceId': 1,
        'status': 1,
        'startTime': 1
      }, 'space_bookings_time');

      await this.ensureIndex(Booking, {
        'landlordId': 1,
        'status': 1,
        'createdAt': -1
      }, 'landlord_bookings');

      await this.ensureIndex(Booking, {
        'status': 1,
        'startTime': 1,
        'endTime': 1
      }, 'booking_time_range');

      // User indexes
      await this.ensureIndex(User, {
        'email': 1
      }, 'user_email', { unique: true });

      await this.ensureIndex(User, {
        'role': 1,
        'createdAt': -1
      }, 'user_role_created');

      await this.ensureIndex(User, {
        'role': 1,
        'isVerifiedLandlord': 1
      }, 'landlord_verification');

      // Transaction indexes
      await this.ensureIndex(Transaction, {
        'userId': 1,
        'status': 1,
        'createdAt': -1
      }, 'user_transactions');

      await this.ensureIndex(Transaction, {
        'bookingId': 1
      }, 'transaction_booking');

      await this.ensureIndex(Transaction, {
        'status': 1,
        'type': 1,
        'createdAt': -1
      }, 'transaction_status_type');

      this.indexCheckCompleted = true;
      logger.info('✅ Database indexes ensured successfully');

    } catch (error) {
      logger.error('❌ Failed to ensure database indexes:', error);
    }
  }

  async ensureIndex(model, indexSpec, indexName, options = {}) {
    try {
      const collection = model.collection;
      const existingIndexes = await collection.indexes();

      // Check if index already exists by name OR by key pattern
      const indexExists = existingIndexes.some(index => {
        // Check by name
        if (index.name === indexName) {
          return true;
        }

        // Check by key pattern (for cases where index exists with different name)
        const indexKeys = JSON.stringify(index.key);
        const specKeys = JSON.stringify(indexSpec);
        return indexKeys === specKeys;
      });

      if (!indexExists) {
        const indexOptions = {
          name: indexName,
          background: true, // Create index in background
          ...options
        };

        await collection.createIndex(indexSpec, indexOptions);
        logger.info(`📊 Created index: ${indexName} on ${model.modelName}`);
      } else {
        // Find which existing index matches
        const matchingIndex = existingIndexes.find(index => {
          if (index.name === indexName) return true;
          const indexKeys = JSON.stringify(index.key);
          const specKeys = JSON.stringify(indexSpec);
          return indexKeys === specKeys;
        });

        if (matchingIndex) {
          logger.info(`📊 Index already exists: ${matchingIndex.name} (requested: ${indexName}) on ${model.modelName}`);
        }
      }
    } catch (error) {
      // Handle various error types gracefully
      if (error.message?.includes('snappy') || error.message?.includes('compression')) {
        logger.warn(`⚠️  Compression error creating index ${indexName} on ${model.modelName}. Index creation may still succeed. Error: ${error.message}`);
      } else if (error.message?.includes('already exists')) {
        logger.debug(`📊 Index with similar pattern already exists: ${indexName} on ${model.modelName}`);
      } else if (error.message?.includes('different name')) {
        logger.debug(`📊 Index with same keys but different name exists: ${indexName} on ${model.modelName}`);
      } else {
        logger.error(`❌ Failed to create index ${indexName} on ${model.modelName}:`, error);
      }
    }
  }

  setupQueryMonitoring() {
    // Only setup monitoring once
    if (this.queryMonitoringSetup) return;

    // Override mongoose's Query.exec to monitor performance
    const originalExec = mongoose.Query.prototype.exec;

    mongoose.Query.prototype.exec = async function(callback) {
      const startTime = Date.now();
      const queryString = JSON.stringify(this.getQuery());
      const modelName = this.model?.modelName || 'Unknown';

      try {
        const result = await originalExec.call(this, callback);
        const executionTime = Date.now() - startTime;

        // Track query performance
        queryOptimizationService.trackQueryPerformance(modelName, queryString, executionTime);

        return result;
      } catch (error) {
        const executionTime = Date.now() - startTime;
        queryOptimizationService.trackQueryPerformance(modelName, queryString, executionTime, error);
        throw error;
      }
    };

    this.queryMonitoringSetup = true;
    logger.info('📊 Query performance monitoring enabled');
  }

  trackQueryPerformance(modelName, query, executionTime, error = null) {
    // Track in query stats
    const statKey = `${modelName}:${query}`;
    const existing = this.queryStats.get(statKey) || {
      count: 0,
      totalTime: 0,
      avgTime: 0,
      maxTime: 0,
      minTime: Infinity,
      errors: 0
    };

    existing.count++;
    existing.totalTime += executionTime;
    existing.avgTime = existing.totalTime / existing.count;
    existing.maxTime = Math.max(existing.maxTime, executionTime);
    existing.minTime = Math.min(existing.minTime, executionTime);

    if (error) {
      existing.errors++;
    }

    this.queryStats.set(statKey, existing);

    // Track slow queries (>100ms)
    if (executionTime > 100) {
      this.slowQueries.push({
        model: modelName,
        query: query.substring(0, 200), // Limit query string length
        executionTime,
        timestamp: new Date(),
        error: error?.message || null
      });

      // Keep only last 100 slow queries
      if (this.slowQueries.length > 100) {
        this.slowQueries = this.slowQueries.slice(-100);
      }

      logger.warn(`Slow query detected (${executionTime}ms): ${modelName}`, {
        query: query.substring(0, 200),
        executionTime,
        error: error?.message
      });
    }
  }

  startCacheCleanup() {
    // Clean expired cache entries every 5 minutes
    setInterval(() => {
      this.cleanExpiredCache();
    }, 5 * 60 * 1000);
  }

  cleanExpiredCache() {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, value] of this.queryCache.entries()) {
      if (now - value.timestamp > this.cacheExpiryTime) {
        this.queryCache.delete(key);
        cleanedCount++;
      }
    }

    if (cleanedCount > 0) {
      logger.debug(`Cleaned ${cleanedCount} expired cache entries`);
    }
  }

  // Optimized query methods for common operations
  async getActiveParkingSpaces(filters = {}, options = {}) {
    const cacheKey = `active_spaces_${JSON.stringify(filters)}_${JSON.stringify(options)}`;

    // Check cache first
    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    const query = ParkingSpace.find({
      status: 'active',
      isActive: true,
      'adminApproval.status': 'approved',
      ...filters
    });

    if (options.populate) {
      query.populate(options.populate);
    }

    if (options.sort) {
      query.sort(options.sort);
    } else {
      query.sort({ createdAt: -1 }); // Default sort
    }

    if (options.limit) {
      query.limit(parseInt(options.limit));
    }

    if (options.skip) {
      query.skip(parseInt(options.skip));
    }

    const result = await query.lean(); // Use lean() for better performance

    // Cache the result
    this.setCachedResult(cacheKey, result);

    return result;
  }

  async getUserBookings(userId, status = null, options = {}) {
    const filters = { userId };
    if (status) filters.status = status;

    const cacheKey = `user_bookings_${userId}_${status}_${JSON.stringify(options)}`;

    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    const query = Booking.find(filters)
      .populate('parkingSpaceId', 'name address location pricePerHour')
      .sort({ createdAt: -1 });

    if (options.limit) {
      query.limit(parseInt(options.limit));
    }

    const result = await query.lean();
    this.setCachedResult(cacheKey, result);

    return result;
  }

  async getLandlordDashboardData(landlordId) {
    const cacheKey = `landlord_dashboard_${landlordId}`;

    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    // Use aggregation pipeline for better performance
    const [spaceStats, recentBookings, revenue] = await Promise.all([
      // Space statistics
      ParkingSpace.aggregate([
        { $match: { landlordId: new mongoose.Types.ObjectId(landlordId) } },
        {
          $group: {
            _id: null,
            totalSpaces: { $sum: 1 },
            activeSpaces: {
              $sum: {
                $cond: [
                  { $and: [{ $eq: ['$status', 'active'] }, { $eq: ['$isActive', true] }] },
                  1,
                  0
                ]
              }
            },
            approvedSpaces: {
              $sum: {
                $cond: [{ $eq: ['$adminApproval.status', 'approved'] }, 1, 0]
              }
            },
            pendingSpaces: {
              $sum: {
                $cond: [{ $eq: ['$adminApproval.status', 'pending'] }, 1, 0]
              }
            }
          }
        }
      ]),

      // Recent bookings
      Booking.find({ landlordId })
        .populate('userId', 'firstName lastName email')
        .populate('parkingSpaceId', 'name address')
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),

      // Revenue calculation
      Booking.aggregate([
        {
          $match: {
            landlordId: new mongoose.Types.ObjectId(landlordId),
            status: { $in: ['completed', 'active'] }
          }
        },
        {
          $group: {
            _id: null,
            totalRevenue: { $sum: '$totalAmount' },
            totalBookings: { $sum: 1 }
          }
        }
      ])
    ]);

    const result = {
      spaceStats: spaceStats[0] || {
        totalSpaces: 0,
        activeSpaces: 0,
        approvedSpaces: 0,
        pendingSpaces: 0
      },
      recentBookings,
      revenue: revenue[0] || { totalRevenue: 0, totalBookings: 0 }
    };

    this.setCachedResult(cacheKey, result, 2 * 60 * 1000); // Cache for 2 minutes
    return result;
  }

  async getAdminAnalytics() {
    const cacheKey = 'admin_analytics';

    const cached = this.getCachedResult(cacheKey);
    if (cached) return cached;

    const [userStats, spaceStats, bookingStats, revenueStats] = await Promise.all([
      // User statistics
      User.aggregate([
        {
          $group: {
            _id: '$role',
            count: { $sum: 1 }
          }
        }
      ]),

      // Space statistics
      ParkingSpace.aggregate([
        {
          $group: {
            _id: '$adminApproval.status',
            count: { $sum: 1 }
          }
        }
      ]),

      // Booking statistics
      Booking.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalRevenue: { $sum: '$totalAmount' }
          }
        }
      ]),

      // Monthly revenue trend
      Booking.aggregate([
        {
          $match: {
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
            status: { $in: ['completed', 'active'] }
          }
        },
        {
          $group: {
            _id: {
              year: { $year: '$createdAt' },
              month: { $month: '$createdAt' },
              day: { $dayOfMonth: '$createdAt' }
            },
            dailyRevenue: { $sum: '$totalAmount' },
            dailyBookings: { $sum: 1 }
          }
        },
        { $sort: { '_id.year': 1, '_id.month': 1, '_id.day': 1 } }
      ])
    ]);

    const result = {
      users: userStats.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
      spaces: spaceStats.reduce((acc, item) => ({ ...acc, [item._id]: item.count }), {}),
      bookings: bookingStats.reduce((acc, item) => ({
        ...acc,
        [item._id]: { count: item.count, revenue: item.totalRevenue }
      }), {}),
      revenueTrend: revenueStats
    };

    this.setCachedResult(cacheKey, result, 5 * 60 * 1000); // Cache for 5 minutes
    return result;
  }

  getCachedResult(key) {
    const cached = this.queryCache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheExpiryTime) {
      return cached.data;
    }
    return null;
  }

  setCachedResult(key, data, customTTL = null) {
    this.queryCache.set(key, {
      data: data,
      timestamp: Date.now(),
      ttl: customTTL || this.cacheExpiryTime
    });

    // Prevent memory leaks - limit cache size
    if (this.queryCache.size > 1000) {
      const oldestKey = this.queryCache.keys().next().value;
      this.queryCache.delete(oldestKey);
    }
  }

  // Clear cache for specific patterns
  clearCache(pattern = null) {
    if (!pattern) {
      this.queryCache.clear();
      logger.info('All query cache cleared');
      return;
    }

    let cleared = 0;
    for (const key of this.queryCache.keys()) {
      if (key.includes(pattern)) {
        this.queryCache.delete(key);
        cleared++;
      }
    }

    logger.info(`Cleared ${cleared} cache entries matching pattern: ${pattern}`);
  }

  // Get performance statistics
  getPerformanceStats() {
    return {
      cacheSize: this.queryCache.size,
      slowQueries: this.slowQueries.slice(-20), // Last 20 slow queries
      queryStats: Array.from(this.queryStats.entries())
        .map(([key, stats]) => ({ query: key, ...stats }))
        .sort((a, b) => b.avgTime - a.avgTime)
        .slice(0, 20), // Top 20 slowest queries by average time
      indexStatus: this.indexCheckCompleted
    };
  }

  // Force index recreation (admin function)
  async recreateIndexes() {
    this.indexCheckCompleted = false;
    await this.ensureIndexes();
    logger.info('Database indexes recreated');
  }
}

// Create singleton instance
const queryOptimizationService = new QueryOptimizationService();

module.exports = queryOptimizationService;