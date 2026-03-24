const fs = require('fs');
const path = require('path');

const DEFAULT_UPLOADS_ROOT = path.resolve(__dirname, '../../client/public/uploads');
const CLIENT_PUBLIC_ROOT = path.resolve(__dirname, '../../client/public');

const normalizeConfiguredRoot = (configuredRoot = '') => {
    const raw = String(configuredRoot || '').trim();
    if (!raw) return DEFAULT_UPLOADS_ROOT;

    if (path.isAbsolute(raw)) {
        if (raw === '/public' || raw.startsWith('/public/')) {
            return path.resolve(CLIENT_PUBLIC_ROOT, `.${raw.replace(/^\/public/, '')}`);
        }
        return raw;
    }

    return path.resolve(raw);
};

const getUploadsRoot = () => {
    const configuredRoot = String(process.env.UPLOADS_ROOT || '').trim();
    return normalizeConfiguredRoot(configuredRoot);
};

const ensureUploadsSubdir = (subdir = '') => {
    const targetDir = path.join(getUploadsRoot(), String(subdir || '').trim());
    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }
    return targetDir;
};

const resolveUploadedAssetPath = (assetUrl = '') => {
    const raw = String(assetUrl || '').trim();
    if (!raw.startsWith('/uploads/')) return null;

    const uploadsRoot = getUploadsRoot();
    const absolutePath = path.join(uploadsRoot, raw.replace(/^\/uploads\/+/, ''));
    if (!absolutePath.startsWith(uploadsRoot)) return null;
    return absolutePath;
};

module.exports = {
    getUploadsRoot,
    ensureUploadsSubdir,
    resolveUploadedAssetPath,
    DEFAULT_UPLOADS_ROOT
};
