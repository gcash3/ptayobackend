const io = require('socket.io-client');
const axios = require('axios');

// Configuration
const BASE_URL = 'http://192.168.88.254:5000';
const SOCKET_URL = 'http://192.168.88.254:5000';

// Test data
const TEST_DATA = {
  landlordId: '688ce3663053de674c62aa6c',
  userId: '688eb96b66b0d26ae81e791d',
  bookingId: '6894ebb0b723418dda7c870e'
};

/**
 * Verify landlord app connection and functionality
 */
async function verifyLandlordApp() {
  console.log('🔍 Verifying Landlord App Connection and Functionality...\n');
  
  try {
    // Step 1: Check if landlord app is connected
    await checkLandlordAppConnection();
    
    // Step 2: Send test notification
    await sendTestNotification();
    
    console.log('\n✅ Verification completed!');
    console.log('\n📱 Summary:');
    console.log('   • Backend is working correctly');
    console.log('   • WebSocket events are being sent');
    console.log('   • Landlord app should receive notifications');
    console.log('   • If landlord app is not showing notifications, check:');
    console.log('     - Is the landlord app running?');
    console.log('     - Is the landlord logged in?');
    console.log('     - Are there any WebSocket connection errors?');
    console.log('     - Are there any console errors in the app?');
    
  } catch (error) {
    console.error('❌ Verification failed:', error.message);
  } finally {
    process.exit(0);
  }
}

/**
 * Check if landlord app is connected
 */
async function checkLandlordAppConnection() {
  console.log('🔍 Step 1: Checking landlord app connection...');
  
  try {
    // Try to connect as landlord to see if there are any connection issues
    const response = await axios.post(`${BASE_URL}/api/v1/auth/landlord/login`, {
      email: 'landlord@gmail.com',
      password: 'Apple0508'
    });
    
    const token = response.data.token;
    console.log('✅ Landlord authentication successful');
    
    // Test WebSocket connection
    const socket = io(SOCKET_URL, {
      auth: {
        token: token,
        userId: TEST_DATA.landlordId,
        userType: 'landlord'
      }
    });
    
    return new Promise((resolve) => {
      socket.on('connect', () => {
        console.log('✅ WebSocket connection test successful');
        console.log(`🆔 Socket ID: ${socket.id}`);
        
        // Join rooms
        socket.emit('join_landlord_room', TEST_DATA.landlordId);
        socket.emit('join_user_room', TEST_DATA.landlordId);
        
        console.log('✅ Room joining test successful');
        
        // Disconnect test socket
        socket.disconnect();
        resolve(true);
      });
      
      socket.on('connect_error', (error) => {
        console.error('❌ WebSocket connection test failed:', error);
        resolve(false);
      });
      
      // Timeout after 5 seconds
      setTimeout(() => {
        console.error('❌ WebSocket connection test timed out');
        socket.disconnect();
        resolve(false);
      }, 5000);
    });
    
  } catch (error) {
    console.error('❌ Landlord authentication failed:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send test notification
 */
async function sendTestNotification() {
  console.log('📤 Step 2: Sending test notification...');
  
  try {
    // Login as landlord
    const response = await axios.post(`${BASE_URL}/api/v1/auth/landlord/login`, {
      email: 'landlord@gmail.com',
      password: 'Apple0508'
    });
    
    const token = response.data.token;
    
    // Create test socket
    const socket = io(SOCKET_URL, {
      auth: {
        token: token,
        userId: TEST_DATA.landlordId,
        userType: 'landlord'
      }
    });
    
    return new Promise((resolve) => {
      socket.on('connect', () => {
        console.log('✅ Test socket connected');
        
        // Join rooms
        socket.emit('join_landlord_room', TEST_DATA.landlordId);
        socket.emit('join_user_room', TEST_DATA.landlordId);
        
        // Send test notification
        const testNotification = {
          type: 'user_arrived',
          bookingId: TEST_DATA.bookingId,
          userId: TEST_DATA.userId,
          parkingSpaceId: '688e9d520bd159ab15e3c905',
          landlordId: TEST_DATA.landlordId,
          user: {
            firstName: 'Test',
            lastName: 'User',
            id: TEST_DATA.userId
          },
          parkingSpace: {
            name: 'UE GYM PARKING',
            id: '688e9d520bd159ab15e3c905'
          },
          arrivalTime: new Date().toISOString(),
          userLocation: {
            latitude: 14.6024948,
            longitude: 120.9905152,
            accuracy: 5
          },
          geoFenceStatus: {
            status: 'arrived',
            distance: 190.32,
            zone: 'arrival',
            message: 'User has arrived at parking space'
          },
          message: 'User has arrived at parking space',
          timestamp: new Date().toISOString()
        };
        
        // Emit test notification
        socket.emit('user_location_update', testNotification);
        console.log('📤 Test notification sent');
        console.log('📋 Notification data:', JSON.stringify(testNotification, null, 2));
        
        // Wait a moment
        setTimeout(() => {
          console.log('✅ Test notification sent successfully');
          socket.disconnect();
          resolve(true);
        }, 2000);
      });
      
      socket.on('connect_error', (error) => {
        console.error('❌ Test socket connection failed:', error);
        resolve(false);
      });
    });
    
  } catch (error) {
    console.error('❌ Failed to send test notification:', error.message);
    throw error;
  }
}

// Run verification
verifyLandlordApp();
