const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRes, importClientModule, withPatched } = require('./testUtils');

const db = require('../config/db');
const Shipping = require('../models/Shipping');
const shippingController = require('../controllers/shippingController');

test('public shipping endpoint returns preview-safe payload while admin gets full config', async () => {
    const sampleZones = [{
        id: 1,
        name: 'South',
        states: ['Tamil Nadu'],
        options: [{ id: 11, name: 'Standard', rate: 125, conditionType: 'price', min: 0, max: null }]
    }];

    const publicRes = createMockRes();
    const adminRes = createMockRes();

    await withPatched(Shipping, {
        getAll: async () => sampleZones
    }, async () => {
        await shippingController.getZones({}, publicRes);
        await shippingController.getZones({ user: { role: 'admin' } }, adminRes);
    });

    assert.deepEqual(publicRes.body.zones, [{
        states: ['Tamil Nadu'],
        options: [{ rate: 125, conditionType: 'price', min: 0, max: null }]
    }]);
    assert.equal(adminRes.body.zones[0].name, 'South');
    assert.equal(adminRes.body.zones[0].options[0].name, 'Standard');
});

test('shipping zone create rejects overlapping ranges and duplicate state coverage', async () => {
    const originalGetConnection = db.getConnection;
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql) {
            if (sql.includes('SELECT id, states FROM shipping_zones')) {
                return [[{ id: 99, states: JSON.stringify(['Kerala']) }]];
            }
            return [[]];
        },
        async query() {
            return [];
        }
    };
    db.getConnection = async () => fakeConnection;

    try {
        await assert.rejects(
            () => Shipping.createZone({
                name: 'Bad overlap',
                states: ['Tamil Nadu'],
                options: [
                    { name: 'Standard', rate: 100, conditionType: 'price', min: 0, max: 999 },
                    { name: 'Express', rate: 150, conditionType: 'price', min: 999, max: null }
                ]
            }),
            /overlapping price shipping ranges/i
        );

        await assert.rejects(
            () => Shipping.createZone({
                name: 'Duplicate state',
                states: ['Kerala'],
                options: [{ name: 'Standard', rate: 100, conditionType: 'price', min: 0, max: null }]
            }),
            /already assigned to another zone/i
        );
    } finally {
        db.getConnection = originalGetConnection;
    }
});

test('shipping zone update and delete return not found for invalid ids', async () => {
    const originalGetConnection = db.getConnection;
    const originalExecute = db.execute;
    const fakeConnection = {
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
        async execute(sql) {
            if (sql.includes('SELECT id FROM shipping_zones')) return [[]];
            if (sql.includes('SELECT id, states FROM shipping_zones')) return [[]];
            return [[]];
        },
        async query() {
            return [];
        }
    };
    db.getConnection = async () => fakeConnection;
    db.execute = async () => [{ affectedRows: 0 }];

    try {
        await assert.rejects(
            () => Shipping.updateZone(123, { name: 'Missing', states: [], options: [] }),
            /shipping zone not found/i
        );
        await assert.rejects(
            () => Shipping.deleteZone(123),
            /shipping zone not found/i
        );
    } finally {
        db.getConnection = originalGetConnection;
        db.execute = originalExecute;
    }
});

test('shipping update emits preview-safe payload publicly and full payload to admin room', async () => {
    const emitted = [];
    const io = {
        except(room) {
            return {
                emit(event, payload) {
                    emitted.push({ scope: `except:${room}`, event, payload });
                }
            };
        },
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ scope: `to:${room}`, event, payload });
                }
            };
        }
    };

    await withPatched(Shipping, {
        getAll: async () => [{
            id: 1,
            name: 'South',
            states: ['Tamil Nadu'],
            options: [{ id: 11, name: 'Standard', rate: 125, conditionType: 'price', min: 0, max: null }]
        }],
        updateZone: async () => true
    }, async () => {
        const req = {
            params: { id: 1 },
            body: { name: 'South', states: ['Tamil Nadu'], options: [] },
            app: { get: () => io }
        };
        const res = createMockRes();
        await shippingController.updateZone(req, res);
        assert.equal(res.statusCode, 200);
    });

    const publicEmit = emitted.find((entry) => entry.scope === 'except:admin');
    const adminEmit = emitted.find((entry) => entry.scope === 'to:admin');
    assert.equal(publicEmit.payload.zones[0].name, undefined);
    assert.equal(publicEmit.payload.zones[0].options[0].name, undefined);
    assert.equal(adminEmit.payload.zones[0].name, 'South');
    assert.equal(adminEmit.payload.zones[0].options[0].name, 'Standard');
});

test('client shipping preview normalizes state formatting consistently', async () => {
    const preview = await importClientModule('client/src/utils/shippingPreview.js');
    const result = preview.computeShippingPreview({
        zones: [{
            states: ['Tamil Nadu'],
            options: [{ rate: 125, conditionType: 'price', min: 0, max: null }]
        }],
        state: ' tamil-nadu ',
        subtotal: 500,
        totalWeightKg: 0.2
    });

    assert.equal(result.fee, 125);
});
