import { useEffect, useMemo, useRef, useState } from 'react';
import { Heart, ShoppingCart, Check, Minus, Plus } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useCart } from '../context/CartContext';
import { useWishlist } from '../context/WishlistContext';
import { vibrateTap } from '../utils/haptics';
import { useAuth } from '../context/AuthContext';
import { formatTierLabel } from '../utils/tierFormat';
import placeholderImg from '../assets/placeholder.jpg';

const EXTRA_DISCOUNT_BY_TIER = {
    regular: 0,
    bronze: 1,
    silver: 2,
    gold: 3,
    platinum: 5
};

export default function ProductCard({ product, displayCategory = '' }) {
    const [isHovered, setIsHovered] = useState(false);
    const [quickAddAdded, setQuickAddAdded] = useState(false);
    const [isUpdatingQty, setIsUpdatingQty] = useState(false);
    const [heartPressed, setHeartPressed] = useState(false);
    const [cartPressed, setCartPressed] = useState(false);
    const resetTimerRef = useRef(null);
    const heartPressTimerRef = useRef(null);
    const cartPressTimerRef = useRef(null);
    const { items, addItem, updateQuantity, openQuickAdd } = useCart();
    const { isWishlisted, toggleWishlist } = useWishlist();
    const { user } = useAuth();
    const navigate = useNavigate();

    // --- 1. Pricing Logic ---
    const getPriceDetails = () => {
        // Case A: Product has variants
        if (product.variants && product.variants.length > 0) {
            // Find the lowest price among all variants
            const prices = product.variants.map(v => {
                const p = parseFloat(v.price) || 0;
                const d = parseFloat(v.discount_price) || 0;
                return d > 0 ? d : p;
            });
            
            const minPrice = Math.min(...prices);
            
            return {
                displayPrice: minPrice,
                originalPrice: null, // We don't show crossed-out price for ranges usually
                label: 'From ' // Optional prefix
            };
        }

        // Case B: No variants (Standard Product)
        const mrp = parseFloat(product.mrp) || 0;
        const discountPrice = parseFloat(product.discount_price) || 0;

        if (discountPrice > 0 && discountPrice < mrp) {
            return {
                displayPrice: discountPrice,
                originalPrice: mrp,
                label: ''
            };
        }

        return {
            displayPrice: mrp,
            originalPrice: null,
            label: ''
        };
    };

    const { displayPrice, originalPrice, label } = getPriceDetails();
    const loyaltyTier = String(user?.loyaltyTier || 'regular').toLowerCase();
    const memberPct = Number(user?.loyaltyProfile?.extraDiscountPct ?? EXTRA_DISCOUNT_BY_TIER[loyaltyTier] ?? 0);
    const memberPrice = Math.max(0, Number(displayPrice || 0) * (1 - (memberPct / 100)));

    // --- 2. Discount Calculation for Ribbon ---
    const calculateDiscountPercentage = () => {
        if (originalPrice && displayPrice < originalPrice) {
            return Math.round(((originalPrice - displayPrice) / originalPrice) * 100);
        }
        return 0;
    };

    const discountPercentage = calculateDiscountPercentage();
    const productCartItems = useMemo(() => (
        items.filter((item) => String(item.productId) === String(product.id))
    ), [items, product.id]);
    const productCartQty = useMemo(
        () => productCartItems.reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        [productCartItems]
    );
    const inlineCartItem = useMemo(() => {
        if (!productCartItems.length) return null;
        if (!(product.variants && product.variants.length > 0)) {
            return productCartItems.find((item) => !item.variantId) || productCartItems[0];
        }
        if (productCartItems.length === 1) return productCartItems[0];
        return null;
    }, [product.variants, productCartItems]);
    const canAdjustInlineQty = Boolean(inlineCartItem);
    const isInactive = String(product?.status || '').toLowerCase() !== 'active';
    const getAvailableQuantity = (item = {}) => Number((item?.available_quantity ?? item?.quantity) || 0);
    const isOutOfStock = useMemo(() => {
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        if (variants.length > 0) {
            return variants.every((variant) => {
                const tracked = String(variant?.track_quantity) === '1' || String(variant?.track_quantity) === 'true' || variant?.track_quantity === true;
                if (!tracked) return false;
                return getAvailableQuantity(variant) <= 0;
            });
        }
        const tracked = String(product?.track_quantity) === '1' || String(product?.track_quantity) === 'true' || product?.track_quantity === true;
        if (!tracked) return false;
        return getAvailableQuantity(product) <= 0;
    }, [product]);
    const isUnavailable = isInactive || isOutOfStock;
    const lowStockCopy = useMemo(() => {
        const variants = Array.isArray(product?.variants) ? product.variants : [];
        if (variants.length > 1) {
            const hasUrgencyVariant = variants.some((variant) => {
                const tracked = String(variant?.track_quantity) === '1' || String(variant?.track_quantity) === 'true' || variant?.track_quantity === true;
                const trackLowStock = String(variant?.track_low_stock) === '1' || String(variant?.track_low_stock) === 'true' || variant?.track_low_stock === true;
                const qty = getAvailableQuantity(variant);
                const threshold = Number(variant?.low_stock_threshold || 0);
                return tracked && trackLowStock && qty > 0 && qty <= threshold;
            });
            return hasUrgencyVariant ? 'Selling fast' : '';
        }

        const source = variants[0] || product;
        const tracked = String(source?.track_quantity) === '1' || String(source?.track_quantity) === 'true' || source?.track_quantity === true;
        const trackLowStock = String(source?.track_low_stock) === '1' || String(source?.track_low_stock) === 'true' || source?.track_low_stock === true;
        const qty = getAvailableQuantity(source);
        const threshold = Number(source?.low_stock_threshold || 0);
        if (tracked && trackLowStock && qty > 0 && qty <= threshold) {
            return `Only ${qty} left`;
        }
        return '';
    }, [product]);
    const showUrgencyCopy = !isUnavailable && Boolean(lowStockCopy);
    const wishlisted = isWishlisted(product?.id);

    // --- 3. Image Logic (Based on your JSON 'media' array) ---
    const mainImage = product.media && product.media.length > 0 
        ? product.media[0].url 
        : placeholderImg;

    const handleWishlist = async (e) => {
        e.stopPropagation();
        e.preventDefault();

        setHeartPressed(true);
        if (heartPressTimerRef.current) clearTimeout(heartPressTimerRef.current);
        heartPressTimerRef.current = setTimeout(() => setHeartPressed(false), 180);

        await toggleWishlist({
            productId: product.id,
            productTitle: product.title
        });
    };

    useEffect(() => {
        const handleAdded = (event) => {
            const addedProductId = String(event?.detail?.productId || '');
            if (!addedProductId || addedProductId !== String(product.id || '')) return;

            setQuickAddAdded(true);
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
            resetTimerRef.current = setTimeout(() => {
                setQuickAddAdded(false);
            }, 1200);
        };

        window.addEventListener('cart:item-added', handleAdded);
        return () => {
            window.removeEventListener('cart:item-added', handleAdded);
            if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
            if (heartPressTimerRef.current) clearTimeout(heartPressTimerRef.current);
            if (cartPressTimerRef.current) clearTimeout(cartPressTimerRef.current);
        };
    }, [product.id]);

    const handleAddToCart = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setCartPressed(true);
        if (cartPressTimerRef.current) clearTimeout(cartPressTimerRef.current);
        cartPressTimerRef.current = setTimeout(() => setCartPressed(false), 180);
        if (product.variants && product.variants.length > 0) {
            if (isUnavailable) return;
            openQuickAdd(product);
            return;
        }
        if (isUnavailable) return;
        vibrateTap();
        await addItem({ product, quantity: 1 });
    };

    const handleIncrement = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isUpdatingQty || isUnavailable) return;
        if (!canAdjustInlineQty) {
            openQuickAdd(product);
            return;
        }
        vibrateTap();
        setIsUpdatingQty(true);
        try {
            await updateQuantity({
                productId: inlineCartItem.productId,
                variantId: inlineCartItem.variantId || '',
                quantity: Number(inlineCartItem.quantity || 0) + 1
            });
        } finally {
            setIsUpdatingQty(false);
        }
    };

    const handleDecrement = async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isUpdatingQty || !canAdjustInlineQty || isUnavailable) return;
        const nextQty = Number(inlineCartItem.quantity || 0) - 1;
        setIsUpdatingQty(true);
        try {
            await updateQuantity({
                productId: inlineCartItem.productId,
                variantId: inlineCartItem.variantId || '',
                quantity: nextQty
            });
        } finally {
            setIsUpdatingQty(false);
        }
    };

    const renderQuickAction = (isMobile = false) => {
        const wrapperClasses = isMobile
            ? 'mt-2.5 w-full'
            : `w-full transition-all duration-300 ${(quickAddAdded || isHovered || productCartQty > 0) ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'}`;
        const buttonClasses = isMobile
            ? `w-full font-bold py-2 rounded-lg border transition-all duration-150 flex items-center justify-center gap-2 ${cartPressed ? 'scale-[0.98]' : 'scale-100'}`
            : `w-full font-bold py-2 rounded-lg shadow-lg transition-all duration-150 flex items-center justify-center gap-2 ${cartPressed ? 'scale-[0.98]' : 'scale-100'}`;

        return (
            <div className={wrapperClasses}>
                {isUnavailable ? (
                    <button
                        disabled
                        className={`${buttonClasses} bg-gray-100 border-gray-200 text-gray-500 cursor-not-allowed`}
                    >
                        {isInactive ? 'Unavailable' : 'Out of Stock'}
                    </button>
                ) : productCartQty > 0 && canAdjustInlineQty ? (
                    <div className={`w-full rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 flex items-center justify-between px-2 ${isMobile ? 'py-1.5' : 'py-2'}`}>
                        <button
                            onClick={handleDecrement}
                            disabled={isUpdatingQty}
                            className="w-8 h-8 rounded-md border border-emerald-200 bg-white hover:bg-emerald-100 disabled:opacity-50 flex items-center justify-center"
                            aria-label="Decrease quantity"
                        >
                            <Minus size={16} />
                        </button>
                        <span className="text-sm font-bold min-w-10 text-center">{productCartQty}</span>
                        <button
                            onClick={handleIncrement}
                            disabled={isUpdatingQty}
                            className="w-8 h-8 rounded-md border border-emerald-200 bg-white hover:bg-emerald-100 disabled:opacity-50 flex items-center justify-center"
                            aria-label="Increase quantity"
                        >
                            <Plus size={16} />
                        </button>
                    </div>
                ) : (
                    <button
                        onClick={handleAddToCart}
                        className={`${buttonClasses} ${
                            quickAddAdded
                                ? 'bg-emerald-500 border-emerald-500 text-white'
                                : 'bg-white border-gray-200 text-gray-900 hover:bg-primary hover:text-white hover:border-primary'
                        }`}
                    >
                        {quickAddAdded ? <Check size={isMobile ? 16 : 18} /> : <ShoppingCart size={isMobile ? 16 : 18} />}
                        {quickAddAdded ? 'Added' : 'Add to cart'}
                    </button>
                )}
            </div>
        );
    };

    const resolvedCategoryLabel = String(displayCategory || '').trim() || (
        Array.isArray(product.categories) ? product.categories[0] : (product.categories || 'Collection')
    );

    return (
        <div className={`group relative tier-card-surface rounded-2xl border border-gray-100 hover:shadow-xl hover:border-accent/30 transition-all duration-300 transform hover:-translate-y-1 cursor-pointer transform-gpu isolate ${isOutOfStock ? 'grayscale opacity-80' : ''}`}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onClick={() => navigate(`/product/${product.id}`)}
        >
            {/* --- RIBBONS --- */}
            <div className="absolute top-0 left-0 z-20 flex flex-col items-start gap-1 rounded-tl-2xl overflow-hidden">
                {/* Priority 1: Calculated Discount */}
                {discountPercentage > 0 && (
                    <div className="bg-red-500 text-white text-[10px] md:text-xs font-bold px-3 py-1 rounded-br-lg shadow-sm">
                        {discountPercentage}% OFF
                    </div>
                )}
                
                {/* Priority 2: Explicit Ribbon Tag (New Arrival, etc.) */}
                {product.ribbon_tag && !discountPercentage && (
                    <div className="bg-accent text-primary text-[10px] md:text-xs font-bold px-3 py-1 rounded-br-lg shadow-sm">
                        {product.ribbon_tag}
                    </div>
                )}
            </div>

            {/* --- WISHLIST BUTTON --- */}
            <div className="absolute top-3 right-3 z-20 flex flex-col gap-2">
                <button
                    onClick={handleWishlist}
                    className={`p-2 bg-white/80 backdrop-blur-sm rounded-full text-gray-400 hover:text-red-500 hover:bg-white transition-all duration-150 shadow-sm ${heartPressed ? 'scale-110' : 'scale-100'}`}
                >
                    <Heart size={20} className={wishlisted ? 'fill-red-500 text-red-500' : ''} />
                </button>
                <button
                    onClick={handleAddToCart}
                    disabled={isUnavailable}
                    className={`md:hidden p-2 rounded-full backdrop-blur-sm transition-all duration-150 shadow-sm ${
                        isUnavailable
                            ? 'bg-white/70 text-gray-300 cursor-not-allowed'
                            : quickAddAdded
                                ? 'bg-emerald-500 text-white'
                                : 'bg-white/80 text-gray-700 hover:bg-white hover:text-primary'
                    } ${cartPressed ? 'scale-95' : 'scale-100'}`}
                    aria-label={quickAddAdded ? 'Added to cart' : 'Add to cart'}
                >
                    {quickAddAdded ? <Check size={18} /> : <ShoppingCart size={18} />}
                </button>
            </div>

            {/* --- IMAGE AREA --- */}
            <div className="relative aspect-[4/4.65] tier-muted-surface overflow-hidden rounded-t-2xl">
                <img 
                    src={mainImage} 
                    alt={product.title}
                    className={`w-full h-full object-cover transition-transform duration-700 ${isHovered ? 'scale-110' : 'scale-100'}`}
                    loading="lazy"
                    decoding="async"
                    onError={(e) => { e.target.src = placeholderImg; }}
                />
                {isUnavailable && (
                    <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/20">
                        <span className="bg-black/80 text-white text-xs md:text-sm font-bold px-3 py-1.5 rounded-lg uppercase tracking-wider backdrop-blur-sm shadow-md">
                            {isInactive ? 'Unavailable' : 'Out of Stock'}
                        </span>
                    </div>
                )}
                
                {/* Quick Add Overlay */}
                <div className="hidden md:block absolute inset-x-0 bottom-0 p-3.5">
                    {renderQuickAction(false)}
                </div>
            </div>

            {/* --- INFO AREA --- */}
            <div className="px-4 py-3.5">
                {/* Categories */}
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1 font-medium">
                    {resolvedCategoryLabel}
                </p>
                
                {/* Title */}
                <h3 className="font-bold text-gray-800 text-base line-clamp-2 min-h-[2.75rem] mb-1 group-hover:text-primary transition-colors">
                    {product.title}
                </h3>
                
                {/* Subtitle (Optional) */}
                {product.subtitle && (
                    <p className="text-xs text-gray-500 mb-2">{product.subtitle}</p>
                )}
                
                {/* Price Section */}
                <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-lg font-bold text-primary">
                        {label}₹{displayPrice.toLocaleString()}
                    </span>
                    {originalPrice && (
                        <span className="text-sm text-gray-400 line-through decoration-red-400">
                            ₹{originalPrice.toLocaleString()}
                        </span>
                    )}
                </div>
                {memberPct > 0 && (
                    <p className="text-[11px] text-blue-700 mt-1">
                        {formatTierLabel(loyaltyTier)} member price: ₹{memberPrice.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ({memberPct}% extra off)
                    </p>
                )}
                <div className="mt-2 min-h-[1rem]">
                    {showUrgencyCopy ? (
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                            {lowStockCopy}
                        </p>
                    ) : null}
                </div>
            </div>
        </div>
    );
}
