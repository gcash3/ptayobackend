# 🚀 **Smart Booking Comprehensive Solution**

## 📋 **Current Problem & Solution Overview**

### **The Issue**
- Smart booking still uses fixed duration concepts from traditional booking
- Frontend expects to set duration/time manually
- Backend calculates based on ETA + 15min, but doesn't track actual parking duration dynamically

### **The Solution**
Complete separation of **booking window** (ETA-based) from **parking duration** (usage-based).

---

## 🔄 **Smart Booking Flow - Complete Redesign**

### **Phase 1: Booking Creation (ETA-Based Window)**
```
User clicks "Book Now" → Smart Analysis:
├── 📍 Current Location: User's GPS
├── 🎯 Destination: Parking Space GPS  
├── 🗺️ Google Maps API: Calculate ETA (e.g., 20 minutes)
├── ⏰ Grace Period: +15 minutes
└── 📅 Booking Window: Now → ETA + 15min (35 minutes total)

Booking Created:
├── status: 'accepted' (auto-approved for smart booking)
├── startTime: now
├── endTime: now + ETA + 15min (booking window end)
├── bookingMode: 'book_now'
├── arrivalPrediction: { realETAMinutes: 20, gracePeriodMinutes: 15 }
└── actualParkingDuration: null (to be calculated later)
```

### **Phase 2: Arrival & Check-in (Status Transition)**
```
User arrives at parking space → Status Changes:
├── Booking status: 'accepted' → 'parked'
├── Parking start time: recorded (actual arrival time)
├── Real-time tracking: activated
└── Duration calculation: starts counting from this moment
```

### **Phase 3: Parking Duration Calculation (Usage-Based)**
```
While parked (status = 'parked'):
├── ⏱️ Parking Duration: Time since status changed to 'parked'
├── 📊 Real-time Updates: Every location update recalculates duration
├── 💰 Overtime Calculation: If duration > original booking window
└── 🔔 Notifications: Approaching end of booking window
```

### **Phase 4: Checkout & Final Billing**
```
User checks out → Final Calculation:
├── Total Parking Time: From 'parked' status start to checkout
├── Actual Parking Duration: e.g., 3 hours 30 minutes
├── Base Rate: Applied to actual parking time (e.g., ₱50 for first 3 hours)
├── Overtime: If > 3 hours, charge for additional 30 minutes
└── Final Bill: Base rate + Overtime charges (NO navigation time charged)
```

---

## 🏗️ **Backend Implementation Changes**

### **1. Update Booking Model**
```javascript
// Add new fields to Booking schema
const bookingSchema = new mongoose.Schema({
  // ... existing fields ...
  
  // Smart booking specific fields
  bookingMode: {
    type: String,
    enum: ['reservation', 'book_now'],
    default: 'reservation'
  },
  
  // Booking window (ETA-based) vs Actual parking duration (usage-based)
  bookingWindow: {
    estimatedDurationMinutes: Number, // ETA + grace period
    actualArrivalTime: Date,
    windowEndTime: Date // endTime from ETA calculation
  },
  
  // Actual parking session (usage-based)
  parkingSession: {
    startTime: Date, // When status changed to 'parked'
    endTime: Date,   // When checked out
    actualDurationMinutes: Number, // Real parking time
    overtimeMinutes: Number, // actualDuration - bookingWindow
    isWithinWindow: Boolean // Whether checkout was within booking window
  },
  
  // ... rest of schema
});
```

### **2. Update Smart Booking Service**
```javascript
// parktayo-backend/src/services/smartBookingService.js

class SmartBookingService {
  
  /**
   * Create smart booking with ETA-based window
   */
  async createSmartBooking(params) {
    const { userCurrentLocation, parkingSpaceLocation, userId } = params;
    
    // 1. Calculate ETA using Google Maps
    const etaResult = await this.calculateETA(userCurrentLocation, parkingSpaceLocation);
    const etaMinutes = etaResult.durationInTraffic?.minutes || 30; // fallback
    const gracePeriod = 15; // minutes
    const totalWindow = etaMinutes + gracePeriod;
    
    // 2. Create booking with ETA-based window
    const booking = await Booking.create({
      userId,
      parkingSpaceId: params.parkingSpaceId,
      bookingMode: 'book_now',
      status: 'accepted', // Auto-approve smart bookings
      
      // Traditional booking times (for compatibility)
      startTime: new Date(),
      endTime: new Date(Date.now() + totalWindow * 60 * 1000),
      
      // Smart booking window
      bookingWindow: {
        estimatedDurationMinutes: totalWindow,
        windowEndTime: new Date(Date.now() + totalWindow * 60 * 1000)
      },
      
      // Arrival prediction
      arrivalPrediction: {
        realETAMinutes: etaMinutes,
        gracePeriodMinutes: gracePeriod,
        maxArrivalWindow: new Date(Date.now() + totalWindow * 60 * 1000),
        estimatedArrival: new Date(Date.now() + etaMinutes * 60 * 1000)
      },
      
      // Parking session (to be filled when parked)
      parkingSession: {
        startTime: null,
        endTime: null,
        actualDurationMinutes: null
      }
    });
    
    return booking;
  }
  
  /**
   * Handle arrival and start parking session
   */
  async startParkingSession(bookingId, arrivalLocation) {
    const booking = await Booking.findById(bookingId);
    
    if (booking.status !== 'accepted') {
      throw new Error('Booking must be in accepted status to start parking');
    }
    
    const now = new Date();
    
    // Update booking to parked status
    booking.status = 'parked';
    booking.bookingWindow.actualArrivalTime = now;
    booking.parkingSession.startTime = now;
    
    // Check if arrival is within window
    const isWithinWindow = now <= booking.bookingWindow.windowEndTime;
    booking.parkingSession.isWithinWindow = isWithinWindow;
    
    await booking.save();
    
    // Start real-time duration tracking
    this.startDurationTracking(bookingId);
    
    return booking;
  }
  
  /**
   * Calculate current parking duration (billing starts from 'parked' status only)
   */
  calculateCurrentDuration(booking) {
    if (booking.status !== 'parked' || !booking.parkingSession.startTime) {
      return { actualMinutes: 0, overtimeMinutes: 0 };
    }
    
    const now = new Date();
    const parkingStart = new Date(booking.parkingSession.startTime);
    const actualParkingMinutes = Math.floor((now - parkingStart) / (1000 * 60));
    
    // Billing is based on actual parking time, not booking window
    // Standard rate covers first 3 hours (180 minutes)
    const standardRateMinutes = 180; // 3 hours
    const overtimeMinutes = Math.max(0, actualParkingMinutes - standardRateMinutes);
    
    return {
      actualMinutes: actualParkingMinutes,
      overtimeMinutes,
      isOvertime: overtimeMinutes > 0,
      standardRateMinutes,
      // Note: booking window is NOT used for billing, only for arrival tracking
      bookingWindowMinutes: booking.bookingWindow.estimatedDurationMinutes
    };
  }
  
  /**
   * Process checkout with final duration calculation
   */
  async processCheckout(bookingId, checkoutLocation) {
    const booking = await Booking.findById(bookingId);
    
    if (booking.status !== 'parked') {
      throw new Error('Booking must be in parked status to checkout');
    }
    
    const now = new Date();
    const duration = this.calculateCurrentDuration(booking);
    
    // Update parking session
    booking.parkingSession.endTime = now;
    booking.parkingSession.actualDurationMinutes = duration.actualMinutes;
    booking.parkingSession.overtimeMinutes = duration.overtimeMinutes;
    
    // Calculate final pricing
    const finalPricing = await this.calculateFinalPricing(booking, duration);
    booking.pricing = { ...booking.pricing, ...finalPricing };
    
    // Update status
    booking.status = 'completed';
    
    await booking.save();
    
    return {
      booking,
      duration,
      finalPricing
    };
  }
  
  /**
   * Calculate final pricing based on actual parking usage (NOT booking window)
   */
  async calculateFinalPricing(booking, duration) {
    // Base rate for standard parking (e.g., ₱50 for first 3 hours)
    const standardRate = 50; // ₱50 for first 3 hours
    const standardHours = 3;
    
    const actualHours = duration.actualMinutes / 60;
    let totalAmount = 0;
    let overtimeAmount = 0;
    
    if (actualHours <= standardHours) {
      // Within standard rate period
      totalAmount = standardRate;
    } else {
      // Standard rate + overtime
      const overtimeHours = Math.ceil(actualHours - standardHours);
      const overtimeRate = 15; // ₱15 per hour
      overtimeAmount = overtimeHours * overtimeRate;
      totalAmount = standardRate + overtimeAmount;
    }
    
    return {
      standardRate,
      overtimeAmount,
      actualDurationMinutes: duration.actualMinutes,
      actualHours: Math.round(actualHours * 100) / 100, // Round to 2 decimals
      finalTotalAmount: totalAmount,
      breakdown: {
        // Navigation time is NOT billed
        navigationWindow: booking.bookingWindow.estimatedDurationMinutes, // For reference only
        actualParking: duration.actualMinutes, // This is what gets billed
        standardCovered: Math.min(duration.actualMinutes, standardHours * 60),
        overtime: duration.overtimeMinutes,
        overtimeRate: 15
      }
    };
  }
}
```

### **3. Update Booking Controller**
```javascript
// parktayo-backend/src/controllers/bookingController.js

/**
 * Start parking session (when user arrives)
 */
const startParkingSession = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const { arrivalLocation } = req.body;
    const userId = req.user.id;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking || booking.userId.toString() !== userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found or unauthorized'
      });
    }
    
    const updatedBooking = await smartBookingService.startParkingSession(
      bookingId, 
      arrivalLocation
    );
    
    res.status(200).json({
      status: 'success',
      message: 'Parking session started successfully',
      data: {
        booking: updatedBooking,
        parkingStarted: updatedBooking.parkingSession.startTime,
        estimatedWindow: updatedBooking.bookingWindow.estimatedDurationMinutes
      }
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};

/**
 * Get current parking duration
 */
const getCurrentParkingDuration = async (req, res) => {
  try {
    const { bookingId } = req.params;
    const userId = req.user.id;
    
    const booking = await Booking.findById(bookingId);
    
    if (!booking || booking.userId.toString() !== userId) {
      return res.status(404).json({
        status: 'error',
        message: 'Booking not found or unauthorized'
      });
    }
    
    const duration = smartBookingService.calculateCurrentDuration(booking);
    
    res.status(200).json({
      status: 'success',
      data: {
        bookingId,
        currentDuration: duration,
        status: booking.status,
        parkingStartTime: booking.parkingSession.startTime,
        estimatedEndTime: booking.bookingWindow.windowEndTime
      }
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: error.message
    });
  }
};
```

---

## 📱 **Frontend Implementation Changes**

### **1. Update Smart Booking Screen**
```dart
// Remove all duration/time selection UI (already done)
// Focus only on location preferences and ETA display

class SmartBookingScreen extends StatefulWidget {
  // ... existing code ...
  
  Widget _buildETAInfo(SmartBookingOption option) {
    return Container(
      padding: EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.blue.withOpacity(0.1),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('🎯 Smart Booking Window'),
          Text('ETA: ${option.etaMinutes ?? "Calculating..."} minutes'),
          Text('Grace Period: 15 minutes'),
          Text('Total Window: ${(option.etaMinutes ?? 0) + 15} minutes'),
          SizedBox(height: 8),
          Text(
            'Note: Your actual parking duration will be calculated from when you arrive.',
            style: TextStyle(fontSize: 12, color: Colors.grey[600])
          ),
        ],
      ),
    );
  }
}
```

### **2. Create Parking Session Screen**
```dart
// New screen to show during parking
class ParkingSessionScreen extends StatefulWidget {
  final String bookingId;
  
  @override
  _ParkingSessionScreenState createState() => _ParkingSessionScreenState();
}

class _ParkingSessionScreenState extends State<ParkingSessionScreen> {
  Timer? _durationTimer;
  Duration _currentDuration = Duration.zero;
  Duration _bookingWindow = Duration.zero;
  bool _isOvertime = false;
  
  @override
  void initState() {
    super.initState();
    _startDurationTracking();
  }
  
  void _startDurationTracking() {
    _durationTimer = Timer.periodic(Duration(seconds: 30), (timer) {
      _updateCurrentDuration();
    });
  }
  
  Future<void> _updateCurrentDuration() async {
    try {
      final response = await _apiService.getCurrentParkingDuration(widget.bookingId);
      if (response.success) {
        final data = response.data;
        setState(() {
          _currentDuration = Duration(minutes: data['currentDuration']['actualMinutes']);
          _bookingWindow = Duration(minutes: data['currentDuration']['bookingWindowMinutes']);
          _isOvertime = data['currentDuration']['isOvertime'];
        });
      }
    } catch (e) {
      print('Error updating duration: $e');
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: Text('Parking Session')),
      body: Padding(
        padding: EdgeInsets.all(16),
        child: Column(
          children: [
            // Current Duration Display
            _buildDurationCard(),
            
            // Overtime Warning (if applicable)
            if (_isOvertime) _buildOvertimeWarning(),
            
            // Checkout Button
            _buildCheckoutButton(),
          ],
        ),
      ),
    );
  }
  
  Widget _buildDurationCard() {
    final hours = _currentDuration.inHours;
    final minutes = _currentDuration.inMinutes % 60;
    
    return Card(
      child: Padding(
        padding: EdgeInsets.all(20),
        child: Column(
          children: [
            Text('Current Parking Duration', style: TextStyle(fontSize: 16)),
            SizedBox(height: 10),
            Text(
              '${hours}h ${minutes}m',
              style: TextStyle(
                fontSize: 32,
                fontWeight: FontWeight.bold,
                color: _isOvertime ? Colors.red : Colors.green
              ),
            ),
            SizedBox(height: 10),
            Text('Booking Window: ${_bookingWindow.inMinutes} minutes'),
            if (_isOvertime) Text(
              'Overtime: ${(_currentDuration.inMinutes - _bookingWindow.inMinutes)} minutes',
              style: TextStyle(color: Colors.red)
            ),
          ],
        ),
      ),
    );
  }
}
```

### **3. Update API Service**
```dart
// Add new API methods for smart booking
class ApiService {
  
  // Start parking session when user arrives
  Future<ApiResponse> startParkingSession(String bookingId, Map<String, double> location) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/bookings/$bookingId/start-parking'),
        headers: await _getHeaders(),
        body: jsonEncode({
          'arrivalLocation': {
            'latitude': location['latitude'],
            'longitude': location['longitude'],
          }
        }),
      );
      
      return ApiResponse.fromResponse(response);
    } catch (e) {
      return ApiResponse(success: false, message: e.toString());
    }
  }
  
  // Get current parking duration
  Future<ApiResponse> getCurrentParkingDuration(String bookingId) async {
    try {
      final response = await http.get(
        Uri.parse('$baseUrl/bookings/$bookingId/duration'),
        headers: await _getHeaders(),
      );
      
      return ApiResponse.fromResponse(response);
    } catch (e) {
      return ApiResponse(success: false, message: e.toString());
    }
  }
  
  // Process checkout with final billing
  Future<ApiResponse> processSmartCheckout(String bookingId, Map<String, double> location) async {
    try {
      final response = await http.post(
        Uri.parse('$baseUrl/bookings/$bookingId/checkout'),
        headers: await _getHeaders(),
        body: jsonEncode({
          'checkoutLocation': {
            'latitude': location['latitude'],
            'longitude': location['longitude'],
          }
        }),
      );
      
      return ApiResponse.fromResponse(response);
    } catch (e) {
      return ApiResponse(success: false, message: e.toString());
    }
  }
}
```

---

## 🔄 **Complete Smart Booking Flow Example**

### **Scenario: 20-minute ETA, 3.5-hour actual parking**

#### **Step 1: Booking Creation**
```
User Location: Mall entrance
Parking Space: 2km away
Google Maps ETA: 20 minutes
Grace Period: +15 minutes
Booking Window: 35 minutes total

Booking Created:
├── bookingMode: 'book_now'
├── status: 'accepted'
├── startTime: 2:00 PM
├── endTime: 2:35 PM (booking window end)
├── bookingWindow.estimatedDurationMinutes: 35
└── parkingSession.startTime: null (not parked yet)
```

#### **Step 2: User Arrives (2:25 PM)**
```
User arrives and confirms arrival in app
Status Changes:
├── status: 'accepted' → 'parked'
├── parkingSession.startTime: 2:25 PM
├── parkingSession.isWithinWindow: true (within 35-minute window)
└── Duration tracking: STARTS NOW
```

#### **Step 3: During Parking (Real-time Updates)**
```
3:00 PM: Parking Duration = 35 minutes (within 3-hour standard rate)
4:00 PM: Parking Duration = 95 minutes (within 3-hour standard rate)  
5:00 PM: Parking Duration = 155 minutes (within 3-hour standard rate)
5:25 PM: Parking Duration = 180 minutes (exactly 3 hours - standard rate limit)
5:45 PM: Parking Duration = 200 minutes (20 minutes overtime beyond 3-hour rate)

Note: The 35-minute booking window is just for arrival tracking, not billing!
```

#### **Step 4: Checkout (5:55 PM)**
```
User checks out
Final Calculation:
├── Actual Parking Duration: 3h 30m (210 minutes) ← ONLY THIS IS BILLED
├── Standard Rate Coverage: First 3 hours = ₱50
├── Overtime: 30 minutes (0.5 hours) beyond standard 3-hour rate
├── Overtime Charges: 1 hour × ₱15 = ₱15 (rounded up)
└── Final Bill: Standard ₱50 + Overtime ₱15 = ₱65

NOTE: The 35-minute navigation window is NOT charged!
```

---

## ✅ **Corrected Billing Logic**

### 🚨 **IMPORTANT: Navigation Time is NEVER Charged**

```
Booking Window (ETA + 15min) = NAVIGATION TIME = FREE
    ↓
Parking Duration (from 'parked' status) = ACTUAL USAGE = BILLED
```

### **Example Billing Breakdown**
- **Navigation Time**: 35 minutes (ETA 20min + 15min grace) = **₱0** ❌ NOT BILLED
- **Parking Time**: 3h 30m (actual usage) = **₱65** ✅ BILLED
  - Standard Rate: 3 hours = ₱50
  - Overtime: 30 minutes = ₱15 (rounded to 1 hour)

## ✅ **Benefits of This Approach**

1. **🎯 Accurate Billing**: Based on actual parking usage only
2. **🚀 Better UX**: No manual time selection, automatic ETA calculation  
3. **💰 Fair Pricing**: Pay only for parking time, not navigation time
4. **📊 Real-time Tracking**: Live parking duration updates and overtime warnings
5. **🔄 Flexible**: Handles both short and long parking sessions
6. **⚖️ Transparent**: Clear separation between navigation window and parking billing

---

## 🚀 **Implementation Priority**

1. **Phase 1**: Fix immediate error (DynamicPricingCard) ✅
2. **Phase 2**: Update backend booking model and services
3. **Phase 3**: Create parking session tracking APIs
4. **Phase 4**: Update frontend to show ETA-based booking window
5. **Phase 5**: Create parking session screen with real-time duration
6. **Phase 6**: Implement final checkout with usage-based billing

This approach completely separates the **booking reservation window** (ETA-based) from the **actual parking duration** (usage-based), providing a much more accurate and fair smart booking system! 🎉
