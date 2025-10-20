const mongoose = require('mongoose');
const os = require('os');
const { performance } = require('perf_hooks');
const logger = require('../config/logger');
const User = require('../models/User');
const ParkingSpace = require('../models/ParkingSpace');
const Booking = require('../models/Booking');
const Transaction = require('../models/Transaction');

class SystemHealthService {
  constructor() {
    this.startTime = Date.now();
    this.metrics = {
      requests: 0,
      errors: 0,
      responseTimeHistory: [],
      dbQueries: 0,
      dbQueryTime: 0,
      activeConnections: 0,
      memoryUsage: [],
      cpuUsage: [],
      lastHealthCheck: null
    };

    // Start collecting system metrics
    this.startMetricsCollection();
  }

  startMetricsCollection() {
    // Collect memory and CPU usage every 30 seconds
    setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);

    // Clear old metrics every hour
    setInterval(() => {
      this.clearOldMetrics();
    }, 3600000);
  }

  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Store memory usage (in MB)
    this.metrics.memoryUsage.push({
      timestamp: new Date(),
      rss: Math.round(memUsage.rss / 1024 / 1024),
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
      external: Math.round(memUsage.external / 1024 / 1024)
    });

    // Store CPU usage
    this.metrics.cpuUsage.push({
      timestamp: new Date(),
      user: cpuUsage.user,
      system: cpuUsage.system
    });

    // Keep only last 24 hours of data
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    this.metrics.memoryUsage = this.metrics.memoryUsage.filter(m => m.timestamp > oneDayAgo);
    this.metrics.cpuUsage = this.metrics.cpuUsage.filter(c => c.timestamp > oneDayAgo);
  }

  clearOldMetrics() {
    // Keep only last 1000 response times
    if (this.metrics.responseTimeHistory.length > 1000) {
      this.metrics.responseTimeHistory = this.metrics.responseTimeHistory.slice(-1000);
    }
  }

  recordRequest() {
    this.metrics.requests++;
  }

  recordError() {
    this.metrics.errors++;
  }

  recordResponseTime(time) {
    this.metrics.responseTimeHistory.push({
      timestamp: new Date(),
      duration: time
    });
  }

  recordDbQuery(queryTime) {
    this.metrics.dbQueries++;
    this.metrics.dbQueryTime += queryTime;
  }

  updateActiveConnections(count) {
    this.metrics.activeConnections = count;
  }

  async getDatabaseHealth() {
    const startTime = performance.now();

    try {
      // Check MongoDB connection
      const dbState = mongoose.connection.readyState;
      const dbStates = {
        0: 'disconnected',
        1: 'connected',
        2: 'connecting',
        3: 'disconnecting'
      };

      // Test database operations
      const testQueries = await Promise.allSettled([
        User.countDocuments().limit(1),
        ParkingSpace.countDocuments().limit(1),
        Booking.countDocuments().limit(1),
        Transaction.countDocuments().limit(1)
      ]);

      const queryTime = performance.now() - startTime;
      this.recordDbQuery(queryTime);

      const failedQueries = testQueries.filter(result => result.status === 'rejected');
      const hasQueryErrors = failedQueries.length > 0;

      return {
        status: dbState === 1 && !hasQueryErrors ? 'healthy' : 'unhealthy',
        connection: dbStates[dbState],
        responseTime: Math.round(queryTime),
        queryResults: {
          users: testQueries[0].status === 'fulfilled' ? testQueries[0].value : 'error',
          parkingSpaces: testQueries[1].status === 'fulfilled' ? testQueries[1].value : 'error',
          bookings: testQueries[2].status === 'fulfilled' ? testQueries[2].value : 'error',
          transactions: testQueries[3].status === 'fulfilled' ? testQueries[3].value : 'error'
        },
        errors: failedQueries.map(f => f.reason?.message || 'Unknown error'),
        lastChecked: new Date()
      };
    } catch (error) {
      logger.error('Database health check failed:', error);
      return {
        status: 'unhealthy',
        connection: 'error',
        responseTime: performance.now() - startTime,
        error: error.message,
        lastChecked: new Date()
      };
    }
  }

  async getSystemMetrics() {
    const uptime = Date.now() - this.startTime;
    const currentMemory = process.memoryUsage();
    const loadAvg = os.loadavg();

    // Calculate average response time
    const recentResponseTimes = this.metrics.responseTimeHistory
      .filter(r => Date.now() - r.timestamp < 300000) // Last 5 minutes
      .map(r => r.duration);

    const avgResponseTime = recentResponseTimes.length > 0
      ? recentResponseTimes.reduce((a, b) => a + b, 0) / recentResponseTimes.length
      : 0;

    // Calculate error rate
    const errorRate = this.metrics.requests > 0
      ? (this.metrics.errors / this.metrics.requests) * 100
      : 0;

    return {
      uptime: {
        milliseconds: uptime,
        formatted: this.formatUptime(uptime)
      },
      memory: {
        current: {
          rss: Math.round(currentMemory.rss / 1024 / 1024),
          heapUsed: Math.round(currentMemory.heapUsed / 1024 / 1024),
          heapTotal: Math.round(currentMemory.heapTotal / 1024 / 1024),
          external: Math.round(currentMemory.external / 1024 / 1024)
        },
        history: this.metrics.memoryUsage.slice(-20) // Last 20 measurements
      },
      cpu: {
        loadAverage: loadAvg,
        usage: this.metrics.cpuUsage.slice(-20) // Last 20 measurements
      },
      performance: {
        totalRequests: this.metrics.requests,
        totalErrors: this.metrics.errors,
        errorRate: Math.round(errorRate * 100) / 100,
        averageResponseTime: Math.round(avgResponseTime * 100) / 100,
        dbQueries: this.metrics.dbQueries,
        averageDbQueryTime: this.metrics.dbQueries > 0
          ? Math.round((this.metrics.dbQueryTime / this.metrics.dbQueries) * 100) / 100
          : 0
      },
      connections: {
        active: this.metrics.activeConnections,
        database: mongoose.connections.length
      },
      system: {
        platform: os.platform(),
        arch: os.arch(),
        nodeVersion: process.version,
        totalMemory: Math.round(os.totalmem() / 1024 / 1024),
        freeMemory: Math.round(os.freemem() / 1024 / 1024),
        cpuCount: os.cpus().length
      }
    };
  }

  async getComprehensiveHealth() {
    try {
      const [databaseHealth, systemMetrics] = await Promise.all([
        this.getDatabaseHealth(),
        this.getSystemMetrics()
      ]);

      const overallStatus = this.determineOverallHealth(databaseHealth, systemMetrics);

      this.metrics.lastHealthCheck = new Date();

      return {
        status: overallStatus,
        timestamp: new Date(),
        database: databaseHealth,
        system: systemMetrics,
        alerts: this.generateAlerts(databaseHealth, systemMetrics)
      };
    } catch (error) {
      logger.error('Comprehensive health check failed:', error);
      return {
        status: 'unhealthy',
        timestamp: new Date(),
        error: error.message,
        alerts: [{
          type: 'critical',
          message: 'System health check failed',
          details: error.message
        }]
      };
    }
  }

  determineOverallHealth(dbHealth, systemMetrics) {
    // Critical issues
    if (dbHealth.status === 'unhealthy') return 'critical';
    if (systemMetrics.performance.errorRate > 10) return 'critical';

    // Warning conditions
    if (systemMetrics.memory.current.heapUsed > 1000) return 'warning'; // >1GB heap usage
    if (systemMetrics.performance.averageResponseTime > 2000) return 'warning'; // >2s response time
    if (systemMetrics.cpu.loadAverage[0] > 0.8) return 'warning'; // High CPU load

    return 'healthy';
  }

  generateAlerts(dbHealth, systemMetrics) {
    const alerts = [];

    // Database alerts
    if (dbHealth.status === 'unhealthy') {
      alerts.push({
        type: 'critical',
        category: 'database',
        message: 'Database connection unhealthy',
        details: dbHealth.errors?.join(', ') || dbHealth.error || 'Connection issues detected'
      });
    }

    if (dbHealth.responseTime > 1000) {
      alerts.push({
        type: 'warning',
        category: 'database',
        message: 'Slow database response time',
        details: `Database queries taking ${dbHealth.responseTime}ms on average`
      });
    }

    // Memory alerts
    const memUsage = systemMetrics.memory.current.heapUsed;
    if (memUsage > 1500) {
      alerts.push({
        type: 'critical',
        category: 'memory',
        message: 'High memory usage',
        details: `Heap memory usage at ${memUsage}MB`
      });
    } else if (memUsage > 1000) {
      alerts.push({
        type: 'warning',
        category: 'memory',
        message: 'Elevated memory usage',
        details: `Heap memory usage at ${memUsage}MB`
      });
    }

    // CPU alerts
    const cpuLoad = systemMetrics.cpu.loadAverage[0];
    if (cpuLoad > 0.9) {
      alerts.push({
        type: 'critical',
        category: 'cpu',
        message: 'High CPU load',
        details: `System load at ${(cpuLoad * 100).toFixed(1)}%`
      });
    } else if (cpuLoad > 0.7) {
      alerts.push({
        type: 'warning',
        category: 'cpu',
        message: 'Elevated CPU load',
        details: `System load at ${(cpuLoad * 100).toFixed(1)}%`
      });
    }

    // Performance alerts
    const errorRate = systemMetrics.performance.errorRate;
    if (errorRate > 5) {
      alerts.push({
        type: errorRate > 10 ? 'critical' : 'warning',
        category: 'performance',
        message: 'High error rate',
        details: `${errorRate}% of requests are failing`
      });
    }

    const responseTime = systemMetrics.performance.averageResponseTime;
    if (responseTime > 3000) {
      alerts.push({
        type: 'critical',
        category: 'performance',
        message: 'Very slow response times',
        details: `Average response time: ${responseTime}ms`
      });
    } else if (responseTime > 1000) {
      alerts.push({
        type: 'warning',
        category: 'performance',
        message: 'Slow response times',
        details: `Average response time: ${responseTime}ms`
      });
    }

    return alerts;
  }

  formatUptime(milliseconds) {
    const seconds = Math.floor(milliseconds / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
  }

  // Middleware for tracking requests
  createMetricsMiddleware() {
    return (req, res, next) => {
      const startTime = performance.now();

      this.recordRequest();

      // Override res.json to capture response time
      const originalJson = res.json;
      res.json = function(...args) {
        const endTime = performance.now();
        systemHealthService.recordResponseTime(endTime - startTime);
        return originalJson.apply(this, args);
      };

      // Handle errors
      res.on('finish', () => {
        if (res.statusCode >= 400) {
          systemHealthService.recordError();
        }
      });

      next();
    };
  }
}

// Create singleton instance
const systemHealthService = new SystemHealthService();

module.exports = systemHealthService;