export const normalizeStorefrontMobileInput = (value = '') => String(value || '').replace(/\D/g, '').slice(0, 10);

const DISALLOWED_SEQUENCES = new Set([
    '0000000000',
    '0123456789',
    '0987654321',
    '1234567890',
    '9876543210'
]);

const isRepeatedDigitMobile = (value = '') => /^(\d)\1{9}$/.test(value);

export const getStorefrontMobileValidationMessage = (value = '') => {
    const mobile = normalizeStorefrontMobileInput(value);
    if (!/^\d{10}$/.test(mobile)) return 'Enter a valid 10-digit mobile number';
    if (isRepeatedDigitMobile(mobile) || DISALLOWED_SEQUENCES.has(mobile)) {
        return 'Enter a real mobile number';
    }
    return '';
};

export const isValidStorefrontMobile = (value = '') => !getStorefrontMobileValidationMessage(value);
