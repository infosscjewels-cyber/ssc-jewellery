const test = require('node:test');
const assert = require('node:assert/strict');

const { createMockRes, requireFresh, withPatched } = require('./testUtils');

const installMockDb = () => {
    const dbPath = require.resolve('../config/db', { paths: [__dirname] });
    delete require.cache[dbPath];
    require.cache[dbPath] = {
        id: dbPath,
        filename: dbPath,
        loaded: true,
        exports: {
            execute: async () => [[]],
            query: async () => [[]],
            getConnection: async () => ({
                beginTransaction: async () => {},
                commit: async () => {},
                rollback: async () => {},
                release: () => {},
                execute: async () => [[]],
                query: async () => [[]]
            }),
            escape: (value) => `'${String(value).replace(/'/g, "\\'")}'`
        }
    };
};

const loadProductControllerWithFlag = (enabled) => {
    installMockDb();
    const featureFlagsPath = require.resolve('../utils/featureFlags', { paths: [__dirname] });
    delete require.cache[featureFlagsPath];
    require.cache[featureFlagsPath] = {
        id: featureFlagsPath,
        filename: featureFlagsPath,
        loaded: true,
        exports: {
            isSubCategoriesEnabled: () => enabled
        }
    };
    return requireFresh('../controllers/productController');
};

const sampleProduct = () => ({
    id: 'prod_flag_1',
    title: 'Chain',
    status: 'active',
    mrp: 1000,
    discount_price: 900,
    track_quantity: 1,
    quantity: 12,
    track_low_stock: 1,
    low_stock_threshold: 3,
    media: [{ type: 'image', url: '/img.jpg' }],
    categories: ['Chain'],
    usageAudience: 'men',
    subCategory: '18gm Chains',
    variants: [
        {
            id: 'var_1',
            variant_title: '16 inch',
            price: 1000,
            discount_price: 900,
            quantity: 12,
            track_quantity: 1,
            track_low_stock: 1,
            low_stock_threshold: 3,
            image_url: '/img.jpg'
        }
    ]
});

test('product list preserves usageAudience filtering even when subcategories are disabled', async () => {
    const productController = loadProductControllerWithFlag(false);
    const Product = require('../models/Product');
    const req = {
        query: {
            page: '1',
            limit: '20',
            category: 'Chain',
            usageAudience: 'men',
            subCategory: '18gm Chains'
        }
    };
    const res = createMockRes();
    let capturedArgs = null;

    await withPatched(Product, {
        getPaginated: async (...args) => {
            capturedArgs = args;
            return { products: [], total: 0, totalPages: 0, availableSubCategories: [] };
        }
    }, async () => {
        await productController.getProducts(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(capturedArgs[6], 'men');
    assert.equal(capturedArgs[8], '');
});

test('product list forwards usageAudience and subCategory independently when subcategories are enabled', async () => {
    const productController = loadProductControllerWithFlag(true);
    const Product = require('../models/Product');
    const CompanyProfile = require('../models/CompanyProfile');
    const req = {
        query: {
            page: '1',
            limit: '20',
            category: 'Chain',
            usageAudience: 'women',
            subCategory: '24gm Chains'
        }
    };
    const res = createMockRes();
    let capturedArgs = null;

    await withPatched(CompanyProfile, {
        get: async () => ({ subCategoriesEnabled: true })
    }, async () => {
        await withPatched(Product, {
            getPaginated: async (...args) => {
                capturedArgs = args;
                return { products: [], total: 0, totalPages: 0, availableSubCategories: ['24gm Chains'] };
            }
        }, async () => {
            await productController.getProducts(req, res);
        });
    });

    assert.equal(res.statusCode, 200);
    assert.equal(capturedArgs[6], 'women');
    assert.equal(capturedArgs[8], '24gm Chains');
});

test('search preserves usageAudience when subcategories are disabled and only gates subCategory', async () => {
    const productController = loadProductControllerWithFlag(false);
    const Product = require('../models/Product');
    const req = {
        query: {
            q: 'chain',
            category: 'Chain',
            usageAudience: 'kids',
            subCategory: '18gm Chains'
        }
    };
    const res = createMockRes();
    let capturedInput = null;

    await withPatched(Product, {
        searchPaginated: async (input) => {
            capturedInput = input;
            return { products: [], total: 0, totalPages: 0, page: 1, limit: 40 };
        }
    }, async () => {
        await productController.searchProducts(req, res);
    });

    assert.equal(res.statusCode, 200);
    assert.equal(capturedInput.usageAudience, 'kids');
    assert.equal(capturedInput.subCategory, '');
});

test('public serialization keeps variant behavior independent from usageAudience and subCategory', () => {
    const productController = loadProductControllerWithFlag(true);
    const emitted = [];
    const io = {
        except() {
            return {
                emit(_event, payload) {
                    emitted.push(payload);
                }
            };
        },
        to() {
            return {
                emit() {}
            };
        }
    };

    productController.__test.emitProductEvent({ app: { get: () => io } }, 'product:update', sampleProduct());

    assert.equal(emitted.length, 1);
    assert.equal(emitted[0].usageAudience, 'men');
    assert.equal(emitted[0].subCategory, '18gm Chains');
    assert.equal(emitted[0].variants[0].available_quantity, 12);
    assert.equal(emitted[0].variants[0].quantity, 1);
});

test('category-managed subcategory suggestions are merged and normalized by selected category names', async () => {
    installMockDb();
    const Product = require('../models/Product');
    const capturedQueries = [];
    const mockConnection = {
        async execute(query, params) {
            capturedQueries.push({ query, params });
            return [[
                { subcategories_json: JSON.stringify([' 24gm Chains ', '18gm Chains']) },
                { subcategories_json: JSON.stringify(['Kids Chains', '18gm Chains']) }
            ]];
        }
    };

    const result = await Product.getSubCategorySuggestionsByCategoryNames(['Chain', 'Kids Chain'], { connection: mockConnection });

    assert.deepEqual(result, ['18gm Chains', '24gm Chains', 'Kids Chains']);
    assert.equal(capturedQueries.length, 1);
    assert.deepEqual(capturedQueries[0].params, ['Chain', 'Kids Chain']);
});

test('create product rejects unmanaged subcategories when feature flag is enabled', async () => {
    const productController = loadProductControllerWithFlag(true);
    const Product = require('../models/Product');
    const CompanyProfile = require('../models/CompanyProfile');
    const req = {
        body: {
            title: 'Managed Chain',
            mrp: '1000',
            categories: JSON.stringify(['Chain']),
            usageAudience: 'men',
            subCategory: 'Free Text'
        },
        files: [],
        app: { get: () => null }
    };
    const res = createMockRes();

    await withPatched(CompanyProfile, {
        get: async () => ({ usageAudienceEnabled: true, subCategoriesEnabled: true })
    }, async () => {
        await withPatched(Product, {
            getSubCategorySuggestionsByCategoryNames: async () => ['18gm Chains'],
            create: async () => {
                throw new Error('should not create');
            }
        }, async () => {
            await productController.createProduct(req, res);
        });
    });

    assert.equal(res.statusCode, 400);
    assert.equal(res.body.message, 'Selected sub category is not managed under the chosen categories');
});
