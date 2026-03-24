import { useEffect, useMemo, useState } from 'react';
import { productService } from '../services/productService';

const dedupeById = (products = []) => {
    const seen = new Set();
    const next = [];
    products.forEach((product) => {
        const id = String(product?.id || '');
        if (!id || seen.has(id)) return;
        seen.add(id);
        next.push(product);
    });
    return next;
};

export const useCartRecommendations = ({ items = [], wishlistProductIds = [], limit = 6 }) => {
    const [recommendations, setRecommendations] = useState([]);
    const [loading, setLoading] = useState(false);

    const cartProductIds = useMemo(
        () => new Set(items.map((item) => String(item.productId || item.product_id || ''))),
        [items]
    );

    const categoryNames = useMemo(() => {
        const names = new Set();
        items.forEach((item) => {
            const categories = Array.isArray(item.categories) ? item.categories : [];
            categories.forEach((name) => {
                const normalized = String(name || '').trim();
                if (normalized) names.add(normalized);
            });
        });
        return Array.from(names);
    }, [items]);

    const normalizedWishlistIds = useMemo(
        () =>
            Array.from(
                new Set(
                    (Array.isArray(wishlistProductIds) ? wishlistProductIds : [])
                        .map((id) => String(id || '').trim())
                        .filter(Boolean)
                )
            ),
        [wishlistProductIds]
    );

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (!categoryNames.length && !normalizedWishlistIds.length) {
                setRecommendations([]);
                return;
            }

            setLoading(true);
            try {
                const targetCategories = categoryNames.slice(0, 3);
                const [categoryResponses, wishlistProducts] = await Promise.all([
                    targetCategories.length
                        ? Promise.all(
                            targetCategories.map((category) =>
                                productService.getProducts(1, category, 'active', 'newest', 16)
                            )
                        )
                        : Promise.resolve([]),
                    normalizedWishlistIds.length
                        ? Promise.all(
                            normalizedWishlistIds
                                .slice(0, 12)
                                .map((productId) =>
                                    productService.getProduct(productId).catch(() => null)
                                )
                        )
                        : Promise.resolve([])
                ]);

                const categoryProducts = categoryResponses.flatMap((res) =>
                    Array.isArray(res?.products) ? res.products : []
                );
                const combined = [...wishlistProducts.filter(Boolean), ...categoryProducts];
                const unique = dedupeById(combined).filter((product) => {
                    const productId = String(product?.id || '');
                    const isActive = String(product?.status || 'active').toLowerCase() === 'active';
                    const inCart = cartProductIds.has(productId);
                    return productId && isActive && !inCart;
                });
                if (!cancelled) {
                    setRecommendations(unique.slice(0, limit));
                }
            } catch {
                if (!cancelled) {
                    setRecommendations([]);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        load();
        return () => {
            cancelled = true;
        };
    }, [cartProductIds, categoryNames, normalizedWishlistIds, limit]);

    return { recommendations, loading };
};
