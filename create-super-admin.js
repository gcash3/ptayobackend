const mongoose = require('mongoose');
const Admin = require('./src/models/Admin');
const { initializeEnvironment } = require('./src/config/environment');

const env = initializeEnvironment();

async function createSuperAdmin() {
  try {
    console.log('🔌 Connecting to MongoDB...');
    await mongoose.connect(env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Check if super admin already exists
    const existingAdmin = await Admin.findOne({ email: 'admin@parktayo.com' });
    if (existingAdmin) {
      console.log('⚠️  Super admin already exists:', existingAdmin.email);
      console.log('Admin Level:', existingAdmin.adminLevel);
      console.log('Account Status:', existingAdmin.active ? 'Active' : 'Inactive');
      console.log('Account Locked:', existingAdmin.isAccountLocked ? 'Yes' : 'No');

      const readline = require('readline').createInterface({
        input: process.stdin,
        output: process.stdout
      });

      const answer = await new Promise(resolve => {
        readline.question('\nDo you want to delete and recreate? (yes/no): ', resolve);
      });

      readline.close();

      if (answer.toLowerCase() === 'yes') {
        console.log('🗑️  Deleting existing admin...');
        await Admin.deleteOne({ email: 'admin@parktayo.com' });
        console.log('✅ Existing admin deleted');
      } else {
        console.log('❌ Operation cancelled');
        await mongoose.disconnect();
        process.exit(0);
      }
    }

    // Create new super admin with Admin model
    console.log('👤 Creating super admin account...');

    const superAdmin = new Admin({
      // BaseUser fields
      firstName: 'System',
      lastName: 'Administrator',
      email: 'admin@parktayo.com',
      password: 'admin123', // Will be hashed by pre-save hook
      phoneNumber: '+639123456789',
      isEmailVerified: true,
      active: true,
      walletBalance: 0,
      averageRating: 5.0,
      totalReviews: 0,
      loginCount: 0,

      // Admin-specific fields
      adminLevel: 'super_admin',
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
      ],

      employeeId: 'ADMIN-001',
      department: 'operations',

      workSchedule: {
        timezone: 'Asia/Manila',
        workingHours: {
          start: '00:00',
          end: '23:59'
        },
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
      },

      twoFactorEnabled: false,
      isAccountLocked: false,

      stats: {
        totalActionsPerformed: 0,
        usersManaged: 0,
        ticketsResolved: 0,
        verificationsApproved: 0,
        verificationsRejected: 0,
        averageResponseTimeHours: 0
      },

      dashboardSettings: {
        defaultView: 'overview',
        refreshInterval: 30000,
        notificationSettings: {
          newUserRegistration: true,
          urgentTickets: true,
          systemAlerts: true,
          verificationRequests: true
        }
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

    await superAdmin.save();

    console.log('\n✅ Super Admin Account Created Successfully!\n');
    console.log('═══════════════════════════════════════════════');
    console.log('📧 Email:        admin@parktayo.com');
    console.log('🔑 Password:     admin123');
    console.log('👑 Admin Level:  super_admin');
    console.log('🏢 Employee ID:  ADMIN-001');
    console.log('📱 Department:   operations');
    console.log('✅ Status:       Active');
    console.log('🔓 Locked:       No');
    console.log('═══════════════════════════════════════════════');
    console.log('\n⚠️  IMPORTANT: Change the password after first login!\n');

    // Verify the account was created correctly
    const verifyAdmin = await Admin.findOne({ email: 'admin@parktayo.com' }).select('+password');
    if (verifyAdmin) {
      console.log('✅ Verification: Account exists in database');
      console.log('✅ User Type:', verifyAdmin.userType);
      console.log('✅ Has Password:', !!verifyAdmin.password);
      console.log('✅ Password Length:', verifyAdmin.password.length, 'chars (hashed)');
      console.log('✅ Permissions:', verifyAdmin.permissions.length, 'granted');
    }

  } catch (error) {
    console.error('❌ Error creating super admin:', error.message);
    if (error.errors) {
      console.error('Validation errors:');
      Object.keys(error.errors).forEach(key => {
        console.error(`  - ${key}: ${error.errors[key].message}`);
      });
    }
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

createSuperAdmin();
