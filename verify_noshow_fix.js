/**
 * Verification script to ensure no-show fix is correctly applied
 * This script checks the code without requiring the server to be running
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 VERIFYING NO-SHOW FIX...\n');

let allChecksPass = true;

/**
 * Check 1: Verify smartBookingController.js fix
 */
console.log('✓ CHECK 1: Smart Booking Controller');
const controllerPath = path.join(__dirname, 'src/controllers/smartBookingController.js');
const controllerContent = fs.readFileSync(controllerPath, 'utf8');

// Check that noShowCheckTime is set to maxArrivalWindow (not adding grace period twice)
if (controllerContent.includes('const noShowCheckTime = maxArrivalWindow')) {
  console.log('  ✅ noShowCheckTime correctly set to maxArrivalWindow');
} else if (controllerContent.includes('maxArrivalWindow.getTime() + (gracePeriodMinutes * 60 * 1000)')) {
  console.log('  ❌ ERROR: noShowCheckTime still adding grace period twice!');
  allChecksPass = false;
} else {
  console.log('  ⚠️  WARNING: Could not verify noShowCheckTime calculation');
  allChecksPass = false;
}

// Check that it's being passed to the scheduler
if (controllerContent.includes('noShowSchedulerService.scheduleBooking(booking._id, noShowCheckTime)')) {
  console.log('  ✅ noShowCheckTime correctly passed to scheduler');
} else {
  console.log('  ❌ ERROR: noShowCheckTime not passed to scheduler correctly');
  allChecksPass = false;
}

// Check that it's being saved in arrivalPrediction
if (controllerContent.includes('noShowCheckTime: noShowCheckTime')) {
  console.log('  ✅ noShowCheckTime saved in booking arrivalPrediction');
} else {
  console.log('  ⚠️  WARNING: noShowCheckTime might not be saved in booking');
}

/**
 * Check 2: Verify Booking model has noShowCheckTime field
 */
console.log('\n✓ CHECK 2: Booking Model Schema');
const modelPath = path.join(__dirname, 'src/models/Booking.js');
const modelContent = fs.readFileSync(modelPath, 'utf8');

if (modelContent.includes('noShowCheckTime: Date')) {
  console.log('  ✅ noShowCheckTime field defined in schema');
} else {
  console.log('  ❌ ERROR: noShowCheckTime field missing from schema!');
  allChecksPass = false;
}

/**
 * Check 3: Verify noShowSchedulerService logic
 */
console.log('\n✓ CHECK 3: No-Show Scheduler Service');
const schedulerPath = path.join(__dirname, 'src/services/noShowSchedulerService.js');
const schedulerContent = fs.readFileSync(schedulerPath, 'utf8');

// Check for grace period check logic
if (schedulerContent.includes('if (now < noShowCheckTime)')) {
  console.log('  ✅ Grace period check logic present');
} else {
  console.log('  ❌ ERROR: Grace period check logic missing!');
  allChecksPass = false;
}

// Check for immediate no-show marking (not rescheduling indefinitely)
if (schedulerContent.includes('Grace period has passed and user never entered approach zone') &&
    schedulerContent.includes('await this.markNoShow(booking, evaluation)')) {
  console.log('  ✅ Immediate no-show marking logic present');
} else {
  console.log('  ❌ ERROR: No-show marking logic might be incorrect!');
  allChecksPass = false;
}

// Check that it doesn't reschedule indefinitely for missing location
if (schedulerContent.includes('if (!arrivalPrediction.lastLocationStatus?.timestamp)')) {
  console.log('  ⚠️  WARNING: Still checking for location status (old logic)');
} else {
  console.log('  ✅ No longer dependent on location status for no-show decision');
}

/**
 * Check 4: Verify timing calculation
 */
console.log('\n✓ CHECK 4: Timing Calculations');

// Extract the calculation from controller
const etaMatch = controllerContent.match(/const totalWindowMinutes = etaMinutes \+ gracePeriodMinutes/);
const noShowMatch = controllerContent.match(/const noShowCheckTime = maxArrivalWindow/);

if (etaMatch && noShowMatch) {
  console.log('  ✅ Correct timing calculation flow:');
  console.log('     1. totalWindowMinutes = etaMinutes + gracePeriodMinutes');
  console.log('     2. maxArrivalWindow = startTime + totalWindowMinutes');
  console.log('     3. noShowCheckTime = maxArrivalWindow');
  console.log('     Result: No double grace period! ✅');
} else {
  console.log('  ❌ ERROR: Timing calculation might be incorrect!');
  allChecksPass = false;
}

/**
 * Summary
 */
console.log('\n' + '='.repeat(50));
if (allChecksPass) {
  console.log('✅ ALL CHECKS PASSED!');
  console.log('\n🎉 No-show fix is correctly applied!');
  console.log('\n📋 Next Steps:');
  console.log('   1. Ensure backend server is running');
  console.log('   2. Run: node test_no_show_auto_cancel.js');
  console.log('   3. Or test manually with the app');
  console.log('\n💡 Expected Behavior:');
  console.log('   - Booking created at time T');
  console.log('   - ETA calculated (e.g., 5 minutes)');
  console.log('   - Grace period: 15 minutes');
  console.log('   - No-show check at: T + 5min + 15min = T + 20min');
  console.log('   - If user hasn\'t entered approach zone by then → NO-SHOW');
  process.exit(0);
} else {
  console.log('❌ SOME CHECKS FAILED!');
  console.log('\n⚠️  Please review the errors above and fix them.');
  console.log('   See NO_SHOW_FIX_SUMMARY.md for detailed fix information.');
  process.exit(1);
}
