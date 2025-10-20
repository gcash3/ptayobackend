# Vehicle Management System

## Overview
The ParkTayo Vehicle Management System allows users to register and manage their vehicles with KYC (Know Your Customer) verification. This system replaces the manual vehicle information entry during booking with a pre-registered vehicle selection system.

## Features

### Vehicle Registration
- **Simplified Vehicle Types**: Only `car` and `motorcycle` are supported
- **Vehicle Information**: Plate number, brand, model, color, and optional year
- **KYC Documents**: MVFile (Motor Vehicle File) upload for verification
- **Default Vehicle**: Users can set a default vehicle per type

### Vehicle Verification
- **Admin Approval**: Admins can verify or reject vehicles
- **Status Tracking**: Vehicles have statuses: `pending`, `verified`, `rejected`, `inactive`
- **Verification Notes**: Admins can add notes during verification

### Booking Integration
- **Vehicle Selection**: Users select from their verified vehicles during booking
- **Automatic Info**: Vehicle details are automatically populated
- **Usage Tracking**: System tracks vehicle usage statistics

## API Endpoints

### User Endpoints
```
GET    /api/v1/vehicles                    # Get user's vehicles
POST   /api/v1/vehicles                    # Add new vehicle
GET    /api/v1/vehicles/:id                # Get single vehicle
PUT    /api/v1/vehicles/:id                # Update vehicle
DELETE /api/v1/vehicles/:id                # Delete vehicle
POST   /api/v1/vehicles/:id/documents      # Upload MVFile
PATCH  /api/v1/vehicles/:id/default        # Set as default
```

### Admin Endpoints
```
GET    /api/v1/vehicles/admin/all          # Get all vehicles
PATCH  /api/v1/vehicles/admin/:id/verify   # Verify vehicle
PATCH  /api/v1/vehicles/admin/:id/reject   # Reject vehicle
```

## Database Schema

### Vehicle Model
```javascript
{
  userId: ObjectId,           // Owner of the vehicle
  plateNumber: String,        // Unique plate number
  vehicleType: String,        // 'car' or 'motorcycle'
  brand: String,              // Vehicle brand
  model: String,              // Vehicle model
  color: String,              // Vehicle color
  year: Number,               // Optional year
  documents: {
    mvFile: {
      url: String,            // Document URL
      uploadedAt: Date,       // Upload timestamp
      verified: Boolean,      // Verification status
      verifiedAt: Date,       // Verification timestamp
      verifiedBy: ObjectId    // Admin who verified
    }
  },
  status: String,             // 'pending', 'verified', 'rejected', 'inactive'
  verificationNotes: String,  // Admin notes
  totalBookings: Number,      // Usage statistics
  lastUsed: Date,             // Last booking date
  isDefault: Boolean          // Default vehicle flag
}
```

### Updated Booking Model
```javascript
{
  // ... existing fields ...
  vehicleInfo: {
    plateNumber: String,      // From vehicle record
    vehicleType: String,      // From vehicle record
    vehicleColor: String,     // From vehicle record
    vehicleModel: String      // From vehicle record (brand + model)
  }
}
```

## Flutter Integration

### Vehicle Model
```dart
class Vehicle {
  final String id;
  final String plateNumber;
  final String vehicleType;
  final String brand;
  final String model;
  final String color;
  final VehicleDocuments documents;
  final String status;
  final bool isDefault;
  // ... other fields
}
```

### API Service Methods
```dart
// Get user's vehicles
Future<ApiResponse<List<Vehicle>>> getUserVehicles({String? vehicleType})

// Add new vehicle
Future<ApiResponse<Vehicle>> addVehicle(CreateVehicleRequest request)

// Update vehicle
Future<ApiResponse<Vehicle>> updateVehicle(String vehicleId, UpdateVehicleRequest request)

// Delete vehicle
Future<ApiResponse<void>> deleteVehicle(String vehicleId)

// Upload documents
Future<ApiResponse<Vehicle>> uploadVehicleDocuments(String vehicleId, String mvFileUrl)

// Set default vehicle
Future<ApiResponse<Vehicle>> setDefaultVehicle(String vehicleId)
```

### Updated Booking Flow
```dart
// Old booking flow
final response = await _apiService.createBooking(
  vehicleType: 'car',
  vehicleDetails: {...}
);

// New booking flow
final response = await _apiService.createBooking(
  vehicleId: selectedVehicle.id,
  userNotes: notes
);
```

## Usage Examples

### 1. Register a Vehicle
```javascript
POST /api/v1/vehicles
{
  "plateNumber": "ABC123",
  "vehicleType": "car",
  "brand": "Toyota",
  "model": "Camry",
  "color": "Blue",
  "year": 2020,
  "isDefault": true
}
```

### 2. Upload MVFile
```javascript
POST /api/v1/vehicles/VEHICLE_ID/documents
{
  "mvFileUrl": "https://example.com/documents/mvfile.pdf"
}
```

### 3. Admin Verify Vehicle
```javascript
PATCH /api/v1/vehicles/admin/VEHICLE_ID/verify
{
  "notes": "Vehicle documents verified successfully"
}
```

### 4. Book with Vehicle
```javascript
POST /api/v1/bookings
{
  "parkingSpaceId": "SPACE_ID",
  "startTime": "2024-01-01T10:00:00Z",
  "endTime": "2024-01-01T12:00:00Z",
  "vehicleId": "VEHICLE_ID",
  "userNotes": "Optional booking notes"
}
```

## Benefits

1. **Improved UX**: Users don't need to re-enter vehicle details for each booking
2. **Data Consistency**: Vehicle information is standardized and validated
3. **KYC Compliance**: Document verification ensures legitimate users
4. **Admin Control**: Admins can verify and manage vehicles
5. **Usage Analytics**: Track vehicle usage patterns
6. **Simplified Types**: Only car and motorcycle reduce complexity

## Migration Notes

### Backend Changes
- Added Vehicle model and controller
- Updated Booking model to use vehicleId instead of vehicleInfo
- Added vehicle validation in booking creation
- Simplified vehicle types from 7 to 2

### Frontend Changes
- Added Vehicle model and API methods
- Updated booking flow to use vehicle selection
- Need to implement vehicle management UI screens

## TODO: Flutter UI Implementation

The following screens need to be implemented:

1. **Vehicle Management Screen** - List, add, edit, delete vehicles
2. **Vehicle Registration Screen** - Form to add new vehicles
3. **Vehicle KYC Screen** - Upload MVFile documents
4. **Vehicle Selection Screen** - Select vehicle during booking
5. **Vehicle Status Screen** - Show verification status

## Security Considerations

1. **Document Verification**: MVFile documents should be securely stored and verified
2. **Plate Number Uniqueness**: Ensure plate numbers are unique across the system
3. **User Authorization**: Users can only manage their own vehicles
4. **Admin Permissions**: Only admins can verify/reject vehicles
5. **Data Validation**: Strict validation on all vehicle data inputs 