const db = require('../../config/db');
const { sendEmail } = require('./channels/emailChannel');
const { sendWhatsapp } = require('./channels/whatsappChannel');

const MAX_RETRY_ATTEMPTS = Math.max(1, Number(process.env.COMMUNICATION_RETRY_MAX_ATTEMPTS || 2));
const BASE_RETRY_DELAY_MINUTES = Math.max(1, Number(process.env.COMMUNICATION_RETRY_DELAY_MINUTES || 30));
const PROCESS_BATCH_SIZE = Math.max(1, Number(process.env.COMMUNICATION_RETRY_BATCH_SIZE || 3));
const MAX_EMAIL_RETRY_ATTACHMENT_BYTES = Math.max(64 * 1024, Number(process.env.COMMUNICATION_RETRY_ATTACHMENT_MAX_BYTES || (1024 * 1024)));
const STALE_LOCK_MINUTES = Math.max(5, Number(process.env.COMMUNICATION_RETRY_STALE_LOCK_MINUTES || 15));
const SENT_RETENTION_DAYS = Math.max(1, Number(process.env.COMMUNICATION_RETRY_SENT_RETENTION_DAYS || 14));
const FAILED_RETENTION_DAYS = Math.max(1, Number(process.env.COMMUNICATION_RETRY_FAILED_RETENTION_DAYS || 30));
const RATE_LIMIT_RETRY_DELAY_MINUTES = Math.max(BASE_RETRY_DELAY_MINUTES, Number(process.env.COMMUNICATION_RATE_LIMIT_RETRY_DELAY_MINUTES || 120));

const toJson = (value) => {
    try {
        return JSON.stringify(value ?? null);
    } catch {
        return JSON.stringify(null);
    }
};

const fromJson = (value, fallback = null) => {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const normalizeAttachments = (attachments = []) => (
    (Array.isArray(attachments) ? attachments : []).map((entry = {}) => {
        if (!entry || typeof entry !== 'object') return null;
        const next = {
            filename: entry.filename || undefined,
            contentType: entry.contentType || undefined,
            cid: entry.cid || undefined,
            encoding: entry.encoding || undefined,
            path: entry.path || undefined
        };
        if (Buffer.isBuffer(entry.content)) {
            next.contentBase64 = entry.content.toString('base64');
        } else if (typeof entry.content === 'string') {
            next.content = entry.content;
        }
        return next;
    }).filter(Boolean)
);

const estimateAttachmentBytes = (attachments = []) => (
    (Array.isArray(attachments) ? attachments : []).reduce((total, entry = {}) => {
        if (typeof entry.contentBase64 === 'string' && entry.contentBase64) {
            return total + Buffer.byteLength(entry.contentBase64, 'base64');
        }
        if (Buffer.isBuffer(entry.content)) {
            return total + entry.content.length;
        }
        if (typeof entry.content === 'string') {
            return total + Buffer.byteLength(entry.content);
        }
        return total;
    }, 0)
);

const hydrateAttachments = (attachments = []) => (
    (Array.isArray(attachments) ? attachments : []).map((entry = {}) => {
        const next = { ...entry };
        if (typeof next.contentBase64 === 'string' && next.contentBase64) {
            next.content = Buffer.from(next.contentBase64, 'base64');
            delete next.contentBase64;
        }
        return next;
    })
);

const buildNextRetryAt = (attemptCount = 0, baseDelayMinutes = BASE_RETRY_DELAY_MINUTES) => {
    const retryNumber = Math.max(1, Number(attemptCount || 0));
    const minutes = Math.max(1, Number(baseDelayMinutes || BASE_RETRY_DELAY_MINUTES)) * (2 ** Math.max(0, retryNumber - 1));
    return new Date(Date.now() + (minutes * 60 * 1000));
};

const resolveFailureMessage = ({ error = null, result = null } = {}) => (
    error?.message || result?.reason || result?.message || 'channel_failed'
);

const isRateLimitFailure = ({ error = null, result = null } = {}) => {
    const message = String(resolveFailureMessage({ error, result }) || '').toLowerCase();
    return [
        'ratelimit',
        'rate limit',
        'too many auth commands',
        'too many authentication',
        'too many login',
        'hostinger_out_ratelimit',
        '451 4.7.1',
        '450 4.7.1'
    ].some((token) => message.includes(token));
};

const queueCommunicationFailure = async ({
    channel,
    workflow = 'generic',
    recipient,
    payload = {},
    error = null,
    result = null,
    maxAttempts = MAX_RETRY_ATTEMPTS
}) => {
    const safeChannel = String(channel || '').trim().toLowerCase();
    const safeRecipient = String(recipient || '').trim();
    if (!safeChannel || !safeRecipient) return null;

    const nextRetryAt = buildNextRetryAt(
        1,
        isRateLimitFailure({ error, result }) ? RATE_LIMIT_RETRY_DELAY_MINUTES : BASE_RETRY_DELAY_MINUTES
    );
    const normalizedPayload = safeChannel === 'email'
        ? {
            ...payload,
            attachments: normalizeAttachments(payload.attachments)
        }
        : { ...payload };
    const attachmentBytes = safeChannel === 'email'
        ? estimateAttachmentBytes(normalizedPayload.attachments)
        : 0;

    if (safeChannel === 'email' && attachmentBytes > MAX_EMAIL_RETRY_ATTACHMENT_BYTES) {
        const [insert] = await db.execute(
            `INSERT INTO communication_delivery_logs
                (channel, workflow, recipient, payload_json, status, attempt_count, max_attempts, last_error, last_result_json, next_retry_at)
             VALUES (?, ?, ?, ?, 'failed', 1, ?, ?, ?, NULL)`,
            [
                safeChannel,
                String(workflow || 'generic').trim() || 'generic',
                safeRecipient,
                toJson({
                    ...normalizedPayload,
                    attachments: []
                }),
                1,
                `retry_payload_too_large:${attachmentBytes}`,
                toJson({
                    ...result,
                    skippedRetry: true,
                    reason: 'retry_payload_too_large',
                    attachmentBytes
                })
            ]
        );
        return {
            id: Number(insert?.insertId || 0) || null,
            queued: false,
            reason: 'retry_payload_too_large',
            attachmentBytes
        };
    }

    const [insert] = await db.execute(
        `INSERT INTO communication_delivery_logs
            (channel, workflow, recipient, payload_json, status, attempt_count, max_attempts, last_error, last_result_json, next_retry_at)
         VALUES (?, ?, ?, ?, 'queued', 1, ?, ?, ?, ?)`,
        [
            safeChannel,
            String(workflow || 'generic').trim() || 'generic',
            safeRecipient,
            toJson(normalizedPayload),
            Math.max(1, Number(maxAttempts || MAX_RETRY_ATTEMPTS)),
            resolveFailureMessage({ error, result }),
            toJson(result),
            nextRetryAt
        ]
    );
    return {
        id: Number(insert?.insertId || 0) || null,
        queued: true
    };
};

const markRetrySent = async (id, result = null) => {
    await db.execute(
        `UPDATE communication_delivery_logs
         SET status = 'sent',
             locked_at = NULL,
             last_result_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [toJson(result), id]
    );
};

const markRetryFailed = async (id, { attemptCount, maxAttempts, error = null, result = null } = {}) => {
    const exhausted = Number(attemptCount || 0) >= Number(maxAttempts || MAX_RETRY_ATTEMPTS);
    const retryDelayMinutes = isRateLimitFailure({ error, result })
        ? RATE_LIMIT_RETRY_DELAY_MINUTES
        : BASE_RETRY_DELAY_MINUTES;
    await db.execute(
        `UPDATE communication_delivery_logs
         SET status = ?,
             locked_at = NULL,
             next_retry_at = ?,
             last_error = ?,
             last_result_json = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
            exhausted ? 'failed' : 'queued',
            exhausted ? null : buildNextRetryAt(attemptCount, retryDelayMinutes),
            resolveFailureMessage({ error, result }),
            toJson(result),
            id
        ]
    );
};

const claimDueRetries = async (limit = PROCESS_BATCH_SIZE) => {
    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.execute(
            `SELECT *
             FROM communication_delivery_logs
             WHERE status IN ('queued', 'retrying')
               AND (next_retry_at IS NULL OR next_retry_at <= UTC_TIMESTAMP())
               AND locked_at IS NULL
             ORDER BY created_at ASC
             LIMIT ?
             FOR UPDATE`,
            [Math.max(1, Number(limit || PROCESS_BATCH_SIZE))]
        );
        const ids = rows.map((row) => Number(row.id)).filter(Boolean);
        if (ids.length) {
            await connection.query(
                `UPDATE communication_delivery_logs
                 SET status = 'retrying',
                     locked_at = UTC_TIMESTAMP(),
                     attempt_count = attempt_count + 1,
                     updated_at = CURRENT_TIMESTAMP
                 WHERE id IN (${ids.map(() => '?').join(', ')})`,
                ids
            );
        }
        await connection.commit();
        return rows.map((row) => ({
            ...row,
            attempt_count: Number(row.attempt_count || 0) + 1
        }));
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
};

const releaseStaleRetryLocks = async () => {
    const [result] = await db.execute(
        `UPDATE communication_delivery_logs
         SET status = 'queued',
             locked_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE status = 'retrying'
           AND locked_at IS NOT NULL
           AND locked_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? MINUTE)`,
        [STALE_LOCK_MINUTES]
    );
    return Number(result?.affectedRows || 0);
};

const pruneCommunicationDeliveryLogs = async () => {
    const [sentResult] = await db.execute(
        `DELETE FROM communication_delivery_logs
         WHERE status = 'sent'
           AND updated_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
        [SENT_RETENTION_DAYS]
    );
    const [failedResult] = await db.execute(
        `DELETE FROM communication_delivery_logs
         WHERE status = 'failed'
           AND updated_at <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? DAY)`,
        [FAILED_RETENTION_DAYS]
    );
    return {
        deletedSent: Number(sentResult?.affectedRows || 0),
        deletedFailed: Number(failedResult?.affectedRows || 0)
    };
};

const listCommunicationDeliveryLogs = async ({ status = 'all', limit = 50 } = {}) => {
    const safeLimit = Math.max(1, Math.min(200, Number(limit || 50)));
    const filters = [];
    const params = [];
    if (status !== 'all') {
        filters.push('status = ?');
        params.push(String(status || 'all').trim().toLowerCase());
    }
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';
    const [rows] = await db.execute(
        `SELECT id, channel, workflow, recipient, status, attempt_count, max_attempts, last_error, last_result_json, next_retry_at, locked_at, created_at, updated_at
         FROM communication_delivery_logs
         ${where}
         ORDER BY updated_at DESC, id DESC
         LIMIT ?`,
        [...params, safeLimit]
    );
    return rows.map((row) => ({
        id: Number(row.id),
        channel: String(row.channel || ''),
        workflow: String(row.workflow || ''),
        recipient: String(row.recipient || ''),
        status: String(row.status || ''),
        attemptCount: Number(row.attempt_count || 0),
        maxAttempts: Number(row.max_attempts || 0),
        lastError: String(row.last_error || ''),
        lastResult: fromJson(row.last_result_json, null),
        nextRetryAt: row.next_retry_at || null,
        lockedAt: row.locked_at || null,
        createdAt: row.created_at || null,
        updatedAt: row.updated_at || null
    }));
};

const replayQueuedCommunication = async (row = {}) => {
    const channel = String(row.channel || '').trim().toLowerCase();
    const payload = fromJson(row.payload_json, {}) || {};
    if (channel === 'email') {
        return sendEmail({
            ...payload,
            attachments: hydrateAttachments(payload.attachments)
        });
    }
    if (channel === 'whatsapp') {
        return sendWhatsapp(payload);
    }
    throw new Error(`Unsupported communication retry channel: ${channel}`);
};

const processQueuedCommunicationRetries = async ({ limit = PROCESS_BATCH_SIZE } = {}) => {
    const releasedLocks = await releaseStaleRetryLocks();
    const rows = await claimDueRetries(limit);
    let processed = 0;
    let sent = 0;
    let failed = 0;

    for (const row of rows) {
        processed += 1;
        try {
            const result = await replayQueuedCommunication(row);
            if (result?.ok) {
                sent += 1;
                await markRetrySent(row.id, result);
                continue;
            }
            if (result?.skipped) {
                failed += 1;
                await markRetryFailed(row.id, {
                    attemptCount: row.attempt_count,
                    maxAttempts: row.max_attempts,
                    result
                });
                continue;
            }
            failed += 1;
            await markRetryFailed(row.id, {
                attemptCount: row.attempt_count,
                maxAttempts: row.max_attempts,
                result
            });
        } catch (error) {
            failed += 1;
            await markRetryFailed(row.id, {
                attemptCount: row.attempt_count,
                maxAttempts: row.max_attempts,
                error
            });
        }
    }

    return { ok: true, processed, sent, failed, releasedLocks };
};

module.exports = {
    queueCommunicationFailure,
    listCommunicationDeliveryLogs,
    processQueuedCommunicationRetries,
    pruneCommunicationDeliveryLogs,
    releaseStaleRetryLocks,
    __test: {
        estimateAttachmentBytes,
        normalizeAttachments,
        hydrateAttachments,
        buildNextRetryAt
    }
};
