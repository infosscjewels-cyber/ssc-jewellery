const Shipping = require('../models/Shipping');

const buildValidationError = (message) => {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
};

const normalizeStateKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const normalizePincodeInput = (value = '') => String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);

const isValidIndianPincode = (value = '') => /^\d{6}$/.test(normalizePincodeInput(value));

const getAllowedShippingStates = async () => {
    const zones = await Shipping.getAll();
    const unique = new Map();
    (Array.isArray(zones) ? zones : []).forEach((zone) => {
        (Array.isArray(zone?.states) ? zone.states : []).forEach((state) => {
            const label = String(state || '').trim();
            const key = normalizeStateKey(label);
            if (!label || !key || unique.has(key)) return;
            unique.set(key, label);
        });
    });
    return Array.from(unique.values());
};

const resolveAllowedStateName = (allowedStates = [], value = '') => {
    const target = normalizeStateKey(value);
    if (!target) return '';
    return (Array.isArray(allowedStates) ? allowedStates : []).find((state) => normalizeStateKey(state) === target) || '';
};

const normalizeAndValidateAddress = async (value = null, { fieldLabel = 'Address' } = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw buildValidationError(`${fieldLabel} must be an object`);
    }
    const line1 = String(value.line1 || '').trim();
    const city = String(value.city || '').trim();
    const zip = normalizePincodeInput(value.zip || '');
    const rawState = String(value.state || '').trim();
    if (!line1 || !city || !rawState || !zip) {
        throw buildValidationError(`${fieldLabel} fields are required`);
    }
    if (!isValidIndianPincode(zip)) {
        throw buildValidationError(`${fieldLabel} PIN code is invalid`);
    }

    const allowedStates = await getAllowedShippingStates();
    const state = allowedStates.length
        ? resolveAllowedStateName(allowedStates, rawState)
        : rawState;
    if (!state) {
        throw buildValidationError(`${fieldLabel} state is invalid`);
    }

    return { line1, city, state, zip };
};

module.exports = {
    normalizeStateKey,
    normalizePincodeInput,
    isValidIndianPincode,
    getAllowedShippingStates,
    resolveAllowedStateName,
    normalizeAndValidateAddress
};
