'use client';

import React, { useState, useEffect } from 'react';
import apiClient from '@/lib/api/client';
import {
  GripVertical,
  MoreHorizontal,
  Plus,
  Trash2,
  Clock,
  Calendar,
  Sparkles,
  Bot,
  Check,
  RotateCcw,
  Pencil,
  X,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { gooeyToast } from '@/components/ui/goey-toaster';

// ── Types ──────────────────────────────────────────────────────────────
export interface DaySchedule {
  day: string;
  enabled: boolean;
  start: string;
  end: string;
}

export interface Holiday {
  id: string;
  name: string;
  date: string;
}

export type RoutingStrategy = 'round robin' | 'least busy' | 'direct';

export interface AssignmentRule {
  id: string;
  condition: string;
  conditionLabel: string;
  target: string;
  targetType: 'team' | 'agent';
  strategy: RoutingStrategy;
  isDefault?: boolean;
}

export interface RoutingHoursConfig {
  timezone: string;
  schedule: DaySchedule[];
  afterHoursReply: string;
  holidays: Holiday[];
  assignmentRules: AssignmentRule[];
  firstResponseTargetMin: number;
  botAnswersFirst: boolean;
}

// ── Default Initial State matching the design ──────────────────────────
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const SHORT_DAYS: Record<string, string> = {
  Sunday: 'Sun',
  Monday: 'Mon',
  Tuesday: 'Tue',
  Wednesday: 'Wed',
  Thursday: 'Thu',
  Friday: 'Fri',
  Saturday: 'Sat',
};

export function formatTime12(timeStr: string): string {
  if (!timeStr) return '9:30 AM';
  const [hhStr, mmStr] = timeStr.split(':');
  const hh = parseInt(hhStr, 10);
  const mm = parseInt(mmStr || '0', 10);
  if (isNaN(hh)) return timeStr;
  const period = hh >= 12 ? 'PM' : 'AM';
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  const minuteStr = String(mm).padStart(2, '0');
  return `${hour12}:${minuteStr} ${period}`;
}

export function getNextOpenTimeText(
  schedule: DaySchedule[],
  date: Date = new Date(),
  rawTimezone: string = 'Asia/Kolkata'
): string {
  if (!schedule || schedule.length === 0) return 'Mon 9:30 AM';

  const tz = (rawTimezone || 'Asia/Kolkata').replace(/\s*\(.*\)/, '').trim() || 'Asia/Kolkata';

  let weekday = '';
  let currentHHMM = '';

  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const parts = formatter.formatToParts(date);
    const partMap: Record<string, string> = {};
    for (const p of parts) partMap[p.type] = p.value;
    weekday = partMap.weekday || '';
    const hh = (partMap.hour || '00').padStart(2, '0');
    const mm = (partMap.minute || '00').padStart(2, '0');
    currentHHMM = `${hh}:${mm}`;
  } catch {
    weekday = DAY_NAMES[date.getDay()];
    const hh = String(date.getHours()).padStart(2, '0');
    const mm = String(date.getMinutes()).padStart(2, '0');
    currentHHMM = `${hh}:${mm}`;
  }

  const currentDayIndex = DAY_NAMES.findIndex((d) => d.toLowerCase() === weekday.toLowerCase());
  const todayIndex = currentDayIndex >= 0 ? currentDayIndex : date.getDay();

  // 1. Check if today is open and has not started yet
  const todaySlot = schedule.find((s) => s.day.toLowerCase() === weekday.toLowerCase());
  if (todaySlot && todaySlot.enabled && currentHHMM < todaySlot.start) {
    return `${SHORT_DAYS[todaySlot.day] || todaySlot.day.slice(0, 3)} ${formatTime12(todaySlot.start)}`;
  }

  // 2. Check next 7 days in order
  for (let offset = 1; offset <= 7; offset++) {
    const nextDayIndex = (todayIndex + offset) % 7;
    const nextDayName = DAY_NAMES[nextDayIndex];
    const slot = schedule.find((s) => s.day.toLowerCase() === nextDayName.toLowerCase());

    if (slot && slot.enabled) {
      const shortDay = SHORT_DAYS[slot.day] || slot.day.slice(0, 3);
      const time12 = formatTime12(slot.start);
      return `${shortDay} ${time12}`;
    }
  }

  return 'Mon 9:30 AM';
}

export function updateAfterHoursMessage(currentText: string, nextOpenText: string): string {
  const regex = /(back\s+(?:at|on)\s+)(?:(?:today|tomorrow|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*(?:at\s*)?)?\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?/i;

  if (regex.test(currentText)) {
    return currentText.replace(regex, `$1${nextOpenText}`);
  }

  return `Thanks for your message. Our team is back at ${nextOpenText}. Meanwhile you can track orders, start an exchange or browse the catalog below.`;
}

export function isValidHolidayDateInput(input: string): { valid: boolean; error?: string } {
  const clean = input.trim();
  if (!clean) return { valid: false, error: 'Please enter a date or date range' };

  // 1. Day range with shared month and year: e.g. "14–16 Jan 2027" or "14-16 Jan 2027"
  const dayRangeMatch = clean.match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (dayRangeMatch) {
    const startDay = parseInt(dayRangeMatch[1], 10);
    const endDay = parseInt(dayRangeMatch[2], 10);
    const monthStr = dayRangeMatch[3];
    const yearStr = dayRangeMatch[4] || String(new Date().getFullYear());
    const testDate = new Date(`${monthStr} 1, ${yearStr}`);
    if (isNaN(testDate.getTime())) {
      return { valid: false, error: 'Invalid month in range (e.g. 14–16 Jan 2027)' };
    }
    if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) {
      return { valid: false, error: 'Day must be between 1 and 31' };
    }
    if (startDay > endDay) {
      return { valid: false, error: 'Start day cannot be greater than end day' };
    }
    return { valid: true };
  }

  // 2. Full date range: e.g. "14 Jan 2027 - 16 Jan 2027" or "2027-01-14 to 2027-01-16"
  const fullRangeSplit = clean.split(/\s+(?:to|-|–|—)\s+/i);
  if (fullRangeSplit.length === 2 && !clean.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const d1 = new Date(fullRangeSplit[0].trim());
    const d2 = new Date(fullRangeSplit[1].trim());
    if (isNaN(d1.getTime()) || isNaN(d2.getTime())) {
      return { valid: false, error: 'Invalid dates in range (e.g. 14 Jan 2027 - 16 Jan 2027)' };
    }
    if (d1.getTime() > d2.getTime()) {
      return { valid: false, error: 'Start date cannot be after end date' };
    }
    return { valid: true };
  }

  // 3. Single date: e.g. "1 Jan 2027", "8 Nov 2026", "2026-11-08"
  const parsed = new Date(clean);
  if (isNaN(parsed.getTime())) {
    return { valid: false, error: 'Invalid date (e.g. 1 Jan 2027 or 14–16 Jan 2027)' };
  }

  return { valid: true };
}

const DEFAULT_CONFIG: RoutingHoursConfig = {
  timezone: 'Asia/Kolkata (IST)',
  schedule: [
    { day: 'Monday', enabled: true, start: '09:30', end: '19:00' },
    { day: 'Tuesday', enabled: true, start: '09:30', end: '19:00' },
    { day: 'Wednesday', enabled: true, start: '09:30', end: '19:00' },
    { day: 'Thursday', enabled: true, start: '09:30', end: '19:00' },
    { day: 'Friday', enabled: true, start: '09:30', end: '19:00' },
    { day: 'Saturday', enabled: true, start: '10:00', end: '16:00' },
    { day: 'Sunday', enabled: false, start: '09:30', end: '18:00' },
  ],
  afterHoursReply:
    'Thanks for your message. Our team is back at 9:30 AM. Meanwhile you can track orders, start an exchange or browse the catalog below.',
  holidays: [
    { id: 'h1', name: 'Deepavali', date: '8 Nov 2026' },
    { id: 'h2', name: 'Pongal', date: '14–16 Jan 2027' },
    { id: 'h3', name: 'Republic Day', date: '26 Jan 2027' },
  ],
  assignmentRules: [
    {
      id: 'r1',
      condition: 'tag',
      conditionLabel: 'tag is Wholesale',
      target: 'Sales team',
      targetType: 'team',
      strategy: 'round robin',
    },
    {
      id: 'r2',
      condition: 'language',
      conditionLabel: 'language is Tamil',
      target: 'Tamil-speaking agents',
      targetType: 'team',
      strategy: 'least busy',
    },
    {
      id: 'r3',
      condition: 'order_value',
      conditionLabel: 'order value ≥ ₹5,000',
      target: 'Suresh R.',
      targetType: 'agent',
      strategy: 'direct',
    },
    {
      id: 'r-default',
      condition: 'fallback',
      conditionLabel: 'any chat',
      target: 'Support team',
      targetType: 'team',
      strategy: 'round robin',
      isDefault: true,
    },
  ],
  firstResponseTargetMin: 10,
  botAnswersFirst: true,
};

export const RoutingHoursSection: React.FC = () => {
  const [config, setConfig] = useState<RoutingHoursConfig>(DEFAULT_CONFIG);
  const [savedConfig, setSavedConfig] = useState<RoutingHoursConfig>(DEFAULT_CONFIG);
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiClient
      .get('/api/settings/routing')
      .then((res) => {
        if (!cancelled && res.data?.success && res.data.routingConfig) {
          const loaded: RoutingHoursConfig = {
            ...DEFAULT_CONFIG,
            ...res.data.routingConfig,
            // Strictly preserve the saved assignment rules if present
            assignmentRules: Array.isArray(res.data.routingConfig.assignmentRules)
              ? res.data.routingConfig.assignmentRules
              : DEFAULT_CONFIG.assignmentRules,
          };
          // Dynamically synchronize the after-hours reply next-open time with the active schedule
          const nextOpen = getNextOpenTimeText(loaded.schedule, new Date(), loaded.timezone);
          loaded.afterHoursReply = updateAfterHoursMessage(loaded.afterHoursReply, nextOpen);

          setConfig(loaded);
          setSavedConfig(loaded);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  // Modal states
  const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [newRuleConditionType, setNewRuleConditionType] = useState('tag');
  const [newRuleConditionValue, setNewRuleConditionValue] = useState('');
  const [newRuleTarget, setNewRuleTarget] = useState('Support team');
  const [newRuleStrategy, setNewRuleStrategy] = useState<RoutingStrategy>('round robin');

  const [isAddHolidayOpen, setIsAddHolidayOpen] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');
  const [holidayDateError, setHolidayDateError] = useState<string | null>(null);

  // ── Handler Functions ────────────────────────────────────────────────
  const handleToggleDay = (index: number) => {
    setConfig((prev) => {
      const nextSchedule = [...prev.schedule];
      nextSchedule[index] = {
        ...nextSchedule[index],
        enabled: !nextSchedule[index].enabled,
      };
      const nextOpenText = getNextOpenTimeText(nextSchedule, new Date(), prev.timezone);
      const updatedReply = updateAfterHoursMessage(prev.afterHoursReply, nextOpenText);
      return { ...prev, schedule: nextSchedule, afterHoursReply: updatedReply };
    });
    setHasChanges(true);
  };

  const handleTimeChange = (index: number, field: 'start' | 'end', val: string) => {
    setConfig((prev) => {
      const nextSchedule = [...prev.schedule];
      nextSchedule[index] = {
        ...nextSchedule[index],
        [field]: val,
      };
      let updatedReply = prev.afterHoursReply;
      if (field === 'start') {
        const nextOpenText = getNextOpenTimeText(nextSchedule, new Date(), prev.timezone);
        updatedReply = updateAfterHoursMessage(prev.afterHoursReply, nextOpenText);
      }
      return { ...prev, schedule: nextSchedule, afterHoursReply: updatedReply };
    });
    setHasChanges(true);
  };

  const handleSave = async () => {
    try {
      setIsSaving(true);
      const res = await apiClient.post('/api/settings/routing', { routingConfig: config });
      if (res.data?.success) {
        setSavedConfig(config);
        setHasChanges(false);
        gooeyToast.success('Routing and business hours saved successfully!');
      }
    } catch (err: any) {
      gooeyToast.error('Failed to save routing settings', {
        description: err.response?.data?.message || err.message,
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = () => {
    setConfig(savedConfig);
    setHasChanges(false);
    gooeyToast.info('Changes discarded');
  };

  const handleOpenAddRule = () => {
    setEditingRuleId(null);
    setNewRuleConditionType('tag');
    setNewRuleConditionValue('');
    setNewRuleTarget('Support team');
    setNewRuleStrategy('round robin');
    setIsAddRuleOpen(true);
  };

  const handleOpenEditRule = (rule: AssignmentRule) => {
    setEditingRuleId(rule.id);
    setNewRuleConditionType(rule.condition === 'fallback' ? 'fallback' : rule.condition);
    setNewRuleConditionValue(
      rule.conditionLabel.replace(/tag is |language is |order value ≥ /gi, '')
    );
    setNewRuleTarget(rule.target);
    setNewRuleStrategy(rule.strategy);
    setIsAddRuleOpen(true);
  };

  const handleSaveRule = (e: React.FormEvent) => {
    e.preventDefault();

    if (editingRuleId) {
      // Editing an existing rule (including the fallback rule!)
      setConfig((prev) => {
        const rules = prev.assignmentRules.map((r) => {
          if (r.id !== editingRuleId) return r;
          let label = r.conditionLabel;
          if (r.condition !== 'fallback') {
            if (newRuleConditionType === 'tag') label = `tag is ${newRuleConditionValue.trim()}`;
            else if (newRuleConditionType === 'language') label = `language is ${newRuleConditionValue.trim()}`;
            else if (newRuleConditionType === 'order_value') label = `order value ≥ ${newRuleConditionValue.trim()}`;
            else label = newRuleConditionValue.trim();
          }
          return {
            ...r,
            condition: r.condition === 'fallback' ? 'fallback' : newRuleConditionType,
            conditionLabel: label,
            target: newRuleTarget.trim(),
            targetType: (newRuleTarget.toLowerCase().includes('team') || newRuleTarget.toLowerCase().includes('agents') ? 'team' : 'agent') as 'team' | 'agent',
            strategy: newRuleStrategy,
          };
        });
        return { ...prev, assignmentRules: rules };
      });
      setHasChanges(true);
      setIsAddRuleOpen(false);
      setEditingRuleId(null);
      gooeyToast.success('Assignment rule updated');
      return;
    }

    if (!newRuleConditionValue.trim()) return;

    let label = '';
    if (newRuleConditionType === 'tag') label = `tag is ${newRuleConditionValue.trim()}`;
    else if (newRuleConditionType === 'language') label = `language is ${newRuleConditionValue.trim()}`;
    else if (newRuleConditionType === 'order_value') label = `order value ≥ ${newRuleConditionValue.trim()}`;
    else label = newRuleConditionValue.trim();

    const newRule: AssignmentRule = {
      id: `rule-${Date.now()}`,
      condition: newRuleConditionType,
      conditionLabel: label,
      target: newRuleTarget.trim(),
      targetType: newRuleTarget.toLowerCase().includes('team') || newRuleTarget.toLowerCase().includes('agents') ? 'team' : 'agent',
      strategy: newRuleStrategy,
    };

    setConfig((prev) => {
      // Place right before the fallback rule
      const rules = [...prev.assignmentRules];
      const fallbackIdx = rules.findIndex((r) => r.isDefault);
      if (fallbackIdx !== -1) {
        rules.splice(fallbackIdx, 0, newRule);
      } else {
        rules.push(newRule);
      }
      return { ...prev, assignmentRules: rules };
    });

    setHasChanges(true);
    setIsAddRuleOpen(false);
    setNewRuleConditionValue('');
    gooeyToast.success('Assignment rule added');
  };

  const handleDeleteRule = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      assignmentRules: prev.assignmentRules.filter((r) => r.id !== id),
    }));
    setHasChanges(true);
    gooeyToast.success('Rule removed');
  };

  const handleAddHoliday = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newHolidayName.trim()) {
      gooeyToast.error('Please enter a holiday name');
      return;
    }
    if (!newHolidayDate.trim()) {
      setHolidayDateError('Please enter a date or range');
      gooeyToast.error('Please enter a date or range');
      return;
    }

    const validation = isValidHolidayDateInput(newHolidayDate);
    if (!validation.valid) {
      setHolidayDateError(validation.error || 'Invalid date format');
      gooeyToast.error(validation.error || 'Invalid date format');
      return;
    }

    setHolidayDateError(null);
    setConfig((prev) => ({
      ...prev,
      holidays: [
        ...prev.holidays,
        { id: `h-${Date.now()}`, name: newHolidayName.trim(), date: newHolidayDate.trim() },
      ],
    }));
    setHasChanges(true);
    setIsAddHolidayOpen(false);
    setNewHolidayName('');
    setNewHolidayDate('');
    gooeyToast.success('Holiday added');
  };

  const handleDeleteHoliday = (id: string) => {
    setConfig((prev) => ({
      ...prev,
      holidays: prev.holidays.filter((h) => h.id !== id),
    }));
    setHasChanges(true);
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-4 space-y-6 pb-20 font-sans">
      {/* ── Top Header Bar ────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="text-xs text-slate-400 font-medium mb-1">
            <span>Settings</span>
            <span className="mx-1.5 text-slate-300">/</span>
            <span className="text-slate-700">Routing & hours</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Routing & hours</h1>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={handleDiscard}
            disabled={!hasChanges || isSaving}
            className={`px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
              hasChanges
                ? 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50 cursor-pointer shadow-xs'
                : 'bg-slate-50 text-slate-300 border-slate-200 cursor-not-allowed'
            }`}
          >
            Discard
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-5 py-2 rounded-xl text-xs font-semibold bg-[#1e2a78] hover:bg-[#16205e] text-white cursor-pointer shadow-xs transition-all flex items-center gap-1.5"
          >
            {isSaving ? (
              <span>Saving…</span>
            ) : (
              <>
                <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Save changes</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* ── Card 1: Business hours ─────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6">
        <div className="mb-6">
          <h2 className="text-base font-bold text-slate-900">Business hours</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {config.timezone}. Outside these hours the after-hours reply is sent and chats wait in the queue.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: 7 Days of the Week */}
          <div className="lg:col-span-7 space-y-3.5">
            {config.schedule.map((slot, index) => (
              <div key={slot.day} className="flex items-center gap-4 text-xs">
                {/* Switch Toggle */}
                <button
                  type="button"
                  onClick={() => handleToggleDay(index)}
                  className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                    slot.enabled ? 'bg-[#1e2a78]' : 'bg-slate-200'
                  }`}
                  aria-label={`Toggle ${slot.day}`}
                >
                  <div
                    className={`bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform ${
                      slot.enabled ? 'translate-x-4' : 'translate-x-0'
                    }`}
                  />
                </button>

                {/* Day Label */}
                <span className="w-24 font-medium text-slate-800 text-[13px]">{slot.day}</span>

                {/* Hours inputs or Closed message */}
                {slot.enabled ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={slot.start}
                      onChange={(e) => handleTimeChange(index, 'start', e.target.value)}
                      className="w-18 px-2.5 py-1.5 text-center text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
                      placeholder="09:00"
                    />
                    <span className="text-slate-400 text-xs font-normal">to</span>
                    <input
                      type="text"
                      value={slot.end}
                      onChange={(e) => handleTimeChange(index, 'end', e.target.value)}
                      className="w-18 px-2.5 py-1.5 text-center text-xs font-mono bg-white border border-slate-200 rounded-lg text-slate-800 focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
                      placeholder="18:00"
                    />
                  </div>
                ) : (
                  <span className="text-slate-400 italic text-xs">Closed · bot only</span>
                )}
              </div>
            ))}
          </div>

          {/* Right Column: After-hours reply & Holidays Card */}
          <div className="lg:col-span-5 bg-[#f8f9fc] border border-slate-200/80 rounded-2xl p-5 space-y-6">
            {/* After-hours reply */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-800">After-hours reply</span>
                <span className="px-2 py-0.5 rounded-md bg-slate-200/80 text-slate-600 font-semibold text-[10px] tracking-wide">
                  Utility-free
                </span>
              </div>
              <textarea
                value={config.afterHoursReply}
                onChange={(e) => {
                  setConfig((prev) => ({ ...prev, afterHoursReply: e.target.value }));
                  setHasChanges(true);
                }}
                rows={3}
                className="w-full text-xs text-slate-700 bg-white border border-slate-200 rounded-xl p-3 leading-relaxed focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78] resize-none"
              />
            </div>

            {/* Holidays List */}
            <div className="border-t border-slate-200/60 pt-4">
              <div className="flex items-center justify-between mb-2.5">
                <span className="text-xs font-bold text-slate-800">Holidays</span>
                <button
                  type="button"
                  onClick={() => {
                    setNewHolidayName('');
                    setNewHolidayDate('');
                    setHolidayDateError(null);
                    setIsAddHolidayOpen(true);
                  }}
                  className="text-[11px] font-semibold text-[#1e2a78] hover:underline cursor-pointer flex items-center gap-1"
                >
                  <Plus className="w-3 h-3" /> Add
                </button>
              </div>

              <div className="space-y-1.5 text-xs">
                {config.holidays.map((h) => (
                  <div key={h.id} className="flex items-center justify-between group py-0.5">
                    <span className="text-slate-700">
                      <strong>{h.name}</strong> · <span className="text-slate-500">{h.date}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => handleDeleteHoliday(h.id)}
                      className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 transition-opacity cursor-pointer p-0.5"
                      title="Remove holiday"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Card 2: Assignment rules ───────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-2xs p-6">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Assignment rules</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Checked top to bottom. The first rule that matches assigns the chat.
            </p>
          </div>
          <button
            type="button"
            onClick={handleOpenAddRule}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-2xs transition-colors cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5 text-slate-500" />
            Add rule
          </button>
        </div>

        {/* Rules Table / Rows */}
        <div className="space-y-2.5 mb-6">
          {config.assignmentRules.map((rule) => (
            <div
              key={rule.id}
              className="flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-200/80 bg-white hover:border-slate-300 transition-colors text-xs"
            >
              {/* Left group: Drag handle + Condition + Target */}
              <div className="flex items-center gap-3 flex-wrap">
                <GripVertical className="w-4 h-4 text-slate-300 shrink-0 cursor-grab" />
                <span className="text-slate-500 font-medium">
                  {rule.isDefault ? 'Otherwise' : 'If'}
                </span>

                {/* Condition Pill */}
                <span className="px-3 py-1 rounded-full bg-[#eef0fb] text-[#1e2a78] font-semibold text-xs border border-indigo-100 shadow-2xs">
                  {rule.conditionLabel}
                </span>

                <span className="text-slate-400 font-normal">assign to</span>

                {/* Target Team / Agent Pill */}
                <span className="px-3 py-1 rounded-full bg-[#eaf8f0] text-[#15803d] font-semibold text-xs border border-emerald-100 shadow-2xs">
                  {rule.target}
                </span>
              </div>

              {/* Right group: Strategy label + Action menu */}
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-slate-400 text-[11px] font-medium lowercase">
                  {rule.strategy}
                </span>
                <button
                  type="button"
                  onClick={() => handleOpenEditRule(rule)}
                  className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700 flex items-center justify-center transition-colors cursor-pointer"
                  title="Edit rule"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                {!rule.isDefault && (
                  <button
                    type="button"
                    onClick={() => handleDeleteRule(rule.id)}
                    className="w-7 h-7 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-red-600 flex items-center justify-center transition-colors cursor-pointer"
                    title="Remove rule"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom Bar: First response target + Bot handover toggle */}
        <div className="border-t border-slate-100 pt-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          {/* First response target */}
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-700">First response target</span>
            <input
              type="number"
              min={1}
              max={180}
              value={config.firstResponseTargetMin}
              onChange={(e) => {
                setConfig((prev) => ({
                  ...prev,
                  firstResponseTargetMin: Number(e.target.value) || 10,
                }));
                setHasChanges(true);
              }}
              className="w-14 px-2 py-1 text-center font-semibold text-slate-900 bg-white border border-slate-200 rounded-lg focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
            />
            <span className="text-slate-400 font-medium">min</span>
          </div>

          {/* Bot Answers First Toggle */}
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={() => {
                setConfig((prev) => ({ ...prev, botAnswersFirst: !prev.botAnswersFirst }));
                setHasChanges(true);
              }}
              className={`w-9 h-5 flex items-center rounded-full p-0.5 transition-colors cursor-pointer shrink-0 ${
                config.botAnswersFirst ? 'bg-[#1e2a78]' : 'bg-slate-200'
              }`}
              aria-label="Toggle bot answers first"
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-xs transform transition-transform ${
                  config.botAnswersFirst ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className="font-medium text-slate-700">
              Bot answers first; hand over on &quot;Talk to a person&quot;
            </span>
          </div>
        </div>
      </div>

      {/* ── Modal: Add / Edit Assignment Rule ─────────────────────────── */}
      {isAddRuleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">
                {editingRuleId ? 'Edit assignment rule' : 'Add assignment rule'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsAddRuleOpen(false);
                  setEditingRuleId(null);
                }}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRule} className="space-y-4 text-xs">
              {newRuleConditionType === 'fallback' ? (
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Condition</label>
                  <div className="p-2.5 bg-slate-100 border border-slate-200 rounded-xl text-slate-600 font-medium">
                    Otherwise: any chat (fallback rule)
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Condition type</label>
                    <select
                      value={newRuleConditionType}
                      onChange={(e) => setNewRuleConditionType(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#1e2a78] text-slate-800"
                    >
                      <option value="tag">Customer Tag (e.g. Wholesale, VIP)</option>
                      <option value="language">Customer Language (e.g. Tamil, Hindi, Spanish)</option>
                      <option value="order_value">Shopify Order Value (e.g. ₹5,000, $100)</option>
                      <option value="channel">Channel (e.g. WhatsApp, Instagram, Email)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Condition value</label>
                    <input
                      type="text"
                      placeholder="e.g. Wholesale, Tamil, or 5000"
                      value={newRuleConditionValue}
                      onChange={(e) => setNewRuleConditionValue(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#1e2a78] text-slate-800"
                      required
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assign to team or agent</label>
                <input
                  type="text"
                  placeholder="e.g. Support team, Sales team, or Suresh R."
                  value={newRuleTarget}
                  onChange={(e) => setNewRuleTarget(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#1e2a78] text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Distribution strategy</label>
                <select
                  value={newRuleStrategy}
                  onChange={(e) => setNewRuleStrategy(e.target.value as RoutingStrategy)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#1e2a78] text-slate-800"
                >
                  <option value="round robin">Round robin (distribute evenly across team)</option>
                  <option value="least busy">Least busy (assign agent with fewest open tickets)</option>
                  <option value="direct">Direct (assign to specific named agent)</option>
                </select>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddRuleOpen(false);
                    setEditingRuleId(null);
                  }}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#1e2a78] hover:bg-[#16205e] text-white rounded-xl font-semibold cursor-pointer"
                >
                  {editingRuleId ? 'Save rule' : 'Add rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Add Holiday ─────────────────────────────────────── */}
      {isAddHolidayOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-sm w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add holiday</h3>
              <button
                type="button"
                onClick={() => setIsAddHolidayOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddHoliday} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Holiday name</label>
                <input
                  type="text"
                  placeholder="e.g. New Year's Day"
                  value={newHolidayName}
                  onChange={(e) => setNewHolidayName(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#1e2a78] text-slate-800"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Date or range</label>
                <input
                  type="text"
                  placeholder="e.g. 1 Jan 2027 or 14–16 Jan 2027"
                  value={newHolidayDate}
                  onChange={(e) => {
                    setNewHolidayDate(e.target.value);
                    if (holidayDateError) setHolidayDateError(null);
                  }}
                  className={`w-full p-2 bg-slate-50 border rounded-xl focus:bg-white text-slate-800 ${
                    holidayDateError
                      ? 'border-red-400 focus:border-red-500 focus:ring-1 focus:ring-red-200'
                      : 'border-slate-200 focus:border-[#1e2a78]'
                  }`}
                  required
                />
                {holidayDateError && (
                  <p className="text-red-500 text-[11px] mt-1 font-medium">{holidayDateError}</p>
                )}
                <p className="text-[10px] text-slate-400 mt-1">
                  Supported formats: <code>1 Jan 2027</code>, <code>14–16 Jan 2027</code>, <code>2027-01-01</code>
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-3 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsAddHolidayOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#1e2a78] hover:bg-[#16205e] text-white rounded-xl font-semibold cursor-pointer"
                >
                  Save holiday
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

