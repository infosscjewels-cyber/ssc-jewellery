import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { 
    Heart, ShoppingCart, Share2, ChevronDown, ChevronUp, Minus, Plus,
    AlertTriangle, Check, ArrowRight, Home, ShieldCheck, Truck,
    MessageCircle, Facebook, Twitter, Send, Copy, PlayCircle, Instagram, Youtube, X
} from 'lucide-react';
import { productService } from '../services/productService';
import { useSocket } from '../context/SocketContext';
import { useToast } from '../context/ToastContext';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import ProductCard from '../components/ProductCard';
import RazorpayAffordability from '../components/RazorpayAffordability';
import placeholderImg from '../assets/placeholder.jpg'
import { vibrateTap } from '../utils/haptics';
import { buildProductSeo } from '../seo/rules';
import { useSeo } from '../seo/useSeo';
import { buildWhatsAppShareLink } from '../utils/publicContact';

const toBool = (value) => value === 1 || value === true || value === '1' || value === 'true';
const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const getAvailableQuantity = (item = {}) => toNumber(item.available_quantity ?? item.quantity, 0);
const effectivePrice = (item = {}) => toNumber(item.discount_price || item.price || item.mrp || 0, 0);
const isVariantOutOfStock = (variant = {}, parent = {}) => {
    const tracked = variant.track_quantity ?? parent.track_quantity;
    const qty = getAvailableQuantity(variant);
    return Boolean(toBool(tracked) && toNumber(qty, 0) <= 0);
};
const isProductOutOfStock = (product = {}, activeVariantId = null) => {
    if (!product || String(product.status || '').toLowerCase() !== 'active') return true;
    const variants = Array.isArray(product.variants) ? product.variants : [];
    if (variants.length > 0) {
        const selected = activeVariantId ? variants.find((v) => String(v.id) === String(activeVariantId)) : null;
        if (selected) return isVariantOutOfStock(selected, product);
        return variants.every((v) => isVariantOutOfStock(v, product));
    }
    return Boolean(toBool(product.track_quantity) && getAvailableQuantity(product) <= 0);
};
const parseYoutubeInfo = (input = '') => {
    const raw = String(input || '').trim();
    if (!raw) return { videoId: '', isShorts: false };
    try {
        const url = new URL(raw);
        const host = String(url.hostname || '').toLowerCase();
        let videoId = '';
        let isShorts = false;
        if (host.includes('youtu.be')) {
            videoId = url.pathname.split('/').filter(Boolean)[0] || '';
        } else if (host.includes('youtube.com')) {
            if (url.pathname.startsWith('/shorts/')) {
                videoId = url.pathname.split('/')[2] || '';
                isShorts = true;
            } else if (url.pathname.startsWith('/embed/')) {
                videoId = url.pathname.split('/')[2] || '';
            } else {
                videoId = url.searchParams.get('v') || '';
            }
        }
        return { videoId, isShorts };
    } catch {
        return { videoId: '', isShorts: false };
    }
};
const buildYoutubeEmbedUrl = (input = '') => {
    const raw = String(input || '').trim();
    if (!raw) return '';
    const { videoId } = parseYoutubeInfo(raw);
    return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
};
const isYoutubePortraitInput = (input = '') => {
    const { isShorts } = parseYoutubeInfo(input);
    return isShorts;
};
const buildInstagramEmbedUrl = (input = '') => {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        const host = String(url.hostname || '').toLowerCase();
        if (!host.includes('instagram.com')) return '';
        const parts = url.pathname.split('/').filter(Boolean);
        const type = parts[0];
        const id = parts[1] || '';
        if (!id || !['p', 'reel', 'tv'].includes(type)) return '';
        return `https://www.instagram.com/${type}/${id}/embed`;
    } catch {
        return '';
    }
};
const buildInstagramThumbnailUrl = (input = '') => {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        const host = String(url.hostname || '').toLowerCase();
        if (!host.includes('instagram.com')) return '';
        const parts = url.pathname.split('/').filter(Boolean);
        const type = parts[0];
        const id = parts[1] || '';
        if (!id || !['p', 'reel', 'tv'].includes(type)) return '';
        return `https://www.instagram.com/${type}/${id}/media/?size=m`;
    } catch {
        return '';
    }
};
const buildInstagramPermalink = (input = '') => {
    const raw = String(input || '').trim();
    if (!raw) return '';
    try {
        const url = new URL(raw);
        const host = String(url.hostname || '').toLowerCase();
        if (!host.includes('instagram.com')) return '';
        const parts = url.pathname.split('/').filter(Boolean);
        const type = parts[0];
        const id = parts[1] || '';
        if (!id || !['p', 'reel', 'tv'].includes(type)) return '';
        return `https://www.instagram.com/${type}/${id}/?utm_source=ig_embed&utm_campaign=loading`;
    } catch {
        return '';
    }
};
let instagramScriptPromise = null;
const ensureInstagramEmbedScript = () => {
    if (typeof window === 'undefined') return Promise.resolve();
    if (window.instgrm?.Embeds?.process) return Promise.resolve();
    if (instagramScriptPromise) return instagramScriptPromise;
    instagramScriptPromise = new Promise((resolve) => {
        const existing = document.querySelector('script[data-instgrm-embed-script="true"]');
        if (existing) {
            existing.addEventListener('load', () => resolve(), { once: true });
            existing.addEventListener('error', () => resolve(), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.async = true;
        script.src = 'https://www.instagram.com/embed.js';
        script.setAttribute('data-instgrm-embed-script', 'true');
        script.onload = () => resolve();
        script.onerror = () => resolve();
        document.body.appendChild(script);
    });
    return instagramScriptPromise;
};
const parseProductMedia = (mediaInput) => {
    if (!mediaInput) return [];
    try {
        const rawMedia = typeof mediaInput === 'string' ? JSON.parse(mediaInput) : mediaInput;
        if (!Array.isArray(rawMedia)) return [];
        return rawMedia
            .map((item, index) => {
                if (item && typeof item === 'object') {
                    const type = String(item.type || 'image').toLowerCase();
                    const url = String(item.url || '').trim();
                    if (!url) return null;
                    if (type === 'youtube' || type === 'instagram') {
                        const embedUrl = type === 'instagram' ? buildInstagramEmbedUrl(url) : buildYoutubeEmbedUrl(url);
                        if (!embedUrl) return null;
                        const youtubeVideoId = embedUrl.split('/embed/')[1]?.split('?')[0] || '';
                        const thumbnailUrl = type === 'youtube'
                            ? (youtubeVideoId ? `https://img.youtube.com/vi/${youtubeVideoId}/hqdefault.jpg` : '')
                            : buildInstagramThumbnailUrl(url);
                        return {
                            id: `video-${index}-${type}`,
                            kind: 'video',
                            videoType: type,
                            url,
                            embedUrl,
                            videoId: type === 'youtube' ? parseYoutubeInfo(url).videoId : '',
                            isPortrait: type === 'youtube' ? isYoutubePortraitInput(url) : true,
                            permalink: type === 'instagram' ? buildInstagramPermalink(url) : '',
                            thumbnailUrl
                        };
                    }
                    return { id: `image-${index}`, kind: 'image', url };
                }
                const fallbackUrl = String(item || '').trim();
                if (!fallbackUrl) return null;
                return { id: `image-${index}`, kind: 'image', url: fallbackUrl };
            })
            .filter(Boolean);
    } catch {
        return [];
    }
};
const getPrimaryCategoryName = (categoriesInput) => {
    if (!categoriesInput) return null;
    if (typeof categoriesInput === 'string') {
        const raw = categoriesInput.trim();
        if (!raw) return null;
        try {
            return getPrimaryCategoryName(JSON.parse(raw));
        } catch {
            return raw;
        }
    }
    if (Array.isArray(categoriesInput)) {
        for (const entry of categoriesInput) {
            if (typeof entry === 'string' && entry.trim()) return entry.trim();
            if (entry && typeof entry === 'object') {
                const name = String(entry.name || entry.label || entry.title || '').trim();
                if (name) return name;
            }
        }
    }
    return null;
};

export default function ProductPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const { socket } = useSocket();
    const { items, addItem, updateQuantity } = useCart();
    const { toggleWishlist, isWishlisted } = useWishlist();
    const toast = useToast();

    // --- State ---
    const [product, setProduct] = useState(null);
    const [relatedProducts, setRelatedProducts] = useState([]);
    // const [activeVariant, setActiveVariant] = useState(null);
    const [activeVariantId, setActiveVariantId] = useState(null);
    const [selectedImage, setSelectedImage] = useState(null);
    const [videoModal, setVideoModal] = useState({ open: false, item: null });
    const [youtubeAspectCache, setYoutubeAspectCache] = useState({});
    const [loading, setLoading] = useState(true);
    const [zoomStyle, setZoomStyle] = useState({ display: 'none' });
    const [activeAccordion, setActiveAccordion] = useState(null);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [justAddedToCart, setJustAddedToCart] = useState(false);
    const [cartPressed, setCartPressed] = useState(false);
    const [heartPressed, setHeartPressed] = useState(false);
    const seoConfig = useMemo(() => buildProductSeo({ product }), [product]);
    useSeo(seoConfig);
    const shareRef = useRef(null);
    const cartFeedbackTimerRef = useRef(null);
    const relatedReloadTimerRef = useRef(null);
    const liveRefreshTimerRef = useRef(null);
    const youtubeAspectInFlightRef = useRef({});
    const cartPressTimerRef = useRef(null);
    const heartPressTimerRef = useRef(null);
    const selectedCartEntries = useMemo(() => {
        if (!product?.id) return [];
        return (items || []).filter((entry) => {
            if (String(entry?.productId || '') !== String(product.id)) return false;
            const activeVariantKey = String(activeVariantId || '');
            const entryVariantKey = String(entry?.variantId || '');
            if (activeVariantKey) return entryVariantKey === activeVariantKey;
            return !entryVariantKey;
        });
    }, [items, product?.id, activeVariantId]);
    const selectedCartQty = useMemo(
        () => selectedCartEntries.reduce((sum, entry) => sum + Number(entry?.quantity || 0), 0),
        [selectedCartEntries]
    );
    const selectedCartItem = selectedCartEntries[0] || null;

    // [FIX] Helper to normalize socket data (Strings -> Arrays)
    const normalizeSocketData = (data) => {
        if (!data) return data;
        const parsed = { ...data };

        // List of JSON fields to check
        const jsonFields = ['media', 'categories', 'options', 'additional_info', 'related_products'];

        jsonFields.forEach(field => {
            if (typeof parsed[field] === 'string') {
                try {
                    parsed[field] = JSON.parse(parsed[field]);
                } catch (e) {
                    console.error(`Failed to parse ${field} from socket:`, e);
                    parsed[field] = []; // Fallback to empty array to prevent crash
                }
            }
        });

        // Ensure variants are also clean (if they exist)
        if (parsed.variants && Array.isArray(parsed.variants)) {
             // Variants usually come as objects from your DB query, 
             // but safe to leave them if they are already arrays.
        }

        return parsed;
    };

    // --- Refs ---
    const mainImageRef = useRef(null);
    const productRef = useRef(null); // Tracks latest product state for socket

      // --- Safe Data Parsing ---
    
    const orderedMedia = useMemo(() => parseProductMedia(product?.media), [product?.media]);
    const mediaList = useMemo(
        () => orderedMedia.filter((item) => item.kind === 'image').map((item) => item.url),
        [orderedMedia]
    );

    // 2. Additional Info (Accordion)
    const parsedAdditionalInfo = useMemo(() => {
        if (!product?.additional_info) return [];
        try {
            return typeof product.additional_info === 'string' ? JSON.parse(product.additional_info) : product.additional_info;
        } catch {
            return [];
        }
    }, [product]);

    const polishWarrantyMonths = useMemo(() => {
        const raw = Number(product?.polish_warranty_months);
        const allowed = [6, 7, 8, 9, 12];
        if (Number.isFinite(raw) && allowed.includes(raw)) return raw;
        return 6;
    }, [product?.polish_warranty_months]);

    // [ENGINEERING FIX] 1. Enforce Client-Side Stability
    // Irrespective of backend order, we strictly sort variants by ID.
    // This ensures the dropdown options NEVER jump around during updates.
    // [ENGINEERING FIX] 1. Stable Client-Side Sorting
    // Sort by Title. This ensures that even if IDs change (backend regeneration),
    // the visual order of items in the dropdown remains constant for the user.
    const sortedVariants = useMemo(() => {
        if (!product?.variants) return [];
        return [...product.variants].sort((a, b) => {
            return (a.variant_title || '').localeCompare(b.variant_title || '');
        });
    }, [product]);

    // [ENGINEERING FIX] 2. Derive Active Variant from the Stable List
    const activeVariant = useMemo(() => {
        if (!sortedVariants.length || !activeVariantId) return null;
        return sortedVariants.find(v => String(v.id) === String(activeVariantId)) || null;
    }, [sortedVariants, activeVariantId]);

    // Keep IDs in sync for the socket listener
    const activeVariantIdRef = useRef(null);
    const relatedCategoryRef = useRef(null);
    const relatedProductsRef = useRef([]);

    useEffect(() => { activeVariantIdRef.current = activeVariantId; }, [activeVariantId]);

    // [FIX] Keep related products ref in sync
    useEffect(() => {
        relatedProductsRef.current = relatedProducts;
    }, [relatedProducts]);
    // [FIX] Keep ref in sync with state for socket listeners
    useEffect(() => {
        productRef.current = product;
    }, [product]);

    

   // [FIX] Helper to handle image paths and fallbacks
    const getImgUrl = (path) => {
        // Ensure path is a valid string
        if (!path || typeof path !== 'string') return placeholderImg;
        
        try {
            // If it's a web URL, return as is
            if (path.startsWith('http')) return path;
            // If it's a local upload, ensure it starts with /
            if (!path.startsWith('/')) return `/${path}`;
        } catch {
            return placeholderImg;
        }
        return path;
    };

    // [NEW] Helper to refresh Related Products
    const loadRelatedProducts = useCallback(async (data) => {
        let searchCategory = null;
        
        // 1. Default to product's main category
        if (data.categories) {
            const cats = typeof data.categories === 'string' ? JSON.parse(data.categories) : data.categories;
            if (Array.isArray(cats) && cats.length > 0) searchCategory = cats[0];
            else if (typeof cats === 'string') searchCategory = cats;
        }

        // 2. Check for Override
        try {
            const rpConfig = typeof data.related_products === 'string' ? JSON.parse(data.related_products) : data.related_products;
            if (rpConfig && rpConfig.show === true && rpConfig.category) {
                searchCategory = rpConfig.category;
            }
        } catch {
            // Ignore malformed related product config.
        }

        // [CRITICAL] Save the category we are searching for into Ref
        relatedCategoryRef.current = searchCategory; 

        if (searchCategory) {
            try {
                // Fetch 'active' products manually sorted
                const related = await productService.getProducts(1, searchCategory, 'active', 'manual');
                
                // [FIX] Strict Filtering:
                // 1. Exclude current product
                // 2. Exclude Inactive (backend 'active' filter usually handles this, but double check)
                // 3. Exclude Out of Stock (if tracking is enabled)
                const validProducts = related.products.filter(p => {
                    const isCurrent = String(p.id) === String(data.id);
                    const isActive = p.status === 'active';
                    const isStocked = !p.track_quantity || getAvailableQuantity(p) > 0;
                    return !isCurrent && isActive && isStocked;
                });

                setRelatedProducts(validProducts.slice(0, 5));
            } catch (err) {
                console.error("Failed to load related products", err);
            }
        }
    }, []);

    const scheduleRelatedReload = useCallback((data) => {
        if (!data) return;
        if (relatedReloadTimerRef.current) clearTimeout(relatedReloadTimerRef.current);
        relatedReloadTimerRef.current = setTimeout(() => {
            loadRelatedProducts(data);
        }, 180);
    }, [loadRelatedProducts]);
    const scheduleLiveProductRefresh = useCallback((delay = 220) => {
        if (!id) return;
        if (liveRefreshTimerRef.current) clearTimeout(liveRefreshTimerRef.current);
        liveRefreshTimerRef.current = setTimeout(async () => {
            try {
                const latest = await productService.getProduct(id);
                setProduct(latest);
            } catch {
                // Silent fallback: socket payload has already updated optimistic state.
            }
        }, delay);
    }, [id]);

    const handleAddToCart = async () => {
        if (!product) return;
        setCartPressed(true);
        if (cartPressTimerRef.current) clearTimeout(cartPressTimerRef.current);
        cartPressTimerRef.current = setTimeout(() => setCartPressed(false), 180);
        try {
            if (String(product.status || '').toLowerCase() !== 'active') {
                toast.error('This product is inactive and unavailable.');
                return;
            }
            if (product.variants && product.variants.length > 0) {
                if (!activeVariant) {
                    toast.error('Please select a variant');
                    return;
                }
                if (isVariantOutOfStock(activeVariant, product)) {
                    toast.warning('Selected variant is out of stock.');
                    return;
                }
                await addItem({ product, variant: activeVariant, quantity: 1 });
            } else {
                if (isProductOutOfStock(product)) {
                    toast.warning('This product is currently out of stock.');
                    return;
                }
                await addItem({ product, quantity: 1 });
            }
            vibrateTap();
            setJustAddedToCart(true);
            if (cartFeedbackTimerRef.current) clearTimeout(cartFeedbackTimerRef.current);
            cartFeedbackTimerRef.current = setTimeout(() => setJustAddedToCart(false), 1200);
        } catch (error) {
            toast.error(error?.message || 'Failed to add item to cart');
        }
    };

    const handleIncrementSelectedQty = async () => {
        if (!product || isOutOfStock) return;
        if (!selectedCartItem) {
            await handleAddToCart();
            return;
        }
        await updateQuantity({
            productId: selectedCartItem.productId,
            variantId: selectedCartItem.variantId || '',
            quantity: Number(selectedCartItem.quantity || 0) + 1
        });
    };

    const handleDecrementSelectedQty = async () => {
        if (!selectedCartItem) return;
        await updateQuantity({
            productId: selectedCartItem.productId,
            variantId: selectedCartItem.variantId || '',
            quantity: Number(selectedCartItem.quantity || 0) - 1
        });
    };

    // --- 1. Initial Fetch ---
    useEffect(() => {
        const fetchAllData = async () => {
            setLoading(true);
            try {
                const data = await productService.getProduct(id);
                setProduct(data);

                const images = parseProductMedia(data.media)
                    .filter((item) => item.kind === 'image')
                    .map((item) => item.url);
                
                // Initialize Variant (Newest first strategy)
                if (data.variants && data.variants.length > 0) {
                    
                    const sorted = [...data.variants].sort((a, b) => String(a.id).localeCompare(String(b.id)));
                    const firstVar = sorted[0];

                    setActiveVariantId(firstVar.id);
                    // Set initial image
                    const vImg = firstVar?.image_url;
                    setSelectedImage(vImg || (images.length > 0 ? images[0] : null));
                } else {
                    setSelectedImage(images.length > 0 ? images[0] : null);
                }
                // [FIX] Load Related Products using the helper
                await loadRelatedProducts(data);

            } catch (err) {
                console.error(err);
                toast.error("Failed to load product");
                navigate('/store');
            } finally {
                setLoading(false);
            }
        };
        fetchAllData();
    }, [id, navigate, toast, loadRelatedProducts]);

    // --- 2. Real-Time Sync ---
    useEffect(() => {
        if (!socket) return;
        
        const handleUpdate = (rawPayload) => {
            // [FIX] Normalize the payload immediately
            const updatedProduct = normalizeSocketData(rawPayload);

            const msgId = String(updatedProduct.id);
            const currentId = String(id);

            // [SCENARIO 1] Update Main Product
            if (msgId === currentId) {
                // ... (Keep your existing SMART RECOVERY LOGIC here) ...
                // ... (The logic I gave you previously for index matching) ...
                
                const oldData = productRef.current;
                const currentVarId = activeVariantIdRef.current;
                
                let newSelectedId = null;
                let oldPrice = 0, newPrice = 0, priceLabel = updatedProduct.title;
                let oldOutOfStock = false;
                let newOutOfStock = false;
                let oldStatus = 'active';
                let newStatus = String(updatedProduct.status || 'active').toLowerCase();
                let oldQty = 0;
                let newQty = 0;
                let shouldCheckPrice = false;

                // --- SMART RECOVERY LOGIC ---
                if (oldData && oldData.variants && updatedProduct.variants && currentVarId) {
                    // 1. Find what the user WAS looking at (Old Object)
                    const oldVar = oldData.variants.find(v => String(v.id) === String(currentVarId));
                    
                    if (oldVar) {
                        // 2. Find the SAME item in the New Data (Match by Title)
                        const newVar = updatedProduct.variants.find(v => v.variant_title === oldVar.variant_title);

                        if (newVar) {
                            newSelectedId = newVar.id; 
                            priceLabel = newVar.variant_title;

                            // Compare Prices
                            oldPrice = effectivePrice(oldVar);
                            newPrice = effectivePrice(newVar);
                            shouldCheckPrice = true;
                            oldOutOfStock = isVariantOutOfStock(oldVar, oldData);
                            newOutOfStock = isVariantOutOfStock(newVar, updatedProduct);
                            oldQty = getAvailableQuantity(oldVar);
                            newQty = getAvailableQuantity(newVar);
                        }
                    }
                } 
                else if (!currentVarId && oldData) {
                    oldPrice = effectivePrice(oldData);
                    newPrice = effectivePrice(updatedProduct);
                    shouldCheckPrice = true;
                    oldOutOfStock = isProductOutOfStock(oldData, null);
                    newOutOfStock = isProductOutOfStock(updatedProduct, null);
                    oldQty = getAvailableQuantity(oldData);
                    newQty = getAvailableQuantity(updatedProduct);
                }
                oldStatus = String(oldData?.status || 'active').toLowerCase();

                if (shouldCheckPrice) {
                    const diff = newPrice - oldPrice;
                    if (diff < 0) toast.success(`Price drop on ${priceLabel}! Saved ₹${Math.abs(diff).toLocaleString()}`);
                    else if (diff > 0) toast.error(`Price increased on ${priceLabel} by ₹${Math.abs(diff).toLocaleString()}`);
                }
                if (oldStatus === 'active' && newStatus !== 'active') {
                    toast.warning('This product is now inactive.');
                }
                if (!oldOutOfStock && newOutOfStock) {
                    toast.warning(`${priceLabel} is now out of stock.`);
                } else if (oldOutOfStock && !newOutOfStock) {
                    toast.success(`${priceLabel} is back in stock.`);
                } else if (!newOutOfStock && oldQty !== newQty && newQty >= 0) {
                    toast.info(`Availability updated for ${priceLabel}.`);
                }
                
                if (newSelectedId) {
                    setActiveVariantId(newSelectedId);
                }

                // [FIX] Use the NORMALIZED updatedProduct here
                setProduct(prev => ({ ...prev, ...updatedProduct }));

                const completeData = { ...(productRef.current || {}), ...updatedProduct };
                scheduleRelatedReload(completeData);
                scheduleLiveProductRefresh();
            } 
            
            // [SCENARIO 2] Update Related Cards
            const existsInRelated = relatedProductsRef.current.find(p => String(p.id) === msgId);
            const relatedCategory = String(relatedCategoryRef.current || '').trim().toLowerCase();
            const updatedCategories = Array.isArray(updatedProduct?.categories) ? updatedProduct.categories : [];
            const touchesRelatedCategory = relatedCategory
                ? updatedCategories.some((entry) => String(entry || '').trim().toLowerCase() === relatedCategory)
                : false;
            if (existsInRelated) {
                // Check if the update makes it INVALID (Inactive or OOS)
                const isInactive = updatedProduct.status !== 'active';
                const hasVariants = Array.isArray(updatedProduct.variants) && updatedProduct.variants.length > 0;
                const isOOS = hasVariants
                    ? updatedProduct.variants.every((variant) => isVariantOutOfStock(variant, updatedProduct))
                    : (toBool(updatedProduct.track_quantity) && getAvailableQuantity(updatedProduct) <= 0);

                if (isInactive || isOOS) {
                    console.log("🚫 Related product became invalid (OOS/Inactive). Refreshing list...");
                    const relatedCategory = relatedCategoryRef.current;
                    if (relatedCategory) {
                        productService.clearProductsCache({ category: relatedCategory });
                    }
                    // Reload to fill the gap with a new product
                    if (productRef.current) {
                        scheduleRelatedReload(productRef.current);
                    }
                } else {
                    // Valid Update: Just update price/image in place
                    console.log("✅ Updating Related Product Card:", updatedProduct.title);
                    setRelatedProducts(prevRelated => 
                        prevRelated.map(p => String(p.id) === msgId ? { ...p, ...updatedProduct } : p)
                    );
                }
            } else if (touchesRelatedCategory && msgId !== currentId) {
                const targetCategory = relatedCategoryRef.current;
                if (targetCategory) {
                    productService.clearProductsCache({ category: targetCategory });
                }
                if (productRef.current) {
                    scheduleRelatedReload(productRef.current);
                }
            }
            
        };

        // B. [NEW] Handler for Category Changes (Reorder / Add / Remove)
        const handleCategoryChange = (payload) => {
            const currentRelatedCat = String(relatedCategoryRef.current || '').trim();
            const changedCategoryName = String(
                payload?.categoryName
                || payload?.category?.name
                || ''
            ).trim();
            
            // Check if the event affects the category we are displaying
            if (currentRelatedCat && changedCategoryName.toLowerCase() === currentRelatedCat.toLowerCase()) {
                console.log("🔄 Related Category Updated:", payload.action);
                if (payload.action === 'reorder' || payload.action === 'count_update' || payload.action === 'remove' || payload.action === 'add') {
                    productService.clearProductsCache({ category: currentRelatedCat });
                }
                
                // Reload using the current product data
                if (productRef.current) {
                    scheduleRelatedReload(productRef.current);
                }
            }
        };

        const handleDelete = (payload = {}) => {
            const deletedProductId = String(
                payload?.id
                || payload?.productId
                || payload?.product?.id
                || ''
            ).trim();
            if (!deletedProductId) return;

            productService.removeProductFromProductsCache(deletedProductId);

            if (deletedProductId === String(id)) {
                toast.info('This product is no longer available.');
                navigate('/shop', { replace: true });
                return;
            }

            setRelatedProducts((prev) => prev.filter((entry) => String(entry?.id || '') !== deletedProductId));
        };

        // Listeners
        socket.on('product:update', handleUpdate);
        socket.on('product:delete', handleDelete);
        socket.on('refresh:categories', handleCategoryChange);      // Handles Reorder
        socket.on('product:category_change', handleCategoryChange); // Handles Add/Remove
        return () => {
            socket.off('product:update', handleUpdate);
            socket.off('product:delete', handleDelete);
            socket.off('refresh:categories', handleCategoryChange);
            socket.off('product:category_change', handleCategoryChange);
            if (relatedReloadTimerRef.current) {
                clearTimeout(relatedReloadTimerRef.current);
                relatedReloadTimerRef.current = null;
            }
            if (liveRefreshTimerRef.current) {
                clearTimeout(liveRefreshTimerRef.current);
                liveRefreshTimerRef.current = null;
            }
        };
    }, [socket, id, navigate, toast, scheduleLiveProductRefresh, scheduleRelatedReload]);
    
    // --- 3. Handlers ---
    const handleVariantChange = (variant) => {
        if(!variant) return;
        setActiveVariantId(variant.id);
        // If variant has an image, use it. Otherwise try first product image.
        if (variant.image_url) {
            setSelectedImage(variant.image_url);
        } else if (mediaList.length > 0) {
            setSelectedImage(mediaList[0]);
        } else {
            setSelectedImage(null); // Will trigger placeholder
        }
    };

    const handleMouseMove = (e) => {
        const { left, top, width, height } = e.target.getBoundingClientRect();
        const x = ((e.pageX - left) / width) * 100;
        const y = ((e.pageY - top) / height) * 100;
        setZoomStyle({
            display: 'block',
            backgroundPosition: `${x}% ${y}%`,
            backgroundImage: `url(${selectedImage})`
        });
    };

    const shareUrl = window.location.href;
    const shareText = `I found this product in SSC Impo jewellery website - ${shareUrl}`;
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
            toast.success("Link copied to clipboard!");
        } catch (err) {
            console.error("Copy failed", err);
        }
    };

    const handleShareClick = async () => {
        if (navigator.share) {
            try {
                await navigator.share({
                    title: product?.title || 'Product',
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

    useEffect(() => () => {
        if (cartFeedbackTimerRef.current) clearTimeout(cartFeedbackTimerRef.current);
        if (cartPressTimerRef.current) clearTimeout(cartPressTimerRef.current);
        if (heartPressTimerRef.current) clearTimeout(heartPressTimerRef.current);
    }, []);
    useEffect(() => {
        if (!videoModal.open || !videoModal.item || videoModal.item.videoType !== 'instagram') return;
        ensureInstagramEmbedScript().then(() => {
            if (window.instgrm?.Embeds?.process) {
                window.instgrm.Embeds.process();
            }
        });
    }, [videoModal]);
    useEffect(() => {
        if (!videoModal.open || !videoModal.item || videoModal.item.videoType !== 'youtube') return;
        const key = String(videoModal.item.videoId || videoModal.item.url || '').trim();
        if (!key || youtubeAspectCache[key] || youtubeAspectInFlightRef.current[key]) return;

        youtubeAspectInFlightRef.current[key] = true;
        const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(videoModal.item.url)}&format=json`;
        fetch(oembedUrl)
            .then((res) => (res.ok ? res.json() : null))
            .then((data) => {
                const width = Number(data?.width || 0);
                const height = Number(data?.height || 0);
                if (width > 0 && height > 0) {
                    setYoutubeAspectCache((prev) => ({ ...prev, [key]: { width, height } }));
                }
            })
            .catch(() => {})
            .finally(() => {
                delete youtubeAspectInFlightRef.current[key];
            });
    }, [videoModal, youtubeAspectCache]);

    // --- Render Helpers ---
    if (loading) return <div className="h-screen flex items-center justify-center"><div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>;
    if (!product) return null;

  

    // [FIX] Consolidate Logic: Prioritize Active Variant -> Fallback to Product
    const isVariant = !!activeVariant;

    // 1. Pricing
    const rawPrice = isVariant ? activeVariant.price : product.mrp;
    const rawDiscount = isVariant ? activeVariant.discount_price : product.discount_price;
    const currentPrice = Number(rawPrice || 0);
    const currentDiscount = Number(rawDiscount || 0);

    // 2. Stock & SKU
    const currentSKU = isVariant ? activeVariant.sku : product.sku;
    const currentQty = isVariant ? getAvailableQuantity(activeVariant) : getAvailableQuantity(product);
    
    // 3. Stock Status Logic
    // Use variant's tracking setting if available, otherwise default to product's setting
    const shouldTrackQty = isVariant ? (activeVariant.track_quantity ?? product.track_quantity) : product.track_quantity;
    const stockThreshold = isVariant ? (activeVariant.low_stock_threshold ?? product.low_stock_threshold) : product.low_stock_threshold;
    const shouldTrackLowStock = isVariant ? (activeVariant.track_low_stock ?? product.track_low_stock) : product.track_low_stock;

    // Status Check: Product must be active. If tracking is on, qty must be > 0.
    const isOutOfStock = product.status !== 'active' || (!!shouldTrackQty && currentQty <= 0);
    const isLowStock = !isOutOfStock && !!shouldTrackLowStock && currentQty <= stockThreshold;
    const breadcrumbCategory = getPrimaryCategoryName(product?.categories);
    const currentYoutubeKey = String(videoModal?.item?.videoId || videoModal?.item?.url || '').trim();
    const youtubeAspect = currentYoutubeKey ? youtubeAspectCache[currentYoutubeKey] : null;
    const fallbackYoutubeRatio = videoModal?.item?.isPortrait ? (9 / 16) : (16 / 9);
    const resolvedYoutubeRatio = youtubeAspect
        ? (Number(youtubeAspect.width || 0) / Number(youtubeAspect.height || 1))
        : fallbackYoutubeRatio;
    const isYoutubePortrait = resolvedYoutubeRatio < 1;
    const youtubeAspectStyle = youtubeAspect
        ? `${Number(youtubeAspect.width)} / ${Number(youtubeAspect.height)}`
        : (videoModal?.item?.isPortrait ? '9 / 16' : '16 / 9');

    return (
        <div className="bg-secondary min-h-screen pb-20">
            {/* Breadcrumb */}
            <div className="bg-white border-b border-gray-100">
                <div className="container mx-auto px-4 py-3 flex items-center gap-2 text-xs md:text-sm text-gray-500">
                    <Link to="/" className="hover:text-primary"><Home size={14} /></Link>
                    <span>/</span>
                    <Link to="/store" className="hover:text-primary">Store</Link>
                    {breadcrumbCategory && (
                        <>
                            <span>/</span>
                            <Link to={`/shop/${encodeURIComponent(breadcrumbCategory)}`} className="hover:text-primary line-clamp-1">
                                {breadcrumbCategory}
                            </Link>
                        </>
                    )}
                    <span>/</span>
                    <span className="font-bold text-gray-800 line-clamp-1">{product.title}</span>
                </div>
            </div>

            <div className="container mx-auto px-4 py-8">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
                    
                    {/* --- LEFT: MEDIA GALLERY --- */}
                    <div className="space-y-4">
                        {/* Main Image with Zoom */}
                        <div
                            className={`relative aspect-square bg-white rounded-2xl overflow-hidden border shadow-sm group
                            ${isOutOfStock ? 'grayscale opacity-75 cursor-not-allowed' : 'cursor-crosshair'}`}
                            onMouseMove={handleMouseMove}
                            onMouseLeave={() => setZoomStyle({ display: 'none' })}
                        >
                            <img
                                ref={mainImageRef}
                                src={getImgUrl(selectedImage)}
                                alt={product.title}
                                className="w-full h-full object-cover"
                            />
                            {/* Zoom Lens / Overlay */}
                            <div
                                className="absolute inset-0 z-10 pointer-events-none bg-no-repeat transition-opacity duration-200"
                                style={{
                                    ...zoomStyle,
                                    backgroundSize: '200%', // Zoom level
                                }}
                            />
                            {/* Tags */}
                            {product.ribbon_tag && (
                                <div className="absolute top-4 left-4 bg-accent text-primary text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wider shadow-md">
                                    {product.ribbon_tag}
                                </div>
                            )}
                        </div>

                        {/* Thumbnails */}
                        <div className="grid grid-cols-5 gap-2 md:gap-4">
                            {orderedMedia.map((item, idx) => {
                                const isActive = item.kind === 'image'
                                    ? selectedImage === item.url
                                    : (videoModal.open && videoModal.item?.embedUrl === item.embedUrl);
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        onClick={() => {
                                            if (item.kind === 'image') {
                                                setSelectedImage(item.url);
                                                return;
                                            }
                                            setVideoModal({ open: true, item });
                                        }}
                                        className={`relative aspect-square rounded-lg overflow-hidden border-2 transition-all
                                        ${isOutOfStock ? 'grayscale opacity-60' : ''}
                                        ${isActive ? 'border-primary' : 'border-transparent hover:border-gray-300'}`}
                                        aria-label={item.kind === 'video'
                                            ? `Play ${item.videoType === 'instagram' ? 'Instagram' : 'YouTube'} video ${idx + 1}`
                                            : `View image ${idx + 1}`
                                        }
                                    >
                                        {item.kind === 'image' ? (
                                            <img src={getImgUrl(item.url)} className="w-full h-full object-cover" alt={`thumb-${idx}`} />
                                        ) : (
                                            <>
                                                <div className={`absolute inset-0 flex items-center justify-center ${item.videoType === 'instagram' ? 'bg-gradient-to-br from-pink-500 via-rose-500 to-orange-400' : 'bg-gray-900'}`}>
                                                    {item.videoType === 'instagram' ? <Instagram size={24} className="text-white" /> : <Youtube size={24} className="text-white" />}
                                                </div>
                                                {item.thumbnailUrl ? (
                                                    <img
                                                        src={item.thumbnailUrl}
                                                        className="absolute inset-0 w-full h-full object-cover"
                                                        alt={`video-thumb-${idx}`}
                                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                                    />
                                                ) : null}
                                                <div className="absolute inset-0 bg-black/35 flex items-center justify-center">
                                                    <PlayCircle size={26} className="text-white drop-shadow-sm" />
                                                </div>
                                                <div className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                                                    {item.videoType === 'instagram' ? 'IG' : 'YT'}
                                                </div>
                                            </>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* --- RIGHT: PRODUCT INFO --- */}
                    <div>
                        <div className="flex justify-between items-start">
                            <div>
                                <h1 className="text-3xl md:text-4xl font-serif text-primary mb-2">{product.title}</h1>
                                {product.subtitle && <p className="text-gray-500 text-lg mb-4">{product.subtitle}</p>}
                            </div>
                            <div className="relative" ref={shareRef}>
                                <button
                                    onClick={handleShareClick}
                                    className="p-2 rounded-full bg-gray-100 hover:bg-gray-200 transition-colors text-gray-600"
                                >
                                    <Share2 size={20} />
                                </button>
                                {isShareOpen && (
                                    <div className="absolute right-0 mt-2 w-56 bg-white border border-gray-100 shadow-xl rounded-xl p-3 z-20">
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
                                            <Copy size={14} /> Copy Link
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Pricing */}
                        <div className="flex items-end gap-3 mb-6">
                            {/* If discount exists and is lower than MRP, show Discount. Else show MRP */}
                            <span className="text-3xl font-bold text-primary">
                                ₹{(currentDiscount > 0 && currentDiscount < currentPrice) 
                                    ? currentDiscount.toLocaleString() 
                                    : currentPrice.toLocaleString()}
                            </span>
                            
                            {/* Strike-through MRP only if there is a valid discount */}
                            {(currentDiscount > 0 && currentDiscount < currentPrice) && (
                                <span className="text-lg text-gray-400 line-through mb-1">
                                    ₹{currentPrice.toLocaleString()}
                                </span>
                            )}
                        </div>
                        <RazorpayAffordability
                            amountRupees={(currentDiscount > 0 && currentDiscount < currentPrice) ? currentDiscount : currentPrice}
                            className="mb-6"
                        />

                        {/* Stock Status */}
                        <div className="flex items-center gap-4 mb-6 text-sm">
                            {isOutOfStock ? (
                                <span className="flex items-center gap-1 text-red-500 font-bold bg-red-50 px-3 py-1 rounded-full">
                                    <AlertTriangle size={16} /> Out of Stock
                                </span>
                            ) : (
                                <span className="flex items-center gap-1 text-green-600 font-bold bg-green-50 px-3 py-1 rounded-full">
                                    <Check size={16} /> In Stock
                                </span>
                            )}
                            {isLowStock && (
                                <span className="text-orange-500 font-medium">
                                    Only {currentQty} left. Order soon.
                                </span>
                            )}
                            {currentSKU && <span className="text-gray-400">SKU: {currentSKU}</span>}
                        </div>

                        <p className="text-gray-600 leading-relaxed mb-8 border-b border-gray-100 pb-8">
                            {product.description}
                        </p>
                        {/* Variants Selection (Dropdown) */}
                        {product.variants && product.variants.length > 0 && (
                            <div className="mb-8">
                                <h3 className="text-sm font-bold text-gray-900 uppercase tracking-wider mb-3">
                                    Select Variant
                                </h3>
                                <div className="relative max-w-sm">
                                    <select
                                        value={activeVariantId || ''}
                                        onChange={(e) => {
                                            // Look up directly in our stable list
                                            const selected = sortedVariants.find(v => String(v.id) === e.target.value);
                                            handleVariantChange(selected);
                                        }}
                                        className="w-full appearance-none bg-white border border-gray-300 hover:border-primary text-gray-700 font-medium py-3 px-4 pr-10 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all cursor-pointer"
                                    >
                                        {/* [FIX] Map over sortedVariants for stable order */}
                                        {sortedVariants.map((variant) => (
                                            <option key={variant.id} value={variant.id}>
                                                {variant.variant_title}
                                            </option>
                                        ))}
                                    </select>
                                    
                                    {/* Custom Dropdown Arrow */}
                                    <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500">
                                        <ChevronDown size={20} />
                                    </div>
                                </div>
                            </div>
                        )}
                        {/* Action Buttons */}
                        <div className="flex gap-4 mb-10">
                            {selectedCartQty > 0 && !isOutOfStock ? (
                                <div className="flex-1 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 flex items-center justify-between px-2 py-2">
                                    <button
                                        type="button"
                                        onClick={handleDecrementSelectedQty}
                                        className="w-10 h-10 rounded-md border border-emerald-200 bg-white hover:bg-emerald-100 flex items-center justify-center"
                                        aria-label="Decrease quantity"
                                    >
                                        <Minus size={18} />
                                    </button>
                                    <span className="text-base font-bold min-w-20 text-center">{selectedCartQty} in cart</span>
                                    <button
                                        type="button"
                                        onClick={handleIncrementSelectedQty}
                                        className="w-10 h-10 rounded-md border border-emerald-200 bg-white hover:bg-emerald-100 flex items-center justify-center"
                                        aria-label="Increase quantity"
                                    >
                                        <Plus size={18} />
                                    </button>
                                </div>
                            ) : (
                                <button 
                                    disabled={isOutOfStock}
                                    className={`flex-1 btn-primary py-4 text-lg flex items-center justify-center transition-all
                                    ${isOutOfStock ? 'bg-gray-400 border-gray-400 cursor-not-allowed opacity-100 hover:bg-gray-400' : justAddedToCart ? 'bg-emerald-500 border-emerald-500 text-white' : 'hover:shadow-lg'}
                                    ${cartPressed ? 'scale-[0.99]' : 'scale-100'}`}
                                    onClick={() => !isOutOfStock && handleAddToCart()} 
                                >
                                    {justAddedToCart && !isOutOfStock ? <Check size={20} className="mr-2" /> : <ShoppingCart size={20} className="mr-2" />}
                                    {isOutOfStock ? 'Sold out' : justAddedToCart ? 'Added' : 'Add to Cart'}
                                </button>
                            )}
                            <button 
                                className={`px-4 py-4 rounded-lg border border-gray-300 hover:border-red-500 hover:text-red-500 transition-all duration-150 ${heartPressed ? 'scale-110' : 'scale-100'}`}
                                onClick={async () => {
                                    setHeartPressed(true);
                                    if (heartPressTimerRef.current) clearTimeout(heartPressTimerRef.current);
                                    heartPressTimerRef.current = setTimeout(() => setHeartPressed(false), 180);
                                    const selectedVariant = sortedVariants.find(v => String(v.id) === String(activeVariantId || ''));
                                    await toggleWishlist({
                                        productId: product.id,
                                        variantId: activeVariantId || '',
                                        productTitle: product.title,
                                        variantTitle: selectedVariant?.variant_title || ''
                                    });
                                }}
                            >
                                <Heart size={24} className={isWishlisted(product?.id, activeVariantId || '') ? 'fill-red-500 text-red-500' : ''} />
                            </button>
                        </div>

                        {/* Additional Info Accordion */}
                        <div className="border rounded-xl bg-white overflow-hidden">
                            {/* Standard Guarantee Item */}
                            <div className="border-b">
                                <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 text-left" onClick={() => setActiveAccordion(activeAccordion === 'guarantee' ? null : 'guarantee')}>
                                    <span className="font-bold flex items-center gap-3"><ShieldCheck size={22}/> 100% Quality Guarantee</span>
                                    {activeAccordion === 'guarantee' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </button>
                                {activeAccordion === 'guarantee' && (
                                    <div className="px-5 pb-4 text-gray-600 text-sm animate-fade-in">
                                        All our products go through rigorous quality checks. This item includes {polishWarrantyMonths}-month polish warranty from delivery date.
                                    </div>
                                )}
                            </div>

                            <div className="border-b">
                                <button className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 text-left" onClick={() => setActiveAccordion(activeAccordion === 'shipping' ? null : 'shipping')}>
                                    <span className="font-bold flex items-center gap-3"><Truck size={22}/> Pan India Shipping</span>
                                    {activeAccordion === 'shipping' ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                </button>
                                {activeAccordion === 'shipping' && (
                                    <div className="px-5 pb-4 text-gray-600 text-sm animate-fade-in">
                                        We deliver across India with secure packaging. Orders are shipped within 2-3 working days.
                                    </div>
                                )}
                            </div>

                            {/* Dynamic Items from DB */}
                            {parsedAdditionalInfo.map((info, i) => (
                                <div key={i} className={i !== parsedAdditionalInfo.length - 1 ? 'border-b' : ''}>
                                    <button 
                                        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 text-left"
                                        onClick={() => setActiveAccordion(activeAccordion === i ? null : i)}
                                    >
                                        <span className="font-bold text-gray-800">{info.title}</span>
                                        {activeAccordion === i ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                                    </button>
                                    {activeAccordion === i && (
                                        <div className="px-5 pb-4 text-gray-600 text-sm animate-fade-in whitespace-pre-line">
                                            {info.description}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>

                    </div>
                </div>

                {/* --- RELATED PRODUCTS --- */}
                {relatedProducts.length > 0 && (
                    <div className="mt-20">
                        <h2 className="text-2xl font-serif font-bold text-primary mb-8 flex items-center gap-3">
                            {(() => {
                                try {
                                    const rp = typeof product.related_products === 'string' ? JSON.parse(product.related_products) : product.related_products;
                                    return (rp && rp.show && rp.title) ? rp.title : "Explore Similar Products";
                                } catch { return "Explore Similar Products"; }
                            })()}
                            <ArrowRight size={24} className="text-accent" />
                        </h2>
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-6">
                            {relatedProducts.map(p => (
                                <ProductCard key={p.id} product={p} displayCategory={relatedCategoryRef.current || ''} />
                            ))}
                        </div>
                    </div>
                )}
            </div>
            {videoModal.open && videoModal.item && (
                <div className="fixed inset-0 z-[90] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
                    <div
                        className={`bg-white rounded-2xl shadow-2xl w-full max-h-[90vh] overflow-hidden flex flex-col ${
                            videoModal.item.videoType === 'instagram'
                                ? 'max-w-[350px]'
                                : (isYoutubePortrait ? 'max-w-[420px]' : 'max-w-3xl')
                        }`}
                    >
                        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                            <h3 className="text-sm font-semibold text-gray-800">
                                {videoModal.item.videoType === 'instagram' ? 'Instagram Video' : 'YouTube Video'}
                            </h3>
                            <button
                                type="button"
                                onClick={() => setVideoModal({ open: false, item: null })}
                                className="p-1 rounded-md hover:bg-gray-100 text-gray-500"
                                aria-label="Close video"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        {videoModal.item.videoType === 'instagram' && videoModal.item.permalink ? (
                            <div className="flex-1 p-2 bg-[#f6f6f6] overflow-hidden">
                                <div className="mx-auto h-full flex items-center justify-center">
                                    <blockquote
                                        className="instagram-media"
                                        data-instgrm-permalink={videoModal.item.permalink}
                                        data-instgrm-version="14"
                                        style={{
                                            background: '#FFF',
                                            border: 0,
                                            borderRadius: '3px',
                                            boxShadow: '0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15)',
                                            margin: '0 auto',
                                            maxWidth: '320px',
                                            minWidth: 0,
                                            padding: 0,
                                            width: '100%'
                                        }}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="bg-black max-h-[78vh] w-full" style={{ aspectRatio: youtubeAspectStyle }}>
                                <iframe
                                    src={videoModal.item.embedUrl}
                                    title={videoModal.item.videoType === 'instagram' ? 'Instagram Video' : 'YouTube Video'}
                                    className="w-full h-full"
                                    allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                                    allowFullScreen
                                />
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
