const crypto = require('crypto');

const normalizeObjectEntries = (payload = {}, { excludeKeys = [] } = {}) => {
    const blocked = new Set((excludeKeys || []).map((key) => String(key || '').trim().toLowerCase()));
    return Object.entries(payload || {})
        .filter(([key, value]) => {
            const normalizedKey = String(key || '').trim();
            if (!normalizedKey) return false;
            if (blocked.has(normalizedKey.toLowerCase())) return false;
            if (value === undefined || value === null) return false;
            const normalizedValue = String(value).trim();
            return normalizedValue !== '';
        })
        .sort(([left], [right]) => {
            const leftKey = String(left || '');
            const rightKey = String(right || '');
            if (leftKey < rightKey) return -1;
            if (leftKey > rightKey) return 1;
            return 0;
        });
};

const buildIciciPlainHashText = (payload = {}, options = {}) => (
    normalizeObjectEntries(payload, options)
        .map(([, value]) => String(value).trim())
        .join('')
);

const generateIciciSecureHash = ({ payload = {}, secretKey = '', excludeKeys = [] } = {}) => {
    const safeSecretKey = String(secretKey || '').trim();
    if (!safeSecretKey) {
        throw new Error('ICICI secret key is not configured');
    }
    const plainHashText = buildIciciPlainHashText(payload, { excludeKeys });
    const secureHash = crypto
        .createHmac('sha256', safeSecretKey)
        .update(plainHashText)
        .digest('hex');
    return {
        plainHashText,
        secureHash
    };
};

const verifyIciciSecureHash = ({ payload = {}, secureHash = '', secretKey = '', excludeKeys = ['secureHash'] } = {}) => {
    const providedHash = String(secureHash || payload?.secureHash || '').trim().toLowerCase();
    if (!providedHash) return false;
    const { secureHash: generatedHash } = generateIciciSecureHash({
        payload,
        secretKey,
        excludeKeys
    });
    try {
        return crypto.timingSafeEqual(
            Buffer.from(generatedHash, 'utf8'),
            Buffer.from(providedHash, 'utf8')
        );
    } catch {
        return false;
    }
};

module.exports = {
    buildIciciPlainHashText,
    generateIciciSecureHash,
    verifyIciciSecureHash
};
