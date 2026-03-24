const db = require('../config/db');
const AbandonedCart = require('./AbandonedCart');

const toSubunits = (amount) => Math.round(Number(amount || 0) * 100);
const fromSubunits = (subunits) => Number(subunits || 0) / 100;

const nowInSql = () => new Date();

const normalizeCode = (value = '') => String(value || '').trim().toUpperCase();

const randomSegment = (length = 4) => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < length; i += 1) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
};

const generateCouponCode = (prefix = 'SSC') => {
    const p = String(prefix || 'SSC').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 6) || 'SSC';
    return `${p}-${randomSegment(4)}-${randomSegment(4)}`;
};

const parseJson = (value, fallback = null) => {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const isWithinDateWindow = (row) => {
    const now = new Date();
    const startsAt = row?.starts_at ? new Date(row.starts_at) : null;
    const expiresAt = row?.expires_at ? new Date(row.expires_at) : null;
    if (startsAt && !Number.isNaN(startsAt.getTime()) && now < startsAt) return false;
    if (expiresAt && !Number.isNaN(expiresAt.getTime()) && now > expiresAt) return false;
    return true;
};

const normalizeDiscountType = (value = 'percent') => {
    const type = String(value || 'percent').toLowerCase();
    if (['fixed', 'percent', 'shipping_full', 'shipping_partial'].includes(type)) return type;
    return 'percent';
};

class Coupon {
    static async autoArchiveStaleCoupons({ connection = db } = {}) {
        // 1) Expired coupons should not stay active in admin management tables.
        await connection.execute(
            `UPDATE coupons
             SET is_active = 0,
                 updated_at = CURRENT_TIMESTAMP
             WHERE is_active = 1
               AND expires_at IS NOT NULL
               AND expires_at < NOW()`
        );

        // 2) Coupons with exhausted global usage should be archived.
        await connection.execute(
            `UPDATE coupons c
             LEFT JOIN (
                SELECT coupon_id, COUNT(*) AS used_count
                FROM coupon_redemptions
                GROUP BY coupon_id
             ) usage_stats ON usage_stats.coupon_id = c.id
             SET c.is_active = 0,
                 c.updated_at = CURRENT_TIMESTAMP
             WHERE c.is_active = 1
               AND c.usage_limit_total IS NOT NULL
               AND COALESCE(usage_stats.used_count, 0) >= c.usage_limit_total`
        );

        // 3) Customer-target coupons are archived once all targeted users exhaust per-user usage.
        await connection.execute(
            `UPDATE coupons c
             JOIN (
                SELECT cut.coupon_id,
                       COUNT(*) AS target_count,
                       SUM(
                           CASE
                               WHEN COALESCE(user_usage.used_by_user, 0) >= GREATEST(1, COALESCE(c2.usage_limit_per_user, 1))
                               THEN 1 ELSE 0
                           END
                       ) AS exhausted_targets
                FROM coupon_user_targets cut
                JOIN coupons c2 ON c2.id = cut.coupon_id
                LEFT JOIN (
                    SELECT coupon_id, user_id, COUNT(*) AS used_by_user
                    FROM coupon_redemptions
                    GROUP BY coupon_id, user_id
                ) user_usage
                    ON user_usage.coupon_id = cut.coupon_id
                   AND user_usage.user_id = cut.user_id
                GROUP BY cut.coupon_id
             ) target_stats ON target_stats.coupon_id = c.id
             SET c.is_active = 0,
                 c.updated_at = CURRENT_TIMESTAMP
             WHERE c.is_active = 1
               AND c.scope_type = 'customer'
               AND target_stats.target_count > 0
               AND target_stats.exhausted_targets >= target_stats.target_count`
        );
    }

    static async generateUniqueCode({ connection = db, prefix = 'SSC' } = {}) {
        for (let i = 0; i < 10; i += 1) {
            const code = generateCouponCode(prefix);
            const [rows] = await connection.execute('SELECT id FROM coupons WHERE code = ? LIMIT 1', [code]);
            if (!rows.length) return code;
        }
        return `${String(prefix || 'SSC').toUpperCase()}-${Date.now().toString(36).toUpperCase().slice(-4)}-${randomSegment(4)}`;
    }

    static async createCoupon(payload = {}, { connection = db, createdBy = null } = {}) {
        const code = normalizeCode(payload.code || await Coupon.generateUniqueCode({ connection, prefix: payload.prefix || 'SSC' }));
        if (!code || code.length > 15) {
            throw new Error('Coupon code must be 1 to 15 characters');
        }
        const customerTargets = Array.isArray(payload.customerTargets) ? [...new Set(payload.customerTargets.map((id) => String(id || '').trim()).filter(Boolean))] : [];
        const categoryIds = Array.isArray(payload.categoryIds) ? [...new Set(payload.categoryIds.map((id) => Number(id)).filter((n) => Number.isFinite(n) && n > 0))] : [];
        const scopeType = String(payload.scopeType || 'generic').toLowerCase();
        const sourceType = String(payload.sourceType || 'admin').toLowerCase();
        const discountType = normalizeDiscountType(payload.discountType || 'percent');
        const discountValue = Number(payload.discountValue || 0);
        if (discountType !== 'shipping_full' && (!Number.isFinite(discountValue) || discountValue <= 0)) {
            throw new Error('discountValue must be greater than 0');
        }
        if (!['generic', 'category', 'customer', 'tier'].includes(scopeType)) {
            throw new Error('Invalid scopeType');
        }
        const [existing] = await connection.execute('SELECT id FROM coupons WHERE code = ? LIMIT 1', [code]);
        if (existing.length) throw new Error('Coupon code already exists');

        const normalizedMaxDiscount = payload.maxDiscount ?? payload.maxDiscountValue ?? payload.max_discount_value;
        const maxDiscountSubunits = (() => {
            if (normalizedMaxDiscount == null || normalizedMaxDiscount === '') return null;
            const amount = Number(normalizedMaxDiscount);
            if (!Number.isFinite(amount) || amount <= 0) return null;
            return toSubunits(amount);
        })();
        const [result] = await connection.execute(
            `INSERT INTO coupons
                (code, name, description, source_type, scope_type, discount_type, discount_value, max_discount_subunits, min_cart_subunits, tier_scope, category_scope_json, starts_at, expires_at, usage_limit_total, usage_limit_per_user, metadata_json, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                code,
                String(payload.name || code).slice(0, 120),
                payload.description ? String(payload.description).slice(0, 255) : null,
                sourceType,
                scopeType,
                discountType,
                discountValue,
                maxDiscountSubunits,
                payload.minCartValue != null ? toSubunits(payload.minCartValue) : 0,
                payload.tierScope ? String(payload.tierScope).toLowerCase() : null,
                categoryIds.length ? JSON.stringify(categoryIds) : null,
                payload.startsAt || null,
                payload.expiresAt || null,
                payload.usageLimitTotal != null ? Number(payload.usageLimitTotal) : null,
                Math.max(1, Number(payload.usageLimitPerUser || 1)),
                payload.metadata ? JSON.stringify(payload.metadata) : null,
                payload.isActive === false ? 0 : 1,
                createdBy || null
            ]
        );
        const couponId = Number(result.insertId);
        if (customerTargets.length) {
            for (const userId of customerTargets) {
                await connection.execute(
                    'INSERT IGNORE INTO coupon_user_targets (coupon_id, user_id) VALUES (?, ?)',
                    [couponId, userId]
                );
            }
        }
        return Coupon.getById(couponId, { connection });
    }

    static async getById(couponId, { connection = db } = {}) {
        const [rows] = await connection.execute('SELECT * FROM coupons WHERE id = ? LIMIT 1', [couponId]);
        if (!rows.length) return null;
        const coupon = rows[0];
        const [targets] = await connection.execute('SELECT user_id FROM coupon_user_targets WHERE coupon_id = ?', [couponId]);
        return {
            ...coupon,
            category_scope_json: parseJson(coupon.category_scope_json, []),
            metadata_json: parseJson(coupon.metadata_json, null),
            customerTargets: targets.map((row) => row.user_id)
        };
    }

    static async getByCode(code, { connection = db } = {}) {
        const normalized = normalizeCode(code);
        if (!normalized) return null;
        const [rows] = await connection.execute('SELECT id FROM coupons WHERE code = ? LIMIT 1', [normalized]);
        if (!rows.length) return null;
        return Coupon.getById(rows[0].id, { connection });
    }

    static async getLatestActiveGenericCoupon({ connection = db } = {}) {
        const [rows] = await connection.execute(
            `SELECT *
             FROM coupons
             WHERE is_active = 1
               AND scope_type = 'generic'
               AND (starts_at IS NULL OR starts_at <= NOW())
               AND (expires_at IS NULL OR expires_at >= NOW())
             ORDER BY created_at DESC
             LIMIT 1`
        );
        if (!rows.length) return null;
        return rows[0];
    }

    static async deactivateCoupon(couponId, { connection = db } = {}) {
        const id = Number(couponId || 0);
        if (!Number.isFinite(id) || id <= 0) return 0;
        const [result] = await connection.execute(
            `UPDATE coupons
             SET is_active = 0,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND is_active = 1`,
            [id]
        );
        return Number(result?.affectedRows || 0);
    }

    static async deactivateCouponByCode(code, { connection = db } = {}) {
        const normalized = normalizeCode(code);
        if (!normalized) return 0;
        const [result] = await connection.execute(
            `UPDATE coupons
             SET is_active = 0,
                 updated_at = CURRENT_TIMESTAMP
             WHERE code = ?
               AND is_active = 1`,
            [normalized]
        );
        return Number(result?.affectedRows || 0);
    }

    static async listCoupons({ page = 1, limit = 20, search = '', sourceType = 'all' } = {}, { connection = db } = {}) {
        const safePage = Math.max(1, Number(page || 1));
        const safeLimit = Math.max(1, Math.min(500, Number(limit || 20)));
        const offset = (safePage - 1) * safeLimit;
        const normalizedSearch = String(search || '').trim();
        const normalizedSourceType = String(sourceType || 'all').trim().toLowerCase();
        const includeStandardCoupons = normalizedSourceType !== 'abandoned';
        const includeAbandonedCoupons = normalizedSourceType === 'all' || normalizedSourceType === 'abandoned';

        await Coupon.autoArchiveStaleCoupons({ connection });

        let rows = [];
        if (includeStandardCoupons) {
            const params = [];
            let where = `WHERE c.is_active = 1
                AND (c.starts_at IS NULL OR c.starts_at <= NOW())
                AND (c.expires_at IS NULL OR c.expires_at >= NOW())`;
            if (normalizedSearch) {
                where += ' AND (c.code LIKE ? OR c.name LIKE ?)';
                const term = `%${normalizedSearch}%`;
                params.push(term, term);
            }
            if (normalizedSourceType && normalizedSourceType !== 'all') {
                where += ' AND c.source_type = ?';
                params.push(normalizedSourceType);
            }
            const [couponRows] = await connection.execute(
                `SELECT c.*,
                        (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = c.id) as used_count
                 FROM coupons c
                 ${where}
                 ORDER BY c.created_at DESC`,
                params
            );
            rows = couponRows;
        }

        const couponIds = rows.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
        const customerTargetsByCoupon = new Map();
        if (couponIds.length > 0) {
            const placeholders = couponIds.map(() => '?').join(',');
            const [targetRows] = await connection.execute(
                `SELECT cut.coupon_id, cut.user_id,
                        COALESCE(u.name, '') as customer_name,
                        COALESCE(u.mobile, '') as customer_mobile,
                        COALESCE(u.email, '') as customer_email
                 FROM coupon_user_targets cut
                 LEFT JOIN users u ON u.id = cut.user_id
                 WHERE cut.coupon_id IN (${placeholders})`,
                couponIds
            );
            for (const row of targetRows) {
                const key = Number(row.coupon_id);
                if (!customerTargetsByCoupon.has(key)) customerTargetsByCoupon.set(key, []);
                customerTargetsByCoupon.get(key).push({
                    user_id: row.user_id,
                    name: row.customer_name || '',
                    mobile: row.customer_mobile || '',
                    email: row.customer_email || ''
                });
            }
        }

        let abandonedRows = [];
        if (includeAbandonedCoupons) {
            const abandonedParams = [];
            let abandonedWhere = `WHERE d.status = 'active'
                AND (d.expires_at IS NULL OR d.expires_at >= NOW())
                AND NOT EXISTS (
                    SELECT 1
                    FROM abandoned_cart_discounts dx
                    WHERE UPPER(dx.code) = UPPER(d.code)
                      AND dx.status = 'redeemed'
                )`;
            if (normalizedSearch) {
                abandonedWhere += ' AND (d.code LIKE ? OR u.name LIKE ? OR u.mobile LIKE ?)';
                const term = `%${normalizedSearch}%`;
                abandonedParams.push(term, term, term);
            }
            const [rawAbandonedRows] = await connection.execute(
                `SELECT d.id as abandoned_discount_id, d.user_id, d.journey_id, d.code, d.discount_type, d.discount_percent,
                        d.max_discount_subunits, d.min_cart_subunits, d.expires_at, d.created_at, d.updated_at,
                        COALESCE(u.name, '') as customer_name, COALESCE(u.mobile, '') as customer_mobile,
                        (SELECT COUNT(*) FROM abandoned_cart_discounts dx WHERE UPPER(dx.code) = UPPER(d.code) AND dx.status = 'redeemed') as used_count
                 FROM abandoned_cart_discounts d
                 LEFT JOIN users u ON u.id = d.user_id
                 ${abandonedWhere}
                 ORDER BY d.created_at DESC`,
                abandonedParams
            );
            abandonedRows = (Array.isArray(rawAbandonedRows) ? rawAbandonedRows : []).map((row) => ({
                id: `abandoned:${String(row.user_id || '').trim()}:${String(row.code || '').trim().toUpperCase()}`,
                code: String(row.code || '').trim().toUpperCase(),
                name: row.customer_name
                    ? `Abandoned Cart Recovery - ${row.customer_name}`
                    : 'Abandoned Cart Recovery',
                description: null,
                source_type: 'abandoned',
                scope_type: 'customer',
                discount_type: row.discount_type || 'percent',
                discount_value: Number(row.discount_percent || 0),
                max_discount_value: row.max_discount_subunits != null ? fromSubunits(row.max_discount_subunits) : null,
                max_discount_subunits: row.max_discount_subunits ?? null,
                min_cart_subunits: Number(row.min_cart_subunits || 0),
                starts_at: null,
                expires_at: row.expires_at || null,
                usage_limit_total: 1,
                usage_limit_per_user: 1,
                category_scope_json: [],
                metadata_json: {
                    journeyId: row.journey_id || null,
                    userId: row.user_id || null,
                    customerName: row.customer_name || '',
                    customerMobile: row.customer_mobile || ''
                },
                used_count: Number(row.used_count || 0),
                customer_targets: row.user_id
                    ? [{
                        user_id: row.user_id,
                        name: row.customer_name || '',
                        mobile: row.customer_mobile || '',
                        email: ''
                    }]
                    : [],
                created_at: row.created_at || null,
                updated_at: row.updated_at || null
            })).filter((row) => row.code);
        }

        const standardCoupons = rows.map((row) => ({
            ...row,
            max_discount_value: row.max_discount_subunits != null ? fromSubunits(row.max_discount_subunits) : null,
            category_scope_json: parseJson(row.category_scope_json, []),
            metadata_json: parseJson(row.metadata_json, null),
            used_count: Number(row.used_count || 0),
            customer_targets: customerTargetsByCoupon.get(Number(row.id)) || []
        }));

        const merged = [...standardCoupons, ...abandonedRows].sort(
            (a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime()
        );
        const total = merged.length;
        const paged = merged.slice(offset, offset + safeLimit);

        return {
            coupons: paged,
            total,
            totalPages: Math.ceil(total / safeLimit)
        };
    }

    static async resolveRedeemableCoupon({
        code,
        userId,
        cartTotalSubunits = 0,
        shippingFeeSubunits = 0,
        loyaltyTier = 'regular',
        cartProductIds = [],
        connection = db
    } = {}) {
        const normalized = normalizeCode(code);
        if (!normalized) return null;

        const [rows] = await connection.execute(
            `SELECT c.*
             FROM coupons c
             WHERE c.code = ?
               AND c.is_active = 1
             LIMIT 1`,
            [normalized]
        );
        if (rows.length) {
            const coupon = rows[0];
            if (!isWithinDateWindow(coupon)) return null;
            const minCart = Number(coupon.min_cart_subunits || 0);
            if (Number(cartTotalSubunits || 0) < minCart) return null;

            const [totalUsageRows] = await connection.execute(
                'SELECT COUNT(*) as count FROM coupon_redemptions WHERE coupon_id = ?',
                [coupon.id]
            );
            const totalUsed = Number(totalUsageRows[0]?.count || 0);
            if (coupon.usage_limit_total != null && totalUsed >= Number(coupon.usage_limit_total || 0)) return null;

            const [userUsageRows] = await connection.execute(
                'SELECT COUNT(*) as count FROM coupon_redemptions WHERE coupon_id = ? AND user_id = ?',
                [coupon.id, userId]
            );
            const userUsed = Number(userUsageRows[0]?.count || 0);
            if (userUsed >= Math.max(1, Number(coupon.usage_limit_per_user || 1))) return null;

            const scope = String(coupon.scope_type || 'generic').toLowerCase();
            if (scope === 'customer') {
                const [targetRows] = await connection.execute(
                    'SELECT 1 FROM coupon_user_targets WHERE coupon_id = ? AND user_id = ? LIMIT 1',
                    [coupon.id, userId]
                );
                if (!targetRows.length) return null;
            }
            if (scope === 'tier') {
                const tierScope = String(coupon.tier_scope || '').toLowerCase();
                if (tierScope && tierScope !== String(loyaltyTier || 'regular').toLowerCase()) return null;
            }
            if (scope === 'category') {
                const categoryIds = parseJson(coupon.category_scope_json, []);
                if (!Array.isArray(categoryIds) || !categoryIds.length) return null;
                const products = Array.isArray(cartProductIds) ? [...new Set(cartProductIds.map((id) => String(id || '').trim()).filter(Boolean))] : [];
                if (!products.length) return null;
                const placeholders = products.map(() => '?').join(',');
                const categoryPlaceholders = categoryIds.map(() => '?').join(',');
                const [matchRows] = await connection.execute(
                    `SELECT 1
                     FROM product_categories
                     WHERE product_id IN (${placeholders})
                       AND category_id IN (${categoryPlaceholders})
                     LIMIT 1`,
                    [...products, ...categoryIds]
                );
                if (!matchRows.length) return null;
            }

            const discountType = normalizeDiscountType(coupon.discount_type || 'percent');
            let discountSubunits = 0;
            if (discountType === 'fixed') {
                const fixedSubunits = toSubunits(coupon.discount_value);
                if (Number(cartTotalSubunits || 0) < fixedSubunits) return null;
                discountSubunits = toSubunits(coupon.discount_value);
            } else if (discountType === 'shipping_full') {
                discountSubunits = Number(shippingFeeSubunits || 0);
            } else if (discountType === 'shipping_partial') {
                discountSubunits = Math.round(Number(shippingFeeSubunits || 0) * (Number(coupon.discount_value || 0) / 100));
            } else {
                discountSubunits = Math.round(Number(cartTotalSubunits || 0) * (Number(coupon.discount_value || 0) / 100));
            }
            if (coupon.max_discount_subunits != null && Number(coupon.max_discount_subunits || 0) > 0) {
                discountSubunits = Math.min(discountSubunits, Number(coupon.max_discount_subunits || 0));
            }
            const maxEligibleBase = ['shipping_full', 'shipping_partial'].includes(discountType)
                ? Number(shippingFeeSubunits || 0)
                : Number(cartTotalSubunits || 0);
            discountSubunits = Math.max(0, Math.min(discountSubunits, maxEligibleBase));
            if (discountSubunits <= 0) return null;

            return {
                source: 'coupon',
                id: coupon.id,
                code: coupon.code,
                type: discountType,
                percent: ['percent', 'shipping_partial'].includes(discountType) ? Number(coupon.discount_value || 0) : 0,
                fixedAmount: discountType === 'fixed' ? Number(coupon.discount_value || 0) : 0,
                discountSubunits,
                journeyId: null,
                couponRow: coupon
            };
        }

        const recovery = await AbandonedCart.getRedeemableDiscount({
            code: normalized,
            userId,
            cartTotalSubunits,
            connection
        });
        if (!recovery) return null;
        return {
            source: 'abandoned',
            id: recovery.id,
            code: recovery.code,
            type: recovery.discount_type || 'percent',
            percent: Number(recovery.discount_percent || 0),
            fixedAmount: 0,
            discountSubunits: Number(recovery.discountSubunits || 0),
            journeyId: recovery.journey_id || null
        };
    }

    static async markRedeemed({ source = 'coupon', id, orderId = null, userId = null, connection = db } = {}) {
        if (!id) return 0;
        if (source === 'abandoned') {
            await AbandonedCart.markDiscountRedeemed({
                discountId: id,
                orderId,
                connection
            });
            return 1;
        }
        await connection.execute(
            `INSERT INTO coupon_redemptions (coupon_id, user_id, order_id, year_key)
             VALUES (?, ?, ?, ?)`,
            [id, userId, orderId || null, new Date().getFullYear()]
        );
        return 1;
    }

    static async getAvailableCouponsForUser({
        userId,
        loyaltyTier = 'regular',
        cartTotalSubunits = 0,
        cartProductIds = [],
        shippingFeeSubunits = 0
    } = {}) {
        if (!userId) return [];
        const [rows] = await db.execute(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = c.id) as used_count,
                    (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = c.id AND cr.user_id = ?) as used_by_user,
                    EXISTS(SELECT 1 FROM coupon_user_targets cut WHERE cut.coupon_id = c.id AND cut.user_id = ?) as is_user_target
             FROM coupons c
             WHERE c.is_active = 1
             ORDER BY c.created_at DESC
             LIMIT 500`,
            [userId, userId]
        );
        const out = [];
        for (const row of rows) {
            const scope = String(row.scope_type || 'generic').toLowerCase();
            if (!isWithinDateWindow(row)) continue;
            if (row.usage_limit_total != null && Number(row.used_count || 0) >= Number(row.usage_limit_total || 0)) continue;
            if (Number(row.used_by_user || 0) >= Math.max(1, Number(row.usage_limit_per_user || 1))) continue;
            if (scope === 'customer' && Number(row.is_user_target || 0) !== 1) continue;
            if (scope === 'tier') {
                const tierScope = String(row.tier_scope || '').toLowerCase();
                if (tierScope && tierScope !== String(loyaltyTier || 'regular').toLowerCase()) continue;
            }
            if (scope === 'category') {
                const categoryIds = parseJson(row.category_scope_json, []);
                if (!Array.isArray(categoryIds) || !categoryIds.length) continue;
                const products = [...new Set((cartProductIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
                if (!products.length) continue;
                const placeholders = products.map(() => '?').join(',');
                const categoryPlaceholders = categoryIds.map(() => '?').join(',');
                const [matchRows] = await db.execute(
                    `SELECT 1 FROM product_categories
                     WHERE product_id IN (${placeholders})
                       AND category_id IN (${categoryPlaceholders})
                     LIMIT 1`,
                    [...products, ...categoryIds]
                );
                if (!matchRows.length) continue;
            }
            const minCartSubunits = Number(row.min_cart_subunits || 0);
            const fixedDiscountSubunits = String(row.discount_type || '').toLowerCase() === 'fixed'
                ? toSubunits(row.discount_value || 0)
                : 0;
            const shippingDiscountType = String(row.discount_type || '').toLowerCase();
            const requiredCartSubunits = Math.max(minCartSubunits, fixedDiscountSubunits);
            const currentCartSubunits = Number(cartTotalSubunits || 0);
            const hasShippingCharge = Number(shippingFeeSubunits || 0) > 0;
            const isEligible = currentCartSubunits >= requiredCartSubunits
                && (
                    !['shipping_full', 'shipping_partial'].includes(shippingDiscountType)
                    || hasShippingCharge
                );
            out.push({
                id: row.id,
                code: row.code,
                name: row.name,
                sourceType: row.source_type,
                scopeType: row.scope_type,
                discountType: row.discount_type,
                discountValue: Number(row.discount_value || 0),
                maxDiscountValue: row.max_discount_subunits != null ? fromSubunits(row.max_discount_subunits) : null,
                minCartValue: fromSubunits(row.min_cart_subunits || 0),
                requiredCartValue: fromSubunits(requiredCartSubunits),
                currentCartValue: fromSubunits(currentCartSubunits),
                shippingFee: fromSubunits(shippingFeeSubunits || 0),
                isEligible,
                expiresAt: row.expires_at || null
            });
        }
        const [recoveryRows] = await db.execute(
            `SELECT code, discount_type, discount_percent, max_discount_subunits, min_cart_subunits, expires_at
             FROM abandoned_cart_discounts
             WHERE user_id = ?
               AND status = 'active'
               AND (expires_at IS NULL OR expires_at > NOW())
             ORDER BY id DESC
             LIMIT 30`,
            [userId]
        );
        for (const row of recoveryRows) {
            const minCartSubunits = Number(row.min_cart_subunits || 0);
            const currentCartSubunits = Number(cartTotalSubunits || 0);
            const isEligible = currentCartSubunits >= minCartSubunits;
            out.push({
                id: `abandoned:${row.code}`,
                code: row.code,
                name: 'Recovery Offer',
                sourceType: 'abandoned',
                scopeType: 'customer',
                discountType: row.discount_type || 'percent',
                discountValue: Number(row.discount_percent || 0),
                minCartValue: fromSubunits(row.min_cart_subunits || 0),
                requiredCartValue: fromSubunits(minCartSubunits),
                currentCartValue: fromSubunits(currentCartSubunits),
                isEligible,
                expiresAt: row.expires_at || null
            });
        }
        return out;
    }

    static async getActiveCouponsByUser({
        userId,
        loyaltyTier = 'regular'
    } = {}) {
        if (!userId) return [];
        const [rows] = await db.execute(
            `SELECT c.*,
                    (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = c.id) as used_count,
                    (SELECT COUNT(*) FROM coupon_redemptions cr WHERE cr.coupon_id = c.id AND cr.user_id = ?) as used_by_user,
                    EXISTS(SELECT 1 FROM coupon_user_targets cut WHERE cut.coupon_id = c.id AND cut.user_id = ?) as is_user_target
             FROM coupons c
             WHERE c.is_active = 1
             ORDER BY c.created_at DESC
             LIMIT 500`,
            [userId, userId]
        );
        const out = [];
        for (const row of rows) {
            if (!isWithinDateWindow(row)) continue;
            if (row.usage_limit_total != null && Number(row.used_count || 0) >= Number(row.usage_limit_total || 0)) continue;
            if (Number(row.used_by_user || 0) >= Math.max(1, Number(row.usage_limit_per_user || 1))) continue;
            const scope = String(row.scope_type || 'generic').toLowerCase();
            if (scope === 'customer' && Number(row.is_user_target || 0) !== 1) continue;
            if (scope === 'tier') {
                const tierScope = String(row.tier_scope || '').toLowerCase();
                if (tierScope && tierScope !== String(loyaltyTier || 'regular').toLowerCase()) continue;
            }
            if (!['generic', 'customer', 'tier', 'category'].includes(scope)) continue;
            out.push({
                id: row.id,
                code: row.code,
                name: row.name,
                scopeType: row.scope_type,
                sourceType: row.source_type || 'admin',
                discountType: row.discount_type,
                discountValue: Number(row.discount_value || 0),
                usageLimitPerUser: Number(row.usage_limit_per_user || 1),
                expiresAt: row.expires_at || null,
                createdAt: row.created_at || null
            });
        }
        const [recoveryRows] = await db.execute(
            `SELECT d.code, d.discount_type, d.discount_percent, d.min_cart_subunits, d.expires_at, d.created_at
             FROM abandoned_cart_discounts d
             WHERE d.user_id = ?
               AND d.status = 'active'
               AND (d.expires_at IS NULL OR d.expires_at > NOW())
             ORDER BY d.id DESC
             LIMIT 50`,
            [userId]
        );
        for (const row of recoveryRows) {
            out.push({
                id: `abandoned:${row.code}`,
                code: row.code,
                name: 'Recovery Offer',
                scopeType: 'customer',
                sourceType: 'abandoned',
                discountType: row.discount_type || 'percent',
                discountValue: Number(row.discount_percent || 0),
                usageLimitPerUser: 1,
                minCartValue: fromSubunits(row.min_cart_subunits || 0),
                expiresAt: row.expires_at || null,
                createdAt: row.created_at || null
            });
        }
        return out;
    }
}

module.exports = Coupon;
