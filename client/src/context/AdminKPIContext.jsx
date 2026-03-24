import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { orderService } from '../services/orderService';
import { adminService } from '../services/adminService';
import { useSocket } from './SocketContext';

const AdminKPIContext = createContext(null);

const ORDER_TTL_MS = 60 * 1000;
const ABANDONED_TTL_MS = 60 * 1000;
const RECONCILE_INTERVAL_MS = 30 * 1000;

const toOrderMetricsKey = (query = {}) => [
    String(query.search || ''),
    String(query.startDate || ''),
    String(query.endDate || ''),
    String(query.quickRange || 'last_90_days'),
    String(query.sourceChannel || 'all'),
    String(query.status || 'all')
].join('::');

const toAbandonedInsightsKey = (rangeDays = 30) => String(Number(rangeDays || 30));

export const AdminKPIProvider = ({ children }) => {
    const { socket } = useSocket();
    const [orderMetricsByKey, setOrderMetricsByKey] = useState({});
    const [abandonedInsightsByKey, setAbandonedInsightsByKey] = useState({});
    const registeredOrderQueriesRef = useRef({});
    const registeredAbandonedRangesRef = useRef({});

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
        registeredAbandonedRangesRef.current[key] = Number(rangeDays || 30);
        setAbandonedInsightsByKey((prev) => ({
            ...prev,
            [key]: {
                rangeDays: Number(rangeDays || 30),
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

    const registerAbandonedInsightsRange = useCallback((rangeDays = 30) => {
        const key = toAbandonedInsightsKey(rangeDays);
        registeredAbandonedRangesRef.current[key] = Number(rangeDays || 30);
        return key;
    }, []);

    const fetchOrderMetrics = useCallback(async (query = {}, { force = false } = {}) => {
        const key = toOrderMetricsKey(query);
        const existing = orderMetricsByKey[key];
        if (!force && existing && !existing.dirty && Date.now() - existing.ts < ORDER_TTL_MS) {
            return existing.metrics;
        }
        const res = await orderService.getAdminOrders({
            page: 1,
            limit: 1,
            status: query.status || 'all',
            search: query.search || '',
            startDate: query.startDate || '',
            endDate: query.endDate || '',
            quickRange: query.quickRange || 'last_90_days',
            sourceChannel: query.sourceChannel || 'all',
            sortBy: 'newest'
        });
        setOrderMetricsSnapshot(query, res?.metrics || null);
        return res?.metrics || null;
    }, [orderMetricsByKey, setOrderMetricsSnapshot]);

    const fetchAbandonedInsights = useCallback(async (rangeDays = 30, { force = false } = {}) => {
        const key = toAbandonedInsightsKey(rangeDays);
        const existing = abandonedInsightsByKey[key];
        if (!force && existing && !existing.dirty && Date.now() - existing.ts < ABANDONED_TTL_MS) {
            return existing.insights;
        }
        const res = await adminService.getAbandonedCartInsights(rangeDays);
        setAbandonedInsightsSnapshot(rangeDays, res?.insights || null);
        return res?.insights || null;
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
                const rangeDays = registeredAbandonedRangesRef.current[key] || entry?.rangeDays || 30;
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
