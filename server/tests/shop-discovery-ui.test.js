const test = require('node:test');
const assert = require('node:assert/strict');
const { importClientModule } = require('./testUtils');

test('discovery search eligibility does not depend on hasMore', async () => {
    const { shouldRunDiscoverySearch } = await importClientModule('client/src/utils/shopDiscovery.js');

    assert.equal(shouldRunDiscoverySearch('a', false), false);
    assert.equal(shouldRunDiscoverySearch('ab', false), true);
    assert.equal(shouldRunDiscoverySearch('ab', true), true);
});

test('in-stock filter handles variant-level stock correctly', async () => {
    const { isDiscoveryItemInStock } = await importClientModule('client/src/utils/shopDiscovery.js');

    const allTrackedVariantsOos = {
        variants: [
            { track_quantity: 1, quantity: 0 },
            { track_quantity: true, quantity: 0 }
        ]
    };
    const oneTrackedVariantAvailable = {
        variants: [
            { track_quantity: 1, quantity: 0 },
            { track_quantity: 1, quantity: 3 }
        ]
    };
    const untrackedVariant = {
        variants: [
            { track_quantity: 0, quantity: 0 }
        ]
    };

    assert.equal(isDiscoveryItemInStock(allTrackedVariantsOos), false);
    assert.equal(isDiscoveryItemInStock(oneTrackedVariantAvailable), true);
    assert.equal(isDiscoveryItemInStock(untrackedVariant), true);
});
