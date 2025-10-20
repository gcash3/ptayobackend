# 🔐 Admin Account Setup Guide

## Quick Start (TL;DR)

```bash
# 1. Navigate to backend directory
cd parktayo-backend

# 2. Install dependencies (if not already done)
npm install

# 3. Create admin account with default credentials
node scripts/create-admin.js

# 4. Login credentials:
# Email: admin@parktayo.com
# Password: AdminPass123!
```

## 📋 What You Get

After running the script, you'll have:

✅ **Admin Account Created** in MongoDB  
✅ **Email**: `admin@parktayo.com`  
✅ **Password**: `AdminPass123!`  
✅ **Role**: `admin` (full access)  
✅ **Email Verified**: `true`  
✅ **Account Active**: `true`  

## 🚀 Usage Options

### Option 1: Default Admin (Recommended for Development)
```bash
node scripts/create-admin.js
```

### Option 2: Custom Admin
```bash
node scripts/create-admin.js \
  --email your-email@company.com \
  --password "YourSecurePassword123!" \
  --firstName "Your" \
  --lastName "Name"
```

### Option 3: Windows Batch Script
```batch
scripts\create-admin.bat
```

### Option 4: Unix Shell Script
```bash
./scripts/create-admin.sh
```

## 📱 Testing Your Admin Account

### 1. Via API (cURL)
```bash
curl -X POST http://localhost:5000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@parktayo.com",
    "password": "AdminPass123!"
  }'
```

### 2. Via Admin Panel
1. Start admin frontend: `cd parktayoadmin && npm start`
2. Open: `http://localhost:3000`
3. Login with admin credentials

## ⚙️ Prerequisites

### 1. MongoDB Running
**Windows:**
```batch
net start MongoDB
```

**macOS:**
```bash
brew services start mongodb-community
```

**Linux:**
```bash
sudo systemctl start mongod
```

### 2. Environment File
Create `.env` in `parktayo-backend/` with:
```env
MONGODB_URI=mongodb://localhost:27017/parktayo_db
```

### 3. Dependencies Installed
```bash
cd parktayo-backend
npm install
```

## 🔒 Security Notes

⚠️ **IMPORTANT**: Change the default password in production!

The default credentials are:
- **Development**: `admin@parktayo.com` / `AdminPass123!`
- **Production**: Use custom secure credentials

## 🛠️ Troubleshooting

| Issue | Solution |
|-------|----------|
| `ECONNREFUSED` | Start MongoDB service |
| `MODULE_NOT_FOUND` | Run `npm install` in backend directory |
| `Admin already exists` | Script will prompt to update password |
| `Password validation failed` | Use stronger password (8+ chars, mixed case, numbers, symbols) |

## 📁 Script Files

- `scripts/create-admin.js` - Main Node.js script
- `scripts/create-admin.bat` - Windows batch wrapper
- `scripts/create-admin.sh` - Unix shell wrapper
- `scripts/README.md` - Detailed documentation

## 🎯 What's Next?

After creating your admin account:

1. ✅ **Test Login** via API or admin panel
2. ✅ **Change Password** in production
3. ✅ **Create Additional Admins** if needed
4. ✅ **Start Managing** users, spaces, and bookings

## 📞 Need Help?

Check the detailed documentation in `scripts/README.md` for:
- Complete usage examples
- Advanced configuration
- Troubleshooting guide
- Security best practices
