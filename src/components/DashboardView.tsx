'use client';

import React from 'react';
import {
  MessageSquare,
  TrendingUp,
  ShoppingCart,
  CheckCheck,
  Clock,
  ArrowUpRight,
  Camera,
  Send,
  Smartphone,
  Zap,
  ExternalLink,
  ChevronRight,
  ShieldCheck,
  Percent
} from 'lucide-react';
import { mockConversations, mockAutomations, mockCampaigns } from '../data/mockData';
import { TabType } from './Sidebar';

interface DashboardViewProps {
  setActiveTab: (tab: TabType) => void;
  onSelectConversation: (id: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({ setActiveTab, onSelectConversation }) => {
  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Top Banner: Store overview & Quick Status */}
      <div className="bg-gradient-to-r from-emerald-700 via-teal-700 to-slate-900 rounded-2xl p-6 text-white shadow-lg relative overflow-hidden">
        <div className="absolute right-0 top-0 bottom-0 w-1/3 bg-white/5 skew-x-12 pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-white/20 text-white backdrop-blur-sm border border-white/20">
                Shopify Omnichannel Hub
              </span>
              <span className="text-emerald-200 text-xs font-medium">Synced 2m ago</span>
            </div>
            <h2 className="text-2xl font-bold tracking-tight">WhatsApp & Omnichannel Performance</h2>
            <p className="text-emerald-100/80 text-xs mt-1 max-w-xl">
              Real-time messaging, automated abandoned cart recoveries, Meta Cloud API broadcasts, and multi-channel customer inquiries.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => setActiveTab('inbox')}
              className="px-4 py-2.5 bg-white text-emerald-800 hover:bg-emerald-50 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <MessageSquare className="w-4 h-4 text-emerald-600" />
              <span>Open Live Inbox (2 Unread)</span>
            </button>
            <button
              onClick={() => setActiveTab('broadcast')}
              className="px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-white rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              <span>Launch Broadcast</span>
            </button>
          </div>
        </div>
      </div>

      {/* 4 Key Performance Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Recovered Revenue */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Cart Revenue Recovered</span>
            <div className="w-9 h-9 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600">
              <ShoppingCart className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-slate-800">₹4,86,500</h3>
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className="text-emerald-600 font-semibold flex items-center">
                <TrendingUp className="w-3.5 h-3.5 mr-0.5" /> +28.4%
              </span>
              <span className="text-slate-400">vs last week</span>
            </div>
          </div>
        </div>

        {/* Card 2: Total Messages Sent & Delivered */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Total Outbound Sent</span>
            <div className="w-9 h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600">
              <CheckCheck className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-slate-800">26,040</h3>
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className="text-slate-600 font-medium">98.4% Delivery</span>
              <span className="text-slate-300">•</span>
              <span className="text-emerald-600 font-semibold">89.1% Read</span>
            </div>
          </div>
        </div>

        {/* Card 3: Active Live Chats */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Active Inquiries Today</span>
            <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center text-indigo-600">
              <MessageSquare className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-slate-800">142</h3>
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className="text-emerald-600 font-semibold">124 Resolved</span>
              <span className="text-slate-300">•</span>
              <span className="text-amber-500 font-semibold">18 Open</span>
            </div>
          </div>
        </div>

        {/* Card 4: Avg First Response Time */}
        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-slate-500">Avg Response Time</span>
            <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600">
              <Clock className="w-5 h-5" />
            </div>
          </div>
          <div className="mt-3">
            <h3 className="text-2xl font-bold text-slate-800">1m 45s</h3>
            <div className="flex items-center gap-1.5 mt-1 text-xs">
              <span className="text-emerald-600 font-semibold flex items-center">
                <ArrowUpRight className="w-3.5 h-3.5 rotate-45" /> 42s faster
              </span>
              <span className="text-slate-400">with Copilot</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Channel Volume & Live Abandoned Carts / Chats */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Omnichannel Traffic & Recent Conversations */}
        <div className="lg:col-span-2 space-y-6">
          {/* Channel Breakdown Card */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Omnichannel Volume Breakdown</h4>
                <p className="text-xs text-slate-400">Distribution of customer messages across channels</p>
              </div>
              <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-100">
                Last 30 Days
              </span>
            </div>

            {/* Progress Bars */}
            <div className="space-y-3.5">
              {/* WhatsApp */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    WhatsApp Cloud API
                  </span>
                  <span className="font-bold text-slate-800">18,450 msgs (70.8%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-emerald-500 h-full rounded-full" style={{ width: '70.8%' }}></div>
                </div>
              </div>

              {/* Instagram */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-pink-500"></span>
                    Instagram Direct
                  </span>
                  <span className="font-bold text-slate-800">4,210 msgs (16.2%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-pink-500 h-full rounded-full" style={{ width: '16.2%' }}></div>
                </div>
              </div>

              {/* Facebook Messenger */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                    Facebook Messenger
                  </span>
                  <span className="font-bold text-slate-800">2,180 msgs (8.4%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full" style={{ width: '8.4%' }}></div>
                </div>
              </div>

              {/* SMS Gateway */}
              <div>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="font-semibold text-slate-700 flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                    SMS Gateway
                  </span>
                  <span className="font-bold text-slate-800">1,200 msgs (4.6%)</span>
                </div>
                <div className="w-full bg-slate-100 h-2.5 rounded-full overflow-hidden">
                  <div className="bg-amber-500 h-full rounded-full" style={{ width: '4.6%' }}></div>
                </div>
              </div>
            </div>
          </div>

          {/* Active Omnichannel Inquiries Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h4 className="text-sm font-bold text-slate-800">Recent Customer Inquiries</h4>
                <p className="text-xs text-slate-400">Live conversations requiring agent attention</p>
              </div>
              <button
                onClick={() => setActiveTab('inbox')}
                className="text-xs font-semibold text-emerald-600 hover:text-emerald-700 flex items-center gap-1"
              >
                View all in Inbox <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="divide-y divide-slate-100">
              {mockConversations.slice(0, 4).map((conv) => (
                <div
                  key={conv.id}
                  onClick={() => {
                    onSelectConversation(conv.id);
                    setActiveTab('inbox');
                  }}
                  className="p-4 hover:bg-slate-50 transition-colors cursor-pointer flex items-center justify-between gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="relative">
                      {/* <img
                        src={conv.customer.avatar}
                        alt={conv.customer.name}
                        className="w-10 h-10 rounded-full object-cover border border-slate-200"
                      /> */}
                      <span
                        className={`absolute -bottom-1 -right-1 p-0.5 rounded-full border-2 border-white ${conv.channel === 'whatsapp'
                            ? 'bg-emerald-500 text-white'
                            : conv.channel === 'instagram'
                              ? 'bg-pink-500 text-white'
                              : conv.channel === 'messenger'
                                ? 'bg-blue-500 text-white'
                                : 'bg-amber-500 text-white'
                          }`}
                      >
                        {conv.channel === 'whatsapp' && <MessageSquare className="w-2.5 h-2.5" />}
                        {conv.channel === 'instagram' && <Camera className="w-2.5 h-2.5" />}
                        {conv.channel === 'messenger' && <Send className="w-2.5 h-2.5" />}
                        {conv.channel === 'sms' && <Smartphone className="w-2.5 h-2.5" />}
                      </span>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-800 truncate">{conv.customer.name}</span>
                        {conv.customer.cart && (
                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">
                            Cart: ₹{conv.customer.cart.value}
                          </span>
                        )}
                        {conv.unreadCount > 0 && (
                          <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                        )}
                      </div>
                      <p className="text-xs text-slate-500 truncate max-w-md mt-0.5">
                        {conv.lastMessage?.text}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <span className="text-[11px] text-slate-400 font-medium block">{conv.updatedAt}</span>
                    <span
                      className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${conv.status === 'open'
                          ? 'bg-emerald-100 text-emerald-800'
                          : conv.status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : 'bg-slate-100 text-slate-600'
                        }`}
                    >
                      {conv.status.toUpperCase()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Automated Flow Status & Abandoned Cart Recovery Widget */}
        <div className="space-y-6">
          {/* Active Automations Health */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <h4 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Zap className="w-4 h-4 text-emerald-600" />
                Live Shopify Triggers
              </h4>
              <button
                onClick={() => setActiveTab('automations')}
                className="text-xs text-emerald-600 font-semibold hover:underline"
              >
                Manage
              </button>
            </div>

            <div className="space-y-3">
              {mockAutomations.map((flow) => (
                <div
                  key={flow.id}
                  className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 flex items-center justify-between hover:bg-slate-50 transition-colors"
                >
                  <div className="min-w-0 pr-2">
                    <p className="text-xs font-bold text-slate-800 truncate">{flow.title}</p>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-1">
                      <span>{flow.totalTriggered} triggered</span>
                      <span>•</span>
                      <span className="text-emerald-600 font-semibold">{flow.conversionRate}% conv</span>
                    </div>
                  </div>
                  <div className="shrink-0 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                    <span className="text-[11px] font-bold text-slate-600">Active</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Broadcast Campaign Performance */}
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-bold text-slate-800">Top Campaign</h4>
              <button
                onClick={() => setActiveTab('broadcast')}
                className="text-xs text-emerald-600 font-semibold hover:underline"
              >
                View all
              </button>
            </div>

            {mockCampaigns[0] && (
              <div className="p-3.5 rounded-xl bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200/80">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-emerald-900 truncate">
                    {mockCampaigns[0].name}
                  </span>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-200 text-emerald-800">
                    ACTIVE
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 mt-3 pt-3 border-t border-emerald-200/60">
                  <div>
                    <span className="text-[10px] text-emerald-700 font-medium">Sent & Delivered</span>
                    <p className="text-sm font-bold text-emerald-950">
                      {mockCampaigns[0].deliveredCount.toLocaleString()} / {mockCampaigns[0].sentCount.toLocaleString()}
                    </p>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-700 font-medium">Revenue Generated</span>
                    <p className="text-sm font-bold text-emerald-950">
                      ₹{mockCampaigns[0].revenue.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
