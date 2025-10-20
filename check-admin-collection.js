const mongoose = require('mongoose');
require('dotenv').config();

// Load base model first
require('./src/models/BaseUser');
const Admin = require('./src/models/Admin');
const User = require('./src/models/User');

// Database connection
const DB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo';

async function checkAdmins() {
  await mongoose.connect(DB_URI);
  console.log('✅ MongoDB connected\n');
  try {
    console.log('🔍 Checking Admin collections...\n');

    // Check what collections exist
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log('Available collections:');
    collections.forEach(c => console.log(`  - ${c.name}`));

    console.log('\n====================================');
    console.log('Checking BaseUser collection (users)');
    console.log('====================================\n');

    // Check users collection directly
    const db = mongoose.connection.db;
    const usersCollection = db.collection('users');
    const allUsers = await usersCollection.find({}).toArray();

    console.log(`Total documents in 'users' collection: ${allUsers.length}`);

    // Filter by __t field
    const adminDocs = allUsers.filter(u => u.__t === 'Admin');
    console.log(`Documents with __t='Admin': ${adminDocs.length}`);

    if (adminDocs.length > 0) {
      console.log('\nAdmin documents found:');
      adminDocs.forEach(admin => {
        console.log(`  - ${admin.email} (adminLevel: ${admin.adminLevel}, __t: ${admin.__t})`);
      });
    }

    console.log('\n====================================');
    console.log('Using Admin.find() query');
    console.log('====================================\n');

    const adminsViaModel = await Admin.find();
    console.log(`Admin.find() returned: ${adminsViaModel.length} documents`);

    if (adminsViaModel.length > 0) {
      adminsViaModel.forEach(admin => {
        console.log(`  - ${admin.email} (adminLevel: ${admin.adminLevel})`);
      });
    }

    console.log('\n====================================');
    console.log('Checking specific emails');
    console.log('====================================\n');

    const testEmails = [
      'admin@parktayo.com',
      'support1@parktayo.com',
      'support2@parktayo.com',
      'moderator1@parktayo.com'
    ];

    for (const email of testEmails) {
      const admin = await Admin.findOne({ email });
      if (admin) {
        console.log(`✅ ${email} found via Admin model`);
        console.log(`   adminLevel: ${admin.adminLevel}, __t: ${admin.__t || 'undefined'}`);
      } else {
        console.log(`❌ ${email} NOT found via Admin model`);

        // Check in User model
        const user = await User.findOne({ email });
        if (user) {
          console.log(`   Found in User model instead! role: ${user.role}, __t: ${user.__t || 'undefined'}`);
        }
      }
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkAdmins();
