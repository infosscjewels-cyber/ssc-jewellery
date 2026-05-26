const { generateIciciSecureHash, verifyIciciSecureHash } = require('./iciciHashService');
const { assertIciciConfigured, normalizeIciciFinalStatus, parseGatewayPayload, doesIciciAmountMatchAttempt } = require('./iciciService');
const { PaymentAttempt, PAYMENT_STATUS } = require('../models/PaymentAttempt');
const Order = require('../models/Order');
const { markRecoveredByOrder } = require('./abandonedCartRecoveryService');
const { maybeSendRecoveryCommunications } = require('./paymentReconciliationService');
const { buildIciciPendingSettlementSnapshot } = require('./iciciSettlementService');

const parseJsonSafe = (value) => {
    if (!value) return null;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const toTrimmed = (value) => String(value || '').trim();

const resolveIciciTxnId = (...sources) => {
    for (const source of sources) {
        if (!source) continue;
        const parsed = parseJsonSafe(source);
        const txnId = toTrimmed(parsed?.txnID || parsed?.txnId || parsed?.txn_id);
        if (txnId) return txnId;
    }
    return '';
};

const buildStatusRequestPayload = ({
    merchantTxnNo,
    originalTxnNo = null
} = {}) => {
    const config = assertIciciConfigured();
    const payload = {
        merchantId: config.merchantId,
        merchantTxnNo: String(merchantTxnNo || '').trim(),
        originalTxnNo: String(originalTxnNo || merchantTxnNo || '').trim(),
        transactionType: 'STATUS'
    };
    if (config.aggregatorId) payload.aggregatorID = config.aggregatorId;
    const { secureHash } = generateIciciSecureHash({
        payload,
        secretKey: config.secretKey
    });
    return {
        ...payload,
        secureHash
    };
};

const fetchIciciTransactionStatus = async ({
    merchantTxnNo,
    originalTxnNo = null
} = {}) => {
    const config = assertIciciConfigured();
    const requestPayload = buildStatusRequestPayload({
        merchantTxnNo,
        originalTxnNo
    });
    const body = new URLSearchParams();
    Object.entries(requestPayload).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            body.set(key, String(value));
        }
    });
    const response = await fetch(config.commandUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, text/plain, */*'
        },
        body: body.toString()
    });
    const payload = await parseGatewayPayload(response);
    if (!response.ok) {
        throw new Error(payload?.responseMessage || payload?.message || 'ICICI status lookup failed');
    }
    const responseHash = String(payload?.secureHash || '').trim();
    if (responseHash && !verifyIciciSecureHash({
        payload,
        secureHash: responseHash,
        secretKey: config.secretKey
    })) {
        console.warn('[icici_status_hash_mismatch]', JSON.stringify({
            merchantTxnNo: String(merchantTxnNo || '').trim() || null,
            originalTxnNo: String(originalTxnNo || merchantTxnNo || '').trim() || null,
            responseCode: String(payload?.responseCode || '').trim() || null,
            txnStatus: String(payload?.txnStatus || '').trim() || null,
            txnResponseCode: String(payload?.txnResponseCode || '').trim() || null,
            txnID: String(payload?.txnID || '').trim() || null,
            paymentID: String(payload?.paymentID || '').trim() || null
        }));
        return {
            ...payload,
            _hashValidationFailed: true
        };
    }
    return payload;
};

const mapIciciStateToAttemptStatus = (gatewayState = 'pending') => {
    const normalized = String(gatewayState || '').trim().toLowerCase();
    if (normalized === 'paid') return PAYMENT_STATUS.PAID;
    if (normalized === 'failed') return PAYMENT_STATUS.FAILED;
    return PAYMENT_STATUS.RECONCILIATION_PENDING;
};

const reconcileIciciAttemptById = async ({ attemptId, source = 'scheduler' } = {}) => {
    const attempt = await PaymentAttempt.getById(attemptId);
    if (!attempt?.id) return { ok: false, skipped: true, reason: 'not_found' };
    const merchantTxnNo = String(attempt.gateway_order_ref || '').trim();
    if (!merchantTxnNo) {
        await PaymentAttempt.markGatewayStatus({
            id: attempt.id,
            status: PAYMENT_STATUS.FAILED,
            paymentGateway: 'icici',
            errorMessage: 'ICICI merchant transaction reference is missing'
        });
        return { ok: false, failed: true, reason: 'missing_gateway_order_ref' };
    }
    const payload = await fetchIciciTransactionStatus({
        merchantTxnNo,
        originalTxnNo: resolveIciciTxnId(
            attempt?.gateway_status_payload_json,
            attempt?.gateway_payload_json
        ) || merchantTxnNo
    });
    let normalizedGatewayStatus = normalizeIciciFinalStatus(payload);
    const amountMatchesAttempt = doesIciciAmountMatchAttempt({
        payload,
        attempt
    });
    if (normalizedGatewayStatus === 'paid' && !amountMatchesAttempt) {
        normalizedGatewayStatus = 'failed';
    }
    const gatewayPaymentRef = toTrimmed(payload?.txnID || payload?.paymentID) || null;
    await PaymentAttempt.markGatewayStatus({
        id: attempt.id,
        status: mapIciciStateToAttemptStatus(normalizedGatewayStatus),
        paymentGateway: 'icici',
        gatewayOrderRef: merchantTxnNo,
        gatewayPaymentRef,
        gatewaySignature: payload?.secureHash || null,
        gatewayStatusPayload: payload,
        gatewayMeta: {
            source,
            txnStatus: payload?.txnStatus || null,
            txnResponseCode: payload?.txnResponseCode || null,
            responseCode: payload?.responseCode || null,
            amountMatchesAttempt
        },
        errorMessage: normalizedGatewayStatus === 'failed'
            ? (!amountMatchesAttempt
                ? 'ICICI payment amount mismatch'
                : (payload?.message || payload?.responseMessage || payload?.txnResponseMessage || 'ICICI payment failed'))
            : null
    });

    const refreshedAttempt = await PaymentAttempt.getById(attempt.id);
    if (normalizedGatewayStatus !== 'paid') {
        return {
            ok: true,
            pending: normalizedGatewayStatus === 'pending',
            failed: normalizedGatewayStatus === 'failed',
            attempt: refreshedAttempt,
            payload
        };
    }

    if (refreshedAttempt?.local_order_id) {
        const order = await Order.getById(refreshedAttempt.local_order_id);
        return { ok: true, reconciled: true, order, attempt: refreshedAttempt, payload };
    }

    const existingOrder = gatewayPaymentRef
        ? await Order.getByGatewayPaymentRef({ paymentGateway: 'icici', gatewayPaymentRef })
        : await Order.getByGatewayOrderRef({ paymentGateway: 'icici', gatewayOrderRef: merchantTxnNo });
    if (existingOrder?.id) {
        await PaymentAttempt.linkToExistingOrder({
            id: refreshedAttempt.id,
            localOrderId: existingOrder.id,
            status: PAYMENT_STATUS.PAID
        });
        return { ok: true, reconciled: true, order: existingOrder, attempt: await PaymentAttempt.getById(refreshedAttempt.id), payload };
    }

    const order = await Order.createManualOrderFromAttempt({
        attempt: refreshedAttempt,
        paymentGateway: 'icici',
        paymentReference: gatewayPaymentRef || merchantTxnNo,
        gatewayOrderRef: merchantTxnNo,
        gatewayPaymentRef,
        gatewaySignature: payload?.secureHash || null,
        gatewayPayload: payload,
        paymentStatus: PAYMENT_STATUS.PAID,
        settlementSnapshot: buildIciciPendingSettlementSnapshot({
            paymentReference: gatewayPaymentRef || merchantTxnNo,
            paymentMode: payload?.paymentMode || 'icici',
            gatewayPayload: payload,
            source
        }),
        sourceChannel: source === 'scheduler' ? 'checkout_reconciler' : 'checkout'
    });
    if (order?.id) {
        try {
            await markRecoveredByOrder({ order, reason: `order_paid_${source}` });
        } catch {}
        await maybeSendRecoveryCommunications({
            order,
            paymentId: gatewayPaymentRef || merchantTxnNo
        });
    }
    return {
        ok: Boolean(order?.id),
        reconciled: Boolean(order?.id),
        order: order || null,
        attempt: await PaymentAttempt.getById(refreshedAttempt.id),
        payload
    };
};

module.exports = {
    buildStatusRequestPayload,
    fetchIciciTransactionStatus,
    reconcileIciciAttemptById
};
