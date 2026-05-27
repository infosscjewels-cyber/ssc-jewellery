const test = require('node:test');
const assert = require('node:assert/strict');
const {
    computeChange,
    toSafeEnum,
    normalizeDashboardEventType,
    buildDashboardCacheKey,
    normalizeDashboardPaymentMode,
    resolveDashboardPaymentMode
} = require('../utils/dashboardUtils');

test('computeChange handles normal percentages', () => {
    assert.equal(computeChange(120, 100), 20);
    assert.equal(computeChange(80, 100), -20);
});

test('computeChange handles zero previous safely', () => {
    assert.equal(computeChange(0, 0), 0);
    assert.equal(computeChange(50, 0), 100);
});

test('toSafeEnum normalizes allowed values and falls back', () => {
    assert.equal(toSafeEnum('COD', ['cod', 'razorpay'], 'cod'), 'cod');
    assert.equal(toSafeEnum('other', ['cod', 'razorpay'], 'cod'), 'cod');
});

test('normalizeDashboardEventType rejects unknown event types', () => {
    assert.equal(normalizeDashboardEventType('action_opened'), 'action_opened');
    assert.equal(normalizeDashboardEventType('bad_event_name'), 'dashboard_opened');
});

test('buildDashboardCacheKey remains stable for semantically same input', () => {
    const a = buildDashboardCacheKey({
        quickRange: 'last_30_days',
        status: 'all',
        paymentMode: 'all',
        sourceChannel: 'all',
        lowStockThreshold: 5
    });
    const b = buildDashboardCacheKey({
        quickRange: 'last_30_days',
        status: 'all',
        paymentMode: 'all',
        sourceChannel: 'all',
        lowStockThreshold: '5'
    });
    assert.equal(a, b);
});

test('buildDashboardCacheKey normalizes legacy and canonical quick ranges to the same key', () => {
    const legacy = buildDashboardCacheKey({
        quickRange: 'last_30_days',
        status: 'all',
        paymentMode: 'all',
        sourceChannel: 'all'
    });
    const canonical = buildDashboardCacheKey({
        quickRange: 'current_month',
        status: 'all',
        paymentMode: 'all',
        sourceChannel: 'all'
    });
    assert.equal(legacy, canonical);
});

test('normalizeDashboardPaymentMode preserves Razorpay modes and canonicalizes ICICI instrument codes', () => {
    assert.equal(normalizeDashboardPaymentMode('upi', { gateway: 'razorpay' }), 'upi');
    assert.equal(normalizeDashboardPaymentMode('netbanking', { gateway: 'razorpay' }), 'netbanking');

    assert.equal(normalizeDashboardPaymentMode('UPI', { gateway: 'icici' }), 'upi');
    assert.equal(normalizeDashboardPaymentMode('NB', { gateway: 'icici' }), 'net_banking');
    assert.equal(normalizeDashboardPaymentMode('netbanking', { gateway: 'icici' }), 'net_banking');
    assert.equal(normalizeDashboardPaymentMode('DC', { gateway: 'icici' }), 'debit_card');
    assert.equal(normalizeDashboardPaymentMode('CC', { gateway: 'icici' }), 'credit_card');
    assert.equal(normalizeDashboardPaymentMode('CARD', { gateway: 'icici' }), 'card');
    assert.equal(normalizeDashboardPaymentMode('', { gateway: 'icici' }), 'unknown');
    assert.equal(normalizeDashboardPaymentMode('wallet', { gateway: 'icici' }), 'unknown');
});

test('resolveDashboardPaymentMode uses ICICI source priority and keeps unknowns unknown', () => {
    assert.equal(resolveDashboardPaymentMode({
        gateway: 'icici',
        settlementMode: 'UPI',
        gatewayPayloadMode: 'NB',
        mode: 'icici'
    }), 'upi');

    assert.equal(resolveDashboardPaymentMode({
        gateway: 'icici',
        settlementMode: '',
        gatewayPayloadMode: 'NB',
        mode: 'icici'
    }), 'net_banking');

    assert.equal(resolveDashboardPaymentMode({
        gateway: 'icici',
        settlementMode: '',
        gatewayPayloadMode: '',
        mode: 'icici'
    }), 'unknown');

    assert.equal(resolveDashboardPaymentMode({
        gateway: 'razorpay',
        settlementMode: 'upi',
        gatewayPayloadMode: 'nb',
        mode: 'card'
    }), 'card');
});
