const PINCODE_LOOKUP_BASE_URL = 'https://api.postalpincode.in/pincode';

const pincodeStateCache = new Map();

export const normalizeStateKey = (value = '') => String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const normalizePincodeInput = (value = '') => String(value || '')
    .replace(/\D/g, '')
    .slice(0, 6);

export const isValidIndianPincode = (value = '') => /^\d{6}$/.test(normalizePincodeInput(value));

export const getAllowedShippingStates = (zones = []) => {
    const unique = new Map();
    (Array.isArray(zones) ? zones : []).forEach((zone) => {
        (Array.isArray(zone?.states) ? zone.states : []).forEach((state) => {
            const label = String(state || '').trim();
            const key = normalizeStateKey(label);
            if (!label || !key || unique.has(key)) return;
            unique.set(key, label);
        });
    });
    return Array.from(unique.values()).sort((a, b) => a.localeCompare(b));
};

export const resolveAllowedStateName = (allowedStates = [], value = '') => {
    const target = normalizeStateKey(value);
    if (!target) return '';
    return (Array.isArray(allowedStates) ? allowedStates : []).find((state) => normalizeStateKey(state) === target) || '';
};

export const isAllowedShippingState = (allowedStates = [], value = '') => {
    if (!(Array.isArray(allowedStates) && allowedStates.length)) return true;
    return Boolean(resolveAllowedStateName(allowedStates, value));
};

export const lookupStateByPincode = async (pincode, allowedStates = [], { signal } = {}) => {
    const normalizedPin = normalizePincodeInput(pincode);
    if (!isValidIndianPincode(normalizedPin)) return '';

    const cached = pincodeStateCache.get(normalizedPin);
    if (cached !== undefined) {
        return resolveAllowedStateName(allowedStates, cached);
    }

    const res = await fetch(`${PINCODE_LOOKUP_BASE_URL}/${normalizedPin}`, { signal });
    if (!res.ok) return '';

    const data = await res.json().catch(() => []);
    const first = Array.isArray(data) ? data[0] : null;
    const postOffice = Array.isArray(first?.PostOffice) ? first.PostOffice[0] : null;
    const state = String(postOffice?.State || '').trim();
    pincodeStateCache.set(normalizedPin, state);
    return resolveAllowedStateName(allowedStates, state);
};
