import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { useSocket } from './SocketContext';
import { wishlistService } from '../services/wishlistService';
import { playFacebookLikeSound } from '../utils/uiSound';

const WishlistContext = createContext({
    wishlist: [],
    wishlistItems: [],
    wishlistCount: 0,
    loading: false,
    isWishlisted: () => false,
    addToWishlist: () => {},
    removeFromWishlist: () => {},
    toggleWishlist: () => false
});

export const WishlistProvider = ({ children }) => {
    const { user } = useAuth();
    const toast = useToast();
    const { socket } = useSocket();
    const [wishlistItems, setWishlistItems] = useState([]);
    const [loading, setLoading] = useState(false);

    const normalizeWishlistItems = useCallback((payload = {}) => {
        const rawItems = Array.isArray(payload?.items) ? payload.items : [];
        if (rawItems.length > 0) {
            return rawItems
                .map((entry) => ({
                    productId: String(entry?.productId || entry?.product_id || '').trim(),
                    variantId: String(entry?.variantId || entry?.variant_id || '').trim()
                }))
                .filter((entry) => entry.productId);
        }
        const legacyIds = Array.isArray(payload?.productIds) ? payload.productIds : [];
        return legacyIds
            .map((id) => ({ productId: String(id || '').trim(), variantId: '' }))
            .filter((entry) => entry.productId);
    }, []);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            if (!user?.id) {
                setLoading(false);
                setWishlistItems((prev) => (prev.length ? [] : prev));
                return;
            }
            setLoading(true);
            try {
                const data = await wishlistService.getWishlist();
                if (!cancelled) {
                    const nextItems = normalizeWishlistItems(data);
                    setWishlistItems((prev) => {
                        if (
                            prev.length === nextItems.length
                            && prev.every((entry, idx) => entry.productId === nextItems[idx]?.productId && entry.variantId === nextItems[idx]?.variantId)
                        ) {
                            return prev;
                        }
                        return nextItems;
                    });
                }
            } catch (error) {
                if (!cancelled) {
                    setWishlistItems((prev) => (prev.length ? [] : prev));
                    toast.error(error?.message || 'Failed to load wishlist');
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };
        load();
        return () => {
            cancelled = true;
        };
    }, [user?.id, normalizeWishlistItems]);

    useEffect(() => {
        if (!socket || !user?.id) return;
        const handleWishlistUpdate = (payload = {}) => {
            setWishlistItems(normalizeWishlistItems(payload));
        };
        socket.on('wishlist:update', handleWishlistUpdate);
        return () => {
            socket.off('wishlist:update', handleWishlistUpdate);
        };
    }, [socket, user?.id, normalizeWishlistItems]);

    const toPayload = useCallback((productOrObject, variantArg = '') => {
        if (productOrObject && typeof productOrObject === 'object') {
            return {
                productId: String(productOrObject.productId || '').trim(),
                variantId: String(productOrObject.variantId || '').trim(),
                productTitle: String(productOrObject.productTitle || productOrObject.title || '').trim(),
                variantTitle: String(productOrObject.variantTitle || '').trim()
            };
        }
        return {
            productId: String(productOrObject || '').trim(),
            variantId: String(variantArg || '').trim(),
            productTitle: '',
            variantTitle: ''
        };
    }, []);

    const isWishlisted = useCallback((productOrObject, variantArg = '') => {
        const { productId, variantId } = toPayload(productOrObject, variantArg);
        if (!productId) return false;
        if (!variantId) {
            return wishlistItems.some((entry) => entry.productId === productId);
        }
        return wishlistItems.some((entry) => (
            entry.productId === productId
            && (entry.variantId === variantId || entry.variantId === '')
        ));
    }, [wishlistItems, toPayload]);

    const resolveWishlistRemovalTarget = useCallback((productId, variantId = '', removeAllVariants = false) => {
        const targetProductId = String(productId || '').trim();
        const targetVariantId = String(variantId || '').trim();
        const hasExactMatch = wishlistItems.some((entry) => (
            entry.productId === targetProductId && entry.variantId === targetVariantId
        ));
        const hasBaseMatch = wishlistItems.some((entry) => (
            entry.productId === targetProductId && !entry.variantId
        ));

        if (removeAllVariants) {
            return { exists: hasExactMatch || hasBaseMatch, variantId: '', removeAllVariants: true };
        }
        if (!targetVariantId) {
            return { exists: hasExactMatch, variantId: targetVariantId, removeAllVariants: false };
        }
        if (hasExactMatch) {
            return { exists: true, variantId: targetVariantId, removeAllVariants: false };
        }
        if (hasBaseMatch) {
            return { exists: true, variantId: '', removeAllVariants: true };
        }
        return { exists: false, variantId: targetVariantId, removeAllVariants: false };
    }, [wishlistItems]);

    const addToWishlist = useCallback(async (productOrObject, variantArg = '') => {
        if (!user?.id) {
            toast.info('Please login to save products in wishlist');
            return false;
        }
        const { productId, variantId, productTitle, variantTitle } = toPayload(productOrObject, variantArg);
        if (!productId) return false;
        if (isWishlisted(productId, variantId)) return false;
        try {
            const data = await wishlistService.addItem(productId, variantId);
            const nextItems = normalizeWishlistItems(data);
            setWishlistItems(nextItems);
            const label = [productTitle || 'Item', variantTitle].filter(Boolean).join(' - ');
            toast.success(`Added ${label} to the wishlist`);
            playFacebookLikeSound();
            return true;
        } catch (error) {
            toast.error(error?.message || 'Failed to update wishlist');
            return false;
        }
    }, [toast, user?.id, isWishlisted, normalizeWishlistItems, toPayload]);

    const removeFromWishlist = useCallback(async (productOrObject, variantArg = '', options = {}) => {
        if (!user?.id) {
            toast.info('Please login to manage wishlist');
            return false;
        }
        const { silent = false, removeAllVariants = false } = options || {};
        const { productId, variantId, productTitle, variantTitle } = toPayload(productOrObject, variantArg);
        if (!productId) return false;
        const resolvedTarget = resolveWishlistRemovalTarget(productId, variantId, removeAllVariants);
        if (!resolvedTarget.exists) return false;
        try {
            const data = await wishlistService.removeItem(
                productId,
                resolvedTarget.variantId,
                resolvedTarget.removeAllVariants
            );
            const nextItems = normalizeWishlistItems(data);
            setWishlistItems(nextItems);
            if (!silent) {
                const label = [productTitle || 'Item', variantTitle].filter(Boolean).join(' - ');
                toast.info(`Removed ${label} from the wishlist`);
            }
            return true;
        } catch (error) {
            toast.error(error?.message || 'Failed to update wishlist');
            return false;
        }
    }, [toast, user?.id, normalizeWishlistItems, toPayload, resolveWishlistRemovalTarget]);

    const toggleWishlist = useCallback(async (productOrObject, variantArg = '') => {
        const { productId, variantId } = toPayload(productOrObject, variantArg);
        if (!productId) return false;
        if (isWishlisted(productId, variantId)) {
            await removeFromWishlist(productOrObject, variantArg);
            return false;
        }
        await addToWishlist(productOrObject, variantArg);
        return true;
    }, [addToWishlist, removeFromWishlist, isWishlisted, toPayload]);

    const wishlist = useMemo(() => (
        Array.from(new Set(wishlistItems.map((entry) => entry.productId)))
    ), [wishlistItems]);

    const value = useMemo(() => ({
        wishlist,
        wishlistItems,
        wishlistCount: wishlistItems.length,
        loading,
        isWishlisted,
        addToWishlist,
        removeFromWishlist,
        toggleWishlist
    }), [wishlist, wishlistItems, loading, isWishlisted, addToWishlist, removeFromWishlist, toggleWishlist]);

    return (
        <WishlistContext.Provider value={value}>
            {children}
        </WishlistContext.Provider>
    );
};

export const useWishlist = () => useContext(WishlistContext);
