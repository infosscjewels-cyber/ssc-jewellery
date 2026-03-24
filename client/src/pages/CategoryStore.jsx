import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link, useSearchParams } from 'react-router-dom';
import { productService } from '../services/productService';
import ProductCard from '../components/ProductCard';
import EmptyState from '../components/EmptyState';
import { Filter, SlidersHorizontal, Loader2, ChevronDown, Folder, ArrowRight, ChevronLeft, ChevronRight, ArrowUp, Share2, MessageCircle, Facebook, Twitter, Send, Copy, Home } from 'lucide-react';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { isDiscoveryItemInStock, shouldRunDiscoverySearch } from '../utils/shopDiscovery';
import { buildCategorySeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';
import { isCategoryVisibleInStorefront } from '../utils/categoryVisibility';
import { buildWhatsAppShareLink } from '../utils/publicContact';
import emptyIllustration from '../assets/closed.svg';
// import { io } from 'socket.io-client';

const PAGE_LIMIT = 20;
const SEARCH_DEBOUNCE_MS = 150;
const SEARCH_LIMIT = 60;

const mergeUniqueProducts = (base = [], incoming = []) => {
    const map = new Map();
    [...base, ...incoming].forEach((item) => {
        if (!item || item.id == null) return;
        map.set(String(item.id), item);
    });
    return Array.from(map.values());
};

export default function CategoryStore() {
    const { category } = useParams();
    const [searchParams, setSearchParams] = useSearchParams();
    const { companyInfo } = usePublicCompanyInfo();
    const scrollRef = useRef(null);
    const [products, setProducts] = useState([]);
    const [categoryInfo, setCategoryInfo] = useState(null); 
    const [otherCategories, setOtherCategories] = useState([]); 
    const [isLoading, setIsLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [hasMore, setHasMore] = useState(true);
    const [sortBy, setSortBy] = useState('default');
    const [isHovered, setIsHovered] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const shareRef = useRef(null);
    const loadingRef = useRef(false);
    const productsRef = useRef([]);
    const loadedPagesRef = useRef(new Set());
    const searchAbortRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const requestKeyRef = useRef('');
    const manualRefreshTimerRef = useRef(null);
    const [showTopBtn, setShowTopBtn] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const [availableSubCategories, setAvailableSubCategories] = useState([]);
    const normalizedCategoryName = useMemo(() => decodeURIComponent(category).toLowerCase(), [category]);
    const selectedUsageAudience = useMemo(
        () => String(searchParams.get('usageAudience') || '').trim().toLowerCase(),
        [searchParams]
    );
    const subCategoriesEnabled = companyInfo?.subCategoriesEnabled === true;
    const selectedSubCategory = useMemo(
        () => subCategoriesEnabled ? String(searchParams.get('subCategory') || '').trim() : '',
        [searchParams, subCategoriesEnabled]
    );
    const seoConfig = useMemo(() => buildCategorySeo({
        category: categoryInfo || { name: decodeURIComponent(category || '') },
        products
    }), [category, categoryInfo, products]);
    useSeo(seoConfig);
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
                // Fall back to panel
            }
        }
        setIsShareOpen((prev) => !prev);
    };

    const updateFilterParams = useCallback((updates = {}) => {
        const nextParams = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([key, value]) => {
            const normalized = String(value || '').trim();
            if (normalized) nextParams.set(key, normalized);
            else nextParams.delete(key);
        });
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    // --- FILTER STATE ---
    const [showFilters, setShowFilters] = useState(false);
    const [inStockOnly, setInStockOnly] = useState(false);
    const [priceRange, setPriceRange] = useState({ min: '', max: '' });
    const [searchTerm, setSearchTerm] = useState('');
    const currentServerSort = useMemo(() => (
        sortBy === 'default' ? 'manual' : sortBy
    ), [sortBy]);
    const isStableSort = useMemo(() => currentServerSort === 'newest', [currentServerSort]);
    const isManualSort = useMemo(() => currentServerSort === 'manual', [currentServerSort]);

    useEffect(() => {
        productsRef.current = products;
    }, [products]);

    // Scroll Listener for "Back to Top" Button
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


    // Add Scroll Function
    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth',
        });
    };

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
    // --- 1. Fetch Jumbotron & Explore Data ---
    const fetchCategoryMetadata = useCallback(async (force = false) => {
        try {
            const allCategories = (await productService.getCategoryStats(force, {
                usageAudience: selectedUsageAudience
            })).filter((entry) =>
                isCategoryVisibleInStorefront(entry)
            );
            const cleanName = normalizedCategoryName;
            const currentCat = allCategories.find(c => c.name.toLowerCase() === cleanName);
            
            setCategoryInfo(currentCat ? { ...currentCat } : { name: category, image_url: null });
            setOtherCategories(allCategories.filter(c => c.name.toLowerCase() !== cleanName));
        } catch (err) {
            console.error("Failed to load category info", err);
        }
    }, [category, normalizedCategoryName, selectedUsageAudience]);

    // --- 2. Fetch Products ---
    const fetchProducts = useCallback(async (
        currentPage,
        { shouldAppend = false, skipLoading = false, force = false } = {}
    ) => {
        if (loadingRef.current && !force) return [];
        if (!skipLoading) setIsLoading(true);
        loadingRef.current = true;

        const requestKey = `${normalizedCategoryName}::${selectedUsageAudience}::${selectedSubCategory}::${sortBy}`;
        requestKeyRef.current = requestKey;
        try {
            const serverSort = sortBy === 'default' ? 'manual' : sortBy;
            const data = await productService.getProducts(currentPage, category, 'active', serverSort, PAGE_LIMIT, null, selectedUsageAudience, selectedSubCategory);
            if (requestKeyRef.current !== requestKey) return [];

            const newItems = Array.isArray(data?.products) ? data.products : [];
            setAvailableSubCategories(Array.isArray(data?.availableSubCategories) ? data.availableSubCategories : []);
            loadedPagesRef.current.add(currentPage);
            if (shouldAppend) {
                setProducts((prev) => mergeUniqueProducts(prev, newItems));
            } else {
                setProducts(mergeUniqueProducts([], newItems));
            }
            setPage((prev) => Math.max(prev, currentPage));
            setHasMore(newItems.length >= PAGE_LIMIT);
            return newItems;
        } catch (error) {
            console.error("Store load error", error);
            return [];
        } finally {
            loadingRef.current = false;
            if (!skipLoading) setIsLoading(false);
        }
    }, [category, normalizedCategoryName, selectedSubCategory, selectedUsageAudience, sortBy]);

    const refreshLoadedPagesInCurrentSort = useCallback(async () => {
        if (loadingRef.current) return;
        loadingRef.current = true;
        try {
            const requestKey = `${normalizedCategoryName}::${selectedUsageAudience}::${selectedSubCategory}::${sortBy}`;
            requestKeyRef.current = requestKey;
            const loaded = Array.from(loadedPagesRef.current).sort((a, b) => a - b);
            const pagesToLoad = loaded.length ? loaded : [1];
            let merged = [];
            let lastBatchSize = PAGE_LIMIT;

            for (const pg of pagesToLoad) {
                const data = await productService.getProducts(pg, category, 'active', currentServerSort, PAGE_LIMIT, null, selectedUsageAudience, selectedSubCategory);
                if (requestKeyRef.current !== requestKey) return;
                const batch = Array.isArray(data?.products) ? data.products : [];
                merged = mergeUniqueProducts(merged, batch);
                lastBatchSize = batch.length;
                setAvailableSubCategories(Array.isArray(data?.availableSubCategories) ? data.availableSubCategories : []);
            }

            setProducts(merged);
            setPage(Math.max(...pagesToLoad));
            setHasMore(lastBatchSize >= PAGE_LIMIT);
        } catch (error) {
            console.error('Failed to refresh ordered category list', error);
        } finally {
            loadingRef.current = false;
        }
    }, [category, currentServerSort, normalizedCategoryName, selectedSubCategory, selectedUsageAudience, sortBy]);

    const scheduleManualRefresh = useCallback(() => {
        if (!isManualSort) return;
        if (manualRefreshTimerRef.current) clearTimeout(manualRefreshTimerRef.current);
        manualRefreshTimerRef.current = setTimeout(() => {
            refreshLoadedPagesInCurrentSort();
        }, 180);
    }, [isManualSort, refreshLoadedPagesInCurrentSort]);

    const reorderByIds = (items, orderedIds = []) => {
        if (!Array.isArray(orderedIds) || orderedIds.length === 0) return items;
        const map = new Map(items.map(p => [String(p.id), p]));
        const ordered = orderedIds.map(id => map.get(String(id))).filter(Boolean);
        const remaining = items.filter(p => !orderedIds.includes(String(p.id)));
        return [...ordered, ...remaining];
    };
    
    // Initial Load (Optimized with Promise.all)
    useEffect(() => {
        const loadInitialData = async () => {
            setIsLoading(true);
            setPage(1);
            setHasMore(true);
            loadedPagesRef.current = new Set();
            requestKeyRef.current = `${normalizedCategoryName}::${selectedUsageAudience}::${selectedSubCategory}::${sortBy}`;

            // Execute both requests in parallel and wait for both to finish
            await Promise.all([
                fetchCategoryMetadata(),
                fetchProducts(1, { shouldAppend: false, skipLoading: true, force: true })
            ]);

            setIsLoading(false);
        };

        loadInitialData();
    }, [category, sortBy, fetchProducts, fetchCategoryMetadata, normalizedCategoryName, selectedSubCategory, selectedUsageAudience]);

    // --- 3. Socket.io Sync (Optimized: Local Append/Patch) ---
    const shouldItemBeVisible = useCallback((item) => {
            // 1. Must be active
            if (item.status && item.status !== 'active') return false;

            // 2. Must match the current URL category
            const categories = normalizeCategoryList(item.categories);
            const belongsToCategory = categories.some(c => String(c || '').toLowerCase() === normalizedCategoryName);
            
            const matchesAudience = !selectedUsageAudience || String(item?.usageAudience || item?.usage_audience || '').toLowerCase() === selectedUsageAudience;
            const matchesSubCategory = !selectedSubCategory || String(item?.subCategory || item?.sub_category || '').trim().toLowerCase() === selectedSubCategory.toLowerCase();
            
            return belongsToCategory && matchesAudience && matchesSubCategory;
    }, [normalizeCategoryList, normalizedCategoryName, selectedSubCategory, selectedUsageAudience]);

    const clearCurrentCategoryCache = useCallback(() => {
            productService.clearProductsCache({ category });
    }, [category]);

        // A. Handle Item Creation (APPEND/PREPEND LOCALLY)
    const handleProductCreate = useCallback((newProduct) => {
            // Only add if it belongs to this category and is active
            if (shouldItemBeVisible(newProduct)) {
                if (isManualSort) {
                    clearCurrentCategoryCache();
                    scheduleManualRefresh();
                    return;
                }
                setProducts(prev => {
                    // Logic: If sorting by 'newest', add to TOP. Else add to BOTTOM.
                    if (sortBy === 'newest') {
                        return mergeUniqueProducts([newProduct], prev);
                    }
                    return mergeUniqueProducts(prev, [newProduct]);
                });
            }
    }, [isManualSort, scheduleManualRefresh, shouldItemBeVisible, sortBy, clearCurrentCategoryCache]);

        // B. Handle Item Updates (PATCH LOCALLY + REAPPEARANCE)
    const handleProductUpdate = useCallback((updatedItem) => {
            const incomingCategories = normalizeCategoryList(updatedItem?.categories);
            const touchesCurrentCategory = incomingCategories.some(
                (entry) => String(entry || '').toLowerCase() === normalizedCategoryName
            );
            const existsInCurrent = productsRef.current.some(
                (item) => String(item?.id || '') === String(updatedItem?.id || '')
            );
            if (isManualSort && (touchesCurrentCategory || existsInCurrent)) {
                clearCurrentCategoryCache();
                scheduleManualRefresh();
                return;
            }
            setProducts(prevProducts => {
                const exists = prevProducts.find(p => p.id === updatedItem.id);
                const isVisible = shouldItemBeVisible(updatedItem);

                if (exists) {
                    if (!isVisible) {
                        // Case 1: Was visible -> Now Hidden/Removed (Remove locally)
                        return prevProducts.filter(p => p.id !== updatedItem.id);
                    } else {
                        // Case 2: Was visible -> Still visible (Update details in place)
                        return prevProducts.map(p => p.id === updatedItem.id ? { ...p, ...updatedItem } : p);
                    }
                } else {
                    if (isVisible) {
                        // Case 3: Was HIDDEN -> Now Active (Reappearance)
                        // Inject it into the list without fetching
                        if (sortBy === 'newest') return mergeUniqueProducts([updatedItem], prevProducts);
                        return mergeUniqueProducts(prevProducts, [updatedItem]);
                    }
                    return prevProducts; // Item irrelevant to this page
                }
            });
            if (isStableSort) {
                productService.patchProductInProductsCache(updatedItem, { sorts: [currentServerSort] });
            }
    }, [
        clearCurrentCategoryCache,
        currentServerSort,
        isManualSort,
        isStableSort,
        normalizeCategoryList,
        normalizedCategoryName,
        scheduleManualRefresh,
        shouldItemBeVisible,
        sortBy
    ]);

        // C. Handle Deletes (REMOVE LOCALLY)
        const handleProductDelete = ({ id }) => {
            setProducts(prev => prev.filter(p => p.id !== id));
        };

        // D. Handle Category Add/Remove (Admin Action)
        const handleCategoryChange = (payload = {}) => {
            const { id, categoryId, action } = payload || {};
            const payloadCategoryName = String(payload?.categoryName || '').toLowerCase();
            const matchesByName = payloadCategoryName && payloadCategoryName === normalizedCategoryName;
            const matchesById = categoryInfo && categoryId && String(categoryInfo.id) === String(categoryId);
            if (!matchesByName && !matchesById) return;
            // Check if event relates to THIS category page
            if (isManualSort) {
                clearCurrentCategoryCache();
                scheduleManualRefresh();
                return;
            }
            if (action === 'remove') {
                // Locally remove
                setProducts(prev => prev.filter(p => p.id !== id));
            } else if (payload.product && shouldItemBeVisible(payload.product)) {
                setProducts(prev => {
                    if (sortBy === 'newest') return mergeUniqueProducts([payload.product], prev);
                    return mergeUniqueProducts(prev, [payload.product]);
                });
            } else {
                clearCurrentCategoryCache();
                fetchProducts(1, { shouldAppend: false, force: true });
                return;
            }
            clearCurrentCategoryCache();
        };

        // E. Handle Metadata (Jumbotron/Counts)
        const handleMetadataRefresh = (payload = {}) => {
            const action = String(payload?.action || '').toLowerCase();
            const payloadCategoryName = String(payload?.categoryName || payload?.category?.name || '').toLowerCase();
            const matchesByName = payloadCategoryName && payloadCategoryName === normalizedCategoryName;
            const matchesById = categoryInfo && payload?.categoryId && String(categoryInfo.id) === String(payload.categoryId);
            const touchesCurrentCategory = matchesByName || matchesById;
            fetchCategoryMetadata(true);
            if (action === 'reorder' || action === 'autopilot' || action === 'sync_all') {
                clearCurrentCategoryCache();
                if (touchesCurrentCategory) {
                    refreshLoadedPagesInCurrentSort();
                    return;
                }
            }
            if (action === 'reorder' && payload.orderedProductIds) {
                if (matchesByName || matchesById) {
                    setProducts(prev => reorderByIds(prev, payload.orderedProductIds));
                }
            }
        };

    useAdminCrudSync({
        'product:create': handleProductCreate,
        'product:update': handleProductUpdate,
        'product:delete': handleProductDelete,
        'product:category_change': handleCategoryChange,
        'refresh:categories': handleMetadataRefresh
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
        };
    }, []);

    useEffect(() => {
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
                    category,
                    usageAudience: selectedUsageAudience,
                    subCategory: selectedSubCategory,
                    status: 'active',
                    sort: searchSort,
                    inStockOnly,
                    minPrice: priceRange.min,
                    maxPrice: priceRange.max
                }, { signal: controller.signal });
                setSearchResults(Array.isArray(data?.products) ? data.products : []);
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    console.error('Category search failed', error);
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
    }, [searchTerm, category, sortBy, inStockOnly, priceRange.min, priceRange.max, selectedSubCategory, selectedUsageAudience]);
    // --- 4. Carousel Auto-Slide Logic ---
    useEffect(() => {
        if (otherCategories.length === 0 || isHovered) return;

        const interval = setInterval(() => {
            if (scrollRef.current) {
                const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
                // Loop back logic
                if (scrollLeft + clientWidth >= scrollWidth - 10) {
                    scrollRef.current.scrollTo({ left: 0, behavior: 'smooth' });
                } else {
                    // Scroll 1 item width approx
                    const itemWidth = clientWidth / (window.innerWidth >= 768 ? 5 : 3);
                    scrollRef.current.scrollBy({ left: itemWidth, behavior: 'smooth' });
                }
            }
        }, 3000); 

        return () => clearInterval(interval);
    }, [otherCategories, isHovered]);

    const scrollCarousel = (direction) => {
        if (scrollRef.current) {
            const { clientWidth } = scrollRef.current;
            const itemWidth = clientWidth / (window.innerWidth >= 768 ? 5 : 3);
            const amount = direction === 'left' ? -itemWidth : itemWidth;
            scrollRef.current.scrollBy({ left: amount, behavior: 'smooth' });
        }
    };

    const handleLoadMore = () => {
        if (!hasMore || loadingRef.current) return;
        const loaded = Array.from(loadedPagesRef.current);
        const nextPage = (loaded.length ? Math.max(...loaded) : page) + 1;
        fetchProducts(nextPage, { shouldAppend: true });
    };

    // --- CLIENT-SIDE FILTER & SORT LOGIC ---
    const filteredAndSortedProducts = useMemo(() => {
        let result = [...products];

        // 1. Filter: Availability
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

        // 2. Filter: Price Range
        if (priceRange.min !== '') {
            result = result.filter(p => (p.discount_price || p.mrp) >= Number(priceRange.min));
        }
        if (priceRange.max !== '') {
            result = result.filter(p => (p.discount_price || p.mrp) <= Number(priceRange.max));
        }

        // 3. Sort
        if (sortBy === 'low') {
            result.sort((a, b) => (a.discount_price || a.mrp) - (b.discount_price || b.mrp));
        } else if (sortBy === 'high') {
            result.sort((a, b) => (b.discount_price || b.mrp) - (a.discount_price || a.mrp));
        } else if (sortBy === 'newest' || sortBy === 'default') {
            // Assuming IDs or created_at can be used, or reliance on initial server order (which is newest)
            // If strictly needed: new Date(b.created_at) - new Date(a.created_at)
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
    const hasActiveFilters = Boolean(searchTerm.trim() || inStockOnly || priceRange.min || priceRange.max || selectedSubCategory);
    const clearFilters = useCallback(() => {
        setSearchTerm('');
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
                    <Link to="/shop" className="hover:text-primary">Store</Link>
                    {selectedUsageAudience && (
                        <>
                            <span>/</span>
                            <Link to={`/shop?usageAudience=${encodeURIComponent(selectedUsageAudience)}`} className="hover:text-primary capitalize">
                                {selectedUsageAudience}
                            </Link>
                        </>
                    )}
                    <span>/</span>
                    <span className="font-bold text-gray-800 line-clamp-1 capitalize">{category.replace(/-/g, ' ')}</span>
                </div>
            </div>
            
            {/* Jumbotron (Unchanged) */}
            <div className="relative h-64 md:h-80 bg-gray-900 w-full overflow-visible z-50">
                <div className="absolute inset-0 bg-black/50 z-10"></div>
                <div className="absolute inset-0 overflow-hidden">
                    <img 
                        key={categoryInfo?.image_url} 
                        src={categoryInfo?.image_url || '/placeholder_banner.jpg'} 
                        alt={category}
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-1000 hover:scale-105"
                        onError={(e) => e.target.src = '/placeholder_banner.jpg'}
                    />
                </div>
                <div className="relative z-20 container mx-auto px-4 h-full flex flex-col justify-center items-center text-center">
                    <span className="text-accent uppercase tracking-[0.2em] text-xs md:text-sm font-bold mb-3 animate-fade-in">
                        Exclusive Collection
                    </span>
                    <div className="flex items-center gap-3">
                        <h1 className="text-4xl md:text-6xl font-serif text-white mb-4 capitalize drop-shadow-lg animate-slide-up">
                            {category.replace(/-/g, ' ')}
                        </h1>
                        <div className="relative" ref={shareRef}>
                            <button
                                onClick={handleShareClick}
                                className="p-2 rounded-full bg-white/20 hover:bg-white/30 transition-colors text-white mb-4"
                            >
                                <Share2 size={18} />
                            </button>
                            {isShareOpen && (
                                <div className="absolute left-full ml-3 top-0 w-56 bg-white border border-gray-200 shadow-2xl rounded-xl p-3 z-[70]">
                                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Share</p>
                                    <div className="grid grid-cols-2 gap-2">
                                        <a onClick={() => setIsShareOpen(false)} className="text-xs font-semibold text-gray-700 border border-gray-200 rounded-lg py-2 text-center hover:bg-gray-50 flex items-center justify-center gap-1" href={shareLinks.whatsapp} target="_blank" rel="noreferrer">
                                            <MessageCircle size={14} className="text-green-500" /> WhatsApp
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

            {/* Toolbar - Fixed below Navbar */}
            <div className="sticky top-[64px] z-40 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm w-full transition-all duration-300">
                <div className="container mx-auto px-4 py-3">
                    <div className="flex justify-between items-center">
                        {/* Filter Toggle */}
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

                        {/* Sort Dropdown */}
                        <div className="relative group">
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
                    <div className="mt-2 text-xs text-gray-500">
                        {displayProducts.length} results
                    </div>

                    {/* Expandable Filter Panel */}
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
                            {subCategoriesEnabled && availableSubCategories.length > 0 && (
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-gray-600 font-medium">Sub Category:</span>
                                    <select
                                        value={selectedSubCategory}
                                        onChange={(e) => updateFilterParams({ subCategory: e.target.value, usageAudience: selectedUsageAudience })}
                                        className="px-3 py-1.5 text-sm border border-gray-300 rounded-md focus:outline-none focus:border-primary bg-white"
                                    >
                                        <option value="">All Sub Categories</option>
                                        {availableSubCategories.map((subCategory) => (
                                            <option key={subCategory} value={subCategory}>{subCategory}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            
                            {/* Availability Toggle */}
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

                            {/* Price Range */}
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

                            {/* Clear Button */}
                            {hasActiveFilters && (
                                <button 
                                    onClick={() => {
                                        clearFilters();
                                        updateFilterParams({ subCategory: '', usageAudience: selectedUsageAudience });
                                    }}
                                    className="text-xs text-red-500 hover:text-red-700 font-bold ml-auto md:ml-0"
                                >
                                    Clear Filters
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Product Grid */}
            <main className="container mx-auto px-4 py-8">
                {/* [FIX 1] Check filtered list length instead of raw products */}
                {displayProducts.length > 0 ? (
                    <>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 md:gap-8">
                            {/* [FIX 2] Map over filteredAndSortedProducts */}
                            {displayProducts.map((product) => (
                                <ProductCard key={product.id} product={product} displayCategory={decodeURIComponent(category)} />
                            ))}
                        </div>

                        {isSearchLoading && searchTerm.trim() && (
                            <div className="mt-5 text-center text-sm text-gray-500">
                                Searching...
                            </div>
                        )}
                        {/* Load More Button (Only show if we haven't filtered everything out locally) */}
                        {hasMore && !searchTerm.trim() && displayProducts.length >= PAGE_LIMIT && (
                            <div className="mt-12 text-center">
                                <button 
                                    onClick={handleLoadMore}
                                    disabled={isLoading}
                                    className="px-8 py-3 bg-white border border-gray-200 text-gray-800 rounded-full font-bold hover:bg-gray-50 transition-all shadow-sm flex items-center gap-2 mx-auto disabled:opacity-50"
                                >
                                    {isLoading ? <Loader2 className="animate-spin" size={20}/> : 'Load More Products'}
                                </button>
                            </div>
                        )}
                    </>
                ) : (
                    !isLoading && !isSearchLoading && (
                        <EmptyState
                            image={emptyIllustration}
                            alt="No products found"
                            title="No products found"
                            description="Try adjusting your filters or browse another category."
                            action={(
                                <button
                                    onClick={() => { setInStockOnly(false); setPriceRange({ min: '', max: '' }); }}
                                    className="text-primary font-bold hover:underline"
                                >
                                    Clear Filters
                                </button>
                            )}
                        />
                    )
                )}
                
                {/* [FIX 3] Update Skeleton Loader Check */}
                {isLoading && filteredAndSortedProducts.length === 0 && (
                     <div className="grid grid-cols-2 md:grid-cols-4 gap-4 animate-pulse">
                        {[...Array(4)].map((_,i) => <div key={i} className="bg-gray-200 h-64 rounded-xl"></div>)}
                     </div>
                )}
                {isSearchLoading && displayProducts.length === 0 && (
                    <div className="flex justify-center py-12 text-sm text-gray-500">
                        <Loader2 className="animate-spin mr-2" size={18} /> Searching...
                    </div>
                )}
            </main>

            {/* --- EXPLORE CAROUSEL --- */}
            {otherCategories.length > 0 && (
                <section className="border-t border-gray-100 bg-white py-10 mt-8 w-full">
                    <div className="container mx-auto px-4 relative group/carousel"
                         onMouseEnter={() => setIsHovered(true)}
                         onMouseLeave={() => setIsHovered(false)}
                    >
                        <div className="flex justify-between items-end mb-6">
                            <h3 className="text-xl md:text-2xl font-serif text-gray-900">Explore Collections</h3>
                            <div className="hidden md:flex gap-2">
                                <button onClick={() => scrollCarousel('left')} className="p-2 rounded-full border hover:bg-gray-100"><ChevronLeft size={20}/></button>
                                <button onClick={() => scrollCarousel('right')} className="p-2 rounded-full border hover:bg-gray-100"><ChevronRight size={20}/></button>
                            </div>
                        </div>
                        
                        {/* Carousel Container */}
                        <div 
                            ref={scrollRef}
                            // [FIX] Added arbitrary values to hide scrollbar cross-browser
                            className="flex overflow-x-auto snap-x snap-mandatory scroll-smooth w-full [&::-webkit-scrollbar]:hidden [-ms-overflow-style:'none'] [scrollbar-width:'none']"
                        >
                            {otherCategories.map((cat) => (
                                <Link
                                    key={cat.id} 
                                    to={`/shop/${encodeURIComponent(cat.name)}${selectedUsageAudience || selectedSubCategory ? `?${new URLSearchParams({
                                        ...(selectedUsageAudience ? { usageAudience: selectedUsageAudience } : {}),
                                        ...(selectedSubCategory ? { subCategory: selectedSubCategory } : {})
                                    }).toString()}` : ''}`}
                                    // [FIX] w-1/3 (33%) for Mobile, md:w-1/5 (20%) for Desktop
                                    className="w-1/3 md:w-1/5 min-w-[33.33%] md:min-w-[20%] snap-start cursor-pointer group flex-shrink-0 p-2 box-border"
                                >
                                    <div className="aspect-square rounded-full overflow-hidden border-2 border-transparent group-hover:border-primary transition-all p-1 bg-gray-50 mb-3 relative mx-auto max-w-[120px]">
                                        <div className="w-full h-full rounded-full overflow-hidden flex items-center justify-center bg-gray-100 text-gray-300">
                                            {cat.image_url ? (
                                                <img 
                                                    src={cat.image_url} 
                                                    alt={cat.name} 
                                                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                                    onError={(e) => { e.target.style.display = 'none'; e.target.nextSibling.style.display = 'flex'; }}
                                                />
                                            ) : (
                                                <Folder size={32} strokeWidth={1.5} />
                                            )}
                                            <div className="hidden w-full h-full absolute inset-0 items-center justify-center bg-gray-100">
                                                <Folder size={32} strokeWidth={1.5} />
                                            </div>
                                        </div>
                                    </div>
                                    <h4 className="text-center text-xs md:text-sm font-bold text-gray-700 group-hover:text-primary line-clamp-1">
                                        {cat.name}
                                    </h4>
                                </Link>
                            ))}
                        </div>

                        {/* Mobile Arrows */}
                        <button onClick={() => scrollCarousel('left')} className="md:hidden absolute left-2 top-1/2 -translate-y-1/2 bg-white/90 p-2 rounded-full shadow-lg z-10 text-gray-600">
                            <ChevronLeft size={18}/>
                        </button>
                        <button onClick={() => scrollCarousel('right')} className="md:hidden absolute right-2 top-1/2 -translate-y-1/2 bg-white/90 p-2 rounded-full shadow-lg z-10 text-gray-600">
                            <ChevronRight size={18}/>
                        </button>
                    </div>
                </section>
            )}
            <button
                onClick={scrollToTop}
                className={`fixed bottom-8 right-8 z-50 p-3 rounded-full bg-primary text-white shadow-lg transition-all duration-300 transform hover:scale-110 hover:bg-primary-dark ${
                    showTopBtn ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-10 pointer-events-none'
                }`}
                aria-label="Scroll to top"
            >
                <ArrowUp size={24} />
            </button>
        </div>
    );
}
