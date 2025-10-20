const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
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

async function resetAdminPassword() {
  try {
    console.log('🔍 Finding admin@parktayo.com...');

    const admin = await Admin.findOne({ email: 'admin@parktayo.com' });

    if (!admin) {
      console.log('❌ Admin account not found!');
      process.exit(1);
    }

    console.log('✅ Found admin account:', {
      email: admin.email,
      adminLevel: admin.adminLevel
    });

    // Set new password - the pre-save hook will hash it
    admin.password = 'admin123';
    await admin.save();

    console.log('✅ Password reset successfully!');
    console.log('New credentials:');
    console.log('Email: admin@parktayo.com');
    console.log('Password: admin123');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    process.exit(1);
  }
}

resetAdminPassword();
