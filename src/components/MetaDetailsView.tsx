'use client';

import React, { useState, useEffect } from 'react';
import apiClient from '@/lib/api/client';
import {
  Layers,
  MessageCircle,
  Phone,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
  Copy,
  Check,
  ShieldCheck,
  Sparkles,
  FileText,
  Search,
  Globe,
  Tag,
  Clock,
  Send,
  ExternalLink,
  ChevronDown,
  Store,
} from 'lucide-react';
import { WhatsAppConnectButton } from './whatsapp/WhatsAppConnectButton';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { ErrorState } from '@/components/ui/states';

export const MetaDetailsView: React.FC = () => {
  const [storeId] = useState('pingcart-store.myshopify.com');
  const [selectedPhoneId, setSelectedPhoneId] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [metaData, setMetaData] = useState<any>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [templateSearch, setTemplateSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const fetchMetaDetails = async (isManualRefresh = false, phoneIdToFetch = selectedPhoneId) => {
    if (isManualRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);

    try {
      const response = await apiClient.get('/api/channels/whatsapp/meta-details', {
        params: {
          storeId,
          ...(phoneIdToFetch ? { phoneNumberId: phoneIdToFetch } : {}),
        },
      });

      if (response.data?.success) {
        setMetaData(response.data);
        if (!selectedPhoneId && response.data?.selectedPhoneId) {
          setSelectedPhoneId(response.data.selectedPhoneId);
        }
      } else {
        setError(new ApiError({
          message: response.data?.message || 'Failed to fetch WhatsApp account details.',
          status: response.status,
          code: 'META_API_ERROR',
          source: 'meta',
        }));
      }
    } catch (err) {
      setError(toApiError(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchMetaDetails(false, selectedPhoneId);
  }, [storeId, selectedPhoneId]);

  const handleConnectionChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newPhoneId = e.target.value;
    setSelectedPhoneId(newPhoneId);
    fetchMetaDetails(false, newPhoneId);
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  // Filter message templates
  const templates = metaData?.templates || [];
  const filteredTemplates = templates.filter((tpl: any) => {
    const matchesSearch =
      tpl.name?.toLowerCase().includes(templateSearch.toLowerCase()) ||
      tpl.category?.toLowerCase().includes(templateSearch.toLowerCase());
    const matchesCategory = categoryFilter === 'ALL' || tpl.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const allConnections = metaData?.allConnections || [];

  return (
    <div className="p-6 space-y-6 max-w-6xl mx-auto font-sans">
      {/* 1. Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-[#00a884] to-emerald-600 flex items-center justify-center text-white shadow-md shadow-emerald-600/20">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-slate-900">Meta WhatsApp Account Hub</h2>
              {metaData?.connected ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Connected
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                  <AlertCircle className="w-3.5 h-3.5 text-amber-600" /> Needs Connection
                </span>
              )}
            </div>
            <p className="text-xs text-slate-400">
              Live Meta Graph API data: Phone IDs, Templates & Webhooks for <strong>{storeId}</strong>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 flex-wrap">
          <button
            type="button"
            onClick={() => fetchMetaDetails(true, selectedPhoneId)}
            disabled={refreshing || loading}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl transition-all cursor-pointer"
            title="Fetch latest from Meta Graph API"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-emerald-600' : ''}`} />
            <span>Sync Live Meta</span>
          </button>

          <WhatsAppConnectButton
            storeId={storeId}
            onSuccess={() => fetchMetaDetails(true)}
          />
        </div>
      </div>

      {/* 2. Connection Selector Bar (When store has multiple WhatsApp connections) */}
      {allConnections.length > 0 && (
        <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <span className="text-xs font-bold text-slate-900">Active WhatsApp Connection</span>
              <p className="text-[11px] text-slate-400">
                Found {allConnections.length} registered connection{allConnections.length > 1 ? 's' : ''} for this organization
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500 font-semibold whitespace-nowrap">Select Number:</span>
            <select
              value={selectedPhoneId || metaData?.selectedPhoneId || ''}
              onChange={handleConnectionChange}
              className="px-3 py-2 text-xs font-bold bg-slate-50 border border-slate-200 rounded-xl text-slate-800 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer min-w-56"
            >
              {allConnections.map((conn: any) => {
                const phoneId = conn.metaPhoneNumberId || conn.phoneNumber_id;
                const phoneDisplay = conn.phoneNumber || conn.display_phone_number || conn.verified_name;
                return (
                  <option key={phoneId} value={phoneId}>
                    {phoneDisplay} (ID: {phoneId})
                  </option>
                );
              })}
            </select>
          </div>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="bg-white p-12 rounded-2xl border border-slate-200 shadow-sm text-center">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-600 mx-auto mb-3" />
          <p className="text-sm font-bold text-slate-800">Fetching Meta WhatsApp Details...</p>
          <p className="text-xs text-slate-400 mt-1">Querying Meta Graph API and decrypting tokens</p>
        </div>
      )}

      {/* Error State */}
      {!loading && error && (
        <div className="bg-white rounded-2xl border border-red-200 shadow-sm">
          <ErrorState
            error={error}
            title="Couldn't load WhatsApp account details"
            onRetry={() => fetchMetaDetails(true)}
            retrying={refreshing}
          />
        </div>
      )}

      {/* Disconnected / Empty State */}
      {!loading && !error && !metaData?.connected && (
        <div className="bg-white p-10 rounded-2xl border border-dashed border-slate-300 text-center space-y-3">
          <div className="w-12 h-12 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto">
            <MessageCircle className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-slate-900">No Meta WhatsApp Account Connected</h3>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Click the Connect WhatsApp button to onboard your official WhatsApp Business Cloud API number via Meta Embedded Signup.
          </p>
          <div className="pt-2">
            <WhatsAppConnectButton
              storeId={storeId}
              onSuccess={() => fetchMetaDetails(true)}
            />
          </div>
        </div>
      )}

      {/* Connected Meta Information */}
      {!loading && metaData?.connected && (
        <>
          {/* 3. Overview Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* WABA ID Box */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">WhatsApp Business Account</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                  {metaData.waba?.review_status || 'VERIFIED'}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">{metaData.waba?.name}</p>
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                <span className="text-slate-400 font-mono text-[11px] truncate">{metaData.waba?.id}</span>
                <button
                  onClick={() => copyToClipboard(metaData.waba?.id, 'waba_id')}
                  className="text-slate-400 hover:text-emerald-600 p-1 cursor-pointer"
                  title="Copy WABA ID"
                >
                  {copiedKey === 'waba_id' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Active Phone Details */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Selected Phone Number</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-full">
                  🟢 Quality: {metaData.phoneDetails?.quality_rating || 'HIGH'}
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">
                {metaData.phoneDetails?.display_phone_number || metaData.connection?.phoneNumber || metaData.connection?.display_phone_number || 'N/A'}
              </p>
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                <span className="text-slate-400 font-mono text-[11px] truncate">
                  ID: {metaData.phoneDetails?.id || metaData.connection?.metaPhoneNumberId || metaData.connection?.phoneNumber_id}
                </span>
                <button
                  onClick={() => copyToClipboard(metaData.phoneDetails?.id || metaData.connection?.metaPhoneNumberId || metaData.connection?.phoneNumber_id, 'phone_id')}
                  className="text-slate-400 hover:text-emerald-600 p-1 cursor-pointer"
                  title="Copy Phone Number ID"
                >
                  {copiedKey === 'phone_id' ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            {/* Total Templates & Namespace */}
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Message Templates</span>
                <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
                  {metaData.templatesCount} Active
                </span>
              </div>
              <p className="text-sm font-bold text-slate-900">Verified Namespace</p>
              <div className="flex items-center justify-between pt-1 border-t border-slate-100 text-xs">
                <span className="text-slate-400 font-mono text-[11px] truncate">
                  {metaData.waba?.template_namespace || 'Official Meta Cloud'}
                </span>
                <span className="text-[10px] font-bold text-emerald-600">Meta v25.0</span>
              </div>
            </div>
          </div>

          {/* 4. Connected Phone Numbers Table / List */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 flex items-center gap-2">
                <Phone className="w-4 h-4 text-emerald-600" />
                Store Phone Number Connections ({allConnections.length})
              </h3>
            </div>
            <div className="divide-y divide-slate-100">
              {allConnections.map((conn: any) => {
                const phoneId = conn.metaPhoneNumberId || conn.phoneNumber_id;
                const phoneDisplay = conn.phoneNumber || conn.display_phone_number || phoneId;
                const channelName = conn.verified_name || 'Verified Business';
                const isSelected = phoneId === (selectedPhoneId || metaData?.selectedPhoneId);
                return (
                  <div
                    key={phoneId}
                    className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                      isSelected ? 'bg-emerald-50/40 border-l-4 border-emerald-600' : 'hover:bg-slate-50/60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-bold text-xs ${
                        isSelected ? 'bg-emerald-600 text-white shadow-xs' : 'bg-slate-100 text-slate-600'
                      }`}>
                        <Phone className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-slate-900 font-mono">
                            {phoneDisplay}
                          </span>
                          <span className="text-[10px] font-bold px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded-md">
                            {channelName}
                          </span>
                          {isSelected && (
                            <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                              Active View
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-400 font-mono mt-0.5">
                          Phone Number ID: {phoneId}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3 text-xs">
                      {!isSelected && (
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPhoneId(phoneId);
                            fetchMetaDetails(false, phoneId);
                          }}
                          className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-all"
                        >
                          View Details
                        </button>
                      )}
                      <button
                        onClick={() => copyToClipboard(phoneId, `phone_${phoneId}`)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                      >
                        {copiedKey === `phone_${phoneId}` ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>Copy ID</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 5. WhatsApp Message Templates Section */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden space-y-4 p-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-slate-100">
              <div>
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-emerald-600" />
                  WhatsApp Message Templates ({templates.length})
                </h3>
                <p className="text-xs text-slate-400">
                  Approved marketing, utility, and authentication templates synced directly from Meta WABA.
                </p>
              </div>

              {/* Filters */}
              <div className="flex items-center gap-2">
                {/* Search */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search templates..."
                    value={templateSearch}
                    onChange={(e) => setTemplateSearch(e.target.value)}
                    className="pl-8 pr-3 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 w-40 sm:w-48"
                  />
                </div>

                {/* Category dropdown */}
                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="px-2.5 py-1.5 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-700 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                >
                  <option value="ALL">All Categories</option>
                  <option value="MARKETING">Marketing</option>
                  <option value="UTILITY">Utility</option>
                  <option value="AUTHENTICATION">Authentication</option>
                </select>
              </div>
            </div>

            {/* Templates Cards Grid */}
            {filteredTemplates.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-400 bg-slate-50 rounded-xl">
                No templates found matching your search.
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredTemplates.map((tpl: any) => {
                  const bodyComponent = tpl.components?.find((c: any) => c.type === 'BODY');
                  const headerComponent = tpl.components?.find((c: any) => c.type === 'HEADER');
                  const buttonsComponent = tpl.components?.find((c: any) => c.type === 'BUTTONS');

                  return (
                    <div
                      key={tpl.id || tpl.name}
                      className="p-4 rounded-xl border border-slate-200 bg-slate-50/40 hover:bg-slate-50/80 hover:border-emerald-300 transition-all flex flex-col justify-between"
                    >
                      <div className="space-y-2">
                        {/* Header details */}
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-bold text-xs text-slate-900 font-mono break-all">
                            {tpl.name}
                          </span>
                          <span
                            className={`text-[9px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
                              tpl.status === 'APPROVED'
                                ? 'bg-emerald-100 text-emerald-800'
                                : tpl.status === 'PENDING'
                                ? 'bg-amber-100 text-amber-800'
                                : 'bg-red-100 text-red-800'
                            }`}
                          >
                            {tpl.status || 'APPROVED'}
                          </span>
                        </div>

                        {/* Badges */}
                        <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                          <span className="bg-slate-200/70 px-1.5 py-0.5 rounded font-medium">
                            {tpl.category}
                          </span>
                          <span className="bg-slate-200/70 px-1.5 py-0.5 rounded font-medium">
                            {tpl.language || 'en_US'}
                          </span>
                        </div>

                        {/* Body Preview */}
                        <div className="p-2.5 bg-white border border-slate-200 rounded-lg text-[11px] text-slate-700 leading-relaxed max-h-28 overflow-y-auto whitespace-pre-wrap">
                          {headerComponent?.text && (
                            <p className="font-bold text-slate-900 mb-1">{headerComponent.text}</p>
                          )}
                          <p>{bodyComponent?.text || 'No text preview available'}</p>
                        </div>

                        {/* Buttons Preview if any */}
                        {buttonsComponent?.buttons && buttonsComponent.buttons.length > 0 && (
                          <div className="flex flex-wrap gap-1 pt-1">
                            {buttonsComponent.buttons.map((btn: any, idx: number) => (
                              <span
                                key={idx}
                                className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-md font-medium"
                              >
                                🔘 {btn.text}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Footer ID */}
                      <div className="mt-3 pt-2 border-t border-slate-200/70 flex items-center justify-between text-[10px] text-slate-400 font-mono">
                        <span>ID: {tpl.id || 'Meta Default'}</span>
                        <button
                          onClick={() => copyToClipboard(tpl.name, `tpl_${tpl.name}`)}
                          className="hover:text-emerald-600 flex items-center gap-1 cursor-pointer"
                        >
                          {copiedKey === `tpl_${tpl.name}` ? 'Copied' : 'Copy Name'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default MetaDetailsView;
