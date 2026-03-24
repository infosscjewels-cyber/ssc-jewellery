const test = require('node:test');
const assert = require('node:assert/strict');

const seoService = require('../services/seoService');

test('seo automation recognizes supported static and catalog routes', () => {
    const { parseCatalogRoute } = seoService.__test;

    assert.deepEqual(parseCatalogRoute('/'), { type: 'static', routePath: '/' });
    assert.deepEqual(parseCatalogRoute('/shop'), { type: 'static', routePath: '/shop' });
    assert.deepEqual(parseCatalogRoute('/product/p-123'), {
        type: 'product',
        routePath: '/product/p-123',
        id: 'p-123'
    });
    assert.deepEqual(parseCatalogRoute('/shop/New%20Arrivals'), {
        type: 'category',
        routePath: '/shop/New%20Arrivals',
        name: 'New Arrivals'
    });
    assert.equal(parseCatalogRoute('/admin/products'), null);
});

test('dynamic fallback seo is noindex for uncached catalog routes', async () => {
    const { buildFallbackSeo } = seoService.__test;

    const productSeo = await buildFallbackSeo('/product/p-123');
    const categorySeo = await buildFallbackSeo('/shop/New%20Arrivals');
    const homeSeo = await buildFallbackSeo('/');

    assert.equal(productSeo.robots, 'noindex,nofollow');
    assert.equal(categorySeo.robots, 'noindex,nofollow');
    assert.notEqual(homeSeo.robots, 'noindex,nofollow');
    assert.equal(productSeo.canonical.endsWith('/product/p-123'), true);
});

test('seo head injection replaces title/canonical and preserves html shell', () => {
    const { injectSeo } = seoService.__test;

    const html = '<html><head><title>Old</title><meta name="description" content="old"></head><body><div id="root"></div></body></html>';
    const injected = injectSeo(html, {
        title: 'Fresh Title',
        description: 'Fresh description',
        canonical: 'https://example.com/product/p1',
        robots: 'index,follow',
        image: 'https://example.com/p1.jpg',
        structuredData: [{ '@context': 'https://schema.org', '@type': 'Thing', name: 'Fresh' }]
    });

    assert.match(injected, /Fresh Title/);
    assert.match(injected, /https:\/\/example\.com\/product\/p1/);
    assert.match(injected, /application\/ld\+json/);
    assert.match(injected, /<div id="root"><\/div>/);
});
