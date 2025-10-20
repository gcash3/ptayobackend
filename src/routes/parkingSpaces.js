const express = require('express');
const parkingSpaceController = require('../controllers/parkingSpaceController');
const { optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Public routes (no authentication required)
router.get('/', optionalAuth, parkingSpaceController.getAllParkingSpaces);
router.get('/search', optionalAuth, parkingSpaceController.searchParkingSpaces);
router.get('/nearby', optionalAuth, parkingSpaceController.getNearbyParkingSpaces);
router.get('/map', optionalAuth, parkingSpaceController.getParkingSpacesForMap);
router.get('/clusters', optionalAuth, parkingSpaceController.getParkingSpaceClusters);
router.get('/universities/nearby', parkingSpaceController.getNearbyUniversities);

// Single parking space (public)
router.get('/:id', optionalAuth, parkingSpaceController.getParkingSpace);
router.post('/:id/check-availability', parkingSpaceController.checkAvailability);

// Development/testing routes
router.post('/seed', parkingSpaceController.seedParkingSpaces);
router.post('/clear-and-reseed', parkingSpaceController.clearAndReseed);

module.exports = router; 