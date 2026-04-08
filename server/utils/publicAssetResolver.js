const fs = require('fs');
const path = require('path');
const { resolveUploadedAssetPath } = require('./uploadsRoot');

const PUBLIC_ROOT = path.resolve(__dirname, '../../client/public');

const resolvePublicAssetPath = (assetUrl = '') => {
    const raw = String(assetUrl || '').trim();
    const clean = raw.split('?')[0].split('#')[0];
    if (!clean.startsWith('/')) return null;

    const uploadedPath = resolveUploadedAssetPath(clean);
    if (uploadedPath && fs.existsSync(uploadedPath)) {
        return uploadedPath;
    }
    // Support legacy/sanitized DB paths that may miss file extension.
    if (uploadedPath && !path.extname(uploadedPath)) {
        try {
            const dir = path.dirname(uploadedPath);
            const base = path.basename(uploadedPath);
            if (fs.existsSync(dir)) {
                const match = fs.readdirSync(dir).find((name) => (
                    String(name || '').startsWith(`${base}.`)
                ));
                if (match) {
                    const resolved = path.join(dir, match);
                    if (resolved.startsWith(dir) && fs.existsSync(resolved)) return resolved;
                }
            }
        } catch {
            // fall through to public root resolution
        }
    }

    const relativePath = clean.replace(/^\/+/, '');
    const absolutePath = path.resolve(PUBLIC_ROOT, relativePath);
    if (!absolutePath.startsWith(PUBLIC_ROOT)) return null;
    if (!fs.existsSync(absolutePath)) return null;
    return absolutePath;
};

module.exports = {
    PUBLIC_ROOT,
    resolvePublicAssetPath
};
