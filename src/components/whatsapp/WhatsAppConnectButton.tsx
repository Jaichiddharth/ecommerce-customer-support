'use client';

import React from 'react';
import { Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { useWhatsAppConnect } from './useWhatsAppConnect';

export interface WhatsAppConnectButtonProps {
  storeId?: string;
  className?: string;
  children?: React.ReactNode;
  onSuccess?: (data: any) => void;
  onError?: (error: string) => void;
}

export const WhatsAppConnectButton: React.FC<WhatsAppConnectButtonProps> = ({
  storeId = 'pingcart-store.myshopify.com',
  className = '',
  children,
  onSuccess,
  onError,
}) => {
  const { handleConnect, loading, isConnected, error } = useWhatsAppConnect({
    storeId,
    onSuccess,
    onError,
  });

  return (
    <div className="inline-flex flex-col items-start gap-1.5">
      <button
        type="button"
        onClick={handleConnect}
        disabled={loading}
        className={
          children
            ? `${className} ${loading ? 'opacity-70 cursor-wait' : ''}`
            : `inline-flex items-center justify-center gap-2 px-4 py-2 rounded-xl font-bold text-xs text-white transition-all cursor-pointer ${isConnected
              ? 'bg-emerald-700 hover:bg-emerald-800 shadow-sm'
              : 'bg-emerald-600 hover:bg-emerald-700 shadow-md shadow-emerald-600/20'
            } ${loading ? 'opacity-75 cursor-wait' : 'active:scale-95'} ${className}`
        }
      >
        {children ? (
          loading ? (
            <span className="inline-flex items-center justify-center gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Connecting...</span>
            </span>
          ) : (
            children
          )
        ) : loading ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span>Connecting WhatsApp...</span>
          </>
        ) : isConnected ? (
          <>
            <CheckCircle2 className="w-4 h-4 text-emerald-300" />
            <span>Connected (Click to Reconnect)</span>
          </>
        ) : (
          <>
            <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
              <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.56 20.15 9.1 19.75 7.83 19L7.53 18.82L4.41 19.64L5.24 16.6L5.04 16.29C4.22 14.98 3.79 13.47 3.79 11.91C3.79 7.37 7.5 3.66 12.05 3.66C14.25 3.66 16.32 4.52 17.88 6.08C19.44 7.64 20.3 9.71 20.3 11.91C20.29 16.46 16.59 20.15 12.05 20.15ZM16.58 14.39C16.33 14.26 15.11 13.66 14.88 13.58C14.66 13.49 14.5 13.45 14.34 13.7C14.17 13.95 13.7 14.53 13.55 14.7C13.41 14.86 13.27 14.89 13.02 14.76C12.77 14.64 11.98 14.38 11.04 13.54C10.3 12.89 9.81 12.08 9.66 11.83C9.52 11.58 9.64 11.45 9.77 11.32C9.88 11.21 10.02 11.03 10.15 10.88C10.27 10.73 10.31 10.63 10.39 10.46C10.48 10.29 10.43 10.15 10.37 10.03C10.31 9.9 9.81 8.68 9.61 8.17C9.4 7.67 9.2 7.74 9.04 7.73C8.9 7.72 8.73 7.72 8.56 7.72C8.39 7.72 8.12 7.78 7.89 8.03C7.66 8.28 7.02 8.88 7.02 10.09C7.02 11.31 7.91 12.48 8.03 12.65C8.16 12.82 9.77 15.3 12.24 16.37C12.83 16.62 13.28 16.77 13.64 16.89C14.24 17.08 14.78 17.05 15.22 16.99C15.7 16.91 16.7 16.38 16.9 15.8C17.11 15.23 17.11 14.74 17.05 14.64C16.99 14.53 16.83 14.51 16.58 14.39Z" />
            </svg>
            <span>Connect WhatsApp</span>
          </>
        )}
      </button>

      {error && (
        <span className="text-[11px] text-red-600 flex items-center gap-1">
          <AlertCircle className="w-3 h-3 shrink-0" />
          {error}
        </span>
      )}
    </div>
  );
};

export default WhatsAppConnectButton;
