const normalizeMobile = (value = '') => String(value || '').replace(/\D/g, '');

const DISALLOWED_SEQUENCES = new Set([
    '0000000000',
    '0123456789',
    '0987654321',
    '1234567890',
    '9876543210'
]);

const isRepeatedDigitMobile = (mobile = '') => /^(\d)\1{9}$/.test(String(mobile || ''));

const isSuspiciousMobile = (value = '') => {
    const mobile = normalizeMobile(value);
    if (!/^\d{10}$/.test(mobile)) return true;
    if (DISALLOWED_SEQUENCES.has(mobile)) return true;
    if (isRepeatedDigitMobile(mobile)) return true;
    return false;
};

const getStorefrontMobileValidationMessage = (value = '') => {
    const mobile = normalizeMobile(value);
    if (!/^\d{10}$/.test(mobile)) return 'Mobile must be 10 digits.';
    if (isRepeatedDigitMobile(mobile) || DISALLOWED_SEQUENCES.has(mobile)) {
        return 'Enter a valid mobile number.';
    }
    return '';
};

module.exports = {
    normalizeMobile,
    isSuspiciousMobile,
    getStorefrontMobileValidationMessage
};
