const DEFAULT_ATTEMPTS = 3;
const DEFAULT_DELAY_MS = 700;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isRetryableStatus = (status) => status === 429 || status >= 500;

export const fetchWithRetry = async (input, init = {}, options = {}) => {
  const {
    attempts = DEFAULT_ATTEMPTS,
    delayMs = DEFAULT_DELAY_MS
  } = options || {};

  const method = String(init?.method || 'GET').toUpperCase();
  const canRetry = method === 'GET' || method === 'HEAD';
  const maxAttempts = Math.max(1, Number(attempts) || DEFAULT_ATTEMPTS);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(input, init);
      if (!canRetry || !isRetryableStatus(response.status) || attempt === maxAttempts) {
        return response;
      }
    } catch (error) {
      if (!canRetry || attempt === maxAttempts) {
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
