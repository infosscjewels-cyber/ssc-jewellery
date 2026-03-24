const test = require('node:test');
const assert = require('node:assert/strict');
const jwt = require('jsonwebtoken');

const { createMockRes, importClientModule, withPatched } = require('./testUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../models/User');
const { protect, authorize } = require('../middleware/authMiddleware');

test('customer cannot access admin APIs through role authorization', () => {
    const req = { user: { role: 'customer' } };
    const res = createMockRes();
    let nextCalled = false;

    authorize('admin', 'staff')(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /not authorized/i);
});

test('staff can access allowed admin APIs through role authorization', () => {
    const req = { user: { role: 'staff' } };
    const res = createMockRes();
    let nextCalled = false;

    authorize('admin', 'staff')(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, true);
    assert.equal(res.body, undefined);
});

test('invalid JWT is rejected by protect middleware', async () => {
    const req = { headers: { authorization: 'Bearer definitely-not-a-token' } };
    const res = createMockRes();
    let nextCalled = false;

    await protect(req, res, () => {
        nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(res.statusCode, 401);
    assert.match(res.body.message, /invalid token/i);
});

test('expired JWT is rejected by protect middleware', async () => {
    const expiredToken = jwt.sign({ id: 'user-1' }, process.env.JWT_SECRET, { expiresIn: -1 });
    const req = { headers: { authorization: `Bearer ${expiredToken}` } };
    const res = createMockRes();

    await withPatched(User, {
        findById: async () => ({ id: 'user-1', role: 'customer' })
    }, async () => {
        await protect(req, res, () => {});
    });

    assert.equal(res.statusCode, 401);
    assert.match(res.body.message, /session expired/i);
});

test('admin redirect policy routes admins to admin dashboard', async () => {
    const policy = await importClientModule('client/src/utils/authRoutePolicy.js');

    assert.equal(policy.shouldRedirectAdminToDashboard({ role: 'admin' }), true);
    assert.equal(policy.shouldRedirectAdminToDashboard({ role: 'staff' }), false);
    assert.equal(policy.canAccessAdminDashboard({ role: 'staff' }), true);
    assert.equal(policy.canAccessAdminDashboard({ role: 'customer' }), false);
});
