import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useCms } from '../hooks/useCms'; // [CHANGE] Import Hook
import { productService } from '../services/productService';
import { ArrowRight, ChevronLeft, ChevronRight, Folder, Truck, PenTool, ShieldCheck, Gem, Headphones, Check, ArrowUp, Sparkles, Gift } from 'lucide-react';
import { useSocket } from '../context/SocketContext';
import ProductCard from '../components/ProductCard';
import EmptyState from '../components/EmptyState';
import { useAuth } from '../context/AuthContext';
import { authService } from '../services/authService';
import emptyIllustration from '../assets/closed.svg';
import { buildHomeSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';
import { isCategoryVisibleInStorefront } from '../utils/categoryVisibility';
import { BRAND_LOGO_URL } from '../utils/branding.js';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
// import { io } from 'socket.io-client';
// --- 1. STATIC HERO COMPONENT (Default) ---
const StaticHero = () => (
    <section className="relative h-[80vh] flex items-center justify-center bg-primary overflow-hidden">
        {/* Background Pattern */}
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gray-100 to-transparent"></div>
        
        <div className="relative z-10 text-center px-4 max-w-4xl mx-auto space-y-6">
            <span className="text-accent text-sm md:text-base font-bold tracking-widest uppercase animate-slide-in">
                Artisanal Excellence
            </span>
            <h1 className="text-5xl md:text-7xl font-serif text-white leading-tight">
                Handmade with <span className="text-gold">Love</span> & Heritage
            </h1>
            <p className="text-gray-300 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
                Discover our exclusive collection of handcrafted treasures, made using traditional techniques passed down through generations.
            </p>
            <div className="flex flex-col md:flex-row gap-4 justify-center pt-8">
                <Link to="/shop" className="btn-primary">
                    Shop Collections
                </Link>
                <Link to="/about" className="px-6 py-3 rounded-lg font-semibold text-white border border-white/20 hover:bg-white/10 transition-all">
                    Our Story
                </Link>
            </div>
        </div>
    </section>
);

// --- 2. DYNAMIC CAROUSEL COMPONENT ---
const CarouselHero = ({ slides }) => {
    const [currentSlide, setCurrentSlide] = useState(0);

    // Auto-Slide Logic
    useEffect(() => {
        if (slides.length <= 1) return;
        const interval = setInterval(() => {
            setCurrentSlide(prev => (prev === slides.length - 1 ? 0 : prev + 1));
        }, 5000); 
        return () => clearInterval(interval);
    }, [slides.length]);

    const nextSlide = () => setCurrentSlide(prev => (prev === slides.length - 1 ? 0 : prev + 1));
    const prevSlide = () => setCurrentSlide(prev => (prev === 0 ? slides.length - 1 : prev - 1));

    return (
        <section className="relative h-[85vh] overflow-hidden bg-primary group">
            {slides.map((slide, index) => (
                <div 
                    key={slide.id}
                    className={`absolute inset-0 transition-opacity duration-1000 ease-in-out ${index === currentSlide ? 'opacity-100 z-10' : 'opacity-0 z-0'}`}
                >
                    {/* Image Layer */}
                    <div className="absolute inset-0">
                        <img 
                            src={slide.image_url} 
                            alt={slide.title} 
                            className="w-full h-full object-cover transition-transform duration-[8000ms] ease-linear scale-105 group-hover:scale-110"
                            loading={index === currentSlide ? 'eager' : 'lazy'}
                            fetchPriority={index === currentSlide ? 'high' : 'auto'}
                            decoding="async"
                        />
                        {/* [OPTION 1] FULL BLACK MASK */}
                        <div className="absolute inset-0 bg-black/50"></div>
                    </div>

                    {/* Content Layer */}
                    <div className="relative h-full flex items-center justify-center text-center px-4">
                        <div className={`max-w-4xl mx-auto space-y-6 transition-all duration-1000 transform drop-shadow-2xl shadow-black/20 ${index === currentSlide ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0'}`}>
                            
                            {slide.subtitle && (
                                <span className="text-accent text-sm md:text-base font-bold tracking-[0.2em] uppercase block mb-2">
                                    {slide.subtitle}
                                </span>
                            )}
                            
                            {slide.title && (
                                <h1 className="text-4xl md:text-7xl font-serif text-white leading-tight drop-shadow-lg">
                                    {slide.title}
                                </h1>
                            )}

                            {slide.link && (
                                <div className="pt-8 flex items-center justify-center">
                                    <Link to={slide.link} className="btn-primary w-[65%] px-8 py-4 text-lg shadow-xl shadow-accent/20">
                                        Explore Collection
                                    </Link>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            ))}

            {/* Navigation Buttons */}
            {slides.length > 1 && (
                <>
                    <button onClick={prevSlide} className="absolute left-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100">
                        <ChevronLeft size={32} />
                    </button>
                    <button onClick={nextSlide} className="absolute right-4 top-1/2 -translate-y-1/2 z-20 p-3 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur-sm transition-all opacity-0 group-hover:opacity-100">
                        <ChevronRight size={32} />
                    </button>
                    <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-20 flex gap-3">
                        {slides.map((_, idx) => (
                            <button
                                key={idx}
                                onClick={() => setCurrentSlide(idx)}
                                className={`w-3 h-3 rounded-full transition-all duration-300 ${idx === currentSlide ? 'bg-accent w-8' : 'bg-white/50 hover:bg-white'}`}
                            />
                        ))}
                    </div>
                </>
            )}
        </section>
    );
};

const isExternalLink = (url) => /^https?:\/\//i.test(url || '');
const hasBannerImage = (imageUrl = '') => {
    const normalized = String(imageUrl || '').trim();
    if (!normalized) return false;
    return normalized !== '/placeholder_banner.jpg';
};

const appendCacheBust = (url = '', version = '') => {
    const normalizedUrl = String(url || '').trim();
    const normalizedVersion = String(version || '').trim();
    if (!normalizedUrl || !normalizedVersion) return normalizedUrl;
    const separator = normalizedUrl.includes('?') ? '&' : '?';
    return `${normalizedUrl}${separator}v=${encodeURIComponent(normalizedVersion)}`;
};

const BannerFrame = ({ imageUrl = '', alt = 'Banner' }) => (
    <div
        className="relative w-full overflow-hidden"
        style={{
            backgroundColor: 'var(--tier-page-bg, #eef1f6)',
            minHeight: 'clamp(220px, 32vw, 420px)'
        }}
    >
        <div className="absolute inset-0 scale-110">
            <img
                src={imageUrl}
                alt=""
                aria-hidden="true"
                className="w-full h-full object-cover blur-2xl opacity-60"
                loading="lazy"
                decoding="async"
            />
            <div className="absolute inset-0 bg-white/25 backdrop-blur-[2px]" />
        </div>
        <div className="relative z-10 flex w-full items-center justify-center px-0 py-4 md:px-0">
            <div className="flex w-[95vw] max-w-[95vw] items-center justify-center md:w-[85vw] md:max-w-[85vw]">
                <img
                    src={imageUrl}
                    alt={alt}
                    className="block h-auto w-full max-w-full"
                    loading="lazy"
                    decoding="async"
                />
            </div>
        </div>
    </div>
);

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

const TextCarousel = ({ texts }) => {
    const [index, setIndex] = useState(0);

    useEffect(() => {
        if (!texts || texts.length === 0) return;
        const interval = setInterval(() => {
            setIndex(prev => (prev + 1) % texts.length);
        }, 3500);
        return () => clearInterval(interval);
    }, [texts]);

    if (!texts || texts.length === 0) return null;

    return (
        <div className="w-full bg-primary text-accent">
            <div className="container mx-auto px-6 md:px-4 py-4 md:py-3 overflow-hidden">
                <div className="relative h-6 text-center">
                    {texts.map((item, i) => (
                        <div
                            key={item.id || i}
                            className={`absolute inset-0 flex items-center justify-center text-[10px] md:text-sm font-semibold tracking-[0.25em] md:tracking-[0.3em] uppercase transition-all duration-700 px-2 ${
                                i === index ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'
                            }`}
                        >
                            {item.text}
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- 3. MAIN PAGE COMPONENT ---
export default function Home() {
    const { user, updateUser } = useAuth();
    const { socket } = useSocket();
    const { companyInfo } = usePublicCompanyInfo();
    const navigate = useNavigate();
    const [slides, setSlides] = useState([]);
    const [categories, setCategories] = useState([]);
    const [bestSellers, setBestSellers] = useState([]);
    const [newArrivals, setNewArrivals] = useState([]);
    const [offersProducts, setOffersProducts] = useState([]);
    const [homeBanner, setHomeBanner] = useState(null);
    const [secondaryBanner, setSecondaryBanner] = useState(null);
    const [tertiaryBanner, setTertiaryBanner] = useState(null);
    const [bannerVersions, setBannerVersions] = useState({
        primary: '',
        secondary: '',
        tertiary: ''
    });
    const [featuredSection, setFeaturedSection] = useState(null);
    const [featuredSectionProducts, setFeaturedSectionProducts] = useState([]);
    const [heroTexts, setHeroTexts] = useState([]);
    const [bottomCarouselCards, setBottomCarouselCards] = useState([]);
    const [isLoadingBottomCarousel, setIsLoadingBottomCarousel] = useState(true);
    const [activeBottomCarouselIndex, setActiveBottomCarouselIndex] = useState(0);
    const [isLoadingHero, setIsLoadingHero] = useState(true);
    const [isLoadingCats, setIsLoadingCats] = useState(true);
    const [isLoadingBest, setIsLoadingBest] = useState(true);
    const [isLoadingNewArrivals, setIsLoadingNewArrivals] = useState(true);
    const [isLoadingBanner, setIsLoadingBanner] = useState(true);
    const [isLoadingSecondaryBanner, setIsLoadingSecondaryBanner] = useState(true);
    const [isLoadingTertiaryBanner, setIsLoadingTertiaryBanner] = useState(true);
    const [isLoadingFeaturedSection, setIsLoadingFeaturedSection] = useState(true);
    const [isLoadingOffers, setIsLoadingOffers] = useState(true);
    const [shouldLoadDeferredContent, setShouldLoadDeferredContent] = useState(false);
    const { getSlides, getHeroTexts, getBanner, getSecondaryBanner, getTertiaryBanner, getFeaturedCategory, getCarouselCards } = useCms();
    const infoSectionRef = useRef(null);
    const bottomCarouselTrackRef = useRef(null);
    const activeBottomCarouselIndexRef = useRef(0);
    const bottomCarouselAutoIndexRef = useRef(0);
    const featuredCategoryNameRef = useRef('');
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
    const seoConfig = useMemo(() => buildHomeSeo({
        categories,
        products: [
            ...bestSellers,
            ...newArrivals,
            ...offersProducts,
            ...featuredSectionProducts
        ],
        slides,
        banners: [homeBanner, secondaryBanner, tertiaryBanner].filter(Boolean)
    }), [bestSellers, categories, featuredSectionProducts, homeBanner, newArrivals, offersProducts, secondaryBanner, slides, tertiaryBanner]);
    useSeo(seoConfig);
    const [showTopBtn, setShowTopBtn] = useState(false);
    const [showBirthdayModal, setShowBirthdayModal] = useState(false);
    const [showConfetti, setShowConfetti] = useState(false);
    const usageAudienceCards = useMemo(() => {
        if (companyInfo?.usageAudienceEnabled !== true) return [];
        return [
            { key: 'men', label: 'Men', imageUrl: companyInfo?.usageAudienceMenImageUrl || '' },
            { key: 'women', label: 'Women', imageUrl: companyInfo?.usageAudienceWomenImageUrl || '' },
            { key: 'kids', label: 'Kids', imageUrl: companyInfo?.usageAudienceKidsImageUrl || '' }
        ].filter((item) => item.imageUrl);
    }, [companyInfo?.usageAudienceEnabled, companyInfo?.usageAudienceKidsImageUrl, companyInfo?.usageAudienceMenImageUrl, companyInfo?.usageAudienceWomenImageUrl]);

    const confettiPieces = useRef(
        Array.from({ length: 36 }, (_, i) => ({
            id: i,
            left: Math.random() * 100,
            delay: Math.random() * 0.6,
            duration: 2.6 + Math.random() * 1.4,
            size: 6 + Math.random() * 6,
            color: ['#f59e0b', '#f97316', '#ef4444', '#10b981', '#3b82f6', '#eab308'][i % 6]
        }))
    );

    const isBirthdayToday = (dob) => {
        if (!dob) return false;
        const [_year, month, day] = String(dob).split('T')[0].split('-');
        if (!month || !day) return false;
        const now = new Date();
        return Number(month) === now.getMonth() + 1 && Number(day) === now.getDate();
    };

    useEffect(() => {
        if (!user) return;
        if (user.role && user.role !== 'customer') return;
        if (!isBirthdayToday(user.dob)) return;
        if (user.birthdayOfferClaimedYear === new Date().getFullYear()) return;
        const today = new Date().toISOString().slice(0, 10);
        const key = `birthday_popup_seen_${user.id || 'guest'}_${today}`;
        if (localStorage.getItem(key)) return;
        localStorage.setItem(key, '1');
        setShowBirthdayModal(true);
        setShowConfetti(true);
        const timer = setTimeout(() => setShowConfetti(false), 4500);
        return () => clearTimeout(timer);
    }, [user]);

    // [FIX] Moved fetchHero out to component scope for Promise.all
    const fetchHero = useCallback(async () => {
        try {
            const data = await getSlides(false); // false = public
            setSlides(data);
        } catch (err) {
            console.error("Hero load failed", err);
        } finally {
            setIsLoadingHero(false);
        }
    }, [getSlides]);

    const fetchBanner = useCallback(async () => {
        try {
            const data = await getBanner(false);
            setHomeBanner(data);
            setBannerVersions((prev) => ({
                ...prev,
                primary: `${Date.now()}`
            }));
        } catch (err) {
            console.error("Banner load failed", err);
        } finally {
            setIsLoadingBanner(false);
        }
    }, [getBanner]);

    const fetchSecondaryBanner = useCallback(async () => {
        try {
            const data = await getSecondaryBanner(false);
            setSecondaryBanner(data);
            setBannerVersions((prev) => ({
                ...prev,
                secondary: `${Date.now()}`
            }));
        } catch (err) {
            console.error("Secondary banner load failed", err);
        } finally {
            setIsLoadingSecondaryBanner(false);
        }
    }, [getSecondaryBanner]);

    const fetchTertiaryBanner = useCallback(async () => {
        try {
            const data = await getTertiaryBanner(false);
            setTertiaryBanner(data);
            setBannerVersions((prev) => ({
                ...prev,
                tertiary: `${Date.now()}`
            }));
        } catch (err) {
            console.error("Tertiary banner load failed", err);
        } finally {
            setIsLoadingTertiaryBanner(false);
        }
    }, [getTertiaryBanner]);

    const fetchHeroTexts = useCallback(async () => {
        try {
            const data = await getHeroTexts(false);
            setHeroTexts(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Hero text load failed", err);
        }
    }, [getHeroTexts]);

    const fetchFeaturedSection = useCallback(async () => {
        try {
            const data = await getFeaturedCategory(false);
            setFeaturedSection(data);
        } catch (err) {
            console.error("Featured category load failed", err);
        } finally {
            setIsLoadingFeaturedSection(false);
        }
    }, [getFeaturedCategory]);

    const fetchFeaturedSectionProducts = useCallback(async ({ categoryName, categoryId } = {}) => {
        const resolvedName = String(categoryName || '').trim();
        const resolvedId = Number(categoryId);
        if (!resolvedName && !Number.isFinite(resolvedId)) {
            setFeaturedSectionProducts([]);
            return;
        }
        try {
            const data = await productService.getProducts(
                1,
                resolvedName || 'all',
                'active',
                'manual',
                10,
                Number.isFinite(resolvedId) ? resolvedId : null
            );
            setFeaturedSectionProducts(data.products || []);
        } catch (err) {
            console.error("Featured category products failed", err);
            setFeaturedSectionProducts([]);
        }
    }, []);

    // 2. [NEW] Fetch Categories
    // We will wrap this in a function so we can call it later from the Socket listener
    const fetchCategories = useCallback(async () => {
        try {
            const data = await productService.getCategoryStats(true);
            const filtered = (Array.isArray(data) ? data : []).filter((c) => isCategoryVisibleInStorefront(c));
            setCategories(filtered);
        } catch (err) {
            console.error("Category load failed", err);
        } finally {
            setIsLoadingCats(false);
        }
    }, []);

    const fetchBestSellers = useCallback(async () => {
        try {
            const data = await productService.getProducts(1, 'Best Sellers', 'active', 'manual', 10);
            setBestSellers(data.products || []);
        } catch (err) {
            console.error("Best sellers load failed", err);
        } finally {
            setIsLoadingBest(false);
        }
    }, []);

    const fetchNewArrivals = useCallback(async () => {
        try {
            const data = await productService.getProducts(1, 'New Arrivals', 'active', 'manual', 10);
            setNewArrivals(data.products || []);
        } catch (err) {
            console.error("New arrivals load failed", err);
        } finally {
            setIsLoadingNewArrivals(false);
        }
    }, []);

    const fetchOffers = useCallback(async () => {
        try {
            const data = await productService.getProducts(1, 'Offers', 'active', 'manual', 10);
            setOffersProducts(data.products || []);
        } catch (err) {
            console.error("Offers load failed", err);
        } finally {
            setIsLoadingOffers(false);
        }
    }, []);

    const fetchBottomCarouselCards = useCallback(async () => {
        try {
            const data = await getCarouselCards(false);
            setBottomCarouselCards(Array.isArray(data) ? data : []);
            setActiveBottomCarouselIndex(0);
        } catch (err) {
            console.error("Bottom carousel cards load failed", err);
            setBottomCarouselCards([]);
        } finally {
            setIsLoadingBottomCarousel(false);
        }
    }, [getCarouselCards]);

    // Keep above-the-fold fetches on the critical path only.
    useEffect(() => {
        const loadInitialData = async () => {
            await Promise.all([
                fetchHero(),
                fetchHeroTexts(),
                fetchCategories(),
                fetchBanner(),
                fetchFeaturedSection()
            ]);
        };
        loadInitialData();
    }, [fetchHero, fetchHeroTexts, fetchCategories, fetchBanner, fetchFeaturedSection]);

    useEffect(() => {
        let cancelled = false;
        let fallbackTimer = null;
        const enableDeferredContent = () => {
            if (cancelled) return;
            setShouldLoadDeferredContent(true);
        };

        if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
            const idleId = window.requestIdleCallback(enableDeferredContent, { timeout: 1200 });
            return () => {
                cancelled = true;
                window.cancelIdleCallback?.(idleId);
            };
        }

        fallbackTimer = window.setTimeout(enableDeferredContent, 700);
        return () => {
            cancelled = true;
            if (fallbackTimer) window.clearTimeout(fallbackTimer);
        };
    }, []);

    useEffect(() => {
        if (!shouldLoadDeferredContent) return;
        fetchBestSellers();
        fetchNewArrivals();
        fetchSecondaryBanner();
        fetchTertiaryBanner();
        fetchOffers();
        fetchBottomCarouselCards();
    }, [
        shouldLoadDeferredContent,
        fetchBestSellers,
        fetchNewArrivals,
        fetchSecondaryBanner,
        fetchTertiaryBanner,
        fetchOffers,
        fetchBottomCarouselCards
    ]);

    useEffect(() => {
        if (!featuredSection) return;
        const titleFallback = featuredSection?.category_name || '';
        featuredCategoryNameRef.current = titleFallback;
        if (titleFallback) {
            fetchFeaturedSectionProducts({
                categoryName: titleFallback,
                categoryId: featuredSection?.category_id
            });
        } else {
            fetchFeaturedSectionProducts({});
        }
    }, [featuredSection, fetchFeaturedSectionProducts]);

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


    // 3. [NEW] Initial Load + Real-Time Sync
    useEffect(() => {
        // A. Load initially
        // fetchCategories();

        if (!socket) return;

        // B. Define Handler
        const handleCategoryRefresh = (payload = {}) => {
            const category = payload.category;
            const action = String(payload?.action || '').toLowerCase();
            const categoryName = String(category?.name || payload?.categoryName || '').toLowerCase();
            if (category) {
                productService.patchCategoryStatsCache((current) => {
                    const idx = current.findIndex(c => String(c.id) === String(category.id));
                    if (idx >= 0) {
                        const next = [...current];
                        next[idx] = { ...next[idx], ...category };
                        return next;
                    }
                    return [...current, category];
                });
            }

            // Patch Featured Categories list (all categories with at least 1 product)
            setCategories(prev => {
                let next = [...prev];
                const name = category?.name || payload.categoryName;
                const id = category?.id || payload.categoryId;

                if (payload.action === 'delete') {
                    next = next.filter(c => String(c.id) !== String(id) && c.name?.toLowerCase() !== String(name || '').toLowerCase());
                    return next;
                }

                if (category) {
                    if (Number(category.product_count || 0) >= 1) {
                        const existing = next.findIndex(c => String(c.id) === String(category.id));
                        if (existing >= 0) next[existing] = { ...next[existing], ...category };
                        else next.push(category);
                    } else {
                        next = next.filter(c => String(c.id) !== String(category.id));
                    }
                }

                return next.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            });

            if ((action === 'reorder' || action === 'autopilot') && categoryName === 'best sellers') {
                productService.clearProductsCache({ category: 'Best Sellers', status: 'active', sort: 'manual', limit: 10 });
                fetchBestSellers();
            }
            if ((action === 'reorder' || action === 'autopilot') && categoryName === 'new arrivals') {
                productService.clearProductsCache({ category: 'New Arrivals', status: 'active', sort: 'manual', limit: 10 });
                fetchNewArrivals();
            }
            if ((action === 'reorder' || action === 'autopilot') && categoryName === 'offers') {
                productService.clearProductsCache({ category: 'Offers', status: 'active', sort: 'manual', limit: 10 });
                fetchOffers();
            }

            // Best Sellers reorder patch (manual order)
            if (payload.action === 'reorder' && payload.categoryName && payload.categoryName.toLowerCase() === 'best sellers') {
                const ordered = payload.orderedProductIds || [];
                if (ordered.length > 0) {
                    setBestSellers(prev => {
                        const map = new Map(prev.map(p => [String(p.id), p]));
                        const reordered = ordered.map(id => map.get(String(id))).filter(Boolean);
                        const remaining = prev.filter(p => !ordered.includes(String(p.id)));
                        return [...reordered, ...remaining].slice(0, 10);
                    });
                }
            }
            if (payload.action === 'reorder' && payload.categoryName && payload.categoryName.toLowerCase() === 'new arrivals') {
                const ordered = payload.orderedProductIds || [];
                if (ordered.length > 0) {
                    setNewArrivals(prev => {
                        const map = new Map(prev.map(p => [String(p.id), p]));
                        const reordered = ordered.map(id => map.get(String(id))).filter(Boolean);
                        const remaining = prev.filter(p => !ordered.includes(String(p.id)));
                        return [...reordered, ...remaining].slice(0, 10);
                    });
                }
            }
            if (payload.action === 'reorder' && payload.categoryName && payload.categoryName.toLowerCase() === 'offers') {
                const ordered = payload.orderedProductIds || [];
                if (ordered.length > 0) {
                    setOffersProducts(prev => {
                        const map = new Map(prev.map(p => [String(p.id), p]));
                        const reordered = ordered.map(id => map.get(String(id))).filter(Boolean);
                        const remaining = prev.filter(p => !ordered.includes(String(p.id)));
                        return [...reordered, ...remaining].slice(0, 10);
                    });
                }
            }
            const featuredName = featuredCategoryNameRef.current;
            if ((action === 'reorder' || action === 'autopilot') && featuredName && categoryName === featuredName.toLowerCase()) {
                productService.clearProductsCache({ category: featuredName, status: 'active', sort: 'manual', limit: 10 });
                fetchFeaturedSectionProducts({
                    categoryName: featuredName,
                    categoryId: featuredSection?.category_id
                });
            }
        };

        // C. Listen
        socket.on('refresh:categories', handleCategoryRefresh);

        const handleCategoryChange = (payload = {}) => {
            const name = payload.categoryName || '';
            if (name.toLowerCase() === 'best sellers' && payload.product) {
                const product = payload.product;
                const isActive = product.status === 'active';
                if (payload.action === 'remove' || !isActive) {
                    setBestSellers(prev => prev.filter(p => String(p.id) !== String(product.id)));
                } else if (payload.action === 'add' && isActive) {
                    setBestSellers(prev => {
                        if (prev.find(p => String(p.id) === String(product.id))) return prev;
                        return [...prev, product].slice(0, 10);
                    });
                }
            }
            if (name.toLowerCase() === 'new arrivals' && payload.product) {
                const product = payload.product;
                const isActive = product.status === 'active';
                if (payload.action === 'remove' || !isActive) {
                    setNewArrivals(prev => prev.filter(p => String(p.id) !== String(product.id)));
                } else if (payload.action === 'add' && isActive) {
                    setNewArrivals(prev => {
                        if (prev.find(p => String(p.id) === String(product.id))) return prev;
                        return [...prev, product].slice(0, 10);
                    });
                }
            }
            if (name.toLowerCase() === 'offers') {
                productService.clearProductsCache({ category: 'Offers', status: 'active', sort: 'manual', limit: 10 });
                fetchOffers();
            }
            const featuredName = featuredCategoryNameRef.current;
            if (featuredName && name.toLowerCase() === featuredName.toLowerCase()) {
                productService.clearProductsCache({ category: featuredName, status: 'active', sort: 'manual', limit: 10 });
                fetchFeaturedSectionProducts({
                    categoryName: featuredName,
                    categoryId: featuredSection?.category_id
                });
            }
        };
        socket.on('product:category_change', handleCategoryChange);

        const isBestSellerProduct = (product) => {
            if (!product || !product.categories) return false;
            return product.categories.some(c => String(c).toLowerCase() === 'best sellers');
        };
        const isNewArrivalProduct = (product) => {
            if (!product || !product.categories) return false;
            return product.categories.some(c => String(c).toLowerCase() === 'new arrivals');
        };
        const isOfferProduct = (product) => {
            if (!product || !product.categories) return false;
            return product.categories.some(c => String(c).toLowerCase() === 'offers');
        };

        const handleProductCreate = (product) => {
            fetchCategories();
            if (isBestSellerProduct(product) && product.status === 'active') {
                setBestSellers(prev => {
                    if (prev.find(p => String(p.id) === String(product.id))) return prev;
                    return [...prev, product].slice(0, 10);
                });
            }
            if (isNewArrivalProduct(product) && product.status === 'active') {
                setNewArrivals(prev => {
                    if (prev.find(p => String(p.id) === String(product.id))) return prev;
                    return [...prev, product].slice(0, 10);
                });
            }
            if (isOfferProduct(product) && product.status === 'active') {
                setOffersProducts(prev => {
                    if (prev.find(p => String(p.id) === String(product.id))) return prev;
                    return [...prev, product].slice(0, 10);
                });
            }
            const featuredName = featuredCategoryNameRef.current;
            if (featuredName && product?.categories?.some(c => String(c).toLowerCase() === featuredName.toLowerCase())) {
                productService.clearProductsCache({ category: featuredName, status: 'active', sort: 'manual', limit: 10 });
                fetchFeaturedSectionProducts({
                    categoryName: featuredName,
                    categoryId: featuredSection?.category_id
                });
            }
        };

        const handleProductUpdate = (product) => {
            if (!product) return;
            fetchCategories();
            const isBest = isBestSellerProduct(product);
            const isNewArrival = isNewArrivalProduct(product);
            const isOffer = isOfferProduct(product);
            setBestSellers(prev => {
                const exists = prev.find(p => String(p.id) === String(product.id));
                if (isBest && product.status === 'active') {
                    if (exists) return prev.map(p => String(p.id) === String(product.id) ? { ...p, ...product } : p);
                    return [...prev, product].slice(0, 10);
                }
                if (exists) return prev.filter(p => String(p.id) !== String(product.id));
                return prev;
            });
            setNewArrivals(prev => {
                const exists = prev.find(p => String(p.id) === String(product.id));
                if (isNewArrival && product.status === 'active') {
                    if (exists) return prev.map(p => String(p.id) === String(product.id) ? { ...p, ...product } : p);
                    return [...prev, product].slice(0, 10);
                }
                if (exists) return prev.filter(p => String(p.id) !== String(product.id));
                return prev;
            });
            setOffersProducts(prev => {
                const exists = prev.find(p => String(p.id) === String(product.id));
                if (isOffer && product.status === 'active') {
                    if (exists) return prev.map(p => String(p.id) === String(product.id) ? { ...p, ...product } : p);
                    return [...prev, product].slice(0, 10);
                }
                if (exists) return prev.filter(p => String(p.id) !== String(product.id));
                return prev;
            });
            const featuredName = featuredCategoryNameRef.current;
            if (featuredName && product?.categories?.some(c => String(c).toLowerCase() === featuredName.toLowerCase())) {
                productService.clearProductsCache({ category: featuredName, status: 'active', sort: 'manual', limit: 10 });
                fetchFeaturedSectionProducts({
                    categoryName: featuredName,
                    categoryId: featuredSection?.category_id
                });
            }
        };

        const handleProductDelete = ({ id }) => {
            fetchCategories();
            setBestSellers(prev => prev.filter(p => String(p.id) !== String(id)));
            setNewArrivals(prev => prev.filter(p => String(p.id) !== String(id)));
            setOffersProducts(prev => prev.filter(p => String(p.id) !== String(id)));
            const featuredName = featuredCategoryNameRef.current;
            if (featuredName) {
                productService.clearProductsCache({ category: featuredName, status: 'active', sort: 'manual', limit: 10 });
                fetchFeaturedSectionProducts({
                    categoryName: featuredName,
                    categoryId: featuredSection?.category_id
                });
            }
        };

        socket.on('product:create', handleProductCreate);
        socket.on('product:update', handleProductUpdate);
        socket.on('product:delete', handleProductDelete);
        socket.on('cms:hero_update', fetchHero);
        socket.on('cms:texts_update', fetchHeroTexts);
        socket.on('cms:banner_update', fetchBanner);
        socket.on('cms:banner_secondary_update', fetchSecondaryBanner);
        socket.on('cms:banner_tertiary_update', fetchTertiaryBanner);
        socket.on('cms:featured_category_update', fetchFeaturedSection);
        socket.on('cms:carousel_cards_update', fetchBottomCarouselCards);
        socket.on('cms:autopilot_update', fetchFeaturedSection);

        // D. Cleanup (Remove Listener ONLY)
        return () => {
            socket.off('refresh:categories', handleCategoryRefresh);
            socket.off('product:category_change', handleCategoryChange);
            socket.off('product:create', handleProductCreate);
            socket.off('product:update', handleProductUpdate);
            socket.off('product:delete', handleProductDelete);
            socket.off('cms:hero_update', fetchHero);
            socket.off('cms:texts_update', fetchHeroTexts);
            socket.off('cms:banner_update', fetchBanner);
            socket.off('cms:banner_secondary_update', fetchSecondaryBanner);
            socket.off('cms:banner_tertiary_update', fetchTertiaryBanner);
            socket.off('cms:featured_category_update', fetchFeaturedSection);
            socket.off('cms:carousel_cards_update', fetchBottomCarouselCards);
            socket.off('cms:autopilot_update', fetchFeaturedSection);
        };
    }, [socket, fetchHero, fetchHeroTexts, fetchBanner, fetchSecondaryBanner, fetchTertiaryBanner, fetchFeaturedSection, fetchBottomCarouselCards, fetchFeaturedSectionProducts, fetchBestSellers, fetchNewArrivals, fetchOffers, fetchCategories, featuredSection?.category_id]); // Depend on socket

    // [NEW] Mouse Move Logic for Info Section
    const handleMouseMove = (e) => {
        if (!infoSectionRef.current) return;
        const rect = infoSectionRef.current.getBoundingClientRect();
        setMousePos({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top
        });
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
        updateActiveBottomCard();
    }, [bottomCarouselCards, updateActiveBottomCard]);

    useEffect(() => {
        activeBottomCarouselIndexRef.current = activeBottomCarouselIndex;
    }, [activeBottomCarouselIndex]);

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

    return (
        <div className="pb-0">
            {showConfetti && (
                <div className="fixed inset-0 z-[80] pointer-events-none overflow-hidden">
                    {confettiPieces.current.map((piece) => (
                        <span
                            key={piece.id}
                            className="confetti-piece"
                            style={{
                                left: `${piece.left}%`,
                                '--delay': `${piece.delay}s`,
                                '--duration': `${piece.duration}s`,
                                '--size': `${piece.size}px`,
                                '--color': piece.color
                            }}
                        />
                    ))}
                </div>
            )}

            {showBirthdayModal && createPortal(
                <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 backdrop-blur-sm px-4">
                    <div className="relative w-full max-w-md rounded-3xl bg-white shadow-2xl border border-amber-100 p-6 overflow-hidden animate-fade-in">
                        <div className="absolute -top-20 -right-20 w-40 h-40 bg-amber-100 rounded-full blur-3xl opacity-70" />
                        <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-orange-100 rounded-full blur-3xl opacity-70" />
                        <div className="relative">
                            <div className="flex items-center gap-3 text-amber-700 font-bold text-xs uppercase tracking-[0.3em]">
                                <Sparkles size={16} />
                                Birthday Surprise
                            </div>
                            <h2 className="text-2xl font-serif text-gray-900 mt-3">Happy Birthday!</h2>
                            <p className="text-sm text-gray-600 mt-2">
                                Celebrate with a special gift from us. Enjoy a <span className="font-semibold text-gray-800">10% birthday discount</span> on your orders today.
                            </p>

                            <div className="mt-5 p-4 rounded-2xl bg-amber-50 border border-amber-100 flex items-center gap-3">
                                <div className="w-10 h-10 rounded-full bg-white border border-amber-200 flex items-center justify-center">
                                    <Gift size={18} className="text-amber-600" />
                                </div>
                                <div>
                                    <p className="text-sm font-semibold text-amber-800">Birthday Coupon</p>
                                    <p className="text-xs text-amber-700">10% off on all orders (claim now)</p>
                                </div>
                            </div>

                            <div className="mt-6 flex items-center gap-3">
                                <button
                                    onClick={() => {
                                        setShowBirthdayModal(false);
                                        setShowConfetti(false);
                                    }}
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-600 font-semibold hover:bg-gray-50"
                                >
                                    Later
                                </button>
                                <button
                                    onClick={async () => {
                                        const yearNow = new Date().getFullYear();
                                        try {
                                            const res = await authService.updateProfile({ birthdayOfferClaimedYear: yearNow });
                                            if (res?.user) {
                                                updateUser(res.user);
                                            }
                                        } catch {
                                            // Silently ignore claim errors for now
                                        } finally {
                                            setShowBirthdayModal(false);
                                            setShowConfetti(false);
                                            navigate('/shop');
                                        }
                                    }}
                                    className="flex-1 px-4 py-2.5 rounded-xl bg-primary text-white font-semibold hover:bg-primary-dark shadow-lg shadow-amber-100/50"
                                >
                                    Claim Now
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                ,
                document.body
            )}
            
            <TextCarousel texts={heroTexts} />

            {/* HERO SECTION: Conditional Render */}
            {!isLoadingHero && slides.length > 0 ? (
                <CarouselHero slides={slides} />
            ) : (
                <StaticHero />
            )}

            {/* --- FEATURED CATEGORIES --- */}
            <section className="container mx-auto px-6 md:px-4 py-6 md:py-8 tier-surface rounded-none md:rounded-2xl">
                {usageAudienceCards.length > 0 && (
                    <div className="mb-12">
                        <div className="text-center mb-8">
                            <h2 className="text-3xl font-serif text-primary">Shop by Usage</h2>
                            <p className="text-gray-500 mt-2">Browse collections curated for Men, Women and Kids</p>
                        </div>
                        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-4 md:grid-cols-3 md:gap-5 lg:max-w-5xl">
                            {usageAudienceCards.map((item) => (
                                <Link
                                    key={item.key}
                                    to={`/shop?usageAudience=${encodeURIComponent(item.key)}#shop-results`}
                                    className="group mx-auto w-full max-w-[290px] cursor-pointer overflow-hidden rounded-[26px] border border-gray-100 bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl md:max-w-[260px] lg:max-w-[285px]"
                                >
                                    <div className="aspect-[4/4.7] overflow-hidden">
                                        <img
                                            src={item.imageUrl}
                                            alt={item.label}
                                            className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    </div>
                                    <div className="px-4 py-3.5 md:px-4.5 md:py-3.5">
                                        <h3 className="text-lg font-serif text-primary md:text-xl">{item.label}</h3>
                                        <p className="mt-1 text-xs text-gray-500 md:text-sm">Explore {item.label.toLowerCase()} collections</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                        <div className="mx-auto mt-10 flex max-w-5xl items-center gap-5 md:mt-12">
                            <span className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-amber-400/90 to-transparent" />
                            <span className="text-[11px] font-bold uppercase tracking-[0.38em] text-amber-700">
                                Explore More
                            </span>
                            <span className="h-[2px] flex-1 bg-gradient-to-r from-transparent via-amber-400/90 to-transparent" />
                        </div>
                        <div
                            aria-hidden="true"
                            className="mx-auto mt-4 h-[8px] max-w-4xl rounded-full bg-[radial-gradient(circle,_rgba(180,83,9,0.72)_1.6px,_transparent_1.6px)] bg-[length:16px_8px] bg-center bg-repeat-x"
                        />
                    </div>
                )}
                <div className="text-center mb-10">
                    <h2 className="text-3xl font-serif text-primary">Featured Categories</h2>
                    <p className="text-gray-500 mt-2">Explore our wide range of handcrafted collections</p>
                </div>
                
                {isLoadingCats ? (
                    // Skeleton Loader
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {[...Array(5)].map((_, i) => (
                            <div key={i} className="h-40 bg-gray-100 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : (
                    // [UPDATED] Responsive Grid for 15+ items
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4 md:gap-6">
                        {categories.map((cat) => (
                            <Link 
                                key={cat.id} 
                                to={`/shop/${encodeURIComponent(cat.name)}`}
                                className="group cursor-pointer relative flex flex-col items-center text-center gap-3 p-4 rounded-2xl tier-card-surface border border-gray-100 shadow-sm hover:shadow-xl hover:border-accent/30 transition-all duration-300 hover:-translate-y-1"
                            >
                                {/* Image Container */}
                                <div className="w-24 h-24 md:w-32 md:h-32 rounded-full tier-muted-surface overflow-hidden border-2 border-white shadow-inner group-hover:scale-105 transition-transform duration-500 relative">
                                    {cat.image_url ? (
                                        <img 
                                            src={cat.image_url} 
                                            alt={cat.name} 
                                            className="w-full h-full object-cover"
                                            loading="lazy"
                                            decoding="async"
                                        />
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-primary/20">
                                            <Folder size={32} />
                                        </div>
                                    )}
                                    {/* Overlay on Hover */}
                                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors rounded-full"></div>
                                </div>

                                {/* Text Info */}
                                <div>
                                    <h3 className="font-bold text-gray-800 group-hover:text-primary transition-colors line-clamp-2 min-h-[3rem]">
                                        {cat.name}
                                    </h3>
                                    <p className="text-xs text-gray-400 mt-1 font-medium">
                                        {cat.product_count} items
                                    </p>
                                </div>
                            </Link>
                        ))}
                        
                        {/* Fallback if no categories */}
                        {categories.length === 0 && (
                            <div className="col-span-full">
                                <EmptyState
                                    image={emptyIllustration}
                                    alt="No categories available"
                                    title="No categories available yet"
                                    description="Collections will appear here once products are ready to browse."
                                    compact
                                />
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* --- INFO DISPLAY GRID (Interactive Hover Effect) --- */}
            <section 
                ref={infoSectionRef}
                onMouseMove={handleMouseMove}
                className="relative py-16 overflow-hidden bg-gray-900 [content-visibility:auto] [contain-intrinsic-size:1px_900px]"
            >
                {/* 1. Base Dark Background */}
                <div className="absolute inset-0 bg-[#111827] z-0"></div>

                {/* 2. Mouse Follower Gradient (Gold/Red Glow) */}
                <div 
                    className="absolute inset-0 z-0 transition-opacity duration-300 pointer-events-none"
                    style={{
                        background: `radial-gradient(600px circle at ${mousePos.x}px ${mousePos.y}px, rgba(63, 19, 6, 0.5), transparent 40%)`
                    }}
                ></div>

                {/* Content Container */}
                <div className="container mx-auto px-4 relative z-10">
                    
                   {/* [NEW] Header with Logo & Title */}
                    <div className="flex flex-col md:flex-row items-center justify-center gap-4 mb-12 animate-fade-in">
                        <img 
                            src={BRAND_LOGO_URL}
                            alt="Logo"
                            // [FIX] Increased mobile size to w-24 (96px) for better visibility
                            className="w-24 h-24 md:w-28 md:h-28 object-contain drop-shadow-[0_0_15px_rgba(255,255,255,0.3)]"
                            loading="lazy"
                            decoding="async"
                            fetchPriority="low"
                        />
                        <h2 className="text-3xl md:text-4xl font-serif text-white text-center md:text-left">
                            Why Customers Trust us?
                        </h2>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
                        
                        {/* 1. Delivery */}
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl flex flex-col items-center text-center hover-glow group cursor-default max-w-xs mx-auto w-full transition-colors hover:bg-white/10 relative overflow-hidden">
                            {/* [NEW] Green Tick on Hover */}
                            <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 p-1.5 bg-green-500/20 rounded-full">
                                <Check size={16} className="text-green-400" strokeWidth={3} />
                            </div>
                            
                            <div className="w-14 h-14 bg-primary/30 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                                <Truck size={28} className="text-accent group-hover:scale-110 transition-transform duration-300" />
                            </div>
                            <h3 className="text-white font-bold text-lg mb-2">Pan India Delivery</h3>
                            <p className="text-gray-400 text-sm">Fast shipping across all pin codes</p>
                        </div>

                        {/* 2. Custom Designs */}
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl flex flex-col items-center text-center hover-glow group cursor-default max-w-xs mx-auto w-full transition-colors hover:bg-white/10 relative overflow-hidden">
                             {/* [NEW] Green Tick on Hover */}
                             <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 p-1.5 bg-green-500/20 rounded-full">
                                <Check size={16} className="text-green-400" strokeWidth={3} />
                            </div>

                            <div className="w-14 h-14 bg-primary/30 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                                <PenTool size={28} className="text-accent group-hover:scale-110 transition-transform duration-300" />
                            </div>
                            <h3 className="text-white font-bold text-lg mb-2">Customized Designs</h3>
                            <p className="text-gray-400 text-sm">Tailored to your specific preference</p>
                        </div>

                        {/* 3. Warranty */}
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl flex flex-col items-center text-center hover-glow group cursor-default max-w-xs mx-auto w-full transition-colors hover:bg-white/10 relative overflow-hidden">
                             {/* [NEW] Green Tick on Hover */}
                             <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 p-1.5 bg-green-500/20 rounded-full">
                                <Check size={16} className="text-green-400" strokeWidth={3} />
                            </div>

                            <div className="w-14 h-14 bg-primary/30 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                                <ShieldCheck size={28} className="text-accent group-hover:scale-110 transition-transform duration-300" />
                            </div>
                            <h3 className="text-white font-bold text-lg mb-2">12 Months Warranty</h3>
                            <p className="text-gray-400 text-sm">Upto 12 months polish warranty</p>
                        </div>

                        {/* 4. Material Quality */}
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl flex flex-col items-center text-center hover-glow group cursor-default max-w-xs mx-auto w-full transition-colors hover:bg-white/10 relative overflow-hidden">
                             {/* [NEW] Green Tick on Hover */}
                             <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 p-1.5 bg-green-500/20 rounded-full">
                                <Check size={16} className="text-green-400" strokeWidth={3} />
                            </div>

                            <div className="w-14 h-14 bg-primary/30 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                                <Gem size={28} className="text-accent group-hover:scale-110 transition-transform duration-300" />
                            </div>
                            <h3 className="text-white font-bold text-lg mb-2">Premium Quality</h3>
                            <p className="text-gray-400 text-sm">High Quality Brass, Copper & Mixed Alloys</p>
                        </div>

                        {/* 5. Support */}
                        <div className="bg-white/5 backdrop-blur-sm border border-white/10 p-6 rounded-2xl flex flex-col items-center text-center hover-glow group cursor-default max-w-xs mx-auto w-full transition-colors hover:bg-white/10 relative overflow-hidden">
                             {/* [NEW] Green Tick on Hover */}
                             <div className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-all duration-300 transform translate-y-2 group-hover:translate-y-0 p-1.5 bg-green-500/20 rounded-full">
                                <Check size={16} className="text-green-400" strokeWidth={3} />
                            </div>

                            <div className="w-14 h-14 bg-primary/30 rounded-full flex items-center justify-center mb-4 group-hover:bg-accent/20 transition-colors">
                                <Headphones size={28} className="text-accent group-hover:scale-110 transition-transform duration-300" />
                            </div>
                            <h3 className="text-white font-bold text-lg mb-2">Premium Support</h3>
                            <p className="text-gray-400 text-sm">Dedicated assistance for all your queries</p>
                        </div>

                    </div>
{/* [NEW] About Us Button */}
                    <div className="mt-12 text-center">
                        <Link 
                            to="/about"
                            // [FIX] Changed shadow to 'shadow-accent/50' (Gold) so it is visible against the dark background.
                            // This matches the Hero button's glow style.
                            className="inline-flex items-center gap-2 px-8 py-3 rounded-lg font-bold bg-white hover:bg-gray-100 text-primary hover:text-primary transition-all duration-300 transform hover:-translate-y-1 shadow-xl shadow-accent/40 hover:shadow-accent/10 mx-auto"
                        >
                            About Us <ArrowRight size={18} />
                        </Link>
                    </div>

                </div>
            </section>

              {/* --- BEST SELLERS --- */}
            <section className="container mx-auto px-6 md:px-4 py-6 md:py-8 tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_900px]">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-8">
                    <div>
                        <h2 className="text-3xl font-serif text-primary">Best Sellers</h2>
                        <p className="text-gray-500 mt-2">Our most loved pieces, curated for you</p>
                    </div>
                    <Link
                        to={`/shop/${encodeURIComponent('Best Sellers')}`}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-primary border border-primary/20 hover:border-primary hover:bg-primary/5 transition-all w-fit"
                    >
                        View All <ArrowRight size={18} />
                    </Link>
                </div>

                {isLoadingBest ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="h-56 bg-gray-100 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                        {bestSellers.slice(0, 10).map((product) => (
                            <ProductCard key={product.id} product={product} displayCategory="Best Sellers" />
                        ))}
                        {bestSellers.length === 0 && (
                            <div className="col-span-full">
                                <EmptyState
                                    image={emptyIllustration}
                                    alt="No best sellers available"
                                    title="No best sellers available yet"
                                    description="Best-selling products will appear here once sales history builds up."
                                    compact
                                />
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* --- HOME BANNER --- */}
            {((isLoadingBanner) || hasBannerImage(homeBanner?.image_url)) && (
            <section className="w-full tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_420px]">
                {isLoadingBanner ? (
                    <div className="w-full animate-pulse pt-[56.25%]" style={{ backgroundColor: 'var(--tier-page-bg, #eef1f6)' }} />
                ) : (
                    (() => {
                        const link = homeBanner?.link || '';
                        const imageUrl = appendCacheBust(homeBanner?.image_url || '', bannerVersions.primary);
                        if (!hasBannerImage(imageUrl)) return null;
                        const content = <BannerFrame imageUrl={imageUrl} alt="Featured banner" />;

                        if (!link) return content;
                        if (isExternalLink(link)) {
                            return (
                                <a href={link} target="_blank" rel="noreferrer" className="block">
                                    {content}
                                </a>
                            );
                        }
                        return (
                            <Link to={link} className="block">
                                {content}
                            </Link>
                        );
                    })()
                )}
            </section>
            )}

            {/* --- NEW ARRIVALS --- */}
            <section className="container mx-auto px-6 md:px-4 py-6 md:py-8 tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_900px]">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-8">
                    <div>
                        <h2 className="text-3xl font-serif text-primary">New Arrivals</h2>
                        <p className="text-gray-500 mt-2">Fresh additions handpicked for you</p>
                    </div>
                    <Link
                        to={`/shop/${encodeURIComponent('New Arrivals')}`}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-primary border border-primary/20 hover:border-primary hover:bg-primary/5 transition-all w-fit"
                    >
                        View All <ArrowRight size={18} />
                    </Link>
                </div>

                {isLoadingNewArrivals ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="h-56 bg-gray-100 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                        {newArrivals.slice(0, 10).map((product) => (
                            <ProductCard key={product.id} product={product} displayCategory="New Arrivals" />
                        ))}
                        {newArrivals.length === 0 && (
                            <div className="col-span-full">
                                <EmptyState
                                    image={emptyIllustration}
                                    alt="No new arrivals available"
                                    title="No new arrivals available yet"
                                    description="Fresh products will appear here as soon as they are added to the storefront."
                                    compact
                                />
                            </div>
                        )}
                    </div>
                )}
            </section>

            {/* --- SECOND HOME BANNER --- */}
            {((isLoadingSecondaryBanner) || hasBannerImage(secondaryBanner?.image_url)) && (
            <section className="w-full tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_420px]">
                {isLoadingSecondaryBanner ? (
                    <div className="w-full animate-pulse pt-[56.25%]" style={{ backgroundColor: 'var(--tier-page-bg, #eef1f6)' }} />
                ) : (
                    (() => {
                        const link = secondaryBanner?.link || '';
                        const imageUrl = appendCacheBust(secondaryBanner?.image_url || '', bannerVersions.secondary);
                        if (!hasBannerImage(imageUrl)) return null;
                        const content = <BannerFrame imageUrl={imageUrl} alt="Featured banner" />;

                        if (!link) return content;
                        if (isExternalLink(link)) {
                            return (
                                <a href={link} target="_blank" rel="noreferrer" className="block">
                                    {content}
                                </a>
                            );
                        }
                        return (
                            <Link to={link} className="block">
                                {content}
                            </Link>
                        );
                    })()
                )}
            </section>
            )}

            {/* --- FEATURED CATEGORY SECTION --- */}
            <section className="container mx-auto px-6 md:px-4 py-6 md:py-8 tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_900px]">
                {isLoadingFeaturedSection ? (
                    <div className="h-32 bg-gray-100 rounded-2xl animate-pulse" />
                ) : (
                    (() => {
                        const categoryName = featuredSection?.category_name || '';
                        const isAutopilotApplied = Boolean(featuredSection?.autopilot_applied);
                        const title = isAutopilotApplied
                            ? (categoryName || featuredSection?.title?.trim() || '')
                            : (featuredSection?.title?.trim() || categoryName);
                        const subtitle = isAutopilotApplied
                            ? (featuredSection?.subtitle?.trim() || 'Curated picks from this week\'s highlighted category')
                            : (featuredSection?.subtitle?.trim() || 'Curated picks from this collection');

                        if (!categoryName) {
                            return (
                                <EmptyState
                                    image={emptyIllustration}
                                    alt="Featured category not set"
                                    title="Featured category not set yet"
                                    description="Choose a featured category in CMS to highlight products here."
                                    compact
                                />
                            );
                        }

                        return (
                            <>
                                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-8">
                                    <div>
                                        <h2 className="text-3xl font-serif text-primary">{title}</h2>
                                        <p className="text-gray-500 mt-2">{subtitle}</p>
                                    </div>
                                    <Link
                                        to={`/shop/${encodeURIComponent(categoryName)}`}
                                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-primary border border-primary/20 hover:border-primary hover:bg-primary/5 transition-all w-fit"
                                    >
                                        View All <ArrowRight size={18} />
                                    </Link>
                                </div>

                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                                    {featuredSectionProducts.slice(0, 10).map((product) => (
                                        <ProductCard key={product.id} product={product} displayCategory={categoryName} />
                                    ))}
                                    {featuredSectionProducts.length === 0 && (
                                        <div className="col-span-full">
                                            <EmptyState
                                                image={emptyIllustration}
                                                alt="No products available in this category"
                                                title="No products available in this category"
                                                description="Add active products to this category to feature them here."
                                                compact
                                            />
                                        </div>
                                    )}
                                </div>
                            </>
                        );
                    })()
                )}
            </section>

            {/* --- HOME BANNER 3 (below featured showcase section) --- */}
            {((isLoadingTertiaryBanner) || hasBannerImage(tertiaryBanner?.image_url)) && (
            <section className="w-full tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_420px]">
                {isLoadingTertiaryBanner ? (
                    <div className="w-full animate-pulse pt-[56.25%]" style={{ backgroundColor: 'var(--tier-page-bg, #eef1f6)' }} />
                ) : (
                    (() => {
                        const link = tertiaryBanner?.link || '';
                        const imageUrl = appendCacheBust(tertiaryBanner?.image_url || '', bannerVersions.tertiary);
                        if (!hasBannerImage(imageUrl)) return null;
                        const content = <BannerFrame imageUrl={imageUrl} alt="Home banner 3" />;

                        if (!link) return content;
                        if (isExternalLink(link)) {
                            return (
                                <a href={link} target="_blank" rel="noreferrer" className="block">
                                    {content}
                                </a>
                            );
                        }
                        return (
                            <Link to={link} className="block">
                                {content}
                            </Link>
                        );
                    })()
                )}
            </section>
            )}

            {/* --- OFFERS --- */}
            <section className="container mx-auto px-6 md:px-4 py-6 md:py-8 tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_900px]">
                <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-8">
                    <div>
                        <h2 className="text-3xl font-serif text-primary">Offers</h2>
                        <p className="text-gray-500 mt-2">Auto-curated products with active discounts</p>
                    </div>
                    <Link
                        to={`/shop/${encodeURIComponent('Offers')}`}
                        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg font-bold text-primary border border-primary/20 hover:border-primary hover:bg-primary/5 transition-all w-fit"
                    >
                        View All <ArrowRight size={18} />
                    </Link>
                </div>

                {isLoadingOffers ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="h-56 bg-gray-100 rounded-2xl animate-pulse"></div>
                        ))}
                    </div>
                ) : (
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 md:gap-6">
                        {offersProducts.slice(0, 10).map((product) => (
                            <ProductCard key={product.id} product={product} displayCategory="Offers" />
                        ))}
                        {offersProducts.length === 0 && (
                            <div className="col-span-full">
                                <EmptyState
                                    image={emptyIllustration}
                                    alt="No offers available"
                                    title="No offers available at the moment"
                                    description="Discounted products will appear here whenever active offers are available."
                                    compact
                                />
                            </div>
                        )}
                    </div>
                )}
            </section>

            {(isLoadingBottomCarousel || bottomCarouselCards.length > 0) && (
                <section className="container mx-auto px-4 md:px-6 py-8 md:py-12 tier-surface [content-visibility:auto] [contain-intrinsic-size:1px_520px]">
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
                                <div key={`bottom-carousel-skeleton-${index}`} className="w-full md:w-[calc((100%-2rem)/3.3)] aspect-video rounded-3xl bg-gray-100 animate-pulse shrink-0" />
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
                                                <>
                                                    <img
                                                        src={imageUrl}
                                                        alt={card?.title || 'Feature'}
                                                        className="absolute inset-0 h-full w-full object-cover"
                                                        loading="lazy"
                                                    />
                                                </>
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
                                            key={`bottom-carousel-card-${card.id}`}
                                            data-bottom-carousel-card="true"
                                            className="shrink-0 w-full md:w-[calc((100%-2rem)/3.3)] snap-start"
                                        >
                                            {buttonLink ? (
                                                isExternalLink(buttonLink) ? (
                                                    <a href={buttonLink} target="_blank" rel="noreferrer" className="block">
                                                        {cardBody}
                                                    </a>
                                                ) : (
                                                    <Link to={buttonLink} className="block">
                                                        {cardBody}
                                                    </Link>
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
                                                key={`bottom-carousel-dot-${card.id || index}`}
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
