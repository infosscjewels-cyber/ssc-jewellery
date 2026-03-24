export const hasUnavailableCheckoutItems = (items = []) => (
    Array.isArray(items)
        ? items.some((item) => String(item?.status || '').toLowerCase() !== 'active' || Boolean(item?.isOutOfStock))
        : false
);
