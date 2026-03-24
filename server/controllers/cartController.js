const Cart = require('../models/Cart');
const AbandonedCart = require('../models/AbandonedCart');
const Wishlist = require('../models/Wishlist');
const { trackCartActivity } = require('../services/abandonedCartRecoveryService');

const getCartMutationStatus = (error) => {
    const message = String(error?.message || '');
    if (/productid required/i.test(message)) return 400;
    if (/product not found|variant is unavailable|product is unavailable|only \d+ item\(s\) available/i.test(message)) return 400;
    return 500;
};

const emitAbandonedCartUpdate = async (req, { userId, reason = 'cart_update', journeyId = null } = {}) => {
    try {
        const io = req.app.get('io');
        if (!io || !userId) return;
        let journey = null;
        if (journeyId) {
            const timeline = await AbandonedCart.getJourneyTimeline(journeyId);
            journey = timeline?.journey || null;
        } else {
            journey = await AbandonedCart.getActiveJourneyByUser(userId);
        }
        if (!journey && !journeyId) return;
        io.to('admin').emit('abandoned_cart:update', {
            userId,
            reason,
            journeyId: journey?.id || journeyId || null,
            journey: journey || null,
            status: journey?.status || null,
            ts: new Date().toISOString()
        });
    } catch (error) {
        console.error('Abandoned-cart socket emit error:', error?.message || error);
    }
};

const emitWishlistUpdateIfChanged = async (req, userId, removedCount = 0) => {
    if (!userId || Number(removedCount || 0) <= 0) return;
    const io = req.app.get('io');
    if (!io) return;
    const items = await Wishlist.getByUser(userId);
    io.to(`user:${userId}`).emit('wishlist:update', {
        items,
        productIds: [...new Set(items.map((entry) => String(entry?.productId || '').trim()).filter(Boolean))]
    });
};

const getCart = async (req, res) => {
    try {
        const items = await Cart.getByUser(req.user.id);
        res.json({ items });
    } catch (error) {
        console.error('Cart fetch error:', error);
        res.status(500).json({ message: 'Failed to fetch cart' });
    }
};

const addCartItem = async (req, res) => {
    try {
        const { productId, variantId, quantity } = req.body || {};
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Cart.addItem(req.user.id, productId, variantId, quantity);
        const removedWishlistCount = await Wishlist.removeForCartAdd(req.user.id, productId, variantId);
        await emitWishlistUpdateIfChanged(req, req.user.id, removedWishlistCount);
        const items = await Cart.getByUser(req.user.id);
        try {
            const tracked = await trackCartActivity(req.user.id, { reason: 'cart_add' });
            await emitAbandonedCartUpdate(req, {
                userId: req.user.id,
                reason: 'cart_add',
                journeyId: tracked?.journeyId || null
            });
        } catch (err) {
            console.error('Abandoned-cart track error (add):', err?.message || err);
        }
        res.json({ items });
    } catch (error) {
        console.error('Cart add error:', error);
        res.status(getCartMutationStatus(error)).json({ message: error?.message || 'Failed to add item' });
    }
};

const updateCartItem = async (req, res) => {
    try {
        const { productId, variantId, quantity } = req.body || {};
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Cart.setItemQuantity(req.user.id, productId, variantId, quantity);
        const items = await Cart.getByUser(req.user.id);
        try {
            const tracked = await trackCartActivity(req.user.id, { reason: 'cart_update' });
            await emitAbandonedCartUpdate(req, {
                userId: req.user.id,
                reason: 'cart_update',
                journeyId: tracked?.journeyId || null
            });
        } catch (err) {
            console.error('Abandoned-cart track error (update):', err?.message || err);
        }
        res.json({ items });
    } catch (error) {
        console.error('Cart update error:', error);
        res.status(getCartMutationStatus(error)).json({ message: error?.message || 'Failed to update item' });
    }
};

const removeCartItem = async (req, res) => {
    try {
        const { productId, variantId } = req.body || {};
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Cart.removeItem(req.user.id, productId, variantId);
        const items = await Cart.getByUser(req.user.id);
        try {
            const tracked = await trackCartActivity(req.user.id, { reason: 'cart_remove' });
            await emitAbandonedCartUpdate(req, {
                userId: req.user.id,
                reason: 'cart_remove',
                journeyId: tracked?.journeyId || null
            });
        } catch (err) {
            console.error('Abandoned-cart track error (remove):', err?.message || err);
        }
        res.json({ items });
    } catch (error) {
        console.error('Cart remove error:', error);
        res.status(500).json({ message: 'Failed to remove item' });
    }
};

const clearCart = async (req, res) => {
    try {
        await Cart.clearUser(req.user.id);
        try {
            const tracked = await trackCartActivity(req.user.id, { reason: 'cart_clear' });
            await emitAbandonedCartUpdate(req, {
                userId: req.user.id,
                reason: 'cart_clear',
                journeyId: tracked?.journeyId || null
            });
        } catch (err) {
            console.error('Abandoned-cart track error (clear):', err?.message || err);
        }
        res.json({ items: [] });
    } catch (error) {
        console.error('Cart clear error:', error);
        res.status(500).json({ message: 'Failed to clear cart' });
    }
};

const bulkAddCart = async (req, res) => {
    try {
        const { items } = req.body || {};
        await Cart.bulkAdd(req.user.id, items || []);
        let removedWishlistCount = 0;
        for (const item of Array.isArray(items) ? items : []) {
            const productId = String(item?.productId || '').trim();
            if (!productId) continue;
            const variantId = String(item?.variantId || '').trim();
            // Invalidate matching wishlist entries when product is moved to cart.
            removedWishlistCount += await Wishlist.removeForCartAdd(req.user.id, productId, variantId);
        }
        await emitWishlistUpdateIfChanged(req, req.user.id, removedWishlistCount);
        const updated = await Cart.getByUser(req.user.id);
        try {
            const tracked = await trackCartActivity(req.user.id, { reason: 'cart_bulk_add' });
            await emitAbandonedCartUpdate(req, {
                userId: req.user.id,
                reason: 'cart_bulk_add',
                journeyId: tracked?.journeyId || null
            });
        } catch (err) {
            console.error('Abandoned-cart track error (bulk_add):', err?.message || err);
        }
        res.json({ items: updated });
    } catch (error) {
        console.error('Cart bulk error:', error);
        res.status(getCartMutationStatus(error)).json({ message: error?.message || 'Failed to merge cart' });
    }
};

module.exports = { getCart, addCartItem, updateCartItem, removeCartItem, clearCart, bulkAddCart };
