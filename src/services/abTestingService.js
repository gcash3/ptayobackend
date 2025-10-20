const User = require('../models/User');
const Booking = require('../models/Booking');
const logger = require('../config/logger');

class ABTestingService {
  constructor() {
    this.activeTests = new Map();
    this.testResults = new Map();
    this.initializeDefaultTests();
  }

  /**
   * Initialize default A/B tests
   */
  initializeDefaultTests() {
    // Smart Booking vs Traditional Booking Test
    this.createTest({
      testId: 'smart_vs_traditional',
      name: 'Smart Booking vs Traditional Booking',
      description: 'Compare user satisfaction and success rates between smart booking and traditional reservation',
      startDate: new Date(),
      endDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000), // 90 days
      variants: [
        {
          id: 'control',
          name: 'Traditional Only',
          description: 'Users only see traditional reservation booking',
          allocation: 30, // 30% of users
          config: {
            enableSmartBooking: false,
            showBookNowOption: false,
            defaultBookingMode: 'reservation'
          }
        },
        {
          id: 'smart_only',
          name: 'Smart Only',
          description: 'Users only see smart booking option',
          allocation: 30, // 30% of users
          config: {
            enableSmartBooking: true,
            showReservationOption: false,
            defaultBookingMode: 'book_now'
          }
        },
        {
          id: 'both_options',
          name: 'Both Options',
          description: 'Users can choose between smart booking and reservation',
          allocation: 40, // 40% of users
          config: {
            enableSmartBooking: true,
            showReservationOption: true,
            defaultBookingMode: 'choice'
          }
        }
      ],
      metrics: [
        'conversion_rate',
        'booking_success_rate',
        'user_satisfaction',
        'completion_time',
        'on_time_arrival',
        'cancellation_rate'
      ],
      isActive: true
    });

    // Confidence Threshold Test
    this.createTest({
      testId: 'confidence_threshold',
      name: 'Smart Booking Confidence Threshold',
      description: 'Test different confidence thresholds for allowing smart booking',
      startDate: new Date(),
      endDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000), // 60 days
      variants: [
        {
          id: 'low_threshold',
          name: 'Low Threshold (60%)',
          description: 'Allow smart booking at 60% confidence',
          allocation: 33,
          config: {
            confidenceThreshold: 60,
            fallbackToReservation: true
          }
        },
        {
          id: 'medium_threshold',
          name: 'Medium Threshold (70%)',
          description: 'Allow smart booking at 70% confidence',
          allocation: 34,
          config: {
            confidenceThreshold: 70,
            fallbackToReservation: true
          }
        },
        {
          id: 'high_threshold',
          name: 'High Threshold (85%)',
          description: 'Allow smart booking at 85% confidence',
          allocation: 33,
          config: {
            confidenceThreshold: 85,
            fallbackToReservation: true
          }
        }
      ],
      metrics: [
        'smart_booking_usage',
        'prediction_accuracy',
        'user_frustration_rate',
        'fallback_rate'
      ],
      isActive: true
    });

    logger.info('✅ A/B Testing Service initialized with default tests');
  }

  /**
   * Create a new A/B test
   */
  createTest(testConfig) {
    const {
      testId,
      name,
      description,
      startDate,
      endDate,
      variants,
      metrics,
      isActive = true
    } = testConfig;

    // Validate variant allocations sum to 100%
    const totalAllocation = variants.reduce((sum, variant) => sum + variant.allocation, 0);
    if (Math.abs(totalAllocation - 100) > 0.1) {
      throw new Error(`Variant allocations must sum to 100%, got ${totalAllocation}%`);
    }

    const test = {
      testId,
      name,
      description,
      startDate,
      endDate,
      variants,
      metrics,
      isActive,
      createdAt: new Date(),
      participantCount: 0,
      results: {
        byVariant: {},
        overall: {}
      }
    };

    // Initialize results for each variant
    variants.forEach(variant => {
      test.results.byVariant[variant.id] = {
        participants: 0,
        metrics: {}
      };
    });

    this.activeTests.set(testId, test);
    logger.info(`📊 Created A/B test: ${name} (${testId})`);
    
    return test;
  }

  /**
   * Assign user to test variant
   */
  assignUserToVariant(userId, testId) {
    const test = this.activeTests.get(testId);
    if (!test || !test.isActive) {
      return null;
    }

    // Check if test is within date range
    const now = new Date();
    if (now < test.startDate || now > test.endDate) {
      return null;
    }

    // Use consistent hashing to assign users to variants
    const hash = this.hashUserId(userId, testId);
    const percentage = hash % 100;
    
    let cumulativeAllocation = 0;
    for (const variant of test.variants) {
      cumulativeAllocation += variant.allocation;
      if (percentage < cumulativeAllocation) {
        // Track participation
        test.participantCount++;
        test.results.byVariant[variant.id].participants++;
        
        logger.info(`👤 User ${userId} assigned to variant ${variant.id} for test ${testId}`);
        return variant;
      }
    }

    // Fallback to first variant (shouldn't happen with proper allocation)
    return test.variants[0];
  }

  /**
   * Get user's variant for a specific test
   */
  getUserVariant(userId, testId) {
    return this.assignUserToVariant(userId, testId);
  }

  /**
   * Track metric for A/B test
   */
  trackMetric(userId, testId, metricName, value, metadata = {}) {
    const test = this.activeTests.get(testId);
    if (!test) {
      logger.warn(`Attempted to track metric for non-existent test: ${testId}`);
      return;
    }

    const variant = this.getUserVariant(userId, testId);
    if (!variant) {
      return;
    }

    // Initialize metric if not exists
    if (!test.results.byVariant[variant.id].metrics[metricName]) {
      test.results.byVariant[variant.id].metrics[metricName] = {
        count: 0,
        sum: 0,
        values: [],
        average: 0
      };
    }

    const metric = test.results.byVariant[variant.id].metrics[metricName];
    
    // Update metric
    metric.count++;
    metric.sum += value;
    metric.values.push({
      value,
      timestamp: new Date(),
      userId,
      metadata
    });
    metric.average = metric.sum / metric.count;

    // Keep only recent values (last 1000)
    if (metric.values.length > 1000) {
      metric.values = metric.values.slice(-1000);
    }

    logger.info(`📈 Tracked metric ${metricName}=${value} for user ${userId}, variant ${variant.id}, test ${testId}`);
  }

  /**
   * Track booking event for A/B testing
   */
  async trackBookingEvent(userId, eventType, bookingData) {
    const smartVsTraditionalVariant = this.getUserVariant(userId, 'smart_vs_traditional');
    const confidenceThresholdVariant = this.getUserVariant(userId, 'confidence_threshold');

    switch (eventType) {
      case 'booking_started':
        if (smartVsTraditionalVariant) {
          this.trackMetric(userId, 'smart_vs_traditional', 'booking_started', 1);
        }
        break;

      case 'booking_completed':
        if (smartVsTraditionalVariant) {
          this.trackMetric(userId, 'smart_vs_traditional', 'booking_success_rate', 1);
          
          // Track completion time
          const completionTime = bookingData.completionTime || 0;
          this.trackMetric(userId, 'smart_vs_traditional', 'completion_time', completionTime);
        }
        break;

      case 'booking_cancelled':
        if (smartVsTraditionalVariant) {
          this.trackMetric(userId, 'smart_vs_traditional', 'cancellation_rate', 1);
        }
        break;

      case 'smart_booking_allowed':
        if (confidenceThresholdVariant) {
          this.trackMetric(userId, 'confidence_threshold', 'smart_booking_usage', 1, {
            confidence: bookingData.confidence
          });
        }
        break;

      case 'smart_booking_rejected':
        if (confidenceThresholdVariant) {
          this.trackMetric(userId, 'confidence_threshold', 'fallback_rate', 1, {
            confidence: bookingData.confidence,
            reason: bookingData.reason
          });
        }
        break;

      case 'arrival_recorded':
        if (smartVsTraditionalVariant && bookingData.bookingMode === 'book_now') {
          const onTime = bookingData.wasOnTime ? 1 : 0;
          this.trackMetric(userId, 'smart_vs_traditional', 'on_time_arrival', onTime);
        }
        
        if (confidenceThresholdVariant && bookingData.bookingMode === 'book_now') {
          const accuracy = bookingData.wasOnTime ? 100 : 0;
          this.trackMetric(userId, 'confidence_threshold', 'prediction_accuracy', accuracy);
        }
        break;
    }
  }

  /**
   * Get test results
   */
  getTestResults(testId) {
    const test = this.activeTests.get(testId);
    if (!test) {
      throw new Error(`Test ${testId} not found`);
    }

    const results = {
      testInfo: {
        testId: test.testId,
        name: test.name,
        description: test.description,
        startDate: test.startDate,
        endDate: test.endDate,
        isActive: test.isActive,
        totalParticipants: test.participantCount
      },
      variants: {},
      summary: {},
      recommendations: []
    };

    // Calculate results for each variant
    test.variants.forEach(variant => {
      const variantData = test.results.byVariant[variant.id];
      results.variants[variant.id] = {
        name: variant.name,
        description: variant.description,
        allocation: variant.allocation,
        participants: variantData.participants,
        metrics: this.calculateMetricsSummary(variantData.metrics)
      };
    });

    // Calculate overall summary and statistical significance
    results.summary = this.calculateTestSummary(test);
    results.recommendations = this.generateRecommendations(test, results);

    return results;
  }

  /**
   * Calculate metrics summary for a variant
   */
  calculateMetricsSummary(metrics) {
    const summary = {};
    
    Object.keys(metrics).forEach(metricName => {
      const metric = metrics[metricName];
      summary[metricName] = {
        count: metric.count,
        average: Math.round(metric.average * 100) / 100,
        total: metric.sum,
        recent: metric.values.slice(-10).map(v => v.value)
      };
    });

    return summary;
  }

  /**
   * Calculate test summary with statistical significance
   */
  calculateTestSummary(test) {
    const summary = {
      duration: Math.round((new Date() - test.startDate) / (1000 * 60 * 60 * 24)), // days
      totalParticipants: test.participantCount,
      sampleSizeAdequate: test.participantCount >= 100, // Minimum sample size
      hasSignificantResults: false,
      winningVariant: null,
      confidence: 0
    };

    // Simple statistical significance check
    // In production, you'd want more sophisticated statistical tests
    const variants = Object.keys(test.results.byVariant);
    if (variants.length >= 2) {
      const variantResults = variants.map(variantId => {
        const variantData = test.results.byVariant[variantId];
        const conversionRate = variantData.metrics.booking_success_rate?.average || 0;
        return {
          variantId,
          conversionRate,
          participants: variantData.participants
        };
      });

      // Find best performing variant
      const bestVariant = variantResults.reduce((best, current) => 
        current.conversionRate > best.conversionRate ? current : best
      );

      summary.winningVariant = bestVariant.variantId;
      
      // Simple confidence calculation (would need proper statistical test in production)
      const totalParticipants = variantResults.reduce((sum, v) => sum + v.participants, 0);
      if (totalParticipants >= 100) {
        const improvementRate = bestVariant.conversionRate / (variantResults[0].conversionRate || 1);
        summary.confidence = Math.min(95, Math.max(50, improvementRate * 80));
        summary.hasSignificantResults = summary.confidence >= 80;
      }
    }

    return summary;
  }

  /**
   * Generate recommendations based on test results
   */
  generateRecommendations(test, results) {
    const recommendations = [];

    if (test.testId === 'smart_vs_traditional') {
      const variants = results.variants;
      
      // Check conversion rates
      const smartOnly = variants.smart_only?.metrics?.booking_success_rate?.average || 0;
      const traditional = variants.control?.metrics?.booking_success_rate?.average || 0;
      const both = variants.both_options?.metrics?.booking_success_rate?.average || 0;

      if (smartOnly > traditional * 1.1) {
        recommendations.push({
          type: 'performance',
          message: 'Smart booking shows higher success rates than traditional booking',
          action: 'Consider promoting smart booking as the primary option'
        });
      }

      if (both > Math.max(smartOnly, traditional)) {
        recommendations.push({
          type: 'user_choice',
          message: 'Users perform best when given both options',
          action: 'Implement dual-mode booking interface'
        });
      }

      // Check on-time rates
      const smartOnTime = variants.smart_only?.metrics?.on_time_arrival?.average || 0;
      if (smartOnTime > 0.8) {
        recommendations.push({
          type: 'accuracy',
          message: 'Smart booking predictions are highly accurate',
          action: 'Increase confidence threshold to 85% for better reliability'
        });
      }
    }

    if (test.testId === 'confidence_threshold') {
      const variants = results.variants;
      
      // Find optimal threshold
      const thresholds = [
        { id: 'low_threshold', threshold: 60, data: variants.low_threshold },
        { id: 'medium_threshold', threshold: 70, data: variants.medium_threshold },
        { id: 'high_threshold', threshold: 85, data: variants.high_threshold }
      ];

      const bestThreshold = thresholds.reduce((best, current) => {
        const accuracy = current.data?.metrics?.prediction_accuracy?.average || 0;
        const usage = current.data?.metrics?.smart_booking_usage?.average || 0;
        const score = accuracy * 0.7 + usage * 0.3; // Weight accuracy more
        
        return score > (best.score || 0) ? { ...current, score } : best;
      }, {});

      if (bestThreshold.id) {
        recommendations.push({
          type: 'optimization',
          message: `${bestThreshold.threshold}% confidence threshold shows best balance of accuracy and usage`,
          action: `Set confidence threshold to ${bestThreshold.threshold}%`
        });
      }
    }

    return recommendations;
  }

  /**
   * Hash user ID for consistent variant assignment
   */
  hashUserId(userId, testId) {
    const str = `${userId}-${testId}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  /**
   * Get all active tests
   */
  getActiveTests() {
    const tests = [];
    this.activeTests.forEach((test, testId) => {
      if (test.isActive) {
        tests.push({
          testId,
          name: test.name,
          description: test.description,
          participants: test.participantCount,
          variants: test.variants.map(v => ({
            id: v.id,
            name: v.name,
            allocation: v.allocation
          }))
        });
      }
    });
    return tests;
  }

  /**
   * End a test
   */
  endTest(testId) {
    const test = this.activeTests.get(testId);
    if (test) {
      test.isActive = false;
      test.endDate = new Date();
      logger.info(`🏁 Ended A/B test: ${test.name} (${testId})`);
      return this.getTestResults(testId);
    }
    throw new Error(`Test ${testId} not found`);
  }
}

module.exports = new ABTestingService();