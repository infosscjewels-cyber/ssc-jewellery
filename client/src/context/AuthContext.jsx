/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { authService } from '../services/authService';
import { productService } from '../services/productService';
import { signOut } from 'firebase/auth';
import { auth } from '../firebase';
import {
    clearStoredSession,
    getSessionExpiredEventName,
    getStoredToken,
    getStoredUser,
    setStoredSession,
    setStoredUser,
    shouldTreatAsExpiredSession,
    syncGuestPreviewModeFromLocation
} from '../utils/authSession';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
    const [user, setUser] = useState(null);
    const [loading, setLoading] = useState(true);
    const logoutInFlightRef = useRef(false);

    const mergeUserWithLoyalty = useCallback((profileUser, loyaltyStatus = null) => ({
        ...profileUser,
        ...(loyaltyStatus?.effectiveTier || loyaltyStatus?.tier
            ? { loyaltyTier: String(loyaltyStatus?.effectiveTier || loyaltyStatus?.tier || 'regular').toLowerCase() }
            : {}),
        ...(loyaltyStatus?.effectiveProfile || loyaltyStatus?.profile
            ? { loyaltyProfile: loyaltyStatus?.effectiveProfile || loyaltyStatus?.profile }
            : {}),
        ...(loyaltyStatus?.eligibility ? { loyaltyEligibility: loyaltyStatus.eligibility } : {}),
        ...(loyaltyStatus?.tier || loyaltyStatus?.earnedTier
            ? { earnedLoyaltyTier: String(loyaltyStatus?.tier || loyaltyStatus?.earnedTier || 'regular').toLowerCase() }
            : {}),
        ...(loyaltyStatus?.earnedProfile || loyaltyStatus?.profile
            ? { earnedLoyaltyProfile: loyaltyStatus?.earnedProfile || loyaltyStatus?.profile }
            : {})
    }), []);

    // 3. Centralized Logout Function
    const performLogout = useCallback(async () => {
        if (logoutInFlightRef.current) return;
        logoutInFlightRef.current = true;
        clearStoredSession();
        try { await signOut(auth); } catch (e) { console.error(e); }
        setUser(null); // Updates Navbar instantly!
        productService.clearCache();
        logoutInFlightRef.current = false;
    }, []);

    // 1. Check Session on Mount (The "Auto-Login" Logic)
    useEffect(() => {
        let cancelled = false;
        const initAuth = async () => {
            syncGuestPreviewModeFromLocation();
            const token = getStoredToken();
            const parsedStoredUser = getStoredUser();

            // [FIX] Strict check to ensure token is not the string "undefined" or "null"
            if (token && token !== "undefined" && token !== "null") {
                try {
                    if (!authService.isTokenExpired(token)) {
                        // Hydrate immediately from cache so navbar tier/profile render instantly.
                        if (parsedStoredUser && typeof parsedStoredUser === 'object') {
                            if (!cancelled) setUser(parsedStoredUser);
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
                            const mergedUser = mergeUserWithLoyalty(profileUser, loyaltyStatus);
                            setStoredUser(mergedUser);
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
                if (token || parsedStoredUser) {
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

                const mergedUser = mergeUserWithLoyalty(profileUser, loyaltyStatus);
                setStoredUser(mergedUser);
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
    }, [mergeUserWithLoyalty, performLogout, user]);

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
        setStoredSession(token, userData);
        setUser(userData);
        productService.clearCache(); // Avoid stale data after login
    };

    const updateUser = (updates) => {
        setUser((prev) => {
            if (!prev) return prev;
            const next = { ...prev, ...updates };
            setStoredUser(next);
            return next;
        });
    };

    const refreshUser = useCallback(async () => {
        const token = getStoredToken();
        if (!token || token === 'undefined' || token === 'null') return null;
        const [profileResult, loyaltyResult] = await Promise.allSettled([
            authService.getProfile(),
            authService.getLoyaltyStatus()
        ]);
        const profileUser = profileResult.status === 'fulfilled'
            ? profileResult.value?.user || null
            : null;
        if (!profileUser) return null;
        const loyaltyStatus = loyaltyResult.status === 'fulfilled'
            ? loyaltyResult.value?.status || null
            : null;
        const mergedUser = mergeUserWithLoyalty(profileUser, loyaltyStatus);
        setStoredUser(mergedUser);
        setUser(mergedUser);
        return mergedUser;
    }, [mergeUserWithLoyalty]);

    return (
        <AuthContext.Provider value={{ user, login, logout: performLogout, updateUser, refreshUser, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => useContext(AuthContext);
