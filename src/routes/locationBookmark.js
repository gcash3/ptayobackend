const express = require('express');
const router = express.Router();
const { toggleLocationBookmark } = require('../controllers/locationBookmarkController');

// Toggle location bookmark (add/remove)
router.post('/', toggleLocationBookmark);

module.exports = router;