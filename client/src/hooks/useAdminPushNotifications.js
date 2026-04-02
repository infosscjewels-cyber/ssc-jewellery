import { useEffect } from 'react';
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { firebaseApp } from '../firebase';
import { authService } from '../services/authService';

const ENABLE_PUSH = String(import.meta.env.VITE_ENABLE_PUSH_NOTIFICATIONS ?? 'true').trim().toLowerCase() !== 'false';
const ENABLE_ADMIN_PUSH = String(import.meta.env.VITE_ENABLE_ADMIN_PUSH_NOTIFICATIONS ?? 'true').trim().toLowerCase() !== 'false';
const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();
const PUSH_PROMPTED_KEY = 'admin_push_notifications_prompted_v1';

const buildDeviceLabel = () => {
    if (typeof navigator === 'undefined') return 'Admin Browser';
    const platform = String(navigator.platform || '').trim();
    return platform ? `Admin Browser (${platform})` : 'Admin Browser';
};

export const useAdminPushNotifications = (user = null) => {
    useEffect(() => {
        if (typeof window === 'undefined' || typeof navigator === 'undefined') return;
        if (!ENABLE_PUSH || !ENABLE_ADMIN_PUSH || !VAPID_KEY) return;
        if (!user?.id) return;
        const role = String(user?.role || '').trim().toLowerCase();
        if (role !== 'admin' && role !== 'staff') return;
        if (!('Notification' in window) || !('serviceWorker' in navigator)) return;

        let cancelled = false;

        const registerAdminPush = async () => {
            try {
                const supported = await isSupported().catch(() => false);
                if (!supported || cancelled) return;

                let permission = Notification.permission;
                if (permission === 'default' && !window.localStorage.getItem(PUSH_PROMPTED_KEY)) {
                    window.localStorage.setItem(PUSH_PROMPTED_KEY, '1');
                    permission = await Notification.requestPermission();
                }
                if (permission !== 'granted' || cancelled) return;

                const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js').catch(() => null);
                if (!registration || cancelled) return;

                const messaging = getMessaging(firebaseApp);
                const fcmToken = await getToken(messaging, {
                    vapidKey: VAPID_KEY,
                    serviceWorkerRegistration: registration
                }).catch(() => '');

                if (!fcmToken || cancelled) return;

                await authService.registerPushSubscription({
                    fcmToken,
                    platform: 'web',
                    deviceLabel: buildDeviceLabel(),
                    userAgent: navigator.userAgent || '',
                    scope: ['admin:new_orders'],
                    notificationsEnabled: true
                }).catch(() => {});
            } catch {
                // Push setup is best-effort only.
            }
        };

        void registerAdminPush();
        return () => {
            cancelled = true;
        };
    }, [user?.id, user?.role]);
};
