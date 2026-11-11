'use client';

import React from 'react';
import {
  MessageCircle, Hash, Bell, GitBranch, Search, UserCheck,
  Send, FileText, UserPlus, PenLine, StopCircle, MessageSquareText, Workflow, Filter, Hourglass,
} from 'lucide-react';
import { getPaletteItem } from './palette-config';

const ICON_MAP: Record<string, React.FC<{ className?: string }>> = {
  MessageCircle, Hash, Bell, GitBranch, Search, UserCheck,
  Send, FileText, UserPlus, PenLine, StopCircle, MessageSquareText, Filter, Hourglass,
};

/** Icon for a step type (falls back to a generic workflow glyph for unknown types). */
export function NodeTypeIcon({ type, className }: { type: string; className?: string }) {
  const Icon = ICON_MAP[getPaletteItem(type)?.icon ?? ''] ?? Workflow;
  return <Icon className={className} />;
}
