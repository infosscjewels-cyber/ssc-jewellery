const {
    reconcilePaymentAttemptById: reconcileRazorpayAttemptById,
    runPaymentAttemptReconciliationPass: runRazorpayReconciliationPass,
    runSettlementSyncPass: runRazorpaySettlementSyncPass
} = require('./paymentReconciliationService');
const { reconcileIciciAttemptById } = require('./iciciStatusService');
const { runIciciSettlementSyncPass } = require('./iciciSettlementService');
const { PaymentAttempt } = require('../models/PaymentAttempt');

const reconcilePaymentAttemptById = async ({ attemptId, source = 'scheduler' } = {}) => {
    const attempt = await PaymentAttempt.getById(attemptId);
    if (!attempt?.id) return { ok: false, skipped: true, reason: 'not_found' };
    const gateway = String(attempt.payment_gateway || 'razorpay').trim().toLowerCase();
    if (gateway === 'icici') {
        return reconcileIciciAttemptById({ attemptId: attempt.id, source });
    }
    return reconcileRazorpayAttemptById({ attemptId: attempt.id, source });
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
        const result = String(attempt?.payment_gateway || 'razorpay').trim().toLowerCase() === 'icici'
            ? await reconcileIciciAttemptById({ attemptId: attempt.id, source: 'scheduler' })
            : await reconcileRazorpayAttemptById({ attemptId: attempt.id, source: 'scheduler' });
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
    const [razorpaySummary, iciciSummary] = await Promise.all([
        runRazorpaySettlementSyncPass({
            limit,
            minAgeHours,
            lookbackDays
        }),
        runIciciSettlementSyncPass({
            limit,
            minAgeHours
        })
    ]);
    return {
        scanned: Number(razorpaySummary?.scanned || 0) + Number(iciciSummary?.scanned || 0),
        updated: Number(razorpaySummary?.updated || 0) + Number(iciciSummary?.updated || 0),
        pending: Number(razorpaySummary?.pending || 0) + Number(iciciSummary?.pending || 0),
        missingSettlementId: Number(razorpaySummary?.missingSettlementId || 0) + Number(iciciSummary?.missingSettlementId || 0),
        failed: Number(razorpaySummary?.failed || 0) + Number(iciciSummary?.failed || 0),
        gateways: {
            razorpay: razorpaySummary,
            icici: iciciSummary
        }
    };
};

module.exports = {
    reconcilePaymentAttemptById,
    runPaymentAttemptReconciliationPass,
    runRazorpayReconciliationPass,
    runSettlementSyncPass
};
