import { useAuth } from '../context/AuthContext';
import { useCallback } from 'react';
import { dispatchSessionExpired, getAuthHeaders, shouldTreatAsExpiredSession } from '../utils/authSession';
import { fetchWithRetry } from '../utils/fetchRetry';

const API_URL = import.meta.env.PROD 
  ? '/api/cms' 
  : 'http://localhost:5000/api/cms';

export const useCms = () => {
    useAuth();
    const getWithRetry = useCallback((url, options = {}) => fetchWithRetry(url, options), []);

    // Helper to handle Fetch with Auth
    const authFetch = useCallback(async (endpoint, options = {}) => {
        const headers = {
            ...getAuthHeaders({ includeJsonContentType: false }),
            ...(options.headers || {})
        };

        const res = await fetch(`${API_URL}${endpoint}`, { ...options, headers });

        // [NEW] Security Feature: Auto-Logout on 401
        if (shouldTreatAsExpiredSession(res.status, res.statusText)) {
            dispatchSessionExpired("Session expired. Please login again.");
            throw new Error("Session expired. Please login again.");
        }

        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }

        return res.json();
    }, []);

    // 1. Get Slides (Public or Admin)
    const getSlides = useCallback(async (isAdmin = false) => {
        // Public requests don't need the authFetch wrapper if strict, 
        // but using it is fine as public endpoints ignore the header.
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/hero?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        return res.json();
    }, [getWithRetry]);

    // 1.0 Get Hero Texts
    const getHeroTexts = useCallback(async (isAdmin = false) => {
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/hero-texts?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }
        return res.json();
    }, [getWithRetry]);
    // 1.1 Get Home Banner (Public or Admin)
    const getBanner = useCallback(async (isAdmin = false) => {
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/banner?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }
        return res.json();
    }, [getWithRetry]);

    const getSecondaryBanner = useCallback(async (isAdmin = false) => {
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/banner-secondary?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }
        return res.json();
    }, [getWithRetry]);

    const getFeaturedCategory = useCallback(async (isAdmin = false) => {
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/featured-category?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }
        return res.json();
    }, [getWithRetry]);

    const getCarouselCards = useCallback(async (isAdmin = false) => {
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/carousel-cards?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }
        return res.json();
    }, [getWithRetry]);

    const getTertiaryBanner = useCallback(async (isAdmin = false) => {
        const headers = isAdmin ? getAuthHeaders({ includeJsonContentType: false }) : {};
        const res = await getWithRetry(`${API_URL}/banner-tertiary?admin=${isAdmin}`, { headers });
        if (res.status === 401 && isAdmin) {
            dispatchSessionExpired("Session expired");
            throw new Error("Session expired");
        }
        if (!res.ok) {
            const error = await res.json();
            throw new Error(error.message || 'API Error');
        }
        return res.json();
    }, [getWithRetry]);

    const getAutopilotConfig = useCallback(async () => {
        return authFetch('/autopilot');
    }, [authFetch]);

    // 2. Create Slide
    const createSlide = useCallback(async (formData) => {
        // Note: FormData does not need Content-Type header
        return authFetch('/hero', {
            method: 'POST',
            body: formData
        });
    }, [authFetch]);

    // 3. Delete Slide
    const deleteSlide = useCallback(async (id) => {
        return authFetch(`/hero/${id}`, {
            method: 'DELETE'
        });
    }, [authFetch]);

    // 4. Reorder Slides
    const reorderSlides = useCallback(async (slideIds) => {
        return authFetch('/hero/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ slideIds })
        });
    }, [authFetch]);

    // 5. Update Slide
    const updateSlide = useCallback(async (id, data) => {
        return authFetch(`/hero/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    // 6. Update Home Banner (Image + Link)
    const updateBanner = useCallback(async (formData) => {
        return authFetch('/banner', {
            method: 'PUT',
            body: formData
        });
    }, [authFetch]);

    const updateSecondaryBanner = useCallback(async (formData) => {
        return authFetch('/banner-secondary', {
            method: 'PUT',
            body: formData
        });
    }, [authFetch]);

    const updateFeaturedCategory = useCallback(async (data) => {
        return authFetch('/featured-category', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    const createCarouselCard = useCallback(async (data) => {
        return authFetch('/carousel-cards', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    const updateCarouselCard = useCallback(async (id, data) => {
        return authFetch(`/carousel-cards/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    const deleteCarouselCard = useCallback(async (id) => {
        return authFetch(`/carousel-cards/${id}`, {
            method: 'DELETE'
        });
    }, [authFetch]);

    const updateTertiaryBanner = useCallback(async (formData) => {
        return authFetch('/banner-tertiary', {
            method: 'PUT',
            body: formData
        });
    }, [authFetch]);

    const updateAutopilotConfig = useCallback(async (data) => {
        return authFetch('/autopilot', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    // 7. Hero Texts CRUD
    const createHeroText = useCallback(async (data) => {
        return authFetch('/hero-texts', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    const updateHeroText = useCallback(async (id, data) => {
        return authFetch(`/hero-texts/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
    }, [authFetch]);

    const deleteHeroText = useCallback(async (id) => {
        return authFetch(`/hero-texts/${id}`, {
            method: 'DELETE'
        });
    }, [authFetch]);

    const reorderHeroTexts = useCallback(async (textIds) => {
        return authFetch('/hero-texts/reorder', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ textIds })
        });
    }, [authFetch]);

    return { 
        getSlides, getHeroTexts, getBanner, getSecondaryBanner, getTertiaryBanner, getFeaturedCategory, getCarouselCards, getAutopilotConfig,
        createSlide, deleteSlide, reorderSlides, updateSlide,
        updateBanner, updateSecondaryBanner, updateTertiaryBanner, updateFeaturedCategory, createCarouselCard, updateCarouselCard, deleteCarouselCard, updateAutopilotConfig,
        createHeroText, updateHeroText, deleteHeroText, reorderHeroTexts
    };
};
