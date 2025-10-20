# ParkTayo Backend API

Backend API server for ParkTayo parking rental platform using Node.js, Express, and MongoDB.

## Quick Start

### 1. Install Dependencies
```bash
npm install
```

### 2. Start the Server
```bash
# Development mode with auto-restart
npm run dev

# Production mode
npm start
```

The server will start on http://192.168.88.254:5000 with default development settings.

### 3. Test the API

#### Option A: Use the automated test script
```bash
# Windows
test-api.bat

# Unix/Linux/Mac
chmod +x test-api.sh
./test-api.sh
```

#### Option B: Manual curl commands

**Health Check:**
```bash
curl -X GET http://192.168.88.254:5000/health
```

**Test Account Login:**
```bash
curl -X POST http://192.168.88.254:5000/api/v1/auth/test-login \
  -H "Content-Type: application/json"
```

**User Signup:**
```bash
curl -X POST http://192.168.88.254:5000/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{"firstName":"Test","lastName":"User","email":"test@example.com","password":"TestPassword123","role":"client"}'
```

**Get Parking Spaces:**
```bash
curl -X GET "http://192.168.88.254:5000/api/v1/parking-spaces"
```

**Search Parking Spaces:**
```bash
curl -X GET "http://192.168.88.254:5000/api/v1/parking-spaces/search?q=test"
```

**Get Nearby Parking:**
```bash
curl -X GET "http://192.168.88.254:5000/api/v1/parking-spaces/nearby?latitude=14.5997&longitude=120.9827&radius=5"
```

**Create Seed Data (Development):**
```bash
curl -X POST http://192.168.88.254:5000/api/v1/parking-spaces/seed
```

## API Endpoints

### Authentication
- `POST /api/v1/auth/signup` - User registration
- `POST /api/v1/auth/login` - User login
- `POST /api/v1/auth/test-login` - Test account login
- `POST /api/v1/auth/logout` - User logout
- `GET /api/v1/auth/me` - Get current user (requires auth)

### Parking Spaces
- `GET /api/v1/parking-spaces` - Get all parking spaces with filters
- `GET /api/v1/parking-spaces/search` - Search parking spaces
- `GET /api/v1/parking-spaces/nearby` - Get nearby parking spaces
- `GET /api/v1/parking-spaces/:id` - Get single parking space
- `POST /api/v1/parking-spaces/seed` - Create test data (development only)

### Protected Routes (require authentication)
- `GET /api/v1/users` - User management
- `POST /api/v1/bookings` - Booking operations
- `GET /api/v1/transactions` - Transaction history
- `GET /api/v1/notifications` - User notifications
- `GET /api/v1/admin` - Admin operations

## Environment Configuration

The server will automatically set development defaults if environment variables are not provided. For production, create a `.env` file:

```env
NODE_ENV=production
PORT=5000
JWT_SECRET=your-super-secret-jwt-key
JWT_EXPIRES_IN=7d
MONGODB_URI=mongodb://localhost:27017/parktayo
```

## Development Features

- **Hot Reload**: Uses nodemon for automatic server restart
- **Error Handling**: Comprehensive error middleware with logging
- **Security**: CORS, helmet, rate limiting, input sanitization
- **Logging**: Winston logger with file and console output
- **Validation**: Input validation with express-validator

## Testing

The backend includes two testing scripts:
- `test-api.bat` - Windows batch script
- `test-api.sh` - Unix shell script

Both scripts test all major endpoints and provide clear output.

## Project Structure

```
parktayo-backend/
├── src/
│   ├── config/          # Configuration files
│   ├── controllers/     # Route handlers
│   ├── middleware/      # Express middleware
│   ├── models/          # Database models
│   ├── routes/          # Route definitions
│   └── server.js        # Main server file
├── logs/                # Log files
├── test-api.bat         # Windows test script
├── test-api.sh          # Unix test script
└── package.json
```

## Features

- ✅ JWT Authentication with refresh tokens
- ✅ User management (clients, landlords, admins)
- ✅ Parking space CRUD operations
- ✅ Geospatial search and filtering
- ✅ Real-time features with Socket.IO
- ✅ Comprehensive error handling
- ✅ Security best practices
- ✅ Development-friendly setup

## MongoDB (Optional)

The server currently runs without MongoDB for testing purposes. To enable MongoDB:

1. Uncomment the database connection in `src/server.js`
2. Set `MONGODB_URI` in your environment
3. Ensure MongoDB is running

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test with the provided scripts
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

For support and questions, please create an issue in the repository.

---

**ParkTayo Backend** - Building the future of parking space rentals in the University Belt! 🚗🏫 