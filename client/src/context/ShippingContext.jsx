/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { shippingService } from '../services/shippingService';
import { useSocket } from './SocketContext';

const ShippingContext = createContext(null);
const CACHE_TTL = 5 * 60 * 1000;
const STORAGE_KEY = 'shipping_zones_cache_v1';
const sanitizeZones = (zones = []) => (Array.isArray(zones) ? zones : []).map((zone) => ({
    states: Array.isArray(zone?.states) ? zone.states : [],
    options: Array.isArray(zone?.options)
        ? zone.options.map((option) => ({
            rate: Number(option?.rate || 0),
            conditionType: option?.conditionType || 'price',
            min: option?.min ?? null,
            max: option?.max ?? null
        }))
        : []
}));

export const ShippingProvider = ({ children }) => {
    const { socket } = useSocket();
    const [zones, setZones] = useState([]);
    const [lastFetchedAt, setLastFetchedAt] = useState(0);
    const [loading, setLoading] = useState(false);

    const refreshZones = useCallback(async (force = false) => {
        if (!force && Date.now() - lastFetchedAt < CACHE_TTL && zones.length > 0) return;
        setLoading(true);
        try {
            const data = await shippingService.getZones();
            const next = sanitizeZones(data.zones || []);
            setZones(next);
            const ts = Date.now();
            setLastFetchedAt(ts);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones: next, ts }));
            } catch {
                // ignore storage write failures
            }
        } finally {
            setLoading(false);
        }
    }, [lastFetchedAt, zones.length]);

    useEffect(() => {
        try {
            const cached = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (cached && Array.isArray(cached.zones)) {
                setZones(sanitizeZones(cached.zones));
                setLastFetchedAt(cached.ts || 0);
            }
        } catch {
            // ignore invalid cache payloads
        }
        refreshZones(false);
    }, [refreshZones]);

    useEffect(() => {
        if (!socket) return;
        const handleUpdate = ({ zones: updatedZones }) => {
            if (!Array.isArray(updatedZones)) return;
            const next = sanitizeZones(updatedZones);
            setZones(next);
            const ts = Date.now();
            setLastFetchedAt(ts);
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify({ zones: next, ts }));
            } catch {
                // ignore storage write failures
            }
        };
        socket.on('shipping:update', handleUpdate);
        return () => socket.off('shipping:update', handleUpdate);
    }, [socket]);

    const value = useMemo(() => ({
        zones,
        loading,
        refreshZones
    }), [zones, loading, refreshZones]);

    return (
        <ShippingContext.Provider value={value}>
            {children}
        </ShippingContext.Provider>
    );
};

export const useShipping = () => useContext(ShippingContext);
