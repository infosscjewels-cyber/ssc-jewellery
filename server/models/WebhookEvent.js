const db = require('../config/db');

class WebhookEvent {
    static async register({ eventId, eventType, signature, payloadRaw, payload }) {
        try {
            const [result] = await db.execute(
                `INSERT INTO razorpay_webhook_events
                    (event_id, event_type, signature, status, payload_raw, payload_json)
                 VALUES (?, ?, ?, 'received', ?, ?)`,
                [
                    eventId,
                    eventType || '',
                    signature || '',
                    payloadRaw || '',
                    JSON.stringify(payload || null)
                ]
            );
            return { duplicate: false, id: result.insertId };
        } catch (error) {
            if (error?.code === 'ER_DUP_ENTRY') {
                return { duplicate: true, id: null };
            }
            throw error;
        }
    }

    static async markProcessed({ eventId, status = 'processed', note = null }) {
        await db.execute(
            `UPDATE razorpay_webhook_events
             SET status = ?, process_note = ?, processed_at = CURRENT_TIMESTAMP
             WHERE event_id = ?`,
            [status, note ? String(note).slice(0, 500) : null, eventId]
        );
    }

    static async markFailed({ eventId, note = null }) {
        await db.execute(
            `UPDATE razorpay_webhook_events
             SET status = 'failed', process_note = ?, processed_at = CURRENT_TIMESTAMP
             WHERE event_id = ?`,
            [note ? String(note).slice(0, 500) : null, eventId]
        );
    }
}

module.exports = WebhookEvent;
