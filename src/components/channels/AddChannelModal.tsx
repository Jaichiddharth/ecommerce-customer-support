'use client';

import React, { useState } from 'react';
import {
  Check,
  X,
  Lock,
  Info,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import { useWhatsAppConnect } from '../whatsapp/useWhatsAppConnect';
import { gooeyToast } from '@/components/ui/goey-toaster';

export interface AddChannelModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (channelData: any) => void;
}

type ChannelKey = 'whatsapp' | 'instagram' | 'messenger';

export const AddChannelModal: React.FC<AddChannelModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [selectedChannel, setSelectedChannel] = useState<ChannelKey>('whatsapp');

  const { handleConnect, loading, error, setError } = useWhatsAppConnect({
    storeId: 'pingcart-store.myshopify.com',
    onSuccess: (data) => {
      gooeyToast.success('WhatsApp channel connected successfully!');
      if (onSuccess) onSuccess(data);
      onClose();
    },
    onError: (err) => {
      gooeyToast.error(err || 'Failed to connect WhatsApp channel');
    },
  });

  if (!isOpen) return null;

  const handleSelectWhatsApp = () => {
    setSelectedChannel('whatsapp');
  };

  const handleBlockedChannelClick = (channelName: string) => {
    gooeyToast.warning(`${channelName} is currently locked`, {
      description: `Integration with ${channelName} is coming in the next release. Only WhatsApp Business is currently active.`,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 overflow-hidden animate-in fade-in duration-200"
      onClick={(e) => {
        if (e.target === e.currentTarget && !loading) {
          onClose();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="bg-white rounded-2xl shadow-2xl border border-slate-200/90 w-full max-w-5xl overflow-hidden animate-in fade-in zoom-in-95 duration-200 select-none flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ======================================================== */}
        {/* TOP HEADER: Brand Logo from login page + Stepper + Close */}
        {/* ======================================================== */}
        <div className="px-6 sm:px-8 py-3.5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
          {/* Brand Logo matching login page */}
          <div className="flex items-center gap-2.5">
            <div className="relative w-8 h-8 rounded-lg bg-[#3440a8] flex items-center justify-center shadow-xs">
              <span className="text-white text-lg font-extrabold leading-none">U</span>
              <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </div>
            <span className="text-lg font-bold tracking-tight text-slate-900">UnoCX</span>
          </div>

          {/* Stepper (Business details -> Connect WhatsApp) */}
          <div className="hidden sm:flex items-center gap-3 select-none">
            {/* Step 1: Business details (Checked) */}
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-[#10b981] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                <Check className="w-3 h-3 stroke-[3]" />
              </span>
              <span className="text-xs font-semibold text-slate-700">Business details</span>
            </div>

            {/* Connecting line */}
            <div className="w-8 lg:w-12 h-0.5 bg-emerald-500 rounded-full" />

            {/* Step 2: Connect WhatsApp (Active) */}
            <div className="flex items-center gap-1.5">
              <span className="w-5 h-5 rounded-full bg-[#3440a8] text-white flex items-center justify-center text-xs font-bold shadow-xs">
                2
              </span>
              <span className="text-xs font-bold text-slate-900">Connect WhatsApp</span>
            </div>
          </div>

          {/* Save and exit */}
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="text-xs sm:text-sm font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50"
          >
            {/* <span>Save and exit</span> */}
            <X className="w-3.5 h-3.5 ml-0.5 text-slate-400" />
          </button>
        </div>

        {/* ======================================================== */}
        {/* MAIN BODY: Heading, Landscape Channel Grid, Action Area */}
        {/* ======================================================== */}
        <div className="px-6 sm:px-8 py-5 space-y-4 shrink-0">
          {/* Main Title & Subtitle */}
          <div>
            <h2 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight">
              Connect your WhatsApp number
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              UnoCX sends and receives messages through Meta&apos;s WhatsApp Business Platform (Cloud API).
            </p>
          </div>

          {/* Channel Selection Cards in Landscape Grid (3 Columns) */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
            {/* Card 1: WhatsApp Business (Active / Clickable) */}
            <div
              onClick={handleSelectWhatsApp}
              className={`p-3.5 rounded-2xl border-2 transition-all cursor-pointer flex flex-col justify-between ${selectedChannel === 'whatsapp'
                ? 'border-[#3440a8] bg-[#f0f3ff]/80 shadow-xs'
                : 'border-slate-200 hover:border-slate-300 bg-white'
                }`}
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-[#3440a8] bg-white flex items-center justify-center">
                      <div className="w-2 h-2 rounded-full bg-[#3440a8]" />
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-[#25d366]/15 border border-[#25d366]/30 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="#25d366" className="w-4 h-4">
                        <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91C2.13 13.66 2.59 15.36 3.45 16.86L2.05 22L7.3 20.62C8.75 21.41 10.38 21.83 12.04 21.83C17.5 21.83 21.95 17.38 21.95 11.92C21.95 9.27 20.92 6.78 19.05 4.91C17.18 3.03 14.69 2 12.04 2ZM12.05 20.15C10.56 20.15 9.1 19.75 7.83 19L7.53 18.82L4.41 19.64L5.24 16.6L5.04 16.29C4.22 14.98 3.79 13.47 3.79 11.91C3.79 7.37 7.5 3.66 12.05 3.66C14.25 3.66 16.32 4.52 17.88 6.08C19.44 7.64 20.3 9.71 20.3 11.91C20.29 16.46 16.59 20.15 12.05 20.15ZM16.58 14.39C16.33 14.26 15.11 13.66 14.88 13.58C14.66 13.49 14.5 13.45 14.34 13.7C14.17 13.95 13.7 14.53 13.55 14.7C13.41 14.86 13.27 14.89 13.02 14.76C12.77 14.64 11.98 14.38 11.04 13.54C10.3 12.89 9.81 12.08 9.66 11.83C9.52 11.58 9.64 11.45 9.77 11.32C9.88 11.21 10.02 11.03 10.15 10.88C10.27 10.73 10.31 10.63 10.39 10.46C10.48 10.29 10.43 10.15 10.37 10.03C10.31 9.9 9.81 8.68 9.61 8.17C9.4 7.67 9.2 7.74 9.04 7.73C8.9 7.72 8.73 7.72 8.56 7.72C8.39 7.72 8.12 7.78 7.89 8.03C7.66 8.28 7.02 8.88 7.02 10.09C7.02 11.31 7.91 12.48 8.03 12.65C8.16 12.82 9.77 15.3 12.24 16.37C12.83 16.62 13.28 16.77 13.64 16.89C14.24 17.08 14.78 17.05 15.22 16.99C15.7 16.91 16.7 16.38 16.9 15.8C17.11 15.23 17.11 14.74 17.05 14.64C16.99 14.53 16.83 14.51 16.58 14.39Z" />
                      </svg>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Recommended
                  </span>
                </div>

                <h3 className="font-bold text-slate-900 text-sm">
                  WhatsApp Business
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Official Meta Cloud API. Shared inbox, automated bots, templates, and 2-way sync.
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px]">
                <span className="text-emerald-700 font-semibold flex items-center gap-1 text-[11px]">
                  <Check className="w-3 h-3 stroke-[2.5]" /> Ready to connect
                </span>
                <span className="text-[10px] text-slate-400">Cloud API</span>
              </div>
            </div>

            {/* Card 2: Instagram Direct (Blocked State) */}
            <div
              onClick={() => handleBlockedChannelClick('Instagram Direct')}
              className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 opacity-60 cursor-not-allowed flex flex-col justify-between transition-opacity hover:opacity-75"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-slate-300 bg-slate-100 flex items-center justify-center">
                      <Lock className="w-2.5 h-2.5 text-slate-400" />
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-amber-500 via-rose-500 to-purple-600 flex items-center justify-center text-white">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069ZM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0Zm0 5.838a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 0 0 0-12.324ZM12 16a4 4 0 1 1 0-8 4 4 0 0 1 0 8Zm6.406-11.845a1.44 1.44 0 1 0 0 2.881 1.44 1.44 0 0 0 0-2.881Z" />
                      </svg>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/80 text-slate-600">
                    <Lock className="w-2.5 h-2.5" /> Blocked
                  </span>
                </div>

                <h3 className="font-bold text-slate-700 text-sm">
                  Instagram Direct
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Direct messages, story mentions, and customer comment management.
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium text-[11px]">Coming in next release</span>
                <span className="text-[10px] text-slate-400">Meta API</span>
              </div>
            </div>

            {/* Card 3: Facebook Messenger (Blocked State) */}
            <div
              onClick={() => handleBlockedChannelClick('Facebook Messenger')}
              className="p-3.5 rounded-2xl border border-slate-200 bg-slate-50/70 opacity-60 cursor-not-allowed flex flex-col justify-between transition-opacity hover:opacity-75"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-4 h-4 rounded-full border border-slate-300 bg-slate-100 flex items-center justify-center">
                      <Lock className="w-2.5 h-2.5 text-slate-400" />
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#00b2ff] via-[#006aff] to-[#a033ff] flex items-center justify-center text-white">
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path d="M12 2C6.477 2 2 6.145 2 11.258c0 2.914 1.455 5.518 3.734 7.183V22l3.418-1.875c.91.252 1.873.391 2.848.391 5.523 0 10-4.145 10-9.258C22 6.145 17.523 2 12 2Zm1.004 12.443-2.563-2.735-5.002 2.735 5.502-5.843 2.625 2.735 4.94-2.735-5.502 5.843Z" />
                      </svg>
                    </div>
                  </div>
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200/80 text-slate-600">
                    <Lock className="w-2.5 h-2.5" /> Blocked
                  </span>
                </div>

                <h3 className="font-bold text-slate-700 text-sm">
                  Facebook Messenger
                </h3>
                <p className="text-[11px] text-slate-500 mt-1 leading-relaxed">
                  Page chats, automated FAQ responses, and unified customer threading.
                </p>
              </div>

              <div className="mt-3 pt-2 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
                <span className="text-slate-500 font-medium text-[11px]">Coming in next release</span>
                <span className="text-[10px] text-slate-400">Meta API</span>
              </div>
            </div>
          </div>

          {/* ======================================================== */}
          {/* META EMBEDDED SIGNUP ACTION & INFO NOTICE                */}
          {/* ======================================================== */}
          {selectedChannel === 'whatsapp' && (
            <div className="p-3 bg-[#fffbeb] border border-[#fde68a] rounded-xl text-xs text-[#92400e] flex items-center gap-2.5 leading-snug">
              <Info className="w-4 h-4 text-amber-600 shrink-0" />
              <p>
                Display name must match your business, e.g. &ldquo;PingCart&rdquo;. Meta reviews it before your messaging limit increases. You can test with 5 numbers meanwhile.
              </p>
            </div>
          )}
        </div>

        {/* ======================================================== */}
        {/* FOOTER ACTIONS: Back & Continue                          */}
        {/* ======================================================== */}
        <div className="px-6 sm:px-8 py-3.5 border-t border-slate-100 bg-slate-50/50 flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            disabled={loading}
            className="px-5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-xl transition-all cursor-pointer disabled:opacity-50"
          >
            Back
          </button>
          {/* 
          <button
            type="button"
            onClick={handleConnect}
            disabled={loading}
            className="px-6 py-2 text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] active:scale-98 rounded-xl shadow-xs transition-all cursor-pointer flex items-center gap-2 disabled:opacity-60 disabled:cursor-wait"
          >
            {loading ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Connecting...</span>
              </>
            ) : (
              <span>Continue</span>
            )}
          </button> */}

          {selectedChannel === 'whatsapp' && (
            <div className="space-y-3 pt-1">
              {/* Facebook Button + Description */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <button
                  type="button"
                  onClick={handleConnect}
                  disabled={loading}
                  className="inline-flex items-center justify-center gap-2.5 px-5 py-2.5 bg-[#1877f2] hover:bg-[#166fe5] active:scale-98 text-white text-xs font-semibold rounded-xl shadow-xs transition-all cursor-pointer disabled:opacity-75 disabled:cursor-wait shrink-0"
                >
                  {loading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Connecting Meta...</span>
                    </>
                  ) : (
                    <>
                      {/* Facebook 'f' Logo */}
                      <svg viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                        <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                      </svg>
                      <span>Continue with Facebook</span>
                    </>
                  )}
                </button>
              </div>

              {/* Error Alert if any */}
              {error && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="font-semibold">Connection failed</p>
                    <p className="text-red-600 mt-0.5">{error}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setError(null)}
                    className="text-red-500 hover:text-red-800 text-xs font-bold cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              )}


            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AddChannelModal;
