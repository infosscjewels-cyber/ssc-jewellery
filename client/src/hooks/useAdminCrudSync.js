import { useEffect, useRef } from 'react';
import { useSocket } from '../context/SocketContext';

export const ADMIN_CRUD_EVENTS = [
    'order:create',
    'order:update',
    'payment:update',
    'product:create',
    'product:update',
    'product:delete',
    'product:category_change',
    'category:autopilot_update',
    'refresh:categories',
    'user:create',
    'user:update',
    'user:delete',
    'company:info_update',
    'tax:config_update',
    'coupon:changed',
    'shipping:update',
    'cms:hero_update',
    'cms:texts_update',
    'cms:banner_update',
    'cms:banner_secondary_update',
    'cms:banner_tertiary_update',
    'cms:featured_category_update',
    'cms:carousel_cards_update',
    'cms:autopilot_update',
    'loyalty:config_update',
    'loyalty:popup_update',
    'abandoned_cart:update',
    'abandoned_cart:journey:update',
    'abandoned_cart:recovered'
];

export const useAdminCrudSync = (eventHandlers = {}) => {
    const { socket } = useSocket();
    const handlersRef = useRef(eventHandlers);

    useEffect(() => {
        handlersRef.current = eventHandlers || {};
    }, [eventHandlers]);

    useEffect(() => {
        if (!socket) return;
        const listeners = ADMIN_CRUD_EVENTS.map((eventName) => {
            const listener = (payload) => {
                const handler = handlersRef.current?.[eventName];
                if (typeof handler === 'function') {
                    handler(payload);
                }
            };
            socket.on(eventName, listener);
            return { eventName, listener };
        });

        return () => {
            listeners.forEach(({ eventName, listener }) => socket.off(eventName, listener));
        };
    }, [socket]);
};
