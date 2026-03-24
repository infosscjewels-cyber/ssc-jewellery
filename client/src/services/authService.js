import { dispatchSessionExpired, getAuthHeaders, getStoredToken, isTokenExpired, shouldTreatAsExpiredSession } from '../utils/authSession';

const API_URL = import.meta.env.PROD 
  ? '/api/auth' 
  : 'http://localhost:5000/api/auth';

const parseJsonSafely = async (res) => {
  try {
    return await res.json();
  } catch {
    return {};
  }
};

const handleResponse = async (res) => {
  const data = await parseJsonSafely(res);
  if (!res.ok) {
    if (shouldTreatAsExpiredSession(res.status, data?.message || res.statusText)) {
      dispatchSessionExpired(data?.message || 'Session expired. Please login again.');
    }
    throw new Error(data?.message || res.statusText || 'Request failed');
  }
  return data;
};

export const authService = {
  getAuthHeader: () => getAuthHeaders({ includeJsonContentType: true }),
  getAuthTokenHeader: () => getAuthHeaders({ includeJsonContentType: false }),
  sendOtp: async (mobile) => {
    const res = await fetch(`${API_URL}/send-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(typeof mobile === 'object' ? mobile : { mobile })
    });
    const data = await parseJsonSafely(res);
    return { ...data, ok: res.ok, status: res.status };
  },
  verifyOtp: async (mobile, otp) => {
    const res = await fetch(`${API_URL}/verify-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, otp })
    });
    return handleResponse(res);
  },

  register: async (userData) => {
    const res = await fetch(`${API_URL}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(userData)
    });
    return handleResponse(res);
  },

  login: async (payload) => {
    const res = await fetch(`${API_URL}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },
  socialLogin: async (idToken) => {
    const res = await fetch(`${API_URL}/social-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
    return handleResponse(res);
  },
  getProfile: async () => {
    const res = await fetch(`${API_URL}/profile`, {
      method: 'GET',
      headers: authService.getAuthHeader()
    });
    return handleResponse(res);
  },
  getLoyaltyStatus: async () => {
    const res = await fetch(`${API_URL}/loyalty-status`, {
      method: 'GET',
      headers: authService.getAuthHeader()
    });
    return handleResponse(res);
  },
  updateProfile: async (payload) => {
    const res = await fetch(`${API_URL}/profile`, {
      method: 'PUT',
      headers: authService.getAuthHeader(),
      body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },
  uploadProfileImage: async (file) => {
    const formData = new FormData();
    formData.append('image', file);
    const res = await fetch(`${API_URL.replace('/auth', '')}/uploads/profile-image`, {
      method: 'POST',
      headers: authService.getAuthTokenHeader(),
      body: formData
    });
    return handleResponse(res);
  },

  resetPassword: async (payload) => {
    const res = await fetch(`${API_URL}/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    return handleResponse(res);
  },
  isTokenExpired,
  getStoredToken
};
