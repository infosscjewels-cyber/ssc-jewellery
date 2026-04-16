export const ADMIN_MOBILE_PREVIOUS_PAGE_KEY = 'admin_mobile_previous_page_v1';

const TRACKED_ADMIN_PAGE_TABS = new Set([
    'dashboard',
    'orders',
    'products',
    'categories',
    'customers',
    'abandoned'
]);

export const isTrackedAdminMobilePageTab = (value = '') => TRACKED_ADMIN_PAGE_TABS.has(String(value || '').trim());

export const readPreviousAdminMobilePageTab = () => {
    if (typeof window === 'undefined') return '';
    const raw = String(window.localStorage.getItem(ADMIN_MOBILE_PREVIOUS_PAGE_KEY) || '').trim();
    return isTrackedAdminMobilePageTab(raw) ? raw : '';
};

export const writePreviousAdminMobilePageTab = (value = '') => {
    if (typeof window === 'undefined') return;
    const next = String(value || '').trim();
    if (!isTrackedAdminMobilePageTab(next)) return;
    window.localStorage.setItem(ADMIN_MOBILE_PREVIOUS_PAGE_KEY, next);
};

