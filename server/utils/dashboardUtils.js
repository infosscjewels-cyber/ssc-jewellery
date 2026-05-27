const { DEFAULT_ADMIN_QUICK_RANGE, normalizeAdminQuickRange } = require('./adminDateRanges');

const computeChange = (currentValue, previousValue) => {
    const current = Number(currentValue || 0);
    const previous = Number(previousValue || 0);
    if (!Number.isFinite(current) || !Number.isFinite(previous)) return null;
    if (previous === 0) return current === 0 ? 0 : 100;
    return Number((((current - previous) / Math.abs(previous)) * 100).toFixed(1));
};

const toSafeEnum = (value, allowed = [], fallback = '') => {
    const normalized = String(value || '').trim().toLowerCase();
    return allowed.includes(normalized) ? normalized : fallback;
};

const buildDashboardCacheKey = (query = {}) => JSON.stringify({
    quickRange: normalizeAdminQuickRange(query.quickRange || DEFAULT_ADMIN_QUICK_RANGE),
    startDate: String(query.startDate || ''),
    endDate: String(query.endDate || ''),
    comparisonMode: String(query.comparisonMode || 'previous_period'),
    status: String(query.status || 'all'),
    paymentMode: String(query.paymentMode || 'all'),
    sourceChannel: String(query.sourceChannel || 'all'),
    lowStockThreshold: Number(query.lowStockThreshold || 5)
});

const normalizeDashboardEventType = (value) => toSafeEnum(value, [
    'dashboard_opened',
    'kpi_clicked',
    'action_opened',
    'action_resolved',
    'goal_saved',
    'goal_deleted',
    'alerts_saved',
    'alerts_run',
    'filters_changed'
], 'dashboard_opened');

const normalizeDashboardPaymentMode = (value, { gateway = '' } = {}) => {
    const normalizedGateway = String(gateway || '').trim().toLowerCase();
    const normalizedValue = String(value || '').trim().toLowerCase();
    if (!normalizedValue) return 'unknown';

    if (normalizedGateway === 'icici') {
        if (normalizedValue === 'upi') return 'upi';
        if (['nb', 'netbanking', 'net_banking'].includes(normalizedValue)) return 'net_banking';
        if (['dc', 'debit_card'].includes(normalizedValue)) return 'debit_card';
        if (['cc', 'credit_card'].includes(normalizedValue)) return 'credit_card';
        if (normalizedValue === 'card') return 'card';
        return 'unknown';
    }

    return normalizedValue;
};

const resolveDashboardPaymentMode = ({
    gateway = '',
    mode = '',
    settlementMode = '',
    gatewayPayloadMode = ''
} = {}) => {
    const normalizedGateway = String(gateway || '').trim().toLowerCase();
    if (normalizedGateway === 'icici') {
        return normalizeDashboardPaymentMode(
            settlementMode || gatewayPayloadMode || mode,
            { gateway: normalizedGateway }
        );
    }
    return normalizeDashboardPaymentMode(mode, { gateway: normalizedGateway });
};

module.exports = {
    computeChange,
    toSafeEnum,
    buildDashboardCacheKey,
    normalizeDashboardEventType,
    normalizeDashboardPaymentMode,
    resolveDashboardPaymentMode
};
