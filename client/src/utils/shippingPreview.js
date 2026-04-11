const normalizeStateKey = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const isPriceRule = (option) => option?.conditionType === 'price' || !option?.conditionType;
const isRuleType = (option, type) => {
  if (type === 'price') return isPriceRule(option);
  return option?.conditionType === type;
};

const getLowestRate = (options = []) => Number(
  [...options].sort((a, b) => Number(a.rate || 0) - Number(b.rate || 0))[0]?.rate || 0
);

const getPaidRateTouchingFreeThreshold = (options = [], freeThreshold = null, type = 'price') => {
  if (freeThreshold === null) return 0;
  const threshold = Number(freeThreshold);
  if (!Number.isFinite(threshold)) return 0;
  const touchingPaidOptions = options.filter((option) => {
    if (!isRuleType(option, type)) return false;
    if (Number(option?.rate || 0) <= 0) return false;
    const max = toNullableNumber(option?.max);
    return max !== null && Math.abs(Number(max) - threshold) < 0.0001;
  });
  return getLowestRate(touchingPaidOptions);
};

const getFreeThresholdForType = (options = [], type = 'price') => {
  const freeOptions = options.filter((option) => isRuleType(option, type)
    && Number(option?.rate || 0) === 0
    && toNullableNumber(option?.min) !== null);
  return freeOptions.length
    ? Math.min(...freeOptions.map((option) => Number(option.min)))
    : null;
};

export const computeShippingPreview = ({
  zones = [],
  state = '',
  subtotal = 0,
  totalWeightKg = 0,
  useDefaultZone = false
} = {}) => {
  if (!Array.isArray(zones) || zones.length === 0) return null;
  const normalizedState = normalizeStateKey(state);

  const matchedZone = normalizedState
    ? zones.find((entry) => Array.isArray(entry?.states)
      && entry.states.some((candidate) => normalizeStateKey(candidate) === normalizedState))
    : null;
  const zone = matchedZone || (useDefaultZone ? zones[0] : null);
  if (!zone || !Array.isArray(zone.options)) {
    return {
      matchedZone: false,
      matchedByState: false,
      usedDefaultZone: false,
      isTentative: false,
      hasEligibleOption: false,
      isUnavailable: true,
      fee: 0,
      freeThreshold: null,
      freeShippingSavings: 0
    };
  }

  const eligible = zone.options.filter((option) => {
    const min = toNullableNumber(option?.min);
    const max = toNullableNumber(option?.max);
    if (option?.conditionType === 'weight') {
      if (min !== null && totalWeightKg < min) return false;
      if (max !== null && totalWeightKg >= max) return false;
      return true;
    }
    if (option?.conditionType === 'price' || !option?.conditionType) {
      if (min !== null && subtotal < min) return false;
      if (max !== null && subtotal >= max) return false;
      return true;
    }
    return false;
  });

  const hasEligibleOption = eligible.length > 0;
  const fee = hasEligibleOption
    ? getLowestRate(eligible)
    : 0;
  const freeThreshold = getFreeThresholdForType(zone.options, 'price');
  const freeWeightThreshold = getFreeThresholdForType(zone.options, 'weight');
  const preFreePaidRate = freeThreshold !== null
    ? getPaidRateTouchingFreeThreshold(zone.options, freeThreshold, 'price')
    : 0;
  const preFreeWeightPaidRate = freeWeightThreshold !== null
    ? getPaidRateTouchingFreeThreshold(zone.options, freeWeightThreshold, 'weight')
    : 0;
  const freeShippingSavingsCandidates = [
    fee === 0 && freeThreshold !== null && subtotal >= freeThreshold ? preFreePaidRate : 0,
    fee === 0 && freeWeightThreshold !== null && totalWeightKg >= freeWeightThreshold ? preFreeWeightPaidRate : 0
  ].filter((value) => Number(value || 0) > 0);
  const freeShippingSavings = freeShippingSavingsCandidates.length
    ? Math.min(...freeShippingSavingsCandidates)
    : 0;

  return {
    matchedZone: Boolean(zone),
    matchedByState: Boolean(matchedZone),
    usedDefaultZone: Boolean(zone && !matchedZone),
    isTentative: Boolean(zone && !matchedZone),
    hasEligibleOption,
    isUnavailable: !hasEligibleOption,
    fee,
    freeThreshold,
    freeWeightThreshold,
    freeShippingSavings
  };
};

export { normalizeStateKey };
