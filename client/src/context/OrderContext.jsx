import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from './AuthContext';
import { orderService } from '../services/orderService';

const OrderContext = createContext(null);

const DEFAULT_PAGINATION = { currentPage: 1, totalPages: 1, totalOrders: 0 };

const buildQueryKey = ({ page, limit, duration }) => `${page}::${limit}::${duration}`;

const parseQueryKey = (key) => {
    const [pageRaw, limitRaw, durationRaw] = String(key || '').split('::');
    return {
        page: Number(pageRaw || 1),
        limit: Number(limitRaw || 10),
        duration: durationRaw || 'latest_10'
    };
};

const normalizeResponse = (data, page) => ({
    orders: data?.orders || [],
    pagination: data?.pagination || { ...DEFAULT_PAGINATION, currentPage: page }
});

export const OrderProvider = ({ children }) => {
    const { user } = useAuth();
    const [myOrdersState, setMyOrdersState] = useState({});
    const [lastOrderEvent, setLastOrderEvent] = useState(null);
    const inFlightRef = useRef(new Map());
    const userIdRef = useRef(user?.id || null);

    const setSlice = useCallback((query, updater) => {
        const key = buildQueryKey(query);
        setMyOrdersState((prev) => {
            const current = prev[key] || {
                orders: [],
                pagination: { ...DEFAULT_PAGINATION, currentPage: query.page },
                isLoading: false,
                error: null,
                lastUpdated: null
            };
            const nextValue = updater(current);
            if (nextValue === current) return prev;
            return { ...prev, [key]: nextValue };
        });
    }, []);

    const loadMyOrders = useCallback(async ({
        page = 1,
        limit = 10,
        duration = 'latest_10',
        force = false
    } = {}) => {
        if (!user) return null;

        const query = { page, limit, duration };
        const key = buildQueryKey(query);
        const cached = orderService.getCachedMyOrders(query);

        if (cached) {
            const cachedData = normalizeResponse(cached, page);
            setSlice(query, (current) => ({
                ...current,
                ...cachedData,
                isLoading: false,
                error: null,
                lastUpdated: Date.now()
            }));
        } else {
            setSlice(query, (current) => ({
                ...current,
                isLoading: true,
                error: null
            }));
        }

        const inFlight = inFlightRef.current.get(key);
        if (inFlight && !force) return inFlight;

        const task = (async () => {
            try {
                const data = await orderService.getMyOrders({
                    page,
                    limit,
                    duration,
                    force: force || !cached
                });
                const nextData = normalizeResponse(data, page);
                setSlice(query, (current) => ({
                    ...current,
                    ...nextData,
                    isLoading: false,
                    error: null,
                    lastUpdated: Date.now()
                }));
                return data;
            } catch (error) {
                setSlice(query, (current) => ({
                    ...current,
                    isLoading: false,
                    error
                }));
                throw error;
            } finally {
                inFlightRef.current.delete(key);
            }
        })();

        inFlightRef.current.set(key, task);
        return task;
    }, [setSlice, user]);

    const refreshMyOrders = useCallback((query = {}) => {
        return loadMyOrders({ ...query, force: true });
    }, [loadMyOrders]);

    useEffect(() => {
        const nextUserId = user?.id || null;
        const previousUserId = userIdRef.current;
        if (previousUserId === nextUserId) return;
        userIdRef.current = nextUserId;
        inFlightRef.current.clear();
        setMyOrdersState({});
        setLastOrderEvent(null);
    }, [user]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleCacheUpdate = (event) => {
            const payload = event?.detail || {};
            const eventOrder = payload?.order || null;
            if (eventOrder) {
                setLastOrderEvent(eventOrder);
            }

            setMyOrdersState((prev) => {
                const keys = Object.keys(prev);
                if (keys.length === 0) return prev;

                let changed = false;
                const next = { ...prev };

                keys.forEach((key) => {
                    const query = parseQueryKey(key);
                    const cached = orderService.getCachedMyOrders(query);
                    if (!cached) return;
                    changed = true;
                    const data = normalizeResponse(cached, query.page);
                    next[key] = {
                        ...prev[key],
                        ...data,
                        isLoading: false,
                        error: null,
                        lastUpdated: Date.now()
                    };
                });

                return changed ? next : prev;
            });
        };

        window.addEventListener('orders:cache-updated', handleCacheUpdate);
        return () => window.removeEventListener('orders:cache-updated', handleCacheUpdate);
    }, []);

    const value = useMemo(() => ({
        myOrdersState,
        lastOrderEvent,
        loadMyOrders,
        refreshMyOrders
    }), [lastOrderEvent, loadMyOrders, myOrdersState, refreshMyOrders]);

    return (
        <OrderContext.Provider value={value}>
            {children}
        </OrderContext.Provider>
    );
};

export const useOrder = () => {
    const context = useContext(OrderContext);
    if (!context) {
        throw new Error('useOrder must be used within OrderProvider');
    }
    return context;
};

export const useMyOrders = ({
    page = 1,
    limit = 10,
    duration = 'latest_10',
    autoLoad = true
} = {}) => {
    const { user } = useAuth();
    const { myOrdersState, lastOrderEvent, loadMyOrders, refreshMyOrders } = useOrder();
    const queryKey = buildQueryKey({ page, limit, duration });
    const slice = myOrdersState[queryKey] || {
        orders: [],
        pagination: { ...DEFAULT_PAGINATION, currentPage: page },
        isLoading: autoLoad && !!user,
        error: null,
        lastUpdated: null
    };

    useEffect(() => {
        if (!autoLoad || !user) return;
        loadMyOrders({ page, limit, duration }).catch(() => {
            // error is kept in context state for consumers
        });
    }, [autoLoad, duration, limit, loadMyOrders, page, user]);

    const reload = useCallback(() => {
        return loadMyOrders({ page, limit, duration, force: false });
    }, [duration, limit, loadMyOrders, page]);

    const refresh = useCallback(() => {
        return refreshMyOrders({ page, limit, duration });
    }, [duration, limit, page, refreshMyOrders]);

    return {
        ...slice,
        lastOrderEvent,
        reload,
        refresh
    };
};
