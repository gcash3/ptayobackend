const mongoose = require('mongoose');
const logger = require('./logger');
const EventEmitter = require('events');

// Database monitoring event emitter
const dbMonitor = new EventEmitter();

const connectDB = async () => {
  try {
    const mongoURI = process.env.NODE_ENV === 'test' 
      ? process.env.MONGODB_TEST_URI 
      : process.env.MONGODB_URI;

    if (!mongoURI) {
      throw new Error('MongoDB URI not provided in environment variables');
    }

    const options = {
      // Remove deprecated options that are now defaults in Mongoose 6+
      // useNewUrlParser: true,
      // useUnifiedTopology: true,

      // Enhanced Connection pool settings for better performance
      maxPoolSize: process.env.NODE_ENV === 'production' ? 20 : 10, // Max concurrent connections
      minPoolSize: process.env.NODE_ENV === 'production' ? 5 : 2, // Maintain minimum connections
      maxIdleTimeMS: 30000, // Close connections after 30 seconds of inactivity
      waitQueueTimeoutMS: 15000, // Wait 15 seconds for connection from pool
      serverSelectionTimeoutMS: 15000, // Keep trying to send operations for 15 seconds
      socketTimeoutMS: 60000, // Close sockets after 60 seconds of inactivity
      heartbeatFrequencyMS: 10000, // Check server status every 10 seconds

      // Performance optimizations
      maxConnecting: 2, // Max number of connections being established at once
      ...(process.env.ENABLE_COMPRESSION !== 'false' && {
        compressors: 'snappy,zlib', // Enable compression if not disabled
        zlibCompressionLevel: 6, // Compression level (1-9)
      }),

      // Write concern and read preference
      writeConcern: {
        w: process.env.NODE_ENV === 'production' ? 'majority' : 1,
        j: process.env.NODE_ENV === 'production' ? true : false, // Journal writes in production
        wtimeout: 15000 // Wait 15 seconds for write concern
      },
      readPreference: 'primaryPreferred', // Read from primary, fallback to secondary
      readConcern: { level: process.env.NODE_ENV === 'production' ? 'majority' : 'local' },

      // Additional options for production
      ...(process.env.NODE_ENV === 'production' && {
        retryWrites: true,
        retryReads: true,
        authMechanism: 'SCRAM-SHA-256'
      })
    };

    // Set global mongoose configuration
    mongoose.set('bufferCommands', false); // Disable mongoose buffering globally
    mongoose.set('strictQuery', false);    // Prepare for mongoose 7

    const conn = await mongoose.connect(mongoURI, options);

    logger.info(`🍃 MongoDB Connected: ${conn.connection.host}`);
    logger.info(`📊 Database: ${conn.connection.name}`);

    // Handle connection events with real-time monitoring
    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      dbMonitor.emit('connectionError', { error: err, timestamp: new Date() });
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected');
      dbMonitor.emit('disconnected', { timestamp: new Date() });
    });

    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      dbMonitor.emit('reconnected', { timestamp: new Date() });
    });

    mongoose.connection.on('connected', () => {
      logger.info('MongoDB connected successfully');
      dbMonitor.emit('connected', { timestamp: new Date() });
    });

    mongoose.connection.on('connecting', () => {
      logger.info('MongoDB connecting...');
      dbMonitor.emit('connecting', { timestamp: new Date() });
    });

    // Monitor slow queries (operations taking > 100ms)
    if (process.env.NODE_ENV !== 'production') {
      mongoose.set('debug', (collectionName, method, query, doc, options) => {
        const executionTime = Date.now() - (options?._startTime || 0);
        if (executionTime > 100) {
          logger.warn(`Slow query detected (${executionTime}ms): ${collectionName}`);
          dbMonitor.emit('slowQuery', {
            collection: collectionName,
            method,
            query,
            executionTime,
            timestamp: new Date()
          });
        }
      });
    }

    // Start connection monitoring
    startConnectionMonitoring();

    // Graceful close
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        logger.info('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        logger.error('Error closing MongoDB connection:', err);
        process.exit(1);
      }
    });

    return conn;

  } catch (error) {
    logger.error('Database connection failed:', error.message);
    
    // Don't exit in test environment
    if (process.env.NODE_ENV !== 'test') {
      process.exit(1);
    }
    
    throw error;
  }
};

// Connection monitoring metrics
let connectionMetrics = {
  connectionAttempts: 0,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  totalDowntime: 0,
  slowQueries: [],
  connectionHistory: []
};

// Start real-time connection monitoring
const startConnectionMonitoring = () => {
  // Check connection status every 30 seconds
  setInterval(async () => {
    try {
      const startTime = Date.now();
      await mongoose.connection.db.admin().ping();
      const responseTime = Date.now() - startTime;

      dbMonitor.emit('healthCheck', {
        status: 'healthy',
        responseTime,
        timestamp: new Date()
      });
    } catch (error) {
      dbMonitor.emit('healthCheck', {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date()
      });
    }
  }, 30000);

  // Listen to monitoring events
  dbMonitor.on('connected', (data) => {
    connectionMetrics.lastConnectedAt = data.timestamp;
    connectionMetrics.connectionHistory.push({
      event: 'connected',
      timestamp: data.timestamp
    });
  });

  dbMonitor.on('disconnected', (data) => {
    connectionMetrics.lastDisconnectedAt = data.timestamp;
    connectionMetrics.connectionHistory.push({
      event: 'disconnected',
      timestamp: data.timestamp
    });
  });

  dbMonitor.on('slowQuery', (data) => {
    connectionMetrics.slowQueries.push(data);
    // Keep only last 100 slow queries
    if (connectionMetrics.slowQueries.length > 100) {
      connectionMetrics.slowQueries = connectionMetrics.slowQueries.slice(-100);
    }
  });

  // Clean up old history every hour
  setInterval(() => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    connectionMetrics.connectionHistory = connectionMetrics.connectionHistory
      .filter(event => event.timestamp > oneHourAgo);
    connectionMetrics.slowQueries = connectionMetrics.slowQueries
      .filter(query => query.timestamp > oneHourAgo);
  }, 3600000);
};

// Enhanced database health check
const checkDBHealth = async () => {
  try {
    const state = mongoose.connection.readyState;
    const states = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    // Perform actual database operations to test health
    const startTime = Date.now();
    const operations = await Promise.allSettled([
      mongoose.connection.db.admin().ping(),
      mongoose.connection.db.stats(),
      mongoose.connection.db.admin().serverStatus()
    ]);
    const responseTime = Date.now() - startTime;

    const [pingResult, statsResult, statusResult] = operations;

    return {
      status: states[state],
      isHealthy: state === 1 && pingResult.status === 'fulfilled',
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      port: mongoose.connection.port,
      collections: Object.keys(mongoose.connection.collections).length,
      responseTime,
      metrics: connectionMetrics,
      operations: {
        ping: pingResult.status === 'fulfilled' ? 'success' : pingResult.reason?.message,
        stats: statsResult.status === 'fulfilled' ? {
          documents: statsResult.value?.objects || 0,
          dataSize: statsResult.value?.dataSize || 0,
          storageSize: statsResult.value?.storageSize || 0,
          indexes: statsResult.value?.indexes || 0
        } : 'failed',
        serverStatus: statusResult.status === 'fulfilled' ? 'available' : 'unavailable'
      },
      poolInfo: {
        maxPoolSize: mongoose.connection.options?.maxPoolSize || 'unknown',
        currentConnections: mongoose.connection.readyState === 1 ? 1 : 0
      }
    };
  } catch (error) {
    return {
      status: 'error',
      isHealthy: false,
      error: error.message,
      metrics: connectionMetrics
    };
  }
};

// Get connection metrics
const getConnectionMetrics = () => {
  return {
    ...connectionMetrics,
    currentStatus: {
      state: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name,
      collections: Object.keys(mongoose.connection.collections).length
    }
  };
};

// Get database performance stats
const getPerformanceStats = async () => {
  try {
    if (mongoose.connection.readyState !== 1) {
      return { error: 'Database not connected' };
    }

    const [dbStats, serverStatus] = await Promise.all([
      mongoose.connection.db.stats(),
      mongoose.connection.db.admin().serverStatus()
    ]);

    return {
      database: {
        collections: dbStats.collections,
        objects: dbStats.objects,
        avgObjSize: dbStats.avgObjSize,
        dataSize: dbStats.dataSize,
        storageSize: dbStats.storageSize,
        indexes: dbStats.indexes,
        indexSize: dbStats.indexSize
      },
      server: {
        uptime: serverStatus.uptime,
        connections: serverStatus.connections,
        memory: serverStatus.mem,
        network: serverStatus.network,
        opcounters: serverStatus.opcounters
      },
      performance: {
        slowQueries: connectionMetrics.slowQueries.length,
        recentSlowQueries: connectionMetrics.slowQueries.slice(-10)
      }
    };
  } catch (error) {
    return { error: error.message };
  }
};

// Function to gracefully close connection
const closeDB = async () => {
  try {
    await mongoose.connection.close();
    logger.info('Database connection closed.');
  } catch (error) {
    logger.error('Error closing database connection:', error);
    throw error;
  }
};

module.exports = {
  connectDB,
  checkDBHealth,
  closeDB,
  getConnectionMetrics,
  getPerformanceStats,
  dbMonitor
}; 