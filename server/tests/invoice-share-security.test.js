const test = require('node:test');
const assert = require('node:assert/strict');

const { requireFresh } = require('./testUtils');

test('invoice share token helper requires configured secret outside dev/test', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInvoiceSecret = process.env.INVOICE_SHARE_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    process.env.NODE_ENV = 'production';
    delete process.env.INVOICE_SHARE_SECRET;
    delete process.env.JWT_SECRET;

    try {
        const service = requireFresh('../services/invoiceShareService');
        assert.throws(() => service.buildInvoiceShareUrl({ orderId: 1, userId: 'u1', baseUrl: 'https://example.com' }), /must be configured/i);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInvoiceSecret === undefined) {
            delete process.env.INVOICE_SHARE_SECRET;
        } else {
            process.env.INVOICE_SHARE_SECRET = originalInvoiceSecret;
        }
        if (originalJwtSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalJwtSecret;
        }
    }
});

test('invoice share token helper still works in test without explicit secret', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInvoiceSecret = process.env.INVOICE_SHARE_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    process.env.NODE_ENV = 'test';
    delete process.env.INVOICE_SHARE_SECRET;
    delete process.env.JWT_SECRET;

    try {
        const service = requireFresh('../services/invoiceShareService');
        const url = service.buildInvoiceShareUrl({ orderId: 1, userId: 'u1', baseUrl: 'https://example.com' });
        assert.match(url, /invoice\/share/);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInvoiceSecret === undefined) {
            delete process.env.INVOICE_SHARE_SECRET;
        } else {
            process.env.INVOICE_SHARE_SECRET = originalInvoiceSecret;
        }
        if (originalJwtSecret === undefined) {
            delete process.env.JWT_SECRET;
        } else {
            process.env.JWT_SECRET = originalJwtSecret;
        }
    }
});

test('invoice share helper requires public base URL in production when none is configured', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInvoiceSecret = process.env.INVOICE_SHARE_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;
    const originalAppBaseUrl = process.env.APP_BASE_URL;
    const originalPublicBaseUrl = process.env.PUBLIC_BASE_URL;
    const originalAppUrl = process.env.APP_URL;
    const originalUrl = process.env.URL;
    const originalRender = process.env.RENDER_EXTERNAL_URL;
    const originalRailway = process.env.RAILWAY_PUBLIC_DOMAIN;
    const originalVercel = process.env.VERCEL_URL;

    process.env.NODE_ENV = 'production';
    process.env.INVOICE_SHARE_SECRET = 'invoice-secret';
    delete process.env.JWT_SECRET;
    delete process.env.APP_BASE_URL;
    delete process.env.PUBLIC_BASE_URL;
    delete process.env.APP_URL;
    delete process.env.URL;
    delete process.env.RENDER_EXTERNAL_URL;
    delete process.env.RAILWAY_PUBLIC_DOMAIN;
    delete process.env.VERCEL_URL;

    try {
        const service = requireFresh('../services/invoiceShareService');
        assert.throws(() => service.buildInvoiceShareUrl({ orderId: 1, userId: 'u1' }), /public base url/i);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInvoiceSecret === undefined) delete process.env.INVOICE_SHARE_SECRET;
        else process.env.INVOICE_SHARE_SECRET = originalInvoiceSecret;
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
        if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = originalAppBaseUrl;
        if (originalPublicBaseUrl === undefined) delete process.env.PUBLIC_BASE_URL;
        else process.env.PUBLIC_BASE_URL = originalPublicBaseUrl;
        if (originalAppUrl === undefined) delete process.env.APP_URL;
        else process.env.APP_URL = originalAppUrl;
        if (originalUrl === undefined) delete process.env.URL;
        else process.env.URL = originalUrl;
        if (originalRender === undefined) delete process.env.RENDER_EXTERNAL_URL;
        else process.env.RENDER_EXTERNAL_URL = originalRender;
        if (originalRailway === undefined) delete process.env.RAILWAY_PUBLIC_DOMAIN;
        else process.env.RAILWAY_PUBLIC_DOMAIN = originalRailway;
        if (originalVercel === undefined) delete process.env.VERCEL_URL;
        else process.env.VERCEL_URL = originalVercel;
    }
});

test('invoice share helper uses APP_BASE_URL when configured', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalInvoiceSecret = process.env.INVOICE_SHARE_SECRET;
    const originalAppBaseUrl = process.env.APP_BASE_URL;

    process.env.NODE_ENV = 'production';
    process.env.INVOICE_SHARE_SECRET = 'invoice-secret';
    process.env.APP_BASE_URL = 'https://shop.example.com';

    try {
        const service = requireFresh('../services/invoiceShareService');
        const url = service.buildInvoiceShareUrl({ orderId: 1, userId: 'u1' });
        assert.match(url, /^https:\/\/shop\.example\.com\/api\/orders\/invoice\/share/);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalInvoiceSecret === undefined) delete process.env.INVOICE_SHARE_SECRET;
        else process.env.INVOICE_SHARE_SECRET = originalInvoiceSecret;
        if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = originalAppBaseUrl;
    }
});
