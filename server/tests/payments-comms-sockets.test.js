const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { createMockRes, requireFresh, withPatched } = require('./testUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const { PaymentAttempt, PAYMENT_STATUS } = require('../models/PaymentAttempt');
const Order = require('../models/Order');
const User = require('../models/User');
const WebhookEvent = require('../models/WebhookEvent');
const socketAudience = require('../utils/socketAudience');
const db = require('../config/db');
const CompanyProfile = require('../models/CompanyProfile');

const loadOrderController = ({
    razorpayConfig = null,
    razorpayClient = null,
    comms = null,
    loyalty = null,
    abandonedCart = null
} = {}) => {
    const razorpayService = require('../services/razorpayService');
    const communicationService = require('../services/communications/communicationService');
    const loyaltyService = require('../services/loyaltyService');
    const abandonedCartService = require('../services/abandonedCartRecoveryService');

    if (razorpayConfig) {
        razorpayService.getRazorpayConfig = razorpayConfig;
    }
    if (razorpayClient) {
        razorpayService.createRazorpayClient = razorpayClient;
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

    return requireFresh('../controllers/orderController');
};

const loadCommunicationService = (patches = {}) => {
    const emailChannel = require('../services/communications/channels/emailChannel');
    const whatsappChannel = require('../services/communications/channels/whatsappChannel');
    if (patches.emailChannel) Object.assign(emailChannel, patches.emailChannel);
    if (patches.whatsappChannel) Object.assign(whatsappChannel, patches.whatsappChannel);
    return requireFresh('../services/communications/communicationService');
};

test('socket auth only joins rooms allowed by JWT-backed role and user id', () => {
    assert.equal(socketAudience.canAuthenticateSocketUser({ id: 'u1', role: 'customer', isActive: true }), true);
    assert.equal(socketAudience.canAuthenticateSocketUser({ id: 'u1', role: 'customer', isActive: false }), false);
    assert.equal(socketAudience.canAuthenticateSocketUser(null), false);
    assert.deepEqual(socketAudience.getSocketRoomsForUser({ userId: 'u1', role: 'customer' }), ['user:u1']);
    assert.deepEqual(socketAudience.getSocketRoomsForUser({ userId: 'u1', role: 'admin' }), ['user:u1', 'admin']);
    assert.deepEqual(socketAudience.getSocketRoomsForUser({ userId: 'u1', role: 'staff' }), ['user:u1', 'admin']);
    assert.deepEqual(socketAudience.getSocketRoomsForUser({ userId: '', role: 'guest' }), []);
});

test('order socket updates are scoped to admin and owning user only', () => {
    const emitted = [];
    const io = {
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ room, event, payload });
                }
            };
        }
    };

    socketAudience.emitToOrderAudiences(io, { id: 'ord_1', user_id: 'u1' }, 'order:update', { orderId: 'ord_1' });

    assert.deepEqual(emitted.map((entry) => entry.room), ['admin', 'user:u1']);
    assert.deepEqual(emitted.map((entry) => entry.event), ['order:update', 'order:update']);
});

test('verifyRazorpayPayment rejects invalid signatures', async () => {
    const controller = loadOrderController({
        razorpayConfig: async () => ({ keySecret: 'secret' }),
        razorpayClient: async () => ({ payments: { fetch: async () => ({}) } }),
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        },
        loyalty: { reassessUserTier: async () => ({}) },
        abandonedCart: { markRecoveredByOrder: async () => ({}) }
    });

    const req = {
        user: { id: 'u1' },
        body: {
            razorpay_payment_id: 'pay_1',
            razorpay_order_id: 'order_1',
            razorpay_signature: 'bad-signature'
        },
        app: { get: () => null }
    };
    const res = createMockRes();
    let failedPayload = null;

    await withPatched(PaymentAttempt, {
        getByRazorpayOrderId: async () => ({
            id: 'attempt_1',
            razorpay_order_id: 'order_1',
            amount_subunits: 1000,
            currency: 'INR',
            status: PAYMENT_STATUS.CREATED
        }),
        markFailed: async (payload) => {
            failedPayload = payload;
        }
    }, async () => {
        await controller.verifyRazorpayPayment(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /invalid payment signature/i);
    assert.equal(failedPayload.id, 'attempt_1');
});

test('verifyRazorpayPayment confirms a paid order on valid signature', async () => {
    const secret = 'secret';
    const paymentId = 'pay_1';
    const razorpayOrderId = 'order_1';
    const signature = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
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
                    settlement_id: 'settl_1'
                })
            }
        }),
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        },
        loyalty: { reassessUserTier: async () => ({}) },
        abandonedCart: { markRecoveredByOrder: async () => ({}) }
    });

    const emitted = [];
    const io = {
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ room, event, payload });
                }
            };
        }
    };
    const req = {
        user: { id: 'u1' },
        body: {
            razorpay_payment_id: paymentId,
            razorpay_order_id: razorpayOrderId,
            razorpay_signature: signature
        },
        app: { get: (key) => (key === 'io' ? io : null) }
    };
    const res = createMockRes();
    let verifiedPayload = null;

    await withPatched(PaymentAttempt, {
        getByRazorpayOrderId: async () => ({
            id: 'attempt_1',
            razorpay_order_id: razorpayOrderId,
            amount_subunits: 1000,
            currency: 'INR',
            status: PAYMENT_STATUS.CREATED,
            billing_address: { line1: 'Billing' },
            shipping_address: { line1: 'Shipping' },
            notes: {}
        }),
        beginVerificationLock: async () => true,
        consumeInventoryForAttempt: async () => {},
        markVerified: async (payload) => {
            verifiedPayload = payload;
            return true;
        },
        releaseInventoryForAttempt: async () => {
            throw new Error('should not release inventory for valid payment');
        }
    }, async () => withPatched(Order, {
        getCheckoutSummary: async () => ({ total: 10 }),
        createFromCart: async () => ({
            id: 'ord_1',
            order_ref: 'REF-1',
            user_id: 'u1',
            userId: 'u1',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        }),
        getById: async () => ({
            id: 'ord_1',
            order_ref: 'REF-1',
            user_id: 'u1',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        })
    }, async () => {
        await controller.verifyRazorpayPayment(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.verified, true);
    assert.equal(res.body.order.id, 'ord_1');
    assert.equal(verifiedPayload.localOrderId, 'ord_1');
    assert.deepEqual(emitted.map((entry) => `${entry.room}:${entry.event}`), [
        'admin:order:create',
        'user:u1:order:create',
        'admin:order:update',
        'user:u1:order:update',
        'admin:payment:update',
        'user:u1:payment:update'
    ]);
});

test('verifyRazorpayPayment still returns success if post-verify work fails', async () => {
    const secret = 'secret';
    const paymentId = 'pay_2';
    const razorpayOrderId = 'order_2';
    const signature = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${paymentId}`).digest('hex');
    const controller = loadOrderController({
        razorpayConfig: async () => ({ keySecret: secret }),
        razorpayClient: async () => ({
            payments: {
                fetch: async () => ({
                    id: paymentId,
                    order_id: razorpayOrderId,
                    amount: 1000,
                    currency: 'INR',
                    status: 'captured'
                })
            }
        }),
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        },
        loyalty: { reassessUserTier: async () => ({}) },
        abandonedCart: { markRecoveredByOrder: async () => ({}) }
    });

    const req = {
        user: { id: 'u1' },
        body: {
            razorpay_payment_id: paymentId,
            razorpay_order_id: razorpayOrderId,
            razorpay_signature: signature
        },
        app: {
            get: (key) => (key === 'io'
                ? {
                    to() {
                        return {
                            emit() {
                                throw new Error('socket emit failed');
                            }
                        };
                    }
                }
                : null)
        }
    };
    const res = createMockRes();
    let markFailedCalled = false;

    await withPatched(PaymentAttempt, {
        getByRazorpayOrderId: async () => ({
            id: 'attempt_2',
            razorpay_order_id: razorpayOrderId,
            amount_subunits: 1000,
            currency: 'INR',
            status: PAYMENT_STATUS.CREATED,
            billing_address: { line1: 'Billing' },
            shipping_address: { line1: 'Shipping' },
            notes: {}
        }),
        beginVerificationLock: async () => true,
        consumeInventoryForAttempt: async () => {},
        markVerified: async () => true,
        markFailed: async () => {
            markFailedCalled = true;
        }
    }, async () => withPatched(Order, {
        getCheckoutSummary: async () => ({ total: 10 }),
        createFromCart: async () => ({
            id: 'ord_2',
            order_ref: 'REF-2',
            user_id: 'u1',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        }),
        getById: async () => ({
            id: 'ord_2',
            order_ref: 'REF-2',
            user_id: 'u1',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        })
    }, async () => {
        await controller.verifyRazorpayPayment(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order.id, 'ord_2');
    assert.equal(markFailedCalled, false);
});

test('duplicate Razorpay webhook delivery is idempotent', async () => {
    const body = { event: 'payment.captured', payload: {} };
    const rawBody = JSON.stringify(body);
    const secret = 'webhook-secret';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const controller = loadOrderController({
        razorpayConfig: async () => ({ webhookSecret: secret }),
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        }
    });

    const req = {
        body,
        rawBody,
        headers: {
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': 'evt_1'
        },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(WebhookEvent, {
        register: async () => ({ duplicate: true })
    }, async () => {
        await controller.handleRazorpayWebhook(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.duplicate, true);
    assert.equal(res.body.eventId, 'evt_1');
});

test('paid webhook for normal checkout can materialize an order from the payment attempt snapshot', async () => {
    const body = {
        event: 'payment.captured',
        payload: {
            payment: {
                entity: {
                    id: 'pay_checkout_1',
                    order_id: 'order_checkout_1',
                    amount: 1000,
                    currency: 'INR'
                }
            }
        }
    };
    const rawBody = JSON.stringify(body);
    const secret = 'webhook-secret';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const controller = loadOrderController({
        razorpayConfig: async () => ({ webhookSecret: secret }),
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        },
        loyalty: { reassessUserTier: async () => ({}) },
        abandonedCart: { markRecoveredByOrder: async () => ({}) }
    });

    const req = {
        body,
        rawBody,
        headers: {
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': 'evt_checkout_paid'
        },
        app: {
            get: () => ({
                to() {
                    return { emit() {} };
                }
            })
        }
    };
    const res = createMockRes();
    let createFromAttemptPayload = null;

    await withPatched(WebhookEvent, {
        register: async () => ({ duplicate: false }),
        markProcessed: async () => {},
        markFailed: async () => {}
    }, async () => withPatched(PaymentAttempt, {
        getByRazorpayOrderIdAny: async () => ({
            id: 42,
            user_id: 'u1',
            razorpay_order_id: 'order_checkout_1',
            amount_subunits: 1000,
            currency: 'INR',
            status: PAYMENT_STATUS.CREATED,
            notes: { attemptSnapshot: { items: [{ productId: 'p1', quantity: 1, unitPrice: 10, lineTotal: 10, title: 'Chain' }] } }
        }),
        markPaidByRazorpayOrder: async () => {}
    }, async () => withPatched(Order, {
        updatePaymentByRazorpayOrderId: async () => 0,
        getByRazorpayPaymentId: async () => null,
        getByRazorpayOrderId: async () => null,
        createManualOrderFromAttempt: async (payload) => {
            createFromAttemptPayload = payload;
            return {
                id: 'ord_webhook_1',
                order_ref: 'REF-WEBHOOK',
                user_id: 'u1',
                status: 'confirmed',
                payment_status: PAYMENT_STATUS.PAID,
                payment_gateway: 'razorpay'
            };
        },
        getById: async () => ({
            id: 'ord_webhook_1',
            order_ref: 'REF-WEBHOOK',
            user_id: 'u1',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.PAID,
            payment_gateway: 'razorpay'
        })
    }, async () => {
        await controller.handleRazorpayWebhook(req, res);
    })));

    assert.equal(res.statusCode, 200);
    assert.equal(createFromAttemptPayload.paymentGateway, 'razorpay');
    assert.equal(createFromAttemptPayload.razorpayOrderId, 'order_checkout_1');
    assert.equal(createFromAttemptPayload.razorpayPaymentId, 'pay_checkout_1');
});

test('retryRazorpayPayment resolves the retryable attempt for the selected order', async () => {
    const controller = loadOrderController({
        razorpayConfig: async () => ({ keyId: 'rzp_test_123' }),
        razorpayClient: async () => ({
            orders: {
                create: async () => ({ id: 'rzp_order_retry', amount: 2500, currency: 'INR' })
            }
        })
    });
    const req = {
        user: { id: 'u1' },
        body: { orderId: 42 }
    };
    const res = createMockRes();
    let retryLookupPayload = null;
    let createdAttemptPayload = null;

    await withPatched(db, {
        execute: async () => [[{
            product_id: 'prod_1',
            variant_id: '',
            quantity: 1,
            product_title: 'Chain',
            product_status: 'active',
            mrp: 2500,
            product_discount_price: 2500,
            product_sku: 'CH-1',
            product_media: '[]',
            product_weight_kg: 0.02,
            resolved_variant_id: null,
            variant_title: null,
            variant_price: null,
            variant_discount_price: null,
            variant_sku: null,
            variant_image_url: null,
            variant_weight_kg: null,
            variant_options: null
        }]]
    }, async () => withPatched(Order, {
        getById: async (id) => ({
            id,
            user_id: 'u1',
            razorpay_order_id: 'order_for_42'
        }),
        getCheckoutSummary: async () => ({
            total: 25,
            currency: 'INR',
            itemCount: 1
        })
    }, async () => withPatched(PaymentAttempt, {
        getLatestRetryableForOrder: async ({ userId, razorpayOrderId }) => {
            retryLookupPayload = { userId, razorpayOrderId };
            return {
            id: 77,
            user_id: userId,
            razorpay_order_id: razorpayOrderId,
            status: PAYMENT_STATUS.FAILED,
            billing_address: { line1: 'Billing', city: 'Chennai', state: 'TN', zip: '600001' },
            shipping_address: { line1: 'Shipping', city: 'Chennai', state: 'TN', zip: '600001' },
            notes: {}
            };
        },
        create: async (payload) => {
            createdAttemptPayload = payload;
            return { id: 88 };
        },
        reserveInventoryForAttempt: async () => ({ reservedItems: 1 })
    }, async () => {
        await controller.retryRazorpayPayment(req, res);
    })));

    assert.equal(res.statusCode, 201);
    assert.deepEqual(retryLookupPayload, { userId: 'u1', razorpayOrderId: 'order_for_42' });
    assert.equal(createdAttemptPayload.notes.retryOfAttemptId, 77);
});

test('deleteAdminPaymentAttempt emits product updates when reserved inventory is released', async () => {
    const controller = loadOrderController();
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
    const req = {
        params: { id: '88' },
        app: { get: (key) => (key === 'io' ? io : null) }
    };
    const res = createMockRes();

    await withPatched(PaymentAttempt, {
        getById: async () => ({
            id: 88,
            local_order_id: null,
            status: PAYMENT_STATUS.FAILED
        }),
        releaseInventoryForAttempt: async () => ({ released: 1, productIds: ['prod_1'] }),
        deleteById: async () => true
    }, async () => withPatched(require('../models/Product'), {
        findById: async () => ({
            id: 'prod_1',
            title: 'Chain',
            status: 'active',
            mrp: 1000,
            discount_price: 900,
            track_quantity: 1,
            quantity: 4,
            track_low_stock: 1,
            low_stock_threshold: 5,
            media: [],
            categories: [],
            related_products: {},
            additional_info: [],
            options: [],
            variants: []
        })
    }, async () => {
        await controller.deleteAdminPaymentAttempt(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(emitted.map((entry) => `${entry.scope}:${entry.event}`), [
        'except:admin:product:update',
        'to:admin:product:update'
    ]);
});

test('admin attempt conversion rejects paid attempts', async () => {
    const controller = loadOrderController();
    const req = {
        params: { id: '12' },
        body: { paymentMode: 'manual', conversionReason: 'Gateway payment settled offline' },
        user: { id: 'admin_1', role: 'admin' }
    };
    const res = createMockRes();

    await withPatched(PaymentAttempt, {
        getById: async () => ({
            id: 12,
            status: PAYMENT_STATUS.PAID,
            local_order_id: null
        })
    }, async () => {
        await controller.convertAdminPaymentAttemptToOrder(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /only open or failed attempts can be converted manually/i);
});

test('updateOrderStatus rejects invalid lifecycle reversal', async () => {
    const controller = loadOrderController();
    const req = {
        params: { id: '12' },
        body: { status: 'pending' },
        user: { id: 'admin_1' },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(Order, {
        getById: async () => ({
            id: 12,
            status: 'completed',
            payment_status: 'paid'
        })
    }, async () => {
        await controller.updateOrderStatus(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /cannot move from completed to pending/i);
});

test('deleteAdminOrder blocks deletion of paid orders', async () => {
    const controller = loadOrderController();
    const req = {
        params: { id: '9' },
        app: { get: () => null }
    };
    const res = createMockRes();
    let deleteCalled = false;

    await withPatched(Order, {
        getById: async () => ({
            id: 9,
            status: 'confirmed',
            payment_status: 'paid',
            razorpay_payment_id: 'pay_123'
        }),
        deleteById: async () => {
            deleteCalled = true;
            return true;
        }
    }, async () => {
        await controller.deleteAdminOrder(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.equal(deleteCalled, false);
    assert.match(res.body.message, /cannot be deleted/i);
});

test('failed payment webhook updates payment attempt state and inventory release', async () => {
    const body = {
        event: 'payment.failed',
        payload: {
            payment: {
                entity: {
                    id: 'pay_1',
                    order_id: 'order_1',
                    error_description: 'bank declined'
                }
            }
        }
    };
    const rawBody = JSON.stringify(body);
    const secret = 'webhook-secret';
    const signature = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
    const controller = loadOrderController({
        razorpayConfig: async () => ({ webhookSecret: secret }),
        comms: {
            sendOrderLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } }),
            sendPaymentLifecycleCommunication: async () => ({ email: { ok: true }, whatsapp: { ok: true } })
        }
    });

    const req = {
        body,
        rawBody,
        headers: {
            'x-razorpay-signature': signature,
            'x-razorpay-event-id': 'evt_failed'
        },
        app: { get: () => null }
    };
    const res = createMockRes();
    let released = null;
    let markedFailed = null;
    let updatedPayment = null;
    let processed = null;

    await withPatched(WebhookEvent, {
        register: async () => ({ duplicate: false }),
        markProcessed: async (payload) => {
            processed = payload;
        }
    }, async () => withPatched(PaymentAttempt, {
        getByRazorpayOrderIdAny: async () => ({ id: 'attempt_1', user_id: 'u1' }),
        releaseInventoryForAttempt: async (payload) => {
            released = payload;
        },
        markFailedByRazorpayOrder: async (payload) => {
            markedFailed = payload;
        }
    }, async () => withPatched(Order, {
        getByRazorpayOrderId: async () => ({
            id: 'ord_1',
            user_id: 'u1',
            status: 'confirmed',
            payment_status: PAYMENT_STATUS.ATTEMPTED,
            payment_gateway: 'razorpay'
        }),
        updatePaymentByRazorpayOrderId: async (payload) => {
            updatedPayment = payload;
            return 1;
        }
    }, async () => {
        await controller.handleRazorpayWebhook(req, res);
    })));

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.paymentStatus, PAYMENT_STATUS.FAILED);
    assert.deepEqual(released, { attemptId: 'attempt_1', reason: 'payment_failed' });
    assert.equal(markedFailed.razorpayOrderId, 'order_1');
    assert.equal(updatedPayment.paymentStatus, PAYMENT_STATUS.FAILED);
    assert.equal(processed.status, 'processed');
});

test('order confirmation communication does not let WhatsApp failure block email', async () => {
    const service = loadCommunicationService({
        emailChannel: {
            sendEmail: async () => ({ ok: true, provider: 'smtp' })
        },
        whatsappChannel: {
            sendWhatsapp: async () => {
                throw new Error('whatsapp down');
            }
        }
    });

    const result = await service.sendOrderLifecycleCommunication({
        stage: 'confirmed',
        customer: { name: 'A', email: 'a@example.com', mobile: '9999999999' },
        order: { id: 'ord_1', order_ref: 'REF-1', user_id: 'u1' },
        includeInvoice: false
    });

    assert.equal(result.email.ok, true);
    assert.equal(result.whatsapp.ok, false);
    assert.equal(result.whatsapp.reason, 'whatsapp_send_failed');
});

test('payment lifecycle communication does not let email failure block WhatsApp', async () => {
    const service = loadCommunicationService({
        emailChannel: {
            sendEmail: async () => {
                throw new Error('smtp down');
            }
        },
        whatsappChannel: {
            sendWhatsapp: async () => ({ ok: true, provider: 'whatsapp' })
        }
    });

    const result = await service.sendPaymentLifecycleCommunication({
        stage: PAYMENT_STATUS.PAID,
        customer: { name: 'A', email: 'a@example.com', mobile: '9999999999' },
        order: { id: 'ord_1', order_ref: 'REF-1', user_id: 'u1' },
        payment: { paymentStatus: PAYMENT_STATUS.PAID, razorpayOrderId: 'order_1' }
    });

    assert.equal(result.email.ok, false);
    assert.equal(result.email.reason, 'email_send_failed');
    assert.equal(result.whatsapp.ok, true);
});

test('whatsapp channel respects admin global disable switch', async () => {
    const originalEnabled = process.env.WHATSAPP_ENABLED;
    const originalLicense = process.env.WHATSAPP_LICENSE_NUMBER;
    const originalApiKey = process.env.WHATSAPP_API_KEY;
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_LICENSE_NUMBER = 'license';
    process.env.WHATSAPP_API_KEY = 'api-key';

    const whatsappChannel = requireFresh('../services/communications/channels/whatsappChannel');
    whatsappChannel.__test.resetChannelCache();
    const originalExecute = db.execute;
    db.execute = async (sql) => {
        if (String(sql).includes('company_profile')) {
            return [[{ whatsapp_channel_enabled: 0, whatsapp_module_settings_json: JSON.stringify({}) }]];
        }
        return [[]];
    };
    try {
        const result = await whatsappChannel.sendWhatsapp({
            type: 'generic',
            template: 'generic',
            mobile: '9876543210',
            message: 'Test'
        });
        assert.equal(result.ok, false);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'whatsapp_disabled_by_admin');
    } finally {
        db.execute = originalExecute;
        whatsappChannel.__test.resetChannelCache();
        if (originalEnabled === undefined) delete process.env.WHATSAPP_ENABLED;
        else process.env.WHATSAPP_ENABLED = originalEnabled;
        if (originalLicense === undefined) delete process.env.WHATSAPP_LICENSE_NUMBER;
        else process.env.WHATSAPP_LICENSE_NUMBER = originalLicense;
        if (originalApiKey === undefined) delete process.env.WHATSAPP_API_KEY;
        else process.env.WHATSAPP_API_KEY = originalApiKey;
    }
});

test('whatsapp channel respects admin module disable switch', async () => {
    const originalEnabled = process.env.WHATSAPP_ENABLED;
    const originalLicense = process.env.WHATSAPP_LICENSE_NUMBER;
    const originalApiKey = process.env.WHATSAPP_API_KEY;
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_LICENSE_NUMBER = 'license';
    process.env.WHATSAPP_API_KEY = 'api-key';

    const whatsappChannel = requireFresh('../services/communications/channels/whatsappChannel');
    whatsappChannel.__test.resetChannelCache();
    const originalExecute = db.execute;
    db.execute = async (sql) => {
        if (String(sql).includes('company_profile')) {
            return [[{
                whatsapp_channel_enabled: 1,
                whatsapp_module_settings_json: JSON.stringify({ loginOtp: false })
            }]];
        }
        return [[]];
    };
    try {
        const result = await whatsappChannel.sendWhatsapp({
            type: 'login_otp',
            mobile: '9876543210',
            params: ['123456'],
            message: 'OTP'
        });
        assert.equal(result.ok, false);
        assert.equal(result.skipped, true);
        assert.equal(result.reason, 'whatsapp_module_disabled_by_admin');
        assert.equal(result.module, 'loginOtp');
    } finally {
        db.execute = originalExecute;
        whatsappChannel.__test.resetChannelCache();
        if (originalEnabled === undefined) delete process.env.WHATSAPP_ENABLED;
        else process.env.WHATSAPP_ENABLED = originalEnabled;
        if (originalLicense === undefined) delete process.env.WHATSAPP_LICENSE_NUMBER;
        else process.env.WHATSAPP_LICENSE_NUMBER = originalLicense;
        if (originalApiKey === undefined) delete process.env.WHATSAPP_API_KEY;
        else process.env.WHATSAPP_API_KEY = originalApiKey;
    }
});

test('sendAdminInvoiceCommunication reports only actually queued channels and uses invoice stage', async () => {
    const originalAppBaseUrl = process.env.APP_BASE_URL;
    process.env.APP_BASE_URL = 'https://shop.example.com';
    const invoicePdf = require('../utils/invoicePdf');
    let communicationPayload = null;
    const controller = loadOrderController({
        comms: {
            sendOrderLifecycleCommunication: async (payload) => {
                communicationPayload = payload;
                return {
                    email: { ok: false, skipped: true, reason: 'missing_email' },
                    whatsapp: { ok: true }
                };
            }
        }
    });

    const req = {
        params: { id: '101' }
    };
    const res = createMockRes();

    try {
        await withPatched(Order, {
            getById: async () => ({
                id: 101,
                user_id: 'u1',
                order_ref: 'REF-101',
                payment_status: PAYMENT_STATUS.PAID
            })
        }, async () => withPatched(User, {
            findById: async () => ({
                id: 'u1',
                name: 'User',
                email: '',
                mobile: '9876543210'
            })
        }, async () => withPatched(CompanyProfile, {
            get: async () => ({ whatsappChannelEnabled: true })
        }, async () => withPatched(invoicePdf, {
            buildInvoicePdfBuffer: async () => Buffer.from('pdf')
        }, async () => withPatched(global, {
            setImmediate: async (fn) => fn()
        }, async () => {
            await controller.sendAdminInvoiceCommunication(req, res);
        })))));

        assert.equal(res.statusCode, 202);
        assert.equal(res.body.queuedChannels.email, false);
        assert.equal(res.body.queuedChannels.whatsapp, true);
        assert.equal(res.body.skippedChannels.email, 'Customer email unavailable');
        assert.equal(communicationPayload.stage, 'invoice');
        assert.equal(communicationPayload.allowEmail, false);
        assert.equal(communicationPayload.allowWhatsapp, true);
        assert.match(String(communicationPayload.invoiceShareUrl || ''), /^https:\/\/shop\.example\.com\//);
    } finally {
        if (originalAppBaseUrl === undefined) delete process.env.APP_BASE_URL;
        else process.env.APP_BASE_URL = originalAppBaseUrl;
    }
});

test('welcome communication still attempts WhatsApp when email send fails', async () => {
    const communicationService = require('../services/communications/communicationService');
    communicationService.sendEmailCommunication = async () => {
        throw new Error('smtp down');
    };
    let whatsappPayload = null;
    communicationService.sendWhatsapp = async (payload) => {
        whatsappPayload = payload;
        return { ok: true };
    };
    const authController = requireFresh('../controllers/authController');

    await withPatched(global, {
        setImmediate: async (fn) => fn()
    }, async () => {
        authController.__test.dispatchWelcomeCommunication({
            name: 'Customer',
            email: 'welcome@example.com',
            mobile: '9999999999'
        });
        await Promise.resolve();
    });

    assert.equal(whatsappPayload.type, 'welcome');
    assert.equal(whatsappPayload.mobile, '9999999999');
});

test('loyalty upgrade communication still attempts WhatsApp when email send fails', async () => {
    const communicationService = require('../services/communications/communicationService');
    communicationService.sendEmailCommunication = async () => {
        throw new Error('smtp down');
    };
    let whatsappPayload = null;
    communicationService.sendWhatsapp = async (payload) => {
        whatsappPayload = payload;
        return { ok: true };
    };
    const loyaltyService = requireFresh('../services/loyaltyService');

    await assert.rejects(() => loyaltyService.__test.sendTierUpgradeMail({
        user: { id: 'u1', name: 'A', email: 'a@example.com', mobile: '9999999999' },
        previousTier: 'regular',
        newTier: 'gold',
        status: {
            progress: { message: 'Close to next tier' },
            profile: { label: 'Gold' }
        }
    }), /smtp down/);

    assert.equal(whatsappPayload.type, 'loyalty_upgrade');
    assert.equal(whatsappPayload.mobile, '9999999999');
});
