// Script to create an admin user for testing
require('dotenv').config();
const mongoose = require('mongoose');
const User = require('./src/models/User');

async function createAdmin() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo', {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB');

    // Check if admin already exists
    const existingAdmin = await User.findOne({ email: 'admin@parktayo.com', role: 'admin' });

    if (existingAdmin) {
      console.log('Admin user already exists');
      process.exit(0);
    }

    // Create admin user
    const adminUser = new User({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@parktayo.com',
      password: 'admin123',
      role: 'admin',
      isEmailVerified: true,
      active: true
    });

    await adminUser.save();
    console.log('Admin user created successfully');
    console.log('Email: admin@parktayo.com');
    console.log('Password: admin123');

    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
}

createAdmin();