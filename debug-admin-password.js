const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('./src/models/User');
const { initializeEnvironment } = require('./src/config/environment');

const env = initializeEnvironment();

async function debugAdminPassword() {
  try {
    await mongoose.connect(env.MONGODB_URI);
    console.log('Connected to MongoDB\n');
    
    // Find the admin user - explicitly select password field since it has select: false
    const admin = await User.findOne({ email: 'admin@parktayo.com' }).select('+password');
    
    if (!admin) {
      console.log('❌ Admin user not found!');
      return;
    }
    
    console.log('✅ Admin user found:');
    console.log('Email:', admin.email);
    console.log('Role:', admin.role);
    console.log('Active:', admin.active);
    console.log('Status:', admin.status);
    console.log('Has Password:', !!admin.password);
    console.log('Password Hash Length:', admin.password ? admin.password.length : 0);
    console.log('Password Hash (first 20 chars):', admin.password ? admin.password.substring(0, 20) : 'N/A');
    console.log('\n-----------------------------------\n');
    
    // Test password comparison manually
    const testPassword = 'admin123';
    console.log(`Testing password: "${testPassword}"`);
    
    // Method 1: Direct bcrypt compare
    console.log('\nMethod 1: Direct bcrypt.compare()');
    const isMatch1 = await bcrypt.compare(testPassword, admin.password);
    console.log('Result:', isMatch1 ? '✅ MATCH' : '❌ NO MATCH');
    
    // Method 2: Using the model method
    console.log('\nMethod 2: Using admin.correctPassword()');
    const isMatch2 = await admin.correctPassword(testPassword, admin.password);
    console.log('Result:', isMatch2 ? '✅ MATCH' : '❌ NO MATCH');
    
    // Test with wrong password
    console.log('\n-----------------------------------\n');
    const wrongPassword = 'wrongpassword';
    console.log(`Testing with wrong password: "${wrongPassword}"`);
    const isMatch3 = await bcrypt.compare(wrongPassword, admin.password);
    console.log('Result:', isMatch3 ? '❌ SHOULD NOT MATCH' : '✅ Correctly rejected');
    
    // Check if password was hashed with bcryptjs
    console.log('\n-----------------------------------\n');
    console.log('Password Hash Info:');
    console.log('Starts with $2a$:', admin.password.startsWith('$2a$'));
    console.log('Starts with $2b$:', admin.password.startsWith('$2b$'));
    
    // Extract salt rounds from hash
    const hashParts = admin.password.split('$');
    if (hashParts.length >= 3) {
      console.log('Hash algorithm:', hashParts[1]);
      console.log('Salt rounds:', hashParts[2]);
    }
    
    // Test creating a fresh hash and comparing
    console.log('\n-----------------------------------\n');
    console.log('Testing fresh hash creation:');
    const freshHash = await bcrypt.hash('admin123', 12);
    console.log('Fresh hash created:', freshHash.substring(0, 20) + '...');
    const freshMatch = await bcrypt.compare('admin123', freshHash);
    console.log('Fresh hash comparison:', freshMatch ? '✅ WORKS' : '❌ BROKEN');
    
    // Additional debugging
    console.log('\n-----------------------------------\n');
    console.log('Additional User Info:');
    console.log('Is Email Verified:', admin.isEmailVerified);
    console.log('Login Count:', admin.loginCount);
    console.log('Created At:', admin.createdAt);
    console.log('Updated At:', admin.updatedAt);
    
    // Check if there are any pre-save hooks that might modify the password
    console.log('\n-----------------------------------\n');
    console.log('RECOMMENDATION:');
    
    if (isMatch1 && isMatch2) {
      console.log('✅ Password hashing is working correctly!');
      console.log('   The issue might be elsewhere in the login flow.');
      console.log('   Check:');
      console.log('   1. Admin panel is sending correct email/password');
      console.log('   2. Request body parsing is working');
      console.log('   3. CORS is configured correctly');
    } else {
      console.log('❌ Password comparison is NOT working!');
      console.log('   Try recreating the admin with:');
      console.log('   node create-admin-proper.js');
    }
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

debugAdminPassword();

