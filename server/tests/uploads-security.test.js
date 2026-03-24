const test = require('node:test');
const assert = require('node:assert/strict');

const uploadUtils = require('../utils/upload');

test('upload validation rejects unsupported popup file types', () => {
    const result = uploadUtils.__test.isAllowedUpload({
        mimetype: 'application/javascript',
        originalname: 'payload.js'
    }, {
        allowedMimeTypes: uploadUtils.DEFAULT_IMAGE_MIME_TYPES,
        allowedExtensions: ['.jpg', '.jpeg', '.png', '.webp', '.gif']
    });

    assert.equal(result.ok, false);
});

test('upload validation accepts supported audio files for popup audio', () => {
    const result = uploadUtils.__test.isAllowedUpload({
        mimetype: 'audio/mpeg',
        originalname: 'popup.mp3'
    }, {
        allowedMimeTypes: uploadUtils.DEFAULT_AUDIO_MIME_TYPES,
        allowedExtensions: ['.mp3', '.wav', '.ogg', '.webm']
    });

    assert.equal(result.ok, true);
});
