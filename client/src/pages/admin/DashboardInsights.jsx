import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowRight, AlertTriangle, Activity, TrendingUp, IndianRupee, Users, ShoppingBag, Target, Bell, Save, Play, Trash2, BarChart3, Funnel, Boxes, UsersRound, Route, CalendarDays, ShieldAlert, Sparkles, PieChart, X, ChevronDown, ChevronUp } from 'lucide-react';
import { adminService } from '../../services/adminService';
import { useToast } from '../../context/ToastContext';
import dashboardIllustration from '../../assets/dashboard.svg';
import successIllustration from '../../assets/success.svg';
import successDingAudio from '../../assets/success_ding.mp3';
import { useAdminCrudSync } from '../../hooks/useAdminCrudSync';
import { burstConfetti } from '../../utils/celebration';
import EmptyState from '../../components/EmptyState';

const QUICK_RANGES = [
    { value: 'latest_10', label: 'Latest Orders (10)' },
    { value: 'last_7_days', label: 'Last 7 Days' },
    { value: 'last_30_days', label: 'Last 30 Days' },
    { value: 'last_90_days', label: 'Last 90 Days' },
    { value: 'custom', label: 'Custom Range' }
];

const formatCurrency = (value) => `₹${Number(value || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const priorityStyles = {
    high: 'bg-red-50 text-red-700 border-red-200',
    medium: 'bg-amber-50 text-amber-700 border-amber-200',
    low: 'bg-blue-50 text-blue-700 border-blue-200'
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

export default function DashboardInsights({ onRunAction = () => {} }) {
    const toast = useToast();
    const toastRef = useRef(toast);
    const [quickRange, setQuickRange] = useState('last_30_days');
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
    const [trendGranularity, setTrendGranularity] = useState('daily');
    const [trendPageIndex, setTrendPageIndex] = useState(0);
    const [isGoalSettingsOpen, setIsGoalSettingsOpen] = useState(false);
    const [isAlertSettingsOpen, setIsAlertSettingsOpen] = useState(false);
    const [isStoreIntroOpen, setIsStoreIntroOpen] = useState(false);
    const [goalCelebration, setGoalCelebration] = useState({ active: false, title: '' });
    const [showGoalSaveSpark, setShowGoalSaveSpark] = useState(false);
    const [syncTick, setSyncTick] = useState(0);
    const forceRefreshRef = useRef(false);
    const hasTrackedFilterChangeRef = useRef(false);
    const startDateInputRef = useRef(null);
    const endDateInputRef = useRef(null);
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
        'abandoned_cart:recovered': queueForcedRefresh
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
                    const response = await adminService.getDashboardInsights({
                        quickRange,
                        startDate: quickRange === 'custom' ? startDate : '',
                        endDate: quickRange === 'custom' ? endDate : '',
                        comparisonMode,
                        status: statusFilter,
                        paymentMode,
                        sourceChannel,
                        forceRefresh: shouldForceRefresh
                    });
                    if (!cancelled) {
                        setData(response || null);
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
            return base;
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
        const grouped = new Map();
        trendSeries.forEach((entry) => {
            const key = String(entry?.date || '').slice(0, 7);
            if (!/^\d{4}-\d{2}$/.test(key)) return;
            const rows = grouped.get(key) || [];
            rows.push(entry);
            grouped.set(key, rows);
        });
        return [...grouped.entries()].map(([key, rows]) => {
            const [year] = key.split('-');
            const labelDate = new Date(`${key}-01T00:00:00`);
            const label = Number.isNaN(labelDate.getTime())
                ? key
                : `${labelDate.toLocaleString('en-IN', { month: 'long' })} ${year}`;
            return {
                key,
                label,
                rows: rows.sort((a, b) => String(a?.date || '').localeCompare(String(b?.date || '')))
            };
        }).sort((a, b) => a.key.localeCompare(b.key));
    }, [trendGranularity, trendSeries]);
    useEffect(() => {
        if (trendGranularity !== 'daily') {
            setTrendPageIndex(0);
            return;
        }
        if (!trendDailyPages.length) {
            setTrendPageIndex(0);
            return;
        }
        setTrendPageIndex((prev) => Math.min(Math.max(0, prev), trendDailyPages.length - 1));
    }, [trendDailyPages, trendGranularity]);
    const trendVisibleSeries = trendGranularity === 'daily'
        ? (trendDailyPages[trendPageIndex]?.rows || [])
        : trendSeries;
    const maxTrendRevenue = Math.max(1, ...trendVisibleSeries.map((entry) => Number(entry?.revenue || 0)));
    const trackerGoals = useMemo(
        () => (goals || []).filter((goal) => Number(goal?.progressPct || 0) < 100),
        [goals]
    );
    const progressBarClass = (pct) => {
        const value = Number(pct || 0);
        if (value >= 80) return 'bg-emerald-500';
        if (value >= 45) return 'bg-amber-500';
        return 'bg-rose-500';
    };
    const getTierBadgeClasses = (tier = 'regular') => {
        const value = String(tier || 'regular').toLowerCase();
        if (value === 'platinum') return 'bg-sky-100 text-sky-800';
        if (value === 'gold') return 'bg-yellow-100 text-yellow-800';
        if (value === 'silver') return 'bg-slate-100 text-slate-700';
        if (value === 'bronze') return 'bg-amber-100 text-amber-800';
        return 'bg-gray-100 text-gray-600';
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
    const hasAnyInsight = Boolean(
        Number(overview.totalOrders || 0) > 0
        || Number(overview.netSales || 0) > 0
        || Number(overview.grossSales || 0) > 0
        || actions.length > 0
        || trends.some((entry) => Number(entry?.orders || 0) > 0 || Number(entry?.revenue || 0) > 0)
        || (products.topSellers || []).length > 0
        || (customers.topCustomers || []).length > 0
    );

    const cards = [
        { label: 'Final Sales', value: formatCurrency(overview.netSales), icon: IndianRupee, target: { tab: 'orders', status: 'all', sortBy: 'amount_high' }, widgetId: 'kpi_net_sales', cardClass: 'bg-emerald-50 border-emerald-100', iconClass: 'text-emerald-700' },
        { label: 'Total Sales', value: formatCurrency(overview.grossSales), icon: TrendingUp, target: { tab: 'orders', status: 'all', sortBy: 'amount_high' }, widgetId: 'kpi_gross_sales', cardClass: 'bg-sky-50 border-sky-100', iconClass: 'text-sky-700' },
        { label: 'Orders', value: Number(overview.totalOrders || 0).toLocaleString('en-IN'), icon: ShoppingBag, target: { tab: 'orders', status: statusFilter || 'all' }, widgetId: 'kpi_orders', cardClass: 'bg-violet-50 border-violet-100', iconClass: 'text-violet-700' },
        { label: 'Average order value', value: formatCurrency(overview.averageOrderValue), icon: Activity, target: { tab: 'orders', status: 'all', sortBy: 'amount_high' }, widgetId: 'kpi_aov', cardClass: 'bg-amber-50 border-amber-100', iconClass: 'text-amber-700' },
        { label: 'Cancelled', value: Number(overview.cancelledOrders || 0).toLocaleString('en-IN'), icon: AlertTriangle, target: { tab: 'orders', status: 'cancelled' }, widgetId: 'kpi_cancelled_orders', cardClass: 'bg-red-50 border-red-100', iconClass: 'text-red-700' },
        { label: 'Repeat Rate', value: `${Number(overview.repeatRate || 0).toFixed(1)}%`, icon: Users, target: { tab: 'customers' }, widgetId: 'kpi_repeat_rate', cardClass: 'bg-cyan-50 border-cyan-100', iconClass: 'text-cyan-700' }
    ];
    const comparison = overview?.comparison || null;
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
        onRunAction({
            id: `card_${String(card.widgetId || card.label).toLowerCase()}`,
            target: {
                ...(card.target || { tab: 'orders' }),
                quickRange,
                startDate: quickRange === 'custom' ? startDate : '',
                endDate: quickRange === 'custom' ? endDate : ''
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
        if (key === 'upi') return 'UPI';
        if (key === 'netbanking') return 'Net Banking';
        if (key === 'card') return 'Card';
        if (key === 'emi') return 'EMI';
        if (key === 'wallet') return 'Wallet';
        if (key === 'paylater') return 'Pay Later';
        return key ? key.replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()) : 'Unknown';
    };

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
            <div className="emboss-card relative overflow-hidden bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                <BarChart3 size={64} className="bg-emboss-icon absolute right-4 top-4 text-gray-200" />
                <button
                    type="button"
                    onClick={() => setIsStoreIntroOpen((prev) => !prev)}
                    className="w-full flex items-start justify-between text-left"
                >
                    <div>
                        <h2 className="text-xl font-semibold text-gray-900">Store Intelligence</h2>
                        <p className="text-sm text-gray-500 mt-1">Sales insights, funnel health, and action priorities.</p>
                        {lastUpdatedLabel && <p className="text-xs text-gray-400 mt-1">Last updated: {lastUpdatedLabel}</p>}
                    </div>
                    <span className="mt-1 text-gray-500">{isStoreIntroOpen ? <ChevronUp size={18} /> : <ChevronDown size={18} />}</span>
                </button>
                {isStoreIntroOpen && (
                    <div className="mt-4 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex flex-wrap gap-2">
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
                        <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-2 w-full md:w-auto">
                            <select
                                value={quickRange}
                                onChange={(e) => setQuickRange(e.target.value)}
                                className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white"
                            >
                                {QUICK_RANGES.map((range) => (
                                    <option key={range.value} value={range.value}>{range.label}</option>
                                ))}
                            </select>
                            {quickRange === 'custom' && (
                                <>
                                    <input ref={startDateInputRef} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="sr-only" />
                                    <input ref={endDateInputRef} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="sr-only" />
                                    <input type="button" value={startDate ? formatPrettyDate(startDate) : 'Start Date'} onClick={() => (startDateInputRef.current?.showPicker ? startDateInputRef.current.showPicker() : startDateInputRef.current?.click())} className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-left" />
                                    <input type="button" value={endDate ? formatPrettyDate(endDate) : 'End Date'} onClick={() => (endDateInputRef.current?.showPicker ? endDateInputRef.current.showPicker() : endDateInputRef.current?.click())} className="px-3 py-2 rounded-lg border border-gray-200 text-sm bg-white text-left" />
                                </>
                            )}
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
                                <option value="shipped">Status: Shipped</option>
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
            {hasSelectedPeriod && <p className="text-xs text-gray-500 -mt-4">Selected period: {selectedPeriodLabel}</p>}

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
                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
                        {cards.map((card) => (
                            <button
                                key={card.label}
                                type="button"
                                onClick={() => handleOpenCard(card)}
                                className={`relative overflow-hidden rounded-xl border p-4 shadow-sm flex items-center justify-between text-left transition-colors hover:brightness-[0.99] ${card.cardClass}`}
                            >
                                <div>
                                    <p className="text-xs uppercase tracking-wide text-gray-500">{card.label}</p>
                                    <p className="text-2xl font-semibold text-gray-900 mt-1">{card.value}</p>
                                    {comparison && (card.label === 'Net Sales' || card.label === 'Orders') && (
                                        <p className="text-[11px] mt-1 text-gray-500">
                                            {card.label === 'Net Sales' ? `Δ ${comparison.netSales ?? 0}%` : `Δ ${comparison.totalOrders ?? 0}%`}
                                        </p>
                                    )}
                                </div>
                                <card.icon size={52} className={`absolute right-2 bottom-2 opacity-10 ${card.iconClass}`} />
                            </button>
                        ))}
                    </div>
                    {isCompareEnabled && comparison && (
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><BarChart3 size={16} />Period Comparison</h3>
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
                        <div className="xl:col-span-3 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <div className="flex items-center justify-between gap-2">
                                <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><BarChart3 size={16} />{trendGranularity.charAt(0).toUpperCase() + trendGranularity.slice(1, trendGranularity[length-1])} Sales</h3>
                                <select value={trendGranularity} onChange={(e) => setTrendGranularity(e.target.value)} className="px-2 py-1 rounded-md border border-gray-200 text-xs bg-white">
                                    <option value="daily">Daily</option>
                                    <option value="weekly">Weekly</option>
                                    <option value="monthly">Monthly</option>
                                </select>
                            </div>
                            <div className="mt-4 space-y-2">
                                {trendVisibleSeries.map((entry) => {
                                    const revenue = Number(entry?.revenue || 0);
                                    const width = Math.max(3, Math.round((revenue / maxTrendRevenue) * 100));
                                    const level = revenue / maxTrendRevenue;
                                    const barColor = level >= 0.67 ? 'bg-emerald-500' : (level >= 0.34 ? 'bg-orange-500' : 'bg-red-500');
                                    return (
                                        <div key={entry.date} className="grid grid-cols-[90px_1fr_100px] items-center gap-3">
                                            <span className="text-xs text-gray-500">{formatPrettyDate(entry.date)}</span>
                                            <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                                                <div className={`h-full rounded-full ${barColor}`} style={{ width: `${width}%` }} />
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
                                    <div className="pt-2 flex items-center justify-between">
                                        <button
                                            type="button"
                                            disabled={trendPageIndex <= 0}
                                            onClick={() => setTrendPageIndex((prev) => Math.max(0, prev - 1))}
                                            className="px-2.5 py-1 rounded-md border border-gray-200 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                                        >
                                            Prev Month
                                        </button>
                                        <span className="text-xs text-gray-500">{trendDailyPages[trendPageIndex]?.label || ''}</span>
                                        <button
                                            type="button"
                                            disabled={trendPageIndex >= trendDailyPages.length - 1}
                                            onClick={() => setTrendPageIndex((prev) => Math.min(trendDailyPages.length - 1, prev + 1))}
                                            className="px-2.5 py-1 rounded-md border border-gray-200 text-xs text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                                        >
                                            Next Month
                                        </button>
                                    </div>
                                )}
                            </div>
                            <BarChart3 size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>

                        <div className="xl:col-span-2 bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Funnel size={16} />Order Summary</h3>
                            <div className="mt-4 space-y-2">
                                {[
                                    { label: 'Attempted', value: funnel.attempted, target: { tab: 'orders', status: 'failed', quickRange: 'last_30_days' } },
                                    { label: 'Paid', value: funnel.paid, target: { tab: 'orders', status: 'confirmed', quickRange: 'last_30_days' } },
                                    { label: 'Shipped', value: funnel.shipped, target: { tab: 'orders', status: 'shipped', quickRange: 'last_30_days' } },
                                    { label: 'Completed', value: funnel.completed, target: { tab: 'orders', status: 'completed', quickRange: 'last_30_days' } },
                                    { label: 'Cancelled', value: funnel.cancelled, target: { tab: 'orders', status: 'cancelled', quickRange: 'last_30_days' } },
                                    { label: 'Refunded', value: funnel.refunded, target: { tab: 'orders', status: 'cancelled', quickRange: 'last_30_days' } }
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

                    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
                        <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Users size={12} />New Customer Revenue</p>
                            <p className="text-xl font-semibold text-gray-900 mt-1">{formatCurrency(growth.newCustomerRevenue)}</p>
                            <p className="text-xs text-gray-500 mt-1">Returning: {formatCurrency(growth.returningCustomerRevenue)}</p>
                            <Users size={46} className="absolute right-2 bottom-2 text-gray-300 opacity-20" />
                        </div>
                        <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><Target size={12} />Coupon Impact</p>
                            <p className="text-xl font-semibold text-gray-900 mt-1">{formatCurrency(growth.couponDiscountTotal)}</p>
                            <p className="text-xs text-gray-500 mt-1">{Number(growth.couponOrders || 0)} orders used coupons</p>
                            <Target size={46} className="absolute right-2 bottom-2 text-gray-300 opacity-20" />
                        </div>
                        <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><ShieldAlert size={12} />Failed Payments (6h)</p>
                            <p className="text-xl font-semibold text-gray-900 mt-1">{Number(risk.failedPaymentsCurrent6h || 0)}</p>
                            <p className="text-xs text-gray-500 mt-1">vs prev 6h: {Number(risk.failedPaymentsSpikePct || 0)}%</p>
                            <ShieldAlert size={46} className="absolute right-2 bottom-2 text-gray-300 opacity-20" />
                        </div>
                        <div className="relative overflow-hidden bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                            <p className="text-xs uppercase tracking-wide text-gray-500 flex items-center gap-1"><CalendarDays size={12} />Pending Aging</p>
                            <p className="text-xl font-semibold text-gray-900 mt-1">{Number(risk.pendingAging?.over72h || 0)} over 72h</p>
                            <p className="text-xs text-gray-500 mt-1">
                                24-72h: {Number(risk.pendingAging?.from24hTo72h || 0)}, &lt;24h: {Number(risk.pendingAging?.under24h || 0)}
                            </p>
                            <CalendarDays size={46} className="absolute right-2 bottom-2 text-gray-300 opacity-20" />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Boxes size={16} />Top Products</h3>
                            <div className="mt-4 space-y-2">
                                {(products.topSellers || []).slice(0, 6).map((item) => (
                                    <button
                                        key={`${String(item.productId)}:${String(item.variantId || '')}`}
                                        type="button"
                                        onClick={() => handleOpenAction({ id: `top_product_${item.productId}`, target: { tab: 'products', productId: item.productId } })}
                                        className="w-full text-left flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-gray-50 rounded-lg px-2 -mx-2"
                                    >
                                        <div className="flex items-center gap-3 min-w-0">
                                            <div className="w-9 h-9 rounded-lg border border-gray-200 bg-gray-50 overflow-hidden shrink-0">
                                                {item.thumbnail ? <img src={item.thumbnail} alt={item.title} className="w-full h-full object-cover" /> : null}
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-sm font-medium text-gray-800 truncate">{item.title}</p>
                                                <p className="text-xs text-gray-500">
                                                    {item.variantTitle ? `${item.variantTitle} • ` : ''}{Number(item.unitsSold || 0)} units
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
                                        description="Top products will appear here once orders are recorded in the selected range."
                                        compact
                                    />
                                )}
                            </div>
                            <Boxes size={58} className="absolute right-3 bottom-3 text-gray-300 opacity-15" />
                        </div>

                        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 relative overflow-hidden">
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><UsersRound size={16} />Top Customers</h3>
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
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold ${getTierBadgeClasses(item.loyaltyTier)}`}>
                                                    {tierLabel(item.loyaltyTier)}
                                                </span>
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
                            <div className="mt-4 space-y-2">
                                {(growth.channelRevenue || []).slice(0, 6).map((item) => (
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
                                            <p className="text-sm font-medium text-gray-800">{String(item.channel || 'unknown').replace(/_/g, ' ')}</p>
                                            <p className="text-xs text-gray-500">{Number(item.orders || 0)} orders</p>
                                        </div>
                                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(item.revenue)}</p>
                                    </button>
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
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><Target size={16} />Goal Tracker</h3>
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
                            <h3 className="text-base font-semibold text-gray-900 flex items-center gap-2"><AlertTriangle size={16} />Action Center</h3>
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
                                                        Total {Number(op.totalActions || 0)} | Shipped {Number(op.shippedUpdates || 0)} | Completed {Number(op.completedUpdates || 0)} | Cancelled {Number(op.cancelledUpdates || 0)}
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
                </>
            )}
        </div>
    );
}
