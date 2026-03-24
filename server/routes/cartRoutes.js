const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const { getCart, addCartItem, updateCartItem, removeCartItem, clearCart, bulkAddCart } = require('../controllers/cartController');

router.use(protect);

router.get('/', getCart);
router.post('/items', addCartItem);
router.patch('/items', updateCartItem);
router.delete('/items', removeCartItem);
router.delete('/', clearCart);
router.post('/bulk', bulkAddCart);

module.exports = router;
