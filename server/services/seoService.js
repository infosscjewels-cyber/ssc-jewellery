const fs = require('fs');
const path = require('path');
const db = require('../config/db');
const CompanyProfile = require('../models/CompanyProfile');
const Product = require('../models/Product');
const { pathToFileURL } = require('url');

const STATIC_ROUTE_PATHS = [
    '/',
    '/shop',
    '/about',
    '/site-credits',
    '/sitemap',
    '/faq',
    '/contact',
    '/terms',
    '/shipping',
    '/refund',
    '/privacy',
    '/copyright'
];

const ROBOTS_INDEX = 'index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1';
const ROBOTS_NOINDEX = 'noindex,nofollow';
const DEFAULT_TITLE = 'SSC Jewellery';
const DEFAULT_DESCRIPTION = 'Shop imitation and fashion jewellery online at SSC Jewellery. Discover best sellers, new arrivals, category collections, and current offers.';
const DEFAULT_IMAGE = '/placeholder_banner.jpg';

const state = {
    initialized: false,
    queue: Promise.resolve(),
    rulesModule: null,
    templateHtml: null,
    sitemapEntries: null,
    sitemapLoadedAt: null
};

const CLIENT_PUBLIC_ROOT = path.resolve(__dirname, '../../client/public');

const parseJsonSafe = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const normalizeText = (value = '') => String(value || '').trim();

const normalizeBaseUrl = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const getBaseUrl = () => normalizeBaseUrl(
    process.env.APP_BASE_URL
    || process.env.CLIENT_BASE_URL
    || process.env.FRONTEND_URL
    || ''
);

const absoluteUrl = (pathname = '/', baseUrlOverride = '') => {
    const baseUrl = normalizeBaseUrl(baseUrlOverride) || getBaseUrl();
    const normalizedPath = String(pathname || '/').startsWith('/') ? String(pathname || '/') : `/${pathname}`;
    return baseUrl ? `${baseUrl}${normalizedPath}` : normalizedPath;
};

const absolutizeMaybeRelativeUrl = (value = '', baseUrlOverride = '') => {
    const raw = normalizeText(value);
    if (!raw) return raw;
    if (/^https?:\/\//i.test(raw)) return raw;
    return absoluteUrl(raw, baseUrlOverride);
};

const escapeXml = (value = '') => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const escapeHtml = (value = '') => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const getSeoArtifactsRoot = () => {
    const configuredRoot = String(process.env.SEO_ARTIFACTS_ROOT || '').trim();
    if (configuredRoot) {
        if (path.isAbsolute(configuredRoot) && (configuredRoot === '/public' || configuredRoot.startsWith('/public/'))) {
            return path.resolve(CLIENT_PUBLIC_ROOT, `.${configuredRoot.replace(/^\/public/, '')}`);
        }
        return path.resolve(configuredRoot);
    }
    return path.resolve(__dirname, '../../.cache/seo-artifacts');
};

const ensureSeoArtifactsRoot = async () => {
    await fs.promises.mkdir(getSeoArtifactsRoot(), { recursive: true });
    return getSeoArtifactsRoot();
};

const artifactPathForRoute = (routePath = '/') => {
    const normalized = String(routePath || '/').replace(/^\/+/, '') || 'root';
    const safeName = encodeURIComponent(normalized).replace(/%/g, '_');
    return path.join(getSeoArtifactsRoot(), `${safeName}.json`);
};

const loadSeoRules = async () => {
    if (state.rulesModule) return state.rulesModule;
    const rulesPath = path.resolve(__dirname, '../../client/src/seo/rules.js');
    state.rulesModule = await import(pathToFileURL(rulesPath).href);
    return state.rulesModule;
};

const loadTemplateHtml = async () => {
    if (state.templateHtml) return state.templateHtml;
    const templatePath = path.resolve(__dirname, '../../client/dist/index.html');
    state.templateHtml = await fs.promises.readFile(templatePath, 'utf8');
    return state.templateHtml;
};

const renderSeoHead = (seo = {}) => {
    const jsonLd = (seo.structuredData || [])
        .filter(Boolean)
        .map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`)
        .join('\n');

    return [
        `<title>${escapeHtml(seo.title || DEFAULT_TITLE)}</title>`,
        `<meta name="description" content="${escapeHtml(seo.description || DEFAULT_DESCRIPTION)}">`,
        `<meta name="keywords" content="${escapeHtml(seo.keywords || '')}">`,
        `<meta name="robots" content="${escapeHtml(seo.robots || ROBOTS_INDEX)}">`,
        `<link rel="canonical" href="${escapeHtml(seo.canonical || absoluteUrl('/'))}">`,
        `<meta property="og:type" content="${escapeHtml(seo.ogType || 'website')}">`,
        `<meta property="og:site_name" content="${escapeHtml(seo.siteName || DEFAULT_TITLE)}">`,
        `<meta property="og:title" content="${escapeHtml(seo.ogTitle || seo.title || DEFAULT_TITLE)}">`,
        `<meta property="og:description" content="${escapeHtml(seo.ogDescription || seo.description || DEFAULT_DESCRIPTION)}">`,
        `<meta property="og:url" content="${escapeHtml(seo.canonical || absoluteUrl('/'))}">`,
        `<meta property="og:image" content="${escapeHtml(seo.image || absoluteUrl(DEFAULT_IMAGE))}">`,
        `<meta name="twitter:card" content="${escapeHtml(seo.twitterCard || 'summary_large_image')}">`,
        `<meta name="twitter:title" content="${escapeHtml(seo.twitterTitle || seo.title || DEFAULT_TITLE)}">`,
        `<meta name="twitter:description" content="${escapeHtml(seo.twitterDescription || seo.description || DEFAULT_DESCRIPTION)}">`,
        `<meta name="twitter:image" content="${escapeHtml(seo.image || absoluteUrl(DEFAULT_IMAGE))}">`,
        jsonLd
    ].filter(Boolean).join('\n');
};

const injectSeo = (templateHtml, seo) => {
    const stripped = String(templateHtml || '')
        .replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace(/<meta[^>]+(?:name|property)=["'](?:description|keywords|robots|twitter:[^"']+|og:[^"']+)["'][^>]*>\s*/gi, '')
        .replace(/<link[^>]+rel=["']canonical["'][^>]*>\s*/gi, '')
        .replace(/<script type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
    return stripped.replace('</head>', `${renderSeoHead(seo)}\n</head>`);
};

const buildRobotsTxt = (baseUrlOverride = '') => [
    'User-agent: *',
    'Allow: /',
    'Disallow: /admin',
    'Disallow: /login',
    'Disallow: /register',
    'Disallow: /forgot-password',
    'Disallow: /profile',
    'Disallow: /wishlist',
    'Disallow: /orders',
    'Disallow: /track-order',
    'Disallow: /cart',
    'Disallow: /checkout',
    'Disallow: /payment/success',
    'Disallow: /payment/failed',
    '',
    `Sitemap: ${absoluteUrl('/sitemap.xml', baseUrlOverride)}`,
    ''
].join('\n');

const buildSitemapXml = (entries = [], baseUrlOverride = '') => {
    const urls = entries.map(({ loc, lastmod }) => [
        '  <url>',
        `    <loc>${escapeXml(absolutizeMaybeRelativeUrl(loc, baseUrlOverride))}</loc>`,
        lastmod ? `    <lastmod>${escapeXml(lastmod)}</lastmod>` : null,
        '  </url>'
    ].filter(Boolean).join('\n')).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

const normalizeProductForSeo = (product = {}) => ({
    ...product,
    media: parseJsonSafe(product.media, []),
    categories: parseJsonSafe(product.categories, []),
    related_products: parseJsonSafe(product.related_products, {}),
    additional_info: parseJsonSafe(product.additional_info, []),
    options: parseJsonSafe(product.options, []),
    variants: Array.isArray(product.variants)
        ? product.variants.map((variant) => ({
            ...variant,
            variant_options: parseJsonSafe(variant.variant_options, {})
        }))
        : []
});

const buildFallbackSeo = async (pathname = '/') => {
    const rules = await loadSeoRules();
    const base = rules.buildDefaultSeo(pathname);

    if (pathname.startsWith('/product/')) {
        return {
            ...base,
            title: 'Product | SSC Jewellery',
            description: 'Product details are loading. Explore current jewellery collections at SSC Jewellery.',
            canonical: absoluteUrl(pathname),
            robots: ROBOTS_NOINDEX,
            structuredData: []
        };
    }

    if (pathname.startsWith('/shop/')) {
        return {
            ...base,
            title: 'Collection | SSC Jewellery',
            description: 'Collection details are loading. Explore jewellery collections at SSC Jewellery.',
            canonical: absoluteUrl(pathname),
            robots: ROBOTS_NOINDEX,
            structuredData: []
        };
    }

    return {
        ...base,
        canonical: absoluteUrl(pathname)
    };
};

const readArtifact = async (routePath = '/') => {
    try {
        const raw = await fs.promises.readFile(artifactPathForRoute(routePath), 'utf8');
        return JSON.parse(raw);
    } catch (error) {
        if (error?.code === 'ENOENT') return null;
        throw error;
    }
};

const writeArtifact = async (routePath = '/', seo = {}, metadata = {}) => {
    await ensureSeoArtifactsRoot();
    await fs.promises.writeFile(
        artifactPathForRoute(routePath),
        JSON.stringify({
            routePath,
            seo,
            metadata,
            generatedAt: new Date().toISOString()
        }, null, 2),
        'utf8'
    );
};

const removeArtifact = async (routePath = '/') => {
    try {
        await fs.promises.unlink(artifactPathForRoute(routePath));
    } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
    }
};

const parseCatalogRoute = (pathname = '') => {
    const cleanPath = String(pathname || '/').split('?')[0];
    if (STATIC_ROUTE_PATHS.includes(cleanPath)) {
        return { type: 'static', routePath: cleanPath };
    }

    const productMatch = cleanPath.match(/^\/product\/([^/]+)$/);
    if (productMatch) {
        return { type: 'product', routePath: cleanPath, id: decodeURIComponent(productMatch[1]) };
    }

    const categoryMatch = cleanPath.match(/^\/shop\/([^/]+)$/);
    if (categoryMatch) {
        return { type: 'category', routePath: cleanPath, name: decodeURIComponent(categoryMatch[1]) };
    }

    return null;
};

const fetchSharedSeoContext = async () => {
    const company = await CompanyProfile.get().catch(() => null);
    const [categoryRows] = await db.execute(
        `SELECT c.id, c.name, c.image_url, MAX(p.updated_at) AS lastmod
         FROM categories c
         JOIN product_categories pc ON pc.category_id = c.id
         JOIN products p ON p.id = pc.product_id
         WHERE LOWER(COALESCE(p.status, '')) = 'active'
         GROUP BY c.id, c.name, c.image_url
         HAVING COUNT(DISTINCT p.id) > 0
         ORDER BY c.name ASC`
    );
    const [productRows] = await db.execute(
        `SELECT id, title, subtitle, description, media, categories, mrp, discount_price, sku, track_quantity, quantity, updated_at
         FROM products
         WHERE LOWER(COALESCE(status, '')) = 'active'
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 24`
    );
    const [slideRows] = await db.execute(
        `SELECT image_url
         FROM hero_slides
         WHERE LOWER(COALESCE(status, 'active')) = 'active'
         ORDER BY display_order ASC, id ASC`
    ).catch(() => [[]]);
    const [bannerRows] = await db.execute(
        `SELECT image_url
         FROM cms_carousel_cards
         WHERE LOWER(COALESCE(status, 'active')) = 'active'
         ORDER BY display_order ASC, id ASC`
    ).catch(() => [[]]);

    return {
        company: company || {},
        categories: categoryRows || [],
        products: (productRows || []).map(normalizeProductForSeo),
        slides: slideRows || [],
        banners: bannerRows || []
    };
};

const fetchCategorySeoContextById = async (categoryId) => {
    const [rows] = await db.execute(
        `SELECT c.id, c.name, c.image_url, MAX(CASE WHEN LOWER(COALESCE(p.status, '')) = 'active' THEN p.updated_at ELSE NULL END) AS lastmod
         FROM categories c
         LEFT JOIN product_categories pc ON pc.category_id = c.id
         LEFT JOIN products p ON p.id = pc.product_id
         WHERE c.id = ?
         GROUP BY c.id, c.name, c.image_url
         LIMIT 1`,
        [categoryId]
    );
    const category = rows?.[0] || null;
    if (!category) return null;

    const [productRows] = await db.execute(
        `SELECT p.id, p.title, p.subtitle, p.description, p.media, p.categories, p.mrp, p.discount_price, p.sku, p.track_quantity, p.quantity, p.updated_at
         FROM products p
         JOIN product_categories pc ON pc.product_id = p.id
         WHERE pc.category_id = ?
           AND LOWER(COALESCE(p.status, '')) = 'active'
         ORDER BY p.updated_at DESC, p.created_at DESC
         LIMIT 24`,
        [categoryId]
    );

    return {
        category,
        products: (productRows || []).map(normalizeProductForSeo)
    };
};

const findCategoryByName = async (name = '') => {
    const normalized = normalizeText(name);
    if (!normalized) return null;
    const [rows] = await db.execute(
        `SELECT id, name
         FROM categories
         WHERE LOWER(name) = LOWER(?)
         LIMIT 1`,
        [normalized]
    );
    return rows?.[0] || null;
};

const regenerateStaticArtifacts = async () => {
    const rules = await loadSeoRules();
    const shared = await fetchSharedSeoContext();
    const byPath = {
        '/': rules.buildHomeSeo(shared),
        '/shop': rules.buildShopSeo(shared),
        '/about': rules.buildAboutSeo(shared),
        '/site-credits': rules.buildCreditsSeo(shared),
        '/sitemap': rules.buildSitemapPageSeo({
            company: shared.company,
            links: [
                ...STATIC_ROUTE_PATHS.filter((pathname) => pathname !== '/').map((pathname) => ({
                    name: pathname.replace(/^\//, '').replace(/-/g, ' ') || 'home',
                    url: pathname
                })),
                ...shared.categories.map((category) => ({
                    name: category.name,
                    url: `/shop/${encodeURIComponent(category.name)}`
                }))
            ]
        }),
        '/faq': rules.buildFaqSeo(shared),
        '/contact': rules.buildContactSeo(shared),
        '/terms': rules.buildPolicySeo({ company: shared.company, policyKey: 'terms', policyTitle: 'Terms & Conditions' }),
        '/shipping': rules.buildPolicySeo({ company: shared.company, policyKey: 'shipping', policyTitle: 'Shipping Policy' }),
        '/refund': rules.buildPolicySeo({ company: shared.company, policyKey: 'refund', policyTitle: 'Cancellation & Refund Policy' }),
        '/privacy': rules.buildPolicySeo({ company: shared.company, policyKey: 'privacy', policyTitle: 'Privacy Policy' }),
        '/copyright': rules.buildPolicySeo({ company: shared.company, policyKey: 'copyright', policyTitle: 'Copyright & Legal Disclaimer' })
    };

    await Promise.all(Object.entries(byPath).map(([routePath, seo]) => writeArtifact(routePath, seo, { type: 'static' })));
};

const regenerateProductArtifact = async (productId) => {
    const normalizedId = normalizeText(productId);
    if (!normalizedId) return;
    const product = await Product.findById(normalizedId).catch(() => null);
    const routePath = `/product/${encodeURIComponent(normalizedId)}`;

    if (!product || String(product.status || '').toLowerCase() !== 'active') {
        await removeArtifact(routePath);
        return;
    }

    const rules = await loadSeoRules();
    const company = await CompanyProfile.get().catch(() => ({}));
    const seo = rules.buildProductSeo({
        company,
        product: normalizeProductForSeo(product)
    });
    await writeArtifact(routePath, seo, {
        type: 'product',
        productId: normalizedId,
        lastmod: String(product.updated_at || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    });
};

const regenerateCategoryArtifactById = async (categoryId) => {
    const categoryContext = await fetchCategorySeoContextById(categoryId);
    if (!categoryContext?.category?.name) return;

    const company = await CompanyProfile.get().catch(() => ({}));
    const rules = await loadSeoRules();
    const routePath = `/shop/${encodeURIComponent(categoryContext.category.name)}`;
    const seo = rules.buildCategorySeo({
        company,
        category: categoryContext.category,
        products: categoryContext.products
    });

    if (!categoryContext.products.length) {
        seo.robots = ROBOTS_NOINDEX;
        seo.structuredData = [];
    }

    await writeArtifact(routePath, seo, {
        type: 'category',
        categoryId: categoryContext.category.id,
        lastmod: String(categoryContext.category.lastmod || '').slice(0, 10) || new Date().toISOString().slice(0, 10)
    });
};

const regenerateCategoryArtifactByName = async (categoryName) => {
    const category = await findCategoryByName(categoryName);
    if (!category?.id) {
        await removeArtifact(`/shop/${encodeURIComponent(normalizeText(categoryName))}`);
        return;
    }
    await regenerateCategoryArtifactById(category.id);
};

const refreshSitemapCache = async () => {
    const today = new Date().toISOString().slice(0, 10);
    const entries = STATIC_ROUTE_PATHS.map((pathname) => ({
        loc: absoluteUrl(pathname),
        lastmod: today
    }));

    const [categoryRows] = await db.execute(
        `SELECT c.name, MAX(p.updated_at) AS lastmod
         FROM categories c
         JOIN product_categories pc ON pc.category_id = c.id
         JOIN products p ON p.id = pc.product_id
         WHERE LOWER(COALESCE(p.status, '')) = 'active'
         GROUP BY c.id, c.name
         HAVING COUNT(DISTINCT p.id) > 0
         ORDER BY c.name ASC`
    );
    const [productRows] = await db.execute(
        `SELECT id, updated_at
         FROM products
         WHERE LOWER(COALESCE(status, '')) = 'active'
         ORDER BY updated_at DESC, created_at DESC`
    );

    categoryRows.forEach((row) => {
        const categoryName = normalizeText(row.name);
        if (!categoryName) return;
        entries.push({
            loc: absoluteUrl(`/shop/${encodeURIComponent(categoryName)}`),
            lastmod: String(row.lastmod || '').slice(0, 10) || today
        });
    });

    productRows.forEach((row) => {
        const productId = normalizeText(row.id);
        if (!productId) return;
        entries.push({
            loc: absoluteUrl(`/product/${encodeURIComponent(productId)}`),
            lastmod: String(row.updated_at || '').slice(0, 10) || today
        });
    });

    state.sitemapEntries = entries;
    state.sitemapLoadedAt = new Date().toISOString();
    return entries;
};

const loadSitemapEntries = async () => {
    if (state.sitemapEntries?.length) return state.sitemapEntries;
    return refreshSitemapCache();
};

const scheduleTask = (label, task) => {
    if (!state.initialized) return;
    state.queue = state.queue
        .then(async () => {
            try {
                await task();
            } catch (error) {
                console.error(`SEO task failed (${label}):`, error?.message || error);
            }
        })
        .catch((error) => {
            console.error(`SEO queue failure (${label}):`, error?.message || error);
        });
};

const queueStaticRefresh = (reason = 'manual') => {
    scheduleTask(`static:${reason}`, async () => {
        await regenerateStaticArtifacts();
        await refreshSitemapCache();
    });
};

const queueFullRefresh = (reason = 'manual') => {
    scheduleTask(`full:${reason}`, async () => {
        await regenerateStaticArtifacts();
        const [productRows] = await db.execute(
            `SELECT id
             FROM products
             WHERE LOWER(COALESCE(status, '')) = 'active'
             ORDER BY updated_at DESC, created_at DESC`
        );
        const [categoryRows] = await db.execute(
            `SELECT DISTINCT c.id
             FROM categories c
             JOIN product_categories pc ON pc.category_id = c.id
             JOIN products p ON p.id = pc.product_id
             WHERE LOWER(COALESCE(p.status, '')) = 'active'
             ORDER BY c.id ASC`
        );
        for (const row of productRows || []) {
            await regenerateProductArtifact(row.id);
        }
        for (const row of categoryRows || []) {
            await regenerateCategoryArtifactById(row.id);
        }
        await refreshSitemapCache();
    });
};

const queueProductRefresh = ({ productId, categoryNames = [], refreshStatic = true, reason = 'product_change' } = {}) => {
    const normalizedId = normalizeText(productId);
    const normalizedCategoryNames = [...new Set((categoryNames || []).map(normalizeText).filter(Boolean))];

    scheduleTask(`product:${reason}:${normalizedId}`, async () => {
        if (normalizedId) {
            await regenerateProductArtifact(normalizedId);
        }
        for (const categoryName of normalizedCategoryNames) {
            await regenerateCategoryArtifactByName(categoryName);
        }
        if (refreshStatic) {
            await regenerateStaticArtifacts();
        }
        await refreshSitemapCache();
    });
};

const queueProductDelete = ({ productId, categoryNames = [], refreshStatic = true, reason = 'product_delete' } = {}) => {
    const normalizedId = normalizeText(productId);
    const routePath = normalizedId ? `/product/${encodeURIComponent(normalizedId)}` : '';
    const normalizedCategoryNames = [...new Set((categoryNames || []).map(normalizeText).filter(Boolean))];

    scheduleTask(`product-delete:${reason}:${normalizedId}`, async () => {
        if (routePath) await removeArtifact(routePath);
        for (const categoryName of normalizedCategoryNames) {
            await regenerateCategoryArtifactByName(categoryName);
        }
        if (refreshStatic) {
            await regenerateStaticArtifacts();
        }
        await refreshSitemapCache();
    });
};

const queueCategoryRefresh = ({
    categoryId = null,
    categoryName = '',
    previousCategoryName = '',
    affectedProductIds = [],
    refreshStatic = true,
    reason = 'category_change'
} = {}) => {
    const normalizedCategoryName = normalizeText(categoryName);
    const normalizedPreviousName = normalizeText(previousCategoryName);
    const productIds = [...new Set((affectedProductIds || []).map(normalizeText).filter(Boolean))];

    scheduleTask(`category:${reason}:${categoryId || normalizedCategoryName}`, async () => {
        if (normalizedPreviousName && normalizedPreviousName.toLowerCase() !== normalizedCategoryName.toLowerCase()) {
            await removeArtifact(`/shop/${encodeURIComponent(normalizedPreviousName)}`);
        }
        if (categoryId) {
            await regenerateCategoryArtifactById(categoryId);
        } else if (normalizedCategoryName) {
            await regenerateCategoryArtifactByName(normalizedCategoryName);
        }
        for (const productId of productIds) {
            await regenerateProductArtifact(productId);
        }
        if (refreshStatic) {
            await regenerateStaticArtifacts();
        }
        await refreshSitemapCache();
    });
};

const queueCategoryDelete = ({
    categoryId = null,
    categoryName = '',
    affectedProductIds = [],
    refreshStatic = true,
    reason = 'category_delete'
} = {}) => {
    const normalizedCategoryName = normalizeText(categoryName);
    const productIds = [...new Set((affectedProductIds || []).map(normalizeText).filter(Boolean))];

    scheduleTask(`category-delete:${reason}:${categoryId || normalizedCategoryName}`, async () => {
        if (normalizedCategoryName) {
            await removeArtifact(`/shop/${encodeURIComponent(normalizedCategoryName)}`);
        }
        for (const productId of productIds) {
            await regenerateProductArtifact(productId);
        }
        if (refreshStatic) {
            await regenerateStaticArtifacts();
        }
        await refreshSitemapCache();
    });
};

const shouldWarmOnBoot = () => {
    const raw = String(process.env.SEO_WARM_ON_BOOT || 'true').trim().toLowerCase();
    return !['false', '0', 'no', 'off'].includes(raw);
};

const initSeoAutomation = async () => {
    if (state.initialized) return;
    await ensureSeoArtifactsRoot();
    await loadSeoRules();
    await loadTemplateHtml();
    state.initialized = true;
    console.log('SEO: automation initialized');
    if (shouldWarmOnBoot()) {
        queueFullRefresh('startup');
    } else {
        scheduleTask('sitemap:startup', refreshSitemapCache);
        queueStaticRefresh('startup-static');
    }
};

const renderRouteHtml = async (pathname = '/') => {
    const match = parseCatalogRoute(pathname);
    if (!match) return null;

    const templateHtml = await loadTemplateHtml();
    const artifact = await readArtifact(match.routePath);
    if (artifact?.seo) {
        return injectSeo(templateHtml, artifact.seo);
    }

    if (state.initialized) {
        if (match.type === 'product') {
            queueProductRefresh({ productId: match.id, refreshStatic: false, reason: 'request_miss' });
        } else if (match.type === 'category') {
            queueCategoryRefresh({ categoryName: match.name, refreshStatic: false, reason: 'request_miss' });
        } else if (match.type === 'static') {
            queueStaticRefresh('request_miss');
        }
    }

    const fallbackSeo = await buildFallbackSeo(match.routePath);
    return injectSeo(templateHtml, fallbackSeo);
};

module.exports = {
    initSeoAutomation,
    renderRouteHtml,
    queueStaticRefresh,
    queueFullRefresh,
    queueProductRefresh,
    queueProductDelete,
    queueCategoryRefresh,
    queueCategoryDelete,
    buildRobotsTxt,
    buildSitemapXml,
    loadSitemapEntries,
    __test: {
        parseCatalogRoute,
        buildFallbackSeo,
        renderSeoHead,
        injectSeo,
        getSeoArtifactsRoot,
        artifactPathForRoute
    }
};
