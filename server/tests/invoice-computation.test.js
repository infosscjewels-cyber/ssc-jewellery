const test = require('node:test');
const assert = require('node:assert/strict');

const { computeInvoiceComputation } = require('../domain/computation/orderComputation');

const buildLine = (overrides = {}) => ({
    qty: 1,
    displayRate: 100,
    displayAmount: 100,
    displayProductDiscount: 0,
    displayCouponDiscount: 0,
    displayMemberDiscount: 0,
    displayShippingBenefitShare: 0,
    taxAmount: 5,
    isShippingRow: false,
    ...overrides
});

test('invoice computation: no-discount order keeps discount buckets empty', () => {
    const snapshot = computeInvoiceComputation({
        order: { total: 267.75, round_off_amount: 0 },
        tableItems: [
            buildLine({ displayAmount: 100, taxAmount: 5 }),
            buildLine({ displayAmount: 150, taxAmount: 12.5 }),
            buildLine({ isShippingRow: true, displayAmount: 10, taxAmount: 0.25 })
        ],
        taxRegime: 'exclusive'
    });

    assert.equal(snapshot.hasAnyDiscount, false);
    assert.equal(snapshot.subtotalBaseExShipping, 250);
    assert.equal(snapshot.shippingBase, 10);
    assert.equal(snapshot.tableAmountTotal, 260);
    assert.equal(snapshot.tableDiscountTotal, 0);
    assert.equal(snapshot.tableGstTotal, 17.75);
    assert.equal(snapshot.priceAfterDiscounts, 260);
    assert.equal(snapshot.grandTotal, 267.75);
});

test('invoice computation: inclusive mode with product discount computes aligned totals', () => {
    const snapshot = computeInvoiceComputation({
        order: { total: 1100, round_off_amount: 0 },
        tableItems: [
            buildLine({ displayAmount: 533.98, displayProductDiscount: 0, taxAmount: 16.02 }),
            buildLine({ displayAmount: 485.44, displayProductDiscount: 29.13, taxAmount: 13.69 }),
            buildLine({ isShippingRow: true, displayAmount: 77.67, displayShippingBenefitShare: 0, taxAmount: 2.33 })
        ],
        taxRegime: 'inclusive'
    });

    assert.equal(snapshot.taxRegime, 'inclusive');
    assert.equal(snapshot.subtotalBaseExShipping, 1019.42);
    assert.equal(snapshot.shippingBase, 77.67);
    assert.equal(snapshot.tableAmountTotal, 1097.09);
    assert.equal(snapshot.tableDiscountTotal, 29.13);
    assert.equal(snapshot.tableGstTotal, 32.04);
    assert.equal(snapshot.discounts.product, 29.13);
    assert.equal(snapshot.discounts.coupon, 0);
    assert.equal(snapshot.discounts.member, 0);
    assert.equal(snapshot.discounts.memberShippingBenefit, 0);
    assert.equal(snapshot.discounts.totalSavings, 29.13);
    assert.equal(snapshot.priceBeforeDiscounts, 1097.09);
    assert.equal(snapshot.priceAfterDiscounts, 1067.96);
    assert.equal(snapshot.grandTotal, 1100);
});

test('invoice computation: mixed discounts report only applicable non-zero buckets', () => {
    const snapshot = computeInvoiceComputation({
        order: { round_off_amount: -0.01 },
        tableItems: [
            buildLine({
                displayAmount: 500,
                displayProductDiscount: 10,
                displayCouponDiscount: 5,
                displayMemberDiscount: 0,
                taxAmount: 22.5
            }),
            buildLine({
                isShippingRow: true,
                displayAmount: 100,
                displayShippingBenefitShare: 15,
                displayMemberDiscount: 3,
                taxAmount: 4.25
            })
        ],
        taxRegime: 'exclusive'
    });

    assert.equal(snapshot.hasAnyDiscount, true);
    assert.equal(snapshot.discounts.product, 10);
    assert.equal(snapshot.discounts.coupon, 5);
    assert.equal(snapshot.discounts.member, 3);
    assert.equal(snapshot.discounts.memberShippingBenefit, 15);
    assert.equal(snapshot.discounts.totalSavings, 33);
    assert.equal(snapshot.tableDiscountTotal, 33);
    assert.equal(snapshot.priceAfterDiscounts, 567);
    assert.equal(snapshot.tableGstTotal, 26.75);
    assert.equal(snapshot.grandTotal, 593.74);
});
