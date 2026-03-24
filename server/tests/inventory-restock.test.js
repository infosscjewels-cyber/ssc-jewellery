const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const Order = require('../models/Order');

test('Order.updateStatus restores inventory once on non-cancelled to cancelled transition', async () => {
    const originalGetConnection = db.getConnection;
    const executed = [];
    let committed = false;
    const fakeConnection = {
        async beginTransaction() {},
        async commit() { committed = true; },
        async rollback() {},
        release() {},
        async execute(sql, params = []) {
            executed.push({ sql, params });
            if (sql.includes('SELECT id, inventory_restored_at FROM orders')) {
                return [[{ id: 101, inventory_restored_at: null }]];
            }
            if (sql.includes('SELECT product_id, variant_id, quantity FROM order_items')) {
                return [[
                    { product_id: 11, variant_id: 21, quantity: 2 },
                    { product_id: 12, variant_id: null, quantity: 3 }
                ]];
            }
            return [[]];
        }
    };
    db.getConnection = async () => fakeConnection;
    try {
        await Order.updateStatus(101, 'cancelled', {
            actorUserId: 'admin_1',
            restoreInventory: true
        });
    } finally {
        db.getConnection = originalGetConnection;
    }

    assert.equal(committed, true);
    assert.ok(executed.some((entry) => entry.sql.includes('UPDATE product_variants SET quantity = quantity + ? WHERE id = ?') && entry.params[0] === 2 && entry.params[1] === 21));
    assert.ok(executed.some((entry) => entry.sql.includes('UPDATE products SET quantity = quantity + ? WHERE id = ?') && entry.params[0] === 3 && entry.params[1] === 12));
    assert.ok(executed.some((entry) => entry.sql.includes('UPDATE orders SET inventory_restored_at = NOW() WHERE id = ? AND inventory_restored_at IS NULL')));
});

test('Order.updateStatus does not restock again when inventory is already restored', async () => {
    const originalGetConnection = db.getConnection;
    const executed = [];
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql, params = []) {
            executed.push({ sql, params });
            if (sql.includes('SELECT id, inventory_restored_at FROM orders')) {
                return [[{ id: 102, inventory_restored_at: '2026-03-12 10:00:00' }]];
            }
            if (sql.includes('SELECT product_id, variant_id, quantity FROM order_items')) {
                return [[{ product_id: 11, variant_id: 21, quantity: 2 }]];
            }
            return [[]];
        }
    };
    db.getConnection = async () => fakeConnection;
    try {
        await Order.updateStatus(102, 'cancelled', {
            actorUserId: 'admin_1',
            restoreInventory: true
        });
    } finally {
        db.getConnection = originalGetConnection;
    }

    assert.equal(executed.some((entry) => entry.sql.includes('UPDATE product_variants SET quantity = quantity + ? WHERE id = ?')), false);
    assert.equal(executed.some((entry) => entry.sql.includes('UPDATE products SET quantity = quantity + ? WHERE id = ?')), false);
});
