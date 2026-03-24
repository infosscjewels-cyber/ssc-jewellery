import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Heart, ShoppingCart, Trash2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useWishlist } from '../context/WishlistContext';
import { useCart } from '../context/CartContext';
import { productService } from '../services/productService';
import { useSocket } from '../context/SocketContext';
import wishlistIllustration from '../assets/wishlist.svg';

export default function Wishlist() {
    const { user } = useAuth();
    const { wishlistItems, loading: wishlistLoading, removeFromWishlist } = useWishlist();
    const { addItem, openQuickAdd } = useCart();
    const { socket } = useSocket();
    const [productLookup, setProductLookup] = useState({});
    const [isLoading, setIsLoading] = useState(false);
    const productLookupRef = useRef({});

    useEffect(() => {
        productLookupRef.current = productLookup;
    }, [productLookup]);

    useEffect(() => {
        let cancelled = false;

        const loadWishlistProducts = async () => {
            if (!wishlistItems.length) {
                setProductLookup((prev) => (Object.keys(prev).length ? {} : prev));
                return;
            }

            const targetIds = [...new Set(wishlistItems.map((entry) => String(entry.productId || '').trim()).filter(Boolean))];
            const cachedLookup = productLookupRef.current || {};
            const missingIds = targetIds.filter((id) => !cachedLookup[id]);
            if (!missingIds.length) return;

            setIsLoading(true);
            try {
                const responses = await Promise.all(
                    missingIds.map((productId) => productService.getProduct(productId).catch(() => null))
                );
                if (!cancelled) {
                    setProductLookup((prev) => {
                        const validResponses = responses.filter(Boolean);
                        if (!validResponses.length) return prev;
                        const next = { ...prev };
                        validResponses.forEach((product) => {
                            next[String(product.id)] = product;
                        });
                        return next;
                    });
                }
            } finally {
                if (!cancelled) setIsLoading(false);
            }
        };

        loadWishlistProducts();
        return () => {
            cancelled = true;
        };
    }, [wishlistItems]);

    const wishlistEntries = useMemo(() => {
        return wishlistItems
            .map((entry) => {
                const product = productLookup[String(entry.productId || '').trim()];
                if (!product) return null;
                const variants = Array.isArray(product.variants) ? product.variants : [];
                const variant = entry.variantId
                    ? variants.find((v) => String(v.id) === String(entry.variantId))
                    : null;
                const hasMissingVariant = Boolean(entry.variantId && !variant);
                const mediaList = Array.isArray(product.media) ? product.media : [];
                const baseImage = mediaList[0]?.url || mediaList[0] || null;
                const imageUrl = variant?.image_url || baseImage;
                const price = hasMissingVariant
                    ? Number(product.discount_price || product.mrp || 0)
                    : Number(variant?.discount_price || variant?.price || product.discount_price || product.mrp || 0);
                const mrp = hasMissingVariant
                    ? Number(product.mrp || 0)
                    : Number(variant?.price || product.mrp || 0);
                return {
                    key: `${entry.productId}__${entry.variantId || 'base'}`,
                    productId: entry.productId,
                    variantId: entry.variantId || '',
                    product,
                    variant,
                    title: product.title,
                    variantTitle: variant?.variant_title || '',
                    imageUrl,
                    price,
                    mrp,
                    hasMissingVariant,
                    status: String(product.status || 'active').toLowerCase()
                };
            })
            .filter(Boolean);
    }, [wishlistItems, productLookup]);

    useEffect(() => {
        if (!socket) return;

        const handleProductUpdate = (updated = {}) => {
            const updatedId = String(updated?.id || '').trim();
            if (!updatedId) return;
            setProductLookup((prev) => {
                if (!prev[updatedId]) return prev;
                return {
                    ...prev,
                    [updatedId]: { ...prev[updatedId], ...updated }
                };
            });
        };

        const handleProductDelete = ({ id } = {}) => {
            const deletedId = String(id || '').trim();
            if (!deletedId) return;
            setProductLookup((prev) => {
                if (!prev[deletedId]) return prev;
                const next = { ...prev };
                delete next[deletedId];
                return next;
            });
        };

        socket.on('product:update', handleProductUpdate);
        socket.on('product:delete', handleProductDelete);

        return () => {
            socket.off('product:update', handleProductUpdate);
            socket.off('product:delete', handleProductDelete);
        };
    }, [socket]);

    if (!user) return null;

    return (
        <div className="min-h-screen bg-secondary">
            <div className="max-w-6xl mx-auto px-4 md:px-8 py-10 md:py-12">
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
                    <div className="flex items-center gap-3">
                        <div className="p-3 rounded-2xl bg-primary/10 text-primary">
                            <Heart size={20} />
                        </div>
                        <div>
                            <h1 className="text-2xl md:text-3xl font-serif text-primary">My Wishlist</h1>
                            <p className="text-sm text-gray-500 mt-0.5">{wishlistItems.length} saved items</p>
                        </div>
                    </div>
                </div>

                {isLoading || wishlistLoading ? (
                    <div className="mt-8 text-sm text-gray-500">Loading wishlist...</div>
                ) : wishlistEntries.length === 0 ? (
                    <div className="mt-8 bg-white rounded-2xl border border-gray-100 shadow-sm p-10 text-center">
                        <img
                            src={wishlistIllustration}
                            alt="Wishlist empty"
                            className="mx-auto w-40 md:w-48"
                        />
                        <p className="text-lg font-semibold text-gray-800 mt-5">Your wishlist is empty</p>
                        <p className="text-sm text-gray-500 mt-2">Discover beautiful picks and add your favorites for later.</p>
                        <Link
                            to="/shop"
                            className="inline-flex items-center justify-center rounded-xl border border-gray-200 text-primary font-semibold px-5 py-2.5 hover:bg-primary/5 transition-colors mt-5"
                        >
                            Shop Now
                        </Link>
                    </div>
                ) : (
                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
                        {wishlistEntries.map((entry) => (
                            <div key={entry.key} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                                <Link to={`/product/${entry.productId}`} className="block aspect-[4/3] bg-gray-50 overflow-hidden">
                                    {entry.imageUrl ? (
                                        <img src={entry.imageUrl} alt={entry.title} className="w-full h-full object-cover" />
                                    ) : null}
                                </Link>
                                <div className="p-4 space-y-2">
                                    <Link to={`/product/${entry.productId}`} className="font-semibold text-gray-800 hover:text-primary line-clamp-1">
                                        {entry.title}
                                    </Link>
                                    <p className="text-xs text-gray-500">
                                        {entry.hasMissingVariant
                                            ? 'Saved variant is no longer available. Review product options.'
                                            : (entry.variantTitle ? `Variant: ${entry.variantTitle}` : 'Default product')}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <span className="text-base font-bold text-primary">₹{entry.price.toLocaleString('en-IN')}</span>
                                        {entry.mrp > entry.price && (
                                            <span className="text-xs text-gray-400 line-through">₹{entry.mrp.toLocaleString('en-IN')}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between pt-2">
                                        <span className={`text-xs font-semibold ${entry.status === 'active' ? 'text-emerald-600' : 'text-amber-600'}`}>
                                            {entry.status === 'active'
                                                ? (entry.hasMissingVariant ? 'Variant changed' : 'Active')
                                                : 'Unavailable'}
                                        </span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                type="button"
                                                disabled={entry.status !== 'active'}
                                                onClick={() => {
                                                    const variants = Array.isArray(entry.product?.variants) ? entry.product.variants : [];
                                                    if (entry.hasMissingVariant && variants.length > 0) {
                                                        openQuickAdd(entry.product);
                                                        return;
                                                    }
                                                    if (entry.variant) {
                                                        addItem({ product: entry.product, variant: entry.variant, quantity: 1 });
                                                        return;
                                                    }
                                                    if (variants.length > 0) {
                                                        openQuickAdd(entry.product);
                                                        return;
                                                    }
                                                    addItem({ product: entry.product, quantity: 1 });
                                                }}
                                                className="inline-flex items-center gap-1 rounded-lg border border-gray-200 px-2.5 py-1 text-xs font-semibold text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
                                            >
                                                <ShoppingCart size={12} /> {entry.hasMissingVariant ? 'Choose Options' : 'Add to Cart'}
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => removeFromWishlist({
                                                    productId: entry.productId,
                                                    variantId: entry.variantId,
                                                    productTitle: entry.title,
                                                    variantTitle: entry.variantTitle
                                                })}
                                                className="inline-flex items-center gap-1 text-xs text-red-500 hover:text-red-600"
                                            >
                                                <Trash2 size={12} /> Remove
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
