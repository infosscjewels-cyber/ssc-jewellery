const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const User = require('../models/User');
const LoyaltyPopupConfig = require('../models/LoyaltyPopupConfig');
const adminController = require('../controllers/adminController');
const loyaltyService = require('../services/loyaltyService');
const { createMockRes, requireFresh, withPatched } = require('./testUtils');

const createMockIo = () => {
    const emitted = [];
    return {
        emitted,
        to(room) {
            return {
                emit(event, payload) {
                    emitted.push({ scope: `to:${room}`, event, payload });
                }
            };
        },
        emit(event, payload) {
            emitted.push({ scope: 'global', event, payload });
        }
    };
};

test('monthly loyalty reassessment query excludes inactive customers', async () => {
    const queries = [];

    await withPatched(db, {
        execute: async (query) => {
            queries.push(String(query));
            if (String(query).includes('FROM loyalty_tier_config')) return [[]];
            if (String(query).includes('FROM users')) return [[]];
            return [[]];
        }
    }, async () => {
        const result = await loyaltyService.runMonthlyLoyaltyReassessment();
        assert.equal(result.total, 0);
    });

    assert.equal(
        queries.some((query) => query.includes("FROM users WHERE role = 'customer' AND COALESCE(is_active, 1) = 1")),
        true
    );
});

test('birthday coupon issuance skips inactive customers', async () => {
    await withPatched(User, {
        findById: async () => ({
            id: 'cust_1',
            email: 'user@example.com',
            isActive: false,
            dob: '2000-03-11'
        })
    }, async () => {
        const result = await loyaltyService.issueBirthdayCouponForUser('cust_1');
        assert.equal(result.created, false);
        assert.equal(result.reason, 'user_inactive');
    });
});

test('birthday batch query excludes inactive customers', async () => {
    const queries = [];

    await withPatched(db, {
        execute: async (query) => {
            queries.push(String(query));
            return [[]];
        }
    }, async () => {
        const result = await loyaltyService.issueBirthdayCouponsForEligibleUsersToday();
        assert.equal(result.processed, 0);
        assert.equal(result.created, 0);
    });

    assert.equal(
        queries.some((query) => query.includes("WHERE role = 'customer'") && query.includes('COALESCE(is_active, 1) = 1')),
        true
    );
});

test('updating loyalty popup config emits realtime popup update payload', async () => {
    const io = createMockIo();
    const req = {
        body: { isActive: true, title: 'Flash Offer' },
        app: { get: () => io }
    };
    const res = createMockRes();

    await withPatched(LoyaltyPopupConfig, {
        updateAdminConfig: async () => ({ isActive: true, title: 'Flash Offer' }),
        getAdminConfig: async () => ({ isActive: true, title: 'Flash Offer' }),
        getClientActivePopup: async () => ({ isActive: true, title: 'Flash Offer', key: 'popup-key-1' })
    }, async () => {
        await adminController.updateLoyaltyPopupConfig(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(io.emitted.length, 2);
    assert.deepEqual(io.emitted.map((entry) => `${entry.scope}:${entry.event}`), [
        'to:admin:loyalty:popup_update',
        'global:loyalty:popup_public_update'
    ]);
    assert.equal(io.emitted[0].payload.action, 'config_update');
    assert.equal(io.emitted[0].payload.popup?.title, 'Flash Offer');
    assert.equal(io.emitted[1].payload.active, true);
    assert.equal(io.emitted[1].payload.key, 'popup-key-1');
});

test('updating loyalty config emits admin-scoped realtime payload only', async () => {
    const io = createMockIo();
    const req = {
        body: { config: [{ tier: 'gold', threshold: 5000 }] },
        app: { get: () => io }
    };
    const res = createMockRes();
    const loyaltyServiceModule = require('../services/loyaltyService');

    await withPatched(loyaltyServiceModule, {
        updateLoyaltyConfigForAdmin: async (items) => items,
        ensureLoyaltyConfigLoaded: async () => {},
        reassessActiveCustomersForConfigChange: async () => ([{
            id: 'cust_1',
            loyaltyTier: 'gold',
            loyaltyProfile: { label: 'Gold' }
        }])
    }, async () => {
        const freshAdminController = requireFresh('../controllers/adminController');
        await freshAdminController.updateLoyaltyConfig(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(io.emitted.map((entry) => `${entry.scope}:${entry.event}`), [
        'to:admin:loyalty:config_update',
        'to:admin:user:update',
        'to:user:cust_1:user:update'
    ]);
    assert.equal(Array.isArray(io.emitted[0].payload.config), true);
    assert.equal(io.emitted[0].payload.config[0].tier, 'gold');
    assert.equal(io.emitted[2].payload.loyaltyTier, 'gold');
});

test('client popup key rotates when popup content changes', async () => {
    let currentTitle = 'Flash Offer';

    await withPatched(db, {
        execute: async (query) => {
            const sql = String(query);
            if (sql.includes('UPDATE loyalty_popup_config')) return [[]];
            if (sql.includes('LEFT JOIN coupons')) return [[]];
            if (sql.includes('SELECT * FROM loyalty_popup_config WHERE id = 1 AND is_active = 1 LIMIT 1')) {
                return [[{
                    id: 1,
                    is_active: 1,
                    title: currentTitle,
                    summary: '',
                    content: '',
                    encouragement: '',
                    image_url: '',
                    audio_url: '',
                    button_label: 'Shop Now',
                    button_link: '/shop',
                    coupon_code: null,
                    starts_at: null,
                    ends_at: null,
                    metadata_json: '{}',
                    updated_at: '2026-03-11T00:00:00.000Z'
                }]];
            }
            return [[]];
        }
    }, async () => {
        const LoyaltyPopupConfigModel = requireFresh('../models/LoyaltyPopupConfig');
        const popupA = await LoyaltyPopupConfigModel.getClientActivePopup();
        currentTitle = 'Updated Offer';
        const popupB = await LoyaltyPopupConfigModel.getClientActivePopup();
        assert.notEqual(popupA.key, popupB.key);
    });
});
