/**
 * Ticket lifecycle, shared by server and browser.
 *
 * A ticket is one inbox conversation with a customer (`tickets` table). Once a ticket is resolved it stays closed:
 * the customer's next message (or a teammate's next reply) opens a new follow-up ticket, so every ticket is a
 * unique piece of work. Every change to a ticket is written to the contact's thread as a team-only system note
 * whose `metadata.ticketEvent` is a TicketEvent: that is the ticket's audit log (who changed what, and when).
 */

export type TicketEventAction =
  /** A follow-up ticket was opened because the customer (or a teammate) wrote after the last one was resolved */
  | 'opened'
  | 'resolved'
  | 'reopened'
  /** Any other status change */
  | 'status'
  | 'assigned'
  | 'unassigned'
  /** The AI agent was turned on / paused for the conversation */
  | 'ai_on'
  | 'ai_off'
  /** A teammate's first reply made the ticket billable (one ticket credit) */
  | 'billable';

/** Why a ticket was assigned */
export type TicketAssignReason = 'manual' | 'take_over' | 'first_reply';

/** One change, stored in `messages.metadata.ticketEvent` of the system note that records it */
export interface TicketEvent {
  action: TicketEventAction;
  ticketId: number;
  /** Who made the change: a teammate, the customer (by writing), or UnoCX itself */
  actorType: 'agent' | 'customer' | 'system';
  actorId: number | null;
  actorName: string | null;
  assigneeId?: number | null;
  assigneeName?: string | null;
  assignReason?: TicketAssignReason;
  previousStatus?: string | null;
  status?: string | null;
  /** ISO 8601 */
  occurredAt: string;
}

/** Statuses that put a ticket in the Closed view */
export const CLOSED_TICKET_STATUSES = ['RESOLVED', 'CLOSED'];

export const isClosedTicketStatus = (status?: string | null): boolean =>
  Boolean(status && CLOSED_TICKET_STATUSES.includes(status.toUpperCase()));

/**
 * Mock billing: a ticket uses one credit the first time a teammate replies on it (`tickets.billable_at`).
 * The allowance is fixed for now; real plans and billing periods come later.
 */
export const TICKET_CREDIT_ALLOWANCE = 200;

export interface TicketCredits {
  allowance: number;
  /** Billable tickets so far */
  used: number;
  /** Never below 0; `used > allowance` means the workspace went over */
  remaining: number;
}
