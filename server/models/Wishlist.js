const db = require('../config/db');

const normalizeProductId = (productId) => String(productId || '').trim();
const normalizeVariantId = (variantId) => String(variantId || '').trim();

const getWishlistTargetSnapshot = async (connection, productId, variantId = '') => {
    const safeProductId = normalizeProductId(productId);
    const safeVariantId = normalizeVariantId(variantId);
    if (!safeProductId) {
        throw new Error('productId required');
    }
    const [rows] = await connection.execute(
        `SELECT p.id as product_id, p.status as product_status,
                pv.id as resolved_variant_id
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
        variantId: safeVariantId
    };
};

class Wishlist {
    static async getByUser(userId, { withMeta = false } = {}) {
        const [rows] = await db.execute(
            `SELECT wi.product_id, wi.variant_id,
                    p.id as resolved_product_id,
                    p.status as product_status,
                    pv.id as resolved_variant_id
             FROM wishlist_items wi
             LEFT JOIN products p ON p.id = wi.product_id
             LEFT JOIN product_variants pv ON pv.id = wi.variant_id AND pv.product_id = wi.product_id
             WHERE wi.user_id = ?
             ORDER BY wi.created_at DESC`,
            [userId]
        );

        const validItems = [];
        const staleItems = [];
        for (const row of rows) {
            const productId = normalizeProductId(row.product_id);
            const variantId = normalizeVariantId(row.variant_id);
            const productExists = Boolean(row.resolved_product_id);
            const productActive = String(row.product_status || '').toLowerCase() === 'active';
            const variantValid = !variantId || Boolean(row.resolved_variant_id);
            if (!productId || !productExists || !productActive || !variantValid) {
                staleItems.push({ productId, variantId });
                continue;
            }
            validItems.push({ productId, variantId });
        }

        if (staleItems.length > 0) {
            const predicates = staleItems.map(() => '(product_id = ? AND variant_id = ?)').join(' OR ');
            const deleteParams = [userId];
            staleItems.forEach((entry) => {
                deleteParams.push(entry.productId, entry.variantId);
            });
            await db.execute(
                `DELETE FROM wishlist_items
                 WHERE user_id = ?
                   AND (${predicates})`,
                deleteParams
            );
        }

        if (withMeta) {
            return {
                items: validItems,
                prunedCount: staleItems.length
            };
        }
        return validItems;
    }

    static async addItem(userId, productId, variantId = '') {
        const snapshot = await getWishlistTargetSnapshot(db, productId, variantId);
        await db.execute(
            `INSERT INTO wishlist_items (user_id, product_id, variant_id)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE created_at = CURRENT_TIMESTAMP`,
            [userId, snapshot.productId, snapshot.variantId]
        );
    }

    static async removeItem(userId, productId, variantId = '', { removeAllVariants = false } = {}) {
        const normalizedVariantId = String(variantId || '').trim();
        if (removeAllVariants) {
            await db.execute(
                'DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ?',
                [userId, productId]
            );
            return;
        }
        await db.execute(
            'DELETE FROM wishlist_items WHERE user_id = ? AND product_id = ? AND variant_id = ?',
            [userId, productId, normalizedVariantId]
        );
    }

    static async removeForCartAdd(userId, productId, variantId = '') {
        const normalizedVariantId = String(variantId || '').trim();
        const [result] = await db.execute(
            `DELETE FROM wishlist_items
             WHERE user_id = ?
               AND product_id = ?
               AND (variant_id = '' OR variant_id = ?)`,
            [userId, productId, normalizedVariantId]
        );
        return Number(result?.affectedRows || 0);
    }

    static async clearUser(userId) {
        await db.execute(
            'DELETE FROM wishlist_items WHERE user_id = ?',
            [userId]
        );
    }
}

module.exports = Wishlist;
