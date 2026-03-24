const db = require('../config/db');
const User = require('../models/User');
const Coupon = require('../models/Coupon');
const { sendEmailCommunication, sendWhatsapp } = require('./communications/communicationService');

const TIER_ORDER = ['regular', 'bronze', 'silver', 'gold', 'platinum'];

const DEFAULT_LOYALTY_CONFIG = {
    regular: {
        label: 'Basic',
        color: '#4B5563',
        threshold: 0,
        windowDays: 30,
        extraDiscountPct: 0,
        shippingDiscountPct: 0,
        birthdayDiscountPct: 10,
        abandonedCartBoostPct: 0,
        priorityWeight: 0,
        shippingPriority: 'standard',
        benefits: ['Standard pricing', 'Standard shipping', 'Progress tracking to next tier']
    },
    bronze: {
        label: 'Bronze',
        color: '#CD7F32',
        threshold: 5000,
        windowDays: 30,
        extraDiscountPct: 1,
        shippingDiscountPct: 5,
        birthdayDiscountPct: 10,
        abandonedCartBoostPct: 2,
        priorityWeight: 1,
        shippingPriority: 'standard_plus',
        benefits: ['1% extra member discount', '5% shipping fee discount', 'Priority support queue']
    },
    silver: {
        label: 'Silver',
        color: '#9CA3AF',
        threshold: 10000,
        windowDays: 60,
        extraDiscountPct: 2,
        shippingDiscountPct: 10,
        birthdayDiscountPct: 10,
        abandonedCartBoostPct: 4,
        priorityWeight: 2,
        shippingPriority: 'high',
        benefits: ['2% extra member discount', '10% shipping fee discount', 'High priority dispatch queue']
    },
    gold: {
        label: 'Gold',
        color: '#D4AF37',
        threshold: 25000,
        windowDays: 90,
        extraDiscountPct: 3,
        shippingDiscountPct: 15,
        birthdayDiscountPct: 10,
        abandonedCartBoostPct: 6,
        priorityWeight: 3,
        shippingPriority: 'higher',
        benefits: ['3% extra member discount', '15% shipping fee discount', 'Faster dispatch + premium support']
    },
    platinum: {
        label: 'Platinum',
        color: '#60A5FA',
        threshold: 100000,
        windowDays: 365,
        extraDiscountPct: 5,
        shippingDiscountPct: 25,
        birthdayDiscountPct: 10,
        abandonedCartBoostPct: 10,
        priorityWeight: 4,
        shippingPriority: 'highest',
        benefits: ['5% extra member discount', '25% shipping fee discount', 'Top priority dispatch + premium concierge']
    }
};
const LOYALTY_CONFIG_CACHE = {
    loadedAt: 0,
    expiresAt: 0,
    byTier: { ...DEFAULT_LOYALTY_CONFIG }
};
const LOYALTY_CACHE_TTL_MS = 5 * 60 * 1000;

const toMoney = (value) => {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
};

const normalizeBenefits = (value, fallback = []) => {
    if (Array.isArray(value)) return value.map((entry) => String(entry || '').trim()).filter(Boolean);
    if (typeof value === 'string') {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
        } catch {}
    }
    return Array.isArray(fallback) ? fallback : [];
};

const normalizeShippingPriority = (value = 'standard') => {
    const v = String(value || '').toLowerCase();
    if (['standard', 'standard_plus', 'high', 'higher', 'highest'].includes(v)) return v;
    return 'standard';
};

const buildBenefitsFromValues = (tier, config = {}) => {
    const t = String(tier || 'regular').toLowerCase();
    if (t === 'regular') {
        return ['Standard pricing', 'Standard shipping', 'Progress tracking to next tier'];
    }
    const extraDiscountPct = toMoney(config.extraDiscountPct ?? 0);
    const shippingDiscountPct = toMoney(config.shippingDiscountPct ?? 0);
    const birthdayDiscountPct = toMoney(config.birthdayDiscountPct ?? 10);
    const abandonedCartBoostPct = toMoney(config.abandonedCartBoostPct ?? 0);
    const shippingPriority = normalizeShippingPriority(config.shippingPriority || 'standard');
    const shippingPriorityLabel = {
        standard: 'Standard dispatch queue',
        standard_plus: 'Standard+ dispatch queue',
        high: 'High dispatch priority',
        higher: 'Higher dispatch priority',
        highest: 'Highest dispatch priority'
    }[shippingPriority];
    const priorityLine = shippingPriorityLabel;
    return [
        `${extraDiscountPct}% extra member discount`,
        `${shippingDiscountPct}% shipping fee discount`,
        `${birthdayDiscountPct}% birthday coupon offer`,
        `${abandonedCartBoostPct}% abandoned cart offer boost`,
        priorityLine
    ];
};

const normalizeTierRecord = (tier, row = null) => {
    const t = String(tier || '').toLowerCase();
    const fallback = DEFAULT_LOYALTY_CONFIG[t] || DEFAULT_LOYALTY_CONFIG.regular;
    if (!row) {
        const out = { ...fallback, benefits: [...(fallback.benefits || [])] };
        out.benefits = buildBenefitsFromValues(t, out);
        return out;
    }
    const normalized = {
        label: String(row.label || fallback.label || t),
        color: String(row.color || fallback.color || '#4B5563'),
        threshold: toMoney(row.threshold ?? fallback.threshold),
        windowDays: Math.max(1, Number(row.window_days ?? fallback.windowDays) || fallback.windowDays),
        extraDiscountPct: toMoney(row.extra_discount_pct ?? fallback.extraDiscountPct),
        shippingDiscountPct: toMoney(row.shipping_discount_pct ?? fallback.shippingDiscountPct),
        birthdayDiscountPct: toMoney(row.birthday_discount_pct ?? fallback.birthdayDiscountPct ?? 10),
        abandonedCartBoostPct: toMoney(row.abandoned_cart_boost_pct ?? fallback.abandonedCartBoostPct),
        priorityWeight: Number(row.priority_weight ?? fallback.priorityWeight ?? 0),
        shippingPriority: normalizeShippingPriority(row.shipping_priority || fallback.shippingPriority || 'standard'),
        benefits: normalizeBenefits(row.benefits_json, fallback.benefits)
    };
    normalized.benefits = buildBenefitsFromValues(t, normalized);
    return normalized;
};

const setCachedLoyaltyConfig = (byTier = {}) => {
    const merged = {};
    for (const tier of TIER_ORDER) {
        merged[tier] = normalizeTierRecord(tier, byTier[tier]);
    }
    LOYALTY_CONFIG_CACHE.byTier = merged;
    LOYALTY_CONFIG_CACHE.loadedAt = Date.now();
    LOYALTY_CONFIG_CACHE.expiresAt = Date.now() + LOYALTY_CACHE_TTL_MS;
    return merged;
};

const ensureLoyaltyConfigLoaded = async ({ force = false } = {}) => {
    if (!force && LOYALTY_CONFIG_CACHE.expiresAt > Date.now()) return LOYALTY_CONFIG_CACHE.byTier;
    try {
        const [rows] = await db.execute(
            `SELECT tier, label, color, threshold, window_days, extra_discount_pct, shipping_discount_pct,
                    birthday_discount_pct, abandoned_cart_boost_pct, priority_weight, shipping_priority, benefits_json
             FROM loyalty_tier_config
             WHERE is_active = 1`
        );
        const byTier = {};
        for (const row of rows || []) {
            const t = String(row.tier || '').toLowerCase();
            if (!TIER_ORDER.includes(t)) continue;
            byTier[t] = row;
        }
        return setCachedLoyaltyConfig(byTier);
    } catch {
        return setCachedLoyaltyConfig({});
    }
};

const getActiveLoyaltyConfig = () => {
    return LOYALTY_CONFIG_CACHE.byTier || DEFAULT_LOYALTY_CONFIG;
};

const computeTierFromSpends = ({ spend30 = 0, spend60 = 0, spend90 = 0, spend365 = 0 } = {}) => {
    const cfg = getActiveLoyaltyConfig();
    if (spend365 >= Number(cfg.platinum?.threshold || 0)) return 'platinum';
    if (spend90 >= Number(cfg.gold?.threshold || 0)) return 'gold';
    if (spend60 >= Number(cfg.silver?.threshold || 0)) return 'silver';
    if (spend30 >= Number(cfg.bronze?.threshold || 0)) return 'bronze';
    return 'regular';
};

const buildProgress = ({ tier = 'regular', spend30 = 0, spend60 = 0, spend90 = 0, spend365 = 0 } = {}) => {
    const currentIndex = TIER_ORDER.indexOf(tier);
    const nextTier = currentIndex >= 0 && currentIndex < TIER_ORDER.length - 1
        ? TIER_ORDER[currentIndex + 1]
        : null;
    if (!nextTier) {
        return {
            nextTier: null,
            needed: 0,
            progressPct: 100,
            message: 'You are at the highest tier.'
        };
    }

    const cfg = getActiveLoyaltyConfig();
    const nextCfg = cfg[nextTier] || DEFAULT_LOYALTY_CONFIG[nextTier];
    const baseSpend = (() => {
        if (nextTier === 'bronze') return spend30;
        if (nextTier === 'silver') return spend60;
        if (nextTier === 'gold') return spend90;
        return spend365;
    })();
    const needed = Math.max(0, toMoney(nextCfg.threshold - baseSpend));
    const progressPct = Math.min(100, Math.max(0, Math.round((baseSpend / nextCfg.threshold) * 100)));
    return {
        nextTier,
        needed,
        progressPct,
        message: needed > 0
            ? `Spend INR ${needed.toLocaleString('en-IN')} more to unlock ${nextCfg.label}.`
            : `You have unlocked ${nextCfg.label}.`
    };
};

const getUserSpendWindows = async (userId, connection = db) => {
    const [rows] = await connection.execute(
        `SELECT
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN GREATEST(0, subtotal - COALESCE(coupon_discount_value, 0) - COALESCE(loyalty_discount_total, 0)) ELSE 0 END), 0) as spend30,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY) THEN GREATEST(0, subtotal - COALESCE(coupon_discount_value, 0) - COALESCE(loyalty_discount_total, 0)) ELSE 0 END), 0) as spend60,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY) THEN GREATEST(0, subtotal - COALESCE(coupon_discount_value, 0) - COALESCE(loyalty_discount_total, 0)) ELSE 0 END), 0) as spend90,
            COALESCE(SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 365 DAY) THEN GREATEST(0, subtotal - COALESCE(coupon_discount_value, 0) - COALESCE(loyalty_discount_total, 0)) ELSE 0 END), 0) as spend365
         FROM orders
         WHERE user_id = ?
           AND LOWER(COALESCE(payment_status, '')) = 'paid'
           AND LOWER(COALESCE(payment_status, '')) NOT IN ('refunded', 'failed')
           AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'refunded')`,
        [userId]
    );
    const row = rows[0] || {};
    return {
        spend30: toMoney(row.spend30),
        spend60: toMoney(row.spend60),
        spend90: toMoney(row.spend90),
        spend365: toMoney(row.spend365)
    };
};

const getLoyaltyProfileByTier = (tier = 'regular') => {
    const cfg = getActiveLoyaltyConfig();
    return cfg[tier] || cfg.regular || DEFAULT_LOYALTY_CONFIG.regular;
};

const evaluateProfileCompletion = (user = {}) => {
    const address = user?.address && typeof user.address === 'object' ? user.address : {};
    const billingAddress = user?.billingAddress && typeof user.billingAddress === 'object' ? user.billingAddress : {};
    const checks = [
        { key: 'name', ok: Boolean(String(user?.name || '').trim()), label: 'name' },
        { key: 'email', ok: Boolean(String(user?.email || '').trim()), label: 'email' },
        { key: 'mobile', ok: Boolean(String(user?.mobile || '').trim()), label: 'mobile number' },
        { key: 'dob', ok: Boolean(String(user?.dob || '').trim()), label: 'date of birth' },
        { key: 'profileImage', ok: Boolean(String(user?.profileImage || '').trim()), label: 'profile photo' },
        { key: 'addressLine1', ok: Boolean(String(address?.line1 || '').trim()), label: 'shipping address line' },
        { key: 'addressCity', ok: Boolean(String(address?.city || '').trim()), label: 'shipping city' },
        { key: 'addressState', ok: Boolean(String(address?.state || '').trim()), label: 'shipping state' },
        { key: 'addressZip', ok: Boolean(String(address?.zip || '').trim()), label: 'shipping PIN code' },
        { key: 'billingLine1', ok: Boolean(String(billingAddress?.line1 || '').trim()), label: 'billing address line' },
        { key: 'billingCity', ok: Boolean(String(billingAddress?.city || '').trim()), label: 'billing city' },
        { key: 'billingState', ok: Boolean(String(billingAddress?.state || '').trim()), label: 'billing state' },
        { key: 'billingZip', ok: Boolean(String(billingAddress?.zip || '').trim()), label: 'billing PIN code' }
    ];
    const completed = checks.filter((item) => item.ok).length;
    const completionPct = Math.max(0, Math.min(100, Math.round((completed / checks.length) * 100)));
    const missingFields = checks.filter((item) => !item.ok).map((item) => item.label);
    const isEligible = missingFields.length === 0;
    return {
        isEligible,
        completionPct,
        missingFields,
        totalFields: checks.length,
        completedFields: completed,
        message: isEligible
            ? 'Profile is complete. Membership benefits are active.'
            : `Complete profile to 100% to unlock membership benefits (${completionPct}% completed).`
    };
};

const calculateOrderLoyaltyAdjustments = ({ subtotal = 0, shippingFee = 0, couponDiscount = 0, tier = 'regular', membershipEligible = true } = {}) => {
    const profile = getLoyaltyProfileByTier(tier);
    if (!membershipEligible) {
        return {
            tier,
            profile,
            loyaltyDiscount: 0,
            shippingDiscount: 0
        };
    }
    const eligibleBase = Math.max(0, toMoney(subtotal - couponDiscount));
    const loyaltyDiscount = toMoney((eligibleBase * Number(profile.extraDiscountPct || 0)) / 100);
    const shippingDiscount = toMoney((toMoney(shippingFee) * Number(profile.shippingDiscountPct || 0)) / 100);
    return {
        tier,
        profile,
        loyaltyDiscount,
        shippingDiscount
    };
};

const getUserLoyaltyStatus = async (userId) => {
    await ensureLoyaltyConfigLoaded();
    if (!userId) {
        const progress = buildProgress({ tier: 'regular' });
        const eligibility = evaluateProfileCompletion({});
        return {
            tier: 'regular',
            profile: getLoyaltyProfileByTier('regular'),
            effectiveTier: 'regular',
            effectiveProfile: getLoyaltyProfileByTier('regular'),
            earnedTier: 'regular',
            earnedProfile: getLoyaltyProfileByTier('regular'),
            spends: { spend30: 0, spend60: 0, spend90: 0, spend365: 0 },
            progress,
            nextTierProfile: progress?.nextTier ? getLoyaltyProfileByTier(progress.nextTier) : null,
            eligibility
        };
    }
    const spends = await getUserSpendWindows(userId);
    const [storedRows] = await db.execute(
        'SELECT tier FROM user_loyalty WHERE user_id = ? LIMIT 1',
        [userId]
    );
    const storedTier = String(storedRows[0]?.tier || '').toLowerCase();
    const computedTier = computeTierFromSpends(spends);
    const tier = TIER_ORDER.includes(storedTier) ? storedTier : computedTier;
    const user = await User.findById(userId);
    const eligibility = evaluateProfileCompletion(user || {});
    const effectiveTier = eligibility.isEligible ? tier : 'regular';
    const progress = buildProgress({
        tier,
        spend30: spends.spend30,
        spend60: spends.spend60,
        spend90: spends.spend90,
        spend365: spends.spend365
    });
    return {
        tier,
        profile: getLoyaltyProfileByTier(effectiveTier),
        effectiveTier,
        effectiveProfile: getLoyaltyProfileByTier(effectiveTier),
        earnedTier: tier,
        earnedProfile: getLoyaltyProfileByTier(tier),
        spends,
        computedTier,
        progress,
        nextTierProfile: progress?.nextTier ? getLoyaltyProfileByTier(progress.nextTier) : null,
        eligibility
    };
};

const sendTierUpgradeMail = async ({ user, previousTier, newTier, status }) => {
    if (!user?.email && !user?.mobile) return;
    const label = getLoyaltyProfileByTier(newTier).label;
    const newBenefits = (status?.profile?.benefits || getLoyaltyProfileByTier(newTier)?.benefits || [])
        .slice(0, 5)
        .map((line) => String(line || '').trim())
        .filter(Boolean);
    const gratitudeLine = [
        'Thank you for your trust and continued support.',
        'We are grateful for every order you place with us.',
        'Your continued support means a lot to our team.'
    ];
    const template = buildLoyaltyMailTemplate({
        user,
        seed: `tier-upgrade|${user.id}|${newTier}`,
        subjects: Array.from({ length: 10 }, (_, i) => `Welcome to ${label} Membership | Thank You (${i + 1}/10)`),
        bodyBlocks: [
            `Great news. Your membership has been upgraded from <strong>${previousTier}</strong> to <strong>${label}</strong>.`,
            gratitudeLine[hashSeed(`${user.id}|${newTier}`) % gratitudeLine.length],
            'As a welcome to your upgraded tier, these benefits are now available to you:',
            newBenefits.length
                ? `<ul style="margin:8px 0 12px 18px;padding:0;">${newBenefits.map((item) => `<li>${item}</li>`).join('')}</ul>`
                : 'Enhanced member benefits are now active for your account.',
            status?.progress?.message || 'Your recent engagement unlocked this upgrade.'
        ],
        actionItems: [
            'Open your profile to review the updated tier details.',
            'Use your new member benefits in your next order.',
            'Reply to this email if you want a quick benefits walkthrough.'
        ],
        assuranceVariants: [
            'Thank you once again for being a valued SSC Jewellery member.',
            'We are grateful for your continued support and are always here to help.',
            'Our team is happy to support you in maximizing your new tier benefits.',
            'Please reply any time if you need help using your upgraded benefits.',
            'We will keep you informed as you progress further in membership tiers.',
            'Your loyalty is appreciated deeply by our entire team.',
            'Need support? Our team is available for quick assistance.',
            'We are committed to giving you a transparent and rewarding membership experience.',
            'Thank you for choosing SSC Jewellery again and again.',
            'We look forward to serving you with even better value ahead.'
        ]
    });
    const previousLabel = getLoyaltyProfileByTier(previousTier)?.label || String(previousTier || 'Basic');
    const benefit = String(newBenefits?.[0] || 'Exclusive member benefits').trim();
    const [emailResult, whatsappResult] = await Promise.allSettled([
        user?.email
            ? sendEmailCommunication({
                to: user.email,
                subject: template.subject,
                text: template.text,
                html: template.html
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
        user?.mobile
            ? sendWhatsapp({
                type: 'loyalty_upgrade',
                template: 'loyalty_upgrade',
                mobile: user.mobile,
                user: { name: user.name || 'Customer' },
                data: {
                    previousTier: previousLabel,
                    newTier: label,
                    benefit
                }
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_mobile' })
    ]);
    if (emailResult.status === 'rejected') {
        throw emailResult.reason;
    }
    if (whatsappResult.status === 'rejected') {
        console.error('Loyalty upgrade WhatsApp delivery failed:', whatsappResult.reason?.message || whatsappResult.reason);
    }
};

const sendTierDowngradeMail = async ({ user, previousTier, newTier, status }) => {
    if (!user?.email) return;
    const newLabel = getLoyaltyProfileByTier(newTier).label;
    const template = buildLoyaltyMailTemplate({
        user,
        seed: `tier-downgrade|${user.id}|${newTier}`,
        subjects: Array.from({ length: 10 }, (_, i) => `Membership Update: ${newLabel} (${i + 1}/10)`),
        bodyBlocks: [
            `Your membership has moved from <strong>${previousTier}</strong> to <strong>${newLabel}</strong>.`,
            status?.progress?.message || 'This change is based on your recent qualifying activity window.',
            'You can regain higher tiers by continuing regular purchases within the evaluation period.'
        ],
        actionItems: [
            'Review current tier criteria in your account.',
            'Plan next purchases to move back to the next tier.',
            'Reply if you want help understanding qualification thresholds.'
        ],
        assuranceVariants: [
            'Our team can help you with a clear path to your next upgrade.',
            'This update keeps your membership accurate and transparent.',
            'Reply to this email if you need a personalized progression explanation.',
            'We are available for immediate assistance with any membership questions.',
            'Your loyalty journey continues, and we are here to support you.',
            'Our administration team can validate your latest tier metrics on request.',
            'You can still access active benefits of your current tier.',
            'Thank you for staying with SSC Jewellery; we are ready to help.',
            'You will receive another update when your tier changes again.',
            'Please keep this message for your membership records.'
        ]
    });
    await sendEmailCommunication({
        to: user.email,
        subject: template.subject,
        text: template.text,
        html: template.html
    });
};

const sendMonthlyStatusSummaryMail = async ({ user, status }) => {
    if (!status || (!user?.email && !user?.mobile)) return;
    const template = buildLoyaltyMailTemplate({
        user,
        seed: `monthly-summary|${user.id}|${status?.tier || 'regular'}`,
        subjects: Array.from({ length: 10 }, (_, i) => `Your Monthly Membership Summary (${i + 1}/10)`),
        bodyBlocks: [
            `Current tier: <strong>${status?.profile?.label || status?.tier || 'Basic'}</strong>.`,
            status?.progress?.message || 'Your latest progress is available in your profile dashboard.',
            'This monthly summary helps you track your loyalty progress and available benefits.'
        ],
        actionItems: [
            'Review your tier benefits in your account.',
            'Check progress towards the next membership tier.',
            'Reply if you want assistance planning benefit usage.'
        ],
        assuranceVariants: [
            'We will continue sending periodic updates to keep your membership journey clear.',
            'Our team is available for any loyalty-related clarification.',
            'Please contact us if you need a detailed benefit breakdown.',
            'We appreciate your continued trust in SSC Jewellery.',
            'Your membership progress is continuously monitored by our system.',
            'Reply to this email for personalized membership support.',
            'We are here to help you maximize your tier advantages.',
            'Thank you for staying engaged with our loyalty program.',
            'Our administration desk can resolve any tier-related concerns.',
            'You can expect transparent updates whenever your tier changes.'
        ]
    });
    const [emailResult, whatsappResult] = await Promise.allSettled([
        user?.email
            ? sendEmailCommunication({
                to: user.email,
                subject: template.subject,
                text: template.text,
                html: template.html
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
        user?.mobile && status?.progress?.nextTier
            ? sendWhatsapp({
                type: 'loyalty_progress',
                template: 'loyalty_progress',
                mobile: user.mobile,
                user: { name: user.name || 'Customer' },
                data: {
                    currentTier: status?.profile?.label || status?.tier || 'Basic',
                    progressPct: Number(status?.progress?.progressPct || 0),
                    nextTier: getLoyaltyProfileByTier(status?.progress?.nextTier)?.label || status?.progress?.nextTier || 'Next'
                }
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_mobile_or_next_tier' })
    ]);
    if (emailResult.status === 'rejected') {
        throw emailResult.reason;
    }
    if (whatsappResult.status === 'rejected') {
        console.error('Monthly loyalty WhatsApp delivery failed:', whatsappResult.reason?.message || whatsappResult.reason);
    }
};

const sendFomoMailIfEligible = async ({ user, status }) => {
    if (!user?.email && !user?.mobile) return;
    const pct = Number(status?.progress?.progressPct || 0);
    if (pct < 75 || pct >= 100) return;
    const nextTier = status?.progress?.nextTier;
    if (!nextTier) return;
    const nextLabel = getLoyaltyProfileByTier(nextTier).label;
    const template = buildLoyaltyMailTemplate({
        user,
        seed: `fomo|${user.id}|${nextTier}|${pct}`,
        subjects: Array.from({ length: 10 }, (_, i) => `You are close to ${nextLabel} tier (${i + 1}/10)`),
        bodyBlocks: [
            `You are currently <strong>${pct}%</strong> towards <strong>${nextLabel}</strong> tier.`,
            status?.progress?.message || 'A small additional spend can unlock your next membership level.',
            'Unlocking the next tier gives you better loyalty benefits on eligible orders.'
        ],
        actionItems: [
            'Review your next-tier target in your profile.',
            'Complete qualifying purchases before evaluation closes.',
            'Reply for assistance with tier planning.'
        ],
        assuranceVariants: [
            'Our team is happy to guide you to your next tier quickly.',
            'Reply if you want help understanding qualification requirements.',
            'We are here to help you unlock your next membership milestone.',
            'Your loyalty progress is tracked accurately and updated regularly.',
            'Thank you for your continued engagement with SSC Jewellery.',
            'Our support team can suggest the fastest route to your next tier.',
            'You are very close; we are available for any guidance you need.',
            'Keep this note as a reminder of your current progress.',
            'You will receive confirmation once the next tier is achieved.',
            'Our administration team remains available for clarification.'
        ]
    });
    const [emailResult, whatsappResult] = await Promise.allSettled([
        user?.email
            ? sendEmailCommunication({
                to: user.email,
                subject: template.subject,
                text: template.text,
                html: template.html
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_email' }),
        user?.mobile
            ? sendWhatsapp({
                type: 'loyalty_progress',
                template: 'loyalty_progress',
                mobile: user.mobile,
                user: { name: user.name || 'Customer' },
                data: {
                    currentTier: status?.profile?.label || status?.tier || 'Basic',
                    progressPct: Number(status?.progress?.progressPct || 0),
                    nextTier: nextLabel
                }
            })
            : Promise.resolve({ ok: false, skipped: true, reason: 'missing_mobile' })
    ]);
    if (emailResult.status === 'rejected') {
        throw emailResult.reason;
    }
    if (whatsappResult.status === 'rejected') {
        console.error('Loyalty progress WhatsApp delivery failed:', whatsappResult.reason?.message || whatsappResult.reason);
    }
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

const buildLoyaltyMailTemplate = ({
    user = {},
    seed = '',
    subjects = [],
    bodyBlocks = [],
    actionItems = [],
    assuranceVariants = []
}) => {
    const customerName = String(user?.name || 'Customer').trim() || 'Customer';
    const greetingVariants = [
        `Dear ${customerName},`,
        `Hello ${customerName},`,
        `Hi ${customerName},`,
        `Greetings ${customerName},`,
        `Dear Valued Customer ${customerName},`,
        `Hello ${customerName}, thank you for being with SSC Jewellery.`,
        `Hi ${customerName}, this is your loyalty update.`,
        `Dear ${customerName}, please find your membership communication below.`,
        `Hello ${customerName}, we are sharing an account reward update.`,
        `${customerName}, thank you for shopping with SSC Jewellery.`
    ];
    const closingVariants = [
        'Regards,\nSSC Jewellery Loyalty Desk',
        'Warm regards,\nSSC Jewellery Customer Care',
        'Sincerely,\nSSC Jewellery Team',
        'Best regards,\nSSC Jewellery Membership Team',
        'Thank you,\nSSC Jewellery Support',
        'Kind regards,\nSSC Jewellery Administration',
        'With appreciation,\nSSC Jewellery Service Team',
        'Respectfully,\nSSC Jewellery Customer Success Team',
        'Yours faithfully,\nSSC Jewellery Help Desk',
        'Thank you for your trust,\nSSC Jewellery Team'
    ];
    const subject = pickVariant(subjects, `${seed}|subject`);
    const greeting = pickVariant(greetingVariants, `${seed}|greeting`);
    const closing = pickVariant(closingVariants, `${seed}|closing`);
    const assurance = pickVariant(assuranceVariants, `${seed}|assurance`);

    const html = `
        <div style="font-family:Arial,Helvetica,sans-serif;background:#f8fafc;padding:20px;color:#111827;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
                <tr>
                    <td style="padding:22px;font-size:15px;line-height:1.6;">
                        <p style="margin:0 0 12px;">${greeting}</p>
                        ${bodyBlocks.map((item) => `<p style="margin:0 0 12px;">${item}</p>`).join('')}
                        ${actionItems.length ? `<p style="margin:0 0 8px;"><strong>Recommended next steps:</strong></p><ol style="margin:0 0 12px 18px;padding:0;">${actionItems.map((item) => `<li>${item}</li>`).join('')}</ol>` : ''}
                        <p style="margin:0 0 12px;">${assurance}</p>
                        <p style="margin:0;white-space:pre-line;">${closing}</p>
                    </td>
                </tr>
            </table>
        </div>
    `;
    const text = [
        greeting,
        '',
        ...bodyBlocks.map((line) => String(line).replace(/<[^>]+>/g, '')),
        actionItems.length ? '' : null,
        actionItems.length ? 'Recommended next steps:' : null,
        ...actionItems.map((item, index) => `${index + 1}. ${item}`),
        '',
        assurance,
        '',
        closing
    ].filter(Boolean).join('\n');

    return { subject, html, text };
};

const formatDateLabel = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

const reassessUserTier = async (userId, { reason = 'monthly_reassessment', sendNotifications = false, notificationMode = 'full' } = {}) => {
    await ensureLoyaltyConfigLoaded();
    const spends = await getUserSpendWindows(userId);
    const nextTierComputed = computeTierFromSpends(spends);
    const progress = buildProgress({
        tier: nextTierComputed,
        spend30: spends.spend30,
        spend60: spends.spend60,
        spend90: spends.spend90,
        spend365: spends.spend365
    });
    const status = {
        tier: nextTierComputed,
        profile: getLoyaltyProfileByTier(nextTierComputed),
        spends,
        progress,
        nextTierProfile: progress?.nextTier ? getLoyaltyProfileByTier(progress.nextTier) : null
    };
    const [existingRows] = await db.execute(
        'SELECT tier FROM user_loyalty WHERE user_id = ? LIMIT 1',
        [userId]
    );
    const previousTier = String(existingRows[0]?.tier || 'regular').toLowerCase();
    const nextTier = status.tier;

    await db.execute(
        `INSERT INTO user_loyalty
            (user_id, tier, evaluated_at, spend_30d, spend_60d, spend_90d, spend_365d, progress_json, benefits_json)
         VALUES (?, ?, NOW(), ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            tier = VALUES(tier),
            evaluated_at = VALUES(evaluated_at),
            spend_30d = VALUES(spend_30d),
            spend_60d = VALUES(spend_60d),
            spend_90d = VALUES(spend_90d),
            spend_365d = VALUES(spend_365d),
            progress_json = VALUES(progress_json),
            benefits_json = VALUES(benefits_json)`,
        [
            userId,
            nextTier,
            status.spends.spend30,
            status.spends.spend60,
            status.spends.spend90,
            status.spends.spend365,
            JSON.stringify(status.progress || {}),
            JSON.stringify(status.profile || {})
        ]
    );

    if (previousTier !== nextTier) {
        await db.execute(
            `INSERT INTO user_loyalty_history
                (user_id, previous_tier, new_tier, reason, meta_json)
             VALUES (?, ?, ?, ?, ?)`,
            [userId, previousTier, nextTier, reason, JSON.stringify({ spends: status.spends, progress: status.progress })]
        );
    }

    if (sendNotifications) {
        const user = await User.findById(userId);
        if (previousTier !== nextTier && TIER_ORDER.indexOf(nextTier) > TIER_ORDER.indexOf(previousTier)) {
            await sendTierUpgradeMail({ user, previousTier, newTier: nextTier, status }).catch(() => {});
        } else if (notificationMode === 'full' && previousTier !== nextTier && TIER_ORDER.indexOf(nextTier) < TIER_ORDER.indexOf(previousTier)) {
            await sendTierDowngradeMail({ user, previousTier, newTier: nextTier, status }).catch(() => {});
        }
        if (notificationMode === 'full') {
            await sendFomoMailIfEligible({ user, status }).catch(() => {});
        }
        if (reason === 'monthly_reassessment' && notificationMode === 'full') {
            await sendMonthlyStatusSummaryMail({ user, status }).catch(() => {});
        }
    }

    return { previousTier, nextTier, status };
};

const runMonthlyLoyaltyReassessment = async () => {
    await ensureLoyaltyConfigLoaded({ force: true });
    const [rows] = await db.execute("SELECT id FROM users WHERE role = 'customer' AND COALESCE(is_active, 1) = 1");
    let upgraded = 0;
    let changed = 0;
    for (const row of rows) {
        const result = await reassessUserTier(row.id, { reason: 'monthly_reassessment', sendNotifications: true, notificationMode: 'full' });
        if (result.previousTier !== result.nextTier) {
            changed += 1;
            if (TIER_ORDER.indexOf(result.nextTier) > TIER_ORDER.indexOf(result.previousTier)) upgraded += 1;
        }
    }
    return { total: rows.length, changed, upgraded };
};

const isUserBirthdayToday = (dob) => {
    if (!dob) return false;
    const parts = String(dob).split('T')[0].split('-');
    const month = Number(parts[1] || 0);
    const day = Number(parts[2] || 0);
    if (!month || !day) return false;
    const now = new Date();
    return month === now.getMonth() + 1 && day === now.getDate();
};

const issueBirthdayCouponForUser = async (userId, { sendEmail = true } = {}) => {
    const user = await User.findById(userId);
    if (!user?.id || !user?.email) return { created: false, coupon: null, reason: 'user_missing' };
    if (user.isActive === false) return { created: false, coupon: null, reason: 'user_inactive' };
    if (!isUserBirthdayToday(user.dob)) return { created: false, coupon: null, reason: 'not_birthday' };
    const year = new Date().getFullYear();
    const [existingRows] = await db.execute(
        `SELECT id, code
         FROM coupons
         WHERE source_type = 'birthday'
           AND JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.userId')) = ?
           AND CAST(JSON_UNQUOTE(JSON_EXTRACT(metadata_json, '$.year')) AS UNSIGNED) = ?
         ORDER BY id DESC
         LIMIT 1`,
        [String(user.id), Number(year)]
    );
    let coupon = null;
    if (existingRows.length) {
        coupon = existingRows[0];
    } else {
        const status = await getUserLoyaltyStatus(user.id);
        const tierLabel = status?.profile?.label || 'Basic';
        const birthdayDiscountPct = Number(status?.profile?.birthdayDiscountPct ?? 10);
        coupon = await Coupon.createCoupon({
            prefix: 'BDAY',
            name: `${tierLabel} Birthday ${year}`,
            description: `Birthday coupon for ${tierLabel} tier`,
            sourceType: 'birthday',
            scopeType: 'customer',
            discountType: 'percent',
            discountValue: birthdayDiscountPct,
            maxDiscount: null,
            minCartValue: 0,
            usageLimitTotal: null,
            usageLimitPerUser: 1,
            startsAt: new Date(),
            expiresAt: new Date(`${year}-12-31T23:59:59`),
            customerTargets: [user.id],
            metadata: {
                year,
                userId: user.id,
                tier: String(status?.tier || 'regular').toLowerCase()
            }
        }, { createdBy: null });
    }

    if (sendEmail && coupon?.code && !existingRows.length) {
        const template = buildLoyaltyMailTemplate({
            user,
            seed: `birthday|${user.id}|${year}|${coupon.code}`,
            subjects: Array.from({ length: 10 }, (_, i) => `Happy Birthday ${user.name || ''}! Your ${new Date().getFullYear()} coupon is here (${i + 1}/10)`),
            bodyBlocks: [
                'Happy Birthday from SSC Jewellery.',
                `Your birthday coupon code is <strong>${coupon.code}</strong>.`,
                'This coupon can be used once within the validity period for eligible purchases.'
            ],
            actionItems: [
                'Copy your coupon code for checkout.',
                'Apply the code before placing your next order.',
                'Reply if you need help applying the coupon.'
            ],
            assuranceVariants: [
                'We wish you a joyful year ahead and are here if you need support.',
                'Our team is available for any coupon-usage assistance.',
                'Thank you for celebrating with SSC Jewellery.',
                'Reply to this email if your coupon does not apply as expected.',
                'We are happy to help you redeem this birthday benefit.',
                'Enjoy your special reward from our team.',
                'Our customer support can assist with any checkout issue.',
                'Wishing you happiness and a wonderful celebration.',
                'Keep this email for coupon reference during checkout.',
                'We appreciate your trust and wish you a lovely birthday.'
            ]
        });
        await sendEmailCommunication({
            to: user.email,
            subject: template.subject,
            text: template.text,
            html: template.html
        }).catch(() => {});
    }
    if (coupon?.code && !existingRows.length && user?.mobile) {
        const status = await getUserLoyaltyStatus(user.id).catch(() => null);
        const offer = `${Number(status?.profile?.birthdayDiscountPct ?? 10)}% OFF`;
        const validUntil = formatDateLabel(new Date(`${year}-12-31T23:59:59`)) || `31 Dec ${year}`;
        await sendWhatsapp({
            type: 'birthday',
            template: 'birthday',
            mobile: user.mobile,
            user: { name: user.name || 'Customer' },
            data: {
                couponCode: coupon.code,
                offer,
                validUntil
            }
        }).catch(() => {});
    }
    return { created: !existingRows.length, coupon };
};

const issueBirthdayCouponsForEligibleUsersToday = async () => {
    const [rows] = await db.execute(
        `SELECT id, dob, email
         FROM users
         WHERE role = 'customer'
           AND COALESCE(is_active, 1) = 1
           AND email IS NOT NULL
           AND dob IS NOT NULL`
    );
    let created = 0;
    let processed = 0;
    for (const row of rows) {
        if (!isUserBirthdayToday(row.dob)) continue;
        processed += 1;
        const result = await issueBirthdayCouponForUser(row.id, { sendEmail: true });
        if (result?.created) created += 1;
    }
    return { processed, created };
};

const getLoyaltyConfigForAdmin = async () => {
    const cfg = await ensureLoyaltyConfigLoaded({ force: true });
    return TIER_ORDER.map((tier) => ({
        tier,
        ...(cfg[tier] || DEFAULT_LOYALTY_CONFIG[tier] || DEFAULT_LOYALTY_CONFIG.regular)
    }));
};

const updateLoyaltyConfigForAdmin = async (items = []) => {
    const rows = Array.isArray(items) ? items : [];
    for (const raw of rows) {
        const tier = String(raw?.tier || '').toLowerCase();
        if (!TIER_ORDER.includes(tier)) continue;
        const fallback = DEFAULT_LOYALTY_CONFIG[tier] || DEFAULT_LOYALTY_CONFIG.regular;
        const nextRecord = {
            extraDiscountPct: toMoney(raw?.extraDiscountPct ?? fallback.extraDiscountPct),
            shippingDiscountPct: toMoney(raw?.shippingDiscountPct ?? fallback.shippingDiscountPct),
            birthdayDiscountPct: toMoney(raw?.birthdayDiscountPct ?? fallback.birthdayDiscountPct ?? 10),
            abandonedCartBoostPct: toMoney(raw?.abandonedCartBoostPct ?? fallback.abandonedCartBoostPct),
            priorityWeight: Number(raw?.priorityWeight ?? fallback.priorityWeight ?? 0),
            shippingPriority: normalizeShippingPriority(raw?.shippingPriority || fallback.shippingPriority || 'standard')
        };
        const benefits = buildBenefitsFromValues(tier, nextRecord);
        await db.execute(
            `INSERT INTO loyalty_tier_config
                (tier, label, color, threshold, window_days, extra_discount_pct, shipping_discount_pct, birthday_discount_pct, abandoned_cart_boost_pct, priority_weight, shipping_priority, benefits_json, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
             ON DUPLICATE KEY UPDATE
                label = VALUES(label),
                color = VALUES(color),
                threshold = VALUES(threshold),
                window_days = VALUES(window_days),
                extra_discount_pct = VALUES(extra_discount_pct),
                shipping_discount_pct = VALUES(shipping_discount_pct),
                birthday_discount_pct = VALUES(birthday_discount_pct),
                abandoned_cart_boost_pct = VALUES(abandoned_cart_boost_pct),
                priority_weight = VALUES(priority_weight),
                shipping_priority = VALUES(shipping_priority),
                benefits_json = VALUES(benefits_json),
                is_active = VALUES(is_active)`,
            [
                tier,
                String(raw?.label || fallback.label || tier),
                String(fallback.color || '#4B5563'),
                toMoney(raw?.threshold ?? fallback.threshold),
                Math.max(1, Number(raw?.windowDays ?? fallback.windowDays) || fallback.windowDays),
                nextRecord.extraDiscountPct,
                nextRecord.shippingDiscountPct,
                nextRecord.birthdayDiscountPct,
                nextRecord.abandonedCartBoostPct,
                nextRecord.priorityWeight,
                nextRecord.shippingPriority,
                JSON.stringify(benefits)
            ]
        );
    }
    return getLoyaltyConfigForAdmin();
};

const reassessActiveCustomersForConfigChange = async ({ reason = 'admin_config_update' } = {}) => {
    await ensureLoyaltyConfigLoaded({ force: true });
    const [rows] = await db.execute("SELECT id FROM users WHERE role = 'customer' AND COALESCE(is_active, 1) = 1");
    const updates = [];
    for (const row of rows) {
        const userId = String(row?.id || '').trim();
        if (!userId) continue;
        const result = await reassessUserTier(userId, {
            reason,
            sendNotifications: false,
            notificationMode: 'silent'
        });
        const user = await User.findById(userId);
        if (!user) continue;
        updates.push({
            ...User.toSafePayload(user),
            loyaltyTier: result?.status?.effectiveTier || result?.nextTier || 'regular',
            loyaltyProfile: result?.status?.profile || getLoyaltyProfileByTier(result?.status?.effectiveTier || result?.nextTier || 'regular'),
            earnedLoyaltyTier: result?.nextTier || 'regular',
            earnedLoyaltyProfile: result?.status?.earnedProfile || getLoyaltyProfileByTier(result?.nextTier || 'regular')
        });
    }
    return updates;
};

module.exports = {
    TIER_ORDER,
    LOYALTY_CONFIG: DEFAULT_LOYALTY_CONFIG,
    ensureLoyaltyConfigLoaded,
    getLoyaltyConfigForAdmin,
    updateLoyaltyConfigForAdmin,
    getLoyaltyProfileByTier,
    getUserLoyaltyStatus,
    calculateOrderLoyaltyAdjustments,
    reassessUserTier,
    reassessActiveCustomersForConfigChange,
    runMonthlyLoyaltyReassessment,
    issueBirthdayCouponForUser,
    issueBirthdayCouponsForEligibleUsersToday,
    __test: {
        sendTierUpgradeMail,
        sendMonthlyStatusSummaryMail,
        sendFomoMailIfEligible
    }
};
