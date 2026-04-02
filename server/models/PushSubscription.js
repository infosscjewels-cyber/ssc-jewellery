const db = require('../config/db');

const normalizeScope = (value = []) => {
    const source = Array.isArray(value) ? value : [];
    return [...new Set(source.map((entry) => String(entry || '').trim()).filter(Boolean))];
};

class PushSubscription {
    static async upsert({
        userId,
        fcmToken,
        platform = 'web',
        deviceLabel = '',
        userAgent = '',
        notificationsEnabled = true,
        scope = []
    } = {}) {
        const normalizedUserId = String(userId || '').trim();
        const normalizedToken = String(fcmToken || '').trim();
        if (!normalizedUserId || !normalizedToken) {
            throw new Error('User ID and FCM token are required');
        }

        const normalizedScope = JSON.stringify(normalizeScope(scope));
        await db.execute(
            `INSERT INTO push_subscriptions
                (user_id, platform, fcm_token, device_label, user_agent, notifications_enabled, scope_json, last_seen_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
                user_id = VALUES(user_id),
                platform = VALUES(platform),
                device_label = VALUES(device_label),
                user_agent = VALUES(user_agent),
                notifications_enabled = VALUES(notifications_enabled),
                scope_json = VALUES(scope_json),
                last_seen_at = UTC_TIMESTAMP()`,
            [
                normalizedUserId,
                String(platform || 'web').trim().slice(0, 20) || 'web',
                normalizedToken,
                String(deviceLabel || '').trim().slice(0, 120),
                String(userAgent || '').trim().slice(0, 1000),
                notificationsEnabled === false ? 0 : 1,
                normalizedScope
            ]
        );
        return this.findByToken(normalizedToken);
    }

    static async findByToken(fcmToken = '') {
        const normalizedToken = String(fcmToken || '').trim();
        if (!normalizedToken) return null;
        const [rows] = await db.execute(
            'SELECT * FROM push_subscriptions WHERE fcm_token = ? LIMIT 1',
            [normalizedToken]
        );
        return rows[0] || null;
    }

    static async removeByToken({ userId = '', fcmToken = '' } = {}) {
        const normalizedUserId = String(userId || '').trim();
        const normalizedToken = String(fcmToken || '').trim();
        if (!normalizedUserId || !normalizedToken) return;
        await db.execute(
            'DELETE FROM push_subscriptions WHERE user_id = ? AND fcm_token = ?',
            [normalizedUserId, normalizedToken]
        );
    }

    static async disableTokens(tokens = []) {
        const normalized = [...new Set((tokens || []).map((token) => String(token || '').trim()).filter(Boolean))];
        if (!normalized.length) return;
        const placeholders = normalized.map(() => '?').join(',');
        await db.execute(
            `UPDATE push_subscriptions
             SET notifications_enabled = 0, updated_at = CURRENT_TIMESTAMP
             WHERE fcm_token IN (${placeholders})`,
            normalized
        );
    }

    static async listTokensByUserIds(userIds = []) {
        const normalized = [...new Set((userIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
        if (!normalized.length) return [];
        const placeholders = normalized.map(() => '?').join(',');
        const [rows] = await db.execute(
            `SELECT ps.*, u.role, u.isActive
             FROM push_subscriptions ps
             INNER JOIN users u ON u.id = ps.user_id
             WHERE ps.notifications_enabled = 1
               AND u.isActive <> 0
               AND ps.user_id IN (${placeholders})`,
            normalized
        );
        return rows || [];
    }

    static async listAdminTokens() {
        const [rows] = await db.execute(
            `SELECT ps.*, u.role, u.isActive
             FROM push_subscriptions ps
             INNER JOIN users u ON u.id = ps.user_id
             WHERE ps.notifications_enabled = 1
               AND u.isActive <> 0
               AND LOWER(COALESCE(u.role, '')) IN ('admin', 'staff')`
        );
        return rows || [];
    }
}

module.exports = PushSubscription;
