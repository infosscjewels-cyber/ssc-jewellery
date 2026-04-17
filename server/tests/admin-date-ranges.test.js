const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeAdminQuickRange,
    normalizeAbandonedRange,
    resolveNamedRange
} = require('../utils/adminDateRanges');

test('normalizeAdminQuickRange maps legacy aliases to canonical dashboard ranges', () => {
    assert.equal(normalizeAdminQuickRange('last_7_days'), 'current_week');
    assert.equal(normalizeAdminQuickRange('last_30_days'), 'current_month');
    assert.equal(normalizeAdminQuickRange('last_90_days'), 'last_3_months');
});

test('normalizeAbandonedRange preserves lifetime, canonical aliases, and arbitrary numeric ranges', () => {
    assert.equal(normalizeAbandonedRange('lifetime'), 'lifetime');
    assert.equal(normalizeAbandonedRange('30'), 'current_month');
    assert.equal(normalizeAbandonedRange(45), 45);
});

test('resolveNamedRange returns Monday-based current week bounds', () => {
    const resolved = resolveNamedRange('current_week', {
        now: new Date('2026-04-17T12:00:00.000Z')
    });
    assert.equal(resolved.startDateText, '2026-04-13');
    assert.equal(resolved.endDateText, '2026-04-17');
    assert.equal(resolved.periodDays, 5);
});

test('resolveNamedRange returns month and last-three-month windows using calendar boundaries', () => {
    const currentMonth = resolveNamedRange('current_month', {
        now: new Date('2026-04-17T12:00:00.000Z')
    });
    assert.equal(currentMonth.startDateText, '2026-04-01');
    assert.equal(currentMonth.endDateText, '2026-04-17');
    assert.equal(currentMonth.periodDays, 17);

    const lastThreeMonths = resolveNamedRange('last_3_months', {
        now: new Date('2026-04-17T12:00:00.000Z')
    });
    assert.equal(lastThreeMonths.startDateText, '2026-02-01');
    assert.equal(lastThreeMonths.endDateText, '2026-04-17');
    assert.equal(lastThreeMonths.periodDays, 76);
});
