require('dotenv').config({ path: '.env.dev' });
require('dotenv').config();

const mysql = require('mysql2/promise');

const DRY_RUN = !process.argv.includes('--apply');

const createConnection = async () => mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME
});

const pickCanonicalOrder = async (connection, orders = []) => {
    const ids = orders.map((row) => Number(row.id)).filter((id) => Number.isFinite(id) && id > 0);
    if (!ids.length) return null;

    const placeholders = ids.map(() => '?').join(',');
    const [attemptRows] = await connection.execute(
        `SELECT local_order_id
         FROM payment_attempts
         WHERE local_order_id IN (${placeholders})
         ORDER BY id ASC`,
        ids
    );
    const linkedOrderId = Number(attemptRows?.[0]?.local_order_id || 0);
    if (linkedOrderId > 0) {
        return orders.find((row) => Number(row.id) === linkedOrderId) || null;
    }

    return [...orders].sort((a, b) => Number(a.id) - Number(b.id))[0] || null;
};

const countRows = async (connection, tableName, orderIdColumn, orderId) => {
    const [rows] = await connection.execute(
        `SELECT COUNT(*) AS total FROM ${tableName} WHERE ${orderIdColumn} = ?`,
        [orderId]
    );
    return Number(rows?.[0]?.total || 0);
};

const dedupeGroup = async (connection, orders = []) => {
    const canonical = await pickCanonicalOrder(connection, orders);
    if (!canonical) return null;

    const duplicates = orders.filter((row) => Number(row.id) !== Number(canonical.id));
    if (!duplicates.length) return null;

    const result = {
        canonical,
        duplicates: []
    };

    for (const duplicate of duplicates) {
        const duplicateId = Number(duplicate.id);
        const canonicalId = Number(canonical.id);
        const canonicalItemCount = await countRows(connection, 'order_items', 'order_id', canonicalId);
        const duplicateItemCount = await countRows(connection, 'order_items', 'order_id', duplicateId);
        const canonicalEventCount = await countRows(connection, 'order_status_events', 'order_id', canonicalId);
        const duplicateEventCount = await countRows(connection, 'order_status_events', 'order_id', duplicateId);

        result.duplicates.push({
            duplicate,
            canonicalItemCount,
            duplicateItemCount,
            canonicalEventCount,
            duplicateEventCount
        });

        if (DRY_RUN) continue;

        if (canonicalItemCount === 0 && duplicateItemCount > 0) {
            await connection.execute(
                'UPDATE order_items SET order_id = ? WHERE order_id = ?',
                [canonicalId, duplicateId]
            );
        } else {
            await connection.execute('DELETE FROM order_items WHERE order_id = ?', [duplicateId]);
        }

        if (canonicalEventCount === 0 && duplicateEventCount > 0) {
            await connection.execute(
                'UPDATE order_status_events SET order_id = ? WHERE order_id = ?',
                [canonicalId, duplicateId]
            );
        } else {
            await connection.execute('DELETE FROM order_status_events WHERE order_id = ?', [duplicateId]);
        }

        await connection.execute(
            'UPDATE payment_attempts SET local_order_id = ? WHERE local_order_id = ?',
            [canonicalId, duplicateId]
        );
        await connection.execute(
            'UPDATE abandoned_cart_journeys SET recovered_order_id = ? WHERE recovered_order_id = ?',
            [canonicalId, duplicateId]
        );
        await connection.execute(
            'UPDATE abandoned_cart_discounts SET redeemed_order_id = ? WHERE redeemed_order_id = ?',
            [canonicalId, duplicateId]
        );
        await connection.execute('DELETE FROM orders WHERE id = ?', [duplicateId]);
    }

    return result;
};

const ensureUniqueIndexes = async (connection) => {
    const statements = [
        'ALTER TABLE orders ADD UNIQUE KEY uniq_orders_razorpay_order (razorpay_order_id)',
        'ALTER TABLE orders ADD UNIQUE KEY uniq_orders_razorpay_payment (razorpay_payment_id)'
    ];
    for (const statement of statements) {
        try {
            await connection.execute(statement);
        } catch (error) {
            if (!String(error?.message || '').toLowerCase().includes('duplicate')
                && !String(error?.message || '').toLowerCase().includes('duplicate key name')) {
                throw error;
            }
        }
    }
};

const main = async () => {
    const connection = await createConnection();
    try {
        const [groups] = await connection.execute(
            `SELECT
                razorpay_order_id,
                razorpay_payment_id,
                COUNT(*) AS order_count
             FROM orders
             WHERE LOWER(COALESCE(payment_gateway, '')) = 'razorpay'
               AND (
                    (razorpay_payment_id IS NOT NULL AND razorpay_payment_id <> '')
                    OR (razorpay_order_id IS NOT NULL AND razorpay_order_id <> '')
               )
             GROUP BY razorpay_order_id, razorpay_payment_id
             HAVING COUNT(*) > 1
             ORDER BY COUNT(*) DESC, MAX(id) DESC`
        );

        if (!groups.length) {
            if (!DRY_RUN) {
                await ensureUniqueIndexes(connection);
            }
            console.log(JSON.stringify({ ok: true, duplicates: 0, dryRun: DRY_RUN }, null, 2));
            return;
        }

        const summary = [];
        if (!DRY_RUN) {
            await connection.beginTransaction();
        }

        for (const group of groups) {
            const [orders] = await connection.execute(
                `SELECT id, order_ref, user_id, status, payment_status, payment_gateway, razorpay_order_id, razorpay_payment_id, total, created_at
                 FROM orders
                 WHERE razorpay_order_id <=> ?
                   AND razorpay_payment_id <=> ?
                 ORDER BY id ASC`,
                [group.razorpay_order_id || null, group.razorpay_payment_id || null]
            );
            const deduped = await dedupeGroup(connection, orders);
            if (deduped) summary.push(deduped);
        }

        if (!DRY_RUN) {
            await ensureUniqueIndexes(connection);
            await connection.commit();
        }

        console.log(JSON.stringify({
            ok: true,
            dryRun: DRY_RUN,
            groups: summary.length,
            summary
        }, null, 2));
    } catch (error) {
        if (!DRY_RUN) {
            try { await connection.rollback(); } catch {}
        }
        throw error;
    } finally {
        await connection.end();
    }
};

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
