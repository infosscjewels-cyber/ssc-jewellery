require('dotenv').config();
const db = require('../config/db');

const FRIENDLY_REASON = 'Payment already linked to an existing checkout. Please retry with a new payment session.';

const extractPaymentId = (text = '') => {
    const match = String(text || '').match(/pay_[A-Za-z0-9]+/);
    return match ? match[0] : '';
};

const run = async ({ deleteOldDuplicates = false, retentionHours = 72 } = {}) => {
    const [rows] = await db.execute(
        `SELECT id, razorpay_payment_id, failure_reason
         FROM payment_attempts
         WHERE local_order_id IS NULL
           AND (
             LOWER(COALESCE(failure_reason, '')) LIKE '%uniq_payment_attempt_payment_id%'
             OR LOWER(COALESCE(failure_reason, '')) LIKE '%duplicate entry%'
           )
         ORDER BY id ASC`
    );

    let linked = 0;
    let normalized = 0;
    let deleted = 0;
    for (const row of rows) {
        const paymentId = String(row.razorpay_payment_id || '').trim() || extractPaymentId(row.failure_reason || '');
        let orderId = null;
        if (paymentId) {
            const [orderRows] = await db.execute(
                'SELECT id FROM orders WHERE razorpay_payment_id = ? ORDER BY id DESC LIMIT 1',
                [paymentId]
            );
            if (orderRows.length) {
                orderId = Number(orderRows[0].id || 0) || null;
            }
        }

        if (orderId) {
            const [ownerRows] = await db.execute(
                'SELECT id FROM payment_attempts WHERE local_order_id = ? LIMIT 1',
                [orderId]
            );
            const hasOtherOwner = ownerRows.length && String(ownerRows[0].id) !== String(row.id);
            if (!hasOtherOwner) {
                try {
                    await db.execute(
                        `UPDATE payment_attempts
                         SET local_order_id = ?,
                             status = 'paid',
                             verify_started_at = NULL,
                             finalized_at = COALESCE(finalized_at, CURRENT_TIMESTAMP),
                             verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP),
                             failure_reason = NULL,
                             last_gateway_error = NULL,
                             updated_at = CURRENT_TIMESTAMP
                         WHERE id = ?
                           AND local_order_id IS NULL`,
                        [orderId, row.id]
                    );
                    linked += 1;
                    continue;
                } catch (error) {
                    const message = String(error?.message || '').toLowerCase();
                    if (!message.includes('uniq_payment_attempt_local_order')) {
                        throw error;
                    }
                }
            }
        }

        await db.execute(
            `UPDATE payment_attempts
             SET status = 'failed',
                 failure_reason = ?,
                 last_gateway_error = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?
               AND local_order_id IS NULL`,
            [FRIENDLY_REASON, FRIENDLY_REASON, row.id]
        );
        normalized += 1;
    }

    if (deleteOldDuplicates) {
        const safeRetentionHours = Math.max(1, Number(retentionHours || 72));
        const [deleteResult] = await db.execute(
            `DELETE FROM payment_attempts
             WHERE local_order_id IS NULL
               AND status = 'failed'
               AND LOWER(COALESCE(failure_reason, '')) = ?
               AND updated_at < DATE_SUB(NOW(), INTERVAL ? HOUR)`,
            [FRIENDLY_REASON.toLowerCase(), safeRetentionHours]
        );
        deleted = Number(deleteResult?.affectedRows || 0);
    }

    const summary = {
        scanned: rows.length,
        linked,
        normalized,
        deleted
    };
    console.log(JSON.stringify(summary, null, 2));
    return summary;
};

module.exports = {
    FRIENDLY_REASON,
    healDuplicatePaymentFailures: run
};

if (require.main === module) {
    run()
        .catch((error) => {
            console.error(error?.stack || error?.message || String(error));
            process.exitCode = 1;
        });
}
