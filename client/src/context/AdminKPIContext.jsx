import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { orderService } from '../services/orderService';
import { adminService } from '../services/adminService';
import { useSocket } from './SocketContext';
import {
    DEFAULT_ADMIN_ABANDONED_RANGE,
    DEFAULT_ADMIN_QUICK_RANGE,
    normalizeAbandonedRangeValue,
    normalizeAdminQuickRange
} from '../utils/adminDateRanges';

const AdminKPIContext = createContext(null);

const ORDER_TTL_MS = 60 * 1000;
const ABANDONED_TTL_MS = 60 * 1000;
const RECONCILE_INTERVAL_MS = 30 * 1000;
const FAILURE_COOLDOWN_MS = 2 * 60 * 1000;

const toOrderMetricsKey = (query = {}) => [
    String(query.search || ''),
    String(query.startDate || ''),
    String(query.endDate || ''),
    String(normalizeAdminQuickRange(query.quickRange || DEFAULT_ADMIN_QUICK_RANGE)),
    String(query.sourceChannel || 'all'),
    String(query.status || 'all')
].join('::');

const toAbandonedInsightsKey = (rangeDays = DEFAULT_ADMIN_ABANDONED_RANGE) => String(normalizeAbandonedRangeValue(rangeDays));

export const AdminKPIProvider = ({ children }) => {
    const { socket } = useSocket();
    const [orderMetricsByKey, setOrderMetricsByKey] = useState({});
    const [abandonedInsightsByKey, setAbandonedInsightsByKey] = useState({});
    const registeredOrderQueriesRef = useRef({});
    const registeredAbandonedRangesRef = useRef({});
    const orderFailureCooldownRef = useRef({});
    const abandonedFailureCooldownRef = useRef({});

    const setOrderMetricsSnapshot = useCallback((query, metrics) => {
        const key = toOrderMetricsKey(query);
        registeredOrderQueriesRef.current[key] = { ...(query || {}) };
        setOrderMetricsByKey((prev) => ({
            ...prev,
            [key]: {
                query: { ...(query || {}) },
                metrics: metrics || null,
                ts: Date.now(),
                dirty: false
            }
        }));
    }, []);

    const setAbandonedInsightsSnapshot = useCallback((rangeDays, insights) => {
        const key = toAbandonedInsightsKey(rangeDays);
        registeredAbandonedRangesRef.current[key] = normalizeAbandonedRangeValue(rangeDays);
        setAbandonedInsightsByKey((prev) => ({
            ...prev,
            [key]: {
                rangeDays: normalizeAbandonedRangeValue(rangeDays),
                insights: insights || null,
                ts: Date.now(),
                dirty: false
            }
        }));
    }, []);

    const registerOrderMetricsQuery = useCallback((query = {}) => {
        const key = toOrderMetricsKey(query);
        registeredOrderQueriesRef.current[key] = { ...(query || {}) };
        return key;
    }, []);

    const registerAbandonedInsightsRange = useCallback((rangeDays = DEFAULT_ADMIN_ABANDONED_RANGE) => {
        const key = toAbandonedInsightsKey(rangeDays);
        registeredAbandonedRangesRef.current[key] = normalizeAbandonedRangeValue(rangeDays);
        return key;
    }, []);

    const fetchOrderMetrics = useCallback(async (query = {}, { force = false, bypassCooldown = false } = {}) => {
        const key = toOrderMetricsKey(query);
        const existing = orderMetricsByKey[key];
        const now = Date.now();
        const cooldownUntil = Number(orderFailureCooldownRef.current[key] || 0);
        if (!bypassCooldown && cooldownUntil > now) {
            return existing?.metrics || null;
        }
        if (!force && existing && !existing.dirty && Date.now() - existing.ts < ORDER_TTL_MS) {
            return existing.metrics;
        }
        try {
            const res = await orderService.getAdminOrders({
                page: 1,
                limit: 1,
                status: query.status || 'all',
                search: query.search || '',
                startDate: query.startDate || '',
                endDate: query.endDate || '',
                quickRange: normalizeAdminQuickRange(query.quickRange || DEFAULT_ADMIN_QUICK_RANGE),
                sourceChannel: query.sourceChannel || 'all',
                sortBy: 'newest'
            });
            delete orderFailureCooldownRef.current[key];
            setOrderMetricsSnapshot(query, res?.metrics || null);
            return res?.metrics || null;
        } catch (error) {
            orderFailureCooldownRef.current[key] = Date.now() + FAILURE_COOLDOWN_MS;
            throw error;
        }
    }, [orderMetricsByKey, setOrderMetricsSnapshot]);

    const fetchAbandonedInsights = useCallback(async (rangeDays = DEFAULT_ADMIN_ABANDONED_RANGE, { force = false, bypassCooldown = false } = {}) => {
        const key = toAbandonedInsightsKey(rangeDays);
        const existing = abandonedInsightsByKey[key];
        const now = Date.now();
        const cooldownUntil = Number(abandonedFailureCooldownRef.current[key] || 0);
        if (!bypassCooldown && cooldownUntil > now) {
            return existing?.insights || null;
        }
        if (!force && existing && !existing.dirty && Date.now() - existing.ts < ABANDONED_TTL_MS) {
            return existing.insights;
        }
        try {
            const res = await adminService.getAbandonedCartInsights(rangeDays);
            delete abandonedFailureCooldownRef.current[key];
            setAbandonedInsightsSnapshot(rangeDays, res?.insights || null);
            return res?.insights || null;
        } catch (error) {
            abandonedFailureCooldownRef.current[key] = Date.now() + FAILURE_COOLDOWN_MS;
            throw error;
        }
    }, [abandonedInsightsByKey, setAbandonedInsightsSnapshot]);

    const markOrderMetricsDirty = useCallback((query = null) => {
        setOrderMetricsByKey((prev) => {
            const next = { ...prev };
            if (!query) {
                Object.keys(next).forEach((key) => {
                    next[key] = { ...next[key], dirty: true };
                });
                return next;
            }
            const key = toOrderMetricsKey(query);
            if (!next[key]) return prev;
            next[key] = { ...next[key], dirty: true };
            return next;
        });
    }, []);

    const markAbandonedInsightsDirty = useCallback((rangeDays = null) => {
        setAbandonedInsightsByKey((prev) => {
            const next = { ...prev };
            if (rangeDays == null) {
                Object.keys(next).forEach((key) => {
                    next[key] = { ...next[key], dirty: true };
                });
                return next;
            }
            const key = toAbandonedInsightsKey(rangeDays);
            if (!next[key]) return prev;
            next[key] = { ...next[key], dirty: true };
            return next;
        });
    }, []);

    const reconcileNow = useCallback(async () => {
        const orderEntries = Object.entries(registeredOrderQueriesRef.current || {});
        for (const [, query] of orderEntries) {
            try {
                await fetchOrderMetrics(query, { force: true });
            } catch {}
        }
        const abandonedEntries = Object.entries(registeredAbandonedRangesRef.current || {});
        for (const [, rangeDays] of abandonedEntries) {
            try {
                await fetchAbandonedInsights(rangeDays, { force: true });
            } catch {}
        }
    }, [fetchAbandonedInsights, fetchOrderMetrics]);

    useEffect(() => {
        const timer = setInterval(() => {
            const now = Date.now();

            const orderEntries = Object.entries(orderMetricsByKey);
            orderEntries.forEach(([key, entry]) => {
                const stale = !entry?.ts || now - entry.ts >= ORDER_TTL_MS;
                if (!stale && !entry?.dirty) return;
                const query = registeredOrderQueriesRef.current[key] || entry?.query;
                if (!query) return;
                fetchOrderMetrics(query, { force: true }).catch(() => {});
            });

            const abandonedEntries = Object.entries(abandonedInsightsByKey);
            abandonedEntries.forEach(([key, entry]) => {
                const stale = !entry?.ts || now - entry.ts >= ABANDONED_TTL_MS;
                if (!stale && !entry?.dirty) return;
                const rangeDays = registeredAbandonedRangesRef.current[key] || entry?.rangeDays || DEFAULT_ADMIN_ABANDONED_RANGE;
                fetchAbandonedInsights(rangeDays, { force: true }).catch(() => {});
            });
        }, RECONCILE_INTERVAL_MS);
        return () => clearInterval(timer);
    }, [abandonedInsightsByKey, fetchAbandonedInsights, fetchOrderMetrics, orderMetricsByKey]);

    useEffect(() => {
        if (!socket) return;
        const handleOrderLikeEvent = () => {
            markOrderMetricsDirty();
            markAbandonedInsightsDirty();
        };
        socket.on('order:create', handleOrderLikeEvent);
        socket.on('order:update', handleOrderLikeEvent);
        socket.on('payment:update', handleOrderLikeEvent);
        socket.on('abandoned_cart:update', handleOrderLikeEvent);
        socket.on('abandoned_cart:journey:update', handleOrderLikeEvent);
        socket.on('abandoned_cart:recovered', handleOrderLikeEvent);
        return () => {
            socket.off('order:create', handleOrderLikeEvent);
            socket.off('order:update', handleOrderLikeEvent);
            socket.off('payment:update', handleOrderLikeEvent);
            socket.off('abandoned_cart:update', handleOrderLikeEvent);
            socket.off('abandoned_cart:journey:update', handleOrderLikeEvent);
            socket.off('abandoned_cart:recovered', handleOrderLikeEvent);
        };
    }, [markAbandonedInsightsDirty, markOrderMetricsDirty, socket]);

    const value = useMemo(() => ({
        toOrderMetricsKey,
        toAbandonedInsightsKey,
        orderMetricsByKey,
        abandonedInsightsByKey,
        registerOrderMetricsQuery,
        registerAbandonedInsightsRange,
        setOrderMetricsSnapshot,
        setAbandonedInsightsSnapshot,
        fetchOrderMetrics,
        fetchAbandonedInsights,
        markOrderMetricsDirty,
        markAbandonedInsightsDirty,
        reconcileNow
    }), [
        abandonedInsightsByKey,
        fetchAbandonedInsights,
        fetchOrderMetrics,
        markAbandonedInsightsDirty,
        markOrderMetricsDirty,
        orderMetricsByKey,
        registerAbandonedInsightsRange,
        registerOrderMetricsQuery,
        reconcileNow,
        setAbandonedInsightsSnapshot,
        setOrderMetricsSnapshot
    ]);

    return (
        <AdminKPIContext.Provider value={value}>
            {children}
        </AdminKPIContext.Provider>
    );
};

export const useAdminKPI = () => {
    const ctx = useContext(AdminKPIContext);
    if (!ctx) throw new Error('useAdminKPI must be used within AdminKPIProvider');
    return ctx;
};

export { toOrderMetricsKey, toAbandonedInsightsKey };
