/**
 * WhatsApp Embedded Signup & Meta Cloud API TypeScript Definitions
 */

export interface MetaAuthResponse {
  accessToken?: string;
  code?: string;
  expiresIn?: number;
  signedRequest?: string;
  userID?: string;
  data_access_expiration_time?: number;
  graphDomain?: string;
}

export interface FBLoginResponse {
  status: 'connected' | 'not_authorized' | 'unknown';
  authResponse?: MetaAuthResponse | null;
  error?: {
    message: string;
    code: number;
    error_subcode?: number;
  };
}

export interface WAEmbeddedSignupData {
  phone_number_id?: string;
  waba_id?: string;
  current_step?: string;
  [key: string]: unknown;
}

export interface WAEmbeddedSignupMessageEvent {
  type: 'WA_EMBEDDED_SIGNUP';
  event: 'FINISH' | 'CANCEL' | 'ERROR' | 'STEP_CHANGE' | string;
  data?: WAEmbeddedSignupData;
  error?: string | Record<string, unknown>;
}

export interface ConnectWhatsAppRequest {
  code: string;
  wabaId?: string | null;
  phoneNumberId?: string | null;
  storeId?: string;
  businessName?: string;
}

export interface WhatsAppConnectionRecord {
  store_id: string;
  sort_key: string;
  phoneNumber_id: string;
  waba_id: string;
  verified_name: string;
  display_phone_number: string;
  displayName?: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING' | 'DISCONNECTED';
  abandoned_cart: boolean;
  createdAt: string;
  updatedAt?: string;
  quality_rating?: string;
  code_verification_status?: string;
}

/**
 * Augment the global Window interface to include Facebook SDK types
 */
declare global {
  interface Window {
    fbAsyncInit?: () => void;
    FB?: {
      init: (params: {
        appId: string;
        cookie?: boolean;
        xfbml?: boolean;
        version: string;
      }) => void;
      login: (
        callback: (response: FBLoginResponse) => void,
        options?: {
          config_id?: string;
          response_type?: string;
          override_default_response_type?: boolean;
          extras?: {
            featureType?: string;
            setup?: Record<string, unknown>;
            [key: string]: unknown;
          };
          scope?: string;
        }
      ) => void;
      getLoginStatus?: (callback: (response: FBLoginResponse) => void) => void;
    };
  }
}
