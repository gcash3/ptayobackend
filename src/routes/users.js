const express = require('express');
const router = express.Router();

// Placeholder for user routes
// This will be implemented later with full functionality

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'User routes coming soon'
  });
});

module.exports = router; 