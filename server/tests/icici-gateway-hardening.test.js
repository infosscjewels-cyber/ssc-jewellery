const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.SKIP_DB_INIT = 'true';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

test('ICICI status normalization treats STATUS API responseCode as transport success and txnStatus as final outcome', () => {
    const { normalizeIciciFinalStatus } = require('../services/iciciService');

    assert.equal(
        normalizeIciciFinalStatus({
            responseCode: 'R1000',
            txnStatus: 'SUC',
            txnResponseCode: '000'
        }),
        'paid'
    );

    assert.equal(
        normalizeIciciFinalStatus({
            responseCode: 'R1000',
            txnStatus: 'REQ',
            txnResponseCode: ''
        }),
        'pending'
    );

    assert.equal(
        normalizeIciciFinalStatus({
            responseCode: 'R1000',
            txnStatus: 'REJ',
            txnResponseCode: '101'
        }),
        'failed'
    );
});

test('ICICI return/advice normalization still supports direct success response codes', () => {
    const { normalizeIciciFinalStatus } = require('../services/iciciService');

    assert.equal(normalizeIciciFinalStatus({ responseCode: '000' }), 'paid');
    assert.equal(normalizeIciciFinalStatus({ responseCode: '0000' }), 'paid');
    assert.equal(normalizeIciciFinalStatus({ responseCode: 'R1000' }), 'pending');
});

test('ICICI paid callbacks/statuses must still match the original attempt amount', () => {
    const { doesIciciAmountMatchAttempt } = require('../services/iciciService');

    const attempt = { amount_subunits: 10000 };

    assert.equal(
        doesIciciAmountMatchAttempt({
            attempt,
            payload: { amount: '100.00' }
        }),
        true
    );

    assert.equal(
        doesIciciAmountMatchAttempt({
            attempt,
            payload: { txnAmount: '100.00' }
        }),
        true
    );

    assert.equal(
        doesIciciAmountMatchAttempt({
            attempt,
            payload: { amount: '1.00' }
        }),
        false
    );

    assert.equal(
        doesIciciAmountMatchAttempt({
            attempt,
            payload: { txnAmount: '1.00' }
        }),
        false
    );
});

test('ICICI request hashing matches the stepwise doc plain-text construction and round-trips correctly', () => {
    const { generateIciciSecureHash, verifyIciciSecureHash } = require('../services/iciciHashService');

    const payload = {
        addlParam1: '000',
        addlParam2: '111',
        aggregatorID: 'A100000000006873',
        amount: '2.00',
        currencyCode: '356',
        customerEmailID: 'dummy@gmail.com',
        customerMobileNo: '9090909090',
        customerName: 'Narayan',
        merchantId: '100000000006873',
        merchantTxnNo: '757585887575',
        payType: '0',
        returnURL: 'https://pgpayuat.icicibank.com/tsp/pg/api/merchant',
        transactionType: 'SALE',
        txnDate: '20251028235959'
    };

    const result = generateIciciSecureHash({
        payload,
        secretKey: 'db06cca0-838b-4e01-8b20-6ac446ffb6bd'
    });

    assert.equal(
        result.plainHashText,
        '000111A1000000000068732.00356dummy@gmail.com9090909090Narayan1000000000068737575858875750https://pgpayuat.icicibank.com/tsp/pg/api/merchantSALE20251028235959'
    );
    assert.match(result.secureHash, /^[a-f0-9]{64}$/);
    assert.equal(
        verifyIciciSecureHash({
            payload: {
                ...payload,
                secureHash: result.secureHash
            },
            secretKey: 'db06cca0-838b-4e01-8b20-6ac446ffb6bd'
        }),
        true
    );
});

test('ICICI hash sorting stays deterministic for mixed-case callback keys', () => {
    const { buildIciciPlainHashText } = require('../services/iciciHashService');

    const payload = {
        aggregatorID: 'A100000000007164',
        TransmissionDateTime: '20260516170204',
        txnType: 'SALE',
        oth_charge: '35.17',
        authCode: 'bsf3fa6b8ec510',
        bankCode: '9734',
        customerMobileNo: '6380435136',
        customerEmailID: 'natarajan.raju90@gmail.com',
        addlParam1: '49',
        addlParam2: 'mn65jae6w0ij',
        paymentSubInstType: 'CC Avenues Test Bank',
        paymentMode: 'NB',
        amount: '1084.06',
        responseCode: '0000',
        respDescription: 'Transaction successful',
        merchantId: '100000000007164',
        merchantTxnNo: 'ICW0IJ4989NJ7L',
        txnID: '7700227231876',
        paymentDateTime: '20260516170224',
        paymentID: '315014117923',
        secureHash: 'ignored'
    };

    assert.equal(
        buildIciciPlainHashText(payload, { excludeKeys: ['secureHash'] }),
        '2026051617020449mn65jae6w0ijA1000000000071641084.06bsf3fa6b8ec5109734natarajan.raju90@gmail.com6380435136100000000007164ICW0IJ4989NJ7L35.1720260516170224315014117923NBCC Avenues Test BankTransaction successful00007700227231876SALE'
    );
});

test('payment reconciliation dispatcher re-exports Razorpay settlement sync pass', () => {
    const dispatcher = require('../services/paymentReconciliationDispatcher');
    assert.equal(typeof dispatcher.runSettlementSyncPass, 'function');
});

test('ICICI settlement status request payload uses SETTLSTATUS and settlement snapshot normalization is stable', () => {
    process.env.ICICI_PG_MERCHANT_ID = '100000000007164';
    process.env.ICICI_PG_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_PG_SECRET_KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';
    process.env.ICICI_PG_RETURN_URL = 'https://example.com/api/orders/icici/return';
    process.env.ICICI_PG_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
    process.env.ICICI_PG_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';

    const {
        buildSettlementStatusRequestPayload,
        normalizeIciciSettlementSnapshot
    } = require('../services/iciciSettlementService');

    const payload = buildSettlementStatusRequestPayload({
        merchantTxnNo: '343223'
    });

    assert.equal(payload.merchantID, '100000000007164');
    assert.equal(payload.aggregatorID, 'A100000000007164');
    assert.equal(payload.originalTxnNo, '343223');
    assert.equal(payload.transactionType, 'SETTLSTATUS');
    assert.match(String(payload.secureHash || ''), /^[a-f0-9]{64}$/);

    const snapshot = normalizeIciciSettlementSnapshot({
        responseCode: '000',
        merchantTxnNo: '343223',
        settlementStatus: 'STD',
        txnStatus: 'SUC',
        txnResponseCode: '0000',
        txnID: 'T20394302393',
        settlementID: '28288_20191010-001',
        settlementDate: '20160803',
        settledAmount: '100.00',
        secureHash: 'dummy'
    });

    assert.equal(snapshot.status, 'settled');
    assert.equal(snapshot.settlement_status, 'STD');
    assert.equal(snapshot.settlement_id, '28288_20191010-001');
    assert.equal(snapshot.txn_id, 'T20394302393');
    assert.equal(snapshot.settled_amount, 100);
});

test('ICICI pending settlement snapshot stays awaited until a real settlement signal arrives', () => {
    const { buildIciciPendingSettlementSnapshot } = require('../services/iciciSettlementService');

    const snapshot = buildIciciPendingSettlementSnapshot({
        paymentReference: 'PAY001',
        paymentMode: 'upi',
        source: 'icici_return'
    });

    assert.equal(snapshot.status, 'pending');
    assert.equal(snapshot.settlement_status, 'NSD');
    assert.equal(snapshot.payment_reference, 'PAY001');
    assert.equal(snapshot.payment_mode, 'upi');
    assert.equal(snapshot.source, 'icici_return');
    assert.equal(snapshot.id, null);
    assert.equal(snapshot.last_refresh_status, null);
});

test('ICICI refund payload uses command request fields from the gateway spec', () => {
    process.env.ICICI_PG_MERCHANT_ID = '100000000007164';
    process.env.ICICI_PG_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_PG_SECRET_KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';
    process.env.ICICI_PG_RETURN_URL = 'https://example.com/api/orders/icici/return';
    process.env.ICICI_PG_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
    process.env.ICICI_PG_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';

    const {
        buildIciciRefundMerchantTxnNo,
        buildIciciRefundRequestPayload,
        normalizeIciciRefundResponse
    } = require('../services/iciciRefundService');

    const merchantTxnNo = buildIciciRefundMerchantTxnNo({ orderId: 48 });
    assert.ok(merchantTxnNo.startsWith('RF'));
    assert.ok(merchantTxnNo.length <= 20);

    const payload = buildIciciRefundRequestPayload({
        merchantTxnNo,
        originalTxnNo: '7700206371536',
        amount: 150,
        addlParam1: '080426004'
    });

    assert.equal(payload.merchantID, '100000000007164');
    assert.equal(payload.aggregatorID, 'A100000000007164');
    assert.equal(payload.transactionType, 'REFUND');
    assert.equal(payload.merchantTxnNo, merchantTxnNo);
    assert.equal(payload.originalTxnNo, '7700206371536');
    assert.equal(payload.amount, '150.00');
    assert.equal(payload.addlParam1, '080426004');
    assert.match(String(payload.secureHash || ''), /^[a-f0-9]{64}$/);

    const normalized = normalizeIciciRefundResponse({
        responseCode: 'R1000',
        respDescription: 'Request processed successfully',
        merchantTxnNo,
        txnID: '7700206371606',
        txnAuthID: '54472510906'
    });

    assert.equal(normalized.ok, true);
    assert.equal(normalized.id, '7700206371606');
    assert.equal(normalized.merchantTxnNo, merchantTxnNo);
    assert.equal(normalized.txnID, '7700206371606');
    assert.equal(normalized.txnAuthID, '54472510906');
});

test('ICICI STATUS lookup does not hard-fail on response hash mismatch and marks the payload for diagnostics', async () => {
    process.env.ICICI_PG_MERCHANT_ID = '100000000007164';
    process.env.ICICI_PG_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_PG_SECRET_KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';
    process.env.ICICI_PG_RETURN_URL = 'https://example.com/api/orders/icici/return';
    process.env.ICICI_PG_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
    process.env.ICICI_PG_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';

    const { fetchIciciTransactionStatus } = require('../services/iciciStatusService');

    const originalFetch = global.fetch;
    const originalWarn = console.warn;
    const warnings = [];

    console.warn = (...args) => warnings.push(args.join(' '));
    global.fetch = async () => ({
        ok: true,
        headers: {
            get: () => 'application/json'
        },
        text: async () => JSON.stringify({
            responseCode: '000',
            txnStatus: 'SUC',
            txnResponseCode: '0000',
            merchantId: 'T_S00067',
            merchantTxnNo: '7700206371536',
            txnID: '7700206371536',
            secureHash: 'definitely-invalid'
        })
    });

    try {
        const payload = await fetchIciciTransactionStatus({
            merchantTxnNo: '7700206371536',
            originalTxnNo: '7700206371536'
        });

        assert.equal(payload.responseCode, '000');
        assert.equal(payload._hashValidationFailed, true);
        assert.ok(warnings.some((entry) => entry.includes('[icici_status_hash_mismatch]')));
    } finally {
        global.fetch = originalFetch;
        console.warn = originalWarn;
    }
});

test('ICICI settlement summary and details request payloads follow documented transaction types and fields', () => {
    process.env.ICICI_PG_MERCHANT_ID = '100000000007164';
    process.env.ICICI_PG_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_PG_SECRET_KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';
    process.env.ICICI_PG_RETURN_URL = 'https://example.com/api/orders/icici/return';
    process.env.ICICI_PG_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
    process.env.ICICI_PG_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';
    process.env.ICICI_PG_SETTLEMENT_SUMMARY_TRANSACTION_TYPE = 'SETTLEMENTSUMMARY';

    const {
        buildSettlementSummaryRequestPayload,
        buildSettlementDetailsRequestPayload,
        normalizeIciciSettlementSnapshot
    } = require('../services/iciciSettlementService');

    const summaryPayload = buildSettlementSummaryRequestPayload({
        settlementDate: '20260516'
    });
    assert.equal(summaryPayload.merchantID, '100000000007164');
    assert.equal(summaryPayload.aggregatorID, 'A100000000007164');
    assert.equal(summaryPayload.settlementDate, '20260516');
    assert.equal(summaryPayload.transactionType, 'SETTLEMENTSUMMARY');
    assert.match(String(summaryPayload.secureHash || ''), /^[a-f0-9]{64}$/);

    const detailsPayload = buildSettlementDetailsRequestPayload({
        settlementId: 'T03342000280190',
        lastTxnId: '7700201499508',
        providerId: 'SP001'
    });
    assert.equal(detailsPayload.merchantID, '100000000007164');
    assert.equal(detailsPayload.aggregatorID, 'A100000000007164');
    assert.equal(detailsPayload.settlementID, 'T03342000280190');
    assert.equal(detailsPayload.lastTxnID, '7700201499508');
    assert.equal(detailsPayload.providerID, 'SP001');
    assert.match(String(detailsPayload.secureHash || ''), /^[a-f0-9]{64}$/);

    const detailSnapshot = normalizeIciciSettlementSnapshot({
        settlementID: 'T03342000280190',
        settlementStatus: 'SETTLED',
        txnStatus: 'SUC',
        txnResponseCode: '0000',
        paymentID: '10520592231',
        txnID: '7700201499484',
        txnAmount: '100.00',
        settledAmount: '100.00',
        txnCharges: '0.00',
        serviceTax: '0.00',
        utr_no: 'T03342000280190',
        settlementDate: '28-07-2025',
        transmissionDateTime: '2025-07-28 12:56:06'
    });
    assert.equal(detailSnapshot.status, 'settled');
    assert.equal(detailSnapshot.entity, 'settlement_recon');
    assert.equal(detailSnapshot.payment_reference, '10520592231');
    assert.equal(detailSnapshot.amount, 100);
    assert.equal(detailSnapshot.net_amount, 100);
    assert.equal(detailSnapshot.utr, 'T03342000280190');
    assert.match(String(detailSnapshot.created_at || ''), /^2025-07-28T/);
});

test('ICICI settlement sync pass covers status candidates and summary/details enrichment', async () => {
    process.env.ICICI_PG_MERCHANT_ID = '100000000007164';
    process.env.ICICI_PG_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_PG_SECRET_KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';
    process.env.ICICI_PG_RETURN_URL = 'https://example.com/api/orders/icici/return';
    process.env.ICICI_PG_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
    process.env.ICICI_PG_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';
    process.env.ICICI_PG_SETTLEMENT_DETAILS_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/settlementDetails';

    const settlementService = require('../services/iciciSettlementService');
    const Order = require('../models/Order');

    const originalFetch = global.fetch;
    const originalListCandidates = Order.listIciciSettlementSyncCandidates;
    const originalGetByGatewayOrderRef = Order.getByGatewayOrderRef;
    const originalUpdateSettlementByOrderId = Order.updateSettlementByOrderId;
    const originalUpdateGatewayPaymentByOrderId = Order.updateGatewayPaymentByOrderId;

    const settlementUpdates = [];
    const gatewayUpdates = [];
    const orderByRef = {
        ICICI123: {
            id: 41,
            payment_gateway: 'icici',
            gateway_order_ref: 'ICICI123',
            settlement_snapshot: null
        }
    };

    Order.listIciciSettlementSyncCandidates = async () => ([{
        id: 41,
        payment_gateway: 'icici',
        gateway_order_ref: 'ICICI123',
        settlement_snapshot: null
    }]);
    Order.getByGatewayOrderRef = async ({ gatewayOrderRef }) => orderByRef[gatewayOrderRef] || null;
    Order.updateSettlementByOrderId = async (payload) => {
        settlementUpdates.push(payload);
        const existing = orderByRef.ICICI123;
        if (existing && Number(payload.orderId) === existing.id) {
            existing.settlement_snapshot = payload.settlementSnapshot;
        }
        return 1;
    };
    Order.updateGatewayPaymentByOrderId = async (payload) => {
        gatewayUpdates.push(payload);
        return 1;
    };

    global.fetch = async (url, options = {}) => {
        const target = String(url || '');
        const body = String(options?.body || '');
        if (target.endsWith('/command') && body.includes('transactionType=SETTLSTATUS')) {
            return {
                ok: true,
                headers: new Map([['content-type', 'application/json']]),
                text: async () => JSON.stringify({
                    responseCode: '000',
                    settlementStatus: 'NSD',
                    txnStatus: 'SUC',
                    txnResponseCode: '0000',
                    merchantTxnNo: 'ICICI123'
                })
            };
        }
        if (target.endsWith('/settlementDetails')) {
            return {
                ok: true,
                headers: new Map([['content-type', 'application/json']]),
                text: async () => JSON.stringify({
                    error_code: '000',
                    Payouts: [{
                        merchantTxnNo: 'ICICI123',
                        settlementStatus: 'SETTLED',
                        txnStatus: 'SUC',
                        txnResponseCode: '0000',
                        settlementID: 'SETT001',
                        paymentID: 'PAY001',
                        txnID: 'TXN001',
                        settledAmount: '100.00',
                        txnAmount: '100.00',
                        txnCharges: '0.00',
                        serviceTax: '0.00',
                        utr_no: 'UTR001',
                        settlementDate: '28-07-2025',
                        transmissionDateTime: '2025-07-28 12:56:06'
                    }],
                    lasttxnID: 'TXN001'
                })
            };
        }
        if (target.endsWith('/command') && body.includes('transactionType=SETTLEMENTSUMMARY')) {
            return {
                ok: true,
                headers: new Map([['content-type', 'application/json']]),
                text: async () => JSON.stringify({
                    error_code: '000',
                    settlementDate: '20260516',
                    Payouts: [{
                        settlementID: 'SETT001',
                        utr_no: 'UTR001',
                        account_no: '629405033171',
                        ifsc_code: 'ICIC0000011',
                        pay_amount: '100.00'
                    }]
                })
            };
        }
        return {
            ok: true,
            headers: new Map([['content-type', 'application/json']]),
            text: async () => JSON.stringify({})
        };
    };

    try {
        const summary = await settlementService.runIciciSettlementSyncPass({
            limit: 10,
            minAgeHours: 1,
            lookbackDays: 1
        });

        assert.equal(summary.scanned, 1);
        assert.ok(summary.summaryDatesScanned >= 1);
        assert.ok(summary.settlementsScanned >= 1);
        assert.ok(summary.settlementEntriesScanned >= 1);
        assert.ok(settlementUpdates.length >= 2);
        assert.ok(gatewayUpdates.length >= 1);
        assert.equal(gatewayUpdates.at(-1)?.gatewayPaymentRef, 'PAY001');
        assert.equal(settlementUpdates.at(-1)?.settlementId, 'SETT001');
    } finally {
        global.fetch = originalFetch;
        Order.listIciciSettlementSyncCandidates = originalListCandidates;
        Order.getByGatewayOrderRef = originalGetByGatewayOrderRef;
        Order.updateSettlementByOrderId = originalUpdateSettlementByOrderId;
        Order.updateGatewayPaymentByOrderId = originalUpdateGatewayPaymentByOrderId;
    }
});

test('ICICI settlement sync keeps orders awaited and records warning metadata when settlement status lookup fails', async () => {
    process.env.ICICI_PG_MERCHANT_ID = '100000000007164';
    process.env.ICICI_PG_AGGREGATOR_ID = 'A100000000007164';
    process.env.ICICI_PG_SECRET_KEY = 'db06cca0-838b-4e01-8b20-6ac446ffb6bd';
    process.env.ICICI_PG_RETURN_URL = 'https://example.com/api/orders/icici/return';
    process.env.ICICI_PG_SALE_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/v2/initiateSale';
    process.env.ICICI_PG_COMMAND_URL = 'https://pgpayuat.icicibank.com/tsp/pg/api/command';

    const settlementService = require('../services/iciciSettlementService');
    const Order = require('../models/Order');

    const originalFetch = global.fetch;
    const originalListCandidates = Order.listIciciSettlementSyncCandidates;
    const originalUpdateSettlementByOrderId = Order.updateSettlementByOrderId;

    const settlementUpdates = [];

    Order.listIciciSettlementSyncCandidates = async () => ([{
        id: 52,
        payment_gateway: 'icici',
        gateway_order_ref: 'ICICI_FAIL_1',
        gateway_payment_ref: 'PAY_FAIL_1',
        settlement_snapshot: {
            status: 'pending',
            settlement_status: 'NSD',
            source: 'icici_payment_confirmation'
        }
    }]);
    Order.updateSettlementByOrderId = async (payload) => {
        settlementUpdates.push(payload);
        return 1;
    };

    global.fetch = async () => {
        throw new Error('ICICI settlement status endpoint unavailable');
    };

    try {
        const summary = await settlementService.runIciciSettlementSyncPass({
            limit: 10,
            minAgeHours: 1,
            lookbackDays: 1
        });

        assert.equal(summary.scanned, 1);
        assert.ok(summary.failed >= 1);
        assert.equal(settlementUpdates.length, 1);
        assert.equal(settlementUpdates[0]?.settlementId, null);
        assert.equal(settlementUpdates[0]?.settlementSnapshot?.status, 'pending');
        assert.equal(settlementUpdates[0]?.settlementSnapshot?.settlement_status, 'NSD');
        assert.equal(settlementUpdates[0]?.settlementSnapshot?.last_refresh_status, 'failed');
        assert.match(String(settlementUpdates[0]?.settlementSnapshot?.last_refresh_error || ''), /endpoint unavailable/i);
    } finally {
        global.fetch = originalFetch;
        Order.listIciciSettlementSyncCandidates = originalListCandidates;
        Order.updateSettlementByOrderId = originalUpdateSettlementByOrderId;
    }
});
