const { createRazorpayClient } = require('./razorpayService');
const { PaymentAttempt, PAYMENT_STATUS } = require('../models/PaymentAttempt');
const Order = require('../models/Order');
const User = require('../models/User');
const { markRecoveredByOrder } = require('./abandonedCartRecoveryService');
const {
    sendOrderLifecycleCommunication,
    sendPaymentLifecycleCommunication
} = require('./communications/communicationService');

const buildError = (message, statusCode = 400, extra = {}) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    Object.assign(error, extra);
    return error;
};

const isGatewayTransientError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return [
        'timeout',
        'timed out',
        'socket hang up',
        'econnreset',
        'etimedout',
        'network',
        'gateway',
        'temporarily unavailable',
        '503',
        '502',
        '504'
    ].some((fragment) => message.includes(fragment));
};

const normalizeGatewayError = (error, fallbackMessage) => (
    String(error?.error?.description || error?.description || error?.message || fallbackMessage || 'Gateway request failed')
        .trim()
        .slice(0, 500)
);

const normalizeSettlementSnapshot = (settlement = null) => {
    if (!settlement) return null;
    const amount = Number(settlement.amount || 0);
    const fees = Number(settlement.fees || 0);
    const tax = Number(settlement.tax || 0);
    return {
        id: settlement.id || null,
        entity: settlement.entity || 'settlement',
        amount,
        status: settlement.status || null,
        fees,
        tax,
        net_amount: amount - fees - tax,
        utr: settlement.utr || null,
        created_at: settlement.created_at || null,
        fetched_at: Math.floor(Date.now() / 1000)
    };
};

const normalizeSettlementReconSnapshot = (entry = null) => {
    if (!entry) return null;
    const amount = Number(entry.amount || 0) / 100;
    const fees = Number(entry.fee || 0) / 100;
    const tax = Number(entry.tax || 0) / 100;
    const credit = Number(entry.credit || 0) / 100;
    const debit = Number(entry.debit || 0) / 100;
    return {
        id: entry.settlement_id || null,
        entity: 'settlement_recon',
        status: entry.settled ? 'settled' : 'pending',
        amount,
        fees,
        tax,
        net_amount: credit > 0 ? credit : Math.max(0, amount - fees - tax - debit),
        utr: entry.settlement_utr || null,
        created_at: entry.settled_at || entry.created_at || null,
        fetched_at: Math.floor(Date.now() / 1000),
        type: entry.type || null,
        entity_id: entry.entity_id || null,
        payment_id: entry.type === 'payment'
            ? (entry.entity_id || null)
            : (entry.payment_id || null),
        order_id: entry.order_id || null,
        method: entry.method || null,
        gross_credit: credit,
        gross_debit: debit
    };
};

const getIstDateParts = (date = new Date()) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Kolkata',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(date).reduce((acc, part) => {
        acc[part.type] = part.value;
        return acc;
    }, {});
    return {
        year: Number(parts.year || 0),
        month: Number(parts.month || 0),
        day: Number(parts.day || 0)
    };
};

const fetchSettlementReconItemsForDay = async (razorpay, {
    year,
    month,
    day,
    count = 1000,
    maxPages = 5
} = {}) => {
    const items = [];
    let skip = 0;
    for (let page = 0; page < maxPages; page += 1) {
        const response = await razorpay.settlements.reports({
            year,
            month,
            day,
            count,
            skip
        });
        const batch = Array.isArray(response?.items) ? response.items : [];
        items.push(...batch);
        if (!batch.length || batch.length < count || items.length >= Number(response?.count || 0)) {
            break;
        }
        skip += batch.length;
    }
    return items;
};

const isDuplicatePaymentClaimError = (error) => {
    const message = String(error?.message || '').toLowerCase();
    return message.includes('duplicate entry') && message.includes('uniq_payment_attempt_payment_id');
};
const DUPLICATE_PAYMENT_CLAIM_MESSAGE = 'Payment already linked to an existing checkout. Please retry with a new payment session.';

const attachAttemptToExistingPaidOrder = async ({ attempt = null, paymentId = '' } = {}) => {
    const resolvedPaymentId = String(paymentId || '').trim();
    if (!attempt?.id || !resolvedPaymentId) return null;

    let existingOrder = await Order.getByRazorpayPaymentId(resolvedPaymentId);
    if (!existingOrder) {
        const ownerAttempt = await PaymentAttempt.getByRazorpayPaymentId(resolvedPaymentId);
        if (ownerAttempt?.local_order_id) {
            existingOrder = await Order.getById(ownerAttempt.local_order_id);
        }
    }
    if (!existingOrder?.id) return null;

    if (String(attempt.local_order_id || '') !== String(existingOrder.id)) {
        await PaymentAttempt.linkToExistingOrder({
            id: attempt.id,
            localOrderId: existingOrder.id,
            status: PAYMENT_STATUS.PAID
        });
    }
    return existingOrder;
};

const ensureCapturedPaymentMatchesAttempt = async ({
    attempt,
    razorpayPaymentId = null,
    razorpaySignature = null,
    paymentDetails = null
} = {}) => {
    const resolvedPaymentId = String(razorpayPaymentId || paymentDetails?.id || '').trim();
    if (!attempt?.id) {
        throw buildError('Payment attempt not found', 404);
    }
    if (!resolvedPaymentId) {
        throw buildError('Razorpay payment id is required', 400);
    }

    let resolvedPaymentDetails = paymentDetails || null;
    if (!resolvedPaymentDetails) {
        try {
            const razorpay = await createRazorpayClient();
            resolvedPaymentDetails = await razorpay.payments.fetch(resolvedPaymentId);
        } catch (error) {
            const gatewayMessage = normalizeGatewayError(error, 'Failed to fetch payment details from Razorpay');
            await PaymentAttempt.markReconciliationPending({
                id: attempt.id,
                paymentId: resolvedPaymentId,
                signature: razorpaySignature,
                errorMessage: gatewayMessage
            });
            throw buildError(
                isGatewayTransientError(error)
                    ? 'Payment confirmation is taking longer than usual. Please retry in a moment.'
                    : gatewayMessage,
                isGatewayTransientError(error) ? 503 : 400,
                { reconciliationPending: true }
            );
        }
    }

    if (!resolvedPaymentDetails || String(resolvedPaymentDetails.order_id) !== String(attempt.razorpay_order_id)) {
        await PaymentAttempt.markFailed({
            id: attempt.id,
            paymentId: resolvedPaymentId,
            signature: razorpaySignature,
            errorMessage: 'Payment order mismatch'
        });
        throw buildError('Payment verification failed: order mismatch', 400);
    }

    if (Number(resolvedPaymentDetails.amount || 0) !== Number(attempt.amount_subunits || 0)) {
        await PaymentAttempt.markFailed({
            id: attempt.id,
            paymentId: resolvedPaymentId,
            signature: razorpaySignature,
            errorMessage: 'Payment amount mismatch'
        });
        throw buildError('Payment verification failed: amount mismatch', 400);
    }

    if (String(resolvedPaymentDetails.currency || '').toUpperCase() !== String(attempt.currency || 'INR').toUpperCase()) {
        await PaymentAttempt.markFailed({
            id: attempt.id,
            paymentId: resolvedPaymentId,
            signature: razorpaySignature,
            errorMessage: 'Payment currency mismatch'
        });
        throw buildError('Payment verification failed: currency mismatch', 400);
    }

    if (String(resolvedPaymentDetails.status || '').toLowerCase() !== 'captured') {
        await PaymentAttempt.markReconciliationPending({
            id: attempt.id,
            paymentId: resolvedPaymentId,
            signature: razorpaySignature,
            errorMessage: `Payment not captured yet (${String(resolvedPaymentDetails.status || 'unknown')})`
        });
        throw buildError('Payment is not captured yet', 409, { reconciliationPending: true });
    }

    await PaymentAttempt.upsertPaymentSnapshot({
        id: attempt.id,
        paymentDetails: resolvedPaymentDetails
    }).catch(() => {});

    const existingOrder = await attachAttemptToExistingPaidOrder({
        attempt,
        paymentId: resolvedPaymentId
    });
    if (existingOrder?.id) {
        const refreshedAttempt = await PaymentAttempt.getById(attempt.id);
        return {
            attempt: refreshedAttempt || attempt,
            paymentDetails: resolvedPaymentDetails,
            paymentId: resolvedPaymentId,
            existingOrder,
            reusedExistingOrder: true
        };
    }

    try {
        await PaymentAttempt.markPaidUnverified({
            id: attempt.id,
            paymentId: resolvedPaymentId,
            signature: razorpaySignature
        });
    } catch (error) {
        if (!isDuplicatePaymentClaimError(error)) {
            throw error;
        }
        const duplicateOrder = await attachAttemptToExistingPaidOrder({
            attempt,
            paymentId: resolvedPaymentId
        });
        if (duplicateOrder?.id) {
            const refreshedAttempt = await PaymentAttempt.getById(attempt.id);
            return {
                attempt: refreshedAttempt || attempt,
                paymentDetails: resolvedPaymentDetails,
                paymentId: resolvedPaymentId,
                existingOrder: duplicateOrder,
                reusedExistingOrder: true
            };
        }
        await PaymentAttempt.markReconciliationPending({
            id: attempt.id,
            paymentId: resolvedPaymentId,
            signature: razorpaySignature,
            errorMessage: DUPLICATE_PAYMENT_CLAIM_MESSAGE,
            delayMinutes: 2
        });
        throw buildError(
            DUPLICATE_PAYMENT_CLAIM_MESSAGE,
            409,
            { reconciliationPending: true, duplicatePaymentClaim: true }
        );
    }

    const refreshedAttempt = await PaymentAttempt.getById(attempt.id);
    return {
        attempt: refreshedAttempt || attempt,
        paymentDetails: resolvedPaymentDetails,
        paymentId: resolvedPaymentId
    };
};

const resolveCandidatePaymentForAttempt = async (attempt) => {
    const razorpay = await createRazorpayClient();
    const directPaymentId = String(attempt?.razorpay_payment_id || '').trim();
    if (directPaymentId) {
        const paymentDetails = await razorpay.payments.fetch(directPaymentId);
        return {
            paymentDetails,
            paymentId: directPaymentId
        };
    }

    const razorpayOrderId = String(attempt?.razorpay_order_id || '').trim();
    if (!razorpayOrderId) return { paymentDetails: null, paymentId: null };

    const paymentList = await razorpay.payments.all({
        order_id: razorpayOrderId,
        count: 10
    });
    const items = Array.isArray(paymentList?.items) ? paymentList.items : [];
    const prioritized = items.find((item) => String(item?.status || '').toLowerCase() === 'captured')
        || items.find((item) => String(item?.status || '').toLowerCase() === 'authorized')
        || items[0]
        || null;
    return {
        paymentDetails: prioritized,
        paymentId: prioritized?.id ? String(prioritized.id).trim() : null
    };
};

const maybeSendRecoveryCommunications = async ({ order = null, paymentId = null } = {}) => {
    if (!order?.id || !order?.user_id) return;
    const customer = await User.findById(order.user_id);
    if (!customer) return;
    try {
        await sendOrderLifecycleCommunication({
            stage: 'confirmed',
            customer,
            order
        });
    } catch {}
    try {
        await sendPaymentLifecycleCommunication({
            stage: PAYMENT_STATUS.PAID,
            customer,
            order,
            payment: {
                paymentStatus: PAYMENT_STATUS.PAID,
                paymentMethod: order?.payment_gateway || 'razorpay',
                paymentReference: paymentId || order?.razorpay_payment_id || null,
                razorpayOrderId: order?.razorpay_order_id || null
            }
        });
    } catch {}
};

const reconcilePaymentAttemptById = async ({ attemptId, source = 'scheduler' } = {}) => {
    const numericAttemptId = Number(attemptId);
    if (!Number.isFinite(numericAttemptId) || numericAttemptId <= 0) {
        throw buildError('Valid attempt id is required', 400);
    }

    const attempt = await PaymentAttempt.getById(numericAttemptId);
    if (!attempt) {
        return { ok: false, skipped: true, reason: 'not_found' };
    }
    if (attempt.local_order_id) {
        const existingOrder = await Order.getById(attempt.local_order_id);
        return { ok: true, skipped: true, reason: 'already_materialized', order: existingOrder || null };
    }

    const lockAcquired = await PaymentAttempt.beginVerificationLock({
        id: attempt.id,
        paymentId: attempt.razorpay_payment_id || null,
        signature: attempt.razorpay_signature || null
    });
    if (!lockAcquired) {
        return { ok: false, skipped: true, reason: 'verification_locked' };
    }

    try {
        const { paymentDetails, paymentId } = await resolveCandidatePaymentForAttempt(attempt);
        const paymentStatus = String(paymentDetails?.status || '').trim().toLowerCase();

        if (!paymentDetails || !paymentId) {
            await PaymentAttempt.markReconciliationPending({
                id: attempt.id,
                errorMessage: 'Waiting for Razorpay payment details'
            });
            return { ok: true, pending: true, reason: 'waiting_for_payment_details' };
        }

        if (paymentStatus === 'failed') {
            await PaymentAttempt.markFailed({
                id: attempt.id,
                paymentId,
                signature: attempt.razorpay_signature || null,
                errorMessage: paymentDetails?.error_description || 'Payment failed at gateway'
            });
            return { ok: true, failed: true, reason: 'gateway_failed' };
        }

        const reconciled = await ensureCapturedPaymentMatchesAttempt({
            attempt,
            razorpayPaymentId: paymentId,
            razorpaySignature: attempt.razorpay_signature || null,
            paymentDetails
        });

        if (reconciled?.reusedExistingOrder && reconciled?.existingOrder?.id) {
            return { ok: true, skipped: true, reason: 'already_materialized', order: reconciled.existingOrder };
        }

        const order = await Order.createManualOrderFromAttempt({
            attempt: reconciled.attempt,
            paymentGateway: 'razorpay',
            paymentReference: reconciled.paymentId || '',
            actorUserId: null,
            paymentStatus: PAYMENT_STATUS.PAID,
            razorpayOrderId: reconciled.attempt.razorpay_order_id || null,
            razorpayPaymentId: reconciled.paymentId || null,
            razorpaySignature: reconciled.attempt.razorpay_signature || null,
            settlementId: reconciled.paymentDetails?.settlement_id || null,
            settlementSnapshot: null,
            sourceChannel: 'checkout_reconciler'
        });

        if (!order?.id) {
            return { ok: false, skipped: true, reason: 'order_not_materialized' };
        }

        try {
            await markRecoveredByOrder({ order, reason: `order_paid_${source}` });
        } catch {}
        await maybeSendRecoveryCommunications({
            order,
            paymentId: reconciled.paymentId
        });

        return { ok: true, reconciled: true, order };
    } catch (error) {
        if (error?.reconciliationPending) {
            return { ok: true, pending: true, reason: 'reconciliation_pending', message: error.message || null };
        }
        await PaymentAttempt.markFailed({
            id: attempt.id,
            paymentId: attempt.razorpay_payment_id || null,
            signature: attempt.razorpay_signature || null,
            errorMessage: error?.message || 'Payment reconciliation failed'
        });
        return { ok: false, failed: true, reason: 'reconciliation_failed', message: error?.message || null };
    }
};

const runPaymentAttemptReconciliationPass = async ({
    limit = 25,
    minAgeSeconds = 90
} = {}) => {
    const candidates = await PaymentAttempt.listReconciliationCandidates({
        limit,
        minAgeSeconds
    });
    const summary = {
        scanned: candidates.length,
        reconciled: 0,
        pending: 0,
        expired: 0,
        failed: 0,
        skipped: 0
    };

    for (const attempt of candidates) {
        const result = await reconcilePaymentAttemptById({
            attemptId: attempt.id,
            source: 'scheduler'
        });
        if (result?.reconciled) summary.reconciled += 1;
        else if (result?.pending) summary.pending += 1;
        else if (result?.expired) summary.expired += 1;
        else if (result?.failed) summary.failed += 1;
        else summary.skipped += 1;
    }

    return summary;
};

const runSettlementSyncPass = async ({
    limit = 100,
    minAgeHours = 1,
    lookbackDays = 7
} = {}) => {
    const candidates = await Order.listSettlementSyncCandidates({
        limit,
        minAgeHours
    });
    const summary = {
        scanned: candidates.length,
        updated: 0,
        pending: 0,
        missingSettlementId: 0,
        failed: 0
    };

    if (!candidates.length) return summary;

    const razorpay = await createRazorpayClient();
    const unmatchedByOrderId = new Map();
    const candidatePaymentIds = new Map();
    const candidateRazorpayOrderIds = new Map();
    candidates.forEach((order) => {
        unmatchedByOrderId.set(String(order.id), order);
        const paymentId = String(order?.razorpay_payment_id || '').trim();
        const razorpayOrderId = String(order?.razorpay_order_id || '').trim();
        if (paymentId) candidatePaymentIds.set(paymentId, order);
        if (razorpayOrderId) candidateRazorpayOrderIds.set(razorpayOrderId, order);
    });

    const today = new Date();
    for (let offset = 0; offset <= Math.max(0, Number(lookbackDays || 7)); offset += 1) {
        if (!unmatchedByOrderId.size) break;
        try {
            const dayDate = new Date(today.getTime() - offset * 24 * 60 * 60 * 1000);
            const { year, month, day } = getIstDateParts(dayDate);
            const reconItems = await fetchSettlementReconItemsForDay(razorpay, {
                year,
                month,
                day
            });

            for (const entry of reconItems) {
                if (!entry || String(entry.type || '').toLowerCase() !== 'payment') continue;
                const paymentId = String(entry.entity_id || entry.payment_id || '').trim();
                const razorpayOrderId = String(entry.order_id || '').trim();
                const matchedOrder = candidatePaymentIds.get(paymentId) || candidateRazorpayOrderIds.get(razorpayOrderId) || null;
                if (!matchedOrder || !unmatchedByOrderId.has(String(matchedOrder.id))) continue;

                const settlementSnapshot = normalizeSettlementReconSnapshot(entry);
                if (!settlementSnapshot?.id) {
                    summary.pending += 1;
                    unmatchedByOrderId.delete(String(matchedOrder.id));
                    continue;
                }

                await Order.updateSettlementByOrderId({
                    orderId: matchedOrder.id,
                    settlementId: settlementSnapshot.id,
                    settlementSnapshot
                });
                unmatchedByOrderId.delete(String(matchedOrder.id));
                summary.updated += 1;
            }
        } catch (error) {
            summary.failed += 1;
        }
    }

    unmatchedByOrderId.forEach(() => {
        summary.missingSettlementId += 1;
    });

    return summary;
};

module.exports = {
    ensureCapturedPaymentMatchesAttempt,
    reconcilePaymentAttemptById,
    runPaymentAttemptReconciliationPass,
    runSettlementSyncPass
};
