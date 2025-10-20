const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const logger = require('../config/logger');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME || 'parktayo',
  api_key: process.env.CLOUDINARY_API_KEY || '',
  api_secret: process.env.CLOUDINARY_API_SECRET || ''
});

// Configure Multer for memory storage
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  // Log file information for debugging
  logger.info('File upload attempt:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    fieldname: file.fieldname,
    size: file.size
  });

  // Define allowed image MIME types and extensions
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg', 
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/tiff'
  ];

  const allowedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff'];
  
  // Check MIME type first
  if (file.mimetype && allowedMimeTypes.includes(file.mimetype.toLowerCase())) {
    cb(null, true);
    return;
  }

  // Fallback: check file extension if MIME type is not recognized or is application/octet-stream
  if (file.originalname) {
    const fileExtension = file.originalname.toLowerCase().substring(file.originalname.lastIndexOf('.'));
    if (allowedExtensions.includes(fileExtension)) {
      logger.info('File accepted based on extension despite MIME type:', {
        originalname: file.originalname,
        mimetype: file.mimetype,
        extension: fileExtension
      });
      cb(null, true);
      return;
    }
  }

  // Reject file
  const error = new Error(`Only image files are allowed! Received: ${file.mimetype} for file: ${file.originalname}`);
  logger.error('File filter rejected file:', {
    originalname: file.originalname,
    mimetype: file.mimetype,
    reason: 'Not an image file'
  });
  cb(error, false);
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  }
});

class CloudinaryService {
  /**
   * Upload image to Cloudinary
   * @param {Buffer} buffer - Image buffer
   * @param {string} folder - Cloudinary folder
   * @param {string} fileName - File name
   * @returns {Promise<Object>} Upload result
   */
  async uploadImage(buffer, folder = 'receipts', fileName = null) {
    try {
      return new Promise((resolve, reject) => {
        const uploadOptions = {
          folder: `parktayo/${folder}`,
          resource_type: 'image',
          format: 'jpg',
          quality: 'auto:good',
          fetch_format: 'auto'
        };

        if (fileName) {
          uploadOptions.public_id = fileName;
        }

        const uploadStream = cloudinary.uploader.upload_stream(
          uploadOptions,
          (error, result) => {
            if (error) {
              logger.error('Cloudinary upload error:', error);
              reject(error);
            } else {
              logger.info('✅ Image uploaded to Cloudinary successfully', {
                public_id: result.public_id,
                secure_url: result.secure_url
              });
              resolve({
                public_id: result.public_id,
                secure_url: result.secure_url,
                width: result.width,
                height: result.height,
                format: result.format,
                bytes: result.bytes
              });
            }
          }
        );

        uploadStream.end(buffer);
      });
    } catch (error) {
      logger.error('Error uploading to Cloudinary:', error);
      throw error;
    }
  }

  /**
   * Delete image from Cloudinary
   * @param {string} publicId - Cloudinary public ID
   * @returns {Promise<Object>} Delete result
   */
  async deleteImage(publicId) {
    try {
      const result = await cloudinary.uploader.destroy(publicId);
      logger.info('✅ Image deleted from Cloudinary', { public_id: publicId, result });
      return result;
    } catch (error) {
      logger.error('Error deleting from Cloudinary:', error);
      throw error;
    }
  }

  /**
   * Generate optimized URL for image
   * @param {string} publicId - Cloudinary public ID
   * @param {Object} options - Transformation options
   * @returns {string} Optimized URL
   */
  getOptimizedUrl(publicId, options = {}) {
    const defaultOptions = {
      quality: 'auto:good',
      fetch_format: 'auto',
      ...options
    };

    return cloudinary.url(publicId, defaultOptions);
  }

  /**
   * Generate thumbnail URL
   * @param {string} publicId - Cloudinary public ID
   * @param {number} width - Thumbnail width
   * @param {number} height - Thumbnail height
   * @returns {string} Thumbnail URL
   */
  getThumbnailUrl(publicId, width = 200, height = 200) {
    return cloudinary.url(publicId, {
      width,
      height,
      crop: 'fill',
      quality: 'auto:good',
      fetch_format: 'auto'
    });
  }

  /**
   * Get upload middleware for Express
   * @param {string} fieldName - Form field name
   * @returns {Function} Multer middleware
   */
  getUploadMiddleware(fieldName = 'receipt') {
    return upload.single(fieldName);
  }

  /**
   * Get multiple upload middleware for Express
   * @param {string} fieldName - Form field name
   * @param {number} maxCount - Maximum file count
   * @returns {Function} Multer middleware
   */
  getMultipleUploadMiddleware(fieldName = 'receipts', maxCount = 5) {
    return upload.array(fieldName, maxCount);
  }
}

module.exports = new CloudinaryService();