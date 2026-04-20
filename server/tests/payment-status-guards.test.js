const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SKIP_DB_INIT = 'true';

const db = require('../config/db');
const Order = require('../models/Order');
const { PaymentAttempt, PAYMENT_STATUS } = require('../models/PaymentAttempt');
const { withPatched } = require('./testUtils');

test('Order.updatePaymentByRazorpayOrderId preserves paid orders against attempted-style regressions', async () => {
    const calls = [];

    await withPatched(db, {
        execute: async (query, params = []) => {
            calls.push({ sql: String(query), params });
            return [{ affectedRows: 1 }];
        }
    }, async () => {
        const updated = await Order.updatePaymentByRazorpayOrderId({
            razorpayOrderId: 'order_guard_1',
            paymentStatus: PAYMENT_STATUS.ATTEMPTED,
            razorpayPaymentId: 'pay_guard_1'
        });
        assert.equal(updated, 1);
    });

    assert.equal(calls.length, 1);
    assert.match(calls[0].sql, /CASE/);
    assert.equal(calls[0].params[0], 1, 'refunded orders must be preserved against non-refund statuses');
    assert.equal(calls[0].params[1], 1, 'paid orders must be preserved against attempted-style statuses');
    assert.equal(calls[0].params[2], PAYMENT_STATUS.ATTEMPTED);
});

test('PaymentAttempt.markAttemptedByRazorpayOrder does not downgrade linked paid attempts', async () => {
    let executeCalled = false;

    await withPatched(PaymentAttempt, {
        getByRazorpayOrderIdAny: async () => ({
            id: 177,
            status: PAYMENT_STATUS.PAID_UNVERIFIED,
            local_order_id: 54
        })
    }, async () => withPatched(db, {
        execute: async () => {
            executeCalled = true;
            return [{ affectedRows: 1 }];
        }
    }, async () => {
        await PaymentAttempt.markAttemptedByRazorpayOrder({
            razorpayOrderId: 'order_guard_2',
            paymentId: 'pay_guard_2'
        });
    }));

    assert.equal(executeCalled, false);
});

test('PaymentAttempt.markAttemptedByRazorpayOrder still updates genuinely open attempts', async () => {
    let updateParams = null;

    await withPatched(PaymentAttempt, {
        getByRazorpayOrderIdAny: async () => ({
            id: 178,
            status: PAYMENT_STATUS.CREATED,
            local_order_id: null
        }),
        claimPaymentForAttempt: async () => ({ linkedToExistingOrder: false })
    }, async () => withPatched(db, {
        execute: async (_query, params = []) => {
            updateParams = params;
            return [{ affectedRows: 1 }];
        }
    }, async () => {
        await PaymentAttempt.markAttemptedByRazorpayOrder({
            razorpayOrderId: 'order_guard_3',
            paymentId: 'pay_guard_3'
        });
    }));

    assert.deepEqual(updateParams, [PAYMENT_STATUS.ATTEMPTED, 178]);
});
