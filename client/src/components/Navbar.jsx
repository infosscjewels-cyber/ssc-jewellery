import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Menu, X, User, LogOut, ShoppingCart, ChevronDown, Heart, Search, Medal, Crown, Gem } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useCart } from '../context/CartContext';
import { productService } from '../services/productService';
import emptyIllustration from '../assets/closed.svg';
import placeholderImg from '../assets/placeholder.jpg';
import { useAdminCrudSync } from '../hooks/useAdminCrudSync';
import { usePublicCategories, usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import { formatTierLabel } from '../utils/tierFormat';
import { BRAND_LOGO_URL } from '../utils/branding.js';
import EmptyState from './EmptyState';

const TIER_STYLES = {
    regular: {
        badge: 'bg-slate-100 text-slate-700 border-slate-200',
        userBtn: 'text-slate-700 bg-slate-100 hover:bg-slate-200',
        userBtnActive: 'text-white bg-slate-700',
        profileRing: 'border-slate-300'
    },
    bronze: {
        badge: 'bg-amber-100 text-amber-800 border-amber-200',
        userBtn: 'text-amber-900 bg-amber-100 hover:bg-amber-200',
        userBtnActive: 'text-white bg-amber-800',
        profileRing: 'border-amber-400'
    },
    silver: {
        badge: 'bg-zinc-100 text-zinc-700 border-zinc-200',
        userBtn: 'text-zinc-700 bg-zinc-100 hover:bg-zinc-200',
        userBtnActive: 'text-white bg-zinc-700',
        profileRing: 'border-zinc-400'
    },
    gold: {
        badge: 'bg-yellow-100 text-yellow-800 border-yellow-200',
        userBtn: 'text-yellow-900 bg-yellow-100 hover:bg-yellow-200',
        userBtnActive: 'text-white bg-yellow-700',
        profileRing: 'border-yellow-400'
    },
    platinum: {
        badge: 'bg-sky-100 text-sky-800 border-sky-200',
        userBtn: 'text-sky-900 bg-sky-100 hover:bg-sky-200',
        userBtnActive: 'text-white bg-sky-700',
        profileRing: 'border-sky-400'
    }
};

const TIER_ICON_CONFIG = {
    regular: { Icon: User, className: 'text-slate-600' },
    bronze: { Icon: Medal, className: 'text-amber-700' },
    silver: { Icon: Medal, className: 'text-zinc-600' },
    gold: { Icon: Crown, className: 'text-yellow-700' },
    platinum: { Icon: Gem, className: 'text-sky-700' }
};

const NAV_SEARCH_SEED_KEY = 'nav_search_seed_v1';
const MAX_SEARCH_RESULTS = 8;
const SEARCH_SEED_LIMIT = 60;

const readSeedCache = () => {
    try {
        const raw = localStorage.getItem(NAV_SEARCH_SEED_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

const writeSeedCache = (products = []) => {
    try {
        localStorage.setItem(NAV_SEARCH_SEED_KEY, JSON.stringify(products));
    } catch {
        // ignore storage errors
    }
};

const getMediaThumbnail = (product = {}) => {
    const mediaList = Array.isArray(product?.media) ? product.media : [];
    const image = mediaList.find((entry) => entry?.type === 'image' && entry?.url);
    return image?.url || placeholderImg;
};

const getPriceLabel = (product = {}) => {
    const discount = Number(product?.discount_price || 0);
    const mrp = Number(product?.mrp || 0);
    if (discount > 0 && mrp > 0 && discount < mrp) return `₹${discount.toLocaleString('en-IN')}`;
    if (mrp > 0) return `₹${mrp.toLocaleString('en-IN')}`;
    return 'View Product';
};

export default function Navbar() {
    const { user, logout } = useAuth();
    const { itemCount, openCart } = useCart();
    const { companyInfo } = usePublicCompanyInfo();
    const [shakeCart, setShakeCart] = useState(false);
    const [popBadge, setPopBadge] = useState(false);
    const prevCountRef = useRef(itemCount);
    const navigate = useNavigate();
    const location = useLocation();
    
    // UI States
    const [isOpen, setIsOpen] = useState(false);
    const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
    const [isMegaOpen, setIsMegaOpen] = useState(false);
    const { categories, isLoadingCategories, refreshCategories } = usePublicCategories();
    const userMenuRef = useRef(null);
    const megaMenuRef = useRef(null);
    const megaTriggerRef = useRef(null);
    const refreshTimerRef = useRef(null);
    const desktopSearchRef = useRef(null);
    const mobileSearchRef = useRef(null);
    const searchDebounceRef = useRef(null);
    const searchAbortRef = useRef(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [seedProducts, setSeedProducts] = useState([]);
    const seedProductsRef = useRef([]);
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [isSearchLoading, setIsSearchLoading] = useState(false);
    const subCategoriesEnabled = companyInfo?.subCategoriesEnabled === true;
    const [activeMegaCategory, setActiveMegaCategory] = useState('');

   

    // Close User Menu on Click Outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
                setIsUserMenuOpen(false);
            }
            const clickedInsideDesktop = desktopSearchRef.current?.contains(event.target);
            const clickedInsideMobile = mobileSearchRef.current?.contains(event.target);
            if (!clickedInsideDesktop && !clickedInsideMobile) {
                setIsSearchOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (!isMegaOpen) return;
        const handleClickOutside = (event) => {
            if (megaMenuRef.current?.contains(event.target)) return;
            if (megaTriggerRef.current?.contains(event.target)) return;
            setIsMegaOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isMegaOpen]);

    useEffect(() => {
        setIsUserMenuOpen(false);
        setIsMegaOpen(false);
        setIsOpen(false);
        setIsSearchOpen(false);
    }, [location.pathname]);

    useEffect(() => {
        if (itemCount > prevCountRef.current) {
            setShakeCart(true);
            setPopBadge(true);
            const t = setTimeout(() => setShakeCart(false), 400);
            const b = setTimeout(() => setPopBadge(false), 250);
            prevCountRef.current = itemCount;
            return () => { clearTimeout(t); clearTimeout(b); };
        }
        prevCountRef.current = itemCount;
    }, [itemCount]);

    useEffect(() => {
        refreshCategories().catch((error) => {
            console.error('Failed to load categories for mega menu', error);
        });
    }, [refreshCategories]);

    useEffect(() => {
        if (!isMegaOpen) return;
        refreshCategories().catch((error) => {
            console.error('Failed to refresh categories for mega menu', error);
        });
    }, [isMegaOpen, refreshCategories]);

    useAdminCrudSync({
        'refresh:categories': () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                refreshCategories(true).catch(() => {});
            }, 120);
        },
        'product:category_change': () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                refreshCategories(true).catch(() => {});
            }, 120);
        },
        'product:create': () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                refreshCategories(true).catch(() => {});
            }, 120);
        },
        'product:update': () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                refreshCategories(true).catch(() => {});
            }, 120);
        },
        'product:delete': () => {
            if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
            refreshTimerRef.current = setTimeout(() => {
                refreshCategories(true).catch(() => {});
            }, 120);
        }
    });

    useEffect(() => {
        return () => {
            if (refreshTimerRef.current) {
                clearTimeout(refreshTimerRef.current);
                refreshTimerRef.current = null;
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

    const runLocalSearch = useCallback((query, source) => {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return [];
        return (Array.isArray(source) ? source : [])
            .filter((product) => {
                const haystack = [
                    product?.title,
                    product?.subtitle,
                    product?.sku
                ].map((value) => String(value || '').toLowerCase()).join(' ');
                return haystack.includes(q);
            })
            .slice(0, MAX_SEARCH_RESULTS);
    }, []);

    useEffect(() => {
        const seeded = readSeedCache();
        if (seeded.length > 0) {
            setSeedProducts(seeded);
        }
    }, []);

    useEffect(() => {
        seedProductsRef.current = Array.isArray(seedProducts) ? seedProducts : [];
    }, [seedProducts]);

    useEffect(() => {
        if (!isSearchOpen && !String(searchQuery || '').trim()) return;
        if (seedProductsRef.current.length > 0) return;
        let cancelled = false;
        const warmSeed = async () => {
            try {
                const data = await productService.getProducts(1, 'all', 'active', 'newest', SEARCH_SEED_LIMIT);
                const list = Array.isArray(data?.products) ? data.products : [];
                if (!cancelled && list.length > 0) {
                    setSeedProducts(list);
                    writeSeedCache(list);
                }
            } catch {
                // no-op
            }
        };
        warmSeed();
        return () => {
            cancelled = true;
        };
    }, [isSearchOpen, searchQuery]);

    useEffect(() => {
        const q = String(searchQuery || '').trim();
        if (!q) {
            setSearchResults([]);
            setIsSearchLoading(false);
            if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
            if (searchAbortRef.current) searchAbortRef.current.abort();
            return;
        }

        const localMatches = runLocalSearch(q, seedProductsRef.current);
        setSearchResults(localMatches);
        setIsSearchOpen(true);

        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = setTimeout(async () => {
            if (searchAbortRef.current) searchAbortRef.current.abort();
            const controller = new AbortController();
            searchAbortRef.current = controller;
            setIsSearchLoading(true);
            try {
                const data = await productService.searchProducts(
                    {
                        query: q,
                        page: 1,
                        limit: MAX_SEARCH_RESULTS,
                        status: 'active',
                        sort: 'relevance'
                    },
                    { signal: controller.signal }
                );
                const remote = Array.isArray(data?.products) ? data.products : [];
                setSearchResults((prev) => {
                    const merged = [...(Array.isArray(prev) ? prev : []), ...remote];
                    const seen = new Set();
                    const deduped = [];
                    merged.forEach((item) => {
                        const id = String(item?.id || '').trim();
                        if (!id || seen.has(id)) return;
                        seen.add(id);
                        deduped.push(item);
                    });
                    return deduped.slice(0, MAX_SEARCH_RESULTS);
                });
                if (remote.length > 0) {
                    setSeedProducts((prev) => {
                        const merged = [...remote, ...(Array.isArray(prev) ? prev : [])];
                        const seen = new Set();
                        const deduped = [];
                        merged.forEach((item) => {
                            const id = String(item?.id || '').trim();
                            if (!id || seen.has(id)) return;
                            seen.add(id);
                            deduped.push(item);
                        });
                        const limited = deduped.slice(0, 250);
                        writeSeedCache(limited);
                        return limited;
                    });
                }
            } catch (error) {
                if (error?.name !== 'AbortError') {
                    console.error('Navbar search failed:', error);
                }
            } finally {
                if (searchAbortRef.current === controller) searchAbortRef.current = null;
                setIsSearchLoading(false);
            }
        }, 120);
    }, [runLocalSearch, searchQuery]);

    const handleSearchSelect = (productId) => {
        const id = String(productId || '').trim();
        if (!id) return;
        setIsSearchOpen(false);
        setSearchQuery('');
        setIsOpen(false);
        navigate(`/product/${encodeURIComponent(id)}`);
    };

    const handleLogout = async () => {
        await logout();
        setIsUserMenuOpen(false);
        navigate('/login');
    };

    const navLinks = [
        { name: 'Home', path: '/' },
        { name: 'About', path: '/about' },
        { name: 'Contact', path: '/contact' },
    ];

    const isActive = (path) => location.pathname === path;
    const isShopActive = () => location.pathname === '/shop' || location.pathname.startsWith('/shop/');
    const cachedUser = (() => {
        try {
            return JSON.parse(localStorage.getItem('user') || 'null');
        } catch {
            return null;
        }
    })();
    const tier = String(user?.loyaltyTier || cachedUser?.loyaltyTier || 'regular').toLowerCase();
    const tierStyle = TIER_STYLES[tier] || TIER_STYLES.regular;
    const tierIconConfig = TIER_ICON_CONFIG[tier] || TIER_ICON_CONFIG.regular;
    const TierIcon = tierIconConfig.Icon;
    const tierLabel = formatTierLabel(user?.loyaltyProfile?.label || cachedUser?.loyaltyProfile?.label || tier);
    const showTierBadge = (user || cachedUser) && tier !== 'regular';
    const effectiveUser = user || cachedUser;
    const usageAudienceItems = useMemo(() => {
        if (companyInfo?.usageAudienceEnabled !== true) return [];
        return [
            { key: 'men', label: 'Men', imageUrl: companyInfo?.usageAudienceMenImageUrl || '' },
            { key: 'women', label: 'Women', imageUrl: companyInfo?.usageAudienceWomenImageUrl || '' },
            { key: 'kids', label: 'Kids', imageUrl: companyInfo?.usageAudienceKidsImageUrl || '' }
        ].filter((item) => item.imageUrl);
    }, [companyInfo?.usageAudienceEnabled, companyInfo?.usageAudienceKidsImageUrl, companyInfo?.usageAudienceMenImageUrl, companyInfo?.usageAudienceWomenImageUrl]);
    const megaMenuCategories = useMemo(() => (
        (Array.isArray(categories) ? categories : []).map((category) => ({
            ...category,
            name: String(category?.name || '').trim(),
            subCategories: Array.isArray(category?.subCategories)
                ? category.subCategories.filter((entry) => String(entry || '').trim())
                : []
        })).filter((category) => category.name)
    ), [categories]);
    const selectedMegaCategory = useMemo(() => {
        const fallback = megaMenuCategories[0] || null;
        if (!activeMegaCategory) return fallback;
        return megaMenuCategories.find((category) => category.name === activeMegaCategory) || fallback;
    }, [activeMegaCategory, megaMenuCategories]);

    useEffect(() => {
        if (!isMegaOpen || !subCategoriesEnabled) return;
        if (selectedMegaCategory?.name) return;
        if (megaMenuCategories[0]?.name) {
            setActiveMegaCategory(megaMenuCategories[0].name);
        }
    }, [isMegaOpen, subCategoriesEnabled, megaMenuCategories, selectedMegaCategory]);
    const handleCartClick = () => {
        setIsUserMenuOpen(false);
        setIsMegaOpen(false);
        setIsOpen(false);
        openCart();
    };

    return (
        // [FIX] Dynamic Classes for Animation
        // - 'py-4' -> 'py-2': Shrinks height
        // - 'shadow-none' -> 'shadow-md': Adds depth
        <nav className={`fixed top-0 w-full z-[80] bg-white/90 backdrop-blur-2xl transition-all duration-300 ease-in-out py-4 shadow-sm border-b border-white/70`}>
            <div className="container mx-auto px-4 md:px-8">
                <div className="flex justify-between items-center">
                    
                    
                    <Link to="/" className="flex items-center gap-2.5 min-w-0 group">
                        <img 
                            src={BRAND_LOGO_URL} 
                            alt="Logo" 
                            className="h-10 w-auto shrink-0 object-contain transition-all duration-300"
                            decoding="async"
                            fetchPriority="high"
                        />
                        <span className="flex min-w-0 flex-col justify-center leading-none">
                            <span className="truncate font-serif text-[1.05rem] font-bold tracking-[0.08em] text-primary transition-all duration-300 md:text-[1.2rem]">
                                Sree Sai Collections
                            </span>
                            <span className="mt-1 inline-flex w-fit max-w-full items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-amber-800 md:text-[10px]">
                                1 gm Imitiation Jewellery
                            </span>
                        </span>
                    </Link>

                    {/* Desktop Links */}
                    <div className="hidden md:flex items-center gap-8">
                        {navLinks.slice(0, 1).map((link) => (
                            <Link key={link.name} to={link.path} className={`text-sm font-medium tracking-wide transition-colors relative group ${isActive(link.path) ? 'text-accent-deep' : 'text-gray-600 hover:text-accent-deep'}`}>
                                {link.name}
                                <span className={`absolute -bottom-1 left-0 w-0 h-0.5 bg-accent transition-all duration-300 group-hover:w-full ${isActive(link.path) ? 'w-full' : ''}`}></span>
                            </Link>
                        ))}

                        <div className="relative flex items-center gap-2" ref={megaTriggerRef}>
                            <Link
                                to="/shop"
                                className={`text-sm font-medium tracking-wide transition-colors relative group ${isShopActive() ? 'text-accent-deep' : 'text-gray-600 hover:text-accent-deep'}`}
                            >
                                Shop
                                <span className={`absolute -bottom-1 left-0 w-0 h-0.5 bg-accent transition-all duration-300 group-hover:w-full ${isShopActive() ? 'w-full' : ''}`}></span>
                            </Link>
                            <button
                                type="button"
                                aria-label="Toggle shop categories"
                                aria-expanded={isMegaOpen}
                                onClick={() => setIsMegaOpen((prev) => !prev)}
                                className="p-1 rounded-full text-gray-500 hover:text-primary hover:bg-gray-100 transition-colors"
                            >
                                <ChevronDown
                                    size={18}
                                    className={`transition-transform duration-200 ${isMegaOpen ? 'rotate-180' : 'rotate-0'}`}
                                />
                            </button>

                            <div
                                ref={megaMenuRef}
                                className={`absolute left-1/2 top-full mt-6 ${subCategoriesEnabled ? 'w-[980px]' : 'w-[760px]'} max-w-[90vw] -translate-x-1/2 rounded-2xl border border-gray-100 bg-white shadow-2xl transition-all duration-200 ${
                                    isMegaOpen ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 -translate-y-2 pointer-events-none'
                                }`}
                            >
                                <div className="p-6 max-h-[calc(100vh-8rem)] overflow-y-auto">
                                    <div className="flex items-center justify-between">
                                        <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Browse Categories</p>
                                        <Link to="/shop" className="text-xs font-semibold text-accent-deep hover:text-primary transition-colors">
                                            View All
                                        </Link>
                                    </div>
                                    <div className={`mt-5 ${subCategoriesEnabled ? 'grid grid-cols-[280px_minmax(0,1fr)] gap-6 items-start' : 'grid grid-cols-2 lg:grid-cols-3 gap-4'}`}>
                                        {isLoadingCategories && (
                                            <div className={`${subCategoriesEnabled ? 'lg:col-span-2' : 'col-span-2 lg:col-span-3'} text-sm text-gray-500`}>
                                                Loading categories...
                                            </div>
                                        )}
                                        {!isLoadingCategories && megaMenuCategories.length === 0 && (
                                            <div className={`${subCategoriesEnabled ? 'lg:col-span-2' : 'col-span-2 lg:col-span-3'}`}>
                                                <EmptyState
                                                    image={emptyIllustration}
                                                    alt="No categories available"
                                                    title="No categories available yet"
                                                    description="Categories will appear here once products are ready to browse."
                                                    compact
                                                />
                                            </div>
                                        )}
                                        {!isLoadingCategories && subCategoriesEnabled && (
                                            <>
                                                <div className="rounded-2xl border border-gray-100 bg-gray-50/70 p-3 max-h-[420px] overflow-y-auto">
                                                    <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-widest text-gray-400">Categories</p>
                                                    <div className="space-y-1">
                                                        {megaMenuCategories.map((category) => {
                                                            const categoryName = category.name;
                                                            const categoryId = category?.id ?? categoryName;
                                                            const isActiveCategory = selectedMegaCategory?.name === categoryName;
                                                            return (
                                                                <button
                                                                    key={`cat-${categoryId}`}
                                                                    type="button"
                                                                    onMouseEnter={() => setActiveMegaCategory(categoryName)}
                                                                    onFocus={() => setActiveMegaCategory(categoryName)}
                                                                    onClick={() => setActiveMegaCategory(categoryName)}
                                                                    className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors ${
                                                                        isActiveCategory ? 'bg-white shadow-sm ring-1 ring-gray-100' : 'hover:bg-white/80'
                                                                    }`}
                                                                >
                                                                    <div className="h-11 w-11 rounded-full bg-gray-100 shadow-inner overflow-hidden shrink-0">
                                                                        <img
                                                                            src={category?.image_url || '/placeholder_banner.jpg'}
                                                                            alt={categoryName}
                                                                            className="h-full w-full object-cover"
                                                                            onError={(e) => { e.currentTarget.src = '/placeholder_banner.jpg'; }}
                                                                        />
                                                                    </div>
                                                                    <div className="min-w-0 flex-1">
                                                                        <p className="truncate text-sm font-semibold text-gray-800">{categoryName}</p>
                                                                        {typeof category.product_count === 'number' && (
                                                                            <p className="text-xs text-gray-400">{category.product_count} items</p>
                                                                        )}
                                                                    </div>
                                                                    <ChevronDown size={16} className={`shrink-0 text-gray-300 transition-transform ${isActiveCategory ? '-rotate-90' : ''}`} />
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                                <div className="rounded-2xl border border-gray-100 bg-white p-5 shadow-sm min-h-[320px] max-h-[420px] overflow-y-auto">
                                                    {selectedMegaCategory ? (
                                                        <>
                                                            <div className="flex items-center justify-between gap-4">
                                                                <div>
                                                                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Sub Categories</p>
                                                                    <h3 className="mt-2 text-lg font-bold text-gray-900">{selectedMegaCategory.name}</h3>
                                                                </div>
                                                                <Link
                                                                    to={`/shop/${encodeURIComponent(selectedMegaCategory.name)}`}
                                                                    onClick={() => setIsMegaOpen(false)}
                                                                    className="text-xs font-semibold text-accent-deep hover:text-primary transition-colors"
                                                                >
                                                                    View Category
                                                                </Link>
                                                            </div>
                                                            {selectedMegaCategory.subCategories.length > 0 ? (
                                                                <div className="mt-5 grid grid-cols-2 gap-x-8 gap-y-3">
                                                                    {selectedMegaCategory.subCategories.map((subCategory) => (
                                                                        <Link
                                                                            key={`${selectedMegaCategory.id || selectedMegaCategory.name}-${subCategory}`}
                                                                            to={`/shop/${encodeURIComponent(selectedMegaCategory.name)}?subCategory=${encodeURIComponent(subCategory)}`}
                                                                            onClick={() => setIsMegaOpen(false)}
                                                                            className="group inline-flex items-center gap-2 py-1 text-sm font-medium text-gray-700 transition-colors hover:text-primary"
                                                                        >
                                                                            <span className="text-gray-300 transition-colors group-hover:text-primary">/</span>
                                                                            {subCategory}
                                                                        </Link>
                                                                    ))}
                                                                </div>
                                                            ) : (
                                                                <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-400">
                                                                    No subcategories added yet for this category.
                                                                </div>
                                                            )}
                                                        </>
                                                    ) : null}
                                                </div>
                                            </>
                                        )}
                                        {!isLoadingCategories && !subCategoriesEnabled && megaMenuCategories.map((category) => {
                                            const categoryName = category.name;
                                            if (!categoryName) return null;
                                            const categoryId = category?.id ?? categoryName;
                                            return (
                                            <Link
                                                key={`cat-${categoryId}`}
                                                to={`/shop/${encodeURIComponent(categoryName)}`}
                                                onClick={() => setIsMegaOpen(false)}
                                                className="group flex items-center gap-3 rounded-xl border border-transparent p-3 transition-all hover:border-gray-100 hover:bg-gray-50"
                                            >
                                                <div className="h-12 w-12 rounded-full bg-gray-100 shadow-inner overflow-hidden">
                                                    <img
                                                        src={category?.image_url || '/placeholder_banner.jpg'}
                                                        alt={categoryName}
                                                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                        onError={(e) => { e.currentTarget.src = '/placeholder_banner.jpg'; }}
                                                    />
                                                </div>
                                                <div className="flex flex-col">
                                                    <span className="text-sm font-semibold text-gray-800 group-hover:text-primary transition-colors">
                                                        {categoryName}
                                                    </span>
                                                    {typeof category.product_count === 'number' && (
                                                        <span className="text-xs text-gray-400">{category.product_count} items</span>
                                                    )}
                                                </div>
                                            </Link>
                                            );
                                        })}
                                    </div>
                                    {usageAudienceItems.length > 0 && (
                                        <>
                                            <div className="mt-8 flex items-center justify-between">
                                                <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Browse by Usage</p>
                                            </div>
                                            <div className="mt-5 grid grid-cols-2 lg:grid-cols-3 gap-4">
                                                {usageAudienceItems.map((item) => (
                                                    <Link
                                                        key={`usage-${item.key}`}
                                                        to={`/shop?usageAudience=${encodeURIComponent(item.key)}`}
                                                        onClick={() => setIsMegaOpen(false)}
                                                        className="group flex items-center gap-3 rounded-xl border border-transparent p-3 transition-all hover:border-gray-100 hover:bg-gray-50"
                                                    >
                                                        <div className="h-12 w-12 rounded-full bg-gray-100 shadow-inner overflow-hidden shrink-0">
                                                            <img
                                                                src={item.imageUrl}
                                                                alt={item.label}
                                                                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                                                            />
                                                        </div>
                                                        <div className="flex flex-col min-w-0">
                                                            <span className="text-sm font-semibold text-gray-800 group-hover:text-primary transition-colors">
                                                                {item.label}
                                                            </span>
                                                            <span className="text-xs text-gray-400">Shop {item.label.toLowerCase()}</span>
                                                        </div>
                                                    </Link>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        </div>

                        {navLinks.slice(1).map((link) => (
                            <Link key={link.name} to={link.path} className={`text-sm font-medium tracking-wide transition-colors relative group ${isActive(link.path) ? 'text-accent-deep' : 'text-gray-600 hover:text-accent-deep'}`}>
                                {link.name}
                                <span className={`absolute -bottom-1 left-0 w-0 h-0.5 bg-accent transition-all duration-300 group-hover:w-full ${isActive(link.path) ? 'w-full' : ''}`}></span>
                            </Link>
                        ))}
                    </div>

                    <div className="hidden lg:block flex-1 max-w-sm mx-4 xl:max-w-md xl:mx-6" ref={desktopSearchRef}>
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                type="search"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                onFocus={() => {
                                    if (String(searchQuery || '').trim()) setIsSearchOpen(true);
                                }}
                                placeholder="Search products..."
                                className="w-full rounded-xl border border-gray-200 bg-white px-10 py-2.5 text-sm text-gray-700 outline-none focus:border-accent"
                            />
                            {isSearchOpen && (
                                <div className="absolute top-full mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden z-[90]">
                                    {searchResults.length === 0 && !isSearchLoading && (
                                        <EmptyState
                                            image={emptyIllustration}
                                            alt="No products found"
                                            title="No products found"
                                            description="Try a different product name or keyword."
                                            compact
                                            className="px-2"
                                        />
                                    )}
                                    <div className="max-h-80 overflow-y-auto">
                                        {searchResults.map((product) => (
                                            <button
                                                key={`nav-search-${product.id}`}
                                                type="button"
                                                onClick={() => handleSearchSelect(product.id)}
                                                className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b last:border-b-0 border-gray-100"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <img
                                                        src={getMediaThumbnail(product)}
                                                        alt={product?.title || 'Product'}
                                                        className="w-10 h-10 rounded-lg object-cover border border-gray-100"
                                                        onError={(e) => { e.currentTarget.src = placeholderImg; }}
                                                    />
                                                    <div className="min-w-0">
                                                        <p className="text-sm font-medium text-gray-800 truncate">{product?.title || 'Untitled Product'}</p>
                                                        <p className="text-xs text-gray-500 truncate">{getPriceLabel(product)}</p>
                                                    </div>
                                                </div>
                                            </button>
                                        ))}
                                    </div>
                                    {isSearchLoading && (
                                        <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">Searching...</p>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="hidden md:flex items-center gap-4 relative" ref={userMenuRef}>
                        {showTierBadge && (
                            <span className={`px-2.5 py-1 rounded-full border text-[10px] tracking-widest font-bold ${tierStyle.badge}`}>
                                {tierLabel}
                            </span>
                        )}
                        <button 
                            type="button"
                            onClick={handleCartClick}
                            className={`relative p-2 rounded-full hover:bg-gray-100 text-gray-600 hover:text-primary transition-colors ${shakeCart ? 'cart-shake' : ''}`}
                        >
                            <ShoppingCart size={22} strokeWidth={2} />
                            {itemCount > 0 && (
                                <span className={`absolute -top-1 -right-1 bg-primary text-accent text-[10px] font-bold rounded-full w-5 h-5 flex items-center justify-center ${popBadge ? 'cart-pop' : ''}`}>
                                    {itemCount}
                                </span>
                            )}
                        </button>
                        {effectiveUser ? (
                            <>
                                <button onClick={() => setIsUserMenuOpen(!isUserMenuOpen)} className={`p-2 rounded-full transition-colors ${isUserMenuOpen ? tierStyle.userBtnActive : tierStyle.userBtn}`}>
                                    {effectiveUser.profileImage ? (
                                        <img
                                            src={effectiveUser.profileImage}
                                            alt={effectiveUser.name || 'Profile'}
                                            className={`w-6 h-6 rounded-full object-cover border-2 ${tierStyle.profileRing}`}
                                        />
                                    ) : (
                                        <User size={22} strokeWidth={2} />
                                    )}
                                </button>
                                {isUserMenuOpen && (
                                    <div className="absolute top-full right-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 py-2 animate-in fade-in slide-in-from-top-2 overflow-hidden">
                                        <div className="px-4 py-2 border-b border-gray-50">
                                            <p className="text-xs text-gray-500 font-bold uppercase">Hi, {effectiveUser.name}</p>
                                            <div className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5">
                                                <TierIcon size={12} className={tierIconConfig.className} />
                                                <span className="text-[10px] font-bold uppercase tracking-wide text-gray-600">{tierLabel}</span>
                                            </div>
                                        </div>
                                        <Link to="/profile" onClick={() => setIsUserMenuOpen(false)} className="block px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors">My Profile</Link>
                                        <Link to="/wishlist" onClick={() => setIsUserMenuOpen(false)} className="block px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors">My Wishlist</Link>
                                        <Link to="/orders" onClick={() => setIsUserMenuOpen(false)} className="block px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors">My Orders</Link>
                                        <Link to="/track-order" onClick={() => setIsUserMenuOpen(false)} className="block px-4 py-2 text-sm font-semibold text-slate-700 hover:text-slate-900 hover:bg-slate-100 transition-colors">Track Order</Link>
                                        <button onClick={handleLogout} className="w-full text-left px-4 py-2 text-sm font-semibold text-red-600 hover:text-red-700 hover:bg-red-50 transition-colors flex items-center gap-2 border-t border-gray-100 mt-1">
                                            <LogOut size={16} /> Logout
                                        </button>
                                    </div>
                                )}
                            </>
                        ) : (
                            <Link to="/login" className="p-2 rounded-full hover:bg-gray-100 text-gray-600 hover:text-primary transition-colors">
                                <User size={22} strokeWidth={2} />
                            </Link>
                        )}
                    </div>

                    {/* Mobile Actions */}
                    <div className="md:hidden flex items-center gap-2">
                        {showTierBadge && (
                            <span className={`px-2 py-0.5 rounded-full border text-[10px] tracking-widest font-bold ${tierStyle.badge}`}>
                                {tierLabel}
                            </span>
                        )}
                        <button 
                            className="p-2 text-primary"
                            onClick={() => setIsOpen(!isOpen)}
                        >
                            {isOpen ? <X size={28} /> : <Menu size={28} />}
                        </button>
                    </div>
                </div>
            </div>

            {/* Mobile Menu */}
            <div className={`md:hidden absolute top-full left-0 w-full bg-white shadow-xl transition-all duration-300 overflow-hidden ${
                isOpen ? 'max-h-[500px] opacity-100' : 'max-h-0 opacity-0'
            }`}>
                <div className="flex flex-col p-6 space-y-4 text-center">
                    <div className="relative text-left" ref={mobileSearchRef}>
                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            type="search"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onFocus={() => {
                                if (String(searchQuery || '').trim()) setIsSearchOpen(true);
                            }}
                            placeholder="Search products..."
                            className="w-full rounded-xl border border-gray-200 bg-white px-10 py-2.5 text-sm text-gray-700 outline-none focus:border-accent"
                        />
                        {isSearchOpen && (
                            <div className="absolute top-full mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden z-[90]">
                                {searchResults.length === 0 && !isSearchLoading && (
                                    <EmptyState
                                        image={emptyIllustration}
                                        alt="No products found"
                                        title="No products found"
                                        description="Try a different product name or keyword."
                                        compact
                                        className="px-2"
                                    />
                                )}
                                <div className="max-h-72 overflow-y-auto">
                                    {searchResults.map((product) => (
                                        <button
                                            key={`nav-search-mobile-${product.id}`}
                                            type="button"
                                            onClick={() => handleSearchSelect(product.id)}
                                            className="w-full text-left px-3 py-2.5 hover:bg-gray-50 border-b last:border-b-0 border-gray-100"
                                        >
                                            <div className="flex items-center gap-3">
                                                <img
                                                    src={getMediaThumbnail(product)}
                                                    alt={product?.title || 'Product'}
                                                    className="w-10 h-10 rounded-lg object-cover border border-gray-100"
                                                    onError={(e) => { e.currentTarget.src = placeholderImg; }}
                                                />
                                                <div className="min-w-0">
                                                    <p className="text-sm font-medium text-gray-800 truncate">{product?.title || 'Untitled Product'}</p>
                                                    <p className="text-xs text-gray-500 truncate">{getPriceLabel(product)}</p>
                                                </div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                                {isSearchLoading && (
                                    <p className="px-4 py-2 text-xs text-gray-400 border-t border-gray-100">Searching...</p>
                                )}
                            </div>
                        )}
                    </div>

                    <Link 
                        to="/shop"
                        className={`text-lg font-medium py-2 border-b border-gray-100 ${isShopActive() ? 'text-accent-deep font-bold' : 'text-gray-600'}`}
                        onClick={() => setIsOpen(false)}
                    >
                        Shop
                    </Link>
                    {navLinks.map((link) => (
                        <Link 
                            key={link.name} 
                            to={link.path}
                            className={`text-lg font-medium py-2 border-b border-gray-100 ${isActive(link.path) ? 'text-accent-deep font-bold' : 'text-gray-600'}`}
                            onClick={() => setIsOpen(false)}
                        >
                            {link.name}
                        </Link>
                    ))}
                    {effectiveUser ? (
                        <>
                            {showTierBadge && (
                                <div className="text-xs text-gray-500 py-2 border-b border-gray-100">
                                    Tier:
                                    {' '}
                                    <span className={`inline-flex px-2 py-0.5 rounded-full border font-bold tracking-wider ${tierStyle.badge}`}>
                                        {tierLabel}
                                    </span>
                                </div>
                            )}
                            <Link
                                to="/track-order"
                                className="text-lg font-medium py-2 border-b border-gray-100 text-gray-600"
                                onClick={() => setIsOpen(false)}
                            >
                                Track Order
                            </Link>
                            <button onClick={handleLogout} className="flex items-center justify-center gap-2 text-red-500 font-bold pt-4">
                                <LogOut size={20} /> Logout
                            </button>
                        </>
                    ) : (
                        <Link to="/login" className="flex items-center justify-center gap-2 text-primary font-bold pt-4" onClick={() => setIsOpen(false)}>
                            <User size={20} /> Login
                        </Link>
                    )}
                </div>
            </div>
        </nav>
    );
}
