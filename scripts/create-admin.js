#!/usr/bin/env node

/**
 * Admin Account Creation Script for ParkTayo Backend
 * 
 * This script creates an admin user account in MongoDB.
 * It can be run independently and connects directly to the database.
 * 
 * Usage:
 *   node scripts/create-admin.js
 *   node scripts/create-admin.js --email admin@parktayo.com --password AdminPass123!
 */

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

// Load environment variables from parent directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Admin user model schema (inline to avoid dependencies)
const adminUserSchema = new mongoose.Schema({
  firstName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  lastName: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    match: /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/
  },
  phoneNumber: {
    type: String,
    match: /^(\+63|0)[0-9]{10}$/,
    sparse: true
  },
  password: {
    type: String,
    required: true,
    minlength: 8
  },
  role: {
    type: String,
    enum: ['client', 'landlord', 'admin'],
    default: 'admin'
  },
  profilePicture: {
    type: String,
    default: null
  },
  isEmailVerified: {
    type: Boolean,
    default: true // Admin accounts are pre-verified
  },
  active: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  lastLogin: {
    type: Date,
    default: null
  }
});

// Hash password before saving
adminUserSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Create User model
const User = mongoose.model('User', adminUserSchema);

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m'
};

const log = {
  info: (msg) => console.log(`${colors.blue}ℹ${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}✅${colors.reset} ${msg}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}❌${colors.reset} ${msg}`),
  title: (msg) => console.log(`${colors.cyan}🔧 ${msg}${colors.reset}`)
};

// Parse command line arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    email: 'admin@parktayo.com',
    password: 'AdminPass123!',
    firstName: 'Admin',
    lastName: 'User',
    phoneNumber: '+639123456789'
  };

  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]?.replace('--', '');
    const value = args[i + 1];
    if (key && value && options.hasOwnProperty(key)) {
      options[key] = value;
    }
  }

  return options;
}

// Validate password strength
function validatePassword(password) {
  const minLength = 8;
  const hasUpperCase = /[A-Z]/.test(password);
  const hasLowerCase = /[a-z]/.test(password);
  const hasNumbers = /\d/.test(password);
  const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password);

  const errors = [];
  
  if (password.length < minLength) {
    errors.push(`Password must be at least ${minLength} characters long`);
  }
  if (!hasUpperCase) {
    errors.push('Password must contain at least one uppercase letter');
  }
  if (!hasLowerCase) {
    errors.push('Password must contain at least one lowercase letter');
  }
  if (!hasNumbers) {
    errors.push('Password must contain at least one number');
  }
  if (!hasSpecialChar) {
    errors.push('Password must contain at least one special character');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

// Connect to MongoDB
async function connectToDatabase() {
  try {
    const mongoURI = process.env.MONGODB_URI || 'mongodb://localhost:27017/parktayo_db';
    
    log.info(`Connecting to MongoDB: ${mongoURI.replace(/\/\/.*@/, '//***:***@')}`);
    
    await mongoose.connect(mongoURI, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });
    
    log.success(`Connected to MongoDB: ${mongoose.connection.host}`);
    log.info(`Database: ${mongoose.connection.name}`);
    
  } catch (error) {
    log.error(`Database connection failed: ${error.message}`);
    
    if (error.message.includes('ECONNREFUSED')) {
      log.warning('Make sure MongoDB is running on your system');
      log.info('To start MongoDB: net start MongoDB (Windows) or brew services start mongodb (Mac)');
    }
    
    throw error;
  }
}

// Create admin user
async function createAdminUser(options) {
  try {
    log.info('Checking if admin user already exists...');
    
    // Check if user with this email already exists
    const existingUser = await User.findOne({ email: options.email });
    
    if (existingUser) {
      if (existingUser.role === 'admin') {
        log.warning(`Admin user with email ${options.email} already exists`);
        
        // Ask if user wants to update password
        const readline = require('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout
        });
        
        return new Promise((resolve) => {
          rl.question('Do you want to update the password? (y/N): ', async (answer) => {
            rl.close();
            
            if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
              existingUser.password = options.password;
              existingUser.updatedAt = new Date();
              await existingUser.save();
              log.success('Admin password updated successfully!');
            } else {
              log.info('Admin user already exists. No changes made.');
            }
            resolve(existingUser);
          });
        });
      } else {
        log.error(`User with email ${options.email} exists but is not an admin (role: ${existingUser.role})`);
        log.info('Please use a different email or remove the existing user first');
        return null;
      }
    }
    
    // Validate password
    const passwordValidation = validatePassword(options.password);
    if (!passwordValidation.isValid) {
      log.error('Password validation failed:');
      passwordValidation.errors.forEach(error => log.error(`  - ${error}`));
      return null;
    }
    
    log.info('Creating new admin user...');
    
    // Create new admin user
    const adminUser = new User({
      firstName: options.firstName,
      lastName: options.lastName,
      email: options.email,
      phoneNumber: options.phoneNumber,
      password: options.password, // Will be hashed by pre-save middleware
      role: 'admin',
      isEmailVerified: true,
      active: true
    });
    
    await adminUser.save();
    
    log.success('Admin user created successfully!');
    
    return adminUser;
    
  } catch (error) {
    if (error.code === 11000) {
      log.error('A user with this email already exists');
    } else if (error.name === 'ValidationError') {
      log.error('Validation error:');
      Object.values(error.errors).forEach(err => {
        log.error(`  - ${err.message}`);
      });
    } else {
      log.error(`Error creating admin user: ${error.message}`);
    }
    throw error;
  }
}

// Display admin user details
function displayAdminDetails(user, password) {
  console.log('\n' + '='.repeat(50));
  log.title('ADMIN ACCOUNT CREATED');
  console.log('='.repeat(50));
  console.log(`${colors.cyan}ID:${colors.reset}         ${user._id}`);
  console.log(`${colors.cyan}Name:${colors.reset}       ${user.firstName} ${user.lastName}`);
  console.log(`${colors.cyan}Email:${colors.reset}      ${user.email}`);
  console.log(`${colors.cyan}Phone:${colors.reset}      ${user.phoneNumber || 'N/A'}`);
  console.log(`${colors.cyan}Role:${colors.reset}       ${user.role}`);
  console.log(`${colors.cyan}Password:${colors.reset}   ${password}`);
  console.log(`${colors.cyan}Verified:${colors.reset}   ${user.isEmailVerified ? 'Yes' : 'No'}`);
  console.log(`${colors.cyan}Active:${colors.reset}     ${user.active ? 'Yes' : 'No'}`);
  console.log(`${colors.cyan}Created:${colors.reset}    ${user.createdAt.toISOString()}`);
  console.log('='.repeat(50));
  
  log.warning('IMPORTANT: Save these credentials securely!');
  log.info('You can now use these credentials to login to the admin panel');
  log.info('API Endpoint: POST /api/v1/auth/login');
  console.log();
}

// Main function
async function main() {
  try {
    log.title('ParkTayo Admin Account Creation Script');
    console.log();
    
    // Parse command line arguments
    const options = parseArgs();
    
    log.info('Configuration:');
    console.log(`  Email: ${options.email}`);
    console.log(`  Name: ${options.firstName} ${options.lastName}`);
    console.log(`  Phone: ${options.phoneNumber}`);
    console.log();
    
    // Connect to database
    await connectToDatabase();
    
    // Create admin user
    const adminUser = await createAdminUser(options);
    
    if (adminUser) {
      displayAdminDetails(adminUser, options.password);
    }
    
  } catch (error) {
    log.error(`Script failed: ${error.message}`);
    process.exit(1);
  } finally {
    // Close database connection
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.close();
      log.info('Database connection closed');
    }
  }
}

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log.error(`Uncaught Exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (error) => {
  log.error(`Unhandled Rejection: ${error.message}`);
  process.exit(1);
});

// Help message
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`
${colors.cyan}ParkTayo Admin Account Creation Script${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node scripts/create-admin.js [options]

${colors.yellow}Options:${colors.reset}
  --email       Admin email address (default: admin@parktayo.com)
  --password    Admin password (default: AdminPass123!)
  --firstName   Admin first name (default: Admin)
  --lastName    Admin last name (default: User)
  --phoneNumber Admin phone number (default: +639123456789)
  --help, -h    Show this help message

${colors.yellow}Examples:${colors.reset}
  # Create admin with default credentials
  node scripts/create-admin.js

  # Create admin with custom credentials
  node scripts/create-admin.js --email john@parktayo.com --password MySecurePass123! --firstName John --lastName Doe

${colors.yellow}Requirements:${colors.reset}
  - MongoDB must be running
  - .env file must be configured with MONGODB_URI
  - Password must meet security requirements (8+ chars, uppercase, lowercase, number, special char)

${colors.yellow}Environment Variables:${colors.reset}
  MONGODB_URI - MongoDB connection string (default: mongodb://localhost:27017/parktayo_db)
  `);
  process.exit(0);
}

// Run the script
if (require.main === module) {
  main();
}

module.exports = {
  createAdminUser,
  connectToDatabase,
  validatePassword
};
