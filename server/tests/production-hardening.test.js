const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('module');

const { createMockRes, requireFresh } = require('./testUtils');

test('admin communication test endpoints are blocked in production', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const dbModulePath = require.resolve('../config/db', { paths: [__dirname] });
    const originalDbModule = require.cache[dbModulePath];
    require.cache[dbModulePath] = {
        id: dbModulePath,
        filename: dbModulePath,
        loaded: true,
        exports: {
            execute: async () => [[]],
            query: async () => [[]],
            getConnection: async () => ({
                execute: async () => [[]],
                query: async () => [[]],
                beginTransaction: async () => {},
                commit: async () => {},
                rollback: async () => {},
                release() {}
            })
        },
        children: [],
        paths: Module._nodeModulePaths(__dirname)
    };

    const adminController = requireFresh('../controllers/adminController');

    try {
        const emailRes = createMockRes();
        await adminController.sendTestEmail({ body: { to: 'test@example.com' } }, emailRes);
        assert.equal(emailRes.statusCode, 403);
        assert.match(String(emailRes.body?.message || ''), /disabled in production/i);

        const whatsappRes = createMockRes();
        await adminController.sendTestWhatsapp({ body: { mobile: '9876543210' } }, whatsappRes);
        assert.equal(whatsappRes.statusCode, 403);
        assert.match(String(whatsappRes.body?.message || ''), /disabled in production/i);

        const verifyRes = createMockRes();
        await adminController.verifyEmailChannel({}, verifyRes);
        assert.equal(verifyRes.statusCode, 403);
        assert.match(String(verifyRes.body?.message || ''), /disabled in production/i);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalDbModule) require.cache[dbModulePath] = originalDbModule;
        else delete require.cache[dbModulePath];
    }
});

test('delivery confirmation token helper requires configured secret outside dev/test', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    const originalDeliverySecret = process.env.DELIVERY_CONFIRM_SECRET;
    const originalJwtSecret = process.env.JWT_SECRET;

    process.env.NODE_ENV = 'production';
    delete process.env.DELIVERY_CONFIRM_SECRET;
    delete process.env.JWT_SECRET;

    try {
        const service = requireFresh('../services/deliveryConfirmationService');
        assert.throws(
            () => service.buildDeliveryConfirmationUrl({ orderId: 101, userId: 'u1', baseUrl: 'https://shop.example.com' }),
            /DELIVERY_CONFIRM_SECRET or JWT_SECRET must be configured/i
        );
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
        if (originalDeliverySecret === undefined) delete process.env.DELIVERY_CONFIRM_SECRET;
        else process.env.DELIVERY_CONFIRM_SECRET = originalDeliverySecret;
        if (originalJwtSecret === undefined) delete process.env.JWT_SECRET;
        else process.env.JWT_SECRET = originalJwtSecret;
    }
});
