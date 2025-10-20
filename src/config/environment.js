// Environment configuration with fallbacks for development
const path = require('path');

// Load environment variables
require('dotenv').config({ path: '.env.test' });

// Set development defaults if not in production
const setDefaults = () => {
  const defaults = {
    NODE_ENV: 'test',
    PORT: '5000',
    API_VERSION: 'v1'
  };

  // Only set defaults if not already set and not in production
  if (process.env.NODE_ENV !== 'production') {
    Object.keys(defaults).forEach(key => {
      if (!process.env[key]) {
        process.env[key] = defaults[key];
        console.log(`⚠️  Using default value for ${key}`);
      }
    });
  }
};

// Validate required environment variables
const validateEnvironment = () => {
  const required = [
    'PORT',
    'NODE_ENV'
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach(key => console.error(`   - ${key}`));
    
    if (process.env.NODE_ENV === 'production') {
      console.error('💥 Cannot start server without required environment variables in production');
      process.exit(1);
    } else {
      console.log('🔧 Setting test environment defaults...');
      setDefaults();
    }
  }
};

// Initialize environment
const initializeEnvironment = () => {
  console.log('🔧 Initializing environment configuration...');
  
  // Set defaults first
  setDefaults();
  
  // Then validate
  validateEnvironment();
  
  console.log(`📍 Environment: ${process.env.NODE_ENV}`);
  console.log(`🚀 Port: ${process.env.PORT}`);
  console.log(`🔑 JWT Secret: ${process.env.JWT_SECRET ? 'Set' : 'Not set'}`);
  console.log(`📱 SMS Enabled: ${process.env.SMS_ENABLE_NOTIFICATIONS === 'true' ? 'Yes' : 'No'}`);
  console.log(`🗺️ Google Maps API: ${process.env.GOOGLE_MAPS_API_KEY ? 'Set' : 'Not set'}`);
  
  return {
    NODE_ENV: process.env.NODE_ENV,
    PORT: parseInt(process.env.PORT),
    JWT_SECRET: process.env.JWT_SECRET,
    JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN,
    JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET,
    JWT_REFRESH_EXPIRES_IN: process.env.JWT_REFRESH_EXPIRES_IN,
    JWT_COOKIE_EXPIRES_IN: parseInt(process.env.JWT_COOKIE_EXPIRES_IN),
    API_VERSION: process.env.API_VERSION,
    LOG_LEVEL: process.env.LOG_LEVEL,
    RATE_LIMIT_WINDOW_MS: parseInt(process.env.RATE_LIMIT_WINDOW_MS),
    RATE_LIMIT_MAX_REQUESTS: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS),
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS?.split(',') || [],
    MONGODB_URI: process.env.MONGODB_URI,
    GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY,
    SMS_SERVER_URL: process.env.SMS_SERVER_URL,
    SMS_API_KEY: process.env.SMS_API_KEY,
    SMS_DEFAULT_DEVICE: parseInt(process.env.SMS_DEFAULT_DEVICE),
    SMS_DEFAULT_SIM_SLOT: parseInt(process.env.SMS_DEFAULT_SIM_SLOT),
    SMS_ENABLE_NOTIFICATIONS: process.env.SMS_ENABLE_NOTIFICATIONS === 'true',
    WEATHER_API_KEY: process.env.WEATHER_API_KEY,
    WEATHER_API_BASE_URL: process.env.WEATHER_API_BASE_URL,
    OPENWEATHER_API_KEY: process.env.OPENWEATHER_API_KEY
  };
};

module.exports = {
  initializeEnvironment,
  validateEnvironment,
  setDefaults
}; 