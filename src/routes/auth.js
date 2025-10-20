const express = require('express');
const { body } = require('express-validator');
const authController = require('../controllers/authController');
const { refreshToken, authenticateToken } = require('../middleware/auth');
const { validateRequest } = require('../middleware/validation');
const { checkRegistrationEnabled } = require('../middleware/systemSettings');

const router = express.Router();

// Validation rules
const signupValidation = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('phoneNumber')
    .optional()
    .isMobilePhone('en-PH')
    .withMessage('Please provide a valid Philippine phone number'),
  
  body('role')
    .optional()
    .isIn(['client', 'landlord'])
    .withMessage('Role must be either client or landlord'),
];

// Phone verification signup validation
const phoneVerificationSignupValidation = [
  body('phoneNumber')
    .notEmpty()
    .withMessage('Phone number is required')
    .matches(/^(\+?63|0)9\d{9}$/)
    .withMessage('Invalid Philippine phone number format'),
    
  body('verificationCode')
    .notEmpty()
    .withMessage('Verification code is required')
    .isLength({ min: 6, max: 6 })
    .isNumeric()
    .withMessage('Verification code must be exactly 6 digits')
];

const loginValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

const forgotPasswordValidation = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
];

const resetPasswordValidation = [
  body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
];

const changePasswordValidation = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  
  body('newPassword')
    .isLength({ min: 8 })
    .withMessage('New password must be at least 8 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number'),
  
  body('confirmPassword')
    .custom((value, { req }) => {
      if (value !== req.body.newPassword) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),
];

// Flexible validation for landlord registration
const landlordRegistrationValidation = [
  body('firstName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),
  
  body('lastName')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),
  
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long'),
  
  body('phoneNumber')
    .optional()
    .isLength({ min: 10, max: 15 })
    .withMessage('Please provide a valid phone number'),
];

// Public routes
router.post('/signup', checkRegistrationEnabled, signupValidation, authController.signup);
router.post('/register', checkRegistrationEnabled, signupValidation, authController.signup);
router.post('/signup-with-phone', checkRegistrationEnabled, phoneVerificationSignupValidation, authController.signupWithPhoneVerification);
router.post('/login', loginValidation, authController.login);
router.post('/forgot-password', forgotPasswordValidation, authController.forgotPassword);
router.patch('/reset-password/:token', resetPasswordValidation, authController.resetPassword);

// Role-specific routes for different apps
router.post('/landlord/login', loginValidation, authController.landlordLogin);
router.post('/landlord/register', checkRegistrationEnabled, landlordRegistrationValidation, authController.landlordRegister);
router.post('/client/login', loginValidation, authController.clientLogin);
router.post('/client/register', checkRegistrationEnabled, signupValidation, authController.clientRegister);

// Email verification
router.get('/verify-email/:token', authController.verifyEmail);
router.post('/resend-verification', authController.resendVerificationEmail);

// Token refresh
router.post('/refresh-token', refreshToken);

// Logout
router.post('/logout', authController.logout);

// Test account (for development)
router.post('/test-login', authController.testAccountLogin);

// Protected routes (require authentication)
router.use(authenticateToken);

router.patch('/change-password', changePasswordValidation, authController.changePassword);
router.get('/me', authController.getMe);
router.patch('/update-me', authController.updateMe);
router.delete('/delete-me', authController.deleteMe);

// FCM Token management
router.post('/fcm-token', [
  body('fcmToken').notEmpty().withMessage('FCM token is required'),
  body('deviceId').notEmpty().withMessage('Device ID is required'),
  body('platform').isIn(['ios', 'android', 'web', 'flutter']).withMessage('Platform must be ios, android, web, or flutter'),
  body('appVersion').optional().isString().withMessage('App version must be a string')
], authController.addFCMToken);

router.delete('/fcm-token/:deviceId', authController.removeFCMToken);

// Email verification status for authenticated users
router.get('/email-verification/status', require('../controllers/emailVerificationController').getVerificationStatus);
router.post('/email-verification/send', require('../controllers/emailVerificationController').sendVerificationCode);
router.post('/email-verification/verify', require('../controllers/emailVerificationController').verifyCode);
router.post('/email-verification/resend', require('../controllers/emailVerificationController').resendVerificationCode);

module.exports = router; 