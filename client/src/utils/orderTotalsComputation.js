const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const roundCurrency = (value) => Math.round(toNumber(value, 0) * 100) / 100;

const normalizeTaxRegime = (value) => String(value || '').trim().toLowerCase() === 'inclusive'
    ? 'inclusive'
    : 'exclusive';

const parseDisplayPricing = (source = {}) => {
    if (source?.display_pricing && typeof source.display_pricing === 'object') return source.display_pricing;
    if (source?.displayPricing && typeof source.displayPricing === 'object') return source.displayPricing;
    return null;
};

const computeOrderTotalsDisplay = (source = null) => {
    const row = source && typeof source === 'object' ? source : {};
    const displayPricing = parseDisplayPricing(row);
    const taxRegime = normalizeTaxRegime(
        row.tax_price_mode
        || row.taxPriceMode
        || displayPricing?.taxPriceMode
        || row?.company_snapshot?.taxPriceMode
    );

    const subtotal = roundCurrency(Math.max(0, toNumber(
        displayPricing?.displaySubtotalBase,
        toNumber(row.subtotal, toNumber(row.subtotalBase, 0))
    )));
    const shipping = roundCurrency(Math.max(0, toNumber(
        displayPricing?.displayShippingBase,
        toNumber(row.shipping_fee, toNumber(row.shippingFee, 0))
    )));
    const priceBeforeDiscounts = roundCurrency(Math.max(0, toNumber(
        displayPricing?.displayBaseBeforeDiscounts,
        subtotal + shipping
    )));

    const couponDiscount = roundCurrency(Math.max(0, toNumber(row.coupon_discount_value, toNumber(row.couponDiscountTotal, 0))));
    const memberDiscount = roundCurrency(Math.max(0, toNumber(row.loyalty_discount_total, toNumber(row.loyaltyDiscountTotal, 0))));
    const memberShippingBenefit = roundCurrency(Math.max(0, toNumber(
        row.loyalty_shipping_discount_total,
        toNumber(row.loyaltyShippingDiscountTotal, 0)
    )));
    const computedSavings = roundCurrency(couponDiscount + memberDiscount + memberShippingBenefit);
    const totalSavings = roundCurrency(Math.max(0, toNumber(row.discount_total, toNumber(row.discountTotal, computedSavings))));
    const hasAnyDiscount = totalSavings > 0 || couponDiscount > 0 || memberDiscount > 0 || memberShippingBenefit > 0;

    const priceAfterDiscounts = roundCurrency(Math.max(0, toNumber(
        displayPricing?.displayValueAfterDiscountsBase,
        priceBeforeDiscounts - totalSavings
    )));
    const gstTotal = roundCurrency(Math.max(0, toNumber(row.tax_total, toNumber(row.taxTotal, 0))));
    const roundOffAmount = roundCurrency(toNumber(row.round_off_amount, toNumber(row.roundOffAmount, 0)));

    const fallbackGrandTotal = roundCurrency(Math.max(
        0,
        taxRegime === 'inclusive'
            ? priceAfterDiscounts + roundOffAmount
            : priceAfterDiscounts + gstTotal + roundOffAmount
    ));
    const grandTotal = roundCurrency(Math.max(0, toNumber(row.total, fallbackGrandTotal)));

    return {
        taxRegime,
        subtotal,
        shipping,
        hasAnyDiscount,
        priceBeforeDiscounts,
        discounts: {
            coupon: couponDiscount,
            member: memberDiscount,
            memberShippingBenefit,
            totalSavings
        },
        priceAfterDiscounts,
        gstTotal,
        roundOffAmount,
        grandTotal,
        couponCode: String(row.coupon_code || row.couponCode || '').trim()
    };
};

export {
    computeOrderTotalsDisplay
};
