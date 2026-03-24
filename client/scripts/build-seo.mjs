import fs from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

import { buildAboutSeo, buildCategorySeo, buildContactSeo, buildCreditsSeo, buildFaqSeo, buildHomeSeo, buildPolicySeo, buildProductSeo, buildShopSeo, buildSitemapPageSeo } from '../src/seo/rules.js';
import { absoluteUrl } from '../src/seo/helpers.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(clientRoot, '..');
const distDir = path.join(clientRoot, 'dist');

const loadEnv = () => {
    const nodeEnv = String(process.env.NODE_ENV || 'production').trim().toLowerCase();
    const candidates = nodeEnv === 'production'
        ? [path.join(projectRoot, '.env'), path.join(projectRoot, '.env.dev')]
        : [path.join(projectRoot, '.env.dev'), path.join(projectRoot, '.env')];
    candidates.forEach((candidate) => dotenv.config({ path: candidate, override: false }));
};

const parseJsonSafe = (value, fallback = null) => {
    if (value == null) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const escapeHtml = (value = '') => String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const renderSeoHead = (seo) => {
    const jsonLd = (seo.structuredData || [])
        .filter(Boolean)
        .map((item) => `<script type="application/ld+json">${JSON.stringify(item)}</script>`)
        .join('\n');
    return [
        `<title>${escapeHtml(seo.title)}</title>`,
        `<meta name="description" content="${escapeHtml(seo.description)}">`,
        `<meta name="keywords" content="${escapeHtml(seo.keywords || '')}">`,
        `<meta name="robots" content="${escapeHtml(seo.robots || 'index,follow')}">`,
        `<link rel="canonical" href="${escapeHtml(seo.canonical)}">`,
        `<meta property="og:type" content="${escapeHtml(seo.ogType || 'website')}">`,
        `<meta property="og:site_name" content="SSC Jewellery">`,
        `<meta property="og:title" content="${escapeHtml(seo.ogTitle || seo.title)}">`,
        `<meta property="og:description" content="${escapeHtml(seo.ogDescription || seo.description)}">`,
        `<meta property="og:url" content="${escapeHtml(seo.canonical)}">`,
        `<meta property="og:image" content="${escapeHtml(absoluteUrl(seo.image))}">`,
        `<meta name="twitter:card" content="${escapeHtml(seo.twitterCard || 'summary_large_image')}">`,
        `<meta name="twitter:title" content="${escapeHtml(seo.twitterTitle || seo.title)}">`,
        `<meta name="twitter:description" content="${escapeHtml(seo.twitterDescription || seo.description)}">`,
        `<meta name="twitter:image" content="${escapeHtml(absoluteUrl(seo.image))}">`,
        jsonLd
    ].filter(Boolean).join('\n');
};

const injectSeo = (templateHtml, seo) => {
    const stripped = templateHtml
        .replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace(/<meta[^>]+(?:name|property)=["'](?:description|keywords|robots|twitter:[^"']+|og:[^"']+)["'][^>]*>\s*/gi, '')
        .replace(/<link[^>]+rel=["']canonical["'][^>]*>\s*/gi, '')
        .replace(/<script type=["']application\/ld\+json["'][^>]*>[\s\S]*?<\/script>\s*/gi, '');
    return stripped.replace('</head>', `${renderSeoHead(seo)}\n</head>`);
};

const writeRouteHtml = async (routePath, html) => {
    const cleaned = String(routePath || '/').replace(/^\/+/, '');
    const targetFile = cleaned ? path.join(distDir, cleaned, 'index.html') : path.join(distDir, 'index.html');
    await fs.mkdir(path.dirname(targetFile), { recursive: true });
    await fs.writeFile(targetFile, html, 'utf8');
};

const buildSitemapXml = (entries = []) => {
    const urls = entries.map(({ loc, lastmod }) => [
        '  <url>',
        `    <loc>${escapeHtml(loc)}</loc>`,
        lastmod ? `    <lastmod>${escapeHtml(lastmod)}</lastmod>` : null,
        '  </url>'
    ].filter(Boolean).join('\n')).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
};

const buildRobotsTxt = (sitemapUrl = '') => [
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
    sitemapUrl ? `Sitemap: ${sitemapUrl}` : null,
    ''
].filter((line) => line !== null).join('\n');

const buildRouteEntries = ({ company, categories, products }) => {
    const today = new Date().toISOString().slice(0, 10);
    const staticPages = [
        { path: '/', seo: buildHomeSeo({ company, categories, products: products.slice(0, 12) }), lastmod: today },
        { path: '/shop', seo: buildShopSeo({ company, categories, products: products.slice(0, 20) }), lastmod: today },
        { path: '/about', seo: buildAboutSeo({ company, categories, products: products.slice(0, 8) }), lastmod: today },
        { path: '/site-credits', seo: buildCreditsSeo({ company }), lastmod: today },
        { path: '/sitemap', seo: buildSitemapPageSeo({ company, links: categories.map((category) => ({ name: category.name, url: `/shop/${category.name}` })) }), lastmod: today },
        { path: '/faq', seo: buildFaqSeo({ company }), lastmod: today },
        { path: '/contact', seo: buildContactSeo({ company }), lastmod: today },
        { path: '/terms', seo: buildPolicySeo({ company, policyKey: 'terms', policyTitle: 'Terms & Conditions' }), lastmod: today },
        { path: '/shipping', seo: buildPolicySeo({ company, policyKey: 'shipping', policyTitle: 'Shipping Policy' }), lastmod: today },
        { path: '/refund', seo: buildPolicySeo({ company, policyKey: 'refund', policyTitle: 'Cancellation & Refund Policy' }), lastmod: today },
        { path: '/privacy', seo: buildPolicySeo({ company, policyKey: 'privacy', policyTitle: 'Privacy Policy' }), lastmod: today },
        { path: '/copyright', seo: buildPolicySeo({ company, policyKey: 'copyright', policyTitle: 'Copyright & Legal Disclaimer' }), lastmod: today }
    ];

    const categoryPages = categories.map((category) => {
        const categoryProducts = products.filter((product) => {
            const names = Array.isArray(product.categories) ? product.categories : [];
            return names.some((entry) => String(entry || '').trim().toLowerCase() === String(category.name || '').trim().toLowerCase());
        });
        return {
            path: `/shop/${category.name}`,
            seo: buildCategorySeo({ company, category, products: categoryProducts.slice(0, 12) }),
            lastmod: String(category.lastmod || '').slice(0, 10) || today
        };
    });

    const productPages = products.map((product) => ({
        path: `/product/${product.id}`,
        seo: buildProductSeo({ company, product }),
        lastmod: String(product.updated_at || '').slice(0, 10) || today
    }));

    return [...staticPages, ...categoryPages, ...productPages];
};

const run = async () => {
    loadEnv();
    const templateHtml = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
    const data = {
        company: { displayName: 'SSC Jewellery', contactJumbotronImageUrl: '/assets/contact.jpg' },
        categories: [],
        products: []
    };

    const routes = buildRouteEntries(data);
    for (const route of routes) {
        await writeRouteHtml(route.path, injectSeo(templateHtml, route.seo));
    }

    const sitemapEntries = routes.map((route) => ({
        loc: absoluteUrl(route.path),
        lastmod: route.lastmod
    }));
    await fs.writeFile(path.join(distDir, 'sitemap.xml'), buildSitemapXml(sitemapEntries), 'utf8');
    await fs.writeFile(path.join(distDir, 'robots.txt'), buildRobotsTxt(absoluteUrl('/sitemap.xml')), 'utf8');
};

run().catch((error) => {
    console.error('SEO build failed:', error);
    process.exit(1);
});
