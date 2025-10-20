const mongoose = require('mongoose');
const User = require('./src/models/User');
const { initializeEnvironment } = require('./src/config/environment');

const env = initializeEnvironment();

async function createAdminProper() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Check if admin already exists
    const existingAdmin = await User.findOne({ role: 'admin' });
    if (existingAdmin) {
      console.log('Admin already exists:', existingAdmin.email);
      console.log('Deleting existing admin...');
      await User.deleteOne({ role: 'admin' });
    }
    
    // Create new admin user with proper fields
    // Don't pre-hash the password - let the pre-save hook handle it
    const admin = new User({
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@parktayo.com',
      password: 'admin123', // Plain text password - will be hashed by pre-save hook
      phoneNumber: '+639123456789',
      role: 'admin',
      isEmailVerified: true,
      active: true,
      preferredUniversities: [],
      vehicleType: 'car',
      isVerifiedLandlord: false,
      verificationDocuments: [],
      walletBalance: 0,
      totalEarnings: 0,
      averageRating: 0,
      totalReviews: 0,
      loginCount: 0,
      behaviorMetrics: {
        latenessPatterns: {
          averageDelay: 0,
          timeOfDayPattern: [],
          trafficConditionPattern: []
        },
        reliabilityScore: 85,
        preferredBufferTime: 30,
        totalBookings: 0,
        onTimeBookings: 0,
        arrivalHistory: []
      },
      notificationPreferences: {
        booking: true,
        payment: true,
        space: true,
        account: true,
        system: true,
        marketing: false
      },
      legacyNotificationPreferences: {
        email: true,
        push: true,
        sms: false
      },
      deviceTokens: []
    });
    
    await admin.save();
    console.log('✅ Admin user created successfully:');
    console.log('Email:', admin.email);
    console.log('Password: admin123');
    console.log('Role:', admin.role);
    
  } catch (error) {
    console.error('Error creating admin:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

createAdminProper();
