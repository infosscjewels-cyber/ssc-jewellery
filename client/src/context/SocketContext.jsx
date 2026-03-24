/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { useAuth } from './AuthContext';
import { orderService } from '../services/orderService';
import { productService } from '../services/productService';
import { adminService } from '../services/adminService';
import { useToast } from './ToastContext';
import { dispatchSessionExpired, getStoredToken } from '../utils/authSession';

const SocketContext = createContext(null);
const SOCKET_RETRY_CYCLE_ATTEMPTS = 5;
const SOCKET_RETRY_PAUSE_MS = 60 * 1000;

// Detect URL environment
const SOCKET_URL = import.meta.env.PROD ? '/' : 'http://localhost:5000';

// [FIX] Create the socket instance ONCE outside the component lifecycle.
// This prevents it from being destroyed/recreated during React Strict Mode checks.
const globalSocket = io(SOCKET_URL, {
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: SOCKET_RETRY_CYCLE_ATTEMPTS,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    randomizationFactor: 0.5,
    timeout: 20000,
    autoConnect: false // We will connect manually when the app mounts
});
const ADMIN_PAYMENT_TOAST_DEDUPE_MS = 15000;
const adminPaymentToastSeen = new Map();
const ADMIN_ORDER_TOAST_DEDUPE_MS = 8000;
const adminOrderToastSeen = new Map();
const ADMIN_NEW_ORDER_POPUP_DEDUPE_MS = 10 * 60 * 1000;
const adminNewOrderPopupSeen = new Map();

export const SocketProvider = ({ children }) => {
    const [socket] = useState(globalSocket);
    const { user } = useAuth();
    const toast = useToast();

    useEffect(() => {
        // Connect when the app loads
        if (!globalSocket.connected) {
            globalSocket.connect();
        }

        // Cleanup: We deliberately do NOT disconnect here.
        // The socket will automatically close when the browser tab closes.
        // This prevents the "WebSocket is closed before connection established" error 
        // caused by React unmounting the component too quickly in Dev mode.
        return () => {
             // globalSocket.disconnect(); // Keep this commented out
        };
    }, []);

    useEffect(() => {
        if (!socket) return;
        let retryCycleTimer = null;

        const clearRetryTimer = () => {
            if (retryCycleTimer) {
                window.clearTimeout(retryCycleTimer);
                retryCycleTimer = null;
            }
        };

        const scheduleNextRetryCycle = () => {
            clearRetryTimer();
            retryCycleTimer = window.setTimeout(() => {
                const token = getStoredToken();
                if (!token || socket.connected) return;
                socket.connect();
            }, SOCKET_RETRY_PAUSE_MS);
        };

        const handleConnect = () => clearRetryTimer();
        const handleReconnectFailed = () => scheduleNextRetryCycle();

        socket.on('connect', handleConnect);
        socket.io.on('reconnect_failed', handleReconnectFailed);

        return () => {
            clearRetryTimer();
            socket.off('connect', handleConnect);
            socket.io.off('reconnect_failed', handleReconnectFailed);
        };
    }, [socket]);

    useEffect(() => {
        if (!socket) return;

        const authenticateSocket = () => {
            const token = getStoredToken();
            if (user?.id && token && !socket.connected) {
                socket.connect();
                return;
            }
            if (user?.id && token) {
                socket.emit('auth', { token });
            }
        };

        if (socket.connected) {
            authenticateSocket();
        }

        socket.on('connect', authenticateSocket);
        return () => {
            socket.off('connect', authenticateSocket);
        };
    }, [socket, user]);

    useEffect(() => {
        if (!socket) return;

        const handleSocketAuthError = async (payload = {}) => {
            const token = getStoredToken();
            if (!token) return;

            const message = String(payload?.message || '').trim() || 'Realtime session expired';
            socket.disconnect();
            dispatchSessionExpired(message);
            toast.error(message);
        };

        socket.on('auth:error', handleSocketAuthError);
        return () => {
            socket.off('auth:error', handleSocketAuthError);
        };
    }, [socket, toast]);

    useEffect(() => {
        if (!socket) return;

        const notifyApp = (payload) => {
            if (typeof window === 'undefined') return;
            window.dispatchEvent(new CustomEvent('orders:cache-updated', { detail: payload }));
        };

        const dispatchAdminNewOrderPopup = (order = null) => {
            if (!order || typeof window === 'undefined') return;
            const orderId = String(order?.id || order?.order_id || order?.orderId || '').trim();
            if (!orderId) return;
            const now = Date.now();
            const seenAt = adminNewOrderPopupSeen.get(orderId) || 0;
            if (seenAt && now - seenAt <= ADMIN_NEW_ORDER_POPUP_DEDUPE_MS) return;
            adminNewOrderPopupSeen.set(orderId, now);
            if (adminNewOrderPopupSeen.size > 400) {
                const cutoff = now - ADMIN_NEW_ORDER_POPUP_DEDUPE_MS;
                for (const [key, ts] of adminNewOrderPopupSeen.entries()) {
                    if (ts < cutoff) adminNewOrderPopupSeen.delete(key);
                }
            }
            window.dispatchEvent(new CustomEvent('admin:new-order', { detail: { ...order, id: orderId } }));
        };

        const shouldTreatAsFreshOrder = (order = null, fallbackStatus = '') => {
            if (!order || typeof order !== 'object') return false;
            const status = String(order?.status || fallbackStatus || '').toLowerCase();
            if (!['confirmed', 'created', 'pending'].includes(status)) return false;
            const ts = new Date(order?.created_at || order?.createdAt || 0).getTime();
            if (!Number.isFinite(ts) || ts <= 0) return false;
            return (Date.now() - ts) <= 10 * 60 * 1000;
        };

        const handleOrderUpdate = (payload = {}) => {
            if (payload?.order) {
                orderService.patchMyOrdersCache(payload.order);
            } else if (payload?.deleted || String(payload?.status || '').toLowerCase() === 'deleted') {
                orderService.removeMyOrderFromCache(payload?.orderId);
                if (user && (user.role === 'admin' || user.role === 'staff') && shouldTreatAsFreshOrder(payload.order, payload?.status)) {
                    dispatchAdminNewOrderPopup(payload.order);
                }
            }
            if (!payload?.silent && user && (user.role === 'admin' || user.role === 'staff')) {
                const orderRef = payload?.order?.order_ref || payload?.order?.orderRef || `#${payload?.order?.id || payload?.orderId || ''}`;
                const status = String(payload?.status || payload?.order?.status || '').toLowerCase();
                if (status) {
                    const key = `${payload?.orderId || payload?.order?.id || ''}::${status}`;
                    const now = Date.now();
                    const seenAt = adminOrderToastSeen.get(key) || 0;
                    if (!seenAt || now - seenAt > ADMIN_ORDER_TOAST_DEDUPE_MS) {
                        if (payload?.deleted || status === 'deleted') {
                            toast.warning(`Order removed: ${orderRef}`);
                        } else {
                            toast.info(`Order ${status}: ${orderRef}`);
                        }
                        adminOrderToastSeen.set(key, now);
                    }
                }
            }
            orderService.clearAdminListCache();
            notifyApp(payload);
        };

        const handleOrderCreate = async (payload = {}) => {
            let finalOrder = payload?.order || null;
            if (finalOrder) {
                orderService.patchMyOrdersCache(finalOrder);
            }
            if (user && (user.role === 'admin' || user.role === 'staff')) {
                const orderId = finalOrder?.id || payload?.orderId || null;
                if (orderId) {
                    try {
                        const detail = await orderService.getAdminOrder(orderId);
                        if (detail?.order) {
                            finalOrder = detail.order;
                        }
                    } catch {
                        // fallback to socket payload
                    }
                }
                const orderRef = finalOrder?.order_ref || finalOrder?.orderRef || `#${finalOrder?.id || orderId || ''}`;
                toast.success(`New order received: ${orderRef}`);
                const normalizedOrderForPopup = finalOrder || {
                    id: orderId || payload?.order_id || null,
                    order_ref: payload?.order_ref || payload?.orderRef || null,
                    customer_name: payload?.customer_name || payload?.customerName || null,
                    customer_mobile: payload?.customer_mobile || payload?.customerMobile || null,
                    total: payload?.total || 0,
                    payment_status: payload?.payment_status || payload?.paymentStatus || 'pending'
                };
                dispatchAdminNewOrderPopup(normalizedOrderForPopup);
            }
            orderService.clearAdminListCache();
            notifyApp({ ...payload, order: finalOrder || payload?.order || null });
        };

        const handlePaymentUpdate = (payload = {}) => {
            if (payload?.order) {
                orderService.patchMyOrdersCache(payload.order);
            }
            if (!payload?.silent && user && (user.role === 'admin' || user.role === 'staff')) {
                const orderRef = payload?.order?.order_ref || payload?.order?.orderRef || `#${payload?.order?.id || ''}`;
                const paymentStatus = payload?.payment?.paymentStatus;
                const settlementStatus = payload?.payment?.settlementStatus
                    || payload?.settlement?.status
                    || payload?.order?.settlement_snapshot?.status
                    || null;
                const settlementId = payload?.payment?.settlementId
                    || payload?.settlementId
                    || payload?.settlement?.id
                    || payload?.order?.settlement_id
                    || null;
                const status = String(paymentStatus || settlementStatus || '').toLowerCase();
                const orderId = String(payload?.order?.id || payload?.orderId || settlementId || '');
                const key = `${orderId}::${status || payload?.eventType || payload?.payment?.event || 'payment_update'}`;
                const now = Date.now();
                const seenAt = adminPaymentToastSeen.get(key) || 0;
                if (!seenAt || now - seenAt > ADMIN_PAYMENT_TOAST_DEDUPE_MS) {
                    if (paymentStatus) {
                        const lower = String(paymentStatus).toLowerCase();
                        if (['failed', 'expired'].includes(lower)) {
                            toast.warning(`Payment ${paymentStatus}: ${orderRef}`);
                        } else if (lower === 'refunded') {
                            toast.info(`Refund update: ${orderRef}`);
                        } else {
                            toast.success(`Payment ${paymentStatus}: ${orderRef}`);
                        }
                    }

                    if (settlementStatus) {
                        const label = settlementId ? `${settlementStatus} (${settlementId})` : settlementStatus;
                        if (String(settlementStatus).toLowerCase() === 'failed') {
                            toast.warning(`Settlement ${label}`);
                        } else {
                            toast.info(`Settlement ${label}`);
                        }
                    }

                    if (payload?.payment?.refundReference || payload?.order?.refund_reference) {
                        toast.info(`Refund reference updated: ${orderRef}`);
                    }
                    adminPaymentToastSeen.set(key, now);
                }
                if (adminPaymentToastSeen.size > 300) {
                    const cutoff = now - ADMIN_PAYMENT_TOAST_DEDUPE_MS;
                    for (const [k, ts] of adminPaymentToastSeen.entries()) {
                        if (ts < cutoff) adminPaymentToastSeen.delete(k);
                    }
                }
            }
            orderService.clearAdminListCache();
            notifyApp(payload);
        };

        socket.on('order:update', handleOrderUpdate);
        socket.on('order:create', handleOrderCreate);
        socket.on('payment:update', handlePaymentUpdate);
        return () => {
            socket.off('order:update', handleOrderUpdate);
            socket.off('order:create', handleOrderCreate);
            socket.off('payment:update', handlePaymentUpdate);
        };
    }, [socket, toast, user]);

    useEffect(() => {
        if (!socket) return;

        const handleProductCreate = () => {
            productService.clearProductsCache();
            productService.invalidateCategoryStatsCache();
            productService.invalidateCategoryListCache();
        };

        const handleProductUpdate = (product = {}) => {
            productService.patchProductInProductsCache(product);
            const categories = Array.isArray(product?.categories) ? product.categories : [];
            categories.forEach((categoryName) => {
                productService.clearProductsCache({ category: categoryName });
            });
            if (!categories.length) {
                productService.clearProductsCache();
            }
        };

        const handleProductDelete = (payload = {}) => {
            productService.removeProductFromProductsCache(payload?.id);
            productService.invalidateCategoryStatsCache();
            productService.clearProductsCache();
        };

        const handleCategoryRefresh = (payload = {}) => {
            productService.invalidateCategoryStatsCache();
            productService.invalidateCategoryListCache();
            const categoryName = payload?.categoryName || payload?.category?.name;
            if (payload?.action === 'reorder' || payload?.action === 'sync_all') {
                productService.clearProductsCache();
            } else if (categoryName) {
                productService.clearProductsCache({ category: categoryName });
            } else {
                productService.clearProductsCache();
            }
        };

        const handleProductCategoryChange = (payload = {}) => {
            const product = payload?.product;
            if (product) {
                productService.patchProductInProductsCache(product);
                const categories = Array.isArray(product?.categories) ? product.categories : [];
                categories.forEach((categoryName) => {
                    productService.clearProductsCache({ category: categoryName });
                });
            }
            if (payload?.categoryName) {
                productService.clearProductsCache({ category: payload.categoryName });
            } else {
                productService.clearProductsCache();
            }
            productService.invalidateCategoryStatsCache();
            productService.invalidateCategoryListCache();
        };

        const handleAdminCrud = () => {
            adminService.clearCache();
        };

        const handleUserUpdate = (updatedUser = {}) => {
            handleAdminCrud();
            if (typeof window === 'undefined' || !updatedUser?.id || !user?.id) return;
            if (String(updatedUser.id) !== String(user.id)) return;
            window.dispatchEvent(new CustomEvent('auth:user-updated', { detail: updatedUser }));
        };

        const handleUserDelete = (payload = {}) => {
            handleAdminCrud();
            if (typeof window === 'undefined' || !payload?.id || !user?.id) return;
            if (String(payload.id) !== String(user.id)) return;
            window.dispatchEvent(new CustomEvent('auth:user-deleted', { detail: payload }));
        };

        socket.on('product:create', handleProductCreate);
        socket.on('product:update', handleProductUpdate);
        socket.on('product:delete', handleProductDelete);
        socket.on('product:category_change', handleProductCategoryChange);
        socket.on('refresh:categories', handleCategoryRefresh);
        socket.on('user:create', handleAdminCrud);
        socket.on('user:update', handleUserUpdate);
        socket.on('user:delete', handleUserDelete);
        socket.on('company:info_update', handleAdminCrud);
        socket.on('tax:config_update', handleAdminCrud);
        socket.on('coupon:changed', handleAdminCrud);
        socket.on('shipping:update', handleAdminCrud);
        socket.on('cms:hero_update', handleAdminCrud);
        socket.on('cms:texts_update', handleAdminCrud);
        socket.on('cms:banner_update', handleAdminCrud);
        socket.on('cms:banner_secondary_update', handleAdminCrud);
        socket.on('cms:banner_tertiary_update', handleAdminCrud);
        socket.on('cms:featured_category_update', handleAdminCrud);
        socket.on('cms:carousel_cards_update', handleAdminCrud);
        socket.on('cms:autopilot_update', handleAdminCrud);
        socket.on('loyalty:popup_update', handleAdminCrud);

        return () => {
            socket.off('product:create', handleProductCreate);
            socket.off('product:update', handleProductUpdate);
            socket.off('product:delete', handleProductDelete);
            socket.off('product:category_change', handleProductCategoryChange);
            socket.off('refresh:categories', handleCategoryRefresh);
            socket.off('user:create', handleAdminCrud);
            socket.off('user:update', handleUserUpdate);
            socket.off('user:delete', handleUserDelete);
            socket.off('company:info_update', handleAdminCrud);
            socket.off('tax:config_update', handleAdminCrud);
            socket.off('coupon:changed', handleAdminCrud);
            socket.off('shipping:update', handleAdminCrud);
            socket.off('cms:hero_update', handleAdminCrud);
            socket.off('cms:texts_update', handleAdminCrud);
            socket.off('cms:banner_update', handleAdminCrud);
            socket.off('cms:banner_secondary_update', handleAdminCrud);
            socket.off('cms:banner_tertiary_update', handleAdminCrud);
            socket.off('cms:featured_category_update', handleAdminCrud);
            socket.off('cms:carousel_cards_update', handleAdminCrud);
            socket.off('cms:autopilot_update', handleAdminCrud);
            socket.off('loyalty:popup_update', handleAdminCrud);
        };
    }, [socket, user]);

    return (
        <SocketContext.Provider value={{ socket }}>
            {children}
        </SocketContext.Provider>
    );
};

export const useSocket = () => useContext(SocketContext);
