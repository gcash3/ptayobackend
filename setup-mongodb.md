# MongoDB Setup Guide for ParkTayo Backend

## Option 1: Local MongoDB Installation (Recommended for Development)

### Step 1: Download and Install MongoDB Community Server

1. Visit [MongoDB Download Center](https://www.mongodb.com/try/download/community)
2. Select:
   - **Version**: 7.0.x (latest stable)
   - **Platform**: Windows
   - **Package**: msi

3. **Installation Steps:**
   - Run the downloaded `.msi` file as Administrator
   - Choose **Complete** installation type
   - ✅ Check "Install MongoDB as a Service"
   - ✅ Check "Install MongoDB Compass" (optional GUI tool)
   - Complete the installation

### Step 2: Verify Installation

```bash
# Check if MongoDB service is running
sc query MongoDB

# Start MongoDB service if not running
net start MongoDB

# Check MongoDB connection
mongosh --eval "db.adminCommand('ismaster')"
```

### Step 3: Test Connection

Start your ParkTayo backend server - it should now connect to MongoDB:

```bash
cd parktayo-backend
npm start
```

You should see: `🍃 MongoDB Connected: localhost:27017`

---

## Option 2: MongoDB Atlas (Cloud Database)

### Step 1: Create Free Atlas Account

1. Go to [MongoDB Atlas](https://cloud.mongodb.com/v2/signup)
2. Sign up for a free account
3. Create a new project called "ParkTayo"

### Step 2: Create Database Cluster

1. Click "Build a Database"
2. Choose **FREE** tier (M0 Sandbox)
3. Select a cloud provider and region (closest to you)
4. Name your cluster: `parktayo-cluster`
5. Click "Create Cluster"

### Step 3: Configure Database Access

1. **Database User:**
   - Go to Database Access → Add New Database User
   - Username: `parktayo-admin`
   - Password: Generate strong password (save it!)
   - Database User Privileges: Atlas admin

2. **Network Access:**
   - Go to Network Access → Add IP Address
   - Click "Add Current IP Address" or "Allow Access from Anywhere" (0.0.0.0/0)

### Step 4: Get Connection String

1. Go to Databases → Connect → Connect your application
2. Copy the connection string (looks like):
   ```
   mongodb+srv://parktayo-admin:<password>@parktayo-cluster.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
3. Replace `<password>` with your actual password

### Step 5: Update Environment Variables

Create `.env` file in `parktayo-backend/`:

```env
NODE_ENV=development
PORT=5000
JWT_SECRET=your-super-secret-jwt-key-that-should-be-at-least-32-characters-long
JWT_EXPIRES_IN=7d
MONGODB_URI=mongodb+srv://parktayo-admin:YOUR_PASSWORD@parktayo-cluster.xxxxx.mongodb.net/parktayo?retryWrites=true&w=majority
```

---

## Option 3: Docker MongoDB (Quick Setup)

If you have Docker installed:

```bash
# Run MongoDB in Docker container
docker run -d --name mongodb -p 27017:27017 mongo:7.0

# MongoDB will be available at mongodb://localhost:27017
```

---

## Testing the Setup

Once MongoDB is running, test your ParkTayo backend:

### 1. Start the server:
```bash
cd parktayo-backend
npm start
```

### 2. Test endpoints:
```bash
# Health check
curl -X GET http://localhost:5000/health

# Test account login
curl -X POST http://localhost:5000/api/v1/auth/test-login -H "Content-Type: application/json"

# Create seed data
curl -X POST http://localhost:5000/api/v1/parking-spaces/seed
```

### 3. Expected output:
- ✅ Server starts without MongoDB timeout errors
- ✅ `🍃 MongoDB Connected` message appears
- ✅ No duplicate index warnings
- ✅ API endpoints work correctly

---

## Troubleshooting

### Common Issues:

1. **MongoDB service not starting:**
   ```bash
   # Check Windows services
   services.msc
   # Find "MongoDB" and start it
   ```

2. **Connection timeouts:**
   - Check if MongoDB service is running
   - Verify port 27017 is not blocked by firewall
   - For Atlas: Check network access settings

3. **Authentication errors:**
   - Verify username/password for Atlas
   - Check connection string format
   - Ensure database user has proper permissions

### Verification Commands:

```bash
# Check if MongoDB is listening on port 27017
netstat -an | findstr 27017

# Test direct MongoDB connection
mongosh "mongodb://localhost:27017/parktayo"

# Check MongoDB logs (if installed as service)
# Look in Windows Event Viewer → Windows Logs → Application
```

---

## Next Steps

After MongoDB is set up:

1. **Create sample data:**
   ```bash
   curl -X POST http://localhost:5000/api/v1/parking-spaces/seed
   ```

2. **Test all endpoints:**
   ```bash
   # Run the comprehensive test script
   test-api.bat
   ```

3. **Connect from Flutter app:**
   - Update Flutter app's API base URL if needed
   - Test authentication and data fetching

Choose the option that works best for your development environment! 