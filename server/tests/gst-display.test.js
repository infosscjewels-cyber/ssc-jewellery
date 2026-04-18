const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getGstAmountSplit,
    getGstDisplayDetails,
    getOrderGstContext,
    resolveGstJurisdiction
} = require('../utils/gst');
const { importClientModule } = require('./testUtils');

test('server GST helper returns CGST + SGST split for intra-state orders', () => {
    const details = getGstDisplayDetails({
        taxAmount: 180,
        taxRatePercent: 18,
        shippingState: 'Tamil Nadu',
        companyState: 'TN'
    });

    assert.equal(details.jurisdiction, 'intra_state');
    assert.equal(details.taxTypeLabel, 'CGST + SGST');
    assert.equal(details.sgstAmount, 90);
    assert.equal(details.cgstAmount, 90);
    assert.equal(details.componentRateLabel, 'SGST 9% + CGST 9%');
    assert.equal(details.componentAmountLabel, 'SGST INR 90 + CGST INR 90');
});

test('server GST helper returns IGST for inter-state orders', () => {
    const details = getGstDisplayDetails({
        taxAmount: 125,
        taxRatePercent: 5,
        shippingState: 'Maharashtra',
        companyState: 'Karnataka'
    });

    assert.equal(details.jurisdiction, 'inter_state');
    assert.equal(details.taxTypeLabel, 'IGST');
    assert.equal(details.igstAmount, 125);
    assert.equal(details.componentRateLabel, 'IGST 5%');
    assert.equal(details.componentAmountLabel, 'IGST INR 125');
});

test('server GST amount split preserves odd paise totals', () => {
    const split = getGstAmountSplit(1.01);
    assert.equal(split.sgstAmount, 0.5);
    assert.equal(split.cgstAmount, 0.51);
    assert.equal(Number((split.sgstAmount + split.cgstAmount).toFixed(2)), 1.01);
});

test('server order GST context parses stored shipping/company snapshots', () => {
    const context = getOrderGstContext({
        shipping_address: JSON.stringify({ state: 'Kerala' }),
        company_snapshot: JSON.stringify({ state: 'KL' })
    });
    const jurisdiction = resolveGstJurisdiction(context);

    assert.equal(context.shippingState, 'Kerala');
    assert.equal(context.companyState, 'KL');
    assert.equal(jurisdiction.kind, 'intra_state');
});

test('client GST helper falls back to generic GST when state data is unavailable', async () => {
    const clientGst = await importClientModule('client/src/utils/gst.js');
    const details = clientGst.getGstDisplayDetails({
        taxAmount: 44,
        taxRatePercent: 18
    });

    assert.equal(details.jurisdiction, 'unknown');
    assert.equal(details.taxTypeLabel, 'GST');
    assert.equal(details.componentRateLabel, 'GST 18%');
    assert.equal(details.componentAmountLabel, 'GST ₹44');
});
