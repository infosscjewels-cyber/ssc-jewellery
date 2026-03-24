export const BRAND_LOGO_URL = '/branding/logo.webp';
export const BRAND_FAVICON_URL = '/favicon.ico';
export const BRAND_APPLE_TOUCH_ICON_URL = '/apple-touch-icon.png';

export const buildBrandAssetUrl = (baseUrl, version = '') => {
    const base = String(baseUrl || '').trim();
    if (!base) return '';
    const token = String(version || '').trim();
    if (!token) return base;
    const separator = base.includes('?') ? '&' : '?';
    return `${base}${separator}v=${encodeURIComponent(token)}`;
};
