const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRes, requireFresh, withPatched } = require('./testUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CompanyProfile = require('../models/CompanyProfile');
const db = require('../config/db');
const { PaymentAttempt } = require('../models/PaymentAttempt');

const loadOrderController = ({
    razorpayConfig = null,
    razorpayClient = null,
    auth = null
} = {}) => {
    const razorpayService = require('../services/razorpayService');
    const authController = require('../controllers/authController');

    if (razorpayConfig) {
        razorpayService.getRazorpayConfig = razorpayConfig;
    }
    if (razorpayClient) {
        razorpayService.createRazorpayClient = razorpayClient;
    }
    if (auth) {
        Object.assign(authController, auth);
    }

    return requireFresh('../controllers/orderController');
};

test('createPublicRazorpayOrder stores blank guest email as null', async () => {
    let insertedEmail = 'not-set';

    const controller = loadOrderController({
        razorpayConfig: async () => ({ keyId: 'rzp_test_key' }),
        razorpayClient: async () => ({
            orders: {
                create: async () => ({
                    id: 'order_public_blank_email_1',
                    amount: 100000,
                    currency: 'INR'
                })
            }
        }),
        auth: {
            dispatchWelcomeCommunication: () => {}
        }
    });

    const req = {
        body: {
            guest: {
                name: 'Fresh Guest',
                email: '',
                mobile: '9123456789'
            },
            shippingAddress: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' },
            billingAddress: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' },
            notes: { source: 'web_checkout' },
            items: [{ productId: 'prod_1', variantId: '', quantity: 1 }]
        },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(User, {
        findAllByMobile: async () => ([]),
        findByEmail: async () => null,
        findByMobile: async () => null,
        findById: async (id) => ({
            id,
            role: 'customer',
            name: 'Fresh Guest',
            email: null,
            mobile: '9123456789',
            address: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' },
            billingAddress: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' }
        }),
        toSafePayload: (user) => ({ id: user.id, email: user.email, mobile: user.mobile, name: user.name })
    }, async () => withPatched(CompanyProfile, {
        get: async () => ({ storefrontOpen: true })
    }, async () => withPatched(Cart, {
        clearUser: async () => {},
        bulkAdd: async () => {},
        getByUser: async () => ([])
    }, async () => withPatched(Order, {
        getCheckoutSummary: async () => ({
            total: 1000,
            currency: 'INR',
            itemCount: 1,
            items: [
                {
                    productId: 'prod_1',
                    variantId: '',
                    quantity: 1,
                    unitPrice: 1000,
                    lineTotal: 1000
                }
            ]
        })
    }, async () => withPatched(db, {
        execute: async (query, params = []) => {
            if (String(query).includes('INSERT INTO users')) {
                insertedEmail = params[2];
                return [{ affectedRows: 1 }];
            }
            return [[
                {
                    product_id: 'prod_1',
                    variant_id: '',
                    quantity: 1,
                    product_title: 'Guest Product',
                    product_status: 'active',
                    product_categories: '[]',
                    product_sub_category: '',
                    mrp: 1000,
                    product_discount_price: 1000,
                    product_sku: 'SKU-1',
                    product_media: '[]',
                    product_weight_kg: 0,
                    resolved_variant_id: null,
                    variant_title: '',
                    variant_price: null,
                    variant_discount_price: null,
                    variant_sku: null,
                    variant_image_url: null,
                    variant_weight_kg: null,
                    variant_options: null
                }
            ]];
        }
    }, async () => withPatched(PaymentAttempt, {
        create: async () => ({ id: 93 }),
        markCheckoutOpened: async () => {}
    }, async () => {
        await controller.createPublicRazorpayOrder(req, res);
    }))))));

    assert.equal(res.statusCode, 201);
    assert.equal(insertedEmail, null);
});
