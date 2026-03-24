const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRes, importClientModule, withPatched } = require('./testUtils');

const db = require('../config/db');
const Cart = require('../models/Cart');
const cartController = require('../controllers/cartController');
const Wishlist = require('../models/Wishlist');
const abandonedCartRecoveryService = require('../services/abandonedCartRecoveryService');
const CompanyProfile = require('../models/CompanyProfile');
const TaxConfig = require('../models/TaxConfig');
const Order = require('../models/Order');
const Coupon = require('../models/Coupon');

test('cart maps variant items with low-stock metadata and out-of-stock state', async () => {
    const originalExecute = db.execute;
    db.execute = async () => [[{
        user_id: 'u1',
        product_id: 'prod_1',
        variant_id: 'var_1',
        quantity: 2,
        title: 'Chain',
        media: JSON.stringify([{ url: '/main.jpg' }]),
        categories: JSON.stringify(['Gold']),
        mrp: 1500,
        discount_price: 1200,
        status: 'active',
        product_weight_kg: 0.02,
        product_track_quantity: 1,
        product_quantity: 10,
        product_track_low_stock: 1,
        product_low_stock_threshold: 3,
        resolved_variant_id: 'var_1',
        variant_title: '16 inch',
        variant_price: 1300,
        variant_discount_price: 1100,
        variant_image_url: '/variant.jpg',
        variant_weight_kg: 0.03,
        variant_track_quantity: 1,
        variant_quantity: 2,
        variant_track_low_stock: 1,
        variant_low_stock_threshold: 3
    }]];

    try {
        const items = await Cart.getByUser('u1');
        assert.equal(items.length, 1);
        assert.equal(items[0].variantId, 'var_1');
        assert.equal(items[0].imageUrl, '/variant.jpg');
        assert.equal(items[0].trackLowStock, true);
        assert.equal(items[0].availableQuantity, 2);
        assert.equal(items[0].lowStockThreshold, 3);
        assert.equal(items[0].isLowStock, true);
        assert.equal(items[0].isOutOfStock, false);
    } finally {
        db.execute = originalExecute;
    }
});

test('cart marks tracked zero-quantity items as out of stock', async () => {
    const originalExecute = db.execute;
    db.execute = async () => [[{
        user_id: 'u1',
        product_id: 'prod_1',
        variant_id: '',
        quantity: 1,
        title: 'Chain',
        media: JSON.stringify([{ url: '/main.jpg' }]),
        categories: JSON.stringify(['Gold']),
        mrp: 1500,
        discount_price: 1200,
        status: 'active',
        product_weight_kg: 0.02,
        product_track_quantity: 1,
        product_quantity: 0,
        product_track_low_stock: 1,
        product_low_stock_threshold: 3,
        variant_title: null,
        variant_price: null,
        variant_discount_price: null,
        variant_image_url: null,
        variant_weight_kg: null,
        variant_track_quantity: null,
        variant_quantity: null,
        variant_track_low_stock: null,
        variant_low_stock_threshold: null
    }]];

    try {
        const items = await Cart.getByUser('u1');
        assert.equal(items[0].isOutOfStock, true);
    } finally {
        db.execute = originalExecute;
    }
});

test('guest cart merge after login uses bulk add and returns merged items', async () => {
    const req = {
        user: { id: 'u1' },
        body: {
            items: [
                { productId: 'prod_1', variantId: 'var_1', quantity: 2 }
            ]
        },
        app: { get: () => ({ to: () => ({ emit() {} }) }) }
    };
    const res = createMockRes();

    await withPatched(Cart, {
        bulkAdd: async () => {},
        getByUser: async () => [{ productId: 'prod_1', variantId: 'var_1', quantity: 2 }]
    }, async () => withPatched(Wishlist, {
        removeForCartAdd: async () => 0
    }, async () => withPatched(abandonedCartRecoveryService, {
        trackCartActivity: async () => ({ journeyId: 11 })
    }, async () => {
        await cartController.bulkAddCart(req, res);
    })));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.items, [{ productId: 'prod_1', variantId: 'var_1', quantity: 2 }]);
});

test('cart add rejects variants that do not belong to the selected product', async () => {
    const originalGetConnection = db.getConnection;
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql) {
            if (sql.includes('FROM products p')) {
                return [[{
                    product_id: 'prod_1',
                    product_status: 'active',
                    product_track_quantity: 1,
                    product_quantity: 5,
                    resolved_variant_id: null,
                    variant_track_quantity: null,
                    variant_quantity: null
                }]];
            }
            if (sql.includes('SELECT quantity FROM cart_items')) {
                return [[{ quantity: 0 }]];
            }
            return [[]];
        }
    };

    db.getConnection = async () => fakeConnection;
    try {
        await assert.rejects(
            () => Cart.addItem('u1', 'prod_1', 'foreign_variant', 1),
            /selected variant is unavailable/i
        );
    } finally {
        db.getConnection = originalGetConnection;
    }
});

test('cart quantity update rejects values above tracked stock', async () => {
    const originalGetConnection = db.getConnection;
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql) {
            if (sql.includes('FROM products p')) {
                return [[{
                    product_id: 'prod_1',
                    product_status: 'active',
                    product_track_quantity: 1,
                    product_quantity: 2,
                    resolved_variant_id: null,
                    variant_track_quantity: null,
                    variant_quantity: null
                }]];
            }
            return [[]];
        }
    };

    db.getConnection = async () => fakeConnection;
    try {
        await assert.rejects(
            () => Cart.setItemQuantity('u1', 'prod_1', '', 3),
            /only 2 item\(s\) available/i
        );
    } finally {
        db.getConnection = originalGetConnection;
    }
});

test('checkout pricing computes GST after discounts and on mixed product tax rates', async () => {
    const originalCompanyGet = CompanyProfile.get;
    const originalListActive = TaxConfig.listActive;
    CompanyProfile.get = async () => ({ taxEnabled: true });
    TaxConfig.listActive = async () => ([
        { id: 1, name: 'GST 3%', code: 'GST3', ratePercent: 3, isDefault: 0 },
        { id: 2, name: 'GST 5%', code: 'GST5', ratePercent: 5, isDefault: 1 }
    ]);

    try {
        const result = await Order.__test.computeTaxForItems({
            connection: {},
            orderItems: [
                { productId: 'p1', taxConfigId: 1, lineTotal: 1000, snapshot: {} },
                { productId: 'p2', taxConfigId: 2, lineTotal: 500, snapshot: {} }
            ],
            subtotal: 1500,
            shippingFee: 100,
            couponDiscountTotal: 150,
            loyaltyDiscountTotal: 75,
            loyaltyShippingDiscountTotal: 20
        });

        assert.equal(result.items.length, 2);
        assert.equal(result.items[0].taxBase, 850);
        assert.equal(result.items[0].taxAmount, 25.5);
        assert.equal(result.items[1].taxBase, 425);
        assert.equal(result.items[1].taxAmount, 21.25);
        assert.equal(result.taxTotal, 29.5 + 21.25); // shipping tax 5% on 80 = 4.00, plus item taxes
        assert.equal(result.taxBreakup.length, 2);
        const fivePct = result.taxBreakup.find((entry) => Number(entry.taxId) === 2);
        assert.equal(fivePct.taxableBase, 505);
    } finally {
        CompanyProfile.get = originalCompanyGet;
        TaxConfig.listActive = originalListActive;
    }
});

test('checkout blocks low-stock or inactive checkout items correctly', async () => {
    const availability = await importClientModule('client/src/utils/checkoutAvailability.js');

    assert.equal(availability.hasUnavailableCheckoutItems([{ status: 'active', isOutOfStock: false }]), false);
    assert.equal(availability.hasUnavailableCheckoutItems([{ status: 'inactive', isOutOfStock: false }]), true);
    assert.equal(availability.hasUnavailableCheckoutItems([{ status: 'active', isOutOfStock: true }]), true);
});

test('shipping coupons are marked ineligible when shipping fee is zero', async () => {
    const originalExecute = db.execute;
    db.execute = async (sql) => {
        if (sql.includes('FROM coupons c')) {
            return [[{
                id: 1,
                code: 'SHIPFREE',
                name: 'Free Shipping',
                source_type: 'admin',
                scope_type: 'generic',
                discount_type: 'shipping_full',
                discount_value: 100,
                max_discount_subunits: null,
                min_cart_subunits: 0,
                usage_limit_total: null,
                usage_limit_per_user: 1,
                used_count: 0,
                used_by_user: 0,
                is_user_target: 0,
                created_at: new Date().toISOString(),
                expires_at: null
            }]];
        }
        if (sql.includes('FROM abandoned_cart_discounts')) {
            return [[]];
        }
        return [[]];
    };

    try {
        const locked = await Coupon.getAvailableCouponsForUser({
            userId: 'u1',
            cartTotalSubunits: 50000,
            shippingFeeSubunits: 0,
            cartProductIds: ['prod_1']
        });
        assert.equal(locked[0].isEligible, false);

        const eligible = await Coupon.getAvailableCouponsForUser({
            userId: 'u1',
            cartTotalSubunits: 50000,
            shippingFeeSubunits: 12500,
            cartProductIds: ['prod_1']
        });
        assert.equal(eligible[0].isEligible, true);
    } finally {
        db.execute = originalExecute;
    }
});

test('shipping_full coupon ignores zero max discount cap in stored data', async () => {
    const originalExecute = db.execute;
    db.execute = async (sql) => {
        if (sql.includes('FROM coupons c')) {
            return [[{
                id: 15,
                code: 'SSC-4ZRQ-2R6X',
                name: 'Free Shipping',
                source_type: 'admin',
                scope_type: 'generic',
                discount_type: 'shipping_full',
                discount_value: 0,
                max_discount_subunits: 0,
                min_cart_subunits: 0,
                usage_limit_total: null,
                usage_limit_per_user: 1,
                is_active: 1,
                starts_at: new Date(Date.now() - 60_000).toISOString(),
                expires_at: new Date(Date.now() + 60_000).toISOString()
            }]];
        }
        if (sql.includes('FROM coupon_redemptions WHERE coupon_id = ?')) {
            return [[{ count: 0 }]];
        }
        if (sql.includes('FROM abandoned_cart_discounts')) {
            return [[]];
        }
        return [[]];
    };

    try {
        const resolved = await Coupon.resolveRedeemableCoupon({
            code: 'SSC-4ZRQ-2R6X',
            userId: 'u1',
            cartTotalSubunits: 50000,
            shippingFeeSubunits: 12500,
            cartProductIds: ['prod_1']
        });
        assert.equal(resolved.code, 'SSC-4ZRQ-2R6X');
        assert.equal(resolved.discountSubunits, 12500);
    } finally {
        db.execute = originalExecute;
    }
});

test('coupon validation allows saved-address fallback for shipping coupons', async () => {
    const req = {
        user: { id: 'u1' },
        body: {
            code: 'SHIPFREE',
            shippingAddress: null
        }
    };
    const res = createMockRes();
    const { validateRecoveryCoupon } = require('../controllers/orderController');

    await withPatched(Order, {
        getCheckoutSummary: async (userId, options = {}) => {
            assert.equal(userId, 'u1');
            assert.equal(options.couponCode, 'SHIPFREE');
            assert.equal(options.allowSavedAddressFallback, true);
            return {
                couponDiscountTotal: 125,
                total: 1400,
                coupon: { code: 'SHIPFREE', type: 'shipping_full' }
            };
        }
    }, async () => {
        await validateRecoveryCoupon(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.code, 'SHIPFREE');
    assert.equal(res.body.discountTotal, 125);
});

test('checkout summary rejects insufficient stock before payment initiation', async () => {
    const originalGetConnection = db.getConnection;
    const fakeConnection = {
        async execute(sql) {
            if (sql.includes('FROM cart_items ci')) {
                return [[{
                    quantity: 3,
                    product_id: 'prod_1',
                    variant_id: '',
                    product_title: 'Chain',
                    product_status: 'active',
                    tax_config_id: 1,
                    mrp: 1500,
                    product_discount_price: 1200,
                    product_weight_kg: 0.02,
                    product_track_quantity: 1,
                    product_quantity: 2,
                    resolved_variant_id: null,
                    variant_title: null,
                    variant_price: null,
                    variant_discount_price: null,
                    variant_weight_kg: null,
                    variant_track_quantity: null,
                    variant_quantity: null
                }]];
            }
            return [[]];
        },
        release() {}
    };
    db.getConnection = async () => fakeConnection;

    try {
        await assert.rejects(
            () => Order.getCheckoutSummary('u1', { shippingAddress: { state: 'TN' } }),
            /insufficient stock/i
        );
    } finally {
        db.getConnection = originalGetConnection;
    }
});
