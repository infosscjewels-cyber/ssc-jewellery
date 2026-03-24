import { dispatchSessionExpired, getAuthHeaders, shouldTreatAsExpiredSession } from '../utils/authSession';
import { fetchWithRetry } from '../utils/fetchRetry';

const API_URL = import.meta.env.PROD
  ? '/api'
  : 'http://localhost:5000/api';

const getAuthHeader = () => getAuthHeaders({ includeJsonContentType: true });
const getWithRetry = (url, options = {}) => fetchWithRetry(url, options);

const handleResponse = async (res) => {
  const parseJsonSafely = async () => {
    const raw = await res.text().catch(() => '');
    if (!raw) return {};
    try { return JSON.parse(raw); } catch { return {}; }
  };
  if (!res.ok) {
    const data = await parseJsonSafely();
    if (shouldTreatAsExpiredSession(res.status, data?.message || res.statusText)) {
      dispatchSessionExpired(data?.message || 'Session expired. Please login again.');
    }
    throw new Error(data.message || 'Request failed');
  }
  return parseJsonSafely();
};

export const shippingService = {
  getZones: async () => {
    const res = await getWithRetry(`${API_URL}/shipping/zones`);
    return handleResponse(res);
  },
  getAdminZones: async () => {
    const res = await getWithRetry(`${API_URL}/admin/shipping/zones`, { headers: getAuthHeader() });
    return handleResponse(res);
  },
  createZone: async (payload) => {
    const res = await fetch(`${API_URL}/admin/shipping/zones`, {
      method: 'POST',
      headers: getAuthHeader(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },
  updateZone: async (id, payload) => {
    const res = await fetch(`${API_URL}/admin/shipping/zones/${id}`, {
      method: 'PUT',
      headers: getAuthHeader(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },
  deleteZone: async (id) => {
    const res = await fetch(`${API_URL}/admin/shipping/zones/${id}`, {
      method: 'DELETE',
      headers: getAuthHeader()
    });
    return handleResponse(res);
  }
};
