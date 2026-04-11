const db = require('../config/db');
const User = require('../models/User');

const DEFAULT_INACTIVE_DAYS = 90;
const DEFAULT_SCAN_LIMIT = 200;

const toPositiveInt = (value, fallback) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const buildCutoffDate = (days) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

const getInactiveCustomerArchiveCandidates = async ({ inactiveDays = DEFAULT_INACTIVE_DAYS, limit = DEFAULT_SCAN_LIMIT } = {}) => {
    const safeDays = toPositiveInt(inactiveDays, DEFAULT_INACTIVE_DAYS);
    const safeLimit = Math.min(1000, toPositiveInt(limit, DEFAULT_SCAN_LIMIT));
    const cutoff = buildCutoffDate(safeDays);

    const [rows] = await db.execute(
        `SELECT u.id
         FROM users u
         LEFT JOIN user_loyalty ul ON ul.user_id = u.id
         WHERE LOWER(COALESCE(u.role, 'customer')) = 'customer'
           AND COALESCE(u.is_active, 1) = 1
           AND COALESCE(u.is_archived, 0) = 0
           AND u.created_at < ?
           AND NOT EXISTS (
                SELECT 1
                FROM cart_items ci
                WHERE ci.user_id = u.id
           )
           AND NOT EXISTS (
                SELECT 1
                FROM orders o
                WHERE o.user_id = u.id
                  AND (
                    LOWER(COALESCE(o.payment_status, '')) IN ('paid', 'captured')
                    OR LOWER(COALESCE(o.status, '')) IN ('confirmed', 'processing', 'shipped', 'delivered', 'completed')
                  )
           )
           AND NOT EXISTS (
                SELECT 1
                FROM abandoned_cart_candidates ac
                WHERE ac.user_id = u.id
                  AND COALESCE(ac.last_activity_at, ac.updated_at, ac.created_at) >= ?
           )
           AND NOT EXISTS (
                SELECT 1
                FROM abandoned_cart_journeys aj
                WHERE aj.user_id = u.id
                  AND (
                    LOWER(COALESCE(aj.status, '')) IN ('active', 'pending', 'scheduled', 'processing')
                    OR COALESCE(aj.last_activity_at, aj.updated_at, aj.created_at) >= ?
                  )
           )
           AND NOT EXISTS (
                SELECT 1
                FROM coupon_user_targets cut
                INNER JOIN coupons c ON c.id = cut.coupon_id
                WHERE cut.user_id = u.id
                  AND c.is_active = 1
                  AND (c.starts_at IS NULL OR c.starts_at <= NOW())
                  AND (c.expires_at IS NULL OR c.expires_at >= NOW())
           )
           AND LOWER(COALESCE(ul.tier, 'regular')) IN ('regular', 'basic')
           AND (
                COALESCE(ul.spend_30d, 0)
                + COALESCE(ul.spend_60d, 0)
                + COALESCE(ul.spend_90d, 0)
                + COALESCE(ul.spend_365d, 0)
           ) = 0
         ORDER BY u.created_at ASC
         LIMIT ?`,
        [cutoff, cutoff, cutoff, safeLimit]
    );

    return rows.map((row) => String(row.id)).filter(Boolean);
};

const archiveInactiveCustomers = async ({
    inactiveDays = DEFAULT_INACTIVE_DAYS,
    limit = DEFAULT_SCAN_LIMIT,
    dryRun = false,
    reason = 'inactive_customer_cleanup'
} = {}) => {
    const candidateIds = await getInactiveCustomerArchiveCandidates({ inactiveDays, limit });
    if (dryRun || candidateIds.length === 0) {
        return {
            scanned: candidateIds.length,
            archived: 0,
            dryRun: Boolean(dryRun),
            ids: candidateIds
        };
    }

    const placeholders = candidateIds.map(() => '?').join(', ');
    await db.execute(
        `UPDATE users
         SET is_archived = 1,
             archived_at = NOW(),
             archive_reason = ?
         WHERE id IN (${placeholders})
           AND COALESCE(is_archived, 0) = 0`,
        [String(reason || 'inactive_customer_cleanup').slice(0, 255), ...candidateIds]
    );

    const archivedUsers = await Promise.all(candidateIds.map((id) => User.findById(id)));

    return {
        scanned: candidateIds.length,
        archived: archivedUsers.filter(Boolean).length,
        dryRun: false,
        ids: candidateIds,
        users: archivedUsers.filter(Boolean)
    };
};

module.exports = {
    archiveInactiveCustomers,
    getInactiveCustomerArchiveCandidates
};
