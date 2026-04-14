const test = require('node:test');
const assert = require('node:assert/strict');

const { withPatched } = require('./testUtils');

const db = require('../config/db');
const Order = require('../models/Order');
const loyaltyService = require('../services/loyaltyService');
const CompanyProfile = require('../models/CompanyProfile');
const TaxConfig = require('../models/TaxConfig');

test('getAdminManualQuote computes shipping for guest preview when only state is provided', async () => {
    await withPatched(loyaltyService, {
        getUserLoyaltyStatus: async () => ({ eligibility: { isEligible: false }, tier: 'regular' })
    }, async () => withPatched(CompanyProfile, {
        get: async () => ({ taxEnabled: false })
    }, async () => withPatched(TaxConfig, {
        listActive: async () => ([])
    }, async () => {
        const originalGetConnection = db.getConnection;
        db.getConnection = async () => ({
            execute: async (query, params = []) => {
                const sql = String(query);
                if (sql.includes('FROM shipping_zones')) {
                    return [[{ id: 1, states: JSON.stringify(['Tamil Nadu']) }]];
                }
                if (sql.includes('FROM shipping_options')) {
                    return [[{ id: 10, zone_id: 1, condition_type: 'price', min_value: 0, max_value: null, rate: 95 }]];
                }
                if (sql.includes('SELECT address FROM users')) {
                    return [[]];
                }
                if (sql.includes('FROM products p')) {
                    return [[{
                        product_id: 'prod_1',
                        variant_id: '',
                        quantity: 1,
                        product_title: 'Preview Product',
                        product_status: 'active',
                        product_categories: '[]',
                        product_sub_category: '',
                        mrp: 470,
                        product_discount_price: 470,
                        product_sku: 'SKU-1',
                        product_media: '[]',
                        product_weight_kg: 0,
                        resolved_variant_id: null,
                        variant_title: '',
                        variant_price: null,
                        variant_discount_price: null,
                        variant_sku: null,
                        variant_image_url: null,
                        variant_weight_kg: null,
                        variant_options: null
                    }]];
                }
                if (sql.includes('FROM tax_config')) {
                    return [[{
                        id: 1,
                        tax_name: 'GST',
                        tax_code: 'GST',
                        rate_percent: 3,
                        is_active: 1,
                        price_mode: 'inclusive'
                    }]];
                }
                if (sql.includes('FROM coupon_user_targets') || sql.includes('FROM coupons')) {
                    return [[]];
                }
                throw new Error(`Unhandled query in test: ${sql}`);
            },
            release: () => {}
        });

        try {
            const summary = await Order.getAdminManualQuote(null, {
                shippingAddress: { state: 'Tamil Nadu' },
                items: [{ productId: 'prod_1', variantId: '', quantity: 1 }],
                allowSavedAddressFallback: true
            });

            assert.equal(Number(summary.shippingFee || 0), 95);
        } finally {
            db.getConnection = originalGetConnection;
        }
    })));
});
