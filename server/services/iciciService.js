const { generateIciciSecureHash, verifyIciciSecureHash } = require('./iciciHashService');

const ICICI_SUCCESS_CODES = new Set(['000', '0000']);
const ICICI_PENDING_CODES = new Set(['R1000']);

const readEnv = (name, fallback = '') => String(process.env[name] || fallback || '').trim();

const getIciciConfig = () => {
    const baseUrl = readEnv('ICICI_PG_BASE_URL');
    const saleUrl = readEnv('ICICI_PG_SALE_URL') || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/v2/initiateSale` : '');
    const commandUrl = readEnv('ICICI_PG_COMMAND_URL') || (baseUrl ? `${baseUrl.replace(/\/$/, '')}/command` : '');
    return {
        baseUrl,
        saleUrl,
        commandUrl,
        merchantId: readEnv('ICICI_PG_MERCHANT_ID'),
        aggregatorId: readEnv('ICICI_PG_AGGREGATOR_ID'),
        secretKey: readEnv('ICICI_PG_SECRET_KEY'),
        returnUrl: readEnv('ICICI_PG_RETURN_URL'),
        webhookUrl: readEnv('ICICI_PG_WEBHOOK_URL')
    };
};

const assertIciciConfigured = () => {
    const config = getIciciConfig();
    const required = [
        ['ICICI_PG_SALE_URL', config.saleUrl],
        ['ICICI_PG_COMMAND_URL', config.commandUrl],
        ['ICICI_PG_MERCHANT_ID', config.merchantId],
        ['ICICI_PG_SECRET_KEY', config.secretKey],
        ['ICICI_PG_RETURN_URL', config.returnUrl]
    ].filter(([, value]) => !String(value || '').trim());
    if (required.length > 0) {
        throw new Error(`ICICI is not configured on server. Missing: ${required.map(([key]) => key).join(', ')}`);
    }
    return config;
};

const formatTxnDate = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return `${parts.year || ''}${parts.month || ''}${parts.day || ''}235959`;
};

const parseGatewayPayload = async (response) => {
    const contentType = String(response.headers.get('content-type') || '').toLowerCase();
    const raw = await response.text();
    if (!raw) return {};
    if (contentType.includes('application/json')) {
        return JSON.parse(raw);
    }
    try {
        return JSON.parse(raw);
    } catch {}
    const params = new URLSearchParams(raw);
    const parsed = {};
    for (const [key, value] of params.entries()) parsed[key] = value;
    return parsed;
};

const buildInitiateSalePayload = ({
    merchantTxnNo,
    amount,
    customerEmailID,
    customerMobileNo,
    customerName,
    addlParam1 = '',
    addlParam2 = '',
    returnURL = null
} = {}) => {
    const config = assertIciciConfigured();
    const payload = {
        merchantId: config.merchantId,
        merchantTxnNo: String(merchantTxnNo || '').trim(),
        amount: Number(amount || 0).toFixed(2),
        currencyCode: '356',
        payType: '0',
        customerEmailID: String(customerEmailID || '').trim().toLowerCase() || 'dummy@gmail.com',
        transactionType: 'SALE',
        txnDate: formatTxnDate(),
        returnURL: String(returnURL || config.returnUrl || '').trim()
    };
    if (config.aggregatorId) payload.aggregatorID = config.aggregatorId;
    if (String(customerMobileNo || '').trim()) payload.customerMobileNo = String(customerMobileNo || '').trim();
    if (String(customerName || '').trim()) payload.customerName = String(customerName || '').trim();
    if (String(addlParam1 || '').trim()) payload.addlParam1 = String(addlParam1 || '').trim();
    if (String(addlParam2 || '').trim()) payload.addlParam2 = String(addlParam2 || '').trim();
    const { secureHash } = generateIciciSecureHash({
        payload,
        secretKey: config.secretKey
    });
    return {
        ...payload,
        secureHash
    };
};

const initiateSale = async (requestPayload = {}) => {
    const config = assertIciciConfigured();
    const response = await fetch(config.saleUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json, text/plain, */*'
        },
        body: JSON.stringify(requestPayload)
    });
    const payload = await parseGatewayPayload(response);
    if (!response.ok) {
        throw new Error(payload?.responseMessage || payload?.message || 'ICICI initiateSale failed');
    }
    const responseHash = String(payload?.secureHash || '').trim();
    if (responseHash && !verifyIciciSecureHash({
        payload,
        secureHash: responseHash,
        secretKey: config.secretKey
    })) {
        throw new Error('ICICI initiateSale response hash validation failed');
    }
    return payload;
};

const buildRedirectUrl = (payload = {}) => {
    const redirectUri = String(payload?.redirectURI || '').trim();
    const tranCtx = String(payload?.tranCtx || '').trim();
    if (!redirectUri || !tranCtx) {
        throw new Error('ICICI redirect details are missing');
    }
    const url = new URL(redirectUri);
    url.searchParams.set('tranCtx', tranCtx);
    return url.toString();
};

const normalizeIciciFinalStatus = (payload = {}) => {
    const responseCode = String(payload?.responseCode || '').trim().toUpperCase();
    const txnStatus = String(payload?.txnStatus || '').trim().toUpperCase();
    const txnResponseCode = String(payload?.txnResponseCode || '').trim().toUpperCase();

    // STATUS responses use top-level responseCode for API-call success and txnStatus/txnResponseCode
    // for transaction outcome. Hosted return/advice payloads may omit txnStatus and rely on responseCode.
    if (txnStatus) {
        if (txnStatus === 'SUC' && ICICI_SUCCESS_CODES.has(txnResponseCode || '')) return 'paid';
        if (txnStatus === 'REJ') return 'failed';
        if (txnStatus === 'ERR') return 'failed';
        if (txnStatus === 'REQ') return 'pending';
    }

    if (ICICI_SUCCESS_CODES.has(responseCode)) return 'paid';
    if (ICICI_PENDING_CODES.has(responseCode)) return 'pending';
    return 'failed';
};

const getIciciReportedAmountSubunits = (payload = {}) => {
    const candidates = [
        payload?.amount,
        payload?.txnAmount
    ];
    for (const candidate of candidates) {
        if (candidate === undefined || candidate === null || candidate === '') continue;
        const parsed = Number(candidate);
        if (!Number.isFinite(parsed) || parsed < 0) continue;
        return Math.round(parsed * 100);
    }
    return null;
};

const doesIciciAmountMatchAttempt = ({ payload = {}, attempt = null } = {}) => {
    const expectedSubunits = Number(attempt?.amount_subunits || 0);
    if (!Number.isFinite(expectedSubunits) || expectedSubunits <= 0) return true;
    const reportedSubunits = getIciciReportedAmountSubunits(payload);
    if (!Number.isFinite(reportedSubunits) || reportedSubunits < 0) return true;
    return reportedSubunits === expectedSubunits;
};

module.exports = {
    ICICI_SUCCESS_CODES,
    buildInitiateSalePayload,
    buildRedirectUrl,
    doesIciciAmountMatchAttempt,
    formatTxnDate,
    getIciciReportedAmountSubunits,
    getIciciConfig,
    assertIciciConfigured,
    initiateSale,
    normalizeIciciFinalStatus,
    parseGatewayPayload
};
