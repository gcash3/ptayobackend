# ParkTayo Notification System

## Overview

The ParkTayo notification system is a comprehensive solution that handles real-time notifications, push notifications via Firebase Cloud Messaging (FCM), email notifications, and in-app notifications. It's designed to keep users informed about bookings, parking space approvals, payments, and system updates.

## Features

### 📱 Multi-Channel Notifications
- **In-App Notifications**: Real-time updates via Socket.IO
- **Push Notifications**: Mobile push notifications via Firebase Cloud Messaging
- **Email Notifications**: Important updates via email
- **SMS Notifications**: Critical alerts (future implementation)

### 🎯 Notification Categories
- **Booking**: Confirmations, reminders, status updates
- **Payment**: Payment confirmations, receipts, payout notifications
- **Space**: Approval/rejection notifications for parking spaces
- **Account**: Profile updates, verification status
- **System**: Maintenance notices, security alerts
- **Marketing**: Promotions, new features (optional)

### 🔧 User Preferences
Users can customize their notification preferences by category:
```json
{
  "booking": true,
  "payment": true,
  "space": true,
  "account": true,
  "system": true,
  "marketing": false
}
```

## Architecture

### Models

#### Notification Model
```javascript
{
  recipientId: ObjectId,
  recipientType: 'client' | 'landlord' | 'admin',
  title: String,
  message: String,
  type: String, // booking_confirmed, space_approved, etc.
  category: String, // booking, payment, space, etc.
  priority: 'low' | 'medium' | 'high' | 'urgent',
  channels: {
    inApp: { enabled, delivered, read, timestamps },
    push: { enabled, delivered, attempts, errors },
    email: { enabled, delivered, attempts, errors },
    sms: { enabled, delivered, attempts, errors }
  },
  actionData: {
    actionType: 'none' | 'approve' | 'view' | 'pay',
    actionUrl: String,
    actionPayload: Object
  },
  metadata: {
    imageUrl: String,
    deepLink: String,
    customData: Object
  },
  status: 'pending' | 'sent' | 'delivered' | 'failed'
}
```

#### User Device Tokens
```javascript
{
  deviceTokens: [{
    fcmToken: String,
    deviceId: String,
    platform: 'ios' | 'android' | 'web',
    appVersion: String,
    isActive: Boolean,
    lastUsed: Date
  }]
}
```

### Services

#### NotificationService
Main orchestrator for all notification types:
- `sendNotification(recipientId, notificationData, options)`
- `sendTemplatedNotification(recipientId, templateKey, templateData)`
- `sendSpaceApprovalNotification(landlordId, parkingSpace, adminId)`
- `sendBookingConfirmationNotification(clientId, booking, parkingSpace)`

#### FirebaseNotificationService
Handles push notifications via FCM:
- `sendToDevice(fcmToken, notification, data)`
- `sendToMultipleDevices(fcmTokens, notification, data)`
- `sendToUser(userId, notification, data)`
- `broadcastToUserType(userType, notification, data)`

## API Endpoints

### Notification Management
```http
GET /api/v1/notifications
GET /api/v1/notifications/unread-count
GET /api/v1/notifications/:id
PATCH /api/v1/notifications/:id/read
PATCH /api/v1/notifications/mark-all-read
DELETE /api/v1/notifications/:id
```

### Notification Preferences
```http
GET /api/v1/notifications/preferences/settings
PATCH /api/v1/notifications/preferences/settings
```

### FCM Token Management
```http
POST /api/v1/auth/fcm-token
DELETE /api/v1/auth/fcm-token/:deviceId
```

### Admin Broadcasting
```http
POST /api/v1/notifications/broadcast
```

## Real-Time Updates

### Socket.IO Events

#### Client Events
```javascript
// Join user room for notifications
socket.emit('join_user_room', userId);

// Join landlord room for booking notifications
socket.emit('join_landlord_room', landlordId);
```

#### Server Events
```javascript
// New notification received
socket.on('new_notification', (notification) => {
  // Handle new notification
});

// Booking status update
socket.on('booking_status_update', (booking) => {
  // Handle booking update
});

// Landlord-specific notifications
socket.on('landlord_notification', (notification) => {
  // Handle landlord notification
});

// Admin notifications
socket.on('admin_notification', (notification) => {
  // Handle admin notification
});

// Space approval/rejection
socket.on('space_approved', (data) => {
  // Handle space approval
});

socket.on('space_rejected', (data) => {
  // Handle space rejection
});
```

## Firebase Setup

### 1. Create Firebase Project
1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Create a new project
3. Enable Cloud Messaging

### 2. Generate Service Account Key
1. Go to Project Settings > Service Accounts
2. Generate new private key
3. Download the JSON file

### 3. Environment Variables
```bash
# Option 1: Individual fields
FIREBASE_PROJECT_ID=your_project_id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxx@your-project.iam.gserviceaccount.com

# Option 2: Full JSON (preferred)
FIREBASE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"..."}'
```

## Mobile App Integration

### Flutter (Client & Landlord Apps)

#### 1. Add Firebase Dependencies
```yaml
dependencies:
  firebase_core: ^2.15.0
  firebase_messaging: ^14.6.5
```

#### 2. Initialize Firebase
```dart
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await Firebase.initializeApp();
  runApp(MyApp());
}
```

#### 3. Get FCM Token
```dart
class NotificationService {
  final FirebaseMessaging _messaging = FirebaseMessaging.instance;
  
  Future<String?> getFCMToken() async {
    return await _messaging.getToken();
  }
  
  Future<void> registerToken() async {
    final token = await getFCMToken();
    final deviceId = await _getDeviceId();
    
    // Send to backend
    await ApiService.addFCMToken(
      fcmToken: token,
      deviceId: deviceId,
      platform: Platform.isIOS ? 'ios' : 'android',
      appVersion: await _getAppVersion(),
    );
  }
}
```

#### 4. Handle Notifications
```dart
void setupNotificationHandling() {
  // Foreground messages
  FirebaseMessaging.onMessage.listen((RemoteMessage message) {
    _showLocalNotification(message);
  });
  
  // Background/terminated app notifications
  FirebaseMessaging.onMessageOpenedApp.listen((RemoteMessage message) {
    _handleNotificationTap(message);
  });
  
  // App launched from notification
  FirebaseMessaging.instance.getInitialMessage().then((message) {
    if (message != null) {
      _handleNotificationTap(message);
    }
  });
}
```

### React (Admin Panel)

#### 1. Install Firebase SDK
```bash
npm install firebase
```

#### 2. Initialize Firebase
```javascript
import { initializeApp } from 'firebase/app';
import { getMessaging, getToken, onMessage } from 'firebase/messaging';

const firebaseConfig = { /* your config */ };
const app = initializeApp(firebaseConfig);
const messaging = getMessaging(app);
```

#### 3. Request Permission & Get Token
```javascript
async function requestNotificationPermission() {
  const permission = await Notification.requestPermission();
  if (permission === 'granted') {
    const token = await getToken(messaging, {
      vapidKey: 'your-vapid-key'
    });
    // Send token to backend
    await fetch('/api/v1/auth/fcm-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fcmToken: token,
        deviceId: 'web-' + Date.now(),
        platform: 'web'
      })
    });
  }
}
```

## Notification Templates

### Predefined Templates
```javascript
const templates = {
  space_approved: {
    title: 'Parking Space Approved! 🎉',
    message: 'Your parking space "{spaceName}" has been approved and is now live!',
    category: 'space',
    priority: 'high'
  },
  
  booking_confirmed: {
    title: 'Booking Confirmed! 🚗',
    message: 'Your parking booking at {spaceName} is confirmed for {date}.',
    category: 'booking',
    priority: 'high'
  },
  
  payment_received: {
    title: 'Payment Received 💰',
    message: 'You received ₱{amount} for your parking space booking.',
    category: 'payment',
    priority: 'medium'
  }
};
```

### Custom Notifications
```javascript
await notificationService.sendNotification(userId, {
  title: 'Custom Notification',
  message: 'This is a custom message',
  type: 'custom_type',
  category: 'system',
  priority: 'medium',
  actionData: {
    actionType: 'view',
    actionText: 'View Details',
    actionUrl: '/details/123'
  }
});
```

## Testing

### Test Endpoints
```bash
# Send test notification
curl -X POST http://localhost:5000/api/v1/notifications/test \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"type": "test"}'

# Get notifications
curl -X GET http://localhost:5000/api/v1/notifications \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Admin broadcast
curl -X POST http://localhost:5000/api/v1/notifications/broadcast \
  -H "Authorization: Bearer ADMIN_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "System Maintenance",
    "message": "Scheduled maintenance tonight",
    "type": "maintenance_notice",
    "category": "system"
  }'
```

## Error Handling

### Invalid FCM Tokens
The system automatically handles invalid FCM tokens:
- Detects invalid tokens during send operations
- Removes invalid tokens from user records
- Logs errors for monitoring

### Delivery Failures
- Retry mechanism for failed deliveries
- Maximum 3 retry attempts per channel
- Fallback to alternative channels
- Comprehensive error logging

## Monitoring & Analytics

### Metrics to Track
- Notification delivery rates by channel
- User engagement with notifications
- Failed delivery reasons
- Popular notification types
- User preference trends

### Logging
```javascript
// Success
logger.info('Notification sent successfully', {
  notificationId,
  recipientId,
  type,
  channels: ['push', 'inApp']
});

// Failure
logger.error('Notification delivery failed', {
  notificationId,
  error: error.message,
  channel: 'push'
});
```

## Best Practices

### 1. User Experience
- Respect user preferences
- Don't overwhelm with notifications
- Use appropriate priority levels
- Provide clear action buttons

### 2. Performance
- Batch notifications when possible
- Use database indexes effectively
- Clean up expired notifications
- Monitor FCM quota usage

### 3. Security
- Validate all notification data
- Sanitize user inputs
- Use secure FCM tokens
- Implement rate limiting

### 4. Reliability
- Handle network failures gracefully
- Implement retry mechanisms
- Use dead letter queues for failed notifications
- Monitor delivery rates

## Troubleshooting

### Common Issues

#### 1. FCM Token Not Working
```bash
# Check token validity
curl -X POST https://fcm.googleapis.com/v1/projects/YOUR_PROJECT/messages:send \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"validate_only": true, "message": {"token": "YOUR_FCM_TOKEN"}}'
```

#### 2. Notifications Not Received
- Check user notification preferences
- Verify FCM token is active
- Check app is not in battery optimization
- Verify Firebase project configuration

#### 3. Socket.IO Connection Issues
- Check CORS settings
- Verify user is joining correct rooms
- Monitor connection logs
- Check firewall settings

## Future Enhancements

### 1. SMS Notifications
- Integrate Twilio for SMS
- Add phone number verification
- Implement SMS templates

### 2. Rich Notifications
- Add images and media
- Interactive notification buttons
- Custom notification sounds

### 3. Analytics Dashboard
- Notification performance metrics
- User engagement analytics
- A/B testing for notification content

### 4. Intelligent Notifications
- Smart scheduling based on user activity
- Personalized notification content
- Machine learning for optimal timing

## License

This notification system is part of the ParkTayo platform and follows the project's licensing terms. 