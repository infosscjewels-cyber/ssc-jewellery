const test = require('node:test');
const assert = require('node:assert/strict');

const AbandonedCart = require('../models/AbandonedCart');
const recoveryService = require('../services/abandonedCartRecoveryService');
const { createMockRes, withPatched, requireFresh } = require('./testUtils');

const loadController = () => requireFresh('../controllers/communicationsController');

test('admin abandoned-cart campaign endpoint returns campaign payload', async () => {
    const req = {};
    const res = createMockRes();

    await withPatched(AbandonedCart, {
        getCampaign: async () => ({ enabled: true, sendEmail: true, sendWhatsapp: false })
    }, async () => {
        const controller = loadController();
        await controller.getAbandonedCartCampaign(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        campaign: { enabled: true, sendEmail: true, sendWhatsapp: false }
    });
});

test('admin abandoned-cart journeys endpoint returns journeys + total', async () => {
    const req = {
        query: {
            status: 'active',
            sortBy: 'newest',
            search: 'user@example.com',
            limit: '20',
            offset: '0'
        }
    };
    const res = createMockRes();

    await withPatched(AbandonedCart, {
        listJourneysAdvanced: async (params) => {
            assert.equal(params.status, 'active');
            assert.equal(params.sortBy, 'newest');
            assert.equal(params.search, 'user@example.com');
            assert.equal(params.limit, 20);
            assert.equal(params.offset, 0);
            return {
                journeys: [{ id: 101, status: 'active' }],
                total: 1
            };
        }
    }, async () => {
        const controller = loadController();
        await controller.listAbandonedCartJourneys(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, {
        journeys: [{ id: 101, status: 'active' }],
        total: 1
    });
});

test('admin abandoned-cart insights endpoint returns insights payload', async () => {
    const req = { query: { rangeDays: '30' } };
    const res = createMockRes();

    await withPatched(AbandonedCart, {
        getInsights: async ({ rangeDays }) => {
            assert.equal(rangeDays, 30);
            return { totals: { totalJourneys: 10 } };
        }
    }, async () => {
        const controller = loadController();
        await controller.getAbandonedCartInsights(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { insights: { totals: { totalJourneys: 10 } } });
});

test('admin abandoned-cart process-now endpoint triggers maintenance + due processing', async () => {
    const emitted = [];
    const req = {
        body: { limit: 15 },
        app: {
            get: (key) => (key === 'io'
                ? {
                    to(room) {
                        return {
                            emit(event, payload) {
                                emitted.push({ room, event, payload });
                            }
                        };
                    }
                }
                : null)
        }
    };
    const res = createMockRes();
    let maintenanceCalled = false;

    await withPatched(recoveryService, {
        runAbandonedCartMaintenanceOnce: async ({ onJourneyUpdate }) => {
            maintenanceCalled = true;
            onJourneyUpdate?.({ event: 'created', journeyId: 9 });
            return { ok: true };
        },
        runDueAbandonedCartRecoveriesUntilClear: async ({ limit }) => {
            assert.equal(limit, 15);
            return { ok: true, stats: { due: 0, processed: 0 } };
        }
    }, async () => {
        const controller = loadController();
        await controller.processAbandonedCartRecoveriesNow(req, res);
    });

    assert.equal(maintenanceCalled, true);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body, { ok: true, stats: { due: 0, processed: 0 } });
    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].room, 'admin');
    assert.equal(emitted[0].event, 'abandoned_cart:journey:update');
});
