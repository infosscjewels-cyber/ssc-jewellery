const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const emailChannel = require('../services/communications/channels/emailChannel');
const whatsappChannel = require('../services/communications/channels/whatsappChannel');
const CompanyProfile = require('../models/CompanyProfile');
const { requireFresh, withPatched } = require('./testUtils');

test('company profile update keeps email enabled and applies WhatsApp toggle', async () => {
    const calls = [];
    await withPatched(db, {
        execute: async (sql, params = []) => {
            calls.push({ sql: String(sql), params });
            if (String(sql).includes('SELECT * FROM company_profile WHERE id = 1')) {
                return [[{
                    id: 1,
                    display_name: 'SSC Jewellery',
                    email_channel_enabled: 1,
                    whatsapp_channel_enabled: 0,
                    whatsapp_module_settings_json: JSON.stringify({ loginOtp: false, order: true }),
                    razorpay_key_secret: '',
                    razorpay_webhook_secret: ''
                }]];
            }
            return [{ insertId: 1 }];
        }
    }, async () => {
        const result = await CompanyProfile.update({
            displayName: 'SSC Jewellery',
            whatsappChannelEnabled: false,
            emailChannelEnabled: false,
            whatsappModuleSettings: {
                loginOtp: false,
                order: true
            }
        });
        assert.equal(result.emailChannelEnabled, true);
        assert.equal(result.whatsappChannelEnabled, false);
        assert.equal(result.whatsappModuleSettings.loginOtp, false);
        assert.equal(result.whatsappModuleSettings.order, true);
        assert.equal(result.whatsappModuleSettings.welcome, true);
    });

    const writeCall = calls.find((entry) => entry.sql.includes('INSERT INTO company_profile'));
    assert.ok(writeCall);
    assert.equal(writeCall.params[11], 1);
    assert.equal(writeCall.params[12], 0);
    assert.match(String(writeCall.params[13]), /"loginOtp":false/);
});

test('sendEmailCommunication queues failed email attempts', async () => {
    const inserts = [];
    await withPatched(emailChannel, {
        sendEmail: async () => {
            throw new Error('smtp down');
        }
    }, async () => withPatched(db, {
        execute: async (sql, params = []) => {
            if (String(sql).includes('INSERT INTO communication_delivery_logs')) {
                inserts.push({ sql: String(sql), params });
                return [{ insertId: 12 }];
            }
            return [[]];
        }
    }, async () => {
        const communicationService = requireFresh('../services/communications/communicationService');
        await assert.rejects(
            () => communicationService.sendEmailCommunication({
                to: 'user@example.com',
                subject: 'Subject',
                html: '<p>Hello</p>',
                workflow: 'order'
            }),
            /smtp down/
        );
    }));

    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].params[0], 'email');
    assert.equal(inserts[0].params[1], 'order');
    assert.equal(inserts[0].params[2], 'user@example.com');
});

test('sendWhatsapp queues failed provider responses', async () => {
    const inserts = [];
    await withPatched(whatsappChannel, {
        sendWhatsapp: async () => ({ ok: false, skipped: false, reason: 'provider_down' })
    }, async () => withPatched(db, {
        execute: async (sql, params = []) => {
            if (String(sql).includes('INSERT INTO communication_delivery_logs')) {
                inserts.push({ sql: String(sql), params });
                return [{ insertId: 24 }];
            }
            return [[]];
        }
    }, async () => {
        const communicationService = requireFresh('../services/communications/communicationService');
        const result = await communicationService.sendWhatsapp({
            type: 'loyalty_progress',
            mobile: '919999999999',
            message: 'Hello'
        });
        assert.equal(result.ok, false);
    }));

    assert.equal(inserts.length, 1);
    assert.equal(inserts[0].params[0], 'whatsapp');
    assert.equal(inserts[0].params[1], 'loyalty_progress');
    assert.equal(inserts[0].params[2], '919999999999');
});

test('retry processor marks queued email send as sent after replay success', async () => {
    const updates = [];
    const mockConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        async execute(sql) {
            if (String(sql).includes('SELECT *') && String(sql).includes('communication_delivery_logs')) {
                return [[{
                    id: 77,
                    channel: 'email',
                    workflow: 'order',
                    recipient: 'user@example.com',
                    payload_json: JSON.stringify({
                        to: 'user@example.com',
                        subject: 'Queued',
                        html: '<p>Queued</p>'
                    }),
                    attempt_count: 1,
                    max_attempts: 3
                }]];
            }
            return [[]];
        },
        async query(sql, params = []) {
            updates.push({ sql: String(sql), params });
            return [[]];
        },
        release() {}
    };

    await withPatched(emailChannel, {
        sendEmail: async () => ({ ok: true, messageId: 'abc' })
    }, async () => withPatched(db, {
        getConnection: async () => mockConnection,
        execute: async (sql, params = []) => {
            updates.push({ sql: String(sql), params });
            return [[]];
        }
    }, async () => {
        const retryService = requireFresh('../services/communications/communicationRetryService');
        const result = await retryService.processQueuedCommunicationRetries({ limit: 5 });
        assert.equal(result.processed, 1);
        assert.equal(result.sent, 1);
        assert.equal(result.failed, 0);
    }));

    assert.ok(updates.some((entry) => entry.sql.includes("SET status = 'sent'")));
});

test('oversized email attachments are logged without being queued for retry replay', async () => {
    const inserts = [];
    await withPatched(db, {
        execute: async (sql, params = []) => {
            if (String(sql).includes('INSERT INTO communication_delivery_logs')) {
                inserts.push({ sql: String(sql), params });
                return [{ insertId: 44 }];
            }
            return [[]];
        }
    }, async () => {
        const retryService = requireFresh('../services/communications/communicationRetryService');
        const result = await retryService.queueCommunicationFailure({
            channel: 'email',
            workflow: 'order',
            recipient: 'user@example.com',
            payload: {
                to: 'user@example.com',
                subject: 'Invoice',
                attachments: [{
                    filename: 'invoice.pdf',
                    content: Buffer.alloc((1024 * 1024) + 8, 1),
                    contentType: 'application/pdf'
                }]
            },
            error: new Error('smtp down')
        });
        assert.equal(result.queued, false);
        assert.equal(result.reason, 'retry_payload_too_large');
    });

    assert.equal(inserts.length, 1);
    assert.match(String(inserts[0].params[5]), /retry_payload_too_large/);
});

test('retry maintenance releases stale locks and prunes terminal rows', async () => {
    const calls = [];
    await withPatched(db, {
        execute: async (sql, params = []) => {
            calls.push({ sql: String(sql), params });
            if (String(sql).includes("SET status = 'queued'")) return [{ affectedRows: 2 }];
            if (String(sql).includes("DELETE FROM communication_delivery_logs")) return [{ affectedRows: 3 }];
            return [[]];
        }
    }, async () => {
        const retryService = requireFresh('../services/communications/communicationRetryService');
        const released = await retryService.releaseStaleRetryLocks();
        const pruned = await retryService.pruneCommunicationDeliveryLogs();
        assert.equal(released, 2);
        assert.equal(pruned.deletedSent, 3);
        assert.equal(pruned.deletedFailed, 3);
    });

    assert.ok(calls.some((entry) => entry.sql.includes("SET status = 'queued'")));
    assert.equal(calls.filter((entry) => entry.sql.includes('DELETE FROM communication_delivery_logs')).length, 2);
});
