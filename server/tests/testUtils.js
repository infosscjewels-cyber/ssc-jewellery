const path = require('path');
const { pathToFileURL } = require('url');

const createMockRes = () => {
    const res = {
        statusCode: 200,
        body: undefined,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(payload) {
            this.body = payload;
            return this;
        }
    };
    return res;
};

const importClientModule = async (relativePathFromRepoRoot) => {
    const absolutePath = path.resolve(__dirname, '..', '..', relativePathFromRepoRoot);
    return import(pathToFileURL(absolutePath).href);
};

const withPatched = async (target, patches, fn) => {
    const originals = new Map();
    Object.entries(patches).forEach(([key, value]) => {
        originals.set(key, target[key]);
        target[key] = value;
    });
    try {
        return await fn();
    } finally {
        originals.forEach((value, key) => {
            target[key] = value;
        });
    }
};

const requireFresh = (relativePathFromTestsDir, patchers = []) => {
    const absolutePath = require.resolve(relativePathFromTestsDir, { paths: [__dirname] });
    delete require.cache[absolutePath];
    patchers.forEach((patch) => patch());
    delete require.cache[absolutePath];
    return require(absolutePath);
};

module.exports = {
    createMockRes,
    importClientModule,
    withPatched,
    requireFresh
};
