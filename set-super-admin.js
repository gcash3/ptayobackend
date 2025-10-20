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

async function setSuperAdmin() {
  try {
    console.log('🔍 Finding admin@parktayo.com...');

    // Try to find in Admin collection
    let admin = await Admin.findOne({ email: 'admin@parktayo.com' });

    if (!admin) {
      console.log('❌ Admin account not found in Admin model!');
      console.log('Checking if it exists as User...');

      const User = require('./src/models/User');
      const user = await User.findOne({ email: 'admin@parktayo.com', role: 'admin' }).select('+password');

      if (user) {
        console.log('✅ Found as User, migrating to Admin model...');
        admin = await Admin.create({
          email: user.email,
          password: user.password, // Already hashed
          firstName: user.firstName,
          lastName: user.lastName,
          phoneNumber: user.phoneNumber,
          role: 'admin',
          adminLevel: 'super_admin',
          isEmailVerified: user.isEmailVerified,
          permissions: [
            'user_management',
            'space_management',
            'booking_management',
            'financial_management',
            'content_management',
            'system_settings',
            'analytics_access',
            'support_tickets',
            'verification_approval',
            'emergency_actions'
          ]
        });

        // Delete old user record
        await User.deleteOne({ _id: user._id });
        console.log('✅ Migrated successfully!');
      } else {
        console.log('❌ Admin account not found anywhere!');
        console.log('Please create admin@parktayo.com first using create-admin-proper.js');
        process.exit(1);
      }
    }

    console.log('✅ Found admin account:', {
      email: admin.email,
      currentAdminLevel: admin.adminLevel,
      currentPermissions: admin.permissions
    });

    // Update to super_admin with all permissions
    admin.adminLevel = 'super_admin';
    admin.permissions = [
      'user_management',
      'space_management',
      'booking_management',
      'financial_management',
      'content_management',
      'system_settings',
      'analytics_access',
      'support_tickets',
      'verification_approval',
      'emergency_actions'
    ];

    await admin.save();

    console.log('✅ Successfully updated admin@parktayo.com to super_admin!');
    console.log('New settings:', {
      email: admin.email,
      adminLevel: admin.adminLevel,
      permissions: admin.permissions,
      department: admin.department
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error setting super admin:', error);
    process.exit(1);
  }
}

setSuperAdmin();
