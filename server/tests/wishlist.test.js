const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const Wishlist = require('../models/Wishlist');
const wishlistController = require('../controllers/wishlistController');
const { createMockRes, withPatched } = require('./testUtils');

const createMockIo = () => {
    const emitted = [];
    return {
        emitted,
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ room, event, payload });
                }
            };
        }
    };
};

test('addWishlistItem rejects missing product id', async () => {
    const req = { user: { id: 'u1' }, body: {}, app: { get: () => createMockIo() } };
    const res = createMockRes();

    await wishlistController.addWishlistItem(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /productId required/i);
});

test('Wishlist.addItem rejects inactive products', async () => {
    await withPatched(db, {
        execute: async (query) => {
            if (String(query).includes('FROM products p')) {
                return [[{ product_id: 'prod_1', product_status: 'inactive', resolved_variant_id: null }]];
            }
            return [[]];
        }
    }, async () => {
        await assert.rejects(() => Wishlist.addItem('u1', 'prod_1', ''), /unavailable/i);
    });
});

test('Wishlist.addItem rejects mismatched variants', async () => {
    await withPatched(db, {
        execute: async (query) => {
            if (String(query).includes('FROM products p')) {
                return [[{ product_id: 'prod_1', product_status: 'active', resolved_variant_id: null }]];
            }
            return [[]];
        }
    }, async () => {
        await assert.rejects(() => Wishlist.addItem('u1', 'prod_1', 'var_bad'), /variant is unavailable/i);
    });
});

test('Wishlist.getByUser prunes stale product and variant rows', async () => {
    const deleteCalls = [];
    await withPatched(db, {
        execute: async (query, params) => {
            const sql = String(query);
            if (sql.includes('DELETE FROM wishlist_items')) {
                deleteCalls.push(params);
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('FROM wishlist_items')) {
                return [[
                    { product_id: 'prod_valid', variant_id: '', resolved_product_id: 'prod_valid', product_status: 'active', resolved_variant_id: null },
                    { product_id: 'prod_dead', variant_id: '', resolved_product_id: null, product_status: null, resolved_variant_id: null },
                    { product_id: 'prod_valid', variant_id: 'var_dead', resolved_product_id: 'prod_valid', product_status: 'active', resolved_variant_id: null }
                ]];
            }
            return [[]];
        }
    }, async () => {
        const items = await Wishlist.getByUser('u1');
        assert.deepEqual(items, [{ productId: 'prod_valid', variantId: '' }]);
    });

    assert.equal(deleteCalls.length, 1);
    assert.equal(deleteCalls[0][0], 'u1');
    const deletedPairs = [];
    for (let i = 1; i < deleteCalls[0].length; i += 2) {
        deletedPairs.push([deleteCalls[0][i], deleteCalls[0][i + 1]]);
    }
    deletedPairs.sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])));
    assert.deepEqual(deletedPairs, [['prod_dead', ''], ['prod_valid', 'var_dead']]);
});

test('Wishlist.getByUser returns prune metadata when requested', async () => {
    await withPatched(db, {
        execute: async (query) => {
            const sql = String(query);
            if (sql.includes('DELETE FROM wishlist_items')) {
                return [{ affectedRows: 1 }];
            }
            if (sql.includes('FROM wishlist_items')) {
                return [[
                    { product_id: 'prod_valid', variant_id: '', resolved_product_id: 'prod_valid', product_status: 'active', resolved_variant_id: null },
                    { product_id: 'prod_dead', variant_id: '', resolved_product_id: null, product_status: null, resolved_variant_id: null }
                ]];
            }
            return [[]];
        }
    }, async () => {
        const result = await Wishlist.getByUser('u1', { withMeta: true });
        assert.deepEqual(result, {
            items: [{ productId: 'prod_valid', variantId: '' }],
            prunedCount: 1
        });
    });
});

test('addWishlistItem emits scoped wishlist update after successful add', async () => {
    const io = createMockIo();
    const req = {
        user: { id: 'u1' },
        body: { productId: 'prod_1', variantId: 'var_1' },
        app: { get: () => io }
    };
    const res = createMockRes();

    await withPatched(Wishlist, {
        addItem: async () => {},
        getByUser: async () => [{ productId: 'prod_1', variantId: 'var_1' }]
    }, async () => {
        await wishlistController.addWishlistItem(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(io.emitted, [{
        room: 'user:u1',
        event: 'wishlist:update',
        payload: {
            items: [{ productId: 'prod_1', variantId: 'var_1' }],
            productIds: ['prod_1']
        }
    }]);
});

test('getWishlist emits scoped wishlist update when stale rows are pruned', async () => {
    const io = createMockIo();
    const req = {
        user: { id: 'u1' },
        app: { get: () => io }
    };
    const res = createMockRes();

    await withPatched(Wishlist, {
        getByUser: async () => ({
            items: [{ productId: 'prod_1', variantId: '' }],
            prunedCount: 2
        })
    }, async () => {
        await wishlistController.getWishlist(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        items: [{ productId: 'prod_1', variantId: '' }],
        productIds: ['prod_1']
    });
    assert.deepEqual(io.emitted, [{
        room: 'user:u1',
        event: 'wishlist:update',
        payload: {
            items: [{ productId: 'prod_1', variantId: '' }],
            productIds: ['prod_1']
        }
    }]);
});
