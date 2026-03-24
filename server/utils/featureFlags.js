const toBoolean = (value = '', fallback = false) => {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw);
};

const isSubCategoriesEnabled = () => toBoolean(process.env.ENABLE_SUB_CATEGORIES, false);

module.exports = {
    isSubCategoriesEnabled
};
