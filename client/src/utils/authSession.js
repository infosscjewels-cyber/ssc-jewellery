const AUTH_SESSION_EXPIRED_EVENT = 'auth:session-expired';
const GUEST_PREVIEW_MODE_KEY = 'storefront_guest_preview_mode_v1';
const PREVIEW_TOKEN_KEY = 'storefront_preview_token_v1';
const PREVIEW_USER_KEY = 'storefront_preview_user_v1';

const isInvalidTokenValue = (token) => !token || token === 'undefined' || token === 'null';
const hasWindow = () => typeof window !== 'undefined';
const hasLocalStorage = () => typeof localStorage !== 'undefined';
const hasSessionStorage = () => typeof sessionStorage !== 'undefined';
const getLocationSearch = () => (hasWindow() ? String(window.location?.search || '') : '');

const hasGuestPreviewQuery = (search = getLocationSearch()) => {
    try {
        const params = new URLSearchParams(String(search || ''));
        return String(params.get('preview') || '').trim().toLowerCase() === 'guest';
    } catch {
        return false;
    }
};

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

export const isGuestPreviewMode = () => {
    if (hasGuestPreviewQuery()) return true;
    if (!hasSessionStorage()) return false;
    return sessionStorage.getItem(GUEST_PREVIEW_MODE_KEY) === 'guest';
};

export const syncGuestPreviewModeFromLocation = () => {
    if (!hasSessionStorage()) return false;
    if (hasGuestPreviewQuery()) {
        sessionStorage.setItem(GUEST_PREVIEW_MODE_KEY, 'guest');
        return true;
    }
    return isGuestPreviewMode();
};

export const clearGuestPreviewMode = () => {
    if (!hasSessionStorage()) return;
    sessionStorage.removeItem(GUEST_PREVIEW_MODE_KEY);
    sessionStorage.removeItem(PREVIEW_TOKEN_KEY);
    sessionStorage.removeItem(PREVIEW_USER_KEY);
};

const getActiveStorage = () => {
    if (isGuestPreviewMode() && hasSessionStorage()) {
        return {
            storage: sessionStorage,
            tokenKey: PREVIEW_TOKEN_KEY,
            userKey: PREVIEW_USER_KEY
        };
    }
    return {
        storage: hasLocalStorage() ? localStorage : null,
        tokenKey: 'token',
        userKey: 'user'
    };
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
    const { storage, tokenKey, userKey } = getActiveStorage();
    if (!storage) return null;
    const token = storage.getItem(tokenKey);
    if (isInvalidTokenValue(token)) return null;
    if (isTokenExpired(token)) {
        storage.removeItem(tokenKey);
        storage.removeItem(userKey);
        return null;
    }
    return token;
};

export const getStoredUser = () => {
    const { storage, userKey } = getActiveStorage();
    if (!storage) return null;
    const raw = storage.getItem(userKey);
    if (!raw) return null;
    try {
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

export const setStoredSession = (token, userData) => {
    const { storage, tokenKey, userKey } = getActiveStorage();
    if (!storage) return;
    if (token) storage.setItem(tokenKey, token);
    storage.setItem(userKey, JSON.stringify(userData));
};

export const setStoredUser = (userData) => {
    const { storage, userKey } = getActiveStorage();
    if (!storage) return;
    storage.setItem(userKey, JSON.stringify(userData));
};

export const clearStoredSession = () => {
    const { storage, tokenKey, userKey } = getActiveStorage();
    if (!storage) return;
    storage.removeItem(tokenKey);
    storage.removeItem(userKey);
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
