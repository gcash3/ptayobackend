# Cloudinary Configuration Analysis
## Based on .env Lines 37-42

---

## 📋 Configuration Variables (env.example Lines 37-42)

```bash
# Cloudinary Configuration (for image uploads)
CLOUDINARY_CLOUD_NAME=your_cloudinary_cloud_name
CLOUDINARY_API_KEY=your_cloudinary_api_key
CLOUDINARY_API_SECRET=your_cloudinary_api_secret
```

---

## 🏗️ Architecture Overview

The ParkTayo application uses **Cloudinary** as its primary cloud-based image storage and management solution. The system handles three main types of images:

1. **Receipt Images** - For wallet top-up verification
2. **Parking Space Images** - For landlord property listings
3. **ID Verification Photos** - For landlord identity verification

---

## 📁 Core Services

### 1. **cloudinaryService.js** 
**Location:** `src/services/cloudinaryService.js`

**Configuration:**
```javascript
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'parktayo',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});
```

**Key Methods:**
- `uploadImage(buffer, folder, fileName)` - Upload image from buffer
- `deleteImage(publicId)` - Delete image by public ID
- `getThumbnailUrl(publicId, width, height)` - Generate thumbnail URL
- `getOptimizedUrl(publicId, options)` - Get optimized image URL
- `getUploadMiddleware(fieldName)` - Create multer middleware for file uploads

**File Upload Limits:**
- Max file size: **5MB**
- Allowed formats: JPG, JPEG, PNG, GIF, WebP
- Storage: Memory (multer)

**Folder Structure:**
```
parktayo/
  ├── receipts/          # Receipt images
  ├── parking-spaces/    # Parking space photos
  └── id-verification/   # ID photos (front, back, selfie)
```

---

### 2. **imageUploadService.js**
**Location:** `src/services/imageUploadService.js`

**Configuration:**
```javascript
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dfv3pqaoq',
  api_key: process.env.CLOUDINARY_API_KEY || '947168936121835',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'p2q2nssSbSHZ35srWFA5Jiaoiwo',
});
```

**⚠️ SECURITY ISSUE:** This file has **hardcoded fallback credentials** which should be removed in production!

**Key Features:**
- Uses `multer-storage-cloudinary` for direct uploads
- Automatic image transformations:
  - Max dimensions: 1200×800
  - Quality: auto
  - Format: auto (WebP support)
- Dynamic public ID generation based on spaceId and timestamp

**File Upload Limits:**
- Max file size: **10MB**
- Max files per upload: **10 images**
- Allowed formats: JPG, JPEG, PNG, WebP, GIF

**Methods:**
- `uploadSingleImage(file, options)` - Upload one image
- `uploadMultipleImages(files, options)` - Upload multiple images
- `deleteImage(publicId)` - Delete image
- `generateThumbnailUrl(publicId, width, height)` - Generate thumbnail

---

## 🎯 Use Cases & Endpoints

### **1. Receipt Upload System**

#### **Flow:**
```
User → Mobile App → API → cloudinaryService → Cloudinary Cloud
                                      ↓
                              Receipt Model (MongoDB)
```

#### **API Endpoint:**
```
POST /api/v1/receipts/upload
Auth: Required (User)
```

#### **Files Involved:**
- **Route:** `src/routes/receipts.js`
- **Controller:** `src/controllers/receiptController.js`
- **Service:** `src/services/cloudinaryService.js`
- **Model:** `src/models/Receipt.js`

#### **Controller Method:** `uploadReceipt()`
**Location:** `receiptController.js` Lines 12-132

**Process:**
1. Validate user authentication
2. Validate form data (amount, mobileNumber, senderName)
3. Check if receipt image file exists
4. Upload to Cloudinary:
   ```javascript
   const fileName = `receipt-${userId}-${Date.now()}`;
   const uploadResult = await cloudinaryService.uploadImage(
     req.file.buffer,
     'receipts',
     fileName
   );
   ```
5. Generate thumbnail URL
6. Save receipt metadata to MongoDB:
   ```javascript
   receiptImage: {
     cloudinaryId: uploadResult.public_id,
     secureUrl: uploadResult.secure_url,
     thumbnailUrl: thumbnailUrl,
     originalName: req.file.originalname,
     size: uploadResult.bytes,
     format: uploadResult.format
   }
   ```
7. Return receipt details to client

**Error Handling:**
- File size limit: 5MB (returns 400 error)
- Invalid file type: Only images allowed
- Upload failure: Logs error and returns 500

---

### **2. Parking Space Image Upload**

#### **Flow:**
```
Landlord → Landlord App → API → imageUploadService → Cloudinary Cloud
                                      ↓
                           ParkingSpace Model (MongoDB)
```

#### **API Endpoint:**
```
POST /api/v1/landlord/spaces/:spaceId/images
Auth: Required (Landlord)
Max: 10 images per request
```

#### **Files Involved:**
- **Route:** `src/routes/landlord.js` Line 73-76
- **Controller:** `src/controllers/landlordController.js`
- **Service:** `src/services/imageUploadService.js`
- **Model:** `src/models/ParkingSpace.js`

#### **Controller Method:** `uploadSpaceImages()`
**Location:** `landlordController.js` Lines 393-494

**Process:**
1. Authenticate landlord
2. Validate parking space ownership
3. Check image limit (max 10 per space)
4. Upload images to Cloudinary with transformations:
   - Resize: 1200×800 (limit, maintains aspect ratio)
   - Quality: auto
   - Format: auto
5. Generate thumbnails (300×200)
6. Save image metadata to ParkingSpace document:
   ```javascript
   {
     url: result.secure_url,
     thumbnailUrl: cloudinary.url(result.public_id, {
       width: 300,
       height: 200,
       crop: 'fill',
       quality: 'auto',
       fetch_format: 'auto'
     }),
     publicId: result.public_id,
     uploadedAt: new Date(),
     isMain: images.length === 0 // First image is main
   }
   ```

**Image Deletion:**
```
DELETE /api/v1/landlord/spaces/:spaceId/images/:imageId
```
- Deletes from Cloudinary using `publicId`
- Removes from MongoDB array

---

### **3. ID Verification System**

#### **Flow:**
```
Landlord → App → API → imageUploadService → Cloudinary Cloud
                                ↓
                        User Model (idVerification field)
```

#### **API Endpoints:**
```
POST /api/v1/id-verification/submit
POST /api/v1/id-verification/submit-registration
```

**Required Files:**
- `front` - ID front photo
- `back` - ID back photo (optional for some IDs)
- `selfie` - Selfie with ID

#### **Files Involved:**
- **Route:** `src/routes/idVerification.js`
- **Controller:** `src/controllers/idVerificationController.js`
- **Service:** `src/services/idVerificationService.js`
- **Model:** `src/models/User.js` (idVerification field)

#### **Service Method:** `submitIdVerification()`
**Location:** `idVerificationService.js` Lines 74-141

**Process:**
1. Validate ID type (11 supported Philippine IDs)
2. Upload 3 photos to Cloudinary:
   ```javascript
   const uploadPromises = [];
   if (files.front) uploadPromises.push(uploadPhoto('front'));
   if (files.back) uploadPromises.push(uploadPhoto('back'));
   if (files.selfie) uploadPromises.push(uploadPhoto('selfie'));
   
   const uploadResults = await Promise.all(uploadPromises);
   ```
3. Folder: `parktayo/id-verification/`
4. Save to User model:
   ```javascript
   idVerification: {
     status: 'pending',
     idType: verificationData.idType,
     photos: {
       front: { url, publicId },
       back: { url, publicId },
       selfie: { url, publicId }
     },
     submittedAt: new Date()
   }
   ```
5. Admin reviews via dashboard

**Cleanup Method:** `deleteVerificationPhotos()`
- Deletes all 3 photos from Cloudinary
- Removes metadata from User document

---

## 📊 Database Schema Integration

### **1. Receipt Model**
**File:** `src/models/Receipt.js`

```javascript
receiptImage: {
  cloudinaryId: String,      // e.g., "parktayo/receipts/receipt-userId-timestamp"
  secureUrl: String,         // HTTPS URL to full image
  thumbnailUrl: String,      // Thumbnail for list views
  originalName: String,      // Original filename
  size: Number,              // File size in bytes
  format: String             // Image format (jpg, png, etc.)
}
```

**Indexes:**
- `userId` - Find all receipts by user
- `status` - Filter by approval status

---

### **2. ParkingSpace Model**
**File:** `src/models/ParkingSpace.js`

```javascript
images: [{
  url: String,              // Full-size image URL
  thumbnailUrl: String,     // Thumbnail (300×200)
  publicId: String,         // Cloudinary public ID
  uploadedAt: Date,         // Upload timestamp
  isMain: Boolean,          // Is this the primary image?
  _id: ObjectId            // MongoDB subdocument ID
}]
```

**Business Logic:**
- First uploaded image automatically becomes `isMain: true`
- Max 10 images per parking space
- Deleting main image promotes next image

---

### **3. User Model (ID Verification)**
**File:** `src/models/User.js`

```javascript
idVerification: {
  status: {
    type: String,
    enum: ['none', 'pending', 'approved', 'rejected'],
    default: 'none'
  },
  idType: String,           // Type of ID submitted
  photos: {
    front: {
      url: String,
      publicId: String
    },
    back: {
      url: String,
      publicId: String
    },
    selfie: {
      url: String,
      publicId: String
    }
  },
  submittedAt: Date,
  reviewedAt: Date,
  reviewedBy: ObjectId,     // Admin who reviewed
  rejectionReason: String
}
```

---

## 🔒 Security Features

### **1. Authentication & Authorization**
```javascript
// All routes require authentication
router.use(authenticateToken);

// Role-based access control
router.use(requireLandlord);  // Only landlords
router.use(requireAdmin);     // Only admins
```

### **2. File Validation**
```javascript
// MIME type validation
if (!file.mimetype || !file.mimetype.startsWith('image/')) {
  return cb(new Error('Only image files are allowed'));
}

// Extension validation
const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
```

### **3. Rate Limiting**
```javascript
// Receipt uploads: Standard rate limit
// ID verification: 3 submissions per 15 minutes per IP
// Admin reviews: 20 reviews per 5 minutes per IP
```

### **4. Size Limits**
- **Receipts:** 5MB max
- **Parking Space Images:** 10MB max per image, 10 images max
- **ID Photos:** 10MB max per file

---

## ⚡ Image Transformations

### **Automatic Optimizations**

**Parking Space Images:**
```javascript
transformation: [
  { width: 1200, height: 800, crop: 'limit', quality: 'auto' },
  { fetch_format: 'auto' }  // Serves WebP to supported browsers
]
```

**Thumbnails:**
```javascript
// Receipt thumbnails
cloudinary.url(publicId, {
  width: 300,
  height: 300,
  crop: 'fill',
  quality: 'auto',
  fetch_format: 'auto'
})

// Parking space thumbnails
cloudinary.url(publicId, {
  width: 300,
  height: 200,
  crop: 'fill',
  quality: 'auto',
  fetch_format: 'auto'
})
```

### **Benefits:**
- ✅ Automatic WebP conversion for modern browsers
- ✅ Responsive images via URL parameters
- ✅ CDN delivery for fast loading
- ✅ Automatic quality optimization
- ✅ Original image preservation

---

## 🔄 Complete Request Flow Example

### **Receipt Upload Flow:**

```
1. User selects receipt image in mobile app
   ↓
2. POST /api/v1/receipts/upload
   Headers: { Authorization: Bearer <token> }
   Body: FormData {
     amount: 500,
     mobileNumber: "09171234567",
     senderName: "Juan Dela Cruz",
     receipt: <image file>
   }
   ↓
3. receipts.js route → multer middleware
   - Validates file type
   - Checks file size (max 5MB)
   - Loads file into memory buffer
   ↓
4. receiptController.uploadReceipt()
   - Validates amount, mobileNumber, senderName
   - Calls cloudinaryService.uploadImage()
   ↓
5. cloudinaryService.uploadImage()
   - Uploads buffer to Cloudinary
   - Folder: parktayo/receipts/
   - Filename: receipt-{userId}-{timestamp}
   - Returns: { public_id, secure_url, width, height, format, bytes }
   ↓
6. Controller saves to MongoDB
   - Creates Receipt document
   - Stores Cloudinary metadata
   - Sets status: 'pending'
   ↓
7. Response to client
   {
     status: 'success',
     data: {
       receipt: {
         _id: "...",
         amount: 500,
         status: "pending",
         receiptImage: {
           secureUrl: "https://res.cloudinary.com/...",
           thumbnailUrl: "https://res.cloudinary.com/.../c_fill,h_300,w_300/..."
         }
       }
     }
   }
   ↓
8. Admin reviews receipt via admin dashboard
   - Approve → Credits wallet
   - Reject → User notified
```

---

## 🔍 Error Handling

### **Common Errors:**

**1. Configuration Missing**
```javascript
// Fallback values prevent crashes
cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'parktayo',
api_key: process.env.CLOUDINARY_API_KEY || '',
api_secret: process.env.CLOUDINARY_API_SECRET || ''
```

**2. Upload Failures**
```javascript
try {
  const uploadResult = await cloudinaryService.uploadImage(...);
} catch (error) {
  logger.error('Cloudinary upload error:', error);
  return res.status(500).json({
    status: 'error',
    message: 'Failed to upload image'
  });
}
```

**3. File Size Exceeded**
```javascript
if (err.code === 'LIMIT_FILE_SIZE') {
  return res.status(400).json({
    status: 'error',
    message: 'File size too large. Maximum size is 5MB.'
  });
}
```

**4. Invalid File Type**
```javascript
if (err.message.includes('Only image files are allowed')) {
  return res.status(400).json({
    status: 'error',
    message: 'Only image files are allowed.'
  });
}
```

---

## 📝 Logging

All Cloudinary operations are logged:

```javascript
logger.info('✅ Image uploaded to Cloudinary successfully', {
  public_id: result.public_id,
  secure_url: result.secure_url
});

logger.error('Cloudinary upload error:', error);
```

---

## 🚀 Performance Considerations

### **Optimization Strategies:**

1. **Memory Storage (Multer)**
   - Files stored in memory temporarily
   - No disk I/O overhead
   - Faster uploads

2. **Automatic Format Conversion**
   - WebP for modern browsers
   - Smaller file sizes
   - Faster page loads

3. **CDN Delivery**
   - Cloudinary's global CDN
   - Geographically distributed
   - Low latency worldwide

4. **Lazy Loading**
   - Thumbnails for list views
   - Full images loaded on demand
   - Reduced bandwidth

---

## ⚠️ Security Recommendations

### **Current Issues:**

1. **❌ Hardcoded Credentials in imageUploadService.js**
   ```javascript
   // BAD - Remove these fallbacks
   api_key: process.env.CLOUDINARY_API_KEY || '947168936121835',
   api_secret: process.env.CLOUDINARY_API_SECRET || 'p2q2nssSbSHZ35srWFA5Jiaoiwo',
   ```
   **Fix:** Remove all fallback credentials

2. **❌ Public IDs Predictable**
   ```javascript
   // Current: receipt-userId-timestamp
   // Better: receipt-userId-uuid
   ```
   **Fix:** Use UUID instead of timestamp

### **Best Practices:**

✅ **Always use environment variables**
```javascript
if (!process.env.CLOUDINARY_CLOUD_NAME || 
    !process.env.CLOUDINARY_API_KEY || 
    !process.env.CLOUDINARY_API_SECRET) {
  throw new Error('Cloudinary credentials missing');
}
```

✅ **Implement signed uploads for sensitive images**
```javascript
const signature = cloudinary.utils.api_sign_request({
  timestamp: timestamp,
  folder: 'id-verification'
}, process.env.CLOUDINARY_API_SECRET);
```

✅ **Use upload presets for consistency**
```javascript
cloudinary.uploader.upload(file, {
  upload_preset: 'parktayo_receipts'
});
```

---

## 📦 Dependencies

### **NPM Packages:**
```json
{
  "cloudinary": "^1.40.0",
  "multer": "^1.4.5-lts.1",
  "multer-storage-cloudinary": "^4.0.0"
}
```

### **Configuration Files:**
- `.env` (local development)
- `.env.production` (production server)
- `env.example` (template)

---

## 🧪 Testing Cloudinary Integration

### **Manual Testing:**

1. **Test Receipt Upload:**
   ```bash
   curl -X POST http://localhost:5000/api/v1/receipts/upload \
     -H "Authorization: Bearer <token>" \
     -F "amount=500" \
     -F "mobileNumber=09171234567" \
     -F "senderName=Test User" \
     -F "receipt=@test-receipt.jpg"
   ```

2. **Test Parking Space Images:**
   ```bash
   curl -X POST http://localhost:5000/api/v1/landlord/spaces/{spaceId}/images \
     -H "Authorization: Bearer <landlord-token>" \
     -F "images=@space1.jpg" \
     -F "images=@space2.jpg"
   ```

3. **Test ID Verification:**
   ```bash
   curl -X POST http://localhost:5000/api/v1/id-verification/submit \
     -H "Authorization: Bearer <landlord-token>" \
     -F "idType=Driver's License" \
     -F "front=@id-front.jpg" \
     -F "back=@id-back.jpg" \
     -F "selfie=@selfie.jpg"
   ```

---

## 📊 Summary Statistics

### **Total Files Using Cloudinary: 8**

**Services:** 2
- `cloudinaryService.js`
- `imageUploadService.js`

**Controllers:** 3
- `receiptController.js`
- `landlordController.js`
- `idVerificationController.js`

**Routes:** 3
- `receipts.js`
- `landlord.js`
- `idVerification.js`

**Models:** 4 (storing Cloudinary data)
- `Receipt.js`
- `ParkingSpace.js`
- `User.js`
- `Landlord.js`

### **Total API Endpoints: 7**

**Uploads:**
- `POST /api/v1/receipts/upload`
- `POST /api/v1/landlord/spaces/:spaceId/images`
- `POST /api/v1/id-verification/submit`
- `POST /api/v1/id-verification/submit-registration`

**Deletes:**
- `DELETE /api/v1/landlord/spaces/:spaceId/images/:imageId`
- `DELETE /api/v1/id-verification/:userId`

**Admin:**
- `POST /api/v1/receipts/admin/:receiptId/approve`

---

## 🎯 Key Takeaways

1. **Cloudinary is critical** - Powers all image storage in ParkTayo
2. **Three main use cases** - Receipts, parking spaces, ID verification
3. **Two service implementations** - Slightly different configurations
4. **Security needs attention** - Remove hardcoded fallback credentials
5. **Well-integrated** - Proper error handling and logging throughout
6. **Scalable architecture** - CDN delivery, automatic optimizations
7. **Production-ready** - With minor security improvements needed

---

## 📞 Related Configuration

These Cloudinary variables work together with:
- `JWT_SECRET` - For user authentication before uploads
- `MONGODB_URI` - Stores Cloudinary metadata
- `LOG_LEVEL` - Controls Cloudinary operation logging

---

**Last Updated:** September 30, 2025
**Analyzed By:** AI Assistant
**Based On:** env.example lines 37-42 (CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET)


