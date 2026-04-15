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
    const totalPaise = Math.round(totalAmount * 100);
    const evenPaise = totalPaise % 2 === 0 ? totalPaise : totalPaise + 1;
    const halfPaise = Math.max(0, evenPaise / 2);
    const sgstAmount = roundToTwo(halfPaise / 100);
    const cgstAmount = roundToTwo(halfPaise / 100);
    return {
        totalAmount,
        sgstAmount,
        cgstAmount,
        totalAmountLabel: `₹${formatNumber(totalAmount, locale)}`,
        sgstAmountLabel: `₹${formatNumber(sgstAmount, locale)}`,
        cgstAmountLabel: `₹${formatNumber(cgstAmount, locale)}`,
        splitAmountLabel: `SGST ₹${formatNumber(sgstAmount, locale)} + CGST ₹${formatNumber(cgstAmount, locale)}`
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
