import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { productService } from '../services/productService';
import ProductCard from '../components/ProductCard';
import EmptyState from '../components/EmptyState';
import { ChevronDown, ChevronLeft, ChevronRight, Loader2, Filter, Share2, Facebook, Twitter, Send, Copy, ArrowUp, Home, LayoutGrid } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { useCms } from '../hooks/useCms';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { isDiscoveryItemInStock, shouldRunDiscoverySearch } from '../utils/shopDiscovery';
import { buildShopSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';
import { isCategoryVisibleInStorefront } from '../utils/categoryVisibility';
import { buildWhatsAppShareLink } from '../utils/publicContact';
import { useToast } from '../context/ToastContext';
import emptyIllustration from '../assets/closed.svg';
import WhatsAppIcon from '../components/WhatsAppIcon';

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 60;
const SHOP_LOAD_FAILURE_TOAST_COOLDOWN_MS = 60 * 1000;

const PROMO_TITLE_FONTS = [
    '"Impact", "Arial Black", sans-serif',
    '"Playfair Display", Georgia, serif',
    '"Trebuchet MS", "Segoe UI", sans-serif',
    '"Palatino Linotype", "Book Antiqua", serif',
    '"Franklin Gothic Medium", "Arial Narrow", sans-serif'
];

const stableHash = (value) => {
    const input = String(value || '');
    let hash = 0;
    for (let i = 0; i < input.length; i += 1) {
        hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
};

const getPromoTitleFont = (value) => PROMO_TITLE_FONTS[stableHash(value) % PROMO_TITLE_FONTS.length];
const isExternalLink = (url) => /^https?:\/\//i.test(url || '');

const mergeUniqueProducts = (base = [], incoming = []) => {
    const map = new Map();
    [...base, ...incoming].forEach((item) => {
        if (!item || item.id == null) return;
        map.set(String(item.id), item);
    });
    return Array.from(map.values());
};

export default function Shop() {
    const [searchParams] = useSearchParams();
    const { getCarouselCards } = useCms();
    const { companyInfo } = usePublicCompanyInfo();
    const toast = useToast();
    const [categories, setCategories] = useState([]);
    const [selectedCategory, setSelectedCategory] = useState('all');
    const [selectedUsageAudience, setSelectedUsageAudience] = useState(() => String(searchParams.get('usageAudience') || '').trim().toLowerCase());
    const [products, setProducts] = useState([]);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [isLoading, setIsLoading] = useState(true);
    const [sortBy, setSortBy] = useState('default');
    const [jumbotronImage, setJumbotronImage] = useState('/placeholder_banner.jpg');
    const loadingRef = useRef(false);
    const productsRef = useRef([]);
    const sentinelRef = useRef(null);
    const [showFilters, setShowFilters] = useState(false);
    const [inStockOnly, setInStockOnly] = useState(false);
    const [priceRange, setPriceRange] = useState({ min: '', max: '' });
    const [searchTerm, setSearchTerm] = useState(() => String(searchParams.get('q') || '').trim());
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const shareRef = useRef(null);
    const [showTopBtn, setShowTopBtn] = useState(false);
    const [isCategoryOpen, setIsCategoryOpen] = useState(false);
    const [bottomCarouselCards, setBottomCarouselCards] = useState([]);
    const [isLoadingBottomCarousel, setIsLoadingBottomCarousel] = useState(true);
    const [activeBottomCarouselIndex, setActiveBottomCarouselIndex] = useState(0);
    const categoryDropdownRef = useRef(null);
    const bottomCarouselTrackRef = useRef(null);
    const bottomCarouselAutoIndexRef = useRef(0);
    const loadedPagesRef = useRef(new Set());
    const searchAbortRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const requestKeyRef = useRef('');
    const manualRefreshTimerRef = useRef(null);
    const usageScrollRestoreRef = useRef(null);
    const shopLoadFailureToastCooldownRef = useRef(0);
    const seoConfig = useMemo(() => buildShopSeo({
        categories,
        products,
        selectedCategory
    }), [categories, products, selectedCategory]);
    useSeo(seoConfig);

    const usageAudienceEnabled = companyInfo?.usageAudienceEnabled === true;
    const usageAudienceOptions = useMemo(() => {
        if (!usageAudienceEnabled) return [];
        return [
            { value: '', label: 'All Audiences', imageUrl: '' },
            { value: 'men', label: 'Men', imageUrl: companyInfo?.usageAudienceMenImageUrl || '' },
            { value: 'women', label: 'Women', imageUrl: companyInfo?.usageAudienceWomenImageUrl || '' },
            { value: 'kids', label: 'Kids', imageUrl: companyInfo?.usageAudienceKidsImageUrl || '' }
        ];
    }, [companyInfo?.usageAudienceKidsImageUrl, companyInfo?.usageAudienceMenImageUrl, companyInfo?.usageAudienceWomenImageUrl, usageAudienceEnabled]);
    const showAudienceCategoryBrowse = usageAudienceEnabled && Boolean(selectedUsageAudience) && selectedCategory === 'all';

    useEffect(() => {
        if (!usageAudienceEnabled && selectedUsageAudience) {
            setSelectedUsageAudience('');
        }
    }, [selectedUsageAudience, usageAudienceEnabled]);

    useEffect(() => {
        const nextQuery = String(searchParams.get('q') || '').trim();
        setSearchTerm((current) => (current === nextQuery ? current : nextQuery));
        const nextUsageAudience = String(searchParams.get('usageAudience') || '').trim().toLowerCase();
        setSelectedUsageAudience((current) => (current === nextUsageAudience ? current : nextUsageAudience));
    }, [searchParams]);

    const normalizeCategoryList = useCallback((value) => {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                const parsed = JSON.parse(value);
                return Array.isArray(parsed) ? parsed : [];
            } catch {
                return [];
            }
        }
        return [];
    }, []);

    const loadCategories = useCallback(async (force = false) => {
        try {
            const data = await productService.getCategoryStats(force, {
                usageAudience: showAudienceCategoryBrowse ? selectedUsageAudience : ''
            });
            const list = Array.isArray(data) ? data : [];
            setCategories(list);
            const best = list.find(c => c.name?.toLowerCase() === 'best sellers');
            if (best?.image_url) setJumbotronImage(best.image_url);
        } catch (err) {
            console.error('Failed to load categories', err);
        }
    }, [selectedUsageAudience, showAudienceCategoryBrowse]);

    const fetchBottomCarouselCards = useCallback(async () => {
        try {
            const data = await getCarouselCards(false);
            setBottomCarouselCards(Array.isArray(data) ? data : []);
            setActiveBottomCarouselIndex(0);
            bottomCarouselAutoIndexRef.current = 0;
        } catch {
            setBottomCarouselCards([]);
        } finally {
            setIsLoadingBottomCarousel(false);
        }
    }, [getCarouselCards]);

    const shareUrl = window.location.href;
    const shareText = `I found this category in SSC Impo jewellery website - ${shareUrl}`;
    const encodedUrl = encodeURIComponent(shareUrl);
    const encodedText = encodeURIComponent(shareText);
    const shareLinks = {
        whatsapp: buildWhatsAppShareLink({ text: shareText }),
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}`,
        twitter: `https://twitter.com/intent/tweet?text=${encodedText}&url=${encodedUrl}`,
        telegram: `https://t.me/share/url?url=${encodedUrl}&text=${encodedText}`
    };

    const handleCopyLink = async () => {
        try {
            await navigator.clipboard.writeText(shareUrl);
        } catch (err) {
            console.error("Copy failed", err);
        }
    };

    const handleShareClick = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: `SSC Impo Jewellery`,
                    text: shareText,
                    url: shareUrl
                });
                return;
            } catch {
                // fall back to panel
            }
        }
        setIsShareOpen((prev) => !prev);
    };

    const updateActiveBottomCard = useCallback(() => {
        const track = bottomCarouselTrackRef.current;
        if (!track) return;
        const cards = Array.from(track.querySelectorAll('[data-bottom-carousel-card="true"]'));
        if (cards.length === 0) {
            setActiveBottomCarouselIndex(0);
            return;
        }
        const center = track.scrollLeft + track.clientWidth / 2;
        let closestIndex = 0;
        let minDistance = Number.POSITIVE_INFINITY;
        cards.forEach((card, index) => {
            const cardCenter = card.offsetLeft + card.clientWidth / 2;
            const distance = Math.abs(center - cardCenter);
            if (distance < minDistance) {
                minDistance = distance;
                closestIndex = index;
            }
        });
        setActiveBottomCarouselIndex(closestIndex);
    }, []);

    const scrollBottomCarouselTo = useCallback((nextIndex) => {
        const track = bottomCarouselTrackRef.current;
        if (!track) return;
        const cards = Array.from(track.querySelectorAll('[data-bottom-carousel-card="true"]'));
        if (!cards[nextIndex]) return;
        track.scrollTo({
            left: cards[nextIndex].offsetLeft,
            behavior: 'smooth'
        });
    }, []);

    useEffect(() => {
        if (!isShareOpen) return;
        const handleClickOutside = (event) => {
            if (shareRef.current && !shareRef.current.contains(event.target)) {
                setIsShareOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isShareOpen]);

    useEffect(() => {
        updateActiveBottomCard();
    }, [bottomCarouselCards, updateActiveBottomCard]);

    useEffect(() => {
        bottomCarouselAutoIndexRef.current = activeBottomCarouselIndex;
    }, [activeBottomCarouselIndex]);

    useEffect(() => {
        const track = bottomCarouselTrackRef.current;
        if (!track) return;
        const handleScroll = () => updateActiveBottomCard();
        track.addEventListener('scroll', handleScroll, { passive: true });
        window.addEventListener('resize', handleScroll);
        return () => {
            track.removeEventListener('scroll', handleScroll);
            window.removeEventListener('resize', handleScroll);
        };
    }, [bottomCarouselCards, updateActiveBottomCard]);

    useEffect(() => {
        if (bottomCarouselCards.length <= 1) return;
        const interval = setInterval(() => {
            const next = (bottomCarouselAutoIndexRef.current + 1) % bottomCarouselCards.length;
            bottomCarouselAutoIndexRef.current = next;
            scrollBottomCarouselTo(next);
        }, 3000);
        return () => clearInterval(interval);
    }, [bottomCarouselCards.length, scrollBottomCarouselTo]);

    useEffect(() => {
        if (!isCategoryOpen) return;
        const handleClickOutside = (event) => {
            if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target)) {
                setIsCategoryOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isCategoryOpen]);

    useEffect(() => {
        const trimmedQuery = String(searchTerm || '').trim();
        const nextParams = new URLSearchParams(window.location.search);
        if (trimmedQuery) nextParams.set('q', trimmedQuery);
        else nextParams.delete('q');
        if (selectedUsageAudience) nextParams.set('usageAudience', selectedUsageAudience);
        else nextParams.delete('usageAudience');
        const currentSerialized = window.location.search.replace(/^\?/, '');
        const nextSerialized = nextParams.toString();
        if (currentSerialized !== nextSerialized) {
            const nextUrl = `${window.location.pathname}${nextSerialized ? `?${nextSerialized}` : ''}${window.location.hash || ''}`;
            window.history.replaceState(window.history.state, '', nextUrl);
        }
    }, [searchTerm, selectedUsageAudience]);

    useEffect(() => {
        const toggleVisibility = () => {
            if (window.scrollY > 300) {
                setShowTopBtn(true);
            } else {
                setShowTopBtn(false);
            }
        };
        window.addEventListener('scroll', toggleVisibility);
        return () => window.removeEventListener('scroll', toggleVisibility);
    }, []);

    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const preserveScrollDuringUsageFilter = useCallback((nextValue) => {
        const nextAudience = String(nextValue || '').trim().toLowerCase();
        const currentY = window.scrollY;
        setShowFilters(true);
        setSelectedUsageAudience(nextAudience);
        if (usageScrollRestoreRef.current) {
            window.cancelAnimationFrame(usageScrollRestoreRef.current);
            usageScrollRestoreRef.current = null;
        }
        usageScrollRestoreRef.current = window.requestAnimationFrame(() => {
            usageScrollRestoreRef.current = window.requestAnimationFrame(() => {
                window.scrollTo({ top: currentY, left: window.scrollX, behavior: 'auto' });
                usageScrollRestoreRef.current = null;
            });
        });
    }, []);

    useEffect(() => {
        if (selectedUsageAudience) {
            setShowFilters(true);
        }
    }, [selectedUsageAudience]);

    const fetchProducts = useCallback(async (
        currentPage,
        { append = false, skipLoading = false, force = false } = {}
    ) => {
        if (showAudienceCategoryBrowse) {
            setProducts([]);
            setHasMore(false);
            if (!append && !skipLoading) setIsLoading(false);
            return [];
        }
        if (loadingRef.current && !force) return [];
        loadingRef.current = true;
        if (!append && !skipLoading) setIsLoading(true);

        const requestKey = `${selectedCategory}::${selectedUsageAudience}::${sortBy}`;
        requestKeyRef.current = requestKey;
        try {
            const categoryParam = selectedCategory === 'all' ? 'all' : selectedCategory;
            const serverSort = sortBy === 'default'
                ? (categoryParam === 'all' ? 'newest' : 'manual')
                : sortBy;
            const data = await productService.getProducts(currentPage, categoryParam, 'active', serverSort, PAGE_LIMIT, null, selectedUsageAudience);
            if (requestKeyRef.current !== requestKey) return [];

            const newItems = Array.isArray(data?.products) ? data.products : [];
            loadedPagesRef.current.add(currentPage);
            if (append) {
                setProducts(prev => mergeUniqueProducts(prev, newItems));
            } else {
                setProducts(mergeUniqueProducts([], newItems));
            }
            setPage((prev) => Math.max(prev, currentPage));
            setHasMore(newItems.length >= PAGE_LIMIT);
            return newItems;
        } catch (err) {
            console.error('Failed to load products', err);
            const now = Date.now();
            if (now >= Number(shopLoadFailureToastCooldownRef.current || 0)) {
                shopLoadFailureToastCooldownRef.current = now + SHOP_LOAD_FAILURE_TOAST_COOLDOWN_MS;
                toast.error('Failed to load products');
            }
            return [];
        } finally {
            loadingRef.current = false;
            if (!skipLoading) setIsLoading(false);
        }
    }, [selectedCategory, selectedUsageAudience, showAudienceCategoryBrowse, sortBy, toast]);

    useEffect(() => {
        loadCategories();
        fetchBottomCarouselCards();
    }, [loadCategories, fetchBottomCarouselCards]);

    useEffect(() => {
        setPage(1);
        setHasMore(true);
        loadedPagesRef.current = new Set();
        requestKeyRef.current = `${selectedCategory}::${selectedUsageAudience}::${sortBy}`;
        if (showAudienceCategoryBrowse) {
            setProducts([]);
            setHasMore(false);
            setIsLoading(false);
            return;
        }
        fetchProducts(1, { append: false, force: true });
    }, [selectedCategory, selectedUsageAudience, sortBy, fetchProducts, showAudienceCategoryBrowse]);

    useEffect(() => {
        if (!sentinelRef.current) return;
        const observer = new IntersectionObserver((entries) => {
            const entry = entries[0];
            if (entry.isIntersecting && hasMore && !loadingRef.current && !searchTerm.trim()) {
                const loaded = Array.from(loadedPagesRef.current);
                const nextPage = (loaded.length ? Math.max(...loaded) : page) + 1;
                fetchProducts(nextPage, { append: true });
            }
        }, { rootMargin: '200px' });
        observer.observe(sentinelRef.current);
        return () => observer.disconnect();
    }, [page, hasMore, fetchProducts, searchTerm]);

    useEffect(() => {
        if (showAudienceCategoryBrowse) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            if (searchAbortRef.current) searchAbortRef.current.abort();
            setIsSearchLoading(false);
            setSearchResults([]);
            return;
        }
        const q = searchTerm.trim();
        if (!q) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            if (searchAbortRef.current) searchAbortRef.current.abort();
            setIsSearchLoading(false);
            setSearchResults([]);
            return;
        }
        if (!shouldRunDiscoverySearch(q, hasMore)) {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            if (searchAbortRef.current) searchAbortRef.current.abort();
            setIsSearchLoading(false);
            setSearchResults([]);
            return;
        }

        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(async () => {
            if (searchAbortRef.current) searchAbortRef.current.abort();
            const controller = new AbortController();
            searchAbortRef.current = controller;
            setIsSearchLoading(true);
            try {
                const searchSort = sortBy === 'default' ? 'relevance' : sortBy;
                const data = await productService.searchProducts({
                    query: q,
                    page: 1,
                    limit: SEARCH_LIMIT,
                    category: selectedCategory,
                    usageAudience: selectedUsageAudience,
                    status: 'active',
                    sort: searchSort,
                    inStockOnly,
                    minPrice: priceRange.min,
                    maxPrice: priceRange.max
                }, { signal: controller.signal });
                setSearchResults(Array.isArray(data?.products) ? data.products : []);
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    console.error('Search failed', error);
                    setSearchResults([]);
                }
            } finally {
                if (searchAbortRef.current === controller) {
                    setIsSearchLoading(false);
                }
            }
        }, SEARCH_DEBOUNCE_MS);

        return () => {
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        };
    }, [searchTerm, selectedCategory, selectedUsageAudience, sortBy, inStockOnly, priceRange.min, priceRange.max, showAudienceCategoryBrowse]);

    const shouldItemBeVisible = useCallback((item) => {
        if (!item || item.status !== 'active') return false;
        if (selectedUsageAudience && String(item?.usageAudience || item?.usage_audience || '').toLowerCase() !== selectedUsageAudience) {
            return false;
        }
        if (selectedCategory === 'all') return true;
        const clean = selectedCategory.toLowerCase();
        const itemCategories = normalizeCategoryList(item.categories);
        return itemCategories.some(c => String(c).toLowerCase() === clean);
    }, [normalizeCategoryList, selectedCategory, selectedUsageAudience]);

    const currentServerSort = useMemo(() => (
        sortBy === 'default'
            ? (selectedCategory === 'all' ? 'newest' : 'manual')
            : sortBy
    ), [selectedCategory, sortBy]);
    const isStableSort = useMemo(() => currentServerSort === 'newest', [currentServerSort]);
    const isManualSort = useMemo(
        () => currentServerSort === 'manual' && selectedCategory !== 'all',
        [currentServerSort, selectedCategory]
    );

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    const refreshLoadedPagesInCurrentSort = useCallback(async () => {
        if (!isManualSort || loadingRef.current) return;
        loadingRef.current = true;
        try {
            const requestKey = `${selectedCategory}::${selectedUsageAudience}::${sortBy}`;
            requestKeyRef.current = requestKey;
            const loaded = Array.from(loadedPagesRef.current).sort((a, b) => a - b);
            const pagesToLoad = loaded.length ? loaded : [1];
            let merged = [];
            let lastBatchSize = PAGE_LIMIT;

            for (const pg of pagesToLoad) {
                const data = await productService.getProducts(pg, selectedCategory, 'active', currentServerSort, PAGE_LIMIT, null, selectedUsageAudience);
                if (requestKeyRef.current !== requestKey) return;
                const batch = Array.isArray(data?.products) ? data.products : [];
                merged = mergeUniqueProducts(merged, batch);
                lastBatchSize = batch.length;
            }

            setProducts(merged);
            setPage(Math.max(...pagesToLoad));
            setHasMore(lastBatchSize >= PAGE_LIMIT);
        } catch (err) {
            console.error('Failed to refresh ordered shop list', err);
        } finally {
            loadingRef.current = false;
        }
    }, [currentServerSort, isManualSort, selectedCategory, selectedUsageAudience, sortBy]);

    const scheduleManualRefresh = useCallback(() => {
        if (!isManualSort) return;
        if (manualRefreshTimerRef.current) clearTimeout(manualRefreshTimerRef.current);
        manualRefreshTimerRef.current = setTimeout(() => {
            refreshLoadedPagesInCurrentSort();
        }, 180);
    }, [isManualSort, refreshLoadedPagesInCurrentSort]);

    const handleCategoryRefresh = useCallback((payload = {}) => {
        const action = String(payload?.action || '').toLowerCase();
        const payloadCategoryName = String(payload?.categoryName || payload?.category?.name || '').toLowerCase();
        const selectedCategoryName = String(selectedCategory || '').toLowerCase();
        const touchesCurrentCategory = selectedCategoryName === 'all'
            || (payloadCategoryName && payloadCategoryName === selectedCategoryName);
        if (action === 'reorder' || action === 'autopilot' || action === 'sync_all') {
            productService.clearProductsCache({ category: selectedCategory === 'all' ? undefined : selectedCategory });
            if (touchesCurrentCategory) {
                refreshLoadedPagesInCurrentSort();
            }
        }
        loadCategories(true);
    }, [loadCategories, refreshLoadedPagesInCurrentSort, selectedCategory]);

    const handleProductCreate = useCallback((product) => {
            loadCategories(true);
            if (!shouldItemBeVisible(product)) return;
            if (isManualSort) {
                productService.clearProductsCache({ category: selectedCategory });
                scheduleManualRefresh();
                return;
            }
            setProducts(prev => {
                if (sortBy === 'newest') return mergeUniqueProducts([product], prev);
                return mergeUniqueProducts(prev, [product]);
            });
    }, [isManualSort, loadCategories, scheduleManualRefresh, selectedCategory, shouldItemBeVisible, sortBy]);

    const handleProductUpdate = useCallback((updated) => {
            loadCategories(true);
            const currentCategory = selectedCategory.toLowerCase();
            const incomingCategories = normalizeCategoryList(updated?.categories);
            const touchesCurrentCategory = incomingCategories.some(
                (entry) => String(entry || '').toLowerCase() === currentCategory
            );
            const existsInCurrent = productsRef.current.some(
                (item) => String(item?.id || '') === String(updated?.id || '')
            );
            if (isManualSort && (touchesCurrentCategory || existsInCurrent)) {
                productService.clearProductsCache({ category: selectedCategory });
                scheduleManualRefresh();
                return;
            }
            setProducts(prev => {
                const exists = prev.find(p => p.id === updated.id);
                const isVisible = shouldItemBeVisible(updated);
                if (exists) {
                    if (!isVisible) return prev.filter(p => p.id !== updated.id);
                    return prev.map(p => p.id === updated.id ? { ...p, ...updated } : p);
                }
                if (isVisible) return mergeUniqueProducts(prev, [updated]);
                return prev;
            });
            if (isStableSort) {
                productService.patchProductInProductsCache(updated, { sorts: [currentServerSort] });
            }
    }, [
        currentServerSort,
        isManualSort,
        isStableSort,
        normalizeCategoryList,
        loadCategories,
        scheduleManualRefresh,
        selectedCategory,
        shouldItemBeVisible
    ]);

    const handleProductDelete = useCallback(({ id }) => {
            loadCategories(true);
            if (isManualSort) {
                productService.clearProductsCache({ category: selectedCategory });
            }
            setProducts(prev => prev.filter(p => p.id !== id));
    }, [isManualSort, loadCategories, selectedCategory]);

    const handleCategoryChange = useCallback((payload = {}) => {
            if (!payload.product) return;
            const product = payload.product;
            const name = payload.categoryName || '';
            if (selectedCategory !== 'all' && name.toLowerCase() !== selectedCategory.toLowerCase()) return;
            if (isManualSort) {
                productService.clearProductsCache({ category: selectedCategory });
                scheduleManualRefresh();
                return;
            }
            if (!shouldItemBeVisible(product)) {
                setProducts(prev => prev.filter(p => p.id !== product.id));
            } else {
                setProducts(prev => mergeUniqueProducts(prev, [product]));
            }
            productService.clearProductsCache({ category: selectedCategory === 'all' ? undefined : selectedCategory });
    }, [isManualSort, scheduleManualRefresh, selectedCategory, shouldItemBeVisible]);

    useAdminCrudSync({
        'refresh:categories': handleCategoryRefresh,
        'product:create': handleProductCreate,
        'product:update': handleProductUpdate,
        'product:delete': handleProductDelete,
        'product:category_change': handleCategoryChange,
        'cms:carousel_cards_update': fetchBottomCarouselCards
    });

    useEffect(() => {
        return () => {
            if (manualRefreshTimerRef.current) {
                clearTimeout(manualRefreshTimerRef.current);
                manualRefreshTimerRef.current = null;
            }
            if (searchDebounceRef.current) {
                clearTimeout(searchDebounceRef.current);
                searchDebounceRef.current = null;
            }
            if (searchAbortRef.current) {
                searchAbortRef.current.abort();
                searchAbortRef.current = null;
            }
            if (usageScrollRestoreRef.current) {
                window.cancelAnimationFrame(usageScrollRestoreRef.current);
                usageScrollRestoreRef.current = null;
            }
        };
    }, []);

    const categoryOptions = useMemo(() => {
        const list = categories
            .filter((c) => isCategoryVisibleInStorefront(c))
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
        return [{ id: 'all', name: 'All Products' }, ...list];
    }, [categories]);

    const filteredAndSortedProducts = useMemo(() => {
        let result = [...products];

        if (inStockOnly) {
            result = result.filter((p) => isDiscoveryItemInStock(p));
        }
        if (searchTerm.trim()) {
            const q = searchTerm.trim().toLowerCase();
            result = result.filter(p =>
                (p.title || '').toLowerCase().includes(q) ||
                (p.sku || '').toLowerCase().includes(q)
            );
        }

        if (priceRange.min !== '') {
            result = result.filter(p => (p.discount_price || p.mrp) >= Number(priceRange.min));
        }
        if (priceRange.max !== '') {
            result = result.filter(p => (p.discount_price || p.mrp) <= Number(priceRange.max));
        }

        if (sortBy === 'low') {
            result.sort((a, b) => (a.discount_price || a.mrp) - (b.discount_price || b.mrp));
        } else if (sortBy === 'high') {
            result.sort((a, b) => (b.discount_price || b.mrp) - (a.discount_price || a.mrp));
        }

        return result;
    }, [products, sortBy, inStockOnly, priceRange, searchTerm]);
    const localSearchResults = useMemo(() => (
        searchTerm.trim() ? filteredAndSortedProducts : []
    ), [filteredAndSortedProducts, searchTerm]);
    const displayProducts = useMemo(() => {
        if (!searchTerm.trim()) return filteredAndSortedProducts;
        return mergeUniqueProducts(localSearchResults, searchResults);
    }, [filteredAndSortedProducts, localSearchResults, searchResults, searchTerm]);
    const hasActiveFilters = Boolean(
        selectedUsageAudience
        || searchTerm.trim()
        || inStockOnly
        || priceRange.min
        || priceRange.max
    );
    const clearFilters = useCallback(() => {
        setSearchTerm('');
        setSelectedUsageAudience('');
        setInStockOnly(false);
        setPriceRange({ min: '', max: '' });
    }, []);

    return (
        <div className="min-h-screen bg-gray-50 pb-20 w-full">
            {/* Breadcrumb */}
            <div className="bg-white border-b border-gray-100">
                <div className="container mx-auto px-4 py-3 flex items-center gap-2 text-xs md:text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary"><Home size={14} /></Link>
                    <span>/</span>
                    <span className="font-bold text-gray-800">Shop</span>
                </div>
            </div>

            {/* Jumbotron */}
            <div className="relative h-64 md:h-80 bg-gray-900 w-full overflow-hidden">
                <div className="absolute inset-0 bg-black/50 z-10"></div>
                <img
                    src={jumbotronImage}
                    alt="Shop Banner"
                    className="absolute inset-0 w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.src = '/placeholder_banner.jpg'; }}
                />
                <div className="relative z-20 container mx-auto px-4 h-full flex flex-col justify-center items-center text-center">
                    <span className="text-accent uppercase tracking-[0.2em] text-xs md:text-sm font-bold mb-3 animate-fade-in">
                        Explore Everything
                    </span>
                    <div className="flex items-center gap-3">
                        <h1 className="text-4xl md:text-6xl font-serif text-white mb-4 drop-shadow-lg animate-slide-up">
                            Shop
                        </h1>
                        <div className="relative" ref={shareRef}>
                            <button
                                onClick={handleShareClick}
                                className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white mb-4"
                            >
                                <Share2 size={18} />
                            </button>
                            {isShareOpen && (
                                <div className="fixed inset-x-4 top-1/2 z-50 w-auto max-w-sm -translate-y-1/2 rounded-xl border border-gray-200 bg-white p-3 text-gray-700 shadow-2xl sm:absolute sm:inset-x-auto sm:left-full sm:top-0 sm:mt-0 sm:ml-3 sm:w-56 sm:max-w-none sm:translate-y-0">
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Share</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <a onClick={() => setIsShareOpen(false)} className="text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50 flex items-center justify-center gap-1" href={shareLinks.whatsapp} target="_blank" rel="noreferrer">
                                            <WhatsAppIcon size={14} className="text-green-500" /> WhatsApp
                                        </a>
                                        <a onClick={() => setIsShareOpen(false)} className="text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50 flex items-center justify-center gap-1" href={shareLinks.facebook} target="_blank" rel="noreferrer">
                                            <Facebook size={14} className="text-blue-600" /> Facebook
                                        </a>
                                        <a onClick={() => setIsShareOpen(false)} className="text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50 flex items-center justify-center gap-1" href={shareLinks.twitter} target="_blank" rel="noreferrer">
                                            <Twitter size={14} className="text-sky-500" /> Twitter
                                        </a>
                                        <a onClick={() => setIsShareOpen(false)} className="text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50 flex items-center justify-center gap-1" href={shareLinks.telegram} target="_blank" rel="noreferrer">
                                            <Send size={14} className="text-blue-400" /> Telegram
                                        </a>
                                    </div>
                                    <button onClick={() => { handleCopyLink(); setIsShareOpen(false); }} className="mt-3 w-full text-xs font-semibold text-primary border border-primary/20 rounded-lg py-2 hover:bg-primary/5 flex items-center justify-center gap-1">
                                        <Copy size={14} className="text-primary/80" /> Copy Link
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {showAudienceCategoryBrowse ? (
                <section id="shop-results" className="container mx-auto px-4 py-8">
                    <div className="mb-6">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-amber-700">Browse by audience</p>
                        <h2 className="mt-2 text-2xl md:text-3xl font-serif text-primary">
                            {selectedUsageAudience.charAt(0).toUpperCase() + selectedUsageAudience.slice(1)} Categories
                        </h2>
                        <p className="mt-2 text-sm text-gray-500">
                            Choose a category to view products filtered for this audience.
                        </p>
                    </div>
                    {categories.length > 0 ? (
                        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                            {categories.map((category) => (
                                <Link
                                    key={`audience-category-${category.id || category.name}`}
                                    to={`/shop/${encodeURIComponent(category.name)}?usageAudience=${encodeURIComponent(selectedUsageAudience)}`}
                                    className="group overflow-hidden rounded-3xl border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                                >
                                    <div className="aspect-[4/3] overflow-hidden bg-gray-100">
                                        <img
                                            src={category.image_url || '/placeholder_banner.jpg'}
                                            alt={category.name}
                                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                                            onError={(e) => { e.currentTarget.src = '/placeholder_banner.jpg'; }}
                                        />
                                    </div>
                                    <div className="px-4 py-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <h3 className="text-base font-semibold text-gray-900">{category.name}</h3>
                                            <LayoutGrid size={16} className="text-gray-300 transition-colors group-hover:text-primary" />
                                        </div>
                                        <p className="mt-1 text-xs text-gray-500">{Number(category.product_count || 0)} products</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <EmptyState
                            image={emptyIllustration}
                            alt="No categories found"
                            title="No categories found"
                            description="No storefront categories currently have products for this audience."
                        />
                    )}
                </section>
            ) : (
            <div className="container mx-auto px-4 py-6 md:py-8">
                <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-8">
                    {/* Sidebar */}
                    <aside className="bg-white rounded-2xl border border-gray-200 p-4 h-fit">
                        {usageAudienceEnabled && (
                            <>
                                <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-4">Usage Audience</h3>
                                <div className="md:hidden relative mb-5">
                                    <select
                                        value={selectedUsageAudience}
                                        onChange={(e) => preserveScrollDuringUsageFilter(e.target.value)}
                                        className="w-full bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:border-primary shadow-sm"
                                    >
                                        {usageAudienceOptions.map((option) => (
                                            <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div className="hidden md:grid grid-cols-1 gap-2 mb-6">
                                    {usageAudienceOptions.map((option) => {
                                        const isActive = option.value === selectedUsageAudience;
                                        return (
                                            <button
                                                key={option.value || 'all'}
                                                type="button"
                                                onClick={() => preserveScrollDuringUsageFilter(option.value)}
                                                className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                                    isActive ? 'bg-primary text-white' : 'text-gray-600 hover:bg-gray-50'
                                                }`}
                                            >
                                                <div className="w-9 h-9 rounded-full bg-gray-100 overflow-hidden border border-white shadow-inner shrink-0">
                                                    {option.imageUrl ? (
                                                        <img src={option.imageUrl} alt={option.label} className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center bg-primary/10">
                                                            <LayoutGrid size={16} className={isActive ? 'text-white' : 'text-primary'} />
                                                        </div>
                                                    )}
                                                </div>
                                                <span className="truncate">{option.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            </>
                        )}
                        <h3 className="text-sm font-bold text-gray-700 uppercase tracking-widest mb-4 hidden md:block">Categories</h3>
                        {/* Mobile dropdown */}
                        <div className="md:hidden relative" ref={categoryDropdownRef}>
                            <button
                                type="button"
                                onClick={() => setIsCategoryOpen((prev) => !prev)}
                                className="w-full flex items-center justify-between gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm font-medium text-gray-700 focus:outline-none focus:border-primary shadow-sm"
                            >
                                <span className="truncate">
                                    {selectedCategory === 'all' ? 'All Products' : selectedCategory}
                                </span>
                                <ChevronDown className={`text-gray-400 transition-transform ${isCategoryOpen ? 'rotate-180' : 'rotate-0'}`} size={16} />
                            </button>
                            {isCategoryOpen && (
                                <>
                                    <button
                                        type="button"
                                        aria-label="Close categories"
                                        className="fixed inset-0 bg-black/10 backdrop-blur-[2px] z-40"
                                        onClick={() => setIsCategoryOpen(false)}
                                    />
                                    <div className="absolute left-0 right-0 mt-2 rounded-xl border border-gray-200 bg-white shadow-xl max-h-64 overflow-auto z-50 animate-in fade-in slide-in-from-top-2">
                                        {categoryOptions.map((cat) => {
                                            const value = cat.name === 'All Products' ? 'all' : cat.name;
                                            const isActive = value === selectedCategory;
                                            return (
                                                <button
                                                    key={cat.id || cat.name}
                                                    type="button"
                                                    onClick={() => {
                                                        setSelectedCategory(value);
                                                        setIsCategoryOpen(false);
                                                    }}
                                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                                                        isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-gray-700 hover:bg-gray-50'
                                                    }`}
                                                >
                                                    {cat.name === 'All Products' ? (
                                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                                                            <LayoutGrid size={14} className="text-primary" />
                                                        </div>
                                                    ) : (
                                                        <div className="w-6 h-6 rounded-full bg-gray-100 overflow-hidden border border-white shadow-inner">
                                                            {cat.image_url ? (
                                                                <img src={cat.image_url} alt={cat.name} className="w-full h-full object-cover" />
                                                            ) : (
                                                                <div className="w-full h-full bg-gray-200" />
                                                            )}
                                                        </div>
                                                    )}
                                                    <span className="truncate">{cat.name}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </>
                            )}
                        </div>
                        {/* Desktop list */}
                        <div className="space-y-2 hidden md:block">
                            {categoryOptions.map((cat) => (
                                <button
                                    key={cat.id || cat.name}
                                    onClick={() => setSelectedCategory(cat.name === 'All Products' ? 'all' : cat.name)}
                                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                                        (selectedCategory === 'all' && cat.name === 'All Products') || (selectedCategory === cat.name)
                                            ? 'bg-primary text-white'
                                            : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                                >
                                    {cat.name === 'All Products' ? (
                                        <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center">
                                            <LayoutGrid size={14} className="text-primary" />
                                        </div>
                                    ) : (
                                        <div className="w-6 h-6 rounded-full bg-gray-100 overflow-hidden border border-white shadow-inner">
                                            {cat.image_url ? (
                                                <img src={cat.image_url} alt={cat.name} className="w-full h-full object-cover" />
                                            ) : (
                                                <div className="w-full h-full bg-gray-200" />
                                            )}
                                        </div>
                                    )}
                                    {cat.name}
                                </button>
                            ))}
                        </div>
                    </aside>

                    {/* Main */}
                    <section id="shop-results" className="scroll-mt-28">
                        <div className="mb-3">
                            <h2 className="text-xl md:text-2xl font-serif text-primary">
                                {selectedCategory === 'all' ? 'All Products' : selectedCategory}
                                {selectedUsageAudience ? ` • ${selectedUsageAudience.charAt(0).toUpperCase()}${selectedUsageAudience.slice(1)}` : ''}
                            </h2>
                        </div>
                        <div className="sticky top-[64px] z-40 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm w-full transition-all duration-300 mb-4">
                            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-2 py-3">
                                <div className="flex w-full items-center justify-between md:justify-end gap-4">
                                    <button
                                        onClick={() => setShowFilters(!showFilters)}
                                        className={`flex items-center gap-2 font-medium text-sm transition-colors ${showFilters ? 'text-primary' : 'text-gray-600 hover:text-primary'}`}
                                    >
                                        <Filter size={18} className={showFilters ? "fill-current" : ""} />
                                        <span>Filters</span>
                                        {hasActiveFilters ? (
                                            <span className="bg-accent text-primary text-[10px] px-1.5 rounded-full font-bold">!</span>
                                        ) : null}
                                    </button>
                                    <div className="relative group md:ml-auto">
                                        <select
                                            className="appearance-none bg-transparent pl-2 pr-8 py-1 text-sm font-bold text-gray-700 focus:outline-none cursor-pointer hover:text-primary"
                                            value={sortBy}
                                            onChange={(e) => setSortBy(e.target.value)}
                                        >
                                            <option value="default">Default</option>
                                            <option value="newest">Newest First</option>
                                            <option value="low">Price: Low to High</option>
                                            <option value="high">Price: High to Low</option>
                                        </select>
                                        <ChevronDown size={14} className="absolute right-0 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
                                    </div>
                                </div>
                            </div>
                            <div className="px-2 text-xs text-gray-500">
                                {displayProducts.length} results
                            </div>

                            <div className={`overflow-hidden transition-all duration-300 ease-in-out ${showFilters ? 'max-h-40 opacity-100 mt-3 pb-2' : 'max-h-0 opacity-0'}`}>
                                <div className="flex flex-wrap items-center gap-4 md:gap-8 pt-3 border-t border-gray-100">
                                    {/* Search */}
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            placeholder="Search products..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            className="w-48 px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-primary"
                                        />
                                    </div>
                                    {usageAudienceEnabled && (
                                        <div className="flex items-center gap-2">
                                            <span className="text-sm text-gray-600 font-medium">Usage:</span>
                                            <select
                                                value={selectedUsageAudience}
                                                onChange={(e) => preserveScrollDuringUsageFilter(e.target.value)}
                                                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-primary bg-white"
                                            >
                                                {usageAudienceOptions.map((option) => (
                                                    <option key={option.value || 'all'} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                    <label className="flex items-center gap-2 cursor-pointer select-none">
                                        <div className="relative">
                                            <input
                                                type="checkbox"
                                                className="sr-only peer"
                                                checked={inStockOnly}
                                                onChange={() => setInStockOnly(!inStockOnly)}
                                            />
                                            <div className="w-9 h-5 bg-gray-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary"></div>
                                        </div>
                                        <span className="text-sm text-gray-600 font-medium">In Stock Only</span>
                                    </label>

                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-gray-600 font-medium">Price:</span>
                                        <input
                                            type="number"
                                            placeholder="Min"
                                            value={priceRange.min}
                                            onChange={(e) => setPriceRange(prev => ({ ...prev, min: e.target.value }))}
                                            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-primary"
                                        />
                                        <span className="text-gray-400">-</span>
                                        <input
                                            type="number"
                                            placeholder="Max"
                                            value={priceRange.max}
                                            onChange={(e) => setPriceRange(prev => ({ ...prev, max: e.target.value }))}
                                            className="w-20 px-2 py-1 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-primary"
                                        />
                                    </div>
                                    {hasActiveFilters && (
                                        <button
                                            type="button"
                                            onClick={clearFilters}
                                            className="text-xs text-red-500 hover:text-red-700 font-bold"
                                        >
                                            Clear Filters
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {isLoading && products.length === 0 ? (
                            <div className="flex justify-center py-20">
                                <Loader2 className="animate-spin text-accent w-10 h-10" />
                            </div>
                        ) : (
                            <>
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-6">
                                    {displayProducts.map((product) => (
                                        <ProductCard
                                            key={product.id}
                                            product={product}
                                            displayCategory={selectedCategory === 'all' ? '' : selectedCategory}
                                        />
                                    ))}
                                </div>
                                {isSearchLoading && searchTerm.trim() && (
                                    <div className="col-span-full py-4 text-center text-sm text-gray-500">
                                        Searching...
                                    </div>
                                )}
                                {displayProducts.length === 0 && !isSearchLoading && (
                                    <div className="col-span-full">
                                        <EmptyState
                                            image={emptyIllustration}
                                            alt="No products available"
                                            title="No products available"
                                            description="Products matching your current view are not available right now. Try a different search or browse another category."
                                            compact
                                        />
                                    </div>
                                )}
                                <div ref={sentinelRef} className="h-10" />
                                {loadingRef.current && (
                                    <div className="flex justify-center py-6">
                                        <Loader2 className="animate-spin text-accent w-6 h-6" />
                                    </div>
                                )}
                            </>
                        )}
                    </section>
                </div>
            </div>
            )}

            {(isLoadingBottomCarousel || bottomCarouselCards.length > 0) && (
                <section className="container mx-auto px-4 py-8 md:py-10 bg-gray-50">
                    <div className="flex items-center justify-between gap-4 mb-5">
                        <div>
                            <p className="text-[11px] uppercase tracking-[0.32em] text-gray-500 font-semibold">Featured for you</p>
                            <h3 className="text-2xl font-serif text-primary mt-1">Discover More</h3>
                        </div>
                        {bottomCarouselCards.length > 1 && (
                            <div className="hidden md:flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => scrollBottomCarouselTo(Math.max(0, activeBottomCarouselIndex - 1))}
                                    className="h-9 w-9 rounded-full border border-gray-200 bg-white text-gray-600 hover:text-primary hover:border-primary/30 transition-colors flex items-center justify-center"
                                    aria-label="Previous featured card"
                                >
                                    <ChevronLeft size={18} />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => scrollBottomCarouselTo(Math.min(bottomCarouselCards.length - 1, activeBottomCarouselIndex + 1))}
                                    className="h-9 w-9 rounded-full border border-gray-200 bg-white text-gray-600 hover:text-primary hover:border-primary/30 transition-colors flex items-center justify-center"
                                    aria-label="Next featured card"
                                >
                                    <ChevronRight size={18} />
                                </button>
                            </div>
                        )}
                    </div>
                    {isLoadingBottomCarousel ? (
                        <div className="flex gap-4 overflow-hidden">
                            {[...Array(3)].map((_, index) => (
                                <div key={`shop-bottom-carousel-skeleton-${index}`} className="w-full md:w-[calc((100%-2rem)/3.3)] aspect-video rounded-3xl bg-gray-100 animate-pulse shrink-0" />
                            ))}
                        </div>
                    ) : (
                        <>
                            <div
                                ref={bottomCarouselTrackRef}
                                className="flex gap-4 overflow-x-auto pb-2 snap-x snap-mandatory [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
                            >
                                {bottomCarouselCards.map((card) => {
                                    const imageUrl = String(card?.resolved_image_url || card?.image_url || '').trim();
                                    const title = String(card?.title || '').trim();
                                    const description = String(card?.description || '').trim();
                                    const buttonLabel = String(card?.button_label || '').trim();
                                    const buttonLink = String(card?.resolved_button_link || card?.button_link || '').trim();
                                    const hasCopy = Boolean(title || description || buttonLabel);
                                    const titleFont = getPromoTitleFont(card?.id || title || 'promo');

                                    const cardBody = (
                                        <article className="relative w-full aspect-video rounded-3xl overflow-hidden shadow-sm border border-gray-100 bg-slate-900">
                                            {imageUrl && (
                                                <img
                                                    src={imageUrl}
                                                    alt={title || 'Feature'}
                                                    className="absolute inset-0 h-full w-full object-cover"
                                                    loading="lazy"
                                                />
                                            )}
                                            <div className={`absolute inset-0 ${hasCopy ? 'bg-gradient-to-t from-black/80 via-black/65 to-black/35' : 'bg-black/20'}`} />
                                            <div className="relative h-full p-5 md:p-6 flex flex-col text-white">
                                                {title && (
                                                    <h4
                                                        className="text-xl md:text-2xl font-bold leading-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.95)]"
                                                        style={{ fontFamily: titleFont, letterSpacing: '0.02em' }}
                                                    >
                                                        {title}
                                                    </h4>
                                                )}
                                                {description && (
                                                    <p className="text-sm md:text-base mt-2 line-clamp-3 text-white drop-shadow-[0_1px_8px_rgba(0,0,0,0.95)]">
                                                        {description}
                                                    </p>
                                                )}
                                                {buttonLabel && (
                                                    <div className="mt-auto pt-4">
                                                        <span className="inline-flex items-center justify-center rounded-xl px-4 py-2 text-sm font-semibold bg-white text-gray-900 shadow-md">
                                                            {buttonLabel}
                                                        </span>
                                                    </div>
                                                )}
                                            </div>
                                        </article>
                                    );

                                    return (
                                        <div
                                            key={`shop-bottom-carousel-card-${card.id}`}
                                            data-bottom-carousel-card="true"
                                            className="shrink-0 w-full md:w-[calc((100%-2rem)/3.3)] snap-start"
                                        >
                                            {buttonLink ? (
                                                isExternalLink(buttonLink) ? (
                                                    <a href={buttonLink} target="_blank" rel="noreferrer" className="block">{cardBody}</a>
                                                ) : (
                                                    <Link to={buttonLink} className="block">{cardBody}</Link>
                                                )
                                            ) : cardBody}
                                        </div>
                                    );
                                })}
                            </div>
                            {bottomCarouselCards.length > 1 && (
                                <div className="mt-3 flex items-center justify-center gap-3 md:hidden">
                                    <div className="inline-flex items-center gap-1.5">
                                        {bottomCarouselCards.map((card, index) => (
                                            <span
                                                key={`shop-bottom-carousel-dot-${card.id || index}`}
                                                className={`h-2 w-2 rounded-full transition-all ${index === activeBottomCarouselIndex ? 'bg-gray-700 scale-110' : 'bg-gray-300'}`}
                                            />
                                        ))}
                                    </div>
                                    <span className="text-xs font-semibold text-gray-600 bg-gray-100 px-2.5 py-1 rounded-full">
                                        {activeBottomCarouselIndex + 1}/{bottomCarouselCards.length}
                                    </span>
                                </div>
                            )}
                        </>
                    )}
                </section>
            )}

            {/* Back to top */}
            {showTopBtn && (
                <button
                    onClick={scrollToTop}
                    className="fixed bottom-8 right-6 z-50 p-3 rounded-full bg-primary text-white shadow-lg hover:bg-primary/90 transition-all"
                    aria-label="Back to top"
                >
                    <ArrowUp size={18} />
                </button>
            )}
        </div>
    );
}
