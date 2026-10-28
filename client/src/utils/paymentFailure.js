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
    // Gateway details are rendered as React text, never HTML. Keep them through redirects.
    if (raw.startsWith('Razorpay: ')) return raw.slice(0, 500);
    const matched = PAYMENT_FAILURE_PATTERNS.find((entry) => entry.test(raw));
    return matched?.message || 'Payment failed. Please try again.';
};

const RAZORPAY_REASON_MESSAGES = {
    insufficient_funds: 'Insufficient balance. Please use another payment method.',
    incorrect_otp: 'The OTP was incorrect. Please retry with the correct OTP.',
    invalid_otp: 'The OTP was invalid. Please retry with the correct OTP.',
    payment_timed_out: 'Payment timed out. Please retry and complete it within the allowed time.',
    card_declined: 'Your bank declined the card payment. Please contact your bank or use another method.',
    payment_declined: 'Your bank or payment provider declined the payment. Please use another method.',
    bank_technical_error: 'Your bank encountered a technical issue. Please retry later or use another bank.',
    gateway_technical_error: 'The payment gateway encountered a technical issue. Please retry or use another method.',
    authentication_failed: 'Payment authentication failed. Please check your details and retry.'
};

export const formatRazorpayFailure = (error = {}) => {
    const description = String(error?.description || '').trim();
    const reason = String(error?.reason || '').trim();
    const detail = [description, reason && reason !== description ? reason : ''].filter(Boolean).join(' — ');
    const generic = !description || /^payment failed[.!]?$/i.test(description);
    const message = generic
        ? RAZORPAY_REASON_MESSAGES[reason] || 'Payment could not be completed. Please retry or use another payment method.'
        : description;
    // Even the generic fallback retains available gateway information.
    return `Razorpay: ${message}${detail && detail !== message ? ` (${detail})` : ''}`.slice(0, 500);
};
