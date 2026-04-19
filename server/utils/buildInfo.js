const fs = require('fs');
const path = require('path');

const GENERATED_BUILD_INFO_PATH = path.resolve(__dirname, '../../client/src/generated/buildInfo.js');

const DEFAULT_BUILD_INFO = Object.freeze({
    version: 'unknown',
    label: 'Unknown build'
});

const extractStringLiteral = (source = '', constantName = '') => {
    const pattern = new RegExp(`export\\s+const\\s+${constantName}\\s*=\\s*["']([^"']+)["']`, 'i');
    const match = String(source || '').match(pattern);
    return String(match?.[1] || '').trim();
};

const readBuildInfo = () => {
    try {
        const raw = fs.readFileSync(GENERATED_BUILD_INFO_PATH, 'utf8');
        const version = extractStringLiteral(raw, 'BUILD_VERSION');
        const label = extractStringLiteral(raw, 'BUILD_LABEL');
        return {
            version: version || DEFAULT_BUILD_INFO.version,
            label: label || DEFAULT_BUILD_INFO.label
        };
    } catch {
        return { ...DEFAULT_BUILD_INFO };
    }
};

module.exports = {
    readBuildInfo
};
