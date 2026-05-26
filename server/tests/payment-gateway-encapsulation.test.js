const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SKIP_DB_INIT = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { requireFresh } = require('./testUtils');
const { createRazorpayGatewayAdapter } = require('../services/gateways/razorpayGatewayAdapter');

test('payment gateway resolver defaults to razorpay and accepts normalized razorpay env', () => {
    const originalGateway = process.env.PAYMENT_GATEWAY;
    delete process.env.PAYMENT_GATEWAY;
    let service = requireFresh('../services/paymentGatewayService');
    assert.equal(service.getActivePaymentGateway(), 'razorpay');
    assert.equal(service.assertSupportedPaymentGateway(), 'razorpay');

    process.env.PAYMENT_GATEWAY = ' RAZORPAY ';
    service = requireFresh('../services/paymentGatewayService');
    assert.equal(service.getActivePaymentGateway(), 'razorpay');
    assert.equal(service.assertSupportedPaymentGateway(), 'razorpay');

    if (originalGateway === undefined) delete process.env.PAYMENT_GATEWAY;
    else process.env.PAYMENT_GATEWAY = originalGateway;
});

test('payment gateway resolver accepts normalized icici env and fails fast for unknown gateways', () => {
    const originalGateway = process.env.PAYMENT_GATEWAY;
    process.env.PAYMENT_GATEWAY = ' ICICI ';

    const service = requireFresh('../services/paymentGatewayService');
    assert.equal(service.getActivePaymentGateway(), 'icici');
    assert.equal(service.assertSupportedPaymentGateway(), 'icici');

    process.env.PAYMENT_GATEWAY = 'unknown-gateway';
    const invalidService = requireFresh('../services/paymentGatewayService');
    assert.throws(() => invalidService.assertSupportedPaymentGateway(), /Unsupported PAYMENT_GATEWAY/);

    if (originalGateway === undefined) delete process.env.PAYMENT_GATEWAY;
    else process.env.PAYMENT_GATEWAY = originalGateway;
});

test('payment gateway adapter resolver returns the active razorpay adapter', () => {
    const originalGateway = process.env.PAYMENT_GATEWAY;
    process.env.PAYMENT_GATEWAY = 'razorpay';

    const service = requireFresh('../services/paymentGatewayService');
    const adapter = { createSession: () => 'ok' };
    assert.equal(service.getPaymentGatewayAdapter({ razorpay: adapter }), adapter);

    if (originalGateway === undefined) delete process.env.PAYMENT_GATEWAY;
    else process.env.PAYMENT_GATEWAY = originalGateway;
});

test('razorpay gateway adapter delegates lifecycle handlers', async () => {
    const calls = [];
    const adapter = createRazorpayGatewayAdapter({
        createSession: async (req, res) => {
            calls.push(['createSession', req, res]);
            return { ok: 'create' };
        },
        verifyPayment: async (req, res) => {
            calls.push(['verifyPayment', req, res]);
            return { ok: 'verify' };
        }
    });

    const req = { id: 'req' };
    const res = { id: 'res' };
    assert.deepEqual(await adapter.createSession(req, res), { ok: 'create' });
    assert.deepEqual(await adapter.verifyPayment(req, res), { ok: 'verify' });
    assert.deepEqual(calls, [
        ['createSession', req, res],
        ['verifyPayment', req, res]
    ]);
});

test('order routes preserve razorpay endpoints and expose generic payment aliases', () => {
    const router = requireFresh('../routes/orderRoutes');
    const routePaths = router.stack
        .filter((layer) => layer?.route?.path)
        .map((layer) => layer.route.path);

    [
        '/razorpay/order',
        '/razorpay/order/public',
        '/razorpay/retry',
        '/razorpay/verify',
        '/razorpay/verify/public',
        '/razorpay/attempt/:id',
        '/razorpay/attempt/public/:id',
        '/razorpay/webhook',
        '/icici/return',
        '/icici/webhook',
        '/payment/session',
        '/payment/session/public',
        '/payment/retry',
        '/payment/verify',
        '/payment/verify/public',
        '/payment/attempt/:id',
        '/payment/attempt/public/:id',
        '/payment/webhook'
    ].forEach((path) => {
        assert.ok(routePaths.includes(path), `expected route ${path}`);
    });
});
