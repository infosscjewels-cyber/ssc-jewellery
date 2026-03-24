import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useCart } from '../context/CartContext';
import { useAuth } from '../context/AuthContext';
import { useShipping } from '../context/ShippingContext';
import { Heart, X, Minus, Plus, ShoppingCart } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import cartIllustration from '../assets/cart.svg';
import { useCartRecommendations } from '../hooks/useCartRecommendations';
import { useWishlist } from '../context/WishlistContext';
import { vibrateTap } from '../utils/haptics';
import RazorpayAffordability from './RazorpayAffordability';
import { computeShippingPreview } from '../utils/shippingPreview';
import { usePublicCompanyInfo } from '../hooks/usePublicSiteShell';

export default function CartDrawer() {
    const { isOpen, closeCart, items, itemCount, subtotal, updateQuantity, removeItem, isSyncing, addItem, openQuickAdd } = useCart();
    const { user } = useAuth();
    const { zones } = useShipping();
    const { addToWishlist, wishlist } = useWishlist();
    const { companyInfo } = usePublicCompanyInfo();
    const location = useLocation();
    const [render, setRender] = useState(false);
    const [active, setActive] = useState(false);
    const [showFreeShippingFx, setShowFreeShippingFx] = useState(false);
    const [struckShippingFee, setStruckShippingFee] = useState(null);
    const confettiLayerRef = useRef(null);
    const prevSubtotalRef = useRef(null);
    const prevHasFreeShippingRef = useRef(false);
    const prevShippingFeeRef = useRef(0);
    const freeFxTimerRef = useRef(null);
    const { recommendations } = useCartRecommendations({ items, wishlistProductIds: wishlist, limit: 4 });

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

    const freeProgress = useMemo(() => {
        if (!shippingPreview?.freeThreshold) return null;
        const pct = Math.min(100, (subtotal / shippingPreview.freeThreshold) * 100);
        const remaining = Math.max(0, shippingPreview.freeThreshold - subtotal);
        return { pct, remaining };
    }, [shippingPreview?.freeThreshold, subtotal]);
    const hasFreeShipping = useMemo(() => Number(shippingPreview?.fee || 0) === 0, [shippingPreview?.fee]);
    const shouldShowProgress = !!freeProgress && !hasFreeShipping;
    const isShippingUnavailable = Boolean(shippingPreview?.isUnavailable);
    const cartTotal = useMemo(
        () => Number(subtotal || 0) + Number(shippingPreview?.fee || 0),
        [subtotal, shippingPreview?.fee]
    );
    const canRenderDrawerWidget = !['/cart', '/checkout'].includes(String(location.pathname || '').toLowerCase());
    const storefrontOpen = companyInfo?.storefrontOpen !== false;
    const isAtMaxQuantity = (item) => Boolean(item?.trackQuantity && Number(item?.availableQuantity || 0) > 0 && Number(item?.quantity || 0) >= Number(item?.availableQuantity || 0));

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

        if (active && subtotalIncreased && justUnlockedFree) {
            const previousShippingFee = Number(prevShippingFeeRef.current || 0);
            if (previousShippingFee > 0) {
                setStruckShippingFee(previousShippingFee);
            }
            setShowFreeShippingFx(true);

            const colors = ['#10b981', '#0ea5e9', '#f59e0b', '#ef4444', '#8b5cf6', '#22c55e'];
            const count = 30;
            for (let i = 0; i < count; i += 1) {
                const piece = document.createElement('span');
                piece.style.position = 'absolute';
                piece.style.right = `${20 + Math.random() * 45}%`;
                piece.style.top = `${10 + Math.random() * 18}%`;
                piece.style.width = '6px';
                piece.style.height = '10px';
                piece.style.borderRadius = '2px';
                piece.style.background = colors[Math.floor(Math.random() * colors.length)];
                piece.style.opacity = '0.95';
                layer.appendChild(piece);

                const dx = (Math.random() - 0.5) * 220;
                const dy = 90 + Math.random() * 200;
                const rotate = (Math.random() - 0.5) * 880;
                piece.animate(
                    [
                        { transform: 'translate(0px, 0px) rotate(0deg)', opacity: 1 },
                        { transform: `translate(${dx}px, ${dy}px) rotate(${rotate}deg)`, opacity: 0 }
                    ],
                    {
                        duration: 900 + Math.random() * 300,
                        easing: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
                        fill: 'forwards'
                    }
                );
                setTimeout(() => piece.remove(), 1300);
            }

            if (freeFxTimerRef.current) clearTimeout(freeFxTimerRef.current);
            freeFxTimerRef.current = setTimeout(() => setShowFreeShippingFx(false), 1400);
        }

        prevSubtotalRef.current = subtotal;
        prevHasFreeShippingRef.current = hasFreeShipping;
        prevShippingFeeRef.current = Number(shippingPreview?.fee || 0);
    }, [active, hasFreeShipping, shippingPreview?.fee, subtotal]);

    useEffect(() => {
        return () => {
            if (freeFxTimerRef.current) clearTimeout(freeFxTimerRef.current);
        };
    }, []);

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

    useEffect(() => {
        if (isOpen) {
            setRender(true);
            const raf = requestAnimationFrame(() => setActive(true));
            return () => cancelAnimationFrame(raf);
        }

        setActive(false);
        if (render) {
            const t = setTimeout(() => {
                setRender(false);
            }, 280);
            return () => clearTimeout(t);
        }
    }, [isOpen, render]);

    if (!render) return null;

    return createPortal(
        <div className="fixed inset-0 z-[120]">
            <div
                className={`absolute inset-0 bg-black/35 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${active ? 'opacity-100' : 'opacity-0'}`}
                onClick={closeCart}
            />
            <div
                className={`absolute right-0 top-0 h-[100dvh] max-h-[100dvh] w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden will-change-transform transition-[transform,opacity] duration-300 ease-out motion-reduce:transition-none ${active ? 'translate-x-0 opacity-100' : 'translate-x-6 opacity-0'}`}
            >
                <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <ShoppingCart size={20} className="text-primary" />
                        <h3 className="font-bold text-gray-800">Your Cart</h3>
                        <span className="text-xs text-gray-400">({itemCount})</span>
                    </div>
                    <button onClick={closeCart} className="p-2 rounded-lg hover:bg-gray-100 text-gray-500">
                        <X size={18} />
                    </button>
                </div>

                <div className="min-h-[50dvh] flex-1 overflow-y-auto overscroll-contain touch-pan-y p-5 space-y-4 [-webkit-overflow-scrolling:touch]">
                    {isSyncing && items.length === 0 && (
                        <div className="text-xs text-gray-400">Syncing your cart...</div>
                    )}
                    {items.length === 0 && !isSyncing && (
                        <div className="py-10 flex flex-col items-center text-center gap-6">
                            <img src={cartIllustration} alt="Empty cart" className="w-44 md:w-52" />
                            <div>
                                <h3 className="text-lg font-semibold text-gray-800">Your cart is empty</h3>
                                <p className="text-sm text-gray-500 mt-2">Add products to continue checkout.</p>
                            </div>
                            <Link
                                to="/shop"
                                className="inline-flex items-center justify-center rounded-xl border border-gray-200 text-primary font-semibold px-5 py-2.5 hover:bg-primary/5 transition-colors"
                                onClick={closeCart}
                            >
                                Explore collection
                            </Link>
                        </div>
                    )}
                    {items.map(item => {
                        const price = Number(item.price || 0);
                        const mrp = Number(item.compareAt || 0);
                        const hasDiscount = mrp > price;
                        const discountPct = hasDiscount ? Math.round(((mrp - price) / mrp) * 100) : 0;
                        return (
                            <div key={item.key} className={`flex gap-3 items-center ${item.isOutOfStock ? 'grayscale opacity-80' : ''}`}>
                                <div className="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden border border-gray-200">
                                    {item.imageUrl ? (
                                        <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                                    ) : null}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-bold text-gray-800 line-clamp-1">{item.title}</p>
                                    {item.isOutOfStock && (
                                        <span className="inline-flex mt-1 text-[10px] px-2 py-0.5 rounded-full bg-black text-white uppercase tracking-wide">
                                            Out of Stock
                                        </span>
                                    )}
                                    {item.variantTitle && (
                                        <p className="text-xs text-gray-500 line-clamp-1">{item.variantTitle}</p>
                                    )}
                                    <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                                        <p className="text-sm font-bold text-primary">₹{price.toLocaleString()}</p>
                                        {hasDiscount && (
                                            <>
                                                <p className="text-[11px] text-gray-400 line-through">₹{mrp.toLocaleString()}</p>
                                                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-50 text-red-600 font-semibold">
                                                    {discountPct}% OFF
                                                </span>
                                            </>
                                        )}
                                    </div>
                                </div>
                                <div className="flex flex-col items-end gap-2">
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => updateQuantity({ productId: item.productId, variantId: item.variantId, quantity: item.quantity - 1 })}
                                            className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50"
                                        >
                                            <Minus size={14} />
                                        </button>
                                        <span className="text-sm font-bold w-6 text-center">{item.quantity}</span>
                                        <button
                                            onClick={() => {
                                                vibrateTap();
                                                updateQuantity({ productId: item.productId, variantId: item.variantId, quantity: item.quantity + 1 });
                                            }}
                                            disabled={item.isOutOfStock || isAtMaxQuantity(item)}
                                            className="p-1.5 rounded-md border border-gray-200 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
                                        >
                                            <Plus size={14} />
                                        </button>
                                    </div>
                                    <button
                                        onClick={() => removeItem({ productId: item.productId, variantId: item.variantId })}
                                        className="text-xs text-gray-400 hover:text-red-500"
                                    >
                                        Remove
                                    </button>
                                    <button
                                        onClick={() => moveToWishlist(item)}
                                        className="text-xs text-primary hover:text-primary/80 inline-flex items-center gap-1"
                                    >
                                        <Heart size={10} /> Wishlist
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                    {(items.length > 0 || wishlist.length > 0) && recommendations.length > 0 && (
                        <div className="pt-4 border-t border-gray-100">
                            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">
                                You may also like
                            </p>
                            <div className="space-y-3">
                                {recommendations.map((product) => {
                                    const media = Array.isArray(product.media) ? product.media : [];
                                    const imageUrl = media[0]?.url || media[0] || null;
                                    const hasVariants = Array.isArray(product.variants) && product.variants.length > 0;
                                    const price = hasVariants
                                        ? Math.min(...product.variants.map((variant) => Number(variant.discount_price || variant.price || 0)))
                                        : Number(product.discount_price || product.mrp || 0);
                                    return (
                                        <div key={product.id} className="flex items-center gap-3">
                                            <Link to={`/product/${product.id}`} onClick={closeCart} className="w-12 h-12 rounded-lg bg-gray-100 border border-gray-200 overflow-hidden shrink-0">
                                                {imageUrl && <img src={imageUrl} alt={product.title} className="w-full h-full object-cover" />}
                                            </Link>
                                            <div className="flex-1 min-w-0">
                                                <Link to={`/product/${product.id}`} onClick={closeCart} className="text-sm font-semibold text-gray-800 line-clamp-1 hover:text-primary">
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
                                                        closeCart();
                                                        return;
                                                    }
                                                    addItem({ product, quantity: 1 });
                                                }}
                                                className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:bg-gray-50"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {items.length > 0 && (
                <div className="relative max-h-[42dvh] overflow-y-auto overscroll-contain touch-pan-y border-t border-gray-100 p-5 [-webkit-overflow-scrolling:touch]">
                    <div ref={confettiLayerRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
                    <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
                        <span>Subtotal</span>
                        <span className="font-bold text-gray-800">₹{subtotal.toLocaleString()}</span>
                    </div>
                    <div className="flex items-center justify-between text-sm text-gray-500 mb-3">
                        <span>Shipping</span>
                        {shippingPreview == null ? (
                            <span className="font-bold text-gray-800">Calculated at checkout</span>
                        ) : isShippingUnavailable ? (
                            <span className="font-bold text-amber-700">Unavailable</span>
                        ) : hasFreeShipping ? (
                            <span className="inline-flex items-center gap-2 font-bold">
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
                            <span className="font-bold text-gray-800">₹{Number(shippingPreview.fee || 0).toLocaleString()}</span>
                        )}
                    </div>
                    {freeProgress && !isShippingUnavailable && (
                        <div className={`overflow-hidden transition-all duration-300 ease-out ${shouldShowProgress ? 'max-h-40 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0'}`}>
                            <div className="flex items-center justify-between text-xs text-gray-500">
                                <span>Free shipping progress</span>
                                <span>₹{Math.max(0, freeProgress.remaining).toLocaleString()} to go</span>
                            </div>
                            <div className="mt-2 h-2 rounded-full bg-gray-100 overflow-hidden">
                                <div className="h-full bg-emerald-500 transition-all duration-300" style={{ width: `${freeProgress.pct}%` }} />
                            </div>
                            <Link
                                to="/shop"
                                className="mt-3 w-full inline-flex items-center justify-center rounded-xl border border-gray-200 text-primary font-semibold py-2.5 hover:bg-primary/5 transition-colors"
                                onClick={closeCart}
                            >
                                Explore collection
                            </Link>
                        </div>
                    )}
                    <div className="mb-3 flex justify-end">
                        <Link
                            to={user ? '/cart' : '/login?redirect=%2Fcart'}
                            className="text-xs font-semibold text-primary hover:underline"
                            onClick={closeCart}
                        >
                            View cart
                        </Link>
                    </div>
                    {storefrontOpen ? (
                        <Link
                            to={user ? '/checkout' : '/login?redirect=%2Fcheckout'}
                            className="w-full inline-flex items-center justify-center bg-primary text-accent font-bold py-3 rounded-xl shadow-lg shadow-primary/20 hover:bg-primary-light transition-all"
                            onClick={closeCart}
                        >
                            Proceed to Checkout
                        </Link>
                    ) : (
                        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
                            <p className="text-sm font-semibold text-amber-900">Storefront is temporarily closed for new orders.</p>
                            <p className="mt-1 text-xs text-amber-800">Existing orders will still be fulfilled. You can keep items in cart and checkout when ordering reopens.</p>
                        </div>
                    )}
                    <RazorpayAffordability amountRupees={cartTotal} className="mt-3" showWidget={canRenderDrawerWidget} />
                    {isShippingUnavailable && (
                        <p className="text-[10px] text-amber-700 text-center mt-2">
                            Shipping is not configured for your saved state yet.
                        </p>
                    )}
                    <p className="text-[10px] text-gray-400 text-center mt-2">
                        {storefrontOpen
                            ? 'Checkout requires login. We will prompt you later.'
                            : 'Browsing, cart, wishlist, and order tracking stay available while ordering is paused.'}
                    </p>
                </div>
                )}
            </div>
        </div>
        ,
        document.body
    );
}
