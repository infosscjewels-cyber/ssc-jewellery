const test = require('node:test');
const assert = require('node:assert/strict');
const { importClientModule } = require('./testUtils');
const { formatRazorpayFailure, preservePaymentFailure } = require('../utils/paymentFailure');

test('gateway payment entities retain description and reason, including reason-only failures', () => {
    assert.equal(formatRazorpayFailure({ error_description: 'Your bank declined this payment', error_reason: 'card_declined' }),
        'Razorpay: Your bank declined this payment — card_declined');
    assert.equal(formatRazorpayFailure({ error_reason: 'insufficient_funds' }), 'Razorpay: insufficient_funds');
    assert.equal(formatRazorpayFailure(null), 'Payment failed');
    assert.equal(formatRazorpayFailure({ error_description: 'x'.repeat(700) }).length, 500);
});

test('generic refreshes preserve specific saved failures while new details can replace them', () => {
    const saved = 'Razorpay: Your bank declined this payment — card_declined';
    for (const incoming of [null, '', 'Payment failed', 'Payment failed at gateway', 'Razorpay: Payment failed', 'Razorpay: Payment failed — payment_failed', 'Razorpay: payment_failed']) {
        assert.equal(preservePaymentFailure(incoming, saved), saved);
    }
    assert.equal(preservePaymentFailure('Razorpay: incorrect_otp', saved), 'Razorpay: incorrect_otp');
});

test('customer failures preserve gateway details through checkout and failure-page normalization', async () => {
    const client = await importClientModule('client/src/utils/paymentFailure.js');
    for (const error of [
        { description: 'Insufficient balance in account', reason: 'insufficient_funds' },
        { description: 'Payment failed', reason: 'new_gateway_reason' },
        { reason: 'incorrect_otp' },
        { description: 'The bank is unavailable', reason: 'bank_technical_error' },
        {}
    ]) {
        const formatted = client.formatRazorpayFailure(error);
        if (error.description) assert.ok(formatted.includes(error.description));
        if (error.reason) assert.ok(formatted.includes(error.reason));
        assert.equal(client.normalizePaymentFailureReason(client.normalizePaymentFailureReason(formatted)), formatted);
    }
    assert.match(client.formatRazorpayFailure({ reason: 'insufficient_funds' }), /Insufficient balance/);
    assert.match(client.formatRazorpayFailure({ reason: 'unknown_code' }), /Payment could not be completed.*unknown_code/);
    assert.equal(client.normalizePaymentFailureReason('SQL error: confidential data'), 'Payment failed. Please try again.');
    assert.equal(client.normalizePaymentFailureReason('invalid payment signature'),
        'Payment could not be verified. If money was debited, it will be reconciled automatically.');
});
