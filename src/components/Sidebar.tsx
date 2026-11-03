'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  LayoutGrid,
  LogOut,
  Megaphone,
  MoreHorizontal,
  Plug,
  Settings,
  Sparkles,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { gooeyToast } from '@/components/ui/goey-toaster';

export type TabType =
  | 'dashboard'
  | 'inbox'
  | 'analytics'
  | 'broadcast'
  | 'automations'
  | 'templates'
  | 'contacts'
  | 'meta'
  | 'settings'
  | 'integrations';

interface SidebarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  unreadCount?: number;
  aiCount?: number;
}

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  tab?: TabType; // Only items with a tab are built; the rest show "coming soon"
  badge?: 'unread' | 'ai';
}

const WORKSPACE_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: LayoutGrid, tab: 'dashboard' },
  { key: 'inbox', label: 'Inbox', icon: Inbox, tab: 'inbox', badge: 'unread' },
  { key: 'contacts', label: 'Contacts', icon: Users },
  { key: 'ai', label: 'AI agent', icon: Sparkles, badge: 'ai' },
  { key: 'flows', label: 'Flows', icon: Bot, tab: 'automations' },
  { key: 'broadcasts', label: 'Broadcasts', icon: Megaphone },
  { key: 'templates', label: 'Templates', icon: FileText, tab: 'templates' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
];

const SETUP_ITEMS: NavItem[] = [
  { key: 'integrations', label: 'Integrations', icon: Plug, tab: 'integrations' },
  { key: 'settings', label: 'Settings', icon: Settings, tab: 'settings' },
];

const initialsOf = (value?: string | null, fallback = '?') => {
  if (!value) return fallback;
  const parts = value.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, unreadCount = 0, aiCount = 0 }) => {
  const { user, dbUser, logout } = useAuth();
  const router = useRouter();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Restore collapse preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('unocx_sidebar_collapsed');
      if (saved !== null) {
        setIsCollapsed(saved === 'true');
      }
    } catch {
      // Ignore localStorage errors (e.g. private mode)
    }
  }, []);

  const toggleCollapse = () => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('unocx_sidebar_collapsed', String(next));
      } catch {
        // Ignore
      }
      return next;
    });
  };

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

  const userName = dbUser?.name || user?.displayName || user?.email || 'Arun Kumar';
  const userInitials = initialsOf(dbUser?.name || user?.displayName, user?.email?.slice(0, 2).toUpperCase() || 'AK');
  const orgName = dbUser?.organizationName || 'Noctylle';
  const orgInitials = initialsOf(orgName, 'NC');

  const badgeFor = (item: NavItem) => (item.badge === 'unread' ? unreadCount : item.badge === 'ai' ? aiCount : 0);

  const handleItemClick = (item: NavItem) => {
    if (item.tab) {
      setActiveTab(item.tab);
    } else {
      gooeyToast.info(`${item.label} is coming soon`);
    }
  };

  return (
    <aside
      className={`bg-white border-r border-slate-200 flex flex-col shrink-0 h-full select-none z-20 transition-[width] duration-200 ease-in-out ${
        isCollapsed ? 'w-[68px]' : 'w-[240px]'
      }`}
    >
      {/* ============================================================ */}
      {/* EXPANDED VIEW                                                */}
      {/* ============================================================ */}
      {!isCollapsed ? (
        <>
          {/* Header: Product Logo + UnoCX + AI pill + Collapse Button */}
          <div className="h-16 px-4 flex items-center justify-between border-b border-slate-100 shrink-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div
                className="w-9 h-9 rounded-xl bg-[#3440a8] text-white flex items-center justify-center font-bold text-[15px] relative shrink-0 shadow-xs"
                title="UnoCX"
              >
                <span>U</span>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 absolute top-2 right-2" />
              </div>
              <span className="text-[17px] font-bold text-slate-900 tracking-tight">UnoCX</span>
              <span className="px-2 py-0.5 rounded-full bg-[#eef0fb] text-[#3440a8] text-[11px] font-semibold leading-normal">
                AI
              </span>
            </div>

            <button
              onClick={toggleCollapse}
              title="Collapse sidebar"
              className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer transition-colors shrink-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
          </div>

          {/* Workspace card */}
          <div className="px-3 pt-3 pb-1 shrink-0">
            <div className="p-2.5 rounded-xl bg-[#f8f9fc] hover:bg-[#f1f3f9] border border-slate-200/70 transition-colors flex items-center gap-2.5 cursor-pointer">
              <div className="w-8 h-8 rounded-full bg-[#fde8ef] text-[#c0365f] font-semibold text-xs flex items-center justify-center shrink-0">
                {orgInitials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-slate-900 truncate leading-tight">
                  {orgName}
                </div>
                <div className="text-[11px] text-slate-500 truncate leading-tight mt-0.5">
                  Shopify · 3 channels
                </div>
              </div>
              <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
            </div>
          </div>

          {/* Navigation Sections */}
          <nav className="flex-1 overflow-y-auto px-3 py-2 space-y-4 text-[13px]">
            {/* WORKSPACE Group */}
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-bold text-slate-700 tracking-wider uppercase">
                WORKSPACE
              </div>
              <div className="space-y-0.5">
                {WORKSPACE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = item.tab === activeTab;
                  const badge = badgeFor(item);
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleItemClick(item)}
                      title={item.tab ? item.label : `${item.label} · coming soon`}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#eef0fb] text-[#3440a8] font-bold'
                          : 'text-black hover:text-black hover:bg-slate-100/70'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] stroke-[1.8] shrink-0 ${
                          active ? 'text-[#3440a8]' : 'text-black'
                        }`}
                      />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-[#eef0fb] text-[#3440a8] text-[11px] font-bold">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* SETUP Group */}
            <div>
              <div className="px-2 pb-1.5 text-[11px] font-bold text-slate-700 tracking-wider uppercase">
                SETUP
              </div>
              <div className="space-y-0.5">
                {SETUP_ITEMS.map((item) => {
                  const Icon = item.icon;
                  const active = item.tab === activeTab;
                  const badge = badgeFor(item);
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleItemClick(item)}
                      title={item.tab ? item.label : `${item.label} · coming soon`}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#eef0fb] text-[#3440a8] font-bold'
                          : 'text-black hover:text-black hover:bg-slate-100/70'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] stroke-[1.8] shrink-0 ${
                          active ? 'text-[#3440a8]' : 'text-black'
                        }`}
                      />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {badge > 0 && (
                        <span className="px-2 py-0.5 rounded-full bg-[#eef0fb] text-[#3440a8] text-[11px] font-bold">
                          {badge > 99 ? '99+' : badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </nav>

          {/* Plan / Usage Card */}
          <div className="px-3 py-2 shrink-0">
            <div className="p-3 rounded-xl bg-[#f4f6fa] border border-slate-100">
              <div className="text-[12px] font-semibold text-slate-800 leading-tight">
                Growth · 10 seats
              </div>
              <div className="text-[11px] text-slate-500 mt-1 leading-tight">
                AI resolutions 214 / 300
              </div>
              <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2.5 overflow-hidden">
                <div className="h-full bg-[#3440a8] rounded-full w-[71%]" />
              </div>
            </div>
          </div>

          {/* User Profile Card */}
          <div className="border-t border-slate-100 px-3 py-3 shrink-0 relative" ref={profileMenuRef}>
            <div className="flex items-center gap-2.5">
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                title={userName || 'Profile'}
                className="w-9 h-9 rounded-full bg-[#3440a8] text-white flex items-center justify-center font-semibold text-xs overflow-hidden shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
              >
                {user?.photoURL ? (
                  <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
                ) : (
                  <span>{userInitials}</span>
                )}
              </button>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-semibold text-slate-900 truncate leading-tight">
                  {userName}
                </p>
                <p className="text-[11px] text-slate-500 truncate capitalize leading-tight mt-0.5">
                  {dbUser?.role ? dbUser.role.toLowerCase() : 'Owner'}
                </p>
              </div>
              <button
                onClick={() => setShowProfileMenu(!showProfileMenu)}
                title="Profile menu"
                className="w-7 h-7 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 flex items-center justify-center cursor-pointer transition-colors shrink-0"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>

            {showProfileMenu && (
              <div className="absolute left-3 bottom-14 w-56 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-50 text-xs">
                <div className="px-2 py-2 mb-1 border-b border-slate-100">
                  <p className="font-semibold text-slate-900 truncate">
                    {dbUser?.name || user?.displayName || 'Support Agent'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                  {orgName && <p className="text-[11px] text-slate-400 truncate mt-0.5">{orgName}</p>}
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 font-medium cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ============================================================ */
        /* COLLAPSED VIEW                                               */
        /* ============================================================ */
        <>
          {/* Collapsed Top: Logo, Expand button, and Workspace circle */}
          <div className="pt-3 pb-2 px-2 flex flex-col items-center gap-2 shrink-0 border-b border-slate-100">
            <div
              className="w-9 h-9 rounded-xl bg-[#3440a8] text-white flex items-center justify-center font-bold text-[15px] relative shrink-0 shadow-xs"
              title="UnoCX"
            >
              <span>U</span>
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-300 absolute top-2 right-2" />
            </div>

            <button
              onClick={toggleCollapse}
              title="Expand sidebar"
              className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div
              className="w-8 h-8 rounded-full bg-[#fde8ef] text-[#c0365f] flex items-center justify-center font-semibold text-xs cursor-pointer shadow-2xs hover:opacity-90"
              title={`${orgName} · Shopify`}
            >
              {orgInitials}
            </div>
          </div>

          {/* Navigation icons */}
          <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col items-center gap-1.5">
            {WORKSPACE_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.tab === activeTab;
              const badge = badgeFor(item);
              return (
                <div key={item.key} className="relative">
                  <button
                    onClick={() => handleItemClick(item)}
                    title={item.tab ? item.label : `${item.label} · coming soon`}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      active ? 'bg-[#eef0fb] text-[#3440a8]' : 'text-black hover:text-black hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-[19px] h-[19px] stroke-[1.8]" />
                  </button>
                  {badge > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#3440a8] text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white pointer-events-none">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </div>
              );
            })}

            <div className="w-6 h-px bg-slate-200 my-1 shrink-0" />

            {SETUP_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = item.tab === activeTab;
              const badge = badgeFor(item);
              return (
                <div key={item.key} className="relative">
                  <button
                    onClick={() => handleItemClick(item)}
                    title={item.tab ? item.label : `${item.label} · coming soon`}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      active ? 'bg-[#eef0fb] text-[#3440a8]' : 'text-black hover:text-black hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-[19px] h-[19px] stroke-[1.8]" />
                  </button>
                  {badge > 0 && (
                    <span className="absolute -top-1 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#3440a8] text-white text-[10px] font-semibold flex items-center justify-center ring-2 ring-white pointer-events-none">
                      {badge > 99 ? '99+' : badge}
                    </span>
                  )}
                </div>
              );
            })}
          </nav>

          {/* Profile in collapsed */}
          <div className="border-t border-slate-100 py-3 flex justify-center shrink-0 relative" ref={profileMenuRef}>
            <button
              onClick={() => setShowProfileMenu(!showProfileMenu)}
              title={userName || 'Profile'}
              className="w-9 h-9 rounded-full bg-[#3440a8] text-white flex items-center justify-center font-semibold text-xs overflow-hidden cursor-pointer hover:opacity-90"
            >
              {user?.photoURL ? (
                <img src={user.photoURL} alt="User Avatar" className="w-full h-full object-cover" />
              ) : (
                <span>{userInitials}</span>
              )}
            </button>

            {showProfileMenu && (
              <div className="absolute left-14 bottom-2 w-60 bg-white border border-slate-200 rounded-xl shadow-xl p-2 z-50 text-xs">
                <div className="px-2 py-2 mb-1 border-b border-slate-100">
                  <p className="font-semibold text-slate-900 truncate">
                    {dbUser?.name || user?.displayName || 'Support Agent'}
                  </p>
                  <p className="text-[11px] text-slate-500 truncate">{user?.email}</p>
                  {orgName && <p className="text-[11px] text-slate-400 truncate mt-0.5">{orgName}</p>}
                </div>
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-rose-600 hover:bg-rose-50 font-medium cursor-pointer"
                >
                  <LogOut className="w-3.5 h-3.5" />
                  Sign out
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </aside>
  );
};
