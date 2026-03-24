export const shouldRunDiscoverySearch = (searchTerm = '', hasMore = true) => {
    void hasMore;
    return String(searchTerm || '').trim().length >= 2;
};

export const isDiscoveryItemInStock = (product = {}) => {
    const variants = Array.isArray(product?.variants) ? product.variants : [];
    if (variants.length > 0) {
        return variants.some((variant) => {
            const tracked = String(variant?.track_quantity) === '1'
                || String(variant?.track_quantity) === 'true'
                || variant?.track_quantity === true;
            if (!tracked) return true;
            return Number((variant?.available_quantity ?? variant?.quantity) || 0) > 0;
        });
    }
    const tracked = String(product?.track_quantity) === '1'
        || String(product?.track_quantity) === 'true'
        || product?.track_quantity === true;
    if (!tracked) return true;
    return Number((product?.available_quantity ?? product?.quantity) || 0) > 0;
};
