# User Model Separation & Wallet Fix Implementation

## Overview
This implementation addresses two critical issues:
1. **Immediate wallet referenceId errors** causing admin panel failures
2. **Long-term architecture improvement** with separate user models

## Changes Made

### 1. Wallet Model Fixes 🔧

**Problem**: `transactions.referenceId 'null' already exists` error
**Root Cause**: Multiple referenceId generation points causing race conditions

**Solutions Implemented**:
- ✅ Centralized referenceId generation with `generateReferenceId()` function
- ✅ Removed redundant pre-save hooks that caused conflicts
- ✅ Added retry logic for duplicate referenceId errors
- ✅ Enhanced referenceId format for better uniqueness: `TXN-{timestamp}-{random}-{counter}`
- ✅ Added cleanup endpoint `/api/v1/wallet/cleanup` for fixing existing null referenceIds

**Files Modified**:
- `src/models/Wallet.js` - Fixed referenceId generation
- `src/controllers/walletController.js` - Added cleanup functionality
- `src/routes/wallet.js` - Added cleanup route

### 2. Flutter Client Fix 📱

**Problem**: `NoSuchMethodError: Class 'User' has no instance method '[]'`
**Root Cause**: User model expected array-like access for wallet balance

**Solution**:
- ✅ Enhanced `User.fromJson()` to handle multiple wallet balance sources
- ✅ Added fallback logic for different API response formats

**Files Modified**:
- `parktayoflutter/lib/models/user.dart` - Improved JSON parsing

### 3. Separate User Models Architecture 🏗️

**New Models Created**:

#### BaseUser Model (`src/models/BaseUser.js`)
- Common fields for all user types
- Shared authentication methods
- FCM token management
- Notification preferences
- Uses MongoDB discriminator pattern

#### Client Model (`src/models/Client.js`)
- Extends BaseUser
- Client-specific fields: `vehicleType`, `preferredUniversities`, `favoriteSpaces`
- Booking statistics and loyalty tiers
- Student information support

#### Landlord Model (`src/models/Landlord.js`)
- Extends BaseUser
- Verification system with ID upload support
- Earnings tracking and payout settings
- Business information and compliance
- Performance metrics

#### Admin Model (`src/models/Admin.js`)
- Extends BaseUser
- Permission-based access control
- Admin activity tracking
- Security features (2FA, IP whitelist)
- Department and role management

#### Unified Export (`src/models/UserModels.js`)
- Backward compatibility helpers
- Migration utilities
- Model selection based on user type

## Migration Strategy 📊

### Phase 1: Immediate (Completed)
- ✅ Fix wallet referenceId issues
- ✅ Fix Flutter User model
- ✅ Create new user models

### Phase 2: Gradual Migration (Next Steps)
1. **Test the new models** with existing data
2. **Run migration script** to convert legacy users
3. **Update controllers** to use new models gradually
4. **Update APIs** to support both old and new formats

### Phase 3: Complete Transition (Future)
1. Update all controllers to use new models
2. Update admin panel to use separate interfaces
3. Remove legacy User model
4. Clean up deprecated code

## Usage Examples

### Using New Models
```javascript
const { Client, Landlord, Admin } = require('./src/models/UserModels');

// Create a new client
const client = new Client({
  firstName: 'John',
  lastName: 'Doe',
  email: 'john@example.com',
  vehicleType: 'car',
  preferredUniversities: ['UP Diliman']
});

// Create a new landlord
const landlord = new Landlord({
  firstName: 'Jane',
  lastName: 'Smith',
  email: 'jane@example.com',
  businessInfo: {
    businessName: 'Smith Properties'
  }
});
```

### Backward Compatibility
```javascript
const { findUserById, findUserByEmail } = require('./src/models/UserModels');

// These functions work with both old and new models
const user = await findUserById(userId);
const userByEmail = await findUserByEmail(email);
```

## Testing

### Manual Testing Commands
```bash
# Test model imports
node -e "require('./src/models/BaseUser'); console.log('BaseUser OK');"
node -e "require('./src/models/Client'); console.log('Client OK');"
node -e "require('./src/models/Landlord'); console.log('Landlord OK');"
node -e "require('./src/models/Admin'); console.log('Admin OK');"

# Test wallet model
node -e "const {Wallet} = require('./src/models/Wallet'); console.log('Wallet OK');"
```

### Migration Script
```bash
node scripts/migrate-users.js
```

## Expected Results

### Immediate Fixes
- ✅ Admin panel wallet credit should work without referenceId errors
- ✅ Flutter app should load user wallet balance correctly
- ✅ No more `NoSuchMethodError` in Flutter client

### Long-term Benefits
- 🎯 **Type Safety**: Each user type has only relevant fields
- 📈 **Performance**: Smaller documents, better indexing
- 🔧 **Maintainability**: Easier to add type-specific features
- 🔒 **Security**: Clearer role-based access control
- 📊 **Analytics**: Better user segmentation and reporting

## Rollback Plan

If issues arise:
1. Revert `src/models/Wallet.js` to previous version
2. Revert `parktayoflutter/lib/models/user.dart` 
3. Remove new model files
4. Restart services

## Next Steps

### Immediate Actions Required:

1. **Restart Backend Server** to apply wallet fixes
2. **Fix Database Issues** by running cleanup scripts:
   ```bash
   node scripts/fix-wallet-references.js
   ```
3. **Test New Implementation**:
   ```bash
   node scripts/test-implementation.js
   ```
4. **Restart Flutter App** to get wallet balance fix

### Database Cleanup Required:

The current database has corrupted referenceId entries. You MUST run the cleanup script before the fixes will work:

```bash
cd parktayo-backend
node scripts/fix-wallet-references.js
```

### Complete Migration (Optional):

To fully migrate to separate user models:
```bash
node scripts/migrate-users.js
```

### Testing Commands:

```bash
# Test new models work
node scripts/test-implementation.js

# Test wallet functionality 
node -e "const {Wallet} = require('./src/models/Wallet'); console.log('Wallet model loaded successfully');"
```

## Files Created
- `src/models/BaseUser.js`
- `src/models/Client.js`
- `src/models/Landlord.js`
- `src/models/Admin.js`
- `src/models/UserModels.js`
- `scripts/migrate-users.js`
- `IMPLEMENTATION_SUMMARY.md`

## Files Modified
- `src/models/Wallet.js`
- `src/controllers/walletController.js`
- `parktayoflutter/lib/models/user.dart`
