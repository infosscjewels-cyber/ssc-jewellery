import { absoluteUrl, buildCanonical, firstCategoryName, getProductImageCandidates, normalizeText } from './helpers.js';
import { SITE_DESCRIPTION, SITE_NAME } from './constants.js';
import { BRAND_LOGO_URL } from '../utils/branding.js';

const buildPostalAddress = (company = {}) => {
    const address = normalizeText(company.address);
    const city = normalizeText(company.city);
    const state = normalizeText(company.state);
    const postalCode = normalizeText(company.postalCode);
    const country = normalizeText(company.country);
    if (!address && !city && !state && !postalCode && !country) return null;
    return {
        '@type': 'PostalAddress',
        ...(address ? { streetAddress: address } : {}),
        ...(city ? { addressLocality: city } : {}),
        ...(state ? { addressRegion: state } : {}),
        ...(postalCode ? { postalCode } : {}),
        ...(country ? { addressCountry: country } : {})
    };
};

export const buildOrganizationSchema = (company = {}) => {
    const name = normalizeText(company.displayName) || SITE_NAME;
    const logo = absoluteUrl(BRAND_LOGO_URL);
    const sameAs = [
        company.instagramUrl,
        company.youtubeUrl,
        company.facebookUrl
    ].map((value) => normalizeText(value)).filter(Boolean);
    const contactPoint = [];
    if (normalizeText(company.supportEmail)) {
        contactPoint.push({
            '@type': 'ContactPoint',
            contactType: 'customer support',
            email: normalizeText(company.supportEmail)
        });
    }
    if (normalizeText(company.contactNumber)) {
        contactPoint.push({
            '@type': 'ContactPoint',
            contactType: 'customer support',
            telephone: normalizeText(company.contactNumber)
        });
    }
    return {
        '@context': 'https://schema.org',
        '@type': 'Organization',
        name,
        url: buildCanonical('/'),
        logo,
        ...(sameAs.length ? { sameAs } : {}),
        ...(contactPoint.length ? { contactPoint } : {})
    };
};

export const buildLocalBusinessSchema = (company = {}) => {
    const name = normalizeText(company.displayName) || SITE_NAME;
    const logo = absoluteUrl(BRAND_LOGO_URL);
    const image = absoluteUrl(company.contactJumbotronImageUrl || company.logoUrl || '/contact.jpg');
    const sameAs = [
        company.instagramUrl,
        company.youtubeUrl,
        company.facebookUrl
    ].map((value) => normalizeText(value)).filter(Boolean);
    const postalAddress = buildPostalAddress(company);
    const latitude = Number(company.latitude);
    const longitude = Number(company.longitude);

    return {
        '@context': 'https://schema.org',
        '@type': 'JewelryStore',
        name,
        url: buildCanonical('/'),
        logo,
        image,
        ...(normalizeText(company.contactNumber) ? { telephone: normalizeText(company.contactNumber) } : {}),
        ...(normalizeText(company.supportEmail) ? { email: normalizeText(company.supportEmail) } : {}),
        ...(postalAddress ? { address: postalAddress } : {}),
        ...(normalizeText(company.openingHours) ? { openingHours: normalizeText(company.openingHours) } : {}),
        ...(Number.isFinite(latitude) && Number.isFinite(longitude) ? {
            geo: {
                '@type': 'GeoCoordinates',
                latitude,
                longitude
            }
        } : {}),
        ...(sameAs.length ? { sameAs } : {})
    };
};

export const buildWebsiteSchema = ({ includeSearchAction = false } = {}) => ({
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    url: buildCanonical('/'),
    description: SITE_DESCRIPTION,
    ...(includeSearchAction
        ? {
            potentialAction: {
                '@type': 'SearchAction',
                target: `${buildCanonical('/shop')}?q={search_term_string}`,
                'query-input': 'required name=search_term_string'
            }
        }
        : {})
});

export const buildWebPageSchema = ({
    name = '',
    description = '',
    path = '/',
    about = null
} = {}) => ({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: normalizeText(name) || undefined,
    description: normalizeText(description) || undefined,
    url: buildCanonical(path),
    ...(about ? { about } : {})
});

export const buildSiteNavigationSchema = (items = []) => ({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Site navigation',
    itemListElement: (Array.isArray(items) ? items : [])
        .filter((item) => item?.name && item?.url)
        .map((item, index) => ({
            '@type': 'SiteNavigationElement',
            position: index + 1,
            name: item.name,
            url: absoluteUrl(item.url)
        }))
});

export const buildBreadcrumbSchema = (items = []) => ({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: (Array.isArray(items) ? items : [])
        .filter((item) => item?.name && item?.url)
        .map((item, index) => ({
            '@type': 'ListItem',
            position: index + 1,
            name: item.name,
            item: absoluteUrl(item.url)
        }))
});

export const buildCreativePartnerSchema = ({
    name = 'Creativecodz',
    url = 'https://creativecodz.com/',
    sameAs = ['https://www.instagram.com/creativecodz']
} = {}) => ({
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: normalizeText(name) || 'Creativecodz',
    url: normalizeText(url) || 'https://creativecodz.com/',
    sameAs: (Array.isArray(sameAs) ? sameAs : []).map((value) => normalizeText(value)).filter(Boolean)
});

export const buildItemListSchema = (products = [], { name = '' } = {}) => ({
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: normalizeText(name) || undefined,
    itemListElement: (Array.isArray(products) ? products : []).slice(0, 10).map((product, index) => {
        const image = getProductImageCandidates(product)[0];
        return {
            '@type': 'ListItem',
            position: index + 1,
            url: buildCanonical(`/product/${product.id}`),
            name: normalizeText(product?.title) || undefined,
            image: image ? absoluteUrl(image) : undefined
        };
    })
});

export const buildFaqSchema = (items = []) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: (Array.isArray(items) ? items : [])
        .filter((item) => item?.question && item?.answer)
        .map((item) => ({
            '@type': 'Question',
            name: item.question,
            acceptedAnswer: {
                '@type': 'Answer',
                text: item.answer
            }
        }))
});

export const buildProductSchema = (product = null) => {
    if (!product || !product.id) return null;
    const title = normalizeText(product.title) || 'Product';
    const description = normalizeText(product.description)
        || `${title}${product.subtitle ? ` - ${normalizeText(product.subtitle)}` : ''} from ${SITE_NAME}.`;
    const images = getProductImageCandidates(product).map((url) => absoluteUrl(url));
    const category = firstCategoryName(product.categories);
    const variantPrices = (Array.isArray(product.variants) ? product.variants : [])
        .map((variant) => Number(variant.discount_price || variant.price || 0))
        .filter((value) => Number.isFinite(value) && value > 0);
    const displayPrice = variantPrices.length
        ? Math.min(...variantPrices)
        : Number(product.discount_price || product.mrp || 0);
    const isAvailable = (() => {
        const variants = Array.isArray(product.variants) ? product.variants : [];
        if (variants.length > 0) {
            return variants.some((variant) => {
                const tracked = variant.track_quantity === 1 || variant.track_quantity === true || variant.track_quantity === '1' || variant.track_quantity === 'true';
                return !tracked || Number(variant.available_quantity ?? variant.quantity ?? 0) > 0;
            });
        }
        const tracked = product.track_quantity === 1 || product.track_quantity === true || product.track_quantity === '1' || product.track_quantity === 'true';
        return !tracked || Number(product.available_quantity ?? product.quantity ?? 0) > 0;
    })();

    return {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: title,
        description,
        image: images.length ? images : [absoluteUrl('/placeholder_banner.jpg')],
        brand: {
            '@type': 'Brand',
            name: SITE_NAME
        },
        sku: normalizeText(product.sku) || undefined,
        category: category || undefined,
        offers: {
            '@type': 'Offer',
            priceCurrency: 'INR',
            price: Number.isFinite(displayPrice) ? displayPrice.toFixed(2) : '0.00',
            availability: isAvailable ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
            url: buildCanonical(`/product/${product.id}`)
        }
    };
};
