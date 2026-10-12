'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Search, 
  Bell, 
  MessageCircle, 
  Send, 
  Smartphone, 
  Plus, 
  RefreshCw,
  Layers,
  Camera,
  LogOut,
  User as UserIcon,
} from 'lucide-react';
import { TabType } from './Sidebar';
import { WhatsAppConnectButton } from './whatsapp/WhatsAppConnectButton';
import { useAuth } from '../context/AuthContext';

interface HeaderProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  onOpenQuickBroadcast?: () => void;
}

export const Header: React.FC<HeaderProps> = ({ activeTab, setActiveTab, onOpenQuickBroadcast }) => {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showNotifications, setShowNotifications] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRefresh = () => {
    setIsRefreshing(true);
    setTimeout(() => setIsRefreshing(false), 800);
  };

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  const getInitials = () => {
    if (user?.displayName) {
      const parts = user.displayName.trim().split(' ');
      if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
      return parts[0].slice(0, 2).toUpperCase();
    }
    if (user?.email) {
      return user.email.slice(0, 2).toUpperCase();
    }
    return 'AG';
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between z-10">
      {/* Left: Global Search & Omnichannel status */}
      <div className="flex items-center gap-4 flex-1 max-w-xl">
        <div className="relative w-full">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search chats, customer phone #, Shopify orders (#10521)..."
            className="w-full pl-9 pr-4 py-2 text-xs bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white transition-all"
          />
        </div>
      </div>

      {/* Center: Connected Channels Live Status Badges */}
      <div className="hidden lg:flex items-center gap-2 bg-slate-50 px-3 py-1.5 rounded-full border border-slate-200 text-xs text-slate-600">
        <span className="text-[11px] font-semibold text-slate-400 mr-1 flex items-center gap-1">
          <Layers className="w-3.5 h-3.5 text-emerald-600" /> Channels:
        </span>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 font-medium border border-emerald-200">
          <MessageCircle className="w-3.5 h-3.5 text-emerald-600 fill-emerald-100" />
          <span>WhatsApp API</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-pink-50 text-pink-700 font-medium border border-pink-200">
          <Camera className="w-3.5 h-3.5 text-pink-600" />
          <span>Instagram DM</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 font-medium border border-blue-200">
          <Send className="w-3.5 h-3.5 text-blue-600" />
          <span>Messenger</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        </div>
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 font-medium border border-amber-200">
          <Smartphone className="w-3.5 h-3.5 text-amber-600" />
          <span>SMS Gateway</span>
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
        </div>
      </div>

      {/* Right: Quick actions, notifications, status, user profile */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleRefresh}
          className={`p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer ${
            isRefreshing ? 'animate-spin text-emerald-600' : ''
          }`}
          title="Sync Meta & Shopify data"
        >
          <RefreshCw className="w-4 h-4" />
        </button>

        {/* WhatsApp Connect Button */}
        <WhatsAppConnectButton storeId="pingcart-store.myshopify.com" />

        {/* Create Broadcast Quick Button */}
        <button
          onClick={() => {
            if (onOpenQuickBroadcast) {
              onOpenQuickBroadcast();
            } else {
              setActiveTab('broadcast');
            }
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold shadow-sm shadow-emerald-600/30 transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5" />
          <span>New Broadcast</span>
        </button>

        {/* Notifications Dropdown */}
        <div className="relative">
          <button
            onClick={() => setShowNotifications(!showNotifications)}
            className="p-2 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-lg relative transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-emerald-500 rounded-full ring-2 ring-white"></span>
          </button>

          {showNotifications && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-xl border border-slate-200 py-2 z-50 text-xs">
              <div className="px-3 py-2 border-b border-slate-100 flex items-center justify-between">
                <span className="font-bold text-slate-800">Recent Notifications</span>
                <span className="text-[10px] text-emerald-600 font-semibold cursor-pointer">Mark all read</span>
              </div>
              <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
                <div className="p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-2">
                    <span className="p-1 rounded bg-emerald-100 text-emerald-700">🛒</span>
                    <div>
                      <p className="font-semibold text-slate-800">Cart Recovered: ₹3,499</p>
                      <p className="text-slate-500 text-[11px]">Customer Ananya D. completed checkout via WhatsApp reminder.</p>
                      <p className="text-[10px] text-slate-400 mt-1">5m ago</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-2">
                    <span className="p-1 rounded bg-blue-100 text-blue-700">📦</span>
                    <div>
                      <p className="font-semibold text-slate-800">COD Verified Automatically</p>
                      <p className="text-slate-500 text-[11px]">Order #10528 confirmed by customer Vikram Sengupta.</p>
                      <p className="text-[10px] text-slate-400 mt-1">28m ago</p>
                    </div>
                  </div>
                </div>
                <div className="p-3 hover:bg-slate-50 transition-colors">
                  <div className="flex items-start gap-2">
                    <span className="p-1 rounded bg-purple-100 text-purple-700">📢</span>
                    <div>
                      <p className="font-semibold text-slate-800">Broadcast Completed</p>
                      <p className="text-slate-500 text-[11px]">Diwali VIP Broadcast reached 8,320 contacts with 85.8% read rate.</p>
                      <p className="text-[10px] text-slate-400 mt-1">2h ago</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* User Pill & Quick Logout */}
        <div className="hidden sm:flex items-center gap-2 pl-2 border-l border-slate-200">
          <div className="flex items-center gap-2 px-2.5 py-1 bg-slate-100 hover:bg-slate-200/80 rounded-full border border-slate-200 transition-colors">
            <div className="w-5 h-5 rounded-full bg-emerald-700 text-white flex items-center justify-center font-bold text-[10px] overflow-hidden">
              {user?.photoURL ? (
                <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{getInitials()}</span>
              )}
            </div>
            <span className="text-xs font-semibold text-slate-700 max-w-[120px] truncate">
              {user?.displayName || user?.email?.split('@')[0] || 'Agent'}
            </span>
          </div>

          <button
            onClick={handleLogout}
            title="Sign Out"
            className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </header>
  );
};

