const mongoose = require('mongoose');
require('dotenv').config();

// Load base model first
require('./src/models/BaseUser');
const Admin = require('./src/models/Admin');

// Database connection
const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo';

mongoose.connect(DB_URI)
.then(() => console.log('✅ MongoDB connected'))
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

async function activateAdmin() {
  try {
    console.log('🔍 Finding admin@parktayo.com...');

    const admin = await Admin.findOne({ email: 'admin@parktayo.com' });

    if (!admin) {
      console.log('❌ Admin account not found!');
      process.exit(1);
    }

    console.log('Current status:', {
      email: admin.email,
      active: admin.active,
      status: admin.status,
      adminLevel: admin.adminLevel
    });

    // Activate the account
    admin.active = true;
    admin.status = 'active';
    await admin.save();

    console.log('✅ Admin account activated!');
    console.log('New status:', {
      email: admin.email,
      active: admin.active,
      status: admin.status,
      adminLevel: admin.adminLevel
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error activating admin:', error);
    process.exit(1);
  }
}

activateAdmin();
