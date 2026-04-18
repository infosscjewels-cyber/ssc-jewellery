const toFiniteNumber = (value, fallback = 0) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
};

const roundToTwo = (value) => Math.round(toFiniteNumber(value, 0) * 100) / 100;

const formatNumber = (value, locale = 'en-IN') => roundToTwo(value).toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
});

const formatMoney = (value, locale = 'en-IN') => `INR ${formatNumber(value, locale)}`;

const parseObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};

const normalizeStateKey = (value = '') => {
    const raw = String(value || '').trim().toUpperCase();
    if (!raw) return '';
    const compact = raw.replace(/[^A-Z0-9]/g, '');
    const aliases = {
        AN: 'ANDAMANANDNICOBARISLANDS',
        ANDAMANANDNICOBARISLANDS: 'ANDAMANANDNICOBARISLANDS',
        AP: 'ANDHRAPRADESH',
        ANDHRAPRADESH: 'ANDHRAPRADESH',
        AR: 'ARUNACHALPRADESH',
        ARUNACHALPRADESH: 'ARUNACHALPRADESH',
        AS: 'ASSAM',
        ASSAM: 'ASSAM',
        BR: 'BIHAR',
        BIHAR: 'BIHAR',
        CH: 'CHANDIGARH',
        CHANDIGARH: 'CHANDIGARH',
        CG: 'CHHATTISGARH',
        CT: 'CHHATTISGARH',
        CHHATTISGARH: 'CHHATTISGARH',
        DNDD: 'DADRAANDNAGARHAVELIANDDAMANANDDIU',
        DNHDD: 'DADRAANDNAGARHAVELIANDDAMANANDDIU',
        DADRAANDNAGARHAVELIANDDAMANANDDIU: 'DADRAANDNAGARHAVELIANDDAMANANDDIU',
        DL: 'DELHI',
        DELHI: 'DELHI',
        GA: 'GOA',
        GOA: 'GOA',
        GJ: 'GUJARAT',
        GUJARAT: 'GUJARAT',
        HR: 'HARYANA',
        HARYANA: 'HARYANA',
        HP: 'HIMACHALPRADESH',
        HIMACHALPRADESH: 'HIMACHALPRADESH',
        JK: 'JAMMUANDKASHMIR',
        JAMMUANDKASHMIR: 'JAMMUANDKASHMIR',
        JH: 'JHARKHAND',
        JHARKHAND: 'JHARKHAND',
        KA: 'KARNATAKA',
        KARNATAKA: 'KARNATAKA',
        KL: 'KERALA',
        KERALA: 'KERALA',
        LA: 'LADAKH',
        LADAKH: 'LADAKH',
        LD: 'LAKSHADWEEP',
        LAKSHADWEEP: 'LAKSHADWEEP',
        MP: 'MADHYAPRADESH',
        MADHYAPRADESH: 'MADHYAPRADESH',
        MH: 'MAHARASHTRA',
        MAHARASHTRA: 'MAHARASHTRA',
        MN: 'MANIPUR',
        MANIPUR: 'MANIPUR',
        ML: 'MEGHALAYA',
        MEGHALAYA: 'MEGHALAYA',
        MZ: 'MIZORAM',
        MIZORAM: 'MIZORAM',
        NL: 'NAGALAND',
        NAGALAND: 'NAGALAND',
        OD: 'ODISHA',
        OR: 'ODISHA',
        ODISHA: 'ODISHA',
        PB: 'PUNJAB',
        PUNJAB: 'PUNJAB',
        PY: 'PUDUCHERRY',
        PONDICHERRY: 'PUDUCHERRY',
        PUDUCHERRY: 'PUDUCHERRY',
        RJ: 'RAJASTHAN',
        RAJASTHAN: 'RAJASTHAN',
        SK: 'SIKKIM',
        SIKKIM: 'SIKKIM',
        TN: 'TAMILNADU',
        TAMILNADU: 'TAMILNADU',
        TS: 'TELANGANA',
        TELANGANA: 'TELANGANA',
        TR: 'TRIPURA',
        TRIPURA: 'TRIPURA',
        UK: 'UTTARAKHAND',
        UP: 'UTTARPRADESH',
        UT: 'UTTARAKHAND',
        UTTARAKHAND: 'UTTARAKHAND',
        UTTARPRADESH: 'UTTARPRADESH',
        WB: 'WESTBENGAL',
        WESTBENGAL: 'WESTBENGAL'
    };
    return aliases[compact] || compact;
};

const getGstRateSplit = (ratePercent = 0, locale = 'en-IN') => {
    const totalRate = Math.max(0, toFiniteNumber(ratePercent, 0));
    const halfRate = roundToTwo(totalRate / 2);
    return {
        totalRate,
        sgstRate: halfRate,
        cgstRate: halfRate,
        igstRate: totalRate,
        totalRateLabel: `${formatNumber(totalRate, locale)}%`,
        sgstRateLabel: `${formatNumber(halfRate, locale)}%`,
        cgstRateLabel: `${formatNumber(halfRate, locale)}%`,
        igstRateLabel: `${formatNumber(totalRate, locale)}%`,
        splitRateLabel: `SGST ${formatNumber(halfRate, locale)}% + CGST ${formatNumber(halfRate, locale)}%`
    };
};

const getGstAmountSplit = (taxAmount = 0, locale = 'en-IN') => {
    const totalAmount = Math.max(0, toFiniteNumber(taxAmount, 0));
    const totalPaise = Math.max(0, Math.round(totalAmount * 100));
    const sgstPaise = Math.floor(totalPaise / 2);
    const cgstPaise = totalPaise - sgstPaise;
    const sgstAmount = roundToTwo(sgstPaise / 100);
    const cgstAmount = roundToTwo(cgstPaise / 100);
    return {
        totalAmount,
        sgstAmount,
        cgstAmount,
        igstAmount: totalAmount,
        totalAmountLabel: formatMoney(totalAmount, locale),
        sgstAmountLabel: formatMoney(sgstAmount, locale),
        cgstAmountLabel: formatMoney(cgstAmount, locale),
        igstAmountLabel: formatMoney(totalAmount, locale),
        splitAmountLabel: `SGST ${formatMoney(sgstAmount, locale)} + CGST ${formatMoney(cgstAmount, locale)}`
    };
};

const resolveGstJurisdiction = ({ shippingState = '', companyState = '' } = {}) => {
    const shippingStateKey = normalizeStateKey(shippingState);
    const companyStateKey = normalizeStateKey(companyState);
    if (!shippingStateKey || !companyStateKey) {
        return {
            kind: 'unknown',
            shippingStateKey,
            companyStateKey,
            taxTypeLabel: 'GST'
        };
    }
    if (shippingStateKey === companyStateKey) {
        return {
            kind: 'intra_state',
            shippingStateKey,
            companyStateKey,
            taxTypeLabel: 'CGST + SGST'
        };
    }
    return {
        kind: 'inter_state',
        shippingStateKey,
        companyStateKey,
        taxTypeLabel: 'IGST'
    };
};

const getOrderGstContext = (order = {}) => {
    const shipping = parseObject(order.shipping_address || order.shippingAddress) || {};
    const company = parseObject(order.company_snapshot || order.companySnapshot) || {};
    return {
        shippingState: String(shipping.state || '').trim(),
        companyState: String(company.state || '').trim()
    };
};

const getGstDisplayDetails = ({
    taxAmount = 0,
    taxRatePercent = 0,
    taxLabel = '',
    locale = 'en-IN',
    shippingState = '',
    companyState = '',
    jurisdiction = null
} = {}) => {
    const resolvedJurisdiction = jurisdiction?.kind
        ? jurisdiction
        : resolveGstJurisdiction({ shippingState, companyState });
    const genericRate = getGstRateSplit(taxRatePercent, locale);
    const genericAmount = getGstAmountSplit(taxAmount, locale);
    const safeLabel = String(taxLabel || '').trim();
    const title = safeLabel
        ? `GST (${safeLabel}${genericRate.totalRate > 0 ? ` ${genericRate.totalRateLabel}` : ''})`
        : `GST${genericRate.totalRate > 0 ? ` (${genericRate.totalRateLabel})` : ''}`;

    const componentRateLabel = resolvedJurisdiction.kind === 'inter_state'
        ? `IGST ${genericRate.totalRateLabel}`
        : resolvedJurisdiction.kind === 'intra_state'
            ? genericRate.splitRateLabel
            : `GST ${genericRate.totalRateLabel}`;
    const componentAmountLabel = resolvedJurisdiction.kind === 'inter_state'
        ? `IGST ${genericAmount.igstAmountLabel}`
        : resolvedJurisdiction.kind === 'intra_state'
            ? genericAmount.splitAmountLabel
            : `GST ${genericAmount.totalAmountLabel}`;

    return {
        ...genericRate,
        ...genericAmount,
        jurisdiction: resolvedJurisdiction.kind,
        taxTypeLabel: resolvedJurisdiction.taxTypeLabel,
        componentRateLabel,
        componentAmountLabel,
        splitRateLabel: componentRateLabel,
        splitAmountLabel: componentAmountLabel,
        title
    };
};

module.exports = {
    getGstRateSplit,
    getGstAmountSplit,
    resolveGstJurisdiction,
    getOrderGstContext,
    getGstDisplayDetails
};
