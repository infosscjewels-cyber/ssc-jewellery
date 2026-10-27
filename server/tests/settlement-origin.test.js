const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/db');
const Order = require('../models/Order');
const CompanyProfile = require('../models/CompanyProfile');
const { withPatched } = require('./testUtils');

const captureSettlement = async (overrides = {}) => {
    let result;
    const stop = new Error('Stop before persisting the order');
    const connection = {
        beginTransaction: async () => {}, rollback: async () => {}, release: () => {},
        execute: async (sql, params) => {
            if (sql.includes('FROM payment_attempts')) return [[{
                id: 2005, user_id: 'customer', amount_subunits: 62000, currency: 'INR',
                notes: JSON.stringify({ attemptSnapshot: {
                    pricing: { subtotal: 520, shippingFee: 100, total: 620 },
                    items: [{ productId: 'product', quantity: 1, unitPrice: 520, taxRatePercent: 3 }]
                } })
            }]];
            if (sql.includes('order_ref_sequences')) return [[{ last_sequence: 0 }]];
            if (sql.includes('INSERT INTO orders')) {
                result = { id: params.at(-2), snapshot: params.at(-1) ? JSON.parse(params.at(-1)) : null };
                throw stop;
            }
            throw new Error(`Unexpected SQL: ${sql}`);
        }
    };
    await withPatched(db, { getConnection: async () => connection }, async () =>
        withPatched(CompanyProfile, { get: async () => ({}) }, async () => {
            await assert.rejects(Order.createManualOrderFromAttempt({ attempt: { id: 2005, user_id: 'customer' }, ...overrides }), error => error === stop);
        }));
    return result;
};

test('normal Razorpay order creation waits for real settlement data', async () => {
    assert.deepEqual(await captureSettlement({ paymentGateway: 'razorpay' }), { id: null, snapshot: null });
});

test('Razorpay order preserves actual gateway settlement data', async () => {
    const snapshot = { id: 'setl_actual', status: 'pending', utr: null };
    assert.deepEqual(await captureSettlement({ paymentGateway: 'razorpay', settlementId: snapshot.id, settlementSnapshot: snapshot }), { id: snapshot.id, snapshot });
});

test('manual conversion retains its existing manual settlement record', async () => {
    const result = await captureSettlement({ paymentGateway: 'manual' });
    assert.equal(result.id, 'manual_settled_attempt_2005');
    assert.equal(result.snapshot.status, 'settled');
});

test('settlement sync revisits legacy synthetic Razorpay settlements', async () => {
    await withPatched(db, { execute: async (sql) => {
        assert.match(sql, /payment_gateway.*razorpay/);
        assert.match(sql, /LEFT\(COALESCE\(settlement_id, ''\), 23\) = 'manual_settled_attempt_'/);
        return [[]];
    } }, async () => assert.deepEqual(await Order.listSettlementSyncCandidates(), []));
});

const { requireFresh } = require('./testUtils');
const razorpayService = require('../services/razorpayService');
const runSettlementLookup = async ({ order = {}, paymentDetails = null, fetch, reports } = {}) => {
    const writes = [];
    let cleared = false;
    let result;
    await withPatched(razorpayService, {
        createRazorpayClient: async () => ({ settlements: { fetch, reports: reports || (async () => ({ items: [] })) } })
    }, async () => withPatched(Order, {
        clearSyntheticRazorpaySettlement: async () => { cleared = true; },
        updateSettlementByOrderId: async payload => { writes.push(payload); }
    }, async () => {
        const service = requireFresh('../services/paymentReconciliationService');
        result = await service.syncSettlementForOrder({ order: { id: 1, payment_gateway: 'razorpay', razorpay_payment_id: 'pay_expected', ...order }, paymentDetails });
    }));
    return { result, writes, cleared };
};

test('manual sync replaces synthetic settlement with a matching Razorpay report', async () => {
    const { result, writes } = await runSettlementLookup({
        order: { settlement_id: 'manual_settled_attempt_2005' },
        reports: async () => ({ items: [
            { type: 'payment', entity_id: 'pay_other', settlement_id: 'setl_other', settled: true },
            { type: 'payment', entity_id: 'pay_expected', settlement_id: 'setl_real', settled: true, settlement_utr: 'actual-utr' }
        ] })
    });
    assert.equal(result.status, 'settled');
    assert.equal(writes[0].settlementId, 'setl_real');
    assert.equal(writes[0].settlementSnapshot.utr, 'actual-utr');
});

test('manual sync leaves settlement pending when gateway has no settlement', async () => {
    let calls = 0;
    const { result, writes, cleared } = await runSettlementLookup({
        order: { settlement_id: 'manual_settled_attempt_2005' },
        reports: async () => { calls += 1; return { items: [] }; }
    });
    assert.equal(result.status, 'pending');
    assert.equal(calls, 8);
    assert.equal(cleared, true);
    assert.deepEqual(writes, []);
});

test('manual sync fetches a known genuine settlement and preserves gateway status', async () => {
    const { result, writes } = await runSettlementLookup({
        order: { settlement_id: 'setl_real' },
        fetch: async id => ({ id, status: 'processing', amount: 62000, fees: 100, tax: 18, utr: null })
    });
    assert.equal(result.status, 'processing');
    assert.equal(writes[0].settlementId, 'setl_real');
});

test('settlement API failure is returned separately without overwriting real data', async () => {
    const { result, writes } = await runSettlementLookup({
        order: { settlement_id: 'setl_real' }, fetch: async () => { throw new Error('network failure'); }
    });
    assert.equal(result.status, 'error');
    assert.deepEqual(writes, []);
});

test('settlement sync does not touch manual-payment orders', async () => {
    const { result, writes, cleared } = await runSettlementLookup({ order: { payment_gateway: 'manual' } });
    assert.equal(result.status, 'skipped');
    assert.equal(cleared, false);
    assert.deepEqual(writes, []);
});

test('legacy cleanup is restricted to synthetic IDs on Razorpay orders', async () => {
    await withPatched(db, { execute: async (sql, args) => {
        assert.match(sql, /settlement_id = NULL, settlement_snapshot = NULL/);
        assert.match(sql, /payment_gateway.*razorpay/);
        assert.match(sql, /manual_settled_attempt_/);
        assert.deepEqual(args, [1]);
        return [{}];
    } }, async () => Order.clearSyntheticRazorpaySettlement(1));
});
