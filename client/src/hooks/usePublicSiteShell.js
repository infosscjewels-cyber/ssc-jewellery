import { useCallback, useEffect, useState } from 'react';
import { productService } from '../services/productService';
import { isCategoryVisibleInStorefront } from '../utils/categoryVisibility';

const CMS_API_URL = import.meta.env.PROD ? '/api/cms' : 'http://localhost:5000/api/cms';
const COMPANY_CACHE_TTL_MS = 10 * 60 * 1000;

const companyListeners = new Set();
const categoryListeners = new Set();

let companyCache = {
    data: null,
    timestamp: 0,
    promise: null
};

let categoryCache = {
    data: null,
    timestamp: 0,
    promise: null
};

const notifyListeners = (listeners, value) => {
    listeners.forEach((listener) => {
        try {
            listener(value);
        } catch {
            // Ignore subscriber failures to avoid breaking sibling listeners.
        }
    });
};

const normalizePublicCategories = (data = []) => (
    (Array.isArray(data) ? data : [])
        .filter((category) => isCategoryVisibleInStorefront(category))
        .sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
);

const readCompanyInfo = async (force = false) => {
    const isFresh = companyCache.data && (Date.now() - companyCache.timestamp < COMPANY_CACHE_TTL_MS);
    if (!force && isFresh) return companyCache.data;
    if (companyCache.promise) return companyCache.promise;

    companyCache.promise = (async () => {
        const res = await fetch(`${CMS_API_URL}/company-info`, {
            cache: 'no-store'
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            throw new Error(data?.message || 'Failed to load company info');
        }
        const payload = data?.company && typeof data.company === 'object' ? data.company : {};
        companyCache = {
            data: payload,
            timestamp: Date.now(),
            promise: null
        };
        notifyListeners(companyListeners, companyCache.data);
        return companyCache.data;
    })().catch((error) => {
        companyCache = { ...companyCache, promise: null };
        throw error;
    });

    return companyCache.promise;
};

const patchCompanyInfo = (payload = {}) => {
    if (!payload || typeof payload !== 'object') return;
    companyCache = {
        data: {
            ...(companyCache.data || {}),
            ...payload
        },
        timestamp: Date.now(),
        promise: null
    };
    notifyListeners(companyListeners, companyCache.data);
};

const readPublicCategories = async (force = false) => {
    const isFresh = categoryCache.data && categoryCache.data.length > 0;
    if (!force && isFresh) return categoryCache.data;
    if (categoryCache.promise) return categoryCache.promise;

    categoryCache.promise = (async () => {
        const data = await productService.getCategoryStats(force);
        const payload = normalizePublicCategories(data);
        categoryCache = {
            data: payload,
            timestamp: Date.now(),
            promise: null
        };
        notifyListeners(categoryListeners, categoryCache.data);
        return categoryCache.data;
    })().catch((error) => {
        categoryCache = { ...categoryCache, promise: null };
        throw error;
    });

    return categoryCache.promise;
};

const patchPublicCategories = (payload = []) => {
    const next = normalizePublicCategories(payload);
    categoryCache = {
        data: next,
        timestamp: Date.now(),
        promise: null
    };
    notifyListeners(categoryListeners, categoryCache.data);
};

export const usePublicCompanyInfo = () => {
    const [companyInfo, setCompanyInfo] = useState(() => companyCache.data || null);

    useEffect(() => {
        let cancelled = false;
        const handleUpdate = (nextCompany) => {
            if (!cancelled) {
                setCompanyInfo(nextCompany || null);
            }
        };
        companyListeners.add(handleUpdate);
        if (companyCache.data) {
            handleUpdate(companyCache.data);
        } else {
            readCompanyInfo().catch(() => {});
        }
        return () => {
            cancelled = true;
            companyListeners.delete(handleUpdate);
        };
    }, []);

    const refreshCompanyInfo = useCallback(async (force = false) => {
        return readCompanyInfo(force);
    }, []);

    const applyCompanyInfo = useCallback((payload = {}) => {
        patchCompanyInfo(payload);
    }, []);

    return {
        companyInfo,
        refreshCompanyInfo,
        applyCompanyInfo
    };
};

export const usePublicCategories = () => {
    const [categories, setCategories] = useState(() => categoryCache.data || []);
    const [isLoadingCategories, setIsLoadingCategories] = useState(() => !categoryCache.data);

    useEffect(() => {
        let cancelled = false;
        const handleUpdate = (nextCategories) => {
            if (!cancelled) {
                setCategories(Array.isArray(nextCategories) ? nextCategories : []);
                setIsLoadingCategories(false);
            }
        };
        categoryListeners.add(handleUpdate);
        if (categoryCache.data) {
            handleUpdate(categoryCache.data);
        } else {
            setIsLoadingCategories(true);
            readPublicCategories().catch(() => {
                if (!cancelled) setIsLoadingCategories(false);
            });
        }
        return () => {
            cancelled = true;
            categoryListeners.delete(handleUpdate);
        };
    }, []);

    const refreshCategories = useCallback(async (force = false) => {
        setIsLoadingCategories(true);
        try {
            return await readPublicCategories(force);
        } finally {
            setIsLoadingCategories(false);
        }
    }, []);

    const applyCategories = useCallback((payload = []) => {
        patchPublicCategories(payload);
    }, []);

    return {
        categories,
        isLoadingCategories,
        refreshCategories,
        applyCategories
    };
};
