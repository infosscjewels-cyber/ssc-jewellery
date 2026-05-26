const { generateIciciSecureHash, verifyIciciSecureHash } = require('./iciciHashService');
const { assertIciciConfigured, parseGatewayPayload } = require('./iciciService');

const ICICI_REFUND_SUCCESS_CODES = new Set(['000', 'R1000']);

const toTrimmed = (value) => String(value || '').trim();

const buildIciciRefundMerchantTxnNo = ({ orderId = null } = {}) => {
    const encodedTime = Date.now().toString(36).toUpperCase();
    const encodedOrderId = Number(orderId || 0).toString(36).toUpperCase();
    return `RF${encodedTime}${encodedOrderId}`.slice(0, 20);
};

const buildIciciRefundRequestPayload = ({
    merchantTxnNo,
    originalTxnNo,
    amount,
    addlParam1 = '',
    addlParam2 = ''
} = {}) => {
    const config = assertIciciConfigured();
    const payload = {
        merchantID: config.merchantId,
        merchantTxnNo: toTrimmed(merchantTxnNo),
        originalTxnNo: toTrimmed(originalTxnNo),
        amount: Number(amount || 0).toFixed(2),
        transactionType: 'REFUND'
    };
    if (config.aggregatorId) payload.aggregatorID = config.aggregatorId;
    if (toTrimmed(addlParam1)) payload.addlParam1 = toTrimmed(addlParam1);
    if (toTrimmed(addlParam2)) payload.addlParam2 = toTrimmed(addlParam2);
    const { secureHash } = generateIciciSecureHash({
        payload,
        secretKey: config.secretKey
    });
    return {
        ...payload,
        secureHash
    };
};

const buildFormBody = (payload = {}) => {
    const params = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
        if (value === undefined || value === null || String(value).trim() === '') return;
        params.set(key, String(value));
    });
    return params.toString();
};

const normalizeIciciRefundResponse = (payload = {}) => {
    const responseCode = toTrimmed(payload?.responseCode).toUpperCase();
    const isSuccess = ICICI_REFUND_SUCCESS_CODES.has(responseCode);
    return {
        ok: isSuccess,
        id: toTrimmed(payload?.txnID || payload?.txnAuthID || payload?.merchantTxnNo) || null,
        responseCode: toTrimmed(payload?.responseCode) || null,
        respDescription: toTrimmed(payload?.respDescription || payload?.message) || null,
        merchantTxnNo: toTrimmed(payload?.merchantTxnNo) || null,
        txnID: toTrimmed(payload?.txnID) || null,
        txnAuthID: toTrimmed(payload?.txnAuthID) || null,
        paymentDateTime: toTrimmed(payload?.paymentDateTime) || null,
        raw: payload
    };
};

const issueIciciRefund = async ({
    merchantTxnNo,
    originalTxnNo,
    amount,
    addlParam1 = '',
    addlParam2 = ''
} = {}) => {
    const config = assertIciciConfigured();
    const requestPayload = buildIciciRefundRequestPayload({
        merchantTxnNo,
        originalTxnNo,
        amount,
        addlParam1,
        addlParam2
    });
    const response = await fetch(config.commandUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, text/plain, */*'
        },
        body: buildFormBody(requestPayload)
    });
    const payload = await parseGatewayPayload(response);
    if (!response.ok) {
        throw new Error(payload?.respDescription || payload?.message || 'ICICI refund request failed');
    }
    const responseHash = toTrimmed(payload?.secureHash);
    if (responseHash && !verifyIciciSecureHash({
        payload,
        secureHash: responseHash,
        secretKey: config.secretKey
    })) {
        throw new Error('ICICI refund response hash validation failed');
    }
    const normalized = normalizeIciciRefundResponse(payload);
    if (!normalized.ok) {
        throw new Error(normalized.respDescription || 'ICICI refund request failed');
    }
    return normalized;
};

module.exports = {
    buildIciciRefundMerchantTxnNo,
    buildIciciRefundRequestPayload,
    normalizeIciciRefundResponse,
    issueIciciRefund
};
