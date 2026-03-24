const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';

const isInvalidTokenValue = (token) => !token || token === 'undefined' || token === 'null';

const decodeBase64Url = (value = '') => {
    const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padding = normalized.length % 4;
    const padded = padding ? `${normalized}${'='.repeat(4 - padding)}` : normalized;
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
        return window.atob(padded);
    }
    if (typeof globalThis !== 'undefined' && globalThis.Buffer) {
        return globalThis.Buffer.from(padded, 'base64').toString('utf8');
    }
    throw new Error('No base64 decoder available');
};

export const isTokenExpired = (token) => {
    if (isInvalidTokenValue(token)) return true;
    try {
        const payload = JSON.parse(decodeBase64Url(String(token).split('.')[1] || ''));
        const exp = Number(payload?.exp || 0);
        if (!Number.isFinite(exp) || exp <= 0) return true;
        return exp * 1000 <= Date.now();
    } catch {
        return true;
    }
};

export const getStoredToken = () => {
    if (typeof localStorage === 'undefined') return null;
    const token = localStorage.getItem('token');
    if (isInvalidTokenValue(token)) return null;
    if (isTokenExpired(token)) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        return null;
    }
    return token;
};

export const getAuthHeaders = ({ includeJsonContentType = true } = {}) => {
    const token = getStoredToken();
    const headers = includeJsonContentType ? { 'Content-Type': 'application/json' } : {};
    if (!token) return headers;
    return {
        ...headers,
        Authorization: `Bearer ${token}`
    };
};

export const dispatchSessionExpired = (message = 'Session expired. Please login again.') => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(AUTH_SESSION_EXPIRED_EVENT, {
        detail: { message: String(message || 'Session expired. Please login again.') }
    }));
};

export const getSessionExpiredEventName = () => AUTH_SESSION_EXPIRED_EVENT;

export const shouldTreatAsExpiredSession = (status, message = '') => {
    const normalizedMessage = String(message || '').toLowerCase();
    return Number(status) === 401
        || normalizedMessage.includes('jwt expired')
        || normalizedMessage.includes('session expired')
        || normalizedMessage.includes('token expired')
        || normalizedMessage.includes('not authorized');
};
