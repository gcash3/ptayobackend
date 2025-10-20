# Admin Account Creation Scripts

This directory contains scripts to create admin accounts for the ParkTayo backend system.

## 🎯 Purpose

These scripts allow you to create admin user accounts in your MongoDB database for the ParkTayo application. Admin accounts have full access to the admin panel and can manage users, parking spaces, bookings, and system settings.

## 📁 Files

- **`create-admin.js`** - Main Node.js script that creates admin accounts
- **`create-admin.bat`** - Windows batch file wrapper
- **`create-admin.sh`** - Unix/Linux/macOS shell script wrapper
- **`README.md`** - This documentation

## 🚀 Quick Start

### Windows Users

```batch
# Navigate to the backend directory
cd parktayo-backend

# Run the batch script (easiest method)
scripts\create-admin.bat

# Or run directly with Node.js
node scripts\create-admin.js
```

### macOS/Linux Users

```bash
# Navigate to the backend directory
cd parktayo-backend

# Run the shell script (easiest method)
./scripts/create-admin.sh

# Or run directly with Node.js
node scripts/create-admin.js
```

## ⚙️ Configuration

### Environment Variables

Make sure your `.env` file is configured with:

```env
MONGODB_URI=mongodb://localhost:27017/parktayo_db
# or for MongoDB Atlas:
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/parktayo_db
```

### Default Admin Credentials

If you run the script without parameters, it creates an admin with:

- **Email**: `admin@parktayo.com`
- **Password**: `AdminPass123!`
- **Name**: `Admin User`
- **Phone**: `+639123456789`
- **Role**: `admin`

## 📋 Usage Examples

### Create Admin with Default Credentials

```bash
node scripts/create-admin.js
```

### Create Admin with Custom Credentials

```bash
node scripts/create-admin.js \
  --email john.doe@parktayo.com \
  --password "MySecurePassword123!" \
  --firstName John \
  --lastName Doe \
  --phoneNumber "+639987654321"
```

### Available Options

| Option        | Description           | Default Value          |
|---------------|-----------------------|------------------------|
| `--email`     | Admin email address   | `admin@parktayo.com`   |
| `--password`  | Admin password        | `AdminPass123!`        |
| `--firstName` | Admin first name      | `Admin`                |
| `--lastName`  | Admin last name       | `User`                 |
| `--phoneNumber` | Admin phone number  | `+639123456789`        |

### Help Command

```bash
node scripts/create-admin.js --help
```

## 🔒 Password Requirements

Admin passwords must meet these security requirements:

- ✅ At least 8 characters long
- ✅ Contains at least one uppercase letter (A-Z)
- ✅ Contains at least one lowercase letter (a-z)
- ✅ Contains at least one number (0-9)
- ✅ Contains at least one special character (!@#$%^&*(),.?":{}|<>)

**Examples of valid passwords:**
- `AdminPass123!`
- `MySecure@Password1`
- `P@rkTayo2024!`

## 🛠️ Prerequisites

### 1. MongoDB Setup

Ensure MongoDB is running:

**Local MongoDB:**
```bash
# Windows
net start MongoDB

# macOS (Homebrew)
brew services start mongodb-community

# Linux (systemctl)
sudo systemctl start mongod
```

**MongoDB Atlas:**
- Make sure your cluster is running
- Update `MONGODB_URI` with your Atlas connection string

### 2. Dependencies

```bash
cd parktayo-backend
npm install
```

### 3. Environment File

Copy and configure your environment file:

```bash
cp env.example .env
# Edit .env with your MongoDB connection details
```

## 🔍 Troubleshooting

### Common Issues

**1. "Database connection failed: ECONNREFUSED"**
```
Solution: Make sure MongoDB is running
- Windows: net start MongoDB
- macOS: brew services start mongodb-community
- Linux: sudo systemctl start mongod
```

**2. "Admin user already exists"**
```
Solution: The script will prompt to update the password, or use a different email
```

**3. "Password validation failed"**
```
Solution: Use a stronger password that meets all requirements
```

**4. "MongoDB URI not provided"**
```
Solution: Set MONGODB_URI in your .env file
```

### Debug Mode

To see detailed connection information, set debug mode:

```bash
DEBUG=* node scripts/create-admin.js
```

## 🔐 Security Notes

1. **Change Default Credentials**: Always change the default admin password in production
2. **Secure Storage**: Store admin credentials securely (use a password manager)
3. **Regular Updates**: Periodically update admin passwords
4. **Access Monitoring**: Monitor admin account usage in production
5. **Backup Database**: Always backup your database before running scripts

## 📱 Testing Admin Access

After creating an admin account, test it by:

### 1. API Login Test

```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@parktayo.com",
    "password": "AdminPass123!"
  }'
```

### 2. Admin Panel Access

1. Start your admin frontend: `cd parktayoadmin && npm start`
2. Navigate to: `http://localhost:3000`
3. Login with your admin credentials

## 🏗️ Database Schema

The script creates a user with this structure:

```javascript
{
  _id: ObjectId,
  firstName: String,
  lastName: String,
  email: String (unique),
  phoneNumber: String,
  password: String (hashed),
  role: "admin",
  profilePicture: null,
  isEmailVerified: true,
  active: true,
  createdAt: Date,
  updatedAt: Date,
  lastLogin: null
}
```

## 🔄 Updating Existing Admin

If an admin user already exists, the script will:

1. Detect the existing user
2. Prompt whether to update the password
3. Update only the password and `updatedAt` timestamp if confirmed

## 🆘 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Verify your MongoDB connection
3. Ensure all dependencies are installed
4. Check the console output for specific error messages
5. Review your `.env` configuration

## 📝 Example Output

```
🔧 ParkTayo Admin Account Creation Script

ℹ Configuration:
  Email: admin@parktayo.com
  Name: Admin User
  Phone: +639123456789

ℹ Connecting to MongoDB: mongodb://localhost:27017/parktayo_db
✅ Connected to MongoDB: localhost
ℹ Database: parktayo_db
ℹ Checking if admin user already exists...
ℹ Creating new admin user...
✅ Admin user created successfully!

==================================================
🔧 ADMIN ACCOUNT CREATED
==================================================
ID:         65f8a1b2c3d4e5f6a7b8c9d0
Name:       Admin User
Email:      admin@parktayo.com
Phone:      +639123456789
Role:       admin
Password:   AdminPass123!
Verified:   Yes
Active:     Yes
Created:    2024-01-15T10:30:45.123Z
==================================================

⚠️ IMPORTANT: Save these credentials securely!
ℹ You can now use these credentials to login to the admin panel
ℹ API Endpoint: POST /api/v1/auth/login

ℹ Database connection closed
```
