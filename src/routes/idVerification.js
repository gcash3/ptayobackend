const express = require('express');
const { body, param } = require('express-validator');
const rateLimit = require('express-rate-limit');
const idVerificationController = require('../controllers/idVerificationController');
const { authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { uploadMiddleware } = require('../services/imageUploadService');

const router = express.Router();

// Rate limiting for ID verification submissions
const submitRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // Max 3 submissions per window per IP
  message: {
    status: 'error',
    message: 'Too many ID verification attempts. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting for review actions (Admin)
const reviewRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 20, // Max 20 reviews per window per IP
  message: {
    status: 'error',
    message: 'Too many review actions. Please slow down.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Validation schemas
const submitValidation = [
  body('idType')
    .notEmpty()
    .withMessage('ID type is required')
    .isIn([
      'PhilID (National ID)',
      'Driver\'s License', 
      'Philippine Passport',
      'Unified Multi-Purpose ID (UMID)',
      'Professional Regulation Commission (PRC) ID',
      'PhilHealth ID',
      'Postal ID',
      'Voter\'s ID',
      'TIN ID',
      'Barangay ID',
      'Senior Citizen ID'
    ])
    .withMessage('Invalid ID type selected')
];

const reviewValidation = [
  param('userId')
    .isMongoId()
    .withMessage('Invalid user ID'),
  
  body('status')
    .notEmpty()
    .withMessage('Status is required')
    .isIn(['approved', 'rejected'])
    .withMessage('Status must be either approved or rejected'),
    
  body('rejectionReason')
    .optional()
    .isLength({ min: 10, max: 500 })
    .withMessage('Rejection reason must be between 10 and 500 characters')
];

// Middleware to check if user is landlord
const requireLandlord = (req, res, next) => {
  if (req.user.role !== 'landlord') {
    return res.status(403).json({
      status: 'error',
      message: 'ID verification is only available for landlords'
    });
  }
  next();
};

// Middleware to check if user is admin
const requireAdmin = (req, res, next) => {
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      status: 'error',
      message: 'Access denied. Admin privileges required.'
    });
  }
  next();
};

/**
 * @route POST /api/v1/id-verification/submit
 * @desc Submit ID verification with photos
 * @access Private (Landlords only)
 */
router.post('/submit', 
  submitRateLimit,
  authenticateToken,
  requireLandlord,
  uploadMiddleware.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]),
  ...submitValidation,
  validateRequest,
  idVerificationController.submitIdVerification
);

/**
 * @route POST /api/v1/id-verification/submit-registration
 * @desc Submit ID verification documents during registration (no auth required)
 * @access Public (Registration flow only)
 */
router.post('/submit-registration', 
  submitRateLimit,
  uploadMiddleware.fields([
    { name: 'front', maxCount: 1 },
    { name: 'back', maxCount: 1 },
    { name: 'selfie', maxCount: 1 }
  ]),
  [
    body('phoneNumber')
      .isMobilePhone()
      .withMessage('Valid phone number is required'),
    body('idType')
      .isIn([
        'PhilID (National ID)',
        'Driver\'s License', 
        'Philippine Passport',
        'Unified Multi-Purpose ID (UMID)',
        'Professional Regulation Commission (PRC) ID',
        'PhilHealth ID',
        'Postal ID',
        'Voter\'s ID',
        'TIN ID',
        'Barangay ID',
        'Senior Citizen ID'
      ])
      .withMessage('Valid ID type is required')
  ],
  validateRequest,
  idVerificationController.submitIdVerificationRegistration
);

/**
 * @route GET /api/v1/id-verification/status
 * @desc Get current ID verification status
 * @access Private (Landlords only)
 */
router.get('/status',
  authenticateToken,
  requireLandlord,
  idVerificationController.getVerificationStatus
);

/**
 * @route POST /api/v1/id-verification/review/:userId
 * @desc Review ID verification (approve/reject)
 * @access Private (Admins only)
 */
router.post('/review/:userId',
  reviewRateLimit,
  authenticateToken,
  requireAdmin,
  ...reviewValidation,
  validateRequest,
  idVerificationController.reviewIdVerification
);

/**
 * @route GET /api/v1/id-verification/pending
 * @desc Get all pending ID verifications
 * @access Private (Admins only)
 */
router.get('/pending',
  authenticateToken,
  requireAdmin,
  idVerificationController.getPendingVerifications
);

/**
 * @route GET /api/v1/id-verification/stats
 * @desc Get ID verification statistics
 * @access Private (Admins only)
 */
router.get('/stats',
  authenticateToken,
  requireAdmin,
  idVerificationController.getVerificationStats
);

/**
 * @route DELETE /api/v1/id-verification/:userId
 * @desc Delete verification photos for a user
 * @access Private (Admins only)
 */
router.delete('/:userId',
  authenticateToken,
  requireAdmin,
  param('userId').isMongoId().withMessage('Invalid user ID'),
  validateRequest,
  idVerificationController.deleteVerificationPhotos
);

module.exports = router;
