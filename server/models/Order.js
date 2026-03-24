const db = require('../config/db');
const AbandonedCart = require('./AbandonedCart');
const Coupon = require('./Coupon');
const CompanyProfile = require('./CompanyProfile');
const TaxConfig = require('./TaxConfig');
const { getUserLoyaltyStatus, calculateOrderLoyaltyAdjustments, reassessUserTier } = require('../services/loyaltyService');

const ORDER_REF_ALPHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const ORDER_REF_DIGIT_CHARS = '0123456789';
const randomChars = (chars, length) => {
    let out = '';
    const safeLength = Math.max(0, Number(length || 0));
    for (let i = 0; i < safeLength; i += 1) {
        out += chars[Math.floor(Math.random() * chars.length)];
    }
    return out;
};
const buildOrderRefCandidate = (digitCount = 4) => {
    const safeDigits = Math.max(1, Number(digitCount || 4));
    const alphaPart = randomChars(ORDER_REF_ALPHA_CHARS, 3);
    const digitPart = randomChars(ORDER_REF_DIGIT_CHARS, safeDigits);
    return `${alphaPart}${digitPart}`;
};
const buildOrderRef = async (connection = db) => {
    let digitCount = 4;
    while (digitCount <= 12) {
        const attemptLimit = 200;
        for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
            const candidate = buildOrderRefCandidate(digitCount);
            const [rows] = await connection.execute(
                'SELECT id FROM orders WHERE order_ref = ? LIMIT 1',
                [candidate]
            );
            if (!rows.length) return candidate;
        }
        digitCount += 1;
    }
    throw new Error('Unable to generate unique order reference');
};

const normalizeAddress = (address) => {
    if (!address) return null;
    if (typeof address === 'string') {
        try {
            return JSON.parse(address);
        } catch {
            return address;
        }
    }
    return address;
};

const hasCompleteAddress = (address = null) => {
    const source = normalizeAddress(address);
    return Boolean(
        String(source?.line1 || '').trim()
        && String(source?.city || '').trim()
        && String(source?.state || '').trim()
        && String(source?.zip || '').trim()
    );
};

const parseJsonSafe = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const toSubunits = (amount) => Math.round(Number(amount || 0) * 100);
const fromSubunits = (subunits) => Number(subunits || 0) / 100;
const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const applyDefaultPending = (order) => {
    if (!order) return order;
    const status = order.status || '';
    if (!['confirmed'].includes(status)) return order;
    const createdAt = order.created_at ? new Date(order.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return order;
    const now = new Date();
    const diffHours = (now.getTime() - createdAt.getTime()) / (60 * 60 * 1000);
    if (!Number.isFinite(diffHours) || diffHours < 24) return order;
    return { ...order, status: 'pending' };
};

const computeShippingFee = async (connection, shippingAddress, subtotal, totalWeightKg) => {
    if (!shippingAddress || !shippingAddress.state) return 0;
    const [zones] = await connection.execute('SELECT * FROM shipping_zones');
    const [options] = await connection.execute('SELECT * FROM shipping_options');
    const normalizeStateKey = (value) => String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '');
    const state = normalizeStateKey(shippingAddress.state);
    if (!state) return 0;

    const zone = zones.find((z) => {
        if (!z.states) return false;
        try {
            const states = JSON.parse(z.states || '[]');
            return states.some((s) => normalizeStateKey(s) === state);
        } catch {
            return false;
        }
    });

    if (!zone) return 0;
    const zoneOptions = options.filter((opt) => opt.zone_id === zone.id);
    if (zoneOptions.length === 0) return 0;

    const eligible = zoneOptions.filter((opt) => {
        const min = opt.min_value === null ? null : Number(opt.min_value);
        const max = opt.max_value === null ? null : Number(opt.max_value);
        if (opt.condition_type === 'weight') {
            if (min !== null && totalWeightKg < min) return false;
            if (max !== null && totalWeightKg > max) return false;
            return true;
        }
        if (opt.condition_type === 'price' || !opt.condition_type) {
            if (min !== null && subtotal < min) return false;
            if (max !== null && subtotal > max) return false;
            return true;
        }
        return true;
    });

    if (eligible.length === 0) return 0;
    // When both weight-based and price-based rules are eligible for the same cart,
    // shipping currently resolves to the lowest eligible rate. Zone validation blocks
    // overlaps within a rule type, so this is the only remaining precedence path.
    eligible.sort((a, b) => Number(a.rate) - Number(b.rate));
    return Number(eligible[0].rate || 0);
};

const resolveEffectiveShippingAddress = async (connection, userId, shippingAddress = null) => {
    const directAddress = hasCompleteAddress(shippingAddress)
        ? normalizeAddress(shippingAddress)
        : null;
    if (directAddress) return directAddress;
    if (!userId) return null;
    const [userRows] = await connection.execute('SELECT address FROM users WHERE id = ? LIMIT 1', [userId]);
    const savedShippingAddress = normalizeAddress(userRows?.[0]?.address);
    return hasCompleteAddress(savedShippingAddress) ? savedShippingAddress : null;
};

const parseVariantOptionsSafe = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const getPrimaryMediaUrl = (value) => {
    if (!value) return null;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(parsed) || !parsed.length) return null;
        return parsed[0]?.url || parsed[0] || null;
    } catch {
        return null;
    }
};

const allocateProportionally = (amount = 0, bases = []) => {
    const totalAmount = roundMoney(Math.max(0, Number(amount || 0)));
    const safeBases = (Array.isArray(bases) ? bases : []).map((base) => roundMoney(Math.max(0, Number(base || 0))));
    const totalBase = roundMoney(safeBases.reduce((sum, value) => sum + value, 0));
    if (totalAmount <= 0 || totalBase <= 0 || !safeBases.length) {
        return safeBases.map(() => 0);
    }
    const allocations = safeBases.map((base) => roundMoney((base / totalBase) * totalAmount));
    const allocated = roundMoney(allocations.reduce((sum, value) => sum + value, 0));
    const drift = roundMoney(totalAmount - allocated);
    if (drift !== 0) {
        let bestIndex = 0;
        let bestBase = -1;
        for (let i = 0; i < safeBases.length; i += 1) {
            if (safeBases[i] > bestBase) {
                bestBase = safeBases[i];
                bestIndex = i;
            }
        }
        allocations[bestIndex] = roundMoney(allocations[bestIndex] + drift);
    }
    return allocations;
};

const computeTaxForItems = async ({
    connection,
    orderItems = [],
    subtotal = 0,
    shippingFee = 0,
    couponDiscountTotal = 0,
    loyaltyDiscountTotal = 0,
    loyaltyShippingDiscountTotal = 0
} = {}) => {
    const normalizedItems = Array.isArray(orderItems) ? orderItems : [];
    if (!normalizedItems.length) {
        return {
            taxTotal: 0,
            taxBreakup: [],
            items: []
        };
    }

    const companyProfile = await CompanyProfile.get();
    const taxEnabled = Boolean(companyProfile?.taxEnabled);
    const activeTaxes = taxEnabled ? await TaxConfig.listActive() : [];
    const taxesById = new Map(activeTaxes.map((tax) => [Number(tax.id), tax]));
    const defaultTax = activeTaxes.find((tax) => tax.isDefault) || activeTaxes[0] || null;
    if (!taxEnabled || !defaultTax) {
        const zeroItems = normalizedItems.map((item) => ({
            ...item,
            taxRatePercent: 0,
            taxAmount: 0,
            taxName: null,
            taxCode: null,
            taxBase: roundMoney(Number(item.lineTotal || 0)),
            taxSnapshot: null,
            snapshot: {
                ...(item?.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {}),
                taxRatePercent: 0,
                taxAmount: 0,
                taxBase: roundMoney(Number(item.lineTotal || 0))
            }
        }));
        return {
            taxTotal: 0,
            taxBreakup: [],
            items: zeroItems
        };
    }

    const safeSubtotal = roundMoney(Math.max(0, Number(subtotal || 0)));
    const safeShippingFee = roundMoney(Math.max(0, Number(shippingFee || 0)));
    const safeCouponDiscount = roundMoney(Math.max(0, Number(couponDiscountTotal || 0)));
    const couponProductDiscount = roundMoney(Math.min(safeCouponDiscount, safeSubtotal));
    const couponShippingDiscount = roundMoney(Math.min(
        Math.max(0, safeCouponDiscount - couponProductDiscount),
        safeShippingFee
    ));
    const safeLoyaltyDiscount = roundMoney(Math.min(Math.max(0, Number(loyaltyDiscountTotal || 0)), Math.max(0, safeSubtotal - couponProductDiscount)));
    const safeLoyaltyShippingDiscount = roundMoney(Math.min(
        Math.max(0, Number(loyaltyShippingDiscountTotal || 0)),
        Math.max(0, safeShippingFee - couponShippingDiscount)
    ));
    const lineTotals = normalizedItems.map((item) => roundMoney(Math.max(0, Number(item.lineTotal || 0))));
    const couponAllocations = allocateProportionally(couponProductDiscount, lineTotals);
    const loyaltyAllocations = allocateProportionally(safeLoyaltyDiscount, lineTotals);

    const taxBreakupMap = new Map();
    let taxTotal = 0;
    const taxedItems = normalizedItems.map((item, index) => {
        const assignedTax = taxesById.get(Number(item.taxConfigId || 0)) || defaultTax;
        const ratePercent = roundMoney(Math.max(0, Number(assignedTax?.ratePercent || 0)));
        const lineTotal = lineTotals[index] || 0;
        const lineDiscount = roundMoney((couponAllocations[index] || 0) + (loyaltyAllocations[index] || 0));
        const taxBase = roundMoney(Math.max(0, lineTotal - lineDiscount));
        const taxAmount = roundMoney((taxBase * ratePercent) / 100);
        taxTotal = roundMoney(taxTotal + taxAmount);

        const key = `${assignedTax?.id || 0}`;
        const current = taxBreakupMap.get(key) || {
            taxId: assignedTax?.id || null,
            name: assignedTax?.name || null,
            code: assignedTax?.code || null,
            ratePercent,
            taxableBase: 0,
            taxAmount: 0
        };
        current.taxableBase = roundMoney(current.taxableBase + taxBase);
        current.taxAmount = roundMoney(current.taxAmount + taxAmount);
        taxBreakupMap.set(key, current);

        return {
            ...item,
            taxRatePercent: ratePercent,
            taxAmount,
            taxName: assignedTax?.name || null,
            taxCode: assignedTax?.code || null,
            taxBase,
            taxSnapshot: assignedTax ? {
                id: assignedTax.id,
                name: assignedTax.name,
                code: assignedTax.code,
                ratePercent
            } : null,
            snapshot: {
                ...(item?.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {}),
                taxRatePercent: ratePercent,
                taxAmount,
                taxName: assignedTax?.name || null,
                taxCode: assignedTax?.code || null,
                taxBase
            }
        };
    });

    const shippingTaxBase = roundMoney(Math.max(
        0,
        safeShippingFee - couponShippingDiscount - safeLoyaltyShippingDiscount
    ));
    if (shippingTaxBase > 0) {
        const shippingRatePercent = roundMoney(Math.max(0, Number(defaultTax?.ratePercent || 0)));
        const shippingTaxAmount = roundMoney((shippingTaxBase * shippingRatePercent) / 100);
        taxTotal = roundMoney(taxTotal + shippingTaxAmount);
        const shippingKey = `${defaultTax?.id || 0}`;
        const shippingCurrent = taxBreakupMap.get(shippingKey) || {
            taxId: defaultTax?.id || null,
            name: defaultTax?.name || null,
            code: defaultTax?.code || null,
            ratePercent: shippingRatePercent,
            taxableBase: 0,
            taxAmount: 0
        };
        shippingCurrent.taxableBase = roundMoney(shippingCurrent.taxableBase + shippingTaxBase);
        shippingCurrent.taxAmount = roundMoney(shippingCurrent.taxAmount + shippingTaxAmount);
        taxBreakupMap.set(shippingKey, shippingCurrent);
    }

    return {
        taxTotal: roundMoney(taxTotal),
        taxBreakup: Array.from(taxBreakupMap.values()),
        items: taxedItems
    };
};

const normalizeManualSelections = (items = []) => {
    const out = new Map();
    for (const row of (Array.isArray(items) ? items : [])) {
        const productId = Number(row?.productId || row?.product_id || 0);
        const rawVariantId = row?.variantId ?? row?.variant_id ?? '';
        const variantId = rawVariantId === '' || rawVariantId == null ? null : Number(rawVariantId);
        const quantity = Math.max(0, Number(row?.quantity || 0));
        if (!Number.isFinite(productId) || productId <= 0 || quantity <= 0) continue;
        if (variantId != null && (!Number.isFinite(variantId) || variantId <= 0)) continue;
        const key = `${productId}:${variantId || ''}`;
        if (!out.has(key)) {
            out.set(key, { productId, variantId, quantity: 0 });
        }
        out.get(key).quantity += quantity;
    }
    return Array.from(out.values());
};

const buildOrderItemsFromSelections = async (connection, selections = [], { deductStock = false } = {}) => {
    const normalized = normalizeManualSelections(selections);
    if (!normalized.length) {
        throw new Error('Add at least one product to create order');
    }
    const orderItems = [];
    let subtotal = 0;
    let totalWeightKg = 0;
    for (const selected of normalized) {
        const { productId, variantId, quantity } = selected;
        const [rows] = await connection.execute(
            `SELECT p.id as product_id, p.title as product_title, p.status as product_status, p.tax_config_id,
                    p.mrp, p.discount_price as product_discount_price, p.track_quantity as product_track_quantity,
                    p.quantity as product_quantity, p.sku as product_sku, p.media as product_media, p.weight_kg as product_weight_kg, p.polish_warranty_months,
                    pv.id as variant_id, pv.product_id as variant_product_id, pv.variant_title,
                    pv.price as variant_price, pv.discount_price as variant_discount_price,
                    pv.track_quantity as variant_track_quantity, pv.quantity as variant_quantity,
                    pv.sku as variant_sku, pv.image_url as variant_image_url, pv.weight_kg as variant_weight_kg,
                    pv.variant_options
             FROM products p
             LEFT JOIN product_variants pv ON pv.id = ?
             WHERE p.id = ?
             LIMIT 1
             ${deductStock ? 'FOR UPDATE' : ''}`,
            [variantId || null, productId]
        );
        const row = rows[0];
        if (!row) throw new Error('Some selected products are unavailable');
        if (row.product_status && row.product_status !== 'active') {
            throw new Error('Some selected products are unavailable');
        }
        if (variantId && (!row.variant_id || Number(row.variant_product_id) !== Number(productId))) {
            throw new Error('Some selected variants are unavailable');
        }
        if (deductStock) {
            if (variantId) {
                if (Number(row.variant_track_quantity) === 1 && Number(row.variant_quantity || 0) < quantity) {
                    throw new Error('Insufficient stock for some items');
                }
                if (Number(row.variant_track_quantity) === 1) {
                    await connection.execute(
                        'UPDATE product_variants SET quantity = quantity - ? WHERE id = ?',
                        [quantity, variantId]
                    );
                }
            } else {
                if (Number(row.product_track_quantity) === 1 && Number(row.product_quantity || 0) < quantity) {
                    throw new Error('Insufficient stock for some items');
                }
                if (Number(row.product_track_quantity) === 1) {
                    await connection.execute(
                        'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                        [quantity, productId]
                    );
                }
            }
        }
        const price = Number(
            row.variant_discount_price || row.variant_price || row.product_discount_price || row.mrp || 0
        );
        const originalPrice = Number(row.variant_price || row.mrp || price);
        const lineTotal = price * quantity;
        const itemWeight = Number(row.variant_weight_kg || row.product_weight_kg || 0);
        totalWeightKg += itemWeight * quantity;
        const imageUrl = row.variant_image_url || getPrimaryMediaUrl(row.product_media) || null;
        orderItems.push({
            productId,
            variantId: variantId || '',
            taxConfigId: row.tax_config_id || null,
            title: row.product_title || 'Product',
            variantTitle: row.variant_title || null,
            quantity,
            price,
            lineTotal,
            imageUrl,
                sku: row.variant_sku || row.product_sku || null,
                snapshot: {
                productId,
                variantId: variantId || '',
                title: row.product_title || '',
                variantTitle: row.variant_title || null,
                variantOptions: parseVariantOptionsSafe(row.variant_options),
                quantity,
                unitPrice: price,
                originalPrice,
                discountValuePerUnit: Math.max(0, originalPrice - price),
                lineTotal,
                imageUrl,
                    sku: row.variant_sku || row.product_sku || null,
                    polishWarrantyMonths: Number(row.polish_warranty_months || 6),
                    taxConfigId: row.tax_config_id || null,
                weightKg: itemWeight,
                productStatus: row.product_status || 'active',
                capturedAt: new Date().toISOString()
            }
        });
        subtotal += lineTotal;
    }
    return {
        orderItems,
        subtotal,
        totalWeightKg,
        cartProductIds: [...new Set(orderItems.map((item) => item.productId).filter(Boolean))]
    };
};

const MAX_FETCH_RANGE_DAYS = 90;

const buildAdminStatusClause = ({ status = 'all', alias = 'o', params = [] } = {}) => {
    const normalizedStatus = String(status || '').trim().toLowerCase();
    if (!normalizedStatus || normalizedStatus === 'all') return '';
    if (normalizedStatus === 'pending') {
        return ` AND (${alias}.status = 'pending' OR (${alias}.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, ${alias}.created_at, UTC_TIMESTAMP()) >= 24))`;
    }
    if (normalizedStatus === 'confirmed') {
        return ` AND (${alias}.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, ${alias}.created_at, UTC_TIMESTAMP()) < 24)`;
    }
    if (normalizedStatus === 'failed') {
        return ` AND (${alias}.status = 'failed' OR LOWER(COALESCE(${alias}.payment_status, '')) = 'failed')`;
    }
    params.push(normalizedStatus);
    return ` AND ${alias}.status = ?`;
};

const buildAdminOrderFilters = ({ status = 'all', search = '', startDate = '', endDate = '', quickRange = 'last_90_days', sourceChannel = 'all', includeStatus = true } = {}) => {
    const params = [];
    let where = 'WHERE 1=1';
    let latestLimit = null;

    if (includeStatus) {
        where += buildAdminStatusClause({ status, alias: 'o', params });
    }

    if (search) {
        where += ' AND (o.order_ref LIKE ? OR u.name LIKE ? OR u.mobile LIKE ?)';
        const term = `%${search}%`;
        params.push(term, term, term);
    }

    if (sourceChannel && sourceChannel !== 'all') {
        const normalizedSource = String(sourceChannel || '').trim().toLowerCase();
        if (normalizedSource === 'abandoned_recovery') {
            where += " AND (o.is_abandoned_recovery = 1 OR LOWER(COALESCE(o.source_channel, '')) = 'abandoned_recovery')";
        } else if (normalizedSource === 'direct') {
            where += " AND (o.is_abandoned_recovery = 0 AND (COALESCE(o.source_channel, '') = '' OR LOWER(o.source_channel) <> 'abandoned_recovery'))";
        } else {
            where += ' AND LOWER(COALESCE(o.source_channel, \'\')) = ?';
            params.push(normalizedSource);
        }
    }

    switch (quickRange) {
        case 'last_7_days':
            where += ' AND o.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)';
            break;
        case 'last_30_days':
        case 'last_1_month':
            where += ' AND o.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)';
            break;
        case 'last_90_days':
            where += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
            break;
        case 'latest_10':
            where += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
            latestLimit = 10;
            break;
        default:
            if (startDate) {
                where += ' AND DATE(o.created_at) >= ?';
                params.push(startDate);
            }
            if (endDate) {
                where += ' AND DATE(o.created_at) <= ?';
                params.push(endDate);
            }
            if (!startDate && !endDate) {
                where += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
            }
            break;
    }

    return { where, params, latestLimit };
};

const resolveAdminOrderSort = ({ sortBy = 'newest', quickRange = 'last_90_days' } = {}) => {
    if (quickRange === 'latest_10') return 'o.created_at DESC';
    switch (sortBy) {
        case 'priority':
            return `CASE LOWER(COALESCE(o.loyalty_tier, 'regular'))
                WHEN 'platinum' THEN 5
                WHEN 'gold' THEN 4
                WHEN 'silver' THEN 3
                WHEN 'bronze' THEN 2
                ELSE 1
            END DESC, o.created_at DESC`;
        case 'oldest':
            return 'o.created_at ASC';
        case 'amount_high':
            return 'o.total DESC, o.created_at DESC';
        case 'amount_low':
            return 'o.total ASC, o.created_at DESC';
        default:
            return 'o.created_at DESC';
    }
};

class Order {
    static async getAvailableCoupons(userId, { shippingAddress = null } = {}) {
        const connection = await db.getConnection();
        try {
            const [cartRows] = await connection.execute(
                `SELECT ci.quantity, ci.product_id,
                        p.status as product_status, p.mrp, p.discount_price as product_discount_price, p.weight_kg as product_weight_kg,
                        pv.price as variant_price, pv.discount_price as variant_discount_price, pv.weight_kg as variant_weight_kg
                 FROM cart_items ci
                 JOIN products p ON p.id = ci.product_id
                 LEFT JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
                 WHERE ci.user_id = ?`,
                [userId]
            );
            if (!cartRows.length) return [];
            let subtotal = 0;
            let totalWeightKg = 0;
            const productIds = [];
            for (const row of cartRows) {
                const quantity = Number(row.quantity || 0);
                if (quantity <= 0) continue;
                if (row.product_status && row.product_status !== 'active') continue;
                const unitPrice = Number(
                    row.variant_discount_price || row.variant_price || row.product_discount_price || row.mrp || 0
                );
                subtotal += unitPrice * quantity;
                totalWeightKg += Number(row.variant_weight_kg || row.product_weight_kg || 0) * quantity;
                if (row.product_id) productIds.push(row.product_id);
            }
            const shippingAddressForCoupons = await resolveEffectiveShippingAddress(connection, userId, shippingAddress);
            const shippingFee = hasCompleteAddress(shippingAddressForCoupons)
                ? await computeShippingFee(connection, shippingAddressForCoupons, subtotal, totalWeightKg)
                : 0;
            const loyaltyStatus = await getUserLoyaltyStatus(userId);
            const eligibleLoyaltyTier = loyaltyStatus?.eligibility?.isEligible
                ? (loyaltyStatus?.tier || 'regular')
                : 'regular';
            return Coupon.getAvailableCouponsForUser({
                userId,
                loyaltyTier: eligibleLoyaltyTier,
                cartTotalSubunits: toSubunits(subtotal),
                shippingFeeSubunits: toSubunits(shippingFee),
                cartProductIds: [...new Set(productIds)]
            });
        } finally {
            connection.release();
        }
    }

    static async getAvailableCouponsForSelection({
        userId,
        items = []
    } = {}) {
        const connection = await db.getConnection();
        try {
            const { subtotal, cartProductIds } = await buildOrderItemsFromSelections(connection, items, { deductStock: false });
            const loyaltyStatus = await getUserLoyaltyStatus(userId);
            const eligibleLoyaltyTier = loyaltyStatus?.eligibility?.isEligible
                ? (loyaltyStatus?.tier || 'regular')
                : 'regular';
            return Coupon.getAvailableCouponsForUser({
                userId,
                loyaltyTier: eligibleLoyaltyTier,
                cartTotalSubunits: toSubunits(subtotal),
                cartProductIds
            });
        } finally {
            connection.release();
        }
    }

    static async computeShippingFeeForSummary({
        shippingAddress = null,
        subtotal = 0,
        totalWeightKg = 0
    } = {}) {
        if (!shippingAddress || !shippingAddress.state) return 0;
        const connection = await db.getConnection();
        try {
            return await computeShippingFee(connection, shippingAddress, subtotal, totalWeightKg);
        } finally {
            connection.release();
        }
    }

    static async getCheckoutSummary(userId, { shippingAddress, couponCode = null, allowSavedAddressFallback = false } = {}) {
        const connection = await db.getConnection();
        try {
            const [cartRows] = await connection.execute(
                `SELECT ci.quantity, ci.product_id, ci.variant_id,
                        p.title as product_title, p.status as product_status, p.tax_config_id,
                        p.mrp, p.discount_price as product_discount_price, p.weight_kg as product_weight_kg,
                        p.track_quantity as product_track_quantity, p.quantity as product_quantity,
                        pv.id as resolved_variant_id, pv.variant_title, pv.price as variant_price, pv.discount_price as variant_discount_price, pv.weight_kg as variant_weight_kg,
                        pv.track_quantity as variant_track_quantity, pv.quantity as variant_quantity
                 FROM cart_items ci
                 JOIN products p ON p.id = ci.product_id
                 LEFT JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
                 WHERE ci.user_id = ?`,
                [userId]
            );

            if (!cartRows.length) {
                throw new Error('Cart is empty');
            }

            let subtotal = 0;
            let totalWeightKg = 0;
            let itemCount = 0;
            const summaryItems = [];

            for (const row of cartRows) {
                const quantity = Number(row.quantity || 0);
                if (quantity <= 0) continue;

                if (row.product_status && row.product_status !== 'active') {
                    throw new Error('Some items are no longer available');
                }
                if (row.variant_id && !row.resolved_variant_id) {
                    throw new Error('Some selected variants are unavailable');
                }
                if (row.variant_id && Number(row.variant_track_quantity) === 1 && Number(row.variant_quantity || 0) < quantity) {
                    throw new Error('Insufficient stock for some items');
                }
                if (!row.variant_id && Number(row.product_track_quantity) === 1 && Number(row.product_quantity || 0) < quantity) {
                    throw new Error('Insufficient stock for some items');
                }

                const unitPrice = Number(
                    row.variant_discount_price || row.variant_price || row.product_discount_price || row.mrp || 0
                );
                const itemWeight = Number(row.variant_weight_kg || row.product_weight_kg || 0);

                subtotal += unitPrice * quantity;
                totalWeightKg += itemWeight * quantity;
                itemCount += quantity;
                summaryItems.push({
                    productId: row.product_id,
                    variantId: row.variant_id || '',
                    taxConfigId: row.tax_config_id || null,
                    title: row.product_title || 'Product',
                    variantTitle: row.variant_title || null,
                    quantity,
                    price: unitPrice,
                    lineTotal: roundMoney(unitPrice * quantity)
                });
            }

            if (!itemCount) {
                throw new Error('Cart is empty');
            }

            const effectiveShippingAddress = allowSavedAddressFallback
                ? await resolveEffectiveShippingAddress(connection, userId, shippingAddress)
                : shippingAddress;
            const shippingFee = await computeShippingFee(connection, effectiveShippingAddress, subtotal, totalWeightKg);
            let couponDiscountTotal = 0;
            let coupon = null;
            const cartProductIds = [...new Set(cartRows.map((row) => row.product_id).filter(Boolean))];
            const loyaltyStatus = await getUserLoyaltyStatus(userId);
            const isMembershipEligible = Boolean(loyaltyStatus?.eligibility?.isEligible);
            const eligibleLoyaltyTier = isMembershipEligible ? (loyaltyStatus?.tier || 'regular') : 'regular';
            if (couponCode) {
                const discount = await Coupon.resolveRedeemableCoupon({
                    code: couponCode,
                    userId,
                    cartTotalSubunits: toSubunits(subtotal),
                    shippingFeeSubunits: toSubunits(shippingFee),
                    loyaltyTier: eligibleLoyaltyTier,
                    cartProductIds,
                    connection
                });
                if (!discount) {
                    throw new Error('Coupon is invalid or expired');
                }
                couponDiscountTotal = fromSubunits(discount.discountSubunits);
                coupon = {
                    id: discount.id,
                    code: discount.code,
                    source: discount.source || 'coupon',
                    type: discount.type || 'percent',
                    percent: Number(discount.percent || 0),
                    fixedAmount: Number(discount.fixedAmount || 0),
                    journeyId: discount.journeyId || null,
                    discountSubunits: Number(discount.discountSubunits || 0)
                };
            }
            const maxCouponDiscount = Math.max(0, subtotal + shippingFee);
            if (couponDiscountTotal > maxCouponDiscount) couponDiscountTotal = maxCouponDiscount;

            const loyaltyAdjustments = calculateOrderLoyaltyAdjustments({
                subtotal,
                shippingFee,
                couponDiscount: couponDiscountTotal,
                tier: eligibleLoyaltyTier,
                membershipEligible: isMembershipEligible
            });
            const loyaltyDiscountTotal = Math.min(
                Math.max(0, subtotal - couponDiscountTotal),
                Number(loyaltyAdjustments.loyaltyDiscount || 0)
            );
            const loyaltyShippingDiscountTotal = Math.min(
                Math.max(0, shippingFee),
                Number(loyaltyAdjustments.shippingDiscount || 0)
            );
            const taxResult = await computeTaxForItems({
                connection,
                orderItems: summaryItems,
                subtotal,
                shippingFee,
                couponDiscountTotal,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal
            });
            const discountTotal = couponDiscountTotal + loyaltyDiscountTotal + loyaltyShippingDiscountTotal;
            const total = Math.max(0, subtotal + shippingFee + Number(taxResult.taxTotal || 0) - discountTotal);

            return {
                itemCount,
                subtotal,
                shippingFee,
                couponDiscountTotal,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal,
                taxTotal: Number(taxResult.taxTotal || 0),
                taxBreakup: taxResult.taxBreakup || [],
                items: (taxResult.items || []).map((item) => ({
                    productId: item.productId,
                    variantId: item.variantId || '',
                    title: item.title || 'Product',
                    variantTitle: item.variantTitle || null,
                    quantity: item.quantity,
                    price: item.price,
                    lineTotal: item.lineTotal,
                    taxAmount: Number(item.taxAmount || 0),
                    taxRatePercent: Number(item.taxRatePercent || 0),
                    taxName: item.taxName || null,
                    taxCode: item.taxCode || null
                })),
                discountTotal,
                total,
                currency: 'INR',
                coupon,
                loyaltyTier: eligibleLoyaltyTier,
                loyaltyProfile: loyaltyStatus?.profile || null,
                loyaltyMeta: {
                    profile: loyaltyAdjustments.profile || null,
                    progress: loyaltyStatus?.progress || null,
                    spends: loyaltyStatus?.spends || null
                }
            };
        } finally {
            connection.release();
        }
    }

    static async createFromCart(userId, {
        billingAddress,
        shippingAddress,
        payment = null,
        skipStockDeduction = false,
        couponCode = null,
        sourceChannel = null
    }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [cartRows] = await connection.execute(
                `SELECT ci.product_id, ci.variant_id, ci.quantity,
                        p.title as product_title, p.status as product_status, p.tax_config_id,
                        p.mrp, p.discount_price as product_discount_price, p.track_quantity as product_track_quantity,
                        p.quantity as product_quantity, p.sku as product_sku, p.media as product_media, p.weight_kg as product_weight_kg, p.polish_warranty_months,
                        pv.id as resolved_variant_id, pv.variant_title, pv.price as variant_price, pv.discount_price as variant_discount_price,
                        pv.track_quantity as variant_track_quantity, pv.quantity as variant_quantity,
                        pv.sku as variant_sku, pv.image_url as variant_image_url, pv.weight_kg as variant_weight_kg,
                        pv.variant_options
                 FROM cart_items ci
                 JOIN products p ON p.id = ci.product_id
                 LEFT JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
                 WHERE ci.user_id = ?`,
                [userId]
            );

            if (!cartRows.length) {
                throw new Error('Cart is empty');
            }

            const orderItems = [];
            let subtotal = 0;
            let totalWeightKg = 0;

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
                const price = Number(
                    row.variant_discount_price || row.variant_price || row.product_discount_price || row.mrp || 0
                );
                const originalPrice = Number(
                    row.variant_price || row.mrp || price
                );
                const lineTotal = price * quantity;
                const itemWeight = Number(row.variant_weight_kg || row.product_weight_kg || 0);
                totalWeightKg += itemWeight * quantity;

                if (!skipStockDeduction) {
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
                }

                let imageUrl = row.variant_image_url || null;
                if (!imageUrl && row.product_media) {
                    try {
                        const media = JSON.parse(row.product_media || '[]');
                        imageUrl = Array.isArray(media) ? (media[0]?.url || media[0] || null) : null;
                    } catch {
                        imageUrl = null;
                    }
                }

                subtotal += lineTotal;
                orderItems.push({
                    productId: row.product_id,
                    variantId: row.variant_id || '',
                    taxConfigId: row.tax_config_id || null,
                    title: row.product_title,
                    variantTitle: row.variant_title || null,
                    quantity,
                    price,
                    lineTotal,
                    imageUrl,
                    sku: row.variant_sku || row.product_sku || null,
                    snapshot: {
                        productId: row.product_id,
                        variantId: row.variant_id || '',
                        title: row.product_title || '',
                        variantTitle: row.variant_title || null,
                        variantOptions: row.variant_options ? (
                            typeof row.variant_options === 'string'
                                ? (() => {
                                    try { return JSON.parse(row.variant_options); } catch { return null; }
                                })()
                                : row.variant_options
                        ) : null,
                        quantity,
                        unitPrice: price,
                        originalPrice,
                        discountValuePerUnit: Math.max(0, originalPrice - price),
                        lineTotal,
                        imageUrl,
                        sku: row.variant_sku || row.product_sku || null,
                        polishWarrantyMonths: Number(row.polish_warranty_months || 6),
                        taxConfigId: row.tax_config_id || null,
                        weightKg: itemWeight,
                        productStatus: row.product_status || 'active',
                        capturedAt: new Date().toISOString()
                    }
                });
            }

            if (!orderItems.length) {
                throw new Error('Cart is empty');
            }

            const shippingFee = await computeShippingFee(connection, shippingAddress, subtotal, totalWeightKg);
            let couponDiscountTotal = 0;
            let coupon = null;
            const cartProductIds = [...new Set(orderItems.map((item) => item.productId).filter(Boolean))];
            const loyaltyStatus = await getUserLoyaltyStatus(userId);
            const isMembershipEligible = Boolean(loyaltyStatus?.eligibility?.isEligible);
            const eligibleLoyaltyTier = isMembershipEligible ? (loyaltyStatus?.tier || 'regular') : 'regular';
            if (couponCode) {
                const discount = await Coupon.resolveRedeemableCoupon({
                    code: couponCode,
                    userId,
                    cartTotalSubunits: toSubunits(subtotal),
                    shippingFeeSubunits: toSubunits(shippingFee),
                    loyaltyTier: eligibleLoyaltyTier,
                    cartProductIds,
                    connection
                });
                if (!discount) {
                    throw new Error('Coupon is invalid or expired');
                }
                couponDiscountTotal = fromSubunits(discount.discountSubunits);
                coupon = {
                    id: discount.id,
                    code: discount.code,
                    source: discount.source || 'coupon',
                    type: discount.type || 'percent',
                    percent: Number(discount.percent || 0),
                    fixedAmount: Number(discount.fixedAmount || 0),
                    journeyId: discount.journeyId || null,
                    discountSubunits: Number(discount.discountSubunits || 0)
                };
            }
            const maxCouponDiscount = Math.max(0, subtotal + shippingFee);
            if (couponDiscountTotal > maxCouponDiscount) couponDiscountTotal = maxCouponDiscount;

            const loyaltyAdjustments = calculateOrderLoyaltyAdjustments({
                subtotal,
                shippingFee,
                couponDiscount: couponDiscountTotal,
                tier: eligibleLoyaltyTier,
                membershipEligible: isMembershipEligible
            });
            const loyaltyDiscountTotal = Math.min(
                Math.max(0, subtotal - couponDiscountTotal),
                Number(loyaltyAdjustments.loyaltyDiscount || 0)
            );
            const loyaltyShippingDiscountTotal = Math.min(
                Math.max(0, shippingFee),
                Number(loyaltyAdjustments.shippingDiscount || 0)
            );
            const taxResult = await computeTaxForItems({
                connection,
                orderItems,
                subtotal,
                shippingFee,
                couponDiscountTotal,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal
            });
            const taxedOrderItems = taxResult.items || orderItems;
            const taxTotal = Number(taxResult.taxTotal || 0);
            const taxBreakup = taxResult.taxBreakup || [];
            const discountTotal = couponDiscountTotal + loyaltyDiscountTotal + loyaltyShippingDiscountTotal;
            const total = Math.max(0, subtotal + shippingFee + taxTotal - discountTotal);
            const orderRef = await buildOrderRef(connection);
            const paymentStatus = payment?.paymentStatus || 'created';
            const paymentGateway = payment?.gateway || 'razorpay';
            const razorpayOrderId = payment?.razorpayOrderId || null;
            const razorpayPaymentId = payment?.razorpayPaymentId || null;
            const razorpaySignature = payment?.razorpaySignature || null;
            const settlementId = payment?.settlementId || null;
            const settlementSnapshot = payment?.settlementSnapshot || null;
            const couponMeta = coupon ? {
                percent: coupon.percent || 0,
                fixedAmount: coupon.fixedAmount || 0,
                source: coupon.source || 'coupon',
                discountSubunits: coupon.discountSubunits || 0
            } : null;
            const isAbandonedRecovery = coupon?.journeyId ? 1 : 0;
            const loyaltyTier = String(eligibleLoyaltyTier || 'regular').toLowerCase();
            const loyaltyMeta = {
                tierProfile: loyaltyStatus?.profile || null,
                adjustmentProfile: loyaltyAdjustments.profile || null,
                progress: loyaltyStatus?.progress || null
            };
            const companyProfile = await CompanyProfile.get();
            const companySnapshot = CompanyProfile.sanitizeForSnapshot(companyProfile);

            const [orderResult] = await connection.execute(
                `INSERT INTO orders 
                (order_ref, user_id, status, payment_status, payment_gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature, coupon_code, coupon_type, coupon_discount_value, coupon_meta, loyalty_tier, loyalty_discount_total, loyalty_shipping_discount_total, loyalty_meta, source_channel, is_abandoned_recovery, abandoned_journey_id, subtotal, shipping_fee, discount_total, tax_total, tax_breakup_json, total, currency, billing_address, shipping_address, company_snapshot, settlement_id, settlement_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderRef,
                    userId,
                    'confirmed',
                    paymentStatus,
                    paymentGateway,
                    razorpayOrderId,
                    razorpayPaymentId,
                    razorpaySignature,
                    coupon?.code || null,
                    coupon?.type || null,
                    couponDiscountTotal,
                    couponMeta ? JSON.stringify(couponMeta) : null,
                    loyaltyTier,
                    loyaltyDiscountTotal,
                    loyaltyShippingDiscountTotal,
                    JSON.stringify(loyaltyMeta),
                    sourceChannel ? String(sourceChannel).slice(0, 30) : null,
                    isAbandonedRecovery,
                    coupon?.journeyId || null,
                    subtotal,
                    shippingFee,
                    discountTotal,
                    taxTotal,
                    JSON.stringify(taxBreakup),
                    total,
                    'INR',
                    JSON.stringify(billingAddress || null),
                    JSON.stringify(shippingAddress || null),
                    JSON.stringify(companySnapshot),
                    settlementId,
                    settlementSnapshot ? JSON.stringify(settlementSnapshot) : null
                ]
            );

            const orderId = orderResult.insertId;
            if (coupon?.id) {
                await Coupon.markRedeemed({
                    source: coupon.source || 'coupon',
                    id: coupon.id,
                    orderId,
                    userId,
                    connection
                });
            }
            await connection.execute(
                'INSERT INTO order_status_events (order_id, status) VALUES (?, ?)',
                [orderId, 'confirmed']
            );
            if (taxedOrderItems.length) {
                const values = taxedOrderItems.map(item => ([
                    orderId,
                    item.productId,
                    item.variantId,
                    item.title,
                    item.variantTitle,
                    item.quantity,
                    item.price,
                    item.lineTotal,
                    item.taxRatePercent || 0,
                    item.taxAmount || 0,
                    item.taxName || null,
                    item.taxCode || null,
                    item.taxSnapshot ? JSON.stringify(item.taxSnapshot) : null,
                    item.imageUrl,
                    item.sku,
                    JSON.stringify(item.snapshot || null)
                ]));
                await connection.query(
                    `INSERT INTO order_items 
                    (order_id, product_id, variant_id, title, variant_title, quantity, price, line_total, tax_rate_percent, tax_amount, tax_name, tax_code, tax_snapshot_json, image_url, sku, item_snapshot)
                    VALUES ?`,
                    [values]
                );
            }

            await connection.execute('DELETE FROM cart_items WHERE user_id = ?', [userId]);

            await connection.commit();
            await reassessUserTier(userId, { reason: 'order_paid', sendNotifications: true, notificationMode: 'upgrade_welcome' }).catch(() => {});

            return {
                id: orderId,
                orderRef,
                userId,
                status: 'confirmed',
                paymentStatus,
                paymentGateway,
                razorpayOrderId,
                razorpayPaymentId,
                subtotal,
                shippingFee,
                discountTotal,
                taxTotal,
                taxBreakup,
                total,
                currency: 'INR',
                couponCode: coupon?.code || null,
                couponType: coupon?.type || null,
                couponDiscountTotal,
                loyaltyTier,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal,
                loyaltyMeta,
                sourceChannel: sourceChannel || null,
                isAbandonedRecovery: Boolean(isAbandonedRecovery),
                abandonedJourneyId: coupon?.journeyId || null,
                billingAddress: normalizeAddress(billingAddress),
                shippingAddress: normalizeAddress(shippingAddress),
                companySnapshot,
                items: taxedOrderItems
            };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async createFromRecoveryJourney(userId, {
        journey,
        payment = null,
        billingAddress = null,
        shippingAddress = null,
        orderRef = null,
        shippingFeeOverrideSubunits = null
    }) {
        if (!userId) throw new Error('userId is required');
        if (!journey?.id) throw new Error('journey is required');
        const snapshotItems = Array.isArray(journey.cart_snapshot_json) ? journey.cart_snapshot_json : [];
        if (!snapshotItems.length) throw new Error('Recovery snapshot is empty');

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const orderItems = snapshotItems.map((item) => {
                const quantity = Math.max(1, Number(item?.quantity || 1));
                const price = Number(item?.price || 0);
                const lineTotal = Number(item?.lineTotal ?? (price * quantity));
                return {
                    productId: item?.productId || null,
                    variantId: item?.variantId || '',
                    title: item?.title || 'Item',
                    variantTitle: item?.variantTitle || null,
                    quantity,
                    price,
                    lineTotal,
                    imageUrl: item?.imageUrl || item?.image_url || null,
                    sku: item?.sku || null,
                    snapshot: {
                        ...item,
                        quantity,
                        unitPrice: price,
                        lineTotal,
                        capturedAt: new Date().toISOString()
                    }
                };
            });
            const recoveryProductIds = [...new Set(orderItems.map((item) => item.productId).filter(Boolean))];
            if (recoveryProductIds.length) {
                const placeholders = recoveryProductIds.map(() => '?').join(',');
                const [taxRows] = await connection.execute(
                    `SELECT id, tax_config_id, polish_warranty_months FROM products WHERE id IN (${placeholders})`,
                    recoveryProductIds
                );
                const taxByProductId = new Map(taxRows.map((row) => [String(row.id), row.tax_config_id || null]));
                const warrantyByProductId = new Map(taxRows.map((row) => [String(row.id), Number(row.polish_warranty_months || 6)]));
                orderItems.forEach((item) => {
                    item.taxConfigId = taxByProductId.get(String(item.productId || '')) || null;
                    const polishWarrantyMonths = warrantyByProductId.get(String(item.productId || '')) || Number(item?.snapshot?.polishWarrantyMonths || 6);
                    item.snapshot = {
                        ...(item.snapshot || {}),
                        taxConfigId: item.taxConfigId,
                        polishWarrantyMonths
                    };
                });
            }

            const subtotal = fromSubunits(Number(journey.cart_total_subunits || 0))
                || orderItems.reduce((sum, item) => sum + Number(item.lineTotal || 0), 0);
            const totalWeightKg = orderItems.reduce((sum, item) => {
                const weight = Number(item?.snapshot?.weightKg || item?.weightKg || 0);
                const qty = Number(item?.quantity || 0);
                return sum + (weight * qty);
            }, 0);
            const shippingFee = shippingFeeOverrideSubunits != null
                ? fromSubunits(Number(shippingFeeOverrideSubunits || 0))
                : await computeShippingFee(connection, shippingAddress, subtotal, totalWeightKg);
            const discountTotal = 0;
            const taxResult = await computeTaxForItems({
                connection,
                orderItems,
                subtotal,
                shippingFee,
                couponDiscountTotal: 0,
                loyaltyDiscountTotal: 0,
                loyaltyShippingDiscountTotal: 0
            });
            const taxedOrderItems = taxResult.items || orderItems;
            const taxTotal = Number(taxResult.taxTotal || 0);
            const taxBreakup = taxResult.taxBreakup || [];
            const total = subtotal + shippingFee + taxTotal - discountTotal;

            const paymentStatus = payment?.paymentStatus || 'paid';
            const paymentGateway = payment?.gateway || 'razorpay';
            const razorpayOrderId = payment?.razorpayOrderId || null;
            const razorpayPaymentId = payment?.razorpayPaymentId || null;
            const settlementId = payment?.settlementId || null;
            const settlementSnapshot = payment?.settlementSnapshot || null;
            const finalOrderRef = orderRef || await buildOrderRef(connection);
            const loyaltyStatus = await getUserLoyaltyStatus(userId);
            const isMembershipEligible = Boolean(loyaltyStatus?.eligibility?.isEligible);
            const eligibleLoyaltyTier = isMembershipEligible ? (loyaltyStatus?.tier || 'regular') : 'regular';
            const companyProfile = await CompanyProfile.get();
            const companySnapshot = CompanyProfile.sanitizeForSnapshot(companyProfile);

            const [orderResult] = await connection.execute(
                `INSERT INTO orders
                (order_ref, user_id, status, payment_status, payment_gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature, coupon_code, coupon_type, coupon_discount_value, coupon_meta, loyalty_tier, loyalty_discount_total, loyalty_shipping_discount_total, loyalty_meta, source_channel, is_abandoned_recovery, abandoned_journey_id, subtotal, shipping_fee, discount_total, tax_total, tax_breakup_json, total, currency, billing_address, shipping_address, company_snapshot, settlement_id, settlement_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    finalOrderRef,
                    userId,
                    'confirmed',
                    paymentStatus,
                    paymentGateway,
                    razorpayOrderId,
                    razorpayPaymentId,
                    null,
                    null,
                    null,
                    0,
                    null,
                    String(eligibleLoyaltyTier || 'regular').toLowerCase(),
                    0,
                    0,
                    JSON.stringify({ tierProfile: loyaltyStatus?.profile || null, progress: loyaltyStatus?.progress || null }),
                    'abandoned_recovery',
                    1,
                    journey.id,
                    subtotal,
                    shippingFee,
                    discountTotal,
                    taxTotal,
                    JSON.stringify(taxBreakup),
                    total,
                    'INR',
                    JSON.stringify(billingAddress || null),
                    JSON.stringify(shippingAddress || null),
                    JSON.stringify(companySnapshot),
                    settlementId,
                    settlementSnapshot ? JSON.stringify(settlementSnapshot) : null
                ]
            );

            const orderId = orderResult.insertId;
            await connection.execute(
                'INSERT INTO order_status_events (order_id, status) VALUES (?, ?)',
                [orderId, 'confirmed']
            );

            const values = taxedOrderItems.map((item) => ([
                orderId,
                item.productId,
                item.variantId,
                item.title,
                item.variantTitle,
                item.quantity,
                item.price,
                item.lineTotal,
                item.taxRatePercent || 0,
                item.taxAmount || 0,
                item.taxName || null,
                item.taxCode || null,
                item.taxSnapshot ? JSON.stringify(item.taxSnapshot) : null,
                item.imageUrl,
                item.sku,
                JSON.stringify(item.snapshot || null)
            ]));
            await connection.query(
                `INSERT INTO order_items
                (order_id, product_id, variant_id, title, variant_title, quantity, price, line_total, tax_rate_percent, tax_amount, tax_name, tax_code, tax_snapshot_json, image_url, sku, item_snapshot)
                VALUES ?`,
                [values]
            );

            await connection.execute('DELETE FROM cart_items WHERE user_id = ?', [userId]);
            await connection.commit();
            await reassessUserTier(userId, { reason: 'order_paid', sendNotifications: true, notificationMode: 'upgrade_welcome' }).catch(() => {});
            return Order.getById(orderId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getAdminManualQuote(userId, {
        shippingAddress = null,
        couponCode = null,
        items = []
    } = {}) {
        const connection = await db.getConnection();
        try {
            const {
                orderItems,
                subtotal,
                totalWeightKg,
                cartProductIds
            } = await buildOrderItemsFromSelections(connection, items, { deductStock: false });
            const shippingFee = await computeShippingFee(connection, shippingAddress, subtotal, totalWeightKg);
            let couponDiscountTotal = 0;
            let coupon = null;
            const loyaltyStatus = await getUserLoyaltyStatus(userId);
            const isMembershipEligible = Boolean(loyaltyStatus?.eligibility?.isEligible);
            const eligibleLoyaltyTier = isMembershipEligible ? (loyaltyStatus?.tier || 'regular') : 'regular';
            if (couponCode) {
                const discount = await Coupon.resolveRedeemableCoupon({
                    code: couponCode,
                    userId,
                    cartTotalSubunits: toSubunits(subtotal),
                    shippingFeeSubunits: toSubunits(shippingFee),
                    loyaltyTier: eligibleLoyaltyTier,
                    cartProductIds,
                    connection
                });
                if (!discount) {
                    throw new Error('Coupon is invalid or expired');
                }
                couponDiscountTotal = fromSubunits(discount.discountSubunits);
                coupon = {
                    id: discount.id,
                    code: discount.code,
                    source: discount.source || 'coupon',
                    type: discount.type || 'percent',
                    percent: Number(discount.percent || 0),
                    fixedAmount: Number(discount.fixedAmount || 0),
                    journeyId: discount.journeyId || null,
                    discountSubunits: Number(discount.discountSubunits || 0)
                };
            }
            const maxCouponDiscount = Math.max(0, subtotal + shippingFee);
            if (couponDiscountTotal > maxCouponDiscount) couponDiscountTotal = maxCouponDiscount;
            const loyaltyAdjustments = calculateOrderLoyaltyAdjustments({
                subtotal,
                shippingFee,
                couponDiscount: couponDiscountTotal,
                tier: eligibleLoyaltyTier,
                membershipEligible: isMembershipEligible
            });
            const loyaltyDiscountTotal = Math.min(
                Math.max(0, subtotal - couponDiscountTotal),
                Number(loyaltyAdjustments.loyaltyDiscount || 0)
            );
            const loyaltyShippingDiscountTotal = Math.min(
                Math.max(0, shippingFee),
                Number(loyaltyAdjustments.shippingDiscount || 0)
            );
            const taxResult = await computeTaxForItems({
                connection,
                orderItems,
                subtotal,
                shippingFee,
                couponDiscountTotal,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal
            });
            const taxedOrderItems = taxResult.items || orderItems;
            const taxTotal = Number(taxResult.taxTotal || 0);
            const taxBreakup = taxResult.taxBreakup || [];
            const discountTotal = couponDiscountTotal + loyaltyDiscountTotal + loyaltyShippingDiscountTotal;
            const total = Math.max(0, subtotal + shippingFee + taxTotal - discountTotal);
            return {
                items: taxedOrderItems,
                subtotal,
                shippingFee,
                couponDiscountTotal,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal,
                taxTotal,
                taxBreakup,
                discountTotal,
                total,
                currency: 'INR',
                coupon,
                loyaltyTier: String(eligibleLoyaltyTier || 'regular').toLowerCase(),
                loyaltyMeta: {
                    profile: loyaltyAdjustments.profile || null,
                    progress: loyaltyStatus?.progress || null
                }
            };
        } finally {
            connection.release();
        }
    }

    static async createAdminManualOrder(userId, {
        billingAddress,
        shippingAddress,
        payment = null,
        couponCode = null,
        sourceChannel = null,
        items = []
    }) {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const {
                orderItems,
                subtotal,
                shippingFee,
                couponDiscountTotal,
                loyaltyDiscountTotal,
                loyaltyShippingDiscountTotal,
                taxTotal,
                taxBreakup,
                discountTotal,
                total,
                coupon,
                loyaltyTier,
                loyaltyMeta
            } = await Order.getAdminManualQuote(userId, { shippingAddress, couponCode, items });

            await buildOrderItemsFromSelections(connection, items, { deductStock: true });
            const orderRef = await buildOrderRef(connection);
            const paymentStatus = payment?.paymentStatus || 'paid';
            const paymentGateway = payment?.gateway || 'manual';
            const paymentReference = String(payment?.paymentReference || '').trim();
            const couponMeta = coupon ? {
                percent: coupon.percent || 0,
                fixedAmount: coupon.fixedAmount || 0,
                source: coupon.source || 'coupon',
                discountSubunits: coupon.discountSubunits || 0
            } : null;
            const persistedLoyaltyMeta = {
                ...(loyaltyMeta && typeof loyaltyMeta === 'object' ? loyaltyMeta : {}),
                manualPaymentReference: paymentReference || null
            };
            const companyProfile = await CompanyProfile.get();
            const companySnapshot = CompanyProfile.sanitizeForSnapshot(companyProfile);
            const [orderResult] = await connection.execute(
                `INSERT INTO orders 
                (order_ref, user_id, status, payment_status, payment_gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature, coupon_code, coupon_type, coupon_discount_value, coupon_meta, loyalty_tier, loyalty_discount_total, loyalty_shipping_discount_total, loyalty_meta, source_channel, is_abandoned_recovery, abandoned_journey_id, subtotal, shipping_fee, discount_total, tax_total, tax_breakup_json, total, currency, billing_address, shipping_address, company_snapshot, settlement_id, settlement_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderRef,
                    userId,
                    'confirmed',
                    paymentStatus,
                    paymentGateway,
                    null,
                    null,
                    null,
                    coupon?.code || null,
                    coupon?.type || null,
                    couponDiscountTotal,
                    couponMeta ? JSON.stringify(couponMeta) : null,
                    loyaltyTier,
                    loyaltyDiscountTotal,
                    loyaltyShippingDiscountTotal,
                    JSON.stringify(persistedLoyaltyMeta),
                    sourceChannel ? String(sourceChannel).slice(0, 30) : null,
                    0,
                    null,
                    subtotal,
                    shippingFee,
                    discountTotal,
                    taxTotal,
                    JSON.stringify(taxBreakup || []),
                    total,
                    'INR',
                    JSON.stringify(billingAddress || null),
                    JSON.stringify(shippingAddress || null),
                    JSON.stringify(companySnapshot),
                    null,
                    null
                ]
            );
            const orderId = orderResult.insertId;
            if (coupon?.id) {
                await Coupon.markRedeemed({
                    source: coupon.source || 'coupon',
                    id: coupon.id,
                    orderId,
                    userId,
                    connection
                });
            }
            await connection.execute(
                'INSERT INTO order_status_events (order_id, status) VALUES (?, ?)',
                [orderId, 'confirmed']
            );
            const values = orderItems.map(item => ([
                orderId,
                item.productId,
                item.variantId,
                item.title,
                item.variantTitle,
                item.quantity,
                item.price,
                item.lineTotal,
                item.taxRatePercent || 0,
                item.taxAmount || 0,
                item.taxName || null,
                item.taxCode || null,
                item.taxSnapshot ? JSON.stringify(item.taxSnapshot) : null,
                item.imageUrl,
                item.sku,
                JSON.stringify(item.snapshot || null)
            ]));
            await connection.query(
                `INSERT INTO order_items 
                (order_id, product_id, variant_id, title, variant_title, quantity, price, line_total, tax_rate_percent, tax_amount, tax_name, tax_code, tax_snapshot_json, image_url, sku, item_snapshot)
                VALUES ?`,
                [values]
            );
            await connection.commit();
            await reassessUserTier(userId, { reason: 'order_paid', sendNotifications: true, notificationMode: 'upgrade_welcome' }).catch(() => {});
            return Order.getById(orderId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async createManualOrderFromAttempt({
        attempt = null,
        paymentGateway = 'manual',
        paymentReference = '',
        actorUserId = null,
        auditReason = '',
        paymentStatus = 'paid',
        razorpayOrderId = null,
        razorpayPaymentId = null,
        razorpaySignature = null,
        settlementId = null,
        settlementSnapshot = null,
        sourceChannel = 'admin_attempt_conversion'
    } = {}) {
        if (!attempt || !attempt.id) throw new Error('Payment attempt is required');
        if (attempt.local_order_id) throw new Error('Attempt already linked to an order');
        const userId = String(attempt.user_id || '').trim();
        if (!userId) throw new Error('Attempt user is missing');

        const notes = parseJsonSafe(attempt.notes) || {};
        const snapshot = notes?.attemptSnapshot && typeof notes.attemptSnapshot === 'object'
            ? notes.attemptSnapshot
            : null;
        const pricing = snapshot?.pricing && typeof snapshot.pricing === 'object'
            ? snapshot.pricing
            : {};
        const loyalty = snapshot?.loyalty && typeof snapshot.loyalty === 'object'
            ? snapshot.loyalty
            : {};
        const coupon = snapshot?.coupon && typeof snapshot.coupon === 'object'
            ? snapshot.coupon
            : {};

        let snapshotItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
        if (!snapshotItems.length) {
            const [reservationRows] = await db.execute(
                `SELECT
                    pir.id,
                    pir.product_id,
                    pir.variant_id,
                    pir.quantity,
                    p.title as product_title,
                    COALESCE(pv.variant_title, '') as variant_title,
                    COALESCE(
                        NULLIF(pv.discount_price, 0),
                        NULLIF(pv.price, 0),
                        NULLIF(p.discount_price, 0),
                        NULLIF(p.mrp, 0),
                        0
                    ) as unit_price,
                    p.polish_warranty_months,
                    COALESCE(
                        NULLIF(pv.image_url, ''),
                        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.media, '$[0].url')), ''),
                        ''
                    ) as image_url,
                    COALESCE(NULLIF(pv.sku, ''), NULLIF(p.sku, '')) as sku
                 FROM payment_item_reservations pir
                 LEFT JOIN products p ON p.id = pir.product_id
                 LEFT JOIN product_variants pv ON pv.id = pir.variant_id
                 WHERE pir.attempt_id = ?
                 ORDER BY pir.id ASC`,
                [attempt.id]
            );
            snapshotItems = (reservationRows || []).map((row) => {
                const quantity = Math.max(0, Number(row.quantity || 0));
                const unitPrice = Math.max(0, Number(row.unit_price || 0));
                return {
                    id: row.id,
                    productId: row.product_id,
                    variantId: row.variant_id || '',
                    title: row.product_title || 'Product',
                    variantTitle: row.variant_title || '',
                    quantity,
                    unitPrice,
                    lineTotal: Number((quantity * unitPrice).toFixed(2)),
                    imageUrl: row.image_url || '',
                    sku: row.sku || null,
                    polishWarrantyMonths: Number(row.polish_warranty_months || 6),
                    capturedAt: new Date().toISOString()
                };
            });
        }

        if (!snapshotItems.length) {
            throw new Error('Attempt snapshot has no items to convert');
        }

        const subtotal = Number(pricing.subtotal ?? fromSubunits(attempt.amount_subunits) ?? 0);
        const shippingFee = Number(pricing.shippingFee ?? 0);
        const discountTotal = Number(pricing.discountTotal ?? 0);
        const total = Number(pricing.total ?? fromSubunits(attempt.amount_subunits) ?? 0);
        const taxTotal = Number(pricing.taxTotal ?? 0);
        const taxBreakup = Array.isArray(pricing.taxBreakup) ? pricing.taxBreakup : [];
        const couponDiscountTotal = Number(pricing.couponDiscountTotal ?? 0);
        const loyaltyDiscountTotal = Number(pricing.loyaltyDiscountTotal ?? 0);
        const loyaltyShippingDiscountTotal = Number(pricing.loyaltyShippingDiscountTotal ?? 0);
        const loyaltyTier = String(loyalty?.tier || 'regular').toLowerCase();

        const orderItems = snapshotItems.map((item) => {
            const quantity = Math.max(0, Number(item?.quantity || 0));
            const unitPrice = Math.max(0, Number(item?.unitPrice ?? item?.price ?? 0));
            const lineTotal = Number(item?.lineTotal ?? (quantity * unitPrice));
            return {
                productId: item?.productId || null,
                variantId: item?.variantId || '',
                title: item?.title || 'Product',
                variantTitle: item?.variantTitle || '',
                quantity,
                price: unitPrice,
                lineTotal: Number.isFinite(lineTotal) ? lineTotal : 0,
                taxConfigId: item?.taxConfigId || null,
                imageUrl: item?.imageUrl || '',
                sku: item?.sku || null,
                snapshot: item && typeof item === 'object' ? item : null
            };
        });

        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const companyProfile = await CompanyProfile.get();
            const companySnapshot = CompanyProfile.sanitizeForSnapshot(companyProfile);
            const orderRef = await buildOrderRef(connection);
            const loyaltyMeta = {
                ...(loyalty?.meta && typeof loyalty.meta === 'object' ? loyalty.meta : {}),
                source: 'attempt_snapshot_conversion',
                convertedBy: actorUserId || null,
                convertedAt: new Date().toISOString(),
                paymentReference: String(paymentReference || '').trim() || null,
                manualConversionReason: String(auditReason || '').trim() || null
            };
            const couponMeta = coupon?.code ? {
                source: coupon?.source || 'coupon',
                type: coupon?.type || null,
                discountSubunits: toSubunits(couponDiscountTotal)
            } : null;
            const hasTaxDataInSnapshot = orderItems.some((item) => {
                const snap = item?.snapshot && typeof item.snapshot === 'object' ? item.snapshot : null;
                return Number(item?.taxAmount || 0) > 0 || Number(snap?.taxAmount || 0) > 0 || Number(snap?.taxRatePercent || 0) > 0;
            });
            const taxComputed = hasTaxDataInSnapshot
                ? {
                    taxTotal: Number.isFinite(taxTotal) ? taxTotal : 0,
                    taxBreakup: Array.isArray(taxBreakup) ? taxBreakup : [],
                    items: orderItems.map((item) => {
                        const snap = item?.snapshot && typeof item.snapshot === 'object' ? item.snapshot : {};
                        return {
                            ...item,
                            taxRatePercent: Number(item.taxRatePercent ?? snap.taxRatePercent ?? 0),
                            taxAmount: Number(item.taxAmount ?? snap.taxAmount ?? 0),
                            taxName: item.taxName ?? snap.taxName ?? null,
                            taxCode: item.taxCode ?? snap.taxCode ?? null,
                            taxSnapshot: snap?.taxSnapshot || (snap.taxCode || snap.taxName ? {
                                id: snap.taxId || null,
                                name: snap.taxName || null,
                                code: snap.taxCode || null,
                                ratePercent: Number(snap.taxRatePercent || 0)
                            } : null)
                        };
                    })
                }
                : await computeTaxForItems({
                    connection,
                    orderItems,
                    subtotal,
                    shippingFee,
                    couponDiscountTotal,
                    loyaltyDiscountTotal,
                    loyaltyShippingDiscountTotal
                });
            const finalTaxTotal = Number(taxComputed.taxTotal || 0);
            const finalTaxBreakup = taxComputed.taxBreakup || [];
            const finalOrderItems = taxComputed.items || orderItems;
            const finalTotal = Number.isFinite(total) && total > 0
                ? total
                : Math.max(0, subtotal + shippingFee + finalTaxTotal - discountTotal);

            const [orderResult] = await connection.execute(
                `INSERT INTO orders
                (order_ref, user_id, status, payment_status, payment_gateway, razorpay_order_id, razorpay_payment_id, razorpay_signature, coupon_code, coupon_type, coupon_discount_value, coupon_meta, loyalty_tier, loyalty_discount_total, loyalty_shipping_discount_total, loyalty_meta, source_channel, is_abandoned_recovery, abandoned_journey_id, subtotal, shipping_fee, discount_total, tax_total, tax_breakup_json, total, currency, billing_address, shipping_address, company_snapshot, settlement_id, settlement_snapshot)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    orderRef,
                    userId,
                    'confirmed',
                    String(paymentStatus || 'paid').slice(0, 30),
                    String(paymentGateway || 'manual').slice(0, 30),
                    String(razorpayOrderId || '').trim() || null,
                    String(razorpayPaymentId || '').trim() || null,
                    String(razorpaySignature || '').trim() || null,
                    coupon?.code || null,
                    coupon?.type || null,
                    couponDiscountTotal,
                    couponMeta ? JSON.stringify(couponMeta) : null,
                    loyaltyTier,
                    loyaltyDiscountTotal,
                    loyaltyShippingDiscountTotal,
                    JSON.stringify(loyaltyMeta),
                    String(sourceChannel || 'admin_attempt_conversion').slice(0, 30),
                    0,
                    null,
                    subtotal,
                    shippingFee,
                    discountTotal,
                    finalTaxTotal,
                    JSON.stringify(finalTaxBreakup),
                    finalTotal,
                    String(attempt.currency || 'INR'),
                    JSON.stringify(normalizeAddress(attempt.billing_address) || null),
                    JSON.stringify(normalizeAddress(attempt.shipping_address) || null),
                    JSON.stringify(companySnapshot),
                    String(settlementId || '').trim() || null,
                    settlementSnapshot ? JSON.stringify(settlementSnapshot) : null
                ]
            );

            const orderId = orderResult.insertId;
            await connection.execute(
                'INSERT INTO order_status_events (order_id, status, actor_user_id) VALUES (?, ?, ?)',
                [orderId, 'confirmed', actorUserId || null]
            );
            const values = finalOrderItems.map((item) => ([
                orderId,
                item.productId,
                item.variantId,
                item.title,
                item.variantTitle,
                item.quantity,
                item.price,
                item.lineTotal,
                item.taxRatePercent || 0,
                item.taxAmount || 0,
                item.taxName || null,
                item.taxCode || null,
                item.taxSnapshot ? JSON.stringify(item.taxSnapshot) : null,
                item.imageUrl,
                item.sku,
                JSON.stringify(item.snapshot || null)
            ]));
            await connection.query(
                `INSERT INTO order_items
                (order_id, product_id, variant_id, title, variant_title, quantity, price, line_total, tax_rate_percent, tax_amount, tax_name, tax_code, tax_snapshot_json, image_url, sku, item_snapshot)
                VALUES ?`,
                [values]
            );

            await connection.execute(
                `UPDATE payment_item_reservations
                 SET status = 'consumed',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE attempt_id = ?
                   AND status = 'reserved'`,
                [attempt.id]
            );
            await connection.execute(
                `UPDATE payment_attempts
                 SET local_order_id = ?,
                     status = 'paid',
                     verify_started_at = NULL,
                     verified_at = CURRENT_TIMESTAMP,
                     failure_reason = NULL,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?
                   AND local_order_id IS NULL`,
                [orderId, attempt.id]
            );

            await connection.commit();
            await reassessUserTier(userId, { reason: 'order_paid', sendNotifications: true, notificationMode: 'upgrade_welcome' }).catch(() => {});
            return Order.getById(orderId);
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    static async getByRazorpayOrderId(razorpayOrderId) {
        const [rows] = await db.execute(
            'SELECT id FROM orders WHERE razorpay_order_id = ? ORDER BY id DESC LIMIT 1',
            [razorpayOrderId]
        );
        if (!rows.length) return null;
        return Order.getById(rows[0].id);
    }

    static async getByRazorpayPaymentId(razorpayPaymentId) {
        const [rows] = await db.execute(
            'SELECT id FROM orders WHERE razorpay_payment_id = ? ORDER BY id DESC LIMIT 1',
            [razorpayPaymentId]
        );
        if (!rows.length) return null;
        return Order.getById(rows[0].id);
    }

    static async getBySettlementId(settlementId, { limit = 100 } = {}) {
        const ref = String(settlementId || '').trim();
        if (!ref) return [];
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 100));
        const [rows] = await db.execute(
            `SELECT id
             FROM orders
             WHERE settlement_id = ?
             ORDER BY id DESC
             LIMIT ?`,
            [ref, safeLimit]
        );
        if (!rows.length) return [];
        const orders = await Promise.all(rows.map((row) => Order.getById(row.id)));
        return orders.filter(Boolean);
    }

    static async getAdminPaymentHealthSummary() {
        const [[unlinkedPaidRows]] = await db.execute(
            `SELECT COUNT(*) as total
             FROM payment_attempts
             WHERE local_order_id IS NULL
               AND LOWER(COALESCE(status, '')) = 'paid'`
        );
        const [[staleAttemptRows]] = await db.execute(
            `SELECT COUNT(*) as total
             FROM payment_attempts
             WHERE local_order_id IS NULL
               AND LOWER(COALESCE(status, '')) IN ('created', 'attempted')
               AND created_at < DATE_SUB(NOW(), INTERVAL 30 MINUTE)`
        );
        const [[failedSettlementRows]] = await db.execute(
            `SELECT COUNT(*) as total
             FROM orders
             WHERE LOWER(COALESCE(payment_gateway, '')) = 'razorpay'
               AND LOWER(COALESCE(JSON_UNQUOTE(JSON_EXTRACT(settlement_snapshot, '$.status')), '')) = 'failed'`
        );
        const [[missingSettlementRows]] = await db.execute(
            `SELECT COUNT(*) as total
             FROM orders
             WHERE LOWER(COALESCE(payment_gateway, '')) = 'razorpay'
               AND LOWER(COALESCE(payment_status, '')) = 'paid'
               AND created_at < DATE_SUB(NOW(), INTERVAL 2 DAY)
               AND COALESCE(NULLIF(settlement_id, ''), '') = ''`
        );

        const summary = {
            unlinkedPaidAttempts: Number(unlinkedPaidRows?.total || 0),
            staleActiveAttempts: Number(staleAttemptRows?.total || 0),
            failedSettlements: Number(failedSettlementRows?.total || 0),
            missingSettlements: Number(missingSettlementRows?.total || 0)
        };
        return {
            ...summary,
            totalIssues: Object.values(summary).reduce((sum, value) => sum + Number(value || 0), 0)
        };
    }

    static async updatePaymentByRazorpayOrderId({
        razorpayOrderId,
        paymentStatus,
        razorpayPaymentId = null,
        razorpaySignature = null,
        settlementId = null,
        settlementSnapshot = null,
        refundReference = null,
        refundAmount = null,
        refundStatus = null
    }) {
        const [result] = await db.execute(
            `UPDATE orders
             SET payment_status = ?,
                 payment_gateway = 'razorpay',
                 razorpay_payment_id = COALESCE(?, razorpay_payment_id),
                 razorpay_signature = COALESCE(?, razorpay_signature),
                 settlement_id = COALESCE(?, settlement_id),
                 settlement_snapshot = COALESCE(?, settlement_snapshot),
                 refund_reference = COALESCE(?, refund_reference),
                 refund_amount = COALESCE(?, refund_amount),
                 refund_status = COALESCE(?, refund_status),
                 updated_at = CURRENT_TIMESTAMP
             WHERE razorpay_order_id = ?`,
            [
                paymentStatus,
                razorpayPaymentId,
                razorpaySignature,
                settlementId,
                settlementSnapshot ? JSON.stringify(settlementSnapshot) : null,
                refundReference,
                refundAmount,
                refundStatus,
                razorpayOrderId
            ]
        );
        return Number(result?.affectedRows || 0);
    }

    static async updateSettlementByOrderId({
        orderId,
        settlementId = null,
        settlementSnapshot = null
    } = {}) {
        const [result] = await db.execute(
            `UPDATE orders
             SET settlement_id = COALESCE(?, settlement_id),
                 settlement_snapshot = COALESCE(?, settlement_snapshot),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [settlementId, settlementSnapshot ? JSON.stringify(settlementSnapshot) : null, orderId]
        );
        return Number(result?.affectedRows || 0);
    }

    static async getPaginated({
        page = 1,
        limit = 20,
        status = 'all',
        search = '',
        startDate = '',
        endDate = '',
        quickRange = 'last_90_days',
        sortBy = 'newest',
        sourceChannel = 'all'
    }) {
        const safeLimit = Math.max(1, Number(limit) || 20);
        const safePage = Math.max(1, Number(page) || 1);
        const offset = (safePage - 1) * safeLimit;
        const latestLimit = quickRange === 'latest_10' ? 10 : null;
        const includeAttemptRows = (status === 'all' || status === 'failed') && String(sourceChannel || 'all').toLowerCase() === 'all';

        const buildDateClause = (alias, params) => {
            switch (quickRange) {
                case 'last_7_days':
                    return ` AND ${alias}.created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)`;
                case 'last_30_days':
                case 'last_1_month':
                    return ` AND ${alias}.created_at >= DATE_SUB(NOW(), INTERVAL 1 MONTH)`;
                case 'last_90_days':
                    return ` AND ${alias}.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
                case 'latest_10':
                    return ` AND ${alias}.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
                default: {
                    let clause = '';
                    if (startDate) {
                        clause += ` AND DATE(${alias}.created_at) >= ?`;
                        params.push(startDate);
                    }
                    if (endDate) {
                        clause += ` AND DATE(${alias}.created_at) <= ?`;
                        params.push(endDate);
                    }
                    if (!startDate && !endDate) {
                        clause += ` AND ${alias}.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
                    }
                    return clause;
                }
            }
        };

        const searchClauseForOrder = (params) => {
            if (!search) return '';
            const term = `%${search}%`;
            params.push(term, term, term, term, term);
            return ' AND (o.order_ref LIKE ? OR u.name LIKE ? OR u.mobile LIKE ? OR o.razorpay_order_id LIKE ? OR o.razorpay_payment_id LIKE ?)';
        };

        const searchClauseForAttempt = (params) => {
            if (!search) return '';
            const term = `%${search}%`;
            params.push(term, term, term, term);
            return ' AND (pa.razorpay_order_id LIKE ? OR pa.razorpay_payment_id LIKE ? OR u.name LIKE ? OR u.mobile LIKE ?)';
        };

        const orderParams = [];
        const orderStatusParams = [];
        const orderStatusClause = buildAdminStatusClause({ status, alias: 'o', params: orderStatusParams });
        let orderWhere = 'WHERE 1=1';
        if (sourceChannel && sourceChannel !== 'all') {
            const normalizedSource = String(sourceChannel || '').trim().toLowerCase();
            if (normalizedSource === 'abandoned_recovery') {
                orderWhere += " AND (o.is_abandoned_recovery = 1 OR LOWER(COALESCE(o.source_channel, '')) = 'abandoned_recovery')";
            } else if (normalizedSource === 'direct') {
                orderWhere += " AND (o.is_abandoned_recovery = 0 AND (COALESCE(o.source_channel, '') = '' OR LOWER(o.source_channel) <> 'abandoned_recovery'))";
            } else {
                orderWhere += ' AND LOWER(COALESCE(o.source_channel, \'\')) = ?';
                orderParams.push(normalizedSource);
            }
        }
        orderWhere += searchClauseForOrder(orderParams);
        orderWhere += buildDateClause('o', orderParams);
        const orderWhereWithStatus = `${orderWhere}${orderStatusClause}`;

        const attemptParams = [];
        let attemptWhere = `WHERE pa.local_order_id IS NULL
            AND pa.status IN ('failed', 'attempted', 'created', 'expired')
            AND NOT EXISTS (
                SELECT 1
                FROM payment_attempts pa_success
                WHERE pa_success.user_id = pa.user_id
                  AND pa_success.created_at > pa.created_at
                  AND (
                    pa_success.local_order_id IS NOT NULL
                    OR pa_success.status = 'paid'
                  )
            )
            AND NOT (
                pa.status = 'failed'
                AND EXISTS (
                    SELECT 1
                    FROM payment_attempts pa_retry
                    WHERE pa_retry.user_id = pa.user_id
                      AND JSON_UNQUOTE(JSON_EXTRACT(pa_retry.notes, '$.retryOfAttemptId')) = CAST(pa.id AS CHAR)
                      AND (
                          pa_retry.local_order_id IS NOT NULL
                          OR pa_retry.status = 'paid'
                      )
                )
            )`;
        attemptWhere += searchClauseForAttempt(attemptParams);
        attemptWhere += buildDateClause('pa', attemptParams);

        const orderWhereForUnion = latestLimit ? orderWhere : orderWhereWithStatus;
        const unionSql = `
            SELECT
                CAST(o.id AS CHAR) as id,
                'order' as entity_type,
                o.id as order_id,
                NULL as attempt_id,
                o.order_ref,
                o.user_id,
                o.status,
                o.payment_status,
                o.payment_gateway,
                o.razorpay_order_id,
                o.razorpay_payment_id,
                o.coupon_code,
                o.coupon_type,
                o.coupon_discount_value,
                o.coupon_meta,
                o.loyalty_tier,
                o.loyalty_discount_total,
                o.loyalty_shipping_discount_total,
                o.loyalty_meta,
                NULL as attempt_notes,
                o.source_channel,
                o.is_abandoned_recovery,
                o.abandoned_journey_id,
                o.refund_reference,
                o.refund_amount,
                o.refund_status,
                o.refund_mode,
                o.refund_method,
                o.manual_refund_ref,
                o.manual_refund_utr,
                o.refund_coupon_code,
                o.refund_notes,
                o.subtotal,
                o.shipping_fee,
                o.discount_total,
                o.total,
                o.currency,
                o.billing_address,
                o.shipping_address,
                o.created_at,
                o.updated_at,
                u.name as customer_name,
                u.mobile as customer_mobile,
                NULL as failure_reason
            FROM orders o
            LEFT JOIN users u ON u.id = o.user_id
            ${orderWhereForUnion}
            ${includeAttemptRows ? `
            UNION ALL
            SELECT
                CONCAT('attempt_', pa.id) as id,
                'attempt' as entity_type,
                NULL as order_id,
                pa.id as attempt_id,
                CONCAT('PAY-', pa.razorpay_order_id) as order_ref,
                pa.user_id,
                'failed' as status,
                pa.status as payment_status,
                'razorpay' as payment_gateway,
                pa.razorpay_order_id,
                pa.razorpay_payment_id,
                NULL as coupon_code,
                NULL as coupon_type,
                0 as coupon_discount_value,
                NULL as coupon_meta,
                COALESCE(NULLIF(LOWER(JSON_UNQUOTE(JSON_EXTRACT(pa.notes, '$.attemptSnapshot.loyalty.tier'))), ''), 'regular') as loyalty_tier,
                0 as loyalty_discount_total,
                0 as loyalty_shipping_discount_total,
                NULL as loyalty_meta,
                pa.notes as attempt_notes,
                NULL as source_channel,
                0 as is_abandoned_recovery,
                NULL as abandoned_journey_id,
                NULL as refund_reference,
                0 as refund_amount,
                NULL as refund_status,
                NULL as refund_mode,
                NULL as refund_method,
                NULL as manual_refund_ref,
                NULL as manual_refund_utr,
                NULL as refund_coupon_code,
                NULL as refund_notes,
                ROUND(pa.amount_subunits / 100, 2) as subtotal,
                0 as shipping_fee,
                0 as discount_total,
                ROUND(pa.amount_subunits / 100, 2) as total,
                pa.currency,
                pa.billing_address,
                pa.shipping_address,
                pa.created_at,
                pa.updated_at,
                u.name as customer_name,
                u.mobile as customer_mobile,
                pa.failure_reason
            FROM payment_attempts pa
            LEFT JOIN users u ON u.id = pa.user_id
            ${attemptWhere}` : ''}
        `;

        const baseQueryParams = includeAttemptRows
            ? [...orderParams, ...attemptParams]
            : [...orderParams];
        const normalQueryParams = includeAttemptRows
            ? [...orderParams, ...orderStatusParams, ...attemptParams]
            : [...orderParams, ...orderStatusParams];

        const latestStatusParams = [];
        const latestStatusClause = buildAdminStatusClause({ status, alias: 'scoped_rows', params: latestStatusParams });

        let total = 0;
        if (latestLimit) {
            const [countRows] = await db.execute(
                `SELECT COUNT(*) as total
                 FROM (
                    SELECT *
                    FROM (${unionSql}) combined_rows
                    ORDER BY created_at DESC
                    LIMIT ${latestLimit}
                 ) scoped_rows
                 WHERE 1=1 ${latestStatusClause}`,
                [...baseQueryParams, ...latestStatusParams]
            );
            total = Number(countRows[0]?.total || 0);
        } else {
            const [countRows] = await db.execute(
                `SELECT COUNT(*) as total FROM (${unionSql}) combined_rows`,
                normalQueryParams
            );
            total = Number(countRows[0]?.total || 0);
        }
        if (total === 0 || offset >= total) {
            return {
                orders: [],
                total,
                totalPages: Math.ceil(total / safeLimit)
            };
        }

        const queryLimit = Math.min(safeLimit, total - offset);
        let rows = [];

        if (latestLimit) {
            const [latestFilteredRows] = await db.execute(
                `SELECT *
                 FROM (
                    SELECT *
                    FROM (${unionSql}) combined_rows
                    ORDER BY created_at DESC
                    LIMIT ${latestLimit}
                 ) scoped_rows
                 WHERE 1=1 ${latestStatusClause}
                 ORDER BY created_at DESC
                 LIMIT ? OFFSET ?`,
                [...baseQueryParams, ...latestStatusParams, Number(queryLimit), Number(offset)]
            );
            rows = latestFilteredRows;
        } else {
            const mappedOrderBy = (() => {
                if (sortBy === 'priority') {
                    return `CASE LOWER(COALESCE(loyalty_tier, 'regular'))
                        WHEN 'platinum' THEN 5
                        WHEN 'gold' THEN 4
                        WHEN 'silver' THEN 3
                        WHEN 'bronze' THEN 2
                        ELSE 1
                    END DESC, created_at DESC`;
                }
                if (sortBy === 'amount_high') return 'total DESC, created_at DESC';
                if (sortBy === 'amount_low') return 'total ASC, created_at DESC';
                if (sortBy === 'oldest') return 'created_at ASC';
                return 'created_at DESC';
            })();
            const [normalRows] = await db.execute(
                `SELECT * FROM (${unionSql}) combined_rows
                 ORDER BY ${mappedOrderBy}
                 LIMIT ? OFFSET ?`,
                [...normalQueryParams, Number(queryLimit), Number(offset)]
            );
            rows = normalRows;
        }

        const attemptItemMap = {};
        const attemptIds = rows
            .filter((row) => String(row?.entity_type || '').toLowerCase() === 'attempt')
            .map((row) => Number(row.attempt_id))
            .filter((id) => Number.isFinite(id) && id > 0);
        if (attemptIds.length > 0) {
            const placeholders = attemptIds.map(() => '?').join(',');
            const [attemptItems] = await db.execute(
                `SELECT
                    pir.id,
                    pir.attempt_id,
                    pir.product_id,
                    pir.variant_id,
                    pir.quantity,
                    p.title as product_title,
                    COALESCE(pv.variant_title, '') as variant_title,
                    COALESCE(
                        NULLIF(pv.discount_price, 0),
                        NULLIF(pv.price, 0),
                        NULLIF(p.discount_price, 0),
                        NULLIF(p.mrp, 0),
                        0
                    ) as unit_price,
                    COALESCE(
                        NULLIF(pv.image_url, ''),
                        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(p.media, '$[0].url')), ''),
                        ''
                    ) as image_url
                 FROM payment_item_reservations pir
                 LEFT JOIN products p ON p.id = pir.product_id
                 LEFT JOIN product_variants pv ON pv.id = pir.variant_id
                 WHERE pir.attempt_id IN (${placeholders})
                 ORDER BY pir.attempt_id ASC, pir.id ASC`,
                attemptIds
            );
            for (const item of (attemptItems || [])) {
                const attemptId = Number(item.attempt_id);
                if (!Number.isFinite(attemptId) || attemptId <= 0) continue;
                const quantity = Math.max(0, Number(item.quantity || 0));
                const unitPrice = Math.max(0, Number(item.unit_price || 0));
                const entry = {
                    id: item.id,
                    product_id: item.product_id,
                    variant_id: item.variant_id,
                    title: item.product_title || 'Product',
                    variant_title: item.variant_title || '',
                    quantity,
                    price: unitPrice,
                    line_total: Number((quantity * unitPrice).toFixed(2)),
                    image_url: item.image_url || ''
                };
                if (!attemptItemMap[attemptId]) attemptItemMap[attemptId] = [];
                attemptItemMap[attemptId].push(entry);
            }
        }

        const normalized = rows.map((row) => {
            const base = {
                ...row,
                billing_address: normalizeAddress(row.billing_address),
                shipping_address: normalizeAddress(row.shipping_address),
                company_snapshot: parseJsonSafe(row.company_snapshot),
                settlement_snapshot: parseJsonSafe(row.settlement_snapshot),
                refund_notes: parseJsonSafe(row.refund_notes),
                loyalty_meta: parseJsonSafe(row.loyalty_meta),
                tax_breakup_json: parseJsonSafe(row.tax_breakup_json),
                attempt_notes: parseJsonSafe(row.attempt_notes),
                coupon_meta: row?.coupon_meta && typeof row.coupon_meta === 'string'
                    ? (() => {
                        try { return JSON.parse(row.coupon_meta); } catch { return null; }
                    })()
                    : row.coupon_meta || null,
                items: String(row?.entity_type || '').toLowerCase() === 'attempt'
                    ? (attemptItemMap[Number(row.attempt_id)] || [])
                    : [],
                events: []
            };
            if (row.entity_type === 'attempt') {
                const attemptNotes = base.attempt_notes && typeof base.attempt_notes === 'object'
                    ? base.attempt_notes
                    : {};
                const snapshot = attemptNotes?.attemptSnapshot && typeof attemptNotes.attemptSnapshot === 'object'
                    ? attemptNotes.attemptSnapshot
                    : null;
                const snapshotItems = Array.isArray(snapshot?.items) ? snapshot.items : [];
                const mappedSnapshotItems = snapshotItems.map((item, index) => {
                    const quantity = Math.max(0, Number(item?.quantity || 0));
                    const unitPrice = Math.max(0, Number(item?.unitPrice ?? item?.price ?? 0));
                    const lineTotal = Number(
                        item?.lineTotal != null
                            ? item.lineTotal
                            : (unitPrice * quantity)
                    );
                    return {
                        id: item?.id || `snap_${base.attempt_id}_${index + 1}`,
                        product_id: item?.productId || null,
                        variant_id: item?.variantId || '',
                        title: item?.title || 'Product',
                        variant_title: item?.variantTitle || '',
                        quantity,
                        price: unitPrice,
                        line_total: Number.isFinite(lineTotal) ? lineTotal : 0,
                        tax_rate_percent: Number(item?.taxRatePercent || 0),
                        tax_amount: Number(item?.taxAmount || 0),
                        tax_name: item?.taxName || null,
                        tax_code: item?.taxCode || null,
                        tax_snapshot_json: item?.taxSnapshot || null,
                        image_url: item?.imageUrl || '',
                        sku: item?.sku || null,
                        item_snapshot: item && typeof item === 'object' ? item : null
                    };
                });
                const pricing = snapshot?.pricing && typeof snapshot.pricing === 'object'
                    ? snapshot.pricing
                    : null;
                const loyalty = snapshot?.loyalty && typeof snapshot.loyalty === 'object'
                    ? snapshot.loyalty
                    : null;
                const coupon = snapshot?.coupon && typeof snapshot.coupon === 'object'
                    ? snapshot.coupon
                    : null;
                return {
                    ...base,
                    loyalty_tier: String(
                        loyalty?.tier
                        || base.loyalty_tier
                        || 'regular'
                    ).toLowerCase(),
                    loyalty_discount_total: Number(
                        pricing?.loyaltyDiscountTotal
                        ?? base.loyalty_discount_total
                        ?? 0
                    ),
                    loyalty_shipping_discount_total: Number(
                        pricing?.loyaltyShippingDiscountTotal
                        ?? base.loyalty_shipping_discount_total
                        ?? 0
                    ),
                    loyalty_meta: loyalty?.meta || base.loyalty_meta || null,
                    coupon_code: coupon?.code || base.coupon_code || null,
                    coupon_type: coupon?.type || base.coupon_type || null,
                    coupon_discount_value: Number(
                        pricing?.couponDiscountTotal
                        ?? base.coupon_discount_value
                        ?? 0
                    ),
                    subtotal: Number(pricing?.subtotal ?? base.subtotal ?? 0),
                    shipping_fee: Number(pricing?.shippingFee ?? base.shipping_fee ?? 0),
                    discount_total: Number(pricing?.discountTotal ?? base.discount_total ?? 0),
                    tax_total: Number(pricing?.taxTotal ?? base.tax_total ?? 0),
                    tax_breakup_json: Array.isArray(pricing?.taxBreakup)
                        ? pricing.taxBreakup
                        : (parseJsonSafe(base.tax_breakup_json) || []),
                    total: Number(pricing?.total ?? base.total ?? 0),
                    items: mappedSnapshotItems.length
                        ? mappedSnapshotItems
                        : (attemptItemMap[Number(base.attempt_id)] || [])
                };
            }
            return applyDefaultPending(base);
        });
        return {
            orders: normalized,
            total,
            totalPages: Math.ceil(total / safeLimit)
        };
    }

    static async getById(orderId) {
        const [orders] = await db.execute(
            `SELECT o.*, u.name as customer_name, u.mobile as customer_mobile
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.id = ?`,
            [orderId]
        );
        if (!orders.length) return null;
        const order = orders[0];
        const [items] = await db.execute(
            'SELECT * FROM order_items WHERE order_id = ? ORDER BY id ASC',
            [orderId]
        );
        const normalizedItems = items.map((item) => {
            let itemSnapshot = item.item_snapshot;
            let taxSnapshot = item.tax_snapshot_json;
            if (itemSnapshot && typeof itemSnapshot === 'string') {
                try { itemSnapshot = JSON.parse(itemSnapshot); } catch { itemSnapshot = null; }
            }
            if (taxSnapshot && typeof taxSnapshot === 'string') {
                try { taxSnapshot = JSON.parse(taxSnapshot); } catch { taxSnapshot = null; }
            }
            return { ...item, item_snapshot: itemSnapshot, tax_snapshot_json: taxSnapshot };
        });
        const [events] = await db.execute(
            'SELECT * FROM order_status_events WHERE order_id = ? ORDER BY created_at ASC',
            [orderId]
        );
        return applyDefaultPending({
            ...order,
            billing_address: normalizeAddress(order.billing_address),
            shipping_address: normalizeAddress(order.shipping_address),
            company_snapshot: parseJsonSafe(order.company_snapshot),
            settlement_snapshot: parseJsonSafe(order.settlement_snapshot),
            refund_notes: parseJsonSafe(order.refund_notes),
            loyalty_meta: parseJsonSafe(order.loyalty_meta),
            tax_breakup_json: parseJsonSafe(order.tax_breakup_json),
            coupon_meta: order?.coupon_meta && typeof order.coupon_meta === 'string'
                ? (() => {
                    try { return JSON.parse(order.coupon_meta); } catch { return null; }
                })()
                : order.coupon_meta || null,
            items: normalizedItems,
            events
        });
    }

    static async getByUser(userId) {
        const result = await Order.getByUserPaginated({ userId, page: 1, limit: 500, duration: String(MAX_FETCH_RANGE_DAYS) });
        return result.orders;
    }

    static async getByUserPaginated({ userId, page = 1, limit = 10, duration = String(MAX_FETCH_RANGE_DAYS) }) {
        const safeLimit = Math.max(1, Number(limit) || 10);
        const safePage = Math.max(1, Number(page) || 1);
        const offset = (safePage - 1) * safeLimit;
        let latestLimit = null;
        let where = 'WHERE o.user_id = ?';
        const params = [userId];

        if (duration === 'latest_10') {
            where += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
            latestLimit = 10;
        } else if (duration) {
            const days = Number(duration);
            if (Number.isFinite(days) && days > 0) {
                const safeDays = Math.min(MAX_FETCH_RANGE_DAYS, Math.max(1, Math.round(days)));
                where += ' AND o.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
                params.push(safeDays);
            } else {
                where += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
            }
        } else {
            where += ` AND o.created_at >= DATE_SUB(NOW(), INTERVAL ${MAX_FETCH_RANGE_DAYS} DAY)`;
        }

        const [countRows] = await db.execute(
            `SELECT COUNT(*) as total
             FROM orders o
             ${where}`,
            params
        );

        const totalRaw = Number(countRows[0]?.total || 0);
        const total = latestLimit ? Math.min(totalRaw, latestLimit) : totalRaw;
        if (total === 0 || offset >= total) {
            return {
                orders: [],
                total,
                totalPages: Math.ceil(total / safeLimit)
            };
        }

        const queryLimit = Math.min(safeLimit, total - offset);
        let orders = [];
        if (latestLimit) {
            const [latestRows] = await db.execute(
                `SELECT * FROM (
                    SELECT o.*
                    FROM orders o
                    ${where}
                    ORDER BY o.created_at DESC
                    LIMIT ${latestLimit}
                ) latest_orders
                ORDER BY latest_orders.created_at DESC
                LIMIT ? OFFSET ?`,
                [...params, Number(queryLimit), Number(offset)]
            );
            orders = latestRows;
        } else {
            const [normalRows] = await db.execute(
                `SELECT o.*
                 FROM orders o
                 ${where}
                 ORDER BY o.created_at DESC
                 LIMIT ? OFFSET ?`,
                [...params, Number(queryLimit), Number(offset)]
            );
            orders = normalRows;
        }

        if (!orders.length) {
            return {
                orders: [],
                total,
                totalPages: Math.ceil(total / safeLimit)
            };
        }

        const orderIds = orders.map(o => o.id);
        const placeholders = orderIds.map(() => '?').join(',');
        const [items] = await db.execute(
            `SELECT * FROM order_items WHERE order_id IN (${placeholders}) ORDER BY order_id DESC, id ASC`,
            orderIds
        );
        const [events] = await db.execute(
            `SELECT * FROM order_status_events WHERE order_id IN (${placeholders}) ORDER BY created_at ASC`,
            orderIds
        );
        const itemsByOrder = items.reduce((acc, item) => {
            if (item.item_snapshot && typeof item.item_snapshot === 'string') {
                try { item.item_snapshot = JSON.parse(item.item_snapshot); } catch { item.item_snapshot = null; }
            }
            if (item.tax_snapshot_json && typeof item.tax_snapshot_json === 'string') {
                try { item.tax_snapshot_json = JSON.parse(item.tax_snapshot_json); } catch { item.tax_snapshot_json = null; }
            }
            acc[item.order_id] = acc[item.order_id] || [];
            acc[item.order_id].push(item);
            return acc;
        }, {});
        const eventsByOrder = events.reduce((acc, evt) => {
            acc[evt.order_id] = acc[evt.order_id] || [];
            acc[evt.order_id].push(evt);
            return acc;
        }, {});
        const normalizedOrders = orders.map(order => applyDefaultPending({
            ...order,
            billing_address: normalizeAddress(order.billing_address),
            shipping_address: normalizeAddress(order.shipping_address),
            company_snapshot: parseJsonSafe(order.company_snapshot),
            settlement_snapshot: parseJsonSafe(order.settlement_snapshot),
            refund_notes: parseJsonSafe(order.refund_notes),
            loyalty_meta: parseJsonSafe(order.loyalty_meta),
            tax_breakup_json: parseJsonSafe(order.tax_breakup_json),
            coupon_meta: order?.coupon_meta && typeof order.coupon_meta === 'string'
                ? (() => {
                    try { return JSON.parse(order.coupon_meta); } catch { return null; }
                })()
                : order.coupon_meta || null,
            items: itemsByOrder[order.id] || [],
            events: eventsByOrder[order.id] || []
        }));

        return {
            orders: normalizedOrders,
            total,
            totalPages: Math.ceil(total / safeLimit)
        };
    }

    static async getMetrics({ status = 'all', search = '', startDate = '', endDate = '', quickRange = 'last_90_days', sourceChannel = 'all' } = {}) {
        const { where, params, latestLimit } = buildAdminOrderFilters({
            status,
            search,
            startDate,
            endDate,
            quickRange,
            sourceChannel,
            includeStatus: !Boolean(quickRange === 'latest_10')
        });
        const latestStatusParams = [];
        const latestStatusClause = buildAdminStatusClause({ status, alias: 'scoped', params: latestStatusParams });
        let summaryRows = [];
        if (latestLimit) {
            [summaryRows] = await db.execute(
                `SELECT
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN scoped.status <> 'cancelled' THEN scoped.total ELSE 0 END) as total_revenue,
                    SUM(CASE WHEN scoped.status = 'pending' OR (scoped.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, scoped.created_at, UTC_TIMESTAMP()) >= 24) THEN 1 ELSE 0 END) as pending_orders,
                    SUM(CASE WHEN scoped.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, scoped.created_at, UTC_TIMESTAMP()) < 24 THEN 1 ELSE 0 END) as confirmed_orders,
                    SUM(CASE WHEN DATE(scoped.created_at) = CURDATE() THEN 1 ELSE 0 END) as today_orders,
                    SUM(CASE WHEN DATE(scoped.created_at) = CURDATE() AND scoped.status <> 'cancelled' THEN scoped.total ELSE 0 END) as today_revenue
                 FROM (
                    SELECT o.total, o.status, o.created_at
                    FROM orders o
                    LEFT JOIN users u ON u.id = o.user_id
                    ${where}
                    ORDER BY o.created_at DESC
                    LIMIT ${latestLimit}
                 ) scoped
                 WHERE 1=1 ${latestStatusClause}`,
                [...params, ...latestStatusParams]
            );
        } else {
            [summaryRows] = await db.execute(
                `SELECT
                    COUNT(*) as total_orders,
                    SUM(CASE WHEN o.status <> 'cancelled' THEN o.total ELSE 0 END) as total_revenue,
                    SUM(CASE WHEN o.status = 'pending' OR (o.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, o.created_at, UTC_TIMESTAMP()) >= 24) THEN 1 ELSE 0 END) as pending_orders,
                    SUM(CASE WHEN o.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, o.created_at, UTC_TIMESTAMP()) < 24 THEN 1 ELSE 0 END) as confirmed_orders,
                    SUM(CASE WHEN DATE(o.created_at) = CURDATE() THEN 1 ELSE 0 END) as today_orders,
                    SUM(CASE WHEN DATE(o.created_at) = CURDATE() AND o.status <> 'cancelled' THEN o.total ELSE 0 END) as today_revenue
                 FROM orders o
                 LEFT JOIN users u ON u.id = o.user_id
                 ${where}`,
                params
            );
        }

        return {
            totalOrders: summaryRows[0]?.total_orders || 0,
            totalRevenue: Number(summaryRows[0]?.total_revenue || 0),
            pendingOrders: summaryRows[0]?.pending_orders || 0,
            confirmedOrders: summaryRows[0]?.confirmed_orders || 0,
            todayOrders: summaryRows[0]?.today_orders || 0,
            todayRevenue: Number(summaryRows[0]?.today_revenue || 0)
        };
    }

    static async updateStatus(orderId, status, options = {}) {
        const allowed = ['pending', 'confirmed', 'shipped', 'completed', 'cancelled'];
        if (!allowed.includes(status)) {
            throw new Error('Invalid status');
        }
        const {
            courierPartner = null,
            awbNumber = null,
            paymentStatus = null,
            refundReference = null,
            refundAmount = null,
            refundStatus = null,
            refundMode = null,
            refundMethod = null,
            manualRefundRef = null,
            manualRefundUtr = null,
            refundCouponCode = null,
            refundNotes = null,
            actorUserId = null,
            restoreInventory = false
        } = options || {};
        const normalizedCourier = String(courierPartner || '').trim();
        const normalizedAwb = String(awbNumber || '').trim();
        const normalizedPaymentStatus = String(paymentStatus || '').trim().toLowerCase();
        const paymentStatusValue = normalizedPaymentStatus || null;
        const normalizedRefundMode = String(refundMode || '').trim().toLowerCase();
        const normalizedRefundMethod = String(refundMethod || '').trim();
        const normalizedManualRefundRef = String(manualRefundRef || '').trim();
        const normalizedManualRefundUtr = String(manualRefundUtr || '').trim();
        const normalizedRefundCouponCode = String(refundCouponCode || '').trim().toUpperCase();
        const normalizedRefundReference = String(refundReference || '').trim();
        const setShippedAt = status === 'shipped';
        const setCompletedAt = status === 'completed';
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();

            const [orderRows] = await connection.execute(
                'SELECT id, inventory_restored_at FROM orders WHERE id = ? FOR UPDATE',
                [orderId]
            );
            if (!orderRows.length) {
                throw new Error('Order not found');
            }
            const lockedOrder = orderRows[0];

            await connection.execute(
                `UPDATE orders
                 SET status = ?,
                     payment_status = COALESCE(?, payment_status),
                     refund_reference = COALESCE(?, refund_reference),
                     refund_amount = COALESCE(?, refund_amount),
                     refund_status = COALESCE(?, refund_status),
                     courier_partner = COALESCE(?, courier_partner),
                     awb_number = COALESCE(?, awb_number),
                     refund_mode = COALESCE(?, refund_mode),
                     refund_method = COALESCE(?, refund_method),
                     manual_refund_ref = COALESCE(?, manual_refund_ref),
                     manual_refund_utr = COALESCE(?, manual_refund_utr),
                     refund_coupon_code = COALESCE(?, refund_coupon_code),
                     refund_notes = COALESCE(?, refund_notes),
                     shipped_at = CASE
                        WHEN ? THEN COALESCE(shipped_at, NOW())
                        ELSE shipped_at
                     END,
                     completed_at = CASE
                        WHEN ? THEN COALESCE(completed_at, NOW())
                        ELSE completed_at
                     END
                 WHERE id = ?`,
                [
                    status,
                    paymentStatusValue,
                    normalizedRefundReference || null,
                    refundAmount != null ? Number(refundAmount) : null,
                    String(refundStatus || '').trim() || null,
                    normalizedCourier || null,
                    normalizedAwb || null,
                    normalizedRefundMode || null,
                    normalizedRefundMethod || null,
                    normalizedManualRefundRef || null,
                    normalizedManualRefundUtr || null,
                    normalizedRefundCouponCode || null,
                    refundNotes ? JSON.stringify(refundNotes) : null,
                    setShippedAt ? 1 : 0,
                    setCompletedAt ? 1 : 0,
                    orderId
                ]
            );

            if (restoreInventory && !lockedOrder.inventory_restored_at) {
                const [items] = await connection.execute(
                    'SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = ? ORDER BY id ASC',
                    [orderId]
                );
                const affectedProductIds = new Set();
                for (const item of items || []) {
                    const productId = Number(item?.product_id || 0);
                    const variantId = Number(item?.variant_id || 0);
                    const quantity = Math.max(0, Number(item?.quantity || 0));
                    if (!Number.isFinite(productId) || productId <= 0 || quantity <= 0) continue;
                    affectedProductIds.add(String(productId));
                    if (variantId > 0) {
                        await connection.execute('SELECT id FROM product_variants WHERE id = ? FOR UPDATE', [variantId]);
                        await connection.execute(
                            'UPDATE product_variants SET quantity = quantity + ? WHERE id = ?',
                            [quantity, variantId]
                        );
                    } else {
                        await connection.execute('SELECT id FROM products WHERE id = ? FOR UPDATE', [productId]);
                        await connection.execute(
                            'UPDATE products SET quantity = quantity + ? WHERE id = ?',
                            [quantity, productId]
                        );
                    }
                }
                await connection.execute(
                    'UPDATE orders SET inventory_restored_at = NOW() WHERE id = ? AND inventory_restored_at IS NULL',
                    [orderId]
                );
            }

            await connection.execute(
                'INSERT INTO order_status_events (order_id, status, actor_user_id) VALUES (?, ?, ?)',
                [orderId, status, actorUserId || null]
            );
            await connection.commit();
            return true;
        } catch (error) {
            try { await connection.rollback(); } catch {}
            throw error;
        } finally {
            connection.release();
        }
    }

    static async markDeliveryConfirmationReminderSent(orderId) {
        const id = Number(orderId);
        if (!Number.isFinite(id) || id <= 0) return false;
        await db.execute(
            `UPDATE orders
             SET delivery_confirmation_requested_at = NOW(),
                 delivery_confirmation_request_count = COALESCE(delivery_confirmation_request_count, 0) + 1
             WHERE id = ?`,
            [id]
        );
        return true;
    }

    static async getShippedOrdersForCustomerConfirmation({ afterDays = 7, limit = 200 } = {}) {
        const safeDays = Math.max(1, Number(afterDays) || 7);
        const safeLimit = Math.max(1, Math.min(500, Number(limit) || 200));
        const [rows] = await db.execute(
            `SELECT o.*, u.name as customer_name, u.mobile as customer_mobile, u.email as customer_email
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.status = 'shipped'
               AND o.user_id IS NOT NULL
               AND u.email IS NOT NULL
               AND (o.delivery_confirmation_requested_at IS NULL)
               AND COALESCE(o.shipped_at, o.updated_at, o.created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY COALESCE(o.shipped_at, o.updated_at, o.created_at) ASC
             LIMIT ?`,
            [safeDays, safeLimit]
        );
        return (rows || []).map((row) => applyDefaultPending({
            ...row,
            billing_address: normalizeAddress(row.billing_address),
            shipping_address: normalizeAddress(row.shipping_address),
            company_snapshot: parseJsonSafe(row.company_snapshot),
            settlement_snapshot: parseJsonSafe(row.settlement_snapshot),
            refund_notes: parseJsonSafe(row.refund_notes),
            loyalty_meta: parseJsonSafe(row.loyalty_meta),
            coupon_meta: row?.coupon_meta && typeof row.coupon_meta === 'string'
                ? (() => {
                    try { return JSON.parse(row.coupon_meta); } catch { return null; }
                })()
                : row.coupon_meta || null
        }));
    }

    static async getOverdueShippedSummary({ afterDays = 30, limit = 5 } = {}) {
        const safeDays = Math.max(1, Number(afterDays) || 30);
        const safeLimit = Math.max(1, Math.min(20, Number(limit) || 5));
        const [countRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM orders o
             WHERE o.status = 'shipped'
               AND COALESCE(o.shipped_at, o.updated_at, o.created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)`,
            [safeDays]
        );
        const total = Number(countRows?.[0]?.total || 0);
        if (total <= 0) return { total: 0, cases: [] };

        const [rows] = await db.execute(
            `SELECT o.id, o.order_ref, o.total, o.courier_partner, o.awb_number, o.shipped_at, o.created_at,
                    u.name AS customer_name, u.mobile AS customer_mobile
             FROM orders o
             LEFT JOIN users u ON u.id = o.user_id
             WHERE o.status = 'shipped'
               AND COALESCE(o.shipped_at, o.updated_at, o.created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
             ORDER BY COALESCE(o.shipped_at, o.updated_at, o.created_at) ASC
             LIMIT ?`,
            [safeDays, safeLimit]
        );
        return { total, cases: rows || [] };
    }

    static async deleteById(orderId) {
        const [result] = await db.execute('DELETE FROM orders WHERE id = ?', [orderId]);
        return Number(result?.affectedRows || 0) > 0;
    }

    static async markStaleAsPending() {
        const connection = await db.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.execute(
                `SELECT id FROM orders
                 WHERE status IN ('confirmed')
                 AND DATE(created_at) < CURDATE()`
            );
            if (rows.length === 0) {
                await connection.commit();
                return { updated: 0 };
            }
            const ids = rows.map(r => r.id);
            const placeholders = ids.map(() => '?').join(',');
            await connection.execute(
                `UPDATE orders SET status = 'pending' WHERE id IN (${placeholders})`,
                ids
            );
            const values = ids.map(id => [id, 'pending']);
            await connection.query(
                'INSERT INTO order_status_events (order_id, status) VALUES ?',
                [values]
            );
            await connection.commit();
            return { updated: ids.length, ids };
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }
}

module.exports = Order;
module.exports.__test = {
    computeTaxForItems
};
