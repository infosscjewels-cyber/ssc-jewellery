const fs = require('fs');
const path = require('path');
const { resolveUploadedAssetPath } = require('./uploadsRoot');

const PUBLIC_ROOT = path.resolve(__dirname, '../../client/public');

const resolvePublicAssetPath = (assetUrl = '') => {
    const raw = String(assetUrl || '').trim();
    if (!raw.startsWith('/')) return null;

    const uploadedPath = resolveUploadedAssetPath(raw);
    if (uploadedPath && fs.existsSync(uploadedPath)) {
        return uploadedPath;
    }

    const relativePath = raw.replace(/^\/+/, '');
    const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
    if (!absolutePath.startsWith(PUBLIC_ROOT)) return null;
    if (!fs.existsSync(absolutePath)) return null;
    return absolutePath;
};

module.exports = {
    PUBLIC_ROOT,
    resolvePublicAssetPath
};
