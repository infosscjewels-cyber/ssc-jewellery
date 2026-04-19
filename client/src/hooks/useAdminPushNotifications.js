import { useEffect } from 'react';
import { getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { firebaseApp } from '../firebase';
import { authService } from '../services/authService';

const ENABLE_PUSH = String(import.meta.env.VITE_ENABLE_PUSH_NOTIFICATIONS ?? 'true').trim().toLowerCase() !== 'false';
const ENABLE_ADMIN_PUSH = String(import.meta.env.VITE_ENABLE_ADMIN_PUSH_NOTIFICATIONS ?? 'true').trim().toLowerCase() !== 'false';
const VAPID_KEY = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || '').trim();
const PUSH_PROMPTED_KEY = 'admin_push_notifications_prompted_v1';
const PUSH_SW_URL = '/firebase-messaging-sw.js';
const PUSH_SW_SCOPE = '/firebase-push-scope/';
const DEFAULT_ADMIN_LINK = '/admin/dashboard';

const buildDeviceLabel = () => {
    if (typeof navigator === 'undefined') return 'Admin Browser';
    const platform = String(navigator.platform || '').trim();
    return platform ? `Admin Browser (${platform})` : 'Admin Browser';
};

const normalizeForegroundNotification = (payload = {}) => {
    const notification = payload?.notification || {};
    const webpush = payload?.webpush?.notification || {};
    const data = payload?.data || {};
    return {
        title: notification.title || webpush.title || 'SSC Jewels',
        options: {
            body: notification.body || webpush.body || '',
            icon: webpush.icon || '/logo.webp',
            badge: webpush.badge || '/logo.webp',
            tag: webpush.tag || data.tag || undefined,
            data: {
                link: data.link || data.url || DEFAULT_ADMIN_LINK
            }
        }
    };
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
        let unsubscribeOnMessage = null;

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

                const registration = await navigator.serviceWorker.register(PUSH_SW_URL, {
                    scope: PUSH_SW_SCOPE
                }).catch(() => null);
                if (!registration || cancelled) return;

                const messaging = getMessaging(firebaseApp);
                unsubscribeOnMessage = onMessage(messaging, async (payload) => {
                    if (cancelled || Notification.permission !== 'granted') return;

                    const { title, options } = normalizeForegroundNotification(payload);
                    try {
                        await registration.showNotification(title, options);
                    } catch {
                        const notification = new Notification(title, options);
                        notification.onclick = () => {
                            const target = String(options?.data?.link || DEFAULT_ADMIN_LINK).trim() || DEFAULT_ADMIN_LINK;
                            window.focus();
                            window.location.assign(target);
                        };
                    }
                });

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
            if (typeof unsubscribeOnMessage === 'function') {
                unsubscribeOnMessage();
            }
        };
    }, [user?.id, user?.role]);
};
