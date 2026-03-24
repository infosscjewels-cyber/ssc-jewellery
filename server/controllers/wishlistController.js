const Wishlist = require('../models/Wishlist');

const toUniqueProductIds = (items = []) => (
    [...new Set((Array.isArray(items) ? items : []).map((entry) => String(entry?.productId || '').trim()).filter(Boolean))]
);

const emitWishlistUpdate = (req, userId, items = []) => {
    const io = req.app.get('io');
    if (!io || !userId) return;
    io.to(`user:${userId}`).emit('wishlist:update', {
        items,
        productIds: toUniqueProductIds(items)
    });
};

const getWishlist = async (req, res) => {
    try {
        const { items, prunedCount } = await Wishlist.getByUser(req.user.id, { withMeta: true });
        if (prunedCount > 0) {
            emitWishlistUpdate(req, req.user.id, items);
        }
        res.json({ items, productIds: toUniqueProductIds(items) });
    } catch (error) {
        console.error('Wishlist fetch error:', error);
        res.status(500).json({ message: 'Failed to fetch wishlist' });
    }
};

const addWishlistItem = async (req, res) => {
    try {
        const productId = String(req.body?.productId || '').trim();
        const variantId = String(req.body?.variantId || '').trim();
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Wishlist.addItem(req.user.id, productId, variantId);
        const items = await Wishlist.getByUser(req.user.id);
        emitWishlistUpdate(req, req.user.id, items);
        res.json({ items, productIds: toUniqueProductIds(items) });
    } catch (error) {
        console.error('Wishlist add error:', error);
        const message = String(error?.message || '');
        if (/product not found|productid required|unavailable|variant is unavailable/i.test(message)) {
            return res.status(400).json({ message: message || 'Invalid wishlist item' });
        }
        res.status(500).json({ message: 'Failed to add wishlist item' });
    }
};

const removeWishlistItem = async (req, res) => {
    try {
        const productId = String(req.body?.productId || '').trim();
        const variantId = String(req.body?.variantId || '').trim();
        const removeAllVariants = req.body?.removeAllVariants === true || String(req.body?.removeAllVariants || '').toLowerCase() === 'true';
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Wishlist.removeItem(req.user.id, productId, variantId, { removeAllVariants });
        const items = await Wishlist.getByUser(req.user.id);
        emitWishlistUpdate(req, req.user.id, items);
        res.json({ items, productIds: toUniqueProductIds(items) });
    } catch (error) {
        console.error('Wishlist remove error:', error);
        res.status(500).json({ message: 'Failed to remove wishlist item' });
    }
};

const clearWishlist = async (req, res) => {
    try {
        await Wishlist.clearUser(req.user.id);
        emitWishlistUpdate(req, req.user.id, []);
        res.json({ items: [], productIds: [] });
    } catch (error) {
        console.error('Wishlist clear error:', error);
        res.status(500).json({ message: 'Failed to clear wishlist' });
    }
};

module.exports = {
    getWishlist,
    addWishlistItem,
    removeWishlistItem,
    clearWishlist
};
