const axios = require('axios');

// Test login to get a valid token
async function generateTestToken() {
  try {
    console.log('🔑 Generating test token...');

    const loginResponse = await axios.post('http://192.168.100.154:5000/api/v1/auth/login', {
      email: 'admin@parktayo.com',
      password: 'admin123'
    });

    console.log('📋 Login response data:', JSON.stringify(loginResponse.data, null, 2));

    if (loginResponse.data.status === 'success' && loginResponse.data.token) {
      const token = loginResponse.data.token;
      console.log('✅ Token generated successfully!');
      console.log('🎯 Token:', token);
      console.log('\n📋 Update test_optimized_ai_suggestions.js with this token:');
      console.log(`const JWT_TOKEN = '${token}';`);
      return token;
    } else {
      throw new Error('Login failed: ' + JSON.stringify(loginResponse.data));
    }
  } catch (error) {
    console.error('❌ Error generating token:', error.response?.data?.message || error.message);
  }
}

// Run the token generation
generateTestToken();