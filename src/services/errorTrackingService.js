const logger = require('../config/logger');
const realTimeDashboardService = require('./realTimeDashboardService');

class ErrorTrackingService {
  constructor() {
    this.errorStats = {
      total: 0,
      last24Hours: 0,
      byType: new Map(),
      byEndpoint: new Map(),
      recentErrors: []
    };

    this.alertThresholds = {
      errorRate: 10, // errors per minute
      criticalErrorCount: 5, // critical errors in 5 minutes
      memoryUsage: 85, // percentage
      responseTime: 5000 // milliseconds
    };

    this.startErrorTracking();
  }

  startErrorTracking() {
    // Clean up old error stats every hour
    setInterval(() => {
      this.cleanupOldErrors();
    }, 3600000); // 1 hour

    // Check error rates every minute
    setInterval(() => {
      this.checkErrorRates();
    }, 60000); // 1 minute
  }

  cleanupOldErrors() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Clean recent errors older than 24 hours
    this.errorStats.recentErrors = this.errorStats.recentErrors
      .filter(error => error.timestamp > oneDayAgo);

    // Recalculate last24Hours count
    this.errorStats.last24Hours = this.errorStats.recentErrors.length;
  }

  checkErrorRates() {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    const recentErrors = this.errorStats.recentErrors
      .filter(error => error.timestamp > fiveMinutesAgo);

    const errorRate = recentErrors.length / 5; // errors per minute
    const criticalErrors = recentErrors.filter(error =>
      error.level === 'critical' || error.statusCode >= 500
    );

    // Check if we should send alerts
    if (errorRate > this.alertThresholds.errorRate) {
      this.sendAlert('HIGH_ERROR_RATE', {
        rate: errorRate,
        threshold: this.alertThresholds.errorRate,
        recentErrors: recentErrors.slice(-10) // Last 10 errors
      });
    }

    if (criticalErrors.length >= this.alertThresholds.criticalErrorCount) {
      this.sendAlert('CRITICAL_ERRORS', {
        count: criticalErrors.length,
        threshold: this.alertThresholds.criticalErrorCount,
        errors: criticalErrors
      });
    }
  }

  trackError(error, context = {}) {
    const errorData = {
      id: this.generateErrorId(),
      message: error.message,
      stack: error.stack,
      name: error.name,
      level: this.determineErrorLevel(error, context),
      statusCode: context.statusCode || 500,
      endpoint: context.endpoint || 'unknown',
      method: context.method || 'unknown',
      userId: context.userId || null,
      userAgent: context.userAgent || null,
      ip: context.ip || null,
      timestamp: new Date(),
      requestId: context.requestId || null,
      additional: context.additional || {}
    };

    // Update statistics
    this.updateErrorStats(errorData);

    // Log the error
    this.logError(errorData);

    // Send to real-time dashboard if it's a significant error
    if (errorData.level === 'critical' || errorData.statusCode >= 500) {
      this.sendToRealTimeDashboard(errorData);
    }

    return errorData.id;
  }

  trackPerformanceIssue(metric, value, threshold, context = {}) {
    const performanceIssue = {
      id: this.generateErrorId(),
      type: 'performance',
      metric,
      value,
      threshold,
      endpoint: context.endpoint || 'unknown',
      method: context.method || 'unknown',
      timestamp: new Date(),
      level: value > threshold * 2 ? 'critical' : 'warning'
    };

    this.updateErrorStats(performanceIssue);
    this.logPerformanceIssue(performanceIssue);

    if (performanceIssue.level === 'critical') {
      this.sendToRealTimeDashboard(performanceIssue);
    }

    return performanceIssue.id;
  }

  updateErrorStats(errorData) {
    this.errorStats.total++;
    this.errorStats.last24Hours++;
    this.errorStats.recentErrors.push(errorData);

    // Update by type
    const errorType = errorData.type || errorData.name || 'Unknown';
    this.errorStats.byType.set(errorType,
      (this.errorStats.byType.get(errorType) || 0) + 1
    );

    // Update by endpoint
    this.errorStats.byEndpoint.set(errorData.endpoint,
      (this.errorStats.byEndpoint.get(errorData.endpoint) || 0) + 1
    );

    // Keep only last 1000 errors in memory
    if (this.errorStats.recentErrors.length > 1000) {
      this.errorStats.recentErrors = this.errorStats.recentErrors.slice(-1000);
    }
  }

  determineErrorLevel(error, context) {
    // Database connection errors are critical
    if (error.message?.includes('ECONNREFUSED') ||
        error.message?.includes('MongoError') ||
        error.message?.includes('connection')) {
      return 'critical';
    }

    // 5xx status codes are critical
    if (context.statusCode >= 500) {
      return 'critical';
    }

    // Authentication/authorization errors
    if (context.statusCode === 401 || context.statusCode === 403) {
      return 'warning';
    }

    // Client errors (4xx) are generally warnings
    if (context.statusCode >= 400 && context.statusCode < 500) {
      return 'warning';
    }

    // Memory or performance related
    if (error.name === 'RangeError' || error.message?.includes('out of memory')) {
      return 'critical';
    }

    return 'error';
  }

  logError(errorData) {
    const logLevel = errorData.level === 'critical' ? 'error' :
                    errorData.level === 'warning' ? 'warn' : 'error';

    logger[logLevel](`Error tracked: ${errorData.message}`, {
      errorId: errorData.id,
      level: errorData.level,
      statusCode: errorData.statusCode,
      endpoint: errorData.endpoint,
      method: errorData.method,
      userId: errorData.userId,
      stack: errorData.stack,
      timestamp: errorData.timestamp,
      additional: errorData.additional
    });
  }

  logPerformanceIssue(performanceData) {
    logger.warn(`Performance issue detected: ${performanceData.metric}`, {
      performanceId: performanceData.id,
      metric: performanceData.metric,
      value: performanceData.value,
      threshold: performanceData.threshold,
      level: performanceData.level,
      endpoint: performanceData.endpoint,
      method: performanceData.method,
      timestamp: performanceData.timestamp
    });
  }

  sendToRealTimeDashboard(errorData) {
    try {
      realTimeDashboardService.broadcast('system_error', {
        error: {
          id: errorData.id,
          message: errorData.message,
          level: errorData.level,
          endpoint: errorData.endpoint,
          timestamp: errorData.timestamp,
          type: errorData.type || 'error'
        }
      });
    } catch (error) {
      logger.error('Failed to send error to real-time dashboard:', error);
    }
  }

  sendAlert(alertType, alertData) {
    const alert = {
      id: this.generateErrorId(),
      type: alertType,
      severity: 'high',
      message: this.getAlertMessage(alertType, alertData),
      data: alertData,
      timestamp: new Date()
    };

    logger.error(`ALERT: ${alert.message}`, alert);

    // Send to real-time dashboard
    try {
      realTimeDashboardService.broadcast('system_alert', { alert });
    } catch (error) {
      logger.error('Failed to send alert to dashboard:', error);
    }
  }

  getAlertMessage(alertType, data) {
    switch (alertType) {
      case 'HIGH_ERROR_RATE':
        return `High error rate detected: ${data.rate.toFixed(2)} errors/minute (threshold: ${data.threshold})`;
      case 'CRITICAL_ERRORS':
        return `Multiple critical errors: ${data.count} critical errors in 5 minutes (threshold: ${data.threshold})`;
      case 'MEMORY_USAGE':
        return `High memory usage: ${data.usage}% (threshold: ${data.threshold}%)`;
      case 'SLOW_RESPONSE':
        return `Slow response times detected: ${data.averageTime}ms (threshold: ${data.threshold}ms)`;
      default:
        return `System alert: ${alertType}`;
    }
  }

  generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // Create middleware for automatic error tracking
  createErrorTrackingMiddleware() {
    return (error, req, res, next) => {
      const context = {
        statusCode: error.status || error.statusCode || 500,
        endpoint: req.path,
        method: req.method,
        userId: req.user?.id || req.user?._id,
        userAgent: req.get('User-Agent'),
        ip: req.ip,
        requestId: req.id,
        additional: {
          query: req.query,
          params: req.params,
          body: Object.keys(req.body || {}).length > 0 ?
                JSON.stringify(req.body).substring(0, 500) : undefined
        }
      };

      this.trackError(error, context);
      next(error);
    };
  }

  // Create middleware for performance monitoring
  createPerformanceMiddleware() {
    return (req, res, next) => {
      const startTime = Date.now();

      res.on('finish', () => {
        const responseTime = Date.now() - startTime;

        if (responseTime > this.alertThresholds.responseTime) {
          this.trackPerformanceIssue(
            'response_time',
            responseTime,
            this.alertThresholds.responseTime,
            {
              endpoint: req.path,
              method: req.method
            }
          );
        }
      });

      next();
    };
  }

  // Get error statistics
  getErrorStats() {
    return {
      ...this.errorStats,
      byType: Object.fromEntries(this.errorStats.byType),
      byEndpoint: Object.fromEntries(this.errorStats.byEndpoint),
      recentErrors: this.errorStats.recentErrors.slice(-50) // Last 50 errors
    };
  }

  // Get error details by ID
  getErrorById(errorId) {
    return this.errorStats.recentErrors.find(error => error.id === errorId);
  }

  // Clear error statistics (admin function)
  clearErrorStats() {
    this.errorStats = {
      total: 0,
      last24Hours: 0,
      byType: new Map(),
      byEndpoint: new Map(),
      recentErrors: []
    };

    logger.info('Error statistics cleared by admin');
  }
}

// Create singleton instance
const errorTrackingService = new ErrorTrackingService();

module.exports = errorTrackingService;