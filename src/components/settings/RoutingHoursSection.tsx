'use client';

import React, { useState } from 'react';
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
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Modal states
  const [isAddRuleOpen, setIsAddRuleOpen] = useState(false);
  const [newRuleConditionType, setNewRuleConditionType] = useState('tag');
  const [newRuleConditionValue, setNewRuleConditionValue] = useState('');
  const [newRuleTarget, setNewRuleTarget] = useState('Sales team');
  const [newRuleStrategy, setNewRuleStrategy] = useState<RoutingStrategy>('round robin');

  const [isAddHolidayOpen, setIsAddHolidayOpen] = useState(false);
  const [newHolidayName, setNewHolidayName] = useState('');
  const [newHolidayDate, setNewHolidayDate] = useState('');

  // ── Handler Functions ────────────────────────────────────────────────
  const handleToggleDay = (index: number) => {
    setConfig((prev) => {
      const nextSchedule = [...prev.schedule];
      nextSchedule[index] = {
        ...nextSchedule[index],
        enabled: !nextSchedule[index].enabled,
      };
      return { ...prev, schedule: nextSchedule };
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
      return { ...prev, schedule: nextSchedule };
    });
    setHasChanges(true);
  };

  const handleSave = () => {
    setIsSaving(true);
    setTimeout(() => {
      setIsSaving(false);
      setHasChanges(false);
      gooeyToast.success('Routing and business hours saved successfully!');
    }, 600);
  };

  const handleDiscard = () => {
    setConfig(DEFAULT_CONFIG);
    setHasChanges(false);
    gooeyToast.info('Changes discarded');
  };

  const handleAddRule = (e: React.FormEvent) => {
    e.preventDefault();
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
      target: newRuleTarget,
      targetType: newRuleTarget.includes('team') || newRuleTarget.includes('agents') ? 'team' : 'agent',
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
    if (!newHolidayName.trim() || !newHolidayDate.trim()) return;

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
                  onClick={() => setIsAddHolidayOpen(true)}
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
            onClick={() => setIsAddRuleOpen(true)}
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
                {rule.isDefault && (
                  <span className="w-7 h-7 flex items-center justify-center text-slate-300" title="Fallback rule">
                    <MoreHorizontal className="w-4 h-4" />
                  </span>
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

      {/* ── Modal: Add Assignment Rule ─────────────────────────────── */}
      {isAddRuleOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-2xs p-4">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <h3 className="text-base font-bold text-slate-900">Add assignment rule</h3>
              <button
                type="button"
                onClick={() => setIsAddRuleOpen(false)}
                className="text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddRule} className="space-y-4 text-xs">
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

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Assign to team or agent</label>
                <input
                  type="text"
                  placeholder="e.g. Sales team, Support team, or Suresh R."
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
                  onClick={() => setIsAddRuleOpen(false)}
                  className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#1e2a78] hover:bg-[#16205e] text-white rounded-xl font-semibold cursor-pointer"
                >
                  Add rule
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
                  onChange={(e) => setNewHolidayDate(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-200 rounded-xl focus:bg-white focus:border-[#1e2a78] text-slate-800"
                  required
                />
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

