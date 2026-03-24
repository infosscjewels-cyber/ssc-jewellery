const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getWishlist,
    addWishlistItem,
    removeWishlistItem,
    clearWishlist
} = require('../controllers/wishlistController');

router.use(protect);
router.get('/', getWishlist);
router.post('/items', addWishlistItem);
router.delete('/items', removeWishlistItem);
router.delete('/', clearWishlist);

module.exports = router;
