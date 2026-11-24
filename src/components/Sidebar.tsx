'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import {
  BarChart3,
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileText,
  Inbox,
  LayoutGrid,
  Lock,
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
import apiClient from '@/lib/api/client';

/** Kept for backwards-compat with any component that imports TabType */
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

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Path to navigate to; determines active state */
  path?: string;
  /** Prefix to match for active state (useful for nested routes) */
  activePrefix?: string;
  badge?: 'unread' | 'ai';
}

const WORKSPACE_ITEMS: NavItem[] = [
  { key: 'home', label: 'Home', icon: LayoutGrid, path: '/dashboard' },
  { key: 'inbox', label: 'Inbox', icon: Inbox, path: '/inbox', activePrefix: '/inbox', badge: 'unread' },
  { key: 'contacts', label: 'Contacts', icon: Users, path: '/contacts' },
  { key: 'ai', label: 'AI agent', icon: Sparkles, path: '/ai-agent', activePrefix: '/ai-agent', badge: 'ai' },
  { key: 'flows', label: 'Flows', icon: Bot, path: '/flows/automations', activePrefix: '/flows' },
  // RBAC key stays 'broadcasts' (Settings → Roles labels it "Campaigns")
  { key: 'broadcasts', label: 'Campaigns', icon: Megaphone, path: '/campaigns', activePrefix: '/campaigns' },
  { key: 'templates', label: 'Templates', icon: FileText, path: '/templates' },
  { key: 'analytics', label: 'Analytics', icon: BarChart3 },
];

const SETUP_ITEMS: NavItem[] = [
  { key: 'integrations', label: 'Integrations', icon: Plug, path: '/integrations', activePrefix: '/integrations' },
  { key: 'settings', label: 'Settings', icon: Settings, path: '/settings' },
];

const initialsOf = (value?: string | null, fallback = '?') => {
  if (!value) return fallback;
  const parts = value.trim().split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return parts[0].slice(0, 2).toUpperCase();
};

interface SidebarProps {
  activeTab?: string;
  setActiveTab?: (tab: string) => void;
  unreadCount?: number;
  aiCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, unreadCount = 0, aiCount = 0 }) => {
  const { user, dbUser, logout, hasPermission, can } = useAuth();
  const canManageBillingAndIntegrations = hasPermission('manage_billing_and_integrations');
  const router = useRouter();
  const pathname = usePathname();
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  /** Locked = expanded via the button; stays open regardless of hover */
  const [isLocked, setIsLocked] = useState(true);
  /** Temporarily expanded because the mouse is over the sidebar */
  const [isHovered, setIsHovered] = useState(false);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isExpanded = isLocked || isHovered;
  const isCollapsed = !isExpanded;
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const [channelCount, setChannelCount] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    apiClient
      .get<{ channels: any[] }>('/api/channels')
      .then((res) => {
        if (isMounted && res.data?.channels) {
          setChannelCount(res.data.channels.length);
        }
      })
      .catch(() => {});
    return () => {
      isMounted = false;
    };
  }, [dbUser?.organizationId]);

  // Restore collapse preference from localStorage
  useEffect(() => {
    try {
      const saved = localStorage.getItem('unocx_sidebar_collapsed');
      if (saved !== null) {
        setIsLocked(saved !== 'true');
      }
    } catch {
      // Ignore localStorage errors (e.g. private mode)
    }
  }, []);

  useEffect(() => () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
  }, []);

  /** Button: lock open, or unlock and collapse immediately */
  const toggleLock = () => {
    const nextLocked = !isLocked;
    setIsLocked(nextLocked);
    // When unlocking, collapse right away even though the cursor is still over the sidebar
    if (!nextLocked) setIsHovered(false);
    try {
      localStorage.setItem('unocx_sidebar_collapsed', String(!nextLocked));
    } catch {
      // Ignore
    }
  };

  const handleMouseEnter = () => {
    if (isLocked) return;
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Small delay so just passing the cursor across doesn't flash it open
    hoverTimerRef.current = setTimeout(() => setIsHovered(true), 120);
  };

  const handleMouseLeave = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = null;
    if (isLocked) return;
    setIsHovered(false);
    setShowProfileMenu(false);
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
  const orgName = dbUser?.organizationName || 'Workspace';
  const orgInitials = initialsOf(orgName, 'WS');
  const planName = dbUser?.organizationPlan
    ? dbUser.organizationPlan.charAt(0).toUpperCase() + dbUser.organizationPlan.slice(1).toLowerCase()
    : 'Growth';
  const seatsLimit = dbUser?.organizationSeats || 10;

  const badgeFor = (item: NavItem) => (item.badge === 'unread' ? unreadCount : item.badge === 'ai' ? aiCount : 0);

  const isActive = (item: NavItem) => {
    if (!item.path) return false;
    if (item.activePrefix) return pathname?.startsWith(item.activePrefix);
    return pathname === item.path;
  };

  const isItemRestricted = (item: NavItem) => {
    if (!can(item.key, 'read')) return true;
    if (item.key === 'integrations' && !canManageBillingAndIntegrations) return true;
    return false;
  };

  const handleItemClick = (item: NavItem) => {
    if (isItemRestricted(item)) {
      gooeyToast.error(`${item.label} access is restricted`);
      return;
    }
    if (item.path) {
      router.push(item.path);
    } else {
      gooeyToast.info(`${item.label} is coming soon`);
    }
  };

  return (
    // Outer wrapper reserves layout space: full width only when locked open.
    // On hover, the inner aside expands over the page content instead of pushing it.
    <div
      className={`relative shrink-0 h-full z-30 transition-[width] duration-200 ease-in-out ${isLocked ? 'w-[240px]' : 'w-[68px]'}`}
    >
    <aside
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      className={`absolute inset-y-0 left-0 bg-white border-r border-slate-200 flex flex-col h-full overflow-hidden select-none transition-[width,box-shadow] duration-200 ease-in-out ${isCollapsed ? 'w-[68px]' : 'w-[240px]'
        } ${isHovered && !isLocked ? 'shadow-2xl' : ''}`}
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
              onClick={toggleLock}
              title={isLocked ? 'Collapse sidebar' : 'Keep sidebar open'}
              className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer transition-colors shrink-0"
            >
              {isLocked ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
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
                  {channelCount !== null ? `${channelCount} ${channelCount === 1 ? 'channel' : 'channels'}` : 'Omnichannel'} · {planName}
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
                  const active = isActive(item);
                  const badge = badgeFor(item);
                  const isRestricted = isItemRestricted(item);
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleItemClick(item)}
                      title={isRestricted ? `${item.label} · restricted` : item.path ? item.label : `${item.label} · coming soon`}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#eef0fb] text-[#3440a8] font-bold'
                          : isRestricted
                            ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            : 'text-black hover:text-black hover:bg-slate-100/70'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] stroke-[1.8] shrink-0 ${
                          active ? 'text-[#3440a8]' : isRestricted ? 'text-slate-400' : 'text-black'
                        }`}
                      />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {isRestricted && (
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
                      {badge > 0 && !isRestricted && (
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
                  const active = isActive(item);
                  const badge = badgeFor(item);
                  const isRestricted = isItemRestricted(item);
                  return (
                    <button
                      key={item.key}
                      onClick={() => handleItemClick(item)}
                      title={isRestricted ? `${item.label} · restricted` : item.path ? item.label : `${item.label} · coming soon`}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] font-medium transition-colors cursor-pointer ${
                        active
                          ? 'bg-[#eef0fb] text-[#3440a8] font-bold'
                          : isRestricted
                            ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                            : 'text-black hover:text-black hover:bg-slate-100/70'
                      }`}
                    >
                      <Icon
                        className={`w-[18px] h-[18px] stroke-[1.8] shrink-0 ${active ? 'text-[#3440a8]' : 'text-black'
                          }`}
                      />
                      <span className="flex-1 text-left truncate">{item.label}</span>
                      {isRestricted && (
                        <Lock className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      )}
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
          {canManageBillingAndIntegrations && (
            <div className="px-3 py-2 shrink-0">
              <div className="p-3 rounded-xl bg-[#f4f6fa] border border-slate-100">
                <div className="flex items-center justify-between gap-1 text-[12px] font-semibold text-slate-800 leading-tight">
                  <span>{planName} · {seatsLimit} seats</span>
                  {dbUser?.organizationTrial && (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-100/80 px-1.5 py-0.5 rounded">
                      {dbUser.organizationTrial.isExpired ? 'Expired' : `${dbUser.organizationTrial.daysLeft}d left`}
                    </span>
                  )}
                </div>
                <div className="text-[11px] text-slate-500 mt-1 leading-tight">
                  AI resolutions 214 / 300
                </div>
                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2.5 overflow-hidden">
                  <div className="h-full bg-[#3440a8] rounded-full w-[71%]" />
                </div>
              </div>
            </div>
          )}

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
              onClick={toggleLock}
              title="Expand sidebar"
              className="w-7 h-7 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center justify-center cursor-pointer transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>

            <div
              className="w-8 h-8 rounded-full bg-[#fde8ef] text-[#c0365f] flex items-center justify-center font-semibold text-xs cursor-pointer shadow-2xs hover:opacity-90"
              title={`${orgName} · ${planName} plan`}
            >
              {orgInitials}
            </div>
          </div>

          {/* Navigation icons */}
          <nav className="flex-1 overflow-y-auto px-2 py-2 flex flex-col items-center gap-1.5">
            {WORKSPACE_ITEMS.map((item) => {
              const Icon = item.icon;
              const active = isActive(item);
              const badge = badgeFor(item);
              const isRestricted = isItemRestricted(item);
              return (
                <div key={item.key} className="relative">
                  <button
                    onClick={() => handleItemClick(item)}
                    title={isRestricted ? `${item.label} · restricted` : item.path ? item.label : `${item.label} · coming soon`}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      active ? 'bg-[#eef0fb] text-[#3440a8]' : isRestricted ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50' : 'text-black hover:text-black hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-[19px] h-[19px] stroke-[1.8]" />
                  </button>
                  {isRestricted && (
                    <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center pointer-events-none">
                      <Lock className="w-2 h-2 text-slate-500" />
                    </span>
                  )}
                  {badge > 0 && !isRestricted && (
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
              const active = isActive(item);
              const badge = badgeFor(item);
              const isRestricted = item.key === 'integrations' && !canManageBillingAndIntegrations;
              return (
                <div key={item.key} className="relative">
                  <button
                    onClick={() => handleItemClick(item)}
                    title={isRestricted ? `${item.label} · restricted` : item.path ? item.label : `${item.label} · coming soon`}
                    className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors cursor-pointer ${
                      active ? 'bg-[#eef0fb] text-[#3440a8]' : isRestricted ? 'text-slate-400 hover:text-slate-600 hover:bg-slate-50' : 'text-black hover:text-black hover:bg-slate-100'
                    }`}
                  >
                    <Icon className="w-[19px] h-[19px] stroke-[1.8]" />
                  </button>
                  {isRestricted && (
                    <span className="absolute -bottom-1 -right-1 w-3.5 h-3.5 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center pointer-events-none">
                      <Lock className="w-2 h-2 text-slate-500" />
                    </span>
                  )}
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
    </div>
  );
};
