'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import apiClient from '@/lib/api/client';
import { toApiError } from '@/lib/api/api-error';
import { clientLogger } from '@/lib/client-logger';

export interface UseWhatsAppConnectOptions {
  storeId?: string;
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
  onCancel?: (message: string) => void;
}

/**
 * Loads Facebook SDK dynamically
 */
export const getFacebookSdk = (): Promise<any> => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') return reject(new Error('Window not available'));
    if ((window as any).FB) return resolve((window as any).FB);

    (window as any).fbAsyncInit = function () {
      (window as any).FB?.init({
        appId: process.env.NEXT_PUBLIC_META_APP_ID || '1388239869739882',
        cookie: true,
        xfbml: true,
        version: process.env.NEXT_PUBLIC_META_GRAPH_VERSION || 'v25.0',
      });
      resolve((window as any).FB);
    };

    const SCRIPT_ID = 'facebook-jssdk';
    if (document.getElementById(SCRIPT_ID)) {
      const checkInterval = setInterval(() => {
        if ((window as any).FB) {
          clearInterval(checkInterval);
          resolve((window as any).FB);
        }
      }, 100);
      setTimeout(() => {
        clearInterval(checkInterval);
        if ((window as any).FB) {
          resolve((window as any).FB);
        } else {
          reject(new Error('Failed to load Meta Facebook SDK'));
        }
      }, 4000);
      return;
    }

    const script = document.createElement('script');
    script.id = SCRIPT_ID;
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => reject(new Error('Failed to load Meta Facebook SDK'));
    document.head.appendChild(script);
  });
};

export function useWhatsAppConnect({
  storeId = 'pingcart-store.myshopify.com',
  onSuccess,
  onError,
  onCancel,
}: UseWhatsAppConnectOptions = {}) {
  const [loading, setLoading] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [connections, setConnections] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [infoBanner, setInfoBanner] = useState<string | null>(null);
  const signupDataRef = useRef<{ waba_id?: string; phone_number_id?: string }>({});

  // 1. Check existing connection
  useEffect(() => {
    let isMounted = true;
    const checkExistingConnection = async () => {
      try {
        const response = await apiClient.get('/api/channels/whatsapp/connections', {
          params: { storeId },
        });
        if (isMounted && response.data?.success) {
          const list = response.data.connections || [];
          setConnections(list);
          if (response.data.hasConnection || list.length > 0) {
            setIsConnected(true);
          }
        }
      } catch {
        // Silently ignore or rely on default
      }
    };

    if (storeId) {
      checkExistingConnection();
    }
    return () => {
      isMounted = false;
    };
  }, [storeId]);

  // 2. Listen for Meta Embedded Signup message events
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (!event.data) return;

      let payload = event.data;
      if (typeof payload === 'string') {
        try {
          payload = JSON.parse(payload);
        } catch {
          return;
        }
      }

      if (payload?.type === 'WA_EMBEDDED_SIGNUP') {
        if (payload?.event === 'FINISH') {
          signupDataRef.current = {
            waba_id: payload.data?.waba_id,
            phone_number_id: payload.data?.phone_number_id,
          };
        } else if (payload?.event === 'CANCEL') {
          setLoading(false);
          const bannerMsg = 'Signup was closed before finishing. Try again.';
          setInfoBanner(bannerMsg);
          if (onCancel) onCancel(bannerMsg);
        }
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onCancel]);

  // 3. Post OAuth code to backend
  const executeBackendConnect = useCallback(
    async (code: string) => {
      const { waba_id, phone_number_id } = signupDataRef.current;
      try {
        const res = await apiClient.post('/api/channels/whatsapp/connect', {
          code,
          wabaId: waba_id,
          phoneNumberId: phone_number_id,
        });

        if (res.data?.success) {
          setIsConnected(true);
          setLoading(false);
          setInfoBanner(null);
          setError(null);
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('whatsapp-channel-connected', {
                detail: res.data.connection,
              })
            );
          }
          if (onSuccess) onSuccess(res.data.connection);
        } else {
          const errMsg = res.data?.error || 'Failed to connect WhatsApp';
          setError(errMsg);
          if (onError) onError(errMsg);
          setLoading(false);
        }
      } catch (apiErr) {
        const apiError = toApiError(apiErr);
        const msg = apiError.message || 'Failed to connect WhatsApp';
        setError(msg);
        if (onError) onError(msg);
        setLoading(false);
      }
    },
    [onSuccess, onError]
  );

  // 4. Trigger FB.login (synchronous callback required by Meta SDK)
  const handleConnect = useCallback(async () => {
    setLoading(true);
    setError(null);
    setInfoBanner(null);
    signupDataRef.current = {};

    try {
      const FB = await getFacebookSdk();
      const configId = process.env.NEXT_PUBLIC_META_CONFIG_ID;
      FB.login(
        function (response: any) {
          if (response?.authResponse?.code) {
            executeBackendConnect(response.authResponse.code);
          } else {
            setLoading(false);
            const bannerMsg = 'Signup was closed before finishing. Try again.';
            setInfoBanner(bannerMsg);
            if (onCancel) onCancel(bannerMsg);
          }
        },
        {
          config_id: configId,
          response_type: 'code',
          override_default_response_type: true,
          extras: {
            setup: {},
            featureType: 'whatsapp_business_app_onboarding',
            sessionInfoVersion: 3,
          },
        }
      );
    } catch (err: any) {
      clientLogger.error('useWhatsAppConnect.handleConnect', 'Could not start Meta Embedded Signup', err);
      const msg =
        err?.message === 'Failed to load Meta Facebook SDK'
          ? 'Could not load the Facebook sign-up window. Check your connection or disable ad blockers, then try again.'
          : 'Could not start the WhatsApp sign-up. Please try again.';
      setError(msg);
      if (onError) onError(msg);
      setLoading(false);
    }
  }, [executeBackendConnect, onError, onCancel]);

  return {
    handleConnect,
    loading,
    isConnected,
    connections,
    error,
    setError,
    infoBanner,
    setInfoBanner,
  };
}
