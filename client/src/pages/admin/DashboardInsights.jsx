import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, AlertTriangle, Activity, TrendingUp, IndianRupee, Users, ShoppingBag, Target, Bell, Save, Play, Trash2, BarChart3, Funnel, Boxes, UsersRound, Route, CalendarDays, ShieldAlert, Sparkles, PieChart, X, ChevronDown, ChevronUp, Download, Share2, XCircle } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useToast } from '../../context/ToastContext';
import dashboardIllustration from '../../assets/dashboard.svg';
import successIllustration from '../../assets/success.svg';
import successDingAudio from '../../assets/success_ding.mp3';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import { usePwaInstall } from '../../hooks/usePwaInstall';
import { burstConfetti } from '../../utils/celebration';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import TierBadge from '../../components/TierBadge';
import { formatAdminDateTime } from '../../utils/dateFormat';
import {
    ADMIN_QUICK_RANGES,
    DEFAULT_ADMIN_QUICK_RANGE,
    normalizeAdminQuickRange,
    resolveNamedDateRange
} from '../../utils/adminDateRanges';

const QUICK_RANGES = ADMIN_QUICK_RANGES;
const DAILY_TREND_PAGE_SIZE = 6;
const DASHBOARD_CUSTOM_RANGE_MAX_DAYS = 90;
const DASHBOARD_TREND_GRANULARITY_STORAGE_KEY = 'dashboard_trend_granularity_v1';
const KPI_THEME_SEQUENCE = ['green', 'red', 'sky', 'brown', 'pink'];

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const STORE_SHARE_URL = 'https://sscjewels.com';
const STORE_SHARE_TEXT = `SSC Jewels is now Online 🏪
Order 24x7 - Click on the link to place an order

${STORE_SHARE_URL}

Pay using Gpay, Paytm, Phonepe and 150 UPI Apps or Cash.`;
const KPI_CARD_THEMES = {
    sky: {
        shell: 'bg-gradient-to-br from-sky-200 via-sky-300 to-cyan-500 border-sky-700/80',
        label: 'text-slate-900/85',
        value: 'text-slate-950',
        icon: 'text-slate-900/70',
        accent: 'text-slate-900/85',
        subtext: 'text-slate-900/70'
    },
    amber: {
        shell: 'bg-gradient-to-br from-amber-100 via-orange-200 to-orange-300 border-orange-500/70',
        label: 'text-stone-900/85',
        value: 'text-stone-950',
        icon: 'text-stone-900/65',
        accent: 'text-stone-900/80',
        subtext: 'text-stone-900/70'
    },
    green: {
        shell: 'bg-gradient-to-br from-lime-200 via-emerald-300 to-green-500 border-emerald-700/80',
        label: 'text-black/85',
        value: 'text-black',
        icon: 'text-black/70',
        accent: 'text-black/85',
        subtext: 'text-black/70'
    },
    pink: {
        shell: 'bg-gradient-to-br from-fuchsia-200 via-pink-300 to-rose-500 border-fuchsia-700/80',
        label: 'text-rose-950',
        value: 'text-rose-950',
        icon: 'text-rose-950/75',
        accent: 'text-rose-950',
        subtext: 'text-rose-950/75'
    },
    brown: {
        shell: 'bg-gradient-to-br from-amber-200 via-orange-300 to-stone-500 border-amber-800/80',
        label: 'text-white/90 drop-shadow-sm',
        value: 'text-white drop-shadow-sm',
        icon: 'text-white/80 drop-shadow-sm',
        accent: 'text-white/90 drop-shadow-sm',
        subtext: 'text-white/78 drop-shadow-sm'
    },
    red: {
        shell: 'bg-gradient-to-br from-rose-200 via-red-300 to-red-500 border-red-700/80',
        label: 'text-white/90 drop-shadow-sm',
        value: 'text-white drop-shadow-sm',
        icon: 'text-white/80 drop-shadow-sm',
        accent: 'text-white/90 drop-shadow-sm',
        subtext: 'text-white/78 drop-shadow-sm'
    }
};
const GREEN_KPI_PATTERN_STYLE = {
    backgroundColor: '#ddffaa',
    backgroundImage: `linear-gradient(135deg, rgba(255,255,255,0.16), rgba(34,68,17,0.06)), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120' viewBox='0 0 120 120'%3E%3Cpolygon fill='%23AE9' points='120 120 60 120 90 90 120 60 120 0 120 0 60 60 0 0 0 60 30 90 60 120 120 120'/%3E%3C/svg%3E")`,
    backgroundSize: 'cover, 120px 120px'
};
const RED_KPI_PATTERN_STYLE = {
    backgroundColor: '#7f1d1d',
    backgroundImage: 'linear-gradient(135deg, rgba(15,23,42,0.36), rgba(127,29,29,0.2)), linear-gradient(135deg, rgba(254,202,202,0.12) 25%, transparent 25%), linear-gradient(225deg, rgba(244,63,94,0.2) 25%, transparent 25%), linear-gradient(45deg, rgba(190,18,60,0.22) 25%, transparent 25%)',
    backgroundSize: 'cover, 90px 90px, 90px 90px, 90px 90px'
};
const AMBER_KPI_PATTERN_STYLE = {
    backgroundColor: '#fdba74',
    backgroundImage: 'linear-gradient(135deg, rgba(255,255,255,0.24), rgba(120,53,15,0.06)), linear-gradient(135deg, rgba(255,237,213,0.7) 25%, transparent 25%), linear-gradient(225deg, rgba(251,191,36,0.18) 25%, transparent 25%), linear-gradient(45deg, rgba(249,115,22,0.14) 25%, transparent 25%)',
    backgroundSize: 'cover, 90px 90px, 90px 90px, 90px 90px'
};
const SKY_KPI_PATTERN_STYLE = {
    backgroundColor: '#ffffff',
    backgroundImage: `linear-gradient(135deg, rgba(255,255,255,0.28), rgba(30,64,175,0.04)), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160' viewBox='0 0 200 200'%3E%3Cpolygon fill='%23DCEFFA' points='100 0 0 100 100 100 100 200 200 100 200 0'/%3E%3C/svg%3E")`,
    backgroundSize: 'cover, 160px 160px'
};
const BROWN_KPI_PATTERN_STYLE = {
    backgroundColor: '#9a5b00',
    backgroundImage: `linear-gradient(135deg, rgba(69,26,3,0.32), rgba(245,158,11,0.08)), url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='40' height='40' viewBox='0 0 100 100'%3E%3Crect x='0' y='0' width='46' height='46' fill-opacity='0.45' fill='%23c77700'/%3E%3C/svg%3E")`,
    backgroundSize: 'cover, 40px 40px'
};
const getKpiCardStyle = (theme) => {
    if (theme === 'green') return GREEN_KPI_PATTERN_STYLE;
    if (theme === 'amber') return AMBER_KPI_PATTERN_STYLE;
    if (theme === 'red') return RED_KPI_PATTERN_STYLE;
    if (theme === 'sky') return SKY_KPI_PATTERN_STYLE;
    if (theme === 'brown') return BROWN_KPI_PATTERN_STYLE;
    return undefined;
};
const applyKpiThemeRotation = (cards = []) => cards.map((card, index) => ({
    ...card,
    theme: card.theme || KPI_THEME_SEQUENCE[index % KPI_THEME_SEQUENCE.length]
}));
const toRangeDays = ({ quickRange = DEFAULT_ADMIN_QUICK_RANGE, startDate = '', endDate = '' } = {}) => {
    const normalizedQuickRange = normalizeAdminQuickRange(quickRange || DEFAULT_ADMIN_QUICK_RANGE);
    const resolved = resolveNamedDateRange(normalizedQuickRange);
    if (resolved) return resolved.periodDays;
    if (normalizedQuickRange === 'latest_10') return 30;
    if (quickRange === 'custom') {
        const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
        const end = endDate ? new Date(`${endDate}T00:00:00`) : null;
        if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 30;
        const diff = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
        return Math.max(1, Math.min(90, diff));
    }
    return 30;
};

const priorityStyles = {
    high: 'bg-red-200 text-red-950 border-red-300',
    medium: 'bg-amber-200 text-amber-950 border-amber-300',
    low: 'bg-sky-200 text-sky-950 border-sky-300'
};
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAY_MS = 700;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const GOAL_COMPLETION_SEEN_KEY = 'dashboard_goal_completion_seen_v1';
const getOrdinal = (day) => {
    const value = Number(day || 0);
    if (value % 100 >= 11 && value % 100 <= 13) return `${value}th`;
    if (value % 10 === 1) return `${value}st`;
    if (value % 10 === 2) return `${value}nd`;
    if (value % 10 === 3) return `${value}rd`;
    return `${value}th`;
};
const formatPrettyDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const day = getOrdinal(date.getDate());
    const month = date.toLocaleString('en-IN', { month: 'short' });
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
};
const toLocalIsoDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};
const addDaysToIsoDate = (value, days) => {
    if (!value) return '';
    const date = value instanceof Date ? new Date(value) : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + Number(days || 0));
    return toLocalIsoDate(date);
};
const formatCompactPrettyDate = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};
const formatDashboardStatusLabel = (status = '') => {
    const normalized = String(status || '').trim().toLowerCase();
    if (!normalized) return 'Unknown';
    if (normalized === 'confirmed') return 'New';
    if (normalized === 'attempted') return 'Attempted';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1).replace(/_/g, ' ');
};
const getDashboardStatusBadgeClasses = (status = '') => {
    const normalized = String(status || '').trim().toLowerCase();
    if (normalized === 'completed' || normalized === 'shipped') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (normalized === 'pending' || normalized === 'attempted') return 'border-amber-200 bg-amber-50 text-amber-700';
    if (normalized === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700';
    if (normalized === 'cancelled') return 'border-slate-200 bg-slate-100 text-slate-600';
    if (normalized === 'confirmed') return 'border-sky-200 bg-sky-50 text-sky-700';
    return 'border-slate-200 bg-slate-50 text-slate-700';
};
const formatTrendRowLabel = (entry, granularity) => {
    if (!entry?.date) return '';
    if (granularity === 'weekly') {
        const start = String(entry.date);
        const end = addDaysToIsoDate(start, 6);
        return `${formatCompactPrettyDate(start)} - ${formatCompactPrettyDate(end)}`;
    }
    if (granularity === 'monthly') {
        const date = new Date(`${String(entry.date)}T00:00:00`);
        if (Number.isNaN(date.getTime())) return '';
        return date.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    }
    return formatPrettyDate(String(entry.date));
};
const fillMissingDailyTrendRows = (rows = []) => {
    const normalized = [...rows]
        .map((entry) => ({
            ...entry,
            date: String(entry?.date || ''),
            orders: Number(entry?.orders || 0),
            revenue: Number(entry?.revenue || 0)
        }))
        .filter((entry) => /^\d{4}-\d{2}-\d{2}$/.test(entry.date))
        .sort((a, b) => a.date.localeCompare(b.date));
    if (!normalized.length) return [];
    const byDate = new Map(normalized.map((entry) => [entry.date, entry]));
    const result = [];
    const cursor = new Date(`${normalized[0].date}T00:00:00`);
    const last = new Date(`${normalized[normalized.length - 1].date}T00:00:00`);
    while (!Number.isNaN(cursor.getTime()) && cursor <= last) {
        const key = toLocalIsoDate(cursor);
        result.push(byDate.get(key) || { date: key, orders: 0, revenue: 0 });
        cursor.setDate(cursor.getDate() + 1);
    }
    return result;
};
const formatShortRangeHint = (value) => {
    if (!value) return '';
    const date = value instanceof Date ? value : new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};
const isDashboardCustomRangeAllowed = (startDate = '', endDate = '') => {
    const start = startDate ? new Date(`${startDate}T00:00:00`) : null;
    const end = endDate ? new Date(`${endDate}T00:00:00`) : null;
    if (!start || !end || Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return false;
    const diff = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
    return diff >= 1 && diff <= DASHBOARD_CUSTOM_RANGE_MAX_DAYS;
};
const buildLifetimeOrderTarget = ({ status = 'all', count = 0, oldestDate = '', endDate = '' } = {}) => {
    const hasOrders = Number(count || 0) > 0;
    const canUseCustom = hasOrders && isDashboardCustomRangeAllowed(oldestDate, endDate);
    return {
        tab: 'orders',
        status,
        quickRange: canUseCustom ? 'custom' : DEFAULT_ADMIN_QUICK_RANGE,
        startDate: canUseCustom ? String(oldestDate || '') : '',
        endDate: canUseCustom ? String(endDate || '') : ''
    };
};

export default function DashboardInsights({ onRunAction = () => {} }) {
    const toast = useToast();
    const { canInstall, install, isPrompting, showIosHint } = usePwaInstall();
    const installAppLabel = showIosHint ? 'Add to Home Screen' : 'Install app';
    const toastRef = useRef(toast);
    const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
    const [quickRange, setQuickRange] = useState(DEFAULT_ADMIN_QUICK_RANGE);
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [comparisonMode, setComparisonMode] = useState('previous_period');
    const [isCompareEnabled, setIsCompareEnabled] = useState(false);
    const [statusFilter, setStatusFilter] = useState('all');
    const paymentMode = 'all';
    const [sourceChannel, setSourceChannel] = useState('all');
    const [isLoading, setIsLoading] = useState(true);
    const [data, setData] = useState(null);
    const [loadError, setLoadError] = useState('');
    const [goals, setGoals] = useState([]);
    const [isGoalsLoading, setIsGoalsLoading] = useState(false);
    const [isSavingGoal, setIsSavingGoal] = useState(false);
    const [deletingGoalId, setDeletingGoalId] = useState(null);
    const [goalDraft, setGoalDraft] = useState({
        metricKey: 'net_sales',
        label: 'Monthly Net Sales',
        targetValue: '',
        periodType: 'monthly',
        periodStart: new Date().toISOString().slice(0, 10),
        periodEnd: ''
    });
    const [alertSettings, setAlertSettings] = useState({
        isActive: false,
        emailRecipients: '',
        whatsappRecipients: '',
        pendingOver72Threshold: 10,
        failedPayment6hThreshold: 8,
        codCancelRateThreshold: 20,
        lowStockThreshold: 5
    });
    const [isSavingAlerts, setIsSavingAlerts] = useState(false);
    const [isRunningAlerts, setIsRunningAlerts] = useState(false);
    const [resolvedActionIds, setResolvedActionIds] = useState(() => new Set());
    const [trendGranularity, setTrendGranularity] = useState(() => {
        if (typeof window === 'undefined') return 'daily';
        const saved = String(window.localStorage.getItem(DASHBOARD_TREND_GRANULARITY_STORAGE_KEY) || '').trim().toLowerCase();
        if (saved === 'weekly' || saved === 'monthly' || saved === 'daily') return saved;
        return 'daily';
    });
    const [trendPageIndex, setTrendPageIndex] = useState(0);
    const [isGoalSettingsOpen, setIsGoalSettingsOpen] = useState(false);
    const [isAlertSettingsOpen, setIsAlertSettingsOpen] = useState(false);
    const [isStoreIntroOpen, setIsStoreIntroOpen] = useState(false);
    const [isSalesRangeOpen, setIsSalesRangeOpen] = useState(false);
    const [draftQuickRange, setDraftQuickRange] = useState(DEFAULT_ADMIN_QUICK_RANGE);
    const [draftStartDate, setDraftStartDate] = useState('');
    const [draftEndDate, setDraftEndDate] = useState('');
    const [goalCelebration, setGoalCelebration] = useState({ active: false, title: '' });
    const [showGoalSaveSpark, setShowGoalSaveSpark] = useState(false);
    const [syncTick, setSyncTick] = useState(0);
    const [advancedAnalyticsEnabled, setAdvancedAnalyticsEnabled] = useState(true);
    const [isAnalyticsModeSaving, setIsAnalyticsModeSaving] = useState(false);
    const [abandonedInsights, setAbandonedInsights] = useState(null);
    const [abandonedActiveJourneyCount, setAbandonedActiveJourneyCount] = useState(0);
    const [selectedTopProduct, setSelectedTopProduct] = useState(null);
    const [productPurchases, setProductPurchases] = useState(null);
    const [isProductPurchasesLoading, setIsProductPurchasesLoading] = useState(false);
    const forceRefreshRef = useRef(false);
    const hasTrackedFilterChangeRef = useRef(false);
    const hasInitializedTrendPageRef = useRef(false);
    const goalStartInputRef = useRef(null);
    const goalEndInputRef = useRef(null);

    useEffect(() => {
        toastRef.current = toast;
    }, [toast]);

    const trackEvent = (eventType, payload = {}) => {
        adminService.trackDashboardEvent({
            eventType,
            widgetId: payload.widgetId || '',
            actionId: payload.actionId || '',
            meta: payload.meta || {}
        }).catch(() => {});
    };

    const evaluateGoalCompletions = useCallback((goalRows = []) => {
        const safeGoals = Array.isArray(goalRows) ? goalRows : [];
        let seen = {};
        try {
            seen = JSON.parse(localStorage.getItem(GOAL_COMPLETION_SEEN_KEY) || '{}') || {};
        } catch {
            seen = {};
        }
        const newlyCompleted = safeGoals.filter((goal) => Number(goal?.progressPct || 0) >= 100 && !seen[String(goal.id)]);
        if (!newlyCompleted.length) return;
        newlyCompleted.forEach((goal) => {
            seen[String(goal.id)] = Date.now();
        });
        try {
            localStorage.setItem(GOAL_COMPLETION_SEEN_KEY, JSON.stringify(seen));
        } catch {
            // no-op
        }
        const first = newlyCompleted[0];
        setGoalCelebration({ active: true, title: `${first?.label || 'Goal'} completed` });
        burstConfetti();
        try {
            const audio = new Audio(successDingAudio);
            audio.volume = 0.9;
            void audio.play().catch(() => {});
        } catch {
            // ignore autoplay errors
        }
        toastRef.current.success(`${newlyCompleted.length} goal${newlyCompleted.length > 1 ? 's' : ''} completed`);
    }, []);

    useEffect(() => {
        trackEvent('dashboard_opened', { meta: { page: 'dashboard_insights' } });
    }, []);

    useEffect(() => {
        if (!goalCelebration.active) return;
        const timer = setTimeout(() => setGoalCelebration({ active: false, title: '' }), 5000);
        return () => clearTimeout(timer);
    }, [goalCelebration.active]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.localStorage.setItem(DASHBOARD_TREND_GRANULARITY_STORAGE_KEY, trendGranularity);
    }, [trendGranularity]);

    const queueForcedRefresh = () => {
        forceRefreshRef.current = true;
        adminService.invalidateDashboardCache();
        setSyncTick((prev) => prev + 1);
    };

    useAdminCrudSync({
        'order:create': queueForcedRefresh,
        'order:update': queueForcedRefresh,
        'payment:update': queueForcedRefresh,
        'product:create': queueForcedRefresh,
        'product:update': queueForcedRefresh,
        'product:delete': queueForcedRefresh,
        'user:create': queueForcedRefresh,
        'user:update': queueForcedRefresh,
        'user:delete': queueForcedRefresh,
        'coupon:changed': queueForcedRefresh,
        'abandoned_cart:journey:update': queueForcedRefresh,
        'abandoned_cart:recovered': queueForcedRefresh,
        'company:info_update': ({ company } = {}) => {
            if (!company || typeof company !== 'object') return;
            setAdvancedAnalyticsEnabled(company.advancedAnalyticsEnabled !== false);
        }
    });

    useEffect(() => {
        if (!hasTrackedFilterChangeRef.current) {
            hasTrackedFilterChangeRef.current = true;
            return;
        }
        trackEvent('filters_changed', {
            widgetId: 'dashboard_filters',
            meta: { quickRange, comparisonMode, isCompareEnabled, statusFilter, sourceChannel }
        });
    }, [quickRange, comparisonMode, isCompareEnabled, statusFilter, sourceChannel]);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            setIsLoading(true);
            setLoadError('');
            const shouldForceRefresh = forceRefreshRef.current;
            forceRefreshRef.current = false;
            let lastError = null;
            for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt += 1) {
                try {
                    const [response, companyData, abandonedData, abandonedActiveJourneyData] = await Promise.all([
                        adminService.getDashboardInsights({
                            quickRange,
                            startDate: quickRange === 'custom' ? startDate : '',
                            endDate: quickRange === 'custom' ? endDate : '',
                            comparisonMode,
                            status: statusFilter,
                            paymentMode,
                            sourceChannel,
                            forceRefresh: shouldForceRefresh
                        }),
                        adminService.getCompanyInfo(),
                        adminService.getAbandonedCartInsights('lifetime'),
                        adminService.getAbandonedCartJourneys({
                            status: 'active',
                            rangeDays: 'lifetime',
                            limit: 1,
                            offset: 0
                        })
                    ]);
                    if (!cancelled) {
                        setData(response || null);
                        setAdvancedAnalyticsEnabled(companyData?.company?.advancedAnalyticsEnabled !== false);
                        setAbandonedInsights(abandonedData?.insights || null);
                        setAbandonedActiveJourneyCount(Number(abandonedActiveJourneyData?.total || 0));
                        setLoadError('');
                        setIsLoading(false);
                    }
                    return;
                } catch (error) {
                    lastError = error;
                    if (attempt >= MAX_RETRY_ATTEMPTS) break;
                    await wait(RETRY_DELAY_MS * attempt);
                }
            }
            if (!cancelled) {
                setData(null);
                const message = lastError?.message || 'Failed to load dashboard';
                setLoadError(message);
                toastRef.current.error(`${message} (after ${MAX_RETRY_ATTEMPTS} attempts)`);
            }
            if (!cancelled) setIsLoading(false);
        };
        load();
        return () => { cancelled = true; };
    }, [comparisonMode, endDate, quickRange, sourceChannel, startDate, statusFilter, syncTick]);

    useEffect(() => {
        let cancelled = false;
        const loadPhaseThree = async () => {
            setIsGoalsLoading(true);
            try {
                const [goalData, alertData] = await Promise.all([
                    adminService.getDashboardGoals(),
                    adminService.getDashboardAlertSettings()
                ]);
                if (!cancelled) {
                    const rows = Array.isArray(goalData?.goals) ? goalData.goals : [];
                    setGoals(rows);
                    evaluateGoalCompletions(rows);
                    if (alertData?.settings) {
                        setAlertSettings({
                            isActive: Boolean(alertData.settings.isActive),
                            emailRecipients: alertData.settings.emailRecipients || '',
                            whatsappRecipients: alertData.settings.whatsappRecipients || '',
                            pendingOver72Threshold: Number(alertData.settings.pendingOver72Threshold || 10),
                            failedPayment6hThreshold: Number(alertData.settings.failedPayment6hThreshold || 8),
                            codCancelRateThreshold: Number(alertData.settings.codCancelRateThreshold || 20),
                            lowStockThreshold: Number(alertData.settings.lowStockThreshold || 5)
                        });
                    }
                }
            } catch (error) {
                if (!cancelled) toastRef.current.error(error?.message || 'Failed to load goals/alerts');
            } finally {
                if (!cancelled) setIsGoalsLoading(false);
            }
        };
        loadPhaseThree();
        return () => { cancelled = true; };
    }, [evaluateGoalCompletions, syncTick]);

    const overview = data?.overview || {};
    const products = data?.products || {};
    const customers = data?.customers || {};
    const operators = data?.operators || {};
    const growth = data?.growth || {};
    const risk = data?.risk || {};
    const funnel = data?.funnel || {};
    const trends = useMemo(() => (Array.isArray(data?.trends) ? data.trends : []), [data?.trends]);
    const actions = Array.isArray(data?.actions) ? data.actions : [];
    const trendSeries = useMemo(() => {
        const base = [...trends];
        if (trendGranularity === 'daily') {
            return fillMissingDailyTrendRows(base);
        }
        if (trendGranularity === 'weekly') {
            const grouped = new Map();
            base.forEach((entry) => {
                const raw = String(entry?.date || '');
                const date = new Date(`${raw}T00:00:00`);
                if (Number.isNaN(date.getTime())) return;
                const day = date.getDay();
                const diffToMonday = day === 0 ? -6 : 1 - day;
                const monday = new Date(date);
                monday.setDate(date.getDate() + diffToMonday);
                const key = monday.toISOString().slice(0, 10);
                const prev = grouped.get(key) || { date: key, orders: 0, revenue: 0 };
                prev.orders += Number(entry?.orders || 0);
                prev.revenue += Number(entry?.revenue || 0);
                grouped.set(key, prev);
            });
            return [...grouped.values()].slice(-12);
        }
        const grouped = new Map();
        base.forEach((entry) => {
            const raw = String(entry?.date || '');
            const key = raw.slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(key)) return;
            const prev = grouped.get(key) || { date: `${key}-01`, orders: 0, revenue: 0 };
            prev.orders += Number(entry?.orders || 0);
            prev.revenue += Number(entry?.revenue || 0);
            grouped.set(key, prev);
        });
        return [...grouped.values()].slice(-12);
    }, [trendGranularity, trends]);
    const trendDailyPages = useMemo(() => {
        if (trendGranularity !== 'daily') return [];
        const sortedRows = [...trendSeries].sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')));
        const pages = [];
        for (let index = 0; index < sortedRows.length; index += DAILY_TREND_PAGE_SIZE) {
            const rows = sortedRows.slice(index, index + DAILY_TREND_PAGE_SIZE);
            const firstDate = String(rows[0]?.date || '');
            const lastDate = String(rows[rows.length - 1]?.date || '');
            const label = rows.length
                ? `${formatPrettyDate(firstDate)} - ${formatPrettyDate(lastDate)}`
                : '';
            pages.push({
                key: `${firstDate}:${lastDate}:${index}`,
                label,
                rows
            });
        }
        return pages;
    }, [trendGranularity, trendSeries]);
    useEffect(() => {
        if (trendGranularity !== 'daily') {
            hasInitializedTrendPageRef.current = false;
            setTrendPageIndex(0);
            return;
        }
        if (!trendDailyPages.length) {
            hasInitializedTrendPageRef.current = false;
            setTrendPageIndex(0);
            return;
        }
        setTrendPageIndex((prev) => {
            if (!hasInitializedTrendPageRef.current) {
                hasInitializedTrendPageRef.current = true;
                return trendDailyPages.length - 1;
            }
            if (!Number.isFinite(prev) || prev < 0) return trendDailyPages.length - 1;
            return Math.min(prev, trendDailyPages.length - 1);
        });
    }, [trendDailyPages, trendGranularity]);
    const trendVisibleSeries = trendGranularity === 'daily'
        ? (trendDailyPages[trendPageIndex]?.rows || [])
        : trendSeries;
    const maxTrendRevenue = Math.max(1, ...trendVisibleSeries.map((entry) => Number(entry?.revenue || 0)));
    const trendSalesTitle = trendGranularity === 'weekly'
        ? 'Weekly Sales'
        : trendGranularity === 'monthly'
            ? 'Monthly Sales'
            : 'Daily Sales';
    const trackerGoals = useMemo(
        () => (goals || []).filter((goal) => Number(goal?.progressPct || 0) < 100),
        [goals]
    );
    useEffect(() => {
        if (!selectedTopProduct?.productId) return;
        let cancelled = false;
        const loadProductPurchases = async () => {
            setIsProductPurchasesLoading(true);
            try {
                const response = await adminService.getDashboardProductPurchases({
                    productId: selectedTopProduct.productId,
                    variantId: selectedTopProduct.variantId || '',
                    quickRange,
                    startDate: quickRange === 'custom' ? startDate : '',
                    endDate: quickRange === 'custom' ? endDate : ''
                });
                if (!cancelled) {
                    setProductPurchases(response || null);
                }
            } catch (error) {
                if (!cancelled) {
                    setProductPurchases(null);
                    toastRef.current.error(error?.message || 'Failed to load product purchases');
                }
            } finally {
                if (!cancelled) setIsProductPurchasesLoading(false);
            }
        };
        loadProductPurchases();
        return () => {
            cancelled = true;
        };
    }, [endDate, quickRange, selectedTopProduct?.productId, selectedTopProduct?.variantId, startDate]);
    const progressBarClass = (pct) => {
        const value = Number(pct || 0);
        if (value >= 80) return 'bg-emerald-500';
        if (value >= 45) return 'bg-amber-500';
        return 'bg-rose-500';
    };
    const tierLabel = (tier = 'regular') => {
        const value = String(tier || 'regular').toLowerCase();
        if (value === 'regular') return 'Basic';
        return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
    };
    const selectedPeriodLabel = quickRange === 'custom'
        ? `${startDate ? formatPrettyDate(startDate) : 'N/A'} - ${endDate ? formatPrettyDate(endDate) : 'N/A'}`
        : `${formatPrettyDate(data?.filter?.startDate)} - ${formatPrettyDate(data?.filter?.endDate)}`;
    const hasSelectedPeriod = quickRange === 'custom'
        ? Boolean(startDate && endDate)
        : Boolean(data?.filter?.startDate && data?.filter?.endDate);
    const selectedDurationText = hasSelectedPeriod ? `Duration: ${selectedPeriodLabel}` : '';
    const selectedCompactDurationText = hasSelectedPeriod
        ? `Duration: ${formatShortRangeHint(quickRange === 'custom' ? startDate : data?.filter?.startDate)} - ${formatShortRangeHint(quickRange === 'custom' ? endDate : data?.filter?.endDate)}`
        : '';
    const hasAnyInsight = Boolean(
        Number(overview.totalOrders || 0) > 0
        || Number(overview.netSales || 0) > 0
        || Number(overview.grossSales || 0) > 0
        || actions.length > 0
        || trends.some((entry) => Number(entry?.orders || 0) > 0 || Number(entry?.revenue || 0) > 0)
        || (products.topSellers || []).length > 0
        || (customers.topCustomers || []).length > 0
    );
    const abandonedTotals = abandonedInsights?.totals || {};
    const comparison = overview?.comparison || null;
    const navigationKpis = data?.navigationKpis || {};
    const newOrdersNav = navigationKpis?.newOrders || {};
    const pendingOrdersNav = navigationKpis?.pendingOrders || {};
    const failedOrdersNav = navigationKpis?.failedOrders || {};
    const orderSummary = data?.orderSummary || {};
    const cards = useMemo(() => ([
        {
            label: 'New Orders',
            value: Number(newOrdersNav.count || 0).toLocaleString('en-IN'),
            icon: ShoppingBag,
            target: buildLifetimeOrderTarget({
                status: 'confirmed',
                count: newOrdersNav.count,
                oldestDate: newOrdersNav.oldestDate,
                endDate: newOrdersNav.endDate
            }),
            widgetId: 'kpi_new_orders_lifetime',
            helper: Number(newOrdersNav.count || 0) > 0 && newOrdersNav.oldestDate
                ? `Open since ${formatShortRangeHint(newOrdersNav.oldestDate)}`
                : 'No currently new orders'
        },
        {
            label: 'Pending',
            value: Number(pendingOrdersNav.count || 0).toLocaleString('en-IN'),
            icon: AlertTriangle,
            target: buildLifetimeOrderTarget({
                status: 'pending',
                count: pendingOrdersNav.count,
                oldestDate: pendingOrdersNav.oldestDate,
                endDate: pendingOrdersNav.endDate
            }),
            widgetId: 'kpi_pending_orders_lifetime',
            helper: Number(pendingOrdersNav.count || 0) > 0 && pendingOrdersNav.oldestDate
                ? `Open since ${formatShortRangeHint(pendingOrdersNav.oldestDate)}`
                : 'No pending orders right now',
            theme: 'amber'
        },
        {
            label: 'Abandoned Carts',
            value: Number(abandonedActiveJourneyCount || 0).toLocaleString('en-IN'),
            icon: UsersRound,
            target: { tab: 'abandoned', status: 'active', rangeDays: 'lifetime' },
            widgetId: 'kpi_abandoned_carts_active',
            helper: `${Number(abandonedTotals.totalJourneys || 0).toLocaleString('en-IN')} total journeys`,
            theme: 'sky'
        }
    ]), [abandonedActiveJourneyCount, abandonedTotals.totalJourneys, newOrdersNav.count, newOrdersNav.endDate, newOrdersNav.oldestDate, pendingOrdersNav.count, pendingOrdersNav.endDate, pendingOrdersNav.oldestDate]);
    const themedCards = useMemo(() => applyKpiThemeRotation(cards), [cards]);
    const mobileCards = useMemo(() => applyKpiThemeRotation([
        {
            label: 'New Orders',
            value: Number(newOrdersNav.count || 0).toLocaleString('en-IN'),
            icon: ShoppingBag,
            target: buildLifetimeOrderTarget({
                status: 'confirmed',
                count: newOrdersNav.count,
                oldestDate: newOrdersNav.oldestDate,
                endDate: newOrdersNav.endDate
            }),
            widgetId: 'kpi_new_orders_lifetime',
            helper: Number(newOrdersNav.count || 0) > 0 && newOrdersNav.oldestDate
                ? `Open since ${formatShortRangeHint(newOrdersNav.oldestDate)}`
                : 'No currently new orders'
        },
        {
            label: 'Pending',
            value: Number(pendingOrdersNav.count || 0).toLocaleString('en-IN'),
            icon: AlertTriangle,
            target: buildLifetimeOrderTarget({
                status: 'pending',
                count: pendingOrdersNav.count,
                oldestDate: pendingOrdersNav.oldestDate,
                endDate: pendingOrdersNav.endDate
            }),
            widgetId: 'kpi_pending_orders_lifetime',
            helper: Number(pendingOrdersNav.count || 0) > 0 && pendingOrdersNav.oldestDate
                ? `Open since ${formatShortRangeHint(pendingOrdersNav.oldestDate)}`
                : 'No pending orders right now',
            theme: 'amber'
        },
        {
            label: 'Failed',
            value: Number(failedOrdersNav.count ?? risk.failedPaymentsCurrent6h ?? 0).toLocaleString('en-IN'),
            icon: XCircle,
            target: buildLifetimeOrderTarget({
                status: 'failed',
                count: failedOrdersNav.count ?? risk.failedPaymentsCurrent6h,
                oldestDate: failedOrdersNav.oldestDate,
                endDate: failedOrdersNav.endDate
            }),
            widgetId: 'kpi_failed_orders_lifetime',
            helper: Number(failedOrdersNav.count ?? risk.failedPaymentsCurrent6h ?? 0) > 0 && failedOrdersNav.oldestDate
                ? `Since ${formatShortRangeHint(failedOrdersNav.oldestDate)}`
                : 'No failed orders',
            theme: 'red'
        },
        {
            label: 'Abandoned Carts',
            value: Number(abandonedActiveJourneyCount || 0).toLocaleString('en-IN'),
            icon: UsersRound,
            target: { tab: 'abandoned', status: 'active', rangeDays: 'lifetime' },
            widgetId: 'kpi_abandoned_carts_active',
            helper: `${Number(abandonedTotals.totalJourneys || 0).toLocaleString('en-IN')} total journeys`,
            theme: 'sky'
        }
    ]), [abandonedActiveJourneyCount, abandonedTotals.totalJourneys, failedOrdersNav.count, failedOrdersNav.endDate, failedOrdersNav.oldestDate, newOrdersNav.count, newOrdersNav.endDate, newOrdersNav.oldestDate, pendingOrdersNav.count, pendingOrdersNav.endDate, pendingOrdersNav.oldestDate, risk.failedPaymentsCurrent6h]);
    const mobilePrimaryCards = mobileCards.filter((card) => ['New Orders', 'Pending', 'Failed'].includes(card.label));
    const mobileAbandonedCard = mobileCards.find((card) => card.label === 'Abandoned Carts') || null;
    const MobileAbandonedIcon = mobileAbandonedCard?.icon || UsersRound;
    const refreshGoals = async () => {
        const goalData = await adminService.getDashboardGoals();
        const rows = Array.isArray(goalData?.goals) ? goalData.goals : [];
        setGoals(rows);
        evaluateGoalCompletions(rows);
    };
    const handleSaveGoal = async () => {
        setIsSavingGoal(true);
        try {
            const payload = {
                metricKey: goalDraft.metricKey,
                label: goalDraft.label,
                targetValue: Number(goalDraft.targetValue || 0),
                periodType: goalDraft.periodType,
                periodStart: goalDraft.periodStart,
                periodEnd: goalDraft.periodType === 'custom' ? (goalDraft.periodEnd || null) : null
            };
            const result = await adminService.saveDashboardGoal(payload);
            setIsGoalSettingsOpen(false);
            const currentValue = (() => {
                if (payload.metricKey === 'net_sales') return Number(overview?.netSales || 0);
                if (payload.metricKey === 'total_orders') return Number(overview?.totalOrders || 0);
                if (payload.metricKey === 'conversion_rate') return Number(overview?.conversionRate || 0);
                if (payload.metricKey === 'repeat_rate') return Number(overview?.repeatRate || 0);
                return 0;
            })();
            const targetValue = Number(payload.targetValue || 0);
            const progressPct = targetValue > 0 ? Math.min(999, Number(((currentValue / targetValue) * 100).toFixed(1))) : 0;
            if (result?.goal?.id) {
                setGoals((prev) => {
                    const next = Array.isArray(prev) ? [...prev] : [];
                    const idx = next.findIndex((entry) => String(entry.id) === String(result.goal.id));
                    const row = {
                        id: result.goal.id,
                        metricKey: result.goal.metricKey || payload.metricKey,
                        label: result.goal.label || payload.label,
                        targetValue,
                        currentValue,
                        progressPct,
                        periodType: result.goal.periodType || payload.periodType,
                        periodStart: result.goal.periodStart || payload.periodStart,
                        periodEnd: result.goal.periodEnd || payload.periodEnd || ''
                    };
                    if (idx >= 0) {
                        next[idx] = row;
                    } else {
                        next.unshift(row);
                    }
                    return next;
                });
            }
            refreshGoals().catch(() => {});
            setGoalDraft((prev) => ({ ...prev, targetValue: '' }));
            setShowGoalSaveSpark(true);
            setTimeout(() => setShowGoalSaveSpark(false), 1800);
            trackEvent('goal_saved', { widgetId: 'goals', meta: { metricKey: payload.metricKey, periodType: payload.periodType } });
            toastRef.current.success('Goal saved');
        } catch (error) {
            toastRef.current.error(error?.message || 'Failed to save goal');
        } finally {
            setIsSavingGoal(false);
        }
    };
    const handleDeleteGoal = async (id) => {
        setDeletingGoalId(id);
        try {
            await adminService.deleteDashboardGoal(id);
            await refreshGoals();
            trackEvent('goal_deleted', { widgetId: 'goals', actionId: String(id) });
            toastRef.current.success('Goal removed');
        } catch (error) {
            toastRef.current.error(error?.message || 'Failed to remove goal');
        } finally {
            setDeletingGoalId(null);
        }
    };
    const handleSaveAlerts = async () => {
        setIsSavingAlerts(true);
        try {
            const dataRes = await adminService.updateDashboardAlertSettings(alertSettings);
            if (dataRes?.settings) {
                setAlertSettings({
                    isActive: Boolean(dataRes.settings.isActive),
                    emailRecipients: dataRes.settings.emailRecipients || '',
                    whatsappRecipients: dataRes.settings.whatsappRecipients || '',
                    pendingOver72Threshold: Number(dataRes.settings.pendingOver72Threshold || 10),
                    failedPayment6hThreshold: Number(dataRes.settings.failedPayment6hThreshold || 8),
                    codCancelRateThreshold: Number(dataRes.settings.codCancelRateThreshold || 20),
                    lowStockThreshold: Number(dataRes.settings.lowStockThreshold || 5)
                });
            }
            setIsAlertSettingsOpen(false);
            trackEvent('alerts_saved', { widgetId: 'alerts', meta: { isActive: Boolean(alertSettings.isActive) } });
            toastRef.current.success('Alert settings saved');
        } catch (error) {
            toastRef.current.error(error?.message || 'Failed to save alert settings');
        } finally {
            setIsSavingAlerts(false);
        }
    };
    const handleRunAlertsNow = async () => {
        setIsRunningAlerts(true);
        try {
            const result = await adminService.runDashboardAlertsNow();
            trackEvent('alerts_run', { widgetId: 'alerts', meta: { sent: Number(result?.sent || 0) } });
            if (Number(result?.sent || 0) > 0) {
                const suffix = Number(result?.failed || 0) > 0 ? `, ${result.failed} failed` : '';
                toastRef.current.success(`Sent ${result.sent} dashboard alerts${suffix}`);
            } else if (Number(result?.failed || 0) > 0) {
                toastRef.current.error(`Dashboard alerts failed for ${result.failed} candidate${Number(result.failed) > 1 ? 's' : ''}`);
            } else {
                toastRef.current.info(result?.reason ? `No alerts sent (${result.reason})` : 'No alerts sent');
            }
        } catch (error) {
            toastRef.current.error(error?.message || 'Failed to run alerts');
        } finally {
            setIsRunningAlerts(false);
        }
    };
    const handleOpenCard = (card) => {
        const target = card.target || { tab: 'orders' };
        const resolvedQuickRange = target.quickRange || quickRange;
        onRunAction({
            id: `card_${String(card.widgetId || card.label).toLowerCase()}`,
            target: {
                ...target,
                quickRange: resolvedQuickRange,
                startDate: target.startDate != null ? target.startDate : (resolvedQuickRange === 'custom' ? startDate : ''),
                endDate: target.endDate != null ? target.endDate : (resolvedQuickRange === 'custom' ? endDate : '')
            }
        });
        trackEvent('kpi_clicked', { widgetId: card.widgetId || card.label, meta: { quickRange, statusFilter, sourceChannel } });
    };
    const handleOpenAction = (action) => {
        const target = action?.target || {};
        const shouldCarryDate = target?.tab === 'orders';
        const effectiveQuickRange = shouldCarryDate ? (target.quickRange || quickRange) : target.quickRange;
        onRunAction({
            ...action,
            target: {
                ...target,
                quickRange: effectiveQuickRange,
                startDate: shouldCarryDate ? (effectiveQuickRange === 'custom' ? startDate : '') : target.startDate,
                endDate: shouldCarryDate ? (effectiveQuickRange === 'custom' ? endDate : '') : target.endDate
            }
        });
        trackEvent('action_opened', { actionId: action?.id || '', widgetId: 'action_center', meta: { priority: action?.priority || 'low' } });
    };
    const handleOpenTopProduct = (item) => {
        setProductPurchases(null);
        setSelectedTopProduct({
            productId: item?.productId || '',
            variantId: item?.variantId || '',
            title: item?.title || 'Untitled Product',
            variantTitle: item?.variantTitle || '',
            thumbnail: item?.thumbnail || '',
            ordersCount: Number(item?.ordersCount || 0),
            unitsSold: Number(item?.unitsSold || 0),
            revenue: Number(item?.revenue || 0)
        });
        trackEvent('action_opened', { actionId: `top_product_${item?.productId || ''}`, widgetId: 'top_products', meta: { quickRange } });
    };
    const closeTopProductDrawer = () => {
        setSelectedTopProduct(null);
        setProductPurchases(null);
        setIsProductPurchasesLoading(false);
    };
    const handleResolveAction = (action) => {
        const actionId = String(action?.id || '').trim();
        if (!actionId) return;
        setResolvedActionIds((prev) => {
            const next = new Set(prev);
            next.add(actionId);
            return next;
        });
        trackEvent('action_resolved', { actionId, widgetId: 'action_center' });
        toastRef.current.success('Action dismissed for this session');
    };
    const handleAdvancedAnalyticsToggle = async () => {
        if (isAnalyticsModeSaving) return;
        const nextValue = !advancedAnalyticsEnabled;
        setIsAnalyticsModeSaving(true);
        try {
            const response = await adminService.updateCompanyInfo({ advancedAnalyticsEnabled: nextValue });
            setAdvancedAnalyticsEnabled(response?.company?.advancedAnalyticsEnabled !== false);
            toastRef.current.success(`Advanced analytics ${nextValue ? 'enabled' : 'disabled'}`);
        } catch (error) {
            toastRef.current.error(error?.message || 'Failed to update analytics mode');
        } finally {
            setIsAnalyticsModeSaving(false);
        }
    };
    const handleShareStore = useCallback(async () => {
        try {
            if (navigator.share) {
                await navigator.share({
                    title: 'SSC Jewels',
                    text: STORE_SHARE_TEXT,
                    url: STORE_SHARE_URL
                });
                return;
            }
            await navigator.clipboard.writeText(STORE_SHARE_TEXT);
            toastRef.current.success('Store share text copied');
        } catch (error) {
            if (error?.name !== 'AbortError') {
                toastRef.current.error('Unable to open share drawer');
            }
        }
    }, []);
    const handleInstallApp = useCallback(async () => {
        if (showIosHint) {
            setIsInstallModalOpen(true);
            return;
        }
        await install();
    }, [install, showIosHint]);
    const lastUpdatedLabel = data?.lastUpdatedAt
        ? formatPrettyDate(new Date(data.lastUpdatedAt).toISOString().slice(0, 10))
        : null;
    const visibleActions = actions.filter((action) => !resolvedActionIds.has(String(action?.id || '')));
    const paymentModeBreakdown = useMemo(() => {
        const rows = Array.isArray(growth?.paymentModes) ? growth.paymentModes : [];
        const normalized = rows
            .map((row) => ({
                mode: String(row?.mode || '').toLowerCase(),
                orders: Number(row?.orders || 0),
                revenue: Number(row?.revenue || 0)
            }))
            .filter((row) => row.orders > 0 && row.mode !== 'unknown' && row.mode !== 'cod');
        return normalized;
    }, [growth?.paymentModes]);
    const totalPaymentModeOrders = paymentModeBreakdown.reduce((sum, row) => sum + Number(row?.orders || 0), 0);
    const paymentModeLabel = (mode) => {
        const key = String(mode || '').toLowerCase();
        if (key === 'cash') return 'Cash';
        if (key === 'upi') return 'UPI';
        if (key === 'netbanking') return 'Net Banking';
        if (key === 'net_banking') return 'Net Banking';
        if (key === 'card') return 'Card';
        if (key === 'card_swipe') return 'Card Swipe';
        if (key === 'emi') return 'EMI';
        if (key === 'wallet') return 'Wallet';
        if (key === 'paylater') return 'Pay Later';
        if (key === 'manual') return 'Manual';
        return key ? key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Unknown';
    };
    const topProductDetail = productPurchases?.summary || selectedTopProduct || null;
    useEffect(() => {
        if (!isSalesRangeOpen) return;
        setDraftQuickRange(quickRange);
        setDraftStartDate(startDate);
        setDraftEndDate(endDate);
    }, [isSalesRangeOpen, quickRange, startDate, endDate]);

    const handleDashboardQuickRangeChange = (nextRange) => {
        const resolved = normalizeAdminQuickRange(nextRange || DEFAULT_ADMIN_QUICK_RANGE);
        if (resolved === 'custom') {
            const today = toLocalIsoDate(new Date());
            const fallbackEnd = String(draftEndDate || endDate || data?.filter?.endDate || today || '').trim();
            const fallbackStart = String(draftStartDate || startDate || data?.filter?.startDate || addDaysToIsoDate(fallbackEnd, -(DASHBOARD_CUSTOM_RANGE_MAX_DAYS - 1)) || fallbackEnd || '').trim();
            setDraftQuickRange('custom');
            setDraftStartDate(fallbackStart);
            setDraftEndDate(fallbackEnd || fallbackStart);
            return;
        }
        setDraftQuickRange(resolved);
    };
    const handleDashboardStartDateChange = (value) => {
        const nextStart = String(value || '').trim();
        setDraftQuickRange('custom');
        setDraftStartDate(nextStart);
        if (nextStart) {
            setDraftEndDate(addDaysToIsoDate(nextStart, DASHBOARD_CUSTOM_RANGE_MAX_DAYS - 1) || nextStart);
        }
    };
    const handleDashboardEndDateChange = (value) => {
        const nextEnd = String(value || '').trim();
        setDraftQuickRange('custom');
        setDraftEndDate(nextEnd);
        if (nextEnd) {
            setDraftStartDate(addDaysToIsoDate(nextEnd, -(DASHBOARD_CUSTOM_RANGE_MAX_DAYS - 1)) || nextEnd);
        }
    };
    const isDraftSalesRangeValid = draftQuickRange !== 'custom'
        || isDashboardCustomRangeAllowed(draftStartDate, draftEndDate);
    const handleApplySalesRange = () => {
        if (!isDraftSalesRangeValid) {
            toastRef.current.error(`Custom dashboard range can be at most ${DASHBOARD_CUSTOM_RANGE_MAX_DAYS} days.`);
            return;
        }
        setQuickRange(draftQuickRange);
        if (draftQuickRange === 'custom') {
            setStartDate(draftStartDate);
            setEndDate(draftEndDate);
        }
        setIsSalesRangeOpen(false);
    };
    const selectedRangeChipLabel = quickRange === 'custom'
        ? ((startDate && endDate)
            ? `${formatPrettyDate(startDate)} - ${formatPrettyDate(endDate)}`
            : 'Custom Range')
        : (QUICK_RANGES.find((range) => range.value === quickRange)?.label || 'Current Month');

    return (
        <div className="space-y-6">
            {showGoalSaveSpark && (
                <div className="fixed right-6 bottom-8 z-50 pointer-events-none">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-emerald-300 via-cyan-300 to-violet-300 animate-pulse flex items-center justify-center shadow-xl">
                        <Sparkles size={22} className="text-white" />
                    </div>
                </div>
            )}
            {goalCelebration.active && (
                createPortal(
                    <div className="fixed inset-0 z-[95] bg-black/50 flex items-start sm:items-center justify-center p-4 overflow-y-auto">
                        <div className="w-full max-w-lg rounded-2xl bg-white border border-gray-200 shadow-2xl overflow-hidden max-h-[calc(100vh-2rem)] flex flex-col my-auto">
                            <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                                <h3 className="text-lg font-semibold text-gray-900">Goal Completed</h3>
                                <button type="button" onClick={() => setGoalCelebration({ active: false, title: '' })} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="p-5 overflow-y-auto">
                                <div className="flex items-start gap-4">
                                    <img src={successIllustration} alt="Goal completed" className="w-24 h-24 object-contain" />
                                    <div className="flex-1">
                                        <p className="text-sm text-gray-500">Milestone unlocked.</p>
                                        <p className="mt-1 text-base font-semibold text-gray-900">{goalCelebration.title}</p>
                                        <p className="mt-1 text-sm text-gray-700">Target achieved. Keep the momentum going.</p>
                                    </div>
                                </div>
                                <div className="mt-5 flex justify-end">
                                    <button
                                        type="button"
                                        onClick={() => setGoalCelebration({ active: false, title: '' })}
                                        className="px-4 py-2 rounded-lg bg-primary text-accent text-sm font-semibold hover:bg-primary-light"
                                    >
                                        Awesome
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>,
                    document.body
                )
            )}
            {isLoading ? (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 text-center text-gray-400">Loading dashboard insights...</div>
            ) : !hasAnyInsight ? (
                <div className="bg-white rounded-2xl border border-gray-200 shadow-sm py-16 px-6 text-center text-gray-400 flex flex-col items-center">
                    <img src={dashboardIllustration} alt="Dashboard" className="w-40 h-40 object-contain opacity-85" />
                    <p className="mt-4 text-lg font-semibold text-gray-700">
                        {loadError ? 'Dashboard insights are unavailable right now' : 'No dashboard insights available yet'}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                        {loadError
                            ? `Tried ${MAX_RETRY_ATTEMPTS} times. Please refresh after a moment.`
                            : 'Insights will appear once orders and activity are available.'}
                    </p>
                </div>
            ) : (
                <>
                    <div className="md:hidden grid grid-cols-2 gap-3">
                        <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-2">
                            {mobilePrimaryCards.map((card) => (
                                <button
                                    key={card.label}
                                    type="button"
                                    onClick={() => handleOpenCard(card)}
                                    className={`group relative overflow-hidden rounded-2xl border px-2 pb-2 pt-2 shadow-sm flex h-full min-h-0 flex-col text-left transition-transform hover:-translate-y-0.5 ${card.label === 'New Orders' ? 'col-span-2' : ''} ${KPI_CARD_THEMES[card.theme || 'sky']?.shell || KPI_CARD_THEMES.sky.shell}`}
                                    style={getKpiCardStyle(card.theme)}
                                >
                                    <card.icon size={30} className={`pointer-events-none absolute bottom-2 right-2 opacity-90 ${KPI_CARD_THEMES[card.theme || 'sky']?.icon || KPI_CARD_THEMES.sky.icon}`} />
                                    <div className="flex items-start justify-between gap-2">
                                        <p className={`max-w-full break-words text-[8px] font-bold leading-3 uppercase tracking-[0.12em] ${KPI_CARD_THEMES[card.theme || 'sky']?.label || KPI_CARD_THEMES.sky.label}`}>
                                            {card.label}
                                        </p>
                                        <ArrowRight size={12} className={`shrink-0 ${KPI_CARD_THEMES[card.theme || 'sky']?.accent || KPI_CARD_THEMES.sky.accent}`} />
                                    </div>
                                    <div className="mt-auto flex items-end justify-between gap-2 pr-8">
                                        <p className={`min-w-0 text-[26px] leading-none font-extrabold ${KPI_CARD_THEMES[card.theme || 'sky']?.value || KPI_CARD_THEMES.sky.value}`}>{card.value}</p>
                                    </div>
                                </button>
                            ))}
                        </div>
                        {mobileAbandonedCard && (
                            <button
                                type="button"
                                onClick={() => handleOpenCard(mobileAbandonedCard)}
                                className={`group relative overflow-hidden rounded-2xl border px-3 pb-2.5 pt-2.5 shadow-sm flex aspect-square flex-col text-left transition-transform hover:-translate-y-0.5 ${KPI_CARD_THEMES[mobileAbandonedCard.theme || 'sky']?.shell || KPI_CARD_THEMES.sky.shell}`}
                                style={getKpiCardStyle(mobileAbandonedCard.theme)}
                                >
                                    <MobileAbandonedIcon size={38} className={`pointer-events-none absolute bottom-3 right-3 opacity-90 ${KPI_CARD_THEMES[mobileAbandonedCard.theme || 'sky']?.icon || KPI_CARD_THEMES.sky.icon}`} />
                                    <div className="flex items-start justify-between gap-2">
                                        <div className="min-w-0">
                                            <p className={`max-w-full break-words text-[8px] font-bold leading-3 uppercase tracking-[0.12em] ${KPI_CARD_THEMES[mobileAbandonedCard.theme || 'sky']?.label || KPI_CARD_THEMES.sky.label}`}>
                                                Abandoned Carts
                                            </p>
                                            <p className="mt-1 inline-flex max-w-full rounded-full bg-black/10 px-2.5 py-1 text-[8px] font-semibold leading-3 text-black/75">
                                                {mobileAbandonedCard.helper || 'Tap to inspect detailed records'}
                                            </p>
                                        </div>
                                        <ArrowRight size={14} className={KPI_CARD_THEMES[mobileAbandonedCard.theme || 'sky']?.accent || KPI_CARD_THEMES.sky.accent} />
                                    </div>
                                <div className="mt-2 flex items-end justify-between gap-2 pr-10">
                                    <p className={`min-w-0 text-[34px] leading-none font-extrabold ${KPI_CARD_THEMES[mobileAbandonedCard.theme || 'sky']?.value || KPI_CARD_THEMES.sky.value}`}>{mobileAbandonedCard.value}</p>
                                </div>
                            </button>
                        )}
                    </div>
                    <div className="hidden md:grid md:grid-cols-2 xl:grid-cols-3 gap-4">
                        {themedCards.map((card) => (
                            <button
                                key={card.label}
                                type="button"
                                onClick={() => handleOpenCard(card)}
                                className={`group relative overflow-hidden rounded-2xl border p-5 shadow-sm flex min-h-[184px] items-start justify-between text-left transition-transform hover:-translate-y-0.5 ${KPI_CARD_THEMES[card.theme || 'sky']?.shell || KPI_CARD_THEMES.sky.shell}`}
                                style={getKpiCardStyle(card.theme)}
                            >
                                <card.icon size={64} className={`pointer-events-none absolute bottom-4 right-4 opacity-90 ${KPI_CARD_THEMES[card.theme || 'sky']?.icon || KPI_CARD_THEMES.sky.icon}`} />
                                <div className="pr-20">
                                    <p className={`text-sm font-bold uppercase tracking-[0.22em] ${KPI_CARD_THEMES[card.theme || 'sky']?.label || KPI_CARD_THEMES.sky.label}`}>
                                        {card.label}
                                    </p>
                                    <p className={`mt-2 inline-flex max-w-full rounded-full px-3 py-1.5 text-sm font-semibold leading-4 ${
                                        card.label === 'Abandoned Carts'
                                            ? 'bg-black/10 text-black/75'
                                            : card.theme === 'green'
                                                ? 'bg-black/10 text-black/75'
                                            : card.theme === 'amber'
                                                    ? 'bg-white/40 text-stone-900/85 shadow-sm backdrop-blur-[1px]'
                                                : card.theme === 'sky'
                                                    ? 'bg-slate-900/8 text-slate-900/75'
                                                    : ['red', 'brown'].includes(card.theme)
                                                        ? 'bg-white/15 text-white shadow-sm backdrop-blur-[1px]'
                                                        : (KPI_CARD_THEMES[card.theme || 'sky']?.subtext || KPI_CARD_THEMES.sky.subtext)
                                    }`}>
                                        {card.helper || 'Tap to inspect detailed records'}
                                    </p>
                                    <p className={`text-4xl font-extrabold mt-3 leading-none ${KPI_CARD_THEMES[card.theme || 'sky']?.value || KPI_CARD_THEMES.sky.value}`}>{card.value}</p>
                                </div>
                                <div className="relative z-10 flex flex-col items-end justify-between h-full">
                                    <ArrowRight size={22} className={KPI_CARD_THEMES[card.theme || 'sky']?.accent || KPI_CARD_THEMES.sky.accent} />
                                </div>
                            </button>
                        ))}
                    </div>
                    {isCompareEnabled && comparison && (
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><BarChart3 size={16} />Period Comparison</h3>
                            {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            <p className="text-xs text-gray-500 mt-1">
                                {comparisonMode === 'same_period_last_month' ? 'Current period vs same period last month.' : 'Current period vs immediately previous period.'}
                            </p>
                            <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-600">
                                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" />Current period</span>
                                <span className="inline-flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-400" />Comparison period</span>
                            </div>
                            <div className="mt-4 space-y-4">
                                {[
                                    {
                                        key: 'net_sales',
                                        label: 'Net Sales',
                                        current: Number(overview.netSales || 0),
                                        deltaPct: Number(comparison.netSales || 0),
                                        format: (value) => formatCurrency(value)
                                    },
                                    {
                                        key: 'orders',
                                        label: 'Orders',
                                        current: Number(overview.totalOrders || 0),
                                        deltaPct: Number(comparison.totalOrders || 0),
                                        format: (value) => Number(value || 0).toLocaleString('en-IN')
                                    }
                                ].map((metric) => {
                                    const deltaFactor = 1 + (Number(metric.deltaPct || 0) / 100);
                                    const previous = Math.abs(deltaFactor) < 0.0001 ? 0 : Math.max(0, metric.current / deltaFactor);
                                    const maxValue = Math.max(1, metric.current, previous);
                                    const currentWidth = Math.max(4, Math.round((metric.current / maxValue) * 100));
                                    const previousWidth = Math.max(4, Math.round((previous / maxValue) * 100));
                                    return (
                                        <div key={metric.key} className="border border-gray-100 rounded-xl p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-semibold text-gray-800">{metric.label}</p>
                                                <p className="text-xs font-semibold text-gray-600">
                                                    Δ {Number(metric.deltaPct || 0) > 0 ? '+' : ''}{Number(metric.deltaPct || 0).toFixed(1)}%
                                                </p>
                                            </div>
                                            <div className="mt-2 space-y-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[11px] text-gray-500 w-16 shrink-0">Current</span>
                                                    <div className="h-2 bg-gray-100 rounded-full w-full overflow-hidden">
                                                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${currentWidth}%` }} />
                                                    </div>
                                                    <span className="text-[11px] text-gray-700 w-20 text-right">{metric.format(metric.current)}</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[11px] text-gray-500 w-16 shrink-0">Previous</span>
                                                    <div className="h-2 bg-gray-100 rounded-full w-full overflow-hidden">
                                                        <div className="h-full bg-slate-400 rounded-full" style={{ width: `${previousWidth}%` }} />
                                                    </div>
                                                    <span className="text-[11px] text-gray-700 w-20 text-right">{metric.format(previous)}</span>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
                        <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative">
                            <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                    <h3 className="whitespace-nowrap text-base font-semibold leading-none text-gray-900 flex items-center gap-2">
                                        <BarChart3 size={16} className="shrink-0" />
                                        <span>{trendSalesTitle}</span>
                                    </h3>
                                    {selectedCompactDurationText && <p className="mt-1 max-w-[9.5rem] whitespace-nowrap text-[9px] leading-[11px] text-gray-500 sm:max-w-none">{selectedCompactDurationText}</p>}
                                </div>
                                <div className="relative flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setIsSalesRangeOpen((prev) => !prev)}
                                        className="inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
                                        aria-expanded={isSalesRangeOpen}
                                        aria-label="Adjust sales analytics date range"
                                    >
                                        <CalendarDays size={14} />
                                        <span className="hidden sm:inline">{selectedRangeChipLabel}</span>
                                    </button>
                                    <select value={trendGranularity} onChange={(e) => setTrendGranularity(e.target.value)} className="px-2 py-1 rounded-md border border-gray-200 text-xs bg-white">
                                        <option value="daily">Daily</option>
                                        <option value="weekly">Weekly</option>
                                        <option value="monthly">Monthly</option>
                                    </select>
                                </div>
                            </div>
                            {isSalesRangeOpen && (
                                <div className="absolute left-4 right-4 top-[4.5rem] z-20 rounded-xl border border-gray-200 bg-white p-3 shadow-xl sm:left-auto sm:right-5 sm:top-14 sm:w-[22rem]">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">Range</label>
                                            <select
                                                value={draftQuickRange}
                                                onChange={(e) => handleDashboardQuickRangeChange(e.target.value)}
                                                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                            >
                                                {QUICK_RANGES.map((range) => (
                                                    <option key={range.value} value={range.value}>{range.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {draftQuickRange === 'custom' && (
                                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                                <label className="block">
                                                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">From</span>
                                                    <input
                                                        type="date"
                                                        value={draftStartDate}
                                                        onChange={(e) => handleDashboardStartDateChange(e.target.value)}
                                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                                    />
                                                </label>
                                                <label className="block">
                                                    <span className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">To</span>
                                                    <input
                                                        type="date"
                                                        value={draftEndDate}
                                                        onChange={(e) => handleDashboardEndDateChange(e.target.value)}
                                                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
                                                    />
                                                </label>
                                                <p className="sm:col-span-2 text-[11px] leading-4 text-gray-500">
                                                    Selecting either date auto-adjusts the other to keep the range within {DASHBOARD_CUSTOM_RANGE_MAX_DAYS} days.
                                                </p>
                                            </div>
                                        )}
                                        <div className="flex justify-end gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setIsSalesRangeOpen(false)}
                                                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                            >
                                                Cancel
                                            </button>
                                            <button
                                                type="button"
                                                onClick={handleApplySalesRange}
                                                disabled={!isDraftSalesRangeValid}
                                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-accent hover:bg-primary-light disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                Apply
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}
                            <div className="mt-4 space-y-2">
                                {trendVisibleSeries.map((entry) => {
                                    const revenue = Number(entry?.revenue || 0);
                                    const width = Math.max(3, Math.round((revenue / maxTrendRevenue) * 100));
                                    const level = revenue / maxTrendRevenue;
                                    const barColor = level >= 0.67 ? 'bg-emerald-600' : (level >= 0.34 ? 'bg-amber-500' : 'bg-rose-500');
                                    const barStyle = { width: `${width}%` };
                                    return (
                                        <div key={entry.date} className="grid grid-cols-[120px_1fr_100px] items-center gap-3 sm:grid-cols-[140px_1fr_100px]">
                                            <span className="text-[11px] leading-4 text-gray-500">{formatTrendRowLabel(entry, trendGranularity)}</span>
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${barColor}`} style={barStyle} />
                                            </div>
                                            <span className="text-xs font-medium text-gray-700 text-right">{formatCurrency(revenue)}</span>
                                        </div>
                                    );
                                })}
                                {!trendVisibleSeries.length && (
                                    <EmptyState
                                        image={dashboardIllustration}
                                        alt="No trend data available"
                                        title="No trend data available"
                                        description="Trend charts will appear once sales data is available for the selected period."
                                        compact
                                    />
                                )}
                                {trendGranularity === 'daily' && trendDailyPages.length > 1 && (
                                    <div className="relative z-10 pt-2 flex items-center justify-between gap-2">
                                        <button
                                            type="button"
                                            disabled={trendPageIndex <= 0}
                                            onClick={() => setTrendPageIndex((prev) => Math.max(0, prev - 1))}
                                            className="px-2.5 py-1 rounded-md border border-gray-200 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                                        >
                                            Prev
                                        </button>
                                        <span className="min-w-0 flex-1 text-center text-xs text-gray-500">{trendDailyPages[trendPageIndex]?.label || ''}</span>
                                        <button
                                            type="button"
                                            disabled={trendPageIndex >= trendDailyPages.length - 1}
                                            onClick={() => setTrendPageIndex((prev) => Math.min(trendDailyPages.length - 1, prev + 1))}
                                            className="px-2.5 py-1 rounded-md border border-gray-200 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                                        >
                                            Next
                                        </button>
                                    </div>
                                )}
                            </div>
                            <BarChart3 size={58} className="pointer-events-none absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>

                        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Funnel size={16} />Order Summary</h3>
                            {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            <div className="mt-4 space-y-2">
                                {[
                                    { label: 'New', value: orderSummary.confirmed, target: { tab: 'orders', status: 'confirmed' } },
                                    { label: 'Pending', value: orderSummary.pending, target: { tab: 'orders', status: 'pending' } },
                                    { label: 'Attempted', value: orderSummary.attempted, target: { tab: 'orders', status: 'attempted' } },
                                    { label: 'Completed', value: orderSummary.completed, target: { tab: 'orders', status: 'completed' } },
                                    { label: 'Cancelled', value: orderSummary.cancelled, target: { tab: 'orders', status: 'cancelled' } },
                                    { label: 'Failed', value: orderSummary.failed, target: { tab: 'orders', status: 'failed' } }
                                ].map((item) => (
                                    <button key={item.label} type="button" onClick={() => handleOpenAction({ id: `funnel_${item.label.toLowerCase()}`, target: { ...item.target, quickRange, startDate: quickRange === 'custom' ? startDate : '', endDate: quickRange === 'custom' ? endDate : '' } })} className="w-full text-left flex items-center justify-between py-2 border-b last:border-0 border-gray-100 hover:bg-gray-50 rounded-md px-1">
                                        <span className="text-sm text-gray-600">{item.label}</span>
                                        <span className="text-sm font-semibold text-gray-900">{Number(item.value || 0).toLocaleString('en-IN')}</span>
                                    </button>
                                ))}
                            </div>
                            <Funnel size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>
                    </div>

                    {advancedAnalyticsEnabled && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                            {applyKpiThemeRotation([
                                { label: 'New Customer Revenue', value: formatCurrency(growth.newCustomerRevenue), helper: `Returning: ${formatCurrency(growth.returningCustomerRevenue)}`, icon: Users },
                                { label: 'Coupon Impact', value: formatCurrency(growth.couponDiscountTotal), helper: `${Number(growth.couponOrders || 0)} orders used coupons`, icon: Target },
                                { label: 'Failed Payments (6h)', value: Number(risk.failedPaymentsCurrent6h || 0).toLocaleString('en-IN'), helper: `vs prev 6h: ${Number(risk.failedPaymentsSpikePct || 0)}%`, icon: ShieldAlert },
                                { label: 'Pending Aging', value: `${Number(risk.pendingAging?.over72h || 0)} over 72h`, helper: `24-72h: ${Number(risk.pendingAging?.from24hTo72h || 0)}, <24h: ${Number(risk.pendingAging?.under24h || 0)}`, icon: CalendarDays }
                            ]).map((card) => (
                                <div key={card.label} className={`relative overflow-hidden rounded-2xl border p-4 shadow-sm ${KPI_CARD_THEMES[card.theme].shell}`} style={getKpiCardStyle(card.theme)}>
                                    <p className={`text-xs uppercase tracking-[0.2em] flex items-center gap-1 ${KPI_CARD_THEMES[card.theme].label}`}><card.icon size={12} />{card.label}</p>
                                    <p className={`text-xs mt-2 ${KPI_CARD_THEMES[card.theme].subtext}`}>{card.helper}</p>
                                    <p className={`text-2xl font-extrabold mt-3 leading-none ${KPI_CARD_THEMES[card.theme].value}`}>{card.value}</p>
                                    <card.icon size={46} className={`absolute right-2 bottom-2 opacity-90 ${KPI_CARD_THEMES[card.theme].icon}`} />
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Boxes size={16} />Top sold products</h3>
                            {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            <div className="mt-4 space-y-2">
                                {(products.topSellers || []).slice(0, 6).map((item) => (
                                    <button
                                        key={`${String(item.productId)}:${String(item.variantId || '')}`}
                                        type="button"
                                        onClick={() => handleOpenTopProduct(item)}
                                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden shrink-0">
                                                {item.thumbnail ? <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" /> : null}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                                                <p className="text-xs text-gray-500">
                                                    {item.variantTitle ? `${item.variantTitle} • ` : ''}{Number(item.ordersCount || 0)} orders
                                                </p>
                                            </div>
                                        </div>
                                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(item.revenue)}</p>
                                    </button>
                                ))}
                                {!(products.topSellers || []).length && (
                                    <EmptyState
                                        image={dashboardIllustration}
                                        alt="No product sales in this period"
                                        title="No product sales in this period"
                                        description="Top sold products will appear here once orders are recorded in the selected range."
                                        compact
                                    />
                                )}
                            </div>
                            <Boxes size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>

                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><UsersRound size={16} />Top Customers</h3>
                            {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            <div className="mt-4 space-y-2">
                                {(customers.topCustomers || []).slice(0, 6).map((item) => (
                                    <button
                                        key={String(item.userId)}
                                        type="button"
                                        onClick={() => handleOpenAction({ id: `top_customer_${item.userId}`, target: { tab: 'customers', userId: item.userId } })}
                                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2"
                                    >
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <p className="text-sm font-medium text-gray-800">{item.name}</p>
                                                <TierBadge
                                                    tier={item.loyaltyTier || 'regular'}
                                                    label={tierLabel(item.loyaltyTier)}
                                                    className="px-2 py-0.5 text-[10px]"
                                                    iconSize={11}
                                                    hideRegular
                                                />
                                            </div>
                                            <p className="text-xs text-gray-500">{Number(item.orders || 0)} orders</p>
                                        </div>
                                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(item.revenue)}</p>
                                    </button>
                                ))}
                                {!(customers.topCustomers || []).length && (
                                    <EmptyState
                                        image={dashboardIllustration}
                                        alt="No customer activity in this period"
                                        title="No customer activity in this period"
                                        description="Top customer activity will appear here once orders are recorded in the selected range."
                                        compact
                                    />
                                )}
                            </div>
                            <UsersRound size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>

                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Route size={16} />Channel Revenue</h3>
                            {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            <div className="mt-4 space-y-2">
                                {(growth.channelRevenue || []).slice(0, 6).map((item) => (
                                    (() => {
                                        const rawChannel = String(item.channel || 'unknown').toLowerCase();
                                        const channelLabel = rawChannel === 'checkout_webhook_recovery' || rawChannel === 'direct'
                                            ? 'Direct website'
                                            : String(item.channel || 'unknown').replace(/_/g, ' ');
                                        return (
                                    <button
                                        key={String(item.channel)}
                                        type="button"
                                        onClick={() => handleOpenAction({
                                            id: `channel_${String(item.channel || 'unknown')}`,
                                            target: {
                                                tab: 'orders',
                                                status: statusFilter || 'all',
                                                quickRange,
                                                sourceChannel: String(item.channel || 'all').toLowerCase()
                                            }
                                        })}
                                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2"
                                    >
                                        <div>
                                            <p className="text-sm font-medium text-gray-800">{channelLabel}</p>
                                            <p className="text-xs text-gray-500">{Number(item.orders || 0)} orders</p>
                                        </div>
                                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(item.revenue)}</p>
                                    </button>
                                        );
                                    })()
                                ))}
                                {!(growth.channelRevenue || []).length && (
                                    <EmptyState
                                        image={dashboardIllustration}
                                        alt="No channel data in this period"
                                        title="No channel data in this period"
                                        description="Revenue by channel will appear here once matching orders are available."
                                        compact
                                    />
                                )}
                            </div>
                            <Route size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>

                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><PieChart size={16} />Payment Mode Share</h3>
                            {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            <div className="mt-4 flex items-center gap-4">
                                <div
                                    className="w-24 h-24 rounded-full relative flex items-center justify-center text-xs font-semibold text-gray-700"
                                    style={{
                                        background: (() => {
                                            if (!paymentModeBreakdown.length || totalPaymentModeOrders <= 0) {
                                                return 'conic-gradient(#d1fae5 0deg 360deg)';
                                            }
                                            const palette = ['#10b981', '#f97316', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
                                            let cursor = 0;
                                            const segments = paymentModeBreakdown.map((row, index) => {
                                                const ratio = Number(row?.orders || 0) / totalPaymentModeOrders;
                                                const end = cursor + (ratio * 360);
                                                const color = palette[index % palette.length];
                                                const chunk = `${color} ${cursor.toFixed(2)}deg ${end.toFixed(2)}deg`;
                                                cursor = end;
                                                return chunk;
                                            });
                                            return `conic-gradient(${segments.join(', ')})`;
                                        })()
                                    }}
                                >
                                    <span className="absolute inset-[11px] bg-white rounded-full" />
                                    <span className="relative z-10">{totalPaymentModeOrders || 0}</span>
                                </div>
                                <div className="space-y-1 text-xs">
                                    {(paymentModeBreakdown || []).map((row, index) => {
                                        const pct = totalPaymentModeOrders > 0 ? ((Number(row.orders || 0) / totalPaymentModeOrders) * 100) : 0;
                                        const palette = ['#10b981', '#f97316', '#3b82f6', '#a855f7', '#ec4899', '#14b8a6'];
                                        return (
                                            <p key={String(row.mode)} className="text-gray-600 flex items-center gap-2">
                                                <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
                                                <span className="font-semibold">{paymentModeLabel(row.mode)}</span>: {Number(row.orders || 0)} orders ({pct.toFixed(1)}%)
                                            </p>
                                        );
                                    })}
                                    {!paymentModeBreakdown.length && (
                                        <EmptyState
                                            image={dashboardIllustration}
                                            alt="No payment mode data available"
                                            title="No payment mode data available yet"
                                            description="Payment mode usage will appear here once matching transactions are recorded."
                                            compact
                                        />
                                    )}
                                </div>
                            </div>
                            <PieChart size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Target size={16} />Goal Tracker</h3>
                                {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            </div>
                            <span className="text-xs text-gray-500">{isGoalsLoading ? 'Loading...' : `${trackerGoals.length} active`}</span>
                        </div>
                        <div className="mt-4 space-y-2">
                            {trackerGoals.slice(0, 6).map((goal) => (
                                <div key={goal.id} className="border border-gray-200 rounded-lg p-3 bg-white/90">
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="text-sm font-semibold text-gray-800">{goal.label}</p>
                                        <span className="text-[11px] text-gray-500">{Number(goal.progressPct || 0)}%</span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">{goal.metricKey} | Started on {formatPrettyDate(goal.periodStart)}</p>
                                    <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                                        <div className={`h-full ${progressBarClass(goal.progressPct)}`} style={{ width: `${Math.max(0, Math.min(100, Number(goal.progressPct || 0)))}%` }} />
                                    </div>
                                    <p className="text-xs text-gray-500 mt-1">{Number(goal.currentValue || 0).toLocaleString('en-IN')} / {Number(goal.targetValue || 0).toLocaleString('en-IN')}</p>
                                </div>
                            ))}
                            {!trackerGoals.length && !isGoalsLoading && (
                                <EmptyState
                                    image={dashboardIllustration}
                                    alt="No active goals"
                                    title="No active goals"
                                    description="Completed goals are hidden from the tracker. Add or reopen a goal to monitor progress here."
                                    compact
                                />
                            )}
                        </div>
                        <Target size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                    </div>

                    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                        <div className="flex items-center justify-between">
                            <div>
                                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><AlertTriangle size={16} />Action Center</h3>
                                {selectedDurationText && <p className="mt-1 text-xs text-gray-500">{selectedDurationText}</p>}
                            </div>
                            <span className="text-xs text-gray-500">Prioritized operational tasks</span>
                        </div>
                        <div className="mt-4 space-y-3">
                            {visibleActions.map((action) => (
                                <div key={action.id} className="border border-gray-200 rounded-xl p-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                                    <div>
                                        <span className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-semibold border ${priorityStyles[action.priority] || priorityStyles.low}`}>
                                            {String(action.priority || 'low').toUpperCase()}
                                        </span>
                                        <p className="text-sm font-semibold text-gray-900 mt-2 flex items-center gap-2">
                                            <AlertTriangle size={14} className="text-amber-600" />
                                            {action.title}
                                        </p>
                                        <p className="text-xs text-gray-500 mt-1">{action.description}</p>
                                    </div>
                                    <div className="sm:w-28 sm:shrink-0 flex flex-col gap-2">
                                        <button
                                            type="button"
                                            onClick={() => handleOpenAction(action)}
                                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50"
                                        >
                                            Open
                                            <ArrowRight size={12} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleResolveAction(action)}
                                            className="w-full inline-flex items-center justify-center gap-1 px-3 py-2 text-xs font-semibold rounded-lg border border-gray-200 hover:bg-gray-50"
                                        >
                                            Dismiss
                                        </button>
                                    </div>
                                </div>
                            ))}
                            {!visibleActions.length && (
                                <EmptyState
                                    image={successIllustration}
                                    alt="No high-priority actions right now"
                                    title="No high-priority actions right now"
                                    description="The action center is clear for the selected period."
                                    compact
                                />
                            )}
                        </div>
                        <AlertTriangle size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                    </div>

                    {isGoalSettingsOpen && createPortal(
                        <div className="fixed inset-0 z-[180] bg-black/50 flex items-center justify-center p-4">
                            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 p-5 max-h-[calc(100vh-2rem)] overflow-y-auto">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Target size={16} />Goal Settings</h3>
                                    <button type="button" onClick={() => setIsGoalSettingsOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">Start Date is when goal tracking begins. End Date is required only for custom goals.</p>
                                <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <label className="text-xs text-gray-600">
                                        Metric
                                        <select value={goalDraft.metricKey} onChange={(e) => setGoalDraft((prev) => ({ ...prev, metricKey: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                                            <option value="net_sales">Net Sales</option>
                                            <option value="total_orders">Total Orders</option>
                                            <option value="conversion_rate">Conversion Rate</option>
                                            <option value="repeat_rate">Repeat Rate</option>
                                        </select>
                                    </label>
                                    <label className="text-xs text-gray-600">
                                        Goal Label
                                        <input value={goalDraft.label} onChange={(e) => setGoalDraft((prev) => ({ ...prev, label: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="e.g. Monthly net sales target" />
                                    </label>
                                    <label className="text-xs text-gray-600">
                                        Target Value
                                        <input type="number" value={goalDraft.targetValue} onChange={(e) => setGoalDraft((prev) => ({ ...prev, targetValue: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="e.g. 100000" />
                                    </label>
                                    <label className="text-xs text-gray-600">
                                        Period Type
                                        <select value={goalDraft.periodType} onChange={(e) => setGoalDraft((prev) => ({ ...prev, periodType: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm">
                                            <option value="monthly">Monthly</option>
                                            <option value="weekly">Weekly</option>
                                            <option value="daily">Daily</option>
                                            <option value="custom">Custom</option>
                                        </select>
                                    </label>
                                    <label className="text-xs text-gray-600">
                                        Start Date
                                        <input ref={goalStartInputRef} type="date" value={goalDraft.periodStart} onChange={(e) => setGoalDraft((prev) => ({ ...prev, periodStart: e.target.value }))} className="sr-only" />
                                        <input type="button" value={goalDraft.periodStart ? formatPrettyDate(goalDraft.periodStart) : 'Select Start Date'} onClick={() => (goalStartInputRef.current?.showPicker ? goalStartInputRef.current.showPicker() : goalStartInputRef.current?.click())} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-left" />
                                    </label>
                                    {goalDraft.periodType === 'custom' && (
                                        <label className="text-xs text-gray-600">
                                            End Date
                                            <input ref={goalEndInputRef} type="date" value={goalDraft.periodEnd} onChange={(e) => setGoalDraft((prev) => ({ ...prev, periodEnd: e.target.value }))} className="sr-only" />
                                            <input type="button" value={goalDraft.periodEnd ? formatPrettyDate(goalDraft.periodEnd) : 'Select End Date'} onClick={() => (goalEndInputRef.current?.showPicker ? goalEndInputRef.current.showPicker() : goalEndInputRef.current?.click())} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-left" />
                                        </label>
                                    )}
                                </div>
                                <div className="mt-4 flex items-center gap-2">
                                    <button type="button" disabled={isSavingGoal} onClick={handleSaveGoal} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-accent text-xs font-semibold hover:bg-primary-light disabled:opacity-60">
                                        <Save size={13} /> {isSavingGoal ? 'Saving Goal...' : 'Save Goal'}
                                    </button>
                                </div>
                                <div className="mt-4 space-y-2 max-h-64 overflow-y-auto pr-1">
                                    {goals.map((goal) => (
                                        <div key={goal.id} className="border border-gray-200 rounded-lg p-3">
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="text-sm font-semibold text-gray-800">{goal.label}</p>
                                                <button type="button" disabled={deletingGoalId === goal.id} onClick={() => handleDeleteGoal(goal.id)} className="p-1 rounded-md text-red-600 hover:bg-red-50 disabled:opacity-60">
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                            <p className="text-xs text-gray-500 mt-1">{goal.metricKey} | Target {Number(goal.targetValue || 0).toLocaleString('en-IN')}</p>
                                            <p className="text-[11px] text-gray-400 mt-1">Started on {formatPrettyDate(goal.periodStart)}</p>
                                        </div>
                                    ))}
                                    {!goals.length && !isGoalsLoading && (
                                        <EmptyState
                                            image={dashboardIllustration}
                                            alt="No goals configured yet"
                                            title="No goals configured yet"
                                            description="Add a goal to start tracking revenue, orders, or operational milestones."
                                            compact
                                        />
                                    )}
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}

                    {isAlertSettingsOpen && createPortal(
                        <div className="fixed inset-0 z-[180] bg-black/50 flex items-center justify-center p-4">
                            <div className="bg-white w-full max-w-2xl rounded-2xl shadow-2xl border border-gray-200 p-5 max-h-[calc(100vh-2rem)] overflow-y-auto">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Bell size={16} />Alerting & Operators</h3>
                                    <button type="button" onClick={() => setIsAlertSettingsOpen(false)} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"><X size={16} /></button>
                                </div>
                                <p className="text-xs text-gray-500 mt-2">Use comma-separated recipients. Threshold alerts trigger on scheduler and can also be tested manually.</p>
                                <div className="mt-4 space-y-3">
                                    <label className="flex items-center gap-2 text-sm text-gray-700">
                                        <input type="checkbox" checked={alertSettings.isActive} onChange={(e) => setAlertSettings((prev) => ({ ...prev, isActive: e.target.checked }))} />
                                        Enable dashboard alerts
                                    </label>
                                    <label className="text-xs text-gray-600 block">
                                        Alert Emails
                                        <input value={alertSettings.emailRecipients} onChange={(e) => setAlertSettings((prev) => ({ ...prev, emailRecipients: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="ops@store.com, owner@store.com" />
                                    </label>
                                    <label className="text-xs text-gray-600 block">
                                        Alert WhatsApp Numbers
                                        <input value={alertSettings.whatsappRecipients} onChange={(e) => setAlertSettings((prev) => ({ ...prev, whatsappRecipients: e.target.value }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" placeholder="9198xxxxxx, 9177xxxxxx" />
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="text-xs text-gray-600">
                                            Pending &gt;72h Threshold
                                            <input type="number" value={alertSettings.pendingOver72Threshold} onChange={(e) => setAlertSettings((prev) => ({ ...prev, pendingOver72Threshold: Number(e.target.value || 0) }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                                        </label>
                                        <label className="text-xs text-gray-600">
                                            Failed Payments (6h) Threshold
                                            <input type="number" value={alertSettings.failedPayment6hThreshold} onChange={(e) => setAlertSettings((prev) => ({ ...prev, failedPayment6hThreshold: Number(e.target.value || 0) }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                                        </label>
                                    </div>
                                    <label className="text-xs text-gray-600 block">
                                        COD Cancel Rate Threshold (%)
                                        <input type="number" value={alertSettings.codCancelRateThreshold} onChange={(e) => setAlertSettings((prev) => ({ ...prev, codCancelRateThreshold: Number(e.target.value || 0) }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                                    </label>
                                    <label className="text-xs text-gray-600 block">
                                        Low Stock Threshold
                                        <input type="number" value={alertSettings.lowStockThreshold} onChange={(e) => setAlertSettings((prev) => ({ ...prev, lowStockThreshold: Number(e.target.value || 0) }))} className="mt-1 w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" />
                                    </label>
                                    <div className="flex items-center gap-2">
                                        <button type="button" onClick={handleSaveAlerts} disabled={isSavingAlerts} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold hover:bg-gray-50 disabled:opacity-60">
                                            <Save size={13} /> {isSavingAlerts ? 'Saving...' : 'Save Alerts'}
                                        </button>
                                        <button type="button" onClick={handleRunAlertsNow} disabled={isRunningAlerts} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-primary text-accent text-xs font-semibold hover:bg-primary-light disabled:opacity-60">
                                            <Play size={13} /> {isRunningAlerts ? 'Running...' : 'Run Alerts Now'}
                                        </button>
                                    </div>
                                </div>
                                <div className="mt-5">
                                    <h4 className="text-sm font-semibold text-gray-800">Operator Scorecards</h4>
                                    <div className="mt-2 space-y-2 max-h-56 overflow-y-auto pr-1">
                                        {(operators.scorecards || []).map((op) => (
                                            <div key={String(op.userId)} className="border border-gray-200 rounded-lg p-2 flex items-center justify-between">
                                                <div>
                                                    <p className="text-sm font-medium text-gray-800">{op.name}</p>
                                                    <p className="text-xs text-gray-500">
                                                        Total {Number(op.totalActions || 0)} | Completed {Number(op.completedUpdates || 0)} | Cancelled {Number(op.cancelledUpdates || 0)}
                                                    </p>
                                                </div>
                                            </div>
                                        ))}
                                        {!(operators.scorecards || []).length && (
                                            <EmptyState
                                                image={dashboardIllustration}
                                                alt="No operator activity in selected range"
                                                title="No operator activity in selected range"
                                                description="Operator scorecards will appear once relevant dashboard actions are recorded."
                                                compact
                                            />
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                    <div className="emboss-card relative overflow-hidden bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                        <BarChart3 size={64} className="bg-emboss-icon absolute right-4 top-4 text-gray-200" />
                        <div className="flex items-start justify-between gap-3">
                            <button
                                type="button"
                                onClick={() => setIsStoreIntroOpen((prev) => !prev)}
                                className="flex-1 text-left"
                            >
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-900">Store Intelligence</h2>
                                    <p className="text-sm text-gray-500 mt-1">Sales insights, funnel health, and action priorities.</p>
                                    {lastUpdatedLabel && <p className="text-xs text-gray-400 mt-1">Last updated: {lastUpdatedLabel}</p>}
                                </div>
                            </button>
                            <button
                                type="button"
                                onClick={() => setIsStoreIntroOpen((prev) => !prev)}
                                className="mt-1 text-gray-500"
                                aria-label={isStoreIntroOpen ? 'Collapse Store Intelligence controls' : 'Expand Store Intelligence controls'}
                            >
                                {isStoreIntroOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                            </button>
                        </div>
                        {isStoreIntroOpen && (
                            <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        type="button"
                                        onClick={handleAdvancedAnalyticsToggle}
                                        disabled={isAnalyticsModeSaving}
                                        aria-pressed={advancedAnalyticsEnabled}
                                        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-xs font-semibold transition-colors ${
                                            advancedAnalyticsEnabled
                                                ? 'border-primary bg-primary text-accent'
                                                : 'border-sky-200 bg-sky-50 text-sky-900'
                                        } disabled:opacity-60`}
                                    >
                                        <span className={`inline-flex h-5 w-9 items-center rounded-full transition-colors ${advancedAnalyticsEnabled ? 'bg-accent/25' : 'bg-sky-200'}`}>
                                            <span className={`h-4 w-4 rounded-full bg-white shadow transition-transform ${advancedAnalyticsEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                                        </span>
                                        Advanced Analytics
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsGoalSettingsOpen(true)}
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                    >
                                        <Target size={14} /> Goal Settings
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setIsAlertSettingsOpen(true)}
                                        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 text-xs font-semibold text-gray-700 hover:bg-gray-50"
                                    >
                                        <Bell size={14} /> Alert Settings
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-2 w-full md:w-auto">
                                    <select value={comparisonMode} onChange={(e) => setComparisonMode(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                                        <option value="previous_period">Compare: Previous Period</option>
                                        <option value="same_period_last_month">Compare: Last Month</option>
                                    </select>
                                    <button
                                        type="button"
                                        onClick={() => setIsCompareEnabled((prev) => !prev)}
                                        className={`px-3 py-2 rounded-lg border text-sm font-semibold ${isCompareEnabled ? 'bg-primary text-accent border-primary' : 'bg-white text-gray-700 border-gray-200'}`}
                                    >
                                        {isCompareEnabled ? 'Compare: On' : 'Compare: Off'}
                                    </button>
                                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                                        <option value="all">Status: All</option>
                                        <option value="pending">Status: Pending</option>
                                        <option value="confirmed">Status: Confirmed</option>
                                        <option value="completed">Status: Completed</option>
                                        <option value="cancelled">Status: Cancelled</option>
                                        <option value="failed">Status: Failed</option>
                                    </select>
                                    <select value={sourceChannel} onChange={(e) => setSourceChannel(e.target.value)} className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white">
                                        <option value="all">Channel: All</option>
                                        <option value="direct">Channel: Direct (Checkout)</option>
                                        <option value="abandoned_recovery">Channel: Abandoned Recovery</option>
                                    </select>
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {canInstall && (
                            <button
                                type="button"
                                onClick={handleInstallApp}
                                disabled={isPrompting}
                                className="inline-flex items-center justify-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-900 shadow-sm transition hover:bg-emerald-100 disabled:opacity-60"
                            >
                                <Download size={17} />
                                {isPrompting ? 'Preparing install...' : installAppLabel}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={handleShareStore}
                            className="inline-flex items-center justify-center gap-2 rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm font-semibold text-sky-950 shadow-sm transition hover:bg-sky-100"
                        >
                            <Share2 size={17} />
                            Share store
                        </button>
                    </div>
                    <Modal
                        isOpen={isInstallModalOpen}
                        onClose={() => setIsInstallModalOpen(false)}
                        title="Install SSC Jewellery"
                        message="To install SSC Jewellery on iPhone, tap Share in Safari, then choose Add to Home Screen."
                        type="default"
                        confirmText="OK"
                        onConfirm={() => setIsInstallModalOpen(false)}
                    />
                    {selectedTopProduct && createPortal(
                        <div className="fixed inset-0 z-[220]">
                            <button type="button" aria-label="Close product purchases" className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={closeTopProductDrawer} />
                            <div className="absolute inset-y-0 right-0 flex w-full justify-end">
                                <div className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-gray-200 bg-white shadow-2xl">
                                    <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-5 py-4 backdrop-blur">
                                        <div className="flex items-start justify-between gap-4">
                                            <div className="min-w-0">
                                                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">Product purchase insights</p>
                                                <h3 className="mt-1 truncate text-lg font-semibold text-gray-900">{topProductDetail?.title || 'Untitled Product'}</h3>
                                                <p className="mt-1 text-sm text-gray-500">{topProductDetail?.variantTitle || 'Customers and orders for this product'}</p>
                                                {selectedDurationText && <p className="mt-2 text-xs text-gray-500">{selectedDurationText}</p>}
                                            </div>
                                            <button type="button" onClick={closeTopProductDrawer} className="rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 transition hover:bg-gray-50">
                                                Close
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-5 p-5">
                                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                            <div className="rounded-2xl border border-sky-100 bg-sky-50 p-4">
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">Orders</p>
                                                <p className="mt-3 text-2xl font-semibold text-slate-950">{Number(topProductDetail?.ordersCount || 0).toLocaleString('en-IN')}</p>
                                            </div>
                                            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-700">Revenue</p>
                                                <p className="mt-3 text-2xl font-semibold text-slate-950">{formatCurrency(topProductDetail?.revenue || 0)}</p>
                                            </div>
                                            <div className="rounded-2xl border border-amber-100 bg-amber-50 p-4">
                                                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-amber-700">Units</p>
                                                <p className="mt-3 text-2xl font-semibold text-slate-950">{Number(topProductDetail?.unitsSold || 0).toLocaleString('en-IN')}</p>
                                            </div>
                                        </div>

                                        {isProductPurchasesLoading ? (
                                            <div className="rounded-2xl border border-gray-200 bg-white p-5 text-sm text-gray-500">Loading customers and orders for this product...</div>
                                        ) : (
                                            <>
                                                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <h4 className="text-base font-semibold text-gray-900">Customers</h4>
                                                            <p className="mt-1 text-xs text-gray-500">People who bought this product in the selected period.</p>
                                                        </div>
                                                        <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700">
                                                            {Number(productPurchases?.customers?.length || 0).toLocaleString('en-IN')} listed
                                                        </span>
                                                    </div>
                                                    <div className="mt-4 space-y-2">
                                                        {(productPurchases?.customers || []).map((customer) => (
                                                            <button
                                                                key={`${String(customer.userId || 'guest')}::${String(customer.name || '')}`}
                                                                type="button"
                                                                disabled={!customer.userId}
                                                                onClick={() => {
                                                                    closeTopProductDrawer();
                                                                    onRunAction({ id: `product_customer_${customer.userId}`, target: { tab: 'customers', userId: customer.userId } });
                                                                }}
                                                                className="flex w-full items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-3 text-left transition hover:bg-gray-50 disabled:cursor-default disabled:hover:bg-white"
                                                            >
                                                                <div className="min-w-0">
                                                                    <p className="truncate text-sm font-semibold text-gray-900">{customer.name || 'Guest'}</p>
                                                                    <p className="mt-1 truncate text-xs text-gray-500">
                                                                        {customer.mobile || 'No mobile'}{customer.email ? ` • ${customer.email}` : ''}
                                                                    </p>
                                                                    <p className="mt-2 text-[11px] text-gray-500">
                                                                        {Number(customer.ordersCount || 0).toLocaleString('en-IN')} orders • {Number(customer.unitsSold || 0).toLocaleString('en-IN')} units
                                                                    </p>
                                                                </div>
                                                                <div className="shrink-0 text-right">
                                                                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(customer.revenue || 0)}</p>
                                                                    <p className="mt-1 text-[11px] text-gray-500">{customer.lastOrderedAt ? formatAdminDateTime(customer.lastOrderedAt) : '—'}</p>
                                                                </div>
                                                            </button>
                                                        ))}
                                                        {!(productPurchases?.customers || []).length && (
                                                            <EmptyState
                                                                image={dashboardIllustration}
                                                                alt="No customers found"
                                                                title="No customers found"
                                                                description="No matched customers were found for this product in the selected period."
                                                                compact
                                                            />
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="rounded-2xl border border-gray-200 bg-white p-5">
                                                    <div className="flex items-center justify-between gap-3">
                                                        <div>
                                                            <h4 className="text-base font-semibold text-gray-900">Orders</h4>
                                                            <p className="mt-1 text-xs text-gray-500">Orders that included this product.</p>
                                                        </div>
                                                        <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                                                            {Number(productPurchases?.orders?.length || 0).toLocaleString('en-IN')} listed
                                                        </span>
                                                    </div>
                                                    <div className="mt-4 space-y-2">
                                                        {(productPurchases?.orders || []).map((order) => (
                                                            <button
                                                                key={String(order.orderId)}
                                                                type="button"
                                                                onClick={() => {
                                                                    closeTopProductDrawer();
                                                                    onRunAction({
                                                                        id: `product_order_${order.orderId}`,
                                                                        target: {
                                                                            tab: 'orders',
                                                                            orderId: order.orderId,
                                                                            quickRange,
                                                                            startDate: quickRange === 'custom' ? startDate : '',
                                                                            endDate: quickRange === 'custom' ? endDate : ''
                                                                        }
                                                                    });
                                                                }}
                                                                className="flex w-full items-start justify-between gap-3 rounded-xl border border-gray-100 px-3 py-3 text-left transition hover:bg-gray-50"
                                                            >
                                                                <div className="min-w-0">
                                                                    <div className="flex items-center gap-2">
                                                                        <p className="text-sm font-semibold text-gray-900">#{order.orderRef || order.orderId}</p>
                                                                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${getDashboardStatusBadgeClasses(order.status)}`}>
                                                                            {formatDashboardStatusLabel(order.status)}
                                                                        </span>
                                                                    </div>
                                                                    <p className="mt-1 truncate text-xs text-gray-500">
                                                                        {order.customerName || 'Guest'}{order.customerMobile ? ` • ${order.customerMobile}` : ''}
                                                                    </p>
                                                                    <p className="mt-2 text-[11px] text-gray-500">
                                                                        Qty {Number(order.quantity || 0).toLocaleString('en-IN')} • {formatAdminDateTime(order.createdAt)}
                                                                    </p>
                                                                </div>
                                                                <div className="shrink-0 text-right">
                                                                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(order.lineTotal || 0)}</p>
                                                                    <p className="mt-1 text-[11px] text-gray-500">{formatDashboardStatusLabel(order.paymentStatus || order.status)}</p>
                                                                </div>
                                                            </button>
                                                        ))}
                                                        {!(productPurchases?.orders || []).length && (
                                                            <EmptyState
                                                                image={dashboardIllustration}
                                                                alt="No orders found"
                                                                title="No orders found"
                                                                description="No matching orders were found for this product in the selected period."
                                                                compact
                                                            />
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </div>,
                        document.body
                    )}
                </>
            )}
        </div>
    );
}
