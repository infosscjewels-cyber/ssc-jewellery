const test = require('node:test');
const assert = require('node:assert/strict');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../models/User');
const bcrypt = require('bcryptjs');
const adminController = require('../controllers/adminController');
const authController = require('../controllers/authController');
const { createMockRes, withPatched } = require('./testUtils');
const { protect } = require('../middleware/authMiddleware');

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

test('admin user list strips password hashes from returned users', async () => {
    const req = { query: {} };
    const res = createMockRes();

    await withPatched(User, {
        getPaginated: async () => ({
            users: [{
                id: 'u1',
                name: 'Alice',
                email: 'alice@example.com',
                mobile: '9876543210',
                password: 'hashed-secret',
                role: 'customer'
            }],
            total: 1,
            totalPages: 1
        })
    }, async () => {
        await adminController.getUsers(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.users[0].password, undefined);
});

test('createUser rejects invalid roles', async () => {
    const req = {
        user: { id: 'admin_1', role: 'admin' },
        body: {
            name: 'New User',
            email: 'new@example.com',
            mobile: '9876543210',
            password: 'secret123',
            role: 'owner'
        },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByMobile: async () => null,
        findByEmail: async () => null
    }, async () => {
        await adminController.createUser(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /invalid role/i);
});

test('createUser rejects duplicate email addresses', async () => {
    const req = {
        user: { id: 'admin_1', role: 'admin' },
        body: {
            name: 'New User',
            email: 'dup@example.com',
            mobile: '9876543210',
            password: 'secret123',
            role: 'customer'
        },
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByMobile: async () => null,
        findByEmail: async () => ({ id: 'u_existing' })
    }, async () => {
        await adminController.createUser(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /email already in use/i);
});

test('createUser emits scoped safe payload to admin and created user only', async () => {
    const io = createMockIo();
    const req = {
        user: { id: 'admin_1', role: 'admin' },
        body: {
            name: 'Scoped User',
            email: 'scoped@example.com',
            mobile: '9876543210',
            password: 'secret123',
            role: 'customer'
        },
        app: { get: () => io }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByMobile: async () => null,
        findByEmail: async () => null,
        create: async () => ({
            id: 'u_new',
            name: 'Scoped User',
            email: 'scoped@example.com',
            mobile: '9876543210',
            password: 'hashed-secret',
            role: 'customer'
        })
    }, async () => {
        await withPatched(bcrypt, {
            genSalt: async () => 'salt',
            hash: async () => 'hashed-secret'
        }, async () => {
            await adminController.createUser(req, res);
        });
    });

    assert.equal(res.statusCode, 201);
    assert.equal(res.body.user.password, undefined);
    assert.deepEqual(io.emitted.map((entry) => entry.scope), ['to:admin', 'to:user:u_new']);
    assert.equal(io.emitted.some((entry) => entry.scope === 'global'), false);
    assert.equal(io.emitted[0].payload.password, undefined);
});

test('deleteUser deactivates customers instead of removing the row', async () => {
    const req = {
        params: { id: 'cust_1' },
        user: { id: 'admin_1', role: 'admin' },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();
    let deleteCalled = false;
    let deactivateCall = null;

    await withPatched(User, {
        findById: async () => ({ id: 'cust_1', role: 'customer', isActive: true }),
        setActiveStatus: async (_id, payload) => {
            deactivateCall = payload;
            return { id: 'cust_1', role: 'customer', isActive: false, deactivationReason: payload.reason };
        },
        delete: async () => {
            deleteCalled = true;
        }
    }, async () => {
        await adminController.deleteUser(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(deleteCalled, false);
    assert.equal(Boolean(deactivateCall), true);
    assert.equal(res.body.action, 'deactivated');
    assert.equal(res.body.user.isActive, false);
});

test('setUserStatus reactivates inactive customers', async () => {
    const io = createMockIo();
    const req = {
        params: { id: 'cust_1' },
        body: { isActive: true },
        user: { id: 'admin_1', role: 'admin' },
        app: { get: () => io }
    };
    const res = createMockRes();

    await withPatched(User, {
        findById: async () => ({ id: 'cust_1', role: 'customer', isActive: false }),
        setActiveStatus: async () => ({ id: 'cust_1', role: 'customer', isActive: true })
    }, async () => {
        await adminController.setUserStatus(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.isActive, true);
    assert.deepEqual(io.emitted.map((entry) => entry.scope), ['to:admin', 'to:user:cust_1']);
});

test('updateProfile emits scoped safe payload and response omits password', async () => {
    const io = createMockIo();
    const req = {
        user: { id: 'u1' },
        body: { name: 'Updated Name' },
        app: { get: () => io }
    };
    const res = createMockRes();

    let findCall = 0;
    await withPatched(User, {
        findByMobile: async () => null,
        findByEmail: async () => null,
        findById: async () => {
            findCall += 1;
            if (findCall === 1) {
                return { id: 'u1', name: 'Old Name', email: 'user@example.com', mobile: '9876543210', role: 'customer', password: 'hashed', dobLocked: false, birthdayOfferClaimedYear: null };
            }
            return { id: 'u1', name: 'Updated Name', email: 'user@example.com', mobile: '9876543210', role: 'customer', password: 'hashed', dobLocked: false, birthdayOfferClaimedYear: null };
        },
        updateProfile: async () => {}
    }, async () => {
        await authController.updateProfile(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.user.password, undefined);
    assert.deepEqual(io.emitted.map((entry) => entry.scope), ['to:admin', 'to:user:u1']);
    assert.equal(io.emitted[0].payload.password, undefined);
});

test('inactive users are rejected by protect middleware', async () => {
    const jwt = require('jsonwebtoken');
    const token = jwt.sign({ id: 'cust_1' }, process.env.JWT_SECRET, { expiresIn: '1h' });
    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = createMockRes();

    await withPatched(User, {
        findById: async () => ({ id: 'cust_1', role: 'customer', isActive: false, password: 'hashed' })
    }, async () => {
        await protect(req, res, () => {});
    });

    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /deactivated/i);
});

test('inactive users cannot log in', async () => {
    const req = {
        body: {
            type: 'password',
            identifier: 'inactive@example.com',
            password: 'secret123'
        }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByEmail: async () => ({ id: 'cust_1', role: 'customer', isActive: false, password: 'hashed' }),
        findByMobile: async () => null
    }, async () => {
        await authController.login(req, res);
    });

    assert.equal(res.statusCode, 403);
    assert.match(res.body.message, /deactivated/i);
});
