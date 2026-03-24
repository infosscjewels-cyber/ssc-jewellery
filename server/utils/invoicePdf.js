const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { resolvePublicAssetPath } = require('./publicAssetResolver');

const DEFAULT_SUPPORT_EMAIL = 'support@sscjewellery.com';
const TAMIL_REGEX = /[\u0B80-\u0BFF]/;

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

const inr = (value) => `INR ${toNumber(value).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
})}`;

const roundToTwo = (value) => Math.round(toNumber(value, 0) * 100) / 100;
const roundCurrency = (value) => roundToTwo(value);
const formatPercent = (value) => `${roundToTwo(value).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
})}%`;
const getGstAmountSplit = (totalTaxAmount = 0) => {
    const totalTax = Math.max(0, toNumber(totalTaxAmount, 0));
    const halfTax = roundToTwo(totalTax / 2);
    return {
        totalTax,
        halfTax,
        label: `SGST ${inr(halfTax)} + CGST ${inr(halfTax)}`
    };
};
const buildDiscountCellParts = (item = {}) => {
    const totalDiscount = Math.max(
        0,
        toNumber(item.discount, 0) + toNumber(item.couponDiscount, 0) + toNumber(item.memberDiscount, 0) + toNumber(item.shippingBenefitShare, 0)
    );
    const breakdown = [
        `Product: ${inr(item.discount)}`,
        `Coupon: ${inr(item.couponDiscount)}`,
        `Member: ${inr(item.memberDiscount)}`
    ];
    if (toNumber(item.shippingBenefitShare, 0) > 0) {
        breakdown.push(`Shipping Benefit: ${inr(item.shippingBenefitShare)}`);
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
    const line1 = source.line1 || source.addressLine1 || source.address || '';
    const line2 = source.line2 || source.addressLine2 || '';
    const cityState = [source.city, source.state].filter(Boolean).join(', ');
    const zip = source.zip || source.pincode || source.postalCode || '';
    const country = source.country || 'India';
    return [line1, line2, cityState, zip, country].filter(Boolean);
};

const resolveFirstExistingPath = (candidates = []) => {
    for (const filePath of candidates) {
        if (fs.existsSync(filePath)) return filePath;
    }
    return null;
};

const resolveLogoPath = (company = {}) => {
    const brandedLogo = resolvePublicAssetPath(company.logoUrl || '');
    if (brandedLogo) return brandedLogo;
    return resolveFirstExistingPath([
        path.join(__dirname, '../../client/public/apple-touch-icon.png'),
        path.join(__dirname, '../../client/public/logo.png'),
        path.join(__dirname, '../../client/public/logo.jpg'),
        path.join(__dirname, '../../client/public/logo.jpeg'),
        path.join(__dirname, '../../client/public/logo.webp')
    ]);
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

const resolveUnicodeFontPath = () => resolveFirstExistingPath([
    '/usr/share/fonts/truetype/noto/NotoSansTamil-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSansTamilUI-Regular.ttf',
    '/usr/share/fonts/truetype/noto/NotoSans-Regular.ttf'
]);

const containsTamil = (value) => TAMIL_REGEX.test(String(value || ''));

const textHeight = (doc, text, width, size, fonts) => {
    const font = containsTamil(text) ? (fonts.tamil || fonts.base) : fonts.base;
    doc.font(font).fontSize(size);
    return doc.heightOfString(String(text || ''), { width, lineGap: 1 });
};

const drawMixedText = (doc, text, x, y, options = {}, fonts = { base: 'Helvetica', tamil: null }) => {
    const size = options.size || 9;
    const color = options.color || '#111827';
    const width = options.width;
    const align = options.align || 'left';
    const safe = String(text || '');
    const font = containsTamil(safe) ? (fonts.tamil || fonts.base) : fonts.base;
    doc.font(font).fontSize(size).fillColor(color).text(safe, x, y, {
        width,
        align
    });
};

const getCompany = (order = {}) => {
    const snapshot = parseObject(order.company_snapshot || order.companySnapshot) || {};
    return {
        displayName: String(snapshot.displayName || 'SSC Jewellery'),
        contactNumber: String(snapshot.contactNumber || ''),
        supportEmail: String(snapshot.supportEmail || ''),
        address: String(snapshot.address || '')
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

const getItems = (order = {}) => {
    const raw = Array.isArray(order.items) ? order.items : [];
    const baseItems = raw.map((item) => {
        const snapshot = parseObject(item.item_snapshot || item.itemSnapshot || item.snapshot) || {};
        const qty = Math.max(0, toNumber(item.quantity ?? snapshot.quantity, 0));
        const paidUnit = toNumber(item.price ?? snapshot.unitPrice, 0);
        const mrpUnit = toNumber(item.original_price ?? snapshot.originalPrice, paidUnit) || paidUnit;
        const finalLineTotal = toNumber(item.line_total ?? snapshot.lineTotal, paidUnit * qty);
        const taxRatePercent = toNumber(item.tax_rate_percent ?? snapshot.taxRatePercent, 0);
        const taxAmount = toNumber(item.tax_amount ?? snapshot.taxAmount, 0);
        const variantTitle = item.variant_title || snapshot.variantTitle || '';
        const variantOptions = stringifyVariantOptions(snapshot.variantOptions || item.variant_options || item.variantOptions);
        const resolvedTaxRatePercent = taxRatePercent > 0
            ? taxRatePercent
            : toNumber(parseObject(item.tax_snapshot_json || item.taxSnapshot || item.tax_snapshot || snapshot.taxSnapshot)?.ratePercent, 0);
        const parsedWarrantyMonths = Number(snapshot.polishWarrantyMonths || 0);
        const polishWarrantyMonths = [6, 7, 8, 9, 12].includes(parsedWarrantyMonths) ? parsedWarrantyMonths : 0;

        return {
            name: String(item.title || snapshot.title || 'Item'),
            variantLine: [variantTitle, variantOptions].filter(Boolean).join(' | '),
            warrantyLine: polishWarrantyMonths > 0 ? `Polish Warranty: ${polishWarrantyMonths} months` : '',
            qty,
            unitPriceMrp: mrpUnit,
            unitPricePaid: paidUnit,
            discount: Math.max(0, (mrpUnit - paidUnit) * qty),
            lineTotal: finalLineTotal,
            taxAmount,
            taxRatePercent: resolvedTaxRatePercent,
            lineTotalInclTax: finalLineTotal + taxAmount
        };
    });

    const subtotal = Math.max(0, toNumber(order.subtotal, baseItems.reduce((sum, item) => sum + toNumber(item.lineTotal, 0), 0)));
    const couponDiscount = Math.max(0, toNumber(order.coupon_discount_value, 0));
    const loyaltyDiscount = Math.max(0, toNumber(order.loyalty_discount_total, 0));
    const lineDenominator = subtotal > 0
        ? subtotal
        : Math.max(1, baseItems.reduce((sum, item) => sum + Math.max(0, toNumber(item.lineTotal, 0)), 0));

    let couponAllocated = 0;
    let memberAllocated = 0;

    return baseItems.map((item, index) => {
        const lineBase = Math.max(0, toNumber(item.lineTotal, 0));
        const ratio = lineDenominator > 0 ? (lineBase / lineDenominator) : 0;
        const isLast = index === baseItems.length - 1;

        const couponShare = isLast
            ? Math.max(0, couponDiscount - couponAllocated)
            : roundCurrency(couponDiscount * ratio);
        couponAllocated += couponShare;

        const memberShare = isLast
            ? Math.max(0, loyaltyDiscount - memberAllocated)
            : roundCurrency(loyaltyDiscount * ratio);
        memberAllocated += memberShare;
        const taxableValue = Math.max(0, lineBase - couponShare - memberShare);

        return {
            ...item,
            couponDiscount: couponShare,
            memberDiscount: memberShare,
            shippingShare: 0,
            shippingBenefitShare: 0,
            netShippingShare: 0,
            taxableValue,
            lineTotalInclTax: taxableValue + toNumber(item.taxAmount, 0)
        };
    });
};

const buildShippingRow = (order = {}, items = []) => {
    const shippingFee = Math.max(0, toNumber(order.shipping_fee, 0));
    const shippingBenefitShare = Math.max(0, toNumber(order.loyalty_shipping_discount_total, 0));
    const totalTax = Math.max(0, toNumber(order.tax_total, 0));
    const itemTaxTotal = items.reduce((sum, item) => sum + Math.max(0, toNumber(item.taxAmount, 0)), 0);
    const shippingTaxAmount = Math.max(0, roundCurrency(totalTax - itemTaxTotal));
    if (shippingFee <= 0 && shippingBenefitShare <= 0 && shippingTaxAmount <= 0) return null;

    const taxableValue = Math.max(0, shippingFee - shippingBenefitShare);
    return {
        name: 'Shipping',
        variantLine: 'Delivery charge',
        warrantyLine: '',
        qty: 1,
        unitPriceMrp: shippingFee,
        unitPricePaid: taxableValue,
        discount: 0,
        couponDiscount: 0,
        memberDiscount: 0,
        shippingShare: shippingFee,
        shippingBenefitShare,
        netShippingShare: taxableValue,
        taxableValue,
        taxAmount: shippingTaxAmount,
        taxRatePercent: 0,
        lineTotal: taxableValue,
        lineTotalInclTax: taxableValue + shippingTaxAmount,
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

const drawTableHeader = (doc, y, { showTaxColumns = false } = {}) => {
    const left = 42;
    const tableWidth = 510;
    const headerHeight = showTaxColumns ? 30 : 22;
    const cols = showTaxColumns
        ? {
            idx: { x: 46, width: 14, label: '#', align: 'left' },
            name: { x: 62, width: 136, label: 'Item', align: 'left' },
            price: { x: 200, width: 74, label: 'Unit Price (MRP)', align: 'right' },
            qty: { x: 276, width: 24, label: 'Qty', align: 'right' },
            discount: { x: 302, width: 106, label: 'Discount', align: 'right' },
            gstAmount: { x: 410, width: 78, label: 'GST', align: 'right' },
            total: { x: 490, width: 58, label: 'Line Total', align: 'right' }
        }
        : {
            idx: { x: 46, width: 18, label: '#', align: 'left' },
            name: { x: 66, width: 224, label: 'Item', align: 'left' },
            price: { x: 292, width: 82, label: 'Unit Price (MRP)', align: 'right' },
            qty: { x: 376, width: 32, label: 'Qty', align: 'right' },
            discount: { x: 410, width: 72, label: 'Discount', align: 'right' },
            total: { x: 484, width: 66, label: 'Line Total', align: 'right' }
        };

    doc.rect(left, y, tableWidth, headerHeight).fill('#F9FAFB');
    doc.fillColor('#4B5563').font('Helvetica-Bold').fontSize(showTaxColumns ? 7 : 8);
    Object.values(cols).forEach((col) => {
        doc.text(col.label, col.x, y + 7, { width: col.width, align: col.align || 'left' });
    });
    return { left, tableWidth, cols, nextY: y + headerHeight, showTaxColumns };
};

const drawItemsTable = (doc, fonts, startY, items = [], { showTaxColumns = false } = {}) => {
    const pageBottom = doc.page.height - 220;
    const table = drawTableHeader(doc, startY, { showTaxColumns });
    let y = table.nextY;

    if (!items.length) {
        doc.rect(table.left, y, table.tableWidth, 24).strokeColor('#E5E7EB').stroke();
        doc.font('Helvetica').fontSize(9).fillColor('#6B7280').text('No items found', table.cols.name.x, y + 7);
        return y + 24;
    }

    const tableTotals = {
        qty: 0,
        unitPriceMrp: 0,
        productDiscount: 0,
        couponDiscount: 0,
        memberDiscount: 0,
        shippingBenefitShare: 0,
        gstAmount: 0,
        lineTotal: 0,
        lineTotalInclTax: 0
    };

    items.forEach((item, idx) => {
        const itemText = [item.name, item.variantLine, item.warrantyLine].filter(Boolean).join('\n');
        const itemTextHeight = textHeight(doc, itemText, table.cols.name.width, 9, fonts);
        const discountParts = showTaxColumns ? buildDiscountCellParts(item) : null;
        const discountTextHeight = showTaxColumns
            ? getBreakdownCellHeight(doc, table.cols.discount.width, discountParts, fonts)
            : textHeight(doc, inr(item.discount), table.cols.discount.width, 9, fonts);
        const gstParts = showTaxColumns ? buildGstCellParts(item) : null;
        const gstTextHeight = showTaxColumns
            ? getBreakdownCellHeight(doc, table.cols.gstAmount.width, gstParts, fonts)
            : 0;
        const rowHeight = Math.max(24, itemTextHeight + 8, discountTextHeight + 8, gstTextHeight + 8);

        if (y + rowHeight > pageBottom) {
            doc.addPage();
            const next = drawTableHeader(doc, 52, { showTaxColumns });
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

        doc.text(inr(item.unitPriceMrp), table.cols.price.x, y + 6, { width: table.cols.price.width, align: 'right' });
        doc.font('Helvetica').fontSize(9).fillColor('#111827').text(String(item.qty), table.cols.qty.x, y + 6, { width: table.cols.qty.width, align: 'right' });
        if (showTaxColumns) {
            drawBreakdownCell(doc, table.cols.discount.x, y + 5, table.cols.discount.width, discountParts, 'right', {}, fonts);
            drawBreakdownCell(doc, table.cols.gstAmount.x, y + 5, table.cols.gstAmount.width, gstParts, 'right', {}, fonts);
            doc.font('Helvetica').fontSize(9).fillColor('#111827');
            doc.text(inr(item.lineTotalInclTax), table.cols.total.x, y + 6, { width: table.cols.total.width, align: 'right' });
        } else {
            doc.font('Helvetica').fontSize(9).fillColor('#111827').text(inr(item.discount), table.cols.discount.x, y + 5, { width: table.cols.discount.width, align: 'right' });
            doc.text(inr(item.lineTotal), table.cols.total.x, y + 6, { width: table.cols.total.width, align: 'right' });
        }

        tableTotals.qty += toNumber(item.qty, 0);
        tableTotals.unitPriceMrp += toNumber(item.unitPriceMrp, 0) * toNumber(item.qty, 0);
        tableTotals.productDiscount += toNumber(item.discount, 0);
        tableTotals.couponDiscount += toNumber(item.couponDiscount, 0);
        tableTotals.memberDiscount += toNumber(item.memberDiscount, 0);
        tableTotals.shippingBenefitShare += toNumber(item.shippingBenefitShare, 0);
        tableTotals.gstAmount += toNumber(item.taxAmount, 0);
        tableTotals.lineTotal += toNumber(item.lineTotal, 0);
        tableTotals.lineTotalInclTax += toNumber(item.lineTotalInclTax, 0);
        y += rowHeight;
    });

    const totalsDiscountParts = showTaxColumns
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
            getBreakdownCellHeight(doc, table.cols.discount.width, totalsDiscountParts, fonts) + 8,
            getBreakdownCellHeight(doc, table.cols.gstAmount.width, totalsGstParts, fonts) + 8
        )
        : 24;
    if (y + totalsRowHeight > pageBottom) {
        doc.addPage();
        const next = drawTableHeader(doc, 52, { showTaxColumns });
        y = next.nextY;
    }
    doc.rect(table.left, y, table.tableWidth, totalsRowHeight).fill('#F9FAFB');
    doc.rect(table.left, y, table.tableWidth, totalsRowHeight).strokeColor('#D1D5DB').stroke();
    doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text('Table Totals', table.cols.name.x, y + 7, { width: table.cols.name.width });
    doc.text(inr(tableTotals.unitPriceMrp), table.cols.price.x, y + 7, { width: table.cols.price.width, align: 'right' });
    doc.text(`${Math.round(tableTotals.qty)}`, table.cols.qty.x, y + 7, { width: table.cols.qty.width, align: 'right' });
    if (showTaxColumns) {
        drawBreakdownCell(doc, table.cols.discount.x, y + 5, table.cols.discount.width, totalsDiscountParts, 'right', { bold: true }, fonts);
        drawBreakdownCell(doc, table.cols.gstAmount.x, y + 5, table.cols.gstAmount.width, totalsGstParts, 'right', { bold: true }, fonts);
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151');
        doc.text(inr(tableTotals.lineTotalInclTax), table.cols.total.x, y + 7, { width: table.cols.total.width, align: 'right' });
    } else {
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#374151').text(inr(tableTotals.productDiscount), table.cols.discount.x, y + 5, { width: table.cols.discount.width, align: 'right' });
        doc.text(inr(tableTotals.lineTotal), table.cols.total.x, y + 7, { width: table.cols.total.width, align: 'right' });
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
    const unicodeFontName = unicodeFontPath ? 'InvoiceTamil' : null;
    if (unicodeFontPath) {
        doc.registerFont(unicodeFontName, unicodeFontPath);
    }
    const fonts = {
        base: 'Helvetica',
        tamil: unicodeFontName || 'Helvetica'
    };

    const company = getCompany(order);
    const companySnapshot = parseObject(order.company_snapshot || order.companySnapshot) || {};
    const billing = parseObject(order.billing_address || order.billingAddress) || {};
    const shipping = parseObject(order.shipping_address || order.shippingAddress) || {};
    const items = getItems(order);
    const shippingRow = buildShippingRow(order, items);
    const tableItems = shippingRow ? [...items, shippingRow] : items;
    const orderRef = order.order_ref || order.orderRef || `ORDER-${order.id || 'N/A'}`;

    const subtotal = toNumber(order.subtotal, items.reduce((sum, item) => sum + item.lineTotal, 0));
    const shippingFee = toNumber(order.shipping_fee, 0);
    const couponDiscount = toNumber(order.coupon_discount_value, 0);
    const loyaltyDiscount = toNumber(order.loyalty_discount_total, 0);
    const loyaltyShippingDiscount = toNumber(order.loyalty_shipping_discount_total, 0);
    const taxTotal = toNumber(order.tax_total, tableItems.reduce((sum, item) => sum + toNumber(item.taxAmount, 0), 0));
    const showTaxTotals = taxTotal > 0;
    const showTaxColumns = toBoolean(companySnapshot.taxEnabled ?? companySnapshot.tax_enabled, false) || showTaxTotals;
    const totalDiscount = toNumber(order.discount_total, couponDiscount + loyaltyDiscount + loyaltyShippingDiscount);
    const total = toNumber(order.total, subtotal + shippingFee + taxTotal - totalDiscount);
    const couponCode = String(order.coupon_code || order.couponCode || '').trim();
    const tierTheme = getTierTheme(order.loyalty_tier || order.loyaltyTier || 'regular');

    const logoPath = resolveLogoPath(company);
    if (logoPath) {
        try {
            doc.image(logoPath, 42, 36, { fit: [96, 52] });
        } catch {}
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

    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111827').text(company.displayName, 42, 94, { width: 300 });
    if (company.address) {
        drawMixedText(doc, company.address, 42, 111, {
            size: 9,
            color: '#374151',
            width: 300
        }, fonts);
    }
    const contactLine = [company.contactNumber, company.supportEmail || DEFAULT_SUPPORT_EMAIL].filter(Boolean).join(' | ');
    doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(contactLine, 42, 137, { width: 320 });

    const billingLines = [
        billing.name || billing.fullName || order.customer_name || 'Customer',
        billing.mobile || billing.phone || order.customer_mobile || '',
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

    let cursorY = drawItemsTable(doc, fonts, infoY + 34, tableItems, { showTaxColumns });

    doc.y = cursorY + 12;
    ensureSpace(doc, 230, 52);

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

    const basePriceBeforeDiscounts = Math.max(0, subtotal + shippingFee);
    const taxableValueAfterDiscounts = Math.max(0, basePriceBeforeDiscounts - couponDiscount - loyaltyDiscount - loyaltyShippingDiscount);
    let runningY = totalsY;
    runningY = writeTotal('Subtotal', inr(subtotal), runningY);
    runningY = writeTotal('Shipping', inr(shippingFee), runningY);
    runningY = writeTotal('Base Price (Before Discounts)', inr(basePriceBeforeDiscounts), runningY);
    runningY = writeTotal(
        `Coupon Discount${couponCode ? ` (${couponCode})` : ''}`,
        `- ${inr(couponDiscount)}`,
        runningY
    );
    runningY = writeTotal(`Member Discount (${tierTheme.label})`, `- ${inr(loyaltyDiscount)}`, runningY);
    runningY = writeTotal('Member Shipping Benefit', `- ${inr(loyaltyShippingDiscount)}`, runningY);
    runningY = writeTotal('Total Savings', inr(totalDiscount), runningY);
    runningY = writeTotal('Taxable Value After Discounts', inr(taxableValueAfterDiscounts), runningY);
    if (showTaxTotals) {
        const taxSplit = getGstAmountSplit(taxTotal);
        runningY = writeTotal('GST Total', inr(taxTotal), runningY, false, { rowGap: 3 });
        doc.font('Helvetica').fontSize(8).fillColor('#6B7280').text(taxSplit.label, totalsX, runningY, { width: 215, align: 'right' });
        runningY += doc.heightOfString(taxSplit.label, { width: 215, align: 'right' }) + 4;
    }
    doc.moveTo(totalsX, runningY).lineTo(totalsX + 215, runningY).strokeColor('#D1D5DB').stroke();
    writeTotal('Grand Total', inr(total), runningY + 8, true);

    doc.y = runningY + 44;
    ensureSpace(doc, 120, 52);

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
