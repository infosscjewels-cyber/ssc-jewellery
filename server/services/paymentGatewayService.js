const PAYMENT_GATEWAYS = Object.freeze({
    RAZORPAY: 'razorpay',
    ICICI: 'icici'
});

const normalizePaymentGateway = (value = process.env.PAYMENT_GATEWAY) => (
    String(value || PAYMENT_GATEWAYS.RAZORPAY).trim().toLowerCase() || PAYMENT_GATEWAYS.RAZORPAY
);

const getActivePaymentGateway = () => normalizePaymentGateway();

const assertSupportedPaymentGateway = () => {
    const gateway = getActivePaymentGateway();
    if (![PAYMENT_GATEWAYS.RAZORPAY, PAYMENT_GATEWAYS.ICICI].includes(gateway)) {
        const error = new Error(
            `Unsupported PAYMENT_GATEWAY "${gateway}". Supported gateways: "${PAYMENT_GATEWAYS.RAZORPAY}", "${PAYMENT_GATEWAYS.ICICI}".`
        );
        error.code = 'UNSUPPORTED_PAYMENT_GATEWAY';
        error.statusCode = 500;
        throw error;
    }
    return gateway;
};

const getPaymentGatewayAdapter = (adapters = {}) => {
    const gateway = assertSupportedPaymentGateway();
    const adapter = adapters?.[gateway];
    if (!adapter || typeof adapter !== 'object') {
        const error = new Error(`Payment gateway adapter "${gateway}" is not configured.`);
        error.code = 'PAYMENT_GATEWAY_ADAPTER_MISSING';
        error.statusCode = 500;
        throw error;
    }
    return adapter;
};

module.exports = {
    PAYMENT_GATEWAYS,
    getActivePaymentGateway,
    assertSupportedPaymentGateway,
    getPaymentGatewayAdapter
};
