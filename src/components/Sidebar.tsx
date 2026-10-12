'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  MessageSquare,
  Users,
  BarChart3,
  Send,
  Zap,
  FileText,
  Settings,
  Bell,
  MessageCircle,
  Layers,
  User as UserIcon,
  LogOut,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

export type TabType =
  | 'dashboard'
  | 'inbox'
  | 'analytics'
  | 'broadcast'
  | 'automations'
  | 'templates'
  | 'contacts'
  | 'meta'
  | 'settings';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  unreadCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, unreadCount = 12 }) => {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Close profile menu on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (profileMenuRef.current && !profileMenuRef.current.contains(event.target as Node)) {
        setShowProfileMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleLogout = async () => {
    try {
      await logout();
      router.replace('/login');
    } catch (err) {
      console.error('Logout error:', err);
    }
  };

  // Helper for user initials
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
    <aside className="w-14 md:w-16 bg-[#091512] text-slate-400 flex flex-col items-center py-3.5 shrink-0 border-r border-[#132720] select-none justify-between h-full z-20">
      {/* Top Section: App Logo & Primary Nav */}
      <div className="flex flex-col items-center gap-5 w-full">
        {/* Brand Logo */}
        <button
          onClick={() => setActiveTab('inbox')}
          className="w-10 h-10 rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#4f46e5] flex items-center justify-center text-white font-black text-lg shadow-lg shadow-blue-950/40 transition-all hover:scale-105 active:scale-95 cursor-pointer"
          title="Omnichannel Command Desk"
        >
          O
        </button>



        {/* Meta Cloud Hub */}
        {/* <button
          onClick={() => setActiveTab('meta')}
          title="Meta WhatsApp Hub & Templates"
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'meta'
              ? 'text-white bg-[#163328]'
              : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
            }`}
        >
          <Layers className="w-4 h-4 stroke-[1.8]" />
        </button> */}

        {/* Navigation Items */}
        <div className="flex flex-col items-center gap-3 w-full px-2">
          {/* Inbox / Messages (Active item with red badge 12) */}
          <div className="relative w-full flex justify-center">
            <button
              onClick={() => setActiveTab('inbox')}
              title="Inbox & Live Chats"
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'inbox'
                ? 'text-white bg-[#163328]'
                : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
                }`}
            >
              <MessageSquare className="w-5 h-5 stroke-[1.8]" />
            </button>
            {/* Red Badge with count 12 */}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-[#ef4444] text-white text-[10px] font-bold flex items-center justify-center ring-2 ring-[#091512] shadow-sm">
                {unreadCount}
              </span>
            )}
          </div>

          {/* Contacts / Users */}
          {/* <button
            onClick={() => setActiveTab('contacts')}
            title="Contacts & Customers"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'contacts'
              ? 'text-white bg-[#163328]'
              : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
              }`}
          >
            <Users className="w-5 h-5 stroke-[1.8]" />
          </button> */}

          {/* Broadcasts */}
          {/* <button
            onClick={() => setActiveTab('broadcast')}
            title="Campaigns & Broadcasts"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'broadcast'
              ? 'text-white bg-[#163328]'
              : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
              }`}
          >
            <Send className="w-4 h-4 stroke-[1.8]" />
          </button> */}

          {/* Automations */}
          {/* <button
            onClick={() => setActiveTab('automations')}
            title="Automations & Triggers"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'automations'
              ? 'text-white bg-[#163328]'
              : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
              }`}
          >
            <Zap className="w-4 h-4 stroke-[1.8]" />
          </button> */}

          {/* Templates */}
          {/* <button
            onClick={() => setActiveTab('templates')}
            title="WhatsApp Templates"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'templates'
              ? 'text-white bg-[#163328]'
              : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
              }`}
          >
            <FileText className="w-4 h-4 stroke-[1.8]" />
          </button> */}

          {/* Analytics */}
          {/* <button
            onClick={() => setActiveTab('analytics')}
            title="Analytics"
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'analytics'
              ? 'text-white bg-[#163328]'
              : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
              }`}
          >
            <BarChart3 className="w-4 h-4 stroke-[1.8]" />
          </button> */}

        </div>
      </div>

      {/* Bottom Section: Notification Bell & User Avatar */}
      <div className="flex flex-col items-center gap-3.5 w-full relative" ref={profileMenuRef}>
        {/* Settings button */}
        {/* <button
          onClick={() => setActiveTab('settings')}
          title="Settings & Channels"
          className={`w-10 h-10 rounded-xl flex items-center justify-center transition-all ${activeTab === 'settings'
            ? 'text-white bg-[#163328]'
            : 'text-slate-400 hover:text-white hover:bg-[#12241d]'
            }`}
        >
          <Settings className="w-4 h-4 stroke-[1.8]" />
        </button> */}

        {/* Notification Bell */}
        {/* <button
          title="Notifications"
          className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-400 hover:text-white hover:bg-[#12241d] transition-all relative cursor-pointer"
        >
          <Bell className="w-4 h-4 stroke-[1.8]" />
          <span className="absolute top-2 right-2.5 w-1.5 h-1.5 rounded-full bg-[#00a884]"></span>
        </button> */}

        {/* User Avatar with Online Dot & Clickable Profile Menu */}
        <div className="relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            title="User Profile & Settings"
            className="w-9 h-9 rounded-full bg-[#008069] hover:bg-[#009b7f] flex items-center justify-center text-white font-bold text-xs tracking-tight shadow-md ring-2 ring-[#00a884]/30 transition-all hover:scale-105 cursor-pointer overflow-hidden"
          >
            {user?.photoURL ? (
              <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
            ) : (
              <span>{getInitials()}</span>
            )}
          </button>
          <span className="absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full bg-[#22c55e] ring-2 ring-[#091512]"></span>

          {/* Profile Popover Menu */}
          {showProfileMenu && (
            <div className="absolute left-14 bottom-0 w-64 bg-[#0b1613] border border-slate-800 rounded-xl shadow-2xl p-3 z-50 text-xs animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center gap-3 pb-3 mb-2 border-b border-slate-800">
                <div className="w-9 h-9 rounded-full bg-[#008069] flex items-center justify-center text-white font-bold text-xs shrink-0 overflow-hidden">
                  {user?.photoURL ? (
                    <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span>{getInitials()}</span>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-white truncate">
                    {user?.displayName || 'Support Agent'}
                  </p>
                  <p className="text-[11px] text-slate-400 truncate">
                    {user?.email || 'agent@omnichannel.io'}
                  </p>
                </div>
              </div>

              <div className="space-y-1">
                <button
                  onClick={() => {
                    setActiveTab('settings');
                    setShowProfileMenu(false);
                  }}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800/60 transition-colors text-left cursor-pointer"
                >
                  <UserIcon className="w-3.5 h-3.5 text-slate-400" />
                  <span>Account Settings</span>
                </button>

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 transition-colors text-left font-medium cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  <span>Sign Out</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
};

