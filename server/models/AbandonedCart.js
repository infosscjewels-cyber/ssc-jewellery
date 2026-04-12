const db = require('../config/db');

const DEFAULT_CAMPAIGN = Object.freeze({
    enabled: true,
    inactivityMinutes: 30,
    maxAttempts: 4,
    attemptDelaysMinutes: [30, 360, 1440, 2880],
    discountLadderPercent: [0, 0, 5, 10],
    maxDiscountPercent: 25,
    minDiscountCartSubunits: 0,
    minDiscountCartValue: 0,
    recoveryWindowHours: 72,
    sendEmail: true,
    sendWhatsapp: true,
    sendPaymentLink: true,
    reminderEnable: true
});
const DUE_GRACE_SECONDS = 90;
const MAX_CAMPAIGN_ATTEMPTS = 6;
const RECOVERY_WINDOW_BUFFER_HOURS = 2;
const JOURNEY_PROCESSING_TIMEOUT_MINUTES = 10;

const parseJson = (value, fallback = null) => {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const parseUtcDateSafe = (value) => {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    const raw = String(value).trim();
    if (!raw) return null;
    const mysqlMatch = raw.match(
        /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/
    );
    if (mysqlMatch) {
        const [, y, m, d, hh = '00', mm = '00', ss = '00'] = mysqlMatch;
        const utc = new Date(Date.UTC(
            Number(y),
            Number(m) - 1,
            Number(d),
            Number(hh),
            Number(mm),
            Number(ss)
        ));
        return Number.isNaN(utc.getTime()) ? null : utc;
    }
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const normalizeCampaignRow = (row = {}) => {
    const delays = parseJson(row.attempt_delays_json, DEFAULT_CAMPAIGN.attemptDelaysMinutes);
    const ladder = parseJson(row.discount_ladder_json, DEFAULT_CAMPAIGN.discountLadderPercent);
    return {
        id: row.id || 1,
        enabled: Number(row.enabled) === 1,
        inactivityMinutes: Number(row.inactivity_minutes || DEFAULT_CAMPAIGN.inactivityMinutes),
        maxAttempts: Number(row.max_attempts || DEFAULT_CAMPAIGN.maxAttempts),
        attemptDelaysMinutes: Array.isArray(delays) && delays.length ? delays.map((n) => Number(n || 0)) : [...DEFAULT_CAMPAIGN.attemptDelaysMinutes],
        discountLadderPercent: Array.isArray(ladder) && ladder.length ? ladder.map((n) => Number(n || 0)) : [...DEFAULT_CAMPAIGN.discountLadderPercent],
        maxDiscountPercent: Number(row.max_discount_percent || DEFAULT_CAMPAIGN.maxDiscountPercent),
        minDiscountCartSubunits: Math.max(0, Number(row.min_discount_cart_subunits || DEFAULT_CAMPAIGN.minDiscountCartSubunits || 0)),
        minDiscountCartValue: Math.max(0, Number(row.min_discount_cart_subunits || DEFAULT_CAMPAIGN.minDiscountCartSubunits || 0) / 100),
        recoveryWindowHours: Number(row.recovery_window_hours || DEFAULT_CAMPAIGN.recoveryWindowHours),
        sendEmail: Number(row.send_email) === 1,
        sendWhatsapp: Number(row.send_whatsapp) === 1,
        sendPaymentLink: Number(row.send_payment_link) === 1,
        reminderEnable: Number(row.reminder_enable) === 1,
        updatedAt: row.updated_at || null
    };
};

const applyJourneyNextAttemptSchedule = (journey = {}, campaign = DEFAULT_CAMPAIGN) => {
    const row = { ...journey };
    const status = String(row.status || '').toLowerCase();
    if (status !== 'active') {
        row.next_attempt_at = null;
        return row;
    }

    const nextAttemptNo = Number(row.last_attempt_no || 0) + 1;
    const maxAttempts = Math.max(1, Number(campaign?.maxAttempts || DEFAULT_CAMPAIGN.maxAttempts));
    if (nextAttemptNo > maxAttempts) {
        row.next_attempt_at = null;
        return row;
    }

    const existingNextAttempt = toDateSafe(row.next_attempt_at);
    if (existingNextAttempt) {
        if (row.expires_at && toDateSafe(row.expires_at) && existingNextAttempt.getTime() > toDateSafe(row.expires_at).getTime()) {
            row.next_attempt_at = null;
            return row;
        }
        row.next_attempt_at = existingNextAttempt.toISOString();
        return row;
    }

    const lastActivity = toDateSafe(row.last_activity_at);
    const updatedAt = toDateSafe(row.updated_at);
    const base = [lastActivity, updatedAt].filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] || new Date();
    let computed = AbandonedCart.computeAttemptAtFromLastActivity({
        lastActivityAt: base,
        campaign,
        attemptNo: nextAttemptNo
    });
    if (row.expires_at && toDateSafe(row.expires_at) && computed.getTime() > toDateSafe(row.expires_at).getTime()) {
        row.next_attempt_at = null;
        return row;
    }
    row.next_attempt_at = computed.toISOString();
    return row;
};

const toDateSafe = (value) => parseUtcDateSafe(value);

const normalizeJourneyTimes = (journey = {}) => {
    const row = { ...journey };
    const computedLast = [
        toDateSafe(row.computed_last_activity_at),
        toDateSafe(row.last_activity_at),
        toDateSafe(row.updated_at),
        toDateSafe(row.created_at)
    ].filter(Boolean).sort((a, b) => b.getTime() - a.getTime())[0] || null;
    if (computedLast) {
        row.computed_last_activity_at = computedLast.toISOString();
    }
    const nextAttempt = toDateSafe(row.next_attempt_at);
    if (nextAttempt) {
        row.next_attempt_at = nextAttempt.toISOString();
    }
    return row;
};

const normalizePositiveInteger = (value, field, { min = 1 } = {}) => {
    const num = Number(value);
    if (!Number.isFinite(num) || !Number.isInteger(num) || num < min) {
        throw new Error(`${field} must be an integer >= ${min}`);
    }
    return num;
};

const normalizeIntegerArray = (value, field, { min = 0 } = {}) => {
    if (!Array.isArray(value)) {
        throw new Error(`${field} must be an array of integers`);
    }
    const normalized = value.map((entry) => {
        const num = Number(entry);
        if (!Number.isFinite(num) || !Number.isInteger(num) || num < min) {
            throw new Error(`${field} contains invalid value "${entry}"`);
        }
        return num;
    });
    if (!normalized.length) {
        throw new Error(`${field} cannot be empty`);
    }
    return normalized;
};

const normalizeNonNegativeNumber = (value, field) => {
    const num = Number(value);
    if (!Number.isFinite(num) || num < 0) {
        throw new Error(`${field} must be a number >= 0`);
    }
    return num;
};

class AbandonedCart {
    static async invalidateActiveDiscountsByJourney({
        journeyId,
        connection = db
    } = {}) {
        const id = Number(journeyId || 0);
        if (!Number.isFinite(id) || id <= 0) return 0;
        const [result] = await connection.execute(
            `UPDATE abandoned_cart_discounts
             SET status = 'invalidated',
                 updated_at = CURRENT_TIMESTAMP
             WHERE journey_id = ?
               AND status = 'active'`,
            [id]
        );
        return Number(result?.affectedRows || 0);
    }

    static getDefaultCampaign() {
        return { ...DEFAULT_CAMPAIGN };
    }

    static async getCampaign() {
        const [rows] = await db.execute(
            'SELECT * FROM abandoned_cart_campaigns WHERE id = 1 LIMIT 1'
        );
        if (!rows.length) return { ...DEFAULT_CAMPAIGN, id: 1 };
        return normalizeCampaignRow(rows[0]);
    }

    static async upsertCampaign(partial = {}) {
        const [rows] = await db.execute(
            'SELECT * FROM abandoned_cart_campaigns WHERE id = 1 LIMIT 1'
        );
        const current = rows.length ? normalizeCampaignRow(rows[0]) : { ...DEFAULT_CAMPAIGN, id: 1 };
        const next = {
            ...current,
            ...partial
        };
        const maxAttempts = normalizePositiveInteger(
            next.maxAttempts != null ? next.maxAttempts : DEFAULT_CAMPAIGN.maxAttempts,
            'maxAttempts',
            { min: 1 }
        );
        if (maxAttempts > MAX_CAMPAIGN_ATTEMPTS) {
            throw new Error(`maxAttempts cannot exceed ${MAX_CAMPAIGN_ATTEMPTS}`);
        }
        const inactivityMinutes = normalizePositiveInteger(
            next.inactivityMinutes != null ? next.inactivityMinutes : DEFAULT_CAMPAIGN.inactivityMinutes,
            'inactivityMinutes',
            { min: 1 }
        );
        const recoveryWindowHoursInput = normalizePositiveInteger(
            next.recoveryWindowHours != null ? next.recoveryWindowHours : DEFAULT_CAMPAIGN.recoveryWindowHours,
            'recoveryWindowHours',
            { min: 1 }
        );
        const maxDiscountPercent = normalizePositiveInteger(
            next.maxDiscountPercent != null ? next.maxDiscountPercent : DEFAULT_CAMPAIGN.maxDiscountPercent,
            'maxDiscountPercent',
            { min: 0 }
        );
        const minDiscountCartSubunits = Math.round(
            normalizeNonNegativeNumber(
                next.minDiscountCartSubunits != null
                    ? next.minDiscountCartSubunits
                    : (
                        next.minDiscountCartValue != null
                            ? Number(next.minDiscountCartValue) * 100
                            : DEFAULT_CAMPAIGN.minDiscountCartSubunits
                    ),
                'minDiscountCartValue'
            )
        );
        const attemptDelaysMinutes = normalizeIntegerArray(
            Array.isArray(next.attemptDelaysMinutes) && next.attemptDelaysMinutes.length
                ? next.attemptDelaysMinutes
                : [...DEFAULT_CAMPAIGN.attemptDelaysMinutes],
            'attemptDelaysMinutes',
            { min: 1 }
        );
        const discountLadderPercent = normalizeIntegerArray(
            Array.isArray(next.discountLadderPercent) && next.discountLadderPercent.length
                ? next.discountLadderPercent
                : [...DEFAULT_CAMPAIGN.discountLadderPercent],
            'discountLadderPercent',
            { min: 0 }
        );
        if (attemptDelaysMinutes.length !== maxAttempts) {
            throw new Error(`attemptDelaysMinutes must contain exactly ${maxAttempts} values`);
        }
        if (discountLadderPercent.length !== maxAttempts) {
            throw new Error(`discountLadderPercent must contain exactly ${maxAttempts} values`);
        }
        if (discountLadderPercent.some((entry) => entry > maxDiscountPercent)) {
            throw new Error('discountLadderPercent cannot exceed maxDiscountPercent');
        }
        const totalAttemptDelayMinutes = attemptDelaysMinutes
            .slice(0, maxAttempts)
            .reduce((sum, value) => sum + Number(value || 0), 0);
        const minRecoveryWindowHours = Math.max(
            1,
            Math.ceil(totalAttemptDelayMinutes / 60) + RECOVERY_WINDOW_BUFFER_HOURS
        );
        const recoveryWindowHours = Math.max(recoveryWindowHoursInput, minRecoveryWindowHours);

        const sendWhatsapp = Boolean(next.sendWhatsapp);
        const sendEmail = Boolean(next.sendEmail) || !sendWhatsapp;

        await db.execute(
            `INSERT INTO abandoned_cart_campaigns
                (id, enabled, inactivity_minutes, max_attempts, attempt_delays_json, discount_ladder_json, max_discount_percent, min_discount_cart_subunits, recovery_window_hours, send_email, send_whatsapp, send_payment_link, reminder_enable)
             VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
                enabled = VALUES(enabled),
                inactivity_minutes = VALUES(inactivity_minutes),
                max_attempts = VALUES(max_attempts),
                attempt_delays_json = VALUES(attempt_delays_json),
                discount_ladder_json = VALUES(discount_ladder_json),
                max_discount_percent = VALUES(max_discount_percent),
                min_discount_cart_subunits = VALUES(min_discount_cart_subunits),
                recovery_window_hours = VALUES(recovery_window_hours),
                send_email = VALUES(send_email),
                send_whatsapp = VALUES(send_whatsapp),
                send_payment_link = VALUES(send_payment_link),
                reminder_enable = VALUES(reminder_enable),
                updated_at = CURRENT_TIMESTAMP`,
            [
                next.enabled ? 1 : 0,
                inactivityMinutes,
                maxAttempts,
                JSON.stringify(attemptDelaysMinutes),
                JSON.stringify(discountLadderPercent),
                maxDiscountPercent,
                minDiscountCartSubunits,
                recoveryWindowHours,
                sendEmail ? 1 : 0,
                sendWhatsapp ? 1 : 0,
                next.sendPaymentLink ? 1 : 0,
                next.reminderEnable ? 1 : 0
            ]
        );
        const nextCampaign = await AbandonedCart.getCampaign();
        await AbandonedCart.realignActiveJourneySchedules(nextCampaign);
        return nextCampaign;
    }

    static resolveAttemptDelayMinutes(campaign, attemptNo) {
        const delays = Array.isArray(campaign?.attemptDelaysMinutes) ? campaign.attemptDelaysMinutes : [];
        const idx = Math.max(0, Number(attemptNo || 1) - 1);
        const fallback = Number(campaign?.inactivityMinutes || DEFAULT_CAMPAIGN.inactivityMinutes);
        return Math.max(1, Number(delays[idx] != null ? delays[idx] : delays[delays.length - 1] || fallback));
    }

    static resolveDiscountPercent(campaign, attemptNo) {
        const ladder = Array.isArray(campaign?.discountLadderPercent) ? campaign.discountLadderPercent : [];
        const idx = Math.max(0, Number(attemptNo || 1) - 1);
        const raw = Number(ladder[idx] != null ? ladder[idx] : ladder[ladder.length - 1] || 0);
        return Math.max(0, Math.min(raw, Number(campaign?.maxDiscountPercent || DEFAULT_CAMPAIGN.maxDiscountPercent)));
    }

    static computeNextAttemptAt({ baseDate = new Date(), campaign, nextAttemptNo = 1 }) {
        const delay = AbandonedCart.resolveAttemptDelayMinutes(campaign, nextAttemptNo);
        return new Date(new Date(baseDate).getTime() + delay * 60 * 1000);
    }

    static computeAttemptAtFromLastActivity({ lastActivityAt = new Date(), campaign, attemptNo = 1 }) {
        const safeAttemptNo = Math.max(1, Number(attemptNo || 1));
        let totalDelayMinutes = 0;
        for (let i = 1; i <= safeAttemptNo; i += 1) {
            totalDelayMinutes += AbandonedCart.resolveAttemptDelayMinutes(campaign, i);
        }
        return new Date(new Date(lastActivityAt).getTime() + totalDelayMinutes * 60 * 1000);
    }

    static async getActiveJourneyByUser(userId) {
        const [rows] = await db.execute(
            `SELECT * FROM abandoned_cart_journeys
             WHERE user_id = ? AND status = 'active'
             ORDER BY id DESC LIMIT 1`,
            [userId]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            cart_snapshot_json: parseJson(row.cart_snapshot_json, [])
        };
    }

    static async upsertCandidate({
        userId,
        cartItemCount,
        cartTotalSubunits,
        currency = 'INR'
    }) {
        if (!userId) return 0;
        const [result] = await db.execute(
            `INSERT INTO abandoned_cart_candidates
                (user_id, cart_item_count, cart_total_subunits, currency, last_activity_at)
             VALUES (?, ?, ?, ?, UTC_TIMESTAMP())
             ON DUPLICATE KEY UPDATE
                cart_item_count = VALUES(cart_item_count),
                cart_total_subunits = VALUES(cart_total_subunits),
                currency = VALUES(currency),
                last_activity_at = UTC_TIMESTAMP(),
                updated_at = UTC_TIMESTAMP()`,
            [
                userId,
                Number(cartItemCount || 0),
                Number(cartTotalSubunits || 0),
                String(currency || 'INR')
            ]
        );
        return Number(result?.affectedRows || 0);
    }

    static async deleteCandidate(userId) {
        if (!userId) return 0;
        const [result] = await db.execute(
            'DELETE FROM abandoned_cart_candidates WHERE user_id = ?',
            [userId]
        );
        return Number(result?.affectedRows || 0);
    }

    static async listDueCandidates({ inactivityMinutes = 30, limit = 50 } = {}) {
        const safeMinutes = Math.max(1, Number(inactivityMinutes || 30));
        const [rows] = await db.execute(
            `SELECT * FROM abandoned_cart_candidates
             WHERE last_activity_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
             ORDER BY last_activity_at ASC
             LIMIT ?`,
            [safeMinutes, Number(limit || 50)]
        );
        return rows;
    }

    static async createJourneyFromCandidate({
        candidate,
        campaign
    }) {
        if (!candidate?.user_id) return null;
        const lastActivity = new Date(candidate.last_activity_at || Date.now());
        const nextAttemptAt = AbandonedCart.computeAttemptAtFromLastActivity({
            lastActivityAt: lastActivity,
            campaign,
            attemptNo: 1
        });
        const expiresAt = new Date(lastActivity.getTime() + Number(campaign?.recoveryWindowHours || 72) * 60 * 60 * 1000);
        const [inserted] = await db.execute(
            `INSERT INTO abandoned_cart_journeys
                (user_id, status, cart_item_count, cart_total_subunits, currency, cart_snapshot_json, last_activity_at, last_attempt_no, next_attempt_at, expires_at)
             VALUES (?, 'active', ?, ?, ?, ?, ?, 0, ?, ?)`,
            [
                candidate.user_id,
                Number(candidate.cart_item_count || 0),
                Number(candidate.cart_total_subunits || 0),
                String(candidate.currency || 'INR'),
                JSON.stringify([]),
                lastActivity,
                nextAttemptAt,
                expiresAt
            ]
        );
        return { id: inserted.insertId };
    }

    static async touchJourney({
        userId,
        cartItemCount,
        cartTotalSubunits,
        currency = 'INR',
        cartSnapshot = [],
        campaign
    }) {
        const active = await AbandonedCart.getActiveJourneyByUser(userId);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + Number(campaign?.recoveryWindowHours || 72) * 60 * 60 * 1000);

        if (!active) {
            const nextAttemptAt = AbandonedCart.computeAttemptAtFromLastActivity({
                lastActivityAt: now,
                campaign,
                attemptNo: 1
            });
            const [inserted] = await db.execute(
            `INSERT INTO abandoned_cart_journeys
                (user_id, status, cart_item_count, cart_total_subunits, currency, cart_snapshot_json, last_activity_at, last_attempt_no, next_attempt_at, expires_at)
             VALUES (?, 'active', ?, ?, ?, ?, UTC_TIMESTAMP(), 0, ?, ?)`,
                [
                    userId,
                    Number(cartItemCount || 0),
                    Number(cartTotalSubunits || 0),
                    String(currency || 'INR'),
                    JSON.stringify(cartSnapshot || []),
                    nextAttemptAt,
                    expiresAt
                ]
            );
            return { id: inserted.insertId, created: true };
        }

        const preservedAttemptNo = Math.max(0, Number(active.last_attempt_no || 0));
        const nextAttemptNo = preservedAttemptNo + 1;
        const hasNextAttempt = nextAttemptNo <= Math.max(1, Number(campaign?.maxAttempts || DEFAULT_CAMPAIGN.maxAttempts));
        const nextAttemptAt = hasNextAttempt
            ? AbandonedCart.computeNextAttemptAt({
                baseDate: now,
                campaign,
                nextAttemptNo
            })
            : null;

        await db.execute(
            `UPDATE abandoned_cart_journeys
             SET cart_item_count = ?,
                 cart_total_subunits = ?,
                 currency = ?,
                 last_activity_at = UTC_TIMESTAMP(),
                 last_attempt_no = ?,
                 next_attempt_at = ?,
                 expires_at = ?,
                 status = 'active',
                 recovered_order_id = NULL,
                 recovered_at = NULL,
                 recovery_reason = NULL,
                 processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = UTC_TIMESTAMP()
             WHERE id = ?`,
            [
                Number(cartItemCount || 0),
                Number(cartTotalSubunits || 0),
                String(currency || 'INR'),
                preservedAttemptNo,
                nextAttemptAt,
                expiresAt,
                active.id
            ]
        );
        return { id: active.id, updated: true };
    }

    static async updateJourneySnapshot({
        journeyId,
        cartSnapshot = [],
        cartItemCount = null,
        cartTotalSubunits = null,
        currency = null
    } = {}) {
        if (!journeyId) return 0;
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys
             SET cart_snapshot_json = ?,
                 cart_item_count = COALESCE(?, cart_item_count),
                 cart_total_subunits = COALESCE(?, cart_total_subunits),
                 currency = COALESCE(?, currency),
                 updated_at = UTC_TIMESTAMP()
             WHERE id = ?`,
            [
                JSON.stringify(cartSnapshot || []),
                cartItemCount != null ? Number(cartItemCount) : null,
                cartTotalSubunits != null ? Number(cartTotalSubunits) : null,
                currency ? String(currency) : null,
                Number(journeyId)
            ]
        );
        return Number(result?.affectedRows || 0);
    }

    static async closeActiveJourneyByUser({
        userId,
        status = 'cancelled',
        recoveredOrderId = null,
        reason = null
    }) {
        const markRecovered = String(status || '').toLowerCase() === 'recovered' ? 1 : 0;
        const [activeRows] = await db.execute(
            `SELECT id
             FROM abandoned_cart_journeys
             WHERE user_id = ? AND status = 'active'`,
            [userId]
        );
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys
             SET status = ?,
                 recovered_order_id = ?,
                 recovered_at = CASE WHEN ? = 1 THEN CURRENT_TIMESTAMP ELSE recovered_at END,
                 recovery_reason = ?,
                 next_attempt_at = NULL,
                 processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ? AND status = 'active'`,
            [status, recoveredOrderId, markRecovered, reason ? String(reason).slice(0, 200) : null, userId]
        );
        if (['recovered', 'cancelled', 'expired'].includes(String(status || '').toLowerCase())) {
            for (const row of activeRows) {
                await AbandonedCart.invalidateActiveDiscountsByJourney({ journeyId: row.id, connection: db });
            }
        }
        return Number(result?.affectedRows || 0);
    }

    static async markLatestJourneyRecoveredByUser({
        userId,
        recoveredOrderId = null,
        reason = 'order_paid',
        maxAgeHours = null
    }) {
        if (!userId) return 0;
        const hours = maxAgeHours != null ? Math.max(1, Number(maxAgeHours || 0)) : null;
        const [targetRows] = await db.execute(
            `SELECT id
             FROM abandoned_cart_journeys
             WHERE user_id = ?
               AND status IN ('active', 'cancelled')
               AND recovered_order_id IS NULL
               ${hours ? 'AND created_at >= DATE_SUB(NOW(), INTERVAL ? HOUR)' : ''}
             ORDER BY created_at DESC
             LIMIT 1`,
            hours ? [userId, hours] : [userId]
        );
        if (!targetRows.length) return 0;
        const targetJourneyId = Number(targetRows[0].id || 0);
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys
             SET status = 'recovered',
                 recovered_order_id = ?,
                 recovered_at = CURRENT_TIMESTAMP,
                 recovery_reason = ?,
                 next_attempt_at = NULL,
                 processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [recoveredOrderId || null, String(reason || 'order_paid').slice(0, 200), targetJourneyId]
        );
        if (Number(result?.affectedRows || 0) > 0) {
            await AbandonedCart.invalidateActiveDiscountsByJourney({ journeyId: targetJourneyId, connection: db });
        }
        return Number(result?.affectedRows || 0);
    }

    static async markJourneyRecoveredById({ journeyId, recoveredOrderId = null, reason = 'order_paid' } = {}) {
        if (!journeyId) return 0;
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys
             SET status = 'recovered',
                 recovered_order_id = ?,
                 recovered_at = CURRENT_TIMESTAMP,
                 recovery_reason = ?,
                 next_attempt_at = NULL,
                 processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
            WHERE id = ?`,
            [recoveredOrderId || null, String(reason || 'order_paid').slice(0, 200), Number(journeyId)]
        );
        if (Number(result?.affectedRows || 0) > 0) {
            await AbandonedCart.invalidateActiveDiscountsByJourney({ journeyId, connection: db });
        }
        return Number(result?.affectedRows || 0);
    }

    static async getDueJourneys({ limit = 25 } = {}) {
        await AbandonedCart.closeExpiredJourneys();
        await AbandonedCart.closeActiveJourneysWithEmptyCarts();
        const now = new Date();
        const [rows] = await db.execute(
            `SELECT j.*
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             WHERE j.status = 'active'
               AND LOWER(COALESCE(u.role, 'customer')) = 'customer'
               AND COALESCE(u.is_active, 0) = 1
               AND next_attempt_at IS NOT NULL
               AND next_attempt_at <= DATE_ADD(?, INTERVAL ? SECOND)
               AND (
                    j.processing_started_at IS NULL
                    OR j.processing_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
               )
               AND (expires_at IS NULL OR expires_at > ?)
             ORDER BY j.next_attempt_at ASC
             LIMIT ?`,
            [now, DUE_GRACE_SECONDS, JOURNEY_PROCESSING_TIMEOUT_MINUTES, now, Number(limit || 25)]
        );
        return rows.map((row) => ({
            ...row,
            cart_snapshot_json: parseJson(row.cart_snapshot_json, [])
        }));
    }

    static async closeActiveJourneysWithEmptyCarts() {
        const [rows] = await db.execute(
            `SELECT j.id
             FROM abandoned_cart_journeys j
             LEFT JOIN (
                SELECT user_id, COUNT(*) as item_count
                FROM cart_items
                GROUP BY user_id
             ) c ON c.user_id = j.user_id
             WHERE j.status = 'active'
               AND COALESCE(c.item_count, 0) = 0`
        );
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys j
             LEFT JOIN (
                SELECT user_id, COUNT(*) as item_count
                FROM cart_items
                GROUP BY user_id
             ) c ON c.user_id = j.user_id
             SET j.status = 'cancelled',
                 j.recovery_reason = 'cart_empty',
                 j.next_attempt_at = NULL,
                 j.processing_token = NULL,
                 j.processing_started_at = NULL,
                 j.updated_at = CURRENT_TIMESTAMP
             WHERE j.status = 'active'
               AND COALESCE(c.item_count, 0) = 0`
        );
        for (const row of rows) {
            await AbandonedCart.invalidateActiveDiscountsByJourney({ journeyId: row.id, connection: db });
        }
        return Number(result?.affectedRows || 0);
    }

    static async closeExpiredJourneys() {
        const [expiringRows] = await db.execute(
            `SELECT id
             FROM abandoned_cart_journeys
             WHERE status = 'active'
               AND expires_at IS NOT NULL
               AND expires_at <= NOW()`
        );
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys
             SET status = 'expired',
                 recovery_reason = COALESCE(recovery_reason, 'window_expired'),
                 next_attempt_at = NULL,
                 processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE status = 'active'
               AND expires_at IS NOT NULL
               AND expires_at <= NOW()`
        );
        for (const row of expiringRows) {
            await AbandonedCart.invalidateActiveDiscountsByJourney({ journeyId: row.id, connection: db });
        }
        return Number(result?.affectedRows || 0);
    }

    static async realignActiveJourneySchedules(campaign) {
        const [rows] = await db.execute(
            `SELECT id, last_attempt_no, last_activity_at, updated_at, expires_at
             FROM abandoned_cart_journeys
             WHERE status = 'active'`
        );
        const maxAttempts = Math.max(1, Number(campaign?.maxAttempts || DEFAULT_CAMPAIGN.maxAttempts));
        for (const row of rows) {
            const nextAttemptNo = Number(row.last_attempt_no || 0) + 1;
            if (nextAttemptNo > maxAttempts) {
                await db.execute(
                    `UPDATE abandoned_cart_journeys
                     SET status = 'expired',
                         next_attempt_at = NULL,
                         recovery_reason = COALESCE(recovery_reason, 'max_attempts_reached'),
                         updated_at = CURRENT_TIMESTAMP
                     WHERE id = ?`,
                    [row.id]
                );
                continue;
            }
            const base = [toDateSafe(row.last_activity_at), toDateSafe(row.updated_at)]
                .filter(Boolean)
                .sort((a, b) => b.getTime() - a.getTime())[0] || new Date();
            let nextAttemptAt = AbandonedCart.computeAttemptAtFromLastActivity({
                lastActivityAt: base,
                campaign,
                attemptNo: nextAttemptNo
            });
            if (row.expires_at && nextAttemptAt.getTime() > new Date(row.expires_at).getTime()) {
                nextAttemptAt = null;
            }
            await db.execute(
                `UPDATE abandoned_cart_journeys
                 SET next_attempt_at = ?,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [nextAttemptAt, row.id]
            );
        }
    }

    static async hasRecoveredOrderSinceJourney({ userId, journeyCreatedAt, journeyExpiresAt = null }) {
        let query = `SELECT id FROM orders
             WHERE user_id = ?
               AND created_at >= ?
               AND LOWER(COALESCE(payment_status, '')) IN ('paid', 'captured')`;
        const params = [userId, journeyCreatedAt];
        if (journeyExpiresAt) {
            query += ' AND created_at <= ?';
            params.push(journeyExpiresAt);
        }
        query += ' ORDER BY id DESC LIMIT 1';
        const [rows] = await db.execute(
            query,
            params
        );
        return rows[0]?.id || null;
    }

    static async createDiscount({
        journeyId,
        attemptNo,
        userId,
        percent = 0,
        maxDiscountSubunits = null,
        minCartSubunits = null,
        expiresAt
    }) {
        const safeJourneyId = Number(journeyId || 0);
        const safeAttemptNo = Number(attemptNo || 1);
        const [existingRows] = await db.execute(
            `SELECT code, discount_percent
             FROM abandoned_cart_discounts
             WHERE journey_id = ? AND attempt_no = ?
             ORDER BY id DESC
             LIMIT 1`,
            [safeJourneyId, safeAttemptNo]
        );
        if (existingRows.length) {
            return {
                code: existingRows[0].code,
                percent: Number(existingRows[0].discount_percent || percent || 0)
            };
        }

        const stamp = Date.now().toString(36).toUpperCase().slice(-4);
        const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
        const code = `REC-${String(journeyId).slice(-2).padStart(2, '0')}${String(attemptNo)}-${stamp}${rand}`.slice(0, 24);
        try {
            await db.execute(
                `INSERT INTO abandoned_cart_discounts
                    (journey_id, user_id, attempt_no, code, discount_type, discount_percent, max_discount_subunits, min_cart_subunits, status, expires_at)
                 VALUES (?, ?, ?, ?, 'percent', ?, ?, ?, 'active', ?)`,
                [
                    safeJourneyId,
                    userId,
                    safeAttemptNo,
                    code,
                    Number(percent || 0),
                    maxDiscountSubunits != null ? Number(maxDiscountSubunits) : null,
                    minCartSubunits != null ? Number(minCartSubunits) : null,
                    expiresAt || null
                ]
            );
        } catch (error) {
            const duplicateAttempt = Number(error?.errno) === 1062
                && String(error?.sqlMessage || '').includes('uniq_ac_discount_attempt');
            if (!duplicateAttempt) throw error;
            const [retryRows] = await db.execute(
                `SELECT code, discount_percent
                 FROM abandoned_cart_discounts
                 WHERE journey_id = ? AND attempt_no = ?
                 ORDER BY id DESC
                 LIMIT 1`,
                [safeJourneyId, safeAttemptNo]
            );
            if (retryRows.length) {
                return {
                    code: retryRows[0].code,
                    percent: Number(retryRows[0].discount_percent || percent || 0)
                };
            }
            throw error;
        }
        await db.execute(
            `UPDATE abandoned_cart_discounts
             SET status = 'invalidated',
                 updated_at = CURRENT_TIMESTAMP
             WHERE journey_id = ?
               AND user_id = ?
               AND attempt_no < ?
               AND status = 'active'`,
            [safeJourneyId, userId, safeAttemptNo]
        );
        return { code, percent: Number(percent || 0) };
    }

    static async addAttempt({
        journeyId,
        attemptNo,
        status = 'sent',
        channels = [],
        discountCode = null,
        discountPercent = 0,
        paymentLinkId = null,
        paymentLinkUrl = null,
        payload = null,
        response = null,
        errorMessage = null
    }) {
        const shouldSetSentAt = ['sent', 'partial'].includes(String(status || '').toLowerCase());
        await db.execute(
            `INSERT INTO abandoned_cart_attempts
                (journey_id, attempt_no, status, channels_json, discount_code, discount_percent, payment_link_id, payment_link_url, payload_json, response_json, error_message, scheduled_at, sent_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?)`,
            [
                journeyId,
                Number(attemptNo || 1),
                String(status || 'sent').slice(0, 20),
                JSON.stringify(channels || []),
                discountCode || null,
                Number(discountPercent || 0),
                paymentLinkId || null,
                paymentLinkUrl || null,
                payload ? JSON.stringify(payload) : null,
                response ? JSON.stringify(response) : null,
                errorMessage ? String(errorMessage).slice(0, 500) : null,
                shouldSetSentAt ? new Date() : null
            ]
        );
    }

    static async claimDueJourney({ journeyId, token, expectedNextAttemptAt = null } = {}) {
        const id = Number(journeyId || 0);
        const claimToken = String(token || '').trim().slice(0, 64);
        if (!Number.isFinite(id) || id <= 0 || !claimToken) return false;
        const params = [
            claimToken,
            id,
            JOURNEY_PROCESSING_TIMEOUT_MINUTES
        ];
        let sql = `UPDATE abandoned_cart_journeys
             SET processing_token = ?,
                 processing_started_at = UTC_TIMESTAMP(),
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND status = 'active'
               AND next_attempt_at IS NOT NULL
               AND (
                    processing_started_at IS NULL
                    OR processing_started_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)
               )`;
        if (expectedNextAttemptAt != null) {
            sql += ' AND next_attempt_at <=> ?';
            params.push(expectedNextAttemptAt);
        }
        const [result] = await db.execute(sql, params);
        return Number(result?.affectedRows || 0) > 0;
    }

    static async clearJourneyProcessing({ journeyId, token = null } = {}) {
        const id = Number(journeyId || 0);
        if (!Number.isFinite(id) || id <= 0) return 0;
        const params = [id];
        let sql = `UPDATE abandoned_cart_journeys
             SET processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`;
        if (token != null && String(token).trim()) {
            sql += ' AND processing_token = ?';
            params.push(String(token).trim().slice(0, 64));
        }
        const [result] = await db.execute(sql, params);
        return Number(result?.affectedRows || 0);
    }

    static async markJourneyAttempted({ journeyId, nextAttemptNo, nextAttemptAt, markExpired = false }) {
        const [result] = await db.execute(
            `UPDATE abandoned_cart_journeys
             SET last_attempt_no = ?,
                 next_attempt_at = ?,
                 status = CASE WHEN ? = 1 THEN 'expired' ELSE status END,
                 processing_token = NULL,
                 processing_started_at = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                Number(nextAttemptNo || 0),
                nextAttemptAt || null,
                markExpired ? 1 : 0,
                journeyId
            ]
        );
        if (markExpired && Number(result?.affectedRows || 0) > 0) {
            await AbandonedCart.invalidateActiveDiscountsByJourney({ journeyId, connection: db });
        }
    }

    static async listJourneys({ status = 'all', limit = 50, offset = 0 } = {}) {
        const campaign = await AbandonedCart.getCampaign();
        const inactivityMinutes = Math.max(1, Number(campaign?.inactivityMinutes || DEFAULT_CAMPAIGN.inactivityMinutes));
        const params = [];
        let where = "WHERE LOWER(COALESCE(u.role, 'customer')) = 'customer' AND COALESCE(u.is_active, 0) = 1";
        where += ` AND (
            j.status <> 'active'
            OR j.last_attempt_no > 0
            OR COALESCE(j.last_activity_at, j.updated_at, j.created_at) <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        )`;
        params.push(inactivityMinutes);
        if (status && status !== 'all') {
            where += ' AND j.status = ?';
            params.push(status);
        }
        const [rows] = await db.execute(
            `SELECT j.*, u.name as customer_name, u.email as customer_email, u.mobile as customer_mobile,
                    o.order_ref as recovered_order_ref, o.total as recovered_order_total,
                    NULLIF(
                        GREATEST(
                            COALESCE(la.last_attempt_at, '1000-01-01 00:00:00'),
                            COALESCE(j.last_activity_at, '1000-01-01 00:00:00'),
                            COALESCE(j.updated_at, '1000-01-01 00:00:00')
                        ),
                        '1000-01-01 00:00:00'
                    ) as computed_last_activity_at
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             LEFT JOIN orders o ON o.id = j.recovered_order_id
             LEFT JOIN (
                SELECT journey_id, MAX(created_at) as last_attempt_at
                FROM abandoned_cart_attempts
                GROUP BY journey_id
             ) la ON la.journey_id = j.id
             ${where}
             ORDER BY j.id DESC
             LIMIT ? OFFSET ?`,
            [...params, Number(limit || 50), Number(offset || 0)]
        );
        const mapped = rows.map((row) => applyJourneyNextAttemptSchedule({
            ...row,
            cart_snapshot_json: parseJson(row.cart_snapshot_json, [])
        }, campaign)).map(normalizeJourneyTimes);
        return mapped;
    }

    static async getJourneyTimeline(journeyId) {
        const campaign = await AbandonedCart.getCampaign();
        const [journeyRows] = await db.execute(
            `SELECT j.*, u.name as customer_name, u.email as customer_email, u.mobile as customer_mobile
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             WHERE j.id = ?
               AND LOWER(COALESCE(u.role, 'customer')) = 'customer'
               AND COALESCE(u.is_active, 0) = 1
             LIMIT 1`,
            [journeyId]
        );
        if (!journeyRows.length) return null;
        const journey = normalizeJourneyTimes(applyJourneyNextAttemptSchedule({
            ...journeyRows[0],
            cart_snapshot_json: parseJson(journeyRows[0].cart_snapshot_json, [])
        }, campaign));

        const [attempts] = await db.execute(
            `SELECT * FROM abandoned_cart_attempts
             WHERE journey_id = ?
             ORDER BY attempt_no ASC, id ASC`,
            [journeyId]
        );
        const [discounts] = await db.execute(
            `SELECT * FROM abandoned_cart_discounts
             WHERE journey_id = ?
             ORDER BY id ASC`,
            [journeyId]
        );

        return {
            journey,
            attempts: attempts.map((row) => ({
                ...row,
                channels_json: parseJson(row.channels_json, []),
                payload_json: parseJson(row.payload_json, {}),
                response_json: parseJson(row.response_json, {})
            })),
            discounts
        };
    }

    static async getAttemptMeta({ journeyId, attemptNo } = {}) {
        if (!journeyId || !attemptNo) return null;
        const [rows] = await db.execute(
            `SELECT *
             FROM abandoned_cart_attempts
             WHERE journey_id = ? AND attempt_no = ?
             ORDER BY id DESC
             LIMIT 1`,
            [Number(journeyId), Number(attemptNo)]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            channels_json: parseJson(row.channels_json, []),
            payload_json: parseJson(row.payload_json, {}),
            response_json: parseJson(row.response_json, {})
        };
    }

    static async markAttemptPaidByPaymentLink({ paymentLinkId, paymentId = null } = {}) {
        if (!paymentLinkId) return 0;
        const [result] = await db.execute(
            `UPDATE abandoned_cart_attempts
             SET status = 'paid',
                 response_json = JSON_SET(COALESCE(response_json, JSON_OBJECT()), '$.paymentId', ?),
                 sent_at = COALESCE(sent_at, NOW()),
                 updated_at = CURRENT_TIMESTAMP
             WHERE payment_link_id = ?`,
            [paymentId || null, String(paymentLinkId)]
        );
        return Number(result?.affectedRows || 0);
    }

    static async getAttemptByPaymentLinkId(paymentLinkId) {
        if (!paymentLinkId) return null;
        const [rows] = await db.execute(
            `SELECT *
             FROM abandoned_cart_attempts
             WHERE payment_link_id = ?
             ORDER BY id DESC
             LIMIT 1`,
            [String(paymentLinkId)]
        );
        if (!rows.length) return null;
        const row = rows[0];
        return {
            ...row,
            channels_json: parseJson(row.channels_json, []),
            payload_json: parseJson(row.payload_json, {}),
            response_json: parseJson(row.response_json, {})
        };
    }

    static async listJourneysAdvanced({
        status = 'all',
        search = '',
        sortBy = 'newest',
        limit = 50,
        offset = 0,
        rangeDays = 90
    } = {}) {
        const campaign = await AbandonedCart.getCampaign();
        const inactivityMinutes = Math.max(1, Number(campaign?.inactivityMinutes || DEFAULT_CAMPAIGN.inactivityMinutes));
        const isLifetimeRange = String(rangeDays || '').toLowerCase() === 'lifetime';
        const safeRangeDays = isLifetimeRange ? null : Math.max(1, Math.min(90, Number(rangeDays || 90)));
        const params = [];
        let where = "WHERE LOWER(COALESCE(u.role, 'customer')) = 'customer' AND COALESCE(u.is_active, 0) = 1";
        where += ` AND (
            j.status <> 'active'
            OR j.last_attempt_no > 0
            OR COALESCE(j.last_activity_at, j.updated_at, j.created_at) <= DATE_SUB(NOW(), INTERVAL ? MINUTE)
        )`;
        params.push(inactivityMinutes);
        if (!isLifetimeRange) {
            where += ' AND j.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            params.push(safeRangeDays);
        }
        if (status && status !== 'all') {
            where += ' AND j.status = ?';
            params.push(status);
        }
        if (search) {
            const term = `%${search}%`;
            where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR CAST(j.id AS CHAR) LIKE ?)';
            params.push(term, term, term, term);
        }
        let orderBy = 'j.id DESC';
        if (sortBy === 'oldest') orderBy = 'COALESCE(la.last_attempt_at, j.updated_at) ASC, j.id ASC';
        if (sortBy === 'newest') orderBy = 'COALESCE(la.last_attempt_at, j.updated_at) DESC, j.id DESC';
        if (sortBy === 'highest_value') orderBy = 'j.cart_total_subunits DESC, j.id DESC';
        if (sortBy === 'lowest_value') orderBy = 'j.cart_total_subunits ASC, j.id DESC';
        if (sortBy === 'next_due') orderBy = 'j.next_attempt_at ASC, j.id DESC';

        const [countRows] = await db.execute(
            `SELECT COUNT(*) as total
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             ${where}`,
            params
        );
        const total = Number(countRows[0]?.total || 0);

        const [rows] = await db.execute(
            `SELECT j.*, u.name as customer_name, u.email as customer_email, u.mobile as customer_mobile,
                    o.order_ref as recovered_order_ref, o.total as recovered_order_total,
                    NULLIF(
                        GREATEST(
                            COALESCE(la.last_attempt_at, '1000-01-01 00:00:00'),
                            COALESCE(j.last_activity_at, '1000-01-01 00:00:00'),
                            COALESCE(j.updated_at, '1000-01-01 00:00:00')
                        ),
                        '1000-01-01 00:00:00'
                    ) as computed_last_activity_at
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             LEFT JOIN orders o ON o.id = j.recovered_order_id
             LEFT JOIN (
                SELECT journey_id, MAX(created_at) as last_attempt_at
                FROM abandoned_cart_attempts
                GROUP BY journey_id
             ) la ON la.journey_id = j.id
             ${where}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [...params, Number(limit || 50), Number(offset || 0)]
        );

        const mapped = rows.map((row) => applyJourneyNextAttemptSchedule({
                ...row,
                cart_snapshot_json: parseJson(row.cart_snapshot_json, [])
            }, campaign)).map(normalizeJourneyTimes);
        return {
            journeys: mapped,
            total
        };
    }

    static async listPendingCandidatesAdvanced({
        search = '',
        sortBy = 'newest',
        limit = 50,
        offset = 0,
        rangeDays = 90
    } = {}) {
        const campaign = await AbandonedCart.getCampaign();
        const inactivityMinutes = Math.max(1, Number(campaign?.inactivityMinutes || DEFAULT_CAMPAIGN.inactivityMinutes));
        const safeRangeDays = Math.max(1, Math.min(90, Number(rangeDays || 90)));
        const params = [];
        let where = "WHERE LOWER(COALESCE(u.role, 'customer')) = 'customer' AND COALESCE(u.is_active, 0) = 1";
        where += ' AND c.last_activity_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
        params.push(safeRangeDays);
        if (search) {
            const term = `%${search}%`;
            where += ' AND (u.name LIKE ? OR u.email LIKE ? OR u.mobile LIKE ? OR c.user_id LIKE ?)';
            params.push(term, term, term, term);
        }

        let orderBy = 'c.last_activity_at DESC, c.user_id DESC';
        const queryParams = [...params];
        if (sortBy === 'oldest') orderBy = 'c.last_activity_at ASC, c.user_id ASC';
        if (sortBy === 'highest_value') orderBy = 'c.cart_total_subunits DESC, c.user_id DESC';
        if (sortBy === 'lowest_value') orderBy = 'c.cart_total_subunits ASC, c.user_id DESC';
        if (sortBy === 'next_due') {
            orderBy = 'DATE_ADD(c.last_activity_at, INTERVAL ? MINUTE) ASC, c.user_id DESC';
            queryParams.push(inactivityMinutes);
        }

        const [countRows] = await db.execute(
            `SELECT COUNT(*) as total
             FROM abandoned_cart_candidates c
             LEFT JOIN users u ON u.id = c.user_id
             LEFT JOIN abandoned_cart_journeys j ON j.user_id = c.user_id AND j.status = 'active'
             ${where} AND j.id IS NULL`,
            params
        );
        const total = Number(countRows[0]?.total || 0);

        const [rows] = await db.execute(
            `SELECT c.user_id, c.cart_item_count, c.cart_total_subunits, c.currency, c.last_activity_at, c.created_at, c.updated_at,
                    u.name as customer_name, u.email as customer_email, u.mobile as customer_mobile
             FROM abandoned_cart_candidates c
             LEFT JOIN users u ON u.id = c.user_id
             LEFT JOIN abandoned_cart_journeys j ON j.user_id = c.user_id AND j.status = 'active'
             ${where} AND j.id IS NULL
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [...queryParams, Number(limit || 50), Number(offset || 0)]
        );

        const candidates = rows.map((row) => {
            const lastActivity = new Date(row.last_activity_at || Date.now());
            const nextAttemptAt = new Date(lastActivity.getTime() + inactivityMinutes * 60 * 1000);
            return {
                id: `candidate:${row.user_id}`,
                user_id: row.user_id,
                status: 'pending',
                source_type: 'candidate',
                cart_item_count: Number(row.cart_item_count || 0),
                cart_total_subunits: Number(row.cart_total_subunits || 0),
                currency: String(row.currency || 'INR'),
                customer_name: row.customer_name || '',
                customer_email: row.customer_email || '',
                customer_mobile: row.customer_mobile || '',
                last_attempt_no: 0,
                last_activity_at: row.last_activity_at,
                computed_last_activity_at: row.last_activity_at,
                next_attempt_at: nextAttemptAt.toISOString(),
                created_at: row.created_at,
                updated_at: row.updated_at
            };
        });

        return { candidates, total };
    }

    static async getInsights({ rangeDays = 30 } = {}) {
        const isLifetimeRange = String(rangeDays || '').toLowerCase() === 'lifetime';
        const safeDays = isLifetimeRange ? null : Math.max(1, Math.min(90, Number(rangeDays || 30)));
        const summaryParams = [];
        let summaryWhere = `WHERE LOWER(COALESCE(u.role, 'customer')) = 'customer'
               AND COALESCE(u.is_active, 0) = 1`;
        if (!isLifetimeRange) {
            summaryWhere = `WHERE j.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
               AND LOWER(COALESCE(u.role, 'customer')) = 'customer'
               AND COALESCE(u.is_active, 0) = 1`;
            summaryParams.push(safeDays);
        }
        const [summaryRows] = await db.execute(
            `SELECT
                COUNT(*) as total_journeys,
                SUM(CASE WHEN j.status = 'active' THEN 1 ELSE 0 END) as active_journeys,
                SUM(CASE WHEN j.status = 'recovered' THEN 1 ELSE 0 END) as recovered_journeys,
                SUM(CASE WHEN j.status = 'expired' THEN 1 ELSE 0 END) as expired_journeys,
                SUM(CASE WHEN j.status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_journeys,
                SUM(CASE WHEN j.status = 'recovered' THEN j.cart_total_subunits ELSE 0 END) as recovered_value_subunits
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             ${summaryWhere}`,
            summaryParams
        );
        const attemptParams = [];
        let attemptsWhere = '';
        if (!isLifetimeRange) {
            attemptsWhere = 'WHERE created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)';
            attemptParams.push(safeDays);
        }
        const [attemptRows] = await db.execute(
            `SELECT
                COUNT(*) as total_attempts,
                SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_attempts,
                SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed_attempts,
                AVG(NULLIF(discount_percent, 0)) as avg_discount_percent
             FROM abandoned_cart_attempts
             ${attemptsWhere}`,
            attemptParams
        );
        const dailyParams = [];
        let dailyWhere = `WHERE LOWER(COALESCE(u.role, 'customer')) = 'customer'
               AND COALESCE(u.is_active, 0) = 1`;
        if (!isLifetimeRange) {
            dailyWhere = `WHERE j.created_at >= DATE_SUB(NOW(), INTERVAL ? DAY)
               AND LOWER(COALESCE(u.role, 'customer')) = 'customer'
               AND COALESCE(u.is_active, 0) = 1`;
            dailyParams.push(safeDays);
        }
        const [dailyRows] = await db.execute(
            `SELECT
                DATE(j.created_at) as day,
                COUNT(*) as journeys,
                SUM(CASE WHEN j.status = 'recovered' THEN 1 ELSE 0 END) as recovered,
                SUM(CASE WHEN j.status = 'active' THEN 1 ELSE 0 END) as active
             FROM abandoned_cart_journeys j
             LEFT JOIN users u ON u.id = j.user_id
             ${dailyWhere}
             GROUP BY DATE(created_at)
             ORDER BY DATE(created_at) ASC`,
            dailyParams
        );

        const summary = summaryRows[0] || {};
        const attempts = attemptRows[0] || {};
        const totalJourneys = Number(summary.total_journeys || 0);
        const recoveredJourneys = Number(summary.recovered_journeys || 0);

        return {
            rangeDays: isLifetimeRange ? 'lifetime' : safeDays,
            totals: {
                totalJourneys,
                activeJourneys: Number(summary.active_journeys || 0),
                recoveredJourneys,
                expiredJourneys: Number(summary.expired_journeys || 0),
                cancelledJourneys: Number(summary.cancelled_journeys || 0),
                recoveryRate: totalJourneys > 0 ? Number(((recoveredJourneys / totalJourneys) * 100).toFixed(2)) : 0,
                recoveredValue: Number(summary.recovered_value_subunits || 0) / 100
            },
            attempts: {
                totalAttempts: Number(attempts.total_attempts || 0),
                sentAttempts: Number(attempts.sent_attempts || 0),
                failedAttempts: Number(attempts.failed_attempts || 0),
                avgDiscountPercent: Number(attempts.avg_discount_percent || 0)
            },
            daily: dailyRows.map((row) => ({
                day: row.day,
                journeys: Number(row.journeys || 0),
                recovered: Number(row.recovered || 0),
                active: Number(row.active || 0)
            }))
        };
    }

    static async getRedeemableDiscount({
        code,
        userId,
        cartTotalSubunits,
        connection = db
    }) {
        const normalizedCode = String(code || '').trim().toUpperCase();
        if (!normalizedCode) return null;
        const [rows] = await connection.execute(
            `SELECT d.*, j.status as journey_status
             FROM abandoned_cart_discounts d
             LEFT JOIN abandoned_cart_journeys j ON j.id = d.journey_id
             WHERE UPPER(d.code) = ?
               AND d.user_id = ?
               AND d.status = 'active'
             LIMIT 1`,
            [normalizedCode, userId]
        );
        if (!rows.length) return null;
        const row = rows[0];
        const now = Date.now();
        const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : null;
        if (expiresAt && expiresAt < now) return null;
        if (row.min_cart_subunits != null && Number(cartTotalSubunits || 0) < Number(row.min_cart_subunits || 0)) {
            return null;
        }
        const percent = Math.max(0, Number(row.discount_percent || 0));
        let discountSubunits = Math.round(Number(cartTotalSubunits || 0) * percent / 100);
        if (row.max_discount_subunits != null) {
            discountSubunits = Math.min(discountSubunits, Number(row.max_discount_subunits || 0));
        }
        return {
            ...row,
            discountSubunits
        };
    }

    static async markDiscountRedeemed({
        discountId,
        orderId,
        connection = db
    }) {
        const safeId = Number(discountId || 0);
        if (!Number.isFinite(safeId) || safeId <= 0) return { redeemed: 0, invalidated: 0 };
        const [targetRows] = await connection.execute(
            `SELECT id, journey_id, user_id
             FROM abandoned_cart_discounts
             WHERE id = ?
             LIMIT 1`,
            [safeId]
        );
        if (!targetRows.length) return { redeemed: 0, invalidated: 0 };
        const target = targetRows[0];
        const [redeemResult] = await connection.execute(
            `UPDATE abandoned_cart_discounts
             SET status = 'redeemed',
                 redeemed_order_id = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND status = 'active'`,
            [orderId, safeId]
        );
        let invalidated = 0;
        if (target.journey_id) {
            const [invalidateResult] = await connection.execute(
                `UPDATE abandoned_cart_discounts
                 SET status = 'invalidated',
                     updated_at = CURRENT_TIMESTAMP
                 WHERE journey_id = ?
                   AND user_id = ?
                   AND id <> ?
                   AND status = 'active'`,
                [target.journey_id, target.user_id, safeId]
            );
            invalidated = Number(invalidateResult?.affectedRows || 0);
        }
        return {
            redeemed: Number(redeemResult?.affectedRows || 0),
            invalidated
        };
    }

    static async deactivateDiscountByCodeForUser({
        userId,
        code,
        connection = db
    } = {}) {
        const normalizedCode = String(code || '').trim().toUpperCase();
        if (!userId || !normalizedCode) return 0;
        const [result] = await connection.execute(
            `UPDATE abandoned_cart_discounts
             SET status = 'invalidated',
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = ?
               AND UPPER(code) = ?
               AND status = 'active'`,
            [userId, normalizedCode]
        );
        return Number(result?.affectedRows || 0);
    }

    static async deactivateDiscountByCode({
        code,
        connection = db
    } = {}) {
        const normalizedCode = String(code || '').trim().toUpperCase();
        if (!normalizedCode) return 0;
        const [result] = await connection.execute(
            `UPDATE abandoned_cart_discounts
             SET status = 'invalidated',
                 updated_at = CURRENT_TIMESTAMP
             WHERE UPPER(code) = ?
               AND status = 'active'`,
            [normalizedCode]
        );
        return Number(result?.affectedRows || 0);
    }
}

module.exports = AbandonedCart;
