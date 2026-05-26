const Order = require('../models/Order');
const { generateIciciSecureHash, verifyIciciSecureHash } = require('./iciciHashService');
const { assertIciciConfigured, parseGatewayPayload } = require('./iciciService');

const ICICI_SETTLEMENT_SUCCESS_CODES = new Set(['000', '0000']);

const toTrimmed = (value = '') => String(value || '').trim();

const toNumberOrNull = (value) => {
    if (value === undefined || value === null || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const buildFormBody = (payload = {}) => {
    const body = new URLSearchParams();
    Object.entries(payload).forEach(([key, value]) => {
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            body.set(key, String(value));
        }
    });
    return body.toString();
};

const verifyFlatIciciHashIfPresent = ({ payload = {}, secretKey = '', errorMessage = 'ICICI response hash validation failed' } = {}) => {
    const responseHash = toTrimmed(payload?.secureHash);
    if (!responseHash) return;

    // Settlement summary/details responses contain nested payout arrays. The shared
    // request/response hash rules in the docs do not define canonical array serialization,
    // so we only enforce hash verification for flat payloads where the canonicalization is deterministic.
    const hasNestedValue = Object.entries(payload || {}).some(([key, value]) => {
        if (String(key || '').trim().toLowerCase() === 'securehash') return false;
        return value && typeof value === 'object';
    });
    if (hasNestedValue) return;

    if (!verifyIciciSecureHash({
        payload,
        secureHash: responseHash,
        secretKey
    })) {
        throw new Error(errorMessage);
    }
};

const parseSettlementTimestamp = (...values) => {
    for (const value of values) {
        const raw = toTrimmed(value);
        if (!raw) continue;
        if (/^\d{8}$/.test(raw)) {
            const year = raw.slice(0, 4);
            const month = raw.slice(4, 6);
            const day = raw.slice(6, 8);
            const parsed = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        if (/^\d{2}-\d{2}-\d{4}$/.test(raw)) {
            const [day, month, year] = raw.split('-');
            const parsed = new Date(`${year}-${month}-${day}T00:00:00+05:30`);
            if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
        }
        const parsed = new Date(raw);
        if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return null;
};

const normalizeIciciSettlementLifecycleStatus = (payload = {}) => {
    const settlementStatus = toTrimmed(payload?.settlementStatus).toUpperCase();
    const txnStatus = toTrimmed(payload?.txnStatus).toUpperCase();
    const txnResponseCode = toTrimmed(payload?.txnResponseCode).toUpperCase();
    const responseCode = toTrimmed(payload?.responseCode || payload?.error_code).toUpperCase();

    if (settlementStatus === 'STD' || settlementStatus === 'SETTLED') return 'settled';
    if (settlementStatus === 'NSD') return 'pending';
    if (txnStatus === 'SUC' && ICICI_SETTLEMENT_SUCCESS_CODES.has(txnResponseCode || '')) return 'settled';
    if (txnStatus === 'REQ') return 'pending';
    if (txnStatus === 'REJ' || txnStatus === 'ERR') return 'failed';
    if (responseCode && !ICICI_SETTLEMENT_SUCCESS_CODES.has(responseCode)) return 'failed';
    return 'pending';
};

const buildIciciPendingSettlementSnapshot = ({
    paymentReference = null,
    paymentMode = 'icici',
    currency = 'INR',
    gatewayPayload = null,
    source = 'icici_payment_confirmation',
    responseDescription = 'Awaiting settlement confirmation from ICICI'
} = {}) => ({
    id: null,
    entity: 'settlement_recon',
    status: 'pending',
    amount: null,
    fees: null,
    tax: null,
    net_amount: null,
    currency: toTrimmed(currency) || 'INR',
    method: toTrimmed(paymentMode).toLowerCase() || 'icici',
    payment_reference: toTrimmed(paymentReference) || null,
    utr: null,
    created_at: null,
    fetched_at: Math.floor(Date.now() / 1000),
    settlement_status: 'NSD',
    response_code: null,
    response_description: toTrimmed(responseDescription) || 'Awaiting settlement confirmation from ICICI',
    settlement_id: null,
    settlement_date: null,
    settled_amount: null,
    txn_amount: null,
    txn_charges: null,
    service_tax: null,
    txn_status: null,
    txn_response_code: null,
    txn_id: null,
    settlement_account: null,
    settlement_account_ifsc: null,
    payment_mode: toTrimmed(paymentMode) || 'icici',
    payment_sub_instrument_type: null,
    card_network: null,
    source,
    last_refresh_status: null,
    last_refresh_error: null,
    last_refresh_at: null,
    gateway_payload: gatewayPayload || null
});

const normalizeIciciSettlementSnapshot = (payload = {}, extras = {}) => {
    const amount = toNumberOrNull(payload?.settledAmount ?? payload?.pay_amount);
    const fees = toNumberOrNull(payload?.txnCharges);
    const tax = toNumberOrNull(payload?.serviceTax);
    const method = toTrimmed(payload?.paymentMode || extras.paymentMode).toLowerCase() || 'icici';
    const normalizedSettlementId = toTrimmed(payload?.settlementID || extras.settlementID) || null;
    const fetchedAt = Math.floor(Date.now() / 1000);
    return {
        id: normalizedSettlementId,
        entity: 'settlement_recon',
        status: normalizeIciciSettlementLifecycleStatus(payload),
        amount,
        fees,
        tax,
        net_amount: amount != null
            ? Number((amount - Number(fees || 0) - Number(tax || 0)).toFixed(2))
            : null,
        currency: toTrimmed(payload?.settlement_currency || payload?.settlementCurrency || extras.currency) || 'INR',
        method,
        payment_reference: toTrimmed(payload?.paymentID || payload?.txnID || extras.paymentReference) || null,
        utr: toTrimmed(payload?.utr_no || extras.utr_no) || null,
        created_at: parseSettlementTimestamp(
            payload?.transmissionDateTime,
            payload?.settlementDate,
            extras.settlementDate
        ),
        fetched_at: fetchedAt,
        settlement_status: toTrimmed(payload?.settlementStatus) || null,
        response_code: toTrimmed(payload?.responseCode || payload?.error_code) || null,
        response_description: toTrimmed(payload?.respDescription || payload?.txnRespDescription || payload?.message) || null,
        settlement_id: normalizedSettlementId,
        settlement_date: toTrimmed(payload?.settlementDate || extras.settlementDate) || null,
        settled_amount: amount,
        txn_amount: toNumberOrNull(payload?.txnAmount),
        txn_charges: fees,
        service_tax: tax,
        txn_status: toTrimmed(payload?.txnStatus) || null,
        txn_response_code: toTrimmed(payload?.txnResponseCode) || null,
        txn_id: toTrimmed(payload?.txnID) || null,
        settlement_account: toTrimmed(payload?.settlementAccount || payload?.settlementAcco || payload?.account_no) || null,
        settlement_account_ifsc: toTrimmed(payload?.settlementAccountIFSC || payload?.settlementAccountIFSC || payload?.settlementAccoIFSC || payload?.ifsc_code) || null,
        payment_mode: toTrimmed(payload?.paymentMode || extras.paymentMode) || null,
        payment_sub_instrument_type: toTrimmed(payload?.paymentSubInstType) || null,
        card_network: toTrimmed(payload?.cardNetwork) || null,
        source: 'icici_settlement_recon',
        last_refresh_status: 'ok',
        last_refresh_error: null,
        last_refresh_at: fetchedAt,
        gateway_payload: payload
    };
};

const annotateIciciSettlementRefreshFailure = ({
    currentSnapshot = null,
    paymentReference = null,
    paymentMode = 'icici',
    gatewayPayload = null,
    error = null
} = {}) => {
    const baseSnapshot = currentSnapshot && typeof currentSnapshot === 'object'
        ? { ...currentSnapshot }
        : buildIciciPendingSettlementSnapshot({
            paymentReference,
            paymentMode,
            gatewayPayload
        });
    const snapshotId = toTrimmed(baseSnapshot.id || baseSnapshot.settlement_id);
    const isManualPlaceholder = snapshotId.startsWith('manual_settled_attempt_')
        || toTrimmed(baseSnapshot.source).toLowerCase() === 'manual_attempt_conversion';
    return {
        ...baseSnapshot,
        id: isManualPlaceholder ? null : (snapshotId || null),
        status: 'pending',
        settlement_status: toTrimmed(baseSnapshot.settlement_status) || 'NSD',
        settlement_id: isManualPlaceholder ? null : (toTrimmed(baseSnapshot.settlement_id) || snapshotId || null),
        source: 'icici_settlement_recon',
        last_refresh_status: 'failed',
        last_refresh_error: toTrimmed(error?.message || error) || 'ICICI settlement refresh failed',
        last_refresh_at: Math.floor(Date.now() / 1000),
        gateway_payload: gatewayPayload || baseSnapshot.gateway_payload || null
    };
};

const buildSettlementStatusRequestPayload = ({ merchantTxnNo } = {}) => {
    const config = assertIciciConfigured();
    const payload = {
        merchantID: config.merchantId,
        originalTxnNo: toTrimmed(merchantTxnNo),
        transactionType: toTrimmed(process.env.ICICI_PG_SETTLEMENT_STATUS_TRANSACTION_TYPE || 'SETTLSTATUS') || 'SETTLSTATUS'
    };
    if (config.aggregatorId) payload.aggregatorID = config.aggregatorId;
    const { secureHash } = generateIciciSecureHash({ payload, secretKey: config.secretKey });
    return { ...payload, secureHash };
};

const buildSettlementSummaryRequestPayload = ({ settlementDate } = {}) => {
    const config = assertIciciConfigured();
    const payload = {
        merchantID: config.merchantId,
        settlementDate: toTrimmed(settlementDate),
        transactionType: toTrimmed(process.env.ICICI_PG_SETTLEMENT_SUMMARY_TRANSACTION_TYPE || 'SETTLEMENTSUMMARY') || 'SETTLEMENTSUMMARY'
    };
    if (config.aggregatorId) payload.aggregatorID = config.aggregatorId;
    const { secureHash } = generateIciciSecureHash({ payload, secretKey: config.secretKey });
    return { ...payload, secureHash };
};

const buildSettlementDetailsRequestPayload = ({
    settlementId,
    lastTxnId = '',
    providerId = ''
} = {}) => {
    const config = assertIciciConfigured();
    const payload = {
        merchantID: config.merchantId,
        settlementID: toTrimmed(settlementId),
        lastTxnID: toTrimmed(lastTxnId)
    };
    if (config.aggregatorId) payload.aggregatorID = config.aggregatorId;
    if (toTrimmed(providerId)) payload.providerID = toTrimmed(providerId);
    const { secureHash } = generateIciciSecureHash({ payload, secretKey: config.secretKey });
    return { ...payload, secureHash };
};

const fetchIciciSettlementStatus = async ({ merchantTxnNo } = {}) => {
    const config = assertIciciConfigured();
    const requestPayload = buildSettlementStatusRequestPayload({ merchantTxnNo });
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
        throw new Error(payload?.respDescription || payload?.message || 'ICICI settlement status lookup failed');
    }
    verifyFlatIciciHashIfPresent({
        payload,
        secretKey: config.secretKey,
        errorMessage: 'ICICI settlement status response hash validation failed'
    });
    return payload;
};

const fetchIciciSettlementSummary = async ({ settlementDate } = {}) => {
    const config = assertIciciConfigured();
    const requestPayload = buildSettlementSummaryRequestPayload({ settlementDate });
    const commandUrl = process.env.ICICI_PG_SETTLEMENT_SUMMARY_URL || config.commandUrl;
    const response = await fetch(commandUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, text/plain, */*'
        },
        body: buildFormBody(requestPayload)
    });
    const payload = await parseGatewayPayload(response);
    if (!response.ok) {
        throw new Error(payload?.message || payload?.respDescription || 'ICICI settlement summary lookup failed');
    }
    verifyFlatIciciHashIfPresent({
        payload,
        secretKey: config.secretKey,
        errorMessage: 'ICICI settlement summary response hash validation failed'
    });
    if (!ICICI_SETTLEMENT_SUCCESS_CODES.has(toTrimmed(payload?.error_code))) {
        throw new Error(payload?.message || payload?.respDescription || 'ICICI settlement summary request failed');
    }
    return payload;
};

const fetchIciciSettlementDetails = async ({
    settlementId,
    lastTxnId = '',
    providerId = ''
} = {}) => {
    const config = assertIciciConfigured();
    const requestPayload = buildSettlementDetailsRequestPayload({
        settlementId,
        lastTxnId,
        providerId
    });
    const detailsUrl = toTrimmed(process.env.ICICI_PG_SETTLEMENT_DETAILS_URL) || `${config.baseUrl.replace(/\/$/, '')}/settlementDetails`;
    const response = await fetch(detailsUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json, text/plain, */*'
        },
        body: buildFormBody(requestPayload)
    });
    const payload = await parseGatewayPayload(response);
    if (!response.ok) {
        throw new Error(payload?.message || payload?.respDescription || 'ICICI settlement details lookup failed');
    }
    verifyFlatIciciHashIfPresent({
        payload,
        secretKey: config.secretKey,
        errorMessage: 'ICICI settlement details response hash validation failed'
    });
    if (!ICICI_SETTLEMENT_SUCCESS_CODES.has(toTrimmed(payload?.error_code))) {
        throw new Error(payload?.message || payload?.respDescription || 'ICICI settlement details request failed');
    }
    return payload;
};

const listSettlementPayouts = (payload = {}) => (
    Array.isArray(payload?.Payouts)
        ? payload.Payouts.filter((entry) => entry && typeof entry === 'object')
        : []
);

const getRecentSettlementDates = ({ lookbackDays = 7 } = {}) => {
    const safeLookbackDays = Math.max(1, Math.min(31, Number(lookbackDays || 7)));
    const dates = [];
    for (let offset = 0; offset < safeLookbackDays; offset += 1) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'Asia/Kolkata',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }).formatToParts(date).reduce((acc, part) => {
            if (part.type !== 'literal') acc[part.type] = part.value;
            return acc;
        }, {});
        dates.push(`${parts.year}${parts.month}${parts.day}`);
    }
    return dates;
};

const mergeSettlementSnapshots = (currentSnapshot = null, nextSnapshot = null) => {
    if (!currentSnapshot) return nextSnapshot;
    if (!nextSnapshot) return currentSnapshot;
    return {
        ...currentSnapshot,
        ...nextSnapshot,
        gateway_payload: nextSnapshot.gateway_payload || currentSnapshot.gateway_payload || null
    };
};

const syncSettlementDetailsForPayout = async ({
    payout = {},
    summary = null
} = {}) => {
    const settlementId = toTrimmed(payout?.settlementID || summary?.settlementID);
    if (!settlementId) {
        return { updated: 0, failed: 0, skipped: 1, scanned: 0 };
    }

    let lastTxnId = '';
    let pages = 0;
    const stats = {
        updated: 0,
        failed: 0,
        skipped: 0,
        scanned: 0
    };

    while (pages < 20) {
        pages += 1;
        const detailsPayload = await fetchIciciSettlementDetails({
            settlementId,
            lastTxnId,
            providerId: summary?.providerID || ''
        });
        const entries = listSettlementPayouts(detailsPayload);
        if (!entries.length) break;

        for (const entry of entries) {
            stats.scanned += 1;
            const merchantTxnNo = toTrimmed(entry?.merchantTxnNo);
            if (!merchantTxnNo) {
                stats.skipped += 1;
                continue;
            }
            const order = await Order.getByGatewayOrderRef({
                paymentGateway: 'icici',
                gatewayOrderRef: merchantTxnNo
            });
            if (!order?.id) {
                stats.skipped += 1;
                continue;
            }

            const nextSnapshot = normalizeIciciSettlementSnapshot(entry, {
                settlementID: settlementId,
                settlementDate: entry?.settlementDate || payout?.settlementDate || summary?.settlementDate,
                paymentMode: entry?.paymentMode || payout?.paymentMode || summary?.paymentMode,
                utr_no: entry?.utr_no || payout?.utr_no || summary?.utr_no
            });
            const settlementSnapshot = mergeSettlementSnapshots(order?.settlement_snapshot || order?.settlementSnapshot || null, nextSnapshot);
            await Promise.all([
                Order.updateGatewayPaymentByOrderId({
                    orderId: order.id,
                    paymentGateway: 'icici',
                    gatewayOrderRef: merchantTxnNo,
                    gatewayPaymentRef: toTrimmed(entry?.paymentID || entry?.txnID) || null,
                    gatewayPayload: entry
                }),
                Order.updateSettlementByOrderId({
                    orderId: order.id,
                    settlementId: nextSnapshot.id || settlementId,
                    settlementSnapshot
                })
            ]);
            stats.updated += 1;
        }

        const nextLastTxnId = toTrimmed(detailsPayload?.lasttxnID || detailsPayload?.lastTxnID);
        if (!nextLastTxnId || nextLastTxnId === lastTxnId || entries.length < 100) break;
        lastTxnId = nextLastTxnId;
    }

    return stats;
};

const runIciciSettlementSyncPass = async ({
    limit = 100,
    minAgeHours = 1,
    lookbackDays = 7
} = {}) => {
    const candidateOrders = await Order.listIciciSettlementSyncCandidates({
        limit,
        minAgeHours
    });
    const summary = {
        scanned: candidateOrders.length,
        updated: 0,
        pending: 0,
        missingSettlementId: 0,
        failed: 0,
        summaryDatesScanned: 0,
        settlementsScanned: 0,
        settlementEntriesScanned: 0
    };

    for (const order of candidateOrders) {
        const merchantTxnNo = toTrimmed(order?.gateway_order_ref);
        if (!merchantTxnNo) {
            summary.failed += 1;
            continue;
        }
        try {
            const payload = await fetchIciciSettlementStatus({ merchantTxnNo });
            const snapshot = normalizeIciciSettlementSnapshot(payload);
            await Order.updateSettlementByOrderId({
                orderId: order.id,
                settlementId: snapshot.id || null,
                settlementSnapshot: mergeSettlementSnapshots(order?.settlement_snapshot || null, snapshot)
            });
            if (snapshot.status === 'settled') summary.updated += 1;
            else if (snapshot.status === 'pending') summary.pending += 1;
            else summary.failed += 1;
        } catch (error) {
            await Order.updateSettlementByOrderId({
                orderId: order.id,
                settlementId: null,
                settlementSnapshot: annotateIciciSettlementRefreshFailure({
                    currentSnapshot: order?.settlement_snapshot || order?.settlementSnapshot || null,
                    paymentReference: order?.gateway_payment_ref || null,
                    error
                })
            }).catch(() => {});
            summary.failed += 1;
        }
    }

    const settlementDates = getRecentSettlementDates({ lookbackDays });
    for (const settlementDate of settlementDates) {
        summary.summaryDatesScanned += 1;
        try {
            const settlementSummaryPayload = await fetchIciciSettlementSummary({ settlementDate });
            const payouts = listSettlementPayouts(settlementSummaryPayload);
            summary.settlementsScanned += payouts.length;
            for (const payout of payouts) {
                const detailStats = await syncSettlementDetailsForPayout({
                    payout,
                    summary: settlementSummaryPayload
                });
                summary.updated += Number(detailStats.updated || 0);
                summary.failed += Number(detailStats.failed || 0);
                summary.missingSettlementId += Number(detailStats.skipped || 0);
                summary.settlementEntriesScanned += Number(detailStats.scanned || 0);
            }
        } catch {
            summary.failed += 1;
        }
    }

    return summary;
};

module.exports = {
    buildIciciPendingSettlementSnapshot,
    buildSettlementStatusRequestPayload,
    buildSettlementSummaryRequestPayload,
    buildSettlementDetailsRequestPayload,
    fetchIciciSettlementStatus,
    fetchIciciSettlementSummary,
    fetchIciciSettlementDetails,
    annotateIciciSettlementRefreshFailure,
    normalizeIciciSettlementSnapshot,
    normalizeSettlementSyncStatus: normalizeIciciSettlementLifecycleStatus,
    runIciciSettlementSyncPass
};
