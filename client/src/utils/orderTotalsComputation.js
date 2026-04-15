const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};

const roundCurrency = (value) => Math.round(toNumber(value, 0) * 100) / 100;
const deriveDisplayedGstAmount = (taxAmount = 0) => {
    const safeTax = Math.max(0, toNumber(taxAmount, 0));
    const paise = Math.round(safeTax * 100);
    const evenPaise = paise % 2 === 0 ? paise : paise + 1;
    return roundCurrency(evenPaise / 100);
};

const normalizeTaxRegime = (value) => String(value || '').trim().toLowerCase() === 'inclusive'
    ? 'inclusive'
    : 'exclusive';

const parseObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
        return null;
    }
};

const resolveBaseFromGross = (gross = 0, ratePercent = 0) => {
    const safeGross = Math.max(0, toNumber(gross, 0));
    const safeRate = Math.max(0, toNumber(ratePercent, 0));
    if (safeGross <= 0 || safeRate <= 0) return roundCurrency(safeGross);
    return roundCurrency(safeGross * (100 / (100 + safeRate)));
};

const parseDisplayPricing = (source = {}) => {
    if (source?.display_pricing && typeof source.display_pricing === 'object') return source.display_pricing;
    if (source?.displayPricing && typeof source.displayPricing === 'object') return source.displayPricing;
    return null;
};

const computeInvoiceStyleItemRows = (row = {}, taxRegime = 'exclusive') => {
    const items = Array.isArray(row?.items) ? row.items : [];
    const normalizedItems = items.map((item) => {
        const snapshot = parseObject(item?.item_snapshot || item?.itemSnapshot || item?.snapshot) || {};
        const qty = Math.max(0, toNumber(item?.quantity ?? snapshot?.quantity, 0));
        if (qty <= 0) return null;

        const paidUnitGross = toNumber(
            item?.price
            ?? item?.unit_price_gross
            ?? item?.unitPriceGross
            ?? snapshot?.unitPriceGross
            ?? snapshot?.unitPrice,
            0
        );
        const originalUnitGross = toNumber(
            item?.original_price
            ?? item?.originalPrice
            ?? snapshot?.originalPrice,
            paidUnitGross
        ) || paidUnitGross;
        const finalLineTotalGross = toNumber(
            item?.line_total
            ?? item?.lineTotal
            ?? item?.lineTotalGross
            ?? snapshot?.lineTotalGross
            ?? snapshot?.lineTotal,
            paidUnitGross * qty
        );
        const taxRatePercent = toNumber(
            item?.tax_rate_percent
            ?? item?.taxRatePercent
            ?? snapshot?.taxRatePercent
            ?? parseObject(item?.tax_snapshot_json || item?.taxSnapshot || item?.tax_snapshot || snapshot?.taxSnapshot)?.ratePercent,
            0
        );
        const paidUnitBase = taxRegime === 'inclusive'
            ? toNumber(
                item?.unit_price_base
                ?? item?.unitPriceBase
                ?? snapshot?.unitPriceBase,
                resolveBaseFromGross(paidUnitGross, taxRatePercent)
            )
            : paidUnitGross;
        const originalUnitBase = taxRegime === 'inclusive'
            ? toNumber(
                item?.originalPriceBase
                ?? snapshot?.originalPriceBase,
                resolveBaseFromGross(originalUnitGross, taxRatePercent)
            )
            : originalUnitGross;
        const paidLineBase = taxRegime === 'inclusive'
            ? toNumber(
                item?.line_total_base
                ?? item?.lineTotalBase
                ?? snapshot?.lineTotalBase,
                resolveBaseFromGross(finalLineTotalGross, taxRatePercent)
            )
            : finalLineTotalGross;
        const productDiscount = roundCurrency(Math.max(0, (originalUnitBase - paidUnitBase) * qty));
        const amountBeforeDiscount = roundCurrency(Math.max(0, paidLineBase + productDiscount));

        return {
            item,
            snapshot,
            qty,
            taxRatePercent,
            rawTaxAmount: toNumber(
                item?.tax_amount
                ?? item?.taxAmount
                ?? snapshot?.taxAmount,
                0
            ),
            lineGross: finalLineTotalGross,
            discountedLineGross: taxRegime === 'inclusive'
                ? toNumber(
                    item?.discounted_line_total_gross
                    ?? item?.discountedLineTotalGross
                    ?? snapshot?.discountedLineTotalGross
                    ?? snapshot?.discountedLineTotal,
                    finalLineTotalGross
                )
                : Math.max(0, finalLineTotalGross),
            discountedLineBase: taxRegime === 'inclusive'
                ? toNumber(
                    item?.discounted_line_total_base
                    ?? item?.discountedLineTotalBase
                    ?? snapshot?.discountedLineTotalBase
                    ?? snapshot?.taxBase,
                    Math.max(0, finalLineTotalGross - toNumber(item?.tax_amount ?? item?.taxAmount ?? snapshot?.taxAmount, 0))
                )
                : Math.max(0, finalLineTotalGross),
            amountBeforeDiscount,
            productDiscount
        };
    }).filter(Boolean);

    const subtotalGross = Math.max(0, normalizedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.lineGross, 0)), 0));
    const denominator = subtotalGross > 0
        ? subtotalGross
        : Math.max(1, normalizedItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.lineGross, 0)), 0));
    const couponDiscount = Math.max(0, toNumber(row?.coupon_discount_value, toNumber(row?.couponDiscountTotal, 0)));
    const memberDiscount = Math.max(0, toNumber(row?.loyalty_discount_total, toNumber(row?.loyaltyDiscountTotal, 0)));

    let couponAllocated = 0;
    let memberAllocated = 0;

    return normalizedItems.map((item, index) => {
        const ratio = denominator > 0 ? (item.lineGross / denominator) : 0;
        const isLast = index === normalizedItems.length - 1;
        const couponShare = isLast
            ? Math.max(0, roundCurrency(couponDiscount - couponAllocated))
            : roundCurrency(couponDiscount * ratio);
        couponAllocated = roundCurrency(couponAllocated + couponShare);
        const memberShare = isLast
            ? Math.max(0, roundCurrency(memberDiscount - memberAllocated))
            : roundCurrency(memberDiscount * ratio);
        memberAllocated = roundCurrency(memberAllocated + memberShare);
        const totalDiscount = roundCurrency(item.productDiscount + couponShare + memberShare);
        const fixedDisplayedLineTotal = roundCurrency(
            taxRegime === 'inclusive'
                ? Math.max(0, toNumber(item.discountedLineGross, item.lineGross - couponShare - memberShare))
                : Math.max(0, toNumber(item.discountedLineBase, item.lineGross - couponShare - memberShare) + item.rawTaxAmount)
        );
        const displayedTaxAmount = deriveDisplayedGstAmount(item.rawTaxAmount);
        const displayedAmount = roundCurrency(Math.max(0, fixedDisplayedLineTotal - displayedTaxAmount + totalDiscount));
        const displayRate = roundCurrency(displayedAmount / Math.max(1, item.qty));

        return {
            amountBeforeDiscount: item.amountBeforeDiscount,
            productDiscount: item.productDiscount,
            rawTaxAmount: item.rawTaxAmount,
            couponDiscount: couponShare,
            memberDiscount: memberShare,
            totalDiscount,
            displayRate,
            displayAmount: displayedAmount,
            displayTaxAmount: displayedTaxAmount,
            displayLineTotal: fixedDisplayedLineTotal
        };
    });
};

const buildInvoiceStyleShippingRow = (row = {}, itemRows = [], taxRegime = 'exclusive', displayPricing = null) => {
    const shippingFeeGross = Math.max(0, toNumber(row?.shipping_fee, toNumber(row?.shippingFee, 0)));
    const shippingFeeBase = Math.max(0, toNumber(displayPricing?.displayShippingBase, shippingFeeGross));
    const shippingBenefitShare = Math.max(0, toNumber(
        row?.loyalty_shipping_discount_total,
        toNumber(row?.loyaltyShippingDiscountTotal, 0)
    ));
    const totalTax = Math.max(0, toNumber(row?.tax_total, toNumber(row?.taxTotal, 0)));
    const itemTaxTotal = roundCurrency(itemRows.reduce((sum, item) => sum + Math.max(0, toNumber(item.displayTaxAmount, 0)), 0));
    const shippingTaxAmount = Math.max(0, roundCurrency(totalTax - itemTaxTotal));
    if (shippingFeeGross <= 0 && shippingBenefitShare <= 0 && shippingTaxAmount <= 0) return null;

    const grossAfterDiscounts = Math.max(0, shippingFeeGross - shippingBenefitShare);
    const taxableValue = taxRegime === 'inclusive'
        ? Math.max(0, roundCurrency(grossAfterDiscounts - shippingTaxAmount))
        : grossAfterDiscounts;
    const fixedDisplayedLineTotal = roundCurrency(
        taxRegime === 'inclusive'
            ? grossAfterDiscounts
            : taxableValue + shippingTaxAmount
    );
    const displayedTaxAmount = deriveDisplayedGstAmount(shippingTaxAmount);
    const displayedAmount = roundCurrency(Math.max(0, fixedDisplayedLineTotal - displayedTaxAmount + shippingBenefitShare));

    return {
        isShippingRow: true,
        qty: 1,
        displayRate: displayedAmount,
        displayAmount: displayedAmount,
        displayProductDiscount: 0,
        displayCouponDiscount: 0,
        displayMemberDiscount: 0,
        displayShippingBenefitShare: shippingBenefitShare,
        taxAmount: displayedTaxAmount
    };
};

const getInvoiceLineDiscounts = (item = {}) => {
    const product = Math.max(0, toNumber(item.displayProductDiscount ?? item.productDiscount, 0));
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

const computeInvoiceAlignedSummary = (source = null) => {
    const row = source && typeof source === 'object' ? source : {};
    const displayPricing = parseDisplayPricing(row);
    const taxRegime = normalizeTaxRegime(
        row.tax_price_mode
        || row.taxPriceMode
        || displayPricing?.taxPriceMode
        || row?.company_snapshot?.taxPriceMode
    );
    const itemRows = computeInvoiceStyleItemRows(row, taxRegime);
    const shippingRow = buildInvoiceStyleShippingRow(row, itemRows, taxRegime, displayPricing);
    const tableItems = shippingRow ? [...itemRows, shippingRow] : itemRows;
    const nonShippingItems = tableItems.filter((item) => !item?.isShippingRow);
    const effectiveShippingRow = tableItems.find((item) => item?.isShippingRow) || null;

    const discounts = {
        product: 0,
        coupon: 0,
        member: 0,
        memberShippingBenefit: 0
    };

    tableItems.forEach((item) => {
        const lineDiscounts = getInvoiceLineDiscounts(item);
        discounts.product = roundCurrency(discounts.product + lineDiscounts.product);
        discounts.coupon = roundCurrency(discounts.coupon + lineDiscounts.coupon);
        discounts.member = roundCurrency(discounts.member + lineDiscounts.member);
        discounts.memberShippingBenefit = roundCurrency(discounts.memberShippingBenefit + lineDiscounts.memberShippingBenefit);
    });

    const subtotal = roundCurrency(nonShippingItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.displayAmount, 0)), 0));
    const shipping = roundCurrency(Math.max(0, toNumber(effectiveShippingRow?.displayAmount, 0)));
    const priceBeforeDiscounts = roundCurrency(tableItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.displayAmount, 0)), 0));
    const totalSavings = roundCurrency(
        discounts.product + discounts.coupon + discounts.member + discounts.memberShippingBenefit
    );
    const priceAfterDiscounts = roundCurrency(Math.max(0, priceBeforeDiscounts - totalSavings));
    const gstTotal = roundCurrency(tableItems.reduce((sum, item) => (
        sum + Math.max(0, toNumber(item.displayTaxAmount ?? item.taxAmount, 0))
    ), 0));
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
        priceBeforeDiscounts,
        discounts: {
            ...discounts,
            totalSavings
        },
        priceAfterDiscounts,
        gstTotal,
        roundOffAmount,
        grandTotal
    };
};

const computeInvoiceStyleTotals = (row = {}, taxRegime = 'exclusive', displayPricing = null) => {
    const normalizedItems = computeInvoiceStyleItemRows(row, taxRegime);

    const subtotal = roundCurrency(normalizedItems.reduce((sum, item) => sum + item.amountBeforeDiscount, 0));
    const shipping = roundCurrency(Math.max(0, toNumber(
        displayPricing?.displayShippingBase,
        toNumber(row.shipping_fee, toNumber(row.shippingFee, 0))
    )));
    const productDiscount = roundCurrency(normalizedItems.reduce((sum, item) => sum + item.productDiscount, 0));
    const itemsDisplayedGstTotal = roundCurrency(normalizedItems.reduce((sum, item) => sum + toNumber(item.displayTaxAmount, 0), 0));
    const rawItemsTaxTotal = roundCurrency(normalizedItems.reduce((sum, item) => sum + toNumber(item.rawTaxAmount, 0), 0));
    const rawOrderTaxTotal = roundCurrency(Math.max(0, toNumber(row.tax_total, toNumber(row.taxTotal, 0))));
    const shippingDisplayedGst = deriveDisplayedGstAmount(Math.max(0, rawOrderTaxTotal - rawItemsTaxTotal));
    const gstTotal = roundCurrency(itemsDisplayedGstTotal + shippingDisplayedGst);

    return {
        subtotal,
        shipping,
        productDiscount,
        gstTotal
    };
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

    const invoiceStyleTotals = computeInvoiceStyleTotals(row, taxRegime, displayPricing);
    const subtotal = roundCurrency(Math.max(0, toNumber(
        invoiceStyleTotals?.subtotal,
        displayPricing?.displaySubtotalBase ?? toNumber(row.subtotal, toNumber(row.subtotalBase, 0))
    )));
    const shipping = roundCurrency(Math.max(0, toNumber(
        invoiceStyleTotals?.shipping,
        displayPricing?.displayShippingBase ?? toNumber(row.shipping_fee, toNumber(row.shippingFee, 0))
    )));
    const priceBeforeDiscounts = roundCurrency(Math.max(0, subtotal + shipping));

    const productDiscount = roundCurrency(Math.max(0, toNumber(
        invoiceStyleTotals?.productDiscount,
        displayPricing?.displayProductDiscountBase
    )));
    const couponDiscount = roundCurrency(Math.max(0, toNumber(row.coupon_discount_value, toNumber(row.couponDiscountTotal, 0))));
    const memberDiscount = roundCurrency(Math.max(0, toNumber(row.loyalty_discount_total, toNumber(row.loyaltyDiscountTotal, 0))));
    const memberShippingBenefit = roundCurrency(Math.max(0, toNumber(
        row.loyalty_shipping_discount_total,
        toNumber(row.loyaltyShippingDiscountTotal, 0)
    )));
    const computedSavings = roundCurrency(productDiscount + couponDiscount + memberDiscount + memberShippingBenefit);
    const storedSavings = roundCurrency(Math.max(0, toNumber(row.discount_total, toNumber(row.discountTotal, 0))));
    const totalSavings = roundCurrency(Math.max(computedSavings, storedSavings));
    const hasAnyDiscount = totalSavings > 0 || productDiscount > 0 || couponDiscount > 0 || memberDiscount > 0 || memberShippingBenefit > 0;

    const priceAfterDiscounts = roundCurrency(Math.max(0, priceBeforeDiscounts - totalSavings));
    const gstTotal = roundCurrency(Math.max(0, toNumber(
        invoiceStyleTotals?.gstTotal,
        toNumber(row.tax_total, toNumber(row.taxTotal, 0))
    )));
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
            product: productDiscount,
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
    computeInvoiceAlignedSummary,
    computeInvoiceStyleItemRows,
    computeOrderTotalsDisplay
};
