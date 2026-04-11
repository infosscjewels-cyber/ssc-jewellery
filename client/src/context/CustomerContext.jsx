/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { adminService } from '../services/adminService';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';

const CustomerContext = createContext(null);
const CACHE_TTL = 5 * 60 * 1000;
const STORAGE_KEY = 'admin_users_cache_v3';

export const CustomerProvider = ({ children }) => {
    const { user } = useAuth();
    const { socket } = useSocket();
    const [users, setUsers] = useState([]);
    const [lastFetchedAt, setLastFetchedAt] = useState(0);
    const [loading, setLoading] = useState(false);
    const usersCountRef = useRef(0);
    const lastFetchedAtRef = useRef(0);
    const archiveModeRef = useRef('active');

    useEffect(() => {
        usersCountRef.current = users.length;
    }, [users.length]);

    useEffect(() => {
        lastFetchedAtRef.current = lastFetchedAt;
    }, [lastFetchedAt]);

    const refreshUsers = useCallback(async (force = false, options = {}) => {
        if (!user || (user.role !== 'admin' && user.role !== 'staff')) return;
        const archiveMode = String(options.archiveMode || 'active').trim().toLowerCase() || 'active';
        const canUseLocalCache = archiveMode === 'active';
        if (canUseLocalCache && !force && Date.now() - lastFetchedAtRef.current < CACHE_TTL && usersCountRef.current > 0) return;

        setLoading(true);
        try {
            adminService.clearCache();
            const all = await adminService.getUsersAll('all', '', { archiveMode });
            archiveModeRef.current = archiveMode;
            setUsers(all);
            const ts = Date.now();
            setLastFetchedAt(ts);
            if (archiveMode === 'active') {
                try {
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({ users: all, ts, archiveMode: 'active' }));
                } catch {
                    // Ignore storage write failures for admin list cache.
                }
            }
        } finally {
            setLoading(false);
        }
    }, [user]);

    useEffect(() => {
        try {
            const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (cached && Array.isArray(cached.users) && (cached.archiveMode || 'active') === 'active') {
                setUsers(cached.users);
                setLastFetchedAt(cached.ts || 0);
            }
        } catch {
            // Ignore malformed cache payloads and refetch.
        }
        refreshUsers(false);
    }, [refreshUsers]);

    useEffect(() => {
        if (!socket || !user || (user.role !== 'admin' && user.role !== 'staff')) return;

        const persist = (updater) => {
            setUsers((prev) => {
                const nextUsers = typeof updater === 'function' ? updater(prev) : updater;
                const ts = Date.now();
                setLastFetchedAt(ts);
                if (archiveModeRef.current === 'active') {
                    try {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({ users: nextUsers, ts, archiveMode: 'active' }));
                    } catch {
                        // Ignore storage write failures for admin list cache.
                    }
                }
                return nextUsers;
            });
        };
        const patchUserCartActivity = (userId, activityAt) => {
            if (!userId || !activityAt) return;
            persist((prev) => prev.map((entry) => (
                String(entry?.id || '') === String(userId)
                    ? {
                        ...entry,
                        abandoned_cart_last_activity_at: activityAt,
                        abandonedCartLastActivityAt: activityAt
                    }
                    : entry
            )));
        };
        const resolveCartActivityAt = (payload = {}) => (
            payload?.journey?.computed_last_activity_at
            || payload?.journey?.last_activity_at
            || payload?.journey?.updated_at
            || payload?.ts
            || null
        );

        const handleCreate = (newUser) => {
            if (!newUser?.id) return;
            if (archiveModeRef.current === 'active' && newUser.isArchived) return;
            adminService.clearCache();
            persist((prev) => {
                const exists = prev.find((u) => u.id === newUser.id);
                if (exists) return prev.map((u) => (u.id === newUser.id ? { ...u, ...newUser } : u));
                return [newUser, ...prev];
            });
        };

        const handleUpdate = (updatedUser) => {
            if (!updatedUser?.id) return;
            adminService.clearCache();
            persist((prev) => {
                if (archiveModeRef.current === 'active' && updatedUser.isArchived) {
                    return prev.filter((u) => u.id !== updatedUser.id);
                }
                const exists = prev.find((u) => u.id === updatedUser.id);
                if (!exists) return prev;
                return prev.map((u) => (u.id === updatedUser.id ? { ...u, ...updatedUser } : u));
            });
        };

        const handleDelete = ({ id }) => {
            if (!id) return;
            adminService.clearCache();
            persist((prev) => prev.filter((u) => u.id !== id));
        };
        const handleAbandonedCartUpdate = (payload = {}) => {
            const userId = payload?.userId || payload?.journey?.user_id || null;
            const activityAt = resolveCartActivityAt(payload);
            patchUserCartActivity(userId, activityAt);
        };
        const handleAbandonedCartRecovered = (payload = {}) => {
            const userId = payload?.userId || null;
            const activityAt = payload?.ts || null;
            patchUserCartActivity(userId, activityAt);
        };

        socket.on('user:create', handleCreate);
        socket.on('user:update', handleUpdate);
        socket.on('user:delete', handleDelete);
        socket.on('abandoned_cart:update', handleAbandonedCartUpdate);
        socket.on('abandoned_cart:journey:update', handleAbandonedCartUpdate);
        socket.on('abandoned_cart:recovered', handleAbandonedCartRecovered);

        return () => {
            socket.off('user:create', handleCreate);
            socket.off('user:update', handleUpdate);
            socket.off('user:delete', handleDelete);
            socket.off('abandoned_cart:update', handleAbandonedCartUpdate);
            socket.off('abandoned_cart:journey:update', handleAbandonedCartUpdate);
            socket.off('abandoned_cart:recovered', handleAbandonedCartRecovered);
        };
    }, [socket, user]);

    const value = useMemo(() => ({
        users,
        loading,
        refreshUsers
    }), [users, loading, refreshUsers]);

    return (
        <CustomerContext.Provider value={value}>
            {children}
        </CustomerContext.Provider>
    );
};

export const useCustomers = () => useContext(CustomerContext);
