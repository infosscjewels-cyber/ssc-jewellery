export const TIER_ORDER = ['regular', 'bronze', 'silver', 'gold', 'platinum'];

export const normalizeTierKey = (value = 'regular') => {
    const key = String(value || 'regular').trim().toLowerCase();
    return TIER_ORDER.includes(key) ? key : 'regular';
};

export const toTitleCase = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());

export const formatTierLabel = (tierOrLabel = 'regular') => {
    const raw = String(tierOrLabel || '').trim();
    if (!raw) return 'Basic';
    const key = raw.toLowerCase();
    if (key === 'regular') return 'Basic';
    return toTitleCase(raw);
};

export const getNextTierFromCurrent = (tier = 'regular') => {
    const key = normalizeTierKey(tier);
    const idx = TIER_ORDER.indexOf(key);
    if (idx < 0 || idx >= TIER_ORDER.length - 1) return null;
    return TIER_ORDER[idx + 1];
};

export const getMembershipLabel = (tierOrLabel = 'regular') => `${formatTierLabel(tierOrLabel)} Membership`;

export const getTierSpendKey = (tier = 'regular') => {
    const key = normalizeTierKey(tier);
    if (key === 'regular') return 'spend30';
    if (key === 'bronze') return 'spend60';
    if (key === 'silver') return 'spend90';
    return 'spend365';
};
