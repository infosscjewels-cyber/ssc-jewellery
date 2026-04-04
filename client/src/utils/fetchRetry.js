const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 700;
const DEFAULT_COOLDOWN_MS = 2 * 60 * 1000;
const FAILURE_COOLDOWN_BY_KEY = new Map();

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status) => status === 429 || status >= 500;
const resolveRequestUrl = (input) => {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  if (typeof Request !== 'undefined' && input instanceof Request) return input.url || '';
  return String(input || '');
};
const toRetryKey = (input, init = {}) => {
  const method = String(init?.method || (typeof Request !== 'undefined' && input instanceof Request ? input.method : 'GET') || 'GET').toUpperCase();
  return `${method}::${resolveRequestUrl(input)}`;
};
const createCooldownError = (cooldownUntil) => {
  const remainingMs = Math.max(0, Number(cooldownUntil || 0) - Date.now());
  const remainingSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const error = new Error(`Server unavailable. Retry paused for ${remainingSeconds}s.`);
  error.code = 'FETCH_RETRY_COOLDOWN';
  error.cooldownUntil = Number(cooldownUntil || 0);
  return error;
};

export const fetchWithRetry = async (input, init = {}, options = {}) => {
  const {
    attempts = DEFAULT_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
    bypassCooldown = false
  } = options || {};

  const method = String(init?.method || 'GET').toUpperCase();
  const canRetry = method === 'GET' || method === 'HEAD';
  const maxAttempts = Math.max(1, Number(attempts) || DEFAULT_ATTEMPTS);
  const requestKey = toRetryKey(input, init);
  const cooldownUntil = Number(FAILURE_COOLDOWN_BY_KEY.get(requestKey) || 0);
  if (canRetry && !bypassCooldown && cooldownUntil > Date.now()) {
    throw createCooldownError(cooldownUntil);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (response.ok) {
        FAILURE_COOLDOWN_BY_KEY.delete(requestKey);
      }
      if (!canRetry || !isRetryableStatus(response.status) || attempt === maxAttempts) {
        if (canRetry && isRetryableStatus(response.status) && attempt === maxAttempts) {
          FAILURE_COOLDOWN_BY_KEY.set(requestKey, Date.now() + Math.max(0, Number(cooldownMs) || DEFAULT_COOLDOWN_MS));
        }
        return response;
      }
    } catch (error) {
      if (!canRetry || attempt === maxAttempts) {
        if (canRetry) {
          const nextCooldownUntil = Date.now() + Math.max(0, Number(cooldownMs) || DEFAULT_COOLDOWN_MS);
          FAILURE_COOLDOWN_BY_KEY.set(requestKey, nextCooldownUntil);
          error.cooldownUntil = nextCooldownUntil;
        }
        throw error;
      }
    }

    await wait(delayMs * attempt);
  }

  return fetch(input, init);
};

// The app bootstrap already installs fetch retry once during startup.
// Service layers opt into retries explicitly via fetchWithRetry, so the
// bootstrap hook remains a no-op compatibility export.
export const installFetchRetry = () => {};
