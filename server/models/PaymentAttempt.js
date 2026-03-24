const db = require('../config/db');

const PAYMENT_STATUS = Object.freeze({
    CREATED: 'created',
    ATTEMPTED: 'attempted',
    PAID: 'paid',
    FAILED: 'failed',
    REFUNDED: 'refunded',
    EXPIRED: 'expired'
});

const parseJsonField = (value) => {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

class PaymentAttempt {
    static async getLatestRetryableByUser(userId) {
        const [rows] = await db.execute(
            `SELECT * FROM payment_attempts
             WHERE user_id = ?
               AND status IN (?, ?)
               AND local_order_id IS NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
            [userId, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            billing_address: parseJsonField(row.billing_address),
            shipping_address: parseJsonField(row.shipping_address),
            notes: parseJsonField(row.notes)
        };
    }

    static async getLatestRetryableForOrder({ userId, razorpayOrderId }) {
        const safeUserId = String(userId || '').trim();
        const safeRazorpayOrderId = String(razorpayOrderId || '').trim();
        if (!safeUserId || !safeRazorpayOrderId) return null;
        const [rows] = await db.execute(
            `SELECT * FROM payment_attempts
             WHERE user_id = ?
               AND razorpay_order_id = ?
               AND status IN (?, ?)
               AND local_order_id IS NULL
             ORDER BY updated_at DESC
             LIMIT 1`,
            [safeUserId, safeRazorpayOrderId, PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            billing_address: parseJsonField(row.billing_address),
            shipping_address: parseJsonField(row.shipping_address),
            notes: parseJsonField(row.notes)
        };
    }

    static async create({
        userId,
        razorpayOrderId,
        amountSubunits,
        currency = 'INR',
        billingAddress = null,
        shippingAddress = null,
        notes = null,
        expiresAt = null
    }) {
        const [result] = await db.execute(
            `INSERT INTO payment_attempts
                (user_id, razorpay_order_id, amount_subunits, currency, status, expires_at, billing_address, shipping_address, notes)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                userId,
                razorpayOrderId,
                Number(amountSubunits || 0),
                currency,
                PAYMENT_STATUS.CREATED,
                expiresAt || null,
                JSON.stringify(billingAddress || null),
                JSON.stringify(shippingAddress || null),
                JSON.stringify(notes || null)
            ]
        );
        return { id: result.insertId };
    }

    static async getByRazorpayOrderId({ userId, razorpayOrderId }) {
        const [rows] = await db.execute(
            'SELECT * FROM payment_attempts WHERE user_id = ? AND razorpay_order_id = ? LIMIT 1',
            [userId, razorpayOrderId]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            billing_address: parseJsonField(row.billing_address),
            shipping_address: parseJsonField(row.shipping_address),
            notes: parseJsonField(row.notes)
        };
    }

    static async getByRazorpayOrderIdAny(razorpayOrderId) {
        const [rows] = await db.execute(
            'SELECT * FROM payment_attempts WHERE razorpay_order_id = ? LIMIT 1',
            [razorpayOrderId]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            billing_address: parseJsonField(row.billing_address),
            shipping_address: parseJsonField(row.shipping_address),
            notes: parseJsonField(row.notes)
        };
    }

    static async getById(id) {
        const [rows] = await db.execute(
            'SELECT * FROM payment_attempts WHERE id = ? LIMIT 1',
            [id]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            billing_address: parseJsonField(row.billing_address),
            shipping_address: parseJsonField(row.shipping_address),
            notes: parseJsonField(row.notes)
        };
    }

    static async beginVerificationLock({ id, paymentId = null, signature = null }) {
        const [result] = await db.execute(
            `UPDATE payment_attempts
             SET status = CASE
                    WHEN status = ? THEN ?
                    ELSE status
                 END,
                 verify_started_at = CURRENT_TIMESTAMP,
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                 razorpay_signature = COALESCE(?, razorpay_signature),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND local_order_id IS NULL
               AND status IN (?, ?, ?, ?)
               AND (verify_started_at IS NULL OR verify_started_at < DATE_SUB(NOW(), INTERVAL 60 SECOND))`,
            [
                PAYMENT_STATUS.CREATED,
                PAYMENT_STATUS.ATTEMPTED,
                paymentId,
                signature,
                id,
                PAYMENT_STATUS.CREATED,
                PAYMENT_STATUS.ATTEMPTED,
                PAYMENT_STATUS.FAILED,
                PAYMENT_STATUS.PAID
            ]
        );
        return Number(result?.affectedRows || 0) > 0;
    }

    static async markFailed({ id, paymentId = null, signature = null, errorMessage = null }) {
        await db.execute(
            `UPDATE payment_attempts
             SET status = ?,
                 verify_started_at = NULL,
                 razorpay_payment_id = ?,
                 razorpay_signature = ?,
                 failure_reason = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [PAYMENT_STATUS.FAILED, paymentId, signature, errorMessage ? String(errorMessage).slice(0, 500) : null, id]
        );
    }

    static async markVerified({ id, paymentId, signature, localOrderId }) {
        const [result] = await db.execute(
            `UPDATE payment_attempts
             SET status = ?,
                 verify_started_at = NULL,
                 razorpay_payment_id = ?,
                 razorpay_signature = ?,
                 local_order_id = ?,
                 verified_at = CURRENT_TIMESTAMP,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND local_order_id IS NULL`,
            [PAYMENT_STATUS.PAID, paymentId, signature, localOrderId, id]
        );
        return Number(result?.affectedRows || 0) > 0;
    }

    static async markPaidByRazorpayOrder({
        razorpayOrderId,
        paymentId = null,
        signature = null
    }) {
        await db.execute(
            `UPDATE payment_attempts
             SET status = ?,
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                 razorpay_signature = COALESCE(?, razorpay_signature),
                 updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_order_id = ?`,
            [PAYMENT_STATUS.PAID, paymentId, signature, razorpayOrderId]
        );
    }

    static async markAttemptedByRazorpayOrder({
        razorpayOrderId,
        paymentId = null
    }) {
        await db.execute(
            `UPDATE payment_attempts
             SET status = ?,
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                 updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_order_id = ?`,
            [PAYMENT_STATUS.ATTEMPTED, paymentId, razorpayOrderId]
        );
    }

    static async markFailedByRazorpayOrder({
        razorpayOrderId,
        paymentId = null,
        errorMessage = null
    }) {
        await db.execute(
            `UPDATE payment_attempts
             SET status = ?,
                 verify_started_at = NULL,
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                 failure_reason = COALESCE(?, failure_reason),
                 updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_order_id = ?`,
            [PAYMENT_STATUS.FAILED, paymentId, errorMessage ? String(errorMessage).slice(0, 500) : null, razorpayOrderId]
        );
    }

    static async reserveInventoryForAttempt({ attemptId, userId, expiresAt }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [existing] = await connection.execute(
                `SELECT id FROM payment_item_reservations
                 WHERE attempt_id = ? AND status = 'reserved'
                 LIMIT 1`,
                [attemptId]
            );
            if (existing.length) {
                await connection.commit();
                return { reservedItems: 0, reused: true };
            }

            const [cartRows] = await connection.execute(
                `SELECT ci.product_id, ci.variant_id, ci.quantity,
                        p.status as product_status, p.track_quantity as product_track_quantity,
                        pv.id as resolved_variant_id, pv.track_quantity as variant_track_quantity
                 FROM cart_items ci
                 JOIN products p ON p.id = ci.product_id
                 LEFT JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
                 WHERE ci.user_id = ?`,
                [userId]
            );

            if (!cartRows.length) {
                throw new Error('Cart is empty');
            }

            let reservedItems = 0;
            const touchedProductIds = new Set();
            for (const row of cartRows) {
                const quantity = Number(row.quantity || 0);
                if (quantity <= 0) continue;
                if (row.product_status && row.product_status !== 'active') {
                    throw new Error('Some items are no longer available');
                }
                if (row.variant_id && !row.resolved_variant_id) {
                    throw new Error('Some selected variants are unavailable');
                }

                const hasVariant = !!row.variant_id;
                if (hasVariant) {
                    const [variantRows] = await connection.execute(
                        'SELECT quantity, track_quantity FROM product_variants WHERE id = ? FOR UPDATE',
                        [row.variant_id]
                    );
                    const variant = variantRows[0];
                    if (!variant) throw new Error('Variant not found');
                    if (Number(variant.track_quantity) === 1 && Number(variant.quantity) < quantity) {
                        throw new Error('Insufficient stock for some items');
                    }
                    if (Number(variant.track_quantity) === 1) {
                        await connection.execute(
                            'UPDATE product_variants SET quantity = quantity - ? WHERE id = ?',
                            [quantity, row.variant_id]
                        );
                    }
                } else {
                    const [productRows] = await connection.execute(
                        'SELECT quantity, track_quantity FROM products WHERE id = ? FOR UPDATE',
                        [row.product_id]
                    );
                    const product = productRows[0];
                    if (!product) throw new Error('Product not found');
                    if (Number(product.track_quantity) === 1 && Number(product.quantity) < quantity) {
                        throw new Error('Insufficient stock for some items');
                    }
                    if (Number(product.track_quantity) === 1) {
                        await connection.execute(
                            'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                            [quantity, row.product_id]
                        );
                    }
                }

                await connection.execute(
                    `INSERT INTO payment_item_reservations
                        (attempt_id, user_id, product_id, variant_id, quantity, status, expires_at)
                     VALUES (?, ?, ?, ?, ?, 'reserved', ?)`,
                    [
                        attemptId,
                        userId,
                        row.product_id,
                        row.variant_id || '',
                        quantity,
                        expiresAt || null
                    ]
                );
                reservedItems += 1;
                touchedProductIds.add(String(row.product_id || '').trim());
            }

            if (!reservedItems) {
                throw new Error('Cart is empty');
            }

            await connection.commit();
            return { reservedItems, reused: false, productIds: [...touchedProductIds] };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async releaseInventoryForAttempt({ attemptId, reason = 'released' }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute(
                `SELECT * FROM payment_item_reservations
                 WHERE attempt_id = ? AND status = 'reserved'
                 FOR UPDATE`,
                [attemptId]
            );
            if (!rows.length) {
                await connection.commit();
                return { released: 0, productIds: [] };
            }

            const touchedProductIds = new Set();
            for (const row of rows) {
                const qty = Number(row.quantity || 0);
                if (qty <= 0) continue;
                if (row.variant_id) {
                    await connection.execute(
                        'UPDATE product_variants SET quantity = quantity + ? WHERE id = ?',
                        [qty, row.variant_id]
                    );
                } else {
                    await connection.execute(
                        'UPDATE products SET quantity = quantity + ? WHERE id = ?',
                        [qty, row.product_id]
                    );
                }
                touchedProductIds.add(String(row.product_id || '').trim());
            }

            await connection.execute(
                `UPDATE payment_item_reservations
                 SET status = 'released',
                     released_reason = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE attempt_id = ? AND status = 'reserved'`,
                [String(reason).slice(0, 100), attemptId]
            );
            await connection.commit();
            return { released: rows.length, productIds: [...touchedProductIds] };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async consumeInventoryForAttempt({ attemptId }) {
        const [rows] = await db.execute(
            `SELECT product_id
             FROM payment_item_reservations
             WHERE attempt_id = ? AND status = 'reserved'`,
            [attemptId]
        );
        await db.execute(
            `UPDATE payment_item_reservations
             SET status = 'consumed', updated_at = CURRENT_TIMESTAMP
             WHERE attempt_id = ? AND status = 'reserved'`,
            [attemptId]
        );
        return {
            productIds: [...new Set((rows || []).map((row) => String(row.product_id || '').trim()).filter(Boolean))]
        };
    }

    static async expireStaleAttempts({ ttlMinutes = 30 } = {}) {
        const [rows] = await db.execute(
            `SELECT id FROM payment_attempts
             WHERE local_order_id IS NULL
               AND status IN (?, ?)
               AND created_at < DATE_SUB(NOW(), INTERVAL ? MINUTE)`,
            [PAYMENT_STATUS.CREATED, PAYMENT_STATUS.ATTEMPTED, Number(ttlMinutes || 30)]
        );
        let expired = 0;
        for (const row of rows) {
            await PaymentAttempt.releaseInventoryForAttempt({
                attemptId: row.id,
                reason: 'expired'
            });
            await db.execute(
                `UPDATE payment_attempts
                 SET status = ?, verify_started_at = NULL, updated_at = CURRENT_TIMESTAMP
                 WHERE id = ? AND local_order_id IS NULL`,
                [PAYMENT_STATUS.EXPIRED, row.id]
            );
            expired += 1;
        }
        return { expired };
    }

    static async createRetryAttempt({ userId, sourceAttemptId, razorpayOrderId, expiresAt }) {
        const source = await PaymentAttempt.getById(sourceAttemptId);
        if (!source || String(source.user_id) !== String(userId)) {
            throw new Error('Payment attempt not found');
        }
        if (![PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED].includes(String(source.status))) {
            throw new Error('Retry is allowed only for failed or expired attempts');
        }
        return PaymentAttempt.create({
            userId,
            razorpayOrderId,
            amountSubunits: Number(source.amount_subunits || 0),
            currency: source.currency || 'INR',
            billingAddress: source.billing_address || null,
            shippingAddress: source.shipping_address || null,
            notes: source.notes || null,
            expiresAt
        });
    }

    static async deleteById(id) {
        const [result] = await db.execute(
            'DELETE FROM payment_attempts WHERE id = ? AND local_order_id IS NULL',
            [id]
        );
        return Number(result?.affectedRows || 0) > 0;
    }
}

module.exports = { PaymentAttempt, PAYMENT_STATUS };
