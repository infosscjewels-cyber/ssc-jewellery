const User = require('../models/User');
const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const Cart = require('../models/Cart');
const Order = require('../models/Order');
const bcrypt = require('bcryptjs');
const CompanyProfile = require('../models/CompanyProfile');
const TaxConfig = require('../models/TaxConfig');
const Coupon = require('../models/Coupon');
const AbandonedCart = require('../models/AbandonedCart');
const LoyaltyPopupConfig = require('../models/LoyaltyPopupConfig');
const LoyaltyPopupTemplate = require('../models/LoyaltyPopupTemplate');
const {
    verifyEmailTransport,
    sendEmailCommunication,
    sendWhatsapp
} = require('../services/communications/communicationService');
const { getLoyaltyConfigForAdmin, updateLoyaltyConfigForAdmin, ensureLoyaltyConfigLoaded, reassessActiveCustomersForConfigChange } = require('../services/loyaltyService');
const { computeChange, toSafeEnum, buildDashboardCacheKey, normalizeDashboardEventType } = require('../utils/dashboardUtils');
const { emitToUserAudiences } = require('../utils/socketAudience');
const { resolveUploadedAssetPath } = require('../utils/uploadsRoot');
const { queueFullRefresh } = require('../services/seoService');
const isProductionLike = () => String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';

const normalizeAddressPayload = (value = null, { fieldLabel = 'Address' } = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${fieldLabel} must be an object`);
    }
    const line1 = String(value.line1 || '').trim();
    const city = String(value.city || '').trim();
    const state = String(value.state || '').trim();
    const zip = String(value.zip || '').trim();
    if (!line1 || !city || !state || !zip) {
        throw new Error(`${fieldLabel} fields are required`);
    }
    if (!/^[0-9A-Za-z\\-\\s]{3,12}$/.test(zip)) {
        throw new Error(`${fieldLabel} zip code is invalid`);
    }
    return { line1, city, state, zip };
};

const emitCouponChanged = (req, payload = {}) => {
    const io = req.app.get('io');
    if (!io) return;
    const eventPayload = { ...payload, ts: new Date().toISOString() };
    io.to('admin').emit('coupon:changed', eventPayload);
    const targets = Array.isArray(payload.userTargets)
        ? [...new Set(payload.userTargets.map((id) => String(id || '').trim()).filter(Boolean))]
        : [];
    targets.forEach((userId) => {
        io.to(`user:${userId}`).emit('coupon:changed', eventPayload);
    });
    if (payload.broadcast === true) {
        io.emit('coupon:changed', eventPayload);
    }
};

const emitCompanyTaxUpdate = async (req, { includeCompany = true } = {}) => {
    const io = req.app.get('io');
    if (!io) return;
    const taxes = await TaxConfig.listAll().catch(() => []);
    let company = null;
    if (includeCompany) {
        company = await CompanyProfile.get().catch(() => null);
    }
    io.emit('company:info_update', { company, taxes });
    io.emit('tax:config_update', { taxes, ts: new Date().toISOString() });
};

const emitLoyaltyPopupUpdate = async (req, payload = {}) => {
    const io = req.app.get('io');
    if (!io) return;
    const [adminPopup, publicPopup] = await Promise.all([
        LoyaltyPopupConfig.getAdminConfig().catch(() => null),
        LoyaltyPopupConfig.getClientActivePopup().catch(() => null)
    ]);
    const adminPayload = {
        popup: adminPopup,
        ...payload,
        ts: new Date().toISOString()
    };
    const publicPayload = {
        action: payload.action || 'config_update',
        active: Boolean(publicPopup),
        key: publicPopup?.key || null,
        ts: adminPayload.ts
    };
    io.to('admin').emit('loyalty:popup_update', adminPayload);
    io.emit('loyalty:popup_public_update', publicPayload);
};

const resolveCategoryCouponContext = async (categoryIds = []) => {
    const ids = [...new Set((Array.isArray(categoryIds) ? categoryIds : [])
        .map((id) => Number(id))
        .filter((id) => Number.isFinite(id) && id > 0))];
    if (!ids.length) return null;
    const placeholders = ids.map(() => '?').join(',');
    const [rows] = await db.execute(`SELECT id, name FROM categories WHERE id IN (${placeholders})`, ids);
    if (!rows.length) return null;
    const namesById = new Map(rows.map((row) => [Number(row.id), String(row.name || '').trim()]).filter(([, name]) => Boolean(name)));
    const categoryNames = ids.map((id) => namesById.get(id)).filter(Boolean);
    if (!categoryNames.length) return null;
    const primaryCategoryName = categoryNames[0];
    const baseUrl = String(
        process.env.CLIENT_BASE_URL
        || process.env.FRONTEND_URL
        || process.env.APP_URL
        || ''
    ).replace(/\/+$/, '');
    const categoryPath = `/shop/${encodeURIComponent(primaryCategoryName)}`;
    return {
        categoryNames,
        primaryCategoryName,
        categoryLink: categoryPath,
        categoryUrl: baseUrl ? `${baseUrl}${categoryPath}` : categoryPath
    };
};

const DASHBOARD_MAX_RANGE_DAYS = 90;
const DASHBOARD_CACHE_TTL_MS = Math.max(30 * 1000, Number(process.env.DASHBOARD_CACHE_TTL_MS || 120 * 1000));
const DASHBOARD_CACHE_MAX_ENTRIES = 120;
const dashboardPayloadCache = new Map();
const hasFullDashboardAggregateCoverage = (rowCount, startDate, endDate) => {
    const start = toDateOnlyInput(startDate);
    const end = toDateOnlyInput(endDate);
    if (!start || !end || end.getTime() < start.getTime()) return false;
    const expectedDays = diffDaysUTC(start, end) + 1;
    return Number(rowCount || 0) >= expectedDays;
};

const toDateOnlyInput = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return null;
    const parsed = new Date(`${raw}T00:00:00.000Z`);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
};

const formatDateOnlyUTC = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toISOString().slice(0, 10);
};

const addDaysUTC = (date, days) => {
    const next = new Date(date);
    next.setUTCDate(next.getUTCDate() + Number(days || 0));
    return next;
};

const diffDaysUTC = (start, end) => {
    const ms = end.getTime() - start.getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000));
};

const addMonthsUTC = (date, months) => {
    const next = new Date(date);
    next.setUTCMonth(next.getUTCMonth() + Number(months || 0));
    return next;
};

const readDashboardPayloadCache = (query = {}) => {
    const key = buildDashboardCacheKey(query);
    const cached = dashboardPayloadCache.get(key);
    if (!cached) return null;
    if (Date.now() - cached.ts > DASHBOARD_CACHE_TTL_MS) {
        dashboardPayloadCache.delete(key);
        return null;
    }
    return cached.value || null;
};

const writeDashboardPayloadCache = (query = {}, value = null) => {
    const key = buildDashboardCacheKey(query);
    dashboardPayloadCache.set(key, { ts: Date.now(), value });
    if (dashboardPayloadCache.size <= DASHBOARD_CACHE_MAX_ENTRIES) return;
    const oldestKey = dashboardPayloadCache.keys().next().value;
    if (oldestKey) dashboardPayloadCache.delete(oldestKey);
};

const invalidateDashboardPayloadCache = () => {
    dashboardPayloadCache.clear();
};

const buildOrderFilterFragments = (query = {}, alias = 'o') => {
    const parts = [];
    const params = [];

    const status = toSafeEnum(
        query.status,
        ['all', 'pending', 'confirmed', 'shipped', 'completed', 'cancelled', 'failed'],
        'all'
    );
    const paymentMode = toSafeEnum(query.paymentMode, ['all', 'razorpay', 'cod'], 'all');
    const sourceChannel = toSafeEnum(query.sourceChannel, ['all', 'abandoned_recovery', 'direct'], 'all');

    if (status !== 'all') {
        if (status === 'pending') {
            parts.push(`(${alias}.status = 'pending' OR (${alias}.status = 'confirmed' AND TIMESTAMPDIFF(HOUR, ${alias}.created_at, UTC_TIMESTAMP()) >= 24))`);
        } else if (status === 'failed') {
            parts.push(`(LOWER(COALESCE(${alias}.status, '')) = 'failed' OR LOWER(COALESCE(${alias}.payment_status, '')) = 'failed')`);
        } else {
            parts.push(`LOWER(COALESCE(${alias}.status, '')) = ?`);
            params.push(status);
        }
    }

    if (paymentMode !== 'all') {
        parts.push(`LOWER(COALESCE(${alias}.payment_gateway, '')) = ?`);
        params.push(paymentMode);
    }

    if (sourceChannel !== 'all') {
        if (sourceChannel === 'abandoned_recovery') {
            parts.push(`(${alias}.is_abandoned_recovery = 1 OR LOWER(COALESCE(${alias}.source_channel, '')) = 'abandoned_recovery')`);
        } else if (sourceChannel === 'direct') {
            parts.push(`(${alias}.is_abandoned_recovery = 0 AND (COALESCE(${alias}.source_channel, '') = '' OR LOWER(${alias}.source_channel) <> 'abandoned_recovery'))`);
        } else {
            parts.push(`LOWER(COALESCE(${alias}.source_channel, '')) = ?`);
            params.push(sourceChannel);
        }
    }

    return {
        clause: parts.length ? ` AND ${parts.join(' AND ')}` : '',
        params,
        status,
        paymentMode,
        sourceChannel
    };
};

const buildDashboardScope = (query = {}) => {
    const requestedQuickRange = String(query.quickRange || 'last_30_days').trim().toLowerCase();
    const allowedQuickRanges = new Set(['latest_10', 'last_7_days', 'last_30_days', 'last_90_days', 'custom']);
    const quickRange = allowedQuickRanges.has(requestedQuickRange) ? requestedQuickRange : 'last_30_days';
    const comparisonMode = toSafeEnum(query.comparisonMode, ['previous_period', 'same_period_last_month'], 'previous_period');
    const now = new Date();
    const orderFilters = buildOrderFilterFragments(query, 'o');

    let periodDays = 30;
    let startDate = null;
    let endDate = null;

    if (quickRange === 'latest_10') periodDays = 10;
    if (quickRange === 'last_7_days') periodDays = 7;
    if (quickRange === 'last_90_days') periodDays = 90;

    if (quickRange === 'custom') {
        const start = toDateOnlyInput(query.startDate);
        const end = toDateOnlyInput(query.endDate);
        if (start && end && end.getTime() >= start.getTime()) {
            const span = diffDaysUTC(start, end) + 1;
            periodDays = Math.max(1, Math.min(DASHBOARD_MAX_RANGE_DAYS, span));
            startDate = start;
            endDate = addDaysUTC(start, periodDays - 1);
        }
    }

    if (!startDate || !endDate) {
        endDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        startDate = addDaysUTC(endDate, -(periodDays - 1));
    }

    const startDateText = formatDateOnlyUTC(startDate);
    const endDateText = formatDateOnlyUTC(endDate);

    let comparisonStart = addDaysUTC(startDate, -periodDays);
    let comparisonEnd = addDaysUTC(startDate, -1);
    if (comparisonMode === 'same_period_last_month') {
        comparisonStart = addMonthsUTC(startDate, -1);
        comparisonEnd = addMonthsUTC(endDate, -1);
    }

    const comparison = {
        startDate: formatDateOnlyUTC(comparisonStart),
        endDate: formatDateOnlyUTC(comparisonEnd),
        mode: comparisonMode
    };

    const ordersScopeSql = quickRange === 'latest_10'
        ? `(SELECT * FROM orders o WHERE o.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${DASHBOARD_MAX_RANGE_DAYS} DAY)${orderFilters.clause} ORDER BY o.created_at DESC LIMIT 10)`
        : `(SELECT * FROM orders o WHERE DATE(o.created_at) BETWEEN ? AND ?${orderFilters.clause})`;
    const ordersScopeParams = quickRange === 'latest_10'
        ? [...orderFilters.params]
        : [startDateText, endDateText, ...orderFilters.params];

    const attemptsWhereBase = quickRange === 'latest_10'
        ? 'pa.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)'
        : 'DATE(pa.created_at) BETWEEN ? AND ?';
    const attemptsParams = quickRange === 'latest_10' ? [] : [startDateText, endDateText];
    const attemptsWhereSql = orderFilters.status === 'failed'
        ? `${attemptsWhereBase} AND LOWER(COALESCE(pa.status, '')) = 'failed'`
        : attemptsWhereBase;

    const usersWhereSql = quickRange === 'latest_10'
        ? 'u.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 DAY)'
        : 'DATE(u.created_at) BETWEEN ? AND ?';
    const usersParams = quickRange === 'latest_10' ? [] : [startDateText, endDateText];
    const lowStockThresholdRaw = Number(query.lowStockThreshold);
    const lowStockThreshold = Number.isFinite(lowStockThresholdRaw)
        ? Math.max(1, Math.min(100, Math.floor(lowStockThresholdRaw)))
        : 5;

    return {
        quickRange,
        periodDays,
        comparison,
        filters: {
            status: orderFilters.status,
            paymentMode: orderFilters.paymentMode,
            sourceChannel: orderFilters.sourceChannel
        },
        orderFilterClause: orderFilters.clause,
        orderFilterParams: orderFilters.params,
        ordersScopeSql,
        ordersScopeParams,
        attemptsWhereSql,
        attemptsParams,
        usersWhereSql,
        usersParams,
        lowStockThreshold,
        seriesStartDate: startDateText,
        seriesEndDate: endDateText
    };
};

const getDashboardInsightsPayload = async (query = {}) => {
    const scope = buildDashboardScope(query || {});
    const ordersScopeSql = scope.ordersScopeSql;
    const ordersScopeParams = scope.ordersScopeParams || [];
    const canUseDailyAggregate = scope.quickRange !== 'latest_10'
        && scope.filters.status === 'all'
        && scope.filters.paymentMode === 'all'
        && scope.filters.sourceChannel === 'all';
    const [[userCreatedAtColumnRows], [userLoyaltyTierColumnRows]] = await Promise.all([
        db.execute(
            `SELECT COUNT(*) AS has_column
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'users'
               AND COLUMN_NAME = 'created_at'`
        ),
        db.execute(
            `SELECT COUNT(*) AS has_column
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'users'
               AND COLUMN_NAME = 'loyalty_tier'`
        )
    ]);
    const hasUserCreatedAt = Number(userCreatedAtColumnRows?.[0]?.has_column || 0) > 0;
    const hasUserLoyaltyTier = Number(userLoyaltyTierColumnRows?.[0]?.has_column || 0) > 0;
    const loyaltyTierSql = hasUserLoyaltyTier
        ? "LOWER(COALESCE(u.loyalty_tier, 'regular'))"
        : "'regular'";
    let useDailyAggregate = false;
    if (canUseDailyAggregate) {
        const [aggregateCoverageRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM dashboard_daily_aggregates
             WHERE day_date BETWEEN ? AND ?`,
            [scope.seriesStartDate, scope.seriesEndDate]
        );
        useDailyAggregate = hasFullDashboardAggregateCoverage(
            aggregateCoverageRows?.[0]?.total || 0,
            scope.seriesStartDate,
            scope.seriesEndDate
        );
    }

    const [[overviewRows], [attemptRows], [funnelRows], [trendRows], [productRows], [noSalesRows], [topCustomerRows], [activeCustomerRows], [repeatCustomerRows], [couponRows], [channelRows], [newReturningRevenueRows], [operatorRows], [paymentGatewayRows], [paymentModeRows]] = await Promise.all([
        useDailyAggregate
            ? db.execute(
                `SELECT
                    SUM(COALESCE(total_orders, 0)) AS total_orders,
                    SUM(COALESCE(gross_sales, 0)) AS gross_sales,
                    SUM(COALESCE(net_sales, 0)) AS net_sales,
                    SUM(COALESCE(paid_orders, 0)) AS paid_orders,
                    SUM(COALESCE(cancelled_orders, 0)) AS cancelled_orders,
                    SUM(COALESCE(refunded_amount, 0)) AS refunded_amount
                 FROM dashboard_daily_aggregates
                 WHERE day_date BETWEEN ? AND ?`,
                [scope.seriesStartDate, scope.seriesEndDate]
            )
            : db.execute(
                `SELECT
                    COUNT(*) AS total_orders,
                    SUM(COALESCE(scoped.subtotal, 0) + COALESCE(scoped.shipping_fee, 0)) AS gross_sales,
                    SUM(CASE WHEN scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS net_sales,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.payment_status, '')) = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.payment_status, '')) = 'refunded' OR COALESCE(scoped.refund_amount, 0) > 0 THEN COALESCE(scoped.refund_amount, 0) ELSE 0 END) AS refunded_amount
                 FROM ${ordersScopeSql} scoped`,
                ordersScopeParams
            ),
        useDailyAggregate
            ? db.execute(
                `SELECT SUM(COALESCE(attempted_payments, 0)) AS attempted_payments
                 FROM dashboard_daily_aggregates
                 WHERE day_date BETWEEN ? AND ?`,
                [scope.seriesStartDate, scope.seriesEndDate]
            )
            : db.execute(
                `SELECT COUNT(*) AS attempted_payments
                 FROM payment_attempts pa
                 WHERE ${scope.attemptsWhereSql}`,
                scope.attemptsParams
            ),
        useDailyAggregate
            ? db.execute(
                `SELECT
                    SUM(COALESCE(paid_orders, 0)) AS paid,
                    SUM(COALESCE(shipped_orders, 0)) AS shipped,
                    SUM(COALESCE(completed_orders, 0)) AS completed,
                    SUM(COALESCE(cancelled_orders, 0)) AS cancelled,
                    SUM(COALESCE(refunded_orders, 0)) AS refunded
                 FROM dashboard_daily_aggregates
                 WHERE day_date BETWEEN ? AND ?`,
                [scope.seriesStartDate, scope.seriesEndDate]
            )
            : db.execute(
                `SELECT
                    SUM(CASE WHEN LOWER(COALESCE(scoped.payment_status, '')) = 'paid' THEN 1 ELSE 0 END) AS paid,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.status, '')) = 'shipped' THEN 1 ELSE 0 END) AS shipped,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.status, '')) = 'completed' THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                    SUM(CASE WHEN LOWER(COALESCE(scoped.payment_status, '')) = 'refunded' OR COALESCE(scoped.refund_amount, 0) > 0 THEN 1 ELSE 0 END) AS refunded
                 FROM ${ordersScopeSql} scoped`,
                ordersScopeParams
            ),
        useDailyAggregate
            ? db.execute(
                `SELECT
                    day_date AS bucket_date,
                    total_orders AS orders_count,
                    net_sales AS revenue
                 FROM dashboard_daily_aggregates
                 WHERE day_date BETWEEN ? AND ?
                 ORDER BY day_date ASC`,
                [scope.seriesStartDate, scope.seriesEndDate]
            )
            : db.execute(
                `SELECT
                    DATE(scoped.created_at) AS bucket_date,
                    COUNT(*) AS orders_count,
                    SUM(CASE WHEN scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS revenue
                 FROM ${ordersScopeSql} scoped
                 GROUP BY DATE(scoped.created_at)
                 ORDER BY DATE(scoped.created_at) ASC`,
                ordersScopeParams
            ),
        db.execute(
            `SELECT
                oi.product_id,
                COALESCE(NULLIF(oi.variant_id, ''), '') AS variant_id,
                COALESCE(NULLIF(oi.title, ''), p.title, 'Untitled Product') AS title,
                COALESCE(NULLIF(oi.variant_title, ''), '') AS variant_title,
                MAX(NULLIF(oi.image_url, '')) AS thumbnail,
                SUM(COALESCE(oi.quantity, 0)) AS units_sold,
                SUM(COALESCE(oi.line_total, 0)) AS revenue
             FROM ${ordersScopeSql} scoped
             JOIN order_items oi ON oi.order_id = scoped.id
             LEFT JOIN products p ON p.id = oi.product_id
             WHERE scoped.status <> 'cancelled'
             GROUP BY oi.product_id, COALESCE(NULLIF(oi.variant_id, ''), ''), COALESCE(NULLIF(oi.title, ''), p.title, 'Untitled Product'), COALESCE(NULLIF(oi.variant_title, ''), '')
             ORDER BY units_sold DESC, revenue DESC
             LIMIT 8`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT p.id, p.title
             FROM products p
             WHERE p.status = 'active'
               AND NOT EXISTS (
                    SELECT 1
                    FROM ${ordersScopeSql} scoped
                    JOIN order_items oi ON oi.order_id = scoped.id
                    WHERE oi.product_id = p.id
               )
             ORDER BY p.updated_at DESC
             LIMIT 5`,
            [...ordersScopeParams]
        ),
        db.execute(
            `SELECT
                scoped.user_id,
                COALESCE(u.name, 'Guest') AS customer_name,
                COALESCE(u.mobile, '') AS customer_mobile,
                ${loyaltyTierSql} AS loyalty_tier,
                COUNT(*) AS orders_count,
                SUM(CASE WHEN scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS revenue
             FROM ${ordersScopeSql} scoped
             LEFT JOIN users u ON u.id = scoped.user_id
             WHERE scoped.user_id IS NOT NULL
             GROUP BY scoped.user_id, COALESCE(u.name, 'Guest'), COALESCE(u.mobile, ''), ${loyaltyTierSql}
             ORDER BY revenue DESC, orders_count DESC
             LIMIT 6`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT COUNT(DISTINCT scoped.user_id) AS active_customers
             FROM ${ordersScopeSql} scoped
             WHERE scoped.user_id IS NOT NULL`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT COUNT(*) AS repeat_customers
             FROM (
                SELECT scoped.user_id
                FROM ${ordersScopeSql} scoped
                WHERE scoped.user_id IS NOT NULL
                GROUP BY scoped.user_id
                HAVING COUNT(*) > 1
             ) repeats`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT
                SUM(CASE WHEN COALESCE(scoped.coupon_code, '') <> '' THEN 1 ELSE 0 END) AS coupon_orders,
                SUM(COALESCE(scoped.coupon_discount_value, 0)) AS coupon_discount_total
             FROM ${ordersScopeSql} scoped`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT
                CASE
                    WHEN scoped.is_abandoned_recovery = 1 OR LOWER(COALESCE(scoped.source_channel, '')) = 'abandoned_recovery'
                        THEN 'abandoned_recovery'
                    WHEN LOWER(COALESCE(scoped.source_channel, '')) IN ('', 'direct', 'checkout', 'web', 'website')
                        THEN 'direct'
                    ELSE LOWER(scoped.source_channel)
                END AS channel,
                SUM(CASE WHEN scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS revenue,
                COUNT(*) AS orders
             FROM ${ordersScopeSql} scoped
             GROUP BY channel
             ORDER BY revenue DESC`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT
                SUM(CASE WHEN DATE(fo.first_order_date) BETWEEN ? AND ? AND scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS new_customer_revenue,
                SUM(CASE WHEN fo.first_order_date < ? AND scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS returning_customer_revenue
             FROM ${ordersScopeSql} scoped
             LEFT JOIN (
                SELECT user_id, MIN(created_at) AS first_order_date
                FROM orders
                WHERE user_id IS NOT NULL
                GROUP BY user_id
            ) fo ON fo.user_id = scoped.user_id`,
            [scope.seriesStartDate, scope.seriesEndDate, scope.seriesStartDate, ...ordersScopeParams]
        ),
        db.execute(
            `SELECT
                e.actor_user_id AS user_id,
                COALESCE(u.name, 'Unknown') AS operator_name,
                COUNT(*) AS total_actions,
                SUM(CASE WHEN e.status = 'shipped' THEN 1 ELSE 0 END) AS shipped_updates,
                SUM(CASE WHEN e.status = 'completed' THEN 1 ELSE 0 END) AS completed_updates,
                SUM(CASE WHEN e.status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_updates
             FROM order_status_events e
             JOIN orders o ON o.id = e.order_id
             LEFT JOIN users u ON u.id = e.actor_user_id
             WHERE e.actor_user_id IS NOT NULL
               AND DATE(e.created_at) BETWEEN ? AND ?${scope.orderFilterClause}
             GROUP BY e.actor_user_id, COALESCE(u.name, 'Unknown')
             ORDER BY total_actions DESC
             LIMIT 8`,
            [scope.seriesStartDate, scope.seriesEndDate, ...scope.orderFilterParams]
        ),
        db.execute(
            `SELECT
                LOWER(COALESCE(scoped.payment_gateway, 'unknown')) AS gateway,
                COUNT(*) AS orders,
                SUM(CASE WHEN scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS revenue
             FROM ${ordersScopeSql} scoped
             GROUP BY LOWER(COALESCE(scoped.payment_gateway, 'unknown'))
             ORDER BY orders DESC`,
            ordersScopeParams
        ),
        db.execute(
            `SELECT
                COALESCE(NULLIF(pm.mode, ''), 'unknown') AS mode,
                COUNT(*) AS orders,
                SUM(CASE WHEN scoped.status <> 'cancelled' THEN COALESCE(scoped.total, 0) ELSE 0 END) AS revenue
             FROM ${ordersScopeSql} scoped
             LEFT JOIN (
                SELECT payment_id, MAX(mode) AS mode
                FROM (
                    SELECT
                        JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.payload.payment.entity.id')) AS payment_id,
                        LOWER(JSON_UNQUOTE(JSON_EXTRACT(payload_json, '$.payload.payment.entity.method'))) AS mode
                    FROM razorpay_webhook_events
                    WHERE event_type IN ('payment.authorized', 'payment.captured', 'payment.failed')
                ) raw
                WHERE COALESCE(payment_id, '') <> ''
                GROUP BY payment_id
             ) pm ON pm.payment_id = scoped.razorpay_payment_id
             WHERE LOWER(COALESCE(scoped.payment_gateway, '')) <> 'cod'
             GROUP BY COALESCE(NULLIF(pm.mode, ''), 'unknown')
             ORDER BY orders DESC`,
            ordersScopeParams
        )
    ]);

    const [newCustomerRows] = hasUserCreatedAt
        ? await db.execute(
            `SELECT COUNT(*) AS new_customers
             FROM users u
             WHERE ${scope.usersWhereSql}`,
            scope.usersParams
        )
        : [[{ new_customers: 0 }]];

    const [pendingAgingRows] = await db.execute(
        `SELECT
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, o.created_at, UTC_TIMESTAMP()) < 24 THEN 1 ELSE 0 END) AS under_24h,
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, o.created_at, UTC_TIMESTAMP()) BETWEEN 24 AND 72 THEN 1 ELSE 0 END) AS from_24h_to_72h,
            SUM(CASE WHEN TIMESTAMPDIFF(HOUR, o.created_at, UTC_TIMESTAMP()) > 72 THEN 1 ELSE 0 END) AS over_72h
         FROM orders o
         WHERE (o.status = 'pending' OR o.status = 'confirmed')${scope.orderFilterClause}`,
        scope.orderFilterParams
    );

    const [failedSpikeRows] = await db.execute(
        `SELECT
            SUM(CASE WHEN pa.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 HOUR) AND LOWER(COALESCE(pa.status, '')) = 'failed' THEN 1 ELSE 0 END) AS current_6h,
            SUM(CASE WHEN pa.created_at < DATE_SUB(UTC_TIMESTAMP(), INTERVAL 6 HOUR) AND pa.created_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 12 HOUR) AND LOWER(COALESCE(pa.status, '')) = 'failed' THEN 1 ELSE 0 END) AS previous_6h
         FROM payment_attempts pa`
    );

    const [codCancellationRows] = await db.execute(
        `SELECT
            SUM(CASE WHEN LOWER(COALESCE(scoped.payment_gateway, '')) = 'cod' THEN 1 ELSE 0 END) AS cod_orders,
            SUM(CASE WHEN LOWER(COALESCE(scoped.payment_gateway, '')) = 'cod' AND LOWER(COALESCE(scoped.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cod_cancelled
         FROM ${ordersScopeSql} scoped`,
        ordersScopeParams
    );

    let comparison = null;
    if (scope.comparison?.startDate && scope.comparison?.endDate) {
        const [previousRows] = await db.execute(
            `SELECT
                COUNT(*) AS total_orders,
                SUM(CASE WHEN o.status <> 'cancelled' THEN COALESCE(o.total, 0) ELSE 0 END) AS net_sales,
                SUM(CASE WHEN LOWER(COALESCE(o.payment_gateway, '')) = 'cod' THEN 1 ELSE 0 END) AS cod_orders,
                SUM(CASE WHEN LOWER(COALESCE(o.payment_gateway, '')) = 'cod' AND LOWER(COALESCE(o.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cod_cancelled
             FROM orders o
             WHERE DATE(o.created_at) BETWEEN ? AND ?${scope.orderFilterClause}`,
            [scope.comparison.startDate, scope.comparison.endDate, ...scope.orderFilterParams]
        );
        const previous = previousRows?.[0] || {};
        const currentCodOrders = Number(codCancellationRows?.[0]?.cod_orders || 0);
        const currentCodCancelled = Number(codCancellationRows?.[0]?.cod_cancelled || 0);
        const previousCodOrders = Number(previous.cod_orders || 0);
        const previousCodCancelled = Number(previous.cod_cancelled || 0);
        const currentCodRate = currentCodOrders > 0 ? (currentCodCancelled / currentCodOrders) * 100 : 0;
        const previousCodRate = previousCodOrders > 0 ? (previousCodCancelled / previousCodOrders) * 100 : 0;
        comparison = {
            mode: scope.comparison.mode,
            totalOrders: computeChange(Number(overviewRows?.[0]?.total_orders || 0), Number(previous.total_orders || 0)),
            netSales: computeChange(Number(overviewRows?.[0]?.net_sales || 0), Number(previous.net_sales || 0)),
            codCancellationRate: computeChange(currentCodRate, previousCodRate)
        };
    }

    const base = overviewRows?.[0] || {};
    const attemptedPayments = Number(attemptRows?.[0]?.attempted_payments || 0);
    const paidOrders = Number(base.paid_orders || 0);
    const netSales = Number(base.net_sales || 0);
    const totalOrders = Number(base.total_orders || 0);
    const averageOrderValue = totalOrders > 0 ? netSales / totalOrders : 0;
    const conversionRate = attemptedPayments > 0 ? (paidOrders / attemptedPayments) * 100 : 0;
    const repeatCustomers = Number(repeatCustomerRows?.[0]?.repeat_customers || 0);
    const activeCustomers = Number(activeCustomerRows?.[0]?.active_customers || 0);
    const repeatRate = activeCustomers > 0 ? (repeatCustomers / activeCustomers) * 100 : 0;
    const failedPaymentsCurrent6h = Number(failedSpikeRows?.[0]?.current_6h || 0);
    const failedPaymentsPrevious6h = Number(failedSpikeRows?.[0]?.previous_6h || 0);
    const failedPaymentsSpikePct = computeChange(failedPaymentsCurrent6h, failedPaymentsPrevious6h);

    const trendMap = new Map((trendRows || []).map((row) => [
        formatDateOnlyUTC(row.bucket_date),
        {
            date: formatDateOnlyUTC(row.bucket_date),
            orders: Number(row.orders_count || 0),
            revenue: Number(row.revenue || 0),
            averageOrderValue: Number(row.orders_count || 0) > 0
                ? Number((Number(row.revenue || 0) / Number(row.orders_count || 0)).toFixed(2))
                : 0
        }
    ]));

    const trendSeries = [];
    const start = toDateOnlyInput(scope.seriesStartDate);
    const end = toDateOnlyInput(scope.seriesEndDate);
    if (start && end && end.getTime() >= start.getTime()) {
        let cursor = new Date(start);
        while (cursor.getTime() <= end.getTime()) {
            const key = formatDateOnlyUTC(cursor);
            trendSeries.push(trendMap.get(key) || { date: key, orders: 0, revenue: 0, averageOrderValue: 0 });
            cursor = addDaysUTC(cursor, 1);
        }
    } else {
        trendSeries.push(...trendMap.values());
    }

    const growth = {
        newCustomerRevenue: Number(newReturningRevenueRows?.[0]?.new_customer_revenue || 0),
        returningCustomerRevenue: Number(newReturningRevenueRows?.[0]?.returning_customer_revenue || 0),
        couponOrders: Number(couponRows?.[0]?.coupon_orders || 0),
        couponDiscountTotal: Number(couponRows?.[0]?.coupon_discount_total || 0),
        channelRevenue: (channelRows || []).map((row) => ({
            channel: row.channel || 'unknown',
            revenue: Number(row.revenue || 0),
            orders: Number(row.orders || 0)
        })),
        paymentGateways: (paymentGatewayRows || []).map((row) => ({
            gateway: row.gateway || 'unknown',
            orders: Number(row.orders || 0),
            revenue: Number(row.revenue || 0)
        })),
        paymentModes: (paymentModeRows || []).map((row) => ({
            mode: row.mode || 'unknown',
            orders: Number(row.orders || 0),
            revenue: Number(row.revenue || 0)
        }))
    };

    const codOrders = Number(codCancellationRows?.[0]?.cod_orders || 0);
    const codCancelled = Number(codCancellationRows?.[0]?.cod_cancelled || 0);
    const codCancellationRate = codOrders > 0 ? Number(((codCancelled / codOrders) * 100).toFixed(1)) : 0;

    const risk = {
        failedPaymentsCurrent6h,
        failedPaymentsPrevious6h,
        failedPaymentsSpikePct,
        pendingAging: {
            under24h: Number(pendingAgingRows?.[0]?.under_24h || 0),
            from24hTo72h: Number(pendingAgingRows?.[0]?.from_24h_to_72h || 0),
            over72h: Number(pendingAgingRows?.[0]?.over_72h || 0)
        },
        codCancellationRate
    };

    const topSellerIds = (productRows || []).map((row) => String(row.product_id || '')).filter(Boolean).slice(0, 3);
    const lowStockTopSellerIds = new Set();
    if (topSellerIds.length) {
        const placeholders = topSellerIds.map(() => '?').join(',');
        const [lowStockMatches] = await db.execute(
            `SELECT DISTINCT p.id
             FROM products p
             WHERE p.id IN (${placeholders})
               AND (
                    (COALESCE(p.track_quantity, 0) = 1 AND COALESCE(p.quantity, 0) <= ?)
                    OR
                    EXISTS (
                        SELECT 1
                        FROM product_variants pv_match
                        WHERE pv_match.product_id = p.id
                          AND COALESCE(pv_match.track_quantity, 0) = 1
                          AND COALESCE(pv_match.quantity, 0) <= ?
                    )
               )`,
            [...topSellerIds, scope.lowStockThreshold, scope.lowStockThreshold]
        );
        (lowStockMatches || []).forEach((row) => lowStockTopSellerIds.add(String(row.id)));
    }

    const actions = [];
    if (risk.pendingAging.over72h > 0) {
        actions.push({
            id: 'pending_aging_over_72h',
            priority: risk.pendingAging.over72h > 10 ? 'high' : 'medium',
            title: `${risk.pendingAging.over72h} pending orders are older than 72h`,
            description: 'Prioritize these orders to reduce SLA risk.',
            target: { tab: 'orders', status: 'pending' }
        });
    }
    if (failedPaymentsCurrent6h > 0) {
        actions.push({
            id: 'failed_payments_spike',
            priority: failedPaymentsCurrent6h > 8 || Number(failedPaymentsSpikePct || 0) > 20 ? 'high' : 'medium',
            title: `${failedPaymentsCurrent6h} failed payments in last 6 hours`,
            description: failedPaymentsSpikePct != null
                ? `Change vs previous 6h: ${failedPaymentsSpikePct > 0 ? '+' : ''}${failedPaymentsSpikePct}%`
                : 'Review failed payment attempts to recover orders.',
            target: { tab: 'orders', status: 'failed' }
        });
    }
    ((productRows || []).slice(0, 2)).forEach((row) => {
        if (lowStockTopSellerIds.has(String(row.product_id || ''))) {
            actions.push({
                id: `low_stock_fast_seller_${row.product_id}`,
                priority: 'high',
                title: `${row.title} is low stock with active demand`,
                description: `${Number(row.units_sold || 0)} units sold in selected period.`,
                target: { tab: 'products' }
            });
        }
    });

    return {
        filter: {
            quickRange: scope.quickRange,
            startDate: scope.seriesStartDate,
            endDate: scope.seriesEndDate,
            comparisonMode: scope.comparison.mode,
            status: scope.filters.status,
            paymentMode: scope.filters.paymentMode,
            sourceChannel: scope.filters.sourceChannel
        },
        overview: {
            grossSales: Number(base.gross_sales || 0),
            netSales,
            totalOrders,
            paidOrders,
            attemptedPayments,
            conversionRate: Number(conversionRate.toFixed(1)),
            averageOrderValue: Number(averageOrderValue.toFixed(2)),
            cancelledOrders: Number(base.cancelled_orders || 0),
            refundedAmount: Number(base.refunded_amount || 0),
            activeCustomers,
            repeatCustomers,
            repeatRate: Number(repeatRate.toFixed(1)),
            comparison
        },
        growth,
        risk,
        funnel: {
            attempted: attemptedPayments,
            paid: Number(funnelRows?.[0]?.paid || 0),
            shipped: Number(funnelRows?.[0]?.shipped || 0),
            completed: Number(funnelRows?.[0]?.completed || 0),
            cancelled: Number(funnelRows?.[0]?.cancelled || 0),
            refunded: Number(funnelRows?.[0]?.refunded || 0)
        },
        trends: trendSeries,
        products: {
            topSellers: (productRows || []).map((row) => ({
                productId: row.product_id,
                variantId: row.variant_id || '',
                title: row.title,
                variantTitle: row.variant_title || '',
                thumbnail: row.thumbnail || '',
                unitsSold: Number(row.units_sold || 0),
                revenue: Number(row.revenue || 0)
            })),
            noSales: (noSalesRows || []).map((row) => ({
                productId: row.id,
                title: row.title
            }))
        },
        customers: {
            newCustomers: Number(newCustomerRows?.[0]?.new_customers || 0),
            activeCustomers,
            repeatCustomers,
            topCustomers: (topCustomerRows || []).map((row) => ({
                userId: row.user_id,
                name: row.customer_name,
                mobile: row.customer_mobile,
                loyaltyTier: row.loyalty_tier || 'regular',
                orders: Number(row.orders_count || 0),
                revenue: Number(row.revenue || 0)
            }))
        },
        operators: {
            scorecards: (operatorRows || []).map((row) => ({
                userId: row.user_id,
                name: row.operator_name,
                totalActions: Number(row.total_actions || 0),
                shippedUpdates: Number(row.shipped_updates || 0),
                completedUpdates: Number(row.completed_updates || 0),
                cancelledUpdates: Number(row.cancelled_updates || 0)
            }))
        },
        actions: actions.slice(0, 8),
        lastUpdatedAt: new Date().toISOString()
    };
};

const getDashboardInsightsPayloadCached = async (query = {}, { force = false } = {}) => {
    if (!force) {
        const cached = readDashboardPayloadCache(query || {});
        if (cached) return cached;
    }
    const payload = await getDashboardInsightsPayload(query || {});
    writeDashboardPayloadCache(query || {}, payload);
    return payload;
};

const getDashboardInsights = async (req, res) => {
    try {
        const force = String(req.query?.force || '').trim() === '1';
        const payload = await getDashboardInsightsPayloadCached(req.query || {}, { force });
        return res.json(payload);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard insights' });
    }
};

const getDashboardOverview = async (req, res) => {
    try {
        const payload = await getDashboardInsightsPayloadCached(req.query || {});
        return res.json({ filter: payload.filter, overview: payload.overview, growth: payload.growth, risk: payload.risk, lastUpdatedAt: payload.lastUpdatedAt });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard overview' });
    }
};

const getDashboardTrends = async (req, res) => {
    try {
        const payload = await getDashboardInsightsPayloadCached(req.query || {});
        return res.json({ filter: payload.filter, trends: payload.trends, lastUpdatedAt: payload.lastUpdatedAt });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard trends' });
    }
};

const getDashboardFunnel = async (req, res) => {
    try {
        const payload = await getDashboardInsightsPayloadCached(req.query || {});
        return res.json({ filter: payload.filter, funnel: payload.funnel, lastUpdatedAt: payload.lastUpdatedAt });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard funnel' });
    }
};

const getDashboardProducts = async (req, res) => {
    try {
        const payload = await getDashboardInsightsPayloadCached(req.query || {});
        return res.json({ filter: payload.filter, products: payload.products, lastUpdatedAt: payload.lastUpdatedAt });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard products' });
    }
};

const getDashboardCustomers = async (req, res) => {
    try {
        const payload = await getDashboardInsightsPayloadCached(req.query || {});
        return res.json({ filter: payload.filter, customers: payload.customers, lastUpdatedAt: payload.lastUpdatedAt });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard customers' });
    }
};

const getDashboardActions = async (req, res) => {
    try {
        const payload = await getDashboardInsightsPayloadCached(req.query || {});
        return res.json({ filter: payload.filter, actions: payload.actions, lastUpdatedAt: payload.lastUpdatedAt });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard actions' });
    }
};

const listDashboardGoals = async (req, res) => {
    try {
        const [rows] = await db.execute(
            `SELECT *
             FROM dashboard_goal_targets
             WHERE is_active = 1
             ORDER BY period_start DESC, id DESC`
        );
        const cache = new Map();
        const computeSnapshot = async (startDate, endDate) => {
            const key = `${startDate}:${endDate}`;
            if (cache.has(key)) return cache.get(key);
            const payload = await getDashboardInsightsPayloadCached({
                quickRange: 'custom',
                startDate,
                endDate,
                status: 'all',
                paymentMode: 'all',
                sourceChannel: 'all'
            }, { force: true });
            cache.set(key, payload);
            return payload;
        };

        const goals = [];
        for (const row of rows || []) {
            const startDate = formatDateOnlyUTC(row.period_start || new Date());
            const endDate = row.period_end ? formatDateOnlyUTC(row.period_end) : formatDateOnlyUTC(new Date());
            const snapshot = await computeSnapshot(startDate, endDate);
            const metricKey = String(row.metric_key || '').toLowerCase();
            let currentValue = 0;
            if (metricKey === 'net_sales') currentValue = Number(snapshot?.overview?.netSales || 0);
            if (metricKey === 'total_orders') currentValue = Number(snapshot?.overview?.totalOrders || 0);
            if (metricKey === 'conversion_rate') currentValue = Number(snapshot?.overview?.conversionRate || 0);
            if (metricKey === 'repeat_rate') currentValue = Number(snapshot?.overview?.repeatRate || 0);
            const targetValue = Number(row.target_value || 0);
            const progressPct = targetValue > 0 ? Math.min(999, Number(((currentValue / targetValue) * 100).toFixed(1))) : 0;
            goals.push({
                id: row.id,
                metricKey,
                label: row.label,
                targetValue,
                currentValue,
                progressPct,
                periodType: row.period_type || 'monthly',
                periodStart: startDate,
                periodEnd: endDate
            });
        }
        return res.json({ goals });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard goals' });
    }
};

const upsertDashboardGoal = async (req, res) => {
    try {
        const {
            id = null,
            metricKey = 'net_sales',
            label = '',
            targetValue = 0,
            periodType = 'monthly',
            periodStart = formatDateOnlyUTC(new Date()),
            periodEnd = null,
            isActive = true
        } = req.body || {};
        const normalizedMetric = toSafeEnum(metricKey, ['net_sales', 'total_orders', 'conversion_rate', 'repeat_rate'], 'net_sales');
        const normalizedPeriod = toSafeEnum(periodType, ['daily', 'weekly', 'monthly', 'custom'], 'monthly');
        const safeLabel = String(label || '').trim() || normalizedMetric.replace(/_/g, ' ').toUpperCase();
        const safeTarget = Number(targetValue || 0);
        if (!Number.isFinite(safeTarget) || safeTarget < 0) {
            return res.status(400).json({ message: 'Invalid target value' });
        }
        const start = formatDateOnlyUTC(periodStart);
        const end = periodEnd ? formatDateOnlyUTC(periodEnd) : null;

        let goalId = null;
        if (id) {
            await db.execute(
                `UPDATE dashboard_goal_targets
                 SET metric_key = ?, label = ?, target_value = ?, period_type = ?, period_start = ?, period_end = ?, is_active = ?
                 WHERE id = ?`,
                [normalizedMetric, safeLabel, safeTarget, normalizedPeriod, start, end, isActive ? 1 : 0, Number(id)]
            );
            goalId = Number(id);
        } else {
            const [insertResult] = await db.execute(
                `INSERT INTO dashboard_goal_targets
                    (metric_key, label, target_value, period_type, period_start, period_end, is_active, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [normalizedMetric, safeLabel, safeTarget, normalizedPeriod, start, end, isActive ? 1 : 0, req.user?.id || null]
            );
            goalId = Number(insertResult?.insertId || 0) || null;
        }
        invalidateDashboardPayloadCache();
        return res.json({
            ok: true,
            goal: {
                id: goalId,
                metricKey: normalizedMetric,
                label: safeLabel,
                targetValue: safeTarget,
                periodType: normalizedPeriod,
                periodStart: start,
                periodEnd: end
            }
        });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to save dashboard goal' });
    }
};

const deleteDashboardGoal = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ message: 'Invalid goal id' });
        }
        await db.execute('UPDATE dashboard_goal_targets SET is_active = 0 WHERE id = ?', [id]);
        invalidateDashboardPayloadCache();
        return res.json({ ok: true, id });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete dashboard goal' });
    }
};

const getDashboardAlertSettings = async (_req, res) => {
    try {
        const [rows] = await db.execute('SELECT * FROM dashboard_alert_settings WHERE id = 1 LIMIT 1');
        const row = rows?.[0] || null;
        if (!row) {
            return res.json({
                settings: {
                    isActive: false,
                    emailRecipients: '',
                    whatsappRecipients: '',
                    pendingOver72Threshold: 10,
                    failedPayment6hThreshold: 8,
                    codCancelRateThreshold: 20,
                    lowStockThreshold: 5
                }
            });
        }
        return res.json({
            settings: {
                isActive: Number(row.is_active || 0) === 1,
                emailRecipients: row.email_recipients || '',
                whatsappRecipients: row.whatsapp_recipients || '',
                pendingOver72Threshold: Number(row.pending_over72_threshold || 10),
                failedPayment6hThreshold: Number(row.failed_payment_6h_threshold || 8),
                codCancelRateThreshold: Number(row.cod_cancel_rate_threshold || 20),
                lowStockThreshold: Number(row.low_stock_threshold || 5),
                updatedAt: row.updated_at || null
            }
        });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load dashboard alert settings' });
    }
};

const removeUploadedAssetIfLocal = async (assetUrl = '') => {
    const absolutePath = resolveUploadedAssetPath(assetUrl);
    if (!absolutePath) return;
    try {
        await fs.promises.unlink(absolutePath);
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
};

const updateDashboardAlertSettings = async (req, res) => {
    try {
        const payload = req.body || {};
        await db.execute(
            `UPDATE dashboard_alert_settings
             SET is_active = ?,
                 email_recipients = ?,
                 whatsapp_recipients = ?,
                 pending_over72_threshold = ?,
                 failed_payment_6h_threshold = ?,
                 cod_cancel_rate_threshold = ?,
                 low_stock_threshold = ?
             WHERE id = 1`,
            [
                payload.isActive ? 1 : 0,
                String(payload.emailRecipients || '').trim(),
                String(payload.whatsappRecipients || '').trim(),
                Math.max(1, Number(payload.pendingOver72Threshold || 10)),
                Math.max(1, Number(payload.failedPayment6hThreshold || 8)),
                Math.max(1, Number(payload.codCancelRateThreshold || 20)),
                Math.max(1, Number(payload.lowStockThreshold || 5))
            ]
        );
        invalidateDashboardPayloadCache();
        return getDashboardAlertSettings(req, res);
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update dashboard alert settings' });
    }
};

const executeDashboardAlerts = async ({ trigger = 'manual', actorUserId = null, forceRefresh = false } = {}) => {
    const [rows] = await db.execute('SELECT * FROM dashboard_alert_settings WHERE id = 1 LIMIT 1');
    const settings = rows?.[0] || null;
    if (!settings || Number(settings.is_active || 0) !== 1) {
        return { ok: true, sent: 0, skipped: true, reason: 'alerts_disabled' };
    }
    const payload = await getDashboardInsightsPayloadCached({
        quickRange: 'last_7_days',
        comparisonMode: 'previous_period',
        status: 'all',
        paymentMode: 'all',
        sourceChannel: 'all',
        lowStockThreshold: Number(settings.low_stock_threshold || 5)
    }, { force: forceRefresh });

    const candidates = [];
    if (Number(payload?.risk?.pendingAging?.over72h || 0) >= Number(settings.pending_over72_threshold || 10)) {
        candidates.push({
            key: 'pending_over72',
            severity: 'high',
            message: `${Number(payload.risk.pendingAging.over72h || 0)} pending orders are older than 72h`
        });
    }
    if (Number(payload?.risk?.failedPaymentsCurrent6h || 0) >= Number(settings.failed_payment_6h_threshold || 8)) {
        candidates.push({
            key: 'failed_payment_6h',
            severity: 'high',
            message: `${Number(payload.risk.failedPaymentsCurrent6h || 0)} failed payments in last 6 hours`
        });
    }
    if (Number(payload?.risk?.codCancellationRate || 0) >= Number(settings.cod_cancel_rate_threshold || 20)) {
        candidates.push({
            key: 'cod_cancellation_rate',
            severity: Number(payload.risk.codCancellationRate || 0) >= Number(settings.cod_cancel_rate_threshold || 20) + 10 ? 'high' : 'medium',
            message: `COD cancellation rate is ${Number(payload.risk.codCancellationRate || 0).toFixed(1)}%`
        });
    }
    const lowStockAlerts = (payload?.actions || []).filter((item) => String(item?.id || '').startsWith('low_stock_fast_seller_'));
    if (lowStockAlerts.length >= 1) {
        candidates.push({
            key: 'low_stock_fast_seller',
            severity: 'high',
            message: `${lowStockAlerts.length} low-stock fast sellers need replenishment`
        });
    }

    if (!candidates.length) {
        return { ok: true, sent: 0, skipped: true, reason: 'no_threshold_breach' };
    }

    const emailRecipients = String(settings.email_recipients || '').split(',').map((item) => item.trim()).filter(Boolean);
    const whatsappRecipients = String(settings.whatsapp_recipients || '').split(',').map((item) => item.trim()).filter(Boolean);
    const alertResults = [];
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;

    for (const candidate of candidates) {
        const [dupRows] = await db.execute(
            `SELECT COUNT(*) AS total
             FROM dashboard_alert_logs
             WHERE alert_key = ?
               AND sent_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 MINUTE)`,
            [candidate.key]
        );
        if (Number(dupRows?.[0]?.total || 0) > 0) {
            skippedCount += 1;
            alertResults.push({ ...candidate, channels: [], status: 'skipped', reason: 'duplicate_suppressed' });
            continue;
        }

        const channels = [];
        if (emailRecipients.length) {
            const emailResult = await sendEmailCommunication({
                to: emailRecipients,
                subject: `[Dashboard Alert] ${candidate.message}`,
                text: `${candidate.message}\n\nPlease check Admin Dashboard for details.`,
                html: `<p><strong>${candidate.message}</strong></p><p>Please check Admin Dashboard for details.</p>`
            }).catch(() => {});
            if (emailResult?.ok) channels.push('email');
        }
        if (whatsappRecipients.length) {
            let whatsappSent = false;
            for (const mobile of whatsappRecipients) {
                const whatsappResult = await sendWhatsapp({
                    type: 'dashboard_alert',
                    template: 'dashboard_alert',
                    mobile,
                    message: `SSC Dashboard Alert: ${candidate.message}`
                }).catch(() => {});
                whatsappSent = whatsappSent || Boolean(whatsappResult?.ok);
            }
            if (whatsappSent) channels.push('whatsapp');
        }

        const status = channels.length
            ? 'sent'
            : ((emailRecipients.length || whatsappRecipients.length) ? 'failed' : 'skipped');
        if (status === 'sent') sentCount += 1;
        else if (status === 'failed') failedCount += 1;
        else skippedCount += 1;

        await db.execute(
            `INSERT INTO dashboard_alert_logs
                (alert_key, severity, message, payload_json, channels_json, status)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [
                candidate.key,
                candidate.severity,
                candidate.message,
                JSON.stringify({
                    trigger,
                    actorUserId: actorUserId || null,
                    snapshot: payload || {}
                }),
                JSON.stringify(channels),
                status
            ]
        );
        alertResults.push({ ...candidate, channels, status });
    }

    return {
        ok: true,
        sent: sentCount,
        failed: failedCount,
        skipped: skippedCount,
        processed: candidates.length,
        alerts: alertResults
    };
};

const runDashboardAlerts = async (req, res) => {
    try {
        const result = await executeDashboardAlerts({
            trigger: 'manual',
            actorUserId: req.user?.id || null,
            forceRefresh: true
        });
        return res.json(result);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to run dashboard alerts' });
    }
};

const runDashboardAlertsJob = async () => executeDashboardAlerts({
    trigger: 'scheduler',
    actorUserId: null,
    forceRefresh: true
});

const refreshDashboardDailyAggregates = async ({ lookbackDays = 120 } = {}) => {
    const safeLookback = Math.max(7, Math.min(365, Number(lookbackDays || 120)));
    const [orderRows] = await db.execute(
        `SELECT
            DATE(o.created_at) AS day_date,
            COUNT(*) AS total_orders,
            SUM(COALESCE(o.subtotal, 0) + COALESCE(o.shipping_fee, 0)) AS gross_sales,
            SUM(CASE WHEN o.status <> 'cancelled' THEN COALESCE(o.total, 0) ELSE 0 END) AS net_sales,
            SUM(CASE WHEN LOWER(COALESCE(o.payment_status, '')) = 'paid' THEN 1 ELSE 0 END) AS paid_orders,
            SUM(CASE WHEN LOWER(COALESCE(o.status, '')) = 'shipped' THEN 1 ELSE 0 END) AS shipped_orders,
            SUM(CASE WHEN LOWER(COALESCE(o.status, '')) = 'completed' THEN 1 ELSE 0 END) AS completed_orders,
            SUM(CASE WHEN LOWER(COALESCE(o.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders,
            SUM(CASE WHEN LOWER(COALESCE(o.payment_status, '')) = 'refunded' OR COALESCE(o.refund_amount, 0) > 0 THEN 1 ELSE 0 END) AS refunded_orders,
            SUM(CASE WHEN LOWER(COALESCE(o.payment_status, '')) = 'refunded' OR COALESCE(o.refund_amount, 0) > 0 THEN COALESCE(o.refund_amount, 0) ELSE 0 END) AS refunded_amount,
            COUNT(DISTINCT o.user_id) AS active_customers,
            SUM(CASE WHEN COALESCE(o.coupon_code, '') <> '' THEN 1 ELSE 0 END) AS coupon_orders,
            SUM(COALESCE(o.coupon_discount_value, 0)) AS coupon_discount_total,
            SUM(CASE WHEN LOWER(COALESCE(o.payment_gateway, '')) = 'cod' THEN 1 ELSE 0 END) AS cod_orders,
            SUM(CASE WHEN LOWER(COALESCE(o.payment_gateway, '')) = 'cod' AND LOWER(COALESCE(o.status, '')) = 'cancelled' THEN 1 ELSE 0 END) AS cod_cancelled
         FROM orders o
         WHERE o.created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
         GROUP BY DATE(o.created_at)`,
        [safeLookback]
    );
    const [repeatRows] = await db.execute(
        `SELECT day_date, COUNT(*) AS repeat_customers
         FROM (
            SELECT DATE(created_at) AS day_date, user_id
            FROM orders
            WHERE created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
              AND user_id IS NOT NULL
            GROUP BY DATE(created_at), user_id
            HAVING COUNT(*) > 1
         ) repeats
         GROUP BY day_date`,
        [safeLookback]
    );
    const [attemptRows] = await db.execute(
        `SELECT
            DATE(pa.created_at) AS day_date,
            COUNT(*) AS attempted_payments,
            SUM(CASE WHEN LOWER(COALESCE(pa.status, '')) = 'failed' THEN 1 ELSE 0 END) AS failed_payments
         FROM payment_attempts pa
         WHERE pa.created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
         GROUP BY DATE(pa.created_at)`,
        [safeLookback]
    );
    const [newCustomerRows] = await db.execute(
        `SELECT
            DATE(u.created_at) AS day_date,
            COUNT(*) AS new_customers
         FROM users u
         WHERE u.created_at >= DATE_SUB(UTC_DATE(), INTERVAL ? DAY)
         GROUP BY DATE(u.created_at)`,
        [safeLookback]
    );

    const byDate = new Map();
    (orderRows || []).forEach((row) => byDate.set(String(row.day_date), {
        day_date: String(row.day_date),
        total_orders: Number(row.total_orders || 0),
        gross_sales: Number(row.gross_sales || 0),
        net_sales: Number(row.net_sales || 0),
        paid_orders: Number(row.paid_orders || 0),
        shipped_orders: Number(row.shipped_orders || 0),
        completed_orders: Number(row.completed_orders || 0),
        cancelled_orders: Number(row.cancelled_orders || 0),
        refunded_orders: Number(row.refunded_orders || 0),
        refunded_amount: Number(row.refunded_amount || 0),
        attempted_payments: 0,
        failed_payments: 0,
        new_customers: 0,
        active_customers: Number(row.active_customers || 0),
        repeat_customers: 0,
        coupon_orders: Number(row.coupon_orders || 0),
        coupon_discount_total: Number(row.coupon_discount_total || 0),
        cod_orders: Number(row.cod_orders || 0),
        cod_cancelled: Number(row.cod_cancelled || 0)
    }));
    (repeatRows || []).forEach((row) => {
        const key = String(row.day_date);
        const current = byDate.get(key) || {
            day_date: key,
            total_orders: 0,
            gross_sales: 0,
            net_sales: 0,
            paid_orders: 0,
            shipped_orders: 0,
            completed_orders: 0,
            cancelled_orders: 0,
            refunded_orders: 0,
            refunded_amount: 0,
            attempted_payments: 0,
            failed_payments: 0,
            new_customers: 0,
            active_customers: 0,
            repeat_customers: 0,
            coupon_orders: 0,
            coupon_discount_total: 0,
            cod_orders: 0,
            cod_cancelled: 0
        };
        current.repeat_customers = Number(row.repeat_customers || 0);
        byDate.set(key, current);
    });
    (attemptRows || []).forEach((row) => {
        const key = String(row.day_date);
        const current = byDate.get(key) || {
            day_date: key,
            total_orders: 0,
            gross_sales: 0,
            net_sales: 0,
            paid_orders: 0,
            shipped_orders: 0,
            completed_orders: 0,
            cancelled_orders: 0,
            refunded_orders: 0,
            refunded_amount: 0,
            attempted_payments: 0,
            failed_payments: 0,
            new_customers: 0,
            active_customers: 0,
            repeat_customers: 0,
            coupon_orders: 0,
            coupon_discount_total: 0,
            cod_orders: 0,
            cod_cancelled: 0
        };
        current.attempted_payments = Number(row.attempted_payments || 0);
        current.failed_payments = Number(row.failed_payments || 0);
        byDate.set(key, current);
    });
    (newCustomerRows || []).forEach((row) => {
        const key = String(row.day_date);
        const current = byDate.get(key) || {
            day_date: key,
            total_orders: 0,
            gross_sales: 0,
            net_sales: 0,
            paid_orders: 0,
            shipped_orders: 0,
            completed_orders: 0,
            cancelled_orders: 0,
            refunded_orders: 0,
            refunded_amount: 0,
            attempted_payments: 0,
            failed_payments: 0,
            new_customers: 0,
            active_customers: 0,
            repeat_customers: 0,
            coupon_orders: 0,
            coupon_discount_total: 0,
            cod_orders: 0,
            cod_cancelled: 0
        };
        current.new_customers = Number(row.new_customers || 0);
        byDate.set(key, current);
    });

    const values = [...byDate.values()].map((row) => [
        row.day_date,
        row.total_orders,
        row.gross_sales,
        row.net_sales,
        row.paid_orders,
        row.shipped_orders,
        row.completed_orders,
        row.cancelled_orders,
        row.refunded_orders,
        row.refunded_amount,
        row.attempted_payments,
        row.failed_payments,
        row.new_customers,
        row.active_customers,
        row.repeat_customers,
        row.coupon_orders,
        row.coupon_discount_total,
        row.cod_orders,
        row.cod_cancelled
    ]);
    if (values.length) {
        await db.query(
            `INSERT INTO dashboard_daily_aggregates
                (day_date, total_orders, gross_sales, net_sales, paid_orders, shipped_orders, completed_orders, cancelled_orders, refunded_orders, refunded_amount, attempted_payments, failed_payments, new_customers, active_customers, repeat_customers, coupon_orders, coupon_discount_total, cod_orders, cod_cancelled)
             VALUES ?
             ON DUPLICATE KEY UPDATE
                total_orders = VALUES(total_orders),
                gross_sales = VALUES(gross_sales),
                net_sales = VALUES(net_sales),
                paid_orders = VALUES(paid_orders),
                shipped_orders = VALUES(shipped_orders),
                completed_orders = VALUES(completed_orders),
                cancelled_orders = VALUES(cancelled_orders),
                refunded_orders = VALUES(refunded_orders),
                refunded_amount = VALUES(refunded_amount),
                attempted_payments = VALUES(attempted_payments),
                failed_payments = VALUES(failed_payments),
                new_customers = VALUES(new_customers),
                active_customers = VALUES(active_customers),
                repeat_customers = VALUES(repeat_customers),
                coupon_orders = VALUES(coupon_orders),
                coupon_discount_total = VALUES(coupon_discount_total),
                cod_orders = VALUES(cod_orders),
                cod_cancelled = VALUES(cod_cancelled),
                updated_at = CURRENT_TIMESTAMP`,
            [values]
        );
    }
    invalidateDashboardPayloadCache();
    return { ok: true, daysUpserted: values.length, lookbackDays: safeLookback };
};

const trackDashboardEvent = async (req, res) => {
    try {
        const eventType = normalizeDashboardEventType(req.body?.eventType);
        const widgetId = String(req.body?.widgetId || '').trim().slice(0, 120) || null;
        const actionId = String(req.body?.actionId || '').trim().slice(0, 120) || null;
        const meta = req.body?.meta && typeof req.body.meta === 'object' ? req.body.meta : {};
        await db.execute(
            `INSERT INTO dashboard_usage_events
                (event_type, widget_id, action_id, meta_json, user_id)
             VALUES (?, ?, ?, ?, ?)`,
            [
                eventType,
                widgetId,
                actionId,
                JSON.stringify(meta || {}),
                req.user?.id || null
            ]
        );
        return res.json({ ok: true });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to track dashboard event' });
    }
};

// --- 1. GET ALL USERS (PAGINATED) ---
const getUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const role = req.query.role || 'all';
        const search = String(req.query.search || '').trim();
        const result = await User.getPaginated(page, limit, role, search);
        
        res.json({
            users: result.users.map((entry) => User.toSafePayload(entry)),
            pagination: {
                currentPage: page,
                totalPages: result.totalPages,
                totalUsers: result.total
            }
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error', error: error.message });
    }
};

// --- 2. CREATE USER ---
const createUser = async (req, res) => {
    const { name, email, mobile, password, address, role, dob } = req.body;

    try {
        const normalizedEmail = String(email || '').trim().toLowerCase();
        const userExists = await User.findByMobile(mobile);
        if (userExists) {
            return res.status(400).json({ message: 'User already exists' });
        }
        if (normalizedEmail) {
            const emailExists = await User.findByEmail(normalizedEmail);
            if (emailExists) {
                return res.status(400).json({ message: 'Email already in use' });
            }
        }

        // SECURITY: Role Assignment
        const allowedRoles = new Set(['customer', 'staff', 'admin']);
        let roleToAssign = 'customer'; 
        if (req.user.role === 'admin' && role) {
            const requestedRole = String(role || '').trim().toLowerCase();
            if (!allowedRoles.has(requestedRole)) {
                return res.status(400).json({ message: 'Invalid role' });
            }
            roleToAssign = requestedRole;
        } else if (req.user.role === 'staff') {
            roleToAssign = 'customer';
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = await User.create({
            name, email: normalizedEmail || null, mobile,
            password: hashedPassword,
            role: roleToAssign,
            address,
            dob: dob || null
        });
        const safeUser = User.toSafePayload(newUser);

        const io = req.app.get('io');
        if (io) {
            emitToUserAudiences(io, safeUser, 'user:create', safeUser);
        }
        res.status(201).json({ message: 'User created successfully', user: safeUser });

    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// --- 3. DELETE USER ---
const deleteUser = async (req, res) => {
    try {
        const userToDelete = await User.findById(req.params.id);
        
        if (!userToDelete) return res.status(404).json({ message: 'User not found' });

        // RULE: Cannot delete Admins
        if (userToDelete.role === 'admin') {
            return res.status(403).json({ message: 'Action Denied: System Admins cannot be deleted.' });
        }

        // RULE: Staff can only delete Customers
        if (req.user.role === 'staff' && userToDelete.role !== 'customer') {
            return res.status(403).json({ message: 'Access Denied: Staff can only delete customers.' });
        }

        if (String(userToDelete.role || '').toLowerCase() === 'customer') {
            const updatedUser = await User.setActiveStatus(req.params.id, {
                isActive: false,
                reason: 'Deactivated by admin'
            });
            const safeUser = User.toSafePayload(updatedUser);
            const io = req.app.get('io');
            if (io) {
                emitToUserAudiences(io, safeUser, 'user:update', safeUser);
            }
            return res.json({ message: 'Customer deactivated', user: safeUser, action: 'deactivated' });
        }

        await User.delete(req.params.id);
        const io = req.app.get('io');
        if (io) {
            emitToUserAudiences(io, { id: req.params.id }, 'user:delete', { id: req.params.id });
        }
        res.json({ message: 'User removed' });
    } catch (error) {
        res.status(500).json({ message: 'Server Error' });
    }
};

const setUserStatus = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const userToUpdate = await User.findById(userId);
        if (!userToUpdate) return res.status(404).json({ message: 'User not found' });

        if (String(userToUpdate.role || '').toLowerCase() !== 'customer') {
            return res.status(400).json({ message: 'Only customer accounts can be activated or deactivated.' });
        }

        const requestedActive = req.body?.isActive;
        const isActive = requestedActive === true || requestedActive === 'true' || requestedActive === 1 || requestedActive === '1';
        const reason = String(req.body?.reason || '').trim();

        if (!isActive && !reason) {
            return res.status(400).json({ message: 'Deactivation reason is required' });
        }

        const updatedUser = await User.setActiveStatus(userId, { isActive, reason });
        const safeUser = User.toSafePayload(updatedUser);
        const io = req.app.get('io');
        if (io) {
            emitToUserAudiences(io, safeUser, 'user:update', safeUser);
        }
        return res.json({
            message: isActive ? 'Customer reactivated' : 'Customer deactivated',
            user: safeUser
        });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Server Error' });
    }
};

// --- 4. RESET PASSWORD (With Privacy Rule Kept) ---
const resetUserPassword = async (req, res) => {
    const { password } = req.body;

    // VALIDATION: Prevent server crash if password is empty
    if (!password || password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    try {
        const userToUpdate = await User.findById(req.params.id);
        if (!userToUpdate) return res.status(404).json({ message: 'User not found' });

        // --- PRIVACY RULE: KEPT AS REQUESTED ---
        // Prevents Admin from manually resetting Customer passwords
        if (userToUpdate.role === 'customer') {
            return res.status(403).json({ 
                message: 'Action Denied: Customer passwords are private. Ask them to use "Forgot Password".' 
            });
        }
        // ----------------------------------------

        // Staff Check
        if (req.user.role === 'staff') {
            if (String(req.user.id) !== String(req.params.id)) {
                return res.status(403).json({ message: 'Access Denied: You can only reset your own password.' });
            }
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        await User.updatePasswordById(req.params.id, hashedPassword);
        res.json({ message: 'Password updated successfully' });
    } catch (error) {
        console.error("Reset Password Error:", error);
        res.status(500).json({ message: 'Server Error' });
    }
};

// --- 5. GET USER CART (Admin/Staff) ---
const getUserCart = async (req, res) => {
    try {
        const userToFetch = await User.findById(req.params.id);
        if (!userToFetch) return res.status(404).json({ message: 'User not found' });
        const items = await Cart.getByUser(req.params.id);
        res.json({
            items,
            lastActivityAt: userToFetch?.abandoned_cart_last_activity_at || null
        });
    } catch (error) {
        console.error('Admin cart fetch error:', error);
        res.status(500).json({ message: 'Server Error' });
    }
};

const addUserCartItem = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const userToFetch = await User.findById(userId);
        if (!userToFetch || String(userToFetch.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const { productId, variantId, quantity } = req.body || {};
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Cart.addItem(userId, productId, variantId || '', quantity || 1);
        const items = await Cart.getByUser(userId);
        return res.json({ items });
    } catch (error) {
        console.error('Admin cart add error:', error);
        return res.status(500).json({ message: 'Server Error' });
    }
};

const updateUserCartItem = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const userToFetch = await User.findById(userId);
        if (!userToFetch || String(userToFetch.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const { productId, variantId, quantity } = req.body || {};
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Cart.setItemQuantity(userId, productId, variantId || '', quantity);
        const items = await Cart.getByUser(userId);
        return res.json({ items });
    } catch (error) {
        console.error('Admin cart update error:', error);
        return res.status(500).json({ message: 'Server Error' });
    }
};

const removeUserCartItem = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const userToFetch = await User.findById(userId);
        if (!userToFetch || String(userToFetch.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const { productId, variantId } = req.body || {};
        if (!productId) return res.status(400).json({ message: 'productId required' });
        await Cart.removeItem(userId, productId, variantId || '');
        const items = await Cart.getByUser(userId);
        return res.json({ items });
    } catch (error) {
        console.error('Admin cart remove error:', error);
        return res.status(500).json({ message: 'Server Error' });
    }
};

const clearUserCart = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const userToFetch = await User.findById(userId);
        if (!userToFetch || String(userToFetch.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        await Cart.clearUser(userId);
        return res.json({ items: [] });
    } catch (error) {
        console.error('Admin cart clear error:', error);
        return res.status(500).json({ message: 'Server Error' });
    }
};

const getUserCartSummary = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const user = await User.findById(userId);
        if (!user || String(user.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const shippingAddress = normalizeAddressPayload(req.body?.shippingAddress, { fieldLabel: 'Shipping address' });
        const code = String(req.body?.couponCode || '').trim().toUpperCase() || null;
        const summary = await Order.getCheckoutSummary(userId, {
            shippingAddress,
            couponCode: code
        });
        return res.json({ summary });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to compute cart summary' });
    }
};

const getUserAvailableCoupons = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        const user = await User.findById(userId);
        if (!user || String(user.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const coupons = await Order.getAvailableCoupons(userId);
        return res.json({ coupons });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to load available coupons' });
    }
};

const verifyEmailChannel = async (_req, res) => {
    try {
        if (isProductionLike()) {
            return res.status(403).json({ ok: false, channel: 'email', message: 'Email test endpoints are disabled in production' });
        }
        const result = await verifyEmailTransport();
        return res.json({ ok: true, channel: 'email', ...result });
    } catch (error) {
        return res.status(400).json({ ok: false, channel: 'email', message: error?.message || 'Email verification failed' });
    }
};

const sendTestEmail = async (req, res) => {
    try {
        if (isProductionLike()) {
            return res.status(403).json({ ok: false, channel: 'email', message: 'Email test endpoints are disabled in production' });
        }
        const {
            to,
            subject = 'SSC Jewellery - Test Email',
            message = 'This is a test email from SSC Jewellery communications module.'
        } = req.body || {};

        if (!to) {
            return res.status(400).json({ message: 'Recipient email is required' });
        }

        const safeMessage = String(message || '').trim() || 'This is a test email from SSC Jewellery communications module.';
        const result = await sendEmailCommunication({
            to,
            subject,
            text: safeMessage,
            html: `<p>${safeMessage}</p>`,
            workflow: 'admin_test_email',
            disableRetry: true
        });

        return res.json({
            ok: true,
            channel: 'email',
            result
        });
    } catch (error) {
        return res.status(400).json({ ok: false, channel: 'email', message: error?.message || 'Failed to send test email' });
    }
};

const sendTestWhatsapp = async (req, res) => {
    try {
        if (isProductionLike()) {
            return res.status(403).json({ ok: false, channel: 'whatsapp', message: 'WhatsApp test endpoints are disabled in production' });
        }
        const {
            mobile,
            template = 'generic',
            message = '',
            params = '',
            fileUrl = '',
            urlParam = '',
            headUrl = '',
            headParam = '',
            name = 'Customer',
            pdfName = ''
        } = req.body || {};

        const normalizedMobile = String(mobile || '').replace(/\D/g, '');
        if (!normalizedMobile || normalizedMobile.length < 10) {
            return res.status(400).json({ message: 'Valid recipient mobile is required' });
        }

        const resolvedParams = Array.isArray(params)
            ? params
            : String(params || '')
                .split(',')
                .map((entry) => String(entry || '').trim())
                .filter(Boolean);

        const result = await sendWhatsapp({
            type: String(template || 'generic').trim().toLowerCase(),
            template: String(template || 'generic').trim(),
            mobile: normalizedMobile,
            message: String(message || '').trim(),
            params: resolvedParams,
            fileUrl: String(fileUrl || '').trim(),
            urlParam: String(urlParam || '').trim(),
            headUrl: String(headUrl || '').trim(),
            headParam: String(headParam || '').trim(),
            name: String(name || 'Customer').trim(),
            pdfName: String(pdfName || '').trim()
        });

        return res.json({
            ok: Boolean(result?.ok),
            channel: 'whatsapp',
            result
        });
    } catch (error) {
        return res.status(400).json({
            ok: false,
            channel: 'whatsapp',
            message: error?.message || 'Failed to send test WhatsApp'
        });
    }
};

const getCompanyInfo = async (_req, res) => {
    try {
        const [company, taxes] = await Promise.all([
            CompanyProfile.get(),
            TaxConfig.listAll()
        ]);
        return res.json({ company, taxes });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to fetch company info' });
    }
};

const isValidEmail = (value = '') => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
const isValidUrl = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return true;
    try {
        // Accept only http(s) URLs
        const parsed = new URL(raw);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
};

const updateCompanyInfo = async (req, res) => {
    try {
        const payload = req.body || {};
        const existingCompany = await CompanyProfile.get();
        const mergedPayload = {
            ...existingCompany,
            ...payload
        };
        const displayName = String(mergedPayload.displayName || '').trim();
        const contactNumber = String(mergedPayload.contactNumber || '').trim();
        const supportEmail = String(mergedPayload.supportEmail || '').trim();
        const whatsappNumber = String(mergedPayload.whatsappNumber || '').trim();
        const logoUrl = String(mergedPayload.logoUrl || '').trim();
        const faviconUrl = String(mergedPayload.faviconUrl || '').trim();
        const appleTouchIconUrl = String(mergedPayload.appleTouchIconUrl || '').trim();
        const postalCode = String(mergedPayload.postalCode || '').trim();
        const openingHours = String(mergedPayload.openingHours || '').trim();
        const latitude = String(mergedPayload.latitude ?? '').trim();
        const longitude = String(mergedPayload.longitude ?? '').trim();
        const contactJumbotronImageUrl = String(mergedPayload.contactJumbotronImageUrl || '').trim();
        const usageAudienceEnabled = mergedPayload.usageAudienceEnabled === true
            || mergedPayload.usageAudienceEnabled === 1
            || String(mergedPayload.usageAudienceEnabled || '').toLowerCase() === 'true';
        const usageAudienceMenImageUrl = String(mergedPayload.usageAudienceMenImageUrl || '').trim();
        const usageAudienceWomenImageUrl = String(mergedPayload.usageAudienceWomenImageUrl || '').trim();
        const usageAudienceKidsImageUrl = String(mergedPayload.usageAudienceKidsImageUrl || '').trim();
        const razorpayKeyId = String(mergedPayload.razorpayKeyId || '').trim();
        const razorpayKeySecret = typeof mergedPayload.razorpayKeySecret === 'string'
            ? String(mergedPayload.razorpayKeySecret || '').trim()
            : null;
        const razorpayWebhookSecret = typeof mergedPayload.razorpayWebhookSecret === 'string'
            ? String(mergedPayload.razorpayWebhookSecret || '').trim()
            : null;
        const emiMinAmount = Number(mergedPayload.razorpayEmiMinAmount || 0);
        const startingTenure = Number(mergedPayload.razorpayStartingTenureMonths || 0);

        if (!displayName) {
            return res.status(400).json({ message: 'Company display name is required' });
        }
        if (mergedPayload.gstNumber && !/^[0-9A-Za-z]{15}$/.test(String(mergedPayload.gstNumber || '').trim())) {
            return res.status(400).json({ message: 'GST number must be 15 alphanumeric characters' });
        }
        if (supportEmail && !isValidEmail(supportEmail)) {
            return res.status(400).json({ message: 'Support email is invalid' });
        }
        if (contactNumber && !/^[0-9+\-\s()]{7,20}$/.test(contactNumber)) {
            return res.status(400).json({ message: 'Contact number format is invalid' });
        }
        if (whatsappNumber && !/^\d{10,14}$/.test(whatsappNumber)) {
            return res.status(400).json({ message: 'WhatsApp number must be 10-14 digits' });
        }
        if (!logoUrl) {
            return res.status(400).json({ message: 'Company logo is required' });
        }
        if (postalCode && !/^[0-9A-Za-z\-\s]{3,12}$/.test(postalCode)) {
            return res.status(400).json({ message: 'Postal code format is invalid' });
        }
        if (latitude && !Number.isFinite(Number(latitude))) {
            return res.status(400).json({ message: 'Latitude must be a valid number' });
        }
        if (longitude && !Number.isFinite(Number(longitude))) {
            return res.status(400).json({ message: 'Longitude must be a valid number' });
        }
        if ((latitude && !longitude) || (!latitude && longitude)) {
            return res.status(400).json({ message: 'Both latitude and longitude are required together' });
        }
        if (openingHours && openingHours.length > 500) {
            return res.status(400).json({ message: 'Opening hours must be 500 characters or less' });
        }
        if (!isValidUrl(mergedPayload.instagramUrl) || !isValidUrl(mergedPayload.youtubeUrl) || !isValidUrl(mergedPayload.facebookUrl)) {
            return res.status(400).json({ message: 'One or more social links are invalid URLs' });
        }
        if (contactJumbotronImageUrl && !isValidUrl(contactJumbotronImageUrl) && !contactJumbotronImageUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Contact jumbotron image URL must be a valid URL or absolute asset path' });
        }
        if (!isValidUrl(logoUrl) && !logoUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Company logo must be a valid URL or absolute asset path' });
        }
        if (faviconUrl && !isValidUrl(faviconUrl) && !faviconUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Favicon must be a valid URL or absolute asset path' });
        }
        if (appleTouchIconUrl && !isValidUrl(appleTouchIconUrl) && !appleTouchIconUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Apple touch icon must be a valid URL or absolute asset path' });
        }
        if (usageAudienceMenImageUrl && !isValidUrl(usageAudienceMenImageUrl) && !usageAudienceMenImageUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Men usage image must be a valid URL or absolute asset path' });
        }
        if (usageAudienceWomenImageUrl && !isValidUrl(usageAudienceWomenImageUrl) && !usageAudienceWomenImageUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Women usage image must be a valid URL or absolute asset path' });
        }
        if (usageAudienceKidsImageUrl && !isValidUrl(usageAudienceKidsImageUrl) && !usageAudienceKidsImageUrl.startsWith('/')) {
            return res.status(400).json({ message: 'Kids usage image must be a valid URL or absolute asset path' });
        }
        if (usageAudienceEnabled && (!usageAudienceMenImageUrl || !usageAudienceWomenImageUrl || !usageAudienceKidsImageUrl)) {
            return res.status(400).json({ message: 'Men, Women, and Kids usage images are required when usage audience classification is enabled' });
        }
        if (razorpayKeyId && !/^rzp_(test|live)_[a-zA-Z0-9]+$/.test(razorpayKeyId)) {
            return res.status(400).json({ message: 'Razorpay Key ID format is invalid' });
        }
        if (razorpayKeySecret !== null && razorpayKeySecret && !/^([a-zA-Z0-9_\-]{8,})$/.test(razorpayKeySecret)) {
            return res.status(400).json({ message: 'Razorpay Key Secret format is invalid' });
        }
        if (razorpayWebhookSecret !== null && razorpayWebhookSecret && String(razorpayWebhookSecret).length < 8) {
            return res.status(400).json({ message: 'Razorpay Webhook Secret must be at least 8 characters' });
        }
        if (!Number.isFinite(emiMinAmount) || emiMinAmount < 1 || emiMinAmount > 10000000) {
            return res.status(400).json({ message: 'EMI minimum amount must be between 1 and 10000000' });
        }
        if (!Number.isFinite(startingTenure) || startingTenure < 1 || startingTenure > 120) {
            return res.status(400).json({ message: 'Starting tenure must be between 1 and 120 months' });
        }

        mergedPayload.emailChannelEnabled = true;
        mergedPayload.whatsappChannelEnabled = mergedPayload.whatsappChannelEnabled !== false;
        const company = await CompanyProfile.update(mergedPayload);
        if (
            existingCompany?.logoUrl
            && existingCompany.logoUrl !== company?.logoUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.logoUrl);
        }
        if (
            existingCompany?.faviconUrl
            && existingCompany.faviconUrl !== company?.faviconUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.faviconUrl);
        }
        if (
            existingCompany?.appleTouchIconUrl
            && existingCompany.appleTouchIconUrl !== company?.appleTouchIconUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.appleTouchIconUrl);
        }
        if (
            existingCompany?.contactJumbotronImageUrl
            && existingCompany.contactJumbotronImageUrl !== company?.contactJumbotronImageUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.contactJumbotronImageUrl);
        }
        if (
            existingCompany?.usageAudienceMenImageUrl
            && existingCompany.usageAudienceMenImageUrl !== company?.usageAudienceMenImageUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.usageAudienceMenImageUrl);
        }
        if (
            existingCompany?.usageAudienceWomenImageUrl
            && existingCompany.usageAudienceWomenImageUrl !== company?.usageAudienceWomenImageUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.usageAudienceWomenImageUrl);
        }
        if (
            existingCompany?.usageAudienceKidsImageUrl
            && existingCompany.usageAudienceKidsImageUrl !== company?.usageAudienceKidsImageUrl
        ) {
            await removeUploadedAssetIfLocal(existingCompany.usageAudienceKidsImageUrl);
        }
        await emitCompanyTaxUpdate(req, { includeCompany: true });
        queueFullRefresh('company_update');
        return res.json({ company });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update company info' });
    }
};

const listTaxConfigs = async (_req, res) => {
    try {
        const taxes = await TaxConfig.listAll();
        return res.json({ taxes });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch tax rates' });
    }
};

const createTaxConfig = async (req, res) => {
    try {
        const tax = await TaxConfig.create(req.body || {});
        const taxes = await TaxConfig.listAll();
        await emitCompanyTaxUpdate(req, { includeCompany: false });
        return res.status(201).json({ tax, taxes });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to create tax rate' });
    }
};

const updateTaxConfig = async (req, res) => {
    try {
        const taxId = Number(req.params.id);
        if (!Number.isFinite(taxId) || taxId <= 0) {
            return res.status(400).json({ message: 'Invalid tax rate id' });
        }
        const tax = await TaxConfig.update(taxId, req.body || {});
        const taxes = await TaxConfig.listAll();
        await emitCompanyTaxUpdate(req, { includeCompany: false });
        return res.json({ tax, taxes });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update tax rate' });
    }
};

const deleteTaxConfig = async (req, res) => {
    try {
        const taxId = Number(req.params.id);
        if (!Number.isFinite(taxId) || taxId <= 0) {
            return res.status(400).json({ message: 'Invalid tax rate id' });
        }
        await TaxConfig.remove(taxId);
        const taxes = await TaxConfig.listAll();
        await emitCompanyTaxUpdate(req, { includeCompany: false });
        return res.json({ ok: true, taxes });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete tax rate' });
    }
};

const getLoyaltyConfig = async (_req, res) => {
    try {
        const config = await getLoyaltyConfigForAdmin();
        return res.json({ config });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch loyalty config' });
    }
};

const getLoyaltyPopupConfig = async (_req, res) => {
    try {
        const popup = await LoyaltyPopupConfig.getAdminConfig();
        return res.json({ popup });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch popup config' });
    }
};

const updateLoyaltyPopupConfig = async (req, res) => {
    try {
        const previousPopup = await LoyaltyPopupConfig.getAdminConfig();
        const popup = await LoyaltyPopupConfig.updateAdminConfig(req.body || {});
        if (previousPopup?.imageUrl && previousPopup.imageUrl !== popup?.imageUrl) {
            await removeUploadedAssetIfLocal(previousPopup.imageUrl);
        }
        if (previousPopup?.audioUrl && previousPopup.audioUrl !== popup?.audioUrl) {
            await removeUploadedAssetIfLocal(previousPopup.audioUrl);
        }
        await emitLoyaltyPopupUpdate(req, { action: 'config_update' });
        return res.json({ popup });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update popup config' });
    }
};

const listLoyaltyPopupTemplates = async (_req, res) => {
    try {
        const templates = await LoyaltyPopupTemplate.list();
        return res.json({ templates });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch popup templates' });
    }
};

const createLoyaltyPopupTemplate = async (req, res) => {
    try {
        const templateName = String(req.body?.templateName || '').trim();
        const payload = req.body?.payload || {};
        const template = await LoyaltyPopupTemplate.create({ templateName, payload });
        await emitLoyaltyPopupUpdate(req, { action: 'template_create', templateId: template?.id || null });
        return res.status(201).json({ template });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to create popup template' });
    }
};

const updateLoyaltyPopupTemplate = async (req, res) => {
    try {
        const templateId = Number(req.params?.id || 0);
        const templateName = String(req.body?.templateName || '').trim();
        const payload = req.body?.payload || {};
        const template = await LoyaltyPopupTemplate.update(templateId, { templateName, payload });
        await emitLoyaltyPopupUpdate(req, { action: 'template_update', templateId });
        return res.json({ template });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update popup template' });
    }
};

const deleteLoyaltyPopupTemplate = async (req, res) => {
    try {
        const templateId = Number(req.params?.id || 0);
        const ok = await LoyaltyPopupTemplate.remove(templateId);
        if (!ok) return res.status(404).json({ message: 'Popup template not found' });
        await emitLoyaltyPopupUpdate(req, { action: 'template_delete', templateId });
        return res.json({ ok: true, id: templateId });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete popup template' });
    }
};

const updateLoyaltyConfig = async (req, res) => {
    try {
        const items = Array.isArray(req.body?.config) ? req.body.config : [];
        const config = await updateLoyaltyConfigForAdmin(items);
        await ensureLoyaltyConfigLoaded({ force: true }).catch(() => {});
        const io = req.app.get('io');
        if (io) {
            io.to('admin').emit('loyalty:config_update', { config });
            const updatedCustomers = await reassessActiveCustomersForConfigChange({ reason: 'admin_config_update' }).catch(() => []);
            updatedCustomers.forEach((customer) => {
                emitToUserAudiences(io, customer, 'user:update', customer);
            });
        }
        return res.json({ config });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to update loyalty config' });
    }
};

const listCoupons = async (req, res) => {
    try {
        const page = parseInt(req.query.page || '1', 10) || 1;
        const limit = parseInt(req.query.limit || '20', 10) || 20;
        const search = String(req.query.search || '').trim();
        const sourceType = String(req.query.sourceType || 'all').trim().toLowerCase();
        const result = await Coupon.listCoupons({ page, limit, search, sourceType });
        return res.json({
            coupons: result.coupons,
            pagination: {
                currentPage: page,
                totalPages: result.totalPages,
                totalCoupons: result.total
            }
        });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch coupons' });
    }
};

const createCoupon = async (req, res) => {
    try {
        if (String(req.user?.role || '').toLowerCase() !== 'admin') {
            return res.status(403).json({ message: 'Only admin can create coupons' });
        }
        const payload = req.body || {};
        if (!payload.startsAt) {
            return res.status(400).json({ message: 'start date is required' });
        }
        if (payload.expiresAt && new Date(payload.expiresAt).getTime() < new Date(payload.startsAt).getTime()) {
            return res.status(400).json({ message: 'end date must be on or after start date' });
        }
        const discountType = String(payload.discountType || 'percent').toLowerCase();
        if (discountType === 'percent') {
            const maxDiscountValue = Number(payload.maxDiscount ?? payload.maxDiscountValue ?? payload.max_discount_value ?? 0);
            if (!Number.isFinite(maxDiscountValue) || maxDiscountValue <= 0) {
                return res.status(400).json({ message: 'max discount is required for percentage coupons' });
            }
        }
        const coupon = await Coupon.createCoupon(payload, { createdBy: req.user?.id || null });
        emitCouponChanged(req, {
            action: 'created',
            couponId: coupon?.id || null,
            scopeType: coupon?.scope_type || payload.scopeType || 'generic',
            sourceType: coupon?.source_type || payload.sourceType || 'admin',
            broadcast: true
        });
        return res.status(201).json({ coupon });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to create coupon' });
    }
};

const issueCouponToUser = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        if (!userId) return res.status(400).json({ message: 'Invalid user id' });
        const user = await User.findById(userId);
        if (!user || String(user.role || 'customer') !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const body = req.body || {};
        if (!body.startsAt) {
            return res.status(400).json({ message: 'start date is required' });
        }
        if (body.expiresAt && new Date(body.expiresAt).getTime() < new Date(body.startsAt).getTime()) {
            return res.status(400).json({ message: 'end date must be on or after start date' });
        }
        const discountType = String(body.discountType || 'percent').toLowerCase();
        if (discountType === 'percent') {
            const maxDiscountValue = Number(body.maxDiscount ?? body.maxDiscountValue ?? body.max_discount_value ?? 0);
            if (!Number.isFinite(maxDiscountValue) || maxDiscountValue <= 0) {
                return res.status(400).json({ message: 'max discount is required for percentage coupons' });
            }
        }
        const requestedScopeType = String(body.scopeType || 'customer').toLowerCase();
        const scopeType = requestedScopeType === 'category' ? 'category' : 'customer';
        const categoryIds = scopeType === 'category'
            ? [...new Set((Array.isArray(body.categoryIds) ? body.categoryIds : [])
                .map((id) => Number(id))
                .filter((id) => Number.isFinite(id) && id > 0))]
            : [];
        const coupon = await Coupon.createCoupon({
            code: body.code || undefined,
            name: body.name || `Customer Offer - ${user.name || userId}`,
            description: body.description || null,
            sourceType: 'admin',
            scopeType,
            discountType: body.discountType || 'percent',
            discountValue: Number(body.discountValue || 0),
            maxDiscount: body.maxDiscount ?? body.maxDiscountValue ?? body.max_discount_value ?? null,
            minCartValue: body.minCartValue != null ? Number(body.minCartValue) : 0,
            usageLimitTotal: body.usageLimitTotal != null ? Number(body.usageLimitTotal) : null,
            usageLimitPerUser: Math.max(1, Number(body.usageLimitPerUser || 1)),
            startsAt: body.startsAt,
            expiresAt: body.expiresAt || null,
            categoryIds,
            customerTargets: [user.id]
        }, { createdBy: req.user?.id || null });

        const customerName = user.name || 'Customer';
        const expiryLabel = coupon.expires_at ? new Date(coupon.expires_at).toLocaleDateString('en-IN') : 'No expiry';
        const offerType = String(coupon.discount_type || body.discountType || 'percent').toLowerCase();
        const offerValue = Number(coupon.discount_value || body.discountValue || 0);
        const offerLabel = offerType === 'fixed'
            ? `₹${offerValue.toLocaleString('en-IN')} OFF`
            : offerType === 'shipping_full'
                ? 'FREE SHIPPING'
                : offerType === 'shipping_partial'
                    ? `${offerValue}% SHIPPING OFF`
                    : `${offerValue}% OFF`;
        const categoryContext = scopeType === 'category'
            ? await resolveCategoryCouponContext(categoryIds)
            : null;
        const categoryEligibilityLine = categoryContext?.primaryCategoryName
            ? `This coupon is valid only for ${categoryContext.primaryCategoryName} category products.`
            : '';
        const categoryCtaLine = categoryContext?.categoryLink
            ? `Explore eligible products: ${categoryContext.categoryUrl || categoryContext.categoryLink}`
            : '';
        const message = `Hi ${customerName}, your coupon code is ${coupon.code}.`;
        const [emailResult, whatsappResult] = await Promise.all([
            user.email
                ? sendEmailCommunication({
                    to: user.email,
                    subject: `${customerName}, a little surprise from SSC Jewellery`,
                    text: [
                        `Hi ${customerName},`,
                        '',
                        `We are so glad to have you with us.`,
                        `As a small thank-you, here is a special offer for your next order:`,
                        '',
                        `Coupon code: ${coupon.code}`,
                        `Offer: ${offerLabel}`,
                        `Valid till: ${expiryLabel}`,
                        ...(categoryEligibilityLine ? [categoryEligibilityLine] : []),
                        ...(categoryCtaLine ? [categoryCtaLine] : []),
                        '',
                        `Whenever you are ready, apply this code at checkout and enjoy your savings.`,
                        '',
                        `With warmth,`,
                        `Team SSC Jewellery`
                    ].join('\n'),
                    html: `
                        <div style="font-family:Arial,Helvetica,sans-serif;background:#f7f7f8;padding:20px;color:#111827;">
                            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                                <tr>
                                    <td style="padding:22px 22px 8px;">
                                        <div style="font-size:22px;font-weight:700;color:#111827;">A little surprise for you</div>
                                        <div style="font-size:14px;color:#4b5563;margin-top:8px;">Hi ${customerName}, we are so glad to have you with us at SSC Jewellery.</div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:0 22px 8px;">
                                        <div style="font-size:14px;color:#111827;">As a small thank-you, here is a special offer for your next order:</div>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 22px;">
                                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:12px;background:#fafafa;">
                                            <tr>
                                                <td style="padding:14px 16px;">
                                                    <div style="font-size:12px;color:#6b7280;letter-spacing:0.04em;text-transform:uppercase;">Coupon Code</div>
                                                    <div style="font-size:22px;font-weight:700;color:#111827;margin-top:4px;">${coupon.code}</div>
                                                    <div style="font-size:14px;color:#111827;margin-top:8px;">Offer: <strong>${offerLabel}</strong></div>
                                                    <div style="font-size:14px;color:#111827;margin-top:4px;">Valid till: <strong>${expiryLabel}</strong></div>
                                                    ${categoryEligibilityLine ? `<div style="font-size:14px;color:#92400e;margin-top:8px;"><strong>${categoryEligibilityLine}</strong></div>` : ''}
                                                    ${categoryContext?.categoryLink ? `<div style="font-size:13px;color:#1f2937;margin-top:6px;"><a href="${categoryContext.categoryUrl || categoryContext.categoryLink}" style="color:#1f2937;text-decoration:underline;font-weight:600;">Browse eligible category products</a></div>` : ''}
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                                <tr>
                                    <td style="padding:8px 22px 20px;font-size:13px;color:#6b7280;">
                                        Whenever you are ready, apply this code at checkout and enjoy your savings.
                                        <br/><br/>
                                        With warmth,<br/>
                                        <strong>Team SSC Jewellery</strong>
                                    </td>
                                </tr>
                            </table>
                        </div>
                    `
                }).catch(() => ({ ok: false }))
                : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
            user.mobile
                ? sendWhatsapp({
                    type: 'coupon_issue',
                    template: 'coupon_issue',
                    mobile: user.mobile,
                    message: `${message}${categoryEligibilityLine ? ` ${categoryEligibilityLine}` : ''}${categoryCtaLine ? ` ${categoryCtaLine}` : ''} Use once per order.`,
                    data: {
                        storeName: 'SSC Jewellery',
                        couponCode: coupon.code,
                        discount: offerLabel,
                        validUntil: expiryLabel,
                        shopUrl: categoryContext?.categoryUrl || process.env.APP_BASE_URL || process.env.CLIENT_BASE_URL || process.env.FRONTEND_URL || process.env.APP_URL || ''
                    }
                }).catch(() => ({ ok: false }))
                : Promise.resolve({ ok: false, skipped: true, reason: 'missing_mobile' })
        ]);

        emitCouponChanged(req, {
            action: 'created',
            couponId: coupon?.id || null,
            scopeType,
            sourceType: 'admin',
            userTargets: [user.id]
        });

        return res.status(201).json({ coupon, delivery: { email: emailResult, whatsapp: whatsappResult } });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to issue coupon' });
    }
};

const deleteCoupon = async (req, res) => {
    try {
        if (String(req.user?.role || '').toLowerCase() !== 'admin') {
            return res.status(403).json({ message: 'Only admin can delete coupons' });
        }
        const couponRef = String(req.params.couponId || req.params.id || '').trim();
        if (!couponRef) {
            return res.status(400).json({ message: 'Invalid coupon id' });
        }

        if (couponRef.startsWith('abandoned:')) {
            const raw = couponRef.slice('abandoned:'.length);
            const [userId = '', codePart = ''] = raw.split(':');
            const normalizedUserId = String(userId || '').trim();
            const normalizedCode = String(codePart || '').trim().toUpperCase();
            if (!normalizedCode) {
                return res.status(400).json({ message: 'Invalid abandoned coupon id' });
            }
            const affected = normalizedUserId
                ? await AbandonedCart.deactivateDiscountByCodeForUser({ userId: normalizedUserId, code: normalizedCode })
                : await AbandonedCart.deactivateDiscountByCode({ code: normalizedCode });
            if (!affected) return res.status(400).json({ message: 'Coupon is already inactive' });
            emitCouponChanged(req, {
                action: 'deactivated',
                code: normalizedCode,
                scopeType: 'customer',
                sourceType: 'abandoned',
                userTargets: normalizedUserId ? [normalizedUserId] : [],
                broadcast: !normalizedUserId
            });
            return res.json({ ok: true, id: couponRef, code: normalizedCode, action: 'deactivated' });
        }

        const couponId = Number(couponRef);
        const isNumericId = Number.isFinite(couponId) && couponId > 0;
        const coupon = isNumericId
            ? await Coupon.getById(couponId)
            : await Coupon.getByCode(couponRef);
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
        const affected = isNumericId
            ? await Coupon.deactivateCoupon(couponId)
            : await Coupon.deactivateCouponByCode(couponRef);
        if (!affected) return res.status(400).json({ message: 'Coupon is already inactive' });
        emitCouponChanged(req, {
            action: 'deactivated',
            couponId: coupon.id || (isNumericId ? couponId : null),
            code: coupon.code || null,
            scopeType: coupon.scope_type || 'generic',
            sourceType: coupon.source_type || 'admin',
            userTargets: coupon.scope_type === 'customer' ? (coupon.customerTargets || []) : [],
            broadcast: coupon.scope_type !== 'customer'
        });
        return res.json({ ok: true, id: coupon.id || (isNumericId ? couponId : couponRef), action: 'deactivated' });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete coupon' });
    }
};

const deleteUserCoupon = async (req, res) => {
    try {
        if (String(req.user?.role || '').toLowerCase() !== 'admin') {
            return res.status(403).json({ message: 'Only admin can delete coupons' });
        }
        const userId = String(req.params.id || '').trim();
        const couponIdRaw = String(req.params.couponId || '').trim();
        if (!userId || !couponIdRaw) {
            return res.status(400).json({ message: 'Invalid coupon id' });
        }

        if (couponIdRaw.startsWith('abandoned:')) {
            const code = couponIdRaw.slice('abandoned:'.length);
            const affected = await AbandonedCart.deactivateDiscountByCodeForUser({ userId, code });
            if (!affected) return res.status(404).json({ message: 'Coupon not found or already inactive' });
            emitCouponChanged(req, {
                action: 'deactivated',
                code: String(code || '').toUpperCase(),
                scopeType: 'customer',
                sourceType: 'abandoned',
                userTargets: [userId]
            });
            return res.json({ ok: true, id: couponIdRaw, action: 'deactivated' });
        }

        const couponId = Number(couponIdRaw);
        if (!Number.isFinite(couponId) || couponId <= 0) {
            return res.status(400).json({ message: 'Invalid coupon id' });
        }
        const coupon = await Coupon.getById(couponId);
        if (!coupon) return res.status(404).json({ message: 'Coupon not found' });
        const scopeType = String(coupon.scope_type || 'generic').toLowerCase();
        if (scopeType !== 'customer') {
            return res.status(400).json({ message: 'Only customer-scope coupons can be deleted from a customer drawer' });
        }
        const affected = await Coupon.deactivateCoupon(couponId);
        if (!affected) return res.status(400).json({ message: 'Coupon is already inactive' });
        emitCouponChanged(req, {
            action: 'deactivated',
            couponId,
            code: coupon.code || null,
            scopeType: coupon.scope_type || 'generic',
            sourceType: coupon.source_type || 'admin',
            userTargets: [userId]
        });
        return res.json({ ok: true, id: couponId, action: 'deactivated' });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete coupon' });
    }
};

const getUserActiveCoupons = async (req, res) => {
    try {
        const userId = String(req.params.id || '').trim();
        if (!userId) return res.status(400).json({ message: 'Invalid user id' });
        const user = await User.findById(userId);
        if (!user) return res.status(404).json({ message: 'User not found' });
        const coupons = await Coupon.getActiveCouponsByUser({
            userId,
            loyaltyTier: user.loyaltyTier || 'regular'
        });
        return res.json({ coupons });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to fetch active coupons' });
    }
};

module.exports = {
    getUsers,
    createUser,
    deleteUser,
    setUserStatus,
    resetUserPassword,
    getUserCart,
    addUserCartItem,
    updateUserCartItem,
    removeUserCartItem,
    clearUserCart,
    getUserCartSummary,
    getUserAvailableCoupons,
    verifyEmailChannel,
    sendTestEmail,
    sendTestWhatsapp,
    getCompanyInfo,
    updateCompanyInfo,
    listTaxConfigs,
    createTaxConfig,
    updateTaxConfig,
    deleteTaxConfig,
    getLoyaltyConfig,
    updateLoyaltyConfig,
    getLoyaltyPopupConfig,
    updateLoyaltyPopupConfig,
    listLoyaltyPopupTemplates,
    createLoyaltyPopupTemplate,
    updateLoyaltyPopupTemplate,
    deleteLoyaltyPopupTemplate,
    listCoupons,
    createCoupon,
    deleteCoupon,
    deleteUserCoupon,
    issueCouponToUser,
    getUserActiveCoupons,
    getDashboardInsights,
    getDashboardOverview,
    getDashboardTrends,
    getDashboardFunnel,
    getDashboardProducts,
    getDashboardCustomers,
    getDashboardActions,
    listDashboardGoals,
    upsertDashboardGoal,
    deleteDashboardGoal,
    getDashboardAlertSettings,
    updateDashboardAlertSettings,
    runDashboardAlerts,
    runDashboardAlertsJob,
    refreshDashboardDailyAggregates,
    trackDashboardEvent,
    __test__: {
        computeChange,
        toSafeEnum,
        normalizeDashboardEventType,
        buildDashboardCacheKey,
        hasFullDashboardAggregateCoverage
    }
};
