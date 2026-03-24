const CompanyProfile = require('../models/CompanyProfile');

let RazorpayLib = null;
let cachedConfig = null;
let cachedAt = 0;
const CACHE_TTL_MS = 30 * 1000;

const getRazorpayConfig = async ({ force = false } = {}) => {
    const now = Date.now();
    if (!force && cachedConfig && (now - cachedAt) < CACHE_TTL_MS) {
        return cachedConfig;
    }
    const config = await CompanyProfile.getRazorpayConfig();
    cachedConfig = config;
    cachedAt = now;
    return config;
};

const createRazorpayClient = async () => {
    const config = await getRazorpayConfig();
    const keyId = String(config?.keyId || '').trim();
    const keySecret = String(config?.keySecret || '').trim();

    if (!keyId || !keySecret) {
        throw new Error('Razorpay API keys are missing in settings');
    }

    if (!RazorpayLib) {
        // eslint-disable-next-line global-require
        RazorpayLib = require('razorpay');
    }

    return new RazorpayLib({
        key_id: keyId,
        key_secret: keySecret
    });
};

module.exports = {
    createRazorpayClient,
    getRazorpayConfig
};
