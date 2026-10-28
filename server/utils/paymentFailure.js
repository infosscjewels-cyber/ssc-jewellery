const GENERIC_FAILURE = /^(?:razorpay:\s*)?(?:payment failed(?: at gateway)?[.!]?(?: — payment_failed)?|payment_failed)$/i;

const isGenericPaymentFailure = (reason) => !String(reason || '').trim()
    || GENERIC_FAILURE.test(String(reason).trim());

// Accept only payment failure fields, never an API exception or complete response.
const formatRazorpayFailure = (payment = {}) => {
    const description = String(payment?.error_description || '').trim();
    const reason = String(payment?.error_reason || '').trim();
    const detail = [description, reason && reason !== description ? reason : ''].filter(Boolean).join(' — ');
    return detail ? `Razorpay: ${detail}`.slice(0, 500) : 'Payment failed';
};

const preservePaymentFailure = (incoming, existing) => (
    isGenericPaymentFailure(incoming) && !isGenericPaymentFailure(existing) ? existing : incoming
);

module.exports = { formatRazorpayFailure, preservePaymentFailure };
