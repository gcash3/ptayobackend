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

async function checkAdminStatus() {
  try {
    console.log('🔍 Checking admin@parktayo.com status...\n');

    const admin = await Admin.findOne({ email: 'admin@parktayo.com' })
      .select('+password +active +status +suspensionReason +suspendedAt');

    if (!admin) {
      console.log('❌ Admin account not found!');
      process.exit(1);
    }

    console.log('Admin Account Details:');
    console.log('======================');
    console.log('Email:', admin.email);
    console.log('Admin Level:', admin.adminLevel);
    console.log('');
    console.log('Status Fields:');
    console.log('--------------');
    console.log('active:', admin.active, `(type: ${typeof admin.active})`);
    console.log('status:', admin.status, `(type: ${typeof admin.status})`);
    console.log('');
    console.log('Login Check Results:');
    console.log('--------------------');
    console.log('!admin.active:', !admin.active);
    console.log('admin.status !== "active":', admin.status !== 'active');
    console.log('Will fail login check:', !admin.active || admin.status !== 'active');
    console.log('');

    if (!admin.active || admin.status !== 'active') {
      console.log('⚠️  PROBLEM DETECTED!');
      console.log('');
      console.log('Fixing...');

      // Ensure both fields are set correctly
      admin.active = true;
      admin.status = 'active';

      // Use validateBeforeSave: false to skip validation
      await admin.save({ validateBeforeSave: false });

      console.log('✅ Fixed!');
      console.log('');

      // Verify
      const verify = await Admin.findOne({ email: 'admin@parktayo.com' })
        .select('+active +status');

      console.log('Verification:');
      console.log('active:', verify.active);
      console.log('status:', verify.status);
      console.log('Will pass login check:', verify.active && verify.status === 'active');
    } else {
      console.log('✅ Account status is correct!');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAdminStatus();
