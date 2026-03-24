const Order = require('../models/Order');
const db = require('../config/db');
const crypto = require('crypto');
const { PaymentAttempt, PAYMENT_STATUS } = require('../models/PaymentAttempt');
const WebhookEvent = require('../models/WebhookEvent');
const { createRazorpayClient, getRazorpayConfig } = require('../services/razorpayService');
const { markRecoveredByOrder } = require('../services/abandonedCartRecoveryService');
const AbandonedCart = require('../models/AbandonedCart');
const Coupon = require('../models/Coupon');
const LoyaltyPopupConfig = require('../models/LoyaltyPopupConfig');
const User = require('../models/User');
const CompanyProfile = require('../models/CompanyProfile');
const Product = require('../models/Product');
const { buildInvoicePdfBuffer } = require('../utils/invoicePdf');
const { sendOrderLifecycleCommunication, sendPaymentLifecycleCommunication } = require('../services/communications/communicationService');
const { verifyDeliveryToken } = require('../services/deliveryConfirmationService');
const { verifyInvoiceShareToken, buildInvoiceShareUrl } = require('../services/invoiceShareService');
const { reassessUserTier } = require('../services/loyaltyService');
const { emitToOrderAudiences } = require('../utils/socketAudience');
const { emitProductEvent } = require('./productController');

const toSubunit = (amount) => Math.round(Number(amount || 0) * 100);
const ATTEMPT_TTL_MINUTES = 30;
const SHIPPED_COURIER_OPTIONS = [
    'Blue Dart',
    'DTDC',
    'Delhivery',
    'India Post',
    'Ecom Express',
    'Xpressbees',
    'Shadowfax',
    'Ekart',
    'Amazon Shipping',
    'Trackon',
    'Professional Couriers',
    'Gati',
    'DHL',
    'FedEx',
    'Aramex',
    'Others'
];
const MANUAL_REFUND_METHODS = [
    'Cash',
    'NEFT/RTGS',
    'UPI',
    'Bank A/c Transfer',
    'Voucher code'
];
const MANUAL_PAYMENT_MODES = ['cash', 'upi', 'bank_transfer', 'card_swipe', 'net_banking', 'manual'];
const ORDER_TRANSITIONS = Object.freeze({
    confirmed: new Set(['confirmed', 'pending', 'shipped', 'cancelled']),
    pending: new Set(['pending', 'shipped', 'cancelled']),
    shipped: new Set(['shipped', 'completed', 'cancelled']),
    completed: new Set(['completed']),
    cancelled: new Set(['cancelled'])
});

const buildReceipt = (userId) => {
    const uid = String(userId || '').replace(/[^a-zA-Z0-9]/g, '').slice(-10) || 'guest';
    const stamp = Date.now().toString(36);
    return `ssc_${uid}_${stamp}`.slice(0, 40);
};

const collectOrderProductIds = (order = null) => (
    [...new Set((Array.isArray(order?.items) ? order.items : [])
        .map((item) => String(item?.product_id || item?.productId || '').trim())
        .filter(Boolean))]
);

const emitProductUpdatesForIds = async (req, productIds = []) => {
    const ids = [...new Set((productIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
    for (const productId of ids) {
        const product = await Product.findById(productId);
        if (!product) continue;
        emitProductEvent(req, 'product:update', product);
    }
};

const assertStorefrontOpenForCheckout = async () => {
    const company = await CompanyProfile.get();
    if (company?.storefrontOpen === false) {
        const error = new Error('Storefront is temporarily closed for new orders. Existing orders will still be fulfilled.');
        error.statusCode = 423;
        throw error;
    }
};

const releaseAttemptInventoryAndEmit = async (req, { attemptId, reason }) => {
    const released = await PaymentAttempt.releaseInventoryForAttempt({ attemptId, reason });
    await emitProductUpdatesForIds(req, released?.productIds || []);
    return released;
};

const reserveAttemptInventoryAndEmit = async (req, { attemptId, userId, expiresAt }) => {
    const reserved = await PaymentAttempt.reserveInventoryForAttempt({ attemptId, userId, expiresAt });
    await emitProductUpdatesForIds(req, reserved?.productIds || []);
    return reserved;
};

const consumeAttemptInventoryAndEmit = async (req, { attemptId }) => {
    const consumed = await PaymentAttempt.consumeInventoryForAttempt({ attemptId });
    await emitProductUpdatesForIds(req, consumed?.productIds || []);
    return consumed;
};

const emitOrderAndPaymentUpdate = (req, { order, payment = null, silent = false } = {}) => {
    const io = req.app.get('io');
    if (!io || !order) return;
    const payload = { orderId: order.id, status: order.status, order, silent: Boolean(silent) };
    emitToOrderAudiences(io, order, 'order:update', payload);
    if (!payment) return;
    const paymentPayload = { ...payload, payment };
    emitToOrderAudiences(io, order, 'payment:update', paymentPayload);
};

const emitAbandonedRecoveryUpdate = (req, { journeyId = null, userId = null, reason = 'order_paid' } = {}) => {
    const io = req.app.get('io');
    if (!io) return;
    io.to('admin').emit('abandoned_cart:recovered', {
        journeyId: journeyId || null,
        userId: userId || null,
        reason,
        ts: new Date().toISOString()
    });
};

const emitCouponChangedForOrder = (req, order = null) => {
    if (!order?.coupon_code || !order?.user_id) return;
    const io = req.app.get('io');
    if (!io) return;
    const payload = {
        action: 'redeemed',
        code: String(order.coupon_code || '').trim().toUpperCase(),
        userId: order.user_id,
        orderId: order.id || null,
        ts: new Date().toISOString()
    };
    io.to('admin').emit('coupon:changed', payload);
    io.to(`user:${order.user_id}`).emit('coupon:changed', payload);
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

const normalizeAddressPayload = (value = null, { fieldLabel = 'Address' } = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error(`${fieldLabel} must be an object`);
    }
    const line1 = String(value.line1 || '').trim();
    const city = String(value.city || '').trim();
    const state = String(value.state || '').trim();
    const zip = String(value.zip || '').trim();
    if (!line1 || !city || !state || !zip) {
        throw new Error(`${fieldLabel} fields are required`);
    }
    if (!/^[0-9A-Za-z\\-\\s]{3,12}$/.test(zip)) {
        throw new Error(`${fieldLabel} zip code is invalid`);
    }
    return { line1, city, state, zip };
};

const parseCategoryScopeIds = (coupon = null) => {
    if (!coupon) return [];
    const raw = coupon.category_scope_json ?? coupon.categoryScopeJson ?? coupon.categoryIds ?? [];
    const source = Array.isArray(raw) ? raw : [];
    return [...new Set(source.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
};

const buildCategoryCouponContext = async (coupon = null) => {
    const scopeType = String(coupon?.scope_type || coupon?.scopeType || '').toLowerCase();
    if (scopeType !== 'category') return null;
    const categoryIds = parseCategoryScopeIds(coupon);
    if (!categoryIds.length) return null;
    const placeholders = categoryIds.map(() => '?').join(',');
    const [rows] = await db.execute(
        `SELECT id, name FROM categories WHERE id IN (${placeholders})`,
        categoryIds
    );
    if (!rows.length) return null;
    const namesById = new Map(rows.map((row) => [Number(row.id), String(row.name || '').trim()]).filter(([, name]) => Boolean(name)));
    const categoryNames = categoryIds.map((id) => namesById.get(id)).filter(Boolean);
    if (!categoryNames.length) return null;
    const primaryCategoryName = categoryNames[0];
    return {
        categoryIds,
        categoryNames,
        primaryCategoryName,
        categoryLink: `/shop/${encodeURIComponent(primaryCategoryName)}`,
        categoryNotice: `Valid only for ${primaryCategoryName} category products.`
    };
};

const createOrderFromRecoveryPayment = async (req, {
    notes = {},
    razorpayOrderId = null,
    razorpayPaymentId = null,
    paymentLinkId = null
} = {}) => {
    if (razorpayPaymentId) {
        const existingByPayment = await Order.getByRazorpayPaymentId(razorpayPaymentId);
        if (existingByPayment) return existingByPayment;
    }

    const attemptByLink = paymentLinkId
        ? await AbandonedCart.getAttemptByPaymentLinkId(paymentLinkId)
        : null;

    const userId = notes.userId || notes.user_id || attemptByLink?.payload_json?.userId || null;
    const journeyId = Number(
        notes.journeyId
        || notes.journey_id
        || attemptByLink?.journey_id
        || 0
    ) || null;
    const attemptNo = Number(
        notes.attemptNo
        || notes.attempt_no
        || attemptByLink?.attempt_no
        || 0
    ) || null;
    const preferredOrderRef = String(
        notes.orderRef
        || notes.order_ref
        || attemptByLink?.payload_json?.orderRef
        || ''
    ).trim() || null;
    const shippingFeeOverrideSubunits = Number(
        notes.shippingFeeSubunits
        || notes.shipping_fee_subunits
        || attemptByLink?.payload_json?.shippingFeeSubunits
        || attemptByLink?.payload_json?.shipping_fee_subunits
        || 0
    ) || null;
    if (!userId || !journeyId) return null;

    const timeline = await AbandonedCart.getJourneyTimeline(journeyId);
    const journey = timeline?.journey || null;
    if (!journey || String(journey.user_id) !== String(userId)) return null;

    const user = await User.findById(userId);
    const shippingAddress = parseAddressObject(user?.address) || {};
    const billingAddress = parseAddressObject(user?.billingAddress) || shippingAddress || {};

    const createdOrder = await Order.createFromRecoveryJourney(userId, {
        journey,
        payment: {
            paymentStatus: PAYMENT_STATUS.PAID,
            gateway: 'razorpay',
            razorpayOrderId: razorpayOrderId || null,
            razorpayPaymentId: razorpayPaymentId || null
        },
        billingAddress,
        shippingAddress,
        orderRef: preferredOrderRef,
        shippingFeeOverrideSubunits
    });

    if (paymentLinkId) {
        try {
            await AbandonedCart.markAttemptPaidByPaymentLink({
                paymentLinkId,
                paymentId: razorpayPaymentId || null
            });
        } catch {}
    }

    if (createdOrder) {
        await emitProductUpdatesForIds(req, collectOrderProductIds(createdOrder));
        try {
            await markRecoveredByOrder({ order: createdOrder, reason: 'payment_paid_webhook' });
            emitAbandonedRecoveryUpdate(req, {
                journeyId: createdOrder.abandoned_journey_id || journeyId,
                userId: createdOrder.user_id || userId,
                reason: 'payment_paid_webhook'
            });
        } catch {}
        emitCouponChangedForOrder(req, createdOrder);
    }
    return createdOrder;
};

const getAttemptExpiryDate = () => {
    const expires = new Date();
    expires.setMinutes(expires.getMinutes() + ATTEMPT_TTL_MINUTES);
    return expires;
};

const timingSafeSignatureMatch = (left, right) => {
    try {
        const a = Buffer.from(String(left || ''), 'utf8');
        const b = Buffer.from(String(right || ''), 'utf8');
        if (a.length !== b.length) return false;
        return crypto.timingSafeEqual(a, b);
    } catch {
        return false;
    }
};

const mapRazorpayOrderStatusToLocalPayment = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'paid') return PAYMENT_STATUS.PAID;
    if (normalized === 'placed') return 'pending';
    if (normalized === 'refunded') return PAYMENT_STATUS.REFUNDED;
    if (normalized === 'cancelled') return PAYMENT_STATUS.FAILED;
    return null;
};

const isAllowedOrderTransition = (currentStatus = '', nextStatus = '') => {
    const current = String(currentStatus || '').trim().toLowerCase() || 'confirmed';
    const next = String(nextStatus || '').trim().toLowerCase() || 'confirmed';
    const allowed = ORDER_TRANSITIONS[current];
    if (!allowed) return false;
    return allowed.has(next);
};

const mapRazorpayPaymentStatusToLocalPayment = (status) => {
    const normalized = String(status || '').toLowerCase();
    if (normalized === 'captured') return PAYMENT_STATUS.PAID;
    if (normalized === 'authorized') return PAYMENT_STATUS.ATTEMPTED;
    if (normalized === 'failed') return PAYMENT_STATUS.FAILED;
    if (normalized === 'pending') return 'pending';
    return null;
};

const normalizePaymentStatus = (status) => String(status || '').trim().toLowerCase();

const isPaidLikeStatus = (status) => {
    const normalized = normalizePaymentStatus(status);
    return normalized === PAYMENT_STATUS.PAID || normalized === PAYMENT_STATUS.REFUNDED;
};

const maybeTriggerConfirmedEmailOnPaymentTransition = ({
    order = null,
    previousPaymentStatus = null,
    currentPaymentStatus = null,
    includeInvoice = true
} = {}) => {
    if (!order?.id || !order?.user_id) return;
    const next = normalizePaymentStatus(currentPaymentStatus);
    if (next !== PAYMENT_STATUS.PAID) return;
    if (isPaidLikeStatus(previousPaymentStatus)) return;
    void triggerOrderLifecycleEmail({
        order,
        stage: 'confirmed',
        includeInvoice
    });
};

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

const buildAttemptSnapshot = async ({
    userId,
    summary = null
} = {}) => {
    const [cartRows] = await db.execute(
        `SELECT ci.product_id, ci.variant_id, ci.quantity,
                p.title as product_title, p.status as product_status,
                p.mrp, p.discount_price as product_discount_price, p.sku as product_sku, p.media as product_media, p.weight_kg as product_weight_kg,
                pv.id as resolved_variant_id, pv.variant_title, pv.price as variant_price, pv.discount_price as variant_discount_price,
                pv.sku as variant_sku, pv.image_url as variant_image_url, pv.weight_kg as variant_weight_kg, pv.variant_options
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
         LEFT JOIN product_variants pv ON pv.id = ci.variant_id AND pv.product_id = ci.product_id
         WHERE ci.user_id = ?`,
        [userId]
    );
    const summaryItems = Array.isArray(summary?.items) ? summary.items : [];
    const taxByItemKey = new Map(
        summaryItems.map((item) => {
            const key = `${String(item?.productId || '')}::${String(item?.variantId || '')}`;
            return [key, item];
        })
    );
    const items = [];
    for (const row of (cartRows || [])) {
        const quantity = Math.max(0, Number(row.quantity || 0));
        if (quantity <= 0) continue;
        if (row.variant_id && !row.resolved_variant_id) continue;
        const unitPrice = Number(
            row.variant_discount_price || row.variant_price || row.product_discount_price || row.mrp || 0
        );
        const originalPrice = Number(row.variant_price || row.mrp || unitPrice);
        const lineTotal = Number((quantity * unitPrice).toFixed(2));
        const itemWeight = Number(row.variant_weight_kg || row.product_weight_kg || 0);
        let imageUrl = row.variant_image_url || null;
        if (!imageUrl && row.product_media) {
            try {
                const media = JSON.parse(row.product_media || '[]');
                imageUrl = Array.isArray(media) ? (media[0]?.url || media[0] || null) : null;
            } catch {
                imageUrl = null;
            }
        }
        items.push({
            productId: row.product_id,
            variantId: row.variant_id || '',
            title: row.product_title || 'Product',
            variantTitle: row.variant_title || '',
            variantOptions: row.variant_options ? (() => {
                try {
                    return typeof row.variant_options === 'string' ? JSON.parse(row.variant_options) : row.variant_options;
                } catch {
                    return null;
                }
            })() : null,
            quantity,
            unitPrice,
            originalPrice,
            discountValuePerUnit: Math.max(0, originalPrice - unitPrice),
            lineTotal,
            imageUrl: imageUrl || '',
            sku: row.variant_sku || row.product_sku || null,
            weightKg: itemWeight,
            productStatus: row.product_status || 'active',
            capturedAt: new Date().toISOString()
        });
        const key = `${String(row.product_id || '')}::${String(row.variant_id || '')}`;
        const taxRef = taxByItemKey.get(key) || null;
        if (taxRef) {
            const last = items[items.length - 1];
            last.taxAmount = Number(taxRef.taxAmount || 0);
            last.taxRatePercent = Number(taxRef.taxRatePercent || 0);
            last.taxName = taxRef.taxName || null;
            last.taxCode = taxRef.taxCode || null;
            last.taxSnapshot = taxRef.taxName || taxRef.taxCode
                ? {
                    id: taxRef.taxId || null,
                    name: taxRef.taxName || null,
                    code: taxRef.taxCode || null,
                    ratePercent: Number(taxRef.taxRatePercent || 0)
                }
                : null;
        }
    }
    if (!summary || typeof summary !== 'object') {
        return {
            capturedAt: new Date().toISOString(),
            items
        };
    }
    return {
        capturedAt: new Date().toISOString(),
        items,
        pricing: {
            subtotal: Number(summary.subtotal || 0),
            shippingFee: Number(summary.shippingFee || 0),
            couponDiscountTotal: Number(summary.couponDiscountTotal || 0),
            loyaltyDiscountTotal: Number(summary.loyaltyDiscountTotal || 0),
            loyaltyShippingDiscountTotal: Number(summary.loyaltyShippingDiscountTotal || 0),
            taxTotal: Number(summary.taxTotal || 0),
            taxBreakup: Array.isArray(summary.taxBreakup) ? summary.taxBreakup : [],
            discountTotal: Number(summary.discountTotal || 0),
            total: Number(summary.total || 0),
            currency: String(summary.currency || 'INR')
        },
        loyalty: {
            tier: String(summary.loyaltyTier || 'regular').toLowerCase(),
            profile: summary.loyaltyProfile || null,
            meta: summary.loyaltyMeta || null
        },
        coupon: summary.coupon
            ? {
                code: summary.coupon.code || null,
                type: summary.coupon.type || null,
                source: summary.coupon.source || null
            }
            : null
    };
};

const fetchSettlementSnapshotSafe = async (razorpay, settlementId) => {
    const ref = String(settlementId || '').trim();
    if (!razorpay || !ref) return null;
    try {
        const settlement = await razorpay.settlements.fetch(ref);
        return normalizeSettlementSnapshot(settlement);
    } catch {
        return null;
    }
};

const createRazorpayOrder = async (req, res) => {
    try {
        await assertStorefrontOpenForCheckout();
        const userId = req.user.id;
        const { billingAddress, shippingAddress, notes, couponCode } = req.body || {};
        const safeShippingAddress = normalizeAddressPayload(shippingAddress, { fieldLabel: 'Shipping address' });
        const safeBillingAddress = normalizeAddressPayload(billingAddress, { fieldLabel: 'Billing address' });
        if (notes !== undefined && (typeof notes !== 'object' || Array.isArray(notes))) {
            return res.status(400).json({ message: 'Notes must be an object' });
        }
        if (couponCode !== undefined && typeof couponCode !== 'string') {
            return res.status(400).json({ message: 'Coupon code must be a string' });
        }

        const normalizedCouponCode = String(couponCode || '').trim().toUpperCase() || null;
        const summary = await Order.getCheckoutSummary(userId, {
            shippingAddress: safeShippingAddress,
            couponCode: normalizedCouponCode
        });
        const amount = toSubunit(summary.total);

        if (amount < 100) {
            return res.status(400).json({ message: 'Order amount should be at least INR 1.00' });
        }

        const razorpay = await createRazorpayClient();
        const razorpayConfig = await getRazorpayConfig();
        const expiresAt = getAttemptExpiryDate();
        const razorpayOrder = await razorpay.orders.create({
            amount,
            currency: summary.currency || 'INR',
            receipt: buildReceipt(userId),
            notes: {
                userId: String(userId),
                itemCount: String(summary.itemCount),
                ...(normalizedCouponCode ? { couponCode: normalizedCouponCode } : {}),
                ...(notes && typeof notes === 'object' ? notes : {})
            }
        });

        const attempt = await PaymentAttempt.create({
            userId,
            razorpayOrderId: razorpayOrder.id,
            amountSubunits: amount,
            currency: summary.currency || 'INR',
            billingAddress: safeBillingAddress,
            shippingAddress: safeShippingAddress,
            notes: {
                ...(notes && typeof notes === 'object' ? notes : {}),
                ...(normalizedCouponCode ? { couponCode: normalizedCouponCode } : {}),
                attemptSnapshot: await buildAttemptSnapshot({
                    userId,
                    summary
                })
            },
            expiresAt
        });

        try {
            await reserveAttemptInventoryAndEmit(req, {
                attemptId: attempt.id,
                userId,
                expiresAt
            });
        } catch (error) {
            await PaymentAttempt.markFailed({
                id: attempt.id,
                errorMessage: error?.message || 'Reservation failed'
            });
            return res.status(400).json({ message: error?.message || 'Failed to reserve stock for payment' });
        }

        return res.status(201).json({
            order: razorpayOrder,
            keyId: razorpayConfig?.keyId || '',
            summary,
            attempt: {
                id: attempt.id,
                status: PAYMENT_STATUS.CREATED,
                expiresAt
            }
        });
    } catch (error) {
        if (Number(error?.statusCode || 0) === 423) {
            return res.status(423).json({ message: error.message });
        }
        const statusCode = Number(error?.statusCode || 0);
        const gatewayMessage = error?.error?.description || error?.description;
        const message = gatewayMessage || error?.message || 'Failed to create payment order';

        if (statusCode === 400 || error?.error?.code === 'BAD_REQUEST_ERROR') {
            return res.status(400).json({ message });
        }
        if (
            String(message).toLowerCase().includes('razorpay') ||
            String(message).toLowerCase().includes('key') ||
            String(message).toLowerCase().includes('credential') ||
            String(message).toLowerCase().includes('cannot find module')
        ) {
            return res.status(500).json({ message: 'Razorpay is not configured on server' });
        }
        return res.status(400).json({ message });
    }
};

const verifyRazorpayPayment = async (req, res) => {
    let lockedAttemptId = null;
    let lockedPaymentId = null;
    let lockedSignature = null;
    let createdOrder = null;
    try {
        const userId = req.user.id;
        const {
            razorpay_payment_id: razorpayPaymentId,
            razorpay_order_id: razorpayOrderId,
            razorpay_signature: razorpaySignature
        } = req.body || {};

        if (!razorpayPaymentId || !razorpayOrderId || !razorpaySignature) {
            return res.status(400).json({ message: 'Payment verification fields are required' });
        }

        const attempt = await PaymentAttempt.getByRazorpayOrderId({ userId, razorpayOrderId });
        if (!attempt) {
            return res.status(404).json({ message: 'Payment attempt not found' });
        }

        if (attempt.status === PAYMENT_STATUS.PAID && attempt.local_order_id) {
            const existingOrder = await Order.getById(attempt.local_order_id);
            if (existingOrder) {
                return res.json({ order: existingOrder, verified: true });
            }
        }
        if (attempt.status === PAYMENT_STATUS.EXPIRED) {
            return res.status(410).json({ message: 'Payment session expired. Please retry payment.' });
        }

        const razorpayConfig = await getRazorpayConfig();
        const secret = String(razorpayConfig?.keySecret || '').trim();
        if (!secret) {
            return res.status(500).json({ message: 'Razorpay is not configured on server' });
        }

        const generatedSignature = crypto
            .createHmac('sha256', secret)
            .update(`${attempt.razorpay_order_id}|${razorpayPaymentId}`)
            .digest('hex');

        const isValidSignature = (() => {
            try {
                return crypto.timingSafeEqual(
                    Buffer.from(generatedSignature),
                    Buffer.from(String(razorpaySignature))
                );
            } catch {
                return false;
            }
        })();

        if (!isValidSignature) {
            await PaymentAttempt.markFailed({
                id: attempt.id,
                paymentId: razorpayPaymentId,
                signature: razorpaySignature,
                errorMessage: 'Signature verification failed'
            });
            return res.status(400).json({ message: 'Invalid payment signature' });
        }

        const lockAcquired = await PaymentAttempt.beginVerificationLock({
            id: attempt.id,
            paymentId: razorpayPaymentId,
            signature: razorpaySignature
        });

        if (!lockAcquired) {
            const latestAttempt = await PaymentAttempt.getById(attempt.id);
            if (latestAttempt?.local_order_id) {
                const existingOrder = await Order.getById(latestAttempt.local_order_id);
                if (existingOrder) {
                    return res.json({ order: existingOrder, verified: true });
                }
            }
            return res.status(409).json({ message: 'Payment verification already in progress. Please retry in a moment.' });
        }
        lockedAttemptId = attempt.id;
        lockedPaymentId = razorpayPaymentId;
        lockedSignature = razorpaySignature;

        const razorpay = await createRazorpayClient();
        const paymentDetails = await razorpay.payments.fetch(razorpayPaymentId);

        if (!paymentDetails || String(paymentDetails.order_id) !== String(attempt.razorpay_order_id)) {
            await releaseAttemptInventoryAndEmit(req, { attemptId: attempt.id, reason: 'verify_mismatch' });
            await PaymentAttempt.markFailed({
                id: attempt.id,
                paymentId: razorpayPaymentId,
                signature: razorpaySignature,
                errorMessage: 'Payment order mismatch'
            });
            return res.status(400).json({ message: 'Payment verification failed: order mismatch' });
        }

        if (Number(paymentDetails.amount || 0) !== Number(attempt.amount_subunits || 0)) {
            await releaseAttemptInventoryAndEmit(req, { attemptId: attempt.id, reason: 'verify_amount_mismatch' });
            await PaymentAttempt.markFailed({
                id: attempt.id,
                paymentId: razorpayPaymentId,
                signature: razorpaySignature,
                errorMessage: 'Payment amount mismatch'
            });
            return res.status(400).json({ message: 'Payment verification failed: amount mismatch' });
        }

        if (String(paymentDetails.currency || '').toUpperCase() !== String(attempt.currency || 'INR').toUpperCase()) {
            await releaseAttemptInventoryAndEmit(req, { attemptId: attempt.id, reason: 'verify_currency_mismatch' });
            await PaymentAttempt.markFailed({
                id: attempt.id,
                paymentId: razorpayPaymentId,
                signature: razorpaySignature,
                errorMessage: 'Payment currency mismatch'
            });
            return res.status(400).json({ message: 'Payment verification failed: currency mismatch' });
        }

        if (String(paymentDetails.status || '').toLowerCase() !== 'captured') {
            return res.status(400).json({ message: 'Payment is not captured yet' });
        }

        const appliedCouponCode = String(attempt?.notes?.couponCode || '').trim().toUpperCase() || null;
        const cartSummary = await Order.getCheckoutSummary(userId, {
            shippingAddress: attempt.shipping_address || null,
            couponCode: appliedCouponCode
        });
        const currentAmountSubunits = toSubunit(cartSummary.total);
        if (Number(currentAmountSubunits) !== Number(attempt.amount_subunits || 0)) {
            await releaseAttemptInventoryAndEmit(req, { attemptId: attempt.id, reason: 'cart_changed' });
            await PaymentAttempt.markFailed({
                id: attempt.id,
                paymentId: razorpayPaymentId,
                signature: razorpaySignature,
                errorMessage: 'Cart changed after payment initiation'
            });
            return res.status(409).json({ message: 'Cart changed after payment initiation. Please retry checkout.' });
        }

        const order = await Order.createFromCart(userId, {
            billingAddress: attempt.billing_address || null,
            shippingAddress: attempt.shipping_address || null,
            payment: {
                gateway: 'razorpay',
                paymentStatus: PAYMENT_STATUS.PAID,
                razorpayOrderId: attempt.razorpay_order_id,
                razorpayPaymentId: razorpayPaymentId,
                razorpaySignature,
                settlementId: paymentDetails?.settlement_id || null,
                settlementSnapshot: null
            },
            skipStockDeduction: true,
            couponCode: appliedCouponCode,
            sourceChannel: appliedCouponCode ? 'abandoned_recovery' : 'checkout'
        });
        createdOrder = order;

        await consumeAttemptInventoryAndEmit(req, { attemptId: attempt.id });
        try {
            await markRecoveredByOrder({ order, reason: 'order_paid_checkout' });
        } catch {}

        const verifyMarked = await PaymentAttempt.markVerified({
            id: attempt.id,
            paymentId: razorpayPaymentId,
            signature: razorpaySignature,
            localOrderId: order.id
        });
        if (!verifyMarked) {
            const latestAttempt = await PaymentAttempt.getById(attempt.id);
            if (latestAttempt?.local_order_id) {
                const existingOrder = await Order.getById(latestAttempt.local_order_id);
                if (existingOrder) {
                    return res.json({ order: existingOrder, verified: true });
                }
            }
            return res.status(409).json({ message: 'Payment verification conflict. Please retry.' });
        }
        lockedAttemptId = null;
        lockedPaymentId = null;
        lockedSignature = null;

        const io = req.app.get('io');
        if (io) {
            const hydratedOrder = await Order.getById(order.id);
            const finalOrder = hydratedOrder || order;
            emitToOrderAudiences(io, finalOrder, 'order:create', { order: finalOrder });
            emitToOrderAudiences(io, finalOrder, 'order:update', {
                orderId: finalOrder.id || order.id,
                status: finalOrder.status || 'confirmed',
                order: finalOrder
            });
            const paymentPayload = {
                orderId: finalOrder.id || order.id,
                status: finalOrder.status || 'confirmed',
                order: finalOrder,
                payment: {
                    paymentStatus: PAYMENT_STATUS.PAID,
                    paymentMethod: 'razorpay',
                    paymentReference: razorpayPaymentId,
                    razorpayOrderId: attempt.razorpay_order_id
                }
            };
            emitToOrderAudiences(io, finalOrder, 'payment:update', paymentPayload);
            emitCouponChangedForOrder(req, finalOrder);
        }

        void triggerOrderLifecycleEmail({
            order,
            stage: 'confirmed',
            includeInvoice: true
        });
        void triggerPaymentLifecycleCommunication({
            order,
            stage: PAYMENT_STATUS.PAID,
            payment: {
                paymentStatus: PAYMENT_STATUS.PAID,
                paymentMethod: 'razorpay',
                paymentReference: razorpayPaymentId,
                razorpayOrderId: attempt.razorpay_order_id
            }
        });

        return res.json({ order, verified: true });
    } catch (error) {
        if (createdOrder?.id) {
            if (lockedAttemptId) {
                try {
                    await PaymentAttempt.markVerified({
                        id: lockedAttemptId,
                        paymentId: lockedPaymentId,
                        signature: lockedSignature,
                        localOrderId: createdOrder.id
                    });
                } catch {}
            }
            const persistedOrder = await Order.getById(createdOrder.id).catch(() => null);
            return res.json({ order: persistedOrder || createdOrder, verified: true });
        }
        if (lockedAttemptId) {
            try {
                await releaseAttemptInventoryAndEmit(req, {
                    attemptId: lockedAttemptId,
                    reason: 'verify_failed'
                });
                await PaymentAttempt.markFailed({
                    id: lockedAttemptId,
                    paymentId: lockedPaymentId,
                    signature: lockedSignature,
                    errorMessage: error?.message || 'Verification failed'
                });
            } catch {}
        }
        return res.status(400).json({ message: error.message || 'Failed to verify payment' });
    }
};

const retryRazorpayPayment = async (req, res) => {
    try {
        await assertStorefrontOpenForCheckout();
        const userId = req.user.id;
        const { attemptId, orderId } = req.body || {};
        let sourceAttempt = null;
        if (attemptId) {
            sourceAttempt = await PaymentAttempt.getById(attemptId);
        } else if (Number.isFinite(Number(orderId)) && Number(orderId) > 0) {
            const order = await Order.getById(Number(orderId));
            if (!order || String(order.user_id) !== String(userId)) {
                return res.status(404).json({ message: 'Order not found' });
            }
            const razorpayOrderId = String(order.razorpay_order_id || '').trim();
            if (!razorpayOrderId) {
                return res.status(400).json({ message: 'Retryable payment is not available for this order' });
            }
            sourceAttempt = await PaymentAttempt.getLatestRetryableForOrder({
                userId,
                razorpayOrderId
            });
        } else {
            sourceAttempt = await PaymentAttempt.getLatestRetryableByUser(userId);
        }

        if (!sourceAttempt || String(sourceAttempt.user_id) !== String(userId)) {
            return res.status(404).json({ message: 'No retryable payment found' });
        }
        if (![PAYMENT_STATUS.FAILED, PAYMENT_STATUS.EXPIRED].includes(String(sourceAttempt.status))) {
            return res.status(400).json({ message: 'Selected payment is not retryable' });
        }

        return createRazorpayOrder({
            ...req,
            body: {
                billingAddress: sourceAttempt.billing_address || null,
                shippingAddress: sourceAttempt.shipping_address || null,
                notes: {
                    ...(sourceAttempt.notes || {}),
                    retryOfAttemptId: sourceAttempt.id
                }
            }
        }, res);
    } catch (error) {
        if (Number(error?.statusCode || 0) === 423) {
            return res.status(423).json({ message: error.message });
        }
        return res.status(400).json({ message: error.message || 'Failed to retry payment' });
    }
};

const createOrderFromCheckoutPaymentAttempt = async (req, {
    attempt = null,
    razorpayOrderId = null,
    razorpayPaymentId = null,
    razorpaySignature = null,
    settlementId = null,
    settlementSnapshot = null
} = {}) => {
    if (!attempt?.id) return null;
    if (attempt.local_order_id) {
        const existingOrder = await Order.getById(attempt.local_order_id);
        if (existingOrder) return existingOrder;
    }

    const order = await Order.createManualOrderFromAttempt({
        attempt,
        paymentGateway: 'razorpay',
        paymentReference: razorpayPaymentId || '',
        actorUserId: null,
        paymentStatus: PAYMENT_STATUS.PAID,
        razorpayOrderId: razorpayOrderId || attempt.razorpay_order_id || null,
        razorpayPaymentId: razorpayPaymentId || null,
        razorpaySignature: razorpaySignature || null,
        settlementId: settlementId || null,
        settlementSnapshot: settlementSnapshot || null,
        sourceChannel: 'checkout_webhook_recovery'
    });
    if (order) {
        await emitProductUpdatesForIds(req, collectOrderProductIds(order));
    }
    if (order) emitCouponChangedForOrder(req, order);
    return order;
};

const handleRazorpayWebhook = async (req, res) => {
    let webhookEventId = null;
    try {
        const razorpayConfig = await getRazorpayConfig();
        const secret = String(razorpayConfig?.webhookSecret || '').trim();
        if (!secret) {
            return res.status(500).json({ message: 'Webhook secret not configured' });
        }

        const signature = req.headers['x-razorpay-signature'];
        if (!signature) {
            return res.status(400).json({ message: 'Missing webhook signature' });
        }

        const rawBody = req.rawBody || JSON.stringify(req.body || {});
        const generatedSignature = crypto
            .createHmac('sha256', secret)
            .update(rawBody)
            .digest('hex');

        if (!timingSafeSignatureMatch(generatedSignature, signature)) {
            return res.status(400).json({ message: 'Invalid webhook signature' });
        }

        const event = String(req.body?.event || '');
        const headerEventId = String(req.headers['x-razorpay-event-id'] || '').trim();
        webhookEventId = headerEventId || crypto.createHash('sha256').update(rawBody).digest('hex');
        const webhookEntry = await WebhookEvent.register({
            eventId: webhookEventId,
            eventType: event,
            signature: String(signature || ''),
            payloadRaw: rawBody,
            payload: req.body || {}
        });
        if (webhookEntry.duplicate) {
            return res.status(200).json({ ok: true, duplicate: true, eventId: webhookEventId });
        }

        const paymentEntity = req.body?.payload?.payment?.entity || null;
        const orderEntity = req.body?.payload?.order?.entity || null;
        const paymentLinkEntity = req.body?.payload?.payment_link?.entity || null;
        const settlementEntity = req.body?.payload?.settlement?.entity || null;
        const paymentNotes = paymentEntity?.notes && typeof paymentEntity.notes === 'object' ? paymentEntity.notes : {};
        const orderNotes = orderEntity?.notes && typeof orderEntity.notes === 'object' ? orderEntity.notes : {};
        const paymentLinkNotes = paymentLinkEntity?.notes && typeof paymentLinkEntity.notes === 'object' ? paymentLinkEntity.notes : {};

        if (event.startsWith('settlement.')) {
            const settlementId = String(settlementEntity?.id || '').trim();
            const settlementSnapshot = normalizeSettlementSnapshot(settlementEntity);
            if (!settlementId || !settlementSnapshot) {
                await WebhookEvent.markProcessed({
                    eventId: webhookEventId,
                    status: 'ignored',
                    note: 'missing_settlement_payload'
                });
                return res.status(200).json({ ok: true, ignored: true, reason: 'missing_settlement_payload' });
            }

            const linkedOrders = await Order.getBySettlementId(settlementId, { limit: 250 });
            for (const linked of linkedOrders) {
                await Order.updateSettlementByOrderId({
                    orderId: linked.id,
                    settlementId,
                    settlementSnapshot
                });
                const updatedOrder = await Order.getById(linked.id);
                if (updatedOrder) {
                    emitOrderAndPaymentUpdate(req, {
                        order: updatedOrder,
                        payment: {
                            event,
                            paymentStatus: updatedOrder.payment_status,
                            paymentMethod: updatedOrder.payment_gateway || 'razorpay',
                            paymentReference: updatedOrder.razorpay_payment_id || null,
                            razorpayOrderId: updatedOrder.razorpay_order_id || null,
                            settlementId,
                            settlementStatus: settlementSnapshot.status || null,
                            settlementAmount: settlementSnapshot.amount
                        }
                    });
                }
            }

            const io = req.app.get('io');
            if (io) {
                io.to('admin').emit('payment:update', {
                    eventType: event,
                    settlement: settlementSnapshot,
                    settlementId,
                    linkedOrderCount: linkedOrders.length
                });
            }

            await WebhookEvent.markProcessed({
                eventId: webhookEventId,
                status: 'processed',
                note: `settlement_status:${settlementSnapshot.status || 'unknown'}`
            });
            return res.status(200).json({
                ok: true,
                event,
                settlementId,
                linkedOrders: linkedOrders.length
            });
        }

        const razorpayOrderId = paymentEntity?.order_id || orderEntity?.id || null;
        const razorpayPaymentId = paymentEntity?.id || null;
        const failureReason = paymentEntity?.error_description || paymentEntity?.error_reason || null;

        let paymentStatus = null;
        if (event === 'payment.authorized') paymentStatus = PAYMENT_STATUS.ATTEMPTED;
        if (event === 'payment.captured' || event === 'order.paid') paymentStatus = PAYMENT_STATUS.PAID;
        if (event === 'payment_link.paid') paymentStatus = PAYMENT_STATUS.PAID;
        if (event === 'payment.failed') paymentStatus = PAYMENT_STATUS.FAILED;
        if (event === 'refund.processed' || event === 'payment.refunded') paymentStatus = PAYMENT_STATUS.REFUNDED;

        if (!paymentStatus) {
            await WebhookEvent.markProcessed({
                eventId: webhookEventId,
                status: 'ignored',
                note: `ignored_event:${event}`
            });
            return res.status(200).json({ ok: true, ignored: true, event });
        }

        if (!razorpayOrderId && paymentStatus !== PAYMENT_STATUS.PAID) {
            await WebhookEvent.markProcessed({
                eventId: webhookEventId,
                status: 'ignored',
                note: 'missing_order_id'
            });
            return res.status(200).json({ ok: true, ignored: true, reason: 'missing_order_id' });
        }

        if (paymentStatus === 'attempted' && razorpayOrderId) {
            await PaymentAttempt.markAttemptedByRazorpayOrder({
                razorpayOrderId,
                paymentId: razorpayPaymentId
            });
        } else if (paymentStatus === PAYMENT_STATUS.PAID && razorpayOrderId) {
            const attempt = await PaymentAttempt.getByRazorpayOrderIdAny(razorpayOrderId);
            const payloadAmount = Number(paymentEntity?.amount || 0);
            if (
                attempt &&
                payloadAmount > 0 &&
                Number(attempt.amount_subunits || 0) > 0 &&
                payloadAmount !== Number(attempt.amount_subunits)
            ) {
                await PaymentAttempt.markFailedByRazorpayOrder({
                    razorpayOrderId,
                    paymentId: razorpayPaymentId,
                    errorMessage: 'Webhook amount mismatch'
                });
                await WebhookEvent.markFailed({
                    eventId: webhookEventId,
                    note: 'Webhook amount mismatch'
                });
                return res.status(400).json({ message: 'Webhook amount mismatch' });
            }
            if (
                attempt
                && String(paymentEntity?.currency || '').trim()
                && String(paymentEntity.currency || '').toUpperCase() !== String(attempt.currency || 'INR').toUpperCase()
            ) {
                await PaymentAttempt.markFailedByRazorpayOrder({
                    razorpayOrderId,
                    paymentId: razorpayPaymentId,
                    errorMessage: 'Webhook currency mismatch'
                });
                await WebhookEvent.markFailed({
                    eventId: webhookEventId,
                    note: 'Webhook currency mismatch'
                });
                return res.status(400).json({ message: 'Webhook currency mismatch' });
            }
            await PaymentAttempt.markPaidByRazorpayOrder({
                razorpayOrderId,
                paymentId: razorpayPaymentId
            });
        } else if (paymentStatus === PAYMENT_STATUS.FAILED && razorpayOrderId) {
            const attempt = await PaymentAttempt.getByRazorpayOrderIdAny(razorpayOrderId);
            if (attempt) {
                await releaseAttemptInventoryAndEmit(req, {
                    attemptId: attempt.id,
                    reason: 'payment_failed'
                });
            }
            await PaymentAttempt.markFailedByRazorpayOrder({
                razorpayOrderId,
                paymentId: razorpayPaymentId,
                errorMessage: failureReason
            });
            void triggerPaymentLifecycleCommunication({
                userId: attempt?.user_id || null,
                stage: PAYMENT_STATUS.FAILED,
                orderRef: razorpayOrderId,
                payment: {
                    paymentStatus: PAYMENT_STATUS.FAILED,
                    paymentMethod: 'razorpay',
                    paymentReference: razorpayPaymentId,
                    razorpayOrderId,
                    failureReason
                }
            });
        } else if (paymentStatus === PAYMENT_STATUS.REFUNDED && razorpayOrderId) {
            await PaymentAttempt.markPaidByRazorpayOrder({
                razorpayOrderId,
                paymentId: razorpayPaymentId
            });
        }

        const refundEntity = req.body?.payload?.refund?.entity || null;
        const existingLinkedOrder = razorpayOrderId
            ? await Order.getByRazorpayOrderId(razorpayOrderId)
            : null;
        const previousLinkedPaymentStatus = existingLinkedOrder?.payment_status || null;
        const settlementIdFromWebhook = paymentEntity?.settlement_id || null;
        const updatedCount = razorpayOrderId
            ? await Order.updatePaymentByRazorpayOrderId({
                razorpayOrderId,
                paymentStatus,
                razorpayPaymentId,
                settlementId: settlementIdFromWebhook,
                settlementSnapshot: null,
                refundReference: refundEntity?.id || null,
                refundAmount: refundEntity?.amount != null ? Number(refundEntity.amount) / 100 : null,
                refundStatus: refundEntity?.status || null
            })
            : 0;

        let linkedOrder = null;
        if (updatedCount > 0) {
            const order = await Order.getByRazorpayOrderId(razorpayOrderId);
            linkedOrder = order;
            if (order && paymentStatus === PAYMENT_STATUS.PAID) {
                try {
                    await markRecoveredByOrder({ order, reason: 'payment_paid_webhook' });
                    emitAbandonedRecoveryUpdate(req, {
                        journeyId: order.abandoned_journey_id || null,
                        userId: order.user_id || null,
                        reason: 'payment_paid_webhook'
                    });
                } catch {}
            }
            maybeTriggerConfirmedEmailOnPaymentTransition({
                order,
                previousPaymentStatus: previousLinkedPaymentStatus,
                currentPaymentStatus: paymentStatus,
                includeInvoice: true
            });
            if (String(previousLinkedPaymentStatus || '').toLowerCase() !== String(paymentStatus || '').toLowerCase()) {
                void triggerPaymentLifecycleCommunication({
                    order,
                    stage: paymentStatus,
                    payment: {
                        event,
                        paymentStatus,
                        paymentMethod: order?.payment_gateway || 'razorpay',
                        paymentReference: razorpayPaymentId,
                        razorpayOrderId,
                        refundReference: refundEntity?.id || null,
                        refundAmount: refundEntity?.amount != null ? Number(refundEntity.amount) / 100 : null,
                        refundStatus: refundEntity?.status || null
                    }
                });
            }
            emitOrderAndPaymentUpdate(req, {
                order,
                payment: {
                    event,
                    paymentStatus,
                    paymentMethod: order?.payment_gateway || 'razorpay',
                    paymentReference: razorpayPaymentId,
                    razorpayOrderId,
                    refundReference: refundEntity?.id || null,
                    refundAmount: refundEntity?.amount != null ? Number(refundEntity.amount) / 100 : null,
                    refundStatus: refundEntity?.status || null
                }
            });
        } else if (paymentStatus === PAYMENT_STATUS.PAID) {
            const notes = { ...orderNotes, ...paymentNotes, ...paymentLinkNotes };
            if (paymentLinkEntity?.id) {
                try {
                    await AbandonedCart.markAttemptPaidByPaymentLink({
                        paymentLinkId: paymentLinkEntity.id,
                        paymentId: razorpayPaymentId || null
                    });
                } catch {}
            }

            linkedOrder = razorpayPaymentId
                ? await Order.getByRazorpayPaymentId(razorpayPaymentId)
                : null;
            if (!linkedOrder && razorpayOrderId) {
                linkedOrder = await Order.getByRazorpayOrderId(razorpayOrderId);
            }
            if (!linkedOrder) {
                const attempt = razorpayOrderId
                    ? await PaymentAttempt.getByRazorpayOrderIdAny(razorpayOrderId)
                    : null;
                linkedOrder = attempt
                    ? await createOrderFromCheckoutPaymentAttempt(req, {
                        attempt,
                        razorpayOrderId,
                        razorpayPaymentId,
                        settlementId: settlementIdFromWebhook,
                        settlementSnapshot: null
                    })
                    : null;
            }
            if (!linkedOrder) {
                linkedOrder = await createOrderFromRecoveryPayment(req, {
                    notes,
                    razorpayOrderId,
                    razorpayPaymentId,
                    paymentLinkId: paymentLinkEntity?.id || null
                });
                if (linkedOrder) {
                    const io = req.app.get('io');
                    if (io) {
                        const hydratedLinkedOrder = await Order.getById(linkedOrder.id);
                        const finalLinkedOrder = hydratedLinkedOrder || linkedOrder;
                        emitToOrderAudiences(io, finalLinkedOrder, 'order:create', { order: finalLinkedOrder });
                        emitToOrderAudiences(io, finalLinkedOrder, 'order:update', {
                            orderId: finalLinkedOrder.id,
                            status: finalLinkedOrder.status,
                            order: finalLinkedOrder
                        });
                    }
                    void triggerOrderLifecycleEmail({
                        order: linkedOrder,
                        stage: 'confirmed',
                        includeInvoice: true
                    });
                    void triggerPaymentLifecycleCommunication({
                        order: linkedOrder,
                        stage: PAYMENT_STATUS.PAID,
                        payment: {
                            event,
                            paymentStatus: PAYMENT_STATUS.PAID,
                            paymentMethod: linkedOrder?.payment_gateway || 'razorpay',
                            paymentReference: razorpayPaymentId,
                            razorpayOrderId
                        }
                    });
                }
            } else {
                maybeTriggerConfirmedEmailOnPaymentTransition({
                    order: linkedOrder,
                    previousPaymentStatus: linkedOrder.payment_status,
                    currentPaymentStatus: paymentStatus,
                    includeInvoice: true
                });
                if (String(linkedOrder?.payment_status || '').toLowerCase() !== String(paymentStatus || '').toLowerCase()) {
                    void triggerPaymentLifecycleCommunication({
                        order: linkedOrder,
                        stage: paymentStatus,
                        payment: {
                            event,
                            paymentStatus,
                            paymentMethod: linkedOrder?.payment_gateway || 'razorpay',
                            paymentReference: razorpayPaymentId,
                            razorpayOrderId
                        }
                    });
                }
            }

            if (linkedOrder) {
                emitOrderAndPaymentUpdate(req, {
                    order: linkedOrder,
                    payment: {
                        event,
                        paymentStatus,
                        paymentMethod: linkedOrder?.payment_gateway || 'razorpay',
                        paymentReference: razorpayPaymentId,
                        razorpayOrderId
                    }
                });
            }
        }

        await WebhookEvent.markProcessed({
            eventId: webhookEventId,
            status: 'processed',
            note: `payment_status:${paymentStatus}`
        });
        return res.status(200).json({ ok: true, event, paymentStatus });
    } catch (error) {
        if (webhookEventId) {
            try {
                await WebhookEvent.markFailed({
                    eventId: webhookEventId,
                    note: error?.message || 'Webhook processing failed'
                });
            } catch {}
        }
        return res.status(500).json({ message: 'Webhook processing failed' });
    }
};

const createOrderFromCheckout = async (req, res) => {
    return res.status(400).json({
        message: 'Direct checkout is disabled. Please complete verified online payment before order creation.'
    });
};

const validateRecoveryCoupon = async (req, res) => {
    try {
        const userId = req.user.id;
        const code = String(req.body?.code || req.query?.code || '').trim().toUpperCase();
        if (!code) {
            return res.status(400).json({ message: 'Coupon code is required' });
        }
        const { shippingAddress = null } = req.body || {};
        const safeShippingAddress = shippingAddress ? normalizeAddressPayload(shippingAddress, { fieldLabel: 'Shipping address' }) : null;
        const summary = await Order.getCheckoutSummary(userId, {
            shippingAddress: safeShippingAddress,
            couponCode: code,
            allowSavedAddressFallback: true
        });
        return res.json({
            ok: true,
            code,
            discountTotal: Number(summary.couponDiscountTotal || summary.discountTotal || 0),
            total: Number(summary.total || 0),
            coupon: summary.coupon || null
        });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Coupon is invalid or expired' });
    }
};

const getAvailableCoupons = async (req, res) => {
    try {
        const userId = req.user.id;
        const { shippingAddress = null } = req.body || {};
        const safeShippingAddress = shippingAddress ? normalizeAddressPayload(shippingAddress, { fieldLabel: 'Shipping address' }) : null;
        const coupons = await Order.getAvailableCoupons(userId, { shippingAddress: safeShippingAddress });
        return res.json({ coupons });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to fetch available coupons' });
    }
};

const getAdminManualCoupons = async (req, res) => {
    try {
        const userId = String(req.body?.userId || '').trim();
        if (!userId) {
            return res.status(400).json({ message: 'Customer is required' });
        }
        const user = await User.findById(userId);
        if (!user || String(user.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const useCustomerCart = req.body?.useCustomerCart === true || String(req.body?.useCustomerCart || '').toLowerCase() === 'true';
        const coupons = useCustomerCart
            ? await Order.getAvailableCoupons(userId)
            : await Order.getAvailableCouponsForSelection({ userId, items: Array.isArray(req.body?.items) ? req.body.items : [] });
        return res.json({ coupons });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to fetch coupons' });
    }
};

const getAdminManualPreview = async (req, res) => {
    try {
        const userId = String(req.body?.userId || '').trim();
        if (!userId) {
            return res.status(400).json({ message: 'Customer is required' });
        }
        const user = await User.findById(userId);
        if (!user || String(user.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const shippingAddress = normalizeAddressPayload(req.body?.shippingAddress, { fieldLabel: 'Shipping address' });
        const couponCode = String(req.body?.couponCode || '').trim().toUpperCase() || null;
        const useCustomerCart = req.body?.useCustomerCart === true || String(req.body?.useCustomerCart || '').toLowerCase() === 'true';
        const quote = useCustomerCart
            ? await Order.getCheckoutSummary(userId, { shippingAddress, couponCode })
            : await Order.getAdminManualQuote(userId, {
                shippingAddress,
                couponCode,
                items: Array.isArray(req.body?.items) ? req.body.items : []
            });
        return res.json({ summary: quote });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to build order summary' });
    }
};

const getCustomerPopupData = async (req, res) => {
    try {
        const userId = req.user.id;
        const user = await User.findById(userId);
        const loyaltyTier = String(user?.loyaltyTier || 'regular').toLowerCase();
        const coupons = await Coupon.getActiveCouponsByUser({ userId, loyaltyTier });
        const latestCoupon = [...(Array.isArray(coupons) ? coupons : [])]
            .sort((a, b) => new Date(b?.createdAt || 0).getTime() - new Date(a?.createdAt || 0).getTime())[0] || null;
        const genericPopup = await LoyaltyPopupConfig.getClientActivePopup();
        let popupCoupon = null;
        if (genericPopup?.couponCode) {
            const couponRow = await Coupon.getByCode(genericPopup.couponCode);
            if (couponRow && Number(couponRow.is_active || 0) === 1) {
                const scope = String(couponRow.scope_type || 'generic').toLowerCase();
                if (scope !== 'tier' && scope !== 'customer') {
                    const categoryContext = await buildCategoryCouponContext(couponRow);
                    popupCoupon = {
                        id: couponRow.id,
                        code: couponRow.code,
                        name: couponRow.name || 'Special Offer',
                        sourceType: couponRow.source_type || 'admin',
                        scopeType: couponRow.scope_type || 'generic',
                        discountType: couponRow.discount_type || 'percent',
                        discountValue: Number(couponRow.discount_value || 0),
                        usageLimitPerUser: Number(couponRow.usage_limit_per_user || 1),
                        expiresAt: couponRow.expires_at || null,
                        createdAt: couponRow.created_at || null,
                        categoryIds: categoryContext?.categoryIds || [],
                        categoryNames: categoryContext?.categoryNames || [],
                        primaryCategoryName: categoryContext?.primaryCategoryName || '',
                        categoryLink: categoryContext?.categoryLink || '',
                        categoryNotice: categoryContext?.categoryNotice || ''
                    };
                }
            }
        }

        let latestCouponCategoryContext = null;
        if (String(latestCoupon?.scopeType || '').toLowerCase() === 'category' && latestCoupon?.id) {
            const fullCoupon = await Coupon.getById(latestCoupon.id);
            latestCouponCategoryContext = await buildCategoryCouponContext(fullCoupon);
        }
        const couponCandidate = latestCoupon ? {
            type: 'coupon',
            key: `coupon:${latestCoupon.id || latestCoupon.code}`,
            createdAt: latestCoupon.createdAt || null,
            title: 'Exclusive Coupon Unlocked',
            summary: `${latestCoupon.code || 'Coupon'} is now active for your account.`,
            content: String(latestCoupon?.scopeType || '').toLowerCase() === 'category' && latestCouponCategoryContext?.primaryCategoryName
                ? `${latestCoupon.code || 'This coupon'} is valid only for ${latestCouponCategoryContext.primaryCategoryName} category products.`
                : latestCoupon.sourceType === 'abandoned'
                ? 'We saved your cart offer. Use this recovery coupon before it expires.'
                : 'A new coupon has been issued for your account. Apply it during checkout.',
            encouragement: 'Great pick. Continue shopping and save more on your next order.',
            imageUrl: '',
            audioUrl: '',
            buttonLabel: latestCouponCategoryContext?.primaryCategoryName ? `Shop ${latestCouponCategoryContext.primaryCategoryName}` : 'Shop Now',
            buttonLink: latestCouponCategoryContext?.categoryLink || '/shop',
            coupon: {
                ...latestCoupon,
                categoryIds: latestCouponCategoryContext?.categoryIds || [],
                categoryNames: latestCouponCategoryContext?.categoryNames || [],
                primaryCategoryName: latestCouponCategoryContext?.primaryCategoryName || '',
                categoryLink: latestCouponCategoryContext?.categoryLink || '',
                categoryNotice: latestCouponCategoryContext?.categoryNotice || ''
            }
        } : null;

        const genericCandidate = genericPopup ? {
            type: 'generic',
            key: genericPopup.key || `generic:${genericPopup.id || 1}:${genericPopup.updatedAt || ''}`,
            createdAt: genericPopup.updatedAt || null,
            title: genericPopup.title || 'Special Offer',
            summary: genericPopup.summary || 'A new offer is available for you.',
            content: genericPopup.content || '',
            encouragement: genericPopup.encouragement || '',
            imageUrl: genericPopup.imageUrl || '',
            audioUrl: genericPopup.audioUrl || '',
            buttonLabel: genericPopup.buttonLabel || (popupCoupon?.primaryCategoryName ? `Shop ${popupCoupon.primaryCategoryName}` : 'Shop Now'),
            buttonLink: genericPopup.buttonLink || popupCoupon?.categoryLink || '/shop',
            coupon: popupCoupon
        } : null;

        const popup = genericCandidate || couponCandidate || null;
        return res.json({ popup });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load popup data' });
    }
};

const getPublicPopupData = async (req, res) => {
    try {
        const genericPopup = await LoyaltyPopupConfig.getClientActivePopup();
        let popupCoupon = null;

        if (genericPopup?.couponCode) {
            const couponRow = await Coupon.getByCode(genericPopup.couponCode);
            if (couponRow && Number(couponRow.is_active || 0) === 1) {
                const scope = String(couponRow.scope_type || 'generic').toLowerCase();
                if (scope === 'generic' || scope === 'category') {
                    const categoryContext = await buildCategoryCouponContext(couponRow);
                    popupCoupon = {
                        id: couponRow.id,
                        code: couponRow.code,
                        name: couponRow.name || 'Special Offer',
                        sourceType: couponRow.source_type || 'admin',
                        scopeType: couponRow.scope_type || 'generic',
                        discountType: couponRow.discount_type || 'percent',
                        discountValue: Number(couponRow.discount_value || 0),
                        usageLimitPerUser: Number(couponRow.usage_limit_per_user || 1),
                        expiresAt: couponRow.expires_at || null,
                        createdAt: couponRow.created_at || null,
                        categoryIds: categoryContext?.categoryIds || [],
                        categoryNames: categoryContext?.categoryNames || [],
                        primaryCategoryName: categoryContext?.primaryCategoryName || '',
                        categoryLink: categoryContext?.categoryLink || '',
                        categoryNotice: categoryContext?.categoryNotice || ''
                    };
                }
            }
        }

        const customPopupCandidate = genericPopup ? {
            type: 'generic',
            key: genericPopup.key || `generic:${genericPopup.id || 1}:${genericPopup.updatedAt || ''}`,
            createdAt: genericPopup.updatedAt || null,
            title: genericPopup.title || 'Special Offer',
            summary: genericPopup.summary || 'A special offer is available for you.',
            content: genericPopup.content || '',
            encouragement: genericPopup.encouragement || '',
            imageUrl: genericPopup.imageUrl || '',
            audioUrl: genericPopup.audioUrl || '',
            buttonLabel: genericPopup.buttonLabel || (popupCoupon?.primaryCategoryName ? `Shop ${popupCoupon.primaryCategoryName}` : 'Shop Now'),
            buttonLink: genericPopup.buttonLink || popupCoupon?.categoryLink || '/shop',
            coupon: popupCoupon
        } : null;

        const fallbackGenericCoupon = await Coupon.getLatestActiveGenericCoupon();
        const genericCouponCandidate = fallbackGenericCoupon ? {
            type: 'coupon',
            key: `generic-coupon:${fallbackGenericCoupon.id || fallbackGenericCoupon.code}`,
            createdAt: fallbackGenericCoupon.created_at || null,
            title: 'Special Coupon Unlocked',
            summary: `${fallbackGenericCoupon.code || 'Coupon'} is currently active.`,
            content: 'Use this coupon during checkout to unlock your savings.',
            encouragement: 'Browse your favorites and apply this offer before it expires.',
            imageUrl: '',
            audioUrl: '',
            buttonLabel: 'Shop Now',
            buttonLink: '/shop',
            coupon: {
                id: fallbackGenericCoupon.id,
                code: fallbackGenericCoupon.code,
                name: fallbackGenericCoupon.name || 'Special Offer',
                sourceType: fallbackGenericCoupon.source_type || 'admin',
                scopeType: fallbackGenericCoupon.scope_type || 'generic',
                discountType: fallbackGenericCoupon.discount_type || 'percent',
                discountValue: Number(fallbackGenericCoupon.discount_value || 0),
                usageLimitPerUser: Number(fallbackGenericCoupon.usage_limit_per_user || 1),
                expiresAt: fallbackGenericCoupon.expires_at || null,
                createdAt: fallbackGenericCoupon.created_at || null
            }
        } : null;

        const popup = customPopupCandidate || genericCouponCandidate || null;
        return res.json({ popup });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load popup data' });
    }
};

const getCheckoutSummary = async (req, res) => {
    try {
        const userId = req.user.id;
        if (req.body?.couponCode !== undefined && typeof req.body?.couponCode !== 'string') {
            return res.status(400).json({ message: 'Coupon code must be a string' });
        }
        const code = String(req.body?.couponCode || '').trim().toUpperCase() || null;
        const { shippingAddress = null } = req.body || {};
        const safeShippingAddress = shippingAddress ? normalizeAddressPayload(shippingAddress, { fieldLabel: 'Shipping address' }) : null;
        const summary = await Order.getCheckoutSummary(userId, {
            shippingAddress: safeShippingAddress,
            couponCode: code
        });
        return res.json({ summary });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to compute checkout summary' });
    }
};

const getAdminOrders = async (req, res) => {
    try {
        const MAX_RANGE_DAYS = 90;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const status = req.query.status || 'all';
        const search = req.query.search || '';
        const startDate = req.query.startDate || '';
        const endDate = req.query.endDate || '';
        const quickRangeRaw = String(req.query.quickRange || 'last_90_days').trim().toLowerCase();
        const quickRange = quickRangeRaw === 'last_30_days' ? 'last_1_month' : quickRangeRaw;
        const sortBy = req.query.sortBy || 'newest';
        const sourceChannel = String(req.query.sourceChannel || 'all').trim().toLowerCase();
        if (quickRange === 'custom') {
            const now = new Date();
            const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
            const end = endDate ? new Date(`${endDate}T00:00:00`) : null;
            if (start && end) {
                const diff = Math.floor((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
                if (Number.isFinite(diff) && diff > MAX_RANGE_DAYS) {
                    return res.status(400).json({ message: `Date range cannot exceed ${MAX_RANGE_DAYS} days` });
                }
            } else if (start) {
                const diff = Math.floor((now.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
                if (Number.isFinite(diff) && diff > MAX_RANGE_DAYS) {
                    return res.status(400).json({ message: `Start date cannot be older than ${MAX_RANGE_DAYS} days` });
                }
            } else if (end) {
                const diff = Math.floor((end.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
                if (Number.isFinite(diff) && diff > MAX_RANGE_DAYS) {
                    return res.status(400).json({ message: `End date cannot exceed ${MAX_RANGE_DAYS} days from today` });
                }
            }
        }
        const filters = { status, search, startDate, endDate, quickRange, sortBy, sourceChannel };
        const result = await Order.getPaginated({ page, limit, ...filters });
        const metrics = await Order.getMetrics(filters);
        res.json({ orders: result.orders, pagination: { currentPage: page, totalPages: result.totalPages, totalOrders: result.total }, metrics });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load orders' });
    }
};

const getAdminPaymentHealth = async (req, res) => {
    try {
        const summary = await Order.getAdminPaymentHealthSummary();
        return res.json({ summary });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load payment health summary' });
    }
};

const getAdminOrderById = async (req, res) => {
    try {
        const order = await Order.getById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Order not found' });
        res.json({ order });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load order' });
    }
};

const getMyOrders = async (req, res) => {
    try {
        const MAX_RANGE_DAYS = 90;
        const page = parseInt(req.query.page, 10) || 1;
        const limit = parseInt(req.query.limit, 10) || 10;
        const durationRaw = String(req.query.duration || `${MAX_RANGE_DAYS}`).trim().toLowerCase();
        let duration = durationRaw;
        if (duration === 'all') duration = `${MAX_RANGE_DAYS}`;
        if (duration !== 'latest_10') {
            const days = Number(duration);
            if (!Number.isFinite(days) || days <= 0) duration = `${MAX_RANGE_DAYS}`;
            if (Number.isFinite(days) && days > MAX_RANGE_DAYS) duration = `${MAX_RANGE_DAYS}`;
        }
        const result = await Order.getByUserPaginated({ userId: req.user.id, page, limit, duration });
        res.json({
            orders: result.orders,
            pagination: {
                currentPage: page,
                totalPages: result.totalPages,
                totalOrders: result.total
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Failed to load orders' });
    }
};

const getMyOrderByPaymentRef = async (req, res) => {
    try {
        const paymentId = String(req.params.paymentId || '').trim();
        if (!paymentId) {
            return res.status(400).json({ message: 'Payment reference is required' });
        }
        const order = await Order.getByRazorpayPaymentId(paymentId);
        if (!order || String(order.user_id) !== String(req.user.id)) {
            return res.status(404).json({ message: 'Order not found' });
        }
        return res.json({ order });
    } catch (error) {
        return res.status(500).json({ message: 'Failed to load order' });
    }
};

const updateOrderStatus = async (req, res) => {
    try {
        const {
            status,
            cancellationMode = '',
            manualRefundAmount = null,
            manualRefundMethod = '',
            manualRefundRef = '',
            manualRefundUtr = '',
            courierPartner = '',
            courierPartnerOther = '',
            awbNumber = ''
        } = req.body || {};
        const orderId = Number(req.params.id);
        if (!Number.isFinite(orderId) || orderId <= 0) {
            return res.status(400).json({ message: 'Invalid order id' });
        }
        const nextStatus = String(status || '').trim().toLowerCase();
        const existingOrder = await Order.getById(orderId);
        if (!existingOrder) {
            return res.status(404).json({ message: 'Order not found' });
        }
        const existingStatus = String(existingOrder?.status || '').toLowerCase();
        if (!isAllowedOrderTransition(existingStatus, nextStatus)) {
            return res.status(400).json({ message: `Order cannot move from ${existingStatus || 'confirmed'} to ${nextStatus || 'unknown'}` });
        }
        if (existingStatus === 'pending' && nextStatus === 'confirmed') {
            return res.status(400).json({ message: 'Pending orders cannot be moved back to confirmed' });
        }
        const refundAlreadyInitiated = Boolean(
            existingOrder?.refund_reference
            || existingOrder?.refund_status
            || String(existingOrder?.payment_status || '').toLowerCase() === PAYMENT_STATUS.REFUNDED
            || Number(existingOrder?.refund_amount || 0) > 0
        );
        if (
            String(existingOrder?.status || '').toLowerCase() === 'cancelled' &&
            refundAlreadyInitiated &&
            nextStatus !== 'cancelled'
        ) {
            return res.status(400).json({ message: 'Cancelled orders with initiated refunds cannot be moved to other statuses' });
        }

        let resolvedCourierPartner = '';
        let resolvedAwb = '';
        if (nextStatus === 'shipped') {
            const normalizedPartner = String(courierPartner || '').trim();
            const normalizedPartnerOther = String(courierPartnerOther || '').trim();
            const normalizedAwb = String(awbNumber || '').trim();
            if (!normalizedPartner) {
                return res.status(400).json({ message: 'Courier partner is required for shipped status' });
            }
            if (!normalizedAwb) {
                return res.status(400).json({ message: 'AWB number is required for shipped status' });
            }
            const isOther = normalizedPartner.toLowerCase() === 'others';
            if (!isOther && !SHIPPED_COURIER_OPTIONS.includes(normalizedPartner)) {
                return res.status(400).json({ message: 'Invalid courier partner selected' });
            }
            if (isOther && !normalizedPartnerOther) {
                return res.status(400).json({ message: 'Please enter courier partner name' });
            }
            resolvedCourierPartner = isOther ? normalizedPartnerOther : normalizedPartner;
            resolvedAwb = normalizedAwb;
        }

        const refundableBaseAmount = Math.max(
            0,
            Number(existingOrder?.total || 0) - Number(existingOrder?.shipping_fee || 0)
        );
        const paymentGateway = String(existingOrder?.payment_gateway || '').toLowerCase();
        const paymentStatus = String(existingOrder?.payment_status || '').toLowerCase();
        const canRazorpayRefund = (
            paymentGateway === 'razorpay'
            && paymentStatus === PAYMENT_STATUS.PAID
            && String(existingOrder?.razorpay_payment_id || '').trim()
        );

        let refund = null;
        let resolvedPaymentStatus = String(existingOrder?.payment_status || '').toLowerCase();
        let resolvedRefundMode = '';
        let resolvedRefundMethod = '';
        let resolvedManualRef = '';
        let resolvedManualUtr = '';
        let resolvedRefundCouponCode = '';
        let resolvedRefundAmount = null;
        let resolvedRefundReference = null;
        let resolvedRefundStatus = null;

        if (nextStatus === 'cancelled' && paymentStatus === PAYMENT_STATUS.PAID) {
            const mode = String(cancellationMode || '').trim().toLowerCase();
            if (!['razorpay', 'manual'].includes(mode)) {
                return res.status(400).json({ message: 'Select cancellation mode (Razorpay or Manual Refund)' });
            }
            resolvedRefundMode = mode;

            if (mode === 'razorpay') {
                resolvedRefundMethod = 'Razorpay Gateway';
                if (!canRazorpayRefund) {
                    return res.status(400).json({ message: 'Razorpay refund is not available for this order' });
                }
                const amountSubunits = Math.round(Math.max(0, refundableBaseAmount) * 100);
                if (!Number.isFinite(amountSubunits) || amountSubunits <= 0) {
                    return res.status(400).json({ message: 'Refundable amount is zero after excluding shipping charges' });
                }
                const razorpay = await createRazorpayClient();
                const paymentId = String(existingOrder.razorpay_payment_id).trim();
                const payload = {
                    speed: 'optimum',
                    amount: amountSubunits,
                    notes: {
                        order_ref: existingOrder.order_ref || '',
                        order_id: String(existingOrder.id),
                        non_refundable_shipping_fee: String(Number(existingOrder?.shipping_fee || 0))
                    },
                    receipt: `rfnd-${existingOrder.order_ref || existingOrder.id}-${Date.now()}`
                };

                refund = await razorpay.payments.refund(paymentId, payload);
                resolvedRefundReference = refund?.id || null;
                resolvedRefundAmount = refund?.amount != null ? Number(refund.amount) / 100 : refundableBaseAmount;
                resolvedRefundStatus = refund?.status || null;
                resolvedPaymentStatus = PAYMENT_STATUS.REFUNDED;

                await Order.updatePaymentByRazorpayOrderId({
                    razorpayOrderId: existingOrder.razorpay_order_id,
                    paymentStatus: PAYMENT_STATUS.REFUNDED,
                    razorpayPaymentId: paymentId,
                    refundReference: resolvedRefundReference,
                    refundAmount: resolvedRefundAmount,
                    refundStatus: resolvedRefundStatus
                });
            } else {
                const method = String(manualRefundMethod || '').trim();
                const amount = Number(manualRefundAmount);
                if (!MANUAL_REFUND_METHODS.includes(method)) {
                    return res.status(400).json({ message: 'Select a valid manual refund method' });
                }
                if (!Number.isFinite(amount) || amount <= 0) {
                    return res.status(400).json({ message: 'Enter refunded amount for manual refund' });
                }
                if (amount > refundableBaseAmount) {
                    return res.status(400).json({ message: `Refund amount cannot exceed ₹${refundableBaseAmount.toLocaleString('en-IN')}. Shipping charge is non-refundable.` });
                }
                const ref = String(manualRefundRef || '').trim();
                const utr = String(manualRefundUtr || '').trim();
                if (method === 'NEFT/RTGS' && !utr) {
                    return res.status(400).json({ message: 'UTR number is required for NEFT/RTGS refunds' });
                }
                if ((method === 'UPI' || method === 'Bank A/c Transfer') && !ref) {
                    return res.status(400).json({ message: `Reference number is required for ${method}` });
                }
                resolvedRefundMethod = method;
                resolvedManualRef = ref;
                resolvedManualUtr = utr;
                resolvedRefundAmount = amount;
                resolvedRefundStatus = 'manual_recorded';
                resolvedPaymentStatus = PAYMENT_STATUS.REFUNDED;

                if (method === 'Voucher code') {
                    if (!existingOrder?.user_id) {
                        return res.status(400).json({ message: 'Cannot issue voucher for guest order' });
                    }
                    const expiresAt = new Date(Date.now() + (180 * 24 * 60 * 60 * 1000));
                    const voucherCoupon = await Coupon.createCoupon({
                        prefix: 'RFND',
                        name: `Refund voucher for ${existingOrder.order_ref || existingOrder.id}`,
                        description: `Manual voucher refund generated for cancelled order ${existingOrder.order_ref || existingOrder.id}`,
                        sourceType: 'admin',
                        scopeType: 'customer',
                        discountType: 'fixed',
                        discountValue: amount,
                        minCartValue: 0,
                        usageLimitPerUser: 1,
                        usageLimitTotal: 1,
                        customerTargets: [String(existingOrder.user_id)],
                        expiresAt,
                        metadata: {
                            reason: 'order_cancellation_manual_refund_voucher',
                            orderId: existingOrder.id,
                            orderRef: existingOrder.order_ref || null
                        }
                    }, { createdBy: req.user?.id || null });
                    resolvedRefundCouponCode = String(voucherCoupon?.code || '').trim().toUpperCase();
                    resolvedManualRef = resolvedRefundCouponCode ? `VOUCHER-${resolvedRefundCouponCode}` : resolvedManualRef;
                }
            }
        }

        // Keep older automation path for backward compatibility when an existing API client still sends processRefund=true.
        if (
            nextStatus === 'cancelled' &&
            !resolvedRefundMode &&
            Boolean(req.body?.processRefund) &&
            String(existingOrder?.payment_gateway || '').toLowerCase() === 'razorpay' &&
            String(existingOrder?.payment_status || '').toLowerCase() === PAYMENT_STATUS.PAID &&
            String(existingOrder?.razorpay_payment_id || '').trim()
        ) {
            const razorpay = await createRazorpayClient();
            const paymentId = String(existingOrder.razorpay_payment_id).trim();
            const amountSubunits = Math.round(Math.max(0, refundableBaseAmount) * 100);
            const payload = {
                speed: 'optimum',
                notes: {
                    order_ref: existingOrder.order_ref || '',
                    order_id: String(existingOrder.id),
                    non_refundable_shipping_fee: String(Number(existingOrder?.shipping_fee || 0))
                },
                receipt: `rfnd-${existingOrder.order_ref || existingOrder.id}-${Date.now()}`
            };
            if (amountSubunits && Number.isFinite(amountSubunits) && amountSubunits > 0) {
                payload.amount = amountSubunits;
            }

            refund = await razorpay.payments.refund(paymentId, payload);
            resolvedRefundMode = 'razorpay';
            resolvedRefundAmount = refund?.amount != null ? Number(refund.amount) / 100 : refundableBaseAmount;
            resolvedRefundReference = refund?.id || null;
            resolvedRefundStatus = refund?.status || null;
            resolvedPaymentStatus = PAYMENT_STATUS.REFUNDED;
            await Order.updatePaymentByRazorpayOrderId({
                razorpayOrderId: existingOrder.razorpay_order_id,
                paymentStatus: PAYMENT_STATUS.REFUNDED,
                razorpayPaymentId: paymentId,
                refundReference: resolvedRefundReference,
                refundAmount: resolvedRefundAmount,
                refundStatus: resolvedRefundStatus
            });
        }

        await Order.updateStatus(req.params.id, nextStatus, {
            courierPartner: resolvedCourierPartner || null,
            awbNumber: resolvedAwb || null,
            paymentStatus: resolvedPaymentStatus || null,
            refundReference: resolvedRefundReference || resolvedManualRef || null,
            refundAmount: resolvedRefundAmount != null ? Number(resolvedRefundAmount) : null,
            refundStatus: resolvedRefundStatus || null,
            refundMode: resolvedRefundMode || null,
            refundMethod: resolvedRefundMethod || null,
            manualRefundRef: resolvedManualRef || null,
            manualRefundUtr: resolvedManualUtr || null,
            refundCouponCode: resolvedRefundCouponCode || null,
            refundNotes: nextStatus === 'cancelled' ? {
                cancellationMode: resolvedRefundMode || null,
                manualRefundMethod: resolvedRefundMethod || null,
                manualRefundRef: resolvedManualRef || null,
                manualRefundUtr: resolvedManualUtr || null,
                refundableBaseAmount,
                nonRefundableShippingFee: Number(existingOrder?.shipping_fee || 0),
                refundAmount: resolvedRefundAmount,
                refundReference: resolvedRefundReference,
                refundStatus: resolvedRefundStatus,
                refundCouponCode: resolvedRefundCouponCode || null
            } : null,
            actorUserId: req.user?.id || null,
            restoreInventory: (
                String(existingOrder?.status || '').toLowerCase() !== 'cancelled'
                && String(nextStatus || '').toLowerCase() === 'cancelled'
            )
        });
        const order = await Order.getById(req.params.id);
        const io = req.app.get('io');
        if (io) {
            emitToOrderAudiences(io, order, 'order:update', { orderId: req.params.id, status: nextStatus, order });
        }
        if (
            order?.user_id
            && String(existingOrder?.status || '').toLowerCase() !== String(nextStatus || '').toLowerCase()
            && ['cancelled', 'refunded'].includes(String(nextStatus || '').toLowerCase())
        ) {
            await reassessUserTier(order.user_id, { reason: 'order_status_reversal', sendNotifications: false }).catch(() => {});
        }
        void triggerOrderLifecycleEmail({
            order,
            stage: nextStatus === 'pending' ? 'pending_delay' : nextStatus,
            includeInvoice: false
        });
        if (String(existingOrder?.payment_status || '').toLowerCase() !== String(order?.payment_status || '').toLowerCase()) {
            void triggerPaymentLifecycleCommunication({
                order,
                stage: order?.payment_status || resolvedPaymentStatus,
                payment: {
                    paymentStatus: order?.payment_status || resolvedPaymentStatus,
                    paymentMethod: order?.payment_gateway || existingOrder?.payment_gateway || 'razorpay',
                    paymentReference: order?.razorpay_payment_id || existingOrder?.razorpay_payment_id || null,
                    razorpayOrderId: order?.razorpay_order_id || existingOrder?.razorpay_order_id || null,
                    refundReference: order?.refund_reference || resolvedRefundReference || resolvedManualRef || null,
                    refundAmount: order?.refund_amount ?? resolvedRefundAmount ?? null,
                    refundStatus: order?.refund_status || resolvedRefundStatus || null
                }
            });
        }
        res.json({ order, refund });
    } catch (error) {
        res.status(400).json({ message: error.message || 'Failed to update order' });
    }
};

const getOverdueShippedSummary = async (req, res) => {
    try {
        const days = Math.max(1, Number(req.query.days || 30) || 30);
        const limit = Math.max(1, Math.min(10, Number(req.query.limit || 5) || 5));
        const summary = await Order.getOverdueShippedSummary({ afterDays: days, limit });
        return res.json(summary);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to load overdue shipped summary' });
    }
};

const confirmDeliveryBySignedLink = async (req, res) => {
    try {
        const { oid, uid, exp, sig } = req.query || {};
        const verified = verifyDeliveryToken({ orderId: oid, userId: uid, exp, sig });
        if (!verified.ok) {
            return res.status(400).send('<h3>Delivery confirmation link is invalid or expired.</h3>');
        }

        const order = await Order.getById(verified.orderId);
        if (!order || String(order.user_id) !== String(verified.userId)) {
            return res.status(404).send('<h3>Order not found.</h3>');
        }
        if (String(order.status || '').toLowerCase() !== 'shipped') {
            return res.send('<h3>Delivery status already updated. Thank you.</h3>');
        }

        await Order.updateStatus(order.id, 'completed');
        const updated = await Order.getById(order.id);
        const io = req.app.get('io');
        if (io && updated) {
            emitToOrderAudiences(io, updated, 'order:update', { orderId: updated.id, status: 'completed', order: updated });
        }
        void triggerOrderLifecycleEmail({
            order: updated,
            stage: 'completed',
            includeInvoice: false
        });

        return res.send('<h3>Thank you. Your delivery confirmation has been recorded successfully.</h3>');
    } catch (error) {
        return res.status(400).send(`<h3>${error?.message || 'Unable to confirm delivery.'}</h3>`);
    }
};

const deleteAdminOrder = async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        if (!Number.isFinite(orderId) || orderId <= 0) {
            return res.status(400).json({ message: 'Invalid order id' });
        }

        const order = await Order.getById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const status = String(order?.status || '').toLowerCase();
        const paymentStatus = String(order?.payment_status || '').toLowerCase();
        const hasFinancialRecord = Boolean(
            ['paid', 'refunded'].includes(paymentStatus)
            || String(order?.razorpay_payment_id || '').trim()
            || String(order?.refund_reference || '').trim()
            || String(order?.refund_status || '').trim()
            || Number(order?.refund_amount || 0) > 0
            || String(order?.settlement_id || '').trim()
        );
        const hasFulfilmentRecord = ['shipped', 'completed'].includes(status);
        if (hasFinancialRecord || hasFulfilmentRecord) {
            return res.status(400).json({ message: 'This order cannot be deleted. Use status updates instead.' });
        }

        const deleted = await Order.deleteById(orderId);
        if (!deleted) {
            return res.status(400).json({ message: 'Failed to delete order' });
        }

        const io = req.app.get('io');
        if (io) {
            emitToOrderAudiences(io, order, 'order:update', { orderId, deleted: true, status: 'deleted' });
        }

        return res.json({ ok: true, id: orderId });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete order' });
    }
};

const deleteAdminPaymentAttempt = async (req, res) => {
    try {
        const attemptId = Number(req.params.id);
        if (!Number.isFinite(attemptId) || attemptId <= 0) {
            return res.status(400).json({ message: 'Invalid attempt id' });
        }

        const attempt = await PaymentAttempt.getById(attemptId);
        if (!attempt || attempt.local_order_id) {
            return res.status(404).json({ message: 'Attempt not found' });
        }
        if (String(attempt.status || '').toLowerCase() === PAYMENT_STATUS.PAID) {
            return res.status(400).json({ message: 'Paid attempts cannot be deleted' });
        }

        await releaseAttemptInventoryAndEmit(req, {
            attemptId,
            reason: 'admin_delete'
        });

        const deleted = await PaymentAttempt.deleteById(attemptId);
        if (!deleted) {
            return res.status(400).json({ message: 'Failed to delete attempt' });
        }

        return res.json({ ok: true, id: attemptId });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to delete attempt' });
    }
};

const convertAdminPaymentAttemptToOrder = async (req, res) => {
    try {
        if (String(req.user?.role || '').toLowerCase() !== 'admin') {
            return res.status(403).json({ message: 'Only admins can convert payment attempts manually' });
        }
        const attemptId = Number(req.params.id);
        if (!Number.isFinite(attemptId) || attemptId <= 0) {
            return res.status(400).json({ message: 'Invalid attempt id' });
        }
        const paymentMode = String(req.body?.paymentMode || 'manual').trim().toLowerCase();
        const paymentReference = String(req.body?.paymentReference || '').trim();
        const conversionReason = String(req.body?.conversionReason || '').trim();
        if (!MANUAL_PAYMENT_MODES.includes(paymentMode)) {
            return res.status(400).json({ message: 'Select a valid manual payment mode' });
        }
        if (conversionReason.length < 8) {
            return res.status(400).json({ message: 'Enter a clear conversion reason (minimum 8 characters)' });
        }

        const attempt = await PaymentAttempt.getById(attemptId);
        if (!attempt) {
            return res.status(404).json({ message: 'Attempt not found' });
        }
        const safeAttemptStatuses = new Set([
            PAYMENT_STATUS.CREATED,
            PAYMENT_STATUS.ATTEMPTED,
            PAYMENT_STATUS.FAILED,
            PAYMENT_STATUS.EXPIRED
        ]);
        if (!safeAttemptStatuses.has(String(attempt.status || '').toLowerCase())) {
            return res.status(400).json({ message: 'Only open or failed attempts can be converted manually' });
        }
        if (attempt.local_order_id) {
            const existingOrder = await Order.getById(attempt.local_order_id);
            if (existingOrder) {
                return res.json({ order: existingOrder, attempt });
            }
            return res.status(400).json({ message: 'Attempt is already linked to an order' });
        }

        const order = await Order.createManualOrderFromAttempt({
            attempt,
            paymentGateway: paymentMode,
            paymentReference,
            auditReason: conversionReason,
            actorUserId: req.user?.id || null
        });
        if (!order) {
            return res.status(400).json({ message: 'Unable to convert payment attempt' });
        }

        const updatedAttempt = await PaymentAttempt.getById(attempt.id);
        const io = req.app.get('io');
        if (io) {
            emitToOrderAudiences(io, order, 'order:update', { orderId: order.id, status: order.status, order });
        }
        emitCouponChangedForOrder(req, order);
        void triggerOrderLifecycleEmail({
            order,
            stage: 'confirmed',
            includeInvoice: true
        });

        return res.json({ order, attempt: updatedAttempt || null });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to convert attempt to order' });
    }
};

const createAdminManualOrder = async (req, res) => {
    try {
        const userId = String(req.body?.userId || '').trim();
        if (!userId) {
            return res.status(400).json({ message: 'Customer is required' });
        }
        const user = await User.findById(userId);
        if (!user || String(user.role || '').toLowerCase() !== 'customer') {
            return res.status(404).json({ message: 'Customer not found' });
        }
        const shippingAddress = normalizeAddressPayload(req.body?.shippingAddress, { fieldLabel: 'Shipping address' });
        const billingAddress = normalizeAddressPayload(req.body?.billingAddress, { fieldLabel: 'Billing address' });
        const couponCode = String(req.body?.couponCode || '').trim().toUpperCase() || null;
        const useCustomerCart = req.body?.useCustomerCart === true || String(req.body?.useCustomerCart || '').toLowerCase() === 'true';
        const items = Array.isArray(req.body?.items) ? req.body.items : [];
        const paymentMode = String(req.body?.paymentMode || 'manual').trim().toLowerCase();
        const paymentReference = String(req.body?.paymentReference || '').trim();
        if (!MANUAL_PAYMENT_MODES.includes(paymentMode)) {
            return res.status(400).json({ message: 'Select a valid manual payment mode' });
        }
        const order = useCustomerCart
            ? await Order.createFromCart(userId, {
                billingAddress,
                shippingAddress,
                payment: {
                    paymentStatus: 'paid',
                    gateway: paymentMode,
                    paymentReference
                },
                couponCode,
                sourceChannel: 'admin_manual'
            })
            : await Order.createAdminManualOrder(userId, {
                billingAddress,
                shippingAddress,
                payment: {
                    paymentStatus: 'paid',
                    gateway: paymentMode,
                    paymentReference
                },
                couponCode,
                sourceChannel: 'admin_manual',
                items
            });
        if (!order?.id) {
            return res.status(400).json({ message: 'Failed to create manual order' });
        }
        await User.updateProfile(userId, {
            address: shippingAddress || null,
            billingAddress: billingAddress || shippingAddress || null
        });
        const persisted = await Order.getById(order.id);
        const finalOrder = persisted || order;
        const paymentPayload = {
            paymentStatus: PAYMENT_STATUS.PAID,
            paymentMethod: paymentMode,
            paymentReference: paymentReference || null
        };
        const io = req.app.get('io');
        if (io && finalOrder) {
            emitToOrderAudiences(io, finalOrder, 'order:create', { order: finalOrder });
            emitToOrderAudiences(io, finalOrder, 'order:update', {
                orderId: finalOrder.id,
                status: finalOrder.status,
                order: finalOrder
            });
            emitToOrderAudiences(io, finalOrder, 'payment:update', {
                orderId: finalOrder.id,
                status: finalOrder.status,
                order: finalOrder,
                payment: paymentPayload
            });
        }
        await emitProductUpdatesForIds(req, collectOrderProductIds(finalOrder));
        emitCouponChangedForOrder(req, finalOrder);
        void triggerOrderLifecycleEmail({
            order: finalOrder,
            stage: 'confirmed',
            includeInvoice: true
        });
        void triggerPaymentLifecycleCommunication({
            order: finalOrder,
            stage: PAYMENT_STATUS.PAID,
            payment: paymentPayload
        });
        return res.status(201).json({ order: finalOrder });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to create manual order' });
    }
};

const fetchAdminPaymentStatus = async (req, res) => {
    try {
        const razorpayConfig = await getRazorpayConfig();
        const isRazorpayTestMode = String(razorpayConfig?.keyId || '').trim().toLowerCase().startsWith('rzp_test_');
        const {
            orderId = null,
            attemptId = null,
            razorpayOrderId: inputRazorpayOrderId = null,
            razorpayPaymentId: inputRazorpayPaymentId = null
        } = req.body || {};

        const numericOrderId = Number(orderId);
        const numericAttemptId = Number(attemptId);

        const order = Number.isFinite(numericOrderId) && numericOrderId > 0
            ? await Order.getById(numericOrderId)
            : null;
        const attempt = Number.isFinite(numericAttemptId) && numericAttemptId > 0
            ? await PaymentAttempt.getById(numericAttemptId)
            : null;

        let razorpayOrderId = String(
            inputRazorpayOrderId ||
            order?.razorpay_order_id ||
            attempt?.razorpay_order_id ||
            ''
        ).trim();
        let razorpayPaymentId = String(
            inputRazorpayPaymentId ||
            order?.razorpay_payment_id ||
            attempt?.razorpay_payment_id ||
            ''
        ).trim();

        if (!razorpayOrderId && !razorpayPaymentId) {
            return res.status(400).json({ message: 'Razorpay order or payment reference is required' });
        }

        const razorpay = await createRazorpayClient();
        let razorpayOrder = null;
        let paymentDetails = null;

        if (razorpayOrderId) {
            try {
                razorpayOrder = await razorpay.orders.fetch(razorpayOrderId);
            } catch {}
        }

        if (razorpayPaymentId) {
            try {
                paymentDetails = await razorpay.payments.fetch(razorpayPaymentId);
                if (!razorpayOrderId && paymentDetails?.order_id) {
                    razorpayOrderId = String(paymentDetails.order_id).trim();
                }
            } catch {}
        }

        // If payment id is not known locally, try resolving latest payment from the Razorpay order.
        if (!paymentDetails && razorpayOrder?.id) {
            try {
                const paymentList = await razorpay.payments.all({
                    order_id: razorpayOrder.id,
                    count: 1
                });
                const candidate = Array.isArray(paymentList?.items) ? paymentList.items[0] : null;
                if (candidate?.id) {
                    paymentDetails = candidate;
                    razorpayPaymentId = candidate.id;
                }
            } catch {}
        }

        let paymentStatus = mapRazorpayOrderStatusToLocalPayment(razorpayOrder?.status);
        const paymentStatusFromPayment = mapRazorpayPaymentStatusToLocalPayment(paymentDetails?.status);
        const refundedSubunits = Number(paymentDetails?.amount_refunded || 0);
        const refundStatusFromGateway = String(paymentDetails?.refund_status || '').trim().toLowerCase();
        const refundSignalFromGateway = (
            refundedSubunits > 0
            || Boolean(refundStatusFromGateway)
            || String(paymentDetails?.status || '').toLowerCase() === 'refunded'
        );
        const existingStatus = String(order?.payment_status || attempt?.status || 'pending').toLowerCase();

        // Razorpay payment can stay "captured" even after refund. Prefer explicit refund signals.
        if (refundSignalFromGateway) {
            paymentStatus = PAYMENT_STATUS.REFUNDED;
        } else if (paymentStatusFromPayment) {
            paymentStatus = paymentStatusFromPayment;
        }
        if (!paymentStatus) {
            paymentStatus = existingStatus;
        }
        // Never regress from refunded to paid when gateway payload has no refund metadata.
        if (existingStatus === PAYMENT_STATUS.REFUNDED && paymentStatus === PAYMENT_STATUS.PAID && !refundSignalFromGateway) {
            paymentStatus = PAYMENT_STATUS.REFUNDED;
        }

        const settlementId = String(
            paymentDetails?.settlement_id
            || order?.settlement_id
            || ''
        ).trim() || null;
        const settlementSnapshot = settlementId
            ? await fetchSettlementSnapshotSafe(razorpay, settlementId)
            : null;
        let previousLinkedPaymentStatus = order?.payment_status || null;

        if (razorpayOrderId) {
            const existingLinkedOrder = await Order.getByRazorpayOrderId(razorpayOrderId);
            previousLinkedPaymentStatus = existingLinkedOrder?.payment_status || previousLinkedPaymentStatus;
            if (paymentStatus === PAYMENT_STATUS.PAID || paymentStatus === PAYMENT_STATUS.REFUNDED) {
                await PaymentAttempt.markPaidByRazorpayOrder({
                    razorpayOrderId,
                    paymentId: razorpayPaymentId || null
                });
            } else if (paymentStatus === PAYMENT_STATUS.FAILED) {
                const existingAttempt = await PaymentAttempt.getByRazorpayOrderIdAny(razorpayOrderId);
                if (existingAttempt) {
                    await releaseAttemptInventoryAndEmit(req, {
                        attemptId: existingAttempt.id,
                        reason: 'payment_failed'
                    });
                }
                await PaymentAttempt.markFailedByRazorpayOrder({
                    razorpayOrderId,
                    paymentId: razorpayPaymentId || null,
                    errorMessage: paymentDetails?.error_description || 'Payment failed'
                });
            } else {
                await PaymentAttempt.markAttemptedByRazorpayOrder({
                    razorpayOrderId,
                    paymentId: razorpayPaymentId || null
                });
            }

            await Order.updatePaymentByRazorpayOrderId({
                razorpayOrderId,
                paymentStatus,
                razorpayPaymentId: razorpayPaymentId || null,
                settlementId,
                settlementSnapshot,
                refundReference: null,
                refundAmount: paymentDetails?.amount_refunded != null
                    ? Number(paymentDetails.amount_refunded || 0) / 100
                    : null,
                refundStatus: paymentDetails?.refund_status || null
            });
        }

        const updatedOrder = razorpayOrderId
            ? await Order.getByRazorpayOrderId(razorpayOrderId)
            : order;
        if (updatedOrder) {
            maybeTriggerConfirmedEmailOnPaymentTransition({
                order: updatedOrder,
                previousPaymentStatus: previousLinkedPaymentStatus,
                currentPaymentStatus: paymentStatus,
                includeInvoice: true
            });
            if (String(previousLinkedPaymentStatus || '').toLowerCase() !== String(paymentStatus || '').toLowerCase()) {
                void triggerPaymentLifecycleCommunication({
                    order: updatedOrder,
                    stage: paymentStatus,
                    payment: {
                        event: 'admin.fetch_status',
                        paymentStatus,
                        paymentMethod: paymentDetails?.method || updatedOrder?.payment_gateway || 'razorpay',
                        paymentReference: razorpayPaymentId || null,
                        razorpayOrderId: razorpayOrderId || null
                    }
                });
            }
            if (paymentStatus === PAYMENT_STATUS.PAID) {
                try {
                    await markRecoveredByOrder({ order: updatedOrder, reason: 'payment_paid_admin_sync' });
                } catch {}
            }
            emitOrderAndPaymentUpdate(req, {
                order: updatedOrder,
                payment: {
                    event: 'admin.fetch_status',
                    paymentStatus,
                    paymentMethod: paymentDetails?.method || updatedOrder?.payment_gateway || 'razorpay',
                    paymentReference: razorpayPaymentId || null,
                    razorpayOrderId: razorpayOrderId || null
                },
                silent: true
            });
        }

        const updatedAttempt = attempt
            ? await PaymentAttempt.getById(attempt.id)
            : (razorpayOrderId ? await PaymentAttempt.getByRazorpayOrderIdAny(razorpayOrderId) : null);

        return res.json({
            ok: true,
            paymentStatus,
            order: updatedOrder || null,
            attempt: updatedAttempt || null,
            settlementContext: {
                mode: isRazorpayTestMode ? 'test' : 'live',
                isTestMode: isRazorpayTestMode
            },
            razorpay: {
                order: razorpayOrder ? {
                    id: razorpayOrder.id,
                    status: razorpayOrder.status,
                    amount: razorpayOrder.amount,
                    amount_paid: razorpayOrder.amount_paid,
                    amount_due: razorpayOrder.amount_due,
                    offers: razorpayOrder.offers || [],
                    promotions: razorpayOrder.promotions || [],
                    customer_details: razorpayOrder.customer_details || null,
                    shipping_fee: razorpayOrder.shipping_fee ?? null
                } : null,
                payment: paymentDetails ? {
                    id: paymentDetails.id,
                    status: paymentDetails.status,
                    method: paymentDetails.method || null,
                    error_description: paymentDetails.error_description || null,
                    error_reason: paymentDetails.error_reason || null
                } : null,
                settlement: settlementSnapshot
            }
        });
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to fetch payment status' });
    }
};

const fetchMyPaymentStatus = async (req, res) => {
    try {
        const numericOrderId = Number(req.body?.orderId);
        if (!Number.isFinite(numericOrderId) || numericOrderId <= 0) {
            return res.status(400).json({ message: 'Valid order id is required' });
        }

        const order = await Order.getById(numericOrderId);
        if (!order || String(order.user_id) !== String(req.user.id)) {
            return res.status(404).json({ message: 'Order not found' });
        }

        const razorpayOrderId = String(order?.razorpay_order_id || '').trim();
        const razorpayPaymentId = String(order?.razorpay_payment_id || '').trim();
        if (!razorpayOrderId && !razorpayPaymentId) {
            return res.status(400).json({ message: 'Razorpay reference not available for this order' });
        }

        req.body = {
            orderId: numericOrderId,
            attemptId: null,
            razorpayOrderId,
            razorpayPaymentId
        };
        return fetchAdminPaymentStatus(req, res);
    } catch (error) {
        return res.status(400).json({ message: error?.message || 'Failed to fetch refund status' });
    }
};

const hydrateOrderForInvoice = async (order = {}) => {
    let orderForInvoice = { ...(order || {}) };
    try {
        const snapshot = orderForInvoice.company_snapshot && typeof orderForInvoice.company_snapshot === 'object'
            ? { ...orderForInvoice.company_snapshot }
            : {};
        const missingAddress = !String(snapshot.address || '').trim();
        const missingSupport = !String(snapshot.supportEmail || '').trim();
        const missingContact = !String(snapshot.contactNumber || '').trim();
        if (missingAddress || missingSupport || missingContact) {
            const profile = await CompanyProfile.get();
            orderForInvoice.company_snapshot = {
                ...profile,
                ...snapshot,
                address: snapshot.address || profile.address || '',
                supportEmail: snapshot.supportEmail || profile.supportEmail || '',
                contactNumber: snapshot.contactNumber || profile.contactNumber || ''
            };
        }
    } catch {}
    return orderForInvoice;
};

const triggerOrderLifecycleEmail = async ({
    order = null,
    stage = 'updated',
    includeInvoice = false
} = {}) => {
    const orderUserId = order?.user_id || order?.userId || null;
    if (!orderUserId) return;
    try {
        const hydratedOrder = order?.id ? await Order.getById(order.id) : null;
        const orderForCommunication = hydratedOrder || order;
        const customer = await User.findById(orderForCommunication.user_id || orderForCommunication.userId || orderUserId);
        if (!customer?.email) {
            console.warn(`Order lifecycle email skipped for order ${orderForCommunication?.id || order?.id || 'unknown'}: missing customer email`);
            return;
        }
        let invoiceAttachment = null;
        const stageKey = String(stage || '').trim().toLowerCase();
        const paymentStatus = String(orderForCommunication?.payment_status || '').trim().toLowerCase();
        const shouldAttachInvoice = Boolean(includeInvoice)
            || (
                ['confirmed', 'confirmation', 'processing', 'shipped', 'shipped_followup', 'completed', 'delivered', 'cancelled', 'updated']
                    .includes(stageKey)
                && ['paid', 'refunded'].includes(paymentStatus)
            );
        if (shouldAttachInvoice) {
            try {
                const orderForInvoice = await hydrateOrderForInvoice(orderForCommunication);
                const pdfBuffer = await buildInvoicePdfBuffer(orderForInvoice);
                const invoiceRef = String(orderForCommunication?.order_ref || orderForCommunication?.id || Date.now()).replace(/[^a-zA-Z0-9-_]/g, '');
                invoiceAttachment = {
                    filename: `invoice-${invoiceRef}.pdf`,
                    content: pdfBuffer,
                    contentType: 'application/pdf'
                };
            } catch (invoiceError) {
                console.error(`Invoice attachment generation failed for order ${orderForCommunication?.id || 'unknown'}:`, invoiceError?.message || invoiceError);
            }
        }
        const includeInvoiceInMail = shouldAttachInvoice && Boolean(invoiceAttachment);
        const result = await sendOrderLifecycleCommunication({
            stage,
            customer,
            order: orderForCommunication,
            includeInvoice: includeInvoiceInMail,
            invoiceAttachment
        });
        if (result?.email?.ok !== true) {
            console.error(
                `Order lifecycle email send failed for order ${orderForCommunication?.id || 'unknown'}:`,
                result?.email?.reason || result?.email?.message || 'unknown_reason'
            );
        }
    } catch (error) {
        console.error(`Order lifecycle email failed for order ${order?.id || 'unknown'}:`, error?.message || error);
    }
};

const triggerPaymentLifecycleCommunication = async ({
    order = null,
    payment = {},
    stage = '',
    userId = null,
    orderRef = null
} = {}) => {
    const orderUserId = userId || order?.user_id || order?.userId || null;
    if (!orderUserId) return;
    try {
        const hydratedOrder = order?.id ? await Order.getById(order.id) : null;
        const orderForCommunication = hydratedOrder || order || {};
        const customer = await User.findById(orderUserId);
        if (!customer?.email && !customer?.mobile) {
            console.warn(`Payment lifecycle communication skipped for user ${orderUserId}: missing customer channels`);
            return;
        }
        const safeStage = String(stage || payment?.paymentStatus || orderForCommunication?.payment_status || 'updated').trim().toLowerCase();
        const result = await sendPaymentLifecycleCommunication({
            stage: safeStage,
            customer,
            order: {
                ...orderForCommunication,
                user_id: orderForCommunication?.user_id || orderUserId,
                order_ref: orderForCommunication?.order_ref || orderForCommunication?.orderRef || orderRef || payment?.razorpayOrderId || 'N/A'
            },
            payment
        });
        if (result?.email?.ok !== true && result?.whatsapp?.ok !== true) {
            console.error(
                `Payment lifecycle communication failed for user ${orderUserId}:`,
                result?.email?.reason || result?.whatsapp?.reason || 'unknown_reason'
            );
        }
    } catch (error) {
        console.error(`Payment lifecycle communication failed for user ${orderUserId}:`, error?.message || error);
    }
};

const sendInvoicePdf = async (res, order) => {
    const paymentStatus = String(order?.payment_status || '').toLowerCase();
    if (![PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED].includes(paymentStatus)) {
        return res.status(400).json({ message: 'Invoice is available only for paid or refunded orders' });
    }
    const orderForInvoice = await hydrateOrderForInvoice(order);
    const pdfBuffer = await buildInvoicePdfBuffer(orderForInvoice);
    const invoiceRef = String(order?.order_ref || order?.id || Date.now()).replace(/[^a-zA-Z0-9-_]/g, '');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=\"invoice-${invoiceRef}.pdf\"`);
    res.setHeader('Cache-Control', 'no-store');
    return res.send(pdfBuffer);
};

const downloadMyInvoicePdf = async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        if (!Number.isFinite(orderId) || orderId <= 0) {
            return res.status(400).json({ message: 'Invalid order id' });
        }
        const order = await Order.getById(orderId);
        if (!order || String(order.user_id) !== String(req.user.id)) {
            return res.status(404).json({ message: 'Order not found' });
        }
        return sendInvoicePdf(res, order);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to generate invoice' });
    }
};

const downloadAdminInvoicePdf = async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        if (!Number.isFinite(orderId) || orderId <= 0) {
            return res.status(400).json({ message: 'Invalid order id' });
        }
        const order = await Order.getById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        return sendInvoicePdf(res, order);
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to generate invoice' });
    }
};

const downloadInvoiceBySignedLink = async (req, res) => {
    try {
        const { oid, uid, exp, sig } = req.query || {};
        const verified = verifyInvoiceShareToken({ orderId: oid, userId: uid, exp, sig });
        if (!verified.ok) {
            return res.status(400).send('<h3>Invoice link is invalid or expired.</h3>');
        }
        const order = await Order.getById(verified.orderId);
        if (!order || String(order.user_id) !== String(verified.userId)) {
            return res.status(404).send('<h3>Order not found.</h3>');
        }
        return sendInvoicePdf(res, order);
    } catch (error) {
        return res.status(400).send(`<h3>${error?.message || 'Unable to open invoice link.'}</h3>`);
    }
};

const sendAdminInvoiceCommunication = async (req, res) => {
    try {
        const orderId = Number(req.params.id);
        if (!Number.isFinite(orderId) || orderId <= 0) {
            return res.status(400).json({ message: 'Invalid order id' });
        }
        const order = await Order.getById(orderId);
        if (!order) {
            return res.status(404).json({ message: 'Order not found' });
        }
        const paymentStatus = String(order?.payment_status || '').toLowerCase();
        if (![PAYMENT_STATUS.PAID, PAYMENT_STATUS.REFUNDED].includes(paymentStatus)) {
            return res.status(400).json({ message: 'Invoice can be sent only for paid or refunded orders' });
        }
        if (!order?.user_id) {
            return res.status(400).json({ message: 'Customer details are unavailable for this order' });
        }
        const customer = await User.findById(order.user_id);
        if (!customer) {
            return res.status(404).json({ message: 'Customer not found for this order' });
        }
        const normalizedEmail = String(customer.email || '').trim();
        const normalizedMobile = String(customer.mobile || '').replace(/\D/g, '');
        const hasEmail = Boolean(normalizedEmail);
        const company = await CompanyProfile.get().catch(() => null);
        const whatsappGloballyEnabled = company?.whatsappChannelEnabled !== false;
        let invoiceShareUrl = '';
        let whatsappBlockedReason = '';

        if (whatsappGloballyEnabled && normalizedMobile.length >= 10) {
            try {
                invoiceShareUrl = buildInvoiceShareUrl({ orderId: order.id, userId: order.user_id });
            } catch (shareUrlError) {
                whatsappBlockedReason = shareUrlError?.message || 'Invoice share URL unavailable';
            }
        } else if (!whatsappGloballyEnabled) {
            whatsappBlockedReason = 'WhatsApp channel disabled in settings';
        } else {
            whatsappBlockedReason = 'Customer WhatsApp number unavailable';
        }

        const allowEmail = hasEmail;
        const allowWhatsapp = Boolean(invoiceShareUrl);
        if (!allowEmail && !allowWhatsapp) {
            return res.status(400).json({
                message: whatsappBlockedReason || 'Customer does not have a reachable invoice delivery channel'
            });
        }

        const orderForInvoice = await hydrateOrderForInvoice(order);
        const pdfBuffer = await buildInvoicePdfBuffer(orderForInvoice);
        const invoiceRef = String(order?.order_ref || order?.id || Date.now()).replace(/[^a-zA-Z0-9-_]/g, '');
        const invoiceAttachment = {
            filename: `invoice-${invoiceRef}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf'
        };

        // Fire delivery in background so admin UI does not block on channel latency.
        setImmediate(async () => {
            try {
                const result = await sendOrderLifecycleCommunication({
                    stage: 'invoice',
                    customer,
                    order,
                    includeInvoice: true,
                    invoiceAttachment,
                    allowEmail,
                    allowWhatsapp,
                    invoiceShareUrl
                });
                console.info(
                    `Invoice communication result for order ${order?.id || 'unknown'}`,
                    {
                        email: result?.email?.ok === true ? 'ok' : (result?.email?.reason || result?.email?.message || 'failed'),
                        whatsapp: result?.whatsapp?.ok === true ? 'ok' : (result?.whatsapp?.reason || result?.whatsapp?.message || 'failed'),
                        whatsappTemplate: result?.whatsapp?.template || null
                    }
                );
                if (result?.email?.ok !== true || result?.whatsapp?.ok !== true) {
                    console.warn(
                        `Invoice communication partial failure for order ${order?.id || 'unknown'}`,
                        {
                            email: result?.email?.reason || result?.email?.message || (result?.email?.ok ? 'ok' : 'failed'),
                            whatsapp: result?.whatsapp?.reason || result?.whatsapp?.message || (result?.whatsapp?.ok ? 'ok' : 'failed'),
                            whatsappTemplate: result?.whatsapp?.template || null,
                            whatsappRequestUrl: result?.whatsapp?.requestUrl || null,
                            whatsappResponse: result?.whatsapp?.response || null
                        }
                    );
                }
            } catch (dispatchError) {
                console.error(
                    `Invoice communication dispatch failed for order ${order?.id || 'unknown'}:`,
                    dispatchError?.message || dispatchError
                );
            }
        });

        return res.status(202).json({
            message: `Invoice communication queued for ${[allowEmail ? 'email' : '', allowWhatsapp ? 'WhatsApp' : ''].filter(Boolean).join(' + ')}`,
            queued: true,
            queuedChannels: {
                email: allowEmail,
                whatsapp: allowWhatsapp
            },
            skippedChannels: {
                email: allowEmail ? null : 'Customer email unavailable',
                whatsapp: allowWhatsapp ? null : whatsappBlockedReason
            }
        });
    } catch (error) {
        return res.status(500).json({ message: error?.message || 'Failed to send invoice communication' });
    }
};

module.exports = {
    createOrderFromCheckout,
    createRazorpayOrder,
    getCheckoutSummary,
    validateRecoveryCoupon,
    getAvailableCoupons,
    getAdminManualCoupons,
    getAdminManualPreview,
    getCustomerPopupData,
    getPublicPopupData,
    retryRazorpayPayment,
    verifyRazorpayPayment,
    handleRazorpayWebhook,
    getAdminOrders,
    getAdminPaymentHealth,
    getAdminOrderById,
    getMyOrders,
    getMyOrderByPaymentRef,
    downloadMyInvoicePdf,
    downloadAdminInvoicePdf,
    sendAdminInvoiceCommunication,
    updateOrderStatus,
    fetchAdminPaymentStatus,
    fetchMyPaymentStatus,
    deleteAdminOrder,
    deleteAdminPaymentAttempt,
    convertAdminPaymentAttemptToOrder,
    createAdminManualOrder,
    getOverdueShippedSummary,
    confirmDeliveryBySignedLink,
    downloadInvoiceBySignedLink
};
