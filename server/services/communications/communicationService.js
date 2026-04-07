const { sendEmail, verifyEmailTransport } = require('./channels/emailChannel');
const db = require('../../config/db');
const {
    sendWhatsapp: sendWhatsappDirect
} = require('./channels/whatsappChannel');
const { buildInvoiceShareUrl } = require('../invoiceShareService');
const { queueCommunicationFailure } = require('./communicationRetryService');

const normalizeCustomer = (customer = {}) => ({
    name: String(customer?.name || 'Customer').trim(),
    email: String(customer?.email || '').trim(),
    mobile: String(customer?.mobile || '').trim()
});

const normalizeEmailRecipients = (value) => {
    if (Array.isArray(value)) {
        return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    }
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
};

const hasExplicitTaxPriceMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'inclusive' || normalized === 'exclusive';
};

const resolveOrderTaxPriceMode = (order = {}) => {
    const displayPricing = order?.display_pricing && typeof order.display_pricing === 'object'
        ? order.display_pricing
        : order?.displayPricing && typeof order.displayPricing === 'object'
            ? order.displayPricing
            : null;
    const directMode = order?.tax_price_mode || order?.taxPriceMode || displayPricing?.taxPriceMode || order?.company_snapshot?.taxPriceMode || order?.companySnapshot?.taxPriceMode || '';
    if (hasExplicitTaxPriceMode(directMode)) {
        return String(directMode).trim().toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive';
    }
    const items = Array.isArray(order?.items) ? order.items : [];
    for (const item of items) {
        const snapshot = parseSnapshotSafe(item?.item_snapshot) || parseSnapshotSafe(item?.itemSnapshot) || parseSnapshotSafe(item?.snapshot) || {};
        const snapshotMode = snapshot?.taxPriceMode || item?.tax_price_mode || item?.taxPriceMode || '';
        if (hasExplicitTaxPriceMode(snapshotMode)) {
            return String(snapshotMode).trim().toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive';
        }
    }
    return 'exclusive';
};

const buildSkippedEmailResult = (reason = 'missing_email', meta = {}) => ({
    ok: false,
    skipped: true,
    reason,
    ...meta
});

const buildSkippedDuplicateResult = (channel = 'generic') => ({
    ok: false,
    skipped: true,
    reason: 'duplicate_communication',
    channel
});

const EMAIL_DAILY_SEND_SOFT_LIMIT = Math.max(1, Number(process.env.EMAIL_DAILY_SEND_SOFT_LIMIT || 90));
const EMAIL_DAILY_SEND_WINDOW_HOURS = Math.max(1, Number(process.env.EMAIL_DAILY_SEND_WINDOW_HOURS || 24));
const EMAIL_ECO_MODE_REMAINING_RATIO = Math.min(1, Math.max(0, Number(process.env.EMAIL_ECO_MODE_REMAINING_RATIO || 0.4)));
const WORKFLOW_EMAIL_CLASSIFICATIONS = {
    mandatory_email: new Set([
        'otp',
        'login_otp',
        'password_reset_otp',
        'order',
        'payment_status'
    ]),
    fallback_email: new Set([
        'welcome',
        'loyalty_upgrade',
        'loyalty_downgrade',
        'loyalty_monthly_summary',
        'loyalty_progress',
        'birthday_coupon',
        'coupon_issue',
        'abandoned_cart_recovery'
    ])
};

const normalizeWorkflowName = (workflow = '') => String(workflow || '').trim().toLowerCase() || 'generic';

const classifyWorkflowEmailPolicy = (workflow = '') => {
    const normalized = normalizeWorkflowName(workflow);
    if (WORKFLOW_EMAIL_CLASSIFICATIONS.mandatory_email.has(normalized)) {
        return 'mandatory_email';
    }
    if (normalized.startsWith('order_')) {
        return 'mandatory_email';
    }
    if (WORKFLOW_EMAIL_CLASSIFICATIONS.fallback_email.has(normalized)) {
        return 'fallback_email';
    }
    return 'generic_email';
};

const getRecentSuccessfulCommunicationCount = async ({ channel = 'email', windowHours = EMAIL_DAILY_SEND_WINDOW_HOURS } = {}) => {
    const [rows] = await db.execute(
        `SELECT COUNT(*) AS total
         FROM communication_delivery_logs
         WHERE channel = ?
           AND status = 'sent'
           AND updated_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL ? HOUR)`,
        [String(channel || 'email').slice(0, 20), Math.max(1, Number(windowHours || EMAIL_DAILY_SEND_WINDOW_HOURS))]
    );
    return Number(rows?.[0]?.total || 0);
};

const getEmailQuotaState = async () => {
    const softLimit = Math.max(1, Number(EMAIL_DAILY_SEND_SOFT_LIMIT || 1));
    const sentInWindow = await getRecentSuccessfulCommunicationCount({
        channel: 'email',
        windowHours: EMAIL_DAILY_SEND_WINDOW_HOURS
    });
    const remainingQuota = Math.max(0, softLimit - sentInWindow);
    const remainingRatio = softLimit > 0 ? (remainingQuota / softLimit) : 0;
    return {
        softLimit,
        windowHours: EMAIL_DAILY_SEND_WINDOW_HOURS,
        sentInWindow,
        remainingQuota,
        remainingRatio,
        ecoModeThresholdRatio: EMAIL_ECO_MODE_REMAINING_RATIO,
        ecoModeActive: remainingRatio <= EMAIL_ECO_MODE_REMAINING_RATIO
    };
};

const buildEmailPolicyMeta = ({
    workflow = 'generic',
    classification = 'generic_email',
    quotaState = null,
    fallbackReason = null,
    recipientMobile = ''
} = {}) => ({
    workflow: normalizeWorkflowName(workflow),
    classification,
    ecoModeActive: Boolean(quotaState?.ecoModeActive),
    softLimit: Number(quotaState?.softLimit || EMAIL_DAILY_SEND_SOFT_LIMIT),
    sentInWindow: Number(quotaState?.sentInWindow || 0),
    remainingQuota: Number(quotaState?.remainingQuota || 0),
    remainingRatio: Number(quotaState?.remainingRatio || 0),
    fallbackReason: fallbackReason || null,
    recipientHasWhatsapp: /^[0-9]{10,12}$/.test(String(recipientMobile || '').trim())
});

const recordSuccessfulCommunicationDelivery = async ({
    channel,
    workflow = 'generic',
    recipient,
    payload = {},
    result = null
} = {}) => {
    const safeChannel = String(channel || '').trim().toLowerCase();
    const safeRecipient = String(recipient || '').trim();
    if (!safeChannel || !safeRecipient) return;
    await db.execute(
        `INSERT INTO communication_delivery_logs
            (channel, workflow, recipient, payload_json, status, attempt_count, max_attempts, last_result_json, next_retry_at)
         VALUES (?, ?, ?, ?, 'sent', 1, 1, ?, NULL)`,
        [
            safeChannel,
            String(workflow || 'generic').trim() || 'generic',
            safeRecipient,
            JSON.stringify(payload ?? null),
            JSON.stringify(result ?? null)
        ]
    );
};

const reserveCommunicationDedupeKey = async ({
    dedupeKey,
    channel,
    workflow,
    stage = null,
    orderId = null
} = {}) => {
    if (!dedupeKey) return true;
    try {
        await db.execute(
            `INSERT INTO communication_dedupe_keys
                (dedupe_key, channel, workflow, stage, order_id, status)
             VALUES (?, ?, ?, ?, ?, 'pending')`,
            [
                String(dedupeKey).slice(0, 255),
                String(channel || '').slice(0, 20),
                String(workflow || 'generic').slice(0, 80),
                stage ? String(stage).slice(0, 80) : null,
                Number.isFinite(Number(orderId)) ? Number(orderId) : null
            ]
        );
        return true;
    } catch (error) {
        if (error?.code === 'ER_DUP_ENTRY') return false;
        throw error;
    }
};

const markCommunicationDedupeSent = async (dedupeKey = '') => {
    if (!dedupeKey) return;
    await db.execute(
        `UPDATE communication_dedupe_keys
         SET status = 'sent',
             updated_at = CURRENT_TIMESTAMP
         WHERE dedupe_key = ?`,
        [String(dedupeKey).slice(0, 255)]
    );
};

const releaseCommunicationDedupeKey = async (dedupeKey = '') => {
    if (!dedupeKey) return;
    await db.execute(
        'DELETE FROM communication_dedupe_keys WHERE dedupe_key = ?',
        [String(dedupeKey).slice(0, 255)]
    );
};

const buildCommunicationDedupeKey = ({
    workflow = 'generic',
    stage = '',
    channel = '',
    order = {},
    payment = {}
} = {}) => {
    const orderId = Number(order?.id || order?.order_id || 0);
    const orderRef = String(
        order?.order_ref
        || order?.orderRef
        || order?.razorpay_order_id
        || payment?.razorpayOrderId
        || payment?.paymentReference
        || ''
    ).trim();
    const target = Number.isFinite(orderId) && orderId > 0 ? `order:${orderId}` : (orderRef ? `ref:${orderRef}` : '');
    if (!target) return '';
    return [
        String(workflow || 'generic').trim().toLowerCase(),
        String(stage || '').trim().toLowerCase(),
        String(channel || '').trim().toLowerCase(),
        target
    ].join('|').slice(0, 255);
};

const runChannelWithDedupe = async ({
    channel,
    workflow,
    stage = '',
    order = {},
    payment = {},
    disableDedupe = false,
    sendFn
} = {}) => {
    if (typeof sendFn !== 'function') {
        throw new Error('sendFn is required');
    }
    const dedupeKey = disableDedupe
        ? ''
        : buildCommunicationDedupeKey({ workflow, stage, channel, order, payment });
    const reserved = await reserveCommunicationDedupeKey({
        dedupeKey,
        channel,
        workflow,
        stage,
        orderId: order?.id || order?.order_id || null
    });
    if (!reserved) {
        return buildSkippedDuplicateResult(channel);
    }
    try {
        const result = await sendFn();
        await markCommunicationDedupeSent(dedupeKey);
        return result;
    } catch (error) {
        await releaseCommunicationDedupeKey(dedupeKey).catch(() => {});
        throw error;
    }
};

const sendEmailCommunication = async ({
    to,
    subject,
    text = '',
    html = '',
    replyTo = null,
    cc = null,
    bcc = null,
    attachments = [],
    workflow = 'generic',
    disableRetry = false
}) => {
    try {
        const recipientList = normalizeEmailRecipients(to);
        const sentInWindow = await getRecentSuccessfulCommunicationCount({ channel: 'email' });
        if (sentInWindow >= EMAIL_DAILY_SEND_SOFT_LIMIT) {
            throw new Error(`Email rate limit reached: hostinger_daily_send_cap (${sentInWindow}/${EMAIL_DAILY_SEND_SOFT_LIMIT} in ${EMAIL_DAILY_SEND_WINDOW_HOURS}h)`);
        }
        const result = await sendEmail({ to, subject, text, html, replyTo, cc, bcc, attachments });
        await recordSuccessfulCommunicationDelivery({
            channel: 'email',
            workflow,
            recipient: recipientList.join(', '),
            payload: { to: recipientList, subject, text, html, replyTo, cc, bcc },
            result
        }).catch(() => {});
        return result;
    } catch (error) {
        if (!disableRetry) {
            await queueCommunicationFailure({
                channel: 'email',
                workflow,
                recipient: Array.isArray(to) ? to.join(',') : String(to || ''),
                payload: { to, subject, text, html, replyTo, cc, bcc, attachments },
                error
            }).catch(() => {});
        }
        throw error;
    }
};

const deliverWorkflowEmail = async ({
    workflow = 'generic',
    to,
    subject,
    text = '',
    html = '',
    replyTo = null,
    cc = null,
    bcc = null,
    attachments = [],
    disableRetry = false,
    context = {}
} = {}) => {
    const recipients = normalizeEmailRecipients(to);
    const workflowName = String(workflow || 'generic').trim().toLowerCase() || 'generic';
    if (!recipients.length) {
        console.warn('[email] skipped workflow email: missing recipient', {
            workflow: workflowName,
            context
        });
        return buildSkippedEmailResult('missing_email');
    }

    console.info('[email] attempting workflow email', {
        workflow: workflowName,
        to: recipients,
        subject: String(subject || ''),
        context
    });

    try {
        const result = await sendEmailCommunication({
            to: recipients,
            subject,
            text,
            html,
            replyTo,
            cc,
            bcc,
            attachments,
            workflow: workflowName,
            disableRetry
        });
        console.info('[email] workflow email result', {
            workflow: workflowName,
            to: recipients,
            ok: result?.ok === true,
            messageId: result?.messageId || null,
            accepted: Array.isArray(result?.accepted) ? result.accepted : [],
            rejected: Array.isArray(result?.rejected) ? result.rejected : [],
            response: result?.response || null,
            context
        });
        return result;
    } catch (error) {
        console.error('[email] workflow email failed', {
            workflow: workflowName,
            to: recipients,
            message: error?.message || 'email_send_failed',
            context
        });
        throw error;
    }
};

const deliverWorkflowEmailWithPolicy = async ({
    workflow = 'generic',
    recipientMobile = '',
    whatsappResult = null,
    to,
    subject,
    text = '',
    html = '',
    replyTo = null,
    cc = null,
    bcc = null,
    attachments = [],
    disableRetry = false,
    context = {}
} = {}) => {
    const workflowName = normalizeWorkflowName(workflow);
    const classification = classifyWorkflowEmailPolicy(workflowName);
    const quotaState = await getEmailQuotaState();
    const policyMetaBase = buildEmailPolicyMeta({
        workflow: workflowName,
        classification,
        quotaState,
        recipientMobile
    });

    if (classification === 'fallback_email' && quotaState.ecoModeActive) {
        const hasWhatsappMobile = /^[0-9]{10,12}$/.test(String(recipientMobile || '').trim());
        const whatsappDelivered = Boolean(whatsappResult?.ok);
        if (hasWhatsappMobile && whatsappDelivered) {
            const result = buildSkippedEmailResult('eco_mode_whatsapp_succeeded', {
                policy: {
                    ...policyMetaBase,
                    fallbackReason: 'whatsapp_succeeded'
                }
            });
            console.info('[email] eco mode skipped workflow email', {
                workflow: workflowName,
                reason: result.reason,
                policy: result.policy,
                context
            });
            return result;
        }
    }

    const fallbackReason = classification === 'fallback_email' && quotaState.ecoModeActive
        ? (whatsappResult?.ok
            ? null
            : (whatsappResult?.reason || whatsappResult?.message || (/^[0-9]{10,12}$/.test(String(recipientMobile || '').trim()) ? 'whatsapp_unavailable_or_failed' : 'missing_whatsapp')))
        : null;

    const result = await deliverWorkflowEmail({
        workflow: workflowName,
        to,
        subject,
        text,
        html,
        replyTo,
        cc,
        bcc,
        attachments,
        disableRetry,
        context
    });
    return {
        ...result,
        policy: buildEmailPolicyMeta({
            workflow: workflowName,
            classification,
            quotaState,
            fallbackReason,
            recipientMobile
        })
    };
};

const sendWhatsapp = async (payload = {}) => {
    const result = await sendWhatsappDirect(payload);
    if (!result?.ok && !result?.skipped) {
        await queueCommunicationFailure({
            channel: 'whatsapp',
            workflow: String(payload?.type || payload?.template || 'generic').trim().toLowerCase() || 'generic',
            recipient: String(payload?.contact || payload?.mobile || payload?.to || '').trim(),
            payload,
            result
        }).catch(() => {});
    }
    return result;
};

const toChannelFailure = (error, fallbackReason = 'channel_failed') => ({
    ok: false,
    skipped: false,
    reason: fallbackReason,
    message: error?.message || fallbackReason
});

const formatCurrency = (amount) => `INR ${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (value) => {
    try {
        const d = new Date(value || Date.now());
        if (Number.isNaN(d.getTime())) return '';
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return '';
    }
};
const formatTier = (value) => {
    const tier = String(value || 'regular').trim().toLowerCase();
    if (!tier || tier === 'regular') return 'Basic';
    return `${tier.charAt(0).toUpperCase()}${tier.slice(1)}`;
};
const formatSplitTaxLabel = (amount) => {
    const total = Math.max(0, Number(amount || 0));
    const half = total / 2;
    return `SGST ${formatCurrency(half)} + CGST ${formatCurrency(half)}`;
};
const roundCurrency = (value) => Math.round(Number(value || 0) * 100) / 100;
const buildDiscountCellHtml = (item = {}) => {
    const totalDiscount = Math.max(
        0,
        Number(item.productDiscount || 0) + Number(item.couponShare || 0) + Number(item.memberShare || 0) + Number(item.shippingBenefitShare || 0)
    );
    const lines = [
        `<div style="font-size:12px;color:#111827;">${formatCurrency(totalDiscount)}</div>`,
        `<div style="font-size:11px;color:#6b7280;">Product: ${formatCurrency(item.productDiscount)}</div>`,
        `<div style="font-size:11px;color:#6b7280;">Coupon: ${formatCurrency(item.couponShare)}</div>`,
        `<div style="font-size:11px;color:#6b7280;">Member: ${formatCurrency(item.memberShare)}</div>`
    ];
    if (Number(item.shippingBenefitShare || 0) > 0) {
        lines.push(`<div style="font-size:11px;color:#6b7280;">Shipping Benefit: ${formatCurrency(item.shippingBenefitShare)}</div>`);
    }
    return lines.join('');
};
const buildTaxCellHtml = (item = {}) => {
    const totalTax = Math.max(0, Number(item.taxAmount || 0));
    const lines = [`<div style="font-size:12px;color:#111827;">${formatCurrency(totalTax)}</div>`];
    if (totalTax > 0) {
        lines.push(`<div style="font-size:11px;color:#6b7280;">${formatSplitTaxLabel(totalTax)}</div>`);
    }
    return lines.join('');
};
const parseSnapshotSafe = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};
const buildOrderSnapshotLine = (order = {}) => {
    const items = Array.isArray(order?.items) ? order.items : [];
    const displayPricing = order?.display_pricing && typeof order.display_pricing === 'object'
        ? order.display_pricing
        : order?.displayPricing && typeof order.displayPricing === 'object'
            ? order.displayPricing
            : null;
    const taxPriceMode = resolveOrderTaxPriceMode(order);
    const resolvedItems = items
        .map((item) => {
            const snapshot = parseSnapshotSafe(item?.item_snapshot) || {};
            const quantity = Math.max(0, Number(snapshot?.quantity ?? item?.quantity ?? 0));
            const title = String(snapshot?.title || item?.title || 'Item').trim() || 'Item';
            const variantTitle = String(snapshot?.variantTitle || item?.variant_title || item?.variantTitle || '').trim();
            const paidUnitGross = Number(item?.price ?? snapshot?.unitPriceGross ?? snapshot?.unitPrice ?? 0);
            const paidUnitBase = Number(item?.unit_price_base ?? item?.unitPriceBase ?? snapshot?.unitPriceBase ?? paidUnitGross);
            const mrpUnitGross = Number(item?.original_price ?? snapshot?.originalPrice ?? paidUnitGross);
            const mrpUnitBase = Number(snapshot?.originalPriceBase ?? mrpUnitGross);
            const lineTotalGross = Number(snapshot?.lineTotalGross ?? snapshot?.lineTotal ?? item?.line_total ?? ((paidUnitGross * quantity) || 0));
            const lineTotalBase = Number(item?.line_total_base ?? item?.lineTotalBase ?? snapshot?.lineTotalBase ?? lineTotalGross);
            const taxAmount = Number(item?.tax_amount ?? snapshot?.taxAmount ?? 0);
            const taxRatePercent = Number(item?.tax_rate_percent ?? snapshot?.taxRatePercent ?? 0);
            return {
                quantity,
                title,
                variantTitle,
                paidUnit: taxPriceMode === 'inclusive' ? paidUnitBase : paidUnitGross,
                mrpUnit: taxPriceMode === 'inclusive' ? mrpUnitBase : mrpUnitGross,
                lineTotal: taxPriceMode === 'inclusive' ? lineTotalBase : lineTotalGross,
                lineTotalGross,
                taxAmount,
                taxRatePercent,
                productDiscount: Math.max(
                    0,
                    ((taxPriceMode === 'inclusive' ? mrpUnitBase : mrpUnitGross) - (taxPriceMode === 'inclusive' ? paidUnitBase : paidUnitGross)) * quantity
                )
            };
        })
        .filter((item) => item.quantity > 0);
    if (!resolvedItems.length) return '';
    const couponDiscount = Number(order?.coupon_discount_value || 0);
    const loyaltyDiscount = Number(order?.loyalty_discount_total || 0);
    const loyaltyShippingDiscount = Number(order?.loyalty_shipping_discount_total || 0);
    const totalDiscount = Number(order?.discount_total || (couponDiscount + loyaltyDiscount + loyaltyShippingDiscount));
    const subtotal = Number((displayPricing?.displaySubtotalBase ?? order?.subtotal ?? 0));
    const shippingFee = Number((displayPricing?.displayShippingBase ?? order?.shipping_fee ?? 0));
    const taxTotal = Number(order?.tax_total || 0);
    const roundOffAmount = Number(order?.round_off_amount ?? order?.roundOffAmount ?? displayPricing?.roundOffAmount ?? 0);
    const basePriceBeforeDiscounts = Number(displayPricing?.displayBaseBeforeDiscounts ?? Math.max(0, subtotal + shippingFee));
    const taxableValueAfterDiscounts = Number(displayPricing?.displayValueAfterDiscountsBase ?? Math.max(0, basePriceBeforeDiscounts - couponDiscount - loyaltyDiscount - loyaltyShippingDiscount));
    const couponCode = String(order?.coupon_code || '').trim().toUpperCase();
    const lineDenominator = Math.max(1, resolvedItems.reduce((sum, item) => sum + Math.max(0, Number(item.lineTotalGross || item.lineTotal || 0)), 0));
    let couponAllocated = 0;
    let memberAllocated = 0;
    const allocatedItems = resolvedItems.map((item, index) => {
        const ratio = lineDenominator > 0 ? (Math.max(0, Number(item.lineTotalGross || item.lineTotal || 0)) / lineDenominator) : 0;
        const isLast = index === resolvedItems.length - 1;
        const couponShare = isLast ? Math.max(0, couponDiscount - couponAllocated) : roundCurrency(couponDiscount * ratio);
        couponAllocated += couponShare;
        const memberShare = isLast ? Math.max(0, loyaltyDiscount - memberAllocated) : roundCurrency(loyaltyDiscount * ratio);
        memberAllocated += memberShare;
        return {
            ...item,
            couponShare,
            memberShare,
            shippingShare: 0,
            shippingBenefitShare: 0,
            netShippingShare: 0,
            lineTotalInclTax: taxPriceMode === 'inclusive'
                ? Math.max(0, Number(item.lineTotalGross || 0) - couponShare - memberShare)
                : Math.max(0, item.lineTotal - couponShare - memberShare) + Math.max(0, item.taxAmount)
        };
    });
    const shippingTaxAmount = Math.max(0, roundCurrency(taxTotal - allocatedItems.reduce((sum, item) => sum + Math.max(0, Number(item.taxAmount || 0)), 0)));
    const shippingRow = (shippingFee > 0 || loyaltyShippingDiscount > 0 || shippingTaxAmount > 0)
        ? {
            quantity: 1,
            title: 'Shipping',
            variantTitle: 'Delivery charge',
            mrpUnit: shippingFee,
            lineTotal: Math.max(0, shippingFee - loyaltyShippingDiscount - (taxPriceMode === 'inclusive' ? shippingTaxAmount : 0)),
            taxAmount: shippingTaxAmount,
            taxRatePercent: 0,
            productDiscount: 0,
            couponShare: 0,
            memberShare: 0,
            shippingBenefitShare: loyaltyShippingDiscount,
            lineTotalInclTax: taxPriceMode === 'inclusive'
                ? Math.max(0, Number(order?.shipping_fee || 0) - loyaltyShippingDiscount)
                : Math.max(0, shippingFee - loyaltyShippingDiscount) + shippingTaxAmount
        }
        : null;
    const tableItems = shippingRow ? [...allocatedItems, shippingRow] : allocatedItems;
    const summaryParts = [
        `Tier: <strong>${formatTier(order?.loyalty_tier || order?.loyaltyTier)}</strong>`,
        `Base Price (Before Discounts): <strong>${formatCurrency(basePriceBeforeDiscounts)}</strong>`,
        couponCode ? `Coupon: <strong>${couponCode}</strong>` : null,
        couponDiscount > 0 ? `Coupon discount: <strong>${formatCurrency(couponDiscount)}</strong>` : null,
        loyaltyDiscount > 0 ? `Member discount: <strong>${formatCurrency(loyaltyDiscount)}</strong>` : null,
        loyaltyShippingDiscount > 0 ? `Member shipping discount: <strong>${formatCurrency(loyaltyShippingDiscount)}</strong>` : null,
        totalDiscount > 0 ? `Total savings: <strong>${formatCurrency(totalDiscount)}</strong>` : null,
        `${taxPriceMode === 'inclusive' ? 'Value After Discounts' : 'Taxable Value After Discounts'}: <strong>${formatCurrency(taxableValueAfterDiscounts)}</strong>`,
        taxTotal > 0 ? `${taxPriceMode === 'inclusive' ? 'GST Breakdown' : 'GST'}: <strong>${formatCurrency(taxTotal)}</strong> (${formatSplitTaxLabel(taxTotal)})` : null,
        roundOffAmount !== 0 ? `Round Off: <strong>${formatCurrency(roundOffAmount)}</strong>` : null
    ].filter(Boolean);
    const visibleItems = tableItems.slice(0, 8);
    const rows = visibleItems.map((item, idx) => `
        <tr>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;vertical-align:top;">${idx + 1}</td>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;vertical-align:top;">
                <div style="font-weight:600;">${item.title}</div>
                ${item.variantTitle ? `<div style="color:#6b7280;margin-top:2px;">${item.variantTitle}</div>` : ''}
            </td>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;text-align:right;vertical-align:top;">${formatCurrency(item.mrpUnit)}</td>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;text-align:right;vertical-align:top;">${item.quantity}</td>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:11px;color:#111827;text-align:right;vertical-align:top;">${buildDiscountCellHtml(item)}</td>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:11px;color:#111827;text-align:right;vertical-align:top;">${buildTaxCellHtml(item)}</td>
            <td style="padding:10px 8px;border-top:1px solid #e5e7eb;font-size:12px;color:#111827;text-align:right;vertical-align:top;font-weight:600;">${formatCurrency(item.lineTotalInclTax)}</td>
        </tr>
    `).join('');
    const tableTotals = {
        qty: tableItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        unitPriceMrp: tableItems.reduce((sum, item) => sum + (Number(item.mrpUnit || 0) * Number(item.quantity || 0)), 0),
        productDiscount: tableItems.reduce((sum, item) => sum + Number(item.productDiscount || 0), 0),
        couponShare: tableItems.reduce((sum, item) => sum + Number(item.couponShare || 0), 0),
        memberShare: tableItems.reduce((sum, item) => sum + Number(item.memberShare || 0), 0),
        shippingBenefitShare: tableItems.reduce((sum, item) => sum + Number(item.shippingBenefitShare || 0), 0),
        taxAmount: tableItems.reduce((sum, item) => sum + Number(item.taxAmount || 0), 0),
        lineTotalInclTax: tableItems.reduce((sum, item) => sum + Number(item.lineTotalInclTax || 0), 0)
    };
    const tableHtml = `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;border-collapse:separate;border-spacing:0;">
            <thead>
                <tr style="background:#f9fafb;">
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:left;">#</th>
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:left;">Item</th>
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:right;">${taxPriceMode === 'inclusive' ? 'Taxable Value' : 'Unit Price (MRP)'}</th>
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:right;">Qty</th>
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:right;">Discount</th>
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:right;">GST</th>
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:right;">Line Total</th>
                </tr>
            </thead>
            <tbody>
                ${rows}
                <tr style="background:#f9fafb;">
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;"></td>
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;font-size:12px;color:#374151;font-weight:700;">Table Totals</td>
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;font-size:12px;color:#374151;text-align:right;font-weight:700;">${formatCurrency(tableTotals.unitPriceMrp)}</td>
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;font-size:12px;color:#374151;text-align:right;font-weight:700;">${Math.round(tableTotals.qty)}</td>
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;font-size:11px;color:#374151;text-align:right;font-weight:700;">${buildDiscountCellHtml(tableTotals)}</td>
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;font-size:11px;color:#374151;text-align:right;font-weight:700;">${buildTaxCellHtml({ taxAmount: tableTotals.taxAmount })}</td>
                    <td style="padding:10px 8px;border-top:1px solid #d1d5db;font-size:12px;color:#374151;text-align:right;font-weight:700;">${formatCurrency(tableTotals.lineTotalInclTax)}</td>
                </tr>
            </tbody>
        </table>
    `;
    return [
        '<strong>Order snapshot</strong>',
        summaryParts.length ? summaryParts.join(' | ') : null,
        tableHtml,
        tableItems.length > visibleItems.length ? `+${tableItems.length - visibleItems.length} more item(s)` : null
    ].filter(Boolean).join('<br/>');
};

const hashSeed = (input = '') => {
    const value = String(input || '');
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = ((hash << 5) - hash) + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
};

const pickVariant = (variants = [], seed = '') => {
    const list = Array.isArray(variants) ? variants : [];
    if (!list.length) return '';
    return list[hashSeed(seed) % list.length];
};

const stripHtml = (value = '') => String(value).replace(/<[^>]+>/g, '');

const buildRichMail = ({ greeting, subject, bodyBlocks = [], actionItems = [], assurance, closing }) => {
    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:20px;color:#111827;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <tr>
                    <td style="padding:22px;font-size:15px;line-height:1.6;">
                        <p style="margin:0 0 12px;">${greeting}</p>
                        ${bodyBlocks.map((item) => `<p style="margin:0 0 12px;">${item}</p>`).join('')}
                        ${actionItems.length ? `<p style="margin:0 0 8px;"><strong>Recommended next steps:</strong></p><ol style="margin:0 0 12px 18px;padding:0;">${actionItems.map((item) => `<li>${item}</li>`).join('')}</ol>` : ''}
                        ${assurance ? `<p style="margin:0 0 12px;">${assurance}</p>` : ''}
                        <p style="margin:0;white-space:pre-line;">${closing}</p>
                    </td>
                </tr>
            </table>
        </div>
    `;

    const text = [
        greeting,
        '',
        ...bodyBlocks.map(stripHtml),
        actionItems.length ? '' : null,
        actionItems.length ? 'Recommended next steps:' : null,
        ...actionItems.map((item, idx) => `${idx + 1}. ${item}`),
        assurance ? '' : null,
        assurance || null,
        '',
        closing
    ].filter(Boolean).join('\n');

    return { subject, html, text };
};

const COMMON_GREETINGS = [
    'Dear {name},',
    'Hello {name},',
    'Hi {name},',
    'Greetings {name},',
    'Dear Valued Customer {name},',
    'Hello {name}, thank you for choosing SSC Jewellery,',
    'Hi {name}, this is an update from SSC Jewellery,',
    'Dear {name}, please find your latest order communication below,',
    'Hello {name}, we are writing with an important update,',
    '{name}, we appreciate your trust in SSC Jewellery.'
];

const COMMON_CLOSINGS = [
    'Regards,\nSSC Jewellery Support Team',
    'Warm regards,\nSSC Jewellery Operations Team',
    'Sincerely,\nSSC Jewellery Customer Care',
    'Best regards,\nSSC Jewellery Administration',
    'Thank you,\nSSC Jewellery Team',
    'Kind regards,\nSSC Jewellery Service Desk',
    'With thanks,\nSSC Jewellery Support',
    'Respectfully,\nSSC Jewellery Customer Success Team',
    'Yours faithfully,\nSSC Jewellery Help Desk',
    'Thank you for shopping with SSC Jewellery,\nCustomer Experience Team'
];

const buildOrderLifecycleTemplate = ({ stage = 'updated', customer = {}, order = {}, includeInvoice = false } = {}) => {
    const recipient = normalizeCustomer(customer);
    const orderRef = order?.order_ref || order?.orderRef || order?.id || 'N/A';
    const safeStage = String(stage || 'updated').trim().toLowerCase();
    const normalizedStage = ['shipped', 'shipped_followup', 'delivered'].includes(safeStage)
        ? 'completed'
        : safeStage;
    const stageKey = (normalizedStage === 'confirmed' || normalizedStage === 'confirmation')
        ? (Number(order?.discount_total || 0) > 0 ? 'confirmation_discount' : 'confirmation_no_discount')
        : normalizedStage;
    const seed = `${stageKey}|${orderRef}|${recipient.email || recipient.mobile || recipient.name}`;

    const subjects = {
        confirmation_discount: Array.from({ length: 10 }, (_, i) => `Order Confirmed: ${orderRef} | Savings Applied (${i + 1}/10)`),
        confirmation_no_discount: Array.from({ length: 10 }, (_, i) => `Order Confirmed: ${orderRef} (${i + 1}/10)`),
        completed: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} is complete (${i + 1}/10)`),
        invoice: Array.from({ length: 10 }, (_, i) => `Invoice for order ${orderRef} (${i + 1}/10)`),
        cancelled: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} cancelled (${i + 1}/10)`),
        failed: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} needs attention (${i + 1}/10)`)
    };

    const total = formatCurrency(order?.total || 0);
    const createdDate = formatDate(order?.created_at || order?.createdAt);
    const discount = Number(order?.discount_total || 0);
    const invoiceLine = includeInvoice ? 'Your invoice is attached with this communication for your records.' : '';

    const stageSummary = {
        confirmation_discount: `Your order <strong>${orderRef}</strong> has been confirmed${createdDate ? ` on <strong>${createdDate}</strong>` : ''}. You saved <strong>${formatCurrency(discount)}</strong>.`,
        confirmation_no_discount: `Your order <strong>${orderRef}</strong> has been confirmed${createdDate ? ` on <strong>${createdDate}</strong>` : ''}.`,
        completed: `Your order <strong>${orderRef}</strong> has been fulfilled successfully and is now marked complete. Thank you for shopping with SSC Jewellery.`,
        invoice: `Please find the invoice for your order <strong>${orderRef}</strong>${createdDate ? ` placed on <strong>${createdDate}</strong>` : ''}.`,
        cancelled: `Your order <strong>${orderRef}</strong> has been cancelled in our system.`,
        failed: `Your order <strong>${orderRef}</strong> requires your attention before we can proceed.`
    };

    const actionItemsByStage = {
        confirmation_discount: ['Review your order details in your account.', 'Keep this email for future reference.', 'Reply to this email if any correction is needed.'],
        confirmation_no_discount: ['Review your order details in your account.', 'Keep this email for future reference.', 'Reply to this email if any correction is needed.'],
        completed: ['Keep this email for your records.', 'Reply if you need support with your order or product.', 'We would love to serve you again soon.'],
        invoice: ['Keep this invoice for your records.', 'Review billing details and tax lines carefully.', 'Reply if any billing information needs correction.'],
        cancelled: ['Review cancellation and refund details in your account.', 'For EMI refunds, contact your issuing bank for statement timeline updates if needed.', 'Reply to this email if any refund detail looks incorrect.'],
        failed: ['Reply to this email for immediate support.', 'Recheck payment/order details in your account.', 'Our team will guide you through quick resolution.']
    };

    const assuranceByStage = [
        'Need help? Reply to this email and our support team will assist you.',
        'Our administration team is monitoring this order and will keep you updated.',
        'If anything looks incorrect, respond to this email with your order reference.',
        'Your satisfaction is our priority, and support is available whenever you need it.',
        'We are committed to transparent, proactive communication for your order.',
        'Thank you for your patience and trust in SSC Jewellery.',
        'For urgent concerns, mention your order reference in your reply.',
        'Our team is available to support product, payment, and delivery questions.',
        'You can count on us for timely and clear status updates.',
        'We appreciate your business and remain available for assistance.'
    ];

    const subject = pickVariant(subjects[stageKey] || [`Order ${orderRef}: ${stageKey}`], `${seed}|subject`);
    const greeting = pickVariant(COMMON_GREETINGS, `${seed}|greeting`).replaceAll('{name}', recipient.name);
    const closing = pickVariant(COMMON_CLOSINGS, `${seed}|closing`);
    const assurance = pickVariant(assuranceByStage, `${seed}|assurance`);

    const orderRefLine = `Order reference: <strong>${orderRef}</strong>${createdDate && stageKey !== 'completed' ? ` | Date: <strong>${createdDate}</strong>` : ''}`;
    const refundMode = String(order?.refund_mode || '').trim().toLowerCase();
    const refundMethod = String(order?.refund_method || '').trim();
    const refundAmount = Number(order?.refund_amount || 0);
    const refundReference = String(order?.refund_reference || '').trim();
    const manualRefundRef = String(order?.manual_refund_ref || '').trim();
    const manualRefundUtr = String(order?.manual_refund_utr || '').trim();
    const refundCouponCode = String(order?.refund_coupon_code || '').trim();
    const nonRefundableShippingFee = Number(
        order?.refund_notes?.nonRefundableShippingFee
        ?? order?.shipping_fee
        ?? 0
    );
    const emiCancellationWarning = (
        stageKey === 'cancelled'
        && String(order?.payment_gateway || '').toLowerCase() === 'razorpay'
    ) ? 'For EMI transactions, statement reversal timelines are governed by your card issuing bank. Please contact your issuing bank if reversal is not reflected in time.' : '';
    const refundDetailLine = stageKey === 'cancelled'
        ? [
            refundAmount > 0 ? `Refund amount (excluding shipping): <strong>${formatCurrency(refundAmount)}</strong>` : null,
            nonRefundableShippingFee > 0 ? `Non-refundable shipping charge: <strong>${formatCurrency(nonRefundableShippingFee)}</strong>` : null,
            refundMode ? `Refund mode: <strong>${refundMode === 'razorpay' ? 'Razorpay' : 'Manual'}</strong>` : null,
            refundMethod ? `Refund method: <strong>${refundMethod}</strong>` : null,
            refundReference ? `Gateway refund reference: <strong>${refundReference}</strong>` : null,
            manualRefundRef ? `Manual refund reference: <strong>${manualRefundRef}</strong>` : null,
            manualRefundUtr ? `UTR number: <strong>${manualRefundUtr}</strong>` : null,
            refundCouponCode ? `Refund voucher code: <strong>${refundCouponCode}</strong>` : null
        ].filter(Boolean).join(' | ')
        : '';
    const snapshotLine = buildOrderSnapshotLine(order);

    const bodyBlocks = [
        stageSummary[stageKey] || `Your order <strong>${orderRef}</strong> status is <strong>${stageKey}</strong>.`,
        orderRefLine,
        `Order value: <strong>${total}</strong>`,
        snapshotLine || null,
        refundDetailLine || null,
        emiCancellationWarning || null,
        invoiceLine || null
    ].filter(Boolean);

    return buildRichMail({
        greeting,
        subject,
        bodyBlocks,
        actionItems: actionItemsByStage[stageKey] || ['Reply to this email if you need support.'],
        assurance,
        closing
    });
};

const sendOrderLifecycleCommunication = async ({
    stage,
    customer = {},
    order = {},
    includeInvoice = false,
    invoiceAttachment = null,
    allowEmail = true,
    allowWhatsapp = true,
    invoiceShareUrl = null,
    disableDedupe = false
}) => {
    const recipient = normalizeCustomer(customer);
    const safeStage = String(stage || 'updated').trim().toLowerCase();
    const template = buildOrderLifecycleTemplate({ stage: safeStage, customer: recipient, order, includeInvoice });
    const invoiceRef = String(order?.order_ref || order?.orderRef || order?.id || Date.now()).replace(/[^a-zA-Z0-9-_]/g, '');
    const invoiceFileName = `invoice-${invoiceRef}.pdf`;
    const invoiceFileUrl = includeInvoice
        ? (typeof invoiceShareUrl === 'string' ? invoiceShareUrl : buildInvoiceShareUrl({ orderId: order?.id, userId: order?.user_id }))
        : '';

    const [emailResult, whatsappResult] = await Promise.allSettled([
        (allowEmail && recipient.email)
            ? runChannelWithDedupe({
                channel: 'email',
                workflow: `order_${safeStage}`,
                stage: safeStage,
                order,
                disableDedupe,
                sendFn: () => deliverWorkflowEmail({
                    workflow: `order_${safeStage}`,
                    to: recipient.email,
                    subject: template.subject,
                    text: template.text,
                    html: template.html,
                    attachments: invoiceAttachment ? [invoiceAttachment] : [],
                    context: {
                        orderId: order?.id || null,
                        orderRef: order?.order_ref || order?.orderRef || null,
                        stage: safeStage
                    }
                })
            })
            : Promise.resolve(buildSkippedEmailResult('missing_email')),
        allowWhatsapp
            ? runChannelWithDedupe({
                channel: 'whatsapp',
                workflow: `order_${safeStage}`,
                stage: safeStage,
                order,
                disableDedupe,
                sendFn: () => sendWhatsapp({
                    stage: safeStage,
                    customer: recipient,
                    order,
                    type: 'order',
                    template: 'order',
                    mobile: recipient.mobile,
                    fileUrl: invoiceFileUrl || '',
                    pdfName: includeInvoice ? invoiceFileName : ''
                })
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_whatsapp' })
    ]);
    return {
        email: emailResult.status === 'fulfilled'
            ? emailResult.value
            : toChannelFailure(emailResult.reason, 'email_send_failed'),
        whatsapp: whatsappResult.status === 'fulfilled'
            ? whatsappResult.value
            : toChannelFailure(whatsappResult.reason, 'whatsapp_send_failed')
    };
};

const sendPaymentLifecycleCommunication = async ({ stage, customer = {}, order = {}, payment = {}, disableDedupe = false }) => {
    const recipient = normalizeCustomer(customer);
    const orderRef = order?.order_ref || order?.orderRef || payment?.razorpayOrderId || 'N/A';
    const safeStage = String(stage || payment?.paymentStatus || 'updated').trim();
    const seed = `${orderRef}|${safeStage}|${recipient.email || recipient.mobile || recipient.name}`;

    const subject = pickVariant(Array.from({ length: 10 }, (_, i) => `Payment update for ${orderRef}: ${safeStage} (${i + 1}/10)`), `${seed}|subject`);
    const greeting = pickVariant(COMMON_GREETINGS, `${seed}|greeting`).replaceAll('{name}', recipient.name);
    const closing = pickVariant(COMMON_CLOSINGS, `${seed}|closing`);
    const assurance = pickVariant([
        'Our billing team is available to assist if you need clarification.',
        'Please keep this email for your payment records.',
        'If this status appears incorrect, reply and we will verify promptly.',
        'Our administration team will continue monitoring reconciliation.',
        'For urgent billing support, reply to this email with your order reference.',
        'We are committed to accurate and timely payment updates.',
        'Your transaction security remains our priority.',
        'You can contact us anytime for payment support.',
        'We appreciate your patience while payment processing completes.',
        'Support is one reply away if anything needs correction.'
    ], `${seed}|assurance`);

    const template = buildRichMail({
        greeting,
        subject,
        bodyBlocks: [
            `Payment status for order <strong>${orderRef}</strong> is currently <strong>${safeStage}</strong>.`,
            'Please review this update and retain it for your records.',
            'If this does not match your expected payment state, let us know immediately.'
        ],
        actionItems: [
            'Check latest order and payment status in your account.',
            'Keep transaction references handy if you contact support.',
            'Reply to this email for direct billing assistance.'
        ],
        assurance,
        closing
    });

    const [emailResult, whatsappResult] = await Promise.allSettled([
        recipient.email
            ? runChannelWithDedupe({
                channel: 'email',
                workflow: 'payment_status',
                stage: safeStage,
                order,
                payment,
                disableDedupe,
                sendFn: () => deliverWorkflowEmail({
                    workflow: 'payment_status',
                    to: recipient.email,
                    subject: template.subject,
                    text: template.text,
                    html: template.html,
                    context: {
                        orderId: order?.id || null,
                        orderRef: order?.order_ref || order?.orderRef || null,
                        stage: safeStage
                    }
                })
            })
            : Promise.resolve(buildSkippedEmailResult('missing_email')),
        runChannelWithDedupe({
            channel: 'whatsapp',
            workflow: 'payment_status',
            stage: safeStage,
            order,
            payment,
            disableDedupe,
            sendFn: () => sendWhatsapp({
                stage: safeStage,
                customer: recipient,
                order,
                payment,
                type: 'payment',
                template: 'payment',
                mobile: recipient.mobile
            })
        })
    ]);
    return {
        email: emailResult.status === 'fulfilled'
            ? emailResult.value
            : toChannelFailure(emailResult.reason, 'email_send_failed'),
        whatsapp: whatsappResult.status === 'fulfilled'
            ? whatsappResult.value
            : toChannelFailure(whatsappResult.reason, 'whatsapp_send_failed')
    };
};

const sendAbandonedCartRecoveryCommunication = async ({ customer = {}, cart = {} }) => {
    const recipient = normalizeCustomer(customer);
    const itemCount = Number(cart?.itemCount || cart?.items?.length || 0);
    const seed = `${recipient.email || recipient.mobile || recipient.name}|${itemCount}`;

    const subject = pickVariant(Array.from({ length: 10 }, (_, i) => `Your saved cart is waiting (${itemCount} item${itemCount === 1 ? '' : 's'}) (${i + 1}/10)`), `${seed}|subject`);
    const greeting = pickVariant(COMMON_GREETINGS, `${seed}|greeting`).replaceAll('{name}', recipient.name);
    const closing = pickVariant(COMMON_CLOSINGS, `${seed}|closing`);
    const assurance = pickVariant([
        'Our team can help with product, pricing, or checkout questions.',
        'Need help finalizing your cart? Reply and we will assist.',
        'Your saved items are available for a limited recovery window.',
        'Support is available for any payment or delivery concern.',
        'We can help compare alternatives before checkout if needed.',
        'Reply to this email for immediate assistance.',
        'Your shopping convenience is important to us.',
        'We are here to help you complete checkout confidently.',
        'Our administration team can assist if you face any issue.',
        'Thank you for considering SSC Jewellery for your purchase.'
    ], `${seed}|assurance`);

    const template = buildRichMail({
        greeting,
        subject,
        bodyBlocks: [
            `You currently have <strong>${itemCount}</strong> item(s) waiting in your cart.`,
            'We preserved your selections so you can complete checkout quickly.',
            'Completing soon helps avoid inventory or pricing changes on popular items.'
        ],
        actionItems: [
            'Open your cart and review saved items.',
            'Proceed to checkout when ready.',
            'Reply for product or payment support.'
        ],
        assurance,
        closing
    });

    const whatsappResult = await sendWhatsapp({
        customer: recipient,
        cart,
        type: 'abandoned_cart_recovery',
        template: 'abandoned_cart_recovery',
        mobile: recipient.mobile
    }).catch((error) => toChannelFailure(error, 'whatsapp_send_failed'));
    const emailResult = recipient.email
        ? await deliverWorkflowEmailWithPolicy({
            workflow: 'abandoned_cart_recovery',
            recipientMobile: recipient.mobile,
            whatsappResult,
            to: recipient.email,
            subject: template.subject,
            text: template.text,
            html: template.html,
            context: {
                itemCount
            }
        }).catch((error) => toChannelFailure(error, 'email_send_failed'))
        : buildSkippedEmailResult('missing_email');
    return {
        email: emailResult,
        whatsapp: whatsappResult
    };
};

module.exports = {
    verifyEmailTransport,
    sendEmailCommunication,
    deliverWorkflowEmail,
    deliverWorkflowEmailWithPolicy,
    sendOrderLifecycleCommunication,
    sendPaymentLifecycleCommunication,
    sendAbandonedCartRecoveryCommunication,
    sendWhatsapp
};
module.exports.__test = {
    resolveOrderTaxPriceMode,
    buildOrderLifecycleTemplate,
    classifyWorkflowEmailPolicy,
    getEmailQuotaState
};
