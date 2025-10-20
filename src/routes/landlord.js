const express = require('express');
const { body } = require('express-validator');
const landlordController = require('../controllers/landlordController');
const bookingController = require('../controllers/bookingController');
const { authenticateToken, requireLandlord } = require('../middleware/auth');
const { uploadMiddleware } = require('../services/imageUploadService');

const router = express.Router();

// Validation for creating parking space
const createParkingSpaceValidation = [
  body('name')
    .trim()
    .isLength({ min: 5, max: 100 })
    .withMessage('Name must be between 5 and 100 characters'),
  
  body('description')
    .trim()
    .isLength({ min: 10, max: 500 })
    .withMessage('Description must be between 10 and 500 characters'),
  
  body('address')
    .trim()
    .isLength({ min: 10, max: 200 })
    .withMessage('Address must be between 10 and 200 characters'),
  
  body('latitude')
    .isFloat({ min: -90, max: 90 })
    .withMessage('Latitude must be a valid coordinate'),
  
  body('longitude')
    .isFloat({ min: -180, max: 180 })
    .withMessage('Longitude must be a valid coordinate'),
  
  body('pricePerHour')
    .isFloat({ min: 10, max: 500 })
    .withMessage('Price per hour must be between ₱10 and ₱500'),
  
  body('totalSpots')
    .isInt({ min: 1, max: 100 })
    .withMessage('Total spots must be between 1 and 100'),
  
  body('vehicleTypes')
    .optional()
    .isArray()
    .withMessage('Vehicle types must be an array'),
  
  body('vehicleTypes.*')
    .optional()
    .isIn(['motorcycle', 'car', 'van', 'truck'])
    .withMessage('Invalid vehicle type'),
];

// Apply authentication and landlord role requirement to all routes
router.use(authenticateToken);
router.use(requireLandlord);

// Dashboard
router.get('/dashboard', landlordController.getLandlordDashboard);

// Booking Management
router.get('/bookings', bookingController.getLandlordBookings);

// Parking Spaces Management
router.get('/spaces', landlordController.getLandlordParkingSpaces);
router.post('/spaces', createParkingSpaceValidation, landlordController.createParkingSpace);
router.get('/spaces/:spaceId', landlordController.getParkingSpaceDetails);
router.patch('/spaces/:spaceId', landlordController.updateParkingSpace);
router.delete('/spaces/:spaceId', landlordController.deleteParkingSpace);
router.patch('/spaces/:spaceId/toggle', landlordController.toggleSpaceAvailability);

// Image Management
router.post('/spaces/:spaceId/images', 
  uploadMiddleware.multiple('images', 10), 
  landlordController.uploadSpaceImages
);
router.delete('/spaces/:spaceId/images/:imageId', landlordController.deleteSpaceImage);

module.exports = router; 