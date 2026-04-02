const admin = require('../config/firebase');
const PushSubscription = require('../models/PushSubscription');

const MAX_TOKENS_PER_BATCH = 500;

const isPushEnabled = () => String(process.env.ENABLE_PUSH_NOTIFICATIONS || 'true').trim().toLowerCase() !== 'false';

const chunk = (items = [], size = MAX_TOKENS_PER_BATCH) => {
    const out = [];
    for (let index = 0; index < items.length; index += size) {
        out.push(items.slice(index, index + size));
    }
    return out;
};

const normalizeDataPayload = (data = {}) => Object.fromEntries(
    Object.entries(data || {})
        .filter(([, value]) => value !== undefined && value !== null)
        .map(([key, value]) => [key, String(value)])
);

const extractInvalidTokens = (tokens = [], batchResponse = null) => {
    const failures = [];
    const responses = Array.isArray(batchResponse?.responses) ? batchResponse.responses : [];
    responses.forEach((response, index) => {
        if (response?.success) return;
        const code = String(response?.error?.code || '').trim();
        if (code === 'messaging/registration-token-not-registered' || code === 'messaging/invalid-registration-token') {
            failures.push(tokens[index]);
        }
    });
    return failures;
};

const sendToTokenRows = async (rows = [], {
    title = '',
    body = '',
    data = {},
    link = '/',
    tag = '',
    icon = '/logo.webp'
} = {}) => {
    if (!isPushEnabled()) return { sent: 0, failed: 0, skipped: rows.length };
    const tokens = [...new Set((rows || []).map((row) => String(row?.fcm_token || '').trim()).filter(Boolean))];
    if (!tokens.length) return { sent: 0, failed: 0, skipped: 0 };

    const payload = {
        notification: {
            title: String(title || '').trim() || 'SSC Jewels',
            body: String(body || '').trim() || ''
        },
        data: normalizeDataPayload(data),
        webpush: {
            notification: {
                title: String(title || '').trim() || 'SSC Jewels',
                body: String(body || '').trim() || '',
                icon,
                badge: icon,
                tag: String(tag || '').trim() || undefined
            },
            fcmOptions: {
                link: String(link || '/').trim() || '/'
            }
        }
    };

    let sent = 0;
    let failed = 0;
    const invalidTokens = [];

    for (const tokenBatch of chunk(tokens, MAX_TOKENS_PER_BATCH)) {
        try {
            const response = await admin.messaging().sendEachForMulticast({
                tokens: tokenBatch,
                ...payload
            });
            sent += Number(response?.successCount || 0);
            failed += Number(response?.failureCount || 0);
            invalidTokens.push(...extractInvalidTokens(tokenBatch, response));
        } catch (error) {
            failed += tokenBatch.length;
            console.warn('Push notification batch failed:', error?.message || error);
        }
    }

    if (invalidTokens.length) {
        PushSubscription.disableTokens(invalidTokens).catch((error) => {
            console.warn('Failed to disable invalid push tokens:', error?.message || error);
        });
    }

    return { sent, failed, skipped: 0 };
};

const sendToAdmins = async ({
    title,
    body,
    data = {},
    link = '/admin',
    tag = ''
} = {}) => {
    try {
        const rows = await PushSubscription.listAdminTokens();
        return await sendToTokenRows(rows, { title, body, data, link, tag });
    } catch (error) {
        console.warn('Admin push notification failed:', error?.message || error);
        return { sent: 0, failed: 0, skipped: 0 };
    }
};

const sendToUsers = async (userIds = [], {
    title,
    body,
    data = {},
    link = '/',
    tag = ''
} = {}) => {
    try {
        const rows = await PushSubscription.listTokensByUserIds(userIds);
        return await sendToTokenRows(rows, { title, body, data, link, tag });
    } catch (error) {
        console.warn('User push notification failed:', error?.message || error);
        return { sent: 0, failed: 0, skipped: 0 };
    }
};

module.exports = {
    sendToAdmins,
    sendToUsers
};
