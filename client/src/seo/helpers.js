/* global __APP_BASE_URL__ */
import { DEFAULT_SOCIAL_IMAGE, SITE_DESCRIPTION, SITE_NAME } from './constants.js';

const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

export const getBaseUrl = () => {
    const configuredBaseUrl = normalizeBaseUrl(
        (typeof __APP_BASE_URL__ !== 'undefined' && __APP_BASE_URL__)
        || globalThis?.process?.env?.APP_BASE_URL
        || globalThis?.process?.env?.PUBLIC_BASE_URL
        || globalThis?.process?.env?.APP_URL
        || globalThis?.process?.env?.URL
        || ''
    );
    if (configuredBaseUrl) return configuredBaseUrl;
    if (typeof window !== 'undefined' && window.location?.origin) {
        return normalizeBaseUrl(window.location.origin);
    }
    return '';
};

export const absoluteUrl = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (/^https?:\/\//i.test(raw)) return raw;
    const baseUrl = getBaseUrl();
    if (!baseUrl) return raw.startsWith('/') ? raw : `/${raw}`;
    return raw.startsWith('/') ? `${baseUrl}${raw}` : `${baseUrl}/${raw}`;
};

export const normalizeText = (value = '') => String(value || '').trim();

export const uniqueList = (values = []) => {
    const seen = new Set();
    return (Array.isArray(values) ? values : [])
        .map((value) => normalizeText(value))
        .filter((value) => {
            if (!value) return false;
            const key = value.toLowerCase();
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
};

export const parseJsonSafe = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

export const asArray = (value) => {
    const parsed = parseJsonSafe(value, value);
    return Array.isArray(parsed) ? parsed : [];
};

export const normalizeCategories = (value) => {
    const raw = asArray(value);
    return raw
        .map((entry) => {
            if (typeof entry === 'string') return entry.trim();
            if (entry && typeof entry === 'object') {
                return normalizeText(entry.name || entry.label || entry.title);
            }
            return '';
        })
        .filter(Boolean);
};

export const extractMediaImages = (value) => {
    const items = asArray(value);
    return items
        .map((entry) => {
            if (typeof entry === 'string') return normalizeText(entry);
            if (!entry || typeof entry !== 'object') return '';
            if (normalizeText(entry.type).toLowerCase() === 'image') return normalizeText(entry.url);
            if (!entry.type && entry.url) return normalizeText(entry.url);
            return '';
        })
        .filter(Boolean);
};

export const getProductImageCandidates = (product = null) => {
    if (!product || typeof product !== 'object') return [];
    const images = extractMediaImages(product.media);
    const variantImages = asArray(product.variants)
        .map((variant) => normalizeText(variant?.image_url || variant?.imageUrl))
        .filter(Boolean);
    return uniqueList([...images, ...variantImages]);
};

export const getCategoryImage = (category = null) => {
    if (!category || typeof category !== 'object') return '';
    return normalizeText(category.image_url || category.imageUrl || category.image);
};

export const pickSocialImage = ({
    preferredImages = [],
    categoryImages = [],
    productImages = [],
    fallbackImage = DEFAULT_SOCIAL_IMAGE
} = {}) => {
    const all = uniqueList([
        ...(preferredImages || []),
        ...(categoryImages || []),
        ...(productImages || []),
        fallbackImage
    ]);
    return absoluteUrl(all[0] || fallbackImage || DEFAULT_SOCIAL_IMAGE);
};

export const toTitle = (value = '') => {
    const base = normalizeText(value) || SITE_NAME;
    return base.includes(SITE_NAME) ? base : `${base} | ${SITE_NAME}`;
};

export const clampDescription = (value = '', fallback = SITE_DESCRIPTION) => {
    const source = normalizeText(value) || fallback;
    if (source.length <= 170) return source;
    return `${source.slice(0, 167).trim()}...`;
};

export const formatCurrency = (value = 0) => {
    const amount = Number(value || 0);
    return `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
};

export const firstCategoryName = (value) => normalizeCategories(value)[0] || '';

export const buildKeywords = (...groups) => uniqueList(groups.flat()).slice(0, 20).join(', ');

export const buildCanonical = (pathname = '/') => {
    const baseUrl = getBaseUrl();
    const cleanPath = `/${String(pathname || '/').split('?')[0].replace(/^\/+/, '')}`.replace(/\/{2,}/g, '/');
    if (!baseUrl) return cleanPath;
    return cleanPath === '/' ? baseUrl : `${baseUrl}${cleanPath}`;
};

export const buildDefaultDescription = ({
    title = '',
    subtitle = '',
    category = '',
    price = null,
    extra = '',
    brand = SITE_NAME
} = {}) => {
    const titleText = normalizeText(title);
    const subtitleText = normalizeText(subtitle);
    const categoryText = normalizeText(category);
    const extraText = normalizeText(extra);
    const priceText = price != null && Number(price) > 0 ? `from ${formatCurrency(price)}` : '';
    const lead = titleText
        ? `Shop ${titleText}${subtitleText ? `, ${subtitleText}` : ''}${categoryText ? ` in ${categoryText}` : ''}`
        : `Shop jewellery${categoryText ? ` in ${categoryText}` : ''}`;
    const tail = uniqueList([
        priceText,
        extraText,
        `online at ${brand}`
    ]).join('. ');
    return clampDescription(`${lead}. ${tail}`.trim());
};
