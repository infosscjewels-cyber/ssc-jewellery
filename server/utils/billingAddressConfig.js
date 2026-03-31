const billingAddressEnabled = String(process.env.ENABLE_BILLING_ADDRESS || '')
    .trim()
    .toLowerCase() === 'true';

const resolveBillingAddress = ({ shippingAddress = undefined, billingAddress = undefined } = {}) => {
    if (!billingAddressEnabled) return shippingAddress;
    return billingAddress;
};

module.exports = {
    billingAddressEnabled,
    resolveBillingAddress
};
