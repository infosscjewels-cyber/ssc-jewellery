import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useShipping } from '../context/ShippingContext';
import { useWishlist } from '../context/WishlistContext';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';
import cartIllustration from '../assets/cart.svg';
import { useCartRecommendations } from '../hooks/useCartRecommendations';
import { vibrateTap } from '../utils/haptics';
import RazorpayAffordability from '../components/RazorpayAffordability';
import { formatTierLabel } from '../utils/tierFormat';
import { computeShippingPreview } from '../utils/shippingPreview';

const EXTRA_DISCOUNT_BY_TIER = {
    regular: 0,
    bronze: 1,
    silver: 2,
    gold: 3,
    platinum: 5
};

export default function CartPage() {
    const { items, itemCount, subtotal, updateQuantity, removeItem, isSyncing, addItem, openQuickAdd } = useCart();
    const { user } = useAuth();
    const { zones } = useShipping();
    const { addToWishlist, wishlist } = useWishlist();
    const { companyInfo } = usePublicCompanyInfo();
    const [showFreeShippingFx, setShowFreeShippingFx] = useState(false);
    const [struckShippingFee, setStruckShippingFee] = useState(null);
    const confettiLayerRef = useRef(null);
    const prevSubtotalRef = useRef(null);
    const prevHasFreeShippingRef = useRef(false);
    const prevShippingFeeRef = useRef(0);
    const freeFxTimerRef = useRef(null);
    const { recommendations } = useCartRecommendations({ items, wishlistProductIds: wishlist, limit: 6 });
    const isAtMaxQuantity = (item) => Boolean(item?.trackQuantity && Number(item?.availableQuantity || 0) > 0 && Number(item?.quantity || 0) >= Number(item?.availableQuantity || 0));

    const moveToWishlist = async (item) => {
        const moved = await addToWishlist({
            productId: item.productId,
            variantId: item.variantId || '',
            productTitle: item.title || '',
            variantTitle: item.variantTitle || ''
        });
        if (!moved) return;
        await removeItem({ productId: item.productId, variantId: item.variantId });
    };

    const totalWeightKg = useMemo(() => items.reduce((sum, item) => {
        const weight = Number(item.weightKg || 0);
        return sum + weight * Number(item.quantity || 0);
    }, 0), [items]);

    const shippingPreview = useMemo(() => computeShippingPreview({
        zones,
        state: user?.address?.state,
        subtotal,
        totalWeightKg
    }), [zones, user?.address?.state, subtotal, totalWeightKg]);

    const cartTotalBeforeMemberPerks = useMemo(() => {
        if (!shippingPreview) return subtotal;
        return Number(subtotal || 0) + Number(shippingPreview.fee || 0);
    }, [subtotal, shippingPreview]);
    const loyaltyTier = String(user?.loyaltyTier || 'regular').toLowerCase();
    const memberDiscountPct = Number(user?.loyaltyProfile?.extraDiscountPct ?? EXTRA_DISCOUNT_BY_TIER[loyaltyTier] ?? 0);
    const memberShippingDiscountPct = Number(user?.loyaltyProfile?.shippingDiscountPct ?? 0);
    const estimatedMemberDiscount = useMemo(
        () => Math.max(0, Number(((Number(subtotal || 0) * memberDiscountPct) / 100).toFixed(2))),
        [subtotal, memberDiscountPct]
    );
    const estimatedMemberShippingBenefit = useMemo(() => {
        const shippingFee = Number(shippingPreview?.fee || 0);
        return Math.max(0, Number(((shippingFee * memberShippingDiscountPct) / 100).toFixed(2)));
    }, [shippingPreview?.fee, memberShippingDiscountPct]);
    const cartTotal = useMemo(() => {
        return Math.max(0, Number(cartTotalBeforeMemberPerks || 0) - estimatedMemberDiscount - estimatedMemberShippingBenefit);
    }, [cartTotalBeforeMemberPerks, estimatedMemberDiscount, estimatedMemberShippingBenefit]);
    const totalSavings = useMemo(() => {
        return items.reduce((sum, item) => {
            const mrp = Number(item.compareAt || 0);
            const price = Number(item.price || 0);
            const qty = Number(item.quantity || 0);
            if (mrp <= price || qty <= 0) return sum;
            return sum + (mrp - price) * qty;
        }, 0);
    }, [items]);

    const freeProgress = useMemo(() => {
        if (!shippingPreview?.freeThreshold) return null;
        const pct = Math.min(100, (subtotal / shippingPreview.freeThreshold) * 100);
        const remaining = Math.max(0, shippingPreview.freeThreshold - subtotal);
        return { pct, remaining };
    }, [shippingPreview, subtotal]);
    const hasFreeShipping = useMemo(() => Number(shippingPreview?.fee || 0) === 0, [shippingPreview?.fee]);
    const shouldShowProgress = !!freeProgress && !hasFreeShipping;
    const isShippingUnavailable = Boolean(shippingPreview?.isUnavailable);
    const storefrontOpen = companyInfo?.storefrontOpen !== false;

    useEffect(() => {
        const layer = confettiLayerRef.current;
        if (!layer) return;

        if (prevSubtotalRef.current == null) {
            prevSubtotalRef.current = subtotal;
            prevHasFreeShippingRef.current = hasFreeShipping;
            prevShippingFeeRef.current = Number(shippingPreview?.fee || 0);
            return;
        }

        const subtotalIncreased = subtotal > prevSubtotalRef.current;
        const justUnlockedFree = !prevHasFreeShippingRef.current && hasFreeShipping;

        if (user && subtotalIncreased && justUnlockedFree) {
            const previousShippingFee = Number(prevShippingFeeRef.current || 0);
            if (previousShippingFee > 0) {
                requestAnimationFrame(() => setStruckShippingFee(previousShippingFee));
            }
            requestAnimationFrame(() => setShowFreeShippingFx(true));

            const colors = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#22c55e'];
            for (let i = 0; i < 32; i += 1) {
                const piece = document.createElement('span');
                piece.style.position = 'absolute';
                piece.style.right = `${18 + Math.random() * 48}%`;
                piece.style.top = `${8 + Math.random() * 20}%`;
                piece.style.width = '7px';
                piece.style.height = '11px';
                piece.style.borderRadius = '2px';
                piece.style.background = colors[Math.floor(Math.random() * colors.length)];
                layer.appendChild(piece);

                const dx = (Math.random() - 0.5) * 260;
                const dy = 100 + Math.random() * 220;
                const rotate = (Math.random() - 0.5) * 920;
                piece.animate(
                    [
                        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
                        { transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`, opacity: 0 }
                    ],
                    { duration: 950 + Math.random() * 280, easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)', fill: 'forwards' }
                );
                setTimeout(() => piece.remove(), 1400);
            }

            if (freeFxTimerRef.current) clearTimeout(freeFxTimerRef.current);
            freeFxTimerRef.current = setTimeout(() => setShowFreeShippingFx(false), 1500);
        }

        prevSubtotalRef.current = subtotal;
        prevHasFreeShippingRef.current = hasFreeShipping;
        prevShippingFeeRef.current = Number(shippingPreview?.fee || 0);
    }, [hasFreeShipping, shippingPreview?.fee, subtotal, user]);

    useEffect(() => {
        return () => {
            if (freeFxTimerRef.current) clearTimeout(freeFxTimerRef.current);
        };
    }, []);

    return (
        <div className="min-h-screen bg-secondary">
            <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-12">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <div className={`flex flex-col md:flex-row md:items-center gap-4 ${items.length === 0 ? 'justify-center text-center' : 'justify-start'}`}>
                        <div className={`flex items-center gap-3 ${items.length === 0 ? 'justify-center' : ''}`}>
                            <div className="p-3 rounded-2xl bg-primary/10 text-primary">
                                <ShoppingCart size={20} />
                            </div>
                            <div>
                                <h1 className="text-2xl md:text-3xl font-serif text-primary">Shopping Cart</h1>
                                <p className="text-sm text-gray-500 mt-0.5">{itemCount} items in your cart</p>
                            </div>
                        </div>
                    </div>
                </div>

                <div className={`grid grid-cols-1 gap-6 mt-6 ${items.length > 0 ? 'lg:grid-cols-[1.5fr_0.7fr]' : ''}`}>
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                        {isSyncing && items.length === 0 && (
                            <div className="text-sm text-gray-400">Syncing your cart...</div>
                        )}
                        {items.length === 0 && !isSyncing && (
                            <div className="py-12 flex flex-col items-center text-center gap-6">
                                <img src={cartIllustration} alt="Empty cart" className="w-52 md:w-64" />
                                <div>
                                    <h3 className="text-xl font-semibold text-gray-800">Your cart is empty</h3>
                                    <p className="text-sm text-gray-500 mt-2">
                                        Add pieces you love and we will keep them ready for checkout.
                                    </p>
                                </div>
                                <Link
                                    to="/shop"
                                    className="inline-flex items-center justify-center rounded-xl border border-gray-200 text-primary font-semibold px-6 py-3 hover:bg-primary/5 transition-colors"
                                >
                                    Explore collection
                                </Link>
                            </div>
                        )}
                        <div className="space-y-6">
                            {items.map(item => (
                                <div key={item.key} className={`border-b border-gray-100 pb-6 ${item.isOutOfStock ? 'grayscale opacity-80' : ''}`}>
                                    <div className="flex gap-4">
                                        <div className="w-20 h-20 md:w-24 md:h-24 rounded-2xl bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
                                            {item.imageUrl && <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            {(() => {
                                                const price = Number(item.price || 0);
                                                const mrp = Number(item.compareAt || 0);
                                                const hasDiscount = mrp > price;
                                                const discountPct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : 0;
                                                const lowStockCopy = item.isLowStock
                                                    ? `Only ${Number(item.availableQuantity || 0)} left. Checkout soon.`
                                                    : '';
                                                return (
                                                    <>
                                                    <p className="text-base font-semibold text-gray-800 line-clamp-1">{item.title}</p>
                                                    {item.variantTitle && <p className="text-sm text-gray-500 line-clamp-1">{item.variantTitle}</p>}
                                                    {item.isOutOfStock && (
                                                        <span className="inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full bg-black text-white uppercase tracking-wide">
                                                            Out of Stock
                                                        </span>
                                                    )}
                                                    {!item.isOutOfStock && lowStockCopy && (
                                                        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                                                            {lowStockCopy}
                                                        </p>
                                                    )}
                                                    <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                        <p className="text-sm text-primary font-semibold">₹{price.toLocaleString()}</p>
                                                        {hasDiscount && (
                                                            <>
                                                                <p className="text-xs text-gray-400 line-through">₹{mrp.toLocaleString()}</p>
                                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                                                                    {discountPct}% OFF
                                                                </span>
                                                            </>
                                                        )}
                                                    </div>
                                            <p className="text-xs text-gray-500 mt-1">
                                                        ₹{price.toLocaleString()} x {item.quantity} = ₹{(price * item.quantity).toLocaleString()}
                                            </p>
                                                    </>
                                                );
                                            })()}
                                        </div>
                                    </div>
                                    <div className="mt-3 flex items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 border border-gray-200 rounded-xl px-2 py-1">
                                            <button
                                                onClick={() => updateQuantity({ productId: item.productId, variantId: item.variantId, quantity: item.quantity - 1 })}
                                                className="p-1 rounded-lg hover:bg-gray-50"
                                            >
                                                <Minus size={14} />
                                            </button>
                                            <span className="min-w-[24px] text-center font-semibold text-gray-700">{item.quantity}</span>
                                            <button
                                                onClick={() => {
                                                    vibrateTap();
                                                    updateQuantity({ productId: item.productId, variantId: item.variantId, quantity: item.quantity + 1 });
                                                }}
                                                disabled={item.isOutOfStock || isAtMaxQuantity(item)}
                                                className="p-1 rounded-lg hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                <Plus size={14} />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-3">
                                            <button
                                                onClick={() => moveToWishlist(item)}
                                                className="inline-flex items-center gap-1 text-xs text-primary hover:text-primary/80"
                                            >
                                                <Heart size={12} /> Move to wishlist
                                            </button>
                                            <button
                                                onClick={() => removeItem({ productId: item.productId, variantId: item.variantId })}
                                                className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600"
                                            >
                                                <Trash2 size={12} /> Remove
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                        {(items.length > 0 || wishlist.length > 0) && recommendations.length > 0 && (
                            <div className="mt-8">
                                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-4">
                                    You may also like
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {recommendations.slice(0, 4).map((product) => {
                                        const media = Array.isArray(product.media) ? product.media : [];
                                        const imageUrl = media[0]?.url || media[0] || null;
                                        const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
                                        const price = hasVariants
                                            ? Math.min(...product.variants.map((variant) => Number(variant.discount_price || variant.price || 0)))
                                            : Number(product.discount_price || product.mrp || 0);
                                        return (
                                            <div key={product.id} className="rounded-xl border border-gray-100 bg-gray-50 p-3 flex items-center gap-3">
                                                <Link to={`/product/${product.id}`} className="w-14 h-14 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
                                                    {imageUrl && <img src={imageUrl} alt={product.title} className="w-full h-full object-cover" />}
                                                </Link>
                                                <div className="flex-1 min-w-0">
                                                    <Link to={`/product/${product.id}`} className="text-sm font-semibold text-gray-800 line-clamp-1 hover:text-primary">
                                                        {product.title}
                                                    </Link>
                                                    <p className="text-xs text-primary font-semibold mt-1">₹{Number(price || 0).toLocaleString()}</p>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => {
                                                        vibrateTap();
                                                        if (hasVariants) {
                                                            openQuickAdd(product);
                                                            return;
                                                        }
                                                        addItem({ product, quantity: 1 });
                                                    }}
                                                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-white"
                                                >
                                                    Add
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div className="mt-4 flex justify-center">
                                    <Link
                                        to="/shop"
                                        className="inline-flex items-center justify-center rounded-xl border border-gray-200 text-primary font-semibold px-5 py-2.5 hover:bg-primary/5 transition-colors"
                                    >
                                        Explore collection
                                    </Link>
                                </div>
                            </div>
                        )}
                    </div>

                    {items.length > 0 && (
                    <div className="space-y-6">
                        <div className="relative bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                            <div ref={confettiLayerRef} className="pointer-events-none absolute inset-0 overflow-hidden rounded-2xl" />
                            <h2 className="text-lg font-semibold text-gray-800">Order Summary</h2>
                            <div className="mt-4 space-y-2 text-sm text-gray-500">
                                <div className="flex items-center justify-between">
                                    <span>Subtotal</span>
                                    <span className="font-semibold text-gray-800">₹{subtotal.toLocaleString()}</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <span>Shipping</span>
                                    {shippingPreview == null ? (
                                        <span className="font-semibold text-gray-800">Calculated during checkout</span>
                                    ) : isShippingUnavailable ? (
                                        <span className="font-semibold text-amber-700">Unavailable for this state</span>
                                    ) : hasFreeShipping ? (
                                        <span className="inline-flex items-center gap-2 font-semibold">
                                            {struckShippingFee != null && struckShippingFee > 0 && (
                                                <span className={`text-gray-400 transition-all duration-500 ${showFreeShippingFx ? 'line-through opacity-100' : 'line-through opacity-70'}`}>
                                                    ₹{struckShippingFee.toLocaleString()}
                                                </span>
                                            )}
                                            <span className={`text-emerald-600 transition-all duration-300 ${showFreeShippingFx ? 'scale-110' : 'scale-100'}`}>
                                                Free
                                            </span>
                                        </span>
                                    ) : (
                                        <span className="font-semibold text-gray-800">₹{Number(shippingPreview.fee || 0).toLocaleString()}</span>
                                    )}
                                </div>
                                {estimatedMemberDiscount > 0 && (
                                    <div className="flex items-center justify-between text-blue-700">
                                        <span>Estimated Member Discount ({formatTierLabel(loyaltyTier)})</span>
                                        <span className="font-semibold">- ₹{estimatedMemberDiscount.toLocaleString('en-IN')}</span>
                                    </div>
                                )}
                                {estimatedMemberShippingBenefit > 0 && (
                                    <div className="flex items-center justify-between text-blue-700">
                                        <span>Estimated Member Shipping Benefit</span>
                                        <span className="font-semibold">- ₹{estimatedMemberShippingBenefit.toLocaleString('en-IN')}</span>
                                    </div>
                                )}
                                {freeProgress && !isShippingUnavailable && (
                                    <div className={`overflow-hidden transition-all duration-300 ease-out ${shouldShowProgress ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'}`}>
                                        <div className="flex items-center justify-between text-xs text-gray-500 mt-2">
                                            <span>Free shipping progress</span>
                                            <span>₹{Math.max(0, freeProgress.remaining).toLocaleString()} to go</span>
                                        </div>
                                        <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                                            <div className="h-full bg-emerald-500" style={{ width: `${freeProgress.pct}%` }} />
                                        </div>
                                        <Link
                                            to="/shop"
                                            className="mt-3 inline-flex items-center justify-center w-full rounded-xl border border-gray-200 text-primary font-semibold py-2.5 hover:bg-primary/5 transition-colors"
                                        >
                                            Explore collection
                                        </Link>
                                    </div>
                                )}
                                {totalSavings > 0 && (
                                    <div className="flex items-center justify-between text-emerald-700">
                                        <span>Total savings</span>
                                        <span className="font-semibold">₹{totalSavings.toLocaleString()}</span>
                                    </div>
                                )}
                                <div className="border-t border-gray-100 pt-3 flex items-center justify-between text-base font-semibold text-gray-800">
                                    <span>Total</span>
                                    <span>{isShippingUnavailable ? 'Update address at checkout' : `₹${cartTotal.toLocaleString()}`}</span>
                                </div>
                            </div>
                            {isShippingUnavailable && (
                                <p className="mt-3 text-xs text-amber-700">
                                    Shipping is not currently configured for your saved state. You can update the delivery address during checkout.
                                </p>
                            )}
                            <RazorpayAffordability amountRupees={cartTotal} className="mt-4" />
                            {storefrontOpen ? (
                                <Link
                                    to={user ? '/checkout' : '/login?redirect=%2Fcheckout'}
                                    className="mt-6 w-full inline-flex items-center justify-center bg-primary text-accent font-bold py-3 rounded-xl shadow-lg shadow-primary/20 hover:bg-primary-light transition-all"
                                >
                                    Continue to Checkout
                                </Link>
                            ) : (
                                <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                                    Storefront is temporarily closed for new orders. Existing orders will still be fulfilled.
                                </div>
                            )}
                            <p className="text-[11px] text-gray-400 text-center mt-2">
                                {storefrontOpen ? 'Checkout requires login. We’ll guide you to sign in if needed.' : 'You can keep items in cart and return when ordering reopens.'}
                            </p>
                        </div>
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                            <h3 className="text-sm font-semibold text-gray-800">Need help?</h3>
                            <p className="text-sm text-gray-500 mt-2">Chat with our team for sizing or delivery questions.</p>
                            <Link to="/contact" className="inline-flex items-center justify-center mt-4 px-4 py-2 rounded-xl border border-gray-200 text-sm font-semibold text-primary hover:bg-primary/5">
                                Contact support
                            </Link>
                        </div>
                    </div>
                    )}
                </div>
            </div>
        </div>
    );
}
