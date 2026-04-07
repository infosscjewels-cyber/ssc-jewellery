const Cart = require('../models/Cart');
const User = require('../models/User');
const Order = require('../models/Order');
const AbandonedCart = require('../models/AbandonedCart');
const CompanyProfile = require('../models/CompanyProfile');
const {
    deliverWorkflowEmailWithPolicy,
    sendWhatsapp
} = require('./communications/communicationService');
const { createStandardPaymentLink } = require('./razorpayPaymentLinkService');
const { getUserLoyaltyStatus, getLoyaltyProfileByTier } = require('./loyaltyService');

const RECOVERY_JOB_INTERVAL_MS = Math.max(
    30 * 1000,
    Number(process.env.ABANDONED_CART_JOB_INTERVAL_MS || 60 * 1000)
);
const MAX_RECOVERY_BATCHES_PER_RUN = 100;
let knownPublicOrigin = '';
let storefrontStateCache = { open: true, ts: 0 };
const buildJourneyProcessingToken = (journeyId) => [
    'acr',
    String(process.pid || '0'),
    String(journeyId || '0'),
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 8)
].join('_').slice(0, 64);

const isStorefrontOpen = async () => {
    const now = Date.now();
    if (now - storefrontStateCache.ts < 60 * 1000) {
        return storefrontStateCache.open;
    }
    const company = await CompanyProfile.get().catch(() => null);
    storefrontStateCache = {
        open: company?.storefrontOpen !== false,
        ts: now
    };
    return storefrontStateCache.open;
};

const toSubunit = (amount) => Math.round(Number(amount || 0) * 100);
const MIN_PAYMENT_LINK_TTL_MS = 10 * 60 * 1000;
const resolveJourneyBaseDate = (journey) => {
    const last = journey?.last_activity_at ? new Date(journey.last_activity_at) : null;
    const updated = journey?.updated_at ? new Date(journey.updated_at) : null;
    const candidates = [last, updated].filter((d) => d && !Number.isNaN(d.getTime()));
    if (!candidates.length) return new Date();
    return candidates.sort((a, b) => b.getTime() - a.getTime())[0];
};
const formatExpiryIST = (value) => {
    if (!value) return null;
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    try {
        return new Intl.DateTimeFormat('en-IN', {
            timeZone: 'Asia/Kolkata',
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        }).format(date) + ' IST';
    } catch {
        return date.toISOString();
    }
};

const parseAddressObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const normalizeAddressForShipping = (value) => {
    const address = parseAddressObject(value);
    if (!address || typeof address !== 'object') return null;
    const line1 = String(address.line1 || address.addressLine1 || address.street || '').trim();
    const city = String(address.city || address.town || '').trim();
    const state = String(address.state || address.region || '').trim();
    const zip = String(address.zip || address.postalCode || address.pincode || '').trim();
    return { ...address, line1, city, state, zip };
};

const summarizeCart = (items = []) => {
    let itemCount = 0;
    let totalSubunits = 0;
    for (const item of items) {
        const qty = Math.max(0, Number(item?.quantity || 0));
        const unit = Number(item?.price || 0);
        itemCount += qty;
        totalSubunits += toSubunit(unit * qty);
    }
    return { itemCount, totalSubunits };
};

const formatCurrency = (subunits = 0, currency = 'INR') => {
    const value = Number(subunits || 0) / 100;
    try {
        return new Intl.NumberFormat('en-IN', {
            style: 'currency',
            currency: String(currency || 'INR').toUpperCase()
        }).format(value);
    } catch {
        return `₹${value.toFixed(2)}`;
    }
};

const resolveAutoPublicOrigins = () => {
    const nodeEnv = String(process.env.NODE_ENV || 'development').toLowerCase();
    const port = Number(process.env.PORT || 5000);
    if (nodeEnv !== 'production') {
        return {
            apiBase: `http://localhost:${port}`,
            clientBase: 'http://localhost:5173'
        };
    }

    const explicitHost = String(
        process.env.PUBLIC_BASE_URL
        || process.env.APP_URL
        || process.env.URL
        || process.env.RENDER_EXTERNAL_URL
        || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
        || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
        || ''
    ).trim().replace(/\/+$/, '');
    const runtimeHost = String(knownPublicOrigin || '').trim().replace(/\/+$/, '');
    const base = explicitHost || runtimeHost;
    return {
        apiBase: base || '',
        clientBase: base || ''
    };
};

const setKnownPublicOrigin = (origin = '') => {
    const value = String(origin || '').trim().replace(/\/+$/, '');
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) return;
    knownPublicOrigin = value;
};

const setKnownPublicOriginFromRequest = (req) => {
    if (!req) return;
    const hostHeader = String(
        req.headers?.['x-forwarded-host']
        || req.headers?.host
        || ''
    ).trim();
    if (!hostHeader) return;
    const protoHeader = String(
        req.headers?.['x-forwarded-proto']
        || req.protocol
        || 'https'
    ).split(',')[0].trim().toLowerCase();
    const protocol = protoHeader === 'http' ? 'http' : 'https';
    setKnownPublicOrigin(`${protocol}://${hostHeader}`);
};

const toAbsoluteMediaUrl = (rawUrl) => {
    const input = String(rawUrl || '').trim();
    if (!input) return '';
    if (/^https?:\/\//i.test(input)) return input;
    const { apiBase } = resolveAutoPublicOrigins();
    const base = String(apiBase || '').trim().replace(/\/+$/, '');
    if (!base) return input;
    return `${base}/${input.replace(/^\/+/, '')}`;
};

const buildDiscountSummary = ({ percent = 0, cartTotalSubunits = 0, maxDiscountPercent = 25 }) => {
    const boundedPercent = Math.max(0, Math.min(Number(percent || 0), Number(maxDiscountPercent || 25)));
    const discountSubunits = Math.round(Number(cartTotalSubunits || 0) * boundedPercent / 100);
    return {
        percent: boundedPercent,
        discountSubunits
    };
};

const buildRecoverySubject = ({ attemptNo = 1, discountPercent = 0 } = {}) => {
    const idx = Math.max(0, Number(attemptNo || 1) - 1);
    if (Number(discountPercent || 0) > 0) {
        const discountSubjects = [
            `A little treat for you: ${discountPercent}% OFF on your saved cart`,
            `Your favourites now come with ${discountPercent}% OFF`,
            `Good news: unlock ${discountPercent}% OFF before your cart expires`,
            `Your saved picks now have ${discountPercent}% OFF waiting`,
            `Before it is gone: enjoy ${discountPercent}% OFF on your cart`,
            `Final reminder: claim ${discountPercent}% OFF on your cart`,
            `Special cart recovery: ${discountPercent}% OFF is active`,
            `Your curated picks with ${discountPercent}% OFF are ready`,
            `Checkout incentive: ${discountPercent}% OFF available now`,
            `Do not miss ${discountPercent}% OFF on your saved cart`,
            `Recovery offer unlocked: ${discountPercent}% OFF`,
            `Secure your selection with ${discountPercent}% OFF today`
        ];
        return discountSubjects[Math.min(idx, discountSubjects.length - 1)];
    }
    const regularSubjects = [
        'You left something beautiful behind',
        'Your favourites are still waiting for you',
        'Still thinking it over? Your cart is ready',
        'Your saved picks are waiting for checkout',
        'A quick reminder: your cart is still live',
        'Last chance to complete your saved cart',
        'We saved your cart so checkout is easy',
        'Your selected items are still available',
        'Your cart is waiting for a final step',
        'Continue your order in one click',
        'Your SSC Jewellery cart is preserved',
        'Friendly reminder: your cart is active'
    ];
    return regularSubjects[Math.min(idx, regularSubjects.length - 1)];
};

const buildRecoveryEmail = ({
    user,
    journey,
    attemptNo,
    discountCode = null,
    discountPercent = 0,
    paymentLinkUrl = null,
    checkoutUrl = null,
    shippingFeeSubunits = null,
    totalWithShippingSubunits = null,
    linkExpiry = null
}) => {
    const items = Array.isArray(journey?.cart_snapshot_json) ? journey.cart_snapshot_json : [];
    const itemCards = items.slice(0, 4).map((item) => {
        const qty = Number(item?.quantity || 0);
        const title = item?.title || 'Item';
        const image = toAbsoluteMediaUrl(item?.imageUrl || item?.image_url || '');
        const price = Number(item?.price || 0);
        return `
            <tr>
                <td style="padding:10px 0;border-bottom:1px solid #eceff4;">
                    <table role="presentation" cellpadding="0" cellspacing="0" width="100%">
                        <tr>
                            <td width="64" valign="top">
                                ${image ? `<img src="${image}" alt="${title}" width="56" height="56" style="display:block;border-radius:8px;object-fit:cover;border:1px solid #e5e7eb;" />` : `<div style="width:56px;height:56px;border-radius:8px;background:#f3f4f6;border:1px solid #e5e7eb;"></div>`}
                            </td>
                            <td valign="top" style="padding-left:10px;">
                                <div style="font-size:14px;font-weight:600;color:#111827;line-height:1.35;">${title}</div>
                                <div style="font-size:12px;color:#6b7280;margin-top:3px;">Qty: ${qty} • ₹${price.toLocaleString()}</div>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        `;
    }).join('');
    const orderValue = formatCurrency(journey?.cart_total_subunits || 0, journey?.currency || 'INR');
    const shippingValue = shippingFeeSubunits != null
        ? formatCurrency(shippingFeeSubunits, journey?.currency || 'INR')
        : null;
    const totalValue = totalWithShippingSubunits != null
        ? formatCurrency(totalWithShippingSubunits, journey?.currency || 'INR')
        : null;
    const discountText = discountCode && discountPercent > 0
        ? `Use code <strong>${discountCode}</strong> for <strong>${discountPercent}% OFF</strong>.`
        : 'Complete your purchase before items go out of stock.';
    const { clientBase } = resolveAutoPublicOrigins();
    const fallbackRestoreUrl = `${clientBase || ''}/cart`;
    const ctaUrl = paymentLinkUrl || checkoutUrl || fallbackRestoreUrl;
    const exploreUrl = `${clientBase || ''}/shop`;
    const ctaLabel = paymentLinkUrl
        ? 'Pay Now'
        : (discountCode && discountPercent > 0 ? 'Apply Coupon & Checkout' : 'Restore Cart');
    const introVariants = [
        `Hi ${user?.name || 'there'}, we saved your cart so you can continue in seconds.`,
        `Hi ${user?.name || 'there'}, your shortlisted picks are still reserved in your cart.`,
        `Hi ${user?.name || 'there'}, this is a reminder that your cart is ready for checkout.`,
        `Hi ${user?.name || 'there'}, your selected products are waiting for confirmation.`,
        `Hi ${user?.name || 'there'}, we kept your cart intact for a smooth checkout experience.`,
        `Hi ${user?.name || 'there'}, your favourites are still available in your saved cart.`,
        `Hi ${user?.name || 'there'}, checkout is one click away with your saved selections.`,
        `Hi ${user?.name || 'there'}, your pending cart is still active and recoverable.`,
        `Hi ${user?.name || 'there'}, we thought you might like to complete your order today.`,
        `Hi ${user?.name || 'there'}, your cart recovery window is still open.`
    ];
    const actionVariants = [
        'Review your items, confirm details, and complete checkout.',
        'Use the primary button below to continue instantly.',
        'Proceed now to avoid inventory changes on high-demand pieces.',
        'Secure your chosen items before availability changes.',
        'Complete your order now for the quickest turnaround.',
        'Use the checkout button to finalize your purchase.',
        'Confirm your order details and complete payment today.',
        'Finish checkout while your selected products are still available.',
        'Use your saved cart and place the order in one flow.',
        'Continue checkout now and avoid reselecting products later.'
    ];
    const assuranceVariants = [
        'Need help? Reply to this email and our support team will assist you.',
        'Our administration team is available to help with checkout or payment issues.',
        'If you need product guidance, reply and we will help immediately.',
        'We can assist with delivery, payment, and coupon-related questions.',
        'For urgent support, reply to this email and mention your mobile number.',
        'Our support desk is ready to guide you through a successful checkout.',
        'You can rely on us for fast assistance at every checkout step.',
        'We are available for any clarification before you place the order.',
        'Our team will ensure a smooth and secure recovery checkout.',
        'Contact us anytime if you need help completing your order.'
    ];
    const variantIndex = Math.min(Math.max(0, Number(attemptNo || 1) - 1), 9);
    const introText = introVariants[variantIndex];
    const actionText = actionVariants[variantIndex];
    const assuranceText = assuranceVariants[variantIndex];

    const subject = buildRecoverySubject({ attemptNo, discountPercent });
    const signatureName = String(process.env.MAIL_FROM_NAME || 'SSC Jewellery').trim() || 'SSC Jewellery';
    const signatureEmail = String(process.env.MAIL_FROM_EMAIL || '').trim();
    const formattedExpiry = formatExpiryIST(linkExpiry);
    const expiryText = formattedExpiry ? `Pay before ${formattedExpiry}.` : '';
    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f7f7f8;padding:20px;color:#111827;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:14px;overflow:hidden;">
                <tr>
                    <td style="padding:22px 22px 8px;">
                        <div style="font-size:22px;font-weight:700;color:#111827;">Your cart is still waiting</div>
                        <div style="font-size:14px;color:#4b5563;margin-top:8px;">${introText}</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding:0 22px 8px;">
                        <div style="font-size:14px;color:#111827;">Cart value: <strong>${orderValue}</strong></div>
                        ${shippingValue ? `<div style="font-size:14px;color:#111827;margin-top:4px;">Shipping: <strong>${shippingValue}</strong></div>` : ''}
                        ${totalValue ? `<div style="font-size:14px;color:#111827;margin-top:4px;">Total to pay: <strong>${totalValue}</strong></div>` : ''}
                        ${expiryText ? `<div style="font-size:12px;color:#6b7280;margin-top:6px;">${expiryText}</div>` : ''}
                        <div style="font-size:14px;color:#111827;margin-top:4px;">${discountText}</div>
                        <div style="font-size:14px;color:#111827;margin-top:4px;">${actionText}</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding:6px 22px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            ${itemCards}
                        </table>
                    </td>
                </tr>
                <tr>
                    <td style="padding:14px 22px 8px;">
                        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                            <tr>
                                <td width="50%" style="padding-right:10px;">
                                    <a href="${ctaUrl}" target="_blank" rel="noreferrer" style="display:block;width:100%;box-sizing:border-box;text-align:center;background:#111827;color:#ffffff;text-decoration:none;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;">${ctaLabel}</a>
                                </td>
                                <td width="50%" style="padding-left:10px;">
                                    <a href="${exploreUrl}" target="_blank" rel="noreferrer" style="display:block;width:100%;box-sizing:border-box;text-align:center;background:#ffffff;color:#111827;text-decoration:none;padding:11px 14px;border-radius:10px;font-size:14px;font-weight:600;border:1px solid #d1d5db;">Explore</a>
                                </td>
                            </tr>
                        </table>
                    </td>
                </tr>
                <tr>
                    <td style="padding:8px 22px 20px;font-size:12px;color:#6b7280;">
                        ${assuranceText}
                        <br/><br/>
                        Regards,<br/>
                        <strong>${signatureName}</strong>
                        ${signatureEmail ? `<br/>${signatureEmail}` : ''}
                    </td>
                </tr>
            </table>
        </div>
    `;
    const text = [
        `Hi ${user?.name || 'there'},`,
        `Your cart (${orderValue}) is waiting.`,
        shippingValue ? `Shipping: ${shippingValue}` : null,
        totalValue ? `Total to pay: ${totalValue}` : null,
        expiryText || null,
        discountCode && discountPercent > 0 ? `Use code ${discountCode} for ${discountPercent}% OFF.` : 'Complete your purchase before items go out of stock.',
        actionText,
        assuranceText,
        `Continue here: ${ctaUrl}`
    ].filter(Boolean).join('\n');
    return { subject, html, text };
};

const CART_ACTIVITY_DEBOUNCE_MS = 3000;
const cartActivityState = new Map();

const runCartActivity = async (userId, reason, { onJourneyUpdate = null } = {}) => {
    if (!(await isStorefrontOpen())) {
        return { ok: true, skipped: true, reason: 'storefront_closed' };
    }
    const campaign = await AbandonedCart.getCampaign();
    if (!campaign.enabled) return { ok: true, skipped: true, reason: 'campaign_disabled' };

    const items = await Cart.getByUser(userId);
    const summary = summarizeCart(items);

    if (!summary.itemCount) {
        await AbandonedCart.deleteCandidate(userId);
        const activeJourney = await AbandonedCart.getActiveJourneyByUser(userId);
        if (activeJourney) {
            const recoveredOrderId = await AbandonedCart.hasRecoveredOrderSinceJourney({
                userId,
                journeyCreatedAt: activeJourney.created_at,
                journeyExpiresAt: activeJourney.expires_at || null
            });
            if (recoveredOrderId) {
                await AbandonedCart.markJourneyRecoveredById({
                    journeyId: activeJourney.id,
                    recoveredOrderId,
                    reason: 'order_paid'
                });
                if (typeof onJourneyUpdate === 'function') {
                    onJourneyUpdate({
                        event: 'recovered',
                        journeyId: activeJourney.id,
                        userId,
                        status: 'recovered',
                        reason: 'order_paid',
                        recoveredOrderId
                    });
                }
                return { ok: true, recovered: true, recoveredOrderId };
            }
        }
        await AbandonedCart.closeActiveJourneyByUser({
            userId,
            status: 'cancelled',
            reason: reason || 'cart_empty'
        });
        return { ok: true, skipped: true, reason: 'empty_cart' };
    }

    const activeJourney = await AbandonedCart.getActiveJourneyByUser(userId);
    if (activeJourney) {
        const touched = await AbandonedCart.touchJourney({
            userId,
            cartItemCount: summary.itemCount,
            cartTotalSubunits: summary.totalSubunits,
            currency: 'INR',
            campaign
        });
        await AbandonedCart.deleteCandidate(userId);
        return { ok: true, journeyId: touched.id };
    }

    await AbandonedCart.upsertCandidate({
        userId,
        cartItemCount: summary.itemCount,
        cartTotalSubunits: summary.totalSubunits,
        currency: 'INR'
    });
    return { ok: true, queued: true };
};

const trackCartActivity = async (userId, { reason = 'cart_update', onJourneyUpdate = null } = {}) => {
    if (!userId) return { ok: true, skipped: true, reason: 'missing_user' };
    const now = Date.now();
    const existing = cartActivityState.get(userId) || {};
    const lastRunAt = existing.lastRunAt || 0;
    const nextDelay = Math.max(0, CART_ACTIVITY_DEBOUNCE_MS - (now - lastRunAt));

    if (existing.timer) {
        existing.pendingReason = reason;
        cartActivityState.set(userId, existing);
        return { ok: true, queued: true, journeyId: existing.lastJourneyId || null };
    }

    if (nextDelay > 0) {
        const timer = setTimeout(async () => {
            const state = cartActivityState.get(userId) || {};
            const pendingReason = state.pendingReason || reason;
            try {
                const result = await runCartActivity(userId, pendingReason, { onJourneyUpdate });
                state.lastRunAt = Date.now();
                state.lastJourneyId = result?.journeyId || state.lastJourneyId || null;
            } catch (error) {
                console.error('Abandoned cart debounce run failed:', error?.message || error);
            } finally {
                state.timer = null;
                state.pendingReason = null;
                cartActivityState.set(userId, state);
            }
        }, nextDelay);
        cartActivityState.set(userId, {
            ...existing,
            timer,
            pendingReason: reason
        });
        return { ok: true, queued: true, journeyId: existing.lastJourneyId || null };
    }

    const result = await runCartActivity(userId, reason, { onJourneyUpdate });
    cartActivityState.set(userId, {
        timer: null,
        pendingReason: null,
        lastRunAt: Date.now(),
        lastJourneyId: result?.journeyId || null
    });
    return result;
};

const markRecoveredByOrder = async ({ order = null, userId = null, reason = 'order_paid' } = {}) => {
    const resolvedUserId = userId || order?.user_id;
    if (!resolvedUserId) return { ok: true, skipped: true, reason: 'missing_user' };
    let affected = 0;
    if (order?.abandoned_journey_id) {
        affected = await AbandonedCart.markJourneyRecoveredById({
            journeyId: order.abandoned_journey_id,
            recoveredOrderId: order?.id || null,
            reason
        });
    }
    if (!affected) {
        affected = await AbandonedCart.closeActiveJourneyByUser({
            userId: resolvedUserId,
            status: 'recovered',
            recoveredOrderId: order?.id || null,
            reason
        });
    }
    if (!affected) {
        const campaign = await AbandonedCart.getCampaign();
        affected = await AbandonedCart.markLatestJourneyRecoveredByUser({
            userId: resolvedUserId,
            recoveredOrderId: order?.id || null,
            reason,
            maxAgeHours: Number(campaign?.recoveryWindowHours || 72)
        });
    }
    return { ok: true, affected };
};

const processDueAbandonedCartRecoveries = async ({ limit = 25, onJourneyUpdate = null } = {}) => {
    if (!(await isStorefrontOpen())) {
        return { ok: true, skipped: true, reason: 'storefront_closed', due: 0, processed: 0, sent: 0, skippedCount: 0, failed: 0 };
    }
    const campaign = await AbandonedCart.getCampaign();
    if (!campaign.enabled) return { ok: true, skipped: true, reason: 'campaign_disabled' };

    const dueJourneys = await AbandonedCart.getDueJourneys({ limit });
    const stats = {
        due: dueJourneys.length,
        processed: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        recovered: 0,
        expired: 0,
        cancelled: 0,
        failedReasons: {}
    };

    for (const journey of dueJourneys) {
        const processingToken = buildJourneyProcessingToken(journey.id);
        const claimed = await AbandonedCart.claimDueJourney({
            journeyId: journey.id,
            token: processingToken,
            expectedNextAttemptAt: journey.next_attempt_at || null
        });
        if (!claimed) {
            continue;
        }
        stats.processed += 1;
        let workingJourney = { ...journey };
        let doneForJourney = false;
        let claimReleased = false;

        // Keep processing missed attempts until this journey is caught up or closed.
        while (!doneForJourney) {
            try {
                const recoveredOrderId = await AbandonedCart.hasRecoveredOrderSinceJourney({
                    userId: workingJourney.user_id,
                    journeyCreatedAt: workingJourney.created_at,
                    journeyExpiresAt: workingJourney.expires_at || null
                });
                if (recoveredOrderId) {
                    await AbandonedCart.closeActiveJourneyByUser({
                        userId: workingJourney.user_id,
                        status: 'recovered',
                        recoveredOrderId,
                        reason: 'order_already_paid'
                    });
                    if (typeof onJourneyUpdate === 'function') {
                        onJourneyUpdate({
                            event: 'recovered',
                            journeyId: workingJourney.id,
                            userId: workingJourney.user_id,
                            status: 'recovered',
                            reason: 'order_already_paid',
                            recoveredOrderId
                        });
                    }
                    stats.recovered += 1;
                    doneForJourney = true;
                    continue;
                }

                const latestCart = await Cart.getByUser(workingJourney.user_id);
                const latestSummary = summarizeCart(latestCart);
                if (!latestSummary.itemCount) {
                    await AbandonedCart.closeActiveJourneyByUser({
                        userId: workingJourney.user_id,
                        status: 'cancelled',
                        reason: 'cart_empty'
                    });
                    if (typeof onJourneyUpdate === 'function') {
                        onJourneyUpdate({
                            event: 'cancelled',
                            journeyId: workingJourney.id,
                            userId: workingJourney.user_id,
                            status: 'cancelled',
                            reason: 'cart_empty'
                        });
                    }
                    stats.cancelled += 1;
                    doneForJourney = true;
                    continue;
                }

                try {
                    await AbandonedCart.updateJourneySnapshot({
                        journeyId: workingJourney.id,
                        cartSnapshot: latestCart,
                        cartItemCount: latestSummary.itemCount,
                        cartTotalSubunits: latestSummary.totalSubunits,
                        currency: workingJourney.currency || 'INR'
                    });
                } catch {}

                const attemptNo = Number(workingJourney.last_attempt_no || 0) + 1;
                if (attemptNo > Number(campaign.maxAttempts || 4)) {
                    await AbandonedCart.markJourneyAttempted({
                        journeyId: workingJourney.id,
                        nextAttemptNo: workingJourney.last_attempt_no || 0,
                        nextAttemptAt: null,
                        markExpired: true
                    });
                    if (typeof onJourneyUpdate === 'function') {
                        onJourneyUpdate({
                            event: 'expired',
                            journeyId: workingJourney.id,
                            userId: workingJourney.user_id,
                            status: 'expired',
                            reason: 'max_attempts_reached',
                            nextAttemptAt: null,
                            lastAttemptNo: Number(workingJourney.last_attempt_no || 0)
                        });
                    }
                    stats.expired += 1;
                    doneForJourney = true;
                    continue;
                }

                const user = await User.findById(workingJourney.user_id);
                const userRole = String(user?.role || '').toLowerCase();
                if (!user || user.isActive === false || (userRole && userRole !== 'customer')) {
                    await AbandonedCart.closeActiveJourneyByUser({
                        userId: workingJourney.user_id,
                        status: 'cancelled',
                        reason: 'customer_inactive'
                    });
                    if (typeof onJourneyUpdate === 'function') {
                        onJourneyUpdate({
                            event: 'cancelled',
                            journeyId: workingJourney.id,
                            userId: workingJourney.user_id,
                            status: 'cancelled',
                            reason: 'customer_inactive'
                        });
                    }
                    stats.cancelled += 1;
                    doneForJourney = true;
                    continue;
                }

                const discountPercent = AbandonedCart.resolveDiscountPercent(campaign, attemptNo);
                const loyaltyStatus = await getUserLoyaltyStatus(workingJourney.user_id).catch(() => ({ tier: 'regular' }));
                const loyaltyProfile = getLoyaltyProfileByTier(loyaltyStatus?.tier || 'regular');
                const loyaltyBoostPercent = Math.max(0, Number(loyaltyProfile?.abandonedCartBoostPct || 0));
                const minDiscountCartSubunits = Math.max(0, Number(campaign?.minDiscountCartSubunits || 0));
                const eligibleDiscountPercent = Number(latestSummary.totalSubunits || 0) >= minDiscountCartSubunits
                    ? (discountPercent + loyaltyBoostPercent)
                    : 0;
                const discount = buildDiscountSummary({
                    percent: eligibleDiscountPercent,
                    cartTotalSubunits: latestSummary.totalSubunits,
                    maxDiscountPercent: campaign.maxDiscountPercent
                });
                const shippingAddress = normalizeAddressForShipping(user?.address)
                    || normalizeAddressForShipping(user?.billingAddress)
                    || null;
                const totalWeightKg = latestCart.reduce((sum, item) => (
                    sum + (Number(item?.weightKg || 0) * Number(item?.quantity || 0))
                ), 0);
                const shippingFee = await Order.computeShippingFeeForSummary({
                    shippingAddress,
                    subtotal: Number(latestSummary.totalSubunits || 0) / 100,
                    totalWeightKg
                });
                const shippingFeeSubunits = toSubunit(shippingFee);

                let discountCode = null;
                if (discount.percent > 0) {
                    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
                    const created = await AbandonedCart.createDiscount({
                        journeyId: workingJourney.id,
                        attemptNo,
                        userId: workingJourney.user_id,
                        percent: discount.percent,
                        minCartSubunits: latestSummary.totalSubunits,
                        expiresAt
                    });
                    discountCode = created.code;
                }

                const nextAttemptNo = attemptNo + 1;
                const hasNext = nextAttemptNo <= Number(campaign.maxAttempts || 4);
                const scheduleBaseDate = resolveJourneyBaseDate(workingJourney);
                const nextAttemptAt = hasNext
                    ? AbandonedCart.computeAttemptAtFromLastActivity({ lastActivityAt: scheduleBaseDate, campaign, attemptNo: nextAttemptNo })
                    : null;
                const journeyExpiry = workingJourney.expires_at ? new Date(workingJourney.expires_at) : null;
                let paymentExpiry = nextAttemptAt ? new Date(nextAttemptAt) : null;
                if (journeyExpiry && (!paymentExpiry || journeyExpiry.getTime() < paymentExpiry.getTime())) {
                    paymentExpiry = journeyExpiry;
                }
                if (!paymentExpiry) {
                    paymentExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
                }
                if (paymentExpiry.getTime() <= Date.now() + 30 * 1000) {
                    paymentExpiry = new Date(Date.now() + MIN_PAYMENT_LINK_TTL_MS);
                }

                const hasDiscountCoupon = Boolean(discountCode && discount.percent > 0);
                const hasAddressOnProfile = Boolean(
                    shippingAddress
                    && String(shippingAddress?.line1 || '').trim()
                    && String(shippingAddress?.city || '').trim()
                    && String(shippingAddress?.state || '').trim()
                    && String(shippingAddress?.zip || '').trim()
                );
                const hasMobileOnProfile = Boolean(String(user?.mobile || '').trim());
                const { clientBase } = resolveAutoPublicOrigins();
                const callbackBase = String(clientBase || '').replace(/\/+$/, '');
                const shouldRouteToCheckout = Boolean(hasDiscountCoupon || !hasAddressOnProfile || !hasMobileOnProfile);
                const checkoutUrl = callbackBase && shouldRouteToCheckout
                    ? `${callbackBase}/checkout${hasDiscountCoupon ? `?coupon=${encodeURIComponent(discountCode)}` : ''}`
                    : null;

                const shouldUsePaymentLink = Boolean(campaign.sendPaymentLink && !shouldRouteToCheckout);
                let paymentLink = null;
                if (shouldUsePaymentLink) {
                    try {
                        const reference = `ACR_${workingJourney.id}_${attemptNo}_${Date.now().toString(36)}`.slice(0, 40);
                        const recoveryOrderRef = `SSC-REC-${workingJourney.id}-${attemptNo}-${Date.now().toString(36)}`
                            .replace(/[^a-zA-Z0-9-]/g, '')
                            .slice(0, 32)
                            .toUpperCase();
                        const callbackUrl = callbackBase ? `${callbackBase}/payment/success` : null;
                        paymentLink = await createStandardPaymentLink({
                            amountSubunits: Number(latestSummary.totalSubunits || 0) + Number(shippingFeeSubunits || 0),
                            currency: workingJourney.currency || 'INR',
                            description: `Order ${recoveryOrderRef}`,
                            referenceId: reference,
                            customer: {
                                name: user?.name || undefined,
                                email: user?.email || undefined,
                                contact: user?.mobile || undefined
                            },
                            expireBy: paymentExpiry,
                            callbackUrl: callbackUrl || null,
                            reminderEnable: campaign.reminderEnable,
                            notes: {
                                journeyId: String(workingJourney.id),
                                attemptNo: String(attemptNo),
                                userId: String(workingJourney.user_id).slice(0, 50),
                                orderRef: recoveryOrderRef,
                                shippingFeeSubunits: String(shippingFeeSubunits || 0)
                            }
                        });
                        if (paymentLink) {
                            paymentLink.recoveryOrderRef = recoveryOrderRef;
                        }
                    } catch {}
                }

                const channels = [];
                const payload = {
                    journeyId: workingJourney.id,
                    attemptNo,
                    cartValueSubunits: latestSummary.totalSubunits,
                    shippingFeeSubunits,
                    totalWithShippingSubunits: Number(latestSummary.totalSubunits || 0) + Number(shippingFeeSubunits || 0),
                    discountCode,
                    discountPercent: discount.percent,
                    paymentLinkUrl: paymentLink?.shortUrl || null,
                    checkoutUrl,
                    orderRef: paymentLink?.recoveryOrderRef || null
                };
                const responses = {};
                let hardFailureMessage = null;

                if (campaign.sendWhatsapp) {
                    try {
                        responses.whatsapp = await sendWhatsapp({
                            type: 'abandoned_cart_recovery',
                            userId: workingJourney.user_id,
                            attemptNo,
                            discountCode,
                            discountPercent: discount.percent,
                            linkExpiry: paymentExpiry ? paymentExpiry.toISOString() : null,
                            cartValueSubunits: latestSummary.totalSubunits,
                            currency: workingJourney.currency || 'INR',
                            paymentLink: paymentLink?.shortUrl || null,
                            checkoutLink: checkoutUrl
                        });
                        channels.push('whatsapp');
                    } catch (whatsappError) {
                        hardFailureMessage = hardFailureMessage || whatsappError?.message || 'WhatsApp send failed';
                        responses.whatsapp = {
                            ok: false,
                            skipped: false,
                            reason: 'whatsapp_send_failed',
                            message: whatsappError?.message || 'WhatsApp send failed'
                        };
                    }
                } else {
                    responses.whatsapp = { ok: false, skipped: true, reason: 'whatsapp_disabled' };
                }

                if (campaign.sendEmail && user?.email) {
                    try {
                        const mail = buildRecoveryEmail({
                            user,
                            journey: { ...workingJourney, cart_snapshot_json: latestCart, cart_total_subunits: latestSummary.totalSubunits },
                            attemptNo,
                            discountCode,
                            discountPercent: discount.percent,
                            paymentLinkUrl: paymentLink?.shortUrl || null,
                            checkoutUrl,
                            shippingFeeSubunits,
                            totalWithShippingSubunits: Number(latestSummary.totalSubunits || 0) + Number(shippingFeeSubunits || 0),
                            linkExpiry: paymentExpiry ? paymentExpiry.toISOString() : null
                        });
                        responses.email = await deliverWorkflowEmailWithPolicy({
                            workflow: 'abandoned_cart_recovery',
                            recipientMobile: user?.mobile || '',
                            whatsappResult: responses.whatsapp,
                            to: user.email,
                            subject: mail.subject,
                            text: mail.text,
                            html: mail.html,
                            context: {
                                userId: workingJourney.user_id,
                                journeyId: workingJourney.id,
                                attemptNo
                            }
                        });
                        if (responses.email?.ok) {
                            channels.push('email');
                        }
                    } catch (emailError) {
                        hardFailureMessage = emailError?.message || 'Email send failed';
                        responses.email = {
                            ok: false,
                            skipped: false,
                            reason: 'email_send_failed',
                            message: hardFailureMessage
                        };
                    }
                } else {
                    responses.email = { ok: false, skipped: true, reason: 'email_disabled_or_missing' };
                }

                // If all enabled channels failed, mark this attempt as failed.
                if (!channels.length && hardFailureMessage) {
                    throw new Error(hardFailureMessage);
                }

                await AbandonedCart.addAttempt({
                    journeyId: workingJourney.id,
                    attemptNo,
                    status: channels.length ? 'sent' : 'skipped',
                    channels,
                    discountCode,
                    discountPercent: discount.percent,
                    paymentLinkId: paymentLink?.id || null,
                    paymentLinkUrl: paymentLink?.shortUrl || null,
                    payload,
                    response: responses
                });

                await AbandonedCart.markJourneyAttempted({
                    journeyId: workingJourney.id,
                    nextAttemptNo: attemptNo,
                    nextAttemptAt,
                    markExpired: !hasNext
                });
                claimReleased = true;
                if (typeof onJourneyUpdate === 'function') {
                    onJourneyUpdate({
                        event: 'attempt_processed',
                        journeyId: workingJourney.id,
                        userId: workingJourney.user_id,
                        status: hasNext ? 'active' : 'expired',
                        nextAttemptAt: nextAttemptAt ? new Date(nextAttemptAt).toISOString() : null,
                        lastAttemptNo: attemptNo
                    });
                }
                if (channels.length) {
                    stats.sent += 1;
                } else {
                    stats.skipped += 1;
                }

                workingJourney = {
                    ...workingJourney,
                    last_attempt_no: attemptNo,
                    next_attempt_at: nextAttemptAt ? new Date(nextAttemptAt).toISOString() : null
                };

                const stillMissed = Boolean(hasNext && nextAttemptAt && new Date(nextAttemptAt).getTime() <= Date.now());
                doneForJourney = !stillMissed;
            } catch (error) {
                stats.failed += 1;
                const failureReason = String(error?.message || 'Recovery processing failed').slice(0, 200);
                stats.failedReasons[failureReason] = Number(stats.failedReasons[failureReason] || 0) + 1;
                try {
                    const attemptNo = Number(workingJourney.last_attempt_no || 0) + 1;
                    await AbandonedCart.addAttempt({
                        journeyId: workingJourney.id,
                        attemptNo,
                        status: 'failed',
                        channels: [],
                        errorMessage: error?.message || 'Recovery processing failed'
                    });
                    const nextAttemptNo = attemptNo + 1;
                    const hasNext = nextAttemptNo <= Number(campaign.maxAttempts || 4);
                    const failedScheduleBaseDate = resolveJourneyBaseDate(workingJourney);
                    const failedNextAttemptAt = hasNext
                        ? AbandonedCart.computeAttemptAtFromLastActivity({ lastActivityAt: failedScheduleBaseDate, campaign, attemptNo: nextAttemptNo })
                        : null;
                    await AbandonedCart.markJourneyAttempted({
                        journeyId: workingJourney.id,
                        nextAttemptNo: attemptNo,
                        nextAttemptAt: failedNextAttemptAt,
                        markExpired: !hasNext
                    });
                    claimReleased = true;
                    if (typeof onJourneyUpdate === 'function') {
                        onJourneyUpdate({
                            event: 'attempt_failed',
                            journeyId: workingJourney.id,
                            userId: workingJourney.user_id,
                            status: hasNext ? 'active' : 'expired',
                            reason: error?.message || 'Recovery processing failed',
                            nextAttemptAt: failedNextAttemptAt ? failedNextAttemptAt.toISOString() : null,
                            lastAttemptNo: attemptNo
                        });
                    }
                    workingJourney = {
                        ...workingJourney,
                        last_attempt_no: attemptNo,
                        next_attempt_at: failedNextAttemptAt ? failedNextAttemptAt.toISOString() : null
                    };
                } catch {}
                doneForJourney = true;
            }
        }
        if (!claimReleased) {
            await AbandonedCart.clearJourneyProcessing({
                journeyId: workingJourney.id,
                token: processingToken
            }).catch(() => {});
        }
    }

    return { ok: true, stats };
};

const runDueAbandonedCartRecoveriesUntilClear = async ({
    limit = 30,
    onJourneyUpdate = null,
    maxBatches = MAX_RECOVERY_BATCHES_PER_RUN
} = {}) => {
    const aggregate = {
        due: 0,
        processed: 0,
        sent: 0,
        skipped: 0,
        failed: 0,
        recovered: 0,
        expired: 0,
        cancelled: 0,
        batches: 0,
        failedReasons: {}
    };
    for (let i = 0; i < Number(maxBatches || 1); i += 1) {
        const result = await processDueAbandonedCartRecoveries({ limit, onJourneyUpdate });
        aggregate.batches += 1;
        if (!result?.ok) return result;
        const stats = result?.stats || {};
        aggregate.due += Number(stats.due || 0);
        aggregate.processed += Number(stats.processed || 0);
        aggregate.sent += Number(stats.sent || 0);
        aggregate.skipped += Number(stats.skipped || 0);
        aggregate.failed += Number(stats.failed || 0);
        aggregate.recovered += Number(stats.recovered || 0);
        aggregate.expired += Number(stats.expired || 0);
        aggregate.cancelled += Number(stats.cancelled || 0);
        Object.entries(stats.failedReasons || {}).forEach(([reason, count]) => {
            aggregate.failedReasons[reason] = Number(aggregate.failedReasons[reason] || 0) + Number(count || 0);
        });

        // No due rows left in this pass; scheduler can sleep.
        if (Number(stats.due || 0) === 0) break;
    }
    return { ok: true, stats: aggregate };
};

const startAbandonedCartRecoveryScheduler = ({ onJourneyUpdate = null } = {}) => {
    // Kick off one pass immediately on startup to avoid waiting for the first interval.
    setTimeout(async () => {
        try {
            await runDueAbandonedCartRecoveriesUntilClear({ limit: 30, onJourneyUpdate });
        } catch (error) {
            console.error('Abandoned cart recovery bootstrap run failed:', error?.message || error);
        }
    }, 5 * 1000);

    setInterval(async () => {
        try {
            await runDueAbandonedCartRecoveriesUntilClear({ limit: 30, onJourneyUpdate });
        } catch (error) {
            console.error('Abandoned cart recovery job failed:', error?.message || error);
        }
    }, RECOVERY_JOB_INTERVAL_MS);
};

const runAbandonedCartMaintenanceOnce = async ({ onJourneyUpdate = null } = {}) => {
    const campaign = await AbandonedCart.getCampaign();
    const dueCandidates = await AbandonedCart.listDueCandidates({
        inactivityMinutes: campaign?.inactivityMinutes,
        limit: 200
    });
    let promoted = 0;
    for (const candidate of dueCandidates) {
        const existing = await AbandonedCart.getActiveJourneyByUser(candidate.user_id);
        if (!existing) {
            const created = await AbandonedCart.createJourneyFromCandidate({ candidate, campaign });
            promoted += created?.id ? 1 : 0;
            const journey = created?.id
                ? await AbandonedCart.getActiveJourneyByUser(candidate.user_id)
                : null;
            if (typeof onJourneyUpdate === 'function') {
                onJourneyUpdate({
                    event: 'created',
                    journeyId: created?.id || journey?.id || null,
                    userId: candidate.user_id,
                    status: journey?.status || 'active',
                    journey
                });
            }
        }
        await AbandonedCart.deleteCandidate(candidate.user_id);
    }
    const expired = await AbandonedCart.closeExpiredJourneys();
    const emptied = await AbandonedCart.closeActiveJourneysWithEmptyCarts();
    return { ok: true, promoted, expired, emptied };
};

const startAbandonedCartMaintenanceScheduler = ({ onJourneyUpdate = null } = {}) => {
    const intervalMs = 3 * 60 * 1000;
    const isTransientMaintenanceError = (error) => {
        const code = String(error?.code || '').toUpperCase();
        const message = String(error?.message || '').toUpperCase();
        return (
            ['ECONNRESET', 'PROTOCOL_CONNECTION_LOST', 'ETIMEDOUT', 'EPIPE', 'ECONNREFUSED'].includes(code)
            || message.includes('ECONNRESET')
            || message.includes('PROTOCOL_CONNECTION_LOST')
        );
    };

    const runMaintenanceWithRetry = async () => {
        try {
            await runAbandonedCartMaintenanceOnce({ onJourneyUpdate });
        } catch (error) {
            if (!isTransientMaintenanceError(error)) throw error;
            // One immediate retry for transient network/DB disconnects.
            await new Promise((resolve) => setTimeout(resolve, 1500));
            await runAbandonedCartMaintenanceOnce({ onJourneyUpdate });
        }
    };

    setTimeout(async () => {
        try {
            await runMaintenanceWithRetry();
        } catch (error) {
            console.error('Abandoned cart maintenance bootstrap run failed:', error?.message || error);
        }
    }, 5 * 1000);

    setInterval(async () => {
        try {
            await runMaintenanceWithRetry();
        } catch (error) {
            console.error('Abandoned cart maintenance job failed:', error?.message || error);
        }
    }, intervalMs);
};

module.exports = {
    setKnownPublicOrigin,
    setKnownPublicOriginFromRequest,
    trackCartActivity,
    markRecoveredByOrder,
    processDueAbandonedCartRecoveries,
    runDueAbandonedCartRecoveriesUntilClear,
    startAbandonedCartRecoveryScheduler,
    startAbandonedCartMaintenanceScheduler,
    runAbandonedCartMaintenanceOnce
};
