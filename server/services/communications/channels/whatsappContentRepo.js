const toText = (value = '') => String(value == null ? '' : value).trim();
const normalize = (value = '') => toText(value).replace(/[\r\n\t]/g, ' ').replace(/\s+/g, ' ').trim();
const WORKFLOW_TEMPLATE_NAMES = {
    generic: normalize(process.env.WHATSAPP_TEMPLATE_GENERIC || '') || 'generic',
    default: normalize(process.env.WHATSAPP_TEMPLATE_DEFAULT || '') || 'generic',
    welcome: normalize(process.env.WHATSAPP_TEMPLATE_WELCOME || '') || 'Welcome',
    loyalty_upgrade: normalize(process.env.WHATSAPP_TEMPLATE_LOYALTY_UPGRADE || '') || 'loyalty_upgrade',
    loyalty_progress: normalize(process.env.WHATSAPP_TEMPLATE_LOYALTY_PROGRESS || '') || 'loyalty_progress',
    birthday: normalize(process.env.WHATSAPP_TEMPLATE_BIRTHDAY || '') || 'Birthday',
    login_otp: normalize(process.env.WHATSAPP_TEMPLATE_LOGIN_OTP || '') || 'login_otp',
    order: normalize(process.env.WHATSAPP_TEMPLATE_ORDER || '') || 'order',
    payment: normalize(process.env.WHATSAPP_TEMPLATE_PAYMENT || '') || 'payment',
    abandoned_cart_recovery: normalize(process.env.WHATSAPP_TEMPLATE_ABANDONED_CART || '') || 'abandoned_cart_recovery',
    abandoned_cart_without_offer: normalize(process.env.WHATSAPP_TEMPLATE_ABANDONED_CART_WITHOUT_OFFER || '') || 'Cart_without_offer',
    abandoned_cart_with_offer: normalize(process.env.WHATSAPP_TEMPLATE_ABANDONED_CART_WITH_OFFER || '') || 'Cart_with_offer',
    dashboard_alert: normalize(process.env.WHATSAPP_TEMPLATE_DASHBOARD_ALERT || '') || 'dashboard_alert',
    coupon_issue: normalize(process.env.WHATSAPP_TEMPLATE_COUPON_ISSUE || '') || 'coupon_issue'
};

const fallbackName = (payload = {}) => (
    normalize(
        payload?.name
        || payload?.customer?.name
        || 'Customer'
    ) || 'Customer'
);

// WhatsApp provider splits Param by comma, so amount must not include thousand separators.
const toAmountLabel = (value = 0) => `INR ${Number(value || 0).toFixed(2)}`;
const toCurrencyFromSubunits = (subunits = 0, currency = 'INR') => {
    const amount = Number(subunits || 0) / 100;
    return `${String(currency || 'INR').toUpperCase()} ${amount.toFixed(2)}`;
};
const ABANDONED_CART_ATTEMPT_MESSAGES = [
    'It looks like you added some items to your cart but did not complete your purchase.',
    'Your saved items are still waiting in your cart.',
    'Your selected pieces are still available for checkout.',
    'Your cart is active and ready whenever you are.',
    'Your favourites are still in cart and can sell out fast.',
    'Your cart is still open and ready for a quick checkout.',
    'This is a reminder that your saved cart is waiting.',
    'Your cart is still available if you want to complete the order.',
    'We kept your cart ready so you can continue easily.',
    'Your pending cart can be completed in just a few steps.'
];
const formatDateLabel = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const date = new Date(raw);
    if (Number.isNaN(date.getTime())) return raw;
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const buildGenericContent = (payload = {}) => ({
    params: Array.isArray(payload?.params) ? payload.params : [],
    message: normalize(payload?.message || '') || 'SSC Jewellery update from support team.',
    name: fallbackName(payload)
});

const buildLoginOtpContent = (payload = {}) => {
    const otp = normalize(payload?.data?.otp || payload?.otp || '');
    const name = fallbackName(payload);
    const urlParam = normalize(
        payload?.data?.urlParam
        || payload?.urlParam
        || process.env.WHATSAPP_OTP_URL_PARAM
        || otp
    );
    return {
        // Template "Otp" expects a single variable: {{1}} = OTP code.
        params: [otp || '000000'],
        message: normalize(payload?.message || '') || `${otp || '000000'} is your verification code`,
        name,
        urlParam
    };
};

const buildWelcomeContent = (payload = {}) => {
    const name = fallbackName(payload);
    return {
        // Template "Welcome" uses {{1}} in header/body for customer name.
        params: [name],
        message: normalize(payload?.message || '') || `Hello ${name}, your account has been created successfully.`,
        name
    };
};

const buildLoyaltyUpgradeContent = (payload = {}) => {
    const user = payload?.user || payload?.customer || {};
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const name = normalize(user?.name || payload?.name || data?.name || 'Customer') || 'Customer';
    const previousTier = normalize(data?.previousTier || payload?.previousTier || 'Basic') || 'Basic';
    const newTier = normalize(data?.newTier || payload?.newTier || 'Gold') || 'Gold';
    const benefit = normalize(data?.benefit || payload?.benefit || 'Exclusive member benefits') || 'Exclusive member benefits';
    return {
        params: [name, previousTier, newTier, benefit],
        message: normalize(payload?.message || '') || `Hello ${name}, your membership upgraded from ${previousTier} to ${newTier}. Benefit unlocked: ${benefit}.`,
        name
    };
};

const buildLoyaltyProgressContent = (payload = {}) => {
    const user = payload?.user || payload?.customer || {};
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const name = normalize(user?.name || payload?.name || data?.name || 'Customer') || 'Customer';
    const currentTier = normalize(data?.currentTier || payload?.currentTier || 'Basic') || 'Basic';
    const progressPct = Math.max(0, Math.min(100, Number(data?.progressPct ?? payload?.progressPct ?? 0)));
    const nextTier = normalize(data?.nextTier || payload?.nextTier || 'Next') || 'Next';
    return {
        params: [name, currentTier, `${Math.round(progressPct)}`, nextTier],
        message: normalize(payload?.message || '') || `Hello ${name}, current tier ${currentTier}. You have completed ${Math.round(progressPct)}% towards ${nextTier}.`,
        name
    };
};

const buildBirthdayContent = (payload = {}) => {
    const user = payload?.user || payload?.customer || {};
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const name = normalize(user?.name || payload?.name || 'Customer') || 'Customer';
    const couponCode = normalize(data?.couponCode || payload?.couponCode || '');
    const offer = normalize(data?.offer || payload?.offer || 'Special birthday offer');
    const validUntil = normalize(data?.validUntil || payload?.validUntil || '');
    return {
        params: [name, couponCode, offer, validUntil || 'Limited period'],
        message: normalize(payload?.message || '') || `Happy Birthday ${name}. Coupon: ${couponCode}. Offer: ${offer}. Valid until: ${validUntil || 'Limited period'}.`,
        name,
        // Used by provider for dynamic button attribute; pass coupon code for "Copy offer code".
        urlParam: couponCode
    };
};

const buildOrderContent = (payload = {}) => {
    const order = payload?.order || {};
    const customer = payload?.customer || {};
    const name = normalize(customer?.name || payload?.name || 'Customer') || 'Customer';
    const orderRef = normalize(order?.order_ref || order?.orderRef || order?.id || 'N/A');
    const stage = normalize(payload?.stage || 'updated');
    const total = toAmountLabel(order?.total || 0);
    return {
        params: [name, orderRef, stage, total],
        message: normalize(payload?.message || '') || `Order ${orderRef} is ${stage}. Total ${total}.`,
        name
    };
};

const buildPaymentContent = (payload = {}) => {
    const customer = payload?.customer || {};
    const order = payload?.order || {};
    const payment = payload?.payment || {};
    const name = normalize(customer?.name || payload?.name || 'Customer') || 'Customer';
    const orderRef = normalize(order?.order_ref || order?.orderRef || payment?.razorpayOrderId || order?.id || 'N/A');
    const stage = normalize(payload?.stage || payment?.paymentStatus || 'updated');
    return {
        params: [name, orderRef, stage],
        message: normalize(payload?.message || '') || `Payment update for order ${orderRef}: ${stage}.`,
        name
    };
};

const buildAbandonedCartContent = (payload = {}) => {
    const customer = payload?.customer || {};
    const cart = payload?.cart || {};
    const name = normalize(customer?.name || payload?.name || 'Customer') || 'Customer';
    const cartRef = normalize(cart?.journeyId || cart?.id || payload?.journeyId || 'N/A');
    const itemCount = Math.max(0, Number(cart?.itemCount ?? payload?.itemCount ?? 0));
    const discountCode = normalize(payload?.discountCode || cart?.discountCode || '');
    const checkoutLink = normalize(payload?.checkoutLink || payload?.paymentLink || '');
    const attemptNo = Math.max(1, Number(payload?.attemptNo || 1));
    const idx = Math.min(ABANDONED_CART_ATTEMPT_MESSAGES.length - 1, attemptNo - 1);
    const reminderMessage = normalize(payload?.attemptMessage || ABANDONED_CART_ATTEMPT_MESSAGES[idx] || ABANDONED_CART_ATTEMPT_MESSAGES[0]);
    const cartValue = toCurrencyFromSubunits(
        payload?.cartValueSubunits ?? cart?.cartValueSubunits ?? payload?.cartTotalSubunits ?? 0,
        payload?.currency || cart?.currency || 'INR'
    );
    const discountPercent = Math.max(0, Number(payload?.discountPercent ?? cart?.discountPercent ?? 0));
    const discountLabel = normalize(payload?.discountLabel || (discountPercent > 0 ? `${discountPercent}% OFF` : 'Special offer'));
    const validUntil = formatDateLabel(payload?.validUntil || payload?.linkExpiry || cart?.validUntil || '');
    const withoutOfferTemplate = normalize(process.env.WHATSAPP_TEMPLATE_ABANDONED_CART_WITHOUT_OFFER || WORKFLOW_TEMPLATE_NAMES.abandoned_cart_without_offer || 'Cart_without_offer');
    const withOfferTemplate = normalize(process.env.WHATSAPP_TEMPLATE_ABANDONED_CART_WITH_OFFER || WORKFLOW_TEMPLATE_NAMES.abandoned_cart_with_offer || 'Cart_with_offer');
    const useWithoutOfferTemplate = !discountCode;
    if (useWithoutOfferTemplate) {
        return {
            template: withoutOfferTemplate,
            params: [name, reminderMessage, cartValue],
            message: normalize(payload?.message || '') || `Hello ${name}, ${reminderMessage} Cart Value: ${cartValue}.`,
            name,
            urlParam: checkoutLink || ''
        };
    }
    return {
        template: withOfferTemplate,
        params: [name, reminderMessage, discountCode, discountLabel, validUntil || 'Limited period'].filter(Boolean),
        message: normalize(payload?.message || '') || `Hello ${name}, ${reminderMessage} Coupon: ${discountCode}. Discount: ${discountLabel}. Valid Until: ${validUntil || 'Limited period'}.`,
        name,
        // Provider maps this dynamic attribute for button actions; pass coupon code for copy-offer-code button.
        urlParam: discountCode || checkoutLink || ''
    };
};

const buildDashboardAlertContent = (payload = {}) => {
    const message = normalize(payload?.message || 'SSC dashboard alert.');
    return {
        params: [message],
        message,
        name: fallbackName(payload)
    };
};

const buildCouponIssueContent = (payload = {}) => {
    const user = payload?.user || {};
    const coupon = payload?.coupon || {};
    const data = payload?.data && typeof payload.data === 'object' ? payload.data : {};
    const name = normalize(user?.name || payload?.name || 'Customer') || 'Customer';
    const storeName = normalize(data.storeName || payload?.storeName || payload?.brandName || 'SSC Jewellery') || 'SSC Jewellery';
    const code = normalize(coupon?.code || data.couponCode || payload?.couponCode || '');
    const offer = normalize(data.discount || payload?.offerText || '');
    const validUntil = normalize(data.validUntil || payload?.validUntil || '');
    const shopUrl = normalize(data.shopUrl || payload?.shopUrl || payload?.urlParam || 'https://sscjewellery.com/');
    return {
        params: [storeName, code, offer, validUntil, shopUrl].filter(Boolean),
        message: normalize(payload?.message || '') || `Hello, good news! A special coupon has been issued for you on ${storeName}. Coupon: ${code || 'N/A'} | Discount: ${offer || 'Special offer'} | Valid Until: ${validUntil || 'Limited period'} | Shop: ${shopUrl}`.trim(),
        name,
        urlParam: shopUrl
    };
};

const WORKFLOW_BUILDERS = {
    generic: buildGenericContent,
    default: buildGenericContent,
    welcome: buildWelcomeContent,
    loyalty_upgrade: buildLoyaltyUpgradeContent,
    loyalty_progress: buildLoyaltyProgressContent,
    birthday: buildBirthdayContent,
    otp: buildLoginOtpContent,
    login_otp: buildLoginOtpContent,
    order: buildOrderContent,
    payment: buildPaymentContent,
    abandoned_cart_recovery: buildAbandonedCartContent,
    dashboard_alert: buildDashboardAlertContent,
    coupon_issue: buildCouponIssueContent
};

const resolveWorkflowContent = ({ workflow = 'generic', payload = {} } = {}) => {
    const key = normalize(workflow).toLowerCase() || 'generic';
    const builder = WORKFLOW_BUILDERS[key] || WORKFLOW_BUILDERS.generic;
    const built = builder(payload || {}) || {};
    return {
        ...built,
        template: normalize(payload?.template || payload?.templateName || built.template || WORKFLOW_TEMPLATE_NAMES[key] || WORKFLOW_TEMPLATE_NAMES.generic)
    };
};

module.exports = {
    resolveWorkflowContent
};
