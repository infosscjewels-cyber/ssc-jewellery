import { dispatchSessionExpired, getAuthHeaders, getStoredToken, shouldTreatAsExpiredSession } from '../utils/authSession';
import { fetchWithRetry } from '../utils/fetchRetry';

const API_URL = import.meta.env.PROD 
  ? '/api/admin' 
  : 'http://localhost:5000/api/admin';
const UPLOAD_API_URL = import.meta.env.PROD
  ? '/api/uploads'
  : 'http://localhost:5000/api/uploads';

// 1. Get Token Securely
const getAuthHeader = () => getAuthHeaders({ includeJsonContentType: true });
const getWithRetry = (url, options = {}) => fetchWithRetry(url, options);

// --- SIMPLE IN-MEMORY CACHE ---
let userCache = {};
let abandonedCache = {
    campaign: null,
    insights: {},
    journeys: {},
    timelines: {}
};
let loyaltyCouponCache = {};
let dashboardCache = {};
const ABANDONED_CACHE_TTL = 60 * 1000;

// 2. ERROR HANDLER (The Fix for "Fake Success")
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

export const adminService = {
    getUsers: async (page = 1, role = 'all', limit = 10, search = '') => {
        // 1. Create a unique key for this request (e.g., "page1_roleadmin")
        const cacheKey = `page${page}_role${role}_limit${limit}_search${String(search || '').trim().toLowerCase()}`;

        // 2. Check Cache
        if (userCache[cacheKey]) {
            console.log("Serving from Cache:", cacheKey); // Debug
            return userCache[cacheKey];
        }

        // 3. Fetch from Network
        const query = `?page=${page}&limit=${limit}&role=${encodeURIComponent(role)}&search=${encodeURIComponent(String(search || '').trim())}`;
        const res = await getWithRetry(`${API_URL}/users${query}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);

        // 4. Save to Cache
        userCache[cacheKey] = data;
        return data;
    },

    deleteUser: async (id) => {
        const res = await fetch(`${API_URL}/users/${id}`, { 
            method: 'DELETE',
            headers: getAuthHeader() 
        });
        userCache = {};
        return handleResponse(res);
    },

    setUserStatus: async (id, payload = {}) => {
        const res = await fetch(`${API_URL}/users/${id}/status`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        userCache = {};
        return handleResponse(res);
    },

    resetPassword: async (id, newPassword) => {
        // Sends 'password' to match controller expectation
        const res = await fetch(`${API_URL}/users/${id}/reset-password`, { 
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify({ password: newPassword }) 
        });
        return handleResponse(res);
    },

    createUser: async (userData) => {
        const res = await fetch(`${API_URL}/users`, { 
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(userData)
        });
        userCache = {};
        return handleResponse(res);
    },

    getUserCart: async (userId) => {
        const res = await getWithRetry(`${API_URL}/users/${userId}/cart`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    addUserCartItem: async (userId, payload = {}) => {
        const res = await fetch(`${API_URL}/users/${userId}/cart/items`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    updateUserCartItem: async (userId, payload = {}) => {
        const res = await fetch(`${API_URL}/users/${userId}/cart/items`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    removeUserCartItem: async (userId, payload = {}) => {
        const res = await fetch(`${API_URL}/users/${userId}/cart/items`, {
            method: 'DELETE',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    clearUserCart: async (userId) => {
        const res = await fetch(`${API_URL}/users/${userId}/cart`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    getUserCartSummary: async (userId, payload = {}) => {
        const res = await fetch(`${API_URL}/users/${userId}/cart/summary`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    getUserAvailableCoupons: async (userId) => {
        const res = await getWithRetry(`${API_URL}/users/${userId}/coupons/available`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    getUserActiveCoupons: async (userId) => {
        const res = await getWithRetry(`${API_URL}/users/${userId}/coupons/active`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    issueCouponToUser: async (userId, payload = {}) => {
        const res = await fetch(`${API_URL}/users/${userId}/coupons`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    deleteUserCoupon: async (userId, couponId) => {
        const res = await fetch(`${API_URL}/users/${userId}/coupons/${encodeURIComponent(couponId)}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },

    getUsersAll: async (role = 'all', search = '') => {
        const all = [];
        let page = 1;
        let totalPages = 1;
        const pageSize = 200;
        do {
            const data = await adminService.getUsers(page, role, pageSize, search);
            const users = data.users || data || [];
            all.push(...users);
            totalPages = Number(data.totalPages || data.pagination?.totalPages || 1);
            page += 1;
        } while (page <= totalPages);
        return all;
    },

    getAbandonedCartCampaign: async () => {
        const cached = abandonedCache.campaign;
        if (cached && Date.now() - cached.ts < ABANDONED_CACHE_TTL) {
            return cached.data;
        }
        const res = await getWithRetry(`${API_URL}/communications/abandoned-carts/campaign`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        abandonedCache.campaign = { ts: Date.now(), data };
        return data;
    },

    updateAbandonedCartCampaign: async (payload = {}) => {
        const res = await fetch(`${API_URL}/communications/abandoned-carts/campaign`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        const data = await handleResponse(res);
        abandonedCache.campaign = { ts: Date.now(), data };
        abandonedCache.journeys = {};
        abandonedCache.timelines = {};
        abandonedCache.insights = {};
        return data;
    },

    processAbandonedCartRecoveries: async (limit = 25) => {
        const res = await fetch(`${API_URL}/communications/abandoned-carts/process`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ limit })
        });
        const data = await handleResponse(res);
        abandonedCache.insights = {};
        abandonedCache.journeys = {};
        return data;
    },

    getAbandonedCartInsights: async (rangeDays = 30) => {
        const safeRangeDays = Math.max(1, Math.min(90, Number(rangeDays || 30)));
        const cacheKey = String(safeRangeDays);
        const cached = abandonedCache.insights[cacheKey];
        if (cached && Date.now() - cached.ts < ABANDONED_CACHE_TTL) {
            return cached.data;
        }
        const res = await getWithRetry(`${API_URL}/communications/abandoned-carts/insights?rangeDays=${encodeURIComponent(safeRangeDays)}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        abandonedCache.insights[cacheKey] = { ts: Date.now(), data };
        return data;
    },

    getAbandonedCartJourneys: async ({ status = 'all', search = '', sortBy = 'newest', limit = 50, offset = 0 } = {}) => {
        const cacheKey = `${status}::${search}::${sortBy}::${limit}::${offset}`;
        const cached = abandonedCache.journeys[cacheKey];
        if (cached && Date.now() - cached.ts < ABANDONED_CACHE_TTL) {
            return cached.data;
        }
        const query = `?status=${encodeURIComponent(status)}&search=${encodeURIComponent(search)}&sortBy=${encodeURIComponent(sortBy)}&limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`;
        const res = await getWithRetry(`${API_URL}/communications/abandoned-carts/journeys${query}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        abandonedCache.journeys[cacheKey] = { ts: Date.now(), data };
        return data;
    },

    getAbandonedCartJourneyTimeline: async (journeyId) => {
        const cacheKey = String(journeyId);
        const cached = abandonedCache.timelines[cacheKey];
        if (cached && Date.now() - cached.ts < ABANDONED_CACHE_TTL) {
            return cached.data;
        }
        const res = await getWithRetry(`${API_URL}/communications/abandoned-carts/journeys/${journeyId}/timeline`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        abandonedCache.timelines[cacheKey] = { ts: Date.now(), data };
        return data;
    },
    getCompanyInfo: async () => {
        const res = await getWithRetry(`${API_URL}/company-info`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    updateCompanyInfo: async (payload = {}) => {
        const res = await fetch(`${API_URL}/company-info`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    sendTestWhatsapp: async (payload = {}) => {
        const res = await fetch(`${API_URL}/communications/whatsapp/test`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    getCommunicationDeliveryLogs: async ({ status = 'all', limit = 30 } = {}) => {
        const query = `?status=${encodeURIComponent(status)}&limit=${encodeURIComponent(limit)}`;
        const res = await getWithRetry(`${API_URL}/communications/delivery-logs${query}`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    getTaxConfigs: async () => {
        const res = await getWithRetry(`${API_URL}/taxes`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    createTaxConfig: async (payload = {}) => {
        const res = await fetch(`${API_URL}/taxes`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    updateTaxConfig: async (id, payload = {}) => {
        const res = await fetch(`${API_URL}/taxes/${encodeURIComponent(id)}`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    deleteTaxConfig: async (id) => {
        const res = await fetch(`${API_URL}/taxes/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    getLoyaltyConfig: async () => {
        const res = await getWithRetry(`${API_URL}/loyalty/config`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    updateLoyaltyConfig: async (config = []) => {
        const res = await fetch(`${API_URL}/loyalty/config`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify({ config })
        });
        return handleResponse(res);
    },
    getLoyaltyPopupConfig: async () => {
        const res = await getWithRetry(`${API_URL}/loyalty/popup`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    updateLoyaltyPopupConfig: async (payload = {}) => {
        const res = await fetch(`${API_URL}/loyalty/popup`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    listLoyaltyPopupTemplates: async () => {
        const res = await getWithRetry(`${API_URL}/loyalty/popup/templates`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    createLoyaltyPopupTemplate: async (payload = {}) => {
        const res = await fetch(`${API_URL}/loyalty/popup/templates`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    updateLoyaltyPopupTemplate: async (templateId, payload = {}) => {
        const res = await fetch(`${API_URL}/loyalty/popup/templates/${encodeURIComponent(templateId)}`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        return handleResponse(res);
    },
    deleteLoyaltyPopupTemplate: async (templateId) => {
        const res = await fetch(`${API_URL}/loyalty/popup/templates/${encodeURIComponent(templateId)}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    uploadLoyaltyPopupImage: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/popup-image`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadLoyaltyPopupAudio: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('audio', file);
        const res = await fetch(`${UPLOAD_API_URL}/popup-audio`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadContactJumbotronImage: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/contact-jumbotron-image`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadUsageAudienceImage: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/usage-audience-image`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadCompanyLogo: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/company-logo`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadCompanyFavicon: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/company-favicon`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadCompanyAppleTouchIcon: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/company-apple-touch-icon`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    uploadCarouselCardImage: async (file) => {
        const token = getStoredToken();
        const formData = new FormData();
        formData.append('image', file);
        const res = await fetch(`${UPLOAD_API_URL}/carousel-card-image`, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData
        });
        return handleResponse(res);
    },
    getLoyaltyCoupons: async ({ page = 1, limit = 20, search = '', sourceType = 'all' } = {}) => {
        const cacheKey = `${page}::${limit}::${search}::${sourceType}`;
        const cached = loyaltyCouponCache[cacheKey];
        if (cached && Date.now() - cached.ts < ABANDONED_CACHE_TTL) {
            return cached.data;
        }
        const query = `?page=${encodeURIComponent(page)}&limit=${encodeURIComponent(limit)}&search=${encodeURIComponent(search)}&sourceType=${encodeURIComponent(sourceType)}`;
        const res = await getWithRetry(`${API_URL}/loyalty/coupons${query}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        loyaltyCouponCache[cacheKey] = { ts: Date.now(), data };
        return data;
    },
    createLoyaltyCoupon: async (payload = {}) => {
        const res = await fetch(`${API_URL}/loyalty/coupons`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify(payload || {})
        });
        const data = await handleResponse(res);
        loyaltyCouponCache = {};
        return data;
    },
    deleteLoyaltyCoupon: async (couponId) => {
        const encodedId = encodeURIComponent(String(couponId ?? '').trim());
        const res = await fetch(`${API_URL}/loyalty/coupons/${encodedId}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        const data = await handleResponse(res);
        loyaltyCouponCache = {};
        return data;
    },
    invalidateLoyaltyCouponCache: () => {
        loyaltyCouponCache = {};
    },
    getDashboardInsights: async ({
        quickRange = 'last_30_days',
        startDate = '',
        endDate = '',
        comparisonMode = 'previous_period',
        status = 'all',
        paymentMode = 'all',
        sourceChannel = 'all',
        forceRefresh = false
    } = {}) => {
        const cacheKey = `${quickRange}::${startDate}::${endDate}::${comparisonMode}::${status}::${paymentMode}::${sourceChannel}`;
        const cached = dashboardCache[cacheKey];
        if (!forceRefresh && cached && Date.now() - cached.ts < ABANDONED_CACHE_TTL) {
            return cached.data;
        }
        const query = `?quickRange=${encodeURIComponent(quickRange)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}&comparisonMode=${encodeURIComponent(comparisonMode)}&status=${encodeURIComponent(status)}&paymentMode=${encodeURIComponent(paymentMode)}&sourceChannel=${encodeURIComponent(sourceChannel)}&force=${forceRefresh ? '1' : '0'}`;
        const res = await getWithRetry(`${API_URL}/dashboard/insights${query}`, { headers: getAuthHeader() });
        const data = await handleResponse(res);
        dashboardCache[cacheKey] = { ts: Date.now(), data };
        return data;
    },
    getDashboardOverview: async (params = {}) => adminService.getDashboardInsights(params).then((data) => ({
        filter: data?.filter || {},
        overview: data?.overview || {},
        growth: data?.growth || {},
        risk: data?.risk || {},
        lastUpdatedAt: data?.lastUpdatedAt || null
    })),
    getDashboardTrends: async (params = {}) => adminService.getDashboardInsights(params).then((data) => ({
        filter: data?.filter || {},
        trends: data?.trends || [],
        lastUpdatedAt: data?.lastUpdatedAt || null
    })),
    getDashboardFunnel: async (params = {}) => adminService.getDashboardInsights(params).then((data) => ({
        filter: data?.filter || {},
        funnel: data?.funnel || {},
        lastUpdatedAt: data?.lastUpdatedAt || null
    })),
    getDashboardProducts: async (params = {}) => adminService.getDashboardInsights(params).then((data) => ({
        filter: data?.filter || {},
        products: data?.products || {},
        lastUpdatedAt: data?.lastUpdatedAt || null
    })),
    getDashboardCustomers: async (params = {}) => adminService.getDashboardInsights(params).then((data) => ({
        filter: data?.filter || {},
        customers: data?.customers || {},
        lastUpdatedAt: data?.lastUpdatedAt || null
    })),
    getDashboardActions: async (params = {}) => adminService.getDashboardInsights(params).then((data) => ({
        filter: data?.filter || {},
        actions: data?.actions || [],
        lastUpdatedAt: data?.lastUpdatedAt || null
    })),
    getDashboardGoals: async () => {
        const res = await getWithRetry(`${API_URL}/dashboard/goals`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    saveDashboardGoal: async (goal = {}) => {
        const id = goal?.id ? Number(goal.id) : null;
        const endpoint = id ? `${API_URL}/dashboard/goals/${id}` : `${API_URL}/dashboard/goals`;
        const method = id ? 'PUT' : 'POST';
        const res = await fetch(endpoint, {
            method,
            headers: getAuthHeader(),
            body: JSON.stringify(goal || {})
        });
        return handleResponse(res);
    },
    deleteDashboardGoal: async (id) => {
        const res = await fetch(`${API_URL}/dashboard/goals/${encodeURIComponent(id)}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    getDashboardAlertSettings: async () => {
        const res = await getWithRetry(`${API_URL}/dashboard/alerts`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    updateDashboardAlertSettings: async (settings = {}) => {
        const res = await fetch(`${API_URL}/dashboard/alerts`, {
            method: 'PUT',
            headers: getAuthHeader(),
            body: JSON.stringify(settings || {})
        });
        dashboardCache = {};
        return handleResponse(res);
    },
    runDashboardAlertsNow: async () => {
        const res = await fetch(`${API_URL}/dashboard/alerts/run`, {
            method: 'POST',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    trackDashboardEvent: async ({ eventType = 'dashboard_opened', widgetId = '', actionId = '', meta = {} } = {}) => {
        const res = await fetch(`${API_URL}/dashboard/events`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({
                eventType,
                widgetId,
                actionId,
                meta
            })
        });
        return handleResponse(res);
    },
    invalidateDashboardCache: () => {
        dashboardCache = {};
    },

    patchAbandonedJourneyCache: (journey) => {
        if (!journey?.id) return;
        Object.keys(abandonedCache.journeys).forEach((cacheKey) => {
            const entry = abandonedCache.journeys[cacheKey];
            const rows = entry?.data?.journeys;
            if (!Array.isArray(rows)) return;
            const idx = rows.findIndex((row) => String(row.id) === String(journey.id));
            if (idx < 0) return;
            const nextRows = [...rows];
            nextRows[idx] = { ...nextRows[idx], ...journey };
            abandonedCache.journeys[cacheKey] = {
                ...entry,
                ts: Date.now(),
                data: { ...entry.data, journeys: nextRows }
            };
        });
        const timelineKey = String(journey.id);
        if (abandonedCache.timelines[timelineKey]?.data?.journey) {
            abandonedCache.timelines[timelineKey] = {
                ...abandonedCache.timelines[timelineKey],
                ts: Date.now(),
                data: {
                    ...abandonedCache.timelines[timelineKey].data,
                    journey: {
                        ...abandonedCache.timelines[timelineKey].data.journey,
                        ...journey
                    }
                }
            };
        }
    },

    invalidateAbandonedCache: () => {
        abandonedCache = {
            campaign: null,
            insights: {},
            journeys: {},
            timelines: {}
        };
    },

    // IMPORTANT: Clear cache when data changes!
    clearCache: () => {
        userCache = {};
        abandonedCache = {
            campaign: null,
            insights: {},
            journeys: {},
            timelines: {}
        };
        loyaltyCouponCache = {};
        dashboardCache = {};
    }
};
