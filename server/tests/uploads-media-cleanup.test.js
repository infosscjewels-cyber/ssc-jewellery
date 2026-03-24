const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { createMockRes, requireFresh, withPatched } = require('./testUtils');

const CompanyProfile = require('../models/CompanyProfile');
const LoyaltyPopupConfig = require('../models/LoyaltyPopupConfig');

test('updateCompanyInfo removes replaced uploaded contact jumbotron asset', async () => {
    const adminController = requireFresh('../controllers/adminController');
    const req = {
        body: {
            displayName: 'SSC Jewellery',
            supportEmail: 'support@example.com',
            contactNumber: '9876543210',
            whatsappNumber: '9876543210',
            gstNumber: '',
            instagramUrl: '',
            youtubeUrl: '',
            facebookUrl: '',
            contactJumbotronImageUrl: '/uploads/contact/new-banner.jpg',
            razorpayKeyId: 'rzp_test_abc12345',
            razorpayEmiMinAmount: 3000,
            razorpayStartingTenureMonths: 12
        },
        app: { get: () => null }
    };
    const res = createMockRes();
    let removedPath = null;

    await withPatched(CompanyProfile, {
        get: async () => ({
            contactJumbotronImageUrl: '/uploads/contact/old-banner.jpg'
        }),
        update: async () => ({
            contactJumbotronImageUrl: '/uploads/contact/new-banner.jpg'
        })
    }, async () => withPatched(fs.promises, {
        unlink: async (filePath) => {
            removedPath = filePath;
        }
    }, async () => {
        await adminController.updateCompanyInfo(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.match(String(removedPath || ''), /uploads\/contact\/old-banner\.jpg$/);
});

test('updateLoyaltyPopupConfig removes replaced uploaded popup media assets', async () => {
    const adminController = requireFresh('../controllers/adminController');
    const req = {
        body: {
            isActive: true,
            title: 'Popup',
            imageUrl: '/uploads/popup/new-image.jpg',
            audioUrl: '/uploads/popup/new-audio.mp3'
        },
        app: { get: () => null }
    };
    const res = createMockRes();
    const removedPaths = [];

    await withPatched(LoyaltyPopupConfig, {
        getAdminConfig: async () => ({
            imageUrl: '/uploads/popup/old-image.jpg',
            audioUrl: '/uploads/popup/old-audio.mp3'
        }),
        updateAdminConfig: async () => ({
            imageUrl: '/uploads/popup/new-image.jpg',
            audioUrl: '/uploads/popup/new-audio.mp3'
        })
    }, async () => withPatched(fs.promises, {
        unlink: async (filePath) => {
            removedPaths.push(filePath);
        }
    }, async () => {
        await adminController.updateLoyaltyPopupConfig(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.equal(removedPaths.length, 2);
    assert.ok(removedPaths.some((entry) => /uploads\/popup\/old-image\.jpg$/.test(String(entry))));
    assert.ok(removedPaths.some((entry) => /uploads\/popup\/old-audio\.mp3$/.test(String(entry))));
});
