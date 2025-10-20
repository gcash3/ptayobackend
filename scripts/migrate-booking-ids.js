const mongoose = require('mongoose');
const Booking = require('../src/models/Booking');
require('dotenv').config();

async function migrateBookingIds() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find all bookings without a numeric bookingId
    console.log('📋 Finding bookings without numeric IDs...');
    const bookingsWithoutId = await Booking.find({ 
      $or: [
        { bookingId: { $exists: false } },
        { bookingId: null }
      ]
    }).sort({ createdAt: 1 }); // Sort by creation date to maintain order

    console.log(`📊 Found ${bookingsWithoutId.length} bookings to migrate`);

    if (bookingsWithoutId.length === 0) {
      console.log('✅ No bookings need migration');
      process.exit(0);
    }

    // Find the highest existing bookingId
    const lastBooking = await Booking.findOne(
      { bookingId: { $exists: true, $ne: null } }, 
      { bookingId: 1 }, 
      { sort: { bookingId: -1 } }
    );

    let nextId = lastBooking ? lastBooking.bookingId + 1 : 100000;
    console.log(`🔢 Starting migration from ID: ${nextId}`);

    // Update bookings one by one to ensure uniqueness
    for (const booking of bookingsWithoutId) {
      try {
        // Update with bypass validation to avoid triggering pre-save hook
        await Booking.updateOne(
          { _id: booking._id },
          { $set: { bookingId: nextId } }
        );
        
        console.log(`✅ Updated booking ${booking._id} → ${nextId}`);
        nextId++;
      } catch (error) {
        console.error(`❌ Failed to update booking ${booking._id}:`, error.message);
        
        // If duplicate key error, increment and try again
        if (error.code === 11000) {
          nextId++;
          await Booking.updateOne(
            { _id: booking._id },
            { $set: { bookingId: nextId } }
          );
          console.log(`✅ Updated booking ${booking._id} → ${nextId} (retry)`);
          nextId++;
        }
      }
    }

    // Verify migration
    const remainingBookings = await Booking.countDocuments({ 
      $or: [
        { bookingId: { $exists: false } },
        { bookingId: null }
      ]
    });

    if (remainingBookings === 0) {
      console.log('🎉 Migration completed successfully!');
      console.log(`📊 Migrated ${bookingsWithoutId.length} bookings`);
      
      // Show some examples
      const sampleBookings = await Booking.find({}, { bookingId: 1, createdAt: 1 })
        .sort({ bookingId: 1 })
        .limit(5);
      
      console.log('\n📋 Sample booking IDs:');
      sampleBookings.forEach(booking => {
        console.log(`  ${booking._id} → ${booking.bookingId}`);
      });
      
    } else {
      console.error(`❌ Migration incomplete. ${remainingBookings} bookings still need IDs`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
  }
}

// Run migration
if (require.main === module) {
  migrateBookingIds();
}

module.exports = migrateBookingIds;
