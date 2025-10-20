const cron = require('node-cron');
const CancellationPolicy = require('../models/CancellationPolicy');
const logger = require('../config/logger');
const { getHongKongTime } = require('../utils/dateTime');

class ScheduledJobService {
  constructor() {
    this.jobs = new Map();
  }

  /**
   * Start all scheduled jobs
   */
  async startAllJobs() {
    try {
      logger.info('🕐 Starting scheduled job service...');

      // Ensure default cancellation policy exists
      await this.ensureDefaultPolicy();

      // Deprecated batch jobs removed: per-booking scheduler handles no-shows and auto-cancellations

      // Start wallet cleanup job (runs daily at 2 AM HK time)
      this.startWalletCleanupJob();

      // Start violation reset job (runs daily at 3 AM HK time)
      this.startViolationResetJob();

      logger.info('✅ Scheduled job service started (wallet + violation jobs active)');

    } catch (error) {
      logger.error('❌ Error starting scheduled jobs:', error);
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopAllJobs() {
    logger.info('🛑 Stopping all scheduled jobs...');
    
    for (const [jobName, job] of this.jobs) {
      job.stop();
      logger.info(`Stopped job: ${jobName}`);
    }
    
      this.jobs.clear();
      logger.info('✅ All scheduled jobs stopped');
  }

  /**
   * Start no-show detection job
   */
  /**
   * Start wallet cleanup job
   */
  startWalletCleanupJob() {
    // Run daily at 2 AM Hong Kong time
    const job = cron.schedule('0 2 * * *', async () => {
      try {
        logger.info('🧹 Running scheduled wallet cleanup...');
        
        const { Wallet } = require('../models/Wallet');
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - 90); // 90 days ago

        // Clean up old completed transactions (keep for audit but mark as archived)
        const result = await Wallet.updateMany(
          {},
          {
            $set: {
              'transactions.$[elem].archived': true
            }
          },
          {
            arrayFilters: [
              {
                'elem.createdAt': { $lt: cutoffDate },
                'elem.status': 'completed',
                'elem.archived': { $ne: true }
              }
            ]
          }
        );

        logger.info(`✅ Wallet cleanup completed. ${result.modifiedCount} wallets updated with archived transactions`);

      } catch (error) {
        logger.error('❌ Error in scheduled wallet cleanup:', error);
      }
    }, {
      scheduled: false,
      timezone: 'Asia/Hong_Kong'
    });

    job.start();
    this.jobs.set('walletCleanup', job);
    logger.info('✅ Wallet cleanup job started (daily at 2 AM HK time)');
  }

  /**
   * Start violation reset job
   */
  startViolationResetJob() {
    // Run daily at 3 AM Hong Kong time
    const job = cron.schedule('0 3 * * *', async () => {
      try {
        logger.info('🔄 Running scheduled violation reset check...');
        
        const ViolationTracking = require('../models/ViolationTracking');
        const policy = await CancellationPolicy.getActivePolicy();
        
        if (!policy) {
          logger.warn('No active cancellation policy found for violation reset');
          return;
        }

        // Find users eligible for violation reset (no violations for X days)
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - policy.violationResetAfterDays);

        const resetCandidates = await ViolationTracking.find({
          consecutiveViolations: { $gt: 0 },
          lastViolationDate: { $lt: cutoffDate }
        });

        let resetCount = 0;
        for (const tracking of resetCandidates) {
          tracking.consecutiveViolations = 0;
          tracking.currentTier = 0;
          await tracking.save();
          resetCount++;
        }

        logger.info(`✅ Violation reset completed. ${resetCount} users had their violation history reset`);

      } catch (error) {
        logger.error('❌ Error in scheduled violation reset:', error);
      }
    }, {
      scheduled: false,
      timezone: 'Asia/Hong_Kong'
    });

    job.start();
    this.jobs.set('violationReset', job);
    logger.info('✅ Violation reset job started (daily at 3 AM HK time)');
  }

  /**
   * Start smart booking auto-cancellation job (runs every 5 minutes)
   */
  /**
   * Ensure default cancellation policy exists
   */
  async ensureDefaultPolicy() {
    try {
      const existingPolicy = await CancellationPolicy.getActivePolicy();
      
      if (!existingPolicy) {
        await CancellationPolicy.createDefaultPolicy();
        logger.info('✅ Created default cancellation policy');
      } else {
        logger.info('✅ Default cancellation policy already exists');
      }
    } catch (error) {
      logger.error('❌ Error ensuring default policy:', error);
    }
  }

  /**
   * Manual trigger for no-show detection (for testing)
   */
  async triggerNoShowDetection() {
    try {
      logger.info('🔍 Manually triggering no-show detection...');
      return await violationTrackingService.checkAllPendingBookingsForNoShows();
    } catch (error) {
      logger.error('❌ Error in manual no-show trigger:', error);
      throw error;
    }
  }

  /**
   * Get job status
   */
  getJobStatus() {
    const status = {};
    
    for (const [jobName, job] of this.jobs) {
      status[jobName] = {
        running: job.running,
        scheduled: job.scheduled
      };
    }

    return {
      totalJobs: this.jobs.size,
      currentTime: getHongKongTime(),
      timezone: 'Asia/Hong_Kong',
      jobs: status
    };
  }
}

module.exports = new ScheduledJobService();
