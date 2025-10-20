const mongoose = require('mongoose');
const logger = require('../config/logger');

// Database migration script to add overtimeRatePerHour field to existing parking spaces
async function addOvertimeRateField() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo');
    logger.info('Connected to MongoDB for overtime rate migration');

    // Get the database connection
    const db = mongoose.connection.db;
    const collection = db.collection('parkingspaces');

    // Find all documents that don't have overtimeRatePerHour field
    const documentsToUpdate = await collection.find({
      pricePer3Hours: { $exists: true },
      overtimeRatePerHour: { $exists: false }
    }).toArray();

    logger.info(`Found ${documentsToUpdate.length} parking spaces to update with overtime rates`);

    if (documentsToUpdate.length === 0) {
      logger.info('No parking spaces need overtime rate migration. All done!');
      return;
    }

    // Update each document
    let updatedCount = 0;
    let errorCount = 0;

    for (const doc of documentsToUpdate) {
      try {
        // Calculate overtime rate as basePricePer3Hours / 3
        const pricePer3Hours = doc.pricePer3Hours;
        const overtimeRatePerHour = pricePer3Hours / 3;

        await collection.updateOne(
          { _id: doc._id },
          {
            $set: {
              overtimeRatePerHour: Math.round(overtimeRatePerHour * 100) / 100 // Round to 2 decimal places
            }
          }
        );

        updatedCount++;
        logger.info(`Updated parking space ${doc._id}: ${doc.name} - Base: ₱${pricePer3Hours} -> Overtime: ₱${overtimeRatePerHour.toFixed(2)}/hr`);

      } catch (error) {
        errorCount++;
        logger.error(`Error updating parking space ${doc._id}:`, error);
      }
    }

    logger.info(`Overtime rate migration completed!`);
    logger.info(`  Successfully updated: ${updatedCount} parking spaces`);
    logger.info(`  Errors: ${errorCount} parking spaces`);

    // Verify migration
    const spacesWithOvertimeRate = await collection.countDocuments({
      overtimeRatePerHour: { $exists: true }
    });

    const spacesWithoutOvertimeRate = await collection.countDocuments({
      pricePer3Hours: { $exists: true },
      overtimeRatePerHour: { $exists: false }
    });

    logger.info(`Verification:`)
    logger.info(`  Parking spaces with overtime rate: ${spacesWithOvertimeRate}`);
    logger.info(`  Parking spaces without overtime rate: ${spacesWithoutOvertimeRate}`);

    if (spacesWithoutOvertimeRate === 0) {
      logger.info('✅ Migration successful! All parking spaces now have overtime rates');
    } else {
      logger.warn('⚠️ Some parking spaces still missing overtime rates');
    }

  } catch (error) {
    logger.error('Overtime rate migration failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  addOvertimeRateField()
    .then(() => {
      logger.info('Overtime rate migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Overtime rate migration script failed:', error);
      process.exit(1);
    });
}

module.exports = addOvertimeRateField;