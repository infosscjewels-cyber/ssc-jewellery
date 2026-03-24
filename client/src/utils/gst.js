const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const roundToTwo = (value) => Math.round(toFiniteNumber(value, 0) * 100) / 100;

const formatNumber = (value, locale = 'en-IN') => {
    return roundToTwo(value).toLocaleString(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
};

export const getGstRateSplit = (ratePercent = 0, locale = 'en-IN') => {
    const totalRate = Math.max(0, toFiniteNumber(ratePercent, 0));
    const halfRate = roundToTwo(totalRate / 2);
    return {
        totalRate,
        sgstRate: halfRate,
        cgstRate: halfRate,
        totalRateLabel: `${formatNumber(totalRate, locale)}%`,
        sgstRateLabel: `${formatNumber(halfRate, locale)}%`,
        cgstRateLabel: `${formatNumber(halfRate, locale)}%`,
        splitRateLabel: `SGST ${formatNumber(halfRate, locale)}% + CGST ${formatNumber(halfRate, locale)}%`
    };
};

export const getGstAmountSplit = (taxAmount = 0, locale = 'en-IN') => {
    const totalAmount = Math.max(0, toFiniteNumber(taxAmount, 0));
    const halfAmount = roundToTwo(totalAmount / 2);
    return {
        totalAmount,
        sgstAmount: halfAmount,
        cgstAmount: halfAmount,
        totalAmountLabel: `₹${formatNumber(totalAmount, locale)}`,
        sgstAmountLabel: `₹${formatNumber(halfAmount, locale)}`,
        cgstAmountLabel: `₹${formatNumber(halfAmount, locale)}`,
        splitAmountLabel: `SGST ₹${formatNumber(halfAmount, locale)} + CGST ₹${formatNumber(halfAmount, locale)}`
    };
};

export const getGstDisplayDetails = ({ taxAmount = 0, taxRatePercent = 0, taxLabel = '', locale = 'en-IN' } = {}) => {
    const rate = getGstRateSplit(taxRatePercent, locale);
    const amount = getGstAmountSplit(taxAmount, locale);
    const safeLabel = String(taxLabel || '').trim();
    const title = safeLabel
        ? `GST (${safeLabel}${rate.totalRate > 0 ? ` ${rate.totalRateLabel}` : ''})`
        : `GST${rate.totalRate > 0 ? ` (${rate.totalRateLabel})` : ''}`;

    return {
        ...rate,
        ...amount,
        title
    };
};

