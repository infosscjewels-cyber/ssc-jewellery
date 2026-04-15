const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { resolvePublicAssetPath } = require('./publicAssetResolver');
const { computeInvoiceComputation } = require('../domain/computation/orderComputation');

const DEFAULT_SUPPORT_EMAIL = 'support@sscjewellery.com';
const TAMIL_REGEX = /[\u0B80-\u0BFF]/;
const NON_ASCII_REGEX = /[^\x00-\x7F]/;

const toNumber = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
};
const toBoolean = (value, fallback = false) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
        if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    }
    return fallback;
};

const parseObject = (value) => {
    if (!value) return null;
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
};
const normalizeUtf8Text = (value = '') => {
    const safe = String(value || '');
    if (!safe) return '';
    // Repair common mojibake case: UTF-8 bytes interpreted as latin1.
    const repaired = Buffer.from(safe, 'latin1').toString('utf8');
    if (TAMIL_REGEX.test(repaired)) return repaired;
    return safe;
};

const inr = (value) => `INR ${toNumber(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;
const inrRate = (value) => `INR ${toNumber(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 3
})}`;

const roundToTwo = (value) => Math.round(toNumber(value, 0) * 100) / 100;
const roundCurrency = (value) => roundToTwo(value);
const hasExplicitTaxPriceMode = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'inclusive' || normalized === 'exclusive';
};
const formatPercent = (value) => `${roundToTwo(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
})}%`;
const getGstAmountSplit = (totalTaxAmount = 0) => {
    const totalTax = Math.max(0, toNumber(totalTaxAmount, 0));
    const totalPaise = Math.round(totalTax * 100);
    const evenPaise = totalPaise % 2 === 0 ? totalPaise : totalPaise + 1;
    const halfPaise = Math.max(0, evenPaise / 2);
    const sgst = roundToTwo(halfPaise / 100);
    const cgst = roundToTwo(halfPaise / 100);
    return {
        totalTax,
        halfTax: sgst,
        sgst,
        cgst,
        label: `SGST ${inr(sgst)} + CGST ${inr(cgst)}`
    };
};
const deriveDisplayedGstAmount = (taxAmount = 0) => {
    const safeTax = Math.max(0, toNumber(taxAmount, 0));
    const paise = Math.round(safeTax * 100);
    const evenPaise = paise % 2 === 0 ? paise : paise + 1;
    return roundToTwo(evenPaise / 100);
};
const buildDiscountCellParts = (item = {}) => {
    const totalDiscount = Math.max(
        0,
        toNumber(item.displayProductDiscount ?? item.discount, 0)
        + toNumber(item.displayCouponDiscount ?? item.couponDiscount, 0)
        + toNumber(item.displayMemberDiscount ?? item.memberDiscount, 0)
        + toNumber(item.displayShippingBenefitShare ?? item.shippingBenefitShare, 0)
    );
    const breakdown = [];
    if (toNumber(item.displayProductDiscount ?? item.discount, 0) > 0) {
        breakdown.push(`Product: ${inr(item.displayProductDiscount ?? item.discount)}`);
    }
    if (toNumber(item.displayCouponDiscount ?? item.couponDiscount, 0) > 0) {
        breakdown.push(`Coupon: ${inr(item.displayCouponDiscount ?? item.couponDiscount)}`);
    }
    if (toNumber(item.displayMemberDiscount ?? item.memberDiscount, 0) > 0) {
        breakdown.push(`Member: ${inr(item.displayMemberDiscount ?? item.memberDiscount)}`);
    }
    if (toNumber(item.displayShippingBenefitShare ?? item.shippingBenefitShare, 0) > 0) {
        breakdown.push(`Shipping Benefit: ${inr(item.displayShippingBenefitShare ?? item.shippingBenefitShare)}`);
    }
    return {
        total: inr(totalDiscount),
        breakdown
    };
};
const buildGstCellParts = (item = {}) => {
    const split = getGstAmountSplit(item.taxAmount);
    const breakdown = [];
    if (split.totalTax > 0) {
        breakdown.push(split.label);
    }
    return {
        total: inr(split.totalTax),
        breakdown
    };
};

const computeDisplayedInvoiceLineTotal = (item = {}) => {
    const amount = roundCurrency(Math.max(0, toNumber(item.displayAmount, 0)));
    const totalDiscount = Math.max(
        0,
        toNumber(item.displayProductDiscount ?? item.discount, 0)
        + toNumber(item.displayCouponDiscount ?? item.couponDiscount, 0)
        + toNumber(item.displayMemberDiscount ?? item.memberDiscount, 0)
        + toNumber(item.displayShippingBenefitShare ?? item.shippingBenefitShare, 0)
    );
    const gst = roundCurrency(Math.max(0, toNumber(item.taxAmount, 0)));
    return roundCurrency(Math.max(0, amount - totalDiscount + gst));
};

const getBreakdownCellHeight = (doc, width, parts, fonts) => {
    const totalHeight = textHeight(doc, parts.total, width, 9, fonts);
    const breakdownHeight = parts.breakdown.reduce((sum, line) => (
        sum + textHeight(doc, line, width, 7, fonts) + 1
    ), 0);
    return totalHeight + breakdownHeight + 4;
};
const drawBreakdownCell = (doc, x, y, width, parts, align = 'right', { bold = false } = {}, fonts) => {
    const totalFont = bold ? 'Helvetica-Bold' : 'Helvetica';
    doc.font(totalFont).fontSize(9).fillColor('#111827').text(parts.total, x, y, { width, align });
    let cursorY = y + textHeight(doc, parts.total, width, 9, fonts) + 1;
    parts.breakdown.forEach((line) => {
        doc.font('Helvetica').fontSize(7).fillColor('#6B7280').text(line, x, cursorY, { width, align });
        cursorY += textHeight(doc, line, width, 7, fonts) + 1;
    });
};

const formatDate = (value) => {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    });
};

const getTierTheme = (tier) => {
    const t = String(tier || 'regular').toLowerCase();
    if (t === 'platinum') return { label: 'Platinum', color: '#0EA5E9' };
    if (t === 'gold') return { label: 'Gold', color: '#CA8A04' };
    if (t === 'silver') return { label: 'Silver', color: '#6B7280' };
    if (t === 'bronze') return { label: 'Bronze', color: '#B45309' };
    return { label: 'Basic', color: '#4B5563' };
};

const normalizeAddressLines = (address) => {
    const source = parseObject(address) || {};
    const line1 = normalizeUtf8Text(source.line1 || source.addressLine1 || source.address || '');
    const line2 = normalizeUtf8Text(source.line2 || source.addressLine2 || '');
    const cityState = [source.city, source.state].map((part) => normalizeUtf8Text(part)).filter(Boolean).join(', ');
    const zip = normalizeUtf8Text(source.zip || source.pincode || source.postalCode || '');
    const country = normalizeUtf8Text(source.country || 'India');
    return [line1, line2, cityState, zip, country].filter(Boolean);
};

const resolveFirstExistingPath = (candidates = []) => {
    for (const filePath of candidates) {
        if (fs.existsSync(filePath)) return filePath;
    }
    return null;
};

const isPdfKitImageFormatSupported = (filePath = '') => {
    const ext = path.extname(String(filePath || '')).toLowerCase();
    return ['.jpg', '.jpeg', '.png'].includes(ext);
};
const resolveLogoCandidates = (company = {}) => {
    const candidates = [
        resolvePublicAssetPath(company.logoUrl || ''),
        resolvePublicAssetPath(company.faviconUrl || ''),
        resolvePublicAssetPath(company.appleTouchIconUrl || ''),
        resolvePublicAssetPath('/branding/logo.png'),
        resolvePublicAssetPath('/branding/logo.jpg'),
        resolvePublicAssetPath('/branding/logo.jpeg'),
        resolvePublicAssetPath('/logo.png'),
        resolvePublicAssetPath('/logo.jpg'),
        resolvePublicAssetPath('/logo.jpeg'),
        path.join(__dirname, '../../client/public/apple-touch-icon.png'),
        path.join(__dirname, '../../client/public/logo.png'),
        path.join(__dirname, '../../client/public/logo.jpg'),
        path.join(__dirname, '../../client/public/logo.jpeg')
    ].filter(Boolean);
    return [...new Set(candidates)];
};

const resolvePaidStampPath = () => resolveFirstExistingPath([
    path.join(__dirname, '../../client/public/assets/paid-stamp.png'),
    path.join(__dirname, '../../client/public/paid-stamp.png'),
    path.join(__dirname, '../../client/src/assets/paid-stamp.png'),
]);

const resolveCancelledStampPath = () => resolveFirstExistingPath([
    path.join(__dirname, '../../client/public/assets/cancelled-stamp.png'),
    path.join(__dirname, '../../client/public/cancelled-stamp.png'),
    path.join(__dirname, '../../client/src/assets/cancelled-stamp.png'),
]);

const resolveTamilFontPath = () => resolveFirstExistingPath([
    '/usr/share/fonts/truetype/noto/NotoSansTamilUI-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSerifTamil-Regular.ttf'
]);
const resolveUnicodeFontPath = () => resolveFirstExistingPath([
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansUI-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansSymbols-Regular.ttf'
]);

const needsUnicodeFont = (value) => NON_ASCII_REGEX.test(String(value || ''));
const splitTextRunsByScript = (value = '') => {
    const safe = String(value || '');
    if (!safe) return [];
    const runs = [];
    let current = '';
    let currentScript = null;
    for (const ch of safe) {
        const script = TAMIL_REGEX.test(ch) ? 'tamil' : 'base';
        if (current && script !== currentScript) {
            runs.push({ text: current, script: currentScript });
            current = ch;
            currentScript = script;
        } else {
            current += ch;
            currentScript = script;
        }
    }
    if (current) runs.push({ text: current, script: currentScript || 'base' });
    return runs;
};

const textHeight = (doc, text, width, size, fonts) => {
    const safe = String(text || '');
    const font = TAMIL_REGEX.test(safe)
        ? (fonts.tamil || fonts.unicode || fonts.base)
        : (needsUnicodeFont(safe) ? (fonts.unicode || fonts.base) : fonts.base);
    doc.font(font).fontSize(size);
    return doc.heightOfString(String(text || ''), { width, lineGap: 1 });
};

const drawMixedText = (doc, text, x, y, options = {}, fonts = { base: 'Helvetica', tamil: null }) => {
    const size = options.size || 9;
    const color = options.color || '#111827';
    const width = options.width;
    const align = options.align || 'left';
    const safe = normalizeUtf8Text(text || '');
    const hasTamil = TAMIL_REGEX.test(safe);
    const hasAscii = /[A-Za-z0-9]/.test(safe);
    const canRunSplit = align === 'left' && width && hasTamil && hasAscii;
    if (!canRunSplit) {
        const font = hasTamil
            ? (fonts.tamil || fonts.unicode || fonts.base)
            : (needsUnicodeFont(safe) ? (fonts.unicode || fonts.base) : fonts.base);
        doc.font(font).fontSize(size).fillColor(color).text(safe, x, y, {
            width,
            align
        });
        return;
    }

    const runs = splitTextRunsByScript(safe);
    if (!runs.length) return;
    runs.forEach((run, idx) => {
        const font = run.script === 'tamil'
            ? (fonts.tamil || fonts.unicode || fonts.base)
            : fonts.base;
        const textOptions = {
            width,
            align,
            continued: idx < runs.length - 1
        };
        if (idx === 0) {
            doc.font(font).fontSize(size).fillColor(color).text(run.text, x, y, textOptions);
        } else {
            doc.font(font).fontSize(size).fillColor(color).text(run.text, textOptions);
        }
    });
};

const getCompany = (order = {}) => {
    const snapshot = parseObject(order.company_snapshot || order.companySnapshot) || {};
    return {
        displayName: normalizeUtf8Text(snapshot.displayName || snapshot.display_name || 'SSC Jewellery'),
        contactNumber: normalizeUtf8Text(snapshot.contactNumber || snapshot.contact_number || ''),
        supportEmail: normalizeUtf8Text(snapshot.supportEmail || snapshot.support_email || ''),
        address: normalizeUtf8Text(snapshot.address || ''),
        gstNumber: normalizeUtf8Text(snapshot.gstNumber || snapshot.gst_number || ''),
        logoUrl: String(snapshot.logoUrl || snapshot.logo_url || ''),
        faviconUrl: String(snapshot.faviconUrl || snapshot.favicon_url || ''),
        appleTouchIconUrl: String(snapshot.appleTouchIconUrl || snapshot.apple_touch_icon_url || '')
    };
};

const stringifyVariantOptions = (value) => {
    const options = parseObject(value) || value;
    if (!options || typeof options !== 'object') return '';
    if (Array.isArray(options)) {
        return options
            .map((entry) => {
                if (!entry || typeof entry !== 'object') return '';
                const name = entry.name || entry.key || '';
                const val = entry.value || entry.label || '';
                if (!name && !val) return '';
                return name ? `${name}: ${val}` : String(val);
            })
            .filter(Boolean)
            .join(', ');
    }
    return Object.entries(options)
        .map(([key, val]) => `${key}: ${val}`)
        .join(', ');
};
const resolveBaseFromGross = (gross = 0, ratePercent = 0) => {
    const safeGross = Math.max(0, toNumber(gross, 0));
    const safeRate = Math.max(0, toNumber(ratePercent, 0));
    if (safeGross <= 0 || safeRate <= 0) return roundCurrency(safeGross);
    return roundCurrency(safeGross * (100 / (100 + safeRate)));
};
const resolveInvoiceTaxPriceMode = (order = {}) => {
    const displayPricing = parseObject(order.display_pricing || order.displayPricing) || {};
    const directMode = order.tax_price_mode || order.taxPriceMode || displayPricing.taxPriceMode || order.company_snapshot?.taxPriceMode || order.companySnapshot?.taxPriceMode || '';
    if (hasExplicitTaxPriceMode(directMode)) {
        return String(directMode).trim().toLowerCase() === 'inclusive' ? 'inclusive' : 'exclusive';
    }
    const items = Array.isArray(order.items) ? order.items : [];
    for (const item of items) {
        const snapshot = parseObject(item.item_snapshot || item.itemSnapshot || item.snapshot) || {};
        const snapshotMode = String(snapshot.taxPriceMode || item.tax_price_mode || item.taxPriceMode || '').trim().toLowerCase();
        if (snapshotMode === 'inclusive') return 'inclusive';
        const unitPriceBase = toNumber(item.unit_price_base ?? item.unitPriceBase ?? snapshot.unitPriceBase, 0);
        const unitPriceGross = toNumber(item.price ?? item.unit_price_gross ?? item.unitPriceGross ?? snapshot.unitPriceGross ?? snapshot.unitPrice, 0);
        const lineTotalBase = toNumber(item.line_total_base ?? item.lineTotalBase ?? snapshot.lineTotalBase, 0);
        const lineTotalGross = toNumber(item.line_total ?? item.lineTotal ?? item.lineTotalGross ?? snapshot.lineTotalGross ?? snapshot.lineTotal, 0);
        if ((unitPriceBase > 0 && unitPriceGross > 0 && Math.abs(unitPriceBase - unitPriceGross) > 0.009)
            || (lineTotalBase > 0 && lineTotalGross > 0 && Math.abs(lineTotalBase - lineTotalGross) > 0.009)) {
            return 'inclusive';
        }
    }
    return 'exclusive';
};

const getItems = (order = {}) => {
    const raw = Array.isArray(order.items) ? order.items : [];
    const taxPriceMode = resolveInvoiceTaxPriceMode(order);
    const baseItems = raw.map((item) => {
        const snapshot = parseObject(item.item_snapshot || item.itemSnapshot || item.snapshot) || {};
        const qty = Math.max(0, toNumber(item.quantity ?? snapshot.quantity, 0));
        const paidUnitGross = toNumber(item.price ?? snapshot.unitPriceGross ?? snapshot.unitPrice, 0);
        const mrpUnitGross = toNumber(item.original_price ?? snapshot.originalPrice, paidUnitGross) || paidUnitGross;
        const finalLineTotalGross = toNumber(item.line_total ?? snapshot.lineTotalGross ?? snapshot.lineTotal, paidUnitGross * qty);
        const taxRatePercent = toNumber(item.tax_rate_percent ?? snapshot.taxRatePercent, 0);
        const taxAmount = toNumber(item.tax_amount ?? snapshot.taxAmount, 0);
        const variantTitle = item.variant_title || snapshot.variantTitle || '';
        const subCategory = item.sub_category || item.subCategory || snapshot.subCategory || snapshot.sub_category || '';
        const variantOptions = stringifyVariantOptions(snapshot.variantOptions || item.variant_options || item.variantOptions);
        const resolvedTaxRatePercent = taxRatePercent > 0
            ? taxRatePercent
            : toNumber(parseObject(item.tax_snapshot_json || item.taxSnapshot || item.tax_snapshot || snapshot.taxSnapshot)?.ratePercent, 0);
        const unitPriceBase = taxPriceMode === 'inclusive'
            ? toNumber(item.unit_price_base ?? item.unitPriceBase ?? snapshot.unitPriceBase, resolveBaseFromGross(paidUnitGross, resolvedTaxRatePercent))
            : paidUnitGross;
        const mrpUnitBase = taxPriceMode === 'inclusive'
            ? toNumber(snapshot.originalPriceBase, resolveBaseFromGross(mrpUnitGross, resolvedTaxRatePercent))
            : mrpUnitGross;
        const lineTotalBase = taxPriceMode === 'inclusive'
            ? toNumber(item.line_total_base ?? item.lineTotalBase ?? snapshot.lineTotalBase, resolveBaseFromGross(finalLineTotalGross, resolvedTaxRatePercent))
            : finalLineTotalGross;
        const discountedLineGross = taxPriceMode === 'inclusive'
            ? toNumber(item.discounted_line_total_gross ?? item.discountedLineTotalGross ?? snapshot.discountedLineTotalGross ?? snapshot.discountedLineTotal, lineTotalBase + taxAmount)
            : toNumber(item.discounted_line_total_gross ?? item.discountedLineTotalGross ?? snapshot.discountedLineTotalGross ?? snapshot.discountedLineTotal, finalLineTotalGross - 0);
        const discountedLineBase = taxPriceMode === 'inclusive'
            ? toNumber(item.discounted_line_total_base ?? item.discountedLineTotalBase ?? snapshot.discountedLineTotalBase ?? snapshot.taxBase, Math.max(0, discountedLineGross - taxAmount))
            : toNumber(item.discounted_line_total_base ?? item.discountedLineTotalBase ?? snapshot.discountedLineTotalBase ?? snapshot.taxBase, Math.max(0, discountedLineGross));
        const parsedWarrantyMonths = Number(snapshot.polishWarrantyMonths || 0);
        const polishWarrantyMonths = [6, 8, 10, 12].includes(parsedWarrantyMonths) ? parsedWarrantyMonths : 0;

        return {
            name: String(item.title || snapshot.title || 'Item'),
            variantLine: [variantTitle, variantOptions].filter(Boolean).join(' | '),
            subCategoryLine: subCategory ? `Sub Category: ${subCategory}` : '',
            warrantyLine: polishWarrantyMonths > 0 ? `Polish Warranty: ${polishWarrantyMonths} months` : '',
            qty,
            unitPriceMrp: mrpUnitBase,
            unitPricePaid: unitPriceBase,
            discount: Math.max(0, (mrpUnitBase - unitPriceBase) * qty),
            lineTotal: lineTotalBase,
            lineTotalBase,
            lineTotalGross: finalLineTotalGross,
            taxAmount,
            taxRatePercent: resolvedTaxRatePercent,
            discountedLineGross,
            discountedLineBase,
            lineTotalInclTax: taxPriceMode === 'inclusive'
                ? discountedLineGross
                : discountedLineBase + taxAmount
        };
    });

    const subtotal = Math.max(0, baseItems.reduce((sum, item) => sum + toNumber(item.lineTotalGross, 0), 0));
    const couponDiscount = Math.max(0, toNumber(order.coupon_discount_value, 0));
    const loyaltyDiscount = Math.max(0, toNumber(order.loyalty_discount_total, 0));
    const lineDenominator = subtotal > 0
        ? subtotal
        : Math.max(1, baseItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.lineTotalGross, 0)), 0));

    let couponAllocated = 0;
    let memberAllocated = 0;

    return baseItems.map((item, index) => {
        const lineGross = Math.max(0, toNumber(item.lineTotalGross, item.lineTotal));
        const ratio = lineDenominator > 0 ? (lineGross / lineDenominator) : 0;
        const isLast = index === baseItems.length - 1;

        const couponShare = isLast
            ? Math.max(0, couponDiscount - couponAllocated)
            : roundCurrency(couponDiscount * ratio);
        couponAllocated += couponShare;

        const memberShare = isLast
            ? Math.max(0, loyaltyDiscount - memberAllocated)
            : roundCurrency(loyaltyDiscount * ratio);
        memberAllocated += memberShare;
        const discountedGross = taxPriceMode === 'inclusive'
            ? Math.max(0, toNumber(item.discountedLineGross, lineGross - couponShare - memberShare))
            : Math.max(0, lineGross - couponShare - memberShare);
        const taxableValue = taxPriceMode === 'inclusive'
            ? Math.max(0, toNumber(item.discountedLineBase, discountedGross - toNumber(item.taxAmount, 0)))
            : Math.max(0, discountedGross);
        const amountBeforeDiscount = taxPriceMode === 'inclusive'
            ? Math.max(0, toNumber(item.lineTotalBase, lineGross) + toNumber(item.discount, 0))
            : Math.max(0, toNumber(item.lineTotalBase, lineGross));
        const displayProductDiscount = toNumber(item.discount, 0);
        const displayCouponDiscount = couponShare;
        const displayMemberDiscount = memberShare;
        const displayShippingBenefitShare = 0;
        const totalDisplayDiscount = roundCurrency(
            displayProductDiscount
            + displayCouponDiscount
            + displayMemberDiscount
            + displayShippingBenefitShare
        );
        const fixedDisplayedLineTotal = roundCurrency(
            taxPriceMode === 'inclusive'
                ? discountedGross
                : Math.max(0, taxableValue + toNumber(item.taxAmount, 0))
        );
        const displayedTaxAmount = deriveDisplayedGstAmount(item.taxAmount);
        const displayedAmount = roundCurrency(Math.max(0, fixedDisplayedLineTotal - displayedTaxAmount + totalDisplayDiscount));
        const rateBeforeDiscount = Math.max(
            0,
            roundCurrency(displayedAmount / Math.max(1, toNumber(item.qty, 0)))
        );
        return {
            ...item,
            couponDiscount: couponShare,
            memberDiscount: memberShare,
            displayProductDiscount,
            displayCouponDiscount,
            displayMemberDiscount,
            displayShippingBenefitShare,
            shippingShare: 0,
            shippingBenefitShare: 0,
            netShippingShare: 0,
            taxableValue,
            taxAmount: displayedTaxAmount,
            displayRate: rateBeforeDiscount,
            displayAmount: displayedAmount,
            lineTotal: taxableValue,
            lineTotalInclTax: fixedDisplayedLineTotal
        };
    });
};

const buildShippingRow = (order = {}, items = []) => {
    const displayPricing = parseObject(order.display_pricing || order.displayPricing) || {};
    const shippingFeeGross = Math.max(0, toNumber(order.shipping_fee, 0));
    const shippingFeeBase = Math.max(0, toNumber(displayPricing.displayShippingBase, shippingFeeGross));
    const shippingBenefitShare = Math.max(0, toNumber(order.loyalty_shipping_discount_total, 0));
    const taxPriceMode = resolveInvoiceTaxPriceMode(order);
    const totalTax = Math.max(0, toNumber(order.tax_total, 0));
    const itemTaxTotal = items.reduce((sum, item) => sum + Math.max(0, toNumber(item.taxAmount, 0)), 0);
    const shippingTaxAmount = Math.max(0, roundCurrency(totalTax - itemTaxTotal));
    if (shippingFeeGross <= 0 && shippingBenefitShare <= 0 && shippingTaxAmount <= 0) return null;

    const grossAfterDiscounts = Math.max(0, shippingFeeGross - shippingBenefitShare);
    const taxableValue = taxPriceMode === 'inclusive'
        ? Math.max(0, roundCurrency(grossAfterDiscounts - shippingTaxAmount))
        : grossAfterDiscounts;
    const displayShippingBenefitShare = shippingBenefitShare;
    const fixedDisplayedLineTotal = roundCurrency(
        taxPriceMode === 'inclusive'
            ? grossAfterDiscounts
            : taxableValue + shippingTaxAmount
    );
    const displayedTaxAmount = deriveDisplayedGstAmount(shippingTaxAmount);
    const displayedAmount = roundCurrency(Math.max(0, fixedDisplayedLineTotal - displayedTaxAmount + displayShippingBenefitShare));
    return {
        name: 'Shipping',
        variantLine: 'Delivery charge',
        warrantyLine: '',
        qty: 1,
        unitPriceMrp: shippingFeeBase,
        unitPricePaid: taxableValue,
        discount: 0,
        couponDiscount: 0,
        memberDiscount: 0,
        displayProductDiscount: 0,
        displayCouponDiscount: 0,
        displayMemberDiscount: 0,
        shippingShare: shippingFeeGross,
        shippingBenefitShare,
        displayShippingBenefitShare,
        netShippingShare: taxableValue,
        taxableValue,
        displayRate: taxPriceMode === 'inclusive'
            ? displayedAmount
            : displayedAmount,
        displayAmount: displayedAmount,
        taxAmount: displayedTaxAmount,
        taxRatePercent: 0,
        lineTotal: taxableValue,
        lineTotalGross: shippingFeeGross,
        lineTotalInclTax: fixedDisplayedLineTotal,
        isShippingRow: true
    };
};

const getAddressBlockHeight = (doc, fonts, { width, lines = [] }) => {
    const safeLines = lines.slice(0, 10);
    const bodyWidth = width - 20;
    const bodyHeight = safeLines.reduce((sum, line) => (
        sum + textHeight(doc, String(line), bodyWidth, 10, fonts) + 2
    ), 0);
    return Math.max(98, 32 + bodyHeight + 8);
};

const drawAddressBlock = (doc, fonts, { x, y, width, heading, lines = [], forcedHeight = null }) => {
    const safeLines = lines.slice(0, 10);
    const bodyWidth = width - 20;
    const computedHeight = getAddressBlockHeight(doc, fonts, { width, lines: safeLines });
    const boxHeight = Math.max(computedHeight, Number(forcedHeight || 0));

    doc.roundedRect(x, y, width, boxHeight, 6).strokeColor('#E5E7EB').stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#6B7280').text(heading, x + 10, y + 8, { width: width - 20 });
    let cursorY = y + 24;
    safeLines.forEach((text) => {
        const lineText = String(text);
        drawMixedText(doc, lineText, x + 10, cursorY, {
            size: 10,
            color: '#111827',
            width: bodyWidth
        }, fonts);
        cursorY += textHeight(doc, lineText, bodyWidth, 10, fonts) + 2;
    });
    return boxHeight;
};

const drawTableHeader = (doc, y, { showTaxColumns = false, showDiscountColumn = true, taxPriceMode = 'exclusive' } = {}) => {
    const left = 42;
    const tableWidth = 510;
    const headerHeight = showTaxColumns ? 30 : 22;
    const gstLabel = showTaxColumns && String(taxPriceMode || '').toLowerCase() === 'inclusive'
        ? 'Incl. GST'
        : 'GST';
    const cols = showTaxColumns
        ? (showDiscountColumn
            ? {
                idx: { x: 46, width: 14, label: '#', align: 'left' },
                name: { x: 62, width: 126, label: 'Item', align: 'left' },
                rate: { x: 190, width: 54, label: 'Rate', align: 'right' },
                qty: { x: 246, width: 24, label: 'Qty', align: 'right' },
                amount: { x: 272, width: 70, label: 'Amount', align: 'right' },
                discount: { x: 344, width: 92, label: 'Discount', align: 'right' },
                gstAmount: { x: 438, width: 54, label: gstLabel, align: 'right' },
                total: { x: 494, width: 54, label: 'Line Total', align: 'right' }
            }
            : {
                idx: { x: 46, width: 14, label: '#', align: 'left' },
                name: { x: 62, width: 126, label: 'Item', align: 'left' },
                rate: { x: 190, width: 54, label: 'Rate', align: 'right' },
                qty: { x: 246, width: 24, label: 'Qty', align: 'right' },
                amount: { x: 272, width: 86, label: 'Amount', align: 'right' },
                gstAmount: { x: 360, width: 60, label: gstLabel, align: 'right' },
                total: { x: 422, width: 126, label: 'Line Total', align: 'right' }
            })
        : (showDiscountColumn
            ? {
                idx: { x: 46, width: 18, label: '#', align: 'left' },
                name: { x: 66, width: 184, label: 'Item', align: 'left' },
                rate: { x: 252, width: 62, label: 'Rate', align: 'right' },
                qty: { x: 316, width: 30, label: 'Qty', align: 'right' },
                amount: { x: 348, width: 74, label: 'Amount', align: 'right' },
                discount: { x: 424, width: 62, label: 'Discount', align: 'right' },
                total: { x: 488, width: 60, label: 'Line Total', align: 'right' }
            }
            : {
                idx: { x: 46, width: 18, label: '#', align: 'left' },
                name: { x: 66, width: 196, label: 'Item', align: 'left' },
                rate: { x: 264, width: 68, label: 'Rate', align: 'right' },
                qty: { x: 334, width: 34, label: 'Qty', align: 'right' },
                amount: { x: 370, width: 82, label: 'Amount', align: 'right' },
                total: { x: 454, width: 94, label: 'Line Total', align: 'right' }
            });

    doc.rect(left, y, tableWidth, headerHeight).fill('#F9FAFB');
    doc.fillColor('#4B5563').font('Helvetica-Bold').fontSize(showTaxColumns ? 7 : 8);
    Object.values(cols).forEach((col) => {
        doc.text(col.label, col.x, y + 7, { width: col.width, align: col.align || 'left' });
    });
    return { left, tableWidth, cols, nextY: y + headerHeight, showTaxColumns };
};

const drawItemsTable = (doc, fonts, startY, items = [], { showTaxColumns = false, showDiscountColumn = true, taxPriceMode = 'exclusive' } = {}) => {
    const pageBottom = doc.page.height - doc.page.margins.bottom - 24;
    const table = drawTableHeader(doc, startY, { showTaxColumns, showDiscountColumn, taxPriceMode });
    let y = table.nextY;

    if (!items.length) {
        doc.rect(table.left, y, table.tableWidth, 24).strokeColor('#E5E7EB').stroke();
        doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('No items found', table.cols.name.x, y + 7);
        return y + 24;
    }

    const tableTotals = {
        qty: 0,
        amount: 0,
        productDiscount: 0,
        couponDiscount: 0,
        memberDiscount: 0,
        shippingBenefitShare: 0,
        gstAmount: 0,
        lineTotalBase: 0,
        lineTotalInclTax: 0
    };

    items.forEach((item, idx) => {
        const itemText = [item.name, item.variantLine, item.subCategoryLine, item.warrantyLine].filter(Boolean).join('\n');
        const itemTextHeight = textHeight(doc, itemText, table.cols.name.width, 9, fonts);
        const discountParts = showDiscountColumn ? buildDiscountCellParts(item) : null;
        const discountTextHeight = showDiscountColumn
            ? getBreakdownCellHeight(doc, table.cols.discount.width, discountParts, fonts)
            : 0;
        const gstParts = showTaxColumns ? buildGstCellParts(item) : null;
        const gstTextHeight = showTaxColumns
            ? getBreakdownCellHeight(doc, table.cols.gstAmount.width, gstParts, fonts)
            : 0;
        const rowHeight = Math.max(24, itemTextHeight + 8, (showDiscountColumn ? discountTextHeight + 8 : 0), gstTextHeight + 8);

        if (y + rowHeight > pageBottom) {
            doc.addPage();
            const next = drawTableHeader(doc, 52, { showTaxColumns, showDiscountColumn, taxPriceMode });
            y = next.nextY;
        }

        doc.rect(table.left, y, table.tableWidth, rowHeight).strokeColor('#E5E7EB').stroke();
        doc.font('Helvetica').fontSize(9).fillColor('#111827').text(String(idx + 1), table.cols.idx.x, y + 6);

        const lines = String(itemText).split('\n');
        let lineY = y + 5;
        lines.forEach((lineText) => {
            drawMixedText(doc, lineText, table.cols.name.x, lineY, {
                size: 9,
                color: '#111827',
                width: table.cols.name.width
            }, fonts);
            lineY += textHeight(doc, lineText, table.cols.name.width, 9, fonts) + 1;
        });

        const displayedRate = toNumber(item.displayRate, 0);
        const displayedAmount = toNumber(item.displayAmount, 0);
        const displayedLineTotal = computeDisplayedInvoiceLineTotal(item);
        doc.text(inrRate(displayedRate), table.cols.rate.x, y + 6, { width: table.cols.rate.width, align: 'right' });
        doc.font('Helvetica').fontSize(9).fillColor('#111827').text(String(item.qty), table.cols.qty.x, y + 6, { width: table.cols.qty.width, align: 'right' });
        doc.text(inr(displayedAmount), table.cols.amount.x, y + 6, { width: table.cols.amount.width, align: 'right' });
        if (showTaxColumns) {
            if (showDiscountColumn) {
                drawBreakdownCell(doc, table.cols.discount.x, y + 5, table.cols.discount.width, discountParts, 'right', {}, fonts);
            }
            drawBreakdownCell(doc, table.cols.gstAmount.x, y + 5, table.cols.gstAmount.width, gstParts, 'right', {}, fonts);
            doc.font('Helvetica').fontSize(9).fillColor('#111827');
            doc.text(inr(displayedLineTotal), table.cols.total.x, y + 6, { width: table.cols.total.width, align: 'right' });
        } else {
            if (showDiscountColumn) {
                drawBreakdownCell(doc, table.cols.discount.x, y + 5, table.cols.discount.width, discountParts, 'right', {}, fonts);
            }
            doc.text(inr(item.lineTotal), table.cols.total.x, y + 6, { width: table.cols.total.width, align: 'right' });
        }

        tableTotals.qty += toNumber(item.qty, 0);
        tableTotals.amount += toNumber(item.displayAmount, 0);
        tableTotals.productDiscount += toNumber(item.discount, 0);
        tableTotals.couponDiscount += toNumber(item.couponDiscount, 0);
        tableTotals.memberDiscount += toNumber(item.memberDiscount, 0);
        tableTotals.shippingBenefitShare += toNumber(item.shippingBenefitShare, 0);
        tableTotals.gstAmount += toNumber(item.taxAmount, 0);
        tableTotals.lineTotalBase += toNumber(item.lineTotal, 0);
        tableTotals.lineTotalInclTax += displayedLineTotal;
        y += rowHeight;
    });

    const totalsDiscountParts = showDiscountColumn
        ? buildDiscountCellParts({
            discount: tableTotals.productDiscount,
            couponDiscount: tableTotals.couponDiscount,
            memberDiscount: tableTotals.memberDiscount,
            shippingBenefitShare: tableTotals.shippingBenefitShare
        })
        : null;
    const totalsGstParts = showTaxColumns ? buildGstCellParts({ taxAmount: tableTotals.gstAmount }) : null;
    const totalsRowHeight = showTaxColumns
        ? Math.max(
            30,
            (showDiscountColumn ? getBreakdownCellHeight(doc, table.cols.discount.width, totalsDiscountParts, fonts) + 8 : 0),
            getBreakdownCellHeight(doc, table.cols.gstAmount.width, totalsGstParts, fonts) + 8
        )
        : (showDiscountColumn ? Math.max(24, getBreakdownCellHeight(doc, table.cols.discount.width, totalsDiscountParts, fonts) + 8) : 24);
    if (y + totalsRowHeight > pageBottom) {
        doc.addPage();
        const next = drawTableHeader(doc, 52, { showTaxColumns, showDiscountColumn, taxPriceMode });
        y = next.nextY;
    }
    doc.rect(table.left, y, table.tableWidth, totalsRowHeight).fill('#F9FAFB');
    doc.rect(table.left, y, table.tableWidth, totalsRowHeight).strokeColor('#D1D5DB').stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Table Totals', table.cols.name.x, y + 7, { width: table.cols.name.width });
    doc.text('—', table.cols.rate.x, y + 7, { width: table.cols.rate.width, align: 'right' });
    doc.text(`${Math.round(tableTotals.qty)}`, table.cols.qty.x, y + 7, { width: table.cols.qty.width, align: 'right' });
    doc.text(inr(roundCurrency(tableTotals.amount)), table.cols.amount.x, y + 7, { width: table.cols.amount.width, align: 'right' });
    if (showTaxColumns) {
        if (showDiscountColumn) {
            drawBreakdownCell(doc, table.cols.discount.x, y + 5, table.cols.discount.width, totalsDiscountParts, 'right', { bold: true }, fonts);
        }
        drawBreakdownCell(doc, table.cols.gstAmount.x, y + 5, table.cols.gstAmount.width, totalsGstParts, 'right', { bold: true }, fonts);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
        doc.text(inr(tableTotals.lineTotalInclTax), table.cols.total.x, y + 7, { width: table.cols.total.width, align: 'right' });
    } else {
        if (showDiscountColumn) {
            drawBreakdownCell(doc, table.cols.discount.x, y + 5, table.cols.discount.width, totalsDiscountParts, 'right', { bold: true }, fonts);
        }
        doc.text(inr(tableTotals.lineTotalBase), table.cols.total.x, y + 7, { width: table.cols.total.width, align: 'right' });
    }
    y += totalsRowHeight;

    return y;
};

const ensureSpace = (doc, neededHeight, topY = 46) => {
    const available = doc.page.height - doc.page.margins.bottom - doc.y;
    if (available >= neededHeight) return;
    doc.addPage();
    doc.y = topY;
};

const measureTotalsRowHeight = (doc, label = '', value = '', strong = false, options = {}) => {
    const fontName = strong ? 'Helvetica-Bold' : 'Helvetica';
    const fontSize = strong ? 11 : 10;
    const labelWidth = Number(options.labelWidth || 120);
    const valueWidth = Number(options.valueWidth || 95);
    const rowGap = Number(options.rowGap || 8);

    doc.font(fontName).fontSize(fontSize);
    const labelHeight = doc.heightOfString(String(label || ''), { width: labelWidth });
    const valueHeight = doc.heightOfString(String(value || ''), { width: valueWidth, align: 'right' });
    return Math.max(labelHeight, valueHeight) + rowGap;
};

const estimateTotalsBlockHeight = (doc, {
    computation = {},
    couponCode = '',
    tierLabel = 'Basic',
    roundOffAmount = 0,
    total = 0,
    showTaxTotals = false
} = {}) => {
    let height = 0;
    height += measureTotalsRowHeight(doc, 'Subtotal', inr(computation.subtotalBaseExShipping));
    height += measureTotalsRowHeight(doc, 'Shipping', inr(computation.shippingBase));
    if (computation.hasAnyDiscount) {
        height += measureTotalsRowHeight(doc, 'Price Before Discounts', inr(computation.priceBeforeDiscounts));
        if (toNumber(computation?.discounts?.product, 0) > 0) {
            height += measureTotalsRowHeight(doc, 'Product Discount', `- ${inr(computation.discounts.product)}`);
        }
        if (toNumber(computation?.discounts?.coupon, 0) > 0) {
            height += measureTotalsRowHeight(doc, `Coupon Discount${couponCode ? ` (${couponCode})` : ''}`, `- ${inr(computation.discounts.coupon)}`);
        }
        if (toNumber(computation?.discounts?.member, 0) > 0) {
            height += measureTotalsRowHeight(doc, `Member Discount (${tierLabel})`, `- ${inr(computation.discounts.member)}`);
        }
        if (toNumber(computation?.discounts?.memberShippingBenefit, 0) > 0) {
            height += measureTotalsRowHeight(doc, 'Member Shipping Benefit', `- ${inr(computation.discounts.memberShippingBenefit)}`);
        }
        if (toNumber(computation?.discounts?.totalSavings, 0) > 0) {
            height += measureTotalsRowHeight(doc, 'Total Savings', inr(computation.discounts.totalSavings));
        }
        height += measureTotalsRowHeight(doc, 'Price After Discounts', inr(computation.priceAfterDiscounts));
    }
    if (showTaxTotals) {
        const taxSplit = getGstAmountSplit(computation.tableGstTotal);
        height += measureTotalsRowHeight(doc, 'GST Breakdown', inr(computation.tableGstTotal), false, { rowGap: 3 });
        doc.font('Helvetica').fontSize(8);
        height += doc.heightOfString(taxSplit.label, { width: 215, align: 'right' }) + 4;
    }
    if (roundOffAmount !== 0) {
        height += measureTotalsRowHeight(doc, 'Round Off', inr(roundOffAmount));
    }
    height += 1; // divider line
    height += measureTotalsRowHeight(doc, 'Grand Total', inr(total), true, { rowGap: 0 });
    return height + 24;
};

const estimatePolicyBlockHeight = (doc, company = {}) => {
    let height = 0;
    doc.font('Helvetica-Bold').fontSize(9);
    height += doc.heightOfString('Terms & Conditions', { width: 520 });
    doc.font('Helvetica').fontSize(8);
    height += 3;
    height += doc.heightOfString(
        '1. All sales are final after dispatch. 2. Product visuals and colour may slightly vary based on display settings.',
        { width: 520, lineGap: 1 }
    );
    height += 10;
    doc.font('Helvetica-Bold').fontSize(9);
    height += doc.heightOfString('Refund Policy', { width: 520 });
    doc.font('Helvetica').fontSize(8);
    height += 3;
    height += doc.heightOfString(
        'No refunds are allowed under any circumstances. Replacements are allowed only when the customer provides a continuous unedited video from receiving the courier package, opening the box, and clearly showing the defect, if any.',
        { width: 520, lineGap: 1 }
    );
    height += 12;
    return height;
};

const addPageNumbers = (doc) => {
    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i += 1) {
        doc.switchToPage(i);
        doc.font('Helvetica').fontSize(8).fillColor('#9CA3AF').text(
            `Page ${i + 1} of ${range.count}`,
            42,
            doc.page.height - 52,
            { width: 520, align: 'right', lineBreak: false }
        );
    }
};

const toBuffer = (doc) => new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
});

const buildInvoicePdfBuffer = async (order = {}) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });

    const unicodeFontPath = resolveUnicodeFontPath();
    const tamilFontPath = resolveTamilFontPath();
    const unicodeFontName = unicodeFontPath ? 'InvoiceUnicode' : null;
    const tamilFontName = tamilFontPath ? 'InvoiceTamil' : null;
    if (unicodeFontPath) {
        doc.registerFont(unicodeFontName, unicodeFontPath);
    }
    if (tamilFontPath) {
        doc.registerFont(tamilFontName, tamilFontPath);
    }
    const fonts = {
        base: 'Helvetica',
        unicode: unicodeFontName || 'Helvetica',
        tamil: tamilFontName || unicodeFontName || 'Helvetica'
    };

    const company = getCompany(order);
    const companySnapshot = parseObject(order.company_snapshot || order.companySnapshot) || {};
    const billing = parseObject(order.billing_address || order.billingAddress) || {};
    const shipping = parseObject(order.shipping_address || order.shippingAddress) || {};
    const items = getItems(order);
    const shippingRow = buildShippingRow(order, items);
    const tableItems = shippingRow ? [...items, shippingRow] : items;
    const orderRef = order.order_ref || order.orderRef || `ORDER-${order.id || 'N/A'}`;
    const taxPriceMode = resolveInvoiceTaxPriceMode(order);

    const couponCode = String(order.coupon_code || order.couponCode || '').trim();
    const tierTheme = getTierTheme(order.loyalty_tier || order.loyaltyTier || 'regular');
    const computation = computeInvoiceComputation({
        order,
        tableItems,
        taxRegime: taxPriceMode
    });
    const taxTotal = toNumber(order.tax_total, tableItems.reduce((sum, item) => sum + toNumber(item.taxAmount, 0), 0));
    const roundOffAmount = toNumber(computation.roundOffAmount, 0);
    const showTaxTotals = taxTotal > 0;
    const showTaxColumns = toBoolean(companySnapshot.taxEnabled ?? companySnapshot.tax_enabled, false) || showTaxTotals;
    const showDiscountColumn = tableItems.some((item) => {
        const totalDiscount = Math.max(
            0,
            toNumber(item.displayProductDiscount ?? item.discount, 0)
            + toNumber(item.displayCouponDiscount ?? item.couponDiscount, 0)
            + toNumber(item.displayMemberDiscount ?? item.memberDiscount, 0)
            + toNumber(item.displayShippingBenefitShare ?? item.shippingBenefitShare, 0)
        );
        return totalDiscount > 0;
    });
    const total = toNumber(order.total, computation.grandTotal);

    const logoCandidates = resolveLogoCandidates(company);
    for (const logoPath of logoCandidates) {
        if (!isPdfKitImageFormatSupported(logoPath)) continue;
        try {
            doc.image(logoPath, 42, 36, { fit: [96, 52] });
            break;
        } catch {
            // try next candidate
        }
    }

    const isCancelledOrder = String(order?.status || '').toLowerCase() === 'cancelled';
    const stampPath = isCancelledOrder
        ? (resolveCancelledStampPath() || resolvePaidStampPath())
        : resolvePaidStampPath();
    if (stampPath) {
        try {
            doc.save();
            doc.opacity(0.14).image(stampPath, 420, 132, { fit: [130, 130] });
            doc.restore();
        } catch {}
    }

    doc.font('Helvetica-Bold').fontSize(16).fillColor('#111827').text(showTaxTotals ? 'TAX INVOICE' : 'INVOICE', 418, 42, { align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text(`Invoice Date: ${formatDate(order.created_at || order.createdAt)}`, 360, 66, { width: 200, align: 'right' });
    doc.font('Helvetica').fontSize(10).fillColor('#6B7280').text(`Invoice No: INV-${orderRef}`, 340, 84, { width: 220, align: 'right' });

    drawMixedText(doc, company.displayName, 42, 94, {
        size: 11,
        color: '#111827',
        width: 300
    }, fonts);
    if (company.address) {
        drawMixedText(doc, company.address, 42, 111, {
            size: 9,
            color: '#374151',
            width: 300
        }, fonts);
    }
    const contactLine = [company.contactNumber, company.supportEmail || DEFAULT_SUPPORT_EMAIL].filter(Boolean).join(' | ');
    drawMixedText(doc, contactLine, 42, 137, {
        size: 8,
        color: '#6B7280',
        width: 320
    }, fonts);
    if (company.gstNumber) {
        drawMixedText(doc, `GSTIN: ${company.gstNumber}`, 42, 149, {
            size: 8,
            color: '#6B7280',
            width: 320
        }, fonts);
    }

    const billingLines = [
        normalizeUtf8Text(billing.name || billing.fullName || order.customer_name || 'Customer'),
        normalizeUtf8Text(billing.mobile || billing.phone || order.customer_mobile || ''),
        ...normalizeAddressLines(billing)
    ].filter(Boolean);
    const shippingLines = normalizeAddressLines(shipping);

    const billingLinesSafe = billingLines.slice(0, 10);
    const shippingLinesSafe = (shippingLines.length ? shippingLines : ['Address not provided']).slice(0, 10);
    const sharedAddressHeight = Math.max(
        getAddressBlockHeight(doc, fonts, { width: 250, lines: billingLinesSafe }),
        getAddressBlockHeight(doc, fonts, { width: 250, lines: shippingLinesSafe })
    );
    drawAddressBlock(doc, fonts, { x: 42, y: 162, width: 250, heading: 'BILL TO', lines: billingLinesSafe, forcedHeight: sharedAddressHeight });
    drawAddressBlock(doc, fonts, { x: 318, y: 162, width: 250, heading: 'SHIP TO', lines: shippingLinesSafe, forcedHeight: sharedAddressHeight });
    const infoY = 162 + sharedAddressHeight + 10;

    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('Order Ref:', 42, infoY, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#111827').text(` ${orderRef}`);
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('Payment:', 220, infoY, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#111827').text(` ${String(order.payment_gateway || 'razorpay').toUpperCase()}`);
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('Payment Status:', 392, infoY, { continued: true });
    doc.font('Helvetica-Bold').fillColor('#111827').text(` ${String(order.payment_status || '—').toUpperCase()}`, { align: 'right' });
    doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('Membership:', 42, infoY + 16, { continued: true });
    doc.font('Helvetica-Bold').fillColor(tierTheme.color).text(` ${tierTheme.label}`);

    let cursorY = drawItemsTable(doc, fonts, infoY + 34, tableItems, { showTaxColumns, showDiscountColumn, taxPriceMode });

    doc.y = cursorY + 12;
    ensureSpace(doc, estimateTotalsBlockHeight(doc, {
        computation,
        couponCode,
        tierLabel: tierTheme.label,
        roundOffAmount,
        total,
        showTaxTotals
    }), 52);

    const totalsX = 350;
    const totalsY = doc.y;
    const writeTotal = (label, value, y, strong = false, options = {}) => {
        const fontName = strong ? 'Helvetica-Bold' : 'Helvetica';
        const fontSize = strong ? 11 : 10;
        const color = strong ? '#111827' : '#4B5563';
        const labelWidth = Number(options.labelWidth || 120);
        const valueWidth = Number(options.valueWidth || 95);
        const rowGap = Number(options.rowGap || 8);

        doc.font(fontName).fontSize(fontSize);
        const labelHeight = doc.heightOfString(String(label || ''), { width: labelWidth });
        const valueHeight = doc.heightOfString(String(value || ''), { width: valueWidth, align: 'right' });
        const rowHeight = Math.max(labelHeight, valueHeight);

        doc.font(fontName).fontSize(fontSize).fillColor(color).text(label, totalsX, y, { width: labelWidth });
        doc.font(fontName).fontSize(fontSize).fillColor(color).text(value, totalsX + labelWidth, y, { width: valueWidth, align: 'right' });

        return y + rowHeight + rowGap;
    };

    let runningY = totalsY;
    runningY = writeTotal('Subtotal', inr(computation.subtotalBaseExShipping), runningY);
    runningY = writeTotal('Shipping', inr(computation.shippingBase), runningY);
    if (computation.hasAnyDiscount) {
        runningY = writeTotal('Price Before Discounts', inr(computation.priceBeforeDiscounts), runningY);
        if (computation.discounts.product > 0) {
            runningY = writeTotal('Product Discount', `- ${inr(computation.discounts.product)}`, runningY);
        }
        if (computation.discounts.coupon > 0) {
            runningY = writeTotal(
                `Coupon Discount${couponCode ? ` (${couponCode})` : ''}`,
                `- ${inr(computation.discounts.coupon)}`,
                runningY
            );
        }
        if (computation.discounts.member > 0) {
            runningY = writeTotal(`Member Discount (${tierTheme.label})`, `- ${inr(computation.discounts.member)}`, runningY);
        }
        if (computation.discounts.memberShippingBenefit > 0) {
            runningY = writeTotal('Member Shipping Benefit', `- ${inr(computation.discounts.memberShippingBenefit)}`, runningY);
        }
        if (computation.discounts.totalSavings > 0) {
            runningY = writeTotal('Total Savings', inr(computation.discounts.totalSavings), runningY);
        }
        runningY = writeTotal('Price After Discounts', inr(computation.priceAfterDiscounts), runningY);
    }
    if (showTaxTotals) {
        const taxSplit = getGstAmountSplit(computation.tableGstTotal);
        runningY = writeTotal('GST Breakdown', inr(computation.tableGstTotal), runningY, false, { rowGap: 3 });
        doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(taxSplit.label, totalsX, runningY, { width: 215, align: 'right' });
        runningY += doc.heightOfString(taxSplit.label, { width: 215, align: 'right' }) + 4;
    }
    if (roundOffAmount !== 0) {
        runningY = writeTotal('Round Off', inr(roundOffAmount), runningY);
    }
    doc.moveTo(totalsX, runningY).lineTo(totalsX + 215, runningY).strokeColor('#D1D5DB').stroke();
    writeTotal('Grand Total', inr(total), runningY + 8, true);

    doc.y = runningY + 44;
    ensureSpace(doc, estimatePolicyBlockHeight(doc, company), 52);

    const policyTop = doc.y;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Terms & Conditions', 42, policyTop);
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(
        '1. All sales are final after dispatch. 2. Product visuals and colour may slightly vary based on display settings.',
        42,
        policyTop + 12,
        { width: 520, lineGap: 1 }
    );

    const refundHeadingY = policyTop + 34;
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Refund Policy', 42, refundHeadingY);
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(
        'No refunds are allowed under any circumstances. Replacements are allowed only when the customer provides a continuous unedited video from receiving the courier package, opening the box, and clearly showing the defect, if any.',
        42,
        refundHeadingY + 12,
        { width: 520, lineGap: 1 }
    );

    doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(
        `Support: ${company.supportEmail || DEFAULT_SUPPORT_EMAIL}${company.contactNumber ? ` | ${company.contactNumber}` : ''}`,
        42,
        doc.page.height - 70,
        { width: 520, align: 'left', lineBreak: false }
    );
    doc.font('Helvetica').fontSize(8).fillColor('#9CA3AF').text(
        'This is a computer-generated invoice and does not require a signature.',
        42,
        doc.page.height - 58,
        { width: 520, align: 'left', lineBreak: false }
    );

    addPageNumbers(doc);
    return toBuffer(doc);
};

module.exports = { buildInvoicePdfBuffer };
module.exports.__test = {
    resolveInvoiceTaxPriceMode,
    getItems,
    buildShippingRow,
    computeInvoiceComputation
};
