const mongoose = require('mongoose');
const logger = require('../config/logger');

class QueryMonitor {
  constructor() {
    this.slowQueryThreshold = 1000; // 1 second threshold
    this.verySlowQueryThreshold = 5000; // 5 second threshold for alerts
    this.queryStats = new Map();
    this.isMonitoring = false;
  }

  /**
   * Start monitoring MongoDB queries
   */
  startMonitoring() {
    if (this.isMonitoring) {
      logger.info('📊 Query monitoring already active');
      return;
    }

    logger.info('🔍 Starting MongoDB query monitoring...');

    // Monitor all database operations
    mongoose.set('debug', (collectionName, method, query, doc, options) => {
      const startTime = Date.now();

      // Create a unique operation ID for tracking
      const operationId = `${collectionName}_${method}_${Date.now()}_${Math.random()}`;

      // Store query start time
      this.queryStats.set(operationId, {
        collection: collectionName,
        method,
        query: this.sanitizeQuery(query),
        startTime,
        options: this.sanitizeOptions(options)
      });

      // Log the query (optional, can be disabled in production)
      if (process.env.LOG_ALL_QUERIES === 'true') {
        logger.debug(`🔍 Query: ${collectionName}.${method}`, {
          query: this.sanitizeQuery(query),
          options: this.sanitizeOptions(options)
        });
      }
    });

    // Monitor query completion (using mongoose events)
    this.setupQueryEventListeners();

    this.isMonitoring = true;
    logger.info('✅ Query monitoring started');
  }

  /**
   * Setup event listeners for query completion
   */
  setupQueryEventListeners() {
    // Override mongoose Query prototype to catch query completion
    const originalExec = mongoose.Query.prototype.exec;
    const self = this;

    mongoose.Query.prototype.exec = function(callback) {
      const startTime = Date.now();
      const collection = this.mongooseCollection.collectionName;
      const operation = this.op;
      const query = this.getQuery();

      const promise = originalExec.call(this, callback);

      promise
        .then((result) => {
          self.logQueryCompletion(collection, operation, query, startTime, null, result);
          return result;
        })
        .catch((error) => {
          self.logQueryCompletion(collection, operation, query, startTime, error, null);
          throw error;
        });

      return promise;
    };
  }

  /**
   * Log query completion with performance metrics
   */
  logQueryCompletion(collection, operation, query, startTime, error, result) {
    const duration = Date.now() - startTime;
    const queryInfo = {
      collection,
      operation,
      query: this.sanitizeQuery(query),
      duration,
      timestamp: new Date().toISOString()
    };

    // Log based on performance thresholds
    if (error) {
      logger.error(`❌ Query Error [${duration}ms]: ${collection}.${operation}`, {
        ...queryInfo,
        error: error.message,
        stack: error.stack
      });
    } else if (duration > this.verySlowQueryThreshold) {
      logger.warn(`🐌 VERY SLOW QUERY [${duration}ms]: ${collection}.${operation}`, queryInfo);

      // Send alert for very slow queries
      this.sendSlowQueryAlert(queryInfo);
    } else if (duration > this.slowQueryThreshold) {
      logger.warn(`⏰ Slow query detected [${duration}ms]: ${collection}.${operation}`, queryInfo);
    } else {
      // Only log fast queries in debug mode
      if (process.env.LOG_ALL_QUERIES === 'true') {
        logger.debug(`✅ Query completed [${duration}ms]: ${collection}.${operation}`);
      }
    }

    // Track query statistics
    this.updateQueryStatistics(collection, operation, duration, !!error);
  }

  /**
   * Update internal query statistics
   */
  updateQueryStatistics(collection, operation, duration, hasError) {
    const key = `${collection}.${operation}`;

    if (!this.queryStats.has(key)) {
      this.queryStats.set(key, {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        maxDuration: 0,
        minDuration: Infinity,
        errorCount: 0
      });
    }

    const stats = this.queryStats.get(key);
    stats.count++;
    stats.totalDuration += duration;
    stats.avgDuration = stats.totalDuration / stats.count;
    stats.maxDuration = Math.max(stats.maxDuration, duration);
    stats.minDuration = Math.min(stats.minDuration, duration);

    if (hasError) {
      stats.errorCount++;
    }

    this.queryStats.set(key, stats);
  }

  /**
   * Send alert for very slow queries
   */
  sendSlowQueryAlert(queryInfo) {
    // Log detailed alert
    logger.error('🚨 CRITICAL: Very slow query detected!', {
      ...queryInfo,
      threshold: this.verySlowQueryThreshold,
      recommendation: 'Check indexes and query optimization'
    });

    // Here you could integrate with alerting systems like:
    // - Slack notifications
    // - Email alerts
    // - PagerDuty
    // - etc.
  }

  /**
   * Get current query statistics
   */
  getQueryStatistics() {
    const stats = {};

    for (const [key, value] of this.queryStats.entries()) {
      stats[key] = {
        ...value,
        errorRate: (value.errorCount / value.count * 100).toFixed(2) + '%'
      };
    }

    return {
      isMonitoring: this.isMonitoring,
      slowQueryThreshold: this.slowQueryThreshold,
      verySlowQueryThreshold: this.verySlowQueryThreshold,
      totalOperations: Object.values(stats).reduce((sum, stat) => sum + stat.count, 0),
      operationStats: stats
    };
  }

  /**
   * Sanitize query for logging (remove sensitive data)
   */
  sanitizeQuery(query) {
    if (!query || typeof query !== 'object') {
      return query;
    }

    const sanitized = { ...query };

    // Remove sensitive fields
    if (sanitized.password) delete sanitized.password;
    if (sanitized.$and && Array.isArray(sanitized.$and)) {
      sanitized.$and = sanitized.$and.map(condition => {
        if (condition.password) {
          return { password: '[REDACTED]' };
        }
        return condition;
      });
    }

    return sanitized;
  }

  /**
   * Sanitize options for logging
   */
  sanitizeOptions(options) {
    if (!options || typeof options !== 'object') {
      return options;
    }

    return {
      ...options,
      // Keep only relevant options for debugging
      sort: options.sort,
      limit: options.limit,
      skip: options.skip,
      select: options.select,
      populate: options.populate
    };
  }

  /**
   * Reset query statistics
   */
  resetStatistics() {
    this.queryStats.clear();
    logger.info('📊 Query statistics reset');
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    mongoose.set('debug', false);
    this.isMonitoring = false;
    logger.info('🛑 Query monitoring stopped');
  }

  /**
   * Set custom thresholds
   */
  setThresholds(slowThreshold, verySlowThreshold) {
    this.slowQueryThreshold = slowThreshold;
    this.verySlowQueryThreshold = verySlowThreshold;
    logger.info(`📊 Query thresholds updated: slow=${slowThreshold}ms, very_slow=${verySlowThreshold}ms`);
  }
}

// Export singleton instance
module.exports = new QueryMonitor();