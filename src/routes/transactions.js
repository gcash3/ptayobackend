const express = require('express');
const router = express.Router();

// Placeholder for transaction routes
// This will be implemented later with full functionality

router.get('/', (req, res) => {
  res.status(200).json({
    status: 'success',
    message: 'Transaction routes coming soon'
  });
});

module.exports = router; 