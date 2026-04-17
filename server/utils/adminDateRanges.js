const DEFAULT_ADMIN_QUICK_RANGE = 'current_month';
const DEFAULT_ADMIN_ABANDONED_RANGE = 'current_month';
const CALENDAR_QUICK_RANGES = new Set(['current_week', 'current_month', 'last_3_months']);
const LEGACY_QUICK_RANGE_ALIASES = {
    last_7_days: 'current_week',
    last_30_days: 'current_month',
    last_1_month: 'current_month',
    last_90_days: 'last_3_months'
};
const LEGACY_ABANDONED_RANGE_ALIASES = {
    '7': 'current_week',
    '30': 'current_month',
    '90': 'last_3_months',
    ...LEGACY_QUICK_RANGE_ALIASES
};

const toUtcDateOnly = (value = new Date()) => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(Date.UTC(parsed.getUTCFullYear(), parsed.getUTCMonth(), parsed.getUTCDate()));
};

const formatUtcDateOnly = (value) => {
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    if (Number.isNaN(parsed.getTime())) return '';
    return parsed.toISOString().slice(0, 10);
};

const addUtcDays = (value, days) => {
    const base = toUtcDateOnly(value);
    if (!base) return null;
    base.setUTCDate(base.getUTCDate() + Number(days || 0));
    return base;
};

const addUtcMonths = (value, months) => {
    const base = toUtcDateOnly(value);
    if (!base) return null;
    base.setUTCMonth(base.getUTCMonth() + Number(months || 0));
    return base;
};

const diffUtcDays = (start, end) => {
    const safeStart = toUtcDateOnly(start);
    const safeEnd = toUtcDateOnly(end);
    if (!safeStart || !safeEnd) return 0;
    return Math.floor((safeEnd.getTime() - safeStart.getTime()) / (24 * 60 * 60 * 1000));
};

const startOfUtcWeek = (value) => {
    const base = toUtcDateOnly(value);
    if (!base) return null;
    const weekday = base.getUTCDay();
    const shift = weekday === 0 ? -6 : 1 - weekday;
    return addUtcDays(base, shift);
};

const startOfUtcMonth = (value) => {
    const base = toUtcDateOnly(value);
    if (!base) return null;
    return new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
};

const normalizeAdminQuickRange = (value, { fallback = DEFAULT_ADMIN_QUICK_RANGE } = {}) => {
    const raw = String(value || '').trim().toLowerCase();
    if (raw === 'latest_10' || raw === 'custom') return raw;
    if (CALENDAR_QUICK_RANGES.has(raw)) return raw;
    return LEGACY_QUICK_RANGE_ALIASES[raw] || fallback;
};

const normalizeAbandonedRange = (value, { fallback = DEFAULT_ADMIN_ABANDONED_RANGE } = {}) => {
    const raw = String(value ?? '').trim().toLowerCase();
    if (raw === 'lifetime') return 'lifetime';
    if (CALENDAR_QUICK_RANGES.has(raw)) return raw;
    if (LEGACY_ABANDONED_RANGE_ALIASES[raw]) return LEGACY_ABANDONED_RANGE_ALIASES[raw];
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
        return Math.max(1, Math.min(90, Math.floor(numeric)));
    }
    return fallback;
};

const resolveNamedRange = (value, { now = new Date() } = {}) => {
    const quickRange = normalizeAdminQuickRange(value);
    if (!CALENDAR_QUICK_RANGES.has(quickRange)) return null;
    const endDate = toUtcDateOnly(now);
    if (!endDate) return null;
    let startDate = endDate;
    if (quickRange === 'current_week') {
        startDate = startOfUtcWeek(endDate);
    } else if (quickRange === 'current_month') {
        startDate = startOfUtcMonth(endDate);
    } else if (quickRange === 'last_3_months') {
        startDate = startOfUtcMonth(addUtcMonths(endDate, -2));
    }
    if (!startDate) return null;
    return {
        quickRange,
        startDate,
        endDate,
        startDateText: formatUtcDateOnly(startDate),
        endDateText: formatUtcDateOnly(endDate),
        periodDays: diffUtcDays(startDate, endDate) + 1
    };
};

module.exports = {
    DEFAULT_ADMIN_ABANDONED_RANGE,
    DEFAULT_ADMIN_QUICK_RANGE,
    addUtcDays,
    addUtcMonths,
    diffUtcDays,
    formatUtcDateOnly,
    normalizeAbandonedRange,
    normalizeAdminQuickRange,
    resolveNamedRange,
    toUtcDateOnly
};
