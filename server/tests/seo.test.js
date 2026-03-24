const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { pathToFileURL } = require('url');

const importSeoModule = async (relativePath) => {
    const abs = path.resolve(__dirname, '../../client/src/seo', relativePath);
    return import(pathToFileURL(abs).href);
};

test('private routes default to noindex', async () => {
    const { buildDefaultSeo } = await importSeoModule('rules.js');
    const seo = buildDefaultSeo('/checkout');
    assert.equal(seo.robots, 'noindex,nofollow');
});

test('product seo builds product and breadcrumb structured data', async () => {
    const { buildProductSeo } = await importSeoModule('rules.js');
    const seo = buildProductSeo({
        product: {
            id: 'p1',
            title: 'Premium Chain',
            subtitle: '24 inches',
            description: '',
            categories: ['Chains'],
            media: [{ type: 'image', url: '/uploads/products/p1.jpg' }],
            mrp: 3000,
            discount_price: 2600,
            sku: 'SKU-1',
            track_quantity: 1,
            quantity: 4
        }
    });
    assert.match(seo.title, /Premium Chain/);
    assert.equal(Array.isArray(seo.structuredData), true);
    assert.equal(seo.structuredData.some((item) => item?.['@type'] === 'Product'), true);
    assert.equal(seo.structuredData.some((item) => item?.['@type'] === 'BreadcrumbList'), true);
});

test('faq seo includes faq structured data and fallback image', async () => {
    const { buildFaqSeo } = await importSeoModule('rules.js');
    const seo = buildFaqSeo({ company: {} });
    assert.equal(seo.structuredData.some((item) => item?.['@type'] === 'FAQPage'), true);
    assert.ok(String(seo.image || '').length > 0);
});

test('home seo includes local business and website search action schema', async () => {
    const { buildHomeSeo } = await importSeoModule('rules.js');
    const seo = buildHomeSeo({
        company: {
            displayName: 'SSC Jewellery',
            supportEmail: 'support@example.com',
            contactNumber: '9876543210',
            address: '12 Temple Road, Chennai',
            city: 'Chennai',
            state: 'Tamil Nadu',
            postalCode: '600001',
            country: 'IN',
            openingHours: 'Mon-Sat 10:00-19:00',
            latitude: '13.0826802',
            longitude: '80.2707184',
            instagramUrl: 'https://instagram.com/ssc',
            facebookUrl: 'https://facebook.com/ssc'
        }
    });
    assert.equal(seo.structuredData.some((item) => item?.['@type'] === 'JewelryStore'), true);
    const websiteSchema = seo.structuredData.find((item) => item?.['@type'] === 'WebSite');
    assert.equal(Boolean(websiteSchema?.potentialAction), true);
    assert.match(String(websiteSchema?.potentialAction?.target || ''), /\/shop\?q=\{search_term_string\}$/);
    const businessSchema = seo.structuredData.find((item) => item?.['@type'] === 'JewelryStore');
    assert.equal(businessSchema?.address?.addressLocality, 'Chennai');
    assert.equal(businessSchema?.address?.addressRegion, 'Tamil Nadu');
    assert.equal(businessSchema?.openingHours, 'Mon-Sat 10:00-19:00');
    assert.equal(businessSchema?.geo?.latitude, 13.0826802);
});

test('seo uses absolute canonicals and richer schema when app base url is configured', async () => {
    const previousBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://sscjewellery.example';

    try {
        const { buildCategorySeo, buildProductSeo } = await importSeoModule('rules.js');
        const categorySeo = buildCategorySeo({
            company: { displayName: 'SSC Jewellery' },
            category: { name: 'Chains', image_url: '/uploads/categories/chains.jpg' },
            products: [
                {
                    id: 'p1',
                    title: 'Premium Chain',
                    media: [{ type: 'image', url: '/uploads/products/p1.jpg' }]
                }
            ]
        });
        const productSeo = buildProductSeo({
            product: {
                id: 'p1',
                title: 'Premium Chain',
                subtitle: '24 inches',
                description: '',
                categories: ['Chains'],
                media: [{ type: 'image', url: '/uploads/products/p1.jpg' }],
                mrp: 3000,
                discount_price: 2600,
                sku: 'SKU-1',
                track_quantity: 1,
                quantity: 4
            }
        });

        assert.equal(categorySeo.canonical, 'https://sscjewellery.example/shop/Chains');
        assert.equal(String(categorySeo.image).startsWith('https://sscjewellery.example/'), true);

        const itemList = categorySeo.structuredData.find((item) => item?.['@type'] === 'ItemList');
        assert.equal(Boolean(itemList?.itemListElement?.[0]?.name), true);
        assert.equal(Boolean(itemList?.itemListElement?.[0]?.image), true);

        const productSchema = productSeo.structuredData.find((item) => item?.['@type'] === 'Product');
        assert.equal(productSchema?.brand?.name, 'SSC Jewellery');
        assert.equal(productSchema?.offers?.url, 'https://sscjewellery.example/product/p1');
    } finally {
        if (previousBaseUrl == null) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = previousBaseUrl;
    }
});
