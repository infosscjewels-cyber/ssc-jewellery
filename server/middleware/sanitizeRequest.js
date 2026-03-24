const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const sanitizeScalar = (value) => {
    if (typeof value !== 'string') return value;
    return value.replace(CONTROL_CHAR_REGEX, '');
};

const sanitizeAny = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => sanitizeAny(entry));
    }
    if (value && typeof value === 'object') {
        const sanitized = {};
        Object.keys(value).forEach((key) => {
            if (BLOCKED_KEYS.has(key)) return;
            sanitized[key] = sanitizeAny(value[key]);
        });
        return sanitized;
    }
    return sanitizeScalar(value);
};

const sanitizeRequest = (req, _res, next) => {
    if (req.body && typeof req.body === 'object') {
        req.body = sanitizeAny(req.body);
    }
    if (req.query && typeof req.query === 'object') {
        req.query = sanitizeAny(req.query);
    }
    if (req.params && typeof req.params === 'object') {
        req.params = sanitizeAny(req.params);
    }
    next();
};

module.exports = sanitizeRequest;
