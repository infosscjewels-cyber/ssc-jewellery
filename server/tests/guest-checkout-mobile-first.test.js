const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const { createMockRes, requireFresh, withPatched } = require('./testUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../models/User');
const Order = require('../models/Order');
const Cart = require('../models/Cart');
const CompanyProfile = require('../models/CompanyProfile');
const db = require('../config/db');
const { PaymentAttempt, PAYMENT_STATUS } = require('../models/PaymentAttempt');

const loadOrderController = ({
    razorpayConfig = null,
    razorpayClient = null,
    reconciliation = null,
    comms = null,
    loyalty = null,
    abandonedCart = null,
    auth = null
} = {}) => {
    const razorpayService = require('../services/razorpayService');
    const paymentReconciliationService = require('../services/paymentReconciliationService');
    const communicationService = require('../services/communications/communicationService');
    const loyaltyService = require('../services/loyaltyService');
    const abandonedCartService = require('../services/abandonedCartRecoveryService');
    const authController = require('../controllers/authController');

    if (razorpayConfig) {
        razorpayService.getRazorpayConfig = razorpayConfig;
    }
    if (razorpayClient) {
        razorpayService.createRazorpayClient = razorpayClient;
    }
    if (reconciliation) {
        Object.assign(paymentReconciliationService, reconciliation);
    }
    if (comms) {
        Object.assign(communicationService, comms);
    }
    if (loyalty) {
        Object.assign(loyaltyService, loyalty);
    }
    if (abandonedCart) {
        Object.assign(abandonedCartService, abandonedCart);
    }
    if (auth) {
        Object.assign(authController, auth);
    }

    return requireFresh('../controllers/orderController');
};

test('lookupGuestCheckoutAccount returns masked profile for existing mobile matches', async () => {
    const controller = loadOrderController();
    const req = {
        body: { mobile: '9876543210' }
    };
    const res = createMockRes();

    await withPatched(User, {
        findAllByMobile: async () => ([
            {
                id: 'cust_1',
                role: 'customer',
                isActive: true,
                name: 'Raman',
                email: 'raman@example.com',
                mobile: '9876543210',
                address: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' }
            }
        ])
    }, async () => {
        await controller.lookupGuestCheckoutAccount(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.status, 'existing_account_locked');
    assert.equal(res.body.maskedProfile.email.includes('raman@example.com'), false);
    assert.equal(res.body.maskedProfile.shippingAddress.includes('12 Street'), false);
    assert.equal(res.body.maskedProfile.shippingAddressFields.line1.includes('12 Street'), false);
    assert.equal(res.body.maskedProfile.shippingAddressFields.city.includes('Chennai'), false);
    assert.equal(res.body.maskedProfile.shippingAddressFields.state.includes('Tamil Nadu'), false);
    assert.equal(res.body.maskedProfile.shippingAddressFields.zip.includes('600001'), false);
    assert.equal(res.body.otpRequiredForEdit, true);
});

test('verifyPublicRazorpayPayment confirms a paid order for public guest flow', async () => {
    const secret = 'secret';
    const paymentId = 'pay_public_1';
    const razorpayOrderId = 'order_public_1';
    const signature = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
    const attemptToken = jwt.sign({
        type: 'checkout_attempt_access',
        attemptId: 88,
        userId: 'u_public',
        razorpayOrderId
    }, process.env.JWT_SECRET, { expiresIn: '2h' });

    const controller = loadOrderController({
        razorpayConfig: async () => ({ keySecret: secret }),
        razorpayClient: async () => ({
            payments: {
                fetch: async () => ({
                    id: paymentId,
                    order_id: razorpayOrderId,
                    amount: 1000,
                    currency: 'INR',
                    status: 'captured',
                    settlement_id: 'settl_public_1'
                })
            }
        }),
        reconciliation: {
            ensureCapturedPaymentMatchesAttempt: async ({ attempt }) => ({
                attempt: {
                    ...attempt,
                    status: PAYMENT_STATUS.PAID,
                    razorpay_payment_id: paymentId,
                    razorpay_signature: signature
                },
                paymentDetails: {
                    settlement_id: 'settl_public_1'
                },
                reusedExistingOrder: false
            })
        },
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        },
        loyalty: { reassessUserTier: async () => ({}) },
        abandonedCart: { markRecoveredByOrder: async () => ({}) }
    });

    const req = {
        body: {
            attemptId: 88,
            attemptToken,
            razorpay_payment_id: paymentId,
            razorpay_order_id: razorpayOrderId,
            razorpay_signature: signature
        },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(PaymentAttempt, {
        getById: async () => ({
            id: 88,
            user_id: 'u_public',
            razorpay_order_id: razorpayOrderId,
            amount_subunits: 1000,
            currency: 'INR',
            status: PAYMENT_STATUS.CREATED,
            billing_address: { line1: 'Billing' },
            shipping_address: { line1: 'Shipping' },
            notes: {}
        }),
        beginVerificationLock: async () => true,
        markVerified: async () => true,
        releaseInventoryForAttempt: async () => {
            throw new Error('should not release inventory for valid payment');
        }
    }, async () => withPatched(Order, {
        getByRazorpayPaymentId: async () => null,
        createManualOrderFromAttempt: async () => ({
            id: 'ord_public_1',
            order_ref: 'REF-PUBLIC-1',
            user_id: 'u_public',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        }),
        getById: async () => ({
            id: 'ord_public_1',
            order_ref: 'REF-PUBLIC-1',
            user_id: 'u_public',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        })
    }, async () => {
        await controller.verifyPublicRazorpayPayment(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verified, true);
    assert.equal(res.body.order.id, 'ord_public_1');
});

test('createPublicRazorpayOrder allows existing mobile accounts to use saved addresses without guest overrides', async () => {
    const controller = loadOrderController({
        razorpayConfig: async () => ({ keyId: 'rzp_test_key' }),
        razorpayClient: async () => ({
            orders: {
                create: async () => ({
                    id: 'order_public_existing_1',
                    amount: 100000,
                    currency: 'INR'
                })
            }
        })
    });
    const req = {
        body: {
            guest: {
                name: '',
                email: '',
                mobile: '9876543210'
            },
            shippingAddress: null,
            billingAddress: null,
            notes: { source: 'web_checkout' },
            items: [{ productId: 'prod_1', variantId: '', quantity: 1 }]
        },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(User, {
        findAllByMobile: async () => ([
            {
                id: 'cust_existing_1',
                role: 'customer',
                isActive: true,
                name: 'Raman',
                email: 'raman@example.com',
                mobile: '9876543210',
                address: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' },
                billingAddress: { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' }
            }
        ])
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
        execute: async () => ([[
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
        ]])
    }, async () => withPatched(PaymentAttempt, {
        create: async ({ billingAddress, shippingAddress }) => {
            assert.deepEqual(shippingAddress, { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' });
            assert.deepEqual(billingAddress, { line1: '12 Street', city: 'Chennai', state: 'Tamil Nadu', zip: '600001' });
            return { id: 91 };
        },
        markCheckoutOpened: async () => {}
    }, async () => {
        await controller.createPublicRazorpayOrder(req, res);
    }))))));

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.order.id, 'order_public_existing_1');
    assert.equal(res.body.keyId, 'rzp_test_key');
    assert.equal(typeof res.body.attemptToken, 'string');
    assert.ok(res.body.attemptToken.length > 0);
});

test('createPublicRazorpayOrder dispatches welcome communication for newly created guest accounts', async () => {
    let welcomedUserId = null;
    const controller = loadOrderController({
        razorpayConfig: async () => ({ keyId: 'rzp_test_key' }),
        razorpayClient: async () => ({
            orders: {
                create: async () => ({
                    id: 'order_public_new_1',
                    amount: 100000,
                    currency: 'INR'
                })
            }
        }),
        auth: {
            dispatchWelcomeCommunication: (user) => {
                welcomedUserId = user?.id || null;
            }
        }
    });
    const req = {
        body: {
            guest: {
                name: 'Fresh Guest',
                email: 'fresh.guest@example.com',
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
        create: async () => ({ id: 'cust_new_1' }),
        findById: async () => ({
            id: 'cust_new_1',
            role: 'customer',
            name: 'Fresh Guest',
            email: 'fresh.guest@example.com',
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
        execute: async () => ([[
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
        ]])
    }, async () => withPatched(PaymentAttempt, {
        create: async () => ({ id: 92 }),
        markCheckoutOpened: async () => {}
    }, async () => {
        await controller.createPublicRazorpayOrder(req, res);
    }))))));

    assert.equal(res.statusCode, 201);
    assert.equal(welcomedUserId, 'cust_new_1');
});
