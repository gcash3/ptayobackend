const mongoose = require('mongoose');
const logger = require('../config/logger');

// Database migration script to rename pricePerHour to pricePer3Hours
async function migratePriceField() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo');
    logger.info('Connected to MongoDB for migration');

    // Get the database connection
    const db = mongoose.connection.db;
    const collection = db.collection('parkingspaces');

    // Find all documents that have pricePerHour but not pricePer3Hours
    const documentsToUpdate = await collection.find({
      pricePerHour: { $exists: true },
      pricePer3Hours: { $exists: false }
    }).toArray();

    logger.info(`Found ${documentsToUpdate.length} documents to migrate`);

    if (documentsToUpdate.length === 0) {
      logger.info('No documents need migration. All done!');
      return;
    }

    // Migrate each document
    let migratedCount = 0;
    let errorCount = 0;

    for (const doc of documentsToUpdate) {
      try {
        // Rename pricePerHour to pricePer3Hours (data is already in 3-hour format)
        await collection.updateOne(
          { _id: doc._id },
          {
            $set: { pricePer3Hours: doc.pricePerHour },
            $unset: { pricePerHour: 1 }
          }
        );

        migratedCount++;
        logger.info(`Migrated document ${doc._id}: ₱${doc.pricePerHour} -> pricePer3Hours: ₱${doc.pricePerHour}`);

      } catch (error) {
        errorCount++;
        logger.error(`Error migrating document ${doc._id}:`, error);
      }
    }

    logger.info(`Migration completed!`);
    logger.info(`  Successfully migrated: ${migratedCount} documents`);
    logger.info(`  Errors: ${errorCount} documents`);

    // Verify migration
    const remainingOldFields = await collection.countDocuments({
      pricePerHour: { $exists: true }
    });

    const newFieldsCount = await collection.countDocuments({
      pricePer3Hours: { $exists: true }
    });

    logger.info(`Verification:`);
    logger.info(`  Documents with old pricePerHour field: ${remainingOldFields}`);
    logger.info(`  Documents with new pricePer3Hours field: ${newFieldsCount}`);

    if (remainingOldFields === 0) {
      logger.info('✅ Migration successful! All pricePerHour fields have been renamed to pricePer3Hours');
    } else {
      logger.warn('⚠️ Some documents still have the old pricePerHour field');
    }

  } catch (error) {
    logger.error('Migration failed:', error);
    throw error;
  } finally {
    await mongoose.disconnect();
    logger.info('Disconnected from MongoDB');
  }
}

// Run migration if this script is executed directly
if (require.main === module) {
  migratePriceField()
    .then(() => {
      logger.info('Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      logger.error('Migration script failed:', error);
      process.exit(1);
    });
}

module.exports = migratePriceField;