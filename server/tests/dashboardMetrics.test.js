const test = require('node:test');
const assert = require('node:assert/strict');
const {
    computeChange,
    toSafeEnum,
    normalizeDashboardEventType,
    buildDashboardCacheKey
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
