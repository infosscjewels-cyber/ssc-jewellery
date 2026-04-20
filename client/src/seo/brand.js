import { SITE_NAME } from './constants.js';

export const LEGACY_BRAND_NAMES = new Set([
    'ssc jewels',
    'ssc jewellery',
    'ssc impon jewellery',
    'sri sai collections'
]);

export const normalizeBrandName = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const normalized = raw.toLowerCase().replace(/\s+/g, ' ');
    if (normalized === SITE_NAME.toLowerCase()) return SITE_NAME;
    if (LEGACY_BRAND_NAMES.has(normalized)) return SITE_NAME;
    return raw;
};

export const resolvePublicBrandName = (company = {}) => normalizeBrandName(company?.displayName) || SITE_NAME;
