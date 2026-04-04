const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const { createMockRes, requireFresh, withPatched } = require('./testUtils');
const Order = require('../models/Order');
const User = require('../models/User');
const CompanyProfile = require('../models/CompanyProfile');
const { PaymentAttempt } = require('../models/PaymentAttempt');
const invoicePdf = require('../utils/invoicePdf');
const communicationService = require('../services/communications/communicationService');
const paymentReconciliationService = require('../services/paymentReconciliationService');
const abandonedCartRecoveryService = require('../services/abandonedCartRecoveryService');
const pushNotificationService = require('../services/pushNotificationService');

const createMockSendRes = () => ({
    statusCode: 200,
    body: undefined,
    headers: {},
    status(code) {
        this.statusCode = code;
        return this;
    },
    json(payload) {
        this.body = payload;
        return this;
    },
    setHeader(key, value) {
        this.headers[key] = value;
    },
    send(payload) {
        this.body = payload;
        return this;
    }
});

const waitFor = async (predicate, { attempts = 20, delayMs = 0 } = {}) => {
    for (let index = 0; index < attempts; index += 1) {
        if (predicate()) return;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error('Timed out waiting for async condition');
};

test('order read resolver prefers stored order tax mode over display pricing and item inference', () => {
    const mode = Order.__test.resolveStoredOrderTaxPriceMode({
        taxPriceMode: 'exclusive',
        companySnapshot: { taxPriceMode: 'inclusive' },
        displayPricing: { taxPriceMode: 'inclusive' },
        items: [
            {
                item_snapshot: {
                    taxPriceMode: 'inclusive',
                    unitPriceBase: 100,
                    unitPriceGross: 118,
                    lineTotalBase: 100,
                    lineTotalGross: 118
                }
            }
        ]
    });

    assert.equal(mode, 'exclusive');
});

test('order read resolver falls back to display pricing tax mode when top-level order mode is missing', () => {
    const mode = Order.__test.resolveStoredOrderTaxPriceMode({
        taxPriceMode: '',
        companySnapshot: { taxPriceMode: 'exclusive' },
        displayPricing: { taxPriceMode: 'inclusive' },
        items: []
    });

    assert.equal(mode, 'inclusive');
});

test('invoice resolver prefers stored order tax mode over display pricing and item inference', () => {
    const mode = invoicePdf.__test.resolveInvoiceTaxPriceMode({
        tax_price_mode: 'exclusive',
        display_pricing: { taxPriceMode: 'inclusive' },
        company_snapshot: { taxPriceMode: 'inclusive' },
        items: [
            {
                item_snapshot: {
                    taxPriceMode: 'inclusive',
                    unitPriceBase: 100,
                    unitPriceGross: 118,
                    lineTotalBase: 100,
                    lineTotalGross: 118
                }
            }
        ]
    });

    assert.equal(mode, 'exclusive');
});

test('communication resolver prefers display pricing tax mode before company snapshot fallback', () => {
    const mode = communicationService.__test.resolveOrderTaxPriceMode({
        tax_price_mode: '',
        display_pricing: { taxPriceMode: 'inclusive' },
        company_snapshot: { taxPriceMode: 'exclusive' },
        items: []
    });

    assert.equal(mode, 'inclusive');
});

test('order lifecycle template preserves stored order tax mode and includes round off', () => {
    const template = communicationService.__test.buildOrderLifecycleTemplate({
        stage: 'confirmed',
        customer: { name: 'Audit User', email: 'audit@example.com', mobile: '9999999999' },
        order: {
            id: 1,
            order_ref: 'REF-AUDIT-1',
            loyalty_tier: 'gold',
            subtotal: 118,
            shipping_fee: 0,
            coupon_discount_value: 18,
            loyalty_discount_total: 0,
            loyalty_shipping_discount_total: 0,
            discount_total: 18,
            tax_total: 18,
            round_off_amount: -0.01,
            tax_price_mode: 'exclusive',
            display_pricing: {
                taxPriceMode: 'inclusive',
                displaySubtotalBase: 100,
                displayShippingBase: 0,
                displayBaseBeforeDiscounts: 100,
                displayValueAfterDiscountsBase: 84
            },
            items: [
                {
                    quantity: 1,
                    price: 118,
                    line_total: 118,
                    item_snapshot: {
                        quantity: 1,
                        title: 'Audit Necklace',
                        unitPriceBase: 100,
                        unitPriceGross: 118,
                        lineTotalBase: 100,
                        lineTotalGross: 118,
                        taxAmount: 18
                    }
                }
            ]
        },
        includeInvoice: false
    });

    assert.match(String(template.html || ''), /Taxable Value After Discounts/i);
    assert.doesNotMatch(String(template.html || ''), />Value After Discounts</i);
    assert.match(String(template.html || ''), /Round Off:/i);
});

test('admin invoice send flow passes preserved tax snapshot through to communication payload', async () => {
    let communicationPayload = null;
    const originalSendOrderLifecycleCommunication = communicationService.sendOrderLifecycleCommunication;
    communicationService.sendOrderLifecycleCommunication = async (payload) => {
        communicationPayload = payload;
        return {
            email: { ok: true },
            whatsapp: { ok: true }
        };
    };

    const controller = requireFresh('../controllers/orderController');
    const req = { params: { id: '101' } };
    const res = createMockRes();

    try {
        await withPatched(Order, {
            getById: async () => ({
                id: 101,
                user_id: 'u1',
                order_ref: 'REF-101',
                payment_status: 'paid',
                tax_price_mode: 'exclusive',
                round_off_amount: -0.01,
                display_pricing: {
                    taxPriceMode: 'inclusive',
                    displayValueAfterDiscountsBase: 84
                }
            })
        }, async () => withPatched(User, {
            findById: async () => ({
                id: 'u1',
                name: 'Audit User',
                email: 'audit@example.com',
                mobile: '9999999999'
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
        assert.equal(communicationPayload.order.tax_price_mode, 'exclusive');
        assert.equal(communicationPayload.order.round_off_amount, -0.01);
        assert.equal(communicationPayload.order.display_pricing.taxPriceMode, 'inclusive');
    } finally {
        communicationService.sendOrderLifecycleCommunication = originalSendOrderLifecycleCommunication;
    }
});

test('getMyOrders returns preserved tax snapshot fields from paginated order payloads', async () => {
    const controller = requireFresh('../controllers/orderController');
    const req = {
        user: { id: 'u1' },
        query: { page: '1', limit: '10', duration: '30' }
    };
    const res = createMockRes();

    await withPatched(Order, {
        getByUserPaginated: async () => ({
            orders: [{
                id: 201,
                order_ref: 'REF-201',
                tax_price_mode: 'exclusive',
                round_off_amount: -0.01,
                display_pricing: {
                    taxPriceMode: 'inclusive',
                    displayValueAfterDiscountsBase: 84
                }
            }],
            total: 1,
            totalPages: 1
        })
    }, async () => {
        await controller.getMyOrders(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.orders[0].tax_price_mode, 'exclusive');
    assert.equal(res.body.orders[0].round_off_amount, -0.01);
    assert.equal(res.body.orders[0].display_pricing.taxPriceMode, 'inclusive');
});

test('downloadMyInvoicePdf passes preserved tax snapshot fields to invoice builder', async () => {
    const req = {
        params: { id: '301' },
        user: { id: 'u1' }
    };
    const res = createMockSendRes();
    let invoiceOrder = null;

    await withPatched(Order, {
        getById: async () => ({
            id: 301,
            user_id: 'u1',
            order_ref: 'REF-301',
            payment_status: 'paid',
            tax_price_mode: 'exclusive',
            round_off_amount: -0.01,
            display_pricing: {
                taxPriceMode: 'inclusive',
                displayValueAfterDiscountsBase: 84
            },
            company_snapshot: {
                taxPriceMode: 'exclusive',
                address: 'Saved Address',
                supportEmail: 'saved@example.com',
                contactNumber: '9999999999',
                logoUrl: '/logo.webp'
            }
        })
    }, async () => withPatched(CompanyProfile, {
        get: async () => ({
            taxPriceMode: 'inclusive',
            address: 'Live Address',
            supportEmail: 'live@example.com',
            contactNumber: '8888888888',
            logoUrl: '/live-logo.webp'
        })
    }, async () => withPatched(invoicePdf, {
        buildInvoicePdfBuffer: async (order) => {
            invoiceOrder = order;
            return Buffer.from('pdf');
        }
    }, async () => {
        const controller = requireFresh('../controllers/orderController');
        await controller.downloadMyInvoicePdf(req, res);
    })));

    assert.equal(res.statusCode, 200);
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(invoiceOrder.tax_price_mode, 'exclusive');
    assert.equal(invoiceOrder.round_off_amount, -0.01);
    assert.equal(invoiceOrder.display_pricing.taxPriceMode, 'inclusive');
    assert.equal(invoiceOrder.company_snapshot.taxPriceMode, 'exclusive');
    assert.equal(invoiceOrder.company_snapshot.address, 'Saved Address');
});

test('downloadAdminInvoicePdf passes preserved tax snapshot fields to invoice builder', async () => {
    const req = {
        params: { id: '351' }
    };
    const res = createMockSendRes();
    let invoiceOrder = null;

    await withPatched(Order, {
        getById: async () => ({
            id: 351,
            user_id: 'u1',
            order_ref: 'REF-351',
            payment_status: 'paid',
            tax_price_mode: 'exclusive',
            round_off_amount: -0.01,
            display_pricing: {
                taxPriceMode: 'inclusive',
                displayValueAfterDiscountsBase: 84
            },
            company_snapshot: {
                taxPriceMode: 'exclusive',
                address: 'Saved Address',
                supportEmail: 'saved@example.com',
                contactNumber: '9999999999',
                logoUrl: '/logo.webp'
            }
        })
    }, async () => withPatched(CompanyProfile, {
        get: async () => ({
            taxPriceMode: 'inclusive',
            address: 'Live Address',
            supportEmail: 'live@example.com',
            contactNumber: '8888888888',
            logoUrl: '/live-logo.webp'
        })
    }, async () => withPatched(invoicePdf, {
        buildInvoicePdfBuffer: async (order) => {
            invoiceOrder = order;
            return Buffer.from('pdf');
        }
    }, async () => {
        const controller = requireFresh('../controllers/orderController');
        await controller.downloadAdminInvoicePdf(req, res);
    })));

    assert.equal(res.statusCode, 200);
    assert.ok(Buffer.isBuffer(res.body));
    assert.equal(invoiceOrder.tax_price_mode, 'exclusive');
    assert.equal(invoiceOrder.round_off_amount, -0.01);
    assert.equal(invoiceOrder.display_pricing.taxPriceMode, 'inclusive');
    assert.equal(invoiceOrder.company_snapshot.taxPriceMode, 'exclusive');
    assert.equal(invoiceOrder.company_snapshot.address, 'Saved Address');
});

test('getAdminOrderById returns preserved tax snapshot fields', async () => {
    const controller = requireFresh('../controllers/orderController');
    const req = { params: { id: '401' } };
    const res = createMockRes();

    await withPatched(Order, {
        getById: async () => ({
            id: 401,
            order_ref: 'REF-401',
            tax_price_mode: 'exclusive',
            round_off_amount: -0.01,
            display_pricing: {
                taxPriceMode: 'inclusive',
                displayValueAfterDiscountsBase: 84
            }
        })
    }, async () => {
        await controller.getAdminOrderById(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.order.tax_price_mode, 'exclusive');
    assert.equal(res.body.order.round_off_amount, -0.01);
    assert.equal(res.body.order.display_pricing.taxPriceMode, 'inclusive');
});

test('getAdminOrders returns preserved tax snapshot fields in list payloads', async () => {
    const controller = requireFresh('../controllers/orderController');
    const req = {
        query: {
            page: '1',
            limit: '20',
            status: 'all',
            search: '',
            startDate: '',
            endDate: '',
            quickRange: 'last_90_days',
            sortBy: 'newest',
            sourceChannel: 'all'
        }
    };
    const res = createMockRes();

    await withPatched(Order, {
        getPaginated: async () => ({
            orders: [{
                id: 451,
                order_ref: 'REF-451',
                tax_price_mode: 'exclusive',
                round_off_amount: -0.01,
                display_pricing: {
                    taxPriceMode: 'inclusive',
                    displayValueAfterDiscountsBase: 84
                }
            }],
            total: 1,
            totalPages: 1
        }),
        getMetrics: async () => ({
            totalOrders: 1,
            totalRevenue: 118
        })
    }, async () => {
        await controller.getAdminOrders(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.orders[0].tax_price_mode, 'exclusive');
    assert.equal(res.body.orders[0].round_off_amount, -0.01);
    assert.equal(res.body.orders[0].display_pricing.taxPriceMode, 'inclusive');
});

test('convertAdminPaymentAttemptToOrder preserves stored tax snapshot through response and lifecycle communication', async () => {
    let paymentAttemptReads = 0;
    let communicationPayload = null;
    const originalSendOrderLifecycleCommunication = communicationService.sendOrderLifecycleCommunication;
    communicationService.sendOrderLifecycleCommunication = async (payload) => {
        communicationPayload = payload;
        return {
            email: { ok: true },
            whatsapp: { ok: true }
        };
    };

    const controller = requireFresh('../controllers/orderController');
    const req = {
        user: { id: 'admin-1', role: 'admin' },
        params: { id: '501' },
        body: {
            paymentMode: 'manual',
            conversionReason: 'audit safe conversion'
        },
        app: { get: () => null }
    };
    const res = createMockRes();
    const convertedOrder = {
        id: 601,
        user_id: 'u1',
        order_ref: 'REF-601',
        status: 'confirmed',
        payment_status: 'paid',
        tax_price_mode: 'exclusive',
        round_off_amount: -0.01,
        display_pricing: {
            taxPriceMode: 'inclusive',
            displayValueAfterDiscountsBase: 84
        }
    };

    try {
        await withPatched(PaymentAttempt, {
            getById: async () => {
                paymentAttemptReads += 1;
                if (paymentAttemptReads === 1) {
                    return {
                        id: 501,
                        user_id: 'u1',
                        status: 'created',
                        local_order_id: null
                    };
                }
                return {
                    id: 501,
                    user_id: 'u1',
                    status: 'created',
                    local_order_id: 601
                };
            }
        }, async () => withPatched(Order, {
            createManualOrderFromAttempt: async () => ({ ...convertedOrder }),
            getById: async () => ({ ...convertedOrder })
        }, async () => withPatched(User, {
            findById: async () => ({
                id: 'u1',
                name: 'Audit User',
                email: 'audit@example.com',
                mobile: '9999999999'
            })
        }, async () => withPatched(invoicePdf, {
            buildInvoicePdfBuffer: async () => Buffer.from('pdf')
        }, async () => {
            await controller.convertAdminPaymentAttemptToOrder(req, res);
            await waitFor(() => communicationPayload !== null);
        }))));

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.order.tax_price_mode, 'exclusive');
        assert.equal(res.body.order.round_off_amount, -0.01);
        assert.equal(res.body.order.display_pricing.taxPriceMode, 'inclusive');
        assert.equal(res.body.attempt.local_order_id, 601);
        assert.equal(communicationPayload.order.tax_price_mode, 'exclusive');
        assert.equal(communicationPayload.order.round_off_amount, -0.01);
        assert.equal(communicationPayload.order.display_pricing.taxPriceMode, 'inclusive');
    } finally {
        communicationService.sendOrderLifecycleCommunication = originalSendOrderLifecycleCommunication;
    }
});

test('reconcileAdminPaymentAttempt returns preserved tax snapshot fields from reconciled order', async () => {
    const originalReconcilePaymentAttemptById = paymentReconciliationService.reconcilePaymentAttemptById;
    paymentReconciliationService.reconcilePaymentAttemptById = async () => ({
        order: { id: 701 }
    });

    const controller = requireFresh('../controllers/orderController');
    const req = {
        user: { role: 'admin' },
        params: { id: '701' },
        app: { get: () => null }
    };
    const res = createMockRes();
    let paymentAttemptReads = 0;

    try {
        await withPatched(PaymentAttempt, {
            getById: async () => {
                paymentAttemptReads += 1;
                if (paymentAttemptReads === 1) {
                    return { id: 701, status: 'attempted', local_order_id: null };
                }
                return { id: 701, status: 'paid', local_order_id: 801 };
            }
        }, async () => withPatched(Order, {
            getById: async () => ({
                id: 801,
                order_ref: 'REF-801',
                payment_status: 'paid',
                tax_price_mode: 'exclusive',
                round_off_amount: -0.01,
                display_pricing: {
                    taxPriceMode: 'inclusive',
                    displayValueAfterDiscountsBase: 84
                }
            })
        }, async () => {
            await controller.reconcileAdminPaymentAttempt(req, res);
        }));

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.order.tax_price_mode, 'exclusive');
        assert.equal(res.body.order.round_off_amount, -0.01);
        assert.equal(res.body.order.display_pricing.taxPriceMode, 'inclusive');
        assert.equal(res.body.attempt.local_order_id, 801);
    } finally {
        paymentReconciliationService.reconcilePaymentAttemptById = originalReconcilePaymentAttemptById;
    }
});

test('getMyPaymentAttemptStatus preserves stored tax snapshot through order creation and lifecycle communications', async () => {
    let orderLifecyclePayload = null;
    let paymentLifecyclePayload = null;
    const originalSendOrderLifecycleCommunication = communicationService.sendOrderLifecycleCommunication;
    const originalSendPaymentLifecycleCommunication = communicationService.sendPaymentLifecycleCommunication;
    const originalEnsureCapturedPaymentMatchesAttempt = paymentReconciliationService.ensureCapturedPaymentMatchesAttempt;
    communicationService.sendOrderLifecycleCommunication = async (payload) => {
        orderLifecyclePayload = payload;
        return {
            email: { ok: true },
            whatsapp: { ok: true }
        };
    };
    communicationService.sendPaymentLifecycleCommunication = async (payload) => {
        paymentLifecyclePayload = payload;
        return {
            email: { ok: true },
            whatsapp: { ok: true }
        };
    };
    paymentReconciliationService.ensureCapturedPaymentMatchesAttempt = async ({ attempt }) => ({
        attempt: {
            ...attempt,
            razorpay_order_id: 'razor-order-1'
        },
        paymentId: 'pay_123',
        paymentDetails: {
            settlement_id: 'set_123'
        }
    });

    const controller = requireFresh('../controllers/orderController');
    const req = {
        user: { id: 'u1' },
        params: { id: '901' },
        app: { get: () => null }
    };
    const res = createMockRes();
    let paymentAttemptReads = 0;
    const finalOrder = {
        id: 902,
        user_id: 'u1',
        order_ref: 'REF-902',
        status: 'confirmed',
        payment_status: 'paid',
        tax_price_mode: 'exclusive',
        round_off_amount: -0.01,
        display_pricing: {
            taxPriceMode: 'inclusive',
            displayValueAfterDiscountsBase: 84
        },
        items: []
    };

    try {
        await withPatched(pushNotificationService, {
            sendToAdmins: async () => ({ ok: true })
        }, async () => {
            await withPatched(abandonedCartRecoveryService, {
                markRecoveredByOrder: async () => ({ ok: true })
            }, async () => {
                await withPatched(PaymentAttempt, {
                    getById: async () => {
                        paymentAttemptReads += 1;
                        if (paymentAttemptReads === 1) {
                            return {
                                id: 901,
                                user_id: 'u1',
                                status: 'attempted',
                                local_order_id: null,
                                razorpay_payment_id: 'pay_123',
                                razorpay_order_id: 'razor-order-1',
                                razorpay_signature: 'sig_123'
                            };
                        }
                        return {
                            id: 901,
                            user_id: 'u1',
                            status: 'paid',
                            local_order_id: 902,
                            razorpay_payment_id: 'pay_123',
                            razorpay_order_id: 'razor-order-1',
                            razorpay_signature: 'sig_123'
                        };
                    },
                    beginVerificationLock: async () => true
                }, async () => {
                    await withPatched(Order, {
                        createManualOrderFromAttempt: async () => ({ ...finalOrder }),
                        getById: async () => ({ ...finalOrder })
                    }, async () => {
                        await withPatched(User, {
                            findById: async () => ({
                                id: 'u1',
                                name: 'Audit User',
                                email: 'audit@example.com',
                                mobile: '9999999999'
                            })
                        }, async () => {
                            await withPatched(invoicePdf, {
                                buildInvoicePdfBuffer: async () => Buffer.from('pdf')
                            }, async () => {
                                await controller.getMyPaymentAttemptStatus(req, res);
                                await waitFor(() => orderLifecyclePayload !== null && paymentLifecyclePayload !== null);
                            });
                        });
                    });
                });
            });
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.order.tax_price_mode, 'exclusive');
        assert.equal(res.body.order.round_off_amount, -0.01);
        assert.equal(res.body.order.display_pricing.taxPriceMode, 'inclusive');
        assert.equal(orderLifecyclePayload.order.tax_price_mode, 'exclusive');
        assert.equal(orderLifecyclePayload.order.round_off_amount, -0.01);
        assert.equal(orderLifecyclePayload.order.display_pricing.taxPriceMode, 'inclusive');
        assert.equal(paymentLifecyclePayload.order.tax_price_mode, 'exclusive');
        assert.equal(paymentLifecyclePayload.order.round_off_amount, -0.01);
        assert.equal(paymentLifecyclePayload.order.display_pricing.taxPriceMode, 'inclusive');
    } finally {
        communicationService.sendOrderLifecycleCommunication = originalSendOrderLifecycleCommunication;
        communicationService.sendPaymentLifecycleCommunication = originalSendPaymentLifecycleCommunication;
        paymentReconciliationService.ensureCapturedPaymentMatchesAttempt = originalEnsureCapturedPaymentMatchesAttempt;
    }
});
