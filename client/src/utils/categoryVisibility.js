const AUTOPILOT_NATIVE_KEYS = new Set(['best_sellers', 'new_arrivals', 'offers']);

export const isCategoryVisibleInStorefront = (category = {}) => {
    if (!category || typeof category !== 'object') return false;
    if (!String(category.name || '').trim()) return false;
    if (Number(category.product_count || 0) > 0) return true;
    const systemKey = String(category.system_key || '').trim().toLowerCase();
    return Number(category.autopilot_enabled || 0) === 1 && AUTOPILOT_NATIVE_KEYS.has(systemKey);
};
