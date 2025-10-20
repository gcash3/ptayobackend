# 📅 Comprehensive Booking Expiration Management System

## 🎯 Overview

This system replaces the simple 4-hour expiration window with a sophisticated, tiered approach that handles various booking expiration scenarios gracefully. Instead of blocking QR generation completely, it provides multiple resolution options for different expiration levels.

## 🔍 Problem Solved

**Before**: 
- ❌ Booking made on September 11, 2025, accessed on September 28, 2025 = "Booking has expired beyond checkout window"
- ❌ Complete blockage with no resolution options
- ❌ No way to handle legitimate delays

**After**:
- ✅ 4 resolution options provided for the 17-day delay scenario
- ✅ Clear charge calculations (₱908 extra charges)
- ✅ Multiple paths forward: manual checkout, mark abandoned, contact support, admin override
- ✅ Comprehensive logging and audit trail

## 🏗️ System Architecture

### 📊 Expiration Windows

| Window | Time Range | Action | Extra Charges | Description |
|--------|------------|--------|---------------|-------------|
| **STANDARD** | 0-4 hours | `allow` | None | Normal checkout window |
| **EXTENDED** | 4-24 hours | `allow_with_overtime` | ₱17/hour | Overtime charges apply |
| **LONG_TERM** | 1-7 days | `require_confirmation` | Overtime + ₱25/day penalty | Requires confirmation |
| **CRITICAL** | 7+ days | `manual_resolution` | Maximum penalties | Manual intervention required |

### 🔧 Resolution Options

| Option | Description | Availability | Requires Confirmation |
|--------|-------------|--------------|----------------------|
| **Generate with Overtime** | Allow QR with calculated charges | Extended, Long-term | Yes |
| **Manual Checkout** | Process checkout without QR | Extended, Long-term, Critical | Yes |
| **Mark as Abandoned** | Apply penalties and mark abandoned | Long-term, Critical | Yes |
| **Contact Support** | Escalate to customer service | All expired scenarios | No |
| **Admin Override** | Administrative resolution | Critical (Admin only) | Yes |

## 🛠️ Implementation Details

### Core Files

1. **`src/config/bookingExpiration.js`** - Configuration and calculation logic
2. **`src/services/bookingExpirationService.js`** - Business logic service
3. **`src/routes/bookingExpiration.js`** - API endpoints
4. **`src/controllers/qrCheckoutController.js`** - Enhanced QR generation logic

### API Endpoints

```
GET  /api/v1/booking-expiration/analyze/:bookingId     - Analyze expiration status
POST /api/v1/booking-expiration/resolve/:bookingId     - Execute resolution
GET  /api/v1/booking-expiration/options/:bookingId     - Get resolution options
GET  /api/v1/booking-expiration/summary                - Landlord summary
POST /api/v1/booking-expiration/bulk-analyze           - Bulk analysis
POST /api/v1/booking-expiration/admin-override/:id     - Admin override
```

## 📱 Usage Examples

### 1. Analyze Booking Expiration

```javascript
GET /api/v1/booking-expiration/analyze/66f2a4b4c45b4b001234567b
Authorization: Bearer <landlord_token>

Response:
{
  "status": "success",
  "data": {
    "expiration": {
      "status": "critical",
      "windowType": "CRITICAL",
      "canGenerate": false,
      "requiresConfirmation": true,
      "hoursSinceEnd": 400.32,
      "daysSinceEnd": 16.68,
      "charges": {
        "originalAmount": 150,
        "overtimeAmount": 408,
        "penaltyAmount": 500,
        "totalExtraCharges": 908,
        "finalAmount": 1058
      },
      "resolutionOptions": [
        {
          "id": "manual_checkout",
          "title": "Manual Checkout",
          "description": "Process checkout manually without QR code"
        }
      ]
    }
  }
}
```

### 2. Execute Resolution

```javascript
POST /api/v1/booking-expiration/resolve/66f2a4b4c45b4b001234567b
Authorization: Bearer <landlord_token>
Content-Type: application/json

{
  "resolutionId": "manual_checkout",
  "options": {
    "confirmed": true
  }
}

Response:
{
  "status": "success",
  "message": "Manual checkout completed successfully",
  "data": {
    "resolution": {
      "action": "manual_checkout_completed",
      "charges": { ... },
      "checkoutTime": "2025-09-28T10:19:11.702Z"
    }
  }
}
```

### 3. Enhanced QR Generation

```javascript
POST /api/v1/qr/generate/66f2a4b4c45b4b001234567b
Authorization: Bearer <landlord_token>

// If booking is expired, returns:
Status: 409 Conflict
{
  "status": "error",
  "error": "booking_expired",
  "message": "Booking expired 17 days ago. Manual resolution required.",
  "expirationStatus": "critical",
  "windowType": "CRITICAL",
  "charges": { ... },
  "resolutionOptions": [ ... ],
  "instructions": {
    "title": "Booking Expiration Resolution Required",
    "description": "Please choose a resolution option below.",
    "apiEndpoint": "/api/v1/booking-expiration/resolve/66f2a4b4c45b4b001234567b"
  }
}
```

## 🧪 Testing

### Run the September 11 → September 28 Test

```bash
node test_september_scenario.js
```

Expected output shows the system now provides 4 resolution options instead of blocking completely.

### Run Comprehensive Tests

```bash
# Update TEST_CONFIG in test_booking_expiration.js with real values
node test_booking_expiration.js --run
```

## 💰 Charge Calculations

### Overtime Charges
- **Rate**: ₱17/hour (₱15 base + ₱2 service fee)
- **Applied**: After 4-hour standard window
- **Cap**: 24 hours maximum for critical scenarios

### Penalty Charges
- **Rate**: ₱25/day for long-term expiration
- **Maximum**: ₱500 total penalty
- **Applied**: For bookings expired 1+ days

### Example Calculation (17-day delay)
```
Original Amount:     ₱150
Overtime (24h cap):  ₱408  (24h × ₱17)
Penalty (max):       ₱500  (capped at maximum)
Total Extra:         ₱908
Final Amount:        ₱1,058
```

## 🔐 Security Features

- **Authorization**: Landlord must own the parking space
- **Admin Controls**: Certain resolutions require admin privileges
- **Audit Trail**: All resolutions are logged with user, timestamp, and reason
- **Validation**: Comprehensive input validation and error handling
- **Rate Limiting**: Bulk operations are limited to prevent abuse

## 📊 Monitoring & Analytics

### Expiration Summary Dashboard
```javascript
GET /api/v1/booking-expiration/summary

Response:
{
  "summary": {
    "total": 15,
    "standard": 10,
    "extended": 3,
    "longTerm": 1,
    "critical": 1,
    "totalPotentialCharges": 1250
  }
}
```

### Key Metrics
- Track expiration patterns by landlord
- Monitor resolution option usage
- Calculate revenue from overtime/penalty charges
- Identify problematic bookings requiring intervention

## 🚀 Benefits

1. **Flexibility**: Multiple resolution paths instead of hard blocks
2. **Revenue Recovery**: Capture legitimate overtime and penalty fees
3. **Customer Service**: Clear options and escalation paths
4. **Audit Trail**: Complete logging for dispute resolution
5. **Scalability**: Handles edge cases gracefully
6. **User Experience**: Clear error messages with actionable solutions

## 🔄 Migration Notes

### Database Updates
The system adds new fields to bookings:
```javascript
{
  expiration: {
    resolvedAt: Date,
    resolutionMethod: String,
    extraCharges: Number,
    escalatedAt: Date,
    escalationTicket: String
  },
  abandonment: {
    markedAt: Date,
    reason: String,
    daysSinceEnd: Number
  },
  adminOverride: {
    performedAt: Date,
    reason: String,
    action: String
  }
}
```

### Backward Compatibility
- Existing QR generation still works for non-expired bookings
- Old error handling is enhanced, not replaced
- All existing endpoints remain functional

## 📞 Support & Troubleshooting

### Common Issues

1. **"Resolution option not available"**
   - Check booking status and expiration window
   - Verify user permissions (admin vs landlord)

2. **"Charge calculation seems wrong"**
   - Review expiration window configuration
   - Check if booking has existing overtime charges

3. **"Admin override not working"**
   - Ensure user has admin role
   - Verify admin token is valid

### Debug Information
All operations include comprehensive logging with:
- Booking ID and status
- User ID and role
- Expiration analysis results
- Resolution execution details
- Charge calculations

## 🎉 Success Story

**Before**: September 11 → September 28 scenario = Complete failure
**After**: September 11 → September 28 scenario = 4 resolution options with ₱908 calculated charges

The system transforms a complete failure into a manageable business scenario with multiple resolution paths and proper charge recovery.
