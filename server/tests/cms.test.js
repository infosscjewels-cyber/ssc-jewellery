const test = require('node:test');
const assert = require('node:assert/strict');

const db = require('../config/db');
const fs = require('fs');
const cmsController = require('../controllers/cmsController');
const CompanyProfile = require('../models/CompanyProfile');
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
        except(room) {
            return {
                emit(event, payload) {
                    emitted.push({ scope: `except:${room}`, event, payload });
                }
            };
        },
        emit(event, payload) {
            emitted.push({ scope: 'global', event, payload });
        }
    };
};

test('deleteHeroText returns 404 when text does not exist', async () => {
    const req = { params: { id: '999' }, app: { get: () => createMockIo() } };
    const res = createMockRes();

    await withPatched(db, {
        execute: async (query) => {
            if (String(query).includes('SELECT id FROM hero_texts')) return [[]];
            return [[]];
        }
    }, async () => {
        await cmsController.deleteHeroText(req, res);
    });

    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /not found/i);
});

test('updateSlide returns 404 when slide does not exist', async () => {
    const req = {
        params: { id: '123' },
        body: { title: 'New', subtitle: '', link: '', status: 'active' },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();

    await withPatched(db, {
        execute: async (query) => {
            if (String(query).includes('SELECT id FROM hero_slides')) return [[]];
            return [[]];
        }
    }, async () => {
        await cmsController.updateSlide(req, res);
    });

    assert.equal(res.statusCode, 404);
    assert.match(res.body.message, /not found/i);
});

test('updateFeaturedCategory rejects invalid category ids', async () => {
    const req = {
        body: { categoryId: 999, title: 'Featured', subtitle: 'Promo' },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();

    await withPatched(db, {
        execute: async (query) => {
            if (String(query).includes('SELECT id, name FROM categories')) return [[]];
            return [[]];
        }
    }, async () => {
        await cmsController.updateFeaturedCategory(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /category not found/i);
});

test('createCarouselCard rejects missing manual image', async () => {
    const req = {
        body: {
            title: 'Promo',
            description: 'Desc',
            sourceType: 'manual',
            imageUrl: '',
            buttonLabel: 'Shop',
            linkTargetType: 'store',
            status: 'active'
        },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();

    await cmsController.createCarouselCard(req, res);

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /require an image/i);
});

test('createCarouselCard rejects missing referenced category', async () => {
    const req = {
        body: {
            title: 'Promo',
            description: 'Desc',
            sourceType: 'category',
            sourceId: '55',
            buttonLabel: 'Shop',
            linkTargetType: 'store',
            status: 'active'
        },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();

    await withPatched(db, {
        execute: async (query) => {
            if (String(query).includes('SELECT id, name FROM categories')) return [[]];
            return [[]];
        }
    }, async () => {
        await cmsController.createCarouselCard(req, res);
    });

    assert.equal(res.statusCode, 400);
    assert.match(res.body.message, /category not found/i);
});

test('submitContactForm rate limits repeated requests', async () => {
    const req = {
        body: {
            name: 'Alice',
            email: 'alice@example.com',
            phone: '9876543210',
            orderId: '',
            message: 'Need help'
        },
        ip: '127.0.0.1'
    };

    const freshCmsController = requireFresh('../controllers/cmsController', [() => {
        const communicationService = require('../services/communications/communicationService');
        communicationService.sendEmailCommunication = async () => ({ ok: true });
    }]);

    await withPatched(CompanyProfile, {
        get: async () => ({ supportEmail: 'support@example.com', displayName: 'SSC Jewellery' })
    }, async () => {
        for (let i = 0; i < 5; i += 1) {
            const res = createMockRes();
            await freshCmsController.submitContactForm(req, res);
            assert.equal(res.statusCode, 200);
        }
        const limitedRes = createMockRes();
        await freshCmsController.submitContactForm(req, limitedRes);
        assert.equal(limitedRes.statusCode, 429);
        assert.match(limitedRes.body.message, /too many contact requests/i);
    });
});

test('CMS notifications send one admin event and one public event', async () => {
    const io = createMockIo();
    const req = {
        body: {
            title: 'Promo',
            description: 'Desc',
            sourceType: 'manual',
            imageUrl: '/banner.jpg',
            buttonLabel: 'Shop',
            linkTargetType: 'store',
            status: 'active'
        },
        app: { get: () => io }
    };
    const res = createMockRes();

    await withPatched(db, {
        execute: async (query) => {
            const sql = String(query);
            if (sql.includes('INSERT INTO cms_carousel_cards')) return [{ insertId: 42 }];
            if (sql.includes('SELECT MAX(display_order)')) return [[{ maxOrder: 1 }]];
            return [[]];
        }
    }, async () => {
        await cmsController.createCarouselCard(req, res);
    });

    assert.equal(res.statusCode, 201);
    assert.deepEqual(io.emitted.map((entry) => entry.scope), ['to:admin', 'except:admin']);
    assert.deepEqual(io.emitted.map((entry) => entry.event), ['cms:carousel_cards_update', 'cms:carousel_cards_update']);
});

test('updateCarouselCard removes replaced uploaded carousel image', async () => {
    const req = {
        params: { id: '9' },
        body: {
            title: 'Promo',
            description: 'Desc',
            sourceType: 'manual',
            imageUrl: '/uploads/carousel/new-image.jpg',
            buttonLabel: 'Shop',
            linkTargetType: 'store',
            status: 'active'
        },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();
    let removedPath = null;

    await withPatched(db, {
        execute: async (query, params = []) => {
            const sql = String(query);
            if (sql.includes('SELECT * FROM cms_carousel_cards')) {
                return [[{ id: 9, image_url: '/uploads/carousel/old-image.jpg', display_order: 0 }]];
            }
            if (sql.includes('UPDATE cms_carousel_cards')) return [{ affectedRows: 1 }];
            return [[]];
        }
    }, async () => withPatched(fs.promises, {
        unlink: async (filePath) => {
            removedPath = filePath;
        }
    }, async () => {
        await cmsController.updateCarouselCard(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.match(String(removedPath || ''), /uploads\/carousel\/old-image\.jpg$/);
});

test('deleteCarouselCard removes uploaded carousel image', async () => {
    const req = {
        params: { id: '10' },
        app: { get: () => createMockIo() }
    };
    const res = createMockRes();
    let removedPath = null;

    await withPatched(db, {
        execute: async (query) => {
            const sql = String(query);
            if (sql.includes('SELECT id FROM cms_carousel_cards')) return [[{ id: 10 }]];
            if (sql.includes('SELECT image_url FROM cms_carousel_cards')) return [[{ image_url: '/uploads/carousel/deleted-image.jpg' }]];
            if (sql.includes('DELETE FROM cms_carousel_cards')) return [{ affectedRows: 1 }];
            return [[]];
        }
    }, async () => withPatched(fs.promises, {
        unlink: async (filePath) => {
            removedPath = filePath;
        }
    }, async () => {
        await cmsController.deleteCarouselCard(req, res);
    }));

    assert.equal(res.statusCode, 200);
    assert.match(String(removedPath || ''), /uploads\/carousel\/deleted-image\.jpg$/);
});
