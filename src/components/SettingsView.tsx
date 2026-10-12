'use client';

import React, { useState } from 'react';
import {
  Settings,
  MessageCircle,
  Store,
  CheckCircle2,
  Check,
} from 'lucide-react';
import { WhatsAppConnectButton } from './whatsapp/WhatsAppConnectButton';

export const SettingsView: React.FC = () => {
  const [storeId] = useState('pingcart-store.myshopify.com');
  const [connectionData, setConnectionData] = useState<any>(null);

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
        <div>
          <h2 className="text-base font-bold text-slate-800 flex items-center gap-2">
            <Settings className="w-5 h-5 text-emerald-600" />
            Channels & Settings
          </h2>
          <p className="text-xs text-slate-400">
            Connect your Shopify store with WhatsApp Cloud API via Meta Embedded Signup.
          </p>
        </div>
      </div>

      {/* Connected Store */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-700">
              <Store className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">Shopify Store</h3>
              <p className="text-xs text-slate-500">
                Store ID: <strong>{storeId}</strong>
              </p>
            </div>
          </div>

          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200">
            <CheckCircle2 className="w-4 h-4" />
            Active
          </span>
        </div>
      </div>

      {/* WhatsApp Connection */}
      <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white">
              <MessageCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">WhatsApp Business Cloud API</h3>
              <p className="text-xs text-slate-500">
                Direct Meta Embedded Signup onboarding.
              </p>
            </div>
          </div>

          {/* Clean Embedded Signup Button */}
          <WhatsAppConnectButton
            storeId={storeId}
            onSuccess={(data) => {
              setConnectionData(data);
            }}
          />
        </div>

        {connectionData && (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs space-y-1 text-emerald-900">
            <p className="font-bold flex items-center gap-1.5 text-emerald-800">
              <Check className="w-4 h-4" /> Connected WhatsApp Account:
            </p>
            <p><strong>Verified Name:</strong> {connectionData.verified_name || connectionData.displayName}</p>
            <p><strong>Phone Number:</strong> {connectionData.display_phone_number || connectionData.phoneNumber_id}</p>
            <p><strong>WABA ID:</strong> {connectionData.waba_id}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default SettingsView;
