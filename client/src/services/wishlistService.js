import { dispatchSessionExpired, getAuthHeaders, shouldTreatAsExpiredSession } from '../utils/authSession';

const API_URL = import.meta.env.PROD
    ? '/api/wishlist'
    : 'http://localhost:5000/api/wishlist';

const getAuthHeader = () => getAuthHeaders({ includeJsonContentType: true });

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

export const wishlistService = {
    getWishlist: async () => {
        const res = await fetch(`${API_URL}`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    addItem: async (productId, variantId = '') => {
        const res = await fetch(`${API_URL}/items`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ productId, variantId })
        });
        return handleResponse(res);
    },
    removeItem: async (productId, variantId = '', removeAllVariants = false) => {
        const res = await fetch(`${API_URL}/items`, {
            method: 'DELETE',
            headers: getAuthHeader(),
            body: JSON.stringify({ productId, variantId, removeAllVariants })
        });
        return handleResponse(res);
    },
    clearWishlist: async () => {
        const res = await fetch(`${API_URL}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    }
};
