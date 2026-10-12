import axios, { type InternalAxiosRequestConfig } from 'axios';
import { auth } from '../firebase/config';
import { toApiError } from './api-error';
import { clientLogger } from '../client-logger';

// Create a central Axios instance for internal Next.js API routes & external requests
export const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || '',
  headers: {
    'Content-Type': 'application/json',
  },
});

type RetryableConfig = InternalAxiosRequestConfig & { _authRetried?: boolean };

// Request Interceptor: Attach Firebase ID Token automatically
apiClient.interceptors.request.use(
  async (config) => {
    try {
      if (typeof window !== 'undefined' && auth.currentUser) {
        const token = await auth.currentUser.getIdToken();
        if (token) {
          config.headers.Authorization = `Bearer ${token}`;
        }
      }
    } catch (error) {
      // The request still goes out; the server will answer 401 and the UI shows "session expired"
      clientLogger.warn('apiClient', 'Could not attach Firebase auth token to request', toApiError(error).toLogObject());
    }

    // If sending FormData, delete Content-Type to allow browser/Axios to set multipart/form-data with boundary
    if (typeof FormData !== 'undefined' && config.data instanceof FormData) {
      delete config.headers['Content-Type'];
    }

    return config;
  }
);

/**
 * Response Interceptor — central error capture for every API call:
 *  - an expired Firebase token is refreshed once and the request retried transparently,
 *  - every failure is normalised into an ApiError (user-friendly message, code, source, request id),
 *  - and logged once to the browser console with the endpoint and server request id.
 * Callers just `catch (err)` and pass it to `notifyError(err)` or an <ErrorState />.
 */
apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const config = error?.config as RetryableConfig | undefined;

    if (
      error?.response?.status === 401 &&
      error.response.data?.code === 'AUTH_TOKEN_EXPIRED' &&
      config &&
      !config._authRetried &&
      auth.currentUser
    ) {
      config._authRetried = true;
      try {
        await auth.currentUser.getIdToken(true);
        return apiClient(config);
      } catch {
        // fall through and report the original 401
      }
    }

    const apiError = toApiError(error);
    if (!apiError.isCancelled) {
      const level = apiError.status >= 500 || apiError.status === 0 ? 'error' : 'warn';
      clientLogger[level](apiError.endpoint ?? 'apiClient', `${apiError.code} — ${apiError.message}`, apiError.toLogObject());
      apiError.logged = true;
    }
    return Promise.reject(apiError);
  }
);

export default apiClient;
