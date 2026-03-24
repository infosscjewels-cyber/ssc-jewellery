import { dispatchSessionExpired, getAuthHeaders, shouldTreatAsExpiredSession } from '../utils/authSession';

const API_URL = import.meta.env.PROD 
  ? '/api/cart' 
  : 'http://localhost:5000/api/cart';

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

export const cartService = {
    getCart: async () => {
        const res = await fetch(`${API_URL}`, { headers: getAuthHeader() });
        return handleResponse(res);
    },
    addItem: async ({ productId, variantId = '', quantity = 1 }) => {
        const res = await fetch(`${API_URL}/items`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ productId, variantId, quantity })
        });
        return handleResponse(res);
    },
    updateItem: async ({ productId, variantId = '', quantity }) => {
        const res = await fetch(`${API_URL}/items`, {
            method: 'PATCH',
            headers: getAuthHeader(),
            body: JSON.stringify({ productId, variantId, quantity })
        });
        return handleResponse(res);
    },
    removeItem: async ({ productId, variantId = '' }) => {
        const res = await fetch(`${API_URL}/items`, {
            method: 'DELETE',
            headers: getAuthHeader(),
            body: JSON.stringify({ productId, variantId })
        });
        return handleResponse(res);
    },
    clearCart: async () => {
        const res = await fetch(`${API_URL}`, {
            method: 'DELETE',
            headers: getAuthHeader()
        });
        return handleResponse(res);
    },
    bulkAdd: async (items = []) => {
        const res = await fetch(`${API_URL}/bulk`, {
            method: 'POST',
            headers: getAuthHeader(),
            body: JSON.stringify({ items })
        });
        return handleResponse(res);
    }
};
