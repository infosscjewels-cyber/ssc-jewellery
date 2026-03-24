import { dispatchSessionExpired, getAuthHeaders, shouldTreatAsExpiredSession } from '../utils/authSession';
import { fetchWithRetry } from '../utils/fetchRetry';

const API_URL = import.meta.env.PROD
  ? '/api/orders'
  : 'http://localhost:5000/api/orders';

const getAuthHeader = () => getAuthHeaders({ includeJsonContentType: true });
const getWithRetry = (url, options = {}) => fetchWithRetry(url, options);

const handleResponse = async (res) => {
    const parseJsonSafely = async () => {
        const raw = await res.text().catch(() => '');
        if (!raw) return {};
        try { return JSON.parse(raw); } catch { return {}; }
    };
    if (!res.ok) {
        const err = await parseJsonSafely();
        if (shouldTreatAsExpiredSession(res.status, err.message || res.statusText)) {
            dispatchSessionExpired(err.message || 'Session expired. Please login again.');
        }
        throw new Error(err.message || res.statusText || 'Server Error');
    }
    return parseJsonSafely();
};

const handleBlobResponse = async (res) => {
    const parseJsonSafely = async () => {
        const raw = await res.text().catch(() => '');
        if (!raw) return {};
        try { return JSON.parse(raw); } catch { return {}; }
    };
    if (!res.ok) {
        const err = await parseJsonSafely();
        if (shouldTreatAsExpiredSession(res.status, err.message || res.statusText)) {
            dispatchSessionExpired(err.message || 'Session expired. Please login again.');
        }
        throw new Error(err.message || res.statusText || 'Download failed');
    }
    return res.blob();
};

let adminOrdersCache = {};
let adminOrderDetailCache = {};
const ADMIN_CACHE_TTL = 60 * 1000;
const MY_ORDERS_CACHE_TTL = 5 * 60 * 1000;
const MY_ORDERS_STORAGE_KEY = 'my_orders_cache_v1';
const MAX_FETCH_RANGE_DAYS = 90;
let myOrdersCache = {};

const getCurrentUserId = () => {
    try {
        const user = JSON.parse(localStorage.getItem('user') || 'null');
        return user?.id || '';
    } catch {
        return '';
    }
};

const buildMyOrdersCacheKey = ({ userId, page, limit, duration }) => {
    return `${userId}::${page}::${limit}::${duration}`;
};

const parseMyOrdersCacheKey = (key) => {
    const [userId, pageRaw, limitRaw, duration] = String(key || '').split('::');
    return {
        userId: userId || '',
        page: Number(pageRaw || 1),
        limit: Number(limitRaw || 10),
        duration: duration || String(MAX_FETCH_RANGE_DAYS)
    };
};

const readMyOrdersCache = () => {
    try {
        const raw = localStorage.getItem(MY_ORDERS_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : {};
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
        return {};
    }
};

const writeMyOrdersCache = () => {
    try {
        localStorage.setItem(MY_ORDERS_STORAGE_KEY, JSON.stringify(myOrdersCache));
    } catch {
        // ignore storage errors
    }
};

myOrdersCache = readMyOrdersCache();

const durationMatches = (createdAt, duration) => {
    if (!duration) return true;
    if (duration === 'latest_10') return true;
    const days = Number(duration);
    if (!Number.isFinite(days) || days <= 0) return true;
    const safeDays = Math.min(MAX_FETCH_RANGE_DAYS, days);
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return true;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - safeDays);
    return created >= cutoff;
};

const normalizeOrderForCache = (order) => {
    if (!order) return order;
    const createdAt = order.created_at || order.createdAt || new Date().toISOString();
    const items = Array.isArray(order.items)
        ? order.items.map((item) => ({
            ...item,
            quantity: Number(item.quantity ?? item.item_snapshot?.quantity ?? item.snapshot?.quantity ?? 0),
            price: Number(item.price ?? item.item_snapshot?.unitPrice ?? item.snapshot?.unitPrice ?? 0),
            line_total: Number(item.line_total ?? item.lineTotal ?? item.item_snapshot?.lineTotal ?? item.snapshot?.lineTotal ?? 0),
            tax_rate_percent: Number(item.tax_rate_percent ?? item.taxRatePercent ?? item.item_snapshot?.taxRatePercent ?? item.snapshot?.taxRatePercent ?? 0),
            tax_amount: Number(item.tax_amount ?? item.taxAmount ?? item.item_snapshot?.taxAmount ?? item.snapshot?.taxAmount ?? 0),
            tax_name: item.tax_name || item.taxName || item.item_snapshot?.taxName || item.snapshot?.taxName || null,
            tax_code: item.tax_code || item.taxCode || item.item_snapshot?.taxCode || item.snapshot?.taxCode || null,
            tax_snapshot_json: item.tax_snapshot_json || item.taxSnapshotJson || item.taxSnapshot || item.item_snapshot?.taxSnapshot || item.snapshot?.taxSnapshot || null,
            original_price: Number(item.original_price ?? item.item_snapshot?.originalPrice ?? item.snapshot?.originalPrice ?? item.compare_at ?? item.mrp ?? 0),
            item_snapshot: item.item_snapshot || item.itemSnapshot || item.snapshot || null,
            image_url: item.image_url || item.imageUrl || item.item_snapshot?.imageUrl || item.snapshot?.imageUrl || null
        }))
        : [];
    const couponMeta = (() => {
        if (!order.coupon_meta && !order.couponMeta) return null;
        const raw = order.coupon_meta || order.couponMeta;
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    })();
    const loyaltyMeta = (() => {
        if (!order.loyalty_meta && !order.loyaltyMeta) return null;
        const raw = order.loyalty_meta || order.loyaltyMeta;
        if (typeof raw === 'object') return raw;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    })();
    return {
        ...order,
        order_ref: order.order_ref || order.orderRef || '',
        created_at: createdAt,
        user_id: order.user_id || order.userId || null,
        payment_status: order.payment_status || order.paymentStatus || '',
        payment_gateway: order.payment_gateway || order.paymentGateway || '',
        razorpay_order_id: order.razorpay_order_id || order.razorpayOrderId || '',
        razorpay_payment_id: order.razorpay_payment_id || order.razorpayPaymentId || '',
        refund_reference: order.refund_reference || order.refundReference || '',
        refund_amount: Number(order.refund_amount ?? order.refundAmount ?? 0),
        refund_status: order.refund_status || order.refundStatus || '',
        refund_mode: order.refund_mode || order.refundMode || '',
        refund_method: order.refund_method || order.refundMethod || '',
        manual_refund_ref: order.manual_refund_ref || order.manualRefundRef || '',
        manual_refund_utr: order.manual_refund_utr || order.manualRefundUtr || '',
        refund_coupon_code: order.refund_coupon_code || order.refundCouponCode || '',
        refund_notes: order.refund_notes || order.refundNotes || null,
        coupon_code: order.coupon_code || order.couponCode || '',
        coupon_type: order.coupon_type || order.couponType || '',
        coupon_discount_value: Number(order.coupon_discount_value ?? order.couponDiscountValue ?? 0),
        coupon_meta: couponMeta,
        loyalty_tier: String(order.loyalty_tier || order.loyaltyTier || 'regular').toLowerCase(),
        loyalty_discount_total: Number(order.loyalty_discount_total ?? order.loyaltyDiscountTotal ?? 0),
        loyalty_shipping_discount_total: Number(order.loyalty_shipping_discount_total ?? order.loyaltyShippingDiscountTotal ?? 0),
        loyalty_meta: loyaltyMeta,
        source_channel: order.source_channel || order.sourceChannel || '',
        is_abandoned_recovery: Boolean(order.is_abandoned_recovery ?? order.isAbandonedRecovery ?? false),
        abandoned_journey_id: order.abandoned_journey_id ?? order.abandonedJourneyId ?? null,
        subtotal: Number(order.subtotal ?? order.subTotal ?? 0),
        shipping_fee: Number(order.shipping_fee ?? order.shippingFee ?? 0),
        discount_total: Number(order.discount_total ?? order.discountTotal ?? 0),
        tax_total: Number(order.tax_total ?? order.taxTotal ?? 0),
        tax_breakup_json: order.tax_breakup_json || order.taxBreakupJson || order.taxBreakup || [],
        total: Number(order.total ?? 0),
        items
    };
};

const matchesAdminQuickRange = (createdAt, query = {}) => {
    const quickRange = String(query.quickRange || 'last_90_days');
    if (quickRange === 'latest_10' || quickRange === 'custom') return true;
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return true;
    const now = new Date();
    if (quickRange === 'last_7_days') {
        const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        return created >= cutoff;
    }
    if (quickRange === 'last_1_month' || quickRange === 'last_30_days') {
        const cutoff = new Date(now);
        cutoff.setMonth(cutoff.getMonth() - 1);
        return created >= cutoff;
    }
    if (quickRange === 'last_90_days') {
        const cutoff = new Date(now.getTime() - MAX_FETCH_RANGE_DAYS * 24 * 60 * 60 * 1000);
        return created >= cutoff;
    }
    return true;
};

const matchesAdminCustomDate = (createdAt, query = {}) => {
    const created = new Date(createdAt);
    if (Number.isNaN(created.getTime())) return true;
    if (query.startDate) {
        const start = new Date(`${query.startDate}T00:00:00`);
        if (!Number.isNaN(start.getTime()) && created < start) return false;
    }
    if (query.endDate) {
        const end = new Date(`${query.endDate}T23:59:59`);
        if (!Number.isNaN(end.getTime()) && created > end) return false;
    }
    return true;
};

const matchesAdminSearch = (order, query = {}) => {
    const term = String(query.search || '').trim().toLowerCase();
    if (!term) return true;
    const haystack = [
        order?.order_ref,
        order?.customer_name,
        order?.customer_mobile,
        order?.razorpay_order_id,
        order?.razorpay_payment_id
    ].map((v) => String(v || '').toLowerCase()).join(' ');
    return haystack.includes(term);
};

const matchesAdminStatus = (order, query = {}) => {
    const status = String(query.status || 'all').toLowerCase();
    if (status === 'all') return true;
    if (status === 'failed') {
        return String(order?.status || '').toLowerCase() === 'failed'
            || String(order?.payment_status || '').toLowerCase() === 'failed';
    }
    return String(order?.status || '').toLowerCase() === status;
};

const matchesAdminSourceChannel = (order, query = {}) => {
    const source = String(query.sourceChannel || 'all').toLowerCase();
    if (!source || source === 'all') return true;
    const channel = String(order?.source_channel || '').toLowerCase();
    const isRecovery = Boolean(order?.is_abandoned_recovery) || channel === 'abandoned_recovery';
    if (source === 'abandoned_recovery') return isRecovery;
    if (source === 'direct') return !isRecovery;
    return channel === source;
};

const sortAdminOrders = (orders = [], query = {}) => {
    const list = [...orders];
    const quickRange = String(query.quickRange || 'all');
    const sortBy = String(query.sortBy || 'newest');
    const getCreatedTs = (order = {}) => {
        const candidates = [
            order?.created_at,
            order?.createdAt,
            order?.updated_at,
            order?.updatedAt
        ];
        for (const value of candidates) {
            const ts = new Date(value || 0).getTime();
            if (Number.isFinite(ts) && ts > 0) return ts;
        }
        const numericId = Number(order?.id || 0);
        return Number.isFinite(numericId) ? numericId : 0;
    };
    const byCreatedDesc = (a, b) => getCreatedTs(b) - getCreatedTs(a);
    const byCreatedAsc = (a, b) => getCreatedTs(a) - getCreatedTs(b);
    const tierPriority = {
        platinum: 4,
        gold: 3,
        silver: 2,
        bronze: 1,
        regular: 0
    };
    if (quickRange === 'latest_10') return list.sort(byCreatedDesc);
    if (sortBy === 'oldest') return list.sort(byCreatedAsc);
    if (sortBy === 'amount_high') {
        return list.sort((a, b) => Number(b.total || 0) - Number(a.total || 0) || byCreatedDesc(a, b));
    }
    if (sortBy === 'amount_low') {
        return list.sort((a, b) => Number(a.total || 0) - Number(b.total || 0) || byCreatedDesc(a, b));
    }
    if (sortBy === 'priority') {
        return list.sort((a, b) => {
            const aTier = String(a?.loyalty_tier || a?.loyaltyTier || 'regular').toLowerCase();
            const bTier = String(b?.loyalty_tier || b?.loyaltyTier || 'regular').toLowerCase();
            const tierDiff = Number(tierPriority[bTier] ?? 0) - Number(tierPriority[aTier] ?? 0);
            if (tierDiff !== 0) return tierDiff;
            return byCreatedDesc(a, b);
        });
    }
    return list.sort(byCreatedDesc);
};

const orderMatchesAdminQuery = (order, query = {}) => {
    if (!matchesAdminStatus(order, query)) return false;
    if (!matchesAdminSourceChannel(order, query)) return false;
    if (!matchesAdminSearch(order, query)) return false;
    if (!matchesAdminQuickRange(order?.created_at, query)) return false;
    if (!matchesAdminCustomDate(order?.created_at, query)) return false;
    return true;
};

const patchAdminOrderCaches = (order) => {
    if (!order) return;
    const normalized = normalizeOrderForCache(order);
    Object.keys(adminOrdersCache).forEach((key) => {
        const entry = adminOrdersCache[key];
        const query = entry?.query || {};
        const data = entry?.data;
        if (!data || !Array.isArray(data.orders)) return;
        const nextOrders = [...data.orders];
        const idx = nextOrders.findIndex((row) => String(row.id) === String(normalized.id));
        const matches = orderMatchesAdminQuery(normalized, query);

        if (idx >= 0) {
            if (!matches) {
                nextOrders.splice(idx, 1);
            } else {
                nextOrders[idx] = { ...nextOrders[idx], ...normalized };
            }
        } else if (matches && Number(query.page || 1) === 1) {
            nextOrders.unshift(normalized);
            const limit = Number(query.limit || nextOrders.length || 20);
            if (nextOrders.length > limit) nextOrders.length = limit;
        } else {
            return;
        }

        const sorted = sortAdminOrders(nextOrders, query);
        adminOrdersCache[key] = {
            ...entry,
            ts: Date.now(),
            data: {
                ...data,
                orders: sorted
            }
        };
    });
};

const patchAdminAttemptCaches = (attempt) => {
    if (!attempt?.id) return;
    const normalized = normalizeOrderForCache({
        ...attempt,
        id: `attempt_${attempt.id}`,
        entity_type: 'attempt',
        order_id: null,
        attempt_id: attempt.id,
        order_ref: attempt.order_ref || `PAY-${attempt.razorpay_order_id || attempt.id}`,
        status: 'failed',
        total: Number(attempt.amount_subunits || 0) / 100,
        subtotal: Number(attempt.amount_subunits || 0) / 100,
        shipping_fee: 0,
        discount_total: 0,
        customer_name: attempt.customer_name || '',
        customer_mobile: attempt.customer_mobile || ''
    });
    Object.keys(adminOrdersCache).forEach((key) => {
        const entry = adminOrdersCache[key];
        const data = entry?.data;
        if (!data || !Array.isArray(data.orders)) return;
        const nextOrders = [...data.orders];
        const idx = nextOrders.findIndex((row) => String(row.attempt_id || '') === String(attempt.id) || String(row.id) === String(normalized.id));
        if (idx < 0) return;
        nextOrders[idx] = { ...nextOrders[idx], ...normalized };
        adminOrdersCache[key] = {
            ...entry,
            ts: Date.now(),
            data: { ...data, orders: nextOrders }
        };
    });
};

const removeAdminEntityFromCache = ({ id, entityType = 'order' } = {}) => {
    if (!id) return;
    Object.keys(adminOrdersCache).forEach((key) => {
        const entry = adminOrdersCache[key];
        const data = entry?.data;
        if (!data || !Array.isArray(data.orders)) return;
        const before = data.orders.length;
        const nextOrders = data.orders.filter((row) => {
            if (entityType === 'attempt') {
                return String(row.attempt_id || row.id) !== String(id) && String(row.id) !== `attempt_${id}`;
            }
            return String(row.order_id || row.id) !== String(id);
        });
        if (nextOrders.length === before) return;
        adminOrdersCache[key] = {
            ...entry,
            ts: Date.now(),
            data: { ...data, orders: nextOrders }
        };
    });
};

export const orderService = {
    getCheckoutSummary: async ({ shippingAddress, couponCode } = {}) => {
        const payload = { shippingAddress };
        const normalizedCoupon = String(couponCode ?? '').trim().toUpperCase();
        if (normalizedCoupon) payload.couponCode = normalizedCoupon;
        const res = await fetch(`${API_URL}/summary`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload)
        });
        return handleResponse(res);
    },
    createRazorpayOrder: async ({ billingAddress, shippingAddress, notes, couponCode } = {}) => {
        const payload = { billingAddress, shippingAddress, notes };
        const normalizedCoupon = String(couponCode ?? '').trim().toUpperCase();
        if (normalizedCoupon) payload.couponCode = normalizedCoupon;
        const res = await fetch(`${API_URL}/razorpay/order`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload)
        });
        return handleResponse(res);
    },
    validateRecoveryCoupon: async ({ code, shippingAddress } = {}) => {
        const res = await fetch(`${API_URL}/coupon/validate`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ code, shippingAddress })
        });
        return handleResponse(res);
    },
    getAvailableCoupons: async ({ shippingAddress = null } = {}) => {
        const res = await fetch(`${API_URL}/coupons/available`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ shippingAddress })
        });
        return handleResponse(res);
    },
    getCustomerPopupData: async () => {
        const res = await fetch(`${API_URL}/coupons/popup`, {
            method: 'GET',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    getPublicPopupData: async () => {
        const res = await fetch(`${API_URL}/coupons/popup/public`, {
            method: 'GET'
        });
        return handleResponse(res);
    },
    retryRazorpayOrder: async ({ attemptId } = {}) => {
        const res = await fetch(`${API_URL}/razorpay/retry`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ attemptId })
        });
        return handleResponse(res);
    },
    verifyRazorpayPayment: async (payload) => {
        const res = await fetch(`${API_URL}/razorpay/verify`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        const data = await handleResponse(res);
        if (data?.order) {
            orderService.patchMyOrdersCache(data.order);
        }
        return data;
    },
    checkout: async ({ billingAddress, shippingAddress }) => {
        const res = await fetch(`${API_URL}/checkout`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ billingAddress, shippingAddress })
        });
        const data = await handleResponse(res);
        if (data?.order) {
            orderService.patchMyOrdersCache(data.order);
        }
        return data;
    },
    getAdminOrders: async ({
        page = 1,
        limit = 20,
        status = 'all',
        search = '',
        startDate = '',
        endDate = '',
        quickRange = 'last_90_days',
        sortBy = 'newest',
        sourceChannel = 'all'
    }) => {
        const cacheKey = `${page}_${limit}_${status}_${search}_${startDate}_${endDate}_${quickRange}_${sortBy}_${sourceChannel}`;
        const cached = adminOrdersCache[cacheKey];
        if (cached && Date.now() - cached.ts < ADMIN_CACHE_TTL) {
            return cached.data;
        }
        const query = `?page=${page}&limit=${limit}&status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&quickRange=${encodeURIComponent(quickRange)}&sortBy=${encodeURIComponent(sortBy)}&sourceChannel=${encodeURIComponent(sourceChannel)}`;
        const res = await getWithRetry(`${API_URL}/admin${query}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        data.orders = sortAdminOrders(Array.isArray(data?.orders) ? data.orders : [], {
            page,
            limit,
            status,
            search,
            startDate,
            endDate,
            quickRange,
            sortBy,
            sourceChannel
        });
        adminOrdersCache[cacheKey] = {
            ts: Date.now(),
            query: { page, limit, status, search, startDate, endDate, quickRange, sortBy, sourceChannel },
            data
        };
        return data;
    },
    getAdminPaymentHealth: async () => {
        const res = await getWithRetry(`${API_URL}/admin/payment/health`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    getAdminOrder: async (id) => {
        const key = String(id);
        const cached = adminOrderDetailCache[key];
        if (cached && Date.now() - cached.ts < ADMIN_CACHE_TTL) {
            return cached.data;
        }
        const res = await getWithRetry(`${API_URL}/admin/${id}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        adminOrderDetailCache[key] = { ts: Date.now(), data };
        return data;
    },
    updateAdminOrderStatus: async (id, status, options = {}) => {
        const res = await fetch(`${API_URL}/admin/${id}/status`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify({
                status,
                processRefund: Boolean(options?.processRefund),
                cancellationMode: options?.cancellationMode ?? '',
                manualRefundAmount: options?.manualRefundAmount ?? null,
                manualRefundMethod: options?.manualRefundMethod ?? '',
                manualRefundRef: options?.manualRefundRef ?? '',
                manualRefundUtr: options?.manualRefundUtr ?? '',
                courierPartner: options?.courierPartner ?? '',
                courierPartnerOther: options?.courierPartnerOther ?? '',
                awbNumber: options?.awbNumber ?? ''
            })
        });
        const data = await handleResponse(res);
        if (data?.order) {
            patchAdminOrderCaches(data.order);
            adminOrderDetailCache[String(data.order.id)] = { ts: Date.now(), data: { order: data.order } };
        }
        return data;
    },
    deleteAdminOrder: async (id) => {
        const res = await fetch(`${API_URL}/admin/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        const data = await handleResponse(res);
        removeAdminEntityFromCache({ id, entityType: 'order' });
        delete adminOrderDetailCache[String(id)];
        return data;
    },
    deleteAdminPaymentAttempt: async (id) => {
        const res = await fetch(`${API_URL}/admin/attempt/${id}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        const data = await handleResponse(res);
        removeAdminEntityFromCache({ id, entityType: 'attempt' });
        return data;
    },
    convertAdminPaymentAttemptToOrder: async (attemptId, payload = {}) => {
        const res = await fetch(`${API_URL}/admin/attempt/${encodeURIComponent(attemptId)}/convert`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        const data = await handleResponse(res);
        if (data?.order) patchAdminOrderCaches(data.order);
        if (data?.order?.id) {
            adminOrderDetailCache[String(data.order.id)] = { ts: Date.now(), data: { order: data.order } };
        }
        if (attemptId != null) {
            removeAdminEntityFromCache({ id: attemptId, entityType: 'attempt' });
        }
        return data;
    },
    createAdminManualOrder: async (payload = {}) => {
        const res = await fetch(`${API_URL}/admin/manual`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        const data = await handleResponse(res);
        if (data?.order) patchAdminOrderCaches(data.order);
        if (data?.order?.id) {
            adminOrderDetailCache[String(data.order.id)] = { ts: Date.now(), data: { order: data.order } };
        }
        return data;
    },
    getAdminManualCoupons: async (payload = {}) => {
        const res = await fetch(`${API_URL}/admin/manual/coupons`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    getAdminManualPreview: async (payload = {}) => {
        const res = await fetch(`${API_URL}/admin/manual/preview`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    fetchAdminPaymentStatus: async (payload = {}) => {
        const res = await fetch(`${API_URL}/admin/payment/fetch-status`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        const data = await handleResponse(res);
        if (data?.order) patchAdminOrderCaches(data.order);
        if (data?.order?.id) {
            adminOrderDetailCache[String(data.order.id)] = { ts: Date.now(), data: { order: data.order } };
        }
        if (data?.attempt) patchAdminAttemptCaches(data.attempt);
        return data;
    },
    getAdminOverdueShippedSummary: async ({ days = 30, limit = 5 } = {}) => {
        const safeDays = Math.max(1, Number(days) || 30);
        const safeLimit = Math.max(1, Math.min(10, Number(limit) || 5));
        const res = await getWithRetry(`${API_URL}/admin/shipped/overdue-summary?days=${encodeURIComponent(safeDays)}&limit=${encodeURIComponent(safeLimit)}`, {
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    fetchMyPaymentStatus: async ({ orderId } = {}) => {
        const id = Number(orderId);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Valid order id is required');
        const res = await fetch(`${API_URL}/my/payment/fetch-status`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ orderId: id })
        });
        const data = await handleResponse(res);
        if (data?.order) {
            orderService.patchMyOrdersCache(data.order);
        }
        return data;
    },
    getMyOrders: async ({ page = 1, limit = 10, duration = 'latest_10', force = false } = {}) => {
        const userId = getCurrentUserId();
        let safeDuration = String(duration || '').trim().toLowerCase();
        if (!safeDuration || safeDuration === 'all') safeDuration = String(MAX_FETCH_RANGE_DAYS);
        if (safeDuration !== 'latest_10') {
            const days = Number(safeDuration);
            safeDuration = Number.isFinite(days) && days > 0
                ? String(Math.min(MAX_FETCH_RANGE_DAYS, Math.round(days)))
                : String(MAX_FETCH_RANGE_DAYS);
        }
        const cacheKey = buildMyOrdersCacheKey({ userId, page, limit, duration: safeDuration });
        const cached = myOrdersCache[cacheKey];
        if (!force && cached && Date.now() - cached.ts < MY_ORDERS_CACHE_TTL) {
            return cached.data;
        }

        const query = `?page=${page}&limit=${limit}&duration=${encodeURIComponent(safeDuration)}`;
        const res = await fetch(`${API_URL}/my${query}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        myOrdersCache[cacheKey] = { ts: Date.now(), data };
        writeMyOrdersCache();
        return data;
    },
    getMyOrderByPaymentRef: async (paymentId) => {
        const ref = String(paymentId || '').trim();
        if (!ref) throw new Error('Payment reference is required');
        const res = await fetch(`${API_URL}/my/payment/${encodeURIComponent(ref)}`, {
            headers: getAuthHeader()
        });
        const data = await handleResponse(res);
        if (data?.order) {
            orderService.patchMyOrdersCache(data.order);
        }
        return data;
    },
    downloadMyInvoice: async (orderId) => {
        const id = Number(orderId);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid order id');
        const res = await fetch(`${API_URL}/my/${id}/invoice`, {
            headers: getAuthHeader()
        });
        const blob = await handleBlobResponse(res);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `invoice-${id}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return true;
    },
    downloadAdminInvoice: async (orderId) => {
        const id = Number(orderId);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid order id');
        const res = await fetch(`${API_URL}/admin/${id}/invoice`, {
            headers: getAuthHeader()
        });
        const blob = await handleBlobResponse(res);
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `invoice-${id}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        return true;
    },
    sendAdminInvoiceCommunication: async (orderId) => {
        const id = Number(orderId);
        if (!Number.isFinite(id) || id <= 0) throw new Error('Invalid order id');
        const res = await fetch(`${API_URL}/admin/${id}/invoice/send`, {
            method: 'POST',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    getCachedMyOrders: ({ page = 1, limit = 10, duration = 'latest_10' } = {}) => {
        const userId = getCurrentUserId();
        let safeDuration = String(duration || '').trim().toLowerCase();
        if (!safeDuration || safeDuration === 'all') safeDuration = String(MAX_FETCH_RANGE_DAYS);
        if (safeDuration !== 'latest_10') {
            const days = Number(safeDuration);
            safeDuration = Number.isFinite(days) && days > 0
                ? String(Math.min(MAX_FETCH_RANGE_DAYS, Math.round(days)))
                : String(MAX_FETCH_RANGE_DAYS);
        }
        const cacheKey = buildMyOrdersCacheKey({ userId, page, limit, duration: safeDuration });
        const cached = myOrdersCache[cacheKey];
        if (!cached || Date.now() - cached.ts >= MY_ORDERS_CACHE_TTL) return null;
        return cached.data;
    },
    patchMyOrdersCache: (order) => {
        if (!order?.id) return;
        const normalizedOrder = normalizeOrderForCache(order);
        const currentUserId = getCurrentUserId();
        const orderUserId = String(normalizedOrder.user_id || '');
        if (orderUserId && currentUserId && orderUserId !== currentUserId) return;

        const entries = Object.entries(myOrdersCache);
        entries.forEach(([key, value]) => {
            const meta = parseMyOrdersCacheKey(key);
            if (!meta.userId || meta.userId !== currentUserId) return;
            const data = value?.data;
            if (!data || !Array.isArray(data.orders)) return;
            if (!durationMatches(normalizedOrder.created_at, meta.duration)) return;

            const nextOrders = [...data.orders];
            const idx = nextOrders.findIndex((o) => String(o.id) === String(normalizedOrder.id));
            if (idx >= 0) {
                nextOrders[idx] = { ...nextOrders[idx], ...normalizedOrder };
            } else if (meta.page === 1) {
                nextOrders.unshift(normalizedOrder);
                if (nextOrders.length > meta.limit) nextOrders.length = meta.limit;
            } else {
                return;
            }

            const previousTotalOrders = Number(data.pagination?.totalOrders || nextOrders.length);
            let totalOrders = idx >= 0
                ? previousTotalOrders
                : previousTotalOrders + 1;
            if (meta.duration === 'latest_10') {
                totalOrders = Math.min(10, totalOrders);
            }
            myOrdersCache[key] = {
                ...value,
                ts: Date.now(),
                data: {
                    ...data,
                    orders: nextOrders,
                    pagination: {
                        currentPage: Number(data.pagination?.currentPage || meta.page),
                        totalPages: Math.max(
                            1,
                            Math.ceil(totalOrders / Number(meta.limit || 1))
                        ),
                        totalOrders
                    }
                }
            };
        });
        writeMyOrdersCache();
    },
    removeMyOrderFromCache: (orderId) => {
        const targetId = String(orderId || '').trim();
        if (!targetId) return;
        const currentUserId = getCurrentUserId();
        const entries = Object.entries(myOrdersCache);
        let changed = false;
        entries.forEach(([key, value]) => {
            const meta = parseMyOrdersCacheKey(key);
            if (!meta.userId || meta.userId !== currentUserId) return;
            const data = value?.data;
            if (!data || !Array.isArray(data.orders)) return;
            const nextOrders = data.orders.filter((order) => String(order?.id) !== targetId);
            if (nextOrders.length === data.orders.length) return;
            changed = true;
            const totalOrders = Math.max(0, Number(data.pagination?.totalOrders || data.orders.length) - 1);
            myOrdersCache[key] = {
                ...value,
                ts: Date.now(),
                data: {
                    ...data,
                    orders: nextOrders,
                    pagination: {
                        currentPage: Number(data.pagination?.currentPage || meta.page),
                        totalPages: Math.max(1, Math.ceil(Math.max(totalOrders, 1) / Number(meta.limit || 1))),
                        totalOrders
                    }
                }
            };
        });
        if (changed) writeMyOrdersCache();
    },
    clearAdminCache: () => {
        adminOrdersCache = {};
        adminOrderDetailCache = {};
    },
    clearAdminListCache: () => {
        adminOrdersCache = {};
    },
    patchAdminOrderCache: (order) => {
        patchAdminOrderCaches(order);
    },
    patchAdminAttemptCache: (attempt) => {
        patchAdminAttemptCaches(attempt);
    },
    removeAdminEntityCache: ({ id, entityType = 'order' } = {}) => {
        removeAdminEntityFromCache({ id, entityType });
    },
    clearMyOrdersCache: () => {
        const userId = getCurrentUserId();
        if (!userId) {
            myOrdersCache = {};
            writeMyOrdersCache();
            return;
        }
        const next = {};
        Object.entries(myOrdersCache).forEach(([key, value]) => {
            if (!key.startsWith(`${userId}::`)) {
                next[key] = value;
            }
        });
        myOrdersCache = next;
        writeMyOrdersCache();
    }
};
