const express = require('express');
const { body, param } = require('express-validator');
const { validateRequest } = require('../middleware/validation');
const vehicleController = require('../controllers/vehicleController');
const { authenticateToken, authorizeRoles } = require('../middleware/auth');

const router = express.Router();

// Validation rules
const addVehicleValidation = [
  body('plateNumber')
    .notEmpty()
    .withMessage('Plate number is required')
    .isLength({ min: 2, max: 15 })
    .withMessage('Plate number must be between 2 and 15 characters'),
  
  body('vehicleType')
    .isIn(['motorcycle', 'car'])
    .withMessage('Vehicle type must be either motorcycle or car'),
  
  body('brand')
    .notEmpty()
    .withMessage('Brand is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Brand must be between 2 and 50 characters'),
  
  body('model')
    .notEmpty()
    .withMessage('Model is required')
    .isLength({ min: 1, max: 50 })
    .withMessage('Model must be between 1 and 50 characters'),
  
  body('color')
    .notEmpty()
    .withMessage('Color is required')
    .isLength({ min: 2, max: 30 })
    .withMessage('Color must be between 2 and 30 characters'),
  
  body('year')
    .optional()
    .isInt({ min: 1900, max: new Date().getFullYear() + 1 })
    .withMessage('Year must be a valid year'),
  
  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean'),
  
  validateRequest
];

const updateVehicleValidation = [
  body('plateNumber')
    .optional()
    .isLength({ min: 2, max: 15 })
    .withMessage('Plate number must be between 2 and 15 characters'),
  
  body('vehicleType')
    .optional()
    .isIn(['motorcycle', 'car'])
    .withMessage('Vehicle type must be either motorcycle or car'),
  
  body('brand')
    .optional()
    .isLength({ min: 2, max: 50 })
    .withMessage('Brand must be between 2 and 50 characters'),
  
  body('model')
    .optional()
    .isLength({ min: 1, max: 50 })
    .withMessage('Model must be between 1 and 50 characters'),
  
  body('color')
    .optional()
    .isLength({ min: 2, max: 30 })
    .withMessage('Color must be between 2 and 30 characters'),
  
  body('year')
    .optional()
    .isInt({ min: 1900, max: new Date().getFullYear() + 1 })
    .withMessage('Year must be a valid year'),
  
  body('isDefault')
    .optional()
    .isBoolean()
    .withMessage('isDefault must be a boolean'),
  
  validateRequest
];

const vehicleIdValidation = [
  param('vehicleId')
    .isMongoId()
    .withMessage('Invalid vehicle ID'),
  validateRequest
];

const uploadDocumentsValidation = [
  body('mvFileUrl')
    .isURL()
    .withMessage('MVFile URL must be a valid URL'),
  validateRequest
];

const adminVehicleActionValidation = [
  param('vehicleId')
    .isMongoId()
    .withMessage('Invalid vehicle ID'),
  validateRequest
];

// Apply authentication to all routes
router.use(authenticateToken);

// User routes
router.get('/', vehicleController.getUserVehicles);
router.post('/', addVehicleValidation, vehicleController.addVehicle);
router.get('/:vehicleId', vehicleIdValidation, vehicleController.getVehicle);
router.put('/:vehicleId', vehicleIdValidation, updateVehicleValidation, vehicleController.updateVehicle);
router.delete('/:vehicleId', vehicleIdValidation, vehicleController.deleteVehicle);

// Document upload
router.post('/:vehicleId/documents', 
  vehicleIdValidation, 
  uploadDocumentsValidation, 
  vehicleController.uploadVehicleDocuments
);

// Set default vehicle
router.patch('/:vehicleId/default', vehicleIdValidation, vehicleController.setDefaultVehicle);

// Admin routes
router.get('/admin/all', authorizeRoles('admin'), vehicleController.getAllVehicles);
router.patch('/admin/:vehicleId/verify', 
  authorizeRoles('admin'), 
  adminVehicleActionValidation, 
  vehicleController.verifyVehicle
);
router.patch('/admin/:vehicleId/reject', 
  authorizeRoles('admin'), 
  adminVehicleActionValidation, 
  body('reason').notEmpty().withMessage('Rejection reason is required'),
  validateRequest,
  vehicleController.rejectVehicle
);

module.exports = router; 