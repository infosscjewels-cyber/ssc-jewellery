const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const roundCurrency = (value) => Math.round(toNumber(value, 0) * 100) / 100;

const getLineDiscounts = (item = {}) => {
    const product = Math.max(0, toNumber(item.displayProductDiscount ?? item.discount, 0));
    const coupon = Math.max(0, toNumber(item.displayCouponDiscount ?? item.couponDiscount, 0));
    const member = Math.max(0, toNumber(item.displayMemberDiscount ?? item.memberDiscount, 0));
    const memberShippingBenefit = Math.max(0, toNumber(item.displayShippingBenefitShare ?? item.shippingBenefitShare, 0));
    const total = roundCurrency(product + coupon + member + memberShippingBenefit);
    return {
        product,
        coupon,
        member,
        memberShippingBenefit,
        total
    };
};

const computeInvoiceComputation = ({
    order = {},
    tableItems = [],
    taxRegime = 'exclusive'
} = {}) => {
    const safeItems = Array.isArray(tableItems) ? tableItems : [];
    const nonShippingItems = safeItems.filter((item) => !item?.isShippingRow);
    const shippingItem = safeItems.find((item) => item?.isShippingRow) || null;

    const discountBuckets = {
        product: 0,
        coupon: 0,
        member: 0,
        memberShippingBenefit: 0
    };

    const lineSnapshot = safeItems.map((item) => {
        const amount = roundCurrency(Math.max(0, toNumber(item.displayAmount, 0)));
        const gst = roundCurrency(Math.max(0, toNumber(item.taxAmount, 0)));
        const discounts = getLineDiscounts(item);
        discountBuckets.product = roundCurrency(discountBuckets.product + discounts.product);
        discountBuckets.coupon = roundCurrency(discountBuckets.coupon + discounts.coupon);
        discountBuckets.member = roundCurrency(discountBuckets.member + discounts.member);
        discountBuckets.memberShippingBenefit = roundCurrency(discountBuckets.memberShippingBenefit + discounts.memberShippingBenefit);
        const lineTotal = roundCurrency(Math.max(0, amount - discounts.total + gst));
        return {
            isShippingRow: Boolean(item?.isShippingRow),
            qty: toNumber(item?.qty, 0),
            rate: roundCurrency(toNumber(item?.displayRate, 0)),
            amount,
            discount: discounts.total,
            gst,
            lineTotal
        };
    });

    const subtotalBaseExShipping = roundCurrency(
        nonShippingItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.displayAmount, 0)), 0)
    );
    const shippingBase = roundCurrency(Math.max(0, toNumber(shippingItem?.displayAmount, 0)));
    const tableAmountTotal = roundCurrency(
        safeItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.displayAmount, 0)), 0)
    );
    const tableDiscountTotal = roundCurrency(
        safeItems.reduce((sum, item) => sum + getLineDiscounts(item).total, 0)
    );
    const tableGstTotal = roundCurrency(
        safeItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.taxAmount, 0)), 0)
    );
    const totalSavings = roundCurrency(
        discountBuckets.product
        + discountBuckets.coupon
        + discountBuckets.member
        + discountBuckets.memberShippingBenefit
    );
    const hasAnyDiscount = totalSavings > 0;

    const priceBeforeDiscounts = tableAmountTotal;
    const priceAfterDiscounts = roundCurrency(Math.max(0, tableAmountTotal - tableDiscountTotal));
    const roundOffAmount = roundCurrency(toNumber(order.round_off_amount, 0));
    const fallbackGrandTotal = roundCurrency(Math.max(
        0,
        String(taxRegime || '').toLowerCase() === 'inclusive'
            ? priceAfterDiscounts + roundOffAmount
            : priceAfterDiscounts + tableGstTotal + roundOffAmount
    ));
    const grandTotal = roundCurrency(toNumber(order.total, fallbackGrandTotal));

    return {
        taxRegime: String(taxRegime || 'exclusive').toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive',
        lines: lineSnapshot,
        subtotalBaseExShipping,
        shippingBase,
        tableAmountTotal,
        tableDiscountTotal,
        tableGstTotal,
        discounts: {
            ...discountBuckets,
            totalSavings
        },
        hasAnyDiscount,
        priceBeforeDiscounts,
        priceAfterDiscounts,
        roundOffAmount,
        grandTotal
    };
};

module.exports = {
    computeInvoiceComputation,
    __test: {
        getLineDiscounts,
        roundCurrency,
        toNumber
    }
};
