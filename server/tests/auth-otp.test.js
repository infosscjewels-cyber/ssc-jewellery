const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRes, requireFresh, withPatched } = require('./testUtils');

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

const User = require('../models/User');
const OtpService = require('../services/otpService');

const loadAuthController = ({ comms = null } = {}) => {
    const communicationService = require('../services/communications/communicationService');
    if (comms) {
        Object.assign(communicationService, comms);
    }
    return requireFresh('../controllers/authController');
};

test('sendOtp hides debug OTP outside test mode and sends general OTP through WhatsApp', async () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const controller = loadAuthController({
        comms: {
            sendWhatsapp: async () => ({ ok: true, provider: 'mock' })
        }
    });

    const req = {
        body: {
            mobile: '9876543210'
        }
    };
    const res = createMockRes();

    try {
        await withPatched(OtpService, {
            saveOtp: async () => {}
        }, async () => {
            await controller.sendOtp(req, res);
        });

        assert.equal(res.statusCode, 200);
        assert.equal(res.body.debug_otp, undefined);
        assert.deepEqual(res.body.delivery.sent, ['whatsapp']);
        assert.deepEqual(res.body.delivery.failed, []);
    } finally {
        process.env.NODE_ENV = originalNodeEnv;
    }
});

test('sendOtp reports login channel failures truthfully and succeeds on remaining channel', async () => {
    const controller = loadAuthController({
        comms: {
            sendEmailCommunication: async () => ({ ok: false, reason: 'smtp_down' }),
            sendWhatsapp: async () => ({ ok: true, provider: 'mock' })
        }
    });

    const req = {
        body: {
            identifier: 'user@example.com',
            purpose: 'login'
        }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByEmail: async () => ({
            id: 'u1',
            name: 'User',
            email: 'user@example.com',
            mobile: '9876543210'
        })
    }, async () => withPatched(OtpService, {
        saveOtp: async () => {}
    }, async () => {
        await controller.sendOtp(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.delivery.sent, ['whatsapp']);
    assert.equal(res.body.delivery.failed.length, 1);
    assert.equal(res.body.delivery.failed[0].channel, 'email');
});

test('sendOtp returns 502 when no delivery channel actually succeeds', async () => {
    const controller = loadAuthController({
        comms: {
            sendWhatsapp: async () => ({ ok: false, reason: 'whatsapp_down' })
        }
    });

    const req = {
        body: {
            mobile: '9876543210'
        }
    };
    const res = createMockRes();

    await withPatched(OtpService, {
        saveOtp: async () => {}
    }, async () => {
        await controller.sendOtp(req, res);
    });

    assert.equal(res.statusCode, 502);
    assert.match(res.body.message, /could not be delivered/i);
    assert.deepEqual(res.body.delivery.sent, []);
    assert.equal(res.body.delivery.failed[0].channel, 'whatsapp');
});

test('password reset OTP supports email-only accounts', async () => {
    const controller = loadAuthController({
        comms: {
            sendEmailCommunication: async () => ({ ok: true, provider: 'mock-email' })
        }
    });

    const req = {
        body: {
            identifier: 'googleuser@example.com',
            purpose: 'password_reset'
        }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByEmail: async () => ({
            id: 'u-google',
            name: 'Google User',
            email: 'googleuser@example.com',
            mobile: null
        })
    }, async () => withPatched(OtpService, {
        saveOtp: async () => {}
    }, async () => {
        await controller.sendOtp(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.delivery.sent, ['email']);
    assert.deepEqual(res.body.delivery.missing, ['whatsapp']);
});

test('password reset OTP sends both email and whatsapp for mobile-registered users', async () => {
    const controller = loadAuthController({
        comms: {
            sendEmailCommunication: async () => ({ ok: true, provider: 'mock-email' }),
            sendWhatsapp: async () => ({ ok: true, provider: 'mock-whatsapp' })
        }
    });

    const req = {
        body: {
            identifier: '9876543210',
            purpose: 'password_reset'
        }
    };
    const res = createMockRes();

    await withPatched(User, {
        findByMobile: async () => ({
            id: 'u-mobile',
            name: 'Customer',
            email: 'customer@example.com',
            mobile: '9876543210'
        })
    }, async () => withPatched(OtpService, {
        saveOtp: async () => {}
    }, async () => {
        await controller.sendOtp(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.body.delivery.sent.sort(), ['email', 'whatsapp']);
});
