import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpDown, CalendarDays, Download, Filter, Mail, MessageCircle, Phone, RefreshCw, Search, Send, Settings2, ShoppingCart, X } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useToast } from '../../context/ToastContext';
import { formatAdminDateTime } from '../../utils/dateFormat';
import { useAdminKPI } from '../../context/AdminKPIContext';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import cartIllustration from '../../assets/cart.svg';
import EmptyState from '../../components/EmptyState';

const journeyStatusOptions = [
    { value: 'all', label: 'All' },
    { value: 'pending', label: 'Pending' },
    { value: 'active', label: 'Active' },
    { value: 'recovered', label: 'Recovered' },
    { value: 'expired', label: 'Expired' },
    { value: 'cancelled', label: 'Cancelled' }
];
const mobileJourneyStatusOptions = [
    { value: 'new', label: 'New' },
    { value: 'attempted', label: 'Attempted' },
    { value: 'completed', label: 'Completed' },
    { value: 'expired', label: 'Expired' },
    { value: 'all', label: 'All' }
];

const sortOptions = [
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'highest_value', label: 'Highest Cart Value' },
    { value: 'lowest_value', label: 'Lowest Cart Value' },
    { value: 'next_due', label: 'Next Due' }
];
const insightRangeOptions = [
    { value: 7, label: 'Last 7 days' },
    { value: 30, label: 'Last 30 days' },
    { value: 90, label: 'Last 90 days' }
];
const journeyWindowOptions = [
    { value: 'last_10', label: 'Last 10 Journeys' },
    { value: '7', label: 'Last Week' },
    { value: '30', label: 'Last Month' },
    { value: '90', label: 'Last 3 Months' }
];
const KPI_THEME_SEQUENCE = ['sky', 'green', 'pink', 'brown', 'red'];
const KPI_CARD_THEMES = {
    sky: {
        shell: 'bg-gradient-to-br from-sky-200 via-sky-300 to-cyan-500 border-sky-700/80',
        label: 'text-sky-950',
        value: 'text-sky-950',
        iconGhost: 'text-sky-950/20'
    },
    green: {
        shell: 'bg-gradient-to-br from-lime-200 via-emerald-300 to-green-500 border-emerald-700/80',
        label: 'text-emerald-950',
        value: 'text-emerald-950',
        iconGhost: 'text-emerald-950/20'
    },
    pink: {
        shell: 'bg-gradient-to-br from-fuchsia-200 via-pink-300 to-rose-500 border-fuchsia-700/80',
        label: 'text-rose-950',
        value: 'text-rose-950',
        iconGhost: 'text-rose-950/20'
    },
    brown: {
        shell: 'bg-gradient-to-br from-amber-200 via-orange-300 to-stone-500 border-amber-800/80',
        label: 'text-stone-950',
        value: 'text-stone-950',
        iconGhost: 'text-stone-950/20'
    },
    red: {
        shell: 'bg-gradient-to-br from-rose-200 via-red-300 to-red-500 border-red-700/80',
        label: 'text-red-950',
        value: 'text-red-950',
        iconGhost: 'text-red-950/20'
    }
};
const applyKpiThemeRotation = (cards = [], startIndex = 0) => cards.map((card, index) => ({
    ...card,
    theme: KPI_THEME_SEQUENCE[(startIndex + index) % KPI_THEME_SEQUENCE.length]
}));
const MOBILE_JOURNEY_CARD_THEMES = {
    new: {
        shell: 'border-sky-200 bg-gradient-to-br from-white via-sky-50/60 to-cyan-50/75 shadow-sky-100/70',
        strip: 'from-sky-400 via-cyan-400 to-sky-300',
        meta: 'border-sky-100 bg-sky-50/80',
        divider: 'border-sky-100'
    },
    attempted: {
        shell: 'border-amber-200 bg-gradient-to-br from-white via-amber-50/60 to-orange-50/75 shadow-amber-100/70',
        strip: 'from-amber-400 via-orange-400 to-amber-300',
        meta: 'border-amber-100 bg-amber-50/80',
        divider: 'border-amber-100'
    },
    attemptedStrong: {
        shell: 'border-orange-200 bg-gradient-to-br from-white via-orange-50/60 to-amber-50/75 shadow-orange-100/70',
        strip: 'from-orange-500 via-amber-400 to-orange-300',
        meta: 'border-orange-100 bg-orange-50/80',
        divider: 'border-orange-100'
    },
    completed: {
        shell: 'border-emerald-200 bg-gradient-to-br from-white via-emerald-50/60 to-lime-50/75 shadow-emerald-100/70',
        strip: 'from-emerald-400 via-lime-400 to-emerald-300',
        meta: 'border-emerald-100 bg-emerald-50/80',
        divider: 'border-emerald-100'
    },
    expired: {
        shell: 'border-rose-200 bg-gradient-to-br from-white via-rose-50/60 to-red-50/75 shadow-rose-100/70',
        strip: 'from-rose-400 via-red-400 to-rose-300',
        meta: 'border-rose-100 bg-rose-50/80',
        divider: 'border-rose-100'
    }
};
const getTimelineTheme = (status = '') => {
    const key = String(status || '').toLowerCase();
    if (key === 'cancelled') {
        return {
            shell: 'border-red-200 bg-gradient-to-br from-white via-rose-50/60 to-red-50/75',
            panel: 'border-red-100 bg-red-50/70',
            title: 'text-red-800',
            dot: 'bg-red-500'
        };
    }
    if (key === 'pending' || key === 'expired') {
        return {
            shell: 'border-amber-200 bg-gradient-to-br from-white via-amber-50/60 to-orange-50/75',
            panel: 'border-amber-100 bg-amber-50/70',
            title: 'text-amber-800',
            dot: 'bg-amber-500'
        };
    }
    return {
        shell: 'border-emerald-200 bg-gradient-to-br from-white via-emerald-50/60 to-teal-50/75',
        panel: 'border-emerald-100 bg-emerald-50/70',
        title: 'text-emerald-800',
        dot: 'bg-emerald-500'
    };
};

const numberArrayInput = (value) => {
    if (Array.isArray(value)) return value.join(',');
    return '';
};

const parseIntegerCsv = (value, { min = 0, fieldLabel = 'Field' } = {}) => {
    const raw = String(value || '').trim();
    if (!raw) return { values: [], error: `${fieldLabel} is required` };
    const parts = raw.split(',').map((part) => part.trim());
    if (parts.some((part) => !part.length)) {
        return { values: [], error: `${fieldLabel} has an empty value. Use comma-separated numbers only.` };
    }
    const values = [];
    for (const part of parts) {
        if (!/^-?\d+$/.test(part)) {
            return { values: [], error: `${fieldLabel} contains invalid value "${part}"` };
        }
        const num = Number(part);
        if (!Number.isFinite(num) || num < min) {
            return { values: [], error: `${fieldLabel} values must be integers >= ${min}` };
        }
        values.push(num);
    }
    return { values, error: null };
};

const statusClass = (status) => {
    const key = String(status || '').toLowerCase();
    if (key === 'pending') return 'bg-amber-200 text-amber-950 border border-amber-300';
    if (key === 'recovered') return 'bg-lime-200 text-emerald-950 border border-lime-300';
    if (key === 'active') return 'bg-sky-200 text-sky-950 border border-sky-300';
    if (key === 'expired') return 'bg-fuchsia-200 text-rose-950 border border-fuchsia-300';
    if (key === 'cancelled') return 'bg-red-200 text-red-950 border border-red-300';
    return 'bg-amber-200 text-amber-950 border border-amber-300';
};
const getMobileJourneyLifecycleStatus = (journey = {}) => {
    const backendStatus = String(journey?.status || '').toLowerCase();
    if (backendStatus === 'recovered' || String(journey?.recovered_order_ref || '').trim()) return 'completed';
    if (backendStatus === 'expired' || backendStatus === 'cancelled') return 'expired';
    if (Number(journey?.last_attempt_no || 0) > 0) return 'attempted';
    return 'new';
};
const getMobileJourneyStatusLabel = (journey = {}) => {
    const key = getMobileJourneyLifecycleStatus(journey);
    if (key === 'completed') return 'Completed';
    if (key === 'attempted') return 'Attempted';
    if (key === 'expired') return 'Expired';
    return 'New';
};
const getMobileJourneyStatusBadgeClass = (journey = {}) => {
    const key = getMobileJourneyLifecycleStatus(journey);
    if (key === 'completed') return 'bg-lime-200 text-emerald-950 border border-lime-300';
    if (key === 'attempted') return 'bg-amber-200 text-amber-950 border border-amber-300';
    if (key === 'expired') return 'bg-red-200 text-red-950 border border-red-300';
    return 'bg-sky-200 text-sky-950 border border-sky-300';
};
const getMobileJourneyFilterBadgeClass = (value = '', active = false) => {
    if (!active) return 'border-gray-200 bg-white text-gray-600';
    if (value === 'completed') return 'bg-lime-200 text-emerald-950 border border-lime-300';
    if (value === 'attempted') return 'bg-amber-200 text-amber-950 border border-amber-300';
    if (value === 'expired') return 'bg-red-200 text-red-950 border border-red-300';
    if (value === 'new') return 'bg-sky-200 text-sky-950 border border-sky-300';
    return 'bg-slate-200 text-slate-800 border border-slate-300';
};
const getMobileJourneyCardTheme = (journey = {}) => {
    const key = getMobileJourneyLifecycleStatus(journey);
    if (key === 'attempted' && Number(journey?.last_attempt_no || 0) >= 3) return MOBILE_JOURNEY_CARD_THEMES.attemptedStrong;
    return MOBILE_JOURNEY_CARD_THEMES[key] || MOBILE_JOURNEY_CARD_THEMES.new;
};
const inr = (value) => `₹${Number(value || 0).toLocaleString()}`;
const normalizeText = (value = '') => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
const formatCurrencyWithCode = (subunits = 0, currency = 'INR') => {
    const amount = Number(subunits || 0) / 100;
    return `${String(currency || 'INR').toUpperCase()} ${amount.toFixed(2)}`;
};
const formatPreviewDate = (value = '') => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) return raw;
    return parsed.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const stripHtml = (value = '') => String(value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const firstNonEmpty = (...values) => values.map((value) => normalizeText(value)).find(Boolean) || '';
const getCallHref = (mobile = '') => {
    const digits = String(mobile || '').replace(/\D/g, '');
    return digits ? `tel:${digits}` : '';
};
const getWhatsappHref = (mobile = '') => {
    const digits = String(mobile || '').replace(/\D/g, '');
    if (!digits) return '';
    const full = digits.length === 10 ? `91${digits}` : digits;
    return `https://wa.me/${full}`;
};
const formatCustomerContacts = (journey) => {
    const email = String(journey?.customer_email || '').trim();
    const mobile = String(journey?.customer_mobile || '').trim();
    if (email && mobile) return `${email} | ${mobile}`;
    return email || mobile || '—';
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

const buildAttemptReminderMessage = (attemptNo = 1) => {
    const messages = [
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
    const idx = Math.min(messages.length - 1, Math.max(0, Number(attemptNo || 1) - 1));
    return messages[idx] || messages[0];
};

const buildWhatsappPreviewText = (attempt = {}, journey = {}) => {
    const response = attempt?.response_json?.whatsapp || {};
    const directText = firstNonEmpty(
        response.preview,
        response.message,
        response.body,
        response.content,
        response.reason
    );
    if (directText && !['whatsapp_send_failed', 'whatsapp_disabled'].includes(String(response.reason || '').toLowerCase())) {
        return directText;
    }

    const payload = attempt?.payload_json || {};
    const name = normalizeText(journey?.customer_name || 'Customer') || 'Customer';
    const attemptNo = Number(payload?.attemptNo || attempt?.attempt_no || 1);
    const reminderMessage = firstNonEmpty(payload?.attemptMessage, buildAttemptReminderMessage(attemptNo));
    const cartValue = formatCurrencyWithCode(payload?.cartValueSubunits || 0, journey?.currency || 'INR');
    const discountPercent = Math.max(0, Number(payload?.discountPercent || 0));
    const discountLabel = firstNonEmpty(payload?.discountLabel, discountPercent > 0 ? `${discountPercent}% OFF` : 'Special offer');
    const validUntil = formatPreviewDate(payload?.validUntil || payload?.linkExpiry || '');
    const paymentLinkUrl = firstNonEmpty(payload?.paymentLinkUrl, payload?.checkoutUrl);
    const message = payload?.discountCode
        ? `Hello ${name}, ${reminderMessage} Coupon: ${payload.discountCode}. Discount: ${discountLabel}. Valid Until: ${validUntil || 'Limited period'}.`
        : `Hello ${name}, ${reminderMessage} Cart Value: ${cartValue}.`;
    const failure = firstNonEmpty(attempt?.error_message, response.message, response.reason);
    return [message, paymentLinkUrl ? `Link: ${paymentLinkUrl}` : '', failure && failure !== message ? `Delivery note: ${failure}` : '']
        .filter(Boolean)
        .join('\n\n')
        || 'No WhatsApp preview available for this attempt yet.';
};

const buildEmailPreviewText = (attempt = {}, journey = {}) => {
    const response = attempt?.response_json?.email || {};
    const directSubject = firstNonEmpty(response.subject);
    const directBody = firstNonEmpty(
        response.preview,
        response.message,
        response.body,
        response.content,
        stripHtml(response.html)
    );
    if (directSubject || directBody) {
        return [directSubject ? `Subject: ${directSubject}` : '', directBody].filter(Boolean).join('\n\n');
    }

    const payload = attempt?.payload_json || {};
    const attemptNo = Number(payload?.attemptNo || attempt?.attempt_no || 1);
    const discountPercent = Math.max(0, Number(payload?.discountPercent || 0));
    const subject = buildRecoverySubject({ attemptNo, discountPercent });
    const shippingValue = Number.isFinite(Number(payload?.shippingFeeSubunits))
        ? formatCurrencyWithCode(payload?.shippingFeeSubunits || 0, journey?.currency || 'INR')
        : '';
    const totalValue = Number.isFinite(Number(payload?.totalWithShippingSubunits))
        ? formatCurrencyWithCode(payload?.totalWithShippingSubunits || 0, journey?.currency || 'INR')
        : '';
    const paymentLinkUrl = firstNonEmpty(payload?.paymentLinkUrl, payload?.checkoutUrl);
    const expiryText = formatPreviewDate(payload?.linkExpiry || '');
    const lines = [
        `Hi ${normalizeText(journey?.customer_name || 'there') || 'there'},`,
        `Your cart (${formatCurrencyWithCode(payload?.cartValueSubunits || 0, journey?.currency || 'INR')}) is waiting.`,
        shippingValue ? `Shipping: ${shippingValue}` : '',
        totalValue ? `Total to pay: ${totalValue}` : '',
        expiryText ? `Pay before ${expiryText}.` : '',
        payload?.discountCode && discountPercent > 0
            ? `Use code ${payload.discountCode} for ${discountPercent}% OFF.`
            : 'Complete your purchase before items go out of stock.',
        'Review your items, confirm details, and complete checkout.',
        'Need help? Reply to this email and our support team will assist you.',
        paymentLinkUrl ? `Continue here: ${paymentLinkUrl}` : ''
    ].filter(Boolean).join('\n');
    const failure = firstNonEmpty(attempt?.error_message, response.message, response.reason);
    return [
        subject ? `Subject: ${subject}` : '',
        lines,
        failure ? `Delivery note: ${failure}` : ''
    ].filter(Boolean).join('\n\n') || 'No email preview available for this attempt yet.';
};

const attemptHasChannelData = (attempt = {}, channel = '') => {
    const channels = Array.isArray(attempt?.channels_json) ? attempt.channels_json : Array.isArray(attempt?.channels) ? attempt.channels : [];
    if (channels.includes(channel)) return true;
    const response = attempt?.response_json?.[channel];
    if (!response || typeof response !== 'object') return false;
    const reason = String(response.reason || '').toLowerCase();
    if (response.skipped && ['email_disabled_or_missing', 'whatsapp_disabled'].includes(reason)) return false;
    return true;
};
const JOURNEY_PAGE_SIZE = 20;
const MAX_CAMPAIGN_ATTEMPTS = 6;
const RECOVERY_WINDOW_BUFFER_HOURS = 2;
const buildVisiblePages = (currentPage, totalPages, windowSize = 5) => {
    const safeTotal = Math.max(1, Number(totalPages || 1));
    const safeCurrent = Math.min(safeTotal, Math.max(1, Number(currentPage || 1)));
    if (safeTotal <= windowSize) return Array.from({ length: safeTotal }, (_, idx) => idx + 1);
    const half = Math.floor(windowSize / 2);
    let start = Math.max(1, safeCurrent - half);
    let end = Math.min(safeTotal, start + windowSize - 1);
    if (end - start + 1 < windowSize) start = Math.max(1, end - windowSize + 1);
    return Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
};

const isJourneyReadyForList = (journey, inactivityMinutes) => {
    if (!journey) return false;
    const status = String(journey.status || '').toLowerCase();
    if (status !== 'active') return true;
    if (Number(journey.last_attempt_no || 0) > 0) return true;
    const minutes = Math.max(1, Number(inactivityMinutes || 30));
    const lastActivityRaw = journey.last_activity_at || journey.updated_at || journey.created_at;
    const lastActivity = lastActivityRaw ? new Date(lastActivityRaw) : null;
    if (!lastActivity || Number.isNaN(lastActivity.getTime())) return true;
    return (Date.now() - lastActivity.getTime()) >= minutes * 60 * 1000;
};

export default function AbandonedCarts({ storefrontOpen = true }) {
    const toast = useToast();
    const {
        abandonedInsightsByKey,
        registerAbandonedInsightsRange,
        setAbandonedInsightsSnapshot,
        markAbandonedInsightsDirty,
        fetchAbandonedInsights,
        toAbandonedInsightsKey
    } = useAdminKPI();
    const [campaignDraft, setCampaignDraft] = useState(null);
    const [insights, setInsights] = useState(null);
    const [journeys, setJourneys] = useState([]);
    const [journeyTotal, setJourneyTotal] = useState(0);
    const [status, setStatus] = useState('all');
    const [mobileStatusFilter, setMobileStatusFilter] = useState('new');
    const [sortBy, setSortBy] = useState('newest');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [page, setPage] = useState(1);
    const [rangeDays, setRangeDays] = useState(30);
    const [journeyWindow, setJourneyWindow] = useState('last_10');
    const [isMobileStatusModalOpen, setIsMobileStatusModalOpen] = useState(false);
    const [isMobileSortModalOpen, setIsMobileSortModalOpen] = useState(false);
    const [isMobileSearchModalOpen, setIsMobileSearchModalOpen] = useState(false);
    const [isMobileRangeModalOpen, setIsMobileRangeModalOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isSavingCampaign, setIsSavingCampaign] = useState(false);
    const [isProcessingNow, setIsProcessingNow] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isSettingsOpen, setIsSettingsOpen] = useState(false);
    const [selectedTimeline, setSelectedTimeline] = useState(null);
    const [isTimelineLoading, setIsTimelineLoading] = useState(false);
    const [isCartOpen, setIsCartOpen] = useState(false);
    const [isCartLoading, setIsCartLoading] = useState(false);
    const [cartItems, setCartItems] = useState([]);
    const [cartJourney, setCartJourney] = useState(null);
    const [messagePreview, setMessagePreview] = useState({ isOpen: false, channel: '', title: '', content: '', loading: false });
    const [attemptDelaysInput, setAttemptDelaysInput] = useState('');
    const [discountLadderInput, setDiscountLadderInput] = useState('');
    const realtimeRefreshTimerRef = useRef(null);
    const insightsKey = toAbandonedInsightsKey(rangeDays);
    const sharedInsights = abandonedInsightsByKey[insightsKey]?.insights || null;
    const isLatestJourneyWindow = journeyWindow === 'last_10';
    const journeyRangeDays = isLatestJourneyWindow ? 90 : Math.max(1, Math.min(90, Number(journeyWindow || 30)));
    const journeyPageSize = isLatestJourneyWindow ? 10 : JOURNEY_PAGE_SIZE;

    const loadCampaign = useCallback(async () => {
        const data = await adminService.getAbandonedCartCampaign();
        const nextCampaign = data.campaign || null;
        setCampaignDraft(nextCampaign);
        setAttemptDelaysInput(numberArrayInput(nextCampaign?.attemptDelaysMinutes));
        setDiscountLadderInput(numberArrayInput(nextCampaign?.discountLadderPercent));
    }, []);

    const loadInsights = useCallback(async () => {
        const data = await adminService.getAbandonedCartInsights(rangeDays);
        const resolvedInsights = data.insights || null;
        setInsights(resolvedInsights);
        if (resolvedInsights) {
            setAbandonedInsightsSnapshot(rangeDays, resolvedInsights);
        }
    }, [rangeDays, setAbandonedInsightsSnapshot]);

    const loadJourneys = useCallback(async () => {
        const data = await adminService.getAbandonedCartJourneys({
            status,
            sortBy,
            search,
            rangeDays: journeyRangeDays,
            limit: journeyPageSize,
            offset: isLatestJourneyWindow ? 0 : (Math.max(1, Number(page || 1)) - 1) * journeyPageSize
        });
        setJourneys(data.journeys || []);
        setJourneyTotal(isLatestJourneyWindow ? Number((data.journeys || []).length || 0) : Number(data.total || 0));
    }, [isLatestJourneyWindow, journeyPageSize, journeyRangeDays, page, search, sortBy, status]);

    const loadAll = useCallback(async () => {
        setIsLoading(true);
        try {
            await Promise.all([loadCampaign(), loadInsights(), loadJourneys()]);
        } catch (error) {
            toast.error(error.message || 'Failed to load abandoned cart data');
        } finally {
            setIsLoading(false);
        }
    }, [loadCampaign, loadInsights, loadJourneys, toast]);

    useEffect(() => {
        loadAll();
    }, [loadAll]);

    useEffect(() => {
        registerAbandonedInsightsRange(rangeDays);
        fetchAbandonedInsights(rangeDays).catch(() => {});
    }, [fetchAbandonedInsights, rangeDays, registerAbandonedInsightsRange]);

    useEffect(() => {
        if (isLoading) return;
        loadJourneys().catch(() => {});
    }, [status, sortBy, search, page, isLoading, loadJourneys]);

    useEffect(() => {
        if (isLoading) return;
        loadInsights().catch(() => {});
    }, [rangeDays, isLoading, loadInsights]);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (search === searchInput) return;
            setSearch(searchInput);
        }, 250);
        return () => clearTimeout(timer);
    }, [search, searchInput]);

    useEffect(() => {
        setPage(1);
    }, [status, sortBy, search, journeyWindow]);

    const cards = useMemo(() => {
        const effectiveInsights = sharedInsights || insights;
        const totals = effectiveInsights?.totals || {};
        return applyKpiThemeRotation([
            { label: 'Total Journeys', value: Number(totals.totalJourneys || 0) },
            { label: 'Recovered', value: Number(totals.recoveredJourneys || 0) },
            { label: 'Recovery Rate', value: `${Number(totals.recoveryRate || 0).toFixed(2)}%` },
            { label: 'Recovered Value', value: inr(totals.recoveredValue || 0) }
        ]);
    }, [insights, sharedInsights]);
    const mobileJourneys = useMemo(() => {
        if (mobileStatusFilter === 'all') return journeys;
        return journeys.filter((journey) => getMobileJourneyLifecycleStatus(journey) === mobileStatusFilter);
    }, [journeys, mobileStatusFilter]);

    const totalPages = useMemo(
        () => isLatestJourneyWindow ? 1 : Math.max(1, Math.ceil(Number(journeyTotal || 0) / JOURNEY_PAGE_SIZE)),
        [isLatestJourneyWindow, journeyTotal]
    );
    const visiblePages = useMemo(() => buildVisiblePages(page, totalPages, 5), [page, totalPages]);

    useEffect(() => {
        setPage((prev) => Math.min(Math.max(1, Number(prev || 1)), totalPages));
    }, [totalPages]);

    const handleCampaignField = (key, value) => {
        setCampaignDraft((prev) => ({ ...(prev || {}), [key]: value }));
    };

    const campaignValidation = useMemo(() => {
        if (!campaignDraft) return { isValid: false, errors: {}, parsed: null };
        const errors = {};

        const maxAttempts = Number(campaignDraft.maxAttempts);
        const inactivityMinutes = Number(campaignDraft.inactivityMinutes);
        const recoveryWindowHours = Number(campaignDraft.recoveryWindowHours);
        const maxDiscountPercent = Number(campaignDraft.maxDiscountPercent);
        const minDiscountCartValue = Number(campaignDraft.minDiscountCartValue);

        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            errors.maxAttempts = 'Max attempts must be an integer >= 1';
        } else if (maxAttempts > MAX_CAMPAIGN_ATTEMPTS) {
            errors.maxAttempts = `Max attempts cannot exceed ${MAX_CAMPAIGN_ATTEMPTS}`;
        }
        if (!Number.isInteger(inactivityMinutes) || inactivityMinutes < 1) {
            errors.inactivityMinutes = 'Inactivity must be an integer >= 1';
        }
        if (!Number.isInteger(recoveryWindowHours) || recoveryWindowHours < 1) {
            errors.recoveryWindowHours = 'Recovery window must be an integer >= 1';
        }
        if (!Number.isInteger(maxDiscountPercent) || maxDiscountPercent < 0) {
            errors.maxDiscountPercent = 'Max discount must be an integer >= 0';
        }
        if (!Number.isFinite(minDiscountCartValue) || minDiscountCartValue < 0) {
            errors.minDiscountCartValue = 'Minimum cart value must be a number >= 0';
        }

        let minRecommendedRecoveryWindowHours = null;
        let effectiveRecoveryWindowHours = recoveryWindowHours;

        const attemptDelays = parseIntegerCsv(attemptDelaysInput, {
            min: 1,
            fieldLabel: 'Attempt delays'
        });
        if (attemptDelays.error) {
            errors.attemptDelaysMinutes = attemptDelays.error;
        } else if (Number.isInteger(maxAttempts) && maxAttempts > 0 && attemptDelays.values.length !== maxAttempts) {
            errors.attemptDelaysMinutes = `Expected ${maxAttempts} values to match max attempts`;
        } else if (!errors.maxAttempts) {
            const totalDelayMinutes = attemptDelays.values.reduce((sum, value) => sum + Number(value || 0), 0);
            minRecommendedRecoveryWindowHours = Math.max(1, Math.ceil(totalDelayMinutes / 60) + RECOVERY_WINDOW_BUFFER_HOURS);
            if (!errors.recoveryWindowHours) {
                effectiveRecoveryWindowHours = Math.max(recoveryWindowHours, minRecommendedRecoveryWindowHours);
            }
        }

        const discountLadder = parseIntegerCsv(discountLadderInput, {
            min: 0,
            fieldLabel: 'Discount ladder'
        });
        if (discountLadder.error) {
            errors.discountLadderPercent = discountLadder.error;
        } else if (Number.isInteger(maxAttempts) && maxAttempts > 0 && discountLadder.values.length !== maxAttempts) {
            errors.discountLadderPercent = `Expected ${maxAttempts} values to match max attempts`;
        } else if (
            !errors.maxDiscountPercent
            && discountLadder.values.some((value) => value > maxDiscountPercent)
        ) {
            errors.discountLadderPercent = 'Discount ladder values cannot exceed max discount';
        }

        return {
            isValid: Object.keys(errors).length === 0,
            errors,
            parsed: {
                maxAttempts,
                inactivityMinutes,
                recoveryWindowHours: effectiveRecoveryWindowHours,
                maxDiscountPercent,
                minDiscountCartValue,
                attemptDelaysMinutes: attemptDelays.values,
                discountLadderPercent: discountLadder.values
            },
            minRecommendedRecoveryWindowHours
        };
    }, [attemptDelaysInput, campaignDraft, discountLadderInput]);

    const handleSaveCampaign = async () => {
        if (!campaignDraft) return;
        if (!campaignValidation.isValid) {
            const firstError = Object.values(campaignValidation.errors)[0];
            toast.error(firstError || 'Please fix campaign field errors');
            return false;
        }
        setIsSavingCampaign(true);
        try {
            const parsed = campaignValidation.parsed;
            const payload = {
                enabled: Boolean(campaignDraft.enabled),
                inactivityMinutes: parsed.inactivityMinutes,
                maxAttempts: parsed.maxAttempts,
                attemptDelaysMinutes: parsed.attemptDelaysMinutes,
                discountLadderPercent: parsed.discountLadderPercent,
                maxDiscountPercent: parsed.maxDiscountPercent,
                minDiscountCartValue: parsed.minDiscountCartValue,
                recoveryWindowHours: parsed.recoveryWindowHours,
                sendEmail: Boolean(campaignDraft.sendEmail),
                sendWhatsapp: Boolean(campaignDraft.sendWhatsapp),
                sendPaymentLink: Boolean(campaignDraft.sendPaymentLink),
                reminderEnable: Boolean(campaignDraft.reminderEnable)
            };
            const data = await adminService.updateAbandonedCartCampaign(payload);
            const nextCampaign = data.campaign || null;
            setCampaignDraft(nextCampaign);
            setAttemptDelaysInput(numberArrayInput(nextCampaign?.attemptDelaysMinutes));
            setDiscountLadderInput(numberArrayInput(nextCampaign?.discountLadderPercent));
            adminService.invalidateAbandonedCache();
            await Promise.all([loadJourneys(), loadInsights()]);
            markAbandonedInsightsDirty(rangeDays);
            fetchAbandonedInsights(rangeDays, { force: true }).catch(() => {});
            toast.success('Campaign settings updated');
            return true;
        } catch (error) {
            toast.error(error.message || 'Failed to update campaign settings');
            return false;
        } finally {
            setIsSavingCampaign(false);
        }
    };

    const handleProcessNow = async () => {
        setIsProcessingNow(true);
        try {
            const data = await adminService.processAbandonedCartRecoveries(50);
            const due = Number(data?.stats?.due || 0);
            const sent = Number(data?.stats?.sent || 0);
            const skipped = Number(data?.stats?.skipped || 0);
            const failed = Number(data?.stats?.failed || 0);
            const recovered = Number(data?.stats?.recovered || 0);
            const cancelled = Number(data?.stats?.cancelled || 0);
            const expired = Number(data?.stats?.expired || 0);
            const failedReasons = data?.stats?.failedReasons || {};
            const topFailure = Object.entries(failedReasons)
                .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0))[0];

            toast.success(`Recovery run: due ${due}, sent ${sent}, skipped ${skipped}, failed ${failed}, recovered ${recovered}, cancelled ${cancelled}, expired ${expired}`);
            if (failed > 0 && topFailure) {
                toast.error(`Top failure (${topFailure[1]}): ${topFailure[0]}`);
            }
            markAbandonedInsightsDirty(rangeDays);
            fetchAbandonedInsights(rangeDays, { force: true }).catch(() => {});
            await Promise.all([loadJourneys(), loadInsights()]);
        } catch (error) {
            toast.error(error.message || 'Failed to process abandoned carts');
        } finally {
            setIsProcessingNow(false);
        }
    };

    const openTimeline = useCallback(async (journeyId) => {
        if (!journeyId) return;
        setIsTimelineLoading(true);
        setSelectedTimeline({ journey: { id: journeyId }, attempts: [], discounts: [] });
        try {
            const data = await adminService.getAbandonedCartJourneyTimeline(journeyId);
            setSelectedTimeline(data || null);
        } catch (error) {
            toast.error(error.message || 'Failed to load timeline');
        } finally {
            setIsTimelineLoading(false);
        }
    }, [toast]);

    const closeTimeline = () => setSelectedTimeline(null);

    const openCart = useCallback(async (journey) => {
        if (!journey?.user_id) {
            toast.error('Cart is unavailable for this journey');
            return;
        }
        setCartJourney(journey);
        setIsCartOpen(true);
        setIsCartLoading(true);
        try {
            const data = await adminService.getUserCart(journey.user_id);
            setCartItems(Array.isArray(data?.items) ? data.items : []);
        } catch (error) {
            toast.error(error?.message || 'Failed to load cart');
            setCartItems([]);
        } finally {
            setIsCartLoading(false);
        }
    }, [toast]);

    const openMessagePreview = useCallback(async (journey, channel) => {
        const label = channel === 'whatsapp' ? 'WhatsApp' : 'Email';
        setMessagePreview({
            isOpen: true,
            channel,
            title: `${label} Preview`,
            content: '',
            loading: true
        });
        try {
            const timeline = await adminService.getAbandonedCartJourneyTimeline(journey.id);
            const attempts = Array.isArray(timeline?.attempts) ? timeline.attempts : [];
            const latestAttempt = [...attempts].reverse().find((attempt) => attemptHasChannelData(attempt, channel)) || attempts[attempts.length - 1] || {};
            const content = channel === 'whatsapp'
                ? buildWhatsappPreviewText(latestAttempt, journey)
                : buildEmailPreviewText(latestAttempt, journey);
            setMessagePreview({
                isOpen: true,
                channel,
                title: `${label} Preview${latestAttempt?.attempt_no ? ` · Attempt #${latestAttempt.attempt_no}` : ''}`,
                content,
                loading: false
            });
        } catch (error) {
            setMessagePreview({
                isOpen: true,
                channel,
                title: `${label} Preview`,
                content: error?.message || `Failed to load ${label.toLowerCase()} preview`,
                loading: false
            });
        }
    }, []);

    const toCsvCell = (value) => {
        const safe = String(value ?? '').replace(/"/g, '""');
        return `"${safe}"`;
    };

    const toCsvDateTime = (value) => {
        if (!value) return '';
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return String(value);
        return parsed.toISOString();
    };

    const handleExportReport = async () => {
        setIsExporting(true);
        try {
            const allJourneys = [];
            let offset = 0;
            const limit = 100;
            while (offset <= 5000) {
                const batch = await adminService.getAbandonedCartJourneys({ status, search, sortBy, limit, offset });
                const rows = Array.isArray(batch?.journeys) ? batch.journeys : [];
                allJourneys.push(...rows);
                if (rows.length < limit || rows.length === 0) break;
                offset += limit;
            }
            if (allJourneys.length === 0) {
                toast.error('No abandoned cart journeys found for export');
                return;
            }

            const exportRows = [];
            for (const journey of allJourneys) {
                const timeline = await adminService.getAbandonedCartJourneyTimeline(journey.id).catch(() => null);
                const attempts = Array.isArray(timeline?.attempts) ? timeline.attempts : [];
                const discounts = Array.isArray(timeline?.discounts) ? timeline.discounts : [];
                const rowCount = Math.max(1, attempts.length, discounts.length);
                for (let idx = 0; idx < rowCount; idx += 1) {
                    const attempt = attempts[idx] || {};
                    const discount = discounts[idx] || {};
                    exportRows.push([
                        journey.id,
                        journey.status || '',
                        journey.customer_name || '',
                        journey.customer_email || '',
                        journey.customer_mobile || '',
                        Number(journey.cart_total_subunits || 0) / 100,
                        Number(journey.last_attempt_no || 0),
                        toCsvDateTime(journey.computed_last_activity_at || journey.last_activity_at || journey.updated_at),
                        toCsvDateTime(journey.next_attempt_at || ''),
                        journey.recovered_order_ref || '',
                        timeline?.journey?.recovery_reason || timeline?.journey?.reason || '',
                        toCsvDateTime(journey.created_at),
                        toCsvDateTime(journey.updated_at),
                        attempt.attempt_no ?? attempt.attemptNo ?? '',
                        attempt.status || '',
                        Array.isArray(attempt.channels_json)
                            ? attempt.channels_json.join('|')
                            : Array.isArray(attempt.channels)
                                ? attempt.channels.join('|')
                                : '',
                        Number(attempt.discount_percent || attempt.discountPercent || 0),
                        toCsvDateTime(attempt.sent_at || attempt.sentAt || attempt.created_at),
                        attempt.payment_link_id || attempt.paymentLinkId || '',
                        attempt.payment_id || attempt.paymentId || '',
                        toCsvDateTime(attempt.created_at),
                        discount.code || '',
                        Number(discount.discount_percent || discount.discountPercent || 0),
                        discount.status || '',
                        toCsvDateTime(discount.expires_at || discount.expiresAt),
                        toCsvDateTime(discount.redeemed_at || discount.redeemedAt),
                        toCsvDateTime(discount.created_at)
                    ]);
                }
            }

            const header = [
                'Journey ID',
                'Journey Status',
                'Customer Name',
                'Customer Email',
                'Customer Mobile',
                'Cart Value',
                'Attempt Count',
                'Last Activity',
                'Next Attempt',
                'Recovered Order Ref',
                'Recovery Reason',
                'Journey Created At',
                'Journey Updated At',
                'Attempt No',
                'Attempt Status',
                'Attempt Channels',
                'Attempt Discount Percent',
                'Attempt Sent At',
                'Attempt Payment Link ID',
                'Attempt Payment ID',
                'Attempt Created At',
                'Discount Code',
                'Discount Percent',
                'Discount Status',
                'Discount Expires At',
                'Discount Redeemed At',
                'Discount Created At'
            ];
            const csv = [
                header.map(toCsvCell).join(','),
                ...exportRows.map((row) => row.map(toCsvCell).join(','))
            ].join('\n');
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `abandoned-cart-report-${new Date().toISOString().slice(0, 10)}.csv`;
            document.body.appendChild(anchor);
            anchor.click();
            document.body.removeChild(anchor);
            URL.revokeObjectURL(url);
            toast.success(`Exported ${exportRows.length} rows from ${allJourneys.length} journeys`);
        } catch (error) {
            toast.error(error.message || 'Failed to export report');
        } finally {
            setIsExporting(false);
        }
    };

    const scheduleRealtimeRefresh = useCallback(() => {
        if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = setTimeout(() => {
            adminService.invalidateAbandonedCache();
            markAbandonedInsightsDirty(rangeDays);
            fetchAbandonedInsights(rangeDays, { force: true }).catch(() => {});
            loadJourneys().catch(() => {});
            if (selectedTimeline?.journey?.id) {
                openTimeline(selectedTimeline.journey.id);
            }
        }, 120);
    }, [fetchAbandonedInsights, loadJourneys, markAbandonedInsightsDirty, openTimeline, rangeDays, selectedTimeline?.journey?.id]);

    const handleAbandonedUpdate = useCallback((payload = {}) => {
        if (payload?.journey?.id) {
            const nextJourney = {
                ...payload.journey,
                computed_last_activity_at:
                    payload.journey.computed_last_activity_at
                    || payload.journey.last_activity_at
                    || payload.journey.updated_at
                    || payload.ts
                    || null
            };
            const shouldShow = isJourneyReadyForList(nextJourney, campaignDraft?.inactivityMinutes);
            setJourneys((prev) => {
                const rows = Array.isArray(prev) ? prev : [];
                const idx = rows.findIndex((row) => String(row.id) === String(nextJourney.id));
                if (!shouldShow) {
                    if (idx < 0) return rows;
                    const next = rows.filter((row) => String(row.id) !== String(nextJourney.id));
                    return next;
                }
                if (idx >= 0) {
                    const copy = [...rows];
                    copy[idx] = {
                        ...copy[idx],
                        ...nextJourney,
                        computed_last_activity_at:
                            nextJourney.computed_last_activity_at
                            || nextJourney.last_activity_at
                            || nextJourney.updated_at
                            || copy[idx].computed_last_activity_at
                    };
                    return copy;
                }
                return [{ ...nextJourney }, ...rows];
            });
        }
        scheduleRealtimeRefresh();
    }, [campaignDraft?.inactivityMinutes, scheduleRealtimeRefresh]);

    useAdminCrudSync({
        'abandoned_cart:update': handleAbandonedUpdate,
        'abandoned_cart:journey:update': handleAbandonedUpdate,
        'abandoned_cart:recovered': handleAbandonedUpdate,
        'order:create': scheduleRealtimeRefresh,
        'order:update': scheduleRealtimeRefresh,
        'payment:update': scheduleRealtimeRefresh
    });

    useEffect(() => {
        return () => {
            if (realtimeRefreshTimerRef.current) clearTimeout(realtimeRefreshTimerRef.current);
        };
    }, []);

    useEffect(() => {
        // Safety reconcile in case any socket message is missed.
        const timer = setInterval(() => {
            adminService.invalidateAbandonedCache();
            markAbandonedInsightsDirty(rangeDays);
            fetchAbandonedInsights(rangeDays, { force: true }).catch(() => {});
            loadJourneys().catch(() => {});
            if (selectedTimeline?.journey?.id) {
                openTimeline(selectedTimeline.journey.id);
            }
        }, 15000);
        return () => clearInterval(timer);
    }, [
        fetchAbandonedInsights,
        loadJourneys,
        markAbandonedInsightsDirty,
        openTimeline,
        rangeDays,
        selectedTimeline?.journey?.id
    ]);

    const renderCampaignSettingsForm = () => (
        !campaignDraft ? (
            <div className="text-sm text-gray-400">Loading settings...</div>
        ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <label className="text-sm text-gray-600">Inactivity (minutes)
                    <input type="number" value={campaignDraft.inactivityMinutes || 30} onChange={(e) => handleCampaignField('inactivityMinutes', e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.inactivityMinutes ? 'border-red-300' : 'border-gray-200'}`} />
                    {campaignValidation.errors.inactivityMinutes && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.inactivityMinutes}</p>}
                </label>
                <label className="text-sm text-gray-600">Max attempts
                    <input type="number" min="1" max={MAX_CAMPAIGN_ATTEMPTS} value={campaignDraft.maxAttempts || 4} onChange={(e) => handleCampaignField('maxAttempts', e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.maxAttempts ? 'border-red-300' : 'border-gray-200'}`} />
                    {campaignValidation.errors.maxAttempts && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.maxAttempts}</p>}
                </label>
                <label className="text-sm text-gray-600">Attempt delays (minutes)
                    <input type="text" value={attemptDelaysInput} onChange={(e) => setAttemptDelaysInput(e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.attemptDelaysMinutes ? 'border-red-300' : 'border-gray-200'}`} placeholder="30, 360, 1440" />
                    {campaignValidation.errors.attemptDelaysMinutes && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.attemptDelaysMinutes}</p>}
                </label>
                <label className="text-sm text-gray-600">Discount ladder (%)
                    <input type="text" value={discountLadderInput} onChange={(e) => setDiscountLadderInput(e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.discountLadderPercent ? 'border-red-300' : 'border-gray-200'}`} placeholder="0, 0, 5, 10" />
                    {campaignValidation.errors.discountLadderPercent && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.discountLadderPercent}</p>}
                </label>
                <label className="text-sm text-gray-600">Max discount (%)
                    <input type="number" value={campaignDraft.maxDiscountPercent || 25} onChange={(e) => handleCampaignField('maxDiscountPercent', e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.maxDiscountPercent ? 'border-red-300' : 'border-gray-200'}`} />
                    {campaignValidation.errors.maxDiscountPercent && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.maxDiscountPercent}</p>}
                </label>
                <label className="text-sm text-gray-600">Min cart value for discount (₹)
                    <input type="number" min="0" step="1" value={campaignDraft.minDiscountCartValue ?? 0} onChange={(e) => handleCampaignField('minDiscountCartValue', e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.minDiscountCartValue ? 'border-red-300' : 'border-gray-200'}`} />
                    {campaignValidation.errors.minDiscountCartValue && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.minDiscountCartValue}</p>}
                </label>
                <label className="text-sm text-gray-600">Recovery window (hours)
                    <input type="number" value={campaignDraft.recoveryWindowHours || 72} onChange={(e) => handleCampaignField('recoveryWindowHours', e.target.value)} className={`mt-1 w-full px-3 py-2 border rounded-lg ${campaignValidation.errors.recoveryWindowHours ? 'border-red-300' : 'border-gray-200'}`} />
                    {campaignValidation.errors.recoveryWindowHours && <p className="mt-1 text-xs text-red-600">{campaignValidation.errors.recoveryWindowHours}</p>}
                    {!campaignValidation.errors.recoveryWindowHours
                        && Number.isFinite(campaignValidation.minRecommendedRecoveryWindowHours)
                        && Number(campaignDraft.recoveryWindowHours || 0) < Number(campaignValidation.minRecommendedRecoveryWindowHours || 0) && (
                        <p className="mt-1 text-xs text-amber-700">
                            Will auto-extend to {campaignValidation.minRecommendedRecoveryWindowHours}h based on configured delays (includes {RECOVERY_WINDOW_BUFFER_HOURS}h buffer).
                        </p>
                    )}
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(campaignDraft.enabled)} onChange={(e) => handleCampaignField('enabled', e.target.checked)} /> Enabled</label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(campaignDraft.sendEmail)} onChange={(e) => handleCampaignField('sendEmail', e.target.checked)} /> Email</label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(campaignDraft.sendWhatsapp)} onChange={(e) => handleCampaignField('sendWhatsapp', e.target.checked)} /> WhatsApp</label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(campaignDraft.sendPaymentLink)} onChange={(e) => handleCampaignField('sendPaymentLink', e.target.checked)} /> Payment Link</label>
                <label className="inline-flex items-center gap-2 text-sm text-gray-700"><input type="checkbox" checked={Boolean(campaignDraft.reminderEnable)} onChange={(e) => handleCampaignField('reminderEnable', e.target.checked)} /> Razorpay Reminders</label>
            </div>
        )
    );

    if (!storefrontOpen) {
        return (
            <div className="animate-fade-in space-y-6 grayscale">
                <div className="rounded-3xl border border-gray-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                        <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-gray-400">Module Inactive</p>
                            <h1 className="mt-2 text-2xl md:text-3xl font-serif font-bold text-gray-900">Abandoned Cart Recovery</h1>
                            <p className="mt-2 max-w-2xl text-sm text-gray-600">
                                Storefront ordering is currently closed, so abandoned-cart capture, recovery messages, and manual recovery runs are paused. Existing orders continue to be fulfilled.
                            </p>
                        </div>
                        <div className="rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
                            Reopen the storefront from <span className="font-semibold">Settings</span> to reactivate this module.
                        </div>
                    </div>
                </div>
                <div className="rounded-3xl border border-dashed border-gray-300 bg-white p-10 text-center shadow-sm">
                    <img src={cartIllustration} alt="Abandoned cart module inactive" className="mx-auto h-32 w-32 object-contain opacity-70" />
                    <p className="mt-4 text-lg font-semibold text-gray-800">Recovery automation is paused</p>
                    <p className="mt-2 text-sm text-gray-500">
                        Campaign settings, exports, and manual recovery actions are unavailable while new orders are paused.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="animate-fade-in space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3 md:block">
                        <h1 className="text-2xl md:text-3xl font-serif text-primary font-bold">Abandoned Cart Recovery</h1>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">Campaign settings, recovery insights, journeys and timelines.</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={handleExportReport}
                        disabled={isExporting || isLoading}
                        className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-semibold hover:bg-gray-50 disabled:opacity-60"
                    >
                        <Download size={14} />
                        {isExporting ? 'Exporting...' : 'Export Report'}
                    </button>
                    <button
                        type="button"
                        onClick={() => setIsSettingsOpen(true)}
                        className="inline-flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white text-gray-700 hover:bg-gray-50"
                        title="Campaign settings"
                    >
                        <Settings2 size={18} />
                    </button>
                    <select
                        value={rangeDays}
                        onChange={(e) => setRangeDays(Number(e.target.value || 30))}
                        className="hidden md:block px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm"
                    >
                        {insightRangeOptions.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        onClick={handleProcessNow}
                        disabled={isProcessingNow}
                        className="hidden md:inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60"
                    >
                        <RefreshCw size={14} className={isProcessingNow ? 'animate-spin' : ''} />
                        {isProcessingNow ? 'Processing...' : 'Run Recovery Now'}
                    </button>
                </div>
            </div>

            <div className="hidden md:grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                {cards.map((card) => (
                    <div key={card.label} className={`emboss-card relative overflow-hidden rounded-2xl border shadow-sm p-5 ${KPI_CARD_THEMES[card.theme || 'sky'].shell}`}>
                        <ShoppingCart size={54} className={`bg-emboss-icon absolute right-2 bottom-2 ${KPI_CARD_THEMES[card.theme || 'sky'].iconGhost}`} />
                        <p className={`text-xs uppercase tracking-widest font-semibold ${KPI_CARD_THEMES[card.theme || 'sky'].label}`}>{card.label}</p>
                        <p className={`text-xl font-bold mt-1 ${KPI_CARD_THEMES[card.theme || 'sky'].value}`}>{card.value}</p>
                    </div>
                ))}
            </div>

            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100 flex flex-col md:flex-row md:items-center gap-2 md:justify-between">
                    <p className="text-sm text-gray-500">Journeys ({journeyTotal})</p>
                    <div className="hidden md:flex flex-col md:flex-row gap-2 w-full md:w-auto">
                        <div className="relative">
                            <Filter className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                            <select value={status} onChange={(e) => setStatus(e.target.value)} className="pl-9 pr-7 py-2 rounded-lg border border-gray-200 bg-white text-sm w-full md:w-auto">
                                {journeyStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        </div>
                        <div className="relative">
                            <CalendarDays className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                            <select value={journeyWindow} onChange={(e) => setJourneyWindow(String(e.target.value || 'last_10'))} className="pl-9 pr-7 py-2 rounded-lg border border-gray-200 bg-white text-sm w-full md:w-auto">
                                {journeyWindowOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                            </select>
                        </div>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm w-full md:w-auto">
                            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <div className="relative">
                            <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="pl-9 pr-3 py-2 rounded-lg border border-gray-200 bg-white text-sm w-full md:w-64" placeholder="Search customer / id" />
                        </div>
                    </div>
                    <div className="flex items-center justify-end gap-2 md:hidden">
                        <button
                            type="button"
                            onClick={() => setIsMobileSortModalOpen(true)}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                                sortBy !== 'newest' ? 'border-sky-200 bg-sky-50 text-sky-700' : 'border-gray-200 bg-white text-gray-600'
                            }`}
                            title="Sort Journeys"
                            aria-label="Sort Journeys"
                        >
                            <ArrowUpDown size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsMobileRangeModalOpen(true)}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                                journeyWindow !== 'last_10' ? 'border-fuchsia-200 bg-fuchsia-50 text-fuchsia-700' : 'border-gray-200 bg-white text-gray-600'
                            }`}
                            title="Journey duration"
                            aria-label="Journey duration"
                        >
                            <CalendarDays size={18} />
                        </button>
                        <button
                            type="button"
                            onClick={() => setIsMobileSearchModalOpen(true)}
                            className={`inline-flex h-11 w-11 items-center justify-center rounded-xl border shadow-sm transition ${
                                searchInput ? 'border-primary/20 bg-primary/5 text-primary' : 'border-gray-200 bg-white text-gray-600'
                            }`}
                            title="Search Journeys"
                            aria-label="Search Journeys"
                        >
                            <Search size={18} />
                        </button>
                    </div>
                    <div className="md:hidden w-full pb-1">
                        <div className="flex flex-wrap gap-2">
                            {mobileJourneyStatusOptions.map((option) => {
                                const active = mobileStatusFilter === option.value;
                                return (
                                    <button
                                        key={option.value}
                                        type="button"
                                        onClick={() => setMobileStatusFilter(option.value)}
                                        className={`inline-flex max-w-full items-center justify-center rounded-full border px-3 py-2 text-[11px] font-semibold leading-none transition ${getMobileJourneyFilterBadgeClass(option.value, active)}`}
                                    >
                                        {option.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                </div>

                {isLoading ? (
                    <div className="py-14 text-center text-gray-400">Loading abandoned cart journeys...</div>
                ) : journeys.length === 0 ? (
                    <div className="py-14 text-center text-gray-400 flex flex-col items-center">
                        <img src={cartIllustration} alt="No journeys" className="w-36 h-36 object-contain opacity-85" />
                        <p className="mt-3 text-sm font-semibold text-gray-700">No abandoned journeys available</p>
                        <p className="text-xs text-gray-500 mt-1">Try adjusting status, search, or sorting filters.</p>
                    </div>
                ) : (
                    <>
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left">
                            <thead className="bg-gray-50 border-b border-gray-100">
                                <tr>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Journey</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Customer</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Cart Value</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Status</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Attempts</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Last Activity</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500">Next Attempt</th>
                                    <th className="px-5 py-3 text-xs uppercase tracking-wider text-gray-500 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {journeys.map((journey) => (
                                    <tr key={journey.id}>
                                        <td className="px-5 py-3 text-sm font-semibold text-gray-800">#{journey.id}</td>
                                        <td className="px-5 py-3 text-sm text-gray-700">
                                            <p className="font-medium">{journey.customer_name || 'Guest'}</p>
                                            <p className="text-xs text-gray-400">{formatCustomerContacts(journey)}</p>
                                        </td>
                                        <td className="px-5 py-3 text-sm text-gray-700">{inr((Number(journey.cart_total_subunits || 0) / 100))}</td>
                                        <td className="px-5 py-3 text-sm">
                                            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${statusClass(journey.status)}`}>{journey.status}</span>
                                            {journey.recovered_order_ref && (
                                                <p className="text-[11px] text-emerald-700 mt-1">Recovered by {journey.recovered_order_ref}</p>
                                            )}
                                        </td>
                                        <td className="px-5 py-3 text-sm text-gray-700">{Number(journey.last_attempt_no || 0)}</td>
                                        <td className="px-5 py-3 text-xs text-gray-500">{formatAdminDateTime(journey.computed_last_activity_at || journey.last_activity_at || journey.updated_at)}</td>
                                        <td className="px-5 py-3 text-xs text-gray-500">
                                            {journey.next_attempt_at ? (
                                                <div>
                                                    <p>#{Number(journey.last_attempt_no || 0) + 1}</p>
                                                    <p>{formatAdminDateTime(journey.next_attempt_at)}</p>
                                                </div>
                                            ) : '—'}
                                        </td>
                                        <td className="px-5 py-3 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {!!getCallHref(journey.customer_mobile) && (
                                                    <a href={getCallHref(journey.customer_mobile)} className="p-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100" title="Call Customer">
                                                        <Phone size={14} />
                                                    </a>
                                                )}
                                                {!!getWhatsappHref(journey.customer_mobile) && (
                                                    <a href={getWhatsappHref(journey.customer_mobile)} target="_blank" rel="noreferrer" className="p-1.5 rounded-md border border-green-200 bg-green-50 text-green-700 shadow-sm transition-colors hover:bg-green-100" title="Contact customer on WhatsApp">
                                                        <MessageCircle size={14} />
                                                    </a>
                                                )}
                                                {journey.user_id && (
                                                    <button type="button" onClick={() => openCart(journey)} className="relative p-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition-colors hover:bg-amber-100" title="View Cart">
                                                        <ShoppingCart size={14} />
                                                    </button>
                                                )}
                                                <button type="button" onClick={() => openMessagePreview(journey, 'whatsapp')} className="p-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100" title="Preview WhatsApp message">
                                                    <Send size={14} />
                                                </button>
                                                <button type="button" onClick={() => openMessagePreview(journey, 'email')} className="p-1.5 rounded-md border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition-colors hover:bg-sky-100" title="Preview Email">
                                                    <Mail size={14} />
                                                </button>
                                                {journey.source_type === 'candidate' ? (
                                                    <span className="ml-2 text-[11px] font-medium text-gray-400">Waiting for inactivity window</span>
                                                ) : (
                                                    <button type="button" onClick={() => openTimeline(journey.id)} className="px-3 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50">Timeline</button>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <div className="md:hidden space-y-4 p-4">
                        {mobileJourneys.length === 0 ? (
                            <div className="py-10 text-center text-gray-400">
                                No journeys match the selected mobile filter.
                            </div>
                        ) : mobileJourneys.map((journey) => {
                            const theme = getMobileJourneyCardTheme(journey);
                            return (
                                <div key={journey.id} className={`relative overflow-hidden rounded-2xl border p-4 shadow-sm ${theme.shell}`}>
                                    <div className={`absolute inset-x-0 top-0 h-1.5 bg-gradient-to-r ${theme.strip}`} />
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="min-w-0">
                                            <p className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-semibold">Journey</p>
                                            <p className="mt-1 text-sm font-semibold text-gray-800">#{journey.id}</p>
                                            <p className="mt-2 text-sm font-medium text-gray-700">{journey.customer_name || 'Guest'}</p>
                                            <p className="text-xs text-gray-400">{formatCustomerContacts(journey)}</p>
                                        </div>
                                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                                            <span className={`inline-flex px-2.5 py-1 rounded-full text-xs font-semibold ${getMobileJourneyStatusBadgeClass(journey)}`}>{getMobileJourneyStatusLabel(journey)}</span>
                                            {!!journey.recovered_order_ref && (
                                                <p className="max-w-[110px] text-right text-[11px] text-emerald-700">Recovered by {journey.recovered_order_ref}</p>
                                            )}
                                        </div>
                                    </div>
                                    <div className={`mt-3 grid grid-cols-2 gap-3 rounded-2xl border px-3 py-3 ${theme.meta}`}>
                                        <div>
                                            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Cart Value</p>
                                            <p className="mt-1 text-sm font-semibold text-gray-800">{inr((Number(journey.cart_total_subunits || 0) / 100))}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Attempts</p>
                                            <p className="mt-1 text-sm text-gray-700">{Number(journey.last_attempt_no || 0)}</p>
                                        </div>
                                        <div>
                                            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Last Activity</p>
                                            <p className="mt-1 text-xs text-gray-500">{formatAdminDateTime(journey.computed_last_activity_at || journey.last_activity_at || journey.updated_at)}</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold">Next Attempt</p>
                                            <p className="mt-1 text-xs text-gray-500">{journey.next_attempt_at ? `#${Number(journey.last_attempt_no || 0) + 1} · ${formatAdminDateTime(journey.next_attempt_at)}` : '—'}</p>
                                        </div>
                                    </div>
                                    <div className={`mt-3 flex items-center justify-between gap-3 border-t pt-3 ${theme.divider}`}>
                                        <div className="flex items-center gap-1.5">
                                            {!!getCallHref(journey.customer_mobile) && (
                                                <a href={getCallHref(journey.customer_mobile)} className="p-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100" title="Call Customer">
                                                    <Phone size={14} />
                                                </a>
                                            )}
                                            {!!getWhatsappHref(journey.customer_mobile) && (
                                                <a href={getWhatsappHref(journey.customer_mobile)} target="_blank" rel="noreferrer" className="p-1.5 rounded-md border border-green-200 bg-green-50 text-green-700 shadow-sm transition-colors hover:bg-green-100" title="Contact customer on WhatsApp">
                                                    <MessageCircle size={14} />
                                                </a>
                                            )}
                                            {journey.user_id && (
                                                <button type="button" onClick={() => openCart(journey)} className="relative p-1.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 shadow-sm transition-colors hover:bg-amber-100" title="View Cart">
                                                    <ShoppingCart size={14} />
                                                </button>
                                            )}
                                            <button type="button" onClick={() => openMessagePreview(journey, 'whatsapp')} className="p-1.5 rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 shadow-sm transition-colors hover:bg-emerald-100" title="Preview WhatsApp message">
                                                <Send size={14} />
                                            </button>
                                            <button type="button" onClick={() => openMessagePreview(journey, 'email')} className="p-1.5 rounded-md border border-sky-200 bg-sky-50 text-sky-700 shadow-sm transition-colors hover:bg-sky-100" title="Preview Email">
                                                <Mail size={14} />
                                            </button>
                                        </div>
                                        {journey.source_type === 'candidate' ? (
                                            <span className="text-right text-[11px] font-medium text-gray-400">Waiting for inactivity window</span>
                                        ) : (
                                            <button type="button" onClick={() => openTimeline(journey.id)} className="rounded-md border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-700 shadow-sm hover:bg-violet-100">Timeline</button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="px-5 py-4 border-t border-gray-100 flex items-center justify-between gap-3">
                        <p className="text-xs text-gray-500">
                            Page {page} of {totalPages}
                        </p>
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                                disabled={page <= 1}
                                className="px-3 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Previous
                            </button>
                            {visiblePages.map((pageNo) => (
                                <button
                                    key={pageNo}
                                    type="button"
                                    onClick={() => setPage(pageNo)}
                                    className={`px-3 py-1.5 rounded-md border text-xs font-semibold ${
                                        pageNo === page
                                            ? 'border-primary bg-primary text-accent'
                                            : 'border-gray-200 text-gray-700 hover:bg-gray-50'
                                    }`}
                                >
                                    {pageNo}
                                </button>
                            ))}
                            <button
                                type="button"
                                onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                                disabled={page >= totalPages}
                                className="px-3 py-1.5 rounded-md border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                            >
                                Next
                            </button>
                        </div>
                    </div>
                    </>
                )}
            </div>

            {isSettingsOpen && createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
                    <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto bg-white rounded-2xl border border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3 mb-4">
                            <h3 className="text-lg font-semibold text-gray-800">Campaign Settings</h3>
                            <button type="button" onClick={() => setIsSettingsOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                                <X size={16} />
                            </button>
                        </div>
                        {renderCampaignSettingsForm()}
                        <div className="mt-5 flex items-center justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsSettingsOpen(false)}
                                className="px-4 py-2 rounded-lg border border-gray-200 text-sm font-semibold text-gray-600 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={async () => {
                                    const ok = await handleSaveCampaign();
                                    if (ok) setIsSettingsOpen(false);
                                }}
                                disabled={isSavingCampaign || !campaignDraft || !campaignValidation.isValid}
                                className="px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light disabled:opacity-60"
                            >
                                {isSavingCampaign ? 'Saving...' : 'Save Settings'}
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {isMobileStatusModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end md:hidden">
                    <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setIsMobileStatusModalOpen(false)} aria-label="Close status filter" />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Journey Status</h3>
                        <p className="mt-1 text-sm text-gray-500">Filter abandoned cart journeys by status.</p>
                        <select value={status} onChange={(e) => setStatus(e.target.value)} className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-accent">
                            {journeyStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <button type="button" onClick={() => setIsMobileStatusModalOpen(false)} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light">
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isMobileSortModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end md:hidden">
                    <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setIsMobileSortModalOpen(false)} aria-label="Close sort modal" />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Sort Journeys</h3>
                        <p className="mt-1 text-sm text-gray-500">Choose how to order the journey list.</p>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-accent">
                            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <button type="button" onClick={() => setIsMobileSortModalOpen(false)} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light">
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isMobileRangeModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end md:hidden">
                    <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setIsMobileRangeModalOpen(false)} aria-label="Close duration modal" />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Journey Duration</h3>
                        <p className="mt-1 text-sm text-gray-500">Limit the list to recent abandoned-cart journeys.</p>
                        <select value={journeyWindow} onChange={(e) => setJourneyWindow(String(e.target.value || 'last_10'))} className="mt-4 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-900 shadow-sm outline-none focus:border-accent">
                            {journeyWindowOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                        <button type="button" onClick={() => setIsMobileRangeModalOpen(false)} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light">
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isMobileSearchModalOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end md:hidden">
                    <button type="button" className="absolute inset-0 bg-black/45 backdrop-blur-sm" onClick={() => setIsMobileSearchModalOpen(false)} aria-label="Close search modal" />
                    <div className="relative w-full rounded-t-3xl bg-white px-5 pb-6 pt-5 shadow-2xl max-h-[82vh] overflow-y-auto">
                        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-gray-200" />
                        <h3 className="text-lg font-bold text-gray-900">Search Journeys</h3>
                        <p className="mt-1 text-sm text-gray-500">Search by customer name, mobile, email, or journey id.</p>
                        <div className="relative mt-4">
                            <Search className="absolute left-3 top-3.5 h-5 w-5 text-gray-400" />
                            <input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} className="w-full rounded-2xl border border-gray-200 bg-white py-3 pl-10 pr-4 text-sm shadow-sm outline-none focus:border-accent" placeholder="Search customer / id" autoFocus />
                        </div>
                        <button type="button" onClick={() => setIsMobileSearchModalOpen(false)} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light">
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {isCartOpen && createPortal(
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white border border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800">Customer Cart</h3>
                                <p className="text-xs text-gray-500 mt-1">{cartJourney?.customer_name || 'Guest'}</p>
                            </div>
                            <button type="button" onClick={() => setIsCartOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                                <X size={16} />
                            </button>
                        </div>
                        {isCartLoading ? (
                            <div className="py-10 text-center text-gray-400">Loading cart...</div>
                        ) : cartItems.length === 0 ? (
                            <div className="py-8">
                                <EmptyState image={cartIllustration} alt="No cart items" title="No cart items" description="This customer does not have active cart items right now." compact />
                            </div>
                        ) : (
                            <div className="mt-4 space-y-3">
                                {cartItems.map((item) => (
                                    <div key={`${item.productId || item.product_id}-${item.variantId || item.variant_id || 'base'}`} className="rounded-xl border border-gray-200 p-3">
                                        <div className="flex items-start gap-3">
                                            {item.image ? <img src={item.image} alt={item.title} className="h-14 w-14 rounded-lg object-cover border border-gray-200" /> : <div className="h-14 w-14 rounded-lg bg-gray-100 border border-gray-200" />}
                                            <div className="min-w-0 flex-1">
                                                <p className="text-sm font-semibold text-gray-800 line-clamp-1">{item.title}</p>
                                                {item.variantTitle && <p className="text-xs text-gray-500 line-clamp-1 mt-1">{item.variantTitle}</p>}
                                                <div className="mt-2 flex items-center justify-between gap-3">
                                                    <p className="text-xs text-gray-500">Qty: {item.quantity}</p>
                                                    <p className="text-sm font-semibold text-gray-800">{inr(item.price || 0)}</p>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>,
                document.body
            )}

            {messagePreview.isOpen && createPortal(
                <div className="fixed inset-0 z-[110] flex items-end sm:items-center justify-center bg-black/45 backdrop-blur-sm p-4">
                    <div className="w-full max-w-lg max-h-[calc(100vh-2rem)] overflow-y-auto rounded-2xl bg-white border border-gray-200 shadow-2xl p-5">
                        <div className="flex items-center justify-between gap-3">
                            <h3 className="text-lg font-semibold text-gray-800">{messagePreview.title}</h3>
                            <button type="button" onClick={() => setMessagePreview({ isOpen: false, channel: '', title: '', content: '', loading: false })} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                                <X size={16} />
                            </button>
                        </div>
                        {messagePreview.loading ? (
                            <div className="py-10 text-center text-gray-400">Loading preview...</div>
                        ) : (
                            <pre className="mt-4 whitespace-pre-wrap rounded-2xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700 font-sans">
                                {messagePreview.content}
                            </pre>
                        )}
                        <button type="button" onClick={() => setMessagePreview({ isOpen: false, channel: '', title: '', content: '', loading: false })} className="mt-5 w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-accent shadow-sm transition hover:bg-primary-light">
                            Close
                        </button>
                    </div>
                </div>,
                document.body
            )}

            {selectedTimeline && createPortal(
                <div className="fixed inset-0 z-[80] flex items-stretch justify-end bg-black/40 backdrop-blur-sm">
                    {(() => {
                        const timelineTheme = getTimelineTheme(selectedTimeline?.journey?.status);
                        return (
                    <div className="bg-white w-full max-w-xl h-full overflow-y-auto p-6 shadow-2xl">
                        <div className="flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-gray-800">Journey Timeline #{selectedTimeline?.journey?.id}</h3>
                            <button type="button" onClick={closeTimeline} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                        </div>

                        {isTimelineLoading ? (
                            <div className="py-14 text-center text-gray-400">Loading timeline...</div>
                        ) : (
                            <div className="space-y-5 mt-4">
                                <div className={`rounded-2xl border p-4 ${timelineTheme.shell}`}>
                                    <p className={`text-xs font-semibold uppercase tracking-widest ${timelineTheme.title}`}>Journey Status</p>
                                    <p className="text-sm font-semibold text-gray-800 mt-1">{selectedTimeline?.journey?.status}</p>
                                    {selectedTimeline?.journey?.recovery_reason && (
                                        <p className="text-xs text-gray-500 mt-1">Reason: {selectedTimeline?.journey?.recovery_reason}</p>
                                    )}
                                    <p className="text-xs text-gray-500 mt-2">
                                        Next attempt: {selectedTimeline?.journey?.next_attempt_at
                                            ? `#${Number(selectedTimeline?.journey?.last_attempt_no || 0) + 1} · ${formatAdminDateTime(selectedTimeline.journey.next_attempt_at)}`
                                            : '—'}
                                    </p>
                                    {!!(selectedTimeline?.attempts || []).length && (
                                        <>
                                            {(() => {
                                                const attempts = selectedTimeline?.attempts || [];
                                                const latestAttempt = attempts[attempts.length - 1];
                                                const paymentId = latestAttempt?.response_json?.paymentId || null;
                                                return (
                                                    <div className="mt-2 text-xs text-gray-500 space-y-1">
                                                        <p>Payment Link ID: {latestAttempt?.payment_link_id || '—'}</p>
                                                        <p>Payment ID: {paymentId || '—'}</p>
                                                        <p>Attempt Status: {latestAttempt?.status || '—'}</p>
                                                    </div>
                                                );
                                            })()}
                                        </>
                                    )}
                                </div>

                                <div>
                                    <p className={`mb-2 text-xs font-semibold uppercase tracking-widest ${timelineTheme.title}`}>Attempts</p>
                                    <div className="space-y-3">
                                        {(selectedTimeline?.attempts || []).map((attempt) => (
                                            <div key={attempt.id} className={`rounded-2xl border p-3 ${timelineTheme.panel}`}>
                                                <div className="flex items-center justify-between">
                                                    <p className="text-sm font-semibold text-gray-800">Attempt #{attempt.attempt_no}</p>
                                                    <span className={`text-[11px] px-2 py-0.5 rounded-full border ${attempt.status === 'sent' ? 'bg-emerald-950 text-emerald-100 border-emerald-700' : attempt.status === 'failed' ? 'bg-red-950 text-red-100 border-red-700' : 'bg-slate-900 text-slate-100 border-slate-700'}`}>{attempt.status}</span>
                                                </div>
                                                <p className="text-xs text-gray-500 mt-1">Channels: {(attempt.channels_json || []).join(', ') || '—'}</p>
                                                {attempt.discount_code && <p className="text-xs text-gray-500">Discount: {attempt.discount_code} ({attempt.discount_percent || 0}%)</p>}
                                                <p className="text-xs text-gray-500">Payment Link ID: {attempt.payment_link_id || '—'}</p>
                                                <p className="text-xs text-gray-500">Payment ID: {attempt.response_json?.paymentId || '—'}</p>
                                                {attempt.error_message && (
                                                    <p className="text-xs text-red-600 mt-1">Failure: {attempt.error_message}</p>
                                                )}
                                                {!attempt.error_message && attempt.status === 'failed' && (
                                                    <p className="text-xs text-red-600 mt-1">
                                                        Failure: {
                                                            attempt.response_json?.email?.message
                                                            || attempt.response_json?.whatsapp?.message
                                                            || attempt.response_json?.email?.reason
                                                            || attempt.response_json?.whatsapp?.reason
                                                            || 'All enabled recovery channels failed'
                                                        }
                                                    </p>
                                                )}
                                                {attempt.payment_link_url && <a className="text-xs text-primary" href={attempt.payment_link_url} target="_blank" rel="noreferrer">Open payment link</a>}
                                                <p className="text-xs text-gray-400 mt-1">{formatAdminDateTime(attempt.created_at)}</p>
                                            </div>
                                        ))}
                                        {(selectedTimeline?.attempts || []).length === 0 && (
                                            <EmptyState
                                                image={cartIllustration}
                                                alt="No attempts yet"
                                                title="No attempts yet"
                                                description="Recovery attempts will appear here once this journey starts processing."
                                                compact
                                            />
                                        )}
                                    </div>
                                </div>

                                <div>
                                    <p className={`mb-2 text-xs font-semibold uppercase tracking-widest ${timelineTheme.title}`}>Discounts</p>
                                    <div className="space-y-2">
                                        {(selectedTimeline?.discounts || []).map((discount) => (
                                            <div key={discount.id} className={`rounded-xl border p-3 text-sm text-gray-700 ${timelineTheme.panel}`}>
                                                <p className="font-semibold">{discount.code}</p>
                                                <p className="text-xs text-gray-500">{discount.discount_percent || 0}% · {discount.status}</p>
                                            </div>
                                        ))}
                                        {(selectedTimeline?.discounts || []).length === 0 && (
                                            <EmptyState
                                                image={cartIllustration}
                                                alt="No discounts issued"
                                                title="No discounts issued"
                                                description="Any recovery discount codes created for this journey will appear here."
                                                compact
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                        );
                    })()}
                </div>,
                document.body
            )}
        </div>
    );
}
