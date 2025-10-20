const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const logger = require('../config/logger');

// Configure Cloudinary with user's credentials
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'dfv3pqaoq',
  api_key: process.env.CLOUDINARY_API_KEY || '947168936121835',
  api_secret: process.env.CLOUDINARY_API_SECRET || 'p2q2nssSbSHZ35srWFA5Jiaoiwo',
});

// Create Cloudinary storage configuration
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'parktayo/parking-spaces',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation: [
      { width: 1200, height: 800, crop: 'limit', quality: 'auto' },
      { fetch_format: 'auto' }
    ],
    public_id: (req, file) => {
      const timestamp = Date.now();
      const spaceId = req.params.spaceId || 'new';
      return `space-${spaceId}-${timestamp}`;
    }
  },
});

// Configure multer with Cloudinary storage
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
    files: 10 // Maximum 10 files per upload
  },
  fileFilter: (req, file, cb) => {
    // Check file type by MIME type first
    if (file.mimetype && file.mimetype.startsWith('image/')) {
      cb(null, true);
      return;
    }
    
    // Fallback: check by file extension if MIME type is missing or unclear
    const allowedExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif'];
    const fileExtension = file.originalname.toLowerCase().split('.').pop();
    
    if (fileExtension && allowedExtensions.includes(`.${fileExtension}`)) {
      cb(null, true);
      return;
    }
    
    // Check common image MIME types that might be missing the 'image/' prefix
    const imageMimeTypes = [
      'image/jpeg',
      'image/jpg', 
      'image/png',
      'image/webp',
      'image/gif',
      'jpeg',
      'jpg',
      'png',
      'webp',
      'gif'
    ];
    
    if (file.mimetype && imageMimeTypes.includes(file.mimetype.toLowerCase())) {
      cb(null, true);
      return;
    }
    
    cb(new Error('Only image files are allowed'), false);
  }
});

class ImageUploadService {
  
  // Upload single image
  async uploadSingleImage(file, options = {}) {
    try {
      const result = await cloudinary.uploader.upload(file.path, {
        folder: 'parktayo/parking-spaces',
        transformation: [
          { width: 1200, height: 800, crop: 'limit', quality: 'auto' },
          { fetch_format: 'auto' }
        ],
        ...options
      });

      return {
        success: true,
        data: {
          publicId: result.public_id,
          url: result.secure_url,
          thumbnailUrl: this.generateThumbnailUrl(result.public_id),
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
          createdAt: result.created_at
        }
      };
    } catch (error) {
      logger.error('Image upload failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Upload multiple images
  async uploadMultipleImages(files, options = {}) {
    try {
      const uploadPromises = files.map(file => this.uploadSingleImage(file, options));
      const results = await Promise.all(uploadPromises);
      
      const successful = results.filter(result => result.success);
      const failed = results.filter(result => !result.success);

      return {
        success: true,
        data: {
          successful: successful.map(result => result.data),
          failed: failed.map(result => result.error),
          total: files.length,
          successCount: successful.length,
          failCount: failed.length
        }
      };
    } catch (error) {
      logger.error('Multiple image upload failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Delete image from Cloudinary
  async deleteImage(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      
      return {
        success: result.result === 'ok',
        data: result
      };
    } catch (error) {
      logger.error('Image deletion failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Delete multiple images
  async deleteMultipleImages(publicIds) {
    try {
      const deletePromises = publicIds.map(publicId => this.deleteImage(publicId));
      const results = await Promise.all(deletePromises);
      
      const successful = results.filter(result => result.success);
      const failed = results.filter(result => !result.success);

      return {
        success: true,
        data: {
          successful: successful.length,
          failed: failed.length,
          total: publicIds.length
        }
      };
    } catch (error) {
      logger.error('Multiple image deletion failed:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  // Generate optimized image URLs
  generateImageUrl(publicId, options = {}) {
    const {
      width = 800,
      height = 600,
      crop = 'fill',
      quality = 'auto',
      format = 'auto'
    } = options;

    return cloudinary.url(publicId, {
      width,
      height,
      crop,
      quality,
      fetch_format: format,
      secure: true
    });
  }

  // Generate thumbnail URL
  generateThumbnailUrl(publicId) {
    return this.generateImageUrl(publicId, {
      width: 300,
      height: 200,
      crop: 'fill',
      quality: '80'
    });
  }

  // Get image metadata
  async getImageMetadata(publicId) {
    try {
      const result = await cloudinary.api.resource(publicId);
      
      return {
        success: true,
        data: {
          publicId: result.public_id,
          url: result.secure_url,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
          createdAt: result.created_at,
          folder: result.folder
        }
      };
    } catch (error) {
      logger.error('Failed to get image metadata:', error);
      return {
        success: false,
        error: error.message
      };
    }
  }
}

const imageUploadService = new ImageUploadService();

module.exports = {
  imageUploadService,
  upload,
  uploadMiddleware: {
    single: (fieldName) => upload.single(fieldName),
    multiple: (fieldName, maxCount = 10) => upload.array(fieldName, maxCount),
    fields: (fields) => upload.fields(fields)
  }
}; 