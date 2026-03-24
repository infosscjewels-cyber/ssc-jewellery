const PAYMENT_FAILURE_PATTERNS = [
    {
        test: (value) => /cancel/i.test(value),
        message: 'Payment cancelled. You can retry the payment.'
    },
    {
        test: (value) => /expired|session expired|session has expired/i.test(value),
        message: 'Payment session expired. Please retry payment.'
    },
    {
        test: (value) => /insufficient stock|out of stock|unavailable/i.test(value),
        message: 'Some items changed while payment was processing. Please review checkout and retry.'
    },
    {
        test: (value) => /cart changed|summary changed|amount mismatch/i.test(value),
        message: 'Your cart changed before payment confirmation. Please review checkout and retry.'
    },
    {
        test: (value) => /invalid payment signature|verification failed|payment could not be verified/i.test(value),
        message: 'Payment could not be verified. If money was debited, it will be reconciled automatically.'
    },
    {
        test: (value) => /unable to load razorpay|razorpay checkout|payment service.*unavailable|key.*not configured/i.test(value),
        message: 'Payment service is temporarily unavailable. Please try again shortly.'
    },
    {
        test: (value) => /network|failed to fetch|load failed|timeout/i.test(value),
        message: 'Network issue while processing payment. Please retry.'
    }
];

export const normalizePaymentFailureReason = (reason = '') => {
    const raw = String(reason || '').trim();
    if (!raw) return 'Payment failed. Please try again.';
    const matched = PAYMENT_FAILURE_PATTERNS.find((entry) => entry.test(raw));
    return matched?.message || 'Payment failed. Please try again.';
};
