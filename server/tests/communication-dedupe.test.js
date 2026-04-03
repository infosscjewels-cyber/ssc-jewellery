const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

const db = require('../config/db');
const emailChannel = require('../services/communications/channels/emailChannel');
const whatsappChannel = require('../services/communications/channels/whatsappChannel');
const { requireFresh, withPatched } = require('./testUtils');
const { PAYMENT_STATUS } = require('../models/PaymentAttempt');

const loadCommunicationService = () => requireFresh('../services/communications/communicationService');

const withMockDedupeStore = async (fn) => {
    const seenKeys = new Set();
    return withPatched(db, {
        execute: async (sql, params = []) => {
            const statement = String(sql);
            if (statement.includes('INSERT INTO communication_dedupe_keys')) {
                const dedupeKey = String(params[0] || '');
                if (seenKeys.has(dedupeKey)) {
                    const error = new Error('Duplicate entry');
                    error.code = 'ER_DUP_ENTRY';
                    throw error;
                }
                seenKeys.add(dedupeKey);
                return [{ insertId: seenKeys.size }];
            }
            if (statement.includes('UPDATE communication_dedupe_keys')) {
                return [{ affectedRows: seenKeys.has(String(params[0] || '')) ? 1 : 0 }];
            }
            if (statement.includes('DELETE FROM communication_dedupe_keys')) {
                seenKeys.delete(String(params[0] || ''));
                return [{ affectedRows: 1 }];
            }
            if (statement.includes('INSERT INTO communication_delivery_logs')) {
                return [{ insertId: 1 }];
            }
            return [[]];
        }
    }, () => fn(seenKeys));
};

test('order lifecycle communication dedupes duplicate sends per channel', async () => {
    let emailCalls = 0;
    let whatsappCalls = 0;

    await withMockDedupeStore(async () => {
        await withPatched(emailChannel, {
            sendEmail: async () => {
                emailCalls += 1;
                return { ok: true, provider: 'smtp' };
            }
        }, async () => withPatched(whatsappChannel, {
            sendWhatsapp: async () => {
                whatsappCalls += 1;
                return { ok: true, provider: 'whatsapp' };
            }
        }, async () => {
            const service = loadCommunicationService();
            const payload = {
                stage: 'completed',
                customer: { name: 'A', email: 'a@example.com', mobile: '9999999999' },
                order: { id: 'ord_1', order_ref: 'REF-1', user_id: 'u1' },
                includeInvoice: false
            };

            const first = await service.sendOrderLifecycleCommunication(payload);
            const second = await service.sendOrderLifecycleCommunication(payload);

            assert.equal(first.email.ok, true);
            assert.equal(first.whatsapp.ok, true);
            assert.equal(second.email.ok, false);
            assert.equal(second.email.reason, 'duplicate_communication');
            assert.equal(second.whatsapp.ok, false);
            assert.equal(second.whatsapp.reason, 'duplicate_communication');
            assert.equal(emailCalls, 1);
            assert.equal(whatsappCalls, 1);
        }));
    });
});

test('payment lifecycle communication dedupes duplicate sends per channel', async () => {
    let emailCalls = 0;
    let whatsappCalls = 0;

    await withMockDedupeStore(async () => {
        await withPatched(emailChannel, {
            sendEmail: async () => {
                emailCalls += 1;
                return { ok: true, provider: 'smtp' };
            }
        }, async () => withPatched(whatsappChannel, {
            sendWhatsapp: async () => {
                whatsappCalls += 1;
                return { ok: true, provider: 'whatsapp' };
            }
        }, async () => {
            const service = loadCommunicationService();
            const payload = {
                stage: PAYMENT_STATUS.PAID,
                customer: { name: 'A', email: 'a@example.com', mobile: '9999999999' },
                order: { id: 'ord_1', order_ref: 'REF-1', user_id: 'u1' },
                payment: { paymentStatus: PAYMENT_STATUS.PAID, razorpayOrderId: 'order_1' }
            };

            const first = await service.sendPaymentLifecycleCommunication(payload);
            const second = await service.sendPaymentLifecycleCommunication(payload);

            assert.equal(first.email.ok, true);
            assert.equal(first.whatsapp.ok, true);
            assert.equal(second.email.ok, false);
            assert.equal(second.email.reason, 'duplicate_communication');
            assert.equal(second.whatsapp.ok, false);
            assert.equal(second.whatsapp.reason, 'duplicate_communication');
            assert.equal(emailCalls, 1);
            assert.equal(whatsappCalls, 1);
        }));
    });
});

test('communication dedupe key is released when a send fails so retry can succeed', async () => {
    let emailCalls = 0;
    let failFirstEmail = true;

    await withMockDedupeStore(async (seenKeys) => {
        await withPatched(emailChannel, {
            sendEmail: async () => {
                emailCalls += 1;
                if (failFirstEmail) {
                    failFirstEmail = false;
                    throw new Error('smtp transient failure');
                }
                return { ok: true, provider: 'smtp' };
            }
        }, async () => withPatched(whatsappChannel, {
            sendWhatsapp: async () => ({ ok: false, skipped: true, reason: 'missing_whatsapp' })
        }, async () => {
            const service = loadCommunicationService();
            const payload = {
                stage: 'confirmed',
                customer: { name: 'A', email: 'a@example.com', mobile: '' },
                order: { id: 'ord_1', order_ref: 'REF-1', user_id: 'u1' },
                includeInvoice: false,
                allowWhatsapp: false
            };

            const first = await service.sendOrderLifecycleCommunication(payload);
            assert.equal(first.email.ok, false);
            assert.equal(first.email.reason, 'email_send_failed');
            assert.equal(emailCalls, 1);
            assert.equal(seenKeys.size, 0);

            const second = await service.sendOrderLifecycleCommunication(payload);
            assert.equal(second.email.ok, true);
            assert.equal(emailCalls, 2);
        }));
    });
});

test('invoice communication can bypass dedupe for intentional resend flows', async () => {
    let emailCalls = 0;
    let whatsappCalls = 0;

    await withPatched(db, {
        execute: async () => {
            throw new Error('dedupe storage should not be used when disableDedupe is true');
        }
    }, async () => withPatched(emailChannel, {
        sendEmail: async () => {
            emailCalls += 1;
            return { ok: true, provider: 'smtp' };
        }
    }, async () => withPatched(whatsappChannel, {
        sendWhatsapp: async () => {
            whatsappCalls += 1;
            return { ok: true, provider: 'whatsapp' };
        }
    }, async () => {
        const service = loadCommunicationService();
        const payload = {
            stage: 'invoice',
            customer: { name: 'A', email: 'a@example.com', mobile: '9999999999' },
            order: { id: 'ord_1', order_ref: 'REF-1', user_id: 'u1' },
            includeInvoice: true,
            invoiceShareUrl: 'https://shop.example.com/invoice/REF-1',
            disableDedupe: true
        };

        const first = await service.sendOrderLifecycleCommunication(payload);
        const second = await service.sendOrderLifecycleCommunication(payload);

        assert.equal(first.email.ok, true);
        assert.equal(first.whatsapp.ok, true);
        assert.equal(second.email.ok, true);
        assert.equal(second.whatsapp.ok, true);
        assert.equal(emailCalls, 2);
        assert.equal(whatsappCalls, 2);
    })));
});
