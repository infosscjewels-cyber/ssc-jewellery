/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { productService } from '../services/productService';
import { useAuth } from './AuthContext';
import { useSocket } from './SocketContext';

const ProductContext = createContext(null);

const CACHE_KEY = 'admin_all_products_cache_v1';
const CACHE_STALE_MS = 5 * 60 * 1000; // 5 minutes
const PAGE_LIMIT = 200;
const PREFETCH_BATCH_SIZE = 2;

const readCache = () => {
    try {
        const raw = localStorage.getItem(CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.products)) return null;
        return parsed;
    } catch {
        return null;
    }
};

const writeCache = (products) => {
    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ products, timestamp: Date.now() }));
    } catch {
        // Ignore storage failures (quota, private mode, etc.)
    }
};

export const ProductProvider = ({ children }) => {
    const { user } = useAuth();
    const { socket } = useSocket();
    const isAdmin = !!user && (user.role === 'admin' || user.role === 'staff');

    const [allProducts, setAllProducts] = useState([]);
    const [status, setStatus] = useState('idle'); // idle | loading | ready | error
    const [progress, setProgress] = useState(0);
    const [lastFetchedAt, setLastFetchedAt] = useState(null);
    const [error, setError] = useState(null);
    const [hasLoadedAll, setHasLoadedAll] = useState(false);

    const inFlightRef = useRef(null);
    const allProductsRef = useRef([]);
    const backgroundPrefetchRef = useRef(null);

    useEffect(() => {
        allProductsRef.current = allProducts;
    }, [allProducts]);

    const hydrateFromCache = useCallback(() => {
        const cached = readCache();
        if (cached && cached.products.length > 0) {
            setAllProducts(cached.products);
            setLastFetchedAt(cached.timestamp);
            setHasLoadedAll(true);
        }
        return cached;
    }, []);

    const fetchAllProducts = useCallback(async ({ force = false } = {}) => {
        if (!isAdmin) return [];

        const cached = readCache();
        const isFresh = cached && (Date.now() - cached.timestamp < CACHE_STALE_MS);
        if (!force && isFresh) {
            if (allProductsRef.current.length === 0) {
                setAllProducts(cached.products);
                setLastFetchedAt(cached.timestamp);
            }
            setStatus('ready');
            setProgress(100);
            setHasLoadedAll(true);
            return cached.products;
        }

        if (inFlightRef.current) return inFlightRef.current;

        setStatus('loading');
        setProgress(0);
        setError(null);
        setHasLoadedAll(false);

        const task = (async () => {
            try {
                if (backgroundPrefetchRef.current) {
                    clearTimeout(backgroundPrefetchRef.current);
                    backgroundPrefetchRef.current = null;
                }

                const first = await productService.getProducts(1, 'all', 'all', 'newest', PAGE_LIMIT, null, '', '', { forceRefresh: force });
                const totalPages = Math.max(1, Number(first.totalPages || 1));
                let combined = Array.isArray(first.products) ? [...first.products] : [];
                const firstProgress = totalPages <= 1 ? 100 : Math.max(10, Math.round((1 / totalPages) * 100));
                setAllProducts(combined);
                setLastFetchedAt(Date.now());
                setProgress(firstProgress);

                for (let startPage = 2; startPage <= totalPages; startPage += PREFETCH_BATCH_SIZE) {
                    const pageNumbers = [];
                    for (let page = startPage; page < startPage + PREFETCH_BATCH_SIZE && page <= totalPages; page += 1) {
                        pageNumbers.push(page);
                    }
                    const batch = await Promise.all(
                        pageNumbers.map((pageNo) => productService.getProducts(pageNo, 'all', 'all', 'newest', PAGE_LIMIT, null, '', '', { forceRefresh: force }))
                    );
                    batch.forEach((res) => {
                        if (Array.isArray(res?.products)) {
                            combined = combined.concat(res.products);
                        }
                    });
                    setAllProducts([...combined]);
                    setLastFetchedAt(Date.now());
                    setProgress(Math.round((Math.min(totalPages, startPage + PREFETCH_BATCH_SIZE - 1) / totalPages) * 100));
                }

                setAllProducts(combined);
                setLastFetchedAt(Date.now());
                writeCache(combined);
                setStatus('ready');
                setHasLoadedAll(true);
                return combined;
            } catch (err) {
                setStatus('error');
                setError(err);
                return allProductsRef.current;
            } finally {
                inFlightRef.current = null;
            }
        })();

        inFlightRef.current = task;
        return task;
    }, [isAdmin]);

    const ensureAllProducts = useCallback(async () => {
        return fetchAllProducts({ force: false });
    }, [fetchAllProducts]);

    const refreshAllProducts = useCallback(async () => {
        return fetchAllProducts({ force: true });
    }, [fetchAllProducts]);

    useEffect(() => {
        if (!isAdmin) return;
        const cached = hydrateFromCache();
        const isStale = !cached || (Date.now() - cached.timestamp >= CACHE_STALE_MS);
        if (isStale) {
            backgroundPrefetchRef.current = setTimeout(() => {
                ensureAllProducts();
            }, 0);
        }
        return () => {
            if (backgroundPrefetchRef.current) {
                clearTimeout(backgroundPrefetchRef.current);
                backgroundPrefetchRef.current = null;
            }
        };
    }, [ensureAllProducts, hydrateFromCache, isAdmin]);

    useEffect(() => {
        if (!socket || !isAdmin) return;

        const persistNext = (updater) => {
            setAllProducts((prev) => {
                const next = typeof updater === 'function' ? updater(prev) : updater;
                setLastFetchedAt(Date.now());
                writeCache(next);
                return next;
            });
        };

        const handleProductCreate = (product = {}) => {
            if (!product?.id) return;
            persistNext((prev) => {
                const exists = prev.some((item) => String(item.id) === String(product.id));
                if (exists) return prev.map((item) => (String(item.id) === String(product.id) ? { ...item, ...product } : item));
                return [product, ...prev];
            });
        };

        const handleProductUpdate = (product = {}) => {
            if (!product?.id) return;
            persistNext((prev) => {
                const exists = prev.some((item) => String(item.id) === String(product.id));
                if (!exists) return [product, ...prev];
                return prev.map((item) => (String(item.id) === String(product.id) ? { ...item, ...product } : item));
            });
        };

        const handleProductDelete = ({ id } = {}) => {
            if (!id) return;
            persistNext((prev) => prev.filter((item) => String(item.id) !== String(id)));
        };

        const handleCategoryChange = (payload = {}) => {
            if (payload?.product?.id) {
                handleProductUpdate(payload.product);
            }
        };

        socket.on('product:create', handleProductCreate);
        socket.on('product:update', handleProductUpdate);
        socket.on('product:delete', handleProductDelete);
        socket.on('product:category_change', handleCategoryChange);

        return () => {
            socket.off('product:create', handleProductCreate);
            socket.off('product:update', handleProductUpdate);
            socket.off('product:delete', handleProductDelete);
            socket.off('product:category_change', handleCategoryChange);
        };
    }, [socket, isAdmin]);

    const value = useMemo(() => ({
        allProducts,
        status,
        progress,
        lastFetchedAt,
        error,
        isDownloading: status === 'loading',
        hasLoadedAll,
        ensureAllProducts,
        refreshAllProducts,
        setAllProducts,
    }), [allProducts, status, progress, lastFetchedAt, error, hasLoadedAll, ensureAllProducts, refreshAllProducts]);

    return (
        <ProductContext.Provider value={value}>
            {children}
        </ProductContext.Provider>
    );
};

export const useProducts = () => useContext(ProductContext);
