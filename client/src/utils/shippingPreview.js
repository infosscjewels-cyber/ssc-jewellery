const normalizeStateKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const computeShippingPreview = ({ zones = [], state = '', subtotal = 0, totalWeightKg = 0 } = {}) => {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  const normalizedState = normalizeStateKey(state);
  if (!normalizedState) return null;

  const zone = zones.find((entry) => Array.isArray(entry?.states)
    && entry.states.some((candidate) => normalizeStateKey(candidate) === normalizedState));
  if (!zone || !Array.isArray(zone.options)) {
    return {
      matchedZone: false,
      hasEligibleOption: false,
      isUnavailable: true,
      fee: 0,
      freeThreshold: null
    };
  }

  const eligible = zone.options.filter((option) => {
    const min = toNullableNumber(option?.min);
    const max = toNullableNumber(option?.max);
    if (option?.conditionType === 'weight') {
      if (min !== null && totalWeightKg < min) return false;
      if (max !== null && totalWeightKg > max) return false;
      return true;
    }
    if (option?.conditionType === 'price' || !option?.conditionType) {
      if (min !== null && subtotal < min) return false;
      if (max !== null && subtotal > max) return false;
      return true;
    }
    return false;
  });

  const hasEligibleOption = eligible.length > 0;
  const fee = hasEligibleOption
    ? Number([...eligible].sort((a, b) => Number(a.rate || 0) - Number(b.rate || 0))[0]?.rate || 0)
    : 0;
  const freeOptions = zone.options.filter((option) => (option?.conditionType === 'price' || !option?.conditionType)
    && Number(option?.rate || 0) === 0
    && toNullableNumber(option?.min) !== null);
  const freeThreshold = freeOptions.length
    ? Math.min(...freeOptions.map((option) => Number(option.min)))
    : null;

  return {
    matchedZone: true,
    hasEligibleOption,
    isUnavailable: !hasEligibleOption,
    fee,
    freeThreshold
  };
};

export { normalizeStateKey };
