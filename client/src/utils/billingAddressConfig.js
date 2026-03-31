export const billingAddressEnabled = String(import.meta.env.VITE_ENABLE_BILLING_ADDRESS || '')
    .trim()
    .toLowerCase() === 'true';

