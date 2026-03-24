const db = require('../config/db');

const AUTOPILOT_REFRESH_MS = 3 * 24 * 60 * 60 * 1000;
const AUTOPILOT_MAX_PRODUCTS = 25;
const AUTOPILOT_NATIVE_LIMIT = 18;
const PERSONALIZED_OFFERS_CACHE_MS = 10 * 60 * 1000;
const SUPPORTED_SYSTEM_KEYS = ['best_sellers', 'new_arrivals', 'offers'];
const personalizedOffersCache = new Map();

const normalizeKey = (value = '') => String(value || '').trim().toLowerCase();
const isSupportedSystemKey = (value = '') => SUPPORTED_SYSTEM_KEYS.includes(normalizeKey(value));
const isAutopilotCapableCategory = (category = {}) => isSupportedSystemKey(category?.system_key);
const isAutopilotEnabledCategory = (category = {}) => isAutopilotCapableCategory(category) && Number(category?.autopilot_enabled || 0) === 1;
const parseJsonSafe = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const hashString = (value = '') => {
    const input = String(value || '');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) - hash) + input.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

const getRefreshBucket = (date = new Date()) => Math.floor(date.getTime() / AUTOPILOT_REFRESH_MS);

const getViewerSeed = ({ viewerKey = '', systemKey = '', bucket = getRefreshBucket() } = {}) => (
    `${normalizeKey(systemKey)}::${String(viewerKey || 'guest').trim().toLowerCase()}::${bucket}`
);

const deterministicSort = (rows = [], { seed = '', score = null } = {}) => (
    [...rows].sort((a, b) => {
        const scoreDelta = typeof score === 'function' ? Number(score(a, b) || 0) : 0;
        if (scoreDelta !== 0) return scoreDelta;
        const aHash = hashString(`${seed}:${a.id}`);
        const bHash = hashString(`${seed}:${b.id}`);
        if (aHash !== bHash) return aHash - bHash;
        return String(a.id || '').localeCompare(String(b.id || ''));
    })
);

const uniqueIds = (rows = []) => [...new Set((Array.isArray(rows) ? rows : []).map((entry) => String(entry?.id || entry || '').trim()).filter(Boolean))];
const parseIdCsv = (value = '') => uniqueIds(String(value || '').split(',').map((part) => String(part || '').trim()).filter(Boolean));
const isShippingDiscountType = (value = '') => ['shipping_full', 'shipping_partial'].includes(normalizeKey(value));

const isCategoryStale = (category = {}) => {
    const refreshedAt = category?.autopilot_refreshed_at ? new Date(category.autopilot_refreshed_at).getTime() : 0;
    if (!refreshedAt || Number.isNaN(refreshedAt)) return true;
    return (Date.now() - refreshedAt) >= AUTOPILOT_REFRESH_MS;
};

const fetchAutopilotCapableCategory = async ({ categoryId = null, categoryName = '' } = {}) => {
    if (categoryId) {
        const [rows] = await db.execute(
            `SELECT id, name, image_url, system_key, is_immutable, autopilot_enabled, autopilot_mode, autopilot_catalog_json, autopilot_refreshed_at
             FROM categories
             WHERE id = ?
             LIMIT 1`,
            [categoryId]
        );
        return rows?.[0] || null;
    }

    const normalizedName = String(categoryName || '').trim();
    if (!normalizedName) return null;
    const [rows] = await db.execute(
        `SELECT id, name, image_url, system_key, is_immutable, autopilot_enabled, autopilot_mode, autopilot_catalog_json, autopilot_refreshed_at
         FROM categories
         WHERE LOWER(name) = LOWER(?)
         LIMIT 1`,
        [normalizedName]
    );
    return rows?.[0] || null;
};

const fetchEnabledAutopilotCategories = async () => {
    const [rows] = await db.execute(
        `SELECT id, name, image_url, system_key, is_immutable, autopilot_enabled, autopilot_mode, autopilot_catalog_json, autopilot_refreshed_at
         FROM categories
         WHERE autopilot_enabled = 1
           AND system_key IN ('best_sellers', 'new_arrivals', 'offers')
         ORDER BY id ASC`
    );
    return rows || [];
};

const fetchActiveProductMetrics = async () => {
    const [rows] = await db.execute(
        `SELECT
            p.id,
            p.created_at,
            p.updated_at,
            p.mrp,
            p.discount_price,
            COALESCE(NULLIF(p.discount_price, 0), p.mrp, 0) AS effective_price,
            (
                SELECT GROUP_CONCAT(DISTINCT pc2.category_id ORDER BY pc2.category_id SEPARATOR ',')
                FROM product_categories pc2
                WHERE pc2.product_id = p.id
            ) AS category_ids_csv,
            COALESCE(SUM(
                CASE
                    WHEN LOWER(COALESCE(o.status, '')) NOT IN ('cancelled', 'failed', 'refunded')
                         AND LOWER(COALESCE(o.payment_status, 'paid')) NOT IN ('failed', 'refunded')
                    THEN oi.quantity
                    ELSE 0
                END
            ), 0) AS sales_qty,
            CASE
                WHEN p.discount_price IS NOT NULL
                     AND p.discount_price > 0
                     AND (p.mrp IS NULL OR p.discount_price < p.mrp)
                THEN 1
                WHEN EXISTS (
                    SELECT 1
                    FROM product_variants pv
                    WHERE pv.product_id = p.id
                      AND pv.discount_price IS NOT NULL
                      AND pv.discount_price > 0
                      AND (pv.price IS NULL OR pv.discount_price < pv.price)
                ) THEN 1
                ELSE 0
            END AS has_discount
         FROM products p
         LEFT JOIN order_items oi ON oi.product_id = p.id
         LEFT JOIN orders o ON o.id = oi.order_id
         WHERE LOWER(COALESCE(p.status, '')) = 'active'
         GROUP BY p.id, p.created_at, p.updated_at, p.mrp, p.discount_price
         ORDER BY p.created_at DESC`
    );

    return (rows || []).map((row) => ({
        ...row,
        sales_qty: Number(row.sales_qty || 0),
        has_discount: Number(row.has_discount || 0) === 1,
        effective_price: Number(row.effective_price || 0),
        category_ids: parseIdCsv(row.category_ids_csv)
    }));
};

const fetchActiveCouponRows = async ({ userId = '' } = {}) => {
    const normalizedUserId = String(userId || '').trim();
    const [rows] = await db.execute(
        `SELECT c.*,
                EXISTS(
                    SELECT 1
                    FROM coupon_user_targets cut
                    WHERE cut.coupon_id = c.id
                      AND cut.user_id = ?
                ) AS is_user_target
         FROM coupons c
         WHERE c.is_active = 1
           AND (c.starts_at IS NULL OR c.starts_at <= NOW())
           AND (c.expires_at IS NULL OR c.expires_at >= NOW())
         ORDER BY c.created_at DESC
         LIMIT 500`,
        [normalizedUserId]
    );
    return rows || [];
};

const buildCouponSignalState = () => ({
    hasGenericProductOffer: false,
    hasGenericShippingOffer: false,
    categoryOfferIds: new Set()
});

const addCouponSignal = (state, row = {}) => {
    const categoryIds = parseJsonSafe(row.category_scope_json, []);
    const targetSet = state || buildCouponSignalState();
    if (Array.isArray(categoryIds) && categoryIds.length > 0) {
        categoryIds.forEach((id) => targetSet.categoryOfferIds.add(String(id)));
        return targetSet;
    }
    if (isShippingDiscountType(row.discount_type)) {
        targetSet.hasGenericShippingOffer = true;
        return targetSet;
    }
    targetSet.hasGenericProductOffer = true;
    return targetSet;
};

const buildOfferSignals = async ({ userId = '' } = {}) => {
    const normalizedUserId = String(userId || '').trim();
    const couponRows = await fetchActiveCouponRows({ userId: normalizedUserId });
    const publicSignals = buildCouponSignalState();
    const viewerSignals = buildCouponSignalState();

    let loyaltyProductOffer = false;
    let loyaltyShippingOffer = false;
    let loyaltyTier = 'regular';

    if (normalizedUserId && normalizedUserId !== 'guest') {
        try {
            const { getUserLoyaltyStatus } = require('./loyaltyService');
            const loyaltyStatus = await getUserLoyaltyStatus(normalizedUserId);
            loyaltyTier = String(loyaltyStatus?.effectiveTier || loyaltyStatus?.tier || 'regular').toLowerCase();
            const effectiveProfile = loyaltyStatus?.effectiveProfile || loyaltyStatus?.profile || {};
            const eligibility = loyaltyStatus?.eligibility || {};
            if (eligibility.isEligible) {
                loyaltyProductOffer = Number(effectiveProfile?.extraDiscountPct || 0) > 0;
                loyaltyShippingOffer = Number(effectiveProfile?.shippingDiscountPct || 0) > 0;
            }
        } catch {
            loyaltyTier = 'regular';
        }
    }

    couponRows.forEach((row) => {
        const scopeType = normalizeKey(row.scope_type || 'generic');
        const isUserTarget = Number(row.is_user_target || 0) === 1;
        const tierScope = normalizeKey(row.tier_scope || '');
        const matchesTier = Boolean(normalizedUserId && tierScope && tierScope === loyaltyTier);

        if (scopeType === 'generic' || scopeType === 'category') {
            addCouponSignal(publicSignals, row);
            addCouponSignal(viewerSignals, row);
            return;
        }

        if (scopeType === 'customer' && normalizedUserId && isUserTarget) {
            addCouponSignal(viewerSignals, row);
            return;
        }

        if (scopeType === 'tier' && normalizedUserId && (!tierScope || matchesTier)) {
            addCouponSignal(viewerSignals, row);
        }
    });

    return {
        publicSignals,
        viewerSignals,
        loyaltyProductOffer,
        loyaltyShippingOffer
    };
};

const scoreOfferRow = (row = {}, signals = {}, { personalized = false } = {}) => {
    const categoryIds = new Set(Array.isArray(row.category_ids) ? row.category_ids.map((id) => String(id)) : []);
    const categoryMatch = Array.from(signals?.categoryOfferIds || []).some((id) => categoryIds.has(String(id)));
    const genericProductOffer = Boolean(signals?.hasGenericProductOffer);
    const genericShippingOffer = Boolean(signals?.hasGenericShippingOffer);

    let score = 0;
    if (!personalized) {
        score += row.has_discount ? 140 : 0;
        score += categoryMatch ? 85 : 0;
        score += genericProductOffer ? 28 : 0;
        score += genericShippingOffer ? 14 : 0;
    } else {
        score += categoryMatch ? 110 : 0;
        score += genericProductOffer ? 55 : 0;
        score += genericShippingOffer ? 26 : 0;
    }
    score += Math.min(24, Number(row.sales_qty || 0));
    return score;
};

const enrichOfferMetrics = async (metrics = [], { viewerKey = '' } = {}) => {
    const rows = Array.isArray(metrics) ? metrics : [];
    const normalizedViewerKey = String(viewerKey || '').trim();
    const {
        publicSignals,
        viewerSignals,
        loyaltyProductOffer,
        loyaltyShippingOffer
    } = await buildOfferSignals({ userId: normalizedViewerKey });

    return rows.map((row) => {
        const publicOfferScore = scoreOfferRow(row, publicSignals, { personalized: false });
        const viewerOfferScore = scoreOfferRow(row, viewerSignals, { personalized: true })
            + (loyaltyProductOffer ? 42 : 0)
            + (loyaltyShippingOffer ? 18 : 0);
        return {
            ...row,
            offer_public_score: publicOfferScore,
            offer_viewer_score: viewerOfferScore
        };
    });
};

const pickRandomIds = (rows = [], { excludedIds = new Set(), count = 0, seed = '', score = null } = {}) => {
    const available = rows.filter((row) => !excludedIds.has(String(row.id || '').trim()));
    const ranked = deterministicSort(available, { seed, score });
    return uniqueIds(ranked.slice(0, Math.max(0, count)));
};

const buildCatalog = ({ category, metrics }) => {
    const bucket = getRefreshBucket();
    const baseSeed = `${normalizeKey(category?.system_key)}::${bucket}`;
    const key = normalizeKey(category?.system_key);
    const rows = Array.isArray(metrics) ? metrics : [];

    let nativeIds = [];
    let randomIds = [];
    let mode = 'hybrid';

    if (key === 'best_sellers') {
        nativeIds = uniqueIds(rows.filter((row) => Number(row.sales_qty || 0) > 0)
            .sort((a, b) => Number(b.sales_qty || 0) - Number(a.sales_qty || 0) || new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime())
            .slice(0, AUTOPILOT_NATIVE_LIMIT));
        if (!nativeIds.length) mode = 'smart_random';
        randomIds = pickRandomIds(rows, {
            excludedIds: new Set(nativeIds),
            count: AUTOPILOT_MAX_PRODUCTS - nativeIds.length,
            seed: `${baseSeed}:best-random`,
            score: (a, b) => Number(a.sales_qty || 0) - Number(b.sales_qty || 0)
        });
    } else if (key === 'new_arrivals') {
        nativeIds = uniqueIds(rows
            .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
            .slice(0, AUTOPILOT_NATIVE_LIMIT));
        randomIds = pickRandomIds(rows, {
            excludedIds: new Set(nativeIds),
            count: AUTOPILOT_MAX_PRODUCTS - nativeIds.length,
            seed: `${baseSeed}:new-random`,
            score: (a, b) => Number(a.sales_qty || 0) - Number(b.sales_qty || 0)
        });
    } else if (key === 'offers') {
        nativeIds = uniqueIds(rows
            .filter((row) => Number(row.offer_public_score || 0) > 0 || row.has_discount)
            .sort((a, b) =>
                Number(b.offer_public_score || 0) - Number(a.offer_public_score || 0)
                || Number(b.sales_qty || 0) - Number(a.sales_qty || 0)
                || new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
            )
            .slice(0, AUTOPILOT_NATIVE_LIMIT));
        if (!nativeIds.length) mode = 'smart_random';
        randomIds = pickRandomIds(rows, {
            excludedIds: new Set(nativeIds),
            count: AUTOPILOT_MAX_PRODUCTS - nativeIds.length,
            seed: `${baseSeed}:offers-random`,
            score: (a, b) => Number(b.offer_public_score || 0) - Number(a.offer_public_score || 0)
        });
    }

    const productIds = uniqueIds([...nativeIds, ...randomIds]).slice(0, AUTOPILOT_MAX_PRODUCTS);
    return {
        version: 1,
        generatedAt: new Date().toISOString(),
        refreshBucket: bucket,
        strategy: key,
        mode,
        nativeProductIds: nativeIds,
        randomProductIds: randomIds,
        productIds
    };
};

const persistCategoryCatalog = async (categoryId, catalog = {}) => {
    await db.execute(
        `UPDATE categories
         SET autopilot_catalog_json = ?, autopilot_refreshed_at = UTC_TIMESTAMP()
         WHERE id = ?`,
        [JSON.stringify(catalog || {}), categoryId]
    );
};

const refreshCategoryAutopilotCatalog = async (categoryId, { force = false } = {}) => {
    const category = await fetchAutopilotCapableCategory({ categoryId });
    if (!category || !isAutopilotEnabledCategory(category)) return null;
    if (!force && !isCategoryStale(category) && parseJsonSafe(category.autopilot_catalog_json, null)) {
        return {
            ...category,
            autopilot_catalog: parseJsonSafe(category.autopilot_catalog_json, {})
        };
    }

    let metrics = await fetchActiveProductMetrics();
    if (normalizeKey(category?.system_key) === 'offers') {
        metrics = await enrichOfferMetrics(metrics, { viewerKey: '' });
    }
    const catalog = buildCatalog({ category, metrics });
    await persistCategoryCatalog(category.id, catalog);
    return {
        ...category,
        autopilot_catalog: catalog,
        autopilot_catalog_json: JSON.stringify(catalog),
        autopilot_refreshed_at: new Date().toISOString()
    };
};

const refreshEnabledCategoryAutopilotCatalogs = async ({ force = false, staleOnly = true } = {}) => {
    const categories = await fetchEnabledAutopilotCategories();
    const results = [];
    for (const category of categories) {
        if (!force && staleOnly && !isCategoryStale(category) && parseJsonSafe(category.autopilot_catalog_json, null)) {
            results.push(category);
            continue;
        }
        const refreshed = await refreshCategoryAutopilotCatalog(category.id, { force: true }).catch(() => null);
        if (refreshed) results.push(refreshed);
    }
    return results;
};

const orderCatalogIdsForViewer = (catalog = {}, { viewerKey = '', systemKey = '' } = {}) => {
    const parsed = catalog && typeof catalog === 'object' ? catalog : {};
    const mode = normalizeKey(parsed.mode || 'hybrid');
    const nativeIds = uniqueIds(parsed.nativeProductIds || []);
    const randomIds = uniqueIds(parsed.randomProductIds || []);
    const allIds = uniqueIds(parsed.productIds || []);
    const seed = getViewerSeed({ viewerKey, systemKey, bucket: parsed.refreshBucket || getRefreshBucket() });

    if (mode === 'smart_random') {
        return deterministicSort(allIds.map((id) => ({ id })), { seed }).map((row) => row.id);
    }

    const orderedRandomIds = deterministicSort(randomIds.map((id) => ({ id })), { seed }).map((row) => row.id);
    return uniqueIds([...nativeIds, ...orderedRandomIds, ...allIds]);
};

const getCachedPersonalizedOfferIds = (viewerKey = '') => {
    const key = String(viewerKey || '').trim();
    if (!key) return null;
    const cached = personalizedOffersCache.get(key);
    if (!cached) return null;
    if ((Date.now() - Number(cached.timestamp || 0)) > PERSONALIZED_OFFERS_CACHE_MS) {
        personalizedOffersCache.delete(key);
        return null;
    }
    return Array.isArray(cached.ids) ? cached.ids : null;
};

const setCachedPersonalizedOfferIds = (viewerKey = '', ids = []) => {
    const key = String(viewerKey || '').trim();
    if (!key) return;
    personalizedOffersCache.set(key, {
        ids: uniqueIds(ids),
        timestamp: Date.now()
    });
};

const loadHydratedProductsByIds = async (ids = []) => {
    const productIds = uniqueIds(ids);
    if (!productIds.length) return [];
    const placeholders = productIds.map(() => '?').join(',');
    const [rows] = await db.execute(
        `SELECT *
         FROM products
         WHERE id IN (${placeholders})
           AND LOWER(COALESCE(status, '')) = 'active'`,
        productIds
    );
    const Product = require('../models/Product');
    const hydrated = await Product.hydrateProductsByIds(rows || [], { connection: db });
    const byId = new Map(hydrated.map((product) => [String(product.id), product]));
    return productIds.map((id) => byId.get(String(id))).filter(Boolean);
};

const getAutopilotProductsForCategory = async (category, { viewerKey = '', page = 1, limit = AUTOPILOT_MAX_PRODUCTS } = {}) => {
    if (!isAutopilotEnabledCategory(category)) return null;
    const refreshedCategory = await refreshCategoryAutopilotCatalog(category.id, { force: false });
    const catalog = parseJsonSafe(refreshedCategory?.autopilot_catalog_json, null)
        || refreshedCategory?.autopilot_catalog
        || parseJsonSafe(category.autopilot_catalog_json, {});
    let orderedIds = orderCatalogIdsForViewer(catalog, {
        viewerKey,
        systemKey: category.system_key
    });
    if (normalizeKey(category?.system_key) === 'offers' && String(viewerKey || '').trim() && String(viewerKey || '').trim() !== 'guest') {
        let personalizedIds = getCachedPersonalizedOfferIds(viewerKey);
        if (!personalizedIds) {
            const personalizedMetrics = await enrichOfferMetrics(await fetchActiveProductMetrics(), { viewerKey });
            personalizedIds = uniqueIds(
                personalizedMetrics
                    .filter((row) => Number(row.offer_viewer_score || 0) > 0)
                    .sort((a, b) =>
                        Number(b.offer_viewer_score || 0) - Number(a.offer_viewer_score || 0)
                        || Number(b.sales_qty || 0) - Number(a.sales_qty || 0)
                        || new Date(b.updated_at || 0).getTime() - new Date(a.updated_at || 0).getTime()
                    )
                    .slice(0, AUTOPILOT_NATIVE_LIMIT)
            );
            setCachedPersonalizedOfferIds(viewerKey, personalizedIds);
        }
        orderedIds = uniqueIds([...personalizedIds, ...orderedIds]);
    }
    const total = orderedIds.length;
    const offset = Math.max(0, (Number(page || 1) - 1) * Number(limit || AUTOPILOT_MAX_PRODUCTS));
    const pagedIds = orderedIds.slice(offset, offset + Math.max(1, Number(limit || AUTOPILOT_MAX_PRODUCTS)));
    const products = await loadHydratedProductsByIds(pagedIds);
    return {
        products,
        total,
        totalPages: Math.max(1, Math.ceil(total / Math.max(1, Number(limit || AUTOPILOT_MAX_PRODUCTS)))),
        page: Math.max(1, Number(page || 1)),
        limit: Math.max(1, Number(limit || AUTOPILOT_MAX_PRODUCTS)),
        catalog
    };
};

const applyAutopilotStats = async (categories = []) => {
    const next = [];
    for (const category of (Array.isArray(categories) ? categories : [])) {
        if (!isAutopilotEnabledCategory(category)) {
            next.push(category);
            continue;
        }
        const refreshed = await refreshCategoryAutopilotCatalog(category.id, { force: false }).catch(() => null);
        const catalog = parseJsonSafe(refreshed?.autopilot_catalog_json, null)
            || refreshed?.autopilot_catalog
            || parseJsonSafe(category.autopilot_catalog_json, {});
        next.push({
            ...category,
            product_count: uniqueIds(catalog?.productIds || []).length,
            autopilot_refreshed_at: refreshed?.autopilot_refreshed_at || category.autopilot_refreshed_at
        });
    }
    return next;
};

const updateCategoryAutopilot = async (categoryId, { enabled = false } = {}) => {
    const category = await fetchAutopilotCapableCategory({ categoryId });
    if (!category) throw new Error('Category not found');
    if (!isAutopilotCapableCategory(category)) {
        throw new Error('Auto-pilot is available only for Best Sellers, New Arrivals, and Offers');
    }

    await db.execute(
        `UPDATE categories
         SET autopilot_enabled = ?, autopilot_mode = 'hybrid'
         WHERE id = ?`,
        [enabled ? 1 : 0, categoryId]
    );

    if (enabled) {
        return refreshCategoryAutopilotCatalog(categoryId, { force: true });
    }

    return fetchAutopilotCapableCategory({ categoryId });
};

module.exports = {
    AUTOPILOT_REFRESH_MS,
    AUTOPILOT_MAX_PRODUCTS,
    isSupportedSystemKey,
    isAutopilotCapableCategory,
    isAutopilotEnabledCategory,
    fetchAutopilotCapableCategory,
    refreshCategoryAutopilotCatalog,
    refreshEnabledCategoryAutopilotCatalogs,
    getAutopilotProductsForCategory,
    applyAutopilotStats,
    updateCategoryAutopilot
};
