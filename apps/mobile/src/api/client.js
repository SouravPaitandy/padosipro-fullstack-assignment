import { useSessionStore } from '../store/session';

const BASE_URL = process.env.EXPO_PUBLIC_API_URL || 'http://10.0.2.2:3000/api/v1';

export class ApiError extends Error {
  constructor(message, code, fields, statusCode) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.fields = fields;
    this.statusCode = statusCode;
  }
}

/**
 * Core fetch wrapper that adds auth headers and maps standard error envelopes.
 */
export async function apiClient(endpoint, { body, method = 'GET', headers = {}, requireAuth = true } = {}) {
  const url = `${BASE_URL.replace(/\/api\/v1$/, '')}/api/v1${endpoint}`;
  const token = useSessionStore.getState().token;

  const defaultHeaders = {
    'Accept': 'application/json',
    ...(body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
  };

  const config = {
    method,
    headers: { ...defaultHeaders, ...headers },
    body: body ? JSON.stringify(body) : null,
  };

  let response;
  try {
    response = await fetch(url, config);
  } catch (err) {
    // Retryable network failure (no connection, CORS error, etc.)
    throw new ApiError('Network request failed. Please check your connection.', 'NETWORK_ERROR');
  }

  // Intercept 401 Unauthorized only for protected routes
  if (response.status === 401 && requireAuth) {
    const { logOut } = useSessionStore.getState();
    await logOut();
    throw new ApiError('Your session has expired. Please log in again.', 'UNAUTHORIZED', null, 401);
  }

  let data;
  try {
    data = await response.json();
  } catch (err) {
    // If the server returns a non-JSON response (e.g. 500 HTML page)
    throw new ApiError('Received an invalid response from the server.', 'INTERNAL_ERROR', null, response.status);
  }

  if (!response.ok) {
    const errorPayload = data.error || {};
    throw new ApiError(
      errorPayload.message || 'An unexpected error occurred.',
      errorPayload.code || 'UNKNOWN_ERROR',
      errorPayload.fields || null,
      response.status
    );
  }

  return data.data || data; // Unwraps { data: {...} } envelope
}

export const authApi = {
  register: (email, password) => apiClient('/auth/register', { method: 'POST', body: { email, password }, requireAuth: false }),
  verifyOtp: (email, code) => apiClient('/auth/verify-otp', { method: 'POST', body: { email, code }, requireAuth: false }),
  resendOtp: (email) => apiClient('/auth/resend-otp', { method: 'POST', body: { email }, requireAuth: false }),
  login: (email, password) => apiClient('/auth/login', { method: 'POST', body: { email, password }, requireAuth: false }),
  getMe: () => apiClient('/auth/me', { requireAuth: true }),
  logout: () => apiClient('/auth/logout', { method: 'POST', requireAuth: true }),
};

export const profileApi = {
  getProfile: () => apiClient('/profile', { requireAuth: true }),
  updateProfile: (profileData) => apiClient('/profile', { method: 'PUT', body: profileData, requireAuth: true }),
};

export const tasksApi = {
  getTasks: (search) => apiClient(search ? `/tasks?search=${encodeURIComponent(search)}` : '/tasks', { requireAuth: true }),
  getMyTasks: () => apiClient('/me/tasks', { requireAuth: true }),
  updateMyTasks: (taskIds) => apiClient('/me/tasks', { method: 'PUT', body: { taskIds }, requireAuth: true }),
};
