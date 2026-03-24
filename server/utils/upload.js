const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { ensureUploadsSubdir } = require('./uploadsRoot');

const DEFAULT_IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DEFAULT_AUDIO_MIME_TYPES = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/ogg', 'audio/webm'];

const normalizeList = (values = []) => (
    Array.isArray(values)
        ? values.map((value) => String(value || '').trim().toLowerCase()).filter(Boolean)
        : []
);

const hasAllowedExtension = (filename = '', allowedExtensions = []) => {
    const normalizedExtensions = normalizeList(allowedExtensions);
    if (!normalizedExtensions.length) return true;
    const ext = path.extname(String(filename || '')).trim().toLowerCase();
    return normalizedExtensions.includes(ext);
};

const isAllowedUpload = (file = {}, options = {}) => {
    const allowedMimeTypes = normalizeList(options.allowedMimeTypes);
    const mime = String(file?.mimetype || '').trim().toLowerCase();
    if (allowedMimeTypes.length && !allowedMimeTypes.includes(mime)) {
        return { ok: false, message: 'Unsupported file type' };
    }
    if (!hasAllowedExtension(file?.originalname || '', options.allowedExtensions || [])) {
        return { ok: false, message: 'Unsupported file extension' };
    }
    return { ok: true };
};

const createDiskStorage = (subdir) => {
    return multer.diskStorage({
        destination: (req, file, cb) => {
            const uploadPath = ensureUploadsSubdir(subdir);
            cb(null, uploadPath);
        },
        filename: (req, file, cb) => {
            const safeName = file.originalname.replace(/\s+/g, '-').replace(/[^\w.-]/g, '');
            cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}-${safeName}`);
        }
    });
};

const createUploader = (subdir, options = {}) => multer({
    storage: createDiskStorage(subdir),
    limits: options?.limits || {
        fileSize: Number(options?.maxFileSizeBytes || (10 * 1024 * 1024))
    },
    fileFilter: (_req, file, cb) => {
        const validation = isAllowedUpload(file, options);
        if (!validation.ok) {
            cb(new Error(validation.message));
            return;
        }
        cb(null, true);
    }
});

module.exports = {
    createUploader,
    DEFAULT_IMAGE_MIME_TYPES,
    DEFAULT_AUDIO_MIME_TYPES,
    __test: {
        isAllowedUpload
    }
};
