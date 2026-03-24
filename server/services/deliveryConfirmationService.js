const crypto = require('crypto');

const DELIVERY_TOKEN_TTL_DAYS = Number(process.env.DELIVERY_CONFIRM_TTL_DAYS || 30);
const isNonProductionLike = () => ['development', 'dev', 'test'].includes(String(process.env.NODE_ENV || '').trim().toLowerCase());

const getSecret = () => {
    const secret = String(process.env.DELIVERY_CONFIRM_SECRET || process.env.JWT_SECRET || '').trim();
    if (secret) return secret;
    if (isNonProductionLike()) return 'ssc-delivery-confirm-secret';
    throw new Error('DELIVERY_CONFIRM_SECRET or JWT_SECRET must be configured');
};

const resolveBaseUrl = (baseUrl = '') => {
    const explicit = String(baseUrl || '').trim().replace(/\/+$/, '');
    if (explicit) return explicit;
    const envBase = String(
        process.env.APP_BASE_URL
        || process.env.PUBLIC_BASE_URL
        || process.env.APP_URL
        || process.env.URL
        || process.env.RENDER_EXTERNAL_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
        || ''
    ).trim().replace(/\/+$/, '');
    if (envBase) return envBase;
    const port = Number(process.env.PORT || 5000);
    return `http://localhost:${port}`;
};

const signPayload = ({ orderId, userId, exp }) => {
    const payload = `${orderId}.${userId}.${exp}`;
    return crypto.createHmac('sha256', getSecret()).update(payload).digest('hex');
};

const buildDeliveryConfirmationUrl = ({
    orderId,
    userId,
    baseUrl = ''
} = {}) => {
    const numericOrderId = Number(orderId);
    const safeUserId = String(userId || '').trim();
    if (!Number.isFinite(numericOrderId) || numericOrderId <= 0 || !safeUserId) {
        return '';
    }
    const exp = Math.floor(Date.now() / 1000) + (DELIVERY_TOKEN_TTL_DAYS * 24 * 60 * 60);
    const sig = signPayload({ orderId: numericOrderId, userId: safeUserId, exp });
    const root = resolveBaseUrl(baseUrl);
    if (!root) return '';
    return `${root}/api/orders/delivery/confirm?oid=${encodeURIComponent(numericOrderId)}&uid=${encodeURIComponent(safeUserId)}&exp=${encodeURIComponent(exp)}&sig=${encodeURIComponent(sig)}`;
};

const verifyDeliveryToken = ({ orderId, userId, exp, sig } = {}) => {
    const numericOrderId = Number(orderId);
    const safeUserId = String(userId || '').trim();
    const expiry = Number(exp);
    const signature = String(sig || '').trim();

    if (!Number.isFinite(numericOrderId) || numericOrderId <= 0) return { ok: false, reason: 'invalid_order' };
    if (!safeUserId) return { ok: false, reason: 'invalid_user' };
    if (!Number.isFinite(expiry) || expiry <= 0) return { ok: false, reason: 'invalid_expiry' };
    if (!signature) return { ok: false, reason: 'invalid_signature' };
    if (Math.floor(Date.now() / 1000) > expiry) return { ok: false, reason: 'expired' };

    const expected = signPayload({ orderId: numericOrderId, userId: safeUserId, exp: expiry });
    const a = Buffer.from(signature, 'utf8');
    const b = Buffer.from(expected, 'utf8');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, reason: 'signature_mismatch' };
    }
    return { ok: true, orderId: numericOrderId, userId: safeUserId };
};

module.exports = {
    buildDeliveryConfirmationUrl,
    verifyDeliveryToken
};
