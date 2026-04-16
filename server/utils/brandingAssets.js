const path = require('path');
const CompanyProfile = require('../models/CompanyProfile');
const { resolvePublicAssetPath } = require('./publicAssetResolver');

const BRANDING_FALLBACKS = {
    logo: ['/logo.webp', '/assets/logo.webp', '/logo_light.webp', '/assets/logo_light.webp'],
    favicon: ['/favicon.ico', '/favicon-48x48.png', '/favicon-96x96.png', '/favicon-192x192.png'],
    appleTouchIcon: ['/apple-touch-icon.png', '/favicon-192x192.png', '/logo.webp', '/assets/logo.webp']
};

const BRANDING_FIELD_MAP = {
    logo: 'logoUrl',
    favicon: 'faviconUrl',
    appleTouchIcon: 'appleTouchIconUrl'
};

const isRemoteUrl = (value = '') => /^https?:\/\//i.test(String(value || '').trim());

const findFallbackPath = (kind = 'logo') => {
    const candidates = BRANDING_FALLBACKS[kind] || [];
    for (const candidate of candidates) {
        const resolved = resolvePublicAssetPath(candidate);
        if (resolved) return resolved;
    }
    return null;
};

const resolveBrandingAsset = async (kind = 'logo') => {
    const field = BRANDING_FIELD_MAP[kind] || BRANDING_FIELD_MAP.logo;
    const company = await CompanyProfile.get().catch(() => null);
    const configured = String(company?.[field] || '').trim();

    if (configured) {
        if (isRemoteUrl(configured)) {
            return { mode: 'redirect', target: configured };
        }
        const localPath = resolvePublicAssetPath(configured);
        if (localPath) {
            return { mode: 'file', target: localPath };
        }
    }

    const fallbackPath = findFallbackPath(kind);
    if (fallbackPath) {
        return { mode: 'file', target: fallbackPath };
    }

    return {
        mode: 'file',
        target: path.resolve(__dirname, '../../client/public/logo.webp')
    };
};

module.exports = {
    resolveBrandingAsset
};
