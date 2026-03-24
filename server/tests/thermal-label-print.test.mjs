import test from 'node:test';
import assert from 'node:assert/strict';

import {
    buildEscPosLabel,
    buildShippingLabelPayload,
    resolvePreferredPrinterTransports,
    validateShippingLabelData
} from '../../client/src/utils/thermalLabelPrint.js';

const companyProfile = {
    displayName: 'SSC Jewellery',
    contactNumber: '9876543210',
    address: '12 Market Street, Salem, Tamil Nadu 636001'
};

const order = {
    order_ref: 'ALS6831',
    customer_name: 'Natarajan Raju',
    customer_mobile: '9876501234',
    shipping_address: {
        line1: '221 Lake View Road',
        city: 'Chennai',
        state: 'Tamil Nadu',
        zip: '600001'
    }
};

test('validateShippingLabelData accepts complete order and company data', () => {
    const result = validateShippingLabelData(order, companyProfile);
    assert.equal(result.ok, true);
    assert.deepEqual(result.missing, []);
    assert.equal(result.details.orderRef, 'ALS6831');
    assert.equal(result.details.senderName, 'SSC Jewellery');
    assert.equal(result.details.shippingName, 'Natarajan Raju');
});

test('validateShippingLabelData reports missing shipping address fields', () => {
    const result = validateShippingLabelData({ order_ref: 'ALS6831' }, companyProfile);
    assert.equal(result.ok, false);
    assert.ok(result.missing.includes('recipient name'));
    assert.ok(result.missing.includes('shipping address'));
});

test('buildShippingLabelPayload creates sender and recipient label blocks', () => {
    const payload = buildShippingLabelPayload(order, companyProfile);
    assert.equal(payload.orderRef, 'ALS6831');
    assert.equal(payload.sender.name, 'SSC Jewellery');
    assert.equal(payload.sender.phone, '9876543210');
    assert.equal(payload.recipient.name, 'Natarajan Raju');
    assert.equal(payload.recipient.phone, '9876501234');
    assert.ok(payload.sender.addressLines.length > 0);
    assert.ok(payload.recipient.addressLines.length > 0);
});

test('buildEscPosLabel includes shipping label text content', () => {
    const payload = buildShippingLabelPayload(order, companyProfile);
    const bytes = buildEscPosLabel(payload);
    assert.ok(bytes instanceof Uint8Array);
    assert.ok(bytes.length > 20);
    const decoded = new TextDecoder().decode(bytes);
    assert.match(decoded, /SHIP TO/);
    assert.match(decoded, /Order Ref: ALS6831/);
    assert.match(decoded, /SSC Jewellery/);
    assert.match(decoded, /Natarajan Raju/);
});

test('resolvePreferredPrinterTransports prefers stored transport and then bluetooth before usb', () => {
    assert.deepEqual(
        resolvePreferredPrinterTransports({
            storedTransport: 'usb',
            supportState: { transports: ['bluetooth', 'usb'] }
        }),
        ['usb', 'bluetooth']
    );
    assert.deepEqual(
        resolvePreferredPrinterTransports({
            storedTransport: '',
            supportState: { transports: ['bluetooth', 'usb'] }
        }),
        ['bluetooth', 'usb']
    );
});
