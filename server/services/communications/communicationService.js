const { sendEmail, verifyEmailTransport } = require('./channels/emailChannel');
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
        return await sendEmail({ to, subject, text, html, replyTo, cc, bcc, attachments });
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
    const resolvedItems = items
        .map((item) => {
            const snapshot = parseSnapshotSafe(item?.item_snapshot) || {};
            const quantity = Math.max(0, Number(snapshot?.quantity ?? item?.quantity ?? 0));
            const title = String(snapshot?.title || item?.title || 'Item').trim() || 'Item';
            const variantTitle = String(snapshot?.variantTitle || item?.variant_title || item?.variantTitle || '').trim();
            const paidUnit = Number(item?.price ?? snapshot?.unitPrice ?? 0);
            const mrpUnit = Number(item?.original_price ?? snapshot?.originalPrice ?? paidUnit);
            const lineTotal = Number(snapshot?.lineTotal ?? item?.line_total ?? ((paidUnit * quantity) || 0));
            const taxAmount = Number(item?.tax_amount ?? snapshot?.taxAmount ?? 0);
            const taxRatePercent = Number(item?.tax_rate_percent ?? snapshot?.taxRatePercent ?? 0);
            return {
                quantity,
                title,
                variantTitle,
                paidUnit,
                mrpUnit,
                lineTotal,
                taxAmount,
                taxRatePercent,
                productDiscount: Math.max(0, (mrpUnit - paidUnit) * quantity)
            };
        })
        .filter((item) => item.quantity > 0);
    if (!resolvedItems.length) return '';
    const couponDiscount = Number(order?.coupon_discount_value || 0);
    const loyaltyDiscount = Number(order?.loyalty_discount_total || 0);
    const loyaltyShippingDiscount = Number(order?.loyalty_shipping_discount_total || 0);
    const totalDiscount = Number(order?.discount_total || (couponDiscount + loyaltyDiscount + loyaltyShippingDiscount));
    const subtotal = Number(order?.subtotal || 0);
    const shippingFee = Number(order?.shipping_fee || 0);
    const taxTotal = Number(order?.tax_total || 0);
    const basePriceBeforeDiscounts = Math.max(0, subtotal + shippingFee);
    const taxableValueAfterDiscounts = Math.max(0, basePriceBeforeDiscounts - couponDiscount - loyaltyDiscount - loyaltyShippingDiscount);
    const couponCode = String(order?.coupon_code || '').trim().toUpperCase();
    const lineDenominator = subtotal > 0
        ? subtotal
        : Math.max(1, resolvedItems.reduce((sum, item) => sum + Math.max(0, Number(item.lineTotal || 0)), 0));
    let couponAllocated = 0;
    let memberAllocated = 0;
    const allocatedItems = resolvedItems.map((item, index) => {
        const ratio = lineDenominator > 0 ? (Math.max(0, item.lineTotal) / lineDenominator) : 0;
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
            lineTotalInclTax: Math.max(0, item.lineTotal - couponShare - memberShare) + Math.max(0, item.taxAmount)
        };
    });
    const shippingTaxAmount = Math.max(0, roundCurrency(taxTotal - allocatedItems.reduce((sum, item) => sum + Math.max(0, Number(item.taxAmount || 0)), 0)));
    const shippingRow = (shippingFee > 0 || loyaltyShippingDiscount > 0 || shippingTaxAmount > 0)
        ? {
            quantity: 1,
            title: 'Shipping',
            variantTitle: 'Delivery charge',
            mrpUnit: shippingFee,
            lineTotal: Math.max(0, shippingFee - loyaltyShippingDiscount),
            taxAmount: shippingTaxAmount,
            taxRatePercent: 0,
            productDiscount: 0,
            couponShare: 0,
            memberShare: 0,
            shippingBenefitShare: loyaltyShippingDiscount,
            lineTotalInclTax: Math.max(0, shippingFee - loyaltyShippingDiscount) + shippingTaxAmount
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
        `Taxable Value After Discounts: <strong>${formatCurrency(taxableValueAfterDiscounts)}</strong>`,
        taxTotal > 0 ? `GST: <strong>${formatCurrency(taxTotal)}</strong> (${formatSplitTaxLabel(taxTotal)})` : null
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
                    <th style="padding:10px 8px;font-size:11px;color:#4b5563;text-align:right;">Unit Price (MRP)</th>
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
    const stageKey = (safeStage === 'confirmed' || safeStage === 'confirmation')
        ? (Number(order?.discount_total || 0) > 0 ? 'confirmation_discount' : 'confirmation_no_discount')
        : safeStage;
    const seed = `${stageKey}|${orderRef}|${recipient.email || recipient.mobile || recipient.name}`;

    const subjects = {
        confirmation_discount: Array.from({ length: 10 }, (_, i) => `Order Confirmed: ${orderRef} | Savings Applied (${i + 1}/10)`),
        confirmation_no_discount: Array.from({ length: 10 }, (_, i) => `Order Confirmed: ${orderRef} (${i + 1}/10)`),
        pending_delay: Array.from({ length: 10 }, (_, i) => `Delay update for order ${orderRef} (${i + 1}/10)`),
        pending: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} is pending (${i + 1}/10)`),
        processing: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} is processing (${i + 1}/10)`),
        shipped: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} has shipped (${i + 1}/10)`),
        shipped_followup: Array.from({ length: 10 }, (_, i) => `A quick delivery check for order ${orderRef} (${i + 1}/10)`),
        completed: Array.from({ length: 10 }, (_, i) => `Thank you for choosing SSC Jewellery (${orderRef}) (${i + 1}/10)`),
        delivered: Array.from({ length: 10 }, (_, i) => `Order ${orderRef} delivered (${i + 1}/10)`),
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
        pending_delay: `Your order <strong>${orderRef}</strong> is delayed. Our team has escalated this and is prioritizing fulfillment.`,
        pending: `Your order <strong>${orderRef}</strong> is currently pending and queued for processing.`,
        processing: `Your order <strong>${orderRef}</strong> is now under active processing by our fulfillment team.`,
        shipped: `Your order <strong>${orderRef}</strong> has been dispatched and is in transit.`,
        shipped_followup: `Your order <strong>${orderRef}</strong> is marked as shipped. We hope it has reached you safely.`,
        completed: `Thank you for shopping with us. We are grateful for your trust in SSC Jewellery.`,
        delivered: `Your order <strong>${orderRef}</strong> has been delivered successfully.`,
        invoice: `Please find the invoice for your order <strong>${orderRef}</strong>${createdDate ? ` placed on <strong>${createdDate}</strong>` : ''}.`,
        cancelled: `Your order <strong>${orderRef}</strong> has been cancelled in our system.`,
        failed: `Your order <strong>${orderRef}</strong> requires your attention before we can proceed.`
    };

    const actionItemsByStage = {
        confirmation_discount: ['Review your order details in your account.', 'Keep this email for future reference.', 'Reply to this email if any correction is needed.'],
        confirmation_no_discount: ['Review your order details in your account.', 'Keep this email for future reference.', 'Reply to this email if any correction is needed.'],
        pending_delay: ['No action is needed right now.', 'Reply if the delivery is time-sensitive.', 'Our administration team will send the next update shortly.'],
        pending: ['No action is needed from your side.', 'Keep your contact details reachable.', 'Reply if you need to update shipping details.'],
        processing: ['No action is required at this stage.', 'We will notify you at dispatch.', 'Contact us if you need urgent delivery advice.'],
        shipped: ['Track your order from your account page.', 'Keep delivery phone accessible.', 'Reply for support if tracking appears delayed.'],
        shipped_followup: ['Please confirm receipt using the link shared below.', 'Reply if you need any assistance from our support team.', 'We will update the order status as soon as you confirm receipt.'],
        completed: ['Enjoy your purchase and keep this email for your records.', 'Reply if you need support with product or service.', 'We would love to serve you again soon.'],
        delivered: ['Please verify package contents after delivery.', 'Reach us immediately if there is any issue.', 'Share your experience with our team.'],
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

    const courierPartner = String(order?.courier_partner || '').trim();
    const awbNumber = String(order?.awb_number || '').trim();
    const deliveryConfirmationUrl = String(order?.delivery_confirmation_url || '').trim();
    const shipmentInfoLine = (stageKey === 'shipped' || stageKey === 'shipped_followup')
        ? [
            courierPartner ? `Courier partner: <strong>${courierPartner}</strong>` : null,
            awbNumber ? `AWB number: <strong>${awbNumber}</strong>` : null
        ].filter(Boolean).join(' | ')
        : '';
    const deliveryConfirmLine = stageKey === 'shipped_followup' && deliveryConfirmationUrl
        ? `Please confirm once you receive your parcel: <a href="${deliveryConfirmationUrl}" target="_blank" rel="noreferrer">${deliveryConfirmationUrl}</a>`
        : '';

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
        shipmentInfoLine || null,
        refundDetailLine || null,
        emiCancellationWarning || null,
        deliveryConfirmLine || null,
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
    invoiceShareUrl = null
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
            ? sendEmailCommunication({
                to: recipient.email,
                subject: template.subject,
                text: template.text,
                html: template.html,
                attachments: invoiceAttachment ? [invoiceAttachment] : []
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
        allowWhatsapp
            ? sendWhatsapp({
                stage: safeStage,
                customer: recipient,
                order,
                type: 'order',
                template: 'order',
                mobile: recipient.mobile,
                fileUrl: invoiceFileUrl || '',
                pdfName: includeInvoice ? invoiceFileName : ''
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

const sendPaymentLifecycleCommunication = async ({ stage, customer = {}, order = {}, payment = {} }) => {
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
            ? sendEmailCommunication({ to: recipient.email, subject: template.subject, text: template.text, html: template.html })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
        sendWhatsapp({
            stage: safeStage,
            customer: recipient,
            order,
            payment,
            type: 'payment',
            template: 'payment',
            mobile: recipient.mobile
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

    const [emailResult, whatsappResult] = await Promise.allSettled([
        recipient.email
            ? sendEmailCommunication({ to: recipient.email, subject: template.subject, text: template.text, html: template.html })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
        sendWhatsapp({
            customer: recipient,
            cart,
            type: 'abandoned_cart_recovery',
            template: 'abandoned_cart_recovery',
            mobile: recipient.mobile
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

module.exports = {
    verifyEmailTransport,
    sendEmailCommunication,
    sendOrderLifecycleCommunication,
    sendPaymentLifecycleCommunication,
    sendAbandonedCartRecoveryCommunication,
    sendWhatsapp
};
