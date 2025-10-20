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

async function debugAdminUser() {
  try {
    const admin = await Admin.findOne({ email: 'admin@parktayo.com' });

    if (!admin) {
      console.log('❌ Admin not found');
      process.exit(1);
    }

    console.log('Admin User Details:');
    console.log('===================');
    console.log('_id:', admin._id);
    console.log('email:', admin.email);
    console.log('role:', admin.role);
    console.log('adminLevel:', admin.adminLevel);
    console.log('__t (discriminator):', admin.__t);
    console.log('constructor.modelName:', admin.constructor.modelName);
    console.log('');
    console.log('Object check:');
    console.log('admin.__t === "Admin":', admin.__t === 'Admin');
    console.log('admin.role === "admin":', admin.role === 'admin');
    console.log('');
    console.log('Full object keys:', Object.keys(admin.toObject()));

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

debugAdminUser();
