const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRes, withPatched } = require('./testUtils');

const db = require('../config/db');
const Product = require('../models/Product');
const productController = require('../controllers/productController');

const sampleProduct = () => ({
    id: 'prod_1',
    title: 'Chain',
    status: 'active',
    mrp: 1000,
    discount_price: 900,
    tax_config_id: 7,
    track_quantity: 1,
    quantity: 12,
    track_low_stock: 1,
    low_stock_threshold: 3,
    media: [{ type: 'image', url: '/img.jpg' }],
    categories: ['Gold'],
    related_products: { show: true, category: 'Gold' },
    additional_info: [],
    options: [],
    variants: [
        {
            id: 'var_1',
            variant_title: '16 inch',
            price: 1000,
            discount_price: 900,
            quantity: 12,
            track_quantity: 1,
            track_low_stock: 1,
            low_stock_threshold: 3,
            image_url: '/img.jpg'
        }
    ]
});

test('public product API returns storefront-safe payload only', async () => {
    const req = { params: { id: 'prod_1' } };
    const res = createMockRes();

    await withPatched(Product, {
        findById: async () => sampleProduct()
    }, async () => {
        await productController.getSingleProduct(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.tax_config_id, undefined);
    assert.equal(res.body.track_low_stock, 1);
    assert.equal(res.body.low_stock_threshold, 3);
    assert.equal(res.body.available_quantity, 12);
    assert.equal(res.body.variants[0].track_low_stock, 1);
    assert.equal(res.body.variants[0].low_stock_threshold, 3);
    assert.equal(res.body.variants[0].available_quantity, 12);
    assert.equal(res.body.variants[0].quantity, 1);
});

test('inactive product is hidden from public product API', async () => {
    const req = { params: { id: 'prod_1' } };
    const res = createMockRes();

    await withPatched(Product, {
        findById: async () => ({ ...sampleProduct(), status: 'inactive' })
    }, async () => {
        await productController.getSingleProduct(req, res);
    });

    assert.equal(res.statusCode, 404);
});

test('admin product API path returns full product payload', async () => {
    const req = { params: { id: 'prod_1' }, user: { role: 'admin' } };
    const res = createMockRes();

    await withPatched(Product, {
        findById: async () => sampleProduct()
    }, async () => {
        await productController.getSingleProduct(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.tax_config_id, 7);
    assert.equal(res.body.quantity, 12);
    assert.equal(res.body.variants[0].quantity, 12);
});

test('public category endpoints exclude empty categories while admin can still access full lists', async () => {
    const publicReq = {};
    const adminReq = { user: { role: 'admin' } };
    const publicRes = createMockRes();
    const adminRes = createMockRes();

    await withPatched(Product, {
        getAllCategories: async ({ publicOnly = false } = {}) => publicOnly ? ['Gold'] : ['Gold', 'Empty'],
        getCategoriesWithStats: async ({ publicOnly = false } = {}) => publicOnly
            ? [{ id: 1, name: 'Gold', product_count: 2 }]
            : [{ id: 1, name: 'Gold', product_count: 2 }, { id: 2, name: 'Empty', product_count: 0 }]
    }, async () => {
        await productController.getCategories(publicReq, publicRes);
        await productController.getCategories(adminReq, adminRes);
    });

    assert.deepEqual(publicRes.body, ['Gold']);
    assert.deepEqual(adminRes.body, ['Gold', 'Empty']);
});

test('product update emit sends public payload to non-admins and full payload to admins', () => {
    const emitted = [];
    const io = {
        except(room) {
            return {
                emit(event, payload) {
                    emitted.push({ scope: `except:${room}`, event, payload });
                }
            };
        },
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ scope: `to:${room}`, event, payload });
                }
            };
        }
    };
    const req = { app: { get: () => io } };
    productController.__test.emitProductEvent(req, 'product:update', sampleProduct());

    const publicEmit = emitted.find((entry) => entry.scope === 'except:admin');
    const adminEmit = emitted.find((entry) => entry.scope === 'to:admin');

    assert.equal(publicEmit.payload.tax_config_id, undefined);
    assert.equal(publicEmit.payload.quantity, 1);
    assert.equal(adminEmit.payload.tax_config_id, 7);
    assert.equal(adminEmit.payload.quantity, 12);
});

test('category assignment and removal rebuild product category mapping', async () => {
    const executed = [];
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql, params) {
            executed.push({ sql, params });
            if (sql.includes('SELECT 1 FROM product_categories')) return [[]];
            if (sql.includes('SELECT COALESCE(MAX(display_order)')) return [[{ max_order: 2 }]];
            if (sql.includes('SELECT id, name, system_key, is_immutable')) return [[{ id: 10, name: 'Gold', system_key: null, is_immutable: 0 }]];
            if (sql.includes('SELECT id FROM products')) return [[{ id: 'prod_1' }]];
            return [[]];
        }
    };

    const originalGetConnection = db.getConnection;
    const originalRebuild = Product.rebuildCategoriesJsonForProducts;
    db.getConnection = async () => fakeConnection;
    let rebuiltIds = null;
    Product.rebuildCategoriesJsonForProducts = async (ids) => {
        rebuiltIds = ids;
    };

    try {
        await Product.manageCategoryProduct(10, 'prod_1', 'add');
        assert.deepEqual(rebuiltIds, ['prod_1']);
        assert.ok(executed.some((entry) => entry.sql.includes('INSERT INTO product_categories')));

        executed.length = 0;
        rebuiltIds = null;
        await Product.manageCategoryProduct(10, 'prod_1', 'remove');
        assert.deepEqual(rebuiltIds, ['prod_1']);
        assert.ok(executed.some((entry) => entry.sql.includes('DELETE FROM product_categories')));
    } finally {
        db.getConnection = originalGetConnection;
        Product.rebuildCategoriesJsonForProducts = originalRebuild;
    }
});

test('delete nonexistent category returns 404 contract error', async () => {
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute() {
            return [[]];
        }
    };
    const originalGetConnection = db.getConnection;
    db.getConnection = async () => fakeConnection;
    try {
        await assert.rejects(() => Product.deleteCategory(999), /Category not found/);
    } finally {
        db.getConnection = originalGetConnection;
    }
});

test('immutable category cannot be renamed or deleted', async () => {
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql) {
            if (sql.includes('SELECT name, system_key, is_immutable FROM categories')) {
                return [[{ name: 'Best Sellers', system_key: 'best_sellers', is_immutable: 1 }]];
            }
            return [[]];
        }
    };
    const originalGetConnection = db.getConnection;
    db.getConnection = async () => fakeConnection;
    try {
        await assert.rejects(() => Product.updateCategory(1, 'Other', null), /immutable/i);
        await assert.rejects(() => Product.deleteCategory(1), /cannot be deleted/i);
    } finally {
        db.getConnection = originalGetConnection;
    }
});

test('category reorder rejects duplicate, partial, and foreign product ids', async () => {
    const originalGetConnection = db.getConnection;
    const makeConnection = (currentIds) => ({
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql) {
            if (sql.includes('SELECT id, name, system_key, is_immutable FROM categories')) return [[{ id: 10, name: 'Gold' }]];
            if (sql.includes('SELECT product_id FROM product_categories')) {
                return [currentIds.map((id) => ({ product_id: id }))];
            }
            return [[]];
        }
    });

    try {
        db.getConnection = async () => makeConnection(['p1', 'p2']);
        await assert.rejects(() => Product.reorderCategoryProducts(10, ['p1', 'p1']), /Duplicate/);
        await assert.rejects(() => Product.reorderCategoryProducts(10, ['p1']), /include every product/);
        await assert.rejects(() => Product.reorderCategoryProducts(10, ['p1', 'p3']), /outside this category/);
    } finally {
        db.getConnection = originalGetConnection;
    }
});

test('category rename and delete update dependent related-product references', async () => {
    const updates = [];
    const fakeConnection = {
        async execute(sql, params) {
            if (sql.includes('SELECT id, related_products FROM products')) {
                return [[
                    { id: 'prod_1', related_products: JSON.stringify({ show: true, category: 'Gold' }) },
                    { id: 'prod_2', related_products: JSON.stringify({ show: true, category: 'Silver' }) }
                ]];
            }
            if (sql.includes('UPDATE products SET related_products')) {
                updates.push({ sql, params });
                return [{ affectedRows: 1 }];
            }
            return [[]];
        }
    };

    const renamed = await Product.syncRelatedProductsCategoryReference('Gold', 'Bridal', { connection: fakeConnection });
    assert.deepEqual(renamed, ['prod_1']);
    assert.equal(JSON.parse(updates[0].params[0]).category, 'Bridal');

    updates.length = 0;
    const removed = await Product.syncRelatedProductsCategoryReference('Gold', '', { connection: fakeConnection, disableIfMissing: true });
    assert.deepEqual(removed, ['prod_1']);
    const deletedPayload = JSON.parse(updates[0].params[0]);
    assert.equal(deletedPayload.category, '');
    assert.equal(deletedPayload.show, false);
});
