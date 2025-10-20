const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('./src/models/User');

const JWT_SECRET = 'your_super_secret_jwt_key_here_change_in_production';

async function createTestUserAndLogin() {
  try {
    await mongoose.connect('mongodb://localhost:27017/parktayo');
    console.log('Connected to MongoDB');

    // Check if user already exists
    let user = await User.findOne({ email: 'test@example.com' });

    if (!user) {
      // Create test user
      console.log('Creating test user...');

      const hashedPassword = await bcrypt.hash('password123', 12);

      user = new User({
        firstName: 'Test',
        lastName: 'User',
        email: 'test@example.com',
        phoneNumber: '+639123456789',
        password: hashedPassword,
        isEmailVerified: true,
        isPhoneVerified: true,
        accountStatus: 'active',
        role: 'client'
      });

      await user.save();
      console.log('✅ Test user created successfully');
    } else {
      console.log('✅ Test user already exists');
    }

    // Generate JWT token
    const token = jwt.sign(
      {
        userId: user._id,
        email: user.email,
        role: user.role
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    console.log('\n🔑 JWT Token for testing:');
    console.log(token);
    console.log('\n👤 User ID:', user._id);
    console.log('📧 Email:', user.email);

    await mongoose.disconnect();
    console.log('\n✅ Done! Use this token in your tests.');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

createTestUserAndLogin();