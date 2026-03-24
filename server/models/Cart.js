const db = require('../config/db');

const parseMedia = (media) => {
    try {
        const raw = typeof media === 'string' ? JSON.parse(media) : media;
        if (!Array.isArray(raw)) return [];
        return raw.map(m => (m && typeof m === 'object' && m.url) ? m.url : m).filter(Boolean);
    } catch {
        return [];
    }
};

const parseCategories = (categories) => {
    try {
        const raw = typeof categories === 'string' ? JSON.parse(categories) : categories;
        return Array.isArray(raw) ? raw.filter(Boolean) : [];
    } catch {
        return [];
    }
};

const normalizeVariantId = (variantId) => (variantId ? String(variantId) : '');
const normalizeProductId = (productId) => String(productId || '').trim();
const toTracked = (value) => value === 1 || value === true || value === '1' || value === 'true';
const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const MAX_CART_ITEM_QUANTITY = 99;

const normalizeRequestedQuantity = (quantity, { allowZero = false } = {}) => {
    const raw = Math.floor(Number(quantity));
    if (!Number.isFinite(raw)) return allowZero ? 0 : 1;
    if (allowZero && raw <= 0) return 0;
    return Math.max(1, Math.min(MAX_CART_ITEM_QUANTITY, raw));
};

const getCartTargetSnapshot = async (connection, productId, variantId = '') => {
    const safeProductId = normalizeProductId(productId);
    const safeVariantId = normalizeVariantId(variantId);
    if (!safeProductId) {
        throw new Error('productId required');
    }
    const [rows] = await connection.execute(
        `SELECT p.id as product_id, p.status as product_status,
                p.track_quantity as product_track_quantity, p.quantity as product_quantity,
                pv.id as resolved_variant_id, pv.product_id as variant_product_id,
                pv.track_quantity as variant_track_quantity, pv.quantity as variant_quantity
         FROM products p
         LEFT JOIN product_variants pv ON pv.id = ? AND pv.product_id = p.id
         WHERE p.id = ?
         LIMIT 1`,
        [safeVariantId || null, safeProductId]
    );
    const row = rows[0];
    if (!row) {
        throw new Error('Product not found');
    }
    if (String(row.product_status || '').toLowerCase() !== 'active') {
        throw new Error('This product is unavailable');
    }
    if (safeVariantId && !row.resolved_variant_id) {
        throw new Error('Selected variant is unavailable');
    }
    return {
        productId: safeProductId,
        variantId: safeVariantId,
        trackQuantity: safeVariantId ? toTracked(row.variant_track_quantity) : toTracked(row.product_track_quantity),
        availableQuantity: safeVariantId ? toNumber(row.variant_quantity, 0) : toNumber(row.product_quantity, 0)
    };
};

const assertCartQuantityAllowed = ({ requestedQuantity, trackQuantity, availableQuantity }) => {
    if (!trackQuantity) return;
    if (requestedQuantity > availableQuantity) {
        throw new Error(`Only ${availableQuantity} item(s) available`);
    }
};

const getExistingCartQuantity = async (connection, userId, productId, variantId = '') => {
    const [rows] = await connection.execute(
        'SELECT quantity FROM cart_items WHERE user_id = ? AND product_id = ? AND variant_id = ? LIMIT 1',
        [userId, productId, normalizeVariantId(variantId)]
    );
    return toNumber(rows[0]?.quantity, 0);
};

const persistCartQuantity = async (connection, userId, productId, variantId, quantity) => {
    const safeVariantId = normalizeVariantId(variantId);
    if (quantity <= 0) {
        await connection.execute(
            'DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND variant_id = ?',
            [userId, productId, safeVariantId]
        );
        return;
    }
    await connection.execute(
        `INSERT INTO cart_items (user_id, product_id, variant_id, quantity)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE quantity = VALUES(quantity)`,
        [userId, productId, safeVariantId, quantity]
    );
};

class Cart {
    static async getByUser(userId) {
        const [rows] = await db.execute(
            `SELECT 
                ci.user_id, ci.product_id, ci.variant_id, ci.quantity,
                p.title, p.media, p.categories, p.mrp, p.discount_price, p.status, p.weight_kg as product_weight_kg, p.track_quantity as product_track_quantity, p.quantity as product_quantity,
                p.track_low_stock as product_track_low_stock, p.low_stock_threshold as product_low_stock_threshold,
                pv.id as resolved_variant_id, pv.variant_title, pv.price as variant_price, pv.discount_price as variant_discount_price, pv.image_url as variant_image_url, pv.weight_kg as variant_weight_kg, pv.track_quantity as variant_track_quantity, pv.quantity as variant_quantity,
                pv.track_low_stock as variant_track_low_stock, pv.low_stock_threshold as variant_low_stock_threshold
             FROM cart_items ci
             JOIN products p ON p.id = ci.product_id
             LEFT JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
             WHERE ci.user_id = ?
             ORDER BY ci.updated_at DESC`,
            [userId]
        );

        return rows.map(r => {
            const hasInvalidVariant = Boolean(r.variant_id && !r.resolved_variant_id);
            const media = parseMedia(r.media);
            const imageUrl = r.variant_image_url || media[0] || null;
            const price = r.variant_discount_price || r.variant_price || r.discount_price || r.mrp || 0;
            const trackQuantity = hasInvalidVariant
                ? true
                : (r.variant_id ? toTracked(r.variant_track_quantity) : toTracked(r.product_track_quantity));
            const availableQuantity = hasInvalidVariant
                ? 0
                : (r.variant_id ? toNumber(r.variant_quantity, 0) : toNumber(r.product_quantity, 0));
            const trackLowStock = hasInvalidVariant
                ? false
                : (r.variant_id ? toTracked(r.variant_track_low_stock) : toTracked(r.product_track_low_stock));
            const lowStockThreshold = hasInvalidVariant
                ? 0
                : (r.variant_id ? toNumber(r.variant_low_stock_threshold, 0) : toNumber(r.product_low_stock_threshold, 0));
            const status = hasInvalidVariant ? 'inactive' : r.status;
            const isOutOfStock = Boolean(hasInvalidVariant || (trackQuantity && availableQuantity <= 0));
            const isLowStock = Boolean(trackQuantity && trackLowStock && availableQuantity > 0 && availableQuantity <= lowStockThreshold);
            return {
                productId: r.product_id,
                variantId: r.variant_id || '',
                quantity: r.quantity,
                title: r.title,
                status,
                categories: parseCategories(r.categories),
                imageUrl,
                price: Number(price),
                compareAt: Number(r.variant_price || r.mrp || 0),
                variantTitle: r.variant_title || null,
                weightKg: Number(r.variant_weight_kg || r.product_weight_kg || 0),
                trackQuantity,
                trackLowStock,
                availableQuantity,
                lowStockThreshold,
                isLowStock,
                isOutOfStock
            };
        });
    }

    static async addItem(userId, productId, variantId, quantity = 1) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const safeProductId = normalizeProductId(productId);
            const safeVariantId = normalizeVariantId(variantId);
            const requestedQty = normalizeRequestedQuantity(quantity);
            const target = await getCartTargetSnapshot(connection, safeProductId, safeVariantId);
            const existingQty = await getExistingCartQuantity(connection, userId, safeProductId, safeVariantId);
            const nextQty = Math.min(MAX_CART_ITEM_QUANTITY, existingQty + requestedQty);
            assertCartQuantityAllowed({
                requestedQuantity: nextQty,
                trackQuantity: target.trackQuantity,
                availableQuantity: target.availableQuantity
            });
            await persistCartQuantity(connection, userId, safeProductId, safeVariantId, nextQty);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async setItemQuantity(userId, productId, variantId, quantity) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const safeProductId = normalizeProductId(productId);
            const safeVariantId = normalizeVariantId(variantId);
            const requestedQty = normalizeRequestedQuantity(quantity, { allowZero: true });
            if (requestedQty <= 0) {
                await persistCartQuantity(connection, userId, safeProductId, safeVariantId, 0);
                await connection.commit();
                return;
            }
            const target = await getCartTargetSnapshot(connection, safeProductId, safeVariantId);
            assertCartQuantityAllowed({
                requestedQuantity: requestedQty,
                trackQuantity: target.trackQuantity,
                availableQuantity: target.availableQuantity
            });
            await persistCartQuantity(connection, userId, safeProductId, safeVariantId, requestedQty);
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async removeItem(userId, productId, variantId) {
        const vid = normalizeVariantId(variantId);
        await db.execute(
            'DELETE FROM cart_items WHERE user_id = ? AND product_id = ? AND variant_id = ?',
            [userId, productId, vid]
        );
    }

    static async clearUser(userId) {
        await db.execute('DELETE FROM cart_items WHERE user_id = ?', [userId]);
    }

    static async bulkAdd(userId, items = []) {
        if (!Array.isArray(items) || items.length === 0) return;
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const normalizedItems = new Map();
            for (const item of items) {
                if (!item || !item.productId) continue;
                const safeProductId = normalizeProductId(item.productId);
                const safeVariantId = normalizeVariantId(item.variantId);
                const key = `${safeProductId}::${safeVariantId}`;
                const qty = normalizeRequestedQuantity(item.quantity);
                normalizedItems.set(key, {
                    productId: safeProductId,
                    variantId: safeVariantId,
                    quantity: Math.min(
                        MAX_CART_ITEM_QUANTITY,
                        toNumber(normalizedItems.get(key)?.quantity, 0) + qty
                    )
                });
            }
            for (const item of normalizedItems.values()) {
                const target = await getCartTargetSnapshot(connection, item.productId, item.variantId);
                const existingQty = await getExistingCartQuantity(connection, userId, item.productId, item.variantId);
                const nextQty = Math.min(MAX_CART_ITEM_QUANTITY, existingQty + item.quantity);
                assertCartQuantityAllowed({
                    requestedQuantity: nextQty,
                    trackQuantity: target.trackQuantity,
                    availableQuantity: target.availableQuantity
                });
                await persistCartQuantity(connection, userId, item.productId, item.variantId, nextQty);
            }
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = Cart;
