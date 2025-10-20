const fs = require('fs');
const path = require('path');

// Read current .env file
const envPath = path.join(__dirname, '.env');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
} else {
  console.log('⚠️ .env file not found, creating new one...');
}

// Update MongoDB URI to use production database
const lines = envContent.split('\n');
let updatedLines = [];
let mongoUriFound = false;

for (const line of lines) {
  if (line.startsWith('MONGODB_URI=')) {
    // Replace with production database
    updatedLines.push('MONGODB_URI=mongodb://localhost:27017/parktayo');
    mongoUriFound = true;
    console.log('🔄 Updated MONGODB_URI to use production database (parktayo)');
  } else if (line.startsWith('NODE_ENV=')) {
    // Set to development for debugging
    updatedLines.push('NODE_ENV=development');
    console.log('🔄 Set NODE_ENV to development');
  } else {
    updatedLines.push(line);
  }
}

// Add MONGODB_URI if not found
if (!mongoUriFound) {
  updatedLines.push('MONGODB_URI=mongodb://localhost:27017/parktayo');
  console.log('➕ Added MONGODB_URI for production database');
}

// Write back to .env file
fs.writeFileSync(envPath, updatedLines.join('\n'));

console.log('\n✅ Successfully switched to production database!');
console.log('📋 Current database configuration:');
console.log('   Database: parktayo (production)');
console.log('   Environment: development');
console.log('   Connection: mongodb://localhost:27017/parktayo');
console.log('\n🚀 Restart your backend server to apply changes.');
console.log('💡 Your wallet credit transactions should now be visible in the admin panel.');