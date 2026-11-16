import { db } from "../db";
import { organizations, users, tickets } from "../db/schema";
import { eq, and, notInArray, sql } from "drizzle-orm";
import { createLogger } from "../logger";

const log = createLogger("AssignmentEngine");

export type RoutingStrategy = "round robin" | "least busy" | "direct";

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

export interface BusinessHoursResult {
  isWithin: boolean;
  reason?: "closed_day" | "outside_schedule" | "holiday";
  holidayName?: string;
  matchedDay?: string;
  schedule?: { start: string; end: string };
  currentTime?: string;
  afterHoursReply?: string;
}

export interface AssignmentRule {
  id: string;
  condition: string;
  conditionLabel: string;
  target: string;
  targetType: "team" | "agent";
  strategy: RoutingStrategy;
  isDefault?: boolean;
}

export interface RoutingHoursConfig {
  timezone?: string;
  schedule?: DaySchedule[];
  afterHoursReply?: string;
  holidays?: Holiday[];
  assignmentRules: AssignmentRule[];
  firstResponseTargetMin?: number;
  botAnswersFirst?: boolean;
}

export class AssignmentEngine {
  /**
   * Retrieves the configured routing rules for an organization.
   * If not explicitly stored, returns standard defaults (assigning fallback to Support team round-robin).
   */
  async getRoutingConfig(organizationId: number): Promise<RoutingHoursConfig | null> {
    const [org] = await db
      .select({ rolePermissions: organizations.rolePermissions })
      .from(organizations)
      .where(eq(organizations.id, organizationId))
      .limit(1);

    const stored = (org?.rolePermissions as Record<string, any>)?.routingConfig as RoutingHoursConfig | undefined;
    return stored || null;
  }

  /**
   * Resolves the best matching assignee for a newly created ticket based on active rules.
   */
  async resolveAssignee(
    organizationId: number,
    ticketContext: {
      tags?: string[];
      language?: string | null;
      channelId?: number | null;
      atDate?: Date;
    } = {}
  ): Promise<{ assigneeId: number; assigneeName: string } | null> {
    try {
      const config = await this.getRoutingConfig(organizationId);

      // Check botAnswersFirst: chats are handled by bot first before handover
      if (config?.botAnswersFirst) {
        log.info("Ticket auto-assignment skipped: 'Bot answers first' is enabled", { organizationId });
        return null;
      }

      // Check Business Hours: outside hours chats wait in queue unassigned
      const hoursCheck = this.isWithinBusinessHours(config, ticketContext.atDate ?? new Date());
      if (!hoursCheck.isWithin) {
        log.info("Ticket auto-assignment skipped: outside business hours (chat waits in queue)", {
          organizationId,
          reason: hoursCheck.reason,
          matchedDay: hoursCheck.matchedDay,
        });
        return null;
      }

      const rules = config?.assignmentRules && config.assignmentRules.length > 0
        ? config.assignmentRules
        : [
            {
              id: "r-default",
              condition: "fallback",
              conditionLabel: "any chat",
              target: "Support team",
              targetType: "team" as const,
              strategy: "round robin" as const,
              isDefault: true,
            },
          ];

      // Find all active, eligible teammates for this organization
      const allTeammates = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          teams: users.teams,
          languages: users.languages,
          status: users.status,
        })
        .from(users)
        .where(eq(users.organizationId, organizationId));

      const eligibleTeammates = allTeammates.filter(
        (u) =>
          (u.role || "AGENT").toUpperCase() !== "VIEWER" &&
          (u.status || "active").toLowerCase() !== "invited" &&
          (u.status || "active").toLowerCase() !== "deactivated"
      );

      if (eligibleTeammates.length === 0) return null;

      // Evaluate rules top-to-bottom
      for (const rule of rules) {
        let matches = false;

        if (rule.isDefault || rule.condition === "fallback") {
          matches = true;
        } else if (rule.condition === "tag") {
          const expectedTag = (rule.conditionLabel.split("tag is")[1] || "").trim().toLowerCase();
          if (expectedTag && ticketContext.tags?.some((t) => t.toLowerCase() === expectedTag)) {
            matches = true;
          }
        } else if (rule.condition === "language") {
          const expectedLang = (rule.conditionLabel.split("language is")[1] || "").trim().toLowerCase();
          if (expectedLang && ticketContext.language?.toLowerCase().includes(expectedLang)) {
            matches = true;
          }
        }

        if (!matches) continue;

        // Rule matches! Determine candidates
        let candidates = eligibleTeammates;
        if (rule.targetType === "agent") {
          candidates = eligibleTeammates.filter(
            (u) => u.name.toLowerCase() === rule.target.toLowerCase()
          );
        } else {
          // Team target, e.g. "Support team" -> match "Support"
          const teamNameClean = rule.target.replace(/team|agents/gi, "").trim().toLowerCase();
          if (teamNameClean) {
            candidates = eligibleTeammates.filter((u) =>
              (u.teams || []).some((t) => t.toLowerCase().includes(teamNameClean))
            );
          }
        }

        // Fallback to all eligible if team has no specific members
        if (candidates.length === 0) {
          candidates = eligibleTeammates;
        }

        const picked = await this.pickCandidate(organizationId, candidates, rule.strategy);
        if (picked) {
          log.info("Ticket assigned via rule", {
            organizationId,
            ruleId: rule.id,
            target: rule.target,
            strategy: rule.strategy,
            assigneeId: picked.id,
            assigneeName: picked.name,
          });
          return { assigneeId: picked.id, assigneeName: picked.name };
        }
      }

      return null;
    } catch (err: any) {
      log.warn("Failed to resolve assignee for ticket", { err: err?.message });
      return null;
    }
  }

  /**
   * Selects candidate based on strategy (round robin, least busy, direct).
   */
  private async pickCandidate(
    organizationId: number,
    candidates: Array<{ id: number; name: string }>,
    strategy: RoutingStrategy
  ): Promise<{ id: number; name: string } | null> {
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const candidateIds = candidates.map((c) => c.id);

    if (strategy === "least busy") {
      // Find open ticket count per candidate
      const counts = await db
        .select({
          assigneeId: tickets.assigneeId,
          count: sql<number>`count(*)::int`,
        })
        .from(tickets)
        .where(
          and(
            eq(tickets.organizationId, organizationId),
            notInArray(tickets.status, ["RESOLVED", "CLOSED"])
          )
        )
        .groupBy(tickets.assigneeId);

      const countMap = new Map<number, number>();
      candidateIds.forEach((id) => countMap.set(id, 0));
      counts.forEach((row) => {
        if (row.assigneeId && countMap.has(row.assigneeId)) {
          countMap.set(row.assigneeId, row.count);
        }
      });

      let minCount = Infinity;
      let bestCandidate = candidates[0];
      for (const c of candidates) {
        const count = countMap.get(c.id) ?? 0;
        if (count < minCount) {
          minCount = count;
          bestCandidate = c;
        }
      }
      return bestCandidate;
    }

    // Default / Round robin: Pick candidate who least recently received an assigned ticket
    const recentAssigned = await db
      .select({
        assigneeId: tickets.assigneeId,
        lastAssignedAt: sql<Date>`max(${tickets.createdAt})`,
      })
      .from(tickets)
      .where(and(eq(tickets.organizationId, organizationId)))
      .groupBy(tickets.assigneeId);

    const lastMap = new Map<number, number>();
    recentAssigned.forEach((r) => {
      if (r.assigneeId) {
        lastMap.set(r.assigneeId, new Date(r.lastAssignedAt).getTime());
      }
    });

    // Candidates never assigned before come first
    let oldestTime = Infinity;
    let selected = candidates[0];
    for (const c of candidates) {
      const t = lastMap.get(c.id) ?? 0;
      if (t < oldestTime) {
        oldestTime = t;
        selected = c;
      }
    }

    return selected;
  }

  /**
   * Evaluates if the given date/time is within configured business hours and not on a holiday or closed day.
   */
  isWithinBusinessHours(
    config: RoutingHoursConfig | null,
    date: Date = new Date()
  ): BusinessHoursResult {
    // If no config or schedule, defaults to standard business hours: Mon-Sat 09:30-19:00, Sun closed
    const activeSchedule = config?.schedule && config.schedule.length > 0
      ? config.schedule
      : [
          { day: "Monday", enabled: true, start: "09:30", end: "19:00" },
          { day: "Tuesday", enabled: true, start: "09:30", end: "19:00" },
          { day: "Wednesday", enabled: true, start: "09:30", end: "19:00" },
          { day: "Thursday", enabled: true, start: "09:30", end: "19:00" },
          { day: "Friday", enabled: true, start: "09:30", end: "19:00" },
          { day: "Saturday", enabled: true, start: "10:00", end: "16:00" },
          { day: "Sunday", enabled: false, start: "09:30", end: "18:00" },
        ];

    const rawTz = config?.timezone || "Asia/Kolkata";
    const tz = rawTz.replace(/\s*\(.*\)/, "").trim() || "Asia/Kolkata";

    let weekday = "";
    let currentHHMM = "";
    let currentYear = 0;
    let currentMonth = 0;
    let currentDay = 0;

    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        year: "numeric",
        month: "numeric",
        day: "numeric",
      });
      const parts = formatter.formatToParts(date);
      const partMap: Record<string, string> = {};
      for (const p of parts) {
        partMap[p.type] = p.value;
      }
      weekday = partMap.weekday || "";
      const hh = (partMap.hour || "00").padStart(2, "0");
      const mm = (partMap.minute || "00").padStart(2, "0");
      currentHHMM = `${hh}:${mm}`;
      currentYear = parseInt(partMap.year || "0", 10);
      currentMonth = parseInt(partMap.month || "0", 10);
      currentDay = parseInt(partMap.day || "0", 10);
    } catch {
      const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      weekday = dayNames[date.getDay()];
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      currentHHMM = `${hh}:${mm}`;
      currentYear = date.getFullYear();
      currentMonth = date.getMonth() + 1;
      currentDay = date.getDate();
    }

    // Check holidays
    if (config?.holidays && config.holidays.length > 0) {
      for (const h of config.holidays) {
        if (this.matchesHoliday(h.date, currentYear, currentMonth, currentDay)) {
          return {
            isWithin: false,
            reason: "holiday",
            holidayName: h.name,
            afterHoursReply: config.afterHoursReply,
          };
        }
      }
    }

    const daySched = activeSchedule.find(
      (s) => s.day.toLowerCase() === weekday.toLowerCase()
    );

    if (!daySched || !daySched.enabled) {
      return {
        isWithin: false,
        reason: "closed_day",
        matchedDay: weekday,
        afterHoursReply: config?.afterHoursReply,
      };
    }

    if (currentHHMM < daySched.start || currentHHMM > daySched.end) {
      return {
        isWithin: false,
        reason: "outside_schedule",
        matchedDay: weekday,
        schedule: { start: daySched.start, end: daySched.end },
        currentTime: currentHHMM,
        afterHoursReply: config?.afterHoursReply,
      };
    }

    return {
      isWithin: true,
      matchedDay: weekday,
      schedule: { start: daySched.start, end: daySched.end },
    };
  }

  private matchesHoliday(
    dateStr: string,
    currentYear: number,
    currentMonth: number,
    currentDay: number
  ): boolean {
    if (!dateStr) return false;
    const clean = dateStr.trim();
    // Range match e.g. "14–16 Jan 2027" or "14-16 Jan 2027"
    const rangeMatch = clean.match(/^(\d{1,2})\s*[-–—]\s*(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
    if (rangeMatch) {
      const startDay = parseInt(rangeMatch[1], 10);
      const endDay = parseInt(rangeMatch[2], 10);
      const monthName = rangeMatch[3];
      const year = parseInt(rangeMatch[4], 10);
      const month = new Date(`${monthName} 1, 2000`).getMonth() + 1;
      if (year === currentYear && month === currentMonth && currentDay >= startDay && currentDay <= endDay) {
        return true;
      }
    }

    // Single date parse e.g. "8 Nov 2026" or "2026-11-08"
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      if (parsed.getFullYear() === currentYear && (parsed.getMonth() + 1) === currentMonth && parsed.getDate() === currentDay) {
        return true;
      }
    }

    return false;
  }

  /**
   * Resolves the dynamic next-open time label (e.g. "Sat 10:00 AM" or "Mon 9:30 AM")
   */
  getNextOpenTimeText(
    schedule: DaySchedule[],
    date: Date = new Date(),
    rawTimezone: string = "Asia/Kolkata"
  ): string {
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const SHORT_DAYS: Record<string, string> = {
      Sunday: "Sun",
      Monday: "Mon",
      Tuesday: "Tue",
      Wednesday: "Wed",
      Thursday: "Thu",
      Friday: "Fri",
      Saturday: "Sat",
    };

    if (!schedule || schedule.length === 0) return "Mon 9:30 AM";

    const tz = (rawTimezone || "Asia/Kolkata").replace(/\s*\(.*\)/, "").trim() || "Asia/Kolkata";

    let weekday = "";
    let currentHHMM = "";

    try {
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "long",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(date);
      const partMap: Record<string, string> = {};
      for (const p of parts) partMap[p.type] = p.value;
      weekday = partMap.weekday || "";
      const hh = (partMap.hour || "00").padStart(2, "0");
      const mm = (partMap.minute || "00").padStart(2, "0");
      currentHHMM = `${hh}:${mm}`;
    } catch {
      weekday = DAY_NAMES[date.getDay()];
      const hh = String(date.getHours()).padStart(2, "0");
      const mm = String(date.getMinutes()).padStart(2, "0");
      currentHHMM = `${hh}:${mm}`;
    }

    const currentDayIndex = DAY_NAMES.findIndex((d) => d.toLowerCase() === weekday.toLowerCase());
    const todayIndex = currentDayIndex >= 0 ? currentDayIndex : date.getDay();

    // 1. Check if today is open and has not started yet
    const todaySlot = schedule.find((s) => s.day.toLowerCase() === weekday.toLowerCase());
    if (todaySlot && todaySlot.enabled && currentHHMM < todaySlot.start) {
      return `${SHORT_DAYS[todaySlot.day] || todaySlot.day.slice(0, 3)} ${this.formatTime12(todaySlot.start)}`;
    }

    // 2. Check next 7 days in order
    for (let offset = 1; offset <= 7; offset++) {
      const nextDayIndex = (todayIndex + offset) % 7;
      const nextDayName = DAY_NAMES[nextDayIndex];
      const slot = schedule.find((s) => s.day.toLowerCase() === nextDayName.toLowerCase());

      if (slot && slot.enabled) {
        const shortDay = SHORT_DAYS[slot.day] || slot.day.slice(0, 3);
        const time12 = this.formatTime12(slot.start);
        return `${shortDay} ${time12}`;
      }
    }

    return "Mon 9:30 AM";
  }

  private formatTime12(timeStr: string): string {
    if (!timeStr) return "9:30 AM";
    const [hhStr, mmStr] = timeStr.split(":");
    const hh = parseInt(hhStr, 10);
    const mm = parseInt(mmStr || "0", 10);
    if (isNaN(hh)) return timeStr;
    const period = hh >= 12 ? "PM" : "AM";
    const hour12 = hh % 12 === 0 ? 12 : hh % 12;
    const minuteStr = String(mm).padStart(2, "0");
    return `${hour12}:${minuteStr} ${period}`;
  }

  /**
   * Formats the after-hours reply message by dynamically replacing the "back at ..." time
   * with the accurate next open schedule (e.g. "back at Sat 10:00 AM" or "back at Mon 9:30 AM").
   */
  formatAfterHoursReply(
    template: string | undefined,
    schedule: DaySchedule[] | undefined,
    date: Date = new Date(),
    rawTimezone: string = "Asia/Kolkata"
  ): string {
    const rawTemplate =
      template?.trim() ||
      "Thanks for your message. Our team is back at 9:30 AM. Meanwhile you can track orders, start an exchange or browse the catalog below.";

    const nextOpen = this.getNextOpenTimeText(schedule || [], date, rawTimezone);

    const regex = /(back\s+(?:at|on)\s+)(?:(?:today|tomorrow|Mon(?:day)?|Tue(?:sday)?|Wed(?:nesday)?|Thu(?:rsday)?|Fri(?:day)?|Sat(?:urday)?|Sun(?:day)?)\s*(?:at\s*)?)?\d{1,2}(?::\d{2})?\s*(?:AM|PM|am|pm)?/i;
    if (regex.test(rawTemplate)) {
      return rawTemplate.replace(regex, `$1${nextOpen}`);
    }

    return `Thanks for your message. Our team is back at ${nextOpen}. Meanwhile you can track orders, start an exchange or browse the catalog below.`;
  }
}

export const assignmentEngine = new AssignmentEngine();

