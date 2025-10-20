const { v4: uuidv4 } = require('uuid');
const Booking = require('../models/Booking');
const violationTrackingService = require('./violationTrackingService');
const logger = require('../config/logger');
const { getHongKongTime } = require('../utils/dateTime');

const RESCHEDULE_DELAY_MINUTES = 3;

class NoShowSchedulerService {
  constructor() {
    this.jobs = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    this.initialized = true;

    await this.restorePendingJobs();
  }

  async restorePendingJobs() {
    try {
      const now = getHongKongTime();

      const pendingBookings = await Booking.find({
        status: { $in: ['accepted', 'confirmed'] },
        'arrivalPrediction.noShowStatus': { $in: [null, 'pending'] },
        'arrivalPrediction.noShowCheckTime': { $exists: true },
        'arrivalPrediction.noShowCheckJobId': { $exists: true }
      }).select('_id arrivalPrediction.noShowCheckTime arrivalPrediction.noShowCheckJobId');

      if (pendingBookings.length > 0) {
        logger.info(`🔁 Restoring ${pendingBookings.length} pending no-show evaluations`);
      }

      for (const booking of pendingBookings) {
        const runAt = booking.arrivalPrediction.noShowCheckTime;
        const existingJobId = booking.arrivalPrediction.noShowCheckJobId;

        // Schedule using existing job id to avoid duplicates
        await this.scheduleBooking(booking._id, runAt, { forceJobId: existingJobId, allowPast: true });
      }

      logger.info('✅ No-show scheduler initialized');

    } catch (error) {
      logger.error('❌ Failed to restore pending no-show jobs:', error);
    }
  }

  async scheduleBooking(bookingId, runAt, options = {}) {
    try {
      if (!runAt) {
        logger.warn(`⚠️ Unable to schedule no-show evaluation for booking ${bookingId}: runAt is missing`);
        return null;
      }

      const jobId = options.forceJobId || uuidv4();
      const runDate = new Date(runAt);
      const now = getHongKongTime();

      // Clear any existing job
      await this.cancelBooking(bookingId, { silent: true });

      const delay = runDate.getTime() - now.getTime();
      const scheduleDelay = delay > 0 ? delay : (options.allowPast ? 2000 : 0);

      const timer = setTimeout(() => {
        this.executeJob(bookingId, jobId).catch((error) => {
          logger.error(`❌ No-show job execution failed for booking ${bookingId}:`, error);
        });
      }, scheduleDelay);

      this.jobs.set(bookingId.toString(), { timer, jobId, runAt: runDate });

      await Booking.findByIdAndUpdate(bookingId, {
        $set: {
          'arrivalPrediction.noShowCheckJobId': jobId,
          'arrivalPrediction.noShowEvaluationScheduledAt': runDate
        }
      });

      logger.info(`📅 Scheduled no-show evaluation for booking ${bookingId} at ${runDate.toISOString()}`);

      return jobId;
    } catch (error) {
      logger.error(`❌ Failed to schedule no-show evaluation for booking ${bookingId}:`, error);
      return null;
    }
  }

  async cancelBooking(bookingId, { silent = false } = {}) {
    const jobKey = bookingId.toString();
    const existingJob = this.jobs.get(jobKey);

    if (existingJob) {
      clearTimeout(existingJob.timer);
      this.jobs.delete(jobKey);
    }

    await Booking.findByIdAndUpdate(bookingId, {
      $unset: {
        'arrivalPrediction.noShowCheckJobId': '',
        'arrivalPrediction.noShowEvaluationScheduledAt': ''
      }
    }).catch((error) => {
      logger.error(`❌ Failed to clear no-show job metadata for booking ${bookingId}:`, error);
    });

    if (!silent && existingJob) {
      logger.info(`🛑 Cancelled no-show evaluation for booking ${bookingId}`);
    }
  }

  async rescheduleBooking(bookingId, newRunAt, reason = 'rescheduled') {
    logger.info(`🔄 Rescheduling no-show evaluation for booking ${bookingId} (${reason})`);
    return this.scheduleBooking(bookingId, newRunAt, { allowPast: true });
  }

  async triggerManualSweep() {
    const now = getHongKongTime();
      const dueBookings = await Booking.find({
        status: { $in: ['accepted', 'confirmed'] },
      'arrivalPrediction.noShowStatus': { $in: [null, 'pending'] },
      'arrivalPrediction.noShowCheckTime': { $lte: now }
    }).select('_id arrivalPrediction.noShowCheckJobId arrivalPrediction.noShowCheckTime');

    logger.info(`🧹 Manual no-show sweep will evaluate ${dueBookings.length} bookings`);

    for (const booking of dueBookings) {
      const jobId = booking.arrivalPrediction?.noShowCheckJobId || uuidv4();
      await this.executeJob(booking._id, jobId, { force: true });
    }
  }

  async executeJob(bookingId, jobId, options = {}) {
    const jobKey = bookingId.toString();
    const trackedJob = this.jobs.get(jobKey);

    if (!options.force && trackedJob && trackedJob.jobId !== jobId) {
      logger.info(`⏭️ Skipping stale no-show job for booking ${bookingId}`);
      return;
    }

    this.jobs.delete(jobKey);

    try {
      let booking = await Booking.findById(bookingId)
        .populate('parkingSpaceId', 'name location')
        .populate('userId', 'firstName lastName phoneNumber')
        .populate('landlordId', 'firstName lastName phoneNumber');

      if (!booking) {
        logger.warn(`⚠️ No-show job executed for missing booking ${bookingId}`);
        return;
      }

      const arrivalPrediction = booking.arrivalPrediction || {};

      if (arrivalPrediction.noShowCheckJobId && arrivalPrediction.noShowCheckJobId !== jobId && !options.force) {
        logger.info(`⏭️ Booking ${bookingId} already has a newer no-show job scheduled`);
        return;
      }

      const now = getHongKongTime();
      const evaluation = {
        evaluatedAt: now,
        result: 'pending',
        reason: '',
        evidence: {
          triggeredAt: now,
          lastLocationStatus: arrivalPrediction.lastLocationStatus || null
        }
      };

      const bookingStatus = booking.status?.toLowerCase();
      if (['parked', 'checked_in', 'completed', 'cancelled'].includes(bookingStatus)) {
        evaluation.result = 'cleared';
        evaluation.reason = `Booking status is ${booking.status}`;
        await this.markCleared(booking, evaluation);
        return;
      }

      if (bookingStatus === 'no_show') {
        evaluation.result = 'no_show';
        evaluation.reason = 'Booking already marked as no-show';
        await this.appendEvaluationOnly(booking, evaluation);
        return;
      }

      if (arrivalPrediction.hasEnteredApproachZone) {
        evaluation.result = 'cleared';
        evaluation.reason = 'User entered approach zone before deadline';
        evaluation.evidence.firstApproachTimestamp = arrivalPrediction.firstApproachTimestamp;
        evaluation.evidence.lastApproachTimestamp = arrivalPrediction.lastApproachTimestamp;
        await this.markCleared(booking, evaluation);
        return;
      }

      // Check if grace period has passed
      const noShowCheckTime = arrivalPrediction.noShowCheckTime ? new Date(arrivalPrediction.noShowCheckTime) : null;
      
      if (!noShowCheckTime) {
        logger.warn(`⚠️ Booking ${bookingId} missing noShowCheckTime, cannot evaluate`);
        return;
      }

      const minutesSinceDeadline = Math.round((now - noShowCheckTime) / (1000 * 60));
      
      logger.info(`⏰ No-show evaluation for booking ${bookingId}:`);
      logger.info(`   - Grace period deadline: ${noShowCheckTime.toISOString()}`);
      logger.info(`   - Current time: ${now.toISOString()}`);
      logger.info(`   - Minutes since deadline: ${minutesSinceDeadline}`);
      logger.info(`   - Has entered approach zone: ${arrivalPrediction.hasEnteredApproachZone || false}`);

      // If we're evaluating too early (before grace period ends), reschedule
      if (now < noShowCheckTime) {
        evaluation.result = 'rescheduled';
        evaluation.reason = `Evaluated ${Math.abs(minutesSinceDeadline)} minutes too early, rescheduling`;
        logger.info(`   ⏭️ Result: Rescheduling (too early)`);
        await this.rescheduleDueToMissingEvidence(booking, evaluation);
        return;
      }

      // Grace period has passed and user never entered approach zone → NO-SHOW
      evaluation.result = 'no_show';
      evaluation.reason = 'User never entered approach zone within arrival window (ETA + 15min grace period)';
      evaluation.evidence.noShowCheckTime = noShowCheckTime;
      evaluation.evidence.hasEnteredApproachZone = false;
      evaluation.evidence.minutesSinceDeadline = minutesSinceDeadline;
      logger.info(`   🚫 Result: NO-SHOW (${minutesSinceDeadline} minutes past deadline)`);
      await this.markNoShow(booking, evaluation);

    } catch (error) {
      logger.error(`❌ Error executing no-show job for booking ${bookingId}:`, error);
    }
  }

  async appendEvaluationOnly(booking, evaluation) {
    await Booking.findByIdAndUpdate(booking._id, {
      $push: { 'arrivalPrediction.noShowEvaluations': evaluation }
    });
  }

  async markCleared(booking, evaluation) {
    await Booking.findByIdAndUpdate(booking._id, {
      $set: {
        'arrivalPrediction.noShowStatus': 'cleared',
        'arrivalPrediction.noShowCheckJobId': null,
        'arrivalPrediction.noShowEvaluationScheduledAt': null
      },
      $push: {
        'arrivalPrediction.noShowEvaluations': evaluation
      }
    });

    logger.info(`✅ Booking ${booking._id} cleared from no-show check`);
  }

  async rescheduleDueToMissingEvidence(booking, evaluation) {
    const now = getHongKongTime();
    const newRunAt = new Date(now.getTime() + RESCHEDULE_DELAY_MINUTES * 60 * 1000);

    await Booking.findByIdAndUpdate(booking._id, {
      $push: {
        'arrivalPrediction.noShowEvaluations': evaluation
      }
    });

    await this.scheduleBooking(booking._id, newRunAt, { allowPast: true });
  }

  async markNoShow(booking, evaluation) {
    const now = getHongKongTime();
    const arrivalPrediction = booking.arrivalPrediction || {};
    const maxWindow = arrivalPrediction.maxArrivalWindow ? new Date(arrivalPrediction.maxArrivalWindow) : now;
    const minutesLate = Math.max(0, Math.round((now - maxWindow) / (1000 * 60)));

    const updatedBooking = await Booking.findByIdAndUpdate(booking._id, {
      $set: {
        status: 'no_show',
        'arrivalPrediction.noShowStatus': 'no_show',
        'arrivalPrediction.noShowCheckJobId': null,
        'arrivalPrediction.noShowEvaluationScheduledAt': null,
        cancellation: {
          cancelledBy: 'system',
          reason: 'Marked as no-show (user never entered approach zone)',
          cancelledAt: now,
          refundAmount: 0
        }
      },
      $push: {
        'arrivalPrediction.noShowEvaluations': evaluation
      }
    }, { new: true });

    if (!updatedBooking) {
      logger.warn(`⚠️ Booking ${booking._id} disappeared before marking no-show`);
      return;
    }

    await updatedBooking.populate('userId landlordId parkingSpaceId');

    try {
      await violationTrackingService.processNoShowViolation(updatedBooking, minutesLate);
      logger.info(`🚫 Booking ${booking._id} marked as no-show (minutes late: ${minutesLate})`);
    } catch (error) {
      logger.error(`❌ Failed to process no-show violation for booking ${booking._id}:`, error);
    }
  }
}

module.exports = new NoShowSchedulerService();

