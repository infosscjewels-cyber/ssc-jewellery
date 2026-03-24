/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authService } from '../services/authService';
import { productService } from '../services/productService';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import { getSessionExpiredEventName, getStoredToken, shouldTreatAsExpiredSession } from '../utils/authSession';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const logoutInFlightRef = useRef(false);

    // 3. Centralized Logout Function
    const performLogout = useCallback(async () => {
        if (logoutInFlightRef.current) return;
        logoutInFlightRef.current = true;
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        try { await signOut(auth); } catch (e) { console.error(e); }
        setUser(null); // Updates Navbar instantly!
        productService.clearCache();
        logoutInFlightRef.current = false;
    }, []);

    // 1. Check Session on Mount (The "Auto-Login" Logic)
    useEffect(() => {
        let cancelled = false;
        const initAuth = async () => {
            const token = getStoredToken();
            const storedUser = localStorage.getItem('user');
            let parsedStoredUser = null;
            try {
                parsedStoredUser = storedUser ? JSON.parse(storedUser) : null;
            } catch {
                parsedStoredUser = null;
            }

            // [FIX] Strict check to ensure token is not the string "undefined" or "null"
            if (token && token !== "undefined" && token !== "null") {
                try {
                    if (!authService.isTokenExpired(token)) {
                        // Hydrate immediately from cache so navbar tier/profile render instantly.
                        if (parsedStoredUser && typeof parsedStoredUser === 'object') {
                            if (!cancelled) setUser(parsedStoredUser);
                            if (!cancelled) setLoading(false);
                        }

                        // Refresh latest profile + loyalty in background and merge into auth state.
                        const [profileResult, loyaltyResult] = await Promise.allSettled([
                            authService.getProfile(),
                            authService.getLoyaltyStatus()
                        ]);

                        if (cancelled) return;

                        const profileUser = (
                            profileResult.status === 'fulfilled'
                                ? profileResult.value?.user || null
                                : null
                        );
                        const loyaltyStatus = (
                            loyaltyResult.status === 'fulfilled'
                                ? loyaltyResult.value?.status || null
                                : null
                        );

                        if (profileUser) {
                            const mergedUser = {
                                ...profileUser,
                                ...(loyaltyStatus?.tier ? { loyaltyTier: String(loyaltyStatus.tier).toLowerCase() } : {}),
                                ...(loyaltyStatus?.profile ? { loyaltyProfile: loyaltyStatus.profile } : {})
                            };
                            localStorage.setItem('user', JSON.stringify(mergedUser));
                            setUser(mergedUser);
                        } else if (!parsedStoredUser) {
                            await performLogout();
                        }
                    } else {
                        await performLogout();
                    }
                } catch (error) {
                    console.error("Session restoration failed:", error);
                    await performLogout();
                }
            } else {
                if (token || storedUser) {
                    await performLogout();
                }
            }
            if (!cancelled) setLoading(false);
        };
        initAuth();
        return () => {
            cancelled = true;
        };
    }, [performLogout]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const syncCurrentUser = async () => {
            const token = getStoredToken();
            if (!token) return;
            try {
                const [profileResult, loyaltyResult] = await Promise.allSettled([
                    authService.getProfile(),
                    authService.getLoyaltyStatus()
                ]);

                const profileUser = profileResult.status === 'fulfilled'
                    ? profileResult.value?.user || null
                    : null;
                const loyaltyStatus = loyaltyResult.status === 'fulfilled'
                    ? loyaltyResult.value?.status || null
                    : null;

                if (!profileUser) {
                    await performLogout();
                    return;
                }

                const mergedUser = {
                    ...profileUser,
                    ...(loyaltyStatus?.tier ? { loyaltyTier: String(loyaltyStatus.tier).toLowerCase() } : {}),
                    ...(loyaltyStatus?.profile ? { loyaltyProfile: loyaltyStatus.profile } : {})
                };
                localStorage.setItem('user', JSON.stringify(mergedUser));
                setUser(mergedUser);
            } catch (error) {
                console.error('Current user sync failed:', error);
                const message = String(error?.message || '').toLowerCase();
                if (message.includes('deactivated') || shouldTreatAsExpiredSession(401, message)) {
                    await performLogout();
                }
            }
        };

        const handleUserUpdated = async (event) => {
            const updatedUser = event?.detail || {};
            if (!updatedUser?.id || !user?.id) return;
            if (String(updatedUser.id) !== String(user.id)) return;
            if (updatedUser?.isActive === false) {
                await performLogout();
                return;
            }
            void syncCurrentUser();
        };

        const handleUserDeleted = async (event) => {
            const deletedUserId = event?.detail?.id;
            if (!deletedUserId || !user?.id) return;
            if (String(deletedUserId) !== String(user.id)) return;
            await performLogout();
        };

        window.addEventListener('auth:user-updated', handleUserUpdated);
        window.addEventListener('auth:user-deleted', handleUserDeleted);
        return () => {
            window.removeEventListener('auth:user-updated', handleUserUpdated);
            window.removeEventListener('auth:user-deleted', handleUserDeleted);
        };
    }, [performLogout, user]);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;

        const handleSessionExpired = async () => {
            await performLogout();
        };

        window.addEventListener(getSessionExpiredEventName(), handleSessionExpired);
        return () => {
            window.removeEventListener(getSessionExpiredEventName(), handleSessionExpired);
        };
    }, [performLogout]);

    // 2. Centralized Login Function
    const login = (token, userData) => {
        if (!token) return; // [NEW] Stop if token is missing
        localStorage.setItem('token', token);
        localStorage.setItem('user', JSON.stringify(userData));
        setUser(userData);
        productService.clearCache(); // Avoid stale data after login
    };

    const updateUser = (updates) => {
        setUser((prev) => {
            if (!prev) return prev;
            const next = { ...prev, ...updates };
            localStorage.setItem('user', JSON.stringify(next));
            return next;
        });
    };

    return (
        <AuthContext.Provider value={{ user, login, logout: performLogout, updateUser, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
